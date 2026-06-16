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
  var out = emps.filter(function (e) {
    if (filter.region && filter.region !== 'All' && e.__region !== filter.region) return false;
    if (filter.dept && filter.dept !== 'All' && e.dept !== filter.dept) return false;
    if (filter.rm && filter.rm !== 'All' && e.rm !== filter.rm) return false;
    if (filter.status && filter.status !== 'All' && e.status !== filter.status) return false;
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
