/**
 * 05_Metrics.gs — Aggregate metrics computed from cached source data.
 *
 * All methods derive from Data.* readers (which are themselves cache-wrapped).
 * No re-reading the sheet directly.
 *
 * Public API:
 *   Metrics.headcount()                 → { india, us, total, byDept, byStatus, byRegion }
 *   Metrics.quarterlyAttrition(asOf?)   → number  (fraction in [0, 1])
 *   Metrics.attritionTrend(quarters?)   → [{ quarter, count, rate }]
 *   Metrics.allocationUtilization()     → { avg, p50, underutilized:[...] }
 *   Metrics.departmentBreakdown()       → [{ dept, total, confirmed, probation, intern }]
 *   Metrics.kpiStrip()                  → KPI[]
 */

var Metrics = Metrics || {};

(function (ns) {

  ns.headcount = function () {
    var india = Data.india();
    var us = Data.us();
    var all = india.concat(us);
    var byDept = countBy_(all, 'dept');
    var byStatus = countBy_(all, 'status');
    var byRegion = { India: india.length, US: us.length };
    return { india: india.length, us: us.length, total: all.length, byDept: byDept, byStatus: byStatus, byRegion: byRegion };
  };

  /**
   * Quarterly attrition for the quarter containing `asOf` (default: now).
   * Formula:  exitsInQuarter / (currentHeadcount + exitsInQuarter)
   * — a reasonable proxy for "starting headcount" without needing point-in-time data.
   */
  ns.quarterlyAttrition = function (asOf) {
    asOf = asOf ? new Date(asOf) : new Date();
    var q = quarterBounds_(asOf);
    var exits = Data.offboarded().filter(function (e) {
      return e.dol && e.dol >= q.start && e.dol <= q.end;
    });
    var current = ns.headcount().total;
    var denominator = current + exits.length;
    if (denominator === 0) return 0;
    return exits.length / denominator;
  };

  /**
   * Last N quarters of attrition (default 4) — for trend chart.
   */
  ns.attritionTrend = function (quarters) {
    quarters = quarters || 4;
    var out = [];
    var current = ns.headcount().total;
    var now = new Date();
    for (var i = quarters - 1; i >= 0; i--) {
      var ref = addMonths_(now, -i * 3);
      var q = quarterBounds_(ref);
      var exits = Data.offboarded().filter(function (e) { return e.dol && e.dol >= q.start && e.dol <= q.end; });
      var denom = current + exits.length;
      out.push({
        quarter: q.label,
        count: exits.length,
        rate: denom === 0 ? 0 : exits.length / denom
      });
    }
    return out;
  };

  ns.allocationUtilization = function () {
    var rm = Data.rm({});
    var rows = rm.rows;
    var vals = rows.map(function (r) { return r.allocation; }).filter(function (v) { return typeof v === 'number'; });
    if (!vals.length) return { avg: 0, p50: 0, underutilized: [], monthLabel: rm.monthLabel };

    var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var p50 = sorted[Math.floor(sorted.length / 2)];

    var bench = Config.threshold('benchAllocation');
    var underutilized = rows.filter(function (r) { return typeof r.allocation === 'number' && r.allocation < bench; });

    return { avg: avg, p50: p50, underutilized: underutilized, monthLabel: rm.monthLabel };
  };

  ns.departmentBreakdown = function () {
    var all = Data.india().concat(Data.us());
    var depts = {};
    all.forEach(function (e) {
      var d = e.dept || 'Unknown';
      if (!depts[d]) depts[d] = { dept: d, total: 0, confirmed: 0, probation: 0, intern: 0 };
      depts[d].total++;
      var s = (e.status || '').toLowerCase();
      if (s.indexOf('confirm') !== -1) depts[d].confirmed++;
      else if (s.indexOf('probation') !== -1) depts[d].probation++;
      else if (s.indexOf('intern') !== -1) depts[d].intern++;
    });
    return Object.keys(depts).map(function (k) { return depts[k]; })
      .sort(function (a, b) { return b.total - a.total; });
  };

  /**
   * KPI strip drives the top of both the Dashboard tab and the web app.
   * Each KPI is { label, value, hint?, tone? }.
   *   tone: 'good' | 'neutral' | 'warn' | 'danger'
   */
  ns.kpiStrip = function () {
    var hc = ns.headcount();
    var attr = ns.quarterlyAttrition();
    var alerts = Alerts.all();
    var health = HealthScore.compute();
    var alloc = ns.allocationUtilization();

    return [
      { label: 'Total Headcount', value: hc.total, hint: hc.india + ' India · ' + hc.us + ' US', tone: 'neutral' },
      { label: 'Confirmed', value: hc.byStatus['Confirmed'] || 0, hint: pct_(hc.byStatus['Confirmed'] || 0, hc.total), tone: 'good' },
      { label: 'Under Probation', value: hc.byStatus['Under Probation'] || 0, hint: pct_(hc.byStatus['Under Probation'] || 0, hc.total), tone: 'neutral' },
      { label: 'Interns', value: hc.byStatus['Intern'] || 0, hint: pct_(hc.byStatus['Intern'] || 0, hc.total), tone: 'neutral' },
      { label: 'LWD Alerts', value: alerts.lwd.length, hint: 'within ' + Config.threshold('lwdAlertDays') + 'd', tone: alerts.lwd.length > 0 ? 'warn' : 'good' },
      { label: 'Probation Due', value: alerts.probation.length, hint: 'within ' + Config.threshold('probationConfirmDays') + 'd', tone: alerts.probation.length > 0 ? 'warn' : 'good' },
      { label: 'Quarterly Attrition', value: (attr * 100).toFixed(1) + '%', hint: 'this quarter', tone: attr > 0.10 ? 'danger' : (attr > 0.05 ? 'warn' : 'good') },
      { label: 'Avg Allocation', value: alloc.avg ? (alloc.avg * 100).toFixed(0) + '%' : '—', hint: alloc.monthLabel || '', tone: alloc.avg < Config.threshold('benchAllocation') ? 'warn' : 'good' },
      { label: 'HR Health Score', value: health.total, hint: healthBand_(health.total), tone: healthTone_(health.total) }
    ];
  };

  // ───────── internals ─────────

  function countBy_(rows, key) {
    var out = {};
    for (var i = 0; i < rows.length; i++) {
      var v = String(rows[i][key] || 'Unknown');
      out[v] = (out[v] || 0) + 1;
    }
    return out;
  }

  function quarterBounds_(d) {
    var y = d.getFullYear();
    var q = Math.floor(d.getMonth() / 3); // 0..3
    var start = new Date(y, q * 3, 1);
    var end = new Date(y, q * 3 + 3, 0, 23, 59, 59); // last day of quarter
    return { start: start, end: end, label: 'Q' + (q + 1) + ' ' + y };
  }

  function addMonths_(d, months) {
    var nd = new Date(d.getTime());
    nd.setMonth(nd.getMonth() + months);
    return nd;
  }

  function pct_(num, denom) {
    if (!denom) return '—';
    return Math.round((num / denom) * 100) + '%';
  }

  function healthBand_(score) {
    var bands = Config.healthBands();
    if (score >= bands.green) return 'Green';
    if (score >= bands.amber) return 'Amber';
    return 'Red';
  }

  function healthTone_(score) {
    var bands = Config.healthBands();
    if (score >= bands.green) return 'good';
    if (score >= bands.amber) return 'warn';
    return 'danger';
  }
})(Metrics);
