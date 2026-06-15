/**
 * 10_Triggers.gs — Installable onEdit + time-based pulse + trigger management.
 *
 * Real-time reflection mechanics:
 *
 *   1. HR edits a source tab → installable `onEditInstallable` fires.
 *   2. Edit gets classified:
 *        - Action column        → Workflow.handleEdit (no dashboard rebuild)
 *        - Drill-Down filter    → applyDrilldown (no dashboard rebuild)
 *        - Reporting Manager    → bust data + rebuild + republish org chart
 *        - _Config              → bust config + bust data + rebuild
 *        - Source tab payload   → bust data + rebuild
 *        - Helper/dashboard tab → ignore (would loop)
 *        - silent write flag set → ignore (rebuild's own writes)
 *   3. The rebuild is debounced via burst-coalescing: first onEdit acquires a
 *      script lock, then polls until 1.5s have passed since the last edit, then
 *      rebuilds. Subsequent edits during this window just update `lastEditTs`.
 *   4. Circuit breaker: if more than 20 rebuilds fire in 60s, the trigger logs
 *      CRITICAL and stops triggering rebuilds for 5 minutes. Better to fail
 *      loudly than burn through quota.
 *
 * Public API:
 *   Triggers.installAll()
 *   Triggers.uninstallAll()
 *
 * Trigger entry points (called by Apps Script runtime, NOT from code):
 *   onEditInstallable(e)
 *   onSchedulePulse()
 *   dailyDigest()
 */

var Triggers = Triggers || {};

(function (ns) {
  var HANDLER_FNS = ['onEditInstallable', 'onSchedulePulse', 'dailyDigest'];

  ns.installAll = function () {
    ns.uninstallAll();
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Installable onEdit (gives us full permissions; simple onEdit can't email)
    ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();

    // 5-minute pulse for SelfMonitor + cache warm
    ScriptApp.newTrigger('onSchedulePulse').timeBased().everyMinutes(5).create();

    // Daily digest at configured hour — SKIPPED in demo mode so we don't
    // schedule a recurring email job during the assignment review period.
    if (Config.isDemoMode && Config.isDemoMode()) {
      Log.info(Log.start('Triggers.installAll', 'manual'), 'Demo mode active — dailyDigest trigger NOT installed');
    } else {
      var hour = Config.emailDigestCronHour();
      if (typeof hour === 'number' && hour >= 0 && hour <= 23) {
        ScriptApp.newTrigger('dailyDigest').timeBased().atHour(hour).everyDays(1).create();
      }
    }
  };

  ns.uninstallAll = function () {
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function (t) {
      if (HANDLER_FNS.indexOf(t.getHandlerFunction()) !== -1) {
        ScriptApp.deleteTrigger(t);
      }
    });
  };

  /**
   * Surgically removes ONLY the dailyDigest trigger. Use this to stop the
   * recurring email job without touching onEditInstallable / onSchedulePulse
   * (which power the live dashboard reflection — those must stay alive).
   * Returns the count of triggers removed.
   */
  ns.uninstallDailyDigest = function () {
    var removed = 0;
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function (t) {
      if (t.getHandlerFunction() === 'dailyDigest') {
        ScriptApp.deleteTrigger(t);
        removed++;
      }
    });
    return removed;
  };
})(Triggers);

// ──────────────────────────────────────────────────────────────────────────
// Installable onEdit
// ──────────────────────────────────────────────────────────────────────────

/** Tabs whose edits should never trigger a dashboard rebuild (would loop). */
var HANDLER_BLOCKED_TABS = ['Dashboard', 'Logs', 'Changelog', 'QA', 'Org Chart', '_Templates'];

function onEditInstallable(e) {
  // Reentrancy guard: skip rebuild's own writes.
  if (isSilentWrite_()) return;
  if (!e || !e.range) return;

  var sh = e.range.getSheet();
  var tabName = sh.getName();

  // Special tab: Drill-Down filter row → re-apply filters (no rebuild).
  if (tabName === 'Drill-Down') {
    if (e.range.getRow() === 3 && e.range.getColumn() >= 1 && e.range.getColumn() <= 4) {
      withSilentWrite(function () { applyDrilldown(); });
    }
    return;
  }

  // Skip rebuild-only tabs.
  if (HANDLER_BLOCKED_TABS.indexOf(tabName) !== -1) return;

  // _Config edits: bust config + data caches + rebuild.
  if (tabName === '_Config') {
    Config.bust();
    Data.bustAll();
    scheduleRebuild_('onEdit');
    return;
  }

  // Action-column edit on employee tabs?
  if (isEmployeeTab_(tabName) && isActionColumnEdit_(sh, e.range)) {
    if (typeof Workflow !== 'undefined' && Workflow.handleEdit) {
      try { Workflow.handleEdit(e); }
      catch (err) { Log.error(Log.start('Workflow.handleEdit', 'onEdit'), err.message, { stack: err.stack }); }
    }
    return;
  }

  // Reporting Manager column change → bust data + republish org chart.
  var isRmEdit = false;
  if (isEmployeeTab_(tabName)) {
    try {
      var tabKey = tabKeyForName_(tabName);
      var rmCol = Header.col(sh, tabKey, 'rm') + 1; // 1-based
      if (e.range.getColumn() === rmCol) isRmEdit = true;
    } catch (err) { /* unresolved — ignore */ }
  }

  Data.bustAll();
  scheduleRebuild_('onEdit', { rmChanged: isRmEdit });
}

function isActionColumnEdit_(sh, range) {
  try {
    var headers = Header.rawHeaders(sh);
    var actionCol = headers.indexOf('Action');
    if (actionCol === -1) return false;
    if (range.getColumn() !== actionCol + 1) return false;
    if (range.getRow() < 2) return false;
    return true;
  } catch (err) { return false; }
}

function isEmployeeTab_(name) {
  return name === Config.canonicalToTabName('india') || name === Config.canonicalToTabName('us');
}

function tabKeyForName_(name) {
  if (name === Config.canonicalToTabName('india')) return 'india';
  if (name === Config.canonicalToTabName('us')) return 'us';
  if (name === Config.canonicalToTabName('rm')) return 'rm';
  if (name === Config.canonicalToTabName('finance')) return 'finance';
  if (name === Config.canonicalToTabName('offboarded')) return 'offboarded';
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Debounced rebuild
// ──────────────────────────────────────────────────────────────────────────

var REBUILD_DEBOUNCE_MS = 1500;
var REBUILD_MAX_WAIT_MS = 8000;
var REBUILD_POLL_MS = 400;
var CIRCUIT_BREAKER_LIMIT = 20;
var CIRCUIT_BREAKER_WINDOW_S = 60;
var CIRCUIT_BREAKER_COOLDOWN_S = 300;

/**
 * Burst-coalescing debounce. The first onEdit in a burst acquires the lock and
 * polls until edits settle; subsequent edits just keep updating lastEditTs.
 */
function scheduleRebuild_(triggerSource, opts) {
  var c = CacheService.getScriptCache();
  c.put('rebuild:lastEditTs', String(Date.now()), 90);

  // Circuit breaker check
  if (isCircuitTripped_()) {
    return; // already failing loudly; don't pile on
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return; // someone else owns the rebuild

  try {
    // Poll until the burst settles.
    var started = Date.now();
    while ((Date.now() - started) < REBUILD_MAX_WAIT_MS) {
      Utilities.sleep(REBUILD_POLL_MS);
      var lastTs = parseInt(c.get('rebuild:lastEditTs') || '0', 10);
      if (Date.now() - lastTs >= REBUILD_DEBOUNCE_MS) break;
    }

    // Increment the rebuild counter; if over limit, trip the breaker.
    if (incrementRebuildCounter_() > CIRCUIT_BREAKER_LIMIT) {
      tripCircuit_();
      return;
    }

    rebuildDashboard(triggerSource);
  } catch (err) {
    var runId = Log.start('scheduleRebuild_', triggerSource);
    Log.error(runId, 'scheduleRebuild_ failed: ' + err.message, { stack: err.stack });
    Log.end(runId, { status: 'FAIL' });
  } finally {
    lock.releaseLock();
  }
}

function incrementRebuildCounter_() {
  var c = CacheService.getScriptCache();
  var count = parseInt(c.get('rebuild:count60s') || '0', 10) + 1;
  c.put('rebuild:count60s', String(count), CIRCUIT_BREAKER_WINDOW_S);
  return count;
}

function isCircuitTripped_() {
  return !!PropertiesService.getScriptProperties().getProperty('circuit:tripped');
}

function tripCircuit_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('circuit:tripped', String(Date.now()));
  var runId = Log.start('circuitBreaker', 'system');
  Log.error(runId, 'Circuit breaker TRIPPED — more than ' + CIRCUIT_BREAKER_LIMIT + ' rebuilds in ' + CIRCUIT_BREAKER_WINDOW_S + 's. Rebuilds suppressed for ' + CIRCUIT_BREAKER_COOLDOWN_S + 's.');
  Log.end(runId, { status: 'FAIL' });
  // Schedule auto-reset
  Utilities.sleep(50);
  ScriptApp.newTrigger('circuitBreakerReset_').timeBased().after(CIRCUIT_BREAKER_COOLDOWN_S * 1000).create();
}

function circuitBreakerReset_() {
  PropertiesService.getScriptProperties().deleteProperty('circuit:tripped');
  var runId = Log.start('circuitBreakerReset_', 'system');
  Log.info(runId, 'Circuit breaker reset; rebuilds re-enabled.');
  Log.end(runId, {});
  // Delete this one-shot trigger
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'circuitBreakerReset_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 5-minute pulse — self-monitoring + cache warm
// ──────────────────────────────────────────────────────────────────────────

function onSchedulePulse() {
  var runId = Log.start('onSchedulePulse', 'onSchedule');
  try {
    PropertiesService.getScriptProperties().setProperty('lastPulseAt', String(Date.now()));

    if (typeof SelfMonitor !== 'undefined' && SelfMonitor.checkAll) {
      try {
        var issues = SelfMonitor.checkAll();
        if (issues.length) Log.warn(runId, 'SelfMonitor found ' + issues.length + ' issue(s)', { issues: issues });
      } catch (err) {
        Log.warn(runId, 'SelfMonitor failed: ' + err.message);
      }
    }

    // Warm the snapshot cache so web app polls hit cache.
    if (typeof api_snapshot === 'function') {
      try { api_snapshot(); }
      catch (err) { Log.warn(runId, 'api_snapshot warm failed: ' + err.message); }
    }

    Log.end(runId, { status: 'OK' });
  } catch (e) {
    Log.error(runId, 'onSchedulePulse failed: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Daily digest entry — implementation lives in 11_Email.gs (Phase 6).
// Stubbed here so the trigger can be installed before Phase 6 ships.
// ──────────────────────────────────────────────────────────────────────────

function dailyDigest() {
  var runId = Log.start('dailyDigest', 'onSchedule');
  try {
    if (typeof Email !== 'undefined' && Email.sendDailyDigest) {
      var result = Email.sendDailyDigest();
      Log.info(runId, 'Daily digest sent', result);
    } else {
      Log.warn(runId, 'Email.sendDailyDigest not yet defined — skipping');
    }
    Log.end(runId, { status: 'OK' });
  } catch (e) {
    Log.error(runId, 'dailyDigest failed: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
  }
}
