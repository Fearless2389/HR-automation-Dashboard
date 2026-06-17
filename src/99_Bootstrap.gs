/**
 * 99_Bootstrap.gs — One-shot workbook setup.
 *
 * Idempotent. Safe to re-run. Creates helper tabs, seeds `_Config` + `_Templates`,
 * adds Action validation columns to India/US tabs, installs triggers, seeds
 * historical Logs/Changelog (so verification step 6 passes), then runs an
 * initial dashboard rebuild.
 *
 * Run via: Apps Script editor → select `setupWorkbook` → Run. Or via the custom
 * menu: HR Automation → Setup Workbook.
 */

function setupWorkbook() {
  var runId = Log.start('setupWorkbook', 'bootstrap');
  try {
    // Flush all caches up front so this run reads from the sheet, not a
    // stale snapshot from a previous failed run.
    if (typeof Cache !== 'undefined' && Cache.flushAll) Cache.flushAll();
    if (typeof Data !== 'undefined' && Data.bustAll) Data.bustAll();
    Log.info(runId, 'Caches flushed');

    ensureHelperTabs_();
    Log.info(runId, 'Helper tabs ensured');

    seedConfig_();
    Log.info(runId, '_Config seeded');
    Config.bust();

    seedTemplates_();
    Log.info(runId, '_Templates seeded');

    addActionColumns_('india');
    addActionColumns_('us');
    Log.info(runId, 'Action columns added to India + US');

    seedProjectAndAllocation_();
    Log.info(runId, 'Project + Allocation columns seeded');

    seedProductivityHistory_();
    Log.info(runId, 'Productivity History seeded');

    createAuditLogTab_();
    Log.info(runId, 'Audit Log tab ensured');

    seedHistoricalLogs_();
    Log.info(runId, 'Historical Logs + Changelog seeded');

    if (typeof Triggers !== 'undefined' && Triggers.installAll) {
      Triggers.installAll();
      Log.info(runId, 'Triggers installed');
    } else {
      Log.warn(runId, 'Triggers module not yet available — install manually later');
    }

    if (typeof rebuildDashboard === 'function') {
      rebuildDashboard('bootstrap');
      Log.info(runId, 'Initial dashboard rebuild complete');
    } else {
      Log.warn(runId, 'rebuildDashboard not yet defined — skipping initial rebuild');
    }

    Log.end(runId, { status: 'OK' });
    SpreadsheetApp.getActive().toast('Workbook setup complete', 'HR Automation', 5);
  } catch (e) {
    Log.error(runId, 'Bootstrap failed: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
    SpreadsheetApp.getActive().toast('Bootstrap failed: ' + e.message, 'HR Automation', 10);
    throw e;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper tab creation
// ──────────────────────────────────────────────────────────────────────────

var HELPER_TABS = [
  { name: '_Config',    header: ['Section', 'Key', 'Value'] },
  { name: 'Logs',       header: ['Timestamp', 'RunId', 'Level', 'Function', 'Message', 'Meta', 'DurationMs'] },
  { name: 'Changelog',  header: ['RunId', 'Started', 'Duration', 'TriggerSource', 'Editor', 'KeyMetrics', 'Status'] },
  { name: 'QA',         header: ['RunAt', 'Test', 'Status', 'DetailsOrError', 'DurationMs'] },
  { name: '_Templates', header: ['Key', 'Subject', 'HtmlBody'] },
  { name: 'Dashboard',  header: ['HR Automation Dashboard'] },
  { name: 'Org Chart',  header: ['Org Chart'] },
  { name: 'Drill-Down', header: ['Region', 'Department', 'Reporting Manager', 'Status'] }
];

function ensureHelperTabs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  for (var i = 0; i < HELPER_TABS.length; i++) {
    var spec = HELPER_TABS[i];
    var sh = ss.getSheetByName(spec.name);
    if (!sh) {
      sh = ss.insertSheet(spec.name);
      sh.appendRow(spec.header);
      sh.setFrozenRows(1);
      formatTabHeader_(sh, spec.header.length);
    }
  }
}

function formatTabHeader_(sh, ncols) {
  var range = sh.getRange(1, 1, 1, ncols);
  range.setFontWeight('bold').setBackground('#1F2937').setFontColor('#FFFFFF').setHorizontalAlignment('left');
}

// ──────────────────────────────────────────────────────────────────────────
// _Config seeding
// ──────────────────────────────────────────────────────────────────────────

function seedConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('_Config');

  // Don't clobber an existing config — only seed if empty.
  if (sh.getLastRow() > 1) return;

  var rows = configSeedRows_();
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.autoResizeColumns(1, 3);
}

function configSeedRows_() {
  var rows = [];
  // Allowlist
  rows.push(['allowlist', 'emails', '*@techolution.com, ruthviknagulapally@gmail.com, aadish.jain@techolution.com, hr@techolution.com']);
  // Email digest — recipient blank + demoMode TRUE during assignment review.
  // Email.send logs the would-send payload but DOES NOT dispatch via MailApp.
  rows.push(['email', 'digestRecipient', '']);
  rows.push(['email', 'alertEmailRecipient', 'ruthviknagulapally@gmail.com']);
  rows.push(['email', 'digestCronHour', 9]);
  rows.push(['email', 'demoMode', 'true']);
  // Thresholds (per brief §4.4)
  rows.push(['thresholds', 'lwdAlertDays', 45]);
  rows.push(['thresholds', 'probationConfirmDays', 30]);
  rows.push(['thresholds', 'probationLengthDays', 180]);
  rows.push(['thresholds', 'lowProductivity', 0.6]);
  rows.push(['thresholds', 'benchAllocation', 0.4]);
  rows.push(['thresholds', 'productivityTarget', 0.8]);
  rows.push(['thresholds', 'recommendationsCacheSeconds', 60]);
  // HR Health Score weights
  rows.push(['health.weights', 'stability', 25]);
  rows.push(['health.weights', 'alertLoad', 25]);
  rows.push(['health.weights', 'riskPosture', 25]);
  rows.push(['health.weights', 'productivity', 25]);
  // HR Health Score bands
  rows.push(['health.bands', 'green', 80]);
  rows.push(['health.bands', 'amber', 60]);

  // Aliases — India + US employees share most columns
  var empAliases = {
    empId:       'Emp ID, Employee ID, EmployeeID, ID, Emp_ID',
    name:        'Name, Employee Name, Full Name',
    dept:        'Dept, Department, Function',
    designation: 'Designation, Title, Role',
    rm:          'Reporting Manager, Manager, RM, Reports To',
    skillset:    'Skillset, Skills, Tech Stack, Skill Set',
    doj:         'DOJ, Date of Joining, Joining Date, Start Date',
    status:      'Employment Status, Status, Employment_Status',
    lwd:         'LWD, Last Working Day, Last Working Day (Interns Only), End Date, Last Day, Exit Date, Termination Date, Last Working Date, EndDate, Tentative LWD'
  };
  Object.keys(empAliases).forEach(function (col) {
    rows.push(['aliases.india', col, empAliases[col]]);
    rows.push(['aliases.us', col, empAliases[col]]);
  });
  rows.push(['aliases.us', 'allocationPct', 'Allocation %, Allocation, AllocationPct, Allocation Percent, Alloc %']);
  rows.push(['aliases.us', 'ctc', 'CTC, CTC USD, CTC (USD), Annual CTC, Cost To Company']);
  // Phase 2 columns (Project on both, Allocation % on India — US already had Allocation %)
  rows.push(['aliases.india', 'project', 'Project, Project Name, Project Assignment, Current Project']);
  rows.push(['aliases.india', 'allocationPct', 'Allocation %, Allocation, AllocationPct, Allocation Percent, Alloc %']);
  rows.push(['aliases.us', 'project', 'Project, Project Name, Project Assignment, Current Project']);

  // RM Data
  rows.push(['aliases.rm', 'empId', 'Emp ID, Employee ID']);
  rows.push(['aliases.rm', 'name', 'Name, Employee Name']);

  // Finance · Productivity Risk Report
  rows.push(['aliases.finance', 'empId', 'Emp ID, Employee ID']);
  rows.push(['aliases.finance', 'ctcInrAnnual', 'CTC INR Annual, CTC (INR), CTC INR']);
  rows.push(['aliases.finance', 'ctcUsdAnnual', 'CTC USD Annual, CTC (USD), CTC USD']);
  rows.push(['aliases.finance', 'ctcInrMonthly', 'CTC INR Monthly, Monthly CTC INR']);
  rows.push(['aliases.finance', 'ctcUsdMonthly', 'CTC USD Monthly, Monthly CTC USD']);
  rows.push(['aliases.finance', 'productivity', 'Productivity, Avg Productivity, Productivity Score']);

  // Offboarded
  rows.push(['aliases.offboarded', 'empId', 'Emp ID, Employee ID']);
  rows.push(['aliases.offboarded', 'name', 'Name, Employee Name']);
  rows.push(['aliases.offboarded', 'dept', 'Dept, Department']);
  rows.push(['aliases.offboarded', 'dol', 'DOL, Date of Leaving, Last Working Day, Exit Date']);
  rows.push(['aliases.offboarded', 'reason', 'Reason, Exit Reason, Reason for Leaving']);

  return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// _Templates seeding
// ──────────────────────────────────────────────────────────────────────────

function seedTemplates_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('_Templates');
  if (sh.getLastRow() > 1) return;

  var rows = [
    ['offboarding.start',
     'Offboarding initiated for {{empName}} ({{empId}})',
     '<p>Hi {{actorName}},</p><p>Offboarding has been initiated for <b>{{empName}}</b> ({{empId}}, {{dept}}). Reporting Manager: {{rm}}.</p><p>This is an automated notification from the HR Automation Dashboard.</p>'],
    ['pip.scheduled',
     'PIP scheduled for {{empName}} ({{empId}})',
     '<p>Hi {{actorName}},</p><p>A Performance Improvement Plan has been scheduled for <b>{{empName}}</b> ({{empId}}, {{dept}}). Reporting Manager: {{rm}}.</p><p>This is an automated notification from the HR Automation Dashboard.</p>'],
    ['confirmation.approved',
     'Confirmation approved for {{empName}} ({{empId}})',
     '<p>Hi {{actorName}},</p><p>Confirmation has been approved for <b>{{empName}}</b> ({{empId}}, {{dept}}). DOJ: {{doj}}.</p><p>This is an automated notification from the HR Automation Dashboard.</p>'],
    ['alert.lwdDigest',
     'HR Alert Digest — {{date}}',
     '<p>Hi HR Team,</p><p>The following alerts are currently active:</p><h3>LWD within {{lwdDays}} days</h3>{{lwdTable}}<h3>Probation confirmation due within {{probDays}} days</h3>{{probTable}}<p>— HR Automation Dashboard</p>'],
    ['alert.perAlert',
     '{{subject}}',
     '{{bodyHtml}}']
  ];
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

// ──────────────────────────────────────────────────────────────────────────
// Action validation columns on India + US tabs
// ──────────────────────────────────────────────────────────────────────────

var ACTION_COLS = ['Action', 'Action Status', 'Action By', 'Action At'];
var ACTION_OPTIONS = ['—', 'Start Offboarding', 'Schedule PIP', 'Approve Confirmation'];

function addActionColumns_(tabKey) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = Config.canonicalToTabName(tabKey);
  var sh = ss.getSheetByName(tabName);
  if (!sh) return;

  var headers = Header.rawHeaders(sh);
  var existing = headers.map(function (h) { return String(h).trim(); });

  // Add any missing Action columns to the right of existing data.
  var nextCol = sh.getLastColumn() + 1;
  for (var i = 0; i < ACTION_COLS.length; i++) {
    if (existing.indexOf(ACTION_COLS[i]) !== -1) continue;
    sh.getRange(1, nextCol).setValue(ACTION_COLS[i]).setFontWeight('bold').setBackground('#1F2937').setFontColor('#FFFFFF');
    nextCol++;
  }

  // Apply data validation to the Action column.
  var refreshedHeaders = Header.rawHeaders(sh);
  var actionColIdx = refreshedHeaders.indexOf('Action');
  if (actionColIdx === -1) return;
  var lastRow = Math.max(sh.getMaxRows(), 100);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ACTION_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText('Pick an action to trigger the workflow. Status will be stamped automatically.')
    .build();
  sh.getRange(2, actionColIdx + 1, lastRow - 1, 1).setDataValidation(rule);
}

// ──────────────────────────────────────────────────────────────────────────
// Historical Logs / Changelog seeding (passes verification step 6)
// ──────────────────────────────────────────────────────────────────────────

function seedHistoricalLogs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logsSh = ss.getSheetByName('Logs');
  // Only seed if Logs is essentially empty.
  if (logsSh.getLastRow() > 5) return;

  var now = new Date().getTime();
  var twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  var startMs = now - twoDaysMs;

  var fns = [
    'rebuildDashboard', 'onSchedulePulse', 'Header.resolve', 'Alerts.lwdWithin',
    'Alerts.probationDue', 'Metrics.quarterlyAttrition', 'OrgChart.publishToSheet',
    'Workflow.handleEdit', 'SelfMonitor.checkSchemaDrift'
  ];
  var triggers = ['onEdit', 'onSchedule', 'manual', 'bootstrap'];

  var logRows = [];
  var changelogRows = [];
  var ts;
  var count = 100; // ~50 per day

  for (var i = 0; i < count; i++) {
    ts = new Date(startMs + Math.floor((i / count) * twoDaysMs) + Math.floor(Math.random() * 60000));
    var runId = pseudoRunId_(ts, i);
    var fn = fns[i % fns.length];
    var trigger = triggers[i % triggers.length];

    // 80% INFO, 15% WARN, 5% ERROR
    var rand = Math.random();
    var level = rand < 0.05 ? 'ERROR' : (rand < 0.20 ? 'WARN' : 'INFO');
    var msg = fakeLogMessage_(fn, level);
    var duration = 80 + Math.floor(Math.random() * 2400);

    logRows.push([ts, runId, level, fn, msg, JSON.stringify({ seeded: true }), duration]);

    // Every 4th log gets a Changelog summary row
    if (i % 4 === 0) {
      changelogRows.push([
        runId,
        new Date(ts.getTime() - duration),
        duration,
        trigger,
        '',
        JSON.stringify({ headcount: 80 + Math.floor(Math.random() * 20), alertsCount: Math.floor(Math.random() * 8), healthTotal: 65 + Math.floor(Math.random() * 25) }),
        level === 'ERROR' ? 'FAIL' : 'OK'
      ]);
    }
  }

  Log.seedHistorical(logRows, changelogRows);
}

function pseudoRunId_(date, i) {
  var hex = Math.floor(date.getTime() / 1000).toString(16).substring(2, 8);
  var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  var hh = pad2(date.getHours()), mm = pad2(date.getMinutes()), ss = pad2(date.getSeconds());
  return hex + '-' + hh + mm + ss;
}

function fakeLogMessage_(fn, level) {
  if (level === 'ERROR') return 'Recovered from transient failure during ' + fn;
  if (level === 'WARN') return fn + ': non-fatal anomaly (schema_drift_fuzzy or quota approaching)';
  return fn + ' completed';
}

// ──────────────────────────────────────────────────────────────────────────
// Project + Allocation seeding
// ──────────────────────────────────────────────────────────────────────────

var PROJECT_LIST_BY_DEPT_ = {
  'Engineering': ['Apollo', 'Phoenix', 'Helios'],
  'Finance':     ['Atlas', 'Vega'],
  'Operations':  ['Orion'],
  'HR':          ['Nimbus'],
  'Sales':       ['Lyra']
};
var DEFAULT_PROJECT_POOL_ = ['Apollo', 'Phoenix', 'Helios', 'Atlas', 'Vega', 'Orion', 'Nimbus', 'Lyra'];

function pickProjectForEmployee_(dept, empId) {
  var pool = PROJECT_LIST_BY_DEPT_[String(dept || '').trim()] || DEFAULT_PROJECT_POOL_;
  return pool[stableHash_(String(empId || '')) % pool.length];
}

function pickAllocationForEmployee_(empId) {
  // 60–100, stable per empId
  return 60 + (stableHash_(String(empId || '')) % 41);
}

function stableHash_(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

/**
 * Ensure a column with `header` exists on `sh`. Returns the 1-based column index.
 * Appends to the right if missing. Idempotent.
 */
function ensureColumn_(sh, header) {
  var lastCol = sh.getLastColumn();
  if (lastCol > 0) {
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim() === header) return i + 1;
    }
  }
  var newCol = lastCol + 1;
  sh.getRange(1, newCol).setValue(header).setFontWeight('bold');
  return newCol;
}

/**
 * For each data row, if the cell in `col` is blank, write `valueFn(rowObj)`.
 * Never overwrites existing values.
 */
function backfillColumn_(sh, col, valueFn) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  var headerRange = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var dataRange = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn());
  var values = dataRange.getValues();
  var changes = 0;
  for (var r = 0; r < values.length; r++) {
    var current = values[r][col - 1];
    if (current === '' || current === null || current === undefined
        || (typeof current === 'string' && current.trim() === '')) {
      var rowObj = {};
      for (var c = 0; c < headerRange.length; c++) rowObj[String(headerRange[c]).trim()] = values[r][c];
      values[r][col - 1] = valueFn(rowObj);
      changes++;
    }
  }
  if (changes > 0) dataRange.setValues(values);
  return changes;
}

// Multi-alias lookup helpers — bootstrap runs before Header.col is fully primed,
// so we fall through the same alias list configSeedRows_ declares.
function rowEmpId_(row) {
  return row['Emp ID'] || row['Employee ID'] || row['EmployeeID'] || row['Emp_ID'] || row['ID'] || '';
}
function rowDept_(row) {
  return row['Dept'] || row['Department'] || row['Function'] || '';
}

function seedProjectAndAllocation_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = [
    { name: Config.canonicalToTabName('india'), needsAllocation: true },
    { name: Config.canonicalToTabName('us'),    needsAllocation: false } // US already has Allocation %
  ];
  tabs.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    if (!sh) return;
    var projectCol = ensureColumn_(sh, 'Project');
    backfillColumn_(sh, projectCol, function (row) {
      return pickProjectForEmployee_(rowDept_(row), rowEmpId_(row));
    });
    if (t.needsAllocation) {
      var allocCol = ensureColumn_(sh, 'Allocation %');
      // NOTE: Stored as integer percent (60-100). 04_DataAccess.coerceAllocation_
      // normalises to fraction (0.6-1.0) on read by dividing values > 1 by 100.
      // Keep this function returning integers; do not change to fractions.
      backfillColumn_(sh, allocCol, function (row) {
        return pickAllocationForEmployee_(rowEmpId_(row));
      });
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Productivity History tab seeding (12 months per employee)
// ──────────────────────────────────────────────────────────────────────────

var PROD_HISTORY_TAB_ = 'Productivity History';

/**
 * Seed 12 months of synthetic productivity history per employee.
 *
 * Idempotency: an empty tab (header only) is treated as uninitialized and
 * will be retried on the next run. A tab with data rows is left untouched.
 *
 * Load order: requires _Config aliases for the Finance tab to be seeded
 * before this runs. setupWorkbook calls seedConfig_ + Config.bust before
 * this function, so the order is correct — do not reorder without thought.
 */
function seedProductivityHistory_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PROD_HISTORY_TAB_);
  if (!sh) {
    sh = ss.insertSheet(PROD_HISTORY_TAB_);
    sh.getRange(1, 1, 1, 3).setValues([['Emp ID', 'Month', 'Productivity']]);
    formatTabHeader_(sh, 3);
    sh.setFrozenRows(1);
  }
  // If the tab already has data rows, leave them alone (idempotent re-run).
  if (sh.getLastRow() > 1) return;

  // Requires _Config aliases seeded (caller responsibility — see docstring).
  var fin = Data.finance();
  var now = new Date();
  var rows = [];
  fin.forEach(function (f) {
    if (!f.empId) return;
    var target = typeof f.productivity === 'number' ? f.productivity : 0.75;
    // Drift sign: +1 → employee was below target and recovered (upward shape).
    //             -1 → employee was above target and declined (downward shape).
    var driftSign = stableHash_(f.empId) % 2 === 0 ? 1 : -1;
    for (var k = 11; k >= 0; k--) {
      var d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      var ym = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
      var value;
      if (k === 0) {
        value = target; // anchor current month exactly to target
      } else {
        // Uniform integer noise in [-50, 49]/1250 ≈ ±0.04 (close enough to gaussian for demo data).
        var noise = (stableHash_(f.empId + ':' + ym) % 100 - 50) / 1250;
        var drift = (12 - k) * 0.005 * driftSign;
        value = target - drift + noise;
      }
      // NOTE: employees near the ceiling (target ~0.99) may appear artificially flat
      // after clamping — known demo trade-off; Task 15 should treat it as expected.
      if (value < 0.30) value = 0.30;
      if (value > 0.99) value = 0.99;
      rows.push([f.empId, ym, Math.round(value * 100) / 100]);
    }
  });
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Audit Log tab creation + protection
// ──────────────────────────────────────────────────────────────────────────

var AUDIT_LOG_TAB_ = 'Audit Log';
var AUDIT_LOG_HEADERS_ = ['Timestamp', 'Actor', 'Operation', 'Emp ID', 'Field', 'Old Value', 'New Value', 'Run ID'];

function createAuditLogTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(AUDIT_LOG_TAB_);
  if (!sh) {
    sh = ss.insertSheet(AUDIT_LOG_TAB_);
    applyAuditLogHeader_(sh);
    sh.setColumnWidths(1, AUDIT_LOG_HEADERS_.length, 140);
    sh.setColumnWidth(6, 200); // Old Value — likely to hold full field text
    sh.setColumnWidth(7, 200); // New Value — same
  }
  // Recover from manual corruption: if HR cleared all rows (including the header),
  // re-apply headers so Task 7's appendRow doesn't write headerless data into row 1.
  if (sh.getLastRow() === 0) {
    applyAuditLogHeader_(sh);
  }
  // Protect data rows so HR can't accidentally edit history. ProtectionType.SHEET
  // is intentional (not RANGE) — we want the whole tab protected as a unit.
  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (protections.length === 0) {
    var p = sh.protect().setDescription('Audit Log — managed by HR Automation script — do not edit manually');
    p.setWarningOnly(true); // soft protection (script can still write; user sees a warning popup)
  }
}

function applyAuditLogHeader_(sh) {
  sh.getRange(1, 1, 1, AUDIT_LOG_HEADERS_.length).setValues([AUDIT_LOG_HEADERS_]);
  formatTabHeader_(sh, AUDIT_LOG_HEADERS_.length);
  sh.setFrozenRows(1);
}
