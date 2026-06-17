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

  function coerceVal_(v) {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch (_) { return String(v); }
    }
    return String(v);
  }

  ns.record = function (entry) {
    try {
      if (!entry) return; // nothing to record
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(TAB_NAME);
      if (!sh) return; // tab not created yet — skip silently
      var actor;
      try { actor = Session.getActiveUser().getEmail() || 'anonymous'; } catch (e) { actor = 'anonymous'; }
      var row = [
        new Date(),
        actor,
        String(entry.op || ''),
        String(entry.empId || ''),
        String(entry.field || ''),
        coerceVal_(entry.oldVal),
        coerceVal_(entry.newVal),
        String(entry.runId || '')
      ];
      sh.appendRow(row);
    } catch (e) {
      // Never throw from audit log — it must not break the write itself.
      // Use console.warn so we don't leak an unclosed Log run on failure paths.
      try { console.warn('AuditLog.record failed: ' + (e && e.message)); } catch (_) {}
    }
  };

  /**
   * Record many field changes from a single update at once.
   * `changes` is an array of { field, oldVal, newVal }.
   * Note: positional args (unlike record() which takes an object).
   * Wraps each iteration in record's own try/catch via delegation; sparse/null
   * elements in `changes` are skipped to preserve the never-throw contract.
   */
  ns.recordMany = function (op, empId, changes, runId) {
    if (!Array.isArray(changes) || changes.length === 0) return;
    changes.forEach(function (c) {
      if (!c) return;
      ns.record({ op: op, empId: empId, field: c.field, oldVal: c.oldVal, newVal: c.newVal, runId: runId });
    });
  };
})(AuditLog);
