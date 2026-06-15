/**
 * 02_Headers.gs — Header-agnostic column resolver.
 *
 * This is the module that satisfies brief §4.5 ("Header-agnostic column lookup.
 * Reordering columns must not break the pipeline.") and verification protocol
 * step 1 (rename 2 columns → system continues to work).
 *
 * Resolution strategy is a hybrid:
 *   1. Alias map in `_Config` (aliases.<tabKey>.<canonical>) — deterministic.
 *   2. Normalized exact match (lowercased, non-alphanumeric stripped).
 *   3. Fuzzy fallback with similarity >= 0.85 AND uniqueness guard — logs a
 *      schema-drift WARN so HR can add the alias.
 *   4. If still unresolved → throws SchemaDriftError. Never silently guess.
 *
 * Public API:
 *   Header.resolve(sheet, tabKey)            → { [canonical]: 0-based colIndex }
 *   Header.col(sheet, tabKey, canonical)     → 0-based colIndex
 *   Header.rows(sheet, tabKey)               → Array<object>  (keyed by canonical)
 *   Header.SchemaDriftError                  → error class
 */

var Header = Header || {};

(function (ns) {
  ns.SchemaDriftError = function (canonical, tabName, headers) {
    this.name = 'SchemaDriftError';
    this.message = 'Could not resolve column "' + canonical + '" in tab "' + tabName + '". Headers found: ' + JSON.stringify(headers) + '. Add an alias to the _Config tab under aliases.' + tabName + '.' + canonical;
    this.canonical = canonical;
    this.tabName = tabName;
    this.headers = headers;
  };
  ns.SchemaDriftError.prototype = Object.create(Error.prototype);

  /**
   * Resolve canonical → column index for the given sheet/tab.
   * Cached per (tabName, row1 hash) so repeated calls are O(1).
   */
  ns.resolve = function (sheet, tabKey) {
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return {};
    var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var hash = simpleHash_(headerRow.join('|'));
    var cacheKey = 'headers:' + tabKey + ':' + hash;
    return Cache.wrap(cacheKey, 21600, function () {
      return resolveUncached_(headerRow, tabKey, sheet.getName());
    });
  };

  /**
   * Get the 0-based column index for a canonical column.
   */
  ns.col = function (sheet, tabKey, canonical) {
    var map = ns.resolve(sheet, tabKey);
    if (typeof map[canonical] !== 'number') {
      var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      throw new ns.SchemaDriftError(canonical, sheet.getName(), headerRow);
    }
    return map[canonical];
  };

  /**
   * Return every data row as an object keyed by canonical names.
   * Includes hidden field `__rowNum` (1-based row number in sheet) for writebacks.
   */
  ns.rows = function (sheet, tabKey) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol === 0) return [];

    var map = ns.resolve(sheet, tabKey);
    var canonicals = Object.keys(map);
    if (!canonicals.length) return [];

    var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var out = [];
    for (var r = 0; r < values.length; r++) {
      var rowVals = values[r];
      // Skip fully-empty rows (Apps Script often returns trailing empties).
      var hasContent = false;
      for (var c = 0; c < rowVals.length; c++) { if (rowVals[c] !== '' && rowVals[c] !== null) { hasContent = true; break; } }
      if (!hasContent) continue;

      var obj = { __rowNum: r + 2 };
      for (var i = 0; i < canonicals.length; i++) {
        obj[canonicals[i]] = rowVals[map[canonicals[i]]];
      }
      out.push(obj);
    }
    return out;
  };

  /**
   * Return the resolved raw row 1 header strings, indexed by column. Useful for
   * SelfMonitor schema-drift comparison.
   */
  ns.rawHeaders = function (sheet) {
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return [];
    return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  };

  // ───────── internals ─────────

  function resolveUncached_(headerRow, tabKey, tabDisplayName) {
    var normalizedHeaders = headerRow.map(normalize_);
    var canonicals = Config.canonicalCols(tabKey);
    var result = {};
    var runId = Log.start('Header.resolve', 'internal');

    for (var i = 0; i < canonicals.length; i++) {
      var canonical = canonicals[i];
      var aliases = Config.aliasesFor(tabKey, canonical).map(normalize_);

      // Pass 1: exact normalized alias match.
      var hit = -1;
      for (var j = 0; j < normalizedHeaders.length; j++) {
        if (aliases.indexOf(normalizedHeaders[j]) !== -1) { hit = j; break; }
      }

      // Pass 2: fuzzy match with uniqueness guard.
      if (hit < 0) {
        var canonicalNorm = normalize_(canonical);
        var candidates = [];
        for (var k = 0; k < normalizedHeaders.length; k++) {
          var s = similarity_(canonicalNorm, normalizedHeaders[k]);
          if (s >= 0.85) candidates.push({ idx: k, score: s });
        }
        if (candidates.length === 1) {
          hit = candidates[0].idx;
          Log.warn(runId, 'schema_drift_fuzzy', {
            tab: tabDisplayName,
            canonical: canonical,
            matched: headerRow[hit],
            score: candidates[0].score
          });
        } else if (candidates.length > 1) {
          Log.warn(runId, 'schema_drift_ambiguous', {
            tab: tabDisplayName,
            canonical: canonical,
            candidates: candidates.map(function (c) { return headerRow[c.idx]; })
          });
        }
      }

      // The column may be legitimately absent (e.g. `lwd` only on interns,
      // `allocationPct` only on US). We tolerate that — caller checks for
      // undefined and handles accordingly. The pipeline only throws when
      // a *required* column is missing, via Header.col().
      if (hit >= 0) result[canonical] = hit;
    }

    Log.end(runId, { tab: tabDisplayName, resolved: Object.keys(result).length, totalCanonicals: canonicals.length });
    return result;
  }

  /** Lowercase + strip non-alphanumerics. "Emp ID" === "EmployeeID" === "emp_id". */
  function normalize_(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Levenshtein-based similarity ratio in [0, 1]. */
  function similarity_(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    var d = levenshtein_(a, b);
    return 1 - d / Math.max(a.length, b.length);
  }

  function levenshtein_(a, b) {
    var m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    var prev = new Array(n + 1), curr = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      curr[0] = i;
      for (var k = 1; k <= n; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        curr[k] = Math.min(curr[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
      }
      var swap = prev; prev = curr; curr = swap;
    }
    return prev[n];
  }

  /** Small non-crypto hash for cache key construction. */
  function simpleHash_(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
})(Header);
