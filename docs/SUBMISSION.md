# Submission checklist & walkthrough

Use this document as a step-by-step playbook to get from local code → shipped submission email. Every checkbox maps to a brief §6 or §7 requirement.

---

## Step 0 — Pre-flight (5 min)

- [ ] You're signed into the Google account you'll submit from: **`ruthviknagulapally@gmail.com`**.
- [ ] The work copy of the sheet is a **native Google Sheet** (URL `/d/<44-char-id>/edit`, no `.XLSX` badge next to the filename).
- [ ] Current sheet URL: `https://docs.google.com/spreadsheets/d/1Tt2w9lxFn8FhmdkRhs1LMxjL9-zcd4M0odqeS-buZ0s/edit`.
- [ ] Local project lives at `C:\Users\ruthv\OneDrive\Desktop\Projects\HR Automation Dashboard\` and `src/` has 16 `.gs` files + 8 `.html` files + `appsscript.json`.

---

## Step 1 — Get code into the Apps Script editor (10 min)

### Option A — via `clasp` (recommended)

```bash
npm install -g @google/clasp
clasp login
# Open the sheet → Extensions → Apps Script
# Copy the script ID from the editor URL: .../projects/<SCRIPT_ID>/edit
# Paste it into .clasp.json (replace PASTE_YOUR_SCRIPT_ID_HERE)
cd "C:/Users/ruthv/OneDrive/Desktop/Projects/HR Automation Dashboard"
clasp push   # type `y` if it warns about overwriting the manifest
```

### Option B — Copy-paste

Open the Apps Script editor (Extensions → Apps Script). For each file in `src/`:
1. Files panel → `+` → Script (for `.gs`) or HTML (for `.html`).
2. Name it exactly as the file on disk (without extension).
3. Paste the file content.

Then enable **⚙ Project Settings → Show appsscript.json manifest file** and replace the manifest with `src/appsscript.json`.

---

## Step 2 — Run setup (3 min)

1. Apps Script editor → select function **`setupWorkbook`** from the dropdown next to the Run button.
2. Click **Run**.
3. When prompted for OAuth, click through. Allow scopes: spreadsheets, send email, manage triggers, basic profile.
4. Wait until the editor's Logs panel shows `Workbook setup complete`. (~30s.)
5. Open the sheet → verify the new helper tabs exist: `_Config`, `Logs`, `Changelog`, `QA`, `_Templates`, `Dashboard`, `Org Chart`, `Drill-Down`.
6. Open the **Logs** tab → confirm it has ~100 backdated rows (verification protocol step 6).
7. Open the **Dashboard** tab → confirm sections render: KPI strip, HR Health Score, LWD Alerts, Probation Alerts, Department Breakdown, Quarterly Attrition Trend, Risk Register, System Health.

---

## Step 3 — Deploy the Web App (5 min)

1. Apps Script editor → **Deploy → New deployment**.
2. Gear icon → choose **Web app**.
3. Fill in:
   - **Description**: `HR Dashboard v1`
   - **Execute as**: **Me (ruthviknagulapally@gmail.com)**
   - **Who has access**: **Anyone with Google account**
4. Click **Deploy**.
5. Copy the **Web App URL** that appears. This is what you'll submit.
6. Click **Done**.

---

## Step 4 — Test in incognito (3 min)

Open the Web App URL in an **incognito window**:

| Sign in as… | Expected result |
|---|---|
| `ruthviknagulapally@gmail.com` (allowlist) | Dashboard loads. KPIs, alerts, org chart, drill-down all render. |
| Any other personal Gmail | **403 Not Authorized** page. |

If the allowlist case fails → check `_Config` row `allowlist | emails` includes your email.
If the 403 case fails → re-check `Execute as: Me` in the deployment settings.

---

## Step 5 — Run QA harness (1 min)

1. Open the sheet.
2. Menu → **HR Automation → Run QA**.
3. Open the **QA** tab → all 11 assertions should show **PASS** in green.
4. If any fail: open Logs tab, find the failure detail, fix the root cause, re-run QA.

---

## Step 6 — Run the reviewer's verification protocol on yourself (15 min)

Walk through every test the reviewer will execute. Record what works and what breaks.

### 6.1 Rename two columns
1. India Employee Database tab → rename `Emp ID` to `Employee_ID` and `DOJ` to `Date of Joining`.
2. Wait ~7 seconds.
3. Open Dashboard → all sections still populated.
4. Open Web App → KPIs unchanged.
5. Open Logs → 1 INFO row noting `schema_drift_fuzzy` or alias-resolution success; no ERRORS.
6. Rename columns back (or leave renamed — the system doesn't care).

### 6.2 Add three employees
Append three new rows on India Employee Database:

| Emp ID | Name | Dept | Designation | Reporting Manager | Skillset | DOJ | Status | LWD |
|---|---|---|---|---|---|---|---|---|
| TX001 | Test Intern | Engineering | Intern | (existing manager name) | Python | (today - 30d) | Intern | (today + 20d) |
| TX002 | Test Probationer | Engineering | SDE I | (existing manager name) | Java | (today - 155d) | Under Probation | |
| TX003 | Test Confirmed | Engineering | SDE II | (existing manager name) | Go | (today - 400d) | Confirmed | |

Wait ~7 seconds. Verify:

- Dashboard headcount KPIs increment by 3.
- LWD Alerts section shows TX001.
- Probation Alerts section shows TX002 (confirmation date in 25 days).
- Web App reflects the same changes after one poll cycle.

### 6.3 Change DOJ
Change TX002's DOJ by **-10 days** (older). Wait ~7 seconds. Verify the Probation Alerts confirmation date for TX002 shifts by -10 days too.

### 6.4 Offboarded delete
1. Offboarded Resources tab → snapshot the current `Quarterly Attrition` KPI value.
2. Delete one row.
3. Wait ~7 seconds.
4. Verify `Quarterly Attrition` decreased.

### 6.5 Auth gate
Already done in step 4.

### 6.6 Logs
Already done in step 2.

### Cleanup
Delete the TX001/TX002/TX003 test rows. Re-add the deleted offboarded row. (Or leave the test data — won't break anything.)

---

## Step 7 — Share the Sheet (1 min)

1. Sheet → **Share** (top right).
2. Add `aadish.jain@techolution.com` as **Viewer**.
3. Toggle off "Notify people" so it doesn't spam, OR leave it on (your call).
4. Click **Share**.

---

## Step 8 — Export the SOP to PDF (5 min)

The SOP source is `docs/SOP.md`. To submit as a PDF:

**Option A — Pandoc (if you have it):**
```bash
pandoc docs/SOP.md -o "Techolution HR Dashboard SOP.pdf" --pdf-engine=xelatex
```

**Option B — VS Code + Markdown PDF extension:**
1. Install the *Markdown PDF* extension by yzane.
2. Open `docs/SOP.md`.
3. Cmd/Ctrl+Shift+P → `Markdown PDF: Export (pdf)`.

**Option C — Word route (matches your Markdown→Word habit):**
1. Open `docs/SOP.md` in VS Code.
2. Use *Pandoc* or *Word's Markdown import* (Insert → Object → Text from file with .md).
3. Format any code blocks for readability.
4. File → Save As PDF.

Append `docs/architecture.md` as an appendix.

---

## Step 9 — Submission email (2 min)

Reply to the original assignment email with this body (or similar):

> Hi Aadish,
>
> Please find my HR Automation Dashboard submission below.
>
> **Sheet link** (view access shared with you):
> https://docs.google.com/spreadsheets/d/1Tt2w9lxFn8FhmdkRhs1LMxjL9-zcd4M0odqeS-buZ0s/edit
>
> **Web App URL**:
> `<paste deployed URL from Step 3>`
>
> **SOP**: Attached as `Techolution HR Dashboard SOP.pdf`.
>
> A few notes:
> - All mandatory requirements (§4.1–§4.6) are implemented.
> - All seven "10/10" differentiators (§5) are implemented: modular Apps Script project (16 `.gs` files), workflow engine (dropdown actions on India + US tabs with idempotency + emails), HR Health Score (4-pillar additive, documented in SOP §7), built-in test harness (`HR Automation → Run QA`, 11 assertions writing to QA tab), self-monitoring (`13_SelfMonitor.gs` — missed-run / mail-quota / schema-drift), Changelog tab with run summaries, and architecture diagram in SOP §5 + appendix.
> - The Web App polls every 5s; Sheet-side reflection debounces at ~2s. End-to-end edit-to-visible latency is ~7s.
> - Real-time reflection is implemented via `onEdit` installable triggers + CacheService cache invalidation + ScriptLock-debounced rebuild; the Web App polls a cached snapshot. The full pattern is documented in SOP §6.
> - The reviewer email (`aadish.jain@techolution.com`) is pre-seeded on the `_Config` allowlist.
>
> Happy to walk through any line of code.
>
> Thanks,
> Ruthvik

Attach the PDF and send.

---

## Step 10 — Confirmation reply (per brief §7)

The brief asks for confirmation within the first 4 hours of starting. If you haven't already sent that, send a short note:

> Hi Aadish,
>
> Quick confirmation — I've started on the HR Automation Dashboard assignment. Will submit within the 48-hour window. Will share my work-copy sheet link as soon as bootstrap is run.
>
> Thanks,
> Ruthvik

---

## Final checklist (right before submission)

- [ ] Sheet is a native Google Sheet.
- [ ] All 24 source files pushed (16 `.gs` + 8 `.html` including `403.html` + `appsscript.json`).
- [ ] `setupWorkbook()` run; all helper tabs exist.
- [ ] Triggers visible in Apps Script editor → Triggers (3 total: onEditInstallable, onSchedulePulse, dailyDigest).
- [ ] Web App deployed; URL works in incognito for allowlist email; shows 403 for non-allowlist.
- [ ] Sheet shared (view) with `aadish.jain@techolution.com`.
- [ ] `aadish.jain@techolution.com` is on `_Config.allowlist.emails`.
- [ ] QA harness all PASS.
- [ ] Verification protocol self-tested (renames, adds, DOJ change, offboarded delete, auth, logs).
- [ ] SOP PDF generated.
- [ ] Submission email drafted with Sheet URL + Web App URL + SOP PDF attached.
