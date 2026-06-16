/**
 * 04_DataAccess.gs — Typed readers for each source tab.
 *
 * All reads go through Header.rows() (canonical-name access) so column renames
 * never break the pipeline. Date fields are coerced to Date objects; numeric
 * fields are coerced via Number().
 *
 * All readers are cache-wrapped via Cache.wrap with TTL 600s. The onEdit
 * trigger busts the relevant `data:*` cache key whenever a source tab is edited.
 *
 * Public API:
 *   Data.india()          → Employee[]
 *   Data.us()             → USEmployee[]
 *   Data.allEmployees()   → (Employee | USEmployee)[]   (with `__region`)
 *   Data.rm({month})      → { month, rows: AllocationRow[] }
 *   Data.offboarded()     → ExitRow[]
 *   Data.finance()        → FinanceRow[]
 *   Data.bustAll()        → invalidate all data:* cache keys
 */

var Data = Data || {};

(function (ns) {
  var TTL = 600;

  ns.india = function () {
    var rows = Cache.wrap('data:india:v1', TTL, function () {
      return readEmployees_('india');
    });
    return rehydrateDates_(rows, ['doj', 'lwd']);
  };

  ns.us = function () {
    var rows = Cache.wrap('data:us:v1', TTL, function () {
      return readEmployees_('us');
    });
    return rehydrateDates_(rows, ['doj', 'lwd']);
  };

  ns.allEmployees = function () {
    var india = ns.india().map(function (e) { e.__region = 'India'; return e; });
    var us = ns.us().map(function (e) { e.__region = 'US'; return e; });
    return india.concat(us);
  };

  ns.rm = function (opts) {
    var tabName = Config.canonicalToTabName('rm');
    var month = (opts && opts.month) || currentMonthLabel_();
    var key = 'data:rm:' + month;
    return Cache.wrap(key, TTL, function () {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(tabName);
      if (!sh) return { month: month, rows: [] };

      var headers = Header.rawHeaders(sh);
      var monthCol = discoverMonthColumn_(headers, month);
      var rows = Header.rows(sh, 'rm');
      var out = rows.map(function (r) {
        var allocation = (monthCol >= 0) ? sheetValueAt_(sh, r.__rowNum, monthCol + 1) : null;
        return {
          empId: String(r.empId || '').trim(),
          name: String(r.name || '').trim(),
          allocation: coerceAllocation_(allocation),
          monthLabel: monthCol >= 0 ? String(headers[monthCol]) : null
        };
      });
      return { month: month, monthCol: monthCol, rows: out };
    });
  };

  ns.offboarded = function () {
    var rows = Cache.wrap('data:offboarded:v1', TTL, function () {
      var tabName = Config.canonicalToTabName('offboarded');
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(tabName);
      if (!sh) return [];
      var headerRows = Header.rows(sh, 'offboarded');
      return headerRows.map(function (r) {
        return {
          empId: String(r.empId || '').trim(),
          name: String(r.name || '').trim(),
          dept: String(r.dept || '').trim(),
          dol: coerceDate_(r.dol),
          reason: String(r.reason || '').trim()
        };
      }).filter(function (r) { return r.empId; });
    });
    return rehydrateDates_(rows, ['dol']);
  };

  ns.finance = function () {
    return Cache.wrap('data:finance:v1', TTL, function () {
      var tabName = Config.canonicalToTabName('finance');
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(tabName);
      if (!sh) return [];
      var rows = Header.rows(sh, 'finance');
      return rows.map(function (r) {
        return {
          empId: String(r.empId || '').trim(),
          ctcInrAnnual: coerceNum_(r.ctcInrAnnual),
          ctcUsdAnnual: coerceNum_(r.ctcUsdAnnual),
          ctcInrMonthly: coerceNum_(r.ctcInrMonthly),
          ctcUsdMonthly: coerceNum_(r.ctcUsdMonthly),
          productivity: coerceNum_(r.productivity)
        };
      }).filter(function (r) { return r.empId; });
    });
  };

  ns.bustAll = function () {
    Cache.bust('data:');
    Cache.bust('snapshot:');
    Cache.bust('health:');
  };

  // ───────── internals ─────────

  function readEmployees_(tabKey) {
    var tabName = Config.canonicalToTabName(tabKey);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(tabName);
    if (!sh) return [];
    var rows = Header.rows(sh, tabKey);
    return rows.map(function (r) {
      var emp = {
        __rowNum: r.__rowNum,
        empId: String(r.empId || '').trim(),
        name: String(r.name || '').trim(),
        dept: String(r.dept || '').trim(),
        designation: String(r.designation || '').trim(),
        rm: String(r.rm || '').trim(),
        skillset: String(r.skillset || '').trim(),
        doj: coerceDate_(r.doj),
        status: String(r.status || '').trim(),
        lwd: coerceDate_(r.lwd),
        project: String(r.project || '').trim(),
        allocationPct: coerceAllocation_(r.allocationPct)
      };
      if (tabKey === 'us') {
        emp.ctc = coerceNum_(r.ctc);
      }
      return emp;
    }).filter(function (e) { return e.empId; });
  }

  function coerceDate_(v) {
    if (v instanceof Date) return v;
    if (v === '' || v === null || v === undefined) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * CacheService round-trips through JSON, turning Date objects into ISO strings.
   * Without this re-hydration, the SECOND call to Data.india() in the same run
   * would return string dates and break `e.doj.getTime()` downstream.
   *
   * Returns a fresh array of fresh objects (does not mutate the cached payload).
   */
  function rehydrateDates_(rows, dateFields) {
    if (!Array.isArray(rows)) return rows;
    return rows.map(function (r) {
      var copy = {};
      for (var k in r) { if (r.hasOwnProperty(k)) copy[k] = r[k]; }
      for (var i = 0; i < dateFields.length; i++) {
        var field = dateFields[i];
        var v = copy[field];
        if (v && !(v instanceof Date)) {
          var d = new Date(v);
          copy[field] = isNaN(d.getTime()) ? null : d;
        }
      }
      return copy;
    });
  }

  function coerceNum_(v) {
    if (typeof v === 'number') return v;
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  /**
   * Accept allocation as either a fraction (0.85) or a percent (85). Returns a fraction in [0, 1].
   */
  function coerceAllocation_(v) {
    var n = coerceNum_(v);
    if (n === null) return null;
    if (n > 1.0) return n / 100;
    return n;
  }

  function currentMonthLabel_() {
    var d = new Date();
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getFullYear();
  }

  /**
   * Discover which column holds allocation data for the requested month label.
   * Strategy: try several common label formats; fall back to the rightmost
   * column whose header parses as a date in the current month.
   */
  function discoverMonthColumn_(headers, monthLabel) {
    var normalized = normalize_(monthLabel);
    for (var i = 0; i < headers.length; i++) {
      if (normalize_(headers[i]) === normalized) return i;
    }
    // Fallback: find rightmost header parseable as a date in same month/year.
    var d = new Date();
    var target = d.getMonth();
    var targetYear = d.getFullYear();
    for (var k = headers.length - 1; k >= 0; k--) {
      var parsed = new Date(headers[k]);
      if (!isNaN(parsed.getTime()) && parsed.getMonth() === target && parsed.getFullYear() === targetYear) return k;
    }
    return -1; // no current-month column found
  }

  function sheetValueAt_(sh, rowNum, colNum) {
    return sh.getRange(rowNum, colNum).getValue();
  }

  function normalize_(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
})(Data);
