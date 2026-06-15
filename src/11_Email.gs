/**
 * 11_Email.gs — Templated email send + daily digest.
 *
 * Templates live in the `_Templates` tab. `{{placeholder}}` substitution is
 * applied to both Subject and HtmlBody. Quota usage is tracked via MailApp's
 * remaining-quota counter; the daily digest is a no-op when no alerts are active
 * (per brief §4.4 "no email if nothing fires").
 *
 * Public API:
 *   Email.send(templateKey, data, to)  → { ok, remainingQuota, message }
 *   Email.quotaLeft()                  → number
 *   Email.sendDailyDigest()            → { ok, sent, reason }
 *   Email.previewTemplate(key, data)   → { subject, htmlBody }
 */

var Email = Email || {};

(function (ns) {
  var TEMPLATES_TAB = '_Templates';
  var QUOTA_WARN_THRESHOLD = 30;
  var QUOTA_CRITICAL_THRESHOLD = 10;

  ns.send = function (templateKey, data, to) {
    var runId = Log.start('Email.send', 'workflow');
    try {
      if (!templateKey) return failResult_('Missing templateKey');
      var tpl = ns.getTemplate(templateKey);
      if (!tpl) return failResult_('Template "' + templateKey + '" not found in _Templates tab');
      if (!to) return failResult_('No recipient (to)');

      var subject = substitute_(tpl.subject, data || {});
      var htmlBody = substitute_(tpl.htmlBody, data || {});

      // Demo mode: log the would-send payload and return ok WITHOUT dispatching.
      // Active during the assignment review period so we don't email real inboxes.
      if (Config.isDemoMode && Config.isDemoMode()) {
        Log.info(runId, 'Demo mode — email NOT sent', {
          template: templateKey, to: to, subject: subject, demoMode: true
        });
        Log.end(runId, { status: 'OK', sent: 0, demoMode: true });
        return { ok: true, remainingQuota: ns.quotaLeft(), message: 'Demo mode — not dispatched' };
      }

      var quota = ns.quotaLeft();
      if (quota < QUOTA_CRITICAL_THRESHOLD) {
        Log.error(runId, 'Mail quota critical (' + quota + ') — skipping send', { template: templateKey, to: to });
        Log.end(runId, { status: 'FAIL' });
        return { ok: false, remainingQuota: quota, message: 'Mail quota too low' };
      }

      MailApp.sendEmail({
        to: to,
        subject: subject,
        htmlBody: htmlBody,
        name: 'Techolution HR Automation'
      });

      var afterQuota = ns.quotaLeft();
      Log.info(runId, 'Email sent', { template: templateKey, to: to, subject: subject, remainingQuota: afterQuota });
      if (afterQuota < QUOTA_WARN_THRESHOLD) Log.warn(runId, 'Mail quota low: ' + afterQuota);
      Log.end(runId, { remainingQuota: afterQuota });
      return { ok: true, remainingQuota: afterQuota, message: 'Sent' };
    } catch (e) {
      Log.error(runId, 'Email.send failed: ' + e.message, { template: templateKey, to: to, stack: e.stack });
      Log.end(runId, { status: 'FAIL' });
      return { ok: false, remainingQuota: ns.quotaLeft(), message: e.message };
    }
  };

  ns.quotaLeft = function () {
    try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; }
  };

  ns.getTemplate = function (key) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TEMPLATES_TAB);
    if (!sh) return null;
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return null;
    var values = sh.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]).trim() === key) {
        return { subject: String(values[i][1] || ''), htmlBody: String(values[i][2] || '') };
      }
    }
    return null;
  };

  ns.previewTemplate = function (key, data) {
    var tpl = ns.getTemplate(key);
    if (!tpl) return null;
    return { subject: substitute_(tpl.subject, data || {}), htmlBody: substitute_(tpl.htmlBody, data || {}) };
  };

  /**
   * Daily digest — sent at the cron hour configured in _Config. No email if
   * no alerts are active.
   */
  ns.sendDailyDigest = function () {
    var runId = Log.start('sendDailyDigest', 'onSchedule');
    try {
      var lwd = Alerts.lwdWithin();
      var prob = Alerts.probationDue();
      if (lwd.length === 0 && prob.length === 0) {
        Log.info(runId, 'No active alerts — daily digest skipped per spec');
        Log.end(runId, { sent: 0 });
        return { ok: true, sent: 0, reason: 'no alerts' };
      }

      var to = Config.emailDigestRecipient();
      if (!to) {
        Log.warn(runId, 'No digest recipient configured');
        Log.end(runId, { sent: 0, reason: 'no recipient' });
        return { ok: false, sent: 0, reason: 'no recipient' };
      }

      var lwdDays = Config.threshold('lwdAlertDays');
      var probDays = Config.threshold('probationConfirmDays');
      var data = {
        date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy'),
        lwdDays: lwdDays,
        probDays: probDays,
        lwdTable: buildAlertTable_(lwd, ['Emp ID', 'Name', 'Dept', 'LWD', 'Days']),
        probTable: buildAlertTable_(prob, ['Emp ID', 'Name', 'Dept', 'Confirmation Due', 'Days'])
      };

      var result = ns.send('alert.lwdDigest', data, to);
      Log.end(runId, { sent: result.ok ? 1 : 0, recipient: to });
      return { ok: result.ok, sent: result.ok ? 1 : 0, reason: result.message };
    } catch (e) {
      Log.error(runId, 'sendDailyDigest failed: ' + e.message, { stack: e.stack });
      Log.end(runId, { status: 'FAIL' });
      return { ok: false, sent: 0, reason: e.message };
    }
  };

  // ───────── internals ─────────

  function substitute_(template, data) {
    return String(template || '').replace(/\{\{(\w+)\}\}/g, function (match, key) {
      return data.hasOwnProperty(key) && data[key] !== null && data[key] !== undefined ? String(data[key]) : '';
    });
  }

  function buildAlertTable_(alerts, headers) {
    if (!alerts || !alerts.length) return '<p style="color:#71717A;font-style:italic;">None.</p>';
    var html = '<table style="border-collapse:collapse;width:100%;font-family:Inter,Arial,sans-serif;font-size:13px;margin:8px 0;">';
    html += '<thead><tr>';
    headers.forEach(function (h) {
      html += '<th style="text-align:left;padding:6px 10px;background:#F4F4F5;border-bottom:1px solid #E4E4E7;font-weight:600;color:#52525B;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">' + h + '</th>';
    });
    html += '</tr></thead><tbody>';
    alerts.forEach(function (a) {
      var cells;
      if (a.kind === 'LWD') {
        cells = [a.empId, a.name, a.dept, fmtDateForEmail_(a.date), a.daysFromNow];
      } else {
        cells = [a.empId, a.name, a.dept, fmtDateForEmail_(a.date), a.daysFromNow];
      }
      html += '<tr>';
      cells.forEach(function (c) {
        html += '<td style="padding:6px 10px;border-bottom:1px solid #F4F4F5;color:#18181B;">' + (c === null || c === undefined ? '' : c) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function fmtDateForEmail_(d) {
    if (!d) return '';
    if (!(d instanceof Date)) return String(d);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM yyyy');
  }

  function failResult_(message) {
    return { ok: false, remainingQuota: ns.quotaLeft(), message: message };
  }
})(Email);
