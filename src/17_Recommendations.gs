/**
 * 17_Recommendations.gs — Rule engine for Alert Engine tab.
 *
 * Each rule reads from a passed-in snapshot (no fresh sheet reads), returns
 * a recommendation card object or null.
 *
 * Public API:
 *   Recommendations.all(snapshot) → [{ id, headline, body, severity, action }]
 */

var Recommendations = Recommendations || {};

(function (ns) {
  function rule_intern_backfill(snap) {
    var lwd = (snap.alerts && snap.alerts.lwd) || [];
    var interns = lwd.filter(function (a) { return (a.status || '').toLowerCase().indexOf('intern') !== -1 && a.daysFromNow <= 30; });
    if (interns.length < 3) return null;
    return {
      id: 'intern_backfill',
      headline: interns.length + ' interns exiting within 30 days — consider backfill',
      body: interns.slice(0, 3).map(function (a) { return a.name + ' (' + a.daysFromNow + 'd)'; }).join(' · '),
      severity: 'warning',
      why: interns.map(function (a) { return a.empId + ' · ' + a.name + ' · LWD in ' + a.daysFromNow + 'd'; }),
      action: { label: 'View on Alerts tab', tab: 'alerts' }
    };
  }

  function rule_probation_review_due(snap) {
    var probs = (snap.alerts && snap.alerts.probation) || [];
    var due = probs.filter(function (a) { return a.daysFromNow <= 7; });
    if (!due.length) return null;
    var first = due[0];
    return {
      id: 'probation_review_due',
      headline: first.empId + "'s probation confirmation is due in " + first.daysFromNow + ' days — initiate review',
      body: due.length > 1 ? '+' + (due.length - 1) + ' more confirmations due ≤7 days' : 'Confirmation date: ' + (first.date ? new Date(first.date).toDateString() : '—'),
      severity: 'critical',
      why: due.map(function (a) { return a.empId + ' · ' + a.name + ' · confirmation in ' + a.daysFromNow + 'd'; }),
      action: { label: 'Open Drill-Down (Under Probation)', tab: 'drilldown', filter: { status: 'Under Probation' } }
    };
  }

  function rule_attrition_spike(snap) {
    var trend = snap.attritionTrend || [];
    if (trend.length < 2) return null;
    var cur = trend[trend.length - 1];
    var prev = trend[trend.length - 2];
    if (!cur || !prev || !prev.rate || prev.rate === 0) return null;
    var growth = (cur.rate - prev.rate) / prev.rate;
    if (growth < 0.30) return null;
    return {
      id: 'attrition_spike',
      headline: 'Attrition up ' + Math.round(growth * 100) + '% this quarter — flag to HR lead',
      body: cur.quarter + ' rate ' + (cur.rate * 100).toFixed(2) + '% vs ' + prev.quarter + ' rate ' + (prev.rate * 100).toFixed(2) + '%',
      severity: 'warning',
      why: ['Current quarter exits: ' + cur.count, 'Prior quarter exits: ' + prev.count, 'Growth: ' + Math.round(growth * 100) + '%'],
      action: { label: 'View Attrition Trend', tab: 'overview' }
    };
  }

  function rule_productivity_decline(snap) {
    var rows = (snap.productivity && snap.productivity.all) || [];
    var byDept = {};
    rows.forEach(function (r) {
      if (r.trend === 'down') byDept[r.dept] = (byDept[r.dept] || 0) + 1;
    });
    var topDept = null, topCount = 0;
    Object.keys(byDept).forEach(function (d) { if (byDept[d] > topCount) { topDept = d; topCount = byDept[d]; } });
    if (topCount < 5) return null;
    return {
      id: 'productivity_decline_' + topDept,
      headline: topDept + ' has ' + topCount + ' declining performers — schedule team review',
      body: 'Productivity trend dropped ≥5% over the last 3 months for these employees.',
      severity: 'warning',
      why: rows.filter(function (r) { return r.dept === topDept && r.trend === 'down'; })
                .slice(0, 10).map(function (r) { return r.name + ' (' + (r.current * 100).toFixed(0) + '%)'; }),
      action: { label: 'Open Productivity (filter ' + topDept + ')', tab: 'productivity', filter: { dept: topDept } }
    };
  }

  function rule_bench_risk(snap) {
    var rows = (snap.productivity && snap.productivity.all) || [];
    var benched = rows.filter(function (r) { return typeof r.allocationPct === 'number' && r.allocationPct < 0.40; });
    if (benched.length < 4) return null;
    return {
      id: 'bench_risk',
      headline: benched.length + ' employees under-allocated — reassign to active projects',
      body: 'All have allocation < 40%. Total potential FTE recovered: ' + benched.length + '.',
      severity: 'warning',
      why: benched.slice(0, 8).map(function (r) { return r.name + ' (' + Math.round((r.allocationPct || 0) * 100) + '%)'; }),
      action: { label: 'Open Productivity (low allocation)', tab: 'productivity' }
    };
  }

  function rule_mgr_overload(snap) {
    var groups = snap.orgGroups || [];
    var overloaded = groups.filter(function (g) { return g.count > 10; });
    if (!overloaded.length) return null;
    var first = overloaded[0];
    return {
      id: 'mgr_overload',
      headline: first.manager + ' manages ' + first.count + ' direct reports — consider org split',
      body: overloaded.length > 1 ? '+' + (overloaded.length - 1) + ' other managers also above 10 reports.' : 'Span of control above recommended 10.',
      severity: 'info',
      why: overloaded.map(function (g) { return g.manager + ': ' + g.count + ' reports'; }),
      action: { label: 'Open Org View', tab: 'org' }
    };
  }

  function rule_health_score_drop(snap) {
    var h = snap.health || {};
    if (typeof h.total !== 'number' || h.total >= 70) return null;
    var pillars = h.pillars || {};
    var weakest = Object.keys(pillars).reduce(function (a, b) { return pillars[a] < pillars[b] ? a : b; }, Object.keys(pillars)[0]);
    return {
      id: 'health_score_drop',
      headline: 'HR Health Score fell to ' + Math.round(h.total) + ' — investigate driver pillar',
      body: 'Weakest pillar: ' + weakest + ' (' + Math.round(pillars[weakest] || 0) + '/25).',
      severity: h.total < 60 ? 'critical' : 'warning',
      why: Object.keys(pillars).map(function (k) { return k + ': ' + Math.round(pillars[k] || 0) + '/25'; }),
      action: { label: 'Open Overview', tab: 'overview' }
    };
  }

  function rule_no_recent_offboard_review(snap) {
    var meta = snap.headcount && snap.headcount.lastOffboardDate;
    if (!meta) return null;
    var lastMs = new Date(meta).getTime();
    var daysSince = Math.round((Date.now() - lastMs) / (24 * 60 * 60 * 1000));
    if (daysSince < 14) return null;
    return {
      id: 'no_recent_offboard_review',
      headline: 'No offboardings in ' + daysSince + ' days — verify Offboarded tab is current',
      body: 'Last offboard recorded: ' + new Date(meta).toDateString() + '. Likely a data hygiene issue rather than zero exits.',
      severity: 'info',
      why: ['Last offboard timestamp: ' + new Date(meta).toISOString()],
      action: { label: 'Open Offboarded Resources', tab: 'overview' }
    };
  }

  ns.all = function (snapshot) {
    var rules = [
      rule_probation_review_due, rule_intern_backfill, rule_attrition_spike,
      rule_productivity_decline, rule_bench_risk, rule_mgr_overload,
      rule_health_score_drop, rule_no_recent_offboard_review
    ];
    var props = PropertiesService.getScriptProperties();
    var nowMs = Date.now();
    var out = [];
    rules.forEach(function (r) {
      var rec = null;
      try { rec = r(snapshot); } catch (e) { return; }
      if (!rec) return;
      var dismissedIso = props.getProperty('recDismiss:' + rec.id);
      if (dismissedIso && (nowMs - new Date(dismissedIso).getTime()) < 7 * 24 * 60 * 60 * 1000) return;
      out.push(rec);
    });
    return out;
  };

  ns.dismiss = function (id) {
    PropertiesService.getScriptProperties().setProperty('recDismiss:' + id, new Date().toISOString());
  };
})(Recommendations);
