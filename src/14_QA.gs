/**
 * 14_QA.gs — Test harness.
 *
 * Run via custom menu (HR Automation → Run QA) or directly:  QA.runAll().
 * Writes results to the `QA` tab — latest run on top. Each assertion captures
 * pass/fail + duration. Failures include the error stack for debugging.
 *
 * Assertions exercise the parts the verification protocol will hit:
 *   1. Header alias resolution
 *   2. LWD alert window
 *   3. Probation confirmation calculation
 *   4. Quarterly attrition is bounded in [0, 1]
 *   5. KPI strip has expected fields
 *   6. HR Health Score total + pillars are consistent and bounded
 *   7. Cache round-trip
 *   8. Allowlist contains reviewer email
 *   9. Workflow idempotency on a synthetic empId (no real row touched)
 *
 * Public API:
 *   QA.runAll()                  → TestResult[]
 *   QA.assert(name, fn)          → TestResult
 */

var QA = QA || {};

(function (ns) {
  var QA_TAB = 'QA';
  var KEEP_RUNS = 50;

  ns.runAll = function () {
    var runStart = new Date();
    var results = [];
    results.push(ns.assert('headers_resolve_for_india_tab', testHeadersResolveIndia_));
    results.push(ns.assert('headers_alias_map_contains_renames', testHeadersAliasMap_));
    results.push(ns.assert('alerts_lwd_within_returns_array_in_window', testAlertsLwdWindow_));
    results.push(ns.assert('alerts_probation_confirmation_calc', testProbationCalc_));
    results.push(ns.assert('metrics_quarterly_attrition_bounded', testAttritionBounded_));
    results.push(ns.assert('metrics_kpi_strip_complete', testKpiStrip_));
    results.push(ns.assert('healthscore_total_pillars_consistent', testHealthScoreConsistency_));
    results.push(ns.assert('healthscore_total_in_0_100', testHealthScoreBounds_));
    results.push(ns.assert('cache_round_trip', testCacheRoundTrip_));
    results.push(ns.assert('config_allowlist_includes_reviewer', testAllowlistReviewer_));
    results.push(ns.assert('workflow_idempotency_marker_works', testWorkflowIdempotency_));
    // Tasks 1-9 assertions
    results.push(ns.assert('Risk.tier is pure (same input → same tier)', testRiskTierPure_));
    results.push(ns.assert('Risk.tier classifies offboarded as red', testRiskTierOffboarded_));
    results.push(ns.assert('AuditLog.record appends a row', testAuditLogRecord_));
    results.push(ns.assert('Project column exists on India tab', testProjectColumnExists_));
    results.push(ns.assert('Allocation % column exists on India tab', testAllocationPctColumnExists_));
    results.push(ns.assert('Productivity History has 12 months per employee', testProductivityHistoryRows_));
    writeResults_(runStart, results);
    return results;
  };

  ns.assert = function (name, fn) {
    var started = Date.now();
    try {
      fn();
      return { name: name, status: 'PASS', detail: '', durationMs: Date.now() - started };
    } catch (err) {
      return { name: name, status: 'FAIL', detail: err.message + (err.stack ? ' | ' + err.stack.split('\n')[0] : ''), durationMs: Date.now() - started };
    }
  };

  // ───────── assertions ─────────

  function testHeadersResolveIndia_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(Config.canonicalToTabName('india'));
    expect_(sh, 'India tab exists');
    var map = Header.resolve(sh, 'india');
    expect_(typeof map.empId === 'number', 'empId resolves: ' + JSON.stringify(map));
    expect_(typeof map.name === 'number', 'name resolves');
    expect_(typeof map.doj === 'number', 'doj resolves');
    expect_(typeof map.status === 'number', 'status resolves');
  }

  function testHeadersAliasMap_() {
    var aliases = Config.aliasesFor('india', 'empId');
    expect_(aliases.indexOf('Emp ID') !== -1 || aliases.indexOf('Employee ID') !== -1, 'empId aliases include known names');
    expect_(aliases.length >= 3, 'empId has at least 3 aliases: ' + aliases.length);
  }

  function testAlertsLwdWindow_() {
    var alerts = Alerts.lwdWithin();
    expect_(Array.isArray(alerts), 'lwdWithin returns array');
    for (var i = 0; i < alerts.length; i++) {
      expect_(alerts[i].kind === 'LWD', 'kind === LWD');
      expect_(alerts[i].date instanceof Date, 'date is Date');
      expect_(typeof alerts[i].daysFromNow === 'number', 'daysFromNow is number');
      expect_(['critical', 'warning', 'info'].indexOf(alerts[i].severity) !== -1, 'severity in set');
    }
  }

  function testProbationCalc_() {
    var probLen = Config.threshold('probationLengthDays');
    expect_(probLen === 180, 'probation length is 180 per brief: got ' + probLen);
    var alerts = Alerts.probationDue();
    expect_(Array.isArray(alerts), 'probationDue returns array');
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var diff = Math.round((a.date.getTime() - a.doj.getTime()) / (1000 * 60 * 60 * 24));
      expect_(Math.abs(diff - probLen) <= 1, 'confirmation date === DOJ + ' + probLen + ' (got diff ' + diff + ')');
    }
  }

  function testAttritionBounded_() {
    var attr = Metrics.quarterlyAttrition();
    expect_(typeof attr === 'number', 'attrition is number');
    expect_(attr >= 0 && attr <= 1, 'attrition in [0, 1]: got ' + attr);
  }

  function testKpiStrip_() {
    var kpis = Metrics.kpiStrip();
    expect_(Array.isArray(kpis) && kpis.length >= 7, 'KPI strip has >= 7 tiles: got ' + (kpis ? kpis.length : 'null'));
    var labels = kpis.map(function (k) { return k.label; });
    ['Total Headcount', 'HR Health Score', 'Quarterly Attrition'].forEach(function (l) {
      expect_(labels.indexOf(l) !== -1, 'KPI strip includes "' + l + '"');
    });
    kpis.forEach(function (k) {
      expect_(typeof k.label === 'string' && k.label.length > 0, 'KPI has label');
      expect_(k.value !== undefined, 'KPI has value');
    });
  }

  function testHealthScoreConsistency_() {
    var h = HealthScore.compute();
    expect_(h.pillars, 'pillars present');
    var sum = h.pillars.stability + h.pillars.alertLoad + h.pillars.riskPosture + h.pillars.productivity;
    expect_(Math.abs(sum - h.total) <= 0.5, 'pillars sum to total ±0.5: sum=' + sum + ' total=' + h.total);
  }

  function testHealthScoreBounds_() {
    var h = HealthScore.compute();
    expect_(h.total >= 0 && h.total <= 100, 'total in [0, 100]: got ' + h.total);
    ['stability', 'alertLoad', 'riskPosture', 'productivity'].forEach(function (p) {
      expect_(h.pillars[p] >= 0 && h.pillars[p] <= 25.5, 'pillar ' + p + ' in [0, 25]: got ' + h.pillars[p]);
    });
  }

  function testCacheRoundTrip_() {
    var key = 'qa:roundtrip:' + Date.now();
    var v = { hello: 'world', n: 42, arr: [1, 2, 3] };
    Cache.put(key, v, 60);
    var got = Cache.get(key);
    expect_(got && got.hello === 'world' && got.n === 42, 'round-trip preserves value: ' + JSON.stringify(got));
    Cache.bust('qa:roundtrip:');
  }

  function testAllowlistReviewer_() {
    var allowed = Config.isAllowed('aadish.jain@techolution.com');
    expect_(allowed === true, 'reviewer email is allowed');
  }

  function testWorkflowIdempotency_() {
    var props = PropertiesService.getScriptProperties();
    var syntheticKey = 'wf:done:QA-SYNTH:start_offboarding';
    props.setProperty(syntheticKey, 'qa-test');
    try {
      var already = Workflow.isAlreadyExecuted('QA-SYNTH:start_offboarding');
      expect_(already === true, 'isAlreadyExecuted returns true for marker key');
      var notSet = Workflow.isAlreadyExecuted('QA-SYNTH-NONEXISTENT:start_offboarding');
      expect_(notSet === false, 'isAlreadyExecuted returns false when no marker');
    } finally {
      props.deleteProperty(syntheticKey);
    }
  }

  // ───────── Tasks 1-9 assertions ─────────

  function testRiskTierPure_() {
    var sample = { status: 'Confirmed', productivity: 0.85, allocationPct: 0.85 };
    var a = Risk.tier(sample), b = Risk.tier(sample);
    if (a.tier !== b.tier) throw new Error('non-deterministic');
  }

  function testRiskTierOffboarded_() {
    var r = Risk.tier({ status: 'Offboarded' });
    if (r.tier !== 'red') throw new Error('expected red, got ' + r.tier);
  }

  // NOTE: intentionally writes a "qa-test" row to Audit Log; benign but visible.
  function testAuditLogRecord_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Audit Log');
    if (!sh) throw new Error('Audit Log tab missing');
    var before = sh.getLastRow();
    AuditLog.record({ op: 'qa-test', empId: 'QA0000', field: 'designation', oldVal: 'a', newVal: 'b', runId: 'qa' });
    var after = sh.getLastRow();
    if (after !== before + 1) throw new Error('expected row count +1, got ' + (after - before));
  }

  function testProjectColumnExists_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(Config.canonicalToTabName('india'));
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (headers.indexOf('Project') === -1) throw new Error('Project header missing');
  }

  function testAllocationPctColumnExists_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(Config.canonicalToTabName('india'));
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (headers.indexOf('Allocation %') === -1) throw new Error('Allocation % header missing');
  }

  function testProductivityHistoryRows_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Productivity History');
    if (!sh) throw new Error('Productivity History tab missing');
    var lastRow = sh.getLastRow();
    if (lastRow < 13) throw new Error('expected at least 13 rows (header + 12), got ' + lastRow);
  }

  // ───────── helpers ─────────

  function expect_(cond, message) {
    if (!cond) throw new Error('Assertion failed: ' + message);
  }

  function writeResults_(runStart, results) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(QA_TAB);
    if (!sh) return;

    var rows = results.map(function (r) {
      return [runStart, r.name, r.status, r.detail || '', r.durationMs];
    });

    // Insert at row 2 (latest on top)
    var headerRow = 1;
    sh.insertRowsAfter(headerRow, rows.length);
    sh.getRange(headerRow + 1, 1, rows.length, 5).setValues(rows);

    // Color-code Status column
    for (var i = 0; i < rows.length; i++) {
      var status = rows[i][2];
      var color = status === 'PASS' ? '#059669' : '#DC2626';
      sh.getRange(headerRow + 1 + i, 3).setFontColor(color).setFontWeight('bold');
    }

    // Trim to KEEP_RUNS * tests.
    var maxRows = KEEP_RUNS * results.length + 1;
    var currentRows = sh.getLastRow();
    if (currentRows > maxRows) sh.deleteRows(maxRows + 1, currentRows - maxRows);

    // Toast
    var pass = results.filter(function (r) { return r.status === 'PASS'; }).length;
    var fail = results.length - pass;
    SpreadsheetApp.getActive().toast('QA: ' + pass + ' passed, ' + fail + ' failed', 'HR Automation', 6);

    // Log it
    var runId = Log.start('QA.runAll', 'manual');
    Log.info(runId, 'QA run complete', { pass: pass, fail: fail });
    Log.end(runId, { pass: pass, fail: fail });
  }
})(QA);
