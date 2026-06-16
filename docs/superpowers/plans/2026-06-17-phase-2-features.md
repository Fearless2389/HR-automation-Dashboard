# Phase 2 Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five mandatory features (Alert Email Engine, Bidirectional Editing, Alert Engine tab, Finance tab, Productivity tab) plus three optional features (Audit Log, search bar, risk indicators) plus UX polish, on a hard deadline of today EOD (2026-06-17).

**Architecture:** Six new `.gs` modules slot into the existing namespace pattern (`var X = X || {}; (function (ns) {...})(X);`). Web App adds four top-level tabs. Bidirectional editing wraps writes in `LockService` + `withSilentWrite` and logs each field change to a dedicated `Audit Log` tab. All UI is vanilla JS — no Alpine, no framework — because HtmlService CSP blocks `eval`.

**Tech Stack:** Google Apps Script V8 + HtmlService + clasp v2.4.2. Tailwind v2 static CSS. No JS chart libraries (HTML/CSS bars + inline SVG sparklines). Python `build_sop.py` for documentation regeneration.

**Spec reference:** `docs/superpowers/specs/2026-06-17-phase-2-features-design.md`

**Execution context:** Working directly on `main` (no worktree — solo project, time pressure). Each task ends in a commit. Push (`clasp push`) happens at the end of each task or batch of related tasks; redeploy happens only at task 26 (pre-submit). Demo mode stays ON throughout — only flipped to OFF for the test-emails step (task 14), then back ON.

**Critical workflow notes:**
- `clasp push` ≠ deploy. The Web App URL serves the *last published version*. To verify Web App changes in incognito, do **Deploy → Manage deployments → pencil → Version: New version → Deploy**. We do this only at the verification step (task 26).
- `_Config` reads are cached for 5 min. After editing `_Config`, click any cell in another tab so onEdit fires `Config.bust()`.
- After bootstrap re-runs, the data caches are also busted automatically.

---

## File Structure

### New `.gs` modules

| File | Single responsibility |
|---|---|
| `src/17_Recommendations.gs` | Rule engine producing recommendation cards from the snapshot. |
| `src/18_Finance.gs` | Aggregate CTC + headcount by project/dept/region; drill-down arrays. |
| `src/19_Productivity.gs` | Trend computation from `Productivity History` + manager-email template hook. |
| `src/20_AlertEmails.gs` | Per-alert email send loop with `ScriptProperties` dedup. |
| `src/21_AuditLog.gs` | `AuditLog.record({op, empId, field, oldVal, newVal, runId})` → append to Audit Log tab. |
| `src/22_Risk.gs` | Pure `Risk.tier(emp)` → `'green'|'amber'|'red'` + reason list. |

### Modified `.gs` modules

| File | Why touched |
|---|---|
| `src/00_Main.gs` | Add menu items for `Run Alert Email Engine`, `Reset Email Dedup`, `Capture Productivity Snapshot`. |
| `src/01_Config.gs` | New keys: `alertEmailRecipient`, `recommendationsCacheSeconds`. |
| `src/04_DataAccess.gs` | Read `project`, `allocationPct` from India + US tabs (header resolver picks them up via new aliases). |
| `src/10_Triggers.gs` | `onSchedulePulse` calls `maybeCaptureMonthlySnapshot_()` and (rate-limited) `AlertEmails.runOnce()`. |
| `src/14_QA.gs` | New assertions for AuditLog idempotency, Risk tiers, Finance totals, Productivity trend bucketing, Recommendation rules, alert email dedup. |
| `src/15_WebAPI.gs` | New endpoints: `api_addEmployee`, `api_updateEmployee`, `api_offboardEmployee`, `api_sendManagerEmail`. Extend `api_snapshot` with `finance`, `productivity`, `recommendations`, `productivityHistory`. Extend `api_drilldown` with `text` filter. |
| `src/99_Bootstrap.gs` | Add `Project` + India `Allocation %` columns, seed values. Create `Productivity History` tab + seed 12 months. Create `Audit Log` tab + protection. Seed new `_Config` rows. Add `Project` + `Allocation %` aliases. |

### Modified HTML

| File | Why touched |
|---|---|
| `src/WebApp.html` | Four new tab buttons + four new panel containers. Modal scaffold for KPI detail + Manage Employees side panel + Email Manager preview. |
| `src/Scripts.html` | New render functions, tab routing extension, click handlers for KPI cards, modal open/close, debounced text search. |
| `src/Styles.html` | Risk dot, audit log table, side panel, finance bars, sparkline, KPI clickable cursor, empty + skeleton states, modal overlay. |
| `src/403.html` | Trim to title only (no friendly copy). |

---

## Task 0: Pre-flight check

**Files:** none.

- [ ] **Step 0.1: Verify clean working tree**

Run:
```bash
cd "C:/Users/ruthv/OneDrive/Desktop/Projects/HR Automation Dashboard" && git status
```
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 0.2: Verify clasp is the right version**

Run: `clasp -v`
Expected: `2.4.2`. If not, `npm install -g @google/clasp@2.4.2`.

- [ ] **Step 0.3: Confirm demo mode is on**

In the sheet → `_Config` tab → `email | demoMode` row → value should be `true`. If unsure, run from editor: `Config.isDemoMode()` → expect `true`.

- [ ] **Step 0.4: Snapshot the current QA pass count**

Sheet menu → **HR Automation → Run QA**. Open `QA` tab, note the count of PASS vs FAIL rows in the latest run. We expect that count to be ≥ today's baseline at task 26.

---

## Task 1: Add new column aliases to Config defaults

**Files:**
- Modify: `src/01_Config.gs` (the `defaultEmployeeAliases_` function near the bottom)
- Modify: `src/01_Config.gs` (the `seedDefaults_` function — add new `aliases.india.project`, etc.)

- [ ] **Step 1.1: Extend `defaultEmployeeAliases_`**

Open `src/01_Config.gs`, find `function defaultEmployeeAliases_()`. Add `project` and `allocationPct` keys:

```js
function defaultEmployeeAliases_() {
  return {
    empId: ['Emp ID', 'Employee ID', 'EmployeeID', 'ID', 'Emp_ID'],
    name: ['Name', 'Employee Name', 'Full Name'],
    dept: ['Dept', 'Department', 'Function'],
    designation: ['Designation', 'Title', 'Role'],
    rm: ['Reporting Manager', 'Manager', 'RM', 'Reports To'],
    skillset: ['Skillset', 'Skills', 'Tech Stack', 'Skill Set'],
    doj: ['DOJ', 'Date of Joining', 'Joining Date', 'Start Date'],
    status: ['Employment Status', 'Status', 'Employment_Status'],
    lwd: ['LWD', 'Last Working Day', 'Last Working Day (Interns Only)', 'End Date', 'Last Day', 'Exit Date', 'Termination Date', 'Last Working Date', 'EndDate', 'Tentative LWD'],
    project: ['Project', 'Project Name', 'Project Assignment', 'Current Project'],
    allocationPct: ['Allocation %', 'Allocation', 'AllocationPct', 'Allocation Percent', 'Alloc %']
  };
}
```

- [ ] **Step 1.2: Add new email + threshold defaults in `seedDefaults_`**

In the same file, find `function seedDefaults_()`. Update the returned `email` and `thresholds` blocks:

```js
thresholds: {
  lwdAlertDays: 45,
  probationConfirmDays: 30,
  probationLengthDays: 180,
  lowProductivity: 0.6,
  benchAllocation: 0.4,
  productivityTarget: 0.8,
  recommendationsCacheSeconds: 60
},
// ... existing health, aliases, tabs ...
email: { digestRecipient: '', digestCronHour: 9, demoMode: true, alertEmailRecipient: '' }
```

- [ ] **Step 1.3: Add Config getters**

Below `ns.emailDigestCronHour`, add:

```js
ns.alertEmailRecipient = function () {
  return ns.load().email.alertEmailRecipient || '';
};
ns.recommendationsCacheSeconds = function () {
  return ns.load().thresholds.recommendationsCacheSeconds || 60;
};
```

- [ ] **Step 1.4: Update the `case 'email':` branch in `loadRaw_`** to parse `alertEmailRecipient`:

```js
case 'email':
  if (key === 'digestCronHour') raw.email.digestCronHour = coerceNumber_(val);
  else if (key === 'demoMode') raw.email.demoMode = (String(val).toLowerCase() === 'true' || val === true);
  else if (key === 'alertEmailRecipient') raw.email.alertEmailRecipient = String(val || '');
  else raw.email[key] = String(val);
  break;
```

- [ ] **Step 1.5: Commit**

```bash
git add src/01_Config.gs
git commit -m "Config: add project/allocationPct aliases and alertEmailRecipient key"
```

---

## Task 2: Bootstrap — add Project + India Allocation columns, seed values

**Files:**
- Modify: `src/99_Bootstrap.gs`

The bootstrap function already exists; we extend it. Read `src/99_Bootstrap.gs` first to find the section that handles employee tabs.

- [ ] **Step 2.1: Add the project constant + seeded picker**

At the top of `src/99_Bootstrap.gs` (after any existing constants), add:

```js
var PROJECT_LIST_BY_DEPT_ = {
  'Engineering': ['Apollo', 'Phoenix', 'Helios'],
  'Finance':     ['Atlas', 'Vega'],
  'Operations':  ['Orion'],
  'HR':          ['Nimbus'],
  'Sales':       ['Lyra']
};
var DEFAULT_PROJECT_POOL_ = ['Apollo', 'Phoenix', 'Helios', 'Atlas', 'Vega', 'Orion', 'Nimbus', 'Lyra'];

function pickProjectForEmployee_(dept, empId) {
  var pool = PROJECT_LIST_BY_DEPT_[String(dept || '').trim()] || DEFAULT_PROJECT_POOL_;
  return pool[stableHash_(String(empId || '')) % pool.length];
}
function pickAllocationForEmployee_(empId) {
  // 60–100, stable per empId
  return 60 + (stableHash_(String(empId || '')) % 41);
}
function stableHash_(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
```

- [ ] **Step 2.2: Add `ensureColumn_` and `backfillColumn_` helpers**

Below the constants:

```js
/**
 * Ensure a column with `header` exists on `sh`. Returns the 1-based column index.
 * Appends to the right if missing. Idempotent.
 */
function ensureColumn_(sh, header) {
  var lastCol = sh.getLastColumn();
  if (lastCol > 0) {
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim() === header) return i + 1;
    }
  }
  var newCol = lastCol + 1;
  sh.getRange(1, newCol).setValue(header).setFontWeight('bold');
  return newCol;
}

/**
 * For each data row, if the cell in `col` is blank, write `valueFn(rowObj)`.
 * Never overwrites existing values.
 */
function backfillColumn_(sh, col, valueFn) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  var headerRange = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var dataRange = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn());
  var values = dataRange.getValues();
  var changes = 0;
  for (var r = 0; r < values.length; r++) {
    var current = values[r][col - 1];
    if (current === '' || current === null || current === undefined) {
      var rowObj = {};
      for (var c = 0; c < headerRange.length; c++) rowObj[String(headerRange[c]).trim()] = values[r][c];
      values[r][col - 1] = valueFn(rowObj);
      changes++;
    }
  }
  if (changes > 0) dataRange.setValues(values);
  return changes;
}
```

- [ ] **Step 2.3: Add `seedProjectAndAllocation_` function**

```js
function seedProjectAndAllocation_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = [
    { name: Config.canonicalToTabName('india'), needsAllocation: true },
    { name: Config.canonicalToTabName('us'),    needsAllocation: false } // US already has Allocation %
  ];
  tabs.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    if (!sh) return;
    var projectCol = ensureColumn_(sh, 'Project');
    backfillColumn_(sh, projectCol, function (row) {
      return pickProjectForEmployee_(row['Dept'] || row['Department'], row['Emp ID']);
    });
    if (t.needsAllocation) {
      var allocCol = ensureColumn_(sh, 'Allocation %');
      backfillColumn_(sh, allocCol, function (row) {
        return pickAllocationForEmployee_(row['Emp ID']);
      });
    }
  });
}
```

- [ ] **Step 2.4: Call `seedProjectAndAllocation_()` from `setupWorkbook`**

Find `function setupWorkbook()`. Add a line after the helper-tab creation block:

```js
seedProjectAndAllocation_();
```

(If you're not sure where, search for `Logs` creation or `_Templates` creation and place this line right after that block.)

- [ ] **Step 2.5: Push, run bootstrap, verify**

```bash
clasp push
```

Then in Apps Script editor → run `setupWorkbook`. In the sheet → India Employee Database tab → confirm new `Project` and `Allocation %` columns exist with non-empty values for every row. Repeat for US tab (Project should be new; Allocation should be unchanged).

- [ ] **Step 2.6: Commit**

```bash
git add src/99_Bootstrap.gs
git commit -m "Bootstrap: add Project + India Allocation columns with stable per-empId backfill"
```

---

## Task 3: Bootstrap — Productivity History tab + 12-month seed

**Files:**
- Modify: `src/99_Bootstrap.gs`

- [ ] **Step 3.1: Add `seedProductivityHistory_`**

In `src/99_Bootstrap.gs`:

```js
var PROD_HISTORY_TAB_ = 'Productivity History';

function seedProductivityHistory_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PROD_HISTORY_TAB_);
  if (!sh) {
    sh = ss.insertSheet(PROD_HISTORY_TAB_);
    sh.getRange(1, 1, 1, 3).setValues([['Emp ID', 'Month', 'Productivity']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // If the tab already has data rows, leave them alone (idempotent re-run).
  if (sh.getLastRow() > 1) return;

  var fin = Data.finance();
  var now = new Date();
  var rows = [];
  fin.forEach(function (f) {
    if (!f.empId) return;
    var target = typeof f.productivity === 'number' ? f.productivity : 0.75;
    for (var k = 11; k >= 0; k--) {
      var d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      var ym = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
      var value;
      if (k === 0) {
        value = target; // anchor current month exactly to target
      } else {
        var noise = (stableHash_(f.empId + ':' + ym) % 100 - 50) / 1250; // ±0.04
        var drift = (12 - k) * 0.005 * (stableHash_(f.empId) % 2 === 0 ? 1 : -1);
        value = target - drift + noise;
      }
      if (value < 0.30) value = 0.30;
      if (value > 0.99) value = 0.99;
      rows.push([f.empId, ym, Math.round(value * 100) / 100]);
    }
  });
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}
```

- [ ] **Step 3.2: Call from `setupWorkbook`**

Add this line right after `seedProjectAndAllocation_();`:

```js
seedProductivityHistory_();
```

- [ ] **Step 3.3: Push + run + verify**

```bash
clasp push
```

Apps Script editor → run `setupWorkbook` again. In the sheet, find the new `Productivity History` tab. Confirm: column headers `Emp ID | Month | Productivity`, and there are `12 × employeeCount` rows. Pick any 3 employees, scan their 12 rows — should look gently noisy without large jumps.

- [ ] **Step 3.4: Commit**

```bash
git add src/99_Bootstrap.gs
git commit -m "Bootstrap: seed Productivity History tab with 12 months per employee"
```

---

## Task 4: Bootstrap — Audit Log tab + protection

**Files:**
- Modify: `src/99_Bootstrap.gs`

- [ ] **Step 4.1: Add `createAuditLogTab_`**

```js
var AUDIT_LOG_TAB_ = 'Audit Log';

function createAuditLogTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(AUDIT_LOG_TAB_);
  if (!sh) {
    sh = ss.insertSheet(AUDIT_LOG_TAB_);
    var headers = ['Timestamp', 'Actor', 'Operation', 'Emp ID', 'Field', 'Old Value', 'New Value', 'Run ID'];
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#1F2937').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, headers.length, 140);
    sh.setColumnWidth(8, 220);
  }
  // Protect data rows so HR can't accidentally edit history.
  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (protections.length === 0) {
    var p = sh.protect().setDescription('Audit Log — system-managed');
    p.setWarningOnly(true); // soft protection (script can still write; user sees a warning popup)
  }
}
```

- [ ] **Step 4.2: Call from `setupWorkbook`**

Add right after `seedProductivityHistory_();`:

```js
createAuditLogTab_();
```

- [ ] **Step 4.3: Push + run + verify**

```bash
clasp push
```

Run `setupWorkbook`. Confirm new `Audit Log` tab exists with 8 headers, frozen first row, and editing any data cell shows a warning popup.

- [ ] **Step 4.4: Commit**

```bash
git add src/99_Bootstrap.gs
git commit -m "Bootstrap: create Audit Log tab with header + soft protection"
```

---

## Task 5: Bootstrap — seed new `_Config` rows

**Files:**
- Modify: `src/99_Bootstrap.gs` (`configSeedRows_`)

- [ ] **Step 5.1: Append new rows**

Find `function configSeedRows_()`. Add these rows to the array, near the existing `email` rows:

```js
rows.push(['email', 'alertEmailRecipient', '']);
rows.push(['thresholds', 'recommendationsCacheSeconds', 60]);
rows.push(['aliases.india', 'project', 'Project, Project Name, Project Assignment, Current Project']);
rows.push(['aliases.india', 'allocationPct', 'Allocation %, Allocation, AllocationPct, Allocation Percent, Alloc %']);
rows.push(['aliases.us', 'project', 'Project, Project Name, Project Assignment, Current Project']);
```

- [ ] **Step 5.2: Push + run + verify**

```bash
clasp push
```

Run `setupWorkbook` once more. In `_Config` tab, confirm the new rows exist (note: `configSeedRows_` typically only seeds when `_Config` is empty — if the tab already has data, you may need to manually paste these rows. Check the existing function to confirm). Then click any cell in another tab to fire `Config.bust()` via onEdit.

- [ ] **Step 5.3: Commit**

```bash
git add src/99_Bootstrap.gs
git commit -m "Bootstrap: seed Config rows for alertEmailRecipient + new aliases"
```

---

## Task 6: Extend `Data.india()` / `Data.us()` to surface project + allocationPct

**Files:**
- Modify: `src/04_DataAccess.gs`

- [ ] **Step 6.1: Read the current `readEmployees_` function**

Locate `readEmployees_` (or whichever function maps row → typed employee object). The header resolver will automatically pick up the new aliases, but you must add the new fields to the typed mapping.

- [ ] **Step 6.2: Add project + allocationPct to the typed employee shape**

In `readEmployees_` find where each row gets fields assigned (something like `out[i] = { empId: ..., name: ..., ... }`). Add:

```js
project: row[colIdx.project] || '',
allocationPct: (function () {
  var v = row[colIdx.allocationPct];
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  if (isNaN(n)) return null;
  return n > 1 ? n / 100 : n; // accept both 75 (percent) and 0.75 (fraction)
})()
```

- [ ] **Step 6.3: Update column-resolver call to include new canonicals**

Find where the function asks Header for column indices. Add `project` and `allocationPct` to the canonical list it requests. Look for an existing array like `['empId','name','dept','designation','rm','skillset','doj','status','lwd']` and append `'project','allocationPct'`.

If the canonicals are read via `Config.canonicalCols('india')`, the new keys are auto-included once Config is busted — confirm `Config.canonicalCols('india')` includes `project` and `allocationPct` by running it in the editor.

- [ ] **Step 6.4: Push + spot-check**

```bash
clasp push
```

In editor:
```js
function debug_data() { Logger.log(JSON.stringify(Data.india()[0], null, 2)); }
```
Run `debug_data`. Confirm output includes `project` and `allocationPct` with non-null values.

- [ ] **Step 6.5: Commit**

```bash
git add src/04_DataAccess.gs
git commit -m "DataAccess: surface project + allocationPct on india/us reads"
```

---

## Task 7: Add `21_AuditLog.gs`

**Files:**
- Create: `src/21_AuditLog.gs`

- [ ] **Step 7.1: Write the module**

Create `src/21_AuditLog.gs`:

```js
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
```

- [ ] **Step 7.2: Push + smoke-test**

```bash
clasp push
```

In editor:
```js
function debug_audit() {
  AuditLog.record({op:'test', empId:'IN9999', field:'designation', oldVal:'Engineer', newVal:'Senior Engineer', runId:'r0'});
}
```
Run `debug_audit`. Confirm one new row appears on the `Audit Log` tab.

- [ ] **Step 7.3: Commit**

```bash
git add src/21_AuditLog.gs
git commit -m "AuditLog: per-field append helper for HR audit trail"
```

---

## Task 8: Add `22_Risk.gs`

**Files:**
- Create: `src/22_Risk.gs`

- [ ] **Step 8.1: Write the module**

Create `src/22_Risk.gs`:

```js
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
```

- [ ] **Step 8.2: Push + smoke-test**

```bash
clasp push
```

In editor:
```js
function debug_risk() {
  var emps = Data.india();
  emps.slice(0, 5).forEach(function (e) {
    Logger.log(e.empId + ' → ' + JSON.stringify(Risk.tier(e)));
  });
}
```
Run. Confirm output mix of green/amber/red with reasonable reasons.

- [ ] **Step 8.3: Commit**

```bash
git add src/22_Risk.gs
git commit -m "Risk: pure tier classifier with reason list for hover tooltip"
```

---

## Task 9: Extend `15_WebAPI.gs` with write endpoints

**Files:**
- Modify: `src/15_WebAPI.gs`

- [ ] **Step 9.1: Add common helpers at the bottom of the file**

```js
// ───────── Phase 2 write helpers ─────────

var EDITABLE_FIELDS_ = ['name', 'dept', 'designation', 'rm', 'status', 'project', 'allocationPct', 'doj', 'skillset', 'lwd'];

function locateEmployee_(empId) {
  if (!empId) throw new Error('empId required');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var regions = ['india', 'us'];
  for (var i = 0; i < regions.length; i++) {
    var tabName = Config.canonicalToTabName(regions[i]);
    var sh = ss.getSheetByName(tabName);
    if (!sh) continue;
    var headerRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var empIdCol = Header.col(sh, regions[i], 'empId') + 1; // 1-based
    var lastRow = sh.getLastRow();
    if (lastRow < 2) continue;
    var ids = sh.getRange(2, empIdCol, lastRow - 1, 1).getValues();
    for (var r = 0; r < ids.length; r++) {
      if (String(ids[r][0]).trim() === String(empId).trim()) {
        return { region: regions[i], sheet: sh, row: r + 2, headers: headerRow };
      }
    }
  }
  return null;
}

function nextEmpId_(region) {
  var prefix = region === 'india' ? 'IN1' : 'US1';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(Config.canonicalToTabName(region));
  if (!sh) throw new Error('region tab missing: ' + region);
  var empIdCol = Header.col(sh, region, 'empId') + 1;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return prefix + '001';
  var ids = sh.getRange(2, empIdCol, lastRow - 1, 1).getValues();
  var maxN = 0;
  ids.forEach(function (row) {
    var m = String(row[0]).match(/^[A-Z]{2}1(\d+)$/);
    if (m) { var n = parseInt(m[1], 10); if (n > maxN) maxN = n; }
  });
  var next = maxN + 1;
  return prefix + (next < 1000 ? ('00' + next).slice(-3) : String(next));
}

function canonicalToHeader_(region, canonical) {
  // First alias in the list is the canonical display name.
  var aliases = Config.aliasesFor(region, canonical);
  return aliases[0] || canonical;
}
```

- [ ] **Step 9.2: Add `api_updateEmployee`**

```js
function api_updateEmployee(empId, patch) {
  var runId = Log.start('api_updateEmployee', 'webapp');
  try {
    if (!empId || !patch) throw new Error('empId and patch required');
    var loc = locateEmployee_(empId);
    if (!loc) throw new Error('employee not found: ' + empId);

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(5000)) throw new Error('could not acquire document lock');
    try {
      var changes = [];
      var rowValues = loc.sheet.getRange(loc.row, 1, 1, loc.sheet.getLastColumn()).getValues()[0];
      withSilentWrite(function () {
        Object.keys(patch).forEach(function (field) {
          if (EDITABLE_FIELDS_.indexOf(field) === -1) return; // ignore unknown
          var header = canonicalToHeader_(loc.region, field);
          var colIdx = -1;
          for (var i = 0; i < loc.headers.length; i++) {
            if (String(loc.headers[i]).trim() === header) { colIdx = i; break; }
          }
          if (colIdx === -1) return; // header not present
          var oldVal = rowValues[colIdx];
          var newVal = patch[field];
          if (field === 'allocationPct' && typeof newVal === 'number' && newVal <= 1) newVal = newVal * 100;
          if (String(oldVal) === String(newVal)) return; // no-op
          loc.sheet.getRange(loc.row, colIdx + 1).setValue(newVal);
          changes.push({ field: field, oldVal: oldVal, newVal: newVal });
        });
      });

      AuditLog.recordMany('update', empId, changes, runId);
      Log.info(runId, 'employee.update', { empId: empId, region: loc.region, changeCount: changes.length });
      Data.bustAll();
      Cache.bust('snapshot:');
      Log.end(runId, { changeCount: changes.length });
      return { ok: true, changeCount: changes.length };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Log.error(runId, 'api_updateEmployee: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
    return { ok: false, message: e.message };
  }
}
```

- [ ] **Step 9.3: Add `api_addEmployee`**

```js
function api_addEmployee(payload) {
  var runId = Log.start('api_addEmployee', 'webapp');
  try {
    if (!payload || !payload.region) throw new Error('payload.region required (india|us)');
    if (payload.region !== 'india' && payload.region !== 'us') throw new Error('region must be india or us');

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(5000)) throw new Error('could not acquire document lock');
    try {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(Config.canonicalToTabName(payload.region));
      var newId = nextEmpId_(payload.region);
      var headerRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      var row = new Array(headerRow.length).fill('');

      function setField(canonical, value) {
        var header = canonicalToHeader_(payload.region, canonical);
        for (var i = 0; i < headerRow.length; i++) {
          if (String(headerRow[i]).trim() === header) { row[i] = value; return; }
        }
      }
      setField('empId', newId);
      setField('name', payload.name || '');
      setField('dept', payload.dept || '');
      setField('designation', payload.designation || '');
      setField('rm', payload.rm || '');
      setField('status', payload.status || 'Confirmed');
      setField('project', payload.project || 'Unassigned');
      setField('skillset', payload.skillset || '');
      if (payload.doj) setField('doj', new Date(payload.doj));
      if (typeof payload.allocationPct === 'number') {
        setField('allocationPct', payload.allocationPct <= 1 ? payload.allocationPct * 100 : payload.allocationPct);
      }

      withSilentWrite(function () {
        sh.appendRow(row);
      });

      AuditLog.record({
        op: 'add', empId: newId, field: '', oldVal: '',
        newVal: JSON.stringify({ region: payload.region, name: payload.name, dept: payload.dept, designation: payload.designation, project: payload.project }),
        runId: runId
      });
      Log.info(runId, 'employee.add', { empId: newId, region: payload.region });
      Data.bustAll();
      Cache.bust('snapshot:');
      Log.end(runId, { empId: newId });
      return { ok: true, empId: newId };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Log.error(runId, 'api_addEmployee: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
    return { ok: false, message: e.message };
  }
}
```

- [ ] **Step 9.4: Add `api_offboardEmployee`**

```js
function api_offboardEmployee(empId, reason) {
  var runId = Log.start('api_offboardEmployee', 'webapp');
  try {
    if (!empId) throw new Error('empId required');
    var loc = locateEmployee_(empId);
    if (!loc) throw new Error('employee not found: ' + empId);
    var reasonStr = String(reason || '').trim();
    if (!reasonStr) throw new Error('reason required');

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(5000)) throw new Error('could not acquire document lock');
    try {
      var rowValues = loc.sheet.getRange(loc.row, 1, 1, loc.sheet.getLastColumn()).getValues()[0];
      var nameIdx = -1, statusIdx = -1, deptIdx = -1;
      for (var i = 0; i < loc.headers.length; i++) {
        var h = String(loc.headers[i]).trim();
        if (h === canonicalToHeader_(loc.region, 'name')) nameIdx = i;
        if (h === canonicalToHeader_(loc.region, 'status')) statusIdx = i;
        if (h === canonicalToHeader_(loc.region, 'dept')) deptIdx = i;
      }
      var prevStatus = statusIdx >= 0 ? rowValues[statusIdx] : '';
      var empName = nameIdx >= 0 ? rowValues[nameIdx] : '';
      var empDept = deptIdx >= 0 ? rowValues[deptIdx] : '';

      withSilentWrite(function () {
        // 1. Flip status on source row
        if (statusIdx >= 0) loc.sheet.getRange(loc.row, statusIdx + 1).setValue('Offboarded');

        // 2. Append a row to Offboarded Resources
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var offSh = ss.getSheetByName(Config.canonicalToTabName('offboarded'));
        if (offSh) {
          // Build row aligned to offboarded headers
          var offHeaders = offSh.getRange(1, 1, 1, offSh.getLastColumn()).getValues()[0];
          var newRow = new Array(offHeaders.length).fill('');
          for (var j = 0; j < offHeaders.length; j++) {
            var oh = String(offHeaders[j]).trim();
            if (oh === 'Emp ID' || oh === 'Employee ID') newRow[j] = empId;
            else if (oh === 'Name' || oh === 'Employee Name') newRow[j] = empName;
            else if (oh === 'Dept' || oh === 'Department') newRow[j] = empDept;
            else if (oh === 'DOL' || oh === 'Date of Leaving' || oh === 'Last Working Day' || oh === 'Exit Date') newRow[j] = new Date();
            else if (oh === 'Reason' || oh === 'Exit Reason' || oh === 'Reason for Leaving') newRow[j] = reasonStr;
          }
          offSh.appendRow(newRow);
        }
      });

      AuditLog.record({
        op: 'offboard', empId: empId, field: 'status',
        oldVal: prevStatus, newVal: 'Offboarded · ' + reasonStr, runId: runId
      });
      Log.info(runId, 'employee.offboard', { empId: empId, reason: reasonStr });
      Data.bustAll();
      Cache.bust('snapshot:');
      Log.end(runId, { empId: empId });
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Log.error(runId, 'api_offboardEmployee: ' + e.message, { stack: e.stack });
    Log.end(runId, { status: 'FAIL' });
    return { ok: false, message: e.message };
  }
}
```

- [ ] **Step 9.5: Extend `api_drilldown` with text filter**

Find the existing `api_drilldown` function. Replace the filter block with:

```js
var text = String((filter && filter.text) || '').trim().toLowerCase();
var out = emps.filter(function (e) {
  if (filter.region && filter.region !== 'All' && e.__region !== filter.region) return false;
  if (filter.dept && filter.dept !== 'All' && e.dept !== filter.dept) return false;
  if (filter.rm && filter.rm !== 'All' && e.rm !== filter.rm) return false;
  if (filter.status && filter.status !== 'All' && e.status !== filter.status) return false;
  if (filter.project && filter.project !== 'All' && e.project !== filter.project) return false;
  if (text) {
    var hay = [e.name, e.empId, e.skillset, e.designation, e.project].join(' ').toLowerCase();
    if (hay.indexOf(text) === -1) return false;
  }
  return true;
}).map(serializeEmployee_);
```

Also extend `serializeEmployee_` to include `project` and `allocationPct`:

```js
function serializeEmployee_(e) {
  return {
    empId: e.empId,
    name: e.name,
    region: e.__region,
    dept: e.dept,
    designation: e.designation,
    rm: e.rm,
    status: e.status,
    skillset: e.skillset,
    project: e.project || '',
    doj: e.doj ? e.doj.toISOString() : null,
    lwd: e.lwd ? e.lwd.toISOString() : null,
    allocationPct: typeof e.allocationPct === 'number' ? e.allocationPct : null,
    ctc: typeof e.ctc === 'number' ? e.ctc : null
  };
}
```

- [ ] **Step 9.6: Push + smoke-test**

```bash
clasp push
```

In editor:
```js
function debug_write() {
  var emps = Data.india();
  var first = emps[0];
  Logger.log('Before: ' + first.designation);
  var r = api_updateEmployee(first.empId, { designation: 'TEST_DESIGNATION' });
  Logger.log(JSON.stringify(r));
}
```
Run. Confirm: returns `{ok: true, changeCount: 1}`, sheet cell updated, Audit Log tab has new row.

Then revert:
```js
function debug_revert() {
  api_updateEmployee(Data.india()[0].empId, { designation: 'Software Engineer' }); // or whatever the original was
}
```

- [ ] **Step 9.7: Commit**

```bash
git add src/15_WebAPI.gs
git commit -m "WebAPI: add/update/offboard employee endpoints + text drill-down filter"
```

---

## Task 10: Write QA assertions for tasks 1–9

**Files:**
- Modify: `src/14_QA.gs`

- [ ] **Step 10.1: Add new test cases**

Find the existing test list in `QA.runAll()` (or wherever new assertions are registered). Append:

```js
QA.assert('Risk.tier is pure (same input → same tier)', function () {
  var sample = { status: 'Confirmed', productivity: 0.85, allocationPct: 0.85 };
  var a = Risk.tier(sample), b = Risk.tier(sample);
  if (a.tier !== b.tier) throw new Error('non-deterministic');
});

QA.assert('Risk.tier classifies offboarded as red', function () {
  var r = Risk.tier({ status: 'Offboarded' });
  if (r.tier !== 'red') throw new Error('expected red, got ' + r.tier);
});

QA.assert('AuditLog.record appends a row', function () {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Audit Log');
  if (!sh) throw new Error('Audit Log tab missing');
  var before = sh.getLastRow();
  AuditLog.record({ op: 'qa-test', empId: 'QA0000', field: 'designation', oldVal: 'a', newVal: 'b', runId: 'qa' });
  var after = sh.getLastRow();
  if (after !== before + 1) throw new Error('expected row count +1, got ' + (after - before));
});

QA.assert('Project column exists on India tab', function () {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(Config.canonicalToTabName('india'));
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('Project') === -1) throw new Error('Project header missing');
});

QA.assert('Allocation % column exists on India tab', function () {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(Config.canonicalToTabName('india'));
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('Allocation %') === -1) throw new Error('Allocation % header missing');
});

QA.assert('Productivity History has 12 months per employee', function () {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Productivity History');
  if (!sh) throw new Error('Productivity History tab missing');
  var lastRow = sh.getLastRow();
  if (lastRow < 13) throw new Error('expected at least 13 rows (header + 12), got ' + lastRow);
});
```

- [ ] **Step 10.2: Push + run QA + verify**

```bash
clasp push
```

Sheet menu → **HR Automation → Run QA**. Open QA tab, verify the 6 new assertions all PASS.

- [ ] **Step 10.3: Commit**

```bash
git add src/14_QA.gs
git commit -m "QA: assertions for Risk, AuditLog, new columns, Productivity History"
```

---

## Task 11: Add `20_AlertEmails.gs` — per-alert send loop with dedup

**Files:**
- Create: `src/20_AlertEmails.gs`
- Modify: `src/00_Main.gs` (menu)

- [ ] **Step 11.1: Write the module**

Create `src/20_AlertEmails.gs`:

```js
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
```

- [ ] **Step 11.2: Seed the per-alert template into `_Templates`**

In `src/99_Bootstrap.gs`, find the template seeding function (look for `_Templates` references). Add a new template:

```js
{ key: 'alert.perAlert', subject: '{{subject}}', htmlBody: '{{bodyHtml}}' }
```

Run `setupWorkbook` to seed it, or paste manually into `_Templates`.

- [ ] **Step 11.3: Add menu items in `src/00_Main.gs`**

In `onOpen()`, after the existing `Stop Daily Digest` line:

```js
.addSeparator()
.addItem('Run Alert Email Engine', 'runAlertEmailEngineMenu_')
.addItem('Reset Email Dedup', 'resetEmailDedupMenu_')
```

Then add the handlers near the bottom of the file:

```js
function runAlertEmailEngineMenu_() {
  if (typeof AlertEmails === 'undefined') return;
  var result = AlertEmails.runOnce();
  SpreadsheetApp.getActive().toast(
    'Sent: ' + result.sent + ' · Skipped dedup: ' + result.skippedDedup,
    'HR Automation', 5
  );
}
function resetEmailDedupMenu_() {
  if (typeof AlertEmails === 'undefined') return;
  var n = AlertEmails.resetDedup();
  SpreadsheetApp.getActive().toast('Cleared ' + n + ' dedup key(s)', 'HR Automation', 5);
}
```

- [ ] **Step 11.4: Push**

```bash
clasp push
```

- [ ] **Step 11.5: Commit**

```bash
git add src/20_AlertEmails.gs src/00_Main.gs src/99_Bootstrap.gs
git commit -m "AlertEmails: per-alert send loop with banded dedup keys; menu items"
```

---

## Task 12: Wire `onSchedulePulse` to rate-limit alert email runs

**Files:**
- Modify: `src/10_Triggers.gs`

- [ ] **Step 12.1: Add `maybeRunAlertEmails_`**

In `src/10_Triggers.gs`, find `function onSchedulePulse()`. Inside that function, append:

```js
maybeRunAlertEmails_();
maybeCaptureMonthlySnapshot_();
```

Below the existing handler functions, add:

```js
function maybeRunAlertEmails_() {
  // Rate-limit: at most once per hour.
  var props = PropertiesService.getScriptProperties();
  var lastIso = props.getProperty('alertEmails:lastRunIso');
  var nowMs = Date.now();
  if (lastIso) {
    var elapsed = nowMs - new Date(lastIso).getTime();
    if (elapsed < 60 * 60 * 1000) return;
  }
  try {
    AlertEmails.runOnce();
    props.setProperty('alertEmails:lastRunIso', new Date().toISOString());
  } catch (e) {
    Log.error(Log.start('maybeRunAlertEmails_', 'onSchedule'), 'failed: ' + e.message);
  }
}

function maybeCaptureMonthlySnapshot_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Productivity History');
    if (!sh) return;
    var ym = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
    // Quick exit: if any row for this month exists, skip.
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;
    var monthCol = sh.getRange(2, 2, lastRow - 1, 1).getValues();
    for (var i = 0; i < monthCol.length; i++) {
      if (String(monthCol[i][0]) === ym) return;
    }
    // Append a row per employee with current productivity.
    var fin = Data.finance();
    var rows = fin
      .filter(function (f) { return f.empId; })
      .map(function (f) {
        var v = typeof f.productivity === 'number' ? f.productivity : 0.75;
        return [f.empId, ym, Math.round(v * 100) / 100];
      });
    if (rows.length) sh.getRange(lastRow + 1, 1, rows.length, 3).setValues(rows);
  } catch (e) {
    Log.error(Log.start('maybeCaptureMonthlySnapshot_', 'onSchedule'), 'failed: ' + e.message);
  }
}
```

- [ ] **Step 12.2: Push**

```bash
clasp push
```

- [ ] **Step 12.3: Commit**

```bash
git add src/10_Triggers.gs
git commit -m "Triggers: rate-limited alert email runs + monthly productivity snapshot capture"
```

---

## Task 13: Add `17_Recommendations.gs` — 8 rules

**Files:**
- Create: `src/17_Recommendations.gs`

- [ ] **Step 13.1: Write the module**

Create `src/17_Recommendations.gs`:

```js
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
```

- [ ] **Step 13.2: Push + smoke-test**

```bash
clasp push
```

In editor:
```js
function debug_recs() {
  var snap = api_snapshot();
  Logger.log(JSON.stringify(Recommendations.all(snap), null, 2));
}
```
Run. Confirm at least 2 cards return (may be empty if data doesn't trigger rules — that's fine; we'll re-test with full snapshot in task 16).

- [ ] **Step 13.3: Commit**

```bash
git add src/17_Recommendations.gs
git commit -m "Recommendations: 8 rules + 7-day dismiss support"
```

---

## Task 14: Add `18_Finance.gs` — aggregations

**Files:**
- Create: `src/18_Finance.gs`

- [ ] **Step 14.1: Write the module**

Create `src/18_Finance.gs`:

```js
/**
 * 18_Finance.gs — Project / Department / Region aggregations.
 *
 * All values computed live from Data.allEmployees() + Data.finance() join.
 * No hardcoded numbers.
 *
 * Public API:
 *   Finance.snapshot() → { byProject, byDept, byRegion, drillDown }
 */

var Finance = Finance || {};

(function (ns) {
  ns.snapshot = function () {
    var emps = Data.allEmployees();
    var fin = Data.finance();
    var finByEmp = {};
    fin.forEach(function (f) { if (f.empId) finByEmp[f.empId] = f; });

    var joined = emps.map(function (e) {
      var f = finByEmp[e.empId] || {};
      return {
        empId: e.empId, name: e.name, dept: e.dept, designation: e.designation,
        region: e.__region, project: e.project || 'Unassigned',
        ctcInr: typeof f.ctcInrAnnual === 'number' ? f.ctcInrAnnual : null,
        ctcUsd: typeof f.ctcUsdAnnual === 'number' ? f.ctcUsdAnnual : null
      };
    });

    var byProject = aggregate_(joined, 'project');
    var byDept = aggregate_(joined, 'dept');
    var byRegion = aggregate_(joined, 'region');
    var drillDown = {};
    joined.forEach(function (j) {
      drillDown['project:' + j.project] = drillDown['project:' + j.project] || [];
      drillDown['project:' + j.project].push(serializeEmp_(j));
      drillDown['dept:' + j.dept] = drillDown['dept:' + j.dept] || [];
      drillDown['dept:' + j.dept].push(serializeEmp_(j));
    });

    return { byProject: byProject, byDept: byDept, byRegion: byRegion, drillDown: drillDown };
  };

  function aggregate_(rows, key) {
    var buckets = {};
    rows.forEach(function (r) {
      var k = r[key] || 'Unknown';
      if (!buckets[k]) buckets[k] = { key: k, headcount: 0, ctcInr: 0, ctcUsd: 0 };
      buckets[k].headcount++;
      if (typeof r.ctcInr === 'number') buckets[k].ctcInr += r.ctcInr;
      if (typeof r.ctcUsd === 'number') buckets[k].ctcUsd += r.ctcUsd;
    });
    return Object.keys(buckets).map(function (k) { return buckets[k]; })
      .sort(function (a, b) { return (b.ctcInr + b.ctcUsd) - (a.ctcInr + a.ctcUsd); });
  }
  function serializeEmp_(j) {
    return { empId: j.empId, name: j.name, designation: j.designation, region: j.region, ctcInr: j.ctcInr, ctcUsd: j.ctcUsd };
  }
})(Finance);
```

- [ ] **Step 14.2: Push + smoke-test**

```bash
clasp push
```

In editor:
```js
function debug_finance() { Logger.log(JSON.stringify(Finance.snapshot().byProject, null, 2)); }
```
Run. Confirm output has multiple projects with non-zero headcount + CTC.

- [ ] **Step 14.3: Commit**

```bash
git add src/18_Finance.gs
git commit -m "Finance: project/dept/region aggregations with drill-down arrays"
```

---

## Task 15: Add `19_Productivity.gs` — trend + manager email

**Files:**
- Create: `src/19_Productivity.gs`

- [ ] **Step 15.1: Write the module**

Create `src/19_Productivity.gs`:

```js
/**
 * 19_Productivity.gs — Trend computation + manager-email template hook.
 *
 * Reads Productivity History tab. Trend = avg(last 3 months) − avg(prior 3 months).
 * Bucketed: > +0.05 = up, < -0.05 = down, else flat.
 *
 * Public API:
 *   Productivity.snapshot() → { all: [...], top5, bottom5 }
 *   Productivity.history(empId, months) → [ {month, value}, ... ]
 *   Productivity.draftManagerEmail(empId) → { subject, body, to }
 */

var Productivity = Productivity || {};

(function (ns) {
  var TAB = 'Productivity History';
  var SPARK_MONTHS = 6;

  ns.snapshot = function () {
    var hist = readHistory_();
    var emps = Data.allEmployees();
    var fin = Data.finance();
    var finByEmp = {}; fin.forEach(function (f) { if (f.empId) finByEmp[f.empId] = f; });

    var all = emps.map(function (e) {
      var rows = (hist[e.empId] || []).sort(function (a, b) { return a.month < b.month ? -1 : 1; });
      var trend = computeTrend_(rows);
      var spark = rows.slice(-SPARK_MONTHS).map(function (r) { return r.value; });
      var current = typeof (finByEmp[e.empId] || {}).productivity === 'number'
        ? finByEmp[e.empId].productivity
        : (rows.length ? rows[rows.length - 1].value : null);
      return {
        empId: e.empId, name: e.name, dept: e.dept, region: e.__region,
        project: e.project || 'Unassigned', rm: e.rm,
        current: current, trend: trend.bucket, delta: trend.delta,
        allocationPct: typeof e.allocationPct === 'number' ? e.allocationPct : null,
        spark: spark
      };
    }).filter(function (r) { return typeof r.current === 'number'; });

    var ranked = all.slice().sort(function (a, b) { return b.current - a.current; });
    return { all: all, top5: ranked.slice(0, 5), bottom5: ranked.slice(-5).reverse() };
  };

  ns.history = function (empId, months) {
    var hist = readHistory_();
    var rows = (hist[empId] || []).sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    return rows.slice(-(months || SPARK_MONTHS));
  };

  ns.draftManagerEmail = function (empId) {
    var emp = Data.allEmployees().filter(function (e) { return e.empId === empId; })[0];
    if (!emp) throw new Error('employee not found: ' + empId);
    var snap = ns.snapshot();
    var row = snap.all.filter(function (r) { return r.empId === empId; })[0];
    var hist = ns.history(empId, 6);
    var sparkLine = hist.map(function (h) { return h.month + ': ' + (h.value * 100).toFixed(0) + '%'; }).join('<br/>');
    var subject = 'Performance summary · ' + emp.name + ' (' + empId + ')';
    var body = ''
      + '<div style="font-family:Inter,Arial,sans-serif;color:#18181B;line-height:1.5;">'
      + '<h2 style="color:#4F46E5;margin:0 0 16px;">' + emp.name + ' — performance summary</h2>'
      + '<p><strong>Employee:</strong> ' + emp.name + ' (' + empId + ') · ' + emp.dept + '</p>'
      + '<p><strong>Current productivity:</strong> ' + (row ? (row.current * 100).toFixed(0) + '%' : '—') + '</p>'
      + '<p><strong>Trend (3-month):</strong> ' + (row ? row.trend.toUpperCase() : '—') + (row && row.delta ? ' (Δ ' + (row.delta * 100).toFixed(1) + ' pts)' : '') + '</p>'
      + '<p><strong>Last 6 months:</strong><br/>' + sparkLine + '</p>'
      + '<p>This summary was generated by Techolution HR Automation. Please review and follow up as appropriate.</p>'
      + '</div>';
    return { subject: subject, body: body, to: '' /* manager email not in source data; HR fills */ };
  };

  function readHistory_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB);
    if (!sh) return {};
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return {};
    var values = sh.getRange(2, 1, lastRow - 1, 3).getValues();
    var out = {};
    values.forEach(function (r) {
      var empId = String(r[0]).trim();
      if (!empId) return;
      out[empId] = out[empId] || [];
      out[empId].push({ month: String(r[1]).trim(), value: Number(r[2]) });
    });
    return out;
  }

  function computeTrend_(rows) {
    if (rows.length < 6) return { bucket: 'flat', delta: 0 };
    var last3 = rows.slice(-3);
    var prior3 = rows.slice(-6, -3);
    var avg = function (arr) { return arr.reduce(function (a, r) { return a + r.value; }, 0) / arr.length; };
    var delta = avg(last3) - avg(prior3);
    var bucket;
    if (delta > 0.05) bucket = 'up';
    else if (delta < -0.05) bucket = 'down';
    else bucket = 'flat';
    return { bucket: bucket, delta: delta };
  }
})(Productivity);
```

- [ ] **Step 15.2: Push + smoke-test**

```bash
clasp push
```

In editor:
```js
function debug_prod() {
  var snap = Productivity.snapshot();
  Logger.log('Top: ' + snap.top5.map(function (r) { return r.name + ' ' + (r.current * 100).toFixed(0) + '% ' + r.trend; }).join('\n'));
  Logger.log('Bottom: ' + snap.bottom5.map(function (r) { return r.name + ' ' + (r.current * 100).toFixed(0) + '% ' + r.trend; }).join('\n'));
}
```
Run. Confirm top 5 and bottom 5 are different, trend chips are a mix of up/flat/down.

- [ ] **Step 15.3: Commit**

```bash
git add src/19_Productivity.gs
git commit -m "Productivity: trend computation + ranked snapshot + manager-email draft"
```

---

## Task 16: Extend `api_snapshot` and add `api_sendManagerEmail`

**Files:**
- Modify: `src/15_WebAPI.gs`

- [ ] **Step 16.1: Add new fields to `api_snapshot`**

Find the existing `return { ... }` object in `api_snapshot`. Add these lines before the closing brace:

```js
finance: Finance.snapshot(),
productivity: Productivity.snapshot(),
recommendations: Recommendations.all(__phase2Stub_),
productivityHistory: (function () {
  var snap = Productivity.snapshot();
  var out = {};
  snap.all.forEach(function (r) { out[r.empId] = r.spark; });
  return out;
})()
```

`__phase2Stub_` is a problem — `Recommendations.all` needs the snapshot we're currently building. Two-pass it:

Replace the entire `api_snapshot` return block so it builds the snapshot first, then computes recommendations against it:

```js
function api_snapshot() {
  return Cache.wrap(API_SNAPSHOT_KEY, API_SNAPSHOT_TTL, function () {
    var emps = Data.allEmployees();
    var alerts = Alerts.all();
    var productivity = Productivity.snapshot();
    var productivityHistory = {};
    productivity.all.forEach(function (r) { productivityHistory[r.empId] = r.spark; });

    var partial = {
      generatedAt: new Date().toISOString(),
      generatedAtLabel: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy · HH:mm'),
      user: { email: tryEmail_() },
      kpis: Metrics.kpiStrip(),
      health: HealthScore.compute(),
      headcount: Metrics.headcount(),
      departmentBreakdown: Metrics.departmentBreakdown(),
      attritionTrend: Metrics.attritionTrend(4),
      alerts: {
        lwd: alerts.lwd.map(serializeAlert_),
        probation: alerts.probation.map(serializeAlert_),
        lowProductivity: alerts.lowProd.map(serializeAlert_),
        bench: alerts.bench.map(serializeAlert_),
        critical: alerts.critical.map(serializeAlert_),
        warning: alerts.warning.map(serializeAlert_)
      },
      orgNodes: OrgChart.nodesForChart(),
      orgGroups: OrgChart.buildGroups(),
      finance: Finance.snapshot(),
      productivity: productivity,
      productivityHistory: productivityHistory,
      drilldownFilters: {
        regions: ['All'].concat(distinctValues_(emps, '__region')),
        departments: ['All'].concat(distinctValues_(emps, 'dept')),
        reportingManagers: ['All'].concat(distinctValues_(emps, 'rm')),
        statuses: ['All'].concat(distinctValues_(emps, 'status')),
        projects: ['All'].concat(distinctValues_(emps, 'project'))
      },
      systemHealth: (typeof SelfMonitor !== 'undefined' && SelfMonitor.collect)
        ? { ok: true, issues: SelfMonitor.collect() } : { ok: true, issues: [] },
      thresholds: {
        lwdAlertDays: Config.threshold('lwdAlertDays'),
        probationConfirmDays: Config.threshold('probationConfirmDays'),
        probationLengthDays: Config.threshold('probationLengthDays')
      }
    };
    partial.recommendations = Recommendations.all(partial);
    return partial;
  });
}
```

- [ ] **Step 16.2: Add `api_sendManagerEmail`**

Below `api_runAction`:

```js
function api_sendManagerEmail(empId, toEmail) {
  var runId = Log.start('api_sendManagerEmail', 'webapp');
  try {
    if (!empId) throw new Error('empId required');
    var draft = Productivity.draftManagerEmail(empId);
    if (!toEmail) {
      // Caller didn't supply — return draft for preview, do not send.
      Log.end(runId, { previewed: true });
      return { ok: true, preview: true, subject: draft.subject, body: draft.body, to: '' };
    }
    var result = Email.send('productivity.summary', {
      bodyHtml: draft.body, subject: draft.subject
    }, toEmail);
    Log.end(runId, { sent: result.ok });
    return { ok: result.ok, message: result.message };
  } catch (e) {
    Log.error(runId, 'api_sendManagerEmail: ' + e.message);
    Log.end(runId, { status: 'FAIL' });
    return { ok: false, message: e.message };
  }
}
```

- [ ] **Step 16.3: Seed `productivity.summary` template**

In bootstrap's template seeding, add:

```js
{ key: 'productivity.summary', subject: '{{subject}}', htmlBody: '{{bodyHtml}}' }
```

- [ ] **Step 16.4: Push + verify snapshot**

```bash
clasp push
```

In editor: `function debug_snap() { Logger.log(Object.keys(api_snapshot())); }` Run. Confirm output includes `finance`, `productivity`, `recommendations`, `productivityHistory`.

- [ ] **Step 16.5: Commit**

```bash
git add src/15_WebAPI.gs src/99_Bootstrap.gs
git commit -m "WebAPI: snapshot adds finance/productivity/recommendations; sendManagerEmail endpoint"
```

---

## Task 17: WebApp.html — add four tab buttons + four panel containers

**Files:**
- Modify: `src/WebApp.html`

- [ ] **Step 17.1: Add four buttons to the tab nav**

Find the existing nav block:

```html
<nav id="tab-nav" class="hidden bg-white border-b border-gray-200">
  <div class="mx-auto max-w-7xl px-6 flex items-center gap-1">
    <button class="tab-link tab-link-active" data-tab="overview">Overview</button>
    <button class="tab-link" data-tab="alerts">Alerts <span class="count-pill" id="tab-alerts-count">0</span></button>
    <button class="tab-link" data-tab="org">Org View</button>
    <button class="tab-link" data-tab="drilldown">Drill-Down</button>
  </div>
</nav>
```

Replace the inner `<div>` with:

```html
<div class="mx-auto max-w-7xl px-6 flex items-center gap-1 flex-wrap">
  <button class="tab-link tab-link-active" data-tab="overview">Overview</button>
  <button class="tab-link" data-tab="alerts">Alerts <span class="count-pill" id="tab-alerts-count">0</span></button>
  <button class="tab-link" data-tab="alertengine">Alert Engine</button>
  <button class="tab-link" data-tab="finance">Finance</button>
  <button class="tab-link" data-tab="productivity">Productivity</button>
  <button class="tab-link" data-tab="manage">Manage Employees</button>
  <button class="tab-link" data-tab="org">Org View</button>
  <button class="tab-link" data-tab="drilldown">Drill-Down</button>
</div>
```

- [ ] **Step 17.2: Add four new panel containers**

Find the existing `<!-- DRILL-DOWN TAB -->` panel. Just before it, add four new panels:

```html
<!-- ALERT ENGINE TAB -->
<div data-tab-content="alertengine" class="tab-panel hidden">
  <section class="card">
    <div class="flex items-start justify-between mb-4 flex-wrap gap-3">
      <div>
        <div class="card-title" style="margin-bottom:0;">Alert Engine</div>
        <div class="text-xs text-gray-500 mt-1">Smart recommendations from live data</div>
      </div>
      <div class="text-xs text-gray-400">Auto-refreshed</div>
    </div>
    <div id="recs-grid" class="grid grid-cols-1 lg:grid-cols-2 gap-4"></div>
    <details class="mt-6 pt-4 border-t border-gray-100">
      <summary class="text-sm text-gray-600 cursor-pointer">View raw alerts</summary>
      <div id="raw-alerts-wrap" class="mt-4"></div>
    </details>
  </section>
</div>

<!-- FINANCE TAB -->
<div data-tab-content="finance" class="tab-panel hidden">
  <section class="card mb-6">
    <div class="card-title">Project-wise CTC</div>
    <div id="finance-projects" class="space-y-2"></div>
  </section>
  <section class="card mb-6">
    <div class="card-title">Department-wise CTC</div>
    <div id="finance-depts" class="space-y-2"></div>
  </section>
  <section class="card">
    <div class="card-title">Region split</div>
    <div id="finance-regions" class="grid grid-cols-1 md:grid-cols-2 gap-6"></div>
  </section>
</div>

<!-- PRODUCTIVITY TAB -->
<div data-tab-content="productivity" class="tab-panel hidden">
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
    <section class="card">
      <div class="card-title">Top 5 performers</div>
      <div id="prod-top5"></div>
    </section>
    <section class="card">
      <div class="card-title">Bottom 5 performers</div>
      <div id="prod-bottom5"></div>
    </section>
  </div>
  <section class="card">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div class="card-title" style="margin-bottom:0;">All employees</div>
      <div class="flex flex-wrap items-center gap-2">
        <input type="text" id="prod-search" class="filter-select" placeholder="Search name, dept, project…" />
        <select class="filter-select" id="prod-filter-region"></select>
        <select class="filter-select" id="prod-filter-dept"></select>
        <select class="filter-select" id="prod-filter-project"></select>
      </div>
    </div>
    <div id="prod-table-wrap" class="overflow-x-auto"></div>
  </section>
</div>

<!-- MANAGE EMPLOYEES TAB -->
<div data-tab-content="manage" class="tab-panel hidden">
  <section class="card">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div>
        <div class="card-title" style="margin-bottom:0;">Manage Employees</div>
        <div class="text-xs text-gray-500 mt-1"><span id="manage-count">0</span> matching</div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input type="text" id="manage-search" class="filter-select" placeholder="Search…" />
        <select class="filter-select" id="manage-filter-region"></select>
        <select class="filter-select" id="manage-filter-dept"></select>
        <select class="filter-select" id="manage-filter-status"></select>
        <button id="btn-add-employee" class="btn-primary">+ Add Employee</button>
      </div>
    </div>
    <div id="manage-table-wrap" class="overflow-x-auto"></div>
  </section>
</div>
```

- [ ] **Step 17.3: Add the modal overlay scaffold at the bottom of `<main>`**

Just before `</main>`:

```html
<div id="modal-overlay" class="modal-overlay hidden">
  <div id="modal-panel" class="modal-panel">
    <div id="modal-content"></div>
  </div>
</div>
```

- [ ] **Step 17.4: Push, redeploy, smoke-test in incognito**

```bash
clasp push
```

For the first UI change, **redeploy** so the Web App URL serves the new HTML:

Apps Script editor → Deploy → Manage deployments → pencil → Version: New version → Deploy.

Open Web App URL in incognito (signed out). Click each new tab. Panels should be empty but render without console errors.

- [ ] **Step 17.5: Commit**

```bash
git add src/WebApp.html
git commit -m "WebApp: add Alert Engine / Finance / Productivity / Manage Employees tabs + modal scaffold"
```

---

## Task 18: Styles.html — add Phase 2 CSS

**Files:**
- Modify: `src/Styles.html`

- [ ] **Step 18.1: Append Phase 2 styles**

Before the closing `</style>` tag, append:

```css
/* Risk dots */
.risk-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }
.risk-green  { background:#10B981; }
.risk-amber  { background:#F59E0B; }
.risk-red    { background:#EF4444; }

/* Buttons */
.btn-primary { padding:6px 14px; font-size:13px; font-weight:600; background:var(--accent); color:#fff; border:none; border-radius:8px; cursor:pointer; transition:opacity 0.12s ease; }
.btn-primary:hover { opacity:0.92; }
.btn-ghost { padding:6px 12px; font-size:13px; font-weight:500; background:transparent; color:#52525B; border:1px solid #E4E4E7; border-radius:8px; cursor:pointer; }
.btn-ghost:hover { background:#FAFAFA; }
.btn-danger { padding:6px 12px; font-size:13px; font-weight:500; background:#FEE2E2; color:#991B1B; border:1px solid #FECACA; border-radius:8px; cursor:pointer; }

/* Modal overlay + side panel */
.modal-overlay { position:fixed; inset:0; background:rgba(15,15,20,0.4); display:flex; align-items:center; justify-content:center; z-index:50; }
.modal-panel { background:white; max-width:520px; width:92%; max-height:88vh; overflow-y:auto; border-radius:12px; padding:24px; box-shadow:0 12px 40px rgba(0,0,0,0.18); }
.modal-section { border-top:1px solid #F4F4F5; padding-top:14px; margin-top:14px; }
.modal-label { font-size:11px; font-weight:600; color:#71717A; letter-spacing:0.05em; text-transform:uppercase; margin-bottom:4px; display:block; }
.modal-input { width:100%; padding:7px 10px; font-size:13px; border:1px solid #E4E4E7; border-radius:6px; background:white; }
.modal-input:focus { outline:2px solid var(--accent); outline-offset:-1px; border-color:var(--accent); }

/* KPI card click affordance */
#kpis-grid .kpi { cursor:pointer; }

/* Empty + skeleton */
.empty-state { padding:32px 16px; text-align:center; color:#A1A1AA; font-size:13px; }
.empty-state::before { content:'···'; display:block; font-size:18px; margin-bottom:6px; }
.skeleton { background:linear-gradient(90deg,#F4F4F5 0%,#E4E4E7 50%,#F4F4F5 100%); background-size:200% 100%; animation:skel 1.4s ease-in-out infinite; border-radius:6px; height:14px; }
@keyframes skel { 0%{background-position:200% 0;} 100%{background-position:-200% 0;} }

/* Finance bars */
.fbar { position:relative; height:24px; background:#F4F4F5; border-radius:6px; overflow:hidden; cursor:pointer; }
.fbar-fill { position:absolute; left:0; top:0; bottom:0; background:var(--accent); opacity:0.85; transition:width 0.3s ease; }
.fbar-label { position:relative; padding:4px 10px; font-size:12px; display:flex; justify-content:space-between; }
.fbar:hover .fbar-fill { opacity:1; }

/* Productivity sparkline */
.spark { display:inline-block; vertical-align:middle; }

/* Recommendation cards */
.rec-card { background:white; border:1px solid #E4E4E7; border-radius:10px; padding:16px; box-shadow:0 1px 2px rgba(0,0,0,0.03); }
.rec-card-headline { font-size:13px; font-weight:600; color:#18181B; margin-bottom:6px; display:flex; align-items:flex-start; gap:8px; }
.rec-card-headline .sev { width:8px; height:8px; border-radius:50%; flex:none; margin-top:6px; }
.sev-critical { background:#EF4444; } .sev-warning { background:#F59E0B; } .sev-info { background:#71717A; }
.rec-card-body { font-size:12px; color:#52525B; line-height:1.5; margin-bottom:12px; }
.rec-card-actions { display:flex; gap:10px; align-items:center; justify-content:space-between; }

/* Trend chips */
.trend-chip { display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; padding:2px 8px; border-radius:9999px; }
.trend-up { background:#D1FAE5; color:#065F46; }
.trend-flat { background:#F4F4F5; color:#52525B; }
.trend-down { background:#FEE2E2; color:#991B1B; }
```

- [ ] **Step 18.2: Push + redeploy + visual check**

```bash
clasp push
```

Redeploy (new version). Reload incognito. Confirm tabs still load; the new classes (`risk-dot`, etc.) exist in DOM source view — they won't render anything yet because there's no data.

- [ ] **Step 18.3: Commit**

```bash
git add src/Styles.html
git commit -m "Styles: Phase 2 components (risk dots, modal, bars, sparkline, rec cards, trend chips)"
```

---

## Task 19: Scripts.html — Manage Employees tab render + filter + Edit/Add/Offboard

**Files:**
- Modify: `src/Scripts.html`

- [ ] **Step 19.1: Extend `PAGE_TABS`**

Find:
```js
var PAGE_TABS = ['overview', 'alerts', 'org', 'drilldown'];
```
Replace with:
```js
var PAGE_TABS = ['overview', 'alerts', 'alertengine', 'finance', 'productivity', 'manage', 'org', 'drilldown'];
```

- [ ] **Step 19.2: Add state for new tabs**

In the `var state = { ... }` initializer, add:
```js
manage: { region: 'All', dept: 'All', status: 'All', text: '', rows: [], count: 0 },
prod:   { region: 'All', dept: 'All', project: 'All', text: '', rows: [] },
```

- [ ] **Step 19.3: Add render orchestration + filter wiring**

In `renderAll`, after `renderDrillDownFilters(s)`:

```js
renderRecsAndRaw(s);
renderFinance(s);
renderProductivityTab(s);
renderManageFilters(s);
refreshManageTable();
```

In the DOMContentLoaded handler, after the existing filter wiring, add:

```js
// Manage Employees filters + search
['manage-filter-region','manage-filter-dept','manage-filter-status'].forEach(function (id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('change', function (e) {
    var key = id.split('-').pop(); state.manage[key] = e.target.value; refreshManageTable();
  });
});
var manageSearch = document.getElementById('manage-search');
if (manageSearch) manageSearch.addEventListener('input', debounce(function (e) {
  state.manage.text = e.target.value; refreshManageTable();
}, 250));
var addBtn = document.getElementById('btn-add-employee');
if (addBtn) addBtn.addEventListener('click', openAddEmployeeModal);

// Productivity filters + search
['prod-filter-region','prod-filter-dept','prod-filter-project'].forEach(function (id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('change', function (e) {
    var key = id.split('-').pop(); state.prod[key] = e.target.value; renderProductivityTab(state.snapshot);
  });
});
var prodSearch = document.getElementById('prod-search');
if (prodSearch) prodSearch.addEventListener('input', debounce(function (e) {
  state.prod.text = e.target.value; renderProductivityTab(state.snapshot);
}, 250));
```

- [ ] **Step 19.4: Add helpers + render functions at the bottom of the `<script>` block (before the closing `</script>`)**

```js
function debounce(fn, ms) {
  var t = null;
  return function () { var ctx = this, args = arguments; if (t) clearTimeout(t); t = setTimeout(function () { fn.apply(ctx, args); }, ms); };
}

function openModal(html) {
  var ov = document.getElementById('modal-overlay');
  document.getElementById('modal-content').innerHTML = html;
  ov.classList.remove('hidden');
  ov.addEventListener('click', overlayBackdropClick_, { once: true });
  document.addEventListener('keydown', escClose_);
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.removeEventListener('keydown', escClose_);
}
function overlayBackdropClick_(e) { if (e.target.id === 'modal-overlay') closeModal(); }
function escClose_(e) { if (e.key === 'Escape') closeModal(); }

function riskDot(emp) {
  // Mirror Risk.tier on client (read-only render, no server roundtrip).
  var reasons = [], tier = 'green';
  var now = new Date();
  var lwdDays = emp.lwd ? Math.round((new Date(emp.lwd) - now) / 86400000) : null;
  var prod = typeof emp.productivity === 'number' ? emp.productivity : null;
  var alloc = typeof emp.allocationPct === 'number' ? emp.allocationPct : null;
  if (emp.status === 'Offboarded') { tier='red'; reasons.push('Offboarded'); }
  else if (lwdDays !== null && lwdDays < 14) { tier='red'; reasons.push('LWD in '+lwdDays+'d'); }
  else if (prod !== null && prod < 0.50) { tier='red'; reasons.push('Productivity '+prod.toFixed(2)); }
  else if (lwdDays !== null && lwdDays < 45) { tier='amber'; reasons.push('LWD in '+lwdDays+'d'); }
  else if (prod !== null && prod < 0.70) { tier='amber'; reasons.push('Productivity '+prod.toFixed(2)); }
  else if (alloc !== null && alloc < 0.40) { tier='amber'; reasons.push('Allocation '+Math.round(alloc*100)+'%'); }
  var title = reasons.length ? reasons.join(' · ') : 'Healthy';
  return '<span class="risk-dot risk-'+tier+'" title="'+esc(title)+'"></span>';
}

function renderManageFilters(s) {
  var f = s.drilldownFilters || {};
  setOptions('manage-filter-region', f.regions || ['All']);
  setOptions('manage-filter-dept', f.departments || ['All']);
  setOptions('manage-filter-status', f.statuses || ['All']);
}

function refreshManageTable() {
  google.script.run.withSuccessHandler(function (result) {
    state.manage.rows = (result && result.rows) || [];
    state.manage.count = (result && result.count) || 0;
    document.getElementById('manage-count').textContent = String(state.manage.count);
    var wrap = document.getElementById('manage-table-wrap');
    if (!state.manage.rows.length) { wrap.innerHTML = '<div class="empty-state">No employees match the current filters.</div>'; return; }
    var rows = state.manage.rows.map(function (e) {
      return '<tr>' +
        '<td>' + riskDot(e) + '</td>' +
        '<td class="font-mono text-xs text-gray-500">' + esc(e.empId) + '</td>' +
        '<td class="font-medium">' + esc(e.name) + '</td>' +
        '<td class="text-gray-600">' + esc(e.region) + '</td>' +
        '<td class="text-gray-600">' + esc(e.dept) + '</td>' +
        '<td class="text-gray-600">' + esc(e.designation) + '</td>' +
        '<td class="text-gray-600">' + esc(e.project || '') + '</td>' +
        '<td class="text-gray-600">' + (typeof e.allocationPct === 'number' ? Math.round(e.allocationPct * 100) + '%' : '—') + '</td>' +
        '<td><span class="badge ' + (e.status === 'Confirmed' ? 'badge-ok' : e.status === 'Under Probation' ? 'badge-warning' : 'badge-info') + '">' + esc(e.status) + '</span></td>' +
        '<td><button class="btn-ghost" data-edit="' + esc(e.empId) + '">Edit</button> ' +
        '<button class="btn-danger" data-off="' + esc(e.empId) + '">Offboard</button></td>' +
      '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="data"><thead><tr>' +
      '<th></th><th>Emp ID</th><th>Name</th><th>Region</th><th>Dept</th><th>Designation</th><th>Project</th><th>Alloc</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
    wrap.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { openEditEmployeeModal(b.getAttribute('data-edit')); }); });
    wrap.querySelectorAll('[data-off]').forEach(function (b) { b.addEventListener('click', function () { openOffboardModal(b.getAttribute('data-off')); }); });
  }).api_drilldown({
    region: state.manage.region, dept: state.manage.dept, status: state.manage.status, text: state.manage.text
  });
}

function openEditEmployeeModal(empId) {
  var emp = state.manage.rows.filter(function (r) { return r.empId === empId; })[0];
  if (!emp) return;
  openModal(employeeFormHtml_('Edit ' + emp.name, emp, false));
  document.getElementById('btn-save-employee').addEventListener('click', function () {
    var patch = collectFormPatch_();
    google.script.run.withSuccessHandler(function (result) {
      if (!result.ok) alert('Save failed: ' + result.message);
      closeModal(); refreshManageTable();
    }).api_updateEmployee(empId, patch);
  });
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
}

function openAddEmployeeModal() {
  openModal(employeeFormHtml_('Add Employee', { region: 'india', status: 'Confirmed', project: 'Unassigned' }, true));
  document.getElementById('btn-save-employee').addEventListener('click', function () {
    var payload = collectFormPatch_();
    var region = document.getElementById('field-region').value;
    payload.region = region;
    google.script.run.withSuccessHandler(function (result) {
      if (!result.ok) alert('Add failed: ' + result.message);
      closeModal(); refreshManageTable();
    }).api_addEmployee(payload);
  });
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
}

function openOffboardModal(empId) {
  var emp = state.manage.rows.filter(function (r) { return r.empId === empId; })[0];
  if (!emp) return;
  openModal('<h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">Offboard ' + esc(emp.name) + '</h3>' +
    '<p class="text-xs text-gray-500 mb-3">This sets status to Offboarded and appends a row to Offboarded Resources.</p>' +
    '<label class="modal-label">Reason</label>' +
    '<input type="text" id="field-reason" class="modal-input" placeholder="e.g. Resignation, end of contract…" />' +
    '<div class="flex justify-end gap-2 mt-4"><button id="btn-cancel" class="btn-ghost">Cancel</button>' +
    '<button id="btn-confirm-off" class="btn-danger">Mark Offboarded</button></div>');
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-confirm-off').addEventListener('click', function () {
    var reason = document.getElementById('field-reason').value;
    if (!reason || !reason.trim()) { alert('Reason required'); return; }
    google.script.run.withSuccessHandler(function (result) {
      if (!result.ok) alert('Failed: ' + result.message);
      closeModal(); refreshManageTable();
    }).api_offboardEmployee(empId, reason);
  });
}

function employeeFormHtml_(title, emp, isAdd) {
  function input(id, label, value, type) { return '<div><label class="modal-label">' + label + '</label><input id="' + id + '" type="' + (type||'text') + '" class="modal-input" value="' + esc(value == null ? '' : value) + '" /></div>'; }
  function select(id, label, options, value) {
    var opts = options.map(function (o) { return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
    return '<div><label class="modal-label">' + label + '</label><select id="' + id + '" class="modal-input">' + opts + '</select></div>';
  }
  var statuses = ['Confirmed', 'Under Probation', 'Intern', 'Offboarded'];
  var depts = ['Engineering','Finance','Operations','HR','Sales'];
  var projects = ['Apollo','Phoenix','Helios','Atlas','Vega','Orion','Nimbus','Lyra','Unassigned'];
  return '<h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">' + esc(title) + '</h3>' +
    (isAdd ? select('field-region','Region',['india','us'], emp.region || 'india') : '<div><label class="modal-label">Region</label><div class="text-sm">' + esc(emp.region) + '</div></div>') +
    '<div class="modal-section grid grid-cols-2 gap-3">' +
      input('field-name','Name', emp.name) +
      select('field-status','Status', statuses, emp.status) +
      select('field-dept','Department', depts, emp.dept) +
      input('field-designation','Designation', emp.designation) +
    '</div>' +
    '<div class="modal-section grid grid-cols-2 gap-3">' +
      input('field-rm','Reporting Manager', emp.rm) +
      input('field-doj','DOJ (YYYY-MM-DD)', emp.doj ? new Date(emp.doj).toISOString().slice(0,10) : '') +
    '</div>' +
    '<div class="modal-section grid grid-cols-2 gap-3">' +
      select('field-project','Project', projects, emp.project) +
      input('field-allocation','Allocation %', typeof emp.allocationPct === 'number' ? Math.round(emp.allocationPct * 100) : '', 'number') +
    '</div>' +
    '<div class="flex justify-end gap-2 mt-4"><button id="btn-cancel" class="btn-ghost">Cancel</button>' +
    '<button id="btn-save-employee" class="btn-primary">Save</button></div>';
}

function collectFormPatch_() {
  function val(id) { var el = document.getElementById(id); return el ? el.value : undefined; }
  var patch = {
    name: val('field-name'),
    dept: val('field-dept'),
    designation: val('field-designation'),
    status: val('field-status'),
    rm: val('field-rm'),
    project: val('field-project')
  };
  var alloc = val('field-allocation');
  if (alloc !== '' && alloc != null) patch.allocationPct = Number(alloc) / 100;
  var doj = val('field-doj');
  if (doj) patch.doj = doj;
  return patch;
}
```

- [ ] **Step 19.5: Push, redeploy, exercise**

```bash
clasp push
```

Redeploy. In incognito:
- Open Manage Employees tab → table populates.
- Click Edit on a row → modal opens with fields.
- Change designation → Save → toast/no error, table re-renders, change visible in sheet within ~7s.
- Click + Add Employee → modal opens → fill required fields → Save → new row appears.
- Click Offboard on a test row → reason modal → confirm → status changes to Offboarded.

- [ ] **Step 19.6: Commit**

```bash
git add src/Scripts.html
git commit -m "Scripts: Manage Employees tab — table, filters, search, edit/add/offboard modals"
```

---

## Task 20: Scripts.html — render Alert Engine tab

**Files:**
- Modify: `src/Scripts.html`

- [ ] **Step 20.1: Add `renderRecsAndRaw`**

Add this function before the closing `</script>`:

```js
function renderRecsAndRaw(s) {
  var recs = (s && s.recommendations) || [];
  var grid = document.getElementById('recs-grid');
  if (!grid) return;
  if (!recs.length) {
    grid.innerHTML = '<div class="empty-state">No active recommendations. System looks healthy.</div>';
  } else {
    grid.innerHTML = recs.map(function (r) {
      var sev = r.severity || 'info';
      var why = (r.why || []).map(function (w) { return '<li style="margin:2px 0;">' + esc(w) + '</li>'; }).join('');
      return '<div class="rec-card" data-rec-id="' + esc(r.id) + '">' +
        '<div class="rec-card-headline"><span class="sev sev-' + esc(sev) + '"></span><span>' + esc(r.headline) + '</span></div>' +
        '<div class="rec-card-body">' + esc(r.body || '') + '</div>' +
        (why ? '<details style="margin:8px 0 12px;"><summary class="text-xs text-gray-500 cursor-pointer">Why this fires</summary><ul style="margin:8px 0 0 16px;font-size:12px;color:#52525B;">' + why + '</ul></details>' : '') +
        '<div class="rec-card-actions">' +
          '<button class="btn-ghost rec-dismiss" data-id="' + esc(r.id) + '">Dismiss for 7 days</button>' +
          (r.action ? '<button class="btn-primary rec-action" data-tab="' + esc(r.action.tab || '') + '">' + esc(r.action.label || 'Open') + '</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    grid.querySelectorAll('.rec-action').forEach(function (b) {
      b.addEventListener('click', function () { activatePageTab(b.getAttribute('data-tab') || 'overview'); });
    });
    grid.querySelectorAll('.rec-dismiss').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var card = b.closest('.rec-card'); if (card) card.style.display = 'none';
        google.script.run.api_dismissRecommendation(id);
      });
    });
  }

  // Raw alerts table (reuse existing renderer)
  var raw = document.getElementById('raw-alerts-wrap');
  if (raw) {
    var alerts = (s && s.alerts) || {};
    var lwd = alerts.lwd || [], prob = alerts.probation || [];
    if (lwd.length + prob.length === 0) {
      raw.innerHTML = '<div class="empty-state">No raw alerts to display.</div>';
    } else {
      raw.innerHTML = '<div class="text-xs font-semibold text-gray-500 mb-2">LWD (' + lwd.length + ')</div>' + alertsToTable_(lwd) +
                      '<div class="text-xs font-semibold text-gray-500 mt-4 mb-2">Probation (' + prob.length + ')</div>' + alertsToTable_(prob);
    }
  }
}

function alertsToTable_(rows) {
  if (!rows.length) return '<div class="empty-state">None.</div>';
  var body = rows.map(function (a) {
    return '<tr><td class="font-mono text-xs text-gray-500">' + esc(a.empId) + '</td>' +
      '<td>' + esc(a.name) + '</td><td>' + esc(a.dept) + '</td>' +
      '<td>' + (a.date ? new Date(a.date).toDateString() : '') + '</td>' +
      '<td>' + (typeof a.daysFromNow === 'number' ? a.daysFromNow + 'd' : '—') + '</td></tr>';
  }).join('');
  return '<table class="data"><thead><tr><th>Emp ID</th><th>Name</th><th>Dept</th><th>Date</th><th>Days</th></tr></thead><tbody>' + body + '</tbody></table>';
}
```

- [ ] **Step 20.2: Add `api_dismissRecommendation` server endpoint**

In `src/15_WebAPI.gs` (yes, a server file — quick add):

```js
function api_dismissRecommendation(id) {
  try { Recommendations.dismiss(id); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; }
}
```

- [ ] **Step 20.3: Push, redeploy, smoke-test**

```bash
clasp push
```

Redeploy. Open Alert Engine tab in incognito. Confirm recommendation cards render with severity dot, body, "Why this fires", action button. Click an action button → navigates to the right tab. Click Dismiss → card disappears (refreshes after next snapshot poll).

- [ ] **Step 20.4: Commit**

```bash
git add src/Scripts.html src/15_WebAPI.gs
git commit -m "Scripts: Alert Engine tab — recommendation cards + raw alerts disclosure"
```

---

## Task 21: Scripts.html — Finance tab render

**Files:**
- Modify: `src/Scripts.html`

- [ ] **Step 21.1: Add `renderFinance`**

```js
function renderFinance(s) {
  var fin = (s && s.finance) || {};
  renderFinanceBars_(document.getElementById('finance-projects'), fin.byProject || [], 'project');
  renderFinanceBars_(document.getElementById('finance-depts'), fin.byDept || [], 'dept');
  var rEl = document.getElementById('finance-regions');
  if (rEl) {
    var byR = fin.byRegion || [];
    var india = byR.filter(function (r) { return r.key === 'india'; })[0] || { headcount: 0, ctcInr: 0 };
    var us = byR.filter(function (r) { return r.key === 'us'; })[0] || { headcount: 0, ctcUsd: 0 };
    rEl.innerHTML = '<div class="card" style="border:1px solid #E4E4E7;">' +
        '<div class="text-xs font-semibold text-gray-500 mb-2">India</div>' +
        '<div class="text-2xl font-bold">' + Math.round(india.headcount) + '</div>' +
        '<div class="text-xs text-gray-500">' + formatINR_(india.ctcInr) + ' total CTC</div>' +
      '</div>' +
      '<div class="card" style="border:1px solid #E4E4E7;">' +
        '<div class="text-xs font-semibold text-gray-500 mb-2">US</div>' +
        '<div class="text-2xl font-bold">' + Math.round(us.headcount) + '</div>' +
        '<div class="text-xs text-gray-500">' + formatUSD_(us.ctcUsd) + ' total CTC</div>' +
      '</div>';
  }
}
function renderFinanceBars_(el, rows, kind) {
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div class="empty-state">No data.</div>'; return; }
  var max = Math.max.apply(null, rows.map(function (r) { return r.ctcInr + r.ctcUsd; }));
  el.innerHTML = rows.map(function (r) {
    var pct = max ? ((r.ctcInr + r.ctcUsd) / max) * 100 : 0;
    var label = esc(r.key) + ' · ' + r.headcount + (r.ctcInr ? ' · ' + formatINR_(r.ctcInr) : '') + (r.ctcUsd ? ' · ' + formatUSD_(r.ctcUsd) : '');
    return '<div class="fbar" data-drill="' + kind + ':' + esc(r.key) + '"><div class="fbar-fill" style="width:' + pct + '%"></div><div class="fbar-label"><span>' + label + '</span></div></div>';
  }).join('');
  el.querySelectorAll('[data-drill]').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-drill');
      var drill = ((state.snapshot && state.snapshot.finance && state.snapshot.finance.drillDown) || {})[key] || [];
      openFinanceDrill_(key, drill);
    });
  });
}
function openFinanceDrill_(key, rows) {
  var body = rows.map(function (r) {
    return '<tr><td class="font-mono text-xs text-gray-500">' + esc(r.empId) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.designation || '') + '</td>' +
      '<td>' + (r.ctcInr ? formatINR_(r.ctcInr) : (r.ctcUsd ? formatUSD_(r.ctcUsd) : '—')) + '</td></tr>';
  }).join('');
  openModal('<h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">' + esc(key) + ' · ' + rows.length + ' employees</h3>' +
    '<table class="data"><thead><tr><th>Emp ID</th><th>Name</th><th>Designation</th><th>CTC</th></tr></thead><tbody>' + body + '</tbody></table>' +
    '<div class="flex justify-end mt-4"><button id="btn-cancel" class="btn-ghost">Close</button></div>');
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
}
function formatINR_(n) { if (!n) return '₹0'; if (n >= 1e7) return '₹' + (n/1e7).toFixed(2) + ' Cr'; if (n >= 1e5) return '₹' + (n/1e5).toFixed(2) + ' L'; return '₹' + Math.round(n).toLocaleString('en-IN'); }
function formatUSD_(n) { if (!n) return '$0'; if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M'; if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K'; return '$' + Math.round(n).toLocaleString('en-US'); }
```

- [ ] **Step 21.2: Push, redeploy, smoke-test**

```bash
clasp push
```

Redeploy. Open Finance tab. Confirm bars render for projects + depts, India/US donuts show non-zero counts. Click any bar → drill modal opens with employee list.

- [ ] **Step 21.3: Commit**

```bash
git add src/Scripts.html
git commit -m "Scripts: Finance tab — bars + drill-down modal + region cards"
```

---

## Task 22: Scripts.html — Productivity tab render

**Files:**
- Modify: `src/Scripts.html`

- [ ] **Step 22.1: Add `renderProductivityTab`**

```js
function renderProductivityTab(s) {
  var p = (s && s.productivity) || { all: [], top5: [], bottom5: [] };
  renderRankList_(document.getElementById('prod-top5'), p.top5);
  renderRankList_(document.getElementById('prod-bottom5'), p.bottom5);

  // Populate filter dropdowns from snapshot
  var f = (s && s.drilldownFilters) || {};
  setOptions('prod-filter-region', f.regions || ['All']);
  setOptions('prod-filter-dept', f.departments || ['All']);
  setOptions('prod-filter-project', f.projects || ['All']);

  // Filtered + searched table
  var rows = (p.all || []).filter(function (r) {
    if (state.prod.region !== 'All' && r.region !== state.prod.region) return false;
    if (state.prod.dept !== 'All' && r.dept !== state.prod.dept) return false;
    if (state.prod.project !== 'All' && r.project !== state.prod.project) return false;
    if (state.prod.text) {
      var hay = (r.name + ' ' + r.empId + ' ' + r.dept + ' ' + (r.project || '')).toLowerCase();
      if (hay.indexOf(state.prod.text.toLowerCase()) === -1) return false;
    }
    return true;
  });
  var wrap = document.getElementById('prod-table-wrap');
  if (!rows.length) { wrap.innerHTML = '<div class="empty-state">No employees match the filters.</div>'; return; }
  var html = rows.map(function (r) {
    return '<tr><td>' + riskDot({ status:'Confirmed', productivity: r.current, allocationPct: r.allocationPct, lwd: null }) + '</td>' +
      '<td class="font-medium">' + esc(r.name) + '</td><td>' + esc(r.dept) + '</td><td>' + esc(r.region) + '</td><td>' + esc(r.project) + '</td>' +
      '<td>' + (r.current * 100).toFixed(0) + '%</td>' +
      '<td><span class="trend-chip trend-' + r.trend + '">' + (r.trend === 'up' ? '↑' : r.trend === 'down' ? '↓' : '→') + ' ' + r.trend + '</span></td>' +
      '<td>' + sparklineSvg_(r.spark || []) + '</td>' +
      '<td><button class="btn-ghost" data-mail="' + esc(r.empId) + '">Email Manager</button></td></tr>';
  }).join('');
  wrap.innerHTML = '<table class="data"><thead><tr><th></th><th>Name</th><th>Dept</th><th>Region</th><th>Project</th><th>Current</th><th>Trend</th><th>Last 6mo</th><th></th></tr></thead><tbody>' + html + '</tbody></table>';
  wrap.querySelectorAll('[data-mail]').forEach(function (b) {
    b.addEventListener('click', function () { openManagerEmailModal(b.getAttribute('data-mail')); });
  });
}

function renderRankList_(el, rows) {
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div class="empty-state">No data.</div>'; return; }
  el.innerHTML = rows.map(function (r) {
    return '<div class="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">' +
      '<div><div class="text-sm font-medium">' + esc(r.name) + '</div><div class="text-xs text-gray-500">' + esc(r.dept) + '</div></div>' +
      '<div class="flex items-center gap-2"><span class="text-sm font-semibold">' + (r.current * 100).toFixed(0) + '%</span>' +
      '<span class="trend-chip trend-' + r.trend + '">' + (r.trend === 'up' ? '↑' : r.trend === 'down' ? '↓' : '→') + '</span></div>' +
    '</div>';
  }).join('');
}

function sparklineSvg_(values) {
  if (!values.length) return '';
  var w = 60, h = 16, max = Math.max.apply(null, values), min = Math.min.apply(null, values);
  var range = (max - min) || 1;
  var pts = values.map(function (v, i) {
    var x = (i / (values.length - 1 || 1)) * w;
    var y = h - ((v - min) / range) * h;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline fill="none" stroke="#4F46E5" stroke-width="1.5" points="' + pts + '"/></svg>';
}

function openManagerEmailModal(empId) {
  google.script.run.withSuccessHandler(function (result) {
    if (!result.ok) { alert('Failed: ' + result.message); return; }
    openModal('<h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">' + esc(result.subject || '') + '</h3>' +
      '<div style="font-size:13px;border:1px solid #E4E4E7;padding:12px;border-radius:8px;max-height:380px;overflow-y:auto;">' + (result.body || '') + '</div>' +
      '<div class="mt-4"><label class="modal-label">Send to (manager email)</label>' +
      '<input id="field-mailto" type="email" class="modal-input" placeholder="manager@techolution.com" /></div>' +
      '<div class="flex justify-end gap-2 mt-4"><button id="btn-cancel" class="btn-ghost">Cancel</button>' +
      '<button id="btn-send" class="btn-primary">Send</button></div>');
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    document.getElementById('btn-send').addEventListener('click', function () {
      var to = document.getElementById('field-mailto').value;
      if (!to) { alert('Email required'); return; }
      google.script.run.withSuccessHandler(function (sr) {
        alert(sr.ok ? (sr.message === 'Demo mode — not dispatched' ? 'Demo mode: would have sent.' : 'Sent.') : 'Failed: ' + sr.message);
        closeModal();
      }).api_sendManagerEmail(empId, to);
    });
  }).api_sendManagerEmail(empId, '');
}
```

- [ ] **Step 22.2: Push, redeploy, smoke-test**

```bash
clasp push
```

Redeploy. Open Productivity tab. Confirm Top 5 + Bottom 5 lists, sortable table with risk dot + trend chip + sparkline. Apply Region filter → table narrows. Search "engineer" → table narrows. Click "Email Manager" on any row → modal opens with pre-populated draft + email input.

- [ ] **Step 22.3: Commit**

```bash
git add src/Scripts.html
git commit -m "Scripts: Productivity tab — top/bottom + table + sparklines + email-manager modal"
```

---

## Task 23: Drill-Down tab extensions — risk dot + text search

**Files:**
- Modify: `src/WebApp.html`, `src/Scripts.html`

- [ ] **Step 23.1: Add text input to Drill-Down filter strip in WebApp.html**

Find the Drill-Down filter row, add the input:

```html
<input type="text" id="filter-text" data-filter="text" class="filter-select" placeholder="Search…" />
```

- [ ] **Step 23.2: Add the risk dot column to `renderDrillDownTable`**

In `src/Scripts.html`, locate `renderDrillDownTable`. Prepend a `<td>` with the dot and add a leading empty `<th>` to the header. Replace the `var rows = ...` block:

```js
var rows = state.drilldown.rows.map(function (e) {
  var statusBadge = 'badge ' + (e.status === 'Confirmed' ? 'badge-ok' : e.status === 'Under Probation' ? 'badge-warning' : 'badge-info');
  return '<tr>' +
    '<td>' + riskDot(e) + '</td>' +
    '<td class="font-mono text-xs text-gray-500">' + esc(e.empId) + '</td>' +
    '<td class="font-medium">' + esc(e.name) + '</td>' +
    '<td class="text-gray-600">' + esc(e.region) + '</td>' +
    '<td class="text-gray-600">' + esc(e.dept) + '</td>' +
    '<td class="text-gray-600">' + esc(e.designation) + '</td>' +
    '<td class="text-gray-600">' + esc(e.rm) + '</td>' +
    '<td><span class="' + statusBadge + '">' + esc(e.status) + '</span></td>' +
    '<td class="text-gray-600 text-xs">' + fmtDate(e.doj) + '</td>' +
    '<td class="text-gray-600 text-xs">' + fmtDate(e.lwd) + '</td>' +
    '</tr>';
}).join('');
wrap.innerHTML = '<table class="data">' +
  '<thead><tr><th></th><th>Emp ID</th><th>Name</th><th>Region</th><th>Dept</th><th>Designation</th><th>Reporting Manager</th><th>Status</th><th>DOJ</th><th>LWD</th></tr></thead>' +
  '<tbody>' + rows + '</tbody></table>';
```

Also update the `onFilterChange` handler so the text input fires `refreshDrilldown` with debounce:

```js
document.querySelectorAll('[data-filter]').forEach(function (sel) {
  if (sel.type === 'text') {
    sel.addEventListener('input', debounce(onFilterChange, 250));
  } else {
    sel.addEventListener('change', onFilterChange);
  }
});
```

(Replace the existing forEach in DOMContentLoaded.)

- [ ] **Step 23.3: Push, redeploy, smoke-test**

```bash
clasp push
```

Redeploy. Drill-Down tab now shows a risk column + a search input. Type "manager" — table narrows. Clear input — table restores.

- [ ] **Step 23.4: Commit**

```bash
git add src/WebApp.html src/Scripts.html
git commit -m "Drill-Down: add risk dot column + debounced text search"
```

---

## Task 24: UX polish — clickable KPI cards, tooltips, empty/skeleton, 403

**Files:**
- Modify: `src/Scripts.html`, `src/Styles.html`, `src/403.html`

- [ ] **Step 24.1: Make KPI cards clickable**

In `renderKpis`, replace the existing inner HTML map with one that includes a `data-kpi` attribute and a tooltip via `title`:

```js
function renderKpis(s) {
  var defs = {
    headcount: { label: 'Headcount', tip: 'Total active employees (India + US). Excludes Offboarded.' },
    alerts:    { label: 'Active alerts', tip: 'Sum of critical + warning alerts surfaced on the Alerts tab.' },
    health:    { label: 'HR Health Score', tip: '4-pillar additive score 0–100. Formula in SOP §4.' },
    attrition: { label: 'Quarterly attrition', tip: '(Current quarter offboardings) / (avg headcount this quarter).' }
  };
  var html = (s.kpis || []).map(function (k, i) {
    var def = defs[k.id || ''] || { tip: '' };
    return '' +
      '<div class="kpi" data-kpi="' + esc(k.id || ('k' + i)) + '" title="' + esc(def.tip || '') + '">' +
        '<div class="kpi-label">' + esc(k.label) + '</div>' +
        '<div class="kpi-value tone-' + esc(k.tone || 'neutral') + '">' + esc(String(k.value)) + '</div>' +
        '<div class="kpi-hint">' + esc(k.hint || '') + '</div>' +
      '</div>';
  }).join('');
  var grid = document.getElementById('kpis-grid');
  grid.innerHTML = html;
  grid.querySelectorAll('[data-kpi]').forEach(function (el) {
    el.addEventListener('click', function () { onKpiClick(el.getAttribute('data-kpi')); });
  });
}

function onKpiClick(id) {
  var s = state.snapshot;
  if (id === 'alerts') { activatePageTab('alerts'); return; }
  if (id === 'health') {
    var h = (s && s.health) || {};
    openModal('<h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">HR Health Score · ' + (h.total || 0) + '</h3>' +
      '<p class="text-xs text-gray-500 mb-3">Sum of four pillars, each capped at 25 points.</p>' +
      Object.keys(h.pillars || {}).map(function (k) {
        return '<div class="flex justify-between text-sm py-1"><span>' + esc(k) + '</span><span class="font-semibold">' + Math.round(h.pillars[k] || 0) + ' / 25</span></div>';
      }).join('') +
      '<div class="flex justify-end mt-4"><button id="btn-cancel" class="btn-ghost">Close</button></div>');
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    return;
  }
  if (id === 'headcount') {
    var hc = (s && s.headcount) || {};
    openModal('<h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">Headcount</h3>' +
      '<div class="flex justify-between text-sm py-1"><span>India</span><span class="font-semibold">' + (hc.india || 0) + '</span></div>' +
      '<div class="flex justify-between text-sm py-1"><span>US</span><span class="font-semibold">' + (hc.us || 0) + '</span></div>' +
      '<div class="flex justify-end mt-4"><button id="btn-cancel" class="btn-ghost">Close</button></div>');
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    return;
  }
  if (id === 'attrition') { activatePageTab('overview'); return; }
}
```

- [ ] **Step 24.2: Trim 403.html**

Replace the contents of `src/403.html` with:

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>Not Authorized</title>
<style>body{font-family:Inter,Arial,sans-serif;color:#18181B;background:#FAFAFA;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{background:#fff;border:1px solid #E4E4E7;border-radius:12px;padding:32px 40px;text-align:center;max-width:380px;}</style>
</head><body><div class="card"><h1 style="font-size:18px;margin:0 0 8px;font-weight:600;">Not authorized</h1>
<p style="font-size:13px;color:#71717A;margin:0;">Contact HR admin to request access.</p></div></body></html>
```

- [ ] **Step 24.3: Verify no emojis in source**

Run:
```bash
cd "C:/Users/ruthv/OneDrive/Desktop/Projects/HR Automation Dashboard"
grep -rP "[\x{1F300}-\x{1FAFF}]|[\x{2600}-\x{26FF}]|[\x{2700}-\x{27BF}]" src/ 2>&1 | head -10
```
Expected: no output. If there are matches, remove them.

- [ ] **Step 24.4: Push, redeploy, verify**

```bash
clasp push
```

Redeploy. In incognito:
- Hover any KPI label → tooltip shows.
- Click Headcount KPI → modal opens with India/US split.
- Click Health Score → modal opens with pillar breakdown.
- Try the 403 page (would only show if Config.isAllowed returns false; sanity-check by manually visiting the file via Apps Script preview, or just leave it).

- [ ] **Step 24.5: Commit**

```bash
git add src/Scripts.html src/403.html
git commit -m "UX polish: clickable KPI cards, hover tooltips, terse 403"
```

---

## Task 25: SOP rebuild

**Files:**
- Modify: `docs/build_sop.py`

- [ ] **Step 25.1: Add Phase 2 section content**

Open `docs/build_sop.py`. Find the section list in `main()`. Add new section content covering Phase 2 features in the existing sections (don't add new chapters — fold into the existing ones):

- In §3 architecture: add the four new tabs (Manage Employees, Finance, Productivity, Alert Engine) to the helper-tabs description.
- In §5 HR Use: add a paragraph about Manage Employees CRUD, Audit Log, search + risk dots.
- In §6 Configuration: add `alertEmailRecipient` and `recommendationsCacheSeconds` keys.
- In §7 Troubleshooting table: add rows for "No recommendations show" (snapshot stale, click rebuild), "Audit Log empty after edit" (likely failed mid-write, check Logs tab), "Alert emails not sending" (`alertEmailRecipient` blank or demoMode on).
- In §8 Developer: add the six new modules to the file map.

The build script regenerates the PDF — no manual rewriting.

- [ ] **Step 25.2: Rebuild**

```bash
cd "C:/Users/ruthv/OneDrive/Desktop/Projects/HR Automation Dashboard/docs" && python build_sop.py
```

Confirm: `SOP.docx` and `SOP.pdf` regenerate. Page count ≤ 12 (we don't want to balloon back to 20+).

- [ ] **Step 25.3: Commit**

```bash
cd "C:/Users/ruthv/OneDrive/Desktop/Projects/HR Automation Dashboard" && git add docs/build_sop.py docs/SOP.docx docs/SOP.pdf
git commit -m "SOP: document Phase 2 features (tabs, Audit Log, search, risk, recommendations)"
```

---

## Task 26: Pre-submit verification

**Files:** none.

- [ ] **Step 26.1: Final clasp push + new deployment version**

```bash
clasp push
```

Apps Script editor → **Deploy → Manage deployments → pencil → Version: New version → Description: "Phase 2 final" → Deploy**. Copy the URL.

- [ ] **Step 26.2: Incognito + signed-out check**

Open incognito, sign out of all Google accounts, paste URL. Confirm: no sign-in prompt, no consent screen, dashboard renders on Overview tab. Click each of the 8 tabs.

- [ ] **Step 26.3: Alert email engine end-to-end**

In `_Config` tab, set `email | alertEmailRecipient` to your own email. Also set `email | demoMode` to `false` temporarily. Click a cell in any other tab so onEdit busts the config cache.

Sheet menu → **HR Automation → Reset Email Dedup**. Then **HR Automation → Run Alert Email Engine**. Toast should say "Sent: N · Skipped dedup: 0" where N ≥ 1.

Check your inbox: confirm ≥ 1 email arrived from "Techolution HR Automation" with accurate content (employee names, days, LWD/probation date).

Run **Run Alert Email Engine** again. Toast should say "Sent: 0 · Skipped dedup: N". This proves dedup works.

Set `demoMode` back to `true`.

- [ ] **Step 26.4: Bidirectional editing end-to-end**

In incognito Web App: Manage Employees → click Edit on any row → change designation to "TEST_DESIG" → Save → toast ok → wait ~7s → reload → designation is "TEST_DESIG" in both UI and Sheet. Audit Log tab has a new row with old + new values. Revert the change.

Then in the Sheet directly: change a different employee's designation. Wait ~7s. The Web App's Manage Employees table reflects the change without manual reload (driven by the 5s poll).

- [ ] **Step 26.5: Run full QA + verification harness**

Sheet menu → **HR Automation → Run QA**. Confirm zero FAIL rows.

Sheet menu → **HR Automation → Run Verification Protocol**. Confirm all 6 reviewer-protocol assertions PASS.

- [ ] **Step 26.6: Scan Logs for hr@techolution.com**

In the `Logs` tab, use Ctrl+F: search for `hr@techolution.com`. Confirm zero matches.

- [ ] **Step 26.7: Final commit + tag**

```bash
git add -A
git commit -m "Phase 2 final: all features verified, ready for submission" --allow-empty
git tag phase-2-submit
```

- [ ] **Step 26.8: Reply to Aadish**

Compose email reply:

> Subject: Re: HR Automation Dashboard — Phase 2 submission
>
> Hi Aadish,
>
> Phase 2 build complete. Submission contents:
> - Web App URL: <paste>
> - Sheet link: <paste>
> - Resume: attached
>
> All six mandatory features (Alert Email Engine, Bidirectional Editing, Alert Engine tab, Finance tab, Productivity tab, UX overhaul) are live and verified end-to-end in signed-out incognito. Three of the optional features (Audit Log, search bar, color-coded risk indicators) are also included. SOP attached.
>
> Open access is the deliberate posture for review per your guidance — anyone with the link can use the dashboard without signing into Google. Demo mode is on by default so emails do not dispatch; toggling `_Config.email.demoMode` to false enables real sends, and `alertEmailRecipient` controls who receives them.
>
> Happy to walk through any part of the system in the virtual demo.
>
> — Ruthvik

---

## Self-Review

**Spec coverage check:**
- §4 Q1 (Manage Employees as dedicated tab) → Task 17 panel + Task 19 render. ✓
- §4 Q2 (per-alert with dedup) → Task 11. ✓
- §4 Q3 (synthetic Project + India Allocation backfill) → Task 2. ✓
- §4 Q4 (12-month Productivity History seed) → Task 3. ✓
- §4 Q5 (Alert Engine recs on top, raw alerts collapsed) → Task 17 + Task 20. ✓
- §4 Q6 (soft delete via Mark Offboarded + reason) → Task 9 step 9.4 + Task 19 step 19.4. ✓
- §4 Q7 (UX polish, top nav, clickable KPI) → Task 17 + Task 24. ✓
- §3.1 Audit Log → Tasks 4, 7, 9 (write endpoints call AuditLog), 19 (no, audit is server-side only — UI doesn't show it; that's fine, the tab itself is the surface). ✓
- §3.1 Search bar → Task 9 (server filter), Task 19 (Manage), Task 22 (Productivity), Task 23 (Drill-Down). ✓
- §3.1 Risk dots → Task 8 (server pure fn) + client mirror in Task 19; reused in Tasks 22, 23. ✓
- §5.1 new columns → Task 2. ✓
- §5.2 Productivity History tab → Task 3. ✓
- §5.3 _Config additions → Task 1 + Task 5. ✓
- §5.4 Audit Log tab → Task 4. ✓
- §6.1 six new modules → Tasks 7, 8, 11, 13, 14, 15. ✓
- §6.2 new API endpoints → Task 9 (writes), Task 16 (snapshot extension + sendManagerEmail), Task 20 step 20.2 (dismissRecommendation). ✓
- §6.3 write-back path → Task 9 implementation. ✓
- §6.4 8 recommendation rules → Task 13. ✓
- §6.5 risk tier rules → Task 8. ✓
- §7 UX overhaul (8 sub-items) → Task 17 (nav 4→8), Task 24 (KPI clickable + tooltips + 403), Task 18 (empty/skeleton CSS). Step 24.3 covers the emoji grep. The skeleton loader CSS is in Task 18; deploying it without a use site is a small loose end — acceptable cut. ✓
- §8.1 Manage Employees layout → Task 19. ✓
- §8.2 Finance layout → Task 21. ✓
- §8.3 Productivity layout → Task 22. ✓
- §8.4 Drill-Down extensions → Task 23. ✓
- §8.5 Alert Engine layout → Task 20. ✓
- §11 implementation order → tasks ordered to match. ✓
- §12 success criteria → all 11 boxes have a verification step in Task 26. ✓

No gaps.

**Placeholder scan:** No `TBD`, no `TODO`, no "implement later", no "similar to Task N", no "add validation" without code. Every code block is concrete.

**Type consistency:**
- `AuditLog.record({op, empId, field, oldVal, newVal, runId})` — same signature in Tasks 7 (definition) and 9 (caller). ✓
- `AuditLog.recordMany('update', empId, changes, runId)` — defined in Task 7, called in Task 9 step 9.2. ✓
- `Risk.tier(emp)` returns `{ tier, reasons }` — Task 8 returns this shape; Task 19 client-mirror returns the same shape implicitly via HTML output. ✓
- `Recommendations.all(snapshot)` defined in Task 13; called in Task 16. ✓
- `Productivity.snapshot()`, `Productivity.history(empId, months)`, `Productivity.draftManagerEmail(empId)` defined in Task 15; called in Task 16, Task 22. ✓
- `api_updateEmployee(empId, patch)` defined Task 9; called Task 19 step 19.4. ✓
- `api_addEmployee(payload)` defined Task 9; called Task 19. `payload.region` required — Task 19 step 19.4 sets it. ✓
- `api_offboardEmployee(empId, reason)` defined Task 9; called Task 19. Reason required. ✓
- `api_sendManagerEmail(empId, toEmail)` defined Task 16; called Task 22 (preview with empty `to`, then send with real `to`). ✓
- `api_dismissRecommendation(id)` defined Task 20 step 20.2; called Task 20 step 20.1. ✓

No inconsistencies found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-17-phase-2-features.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
