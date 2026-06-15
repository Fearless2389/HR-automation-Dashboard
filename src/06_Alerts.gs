/**
 * 06_Alerts.gs — Alert detection.
 *
 * Mandatory alerts per brief §4.4:
 *   - Intern LWD within 45 days (upcoming AND just-passed)
 *   - Probationer confirmation within 30 days (DOJ + 180 = confirmation)
 *
 * Additional alerts surfaced on the dashboard:
 *   - Low productivity (productivity < threshold)
 *   - Bench (allocation < benchAllocation threshold; US only)
 *
 * Public API:
 *   Alerts.lwdWithin(days)         → Alert[]
 *   Alerts.probationDue(days)      → Alert[]
 *   Alerts.lowProductivity(thr?)   → Alert[]
 *   Alerts.bench()                 → Alert[]
 *   Alerts.all()                   → { lwd, probation, lowProd, bench, critical, warning, info }
 *
 * Alert shape:
 *   { empId, name, dept, region, kind, daysFromNow, message, severity }
 *   severity: 'critical' | 'warning' | 'info'
 */

var Alerts = Alerts || {};

(function (ns) {
  var JUST_PASSED_DAYS = 14; // surface LWD up to 14 days in the past

  ns.lwdWithin = function (days) {
    days = days || Config.threshold('lwdAlertDays');
    var today = startOfDay_(new Date());
    var horizon = addDays_(today, days);
    var pastBoundary = addDays_(today, -JUST_PASSED_DAYS);
    var all = Data.allEmployees();
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      // Interns must have LWD; non-interns may also have LWD (resignations).
      if (!e.lwd) continue;
      var d = startOfDay_(e.lwd);
      if (d < pastBoundary || d > horizon) continue;
      var diff = daysBetween_(today, d);
      out.push({
        empId: e.empId,
        name: e.name,
        dept: e.dept,
        region: e.__region,
        status: e.status,
        kind: 'LWD',
        date: d,
        daysFromNow: diff,
        message: diff >= 0 ? 'LWD in ' + diff + 'd' : 'LWD passed ' + Math.abs(diff) + 'd ago',
        severity: severityForLwd_(diff)
      });
    }
    out.sort(function (a, b) { return a.daysFromNow - b.daysFromNow; });
    return out;
  };

  ns.probationDue = function (days) {
    days = days || Config.threshold('probationConfirmDays');
    var probLen = Config.threshold('probationLengthDays');
    var today = startOfDay_(new Date());
    var horizon = addDays_(today, days);
    var all = Data.allEmployees();
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!e.doj) continue;
      var status = (e.status || '').toLowerCase();
      if (status.indexOf('probation') === -1) continue;
      var conf = addDays_(startOfDay_(e.doj), probLen);
      if (conf < today || conf > horizon) continue;
      var diff = daysBetween_(today, conf);
      out.push({
        empId: e.empId,
        name: e.name,
        dept: e.dept,
        region: e.__region,
        status: e.status,
        kind: 'Probation',
        date: conf,
        doj: e.doj,
        daysFromNow: diff,
        message: 'Confirmation in ' + diff + 'd (DOJ + ' + probLen + 'd)',
        severity: severityForProbation_(diff)
      });
    }
    out.sort(function (a, b) { return a.daysFromNow - b.daysFromNow; });
    return out;
  };

  ns.lowProductivity = function (threshold) {
    threshold = threshold === undefined ? Config.threshold('lowProductivity') : threshold;
    var fin = Data.finance();
    var empMap = byEmpId_(Data.allEmployees());
    var out = [];
    for (var i = 0; i < fin.length; i++) {
      var f = fin[i];
      if (typeof f.productivity !== 'number') continue;
      if (f.productivity >= threshold) continue;
      var emp = empMap[f.empId];
      out.push({
        empId: f.empId,
        name: emp ? emp.name : f.empId,
        dept: emp ? emp.dept : '',
        region: emp ? emp.__region : '',
        kind: 'Productivity',
        productivity: f.productivity,
        threshold: threshold,
        message: 'Productivity ' + (f.productivity * 100).toFixed(0) + '% (target ' + (threshold * 100) + '%)',
        severity: f.productivity < threshold * 0.7 ? 'critical' : 'warning'
      });
    }
    out.sort(function (a, b) { return a.productivity - b.productivity; });
    return out;
  };

  ns.bench = function () {
    var bench = Config.threshold('benchAllocation');
    var rmData = Data.rm({});
    var empMap = byEmpId_(Data.allEmployees());
    var out = [];
    for (var i = 0; i < rmData.rows.length; i++) {
      var r = rmData.rows[i];
      if (typeof r.allocation !== 'number') continue;
      if (r.allocation >= bench) continue;
      var emp = empMap[r.empId];
      out.push({
        empId: r.empId,
        name: r.name || (emp ? emp.name : r.empId),
        dept: emp ? emp.dept : '',
        region: emp ? emp.__region : '',
        kind: 'Bench',
        allocation: r.allocation,
        message: 'Allocation ' + (r.allocation * 100).toFixed(0) + '% (' + (rmData.monthLabel || 'current month') + ')',
        severity: r.allocation < bench * 0.5 ? 'critical' : 'warning'
      });
    }
    out.sort(function (a, b) { return a.allocation - b.allocation; });
    return out;
  };

  ns.all = function () {
    var lwd = ns.lwdWithin();
    var prob = ns.probationDue();
    var lowProd = ns.lowProductivity();
    var bnch = ns.bench();
    var critical = [], warning = [], info = [];
    [lwd, prob, lowProd, bnch].forEach(function (group) {
      group.forEach(function (a) {
        if (a.severity === 'critical') critical.push(a);
        else if (a.severity === 'warning') warning.push(a);
        else info.push(a);
      });
    });
    return { lwd: lwd, probation: prob, lowProd: lowProd, bench: bnch, critical: critical, warning: warning, info: info };
  };

  // ───────── internals ─────────

  function severityForLwd_(diffDays) {
    if (diffDays < 0) return 'critical';       // already passed
    if (diffDays <= 7) return 'critical';      // very soon
    if (diffDays <= 30) return 'warning';
    return 'info';
  }

  function severityForProbation_(diffDays) {
    if (diffDays <= 7) return 'critical';
    if (diffDays <= 21) return 'warning';
    return 'info';
  }

  /**
   * Coerce input to a Date. Returns null if not coercible. Used to make every
   * downstream date math resilient to string ISO dates that may slip through
   * (e.g. from a cached snapshot that JSON-stringified its dates).
   */
  function toDate_(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function startOfDay_(d) {
    d = toDate_(d);
    if (!d) return null;
    var n = new Date(d.getTime());
    n.setHours(0, 0, 0, 0);
    return n;
  }

  function addDays_(d, n) {
    d = toDate_(d);
    if (!d) return null;
    var r = new Date(d.getTime());
    r.setDate(r.getDate() + n);
    return r;
  }

  function daysBetween_(a, b) {
    a = toDate_(a); b = toDate_(b);
    if (!a || !b) return 0;
    return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  }

  function byEmpId_(employees) {
    var m = {};
    for (var i = 0; i < employees.length; i++) m[employees[i].empId] = employees[i];
    return m;
  }
})(Alerts);
