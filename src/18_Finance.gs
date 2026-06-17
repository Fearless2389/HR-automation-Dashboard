/**
 * 18_Finance.gs — Project / Department / Region aggregations.
 *
 * All values computed live from Data.allEmployees() + Data.finance() join.
 * No hardcoded numbers.
 *
 * Public API:
 *   Finance.snapshot() → { byProject, byDept, byRegion, drillDown }
 */

var Finance = Finance || {};

(function (ns) {
  ns.snapshot = function () {
    var emps = Data.allEmployees();
    var fin = Data.finance();
    var finByEmp = {};
    fin.forEach(function (f) { if (f.empId) finByEmp[f.empId] = f; });

    var joined = emps.map(function (e) {
      var f = finByEmp[e.empId] || {};
      return {
        empId: e.empId, name: e.name, dept: e.dept, designation: e.designation,
        region: e.__region, project: e.project || 'Unassigned',
        ctcInr: typeof f.ctcInrAnnual === 'number' ? f.ctcInrAnnual : null,
        ctcUsd: typeof f.ctcUsdAnnual === 'number' ? f.ctcUsdAnnual : null
      };
    });

    var byProject = aggregate_(joined, 'project');
    var byDept = aggregate_(joined, 'dept');
    var byRegion = aggregate_(joined, 'region');
    var drillDown = {};
    joined.forEach(function (j) {
      drillDown['project:' + j.project] = drillDown['project:' + j.project] || [];
      drillDown['project:' + j.project].push(serializeEmp_(j));
      drillDown['dept:' + j.dept] = drillDown['dept:' + j.dept] || [];
      drillDown['dept:' + j.dept].push(serializeEmp_(j));
    });

    return { byProject: byProject, byDept: byDept, byRegion: byRegion, drillDown: drillDown };
  };

  function aggregate_(rows, key) {
    var buckets = {};
    rows.forEach(function (r) {
      var k = r[key] || 'Unknown';
      if (!buckets[k]) buckets[k] = { key: k, headcount: 0, ctcInr: 0, ctcUsd: 0 };
      buckets[k].headcount++;
      if (typeof r.ctcInr === 'number') buckets[k].ctcInr += r.ctcInr;
      if (typeof r.ctcUsd === 'number') buckets[k].ctcUsd += r.ctcUsd;
    });
    return Object.keys(buckets).map(function (k) { return buckets[k]; })
      .sort(function (a, b) { return (b.ctcInr + b.ctcUsd) - (a.ctcInr + a.ctcUsd); });
  }
  function serializeEmp_(j) {
    return { empId: j.empId, name: j.name, designation: j.designation, region: j.region, ctcInr: j.ctcInr, ctcUsd: j.ctcUsd };
  }
})(Finance);
