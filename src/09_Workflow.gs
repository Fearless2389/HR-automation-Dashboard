/**
 * 09_Workflow.gs — onEdit-driven workflow engine.
 *
 * When HR picks an action from the `Action` dropdown on India/US Employee tabs,
 * the engine:
 *   1. Verifies the row is a real employee (via canonical empId lookup).
 *   2. Checks idempotency via Action Status column + ScriptProperty marker.
 *      If already executed → reverts dropdown to '—', toasts, and exits.
 *   3. Acquires a document lock.
 *   4. Looks up the email template and dispatches it.
 *   5. Stamps Action Status='Done', Action By=actor, Action At=now.
 *   6. Sets the ScriptProperty marker so a future re-pick is a no-op.
 *   7. Logs + releases lock.
 *
 * All sheet writes go through `withSilentWrite` so the rebuild trigger
 * doesn't loop on its own stamps.
 *
 * Public API (called from Triggers, Web App):
 *   Workflow.handleEdit(e)             — onEdit-installable entry
 *   Workflow.runFromWebApp(action, empId) — Web App "Run Action" button
 *   Workflow.isAlreadyExecuted(rowKey) → boolean (test hook)
 */

var Workflow = Workflow || {};

(function (ns) {
  /**
   * Map dropdown choice → email template key.
   */
  var ACTION_TEMPLATES = {
    'Start Offboarding':    'offboarding.start',
    'Schedule PIP':         'pip.scheduled',
    'Approve Confirmation': 'confirmation.approved'
  };

  ns.handleEdit = function (e) {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var tabName = sh.getName();
    if (tabName !== Config.canonicalToTabName('india') && tabName !== Config.canonicalToTabName('us')) return;
    if (e.range.getRow() < 2) return;

    var newValue = String(e.value || '').trim();
    if (!newValue || newValue === '—') return;
    if (!ACTION_TEMPLATES.hasOwnProperty(newValue)) return; // unknown action

    var tabKey = (tabName === Config.canonicalToTabName('india')) ? 'india' : 'us';
    var rowNum = e.range.getRow();
    var actor = '';
    try { actor = Session.getActiveUser().getEmail() || ''; } catch (err) { actor = ''; }

    executeAction_(sh, tabKey, rowNum, newValue, actor, 'onEdit');
  };

  ns.runFromWebApp = function (action, empId) {
    if (!ACTION_TEMPLATES.hasOwnProperty(action)) return { ok: false, message: 'Unknown action: ' + action };
    var emp = findEmployeeRow_(empId);
    if (!emp) return { ok: false, message: 'Employee ' + empId + ' not found' };
    var actor = '';
    try { actor = Session.getActiveUser().getEmail() || ''; } catch (err) { actor = ''; }
    return executeAction_(emp.sheet, emp.tabKey, emp.rowNum, action, actor, 'webapp');
  };

  ns.isAlreadyExecuted = function (rowKey) {
    return !!PropertiesService.getScriptProperties().getProperty('wf:done:' + rowKey);
  };

  // ───────── internals ─────────

  function executeAction_(sh, tabKey, rowNum, action, actor, source) {
    var runId = Log.start('Workflow.' + canonicalAction_(action), source);
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(5000)) {
      Log.error(runId, 'Could not acquire document lock');
      Log.end(runId, { status: 'FAIL' });
      return { ok: false, message: 'System busy — try again' };
    }

    try {
      // Read row via canonical headers
      var headerMap = Header.resolve(sh, tabKey);
      var empIdCol = headerMap.empId;
      if (typeof empIdCol !== 'number') {
        throw new Error('Could not resolve empId column on ' + sh.getName());
      }
      var emp = readEmployeeRow_(sh, tabKey, rowNum);
      if (!emp.empId) {
        throw new Error('No empId in row ' + rowNum);
      }

      var rowKey = emp.empId + ':' + canonicalAction_(action);

      // Idempotency check.
      if (ns.isAlreadyExecuted(rowKey) || stampAlreadySet_(sh, rowNum)) {
        Log.warn(runId, 'Duplicate action attempt', { empId: emp.empId, action: action });
        // Revert dropdown back to '—' to make the no-op explicit in the UI.
        withSilentWrite(function () {
          var actionColIdx = Header.rawHeaders(sh).indexOf('Action');
          if (actionColIdx >= 0) sh.getRange(rowNum, actionColIdx + 1).setValue('—');
        });
        SpreadsheetApp.getActive().toast(action + ' already executed for ' + emp.empId, 'HR Automation', 5);
        Log.end(runId, { status: 'OK', duplicate: true });
        return { ok: false, message: 'Action already executed for ' + emp.empId };
      }

      // Send email
      var templateKey = ACTION_TEMPLATES[action];
      var data = {
        empId: emp.empId,
        empName: emp.name,
        dept: emp.dept,
        designation: emp.designation,
        rm: emp.rm,
        doj: emp.doj ? Utilities.formatDate(emp.doj, Session.getScriptTimeZone(), 'd MMM yyyy') : '',
        actorName: actor || 'HR Team',
        actor: actor
      };
      var recipient = Config.emailDigestRecipient(); // HR mailbox by default
      var emailResult = Email.send(templateKey, data, recipient);
      if (!emailResult.ok) {
        Log.warn(runId, 'Email failed but continuing to stamp', emailResult);
      }

      // Stamp the row.
      withSilentWrite(function () {
        var headers = Header.rawHeaders(sh);
        var statusCol = headers.indexOf('Action Status');
        var byCol = headers.indexOf('Action By');
        var atCol = headers.indexOf('Action At');
        if (statusCol >= 0) sh.getRange(rowNum, statusCol + 1).setValue('Done');
        if (byCol >= 0) sh.getRange(rowNum, byCol + 1).setValue(actor || 'HR');
        if (atCol >= 0) sh.getRange(rowNum, atCol + 1).setValue(new Date());
      });

      // Set idempotency marker.
      PropertiesService.getScriptProperties().setProperty('wf:done:' + rowKey, runId);

      Log.info(runId, 'Action executed', { empId: emp.empId, action: action, emailOk: emailResult.ok });
      Log.end(runId, { status: 'OK' });
      SpreadsheetApp.getActive().toast(action + ' triggered for ' + emp.name + ' (' + emp.empId + ')', 'HR Automation', 6);
      return { ok: true, message: action + ' executed for ' + emp.empId };

    } catch (err) {
      Log.error(runId, 'executeAction_ failed: ' + err.message, { stack: err.stack });
      Log.end(runId, { status: 'FAIL' });
      SpreadsheetApp.getActive().toast('Action failed: ' + err.message, 'HR Automation', 8);
      return { ok: false, message: err.message };
    } finally {
      lock.releaseLock();
    }
  }

  function readEmployeeRow_(sh, tabKey, rowNum) {
    var headerMap = Header.resolve(sh, tabKey);
    var lastCol = sh.getLastColumn();
    var rowValues = sh.getRange(rowNum, 1, 1, lastCol).getValues()[0];
    var emp = {};
    Object.keys(headerMap).forEach(function (canonical) {
      emp[canonical] = rowValues[headerMap[canonical]];
    });
    emp.empId = String(emp.empId || '').trim();
    emp.name = String(emp.name || '').trim();
    if (emp.doj && !(emp.doj instanceof Date)) emp.doj = new Date(emp.doj);
    return emp;
  }

  function stampAlreadySet_(sh, rowNum) {
    var headers = Header.rawHeaders(sh);
    var statusCol = headers.indexOf('Action Status');
    if (statusCol < 0) return false;
    var stamp = sh.getRange(rowNum, statusCol + 1).getValue();
    return String(stamp || '').trim() === 'Done';
  }

  function findEmployeeRow_(empId) {
    var key = String(empId).trim();
    var tabs = [
      { key: 'india', name: Config.canonicalToTabName('india') },
      { key: 'us', name: Config.canonicalToTabName('us') }
    ];
    for (var i = 0; i < tabs.length; i++) {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabs[i].name);
      if (!sh) continue;
      var rows = Header.rows(sh, tabs[i].key);
      for (var j = 0; j < rows.length; j++) {
        if (String(rows[j].empId).trim() === key) {
          return { sheet: sh, tabKey: tabs[i].key, rowNum: rows[j].__rowNum };
        }
      }
    }
    return null;
  }

  function canonicalAction_(label) {
    return label.replace(/\s+/g, '_').toLowerCase();
  }
})(Workflow);
