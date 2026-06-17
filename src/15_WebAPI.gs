/**
 * 15_WebAPI.gs — Server-side handlers exposed via google.script.run.
 *
 * The Web App calls these from Alpine:
 *   google.script.run.withSuccessHandler(fn).api_snapshot();
 *
 * Date fields are returned as ISO strings; the client parses them back into
 * Date as needed. All handlers cache where reasonable.
 *
 * Public API (callable from client):
 *   api_snapshot()                  → full dashboard snapshot
 *   api_drilldown(filter)           → filtered employees
 *   api_runAction(action, empId)    → trigger a workflow action
 *   api_currentUser()               → { email, isAdmin }
 */

var API_SNAPSHOT_KEY = 'snapshot:dashboard:v1';
var API_SNAPSHOT_TTL = 60;

function api_snapshot() {
  return Cache.wrap(API_SNAPSHOT_KEY, API_SNAPSHOT_TTL, function () {
    var emps = Data.allEmployees();
    var alerts = Alerts.all();
    return {
      generatedAt: new Date().toISOString(),
      generatedAtLabel: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy · HH:mm'),
      user: { email: tryEmail_() },
      kpis: Metrics.kpiStrip(),
      health: HealthScore.compute(),
      headcount: Metrics.headcount(),
      departmentBreakdown: Metrics.departmentBreakdown(),
      attritionTrend: Metrics.attritionTrend(4),
      alerts: {
        lwd: alerts.lwd.map(serializeAlert_),
        probation: alerts.probation.map(serializeAlert_),
        lowProductivity: alerts.lowProd.map(serializeAlert_),
        bench: alerts.bench.map(serializeAlert_),
        critical: alerts.critical.map(serializeAlert_),
        warning: alerts.warning.map(serializeAlert_)
      },
      orgNodes: OrgChart.nodesForChart(),
      orgGroups: OrgChart.buildGroups(),
      drilldownFilters: {
        regions: ['All'].concat(distinctValues_(emps, '__region')),
        departments: ['All'].concat(distinctValues_(emps, 'dept')),
        reportingManagers: ['All'].concat(distinctValues_(emps, 'rm')),
        statuses: ['All'].concat(distinctValues_(emps, 'status'))
      },
      systemHealth: (typeof SelfMonitor !== 'undefined' && SelfMonitor.collect)
        ? { ok: true, issues: SelfMonitor.collect() }
        : { ok: true, issues: [] },
      thresholds: {
        lwdAlertDays: Config.threshold('lwdAlertDays'),
        probationConfirmDays: Config.threshold('probationConfirmDays'),
        probationLengthDays: Config.threshold('probationLengthDays')
      }
    };
  });
}

function api_drilldown(filter) {
  filter = filter || {};
  var emps = Data.allEmployees();
  var text = String((filter && filter.text) || '').trim().toLowerCase();
  var out = emps.filter(function (e) {
    if (filter.region && filter.region !== 'All' && e.__region !== filter.region) return false;
    if (filter.dept && filter.dept !== 'All' && e.dept !== filter.dept) return false;
    if (filter.rm && filter.rm !== 'All' && e.rm !== filter.rm) return false;
    if (filter.status && filter.status !== 'All' && e.status !== filter.status) return false;
    if (filter.project && filter.project !== 'All' && e.project !== filter.project) return false;
    if (text) {
      var hay = [e.name, e.empId, e.skillset, e.designation, e.project].join(' ').toLowerCase();
      if (hay.indexOf(text) === -1) return false;
    }
    return true;
  }).map(serializeEmployee_);
  return { count: out.length, rows: out };
}

function api_runAction(action, empId) {
  if (!action || !empId) return { ok: false, message: 'Missing action or empId' };
  if (typeof Workflow === 'undefined' || !Workflow.runFromWebApp) {
    return { ok: false, message: 'Workflow engine not available' };
  }
  try {
    var result = Workflow.runFromWebApp(action, empId);
    return { ok: !!result.ok, message: result.message || '' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

function api_currentUser() {
  var email = tryEmail_();
  return { email: email, isAllowed: Config.isAllowed(email) };
}

// ───────── serializers ─────────

function serializeEmployee_(e) {
  return {
    empId: e.empId,
    name: e.name,
    region: e.__region,
    dept: e.dept,
    designation: e.designation,
    rm: e.rm,
    status: e.status,
    skillset: e.skillset,
    project: e.project || '',
    doj: e.doj ? e.doj.toISOString() : null,
    lwd: e.lwd ? e.lwd.toISOString() : null,
    allocationPct: typeof e.allocationPct === 'number' ? e.allocationPct : null,
    ctc: typeof e.ctc === 'number' ? e.ctc : null
  };
}

function serializeAlert_(a) {
  return {
    empId: a.empId,
    name: a.name,
    dept: a.dept,
    region: a.region,
    status: a.status || '',
    kind: a.kind,
    severity: a.severity,
    daysFromNow: typeof a.daysFromNow === 'number' ? a.daysFromNow : null,
    date: a.date ? a.date.toISOString() : null,
    doj: a.doj ? a.doj.toISOString() : null,
    productivity: typeof a.productivity === 'number' ? a.productivity : null,
    allocation: typeof a.allocation === 'number' ? a.allocation : null,
    message: a.message
  };
}

function distinctValues_(arr, field) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i][field];
    if (!v) continue;
    if (seen[v]) continue;
    seen[v] = true; out.push(v);
  }
  return out.sort();
}

function tryEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

// ───────── Phase 2 write helpers ─────────

var EDITABLE_FIELDS_ = ['name', 'dept', 'designation', 'rm', 'status', 'project', 'allocationPct', 'doj', 'skillset', 'lwd'];

function locateEmployee_(empId) {
  if (!empId) throw new Error('empId required');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var regions = ['india', 'us'];
  for (var i = 0; i < regions.length; i++) {
    var tabName = Config.canonicalToTabName(regions[i]);
    var sh = ss.getSheetByName(tabName);
    if (!sh) continue;
    var headerRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var empIdCol = Header.col(sh, regions[i], 'empId') + 1; // 1-based
    var lastRow = sh.getLastRow();
    if (lastRow < 2) continue;
    var ids = sh.getRange(2, empIdCol, lastRow - 1, 1).getValues();
    for (var r = 0; r < ids.length; r++) {
      if (String(ids[r][0]).trim() === String(empId).trim()) {
        return { region: regions[i], sheet: sh, row: r + 2, headers: headerRow };
      }
    }
  }
  return null;
}

function nextEmpId_(region) {
  var prefix = region === 'india' ? 'IN1' : 'US1';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(Config.canonicalToTabName(region));
  if (!sh) throw new Error('region tab missing: ' + region);
  var empIdCol = Header.col(sh, region, 'empId') + 1;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return prefix + '001';
  var ids = sh.getRange(2, empIdCol, lastRow - 1, 1).getValues();
  var maxN = 0;
  ids.forEach(function (row) {
    var m = String(row[0]).match(/^[A-Z]{2}1(\d+)$/);
    if (m) { var n = parseInt(m[1], 10); if (n > maxN) maxN = n; }
  });
  var next = maxN + 1;
  return prefix + (next < 1000 ? ('00' + next).slice(-3) : String(next));
}

function canonicalToHeader_(region, canonical) {
  var aliases = Config.aliasesFor(region, canonical);
  return aliases[0] || canonical;
}

// ───────── api_updateEmployee ─────────

function api_updateEmployee(empId, patch) {
  var runId = Log.start('api_updateEmployee', 'webapp');
  try {
    if (!empId || !patch) throw new Error('empId and patch required');
    var loc = locateEmployee_(empId);
    if (!loc) throw new Error('employee not found: ' + empId);

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(5000)) throw new Error('could not acquire document lock');
    try {
      var changes = [];
      var rowValues = loc.sheet.getRange(loc.row, 1, 1, loc.sheet.getLastColumn()).getValues()[0];
      withSilentWrite(function () {
        Object.keys(patch).forEach(function (field) {
          if (EDITABLE_FIELDS_.indexOf(field) === -1) return; // ignore unknown
          var header = canonicalToHeader_(loc.region, field);
          var colIdx = -1;
          for (var i = 0; i < loc.headers.length; i++) {
            if (String(loc.headers[i]).trim() === header) { colIdx = i; break; }
          }
          if (colIdx === -1) return; // header not present
          var oldVal = rowValues[colIdx];
          var newVal = patch[field];
          if (field === 'allocationPct' && typeof newVal === 'number' && newVal <= 1) newVal = newVal * 100;
          if (String(oldVal) === String(newVal)) return; // no-op
          loc.sheet.getRange(loc.row, colIdx + 1).setValue(newVal);
          changes.push({ field: field, oldVal: oldVal, newVal: newVal });
        });
      });

      AuditLog.recordMany('update', empId, changes, runId);
      Log.info(runId, 'employee.update', { empId: empId, region: loc.region, changeCount: changes.length });
      Data.bustAll();
      Cache.bust('snapshot:');
      Log.end(runId, { changeCount: changes.length });
      return { ok: true, changeCount: changes.length };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Log.error(runId, 'api_updateEmployee: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
    return { ok: false, message: e.message };
  }
}

// ───────── api_addEmployee ─────────

function api_addEmployee(payload) {
  var runId = Log.start('api_addEmployee', 'webapp');
  try {
    if (!payload || !payload.region) throw new Error('payload.region required (india|us)');
    if (payload.region !== 'india' && payload.region !== 'us') throw new Error('region must be india or us');

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(5000)) throw new Error('could not acquire document lock');
    try {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(Config.canonicalToTabName(payload.region));
      var newId = nextEmpId_(payload.region);
      var headerRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      var row = new Array(headerRow.length).fill('');

      function setField(canonical, value) {
        var header = canonicalToHeader_(payload.region, canonical);
        for (var i = 0; i < headerRow.length; i++) {
          if (String(headerRow[i]).trim() === header) { row[i] = value; return; }
        }
      }
      setField('empId', newId);
      setField('name', payload.name || '');
      setField('dept', payload.dept || '');
      setField('designation', payload.designation || '');
      setField('rm', payload.rm || '');
      setField('status', payload.status || 'Confirmed');
      setField('project', payload.project || 'Unassigned');
      setField('skillset', payload.skillset || '');
      if (payload.doj) setField('doj', new Date(payload.doj));
      if (typeof payload.allocationPct === 'number') {
        setField('allocationPct', payload.allocationPct <= 1 ? payload.allocationPct * 100 : payload.allocationPct);
      }

      withSilentWrite(function () {
        sh.appendRow(row);
      });

      AuditLog.record({
        op: 'add', empId: newId, field: '', oldVal: '',
        newVal: JSON.stringify({ region: payload.region, name: payload.name, dept: payload.dept, designation: payload.designation, project: payload.project }),
        runId: runId
      });
      Log.info(runId, 'employee.add', { empId: newId, region: payload.region });
      Data.bustAll();
      Cache.bust('snapshot:');
      Log.end(runId, { empId: newId });
      return { ok: true, empId: newId };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Log.error(runId, 'api_addEmployee: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
    return { ok: false, message: e.message };
  }
}

// ───────── api_offboardEmployee ─────────

function api_offboardEmployee(empId, reason) {
  var runId = Log.start('api_offboardEmployee', 'webapp');
  try {
    if (!empId) throw new Error('empId required');
    var loc = locateEmployee_(empId);
    if (!loc) throw new Error('employee not found: ' + empId);
    var reasonStr = String(reason || '').trim();
    if (!reasonStr) throw new Error('reason required');

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(5000)) throw new Error('could not acquire document lock');
    try {
      var rowValues = loc.sheet.getRange(loc.row, 1, 1, loc.sheet.getLastColumn()).getValues()[0];
      var nameIdx = -1, statusIdx = -1, deptIdx = -1;
      for (var i = 0; i < loc.headers.length; i++) {
        var h = String(loc.headers[i]).trim();
        if (h === canonicalToHeader_(loc.region, 'name')) nameIdx = i;
        if (h === canonicalToHeader_(loc.region, 'status')) statusIdx = i;
        if (h === canonicalToHeader_(loc.region, 'dept')) deptIdx = i;
      }
      var prevStatus = statusIdx >= 0 ? rowValues[statusIdx] : '';
      var empName = nameIdx >= 0 ? rowValues[nameIdx] : '';
      var empDept = deptIdx >= 0 ? rowValues[deptIdx] : '';

      withSilentWrite(function () {
        // 1. Flip status on source row
        if (statusIdx >= 0) loc.sheet.getRange(loc.row, statusIdx + 1).setValue('Offboarded');

        // 2. Append a row to Offboarded Resources
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var offSh = ss.getSheetByName(Config.canonicalToTabName('offboarded'));
        if (offSh) {
          var offHeaders = offSh.getRange(1, 1, 1, offSh.getLastColumn()).getValues()[0];
          var newRow = new Array(offHeaders.length).fill('');
          for (var j = 0; j < offHeaders.length; j++) {
            var oh = String(offHeaders[j]).trim();
            if (oh === 'Emp ID' || oh === 'Employee ID') newRow[j] = empId;
            else if (oh === 'Name' || oh === 'Employee Name') newRow[j] = empName;
            else if (oh === 'Dept' || oh === 'Department') newRow[j] = empDept;
            else if (oh === 'DOL' || oh === 'Date of Leaving' || oh === 'Last Working Day' || oh === 'Exit Date') newRow[j] = new Date();
            else if (oh === 'Reason' || oh === 'Exit Reason' || oh === 'Reason for Leaving') newRow[j] = reasonStr;
          }
          offSh.appendRow(newRow);
        }
      });

      AuditLog.record({
        op: 'offboard', empId: empId, field: 'status',
        oldVal: prevStatus, newVal: 'Offboarded · ' + reasonStr, runId: runId
      });
      Log.info(runId, 'employee.offboard', { empId: empId, reason: reasonStr });
      Data.bustAll();
      Cache.bust('snapshot:');
      Log.end(runId, { empId: empId });
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Log.error(runId, 'api_offboardEmployee: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
    return { ok: false, message: e.message };
  }
}
