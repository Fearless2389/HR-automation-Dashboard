/**
 * 22_Risk.gs — Risk tier classifier for employee rows.
 *
 * Pure. No I/O. Deterministic from the passed-in employee object.
 *
 * Public API:
 *   Risk.tier(emp)    → { tier: 'green'|'amber'|'red', reasons: [str, ...] }
 *   Risk.dotHtml(emp) → '<span class="risk-dot risk-{tier}" title="{reasons}"></span>'
 */

var Risk = Risk || {};

(function (ns) {
  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  ns.tier = function (emp) {
    if (!emp) return { tier: 'green', reasons: [] };
    var reasons = [];
    var tier = 'green';

    var now = new Date();
    var lwd = emp.lwd ? (emp.lwd instanceof Date ? emp.lwd : new Date(emp.lwd)) : null;
    var lwdDays = (lwd && !isNaN(lwd.getTime())) ? Math.round((lwd.getTime() - now.getTime()) / MS_PER_DAY) : null;

    var doj = emp.doj ? (emp.doj instanceof Date ? emp.doj : new Date(emp.doj)) : null;
    var probDays = null;
    if (doj && !isNaN(doj.getTime()) && String(emp.status) === 'Under Probation') {
      var confirmDate = new Date(doj.getTime() + 180 * MS_PER_DAY);
      probDays = Math.round((confirmDate.getTime() - now.getTime()) / MS_PER_DAY);
    }

    var prod = typeof emp.productivity === 'number' ? emp.productivity : null;
    var alloc = typeof emp.allocationPct === 'number' ? emp.allocationPct : null;

    // Red rules
    if (String(emp.status) === 'Offboarded') { tier = 'red'; reasons.push('Status: Offboarded'); }
    if (lwdDays !== null && lwdDays < 14) { tier = 'red'; reasons.push('LWD in ' + lwdDays + 'd'); }
    if (prod !== null && prod < 0.50) { tier = 'red'; reasons.push('Productivity ' + prod.toFixed(2)); }

    if (tier === 'red') return { tier: tier, reasons: reasons };

    // Amber rules
    if (lwdDays !== null && lwdDays < 45) { tier = 'amber'; reasons.push('LWD in ' + lwdDays + 'd'); }
    if (probDays !== null && probDays < 30) { tier = 'amber'; reasons.push('Confirmation in ' + probDays + 'd'); }
    if (prod !== null && prod < 0.70) { tier = 'amber'; reasons.push('Productivity ' + prod.toFixed(2)); }
    if (alloc !== null && alloc < 0.40) { tier = 'amber'; reasons.push('Allocation ' + Math.round(alloc * 100) + '%'); }

    return { tier: tier, reasons: reasons };
  };

  ns.dotHtml = function (emp) {
    var r = ns.tier(emp);
    var title = r.reasons.length ? r.reasons.join(' · ') : 'Healthy';
    return '<span class="risk-dot risk-' + r.tier + '" title="' + title.replace(/"/g, '&quot;') + '"></span>';
  };
})(Risk);
