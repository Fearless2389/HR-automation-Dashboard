/**
 * 00_Main.gs — Entry points + dashboard orchestration.
 *
 * Contains:
 *   - doGet(e)           Web App entry; auth-gates and renders WebApp.html.
 *   - onOpen(e)          Simple trigger; adds the HR Automation menu.
 *   - rebuildDashboard() Renders every section of the Dashboard tab.
 *   - applyDrilldown()   Rebuilds the Drill-Down results based on filter cells.
 *   - include(name)      HTML template helper for <?!= include('Component_X') ?>.
 *
 * All sheet writes go through `withSilentWrite(fn)` so the installable onEdit
 * trigger doesn't loop on its own edits.
 */

/**
 * Web App entry. Auth-gates via _Config allowlist.
 *
 * When `_Config.allowlist.emails` contains `*`, the app is in OPEN ACCESS mode:
 * even anonymous viewers (no Google sign-in) get through. Used during the
 * assignment review so reviewers don't hit a consent / sign-in wall.
 */
function doGet(e) {
  var email;
  try { email = Session.getActiveUser().getEmail() || ''; } catch (err) { email = ''; }

  if (!Config.isAllowed(email)) {
    return HtmlService.createHtmlOutputFromFile('403')
      .setTitle('HR Dashboard — Not Authorized')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var t = HtmlService.createTemplateFromFile('WebApp');
  t.user = { email: email };
  try {
    t.bootstrapSnapshot = api_snapshot();
  } catch (err) {
    t.bootstrapSnapshot = { error: err.message };
  }
  return t.evaluate()
    .setTitle('Techolution HR Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** HtmlService include helper, used by WebApp.html templates. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Custom menu — runs on sheet open (simple trigger). */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('HR Automation')
    .addItem('Setup Workbook', 'setupWorkbook')
    .addItem('Rebuild Dashboard', 'rebuildDashboardMenu_')
    .addSeparator()
    .addItem('Run QA', 'runQAMenu_')
    .addItem('Run Verification Protocol', 'runVerificationProtocolMenu_')
    .addSeparator()
    .addItem('Install Triggers', 'installAllTriggersMenu_')
    .addItem('Uninstall Triggers', 'uninstallAllTriggersMenu_')
    .addItem('Stop Daily Digest', 'stopDailyDigestMenu_')
    .addToUi();
}

function rebuildDashboardMenu_() { rebuildDashboard('manual'); SpreadsheetApp.getActive().toast('Dashboard rebuilt', 'HR Automation', 4); }
function runQAMenu_() { if (typeof QA !== 'undefined') QA.runAll(); }
function runVerificationProtocolMenu_() { runVerificationProtocol(); }
function installAllTriggersMenu_() { if (typeof Triggers !== 'undefined') Triggers.installAll(); SpreadsheetApp.getActive().toast('Triggers installed', 'HR Automation', 4); }
function uninstallAllTriggersMenu_() { if (typeof Triggers !== 'undefined') Triggers.uninstallAll(); SpreadsheetApp.getActive().toast('Triggers uninstalled', 'HR Automation', 4); }
function stopDailyDigestMenu_() {
  if (typeof Triggers === 'undefined' || !Triggers.uninstallDailyDigest) return;
  var n = Triggers.uninstallDailyDigest();
  SpreadsheetApp.getActive().toast(
    n > 0 ? 'Removed ' + n + ' daily-digest trigger(s). No more emails.' : 'No daily-digest trigger was installed.',
    'HR Automation', 5
  );
}

// ──────────────────────────────────────────────────────────────────────────
// rebuildDashboard — renders every Dashboard section
// ──────────────────────────────────────────────────────────────────────────

/**
 * Recompute every Dashboard tab section. Idempotent. Cheap enough to run on
 * every onEdit (with debouncing). Caches snapshot for the web app's poll.
 */
function rebuildDashboard(triggerSource) {
  var runId = Log.start('rebuildDashboard', triggerSource || 'manual');
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Dashboard');
    if (!sh) { Log.warn(runId, 'Dashboard tab missing — skipping'); Log.end(runId, {}); return; }

    withSilentWrite(function () {
      sh.clear();
      var row = 1;
      row = writeTitle_(sh, row);
      row = writeKpiStrip_(sh, row + 1);
      row = writeHealthScore_(sh, row + 1);
      row = writeLwdAlerts_(sh, row + 1);
      row = writeProbationAlerts_(sh, row + 1);
      row = writeDepartmentBreakdown_(sh, row + 1);
      row = writeAttritionTrend_(sh, row + 1);
      row = writeRiskRegister_(sh, row + 1);
      writeSystemHealth_(sh, row + 1);

      sh.setColumnWidths(1, 8, 130);
      sh.setColumnWidth(1, 220);
    });

    // Refresh the org chart and drill-down tabs too.
    if (typeof OrgChart !== 'undefined' && OrgChart.publishToSheet) {
      try { withSilentWrite(function () { OrgChart.publishToSheet(); }); }
      catch (err) { Log.warn(runId, 'Org chart publish failed: ' + err.message); }
    }
    try { withSilentWrite(function () { applyDrilldown(); }); }
    catch (err) { Log.warn(runId, 'Drilldown apply failed: ' + err.message); }

    // Bust the web app snapshot so the next poll picks up the new state.
    Cache.bust('snapshot:');
    Cache.bust('health:');

    var hc = Metrics.headcount();
    Log.end(runId, { headcount: hc.total, alertsCritical: Alerts.all().critical.length, healthTotal: HealthScore.compute().total });
  } catch (e) {
    Log.error(runId, 'rebuildDashboard failed: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
    throw e;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Section renderers — each returns the row number AFTER its last write.
// ──────────────────────────────────────────────────────────────────────────

function writeTitle_(sh, row) {
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy · HH:mm');
  sh.getRange(row, 1).setValue('Techolution HR Automation Dashboard').setFontSize(18).setFontWeight('bold');
  sh.getRange(row, 6).setValue('Last rebuilt: ' + ts).setFontStyle('italic').setFontColor('#6B7280').setHorizontalAlignment('right');
  sh.getRange(row, 6, 1, 3).merge();
  return row + 1;
}

function writeKpiStrip_(sh, row) {
  sh.getRange(row, 1).setValue('KEY METRICS').setFontWeight('bold').setFontColor('#4F46E5').setFontSize(11);
  row++;
  var kpis = Metrics.kpiStrip();
  // 3 KPIs per row, 3 columns each (label, value, hint).
  var perRow = 3;
  for (var i = 0; i < kpis.length; i += perRow) {
    var groupRowStart = row;
    for (var j = 0; j < perRow && (i + j) < kpis.length; j++) {
      var kpi = kpis[i + j];
      var col = j * 3 + 1;
      sh.getRange(groupRowStart, col).setValue(kpi.label).setFontWeight('bold').setFontColor('#374151');
      sh.getRange(groupRowStart + 1, col).setValue(kpi.value).setFontSize(18).setFontWeight('bold').setFontColor(toneColor_(kpi.tone));
      sh.getRange(groupRowStart + 2, col).setValue(kpi.hint || '').setFontColor('#6B7280').setFontSize(9);
    }
    row = groupRowStart + 4;
  }
  return row;
}

function writeHealthScore_(sh, row) {
  var h = HealthScore.compute();
  sh.getRange(row, 1).setValue('HR HEALTH SCORE').setFontWeight('bold').setFontColor('#4F46E5').setFontSize(11);
  row++;
  sh.getRange(row, 1).setValue(h.total + ' / 100').setFontSize(24).setFontWeight('bold').setFontColor(toneColor_(healthTone_(h.total)));
  sh.getRange(row, 2).setValue(healthBand_(h.total)).setFontWeight('bold').setFontColor(toneColor_(healthTone_(h.total)));
  row += 2;
  // Pillars
  var pillars = [
    ['Stability',    h.pillars.stability,   25],
    ['Alert Load',   h.pillars.alertLoad,   25],
    ['Risk Posture', h.pillars.riskPosture, 25],
    ['Productivity', h.pillars.productivity, 25]
  ];
  for (var i = 0; i < pillars.length; i++) {
    var col = i * 2 + 1;
    sh.getRange(row,     col).setValue(pillars[i][0]).setFontWeight('bold').setFontColor('#374151');
    sh.getRange(row + 1, col).setValue(pillars[i][1] + ' / ' + pillars[i][2]).setFontSize(14).setFontColor(toneColor_('neutral'));
  }
  return row + 3;
}

function writeLwdAlerts_(sh, row) {
  var lwdDays = Config.threshold('lwdAlertDays');
  sh.getRange(row, 1).setValue('LWD ALERTS — interns within ' + lwdDays + ' days').setFontWeight('bold').setFontColor('#4F46E5').setFontSize(11);
  row++;
  var hdr = ['Emp ID', 'Name', 'Department', 'Region', 'Status', 'LWD', 'Days', 'Severity'];
  sh.getRange(row, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#F3F4F6');
  row++;
  var alerts = Alerts.lwdWithin();
  if (alerts.length === 0) {
    sh.getRange(row, 1).setValue('No active LWD alerts.').setFontColor('#6B7280').setFontStyle('italic');
    return row + 1;
  }
  var rows = alerts.map(function (a) {
    return [a.empId, a.name, a.dept, a.region, a.status, fmtDate_(a.date), a.daysFromNow, a.severity];
  });
  sh.getRange(row, 1, rows.length, hdr.length).setValues(rows);
  applyAlertConditionalFormatting_(sh, row, rows.length, hdr.length);
  return row + rows.length;
}

function writeProbationAlerts_(sh, row) {
  var pDays = Config.threshold('probationConfirmDays');
  sh.getRange(row, 1).setValue('PROBATION ALERTS — confirmation due within ' + pDays + ' days').setFontWeight('bold').setFontColor('#4F46E5').setFontSize(11);
  row++;
  var hdr = ['Emp ID', 'Name', 'Department', 'Region', 'DOJ', 'Confirmation Due', 'Days', 'Severity'];
  sh.getRange(row, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#F3F4F6');
  row++;
  var alerts = Alerts.probationDue();
  if (alerts.length === 0) {
    sh.getRange(row, 1).setValue('No probation alerts.').setFontColor('#6B7280').setFontStyle('italic');
    return row + 1;
  }
  var rows = alerts.map(function (a) {
    return [a.empId, a.name, a.dept, a.region, fmtDate_(a.doj), fmtDate_(a.date), a.daysFromNow, a.severity];
  });
  sh.getRange(row, 1, rows.length, hdr.length).setValues(rows);
  applyAlertConditionalFormatting_(sh, row, rows.length, hdr.length);
  return row + rows.length;
}

function writeDepartmentBreakdown_(sh, row) {
  sh.getRange(row, 1).setValue('DEPARTMENT BREAKDOWN').setFontWeight('bold').setFontColor('#4F46E5').setFontSize(11);
  row++;
  var hdr = ['Department', 'Total', 'Confirmed', 'Probation', 'Intern'];
  sh.getRange(row, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#F3F4F6');
  row++;
  var breakdown = Metrics.departmentBreakdown();
  if (breakdown.length === 0) {
    sh.getRange(row, 1).setValue('No employee data found.').setFontColor('#6B7280').setFontStyle('italic');
    return row + 1;
  }
  var rows = breakdown.map(function (b) { return [b.dept, b.total, b.confirmed, b.probation, b.intern]; });
  sh.getRange(row, 1, rows.length, hdr.length).setValues(rows);
  return row + rows.length;
}

function writeAttritionTrend_(sh, row) {
  sh.getRange(row, 1).setValue('QUARTERLY ATTRITION TREND').setFontWeight('bold').setFontColor('#4F46E5').setFontSize(11);
  row++;
  var hdr = ['Quarter', 'Exits', 'Attrition Rate'];
  sh.getRange(row, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#F3F4F6');
  row++;
  var trend = Metrics.attritionTrend(4);
  var rows = trend.map(function (t) { return [t.quarter, t.count, (t.rate * 100).toFixed(2) + '%']; });
  sh.getRange(row, 1, rows.length, hdr.length).setValues(rows);
  return row + rows.length;
}

function writeRiskRegister_(sh, row) {
  sh.getRange(row, 1).setValue('RISK REGISTER — productivity + bench').setFontWeight('bold').setFontColor('#4F46E5').setFontSize(11);
  row++;
  var hdr = ['Emp ID', 'Name', 'Department', 'Region', 'Risk', 'Detail', 'Severity'];
  sh.getRange(row, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#F3F4F6');
  row++;
  var lowProd = Alerts.lowProductivity();
  var bench = Alerts.bench();
  var combined = lowProd.concat(bench);
  if (combined.length === 0) {
    sh.getRange(row, 1).setValue('No risk entries.').setFontColor('#6B7280').setFontStyle('italic');
    return row + 1;
  }
  var rows = combined.map(function (a) { return [a.empId, a.name, a.dept, a.region, a.kind, a.message, a.severity]; });
  sh.getRange(row, 1, rows.length, hdr.length).setValues(rows);
  applyAlertConditionalFormatting_(sh, row, rows.length, hdr.length);
  return row + rows.length;
}

function writeSystemHealth_(sh, row) {
  sh.getRange(row, 1).setValue('SYSTEM HEALTH').setFontWeight('bold').setFontColor('#6B7280').setFontSize(10);
  row++;
  var issues = (typeof SelfMonitor !== 'undefined' && SelfMonitor.publishToDashboard) ? SelfMonitor.collect() : [];
  var quotaLeft = (typeof Email !== 'undefined' && Email.quotaLeft) ? Email.quotaLeft() : '—';
  sh.getRange(row, 1).setValue('Mail Quota Remaining: ' + quotaLeft).setFontColor('#374151').setFontSize(9);
  sh.getRange(row + 1, 1).setValue(issues.length === 0 ? 'All systems OK.' : (issues.length + ' issue(s) detected — see Logs')).setFontColor(issues.length === 0 ? '#059669' : '#DC2626').setFontSize(9);
  return row + 2;
}

// ──────────────────────────────────────────────────────────────────────────
// Drill-Down tab — applies filters from row 2 and rewrites results from row 5.
// ──────────────────────────────────────────────────────────────────────────

var DRILLDOWN_TAB = 'Drill-Down';
var DRILLDOWN_RESULTS_HEADER_ROW = 5;
var DRILLDOWN_RESULTS_START_ROW = 6;

/**
 * Read filter values from row 2; filter Data.allEmployees(); rewrite results.
 */
function applyDrilldown() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DRILLDOWN_TAB);
  if (!sh) return;

  ensureDrilldownLayout_(sh);

  var filters = sh.getRange(3, 1, 1, 4).getValues()[0];
  var region = String(filters[0] || '').trim();
  var dept = String(filters[1] || '').trim();
  var rm = String(filters[2] || '').trim();
  var status = String(filters[3] || '').trim();

  var matched = Data.allEmployees().filter(function (e) {
    if (region && region !== 'All' && e.__region !== region) return false;
    if (dept && dept !== 'All' && e.dept !== dept) return false;
    if (rm && rm !== 'All' && e.rm !== rm) return false;
    if (status && status !== 'All' && e.status !== status) return false;
    return true;
  });

  // Clear previous results
  var lastRow = sh.getLastRow();
  if (lastRow >= DRILLDOWN_RESULTS_START_ROW) {
    sh.getRange(DRILLDOWN_RESULTS_START_ROW, 1, Math.max(1, lastRow - DRILLDOWN_RESULTS_START_ROW + 1), 9).clearContent();
  }

  if (matched.length === 0) {
    sh.getRange(DRILLDOWN_RESULTS_START_ROW, 1).setValue('No matching employees.').setFontStyle('italic').setFontColor('#6B7280');
    return;
  }

  var rows = matched.map(function (e) {
    return [e.empId, e.name, e.__region, e.dept, e.designation, e.rm, e.status, fmtDate_(e.doj), e.lwd ? fmtDate_(e.lwd) : ''];
  });
  sh.getRange(DRILLDOWN_RESULTS_START_ROW, 1, rows.length, 9).setValues(rows);
}

function ensureDrilldownLayout_(sh) {
  // Row 1: title
  if (sh.getRange(1, 1).getValue() !== 'DRILL-DOWN') {
    sh.getRange(1, 1).setValue('DRILL-DOWN').setFontWeight('bold').setFontColor('#4F46E5').setFontSize(14);
  }
  // Row 2: filter labels
  if (sh.getRange(2, 1).getValue() !== 'Region') {
    sh.getRange(2, 1, 1, 4).setValues([['Region', 'Department', 'Reporting Manager', 'Status']])
      .setFontWeight('bold').setBackground('#F3F4F6');
  }
  // Row 3: filter dropdowns — rebuild validation rules with current distinct values
  var emps = Data.allEmployees();
  var regions = ['All'].concat(distinct_(emps.map(function (e) { return e.__region; })));
  var depts = ['All'].concat(distinct_(emps.map(function (e) { return e.dept; })));
  var rms = ['All'].concat(distinct_(emps.map(function (e) { return e.rm; })));
  var statuses = ['All'].concat(distinct_(emps.map(function (e) { return e.status; })));

  setDropdown_(sh.getRange(3, 1), regions);
  setDropdown_(sh.getRange(3, 2), depts);
  setDropdown_(sh.getRange(3, 3), rms);
  setDropdown_(sh.getRange(3, 4), statuses);
  // Default to All if empty
  ['A3', 'B3', 'C3', 'D3'].forEach(function (a1) { if (!sh.getRange(a1).getValue()) sh.getRange(a1).setValue('All'); });

  // Row 5: results header
  var hdr = ['Emp ID', 'Name', 'Region', 'Department', 'Designation', 'Reporting Manager', 'Status', 'DOJ', 'LWD'];
  sh.getRange(DRILLDOWN_RESULTS_HEADER_ROW, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#1F2937').setFontColor('#FFFFFF');
}

function setDropdown_(range, options) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(options.filter(function (o) { return o !== null && o !== undefined && o !== ''; }), true)
    .setAllowInvalid(false)
    .build();
  range.setDataValidation(rule);
}

function distinct_(arr) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i]; if (!v) continue; if (seen[v]) continue;
    seen[v] = true; out.push(v);
  }
  return out.sort();
}

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run `fn` with the silent-write flag set so installable onEdit ignores writes
 * it causes. Cleared in finally so a thrown error doesn't leave the flag stuck.
 */
function withSilentWrite(fn) {
  var props = PropertiesService.getScriptProperties();
  var token = Utilities.getUuid();
  props.setProperty('silentWriteRunId', token);
  try { fn(); }
  finally { if (props.getProperty('silentWriteRunId') === token) props.deleteProperty('silentWriteRunId'); }
}

function isSilentWrite_() {
  return !!PropertiesService.getScriptProperties().getProperty('silentWriteRunId');
}

function toneColor_(tone) {
  switch (tone) {
    case 'good':    return '#059669';
    case 'warn':    return '#D97706';
    case 'danger':  return '#DC2626';
    case 'neutral': default: return '#111827';
  }
}

function healthBand_(score) {
  var b = Config.healthBands();
  if (score >= b.green) return 'Green';
  if (score >= b.amber) return 'Amber';
  return 'Red';
}

function healthTone_(score) {
  var b = Config.healthBands();
  if (score >= b.green) return 'good';
  if (score >= b.amber) return 'warn';
  return 'danger';
}

function fmtDate_(d) {
  if (!d) return '';
  if (!(d instanceof Date)) return String(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM yyyy');
}

function applyAlertConditionalFormatting_(sh, startRow, nRows, nCols) {
  // Set the severity column tone via cell color.
  var range = sh.getRange(startRow, 1, nRows, nCols);
  var sevCol = nCols; // severity is the last column in our alert tables
  var severities = sh.getRange(startRow, sevCol, nRows, 1).getValues();
  for (var i = 0; i < severities.length; i++) {
    var s = String(severities[i][0]);
    var fg = s === 'critical' ? '#DC2626' : s === 'warning' ? '#D97706' : '#6B7280';
    sh.getRange(startRow + i, sevCol).setFontColor(fg).setFontWeight('bold');
  }
}
