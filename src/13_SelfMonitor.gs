/**
 * 13_SelfMonitor.gs — Pipeline self-monitoring.
 *
 * Detects failure modes the pipeline can recover from (or at least surface)
 * before HR notices something is off:
 *
 *   - Missed scheduled runs — if the 5-min pulse hasn't fired in >15 min.
 *   - Mail quota near exhaustion — MailApp daily quota counter.
 *   - Schema drift — row 1 headers changed since last seen (fuzzy events in
 *     Logs are also surfaced).
 *   - Circuit breaker tripped — onEdit rebuild loop suppressed.
 *
 * Issues are reported to the Web App's system health badge and to a footer
 * on the Sheet Dashboard. They also land in Logs at WARN/ERROR level.
 *
 * Public API:
 *   SelfMonitor.checkAll()       → Issue[]   (and side-effect: writes to Logs)
 *   SelfMonitor.collect()        → Issue[]   (cheap, no side effects, for snapshot)
 *   SelfMonitor.checkMissedRuns()
 *   SelfMonitor.checkMailQuota()
 *   SelfMonitor.checkSchemaDrift()
 *   SelfMonitor.checkCircuitBreaker()
 *
 * Issue shape: { kind, severity: 'info'|'warning'|'critical', message, meta? }
 */

var SelfMonitor = SelfMonitor || {};

(function (ns) {
  var SCHEMA_PROP_PREFIX = 'schema:row1Hash:';
  var SCHEMA_LAST_HEADERS_PREFIX = 'schema:lastRow1:';
  var MISSED_RUN_THRESHOLD_MS = 15 * 60 * 1000;

  ns.checkAll = function () {
    var issues = [];
    issues = issues.concat(ns.checkMissedRuns());
    issues = issues.concat(ns.checkMailQuota());
    issues = issues.concat(ns.checkSchemaDrift());
    issues = issues.concat(ns.checkCircuitBreaker());
    // Cache the result so api_snapshot can include it without re-running checks.
    Cache.put('selfmonitor:issues:v1', issues, 120);
    return issues;
  };

  ns.collect = function () {
    var cached = Cache.get('selfmonitor:issues:v1');
    if (cached !== null) return cached;
    return ns.checkAll();
  };

  ns.checkMissedRuns = function () {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty('lastPulseAt');
    if (!raw) return [{ kind: 'missed_runs', severity: 'info', message: 'No pulse recorded yet (just bootstrapped?)' }];
    var lastPulseAt = parseInt(raw, 10);
    var gap = Date.now() - lastPulseAt;
    if (gap > MISSED_RUN_THRESHOLD_MS) {
      return [{ kind: 'missed_runs', severity: 'critical', message: 'Scheduled pulse has not fired in ' + Math.round(gap / 60000) + ' minutes. Re-install triggers from HR Automation menu.', meta: { lastPulseAt: new Date(lastPulseAt).toISOString() } }];
    }
    return [];
  };

  ns.checkMailQuota = function () {
    var left = (typeof Email !== 'undefined' && Email.quotaLeft) ? Email.quotaLeft() : -1;
    if (left === -1) return [];
    if (left < 10) return [{ kind: 'mail_quota', severity: 'critical', message: 'Mail quota critical: only ' + left + ' remaining today.' }];
    if (left < 30) return [{ kind: 'mail_quota', severity: 'warning', message: 'Mail quota low: ' + left + ' remaining today.' }];
    return [];
  };

  ns.checkSchemaDrift = function () {
    var issues = [];
    var props = PropertiesService.getScriptProperties();
    var tabKeys = Config.allTabKeys();
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    for (var i = 0; i < tabKeys.length; i++) {
      var key = tabKeys[i];
      var tabName = Config.canonicalToTabName(key);
      var sh = ss.getSheetByName(tabName);
      if (!sh) continue;

      var currentHeaders = Header.rawHeaders(sh);
      var currentHash = hashHeaders_(currentHeaders);
      var lastHash = props.getProperty(SCHEMA_PROP_PREFIX + key);
      var lastHeadersRaw = props.getProperty(SCHEMA_LAST_HEADERS_PREFIX + key);

      if (!lastHash) {
        // First time we've seen this tab — record current state.
        props.setProperty(SCHEMA_PROP_PREFIX + key, currentHash);
        props.setProperty(SCHEMA_LAST_HEADERS_PREFIX + key, JSON.stringify(currentHeaders));
        continue;
      }

      if (currentHash !== lastHash) {
        var prevHeaders = [];
        try { prevHeaders = JSON.parse(lastHeadersRaw || '[]'); } catch (e) {}
        var diff = headerDiff_(prevHeaders, currentHeaders);
        issues.push({
          kind: 'schema_drift',
          severity: diff.removed.length > 0 ? 'warning' : 'info',
          message: 'Headers changed on tab "' + tabName + '". ' + (diff.renamed.length ? 'Renamed: ' + diff.renamed.join(', ') + '. ' : '') + (diff.added.length ? 'Added: ' + diff.added.join(', ') + '. ' : '') + (diff.removed.length ? 'Removed: ' + diff.removed.join(', ') + '.' : ''),
          meta: { tab: tabName, prev: prevHeaders, curr: currentHeaders }
        });
        // Update tracking so we don't keep alerting on the same change.
        props.setProperty(SCHEMA_PROP_PREFIX + key, currentHash);
        props.setProperty(SCHEMA_LAST_HEADERS_PREFIX + key, JSON.stringify(currentHeaders));
      }
    }
    return issues;
  };

  ns.checkCircuitBreaker = function () {
    if (!isCircuitTripped_()) return [];
    var trippedAt = parseInt(PropertiesService.getScriptProperties().getProperty('circuit:tripped') || '0', 10);
    return [{
      kind: 'circuit_breaker',
      severity: 'critical',
      message: 'Rebuild circuit breaker is tripped. Suspected onEdit loop. Tripped at ' + new Date(trippedAt).toISOString() + '.',
      meta: { trippedAt: trippedAt }
    }];
  };

  // ───────── internals ─────────

  function hashHeaders_(headers) {
    var s = headers.join('|');
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function headerDiff_(prev, curr) {
    var prevSet = {}, currSet = {};
    prev.forEach(function (h) { prevSet[h] = true; });
    curr.forEach(function (h) { currSet[h] = true; });
    var added = curr.filter(function (h) { return !prevSet[h]; });
    var removed = prev.filter(function (h) { return !currSet[h]; });
    // Heuristic: if equal count of added + removed, treat as renames.
    var renamed = [];
    if (added.length === removed.length && added.length > 0) {
      for (var i = 0; i < removed.length; i++) renamed.push('"' + removed[i] + '" → "' + added[i] + '"');
      added = [];
      removed = [];
    }
    return { added: added, removed: removed, renamed: renamed };
  }
})(SelfMonitor);
