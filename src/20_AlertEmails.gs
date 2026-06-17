/**
 * 20_AlertEmails.gs — Per-alert outbound emails with idempotent dedup.
 *
 * For each active LWD/probation alert, send one email to alertEmailRecipient.
 * Dedup key in ScriptProperties so we never email the same alert twice.
 *
 * Demo mode short-circuits the send (Email.send respects Config.isDemoMode()),
 * but dedup keys still get written — that's fine because re-running won't loop.
 *
 * Public API:
 *   AlertEmails.runOnce()            → { sent, skippedDedup, skippedNoRecipient }
 *   AlertEmails.resetDedup()         → clears all dedup keys (testing)
 */

var AlertEmails = AlertEmails || {};

(function (ns) {
  var DEDUP_PREFIX = 'alertEmail:';

  function dedupKey_(alert) {
    var band = 'gt45';
    if (alert.kind === 'LWD') {
      var d = alert.daysFromNow;
      if (d < 14) band = 'lt14';
      else if (d < 30) band = 'lt30';
      else band = 'lt45';
    } else if (alert.kind === 'Probation') {
      var d2 = alert.daysFromNow;
      if (d2 < 7) band = 'lt7';
      else if (d2 < 30) band = 'lt30';
    }
    return DEDUP_PREFIX + alert.empId + ':' + alert.kind + ':' + band;
  }

  ns.runOnce = function () {
    var runId = Log.start('AlertEmails.runOnce', 'onSchedule');
    var props = PropertiesService.getScriptProperties();
    var recipient = (Config.alertEmailRecipient && Config.alertEmailRecipient()) || '';
    if (!recipient) {
      Log.warn(runId, 'No alertEmailRecipient configured — skipping all sends');
      Log.end(runId, { reason: 'no recipient' });
      return { sent: 0, skippedDedup: 0, skippedNoRecipient: 1 };
    }

    var alerts = Alerts.all();
    var candidates = [].concat(alerts.lwd || [], alerts.probation || []);

    var sent = 0, skippedDedup = 0;
    candidates.forEach(function (a) {
      var key = dedupKey_(a);
      if (props.getProperty(key)) { skippedDedup++; return; }
      var subject = (a.kind === 'LWD' ? (a.daysFromNow < 14 ? '[URGENT] ' : '') : '')
        + a.kind + ' alert · ' + a.name + ' · ' + a.empId;
      var html = buildAlertEmailBody_(a);
      var result = Email.send('alert.perAlert', {
        empId: a.empId, name: a.name, dept: a.dept,
        kind: a.kind, daysFromNow: a.daysFromNow,
        date: a.date ? Utilities.formatDate(a.date, Session.getScriptTimeZone(), 'd MMM yyyy') : '',
        message: a.message,
        bodyHtml: html, subject: subject
      }, recipient);
      if (result.ok) {
        props.setProperty(key, new Date().toISOString());
        sent++;
      } else {
        Log.warn(runId, 'send failed for ' + key + ': ' + result.message);
      }
    });

    Log.end(runId, { sent: sent, skippedDedup: skippedDedup, recipient: recipient });
    return { sent: sent, skippedDedup: skippedDedup, skippedNoRecipient: 0 };
  };

  ns.resetDedup = function () {
    var props = PropertiesService.getScriptProperties();
    var all = props.getProperties();
    var removed = 0;
    Object.keys(all).forEach(function (k) {
      if (k.indexOf(DEDUP_PREFIX) === 0) { props.deleteProperty(k); removed++; }
    });
    return removed;
  };

  function buildAlertEmailBody_(a) {
    return ''
      + '<div style="font-family:Inter,Arial,sans-serif;color:#18181B;line-height:1.5;">'
      + '<h2 style="color:#4F46E5;margin:0 0 16px;">' + a.kind + ' alert</h2>'
      + '<p><strong>' + esc_(a.name) + '</strong> · ' + esc_(a.empId) + ' · ' + esc_(a.dept) + '</p>'
      + '<p>' + esc_(a.message) + '</p>'
      + (a.kind === 'LWD'
          ? '<p>Last working day: <strong>' + (a.date ? Utilities.formatDate(a.date, Session.getScriptTimeZone(), 'd MMM yyyy') : '—') + '</strong> (' + a.daysFromNow + ' days)</p>'
          : '<p>Confirmation due: <strong>' + (a.date ? Utilities.formatDate(a.date, Session.getScriptTimeZone(), 'd MMM yyyy') : '—') + '</strong> (' + a.daysFromNow + ' days)</p>')
      + '<p style="color:#71717A;font-size:12px;margin-top:24px;">Sent automatically by Techolution HR Automation.</p>'
      + '</div>';
  }
  function esc_(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
})(AlertEmails);
