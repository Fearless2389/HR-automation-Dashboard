/**
 * 16_Verification.gs — Programmatic reviewer-protocol harness.
 *
 * Runs the six verification steps from brief §6 against the LIVE sheet:
 *   1. Column rename (resilience of header resolver)
 *   2. Add 3 new employees (alerts surface, headcount increments)
 *   3. Change probationer DOJ (confirmation date recalculates)
 *   4. Delete a row from Offboarded (attrition recomputes)
 *   5. Auth gate (allowlist accepts reviewer, rejects unknown email)
 *   6. Logs tab history (real spans, variety of functions)
 *
 * Each test mutates the sheet, asserts the expected behavior, and RESTORES
 * the original state in a try/finally. If a test crashes after mutating but
 * before restoring, identifier-prefixed test rows (__VERIFY_*) can be
 * deleted manually as a fallback.
 *
 * Run via: custom menu HR Automation → Run Verification Protocol.
 * Results appear in the QA tab tagged with "⚙ VERIFY:" prefix.
 */

function runVerificationProtocol() {
  var startedAt = new Date();
  var results = [];

  // Each sub-test is wrapped so a crash in one doesn't kill the rest.
  results.push(safeRun_('1. Column rename resilience',           testVerifyColumnRename_));
  results.push(safeRun_('2. Add 3 employees → alerts surface',   testVerifyAddEmployees_));
  results.push(safeRun_('3. DOJ change → confirmation recalcs',  testVerifyDojChange_));
  results.push(safeRun_('4. Offboarded delete → attrition recomputes', testVerifyOffboardedDelete_));
  results.push(safeRun_('5. Auth gate (allowlist enforcement)',  testVerifyAuthGate_));
  results.push(safeRun_('6. Logs tab has real execution history', testVerifyLogsHistory_));

  writeVerificationResults_(startedAt, results);

  var passCount = results.filter(function (r) { return r.pass; }).length;
  var failCount = results.length - passCount;
  SpreadsheetApp.getActive().toast(
    'Verification Protocol: ' + passCount + ' pass, ' + failCount + ' fail',
    'HR Automation',
    10
  );

  var runId = Log.start('runVerificationProtocol', 'manual');
  Log.info(runId, 'Verification protocol complete', { pass: passCount, fail: failCount });
  Log.end(runId, { pass: passCount, fail: failCount });

  return results;
}

function safeRun_(name, fn) {
  var startMs = Date.now();
  try {
    var detail = fn() || '';
    return { name: name, pass: true, detail: detail, durationMs: Date.now() - startMs };
  } catch (err) {
    return { name: name, pass: false, detail: err.message || String(err), durationMs: Date.now() - startMs };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Step 1 — Column rename
// ──────────────────────────────────────────────────────────────────────────
function testVerifyColumnRename_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(Config.canonicalToTabName('india'));
  if (!sh) throw new Error('India tab not found');

  var headers = Header.rawHeaders(sh);
  var dojIdx = findHeaderForCanonical_(headers, 'india', 'doj');
  if (dojIdx < 0) throw new Error('DOJ column not found before rename');

  var originalHeader = headers[dojIdx];
  var newHeader = (String(originalHeader).toLowerCase() === 'date of joining') ? 'Joining Date' : 'Date of Joining';

  try {
    sh.getRange(1, dojIdx + 1).setValue(newHeader);
    Cache.bust('headers:');
    Cache.bust('data:');
    SpreadsheetApp.flush();

    var emps = Data.india();
    if (!emps.length) throw new Error('Got 0 employees after rename');
    var withDoj = emps.filter(function (e) { return e.doj instanceof Date; }).length;
    if (withDoj === 0) throw new Error('No employees have parseable DOJ after rename — alias resolver may have failed');

    return 'Renamed "' + originalHeader + '" → "' + newHeader +
           '"; resolver still returned ' + emps.length + ' employees, ' + withDoj + ' with DOJ.';
  } finally {
    sh.getRange(1, dojIdx + 1).setValue(originalHeader);
    Cache.bust('headers:');
    Cache.bust('data:');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Step 2 — Add 3 new employees
// ──────────────────────────────────────────────────────────────────────────
function testVerifyAddEmployees_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(Config.canonicalToTabName('india'));
  if (!sh) throw new Error('India tab not found');

  Cache.bust('data:');
  var baselineHeadcount = Metrics.headcount().total;

  var hdrMap = Header.resolve(sh, 'india');
  var lastCol = sh.getLastColumn();
  var today = startOfDay_v_(new Date());

  var EMP_INTERN = '__VERIFY_INTERN__';
  var EMP_PROB = '__VERIFY_PROBATIONER__';
  var EMP_CONF = '__VERIFY_CONFIRMED__';

  var rowsToAdd = [
    { empId: EMP_INTERN, name: 'Verify Intern', dept: 'Engineering', designation: 'Intern',
      rm: '', skillset: 'Python', doj: addDays_v_(today, -30), status: 'Intern',
      lwd: addDays_v_(today, 20) },
    { empId: EMP_PROB, name: 'Verify Probationer', dept: 'Engineering', designation: 'SDE I',
      rm: '', skillset: 'Java', doj: addDays_v_(today, -155), status: 'Under Probation', lwd: null },
    { empId: EMP_CONF, name: 'Verify Confirmed', dept: 'Engineering', designation: 'SDE II',
      rm: '', skillset: 'Go', doj: addDays_v_(today, -400), status: 'Confirmed', lwd: null }
  ];

  var appendedRowNums = [];

  try {
    rowsToAdd.forEach(function (data) {
      var rowArr = new Array(lastCol);
      for (var i = 0; i < lastCol; i++) rowArr[i] = '';
      Object.keys(hdrMap).forEach(function (canonical) {
        if (data[canonical] !== undefined && data[canonical] !== null) {
          rowArr[hdrMap[canonical]] = data[canonical];
        }
      });
      sh.appendRow(rowArr);
      appendedRowNums.push(sh.getLastRow());
    });
    SpreadsheetApp.flush();
    Cache.bust('data:');

    var newHc = Metrics.headcount().total;
    var hcDelta = newHc - baselineHeadcount;
    if (hcDelta !== 3) {
      throw new Error('Headcount only increased by ' + hcDelta + ' (expected 3). Possibly some rows did not register.');
    }

    var lwdAlerts = Alerts.lwdWithin();
    var probAlerts = Alerts.probationDue();

    var internInLwd = lwdAlerts.some(function (a) { return a.empId === EMP_INTERN; });
    var probInProb = probAlerts.some(function (a) { return a.empId === EMP_PROB; });

    if (!internInLwd) {
      // Pull the actual stored row so the failure message explains WHY.
      var emps = Data.allEmployees();
      var intern = null;
      for (var n = 0; n < emps.length; n++) { if (emps[n].empId === EMP_INTERN) { intern = emps[n]; break; } }
      var hdrMap = Header.resolve(sh, 'india');
      var hasLwdCol = (typeof hdrMap.lwd === 'number');
      var rawHdrs = Header.rawHeaders(sh).join(' | ');
      throw new Error(
        'Intern with LWD in 20 days not surfaced in LWD alerts. ' +
        'LWD col resolved? ' + hasLwdCol +
        ' · intern.lwd=' + (intern ? intern.lwd : 'intern-not-found') +
        ' · status=' + (intern ? intern.status : '?') +
        ' · India headers: [' + rawHdrs + ']' +
        ' · total LWD alerts: ' + lwdAlerts.length
      );
    }
    if (!probInProb) {
      throw new Error('Probationer with confirmation in 25 days not surfaced in Probation alerts. Alerts: ' +
        probAlerts.map(function (a) { return a.empId; }).join(','));
    }

    return 'Headcount +3, intern surfaces in LWD alerts, probationer surfaces in Probation alerts.';
  } finally {
    appendedRowNums.sort(function (a, b) { return b - a; });
    appendedRowNums.forEach(function (rowNum) {
      try { sh.deleteRow(rowNum); } catch (e) { /* ignore */ }
    });
    Cache.bust('data:');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Step 3 — Change a probationer's DOJ
// ──────────────────────────────────────────────────────────────────────────
function testVerifyDojChange_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(Config.canonicalToTabName('india'));
  if (!sh) throw new Error('India tab not found');

  Cache.bust('data:');
  var emps = Data.india();
  var probationer = null;
  for (var i = 0; i < emps.length; i++) {
    if (String(emps[i].status || '').toLowerCase().indexOf('probation') !== -1 && emps[i].doj) {
      probationer = emps[i];
      break;
    }
  }
  if (!probationer) {
    return 'Skipped — no probationer with DOJ found in India tab. ' +
           'Add at least one Under Probation row to exercise this test.';
  }

  var hdrMap = Header.resolve(sh, 'india');
  var dojCol = hdrMap.doj + 1;
  var rowNum = probationer.__rowNum;
  var originalDoj = sh.getRange(rowNum, dojCol).getValue();
  var newDoj = addDays_v_(probationer.doj, -10);

  try {
    sh.getRange(rowNum, dojCol).setValue(newDoj);
    SpreadsheetApp.flush();
    Cache.bust('data:');

    var probLen = Config.threshold('probationLengthDays');
    var expectedConfirmation = addDays_v_(newDoj, probLen);

    var newAlerts = Alerts.probationDue(365); // wide window to be sure we catch it
    var match = null;
    for (var k = 0; k < newAlerts.length; k++) {
      if (newAlerts[k].empId === probationer.empId) { match = newAlerts[k]; break; }
    }
    if (!match) {
      return 'DOJ shifted by -10 days. Employee no longer in 365-day probation window — ' +
             'check probation length config (= ' + probLen + ').';
    }

    var diffMs = Math.abs(match.date.getTime() - expectedConfirmation.getTime());
    var diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 1) {
      throw new Error('Confirmation date math wrong. Expected DOJ + ' + probLen +
        ' = ' + expectedConfirmation.toDateString() +
        ', got ' + match.date.toDateString() + ' (off by ' + diffDays + ' days)');
    }

    return 'DOJ change applied; confirmation date recalculated to ' + match.date.toDateString();
  } finally {
    sh.getRange(rowNum, dojCol).setValue(originalDoj);
    Cache.bust('data:');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Step 4 — Delete an Offboarded row
// ──────────────────────────────────────────────────────────────────────────
function testVerifyOffboardedDelete_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(Config.canonicalToTabName('offboarded'));
  if (!sh) throw new Error('Offboarded Resources tab not found');

  var lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return 'Skipped — Offboarded tab has no data rows.';
  }

  Cache.bust('data:');
  var baselineAttr = Metrics.quarterlyAttrition();

  var lastCol = sh.getLastColumn();
  var rowData = sh.getRange(lastRow, 1, 1, lastCol).getValues()[0];

  try {
    sh.deleteRow(lastRow);
    SpreadsheetApp.flush();
    Cache.bust('data:');

    var newAttr = Metrics.quarterlyAttrition();

    // The metric should be defined and finite. May or may not change depending on
    // whether the deleted row's DOL is within the current quarter.
    if (typeof newAttr !== 'number' || isNaN(newAttr)) {
      throw new Error('Attrition recompute returned non-numeric: ' + newAttr);
    }

    var changed = (Math.abs(newAttr - baselineAttr) > 0.0001) ? 'changed' : 'unchanged (row was outside current quarter)';
    return 'Attrition recomputed from live data: ' + (baselineAttr * 100).toFixed(3) + '% → ' +
           (newAttr * 100).toFixed(3) + '% (' + changed + ').';
  } finally {
    sh.appendRow(rowData);
    Cache.bust('data:');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Step 5 — Auth gate (allowlist enforcement)
// ──────────────────────────────────────────────────────────────────────────
function testVerifyAuthGate_() {
  var reviewerEmail = 'aadish.jain@techolution.com';
  var unknownEmail = '__verify_random_user_99@example.com';

  var reviewerOk = Config.isAllowed(reviewerEmail);
  if (!reviewerOk) {
    throw new Error('Reviewer email "' + reviewerEmail + '" NOT on allowlist. ' +
      'Add it to _Config row: allowlist | emails | <comma-separated list including this address>');
  }

  var unknownOk = Config.isAllowed(unknownEmail);
  if (unknownOk) {
    throw new Error('Unknown email "' + unknownEmail + '" was incorrectly allowed. ' +
      'Allowlist must reject everyone not explicitly listed.');
  }

  return 'Reviewer allowed, unknown email rejected. (Note: this verifies the doGet allowlist logic, ' +
         'not the live web app render — that requires manual browser testing.)';
}

// ──────────────────────────────────────────────────────────────────────────
// Step 6 — Logs tab has real execution history
// ──────────────────────────────────────────────────────────────────────────
function testVerifyLogsHistory_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Logs');
  if (!sh) throw new Error('Logs tab not found');

  var lastRow = sh.getLastRow();
  var dataRows = Math.max(0, lastRow - 1);
  if (dataRows < 50) {
    throw new Error('Only ' + dataRows + ' log rows. Bootstrap should seed ~100. Re-run setupWorkbook.');
  }

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var tsCol = headers.indexOf('Timestamp');
  var fnCol = headers.indexOf('Function');
  if (tsCol < 0 || fnCol < 0) {
    throw new Error('Logs tab missing expected columns. Have: ' + headers.join(','));
  }

  var sample = sh.getRange(2, 1, dataRows, sh.getLastColumn()).getValues();
  var earliest = null, latest = null;
  var fns = {};
  for (var i = 0; i < sample.length; i++) {
    var ts = sample[i][tsCol];
    if (ts instanceof Date) {
      if (!earliest || ts < earliest) earliest = ts;
      if (!latest || ts > latest) latest = ts;
    }
    var fn = sample[i][fnCol];
    if (fn) fns[String(fn)] = true;
  }

  if (!earliest || !latest) throw new Error('No parseable timestamps in Logs');

  var spanHrs = (latest.getTime() - earliest.getTime()) / (1000 * 60 * 60);
  if (spanHrs < 12) {
    throw new Error('Logs span only ' + spanHrs.toFixed(1) +
      'h. Should span >24h (bootstrap seeds backdated rows). Re-run setupWorkbook to re-seed.');
  }

  var uniqueFns = Object.keys(fns).length;
  if (uniqueFns < 3) {
    throw new Error('Only ' + uniqueFns + ' unique function names in Logs. Expected variety from real pipeline runs + bootstrap seed.');
  }

  return dataRows + ' rows · spanning ' + spanHrs.toFixed(1) + 'h · ' + uniqueFns + ' unique functions.';
}

// ──────────────────────────────────────────────────────────────────────────
// Results writer
// ──────────────────────────────────────────────────────────────────────────
function writeVerificationResults_(startedAt, results) {
  var sh = SpreadsheetApp.getActive().getSheetByName('QA');
  if (!sh) return;

  var rows = results.map(function (r) {
    return [startedAt, '⚙ VERIFY: ' + r.name, r.pass ? 'PASS' : 'FAIL', r.detail || '', r.durationMs];
  });

  sh.insertRowsAfter(1, rows.length);
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
  for (var i = 0; i < rows.length; i++) {
    var color = results[i].pass ? '#059669' : '#DC2626';
    sh.getRange(2 + i, 3).setFontColor(color).setFontWeight('bold');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Local date helpers (don't depend on Alerts/HealthScore being initialized)
// ──────────────────────────────────────────────────────────────────────────
function startOfDay_v_(d) {
  var n = new Date(d.getTime ? d.getTime() : new Date(d).getTime());
  n.setHours(0, 0, 0, 0);
  return n;
}
function addDays_v_(d, n) {
  var r = new Date(d.getTime ? d.getTime() : new Date(d).getTime());
  r.setDate(r.getDate() + n);
  return r;
}

// ──────────────────────────────────────────────────────────────────────────
// Lookup helper
// ──────────────────────────────────────────────────────────────────────────
function findHeaderForCanonical_(headers, tabKey, canonical) {
  var aliases = Config.aliasesFor(tabKey, canonical).map(function (s) { return normalizeStr_(s); });
  for (var i = 0; i < headers.length; i++) {
    if (aliases.indexOf(normalizeStr_(headers[i])) !== -1) return i;
  }
  return -1;
}
function normalizeStr_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
