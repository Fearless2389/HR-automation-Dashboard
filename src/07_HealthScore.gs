/**
 * 07_HealthScore.gs — HR Health Score.
 *
 * Four-pillar additive composite (0–100, each pillar 0–25):
 *
 *   Stability       = w_s × (1 − min(quarterlyAttritionRate, capS) / capS)
 *   Alert Load      = w_a × (1 − min(criticalAlerts / headcount, capA) / capA)
 *   Risk Posture    = w_r × (1 − min(employeesInRiskWindow / headcount, capR) / capR)
 *   Productivity    = w_p × clamp(avgProductivity / productivityTarget, 0, 1)
 *
 *   Total = sum(pillars); reported with per-pillar breakdown so the dashboard
 *   can show *why* the score moved.
 *
 * Bands (defaults, tunable in _Config):
 *   Green  ≥ 80
 *   Amber  60–79
 *   Red    < 60
 *
 * Caps (worst-case input the formula assumes):
 *   capS = 0.25  (25% quarterly attrition → 0 stability)
 *   capA = 0.20  (critical alerts equal to 20% of headcount → 0 alert load)
 *   capR = 0.30  (30% of staff in a 30-day risk window → 0 risk posture)
 *
 * Public API:
 *   HealthScore.compute()  → { total, pillars: { stability, alertLoad, riskPosture, productivity }, asOf }
 */

var HealthScore = HealthScore || {};

(function (ns) {
  var CAP_S = 0.25, CAP_A = 0.20, CAP_R = 0.30;
  var RISK_WINDOW_DAYS = 30;
  var CACHE_KEY = 'health:score:v1';
  var CACHE_TTL = 120;

  ns.compute = function () {
    return Cache.wrap(CACHE_KEY, CACHE_TTL, computeFresh_);
  };

  function computeFresh_() {
    var weights = Config.healthWeights();
    var all = Data.allEmployees();
    var headcount = all.length;

    // ── Pillar 1: Stability ──
    var attr = Metrics.quarterlyAttrition();
    var stability = weights.stability * (1 - Math.min(attr, CAP_S) / CAP_S);

    // ── Pillar 2: Alert Load ──
    var critical = Alerts.all().critical.length;
    var alertRatio = headcount ? critical / headcount : 0;
    var alertLoad = weights.alertLoad * (1 - Math.min(alertRatio, CAP_A) / CAP_A);

    // ── Pillar 3: Risk Posture ──
    var risky = 0;
    for (var i = 0; i < all.length; i++) { if (isRiskyWindow_(all[i], RISK_WINDOW_DAYS)) risky++; }
    var riskRatio = headcount ? risky / headcount : 0;
    var riskPosture = weights.riskPosture * (1 - Math.min(riskRatio, CAP_R) / CAP_R);

    // ── Pillar 4: Productivity ──
    var target = Config.threshold('productivityTarget') || 0.8;
    var fin = Data.finance();
    var prods = fin.map(function (f) { return f.productivity; }).filter(function (v) { return typeof v === 'number'; });
    var avgProd = prods.length ? prods.reduce(function (a, b) { return a + b; }, 0) / prods.length : 0;
    var productivity = weights.productivity * Math.max(0, Math.min(1, avgProd / target));

    var pillars = {
      stability: round1_(stability),
      alertLoad: round1_(alertLoad),
      riskPosture: round1_(riskPosture),
      productivity: round1_(productivity)
    };
    var total = round1_(pillars.stability + pillars.alertLoad + pillars.riskPosture + pillars.productivity);

    return {
      total: total,
      pillars: pillars,
      asOf: new Date(),
      inputs: {
        quarterlyAttrition: round3_(attr),
        criticalAlerts: critical,
        riskyEmployees: risky,
        headcount: headcount,
        avgProductivity: round3_(avgProd),
        productivityTarget: target
      }
    };
  }

  /**
   * An employee is in the 30-day "risk window" if any of:
   *   - LWD in the past 14 days OR upcoming within `days` days
   *   - Probationer with confirmation within `days` days
   *   - US employee with allocation < benchAllocation (latent productivity risk)
   */
  function isRiskyWindow_(e, days) {
    var today = startOfDay_(new Date());
    var horizon = addDays_(today, days);
    var pastBoundary = addDays_(today, -14);

    if (e.lwd) {
      var d = startOfDay_(e.lwd);
      if (d >= pastBoundary && d <= horizon) return true;
    }
    if (e.doj && (e.status || '').toLowerCase().indexOf('probation') !== -1) {
      var probLen = Config.threshold('probationLengthDays');
      var conf = addDays_(startOfDay_(e.doj), probLen);
      if (conf >= today && conf <= horizon) return true;
    }
    if (typeof e.allocationPct === 'number') {
      var bench = Config.threshold('benchAllocation');
      if (e.allocationPct < bench) return true;
    }
    return false;
  }

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

  function round1_(n) { return Math.round(n * 10) / 10; }
  function round3_(n) { return Math.round(n * 1000) / 1000; }
})(HealthScore);
