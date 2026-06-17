/**
 * 21_AuditLog.gs — HR-facing audit log of all web-app writes.
 *
 * Append-only. One row per field changed in an update; one row for add/offboard.
 *
 * Public API:
 *   AuditLog.record({op, empId, field, oldVal, newVal, runId})
 */

var AuditLog = AuditLog || {};

(function (ns) {
  var TAB_NAME = 'Audit Log';

  ns.record = function (entry) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(TAB_NAME);
      if (!sh) return; // tab not created yet — skip silently
      var actor;
      try { actor = Session.getActiveUser().getEmail() || 'anonymous'; } catch (e) { actor = 'anonymous'; }
      var ts = new Date();
      var row = [
        ts,
        actor,
        String(entry.op || ''),
        String(entry.empId || ''),
        String(entry.field || ''),
        entry.oldVal == null ? '' : (entry.oldVal instanceof Date ? entry.oldVal.toISOString() : String(entry.oldVal)),
        entry.newVal == null ? '' : (entry.newVal instanceof Date ? entry.newVal.toISOString() : String(entry.newVal)),
        String(entry.runId || '')
      ];
      sh.appendRow(row);
    } catch (e) {
      // Never throw from audit log — it must not break the write itself.
      try { Log.warn(Log.start('AuditLog.record', 'internal'), 'audit append failed: ' + e.message); } catch (_) {}
    }
  };

  /**
   * Record many field changes from a single update at once.
   * `changes` is an array of { field, oldVal, newVal }.
   */
  ns.recordMany = function (op, empId, changes, runId) {
    if (!Array.isArray(changes) || changes.length === 0) return;
    changes.forEach(function (c) {
      ns.record({ op: op, empId: empId, field: c.field, oldVal: c.oldVal, newVal: c.newVal, runId: runId });
    });
  };
})(AuditLog);
