# Standard Operating Procedure
## Techolution HR Automation Dashboard

| | |
|---|---|
| **Owner** | HR Operations |
| **Version** | 1.0 |
| **Stack** | Google Sheets + Apps Script + HtmlService |
| **Surfaces** | (1) Sheet Dashboard tab inside the workbook (2) Deployed Web App URL |

> Submit this SOP as a PDF. Markdown source lives at `docs/SOP.md`.

---

## 1. What this system is

A live dashboard for Techolution's India + US workforce. HR edits source tabs in the workbook (employees, RM allocation, finance, offboarded); the system reflects every change on both surfaces within **~7 seconds** — no manual refresh, no buttons, no script runs.

**HR's job** is to keep source data accurate.
**The system's job** is to reflect that data — instantly — and surface anything that needs attention (LWD due, probation confirmation due, productivity dips, bench risk).

---

## 2. Daily usage

### 2.1 In the workbook

| Tab | What HR does here |
|---|---|
| **India Employee Database** | Add / edit / delete employee rows. |
| **US Employee Database** | Same, plus Allocation % and CTC. |
| **RM Data** | Update monthly allocation by resource. New month? Just add a new column on the right with the month label — the system auto-discovers it. |
| **Finance · Productivity Risk Report** | CTC (INR + USD, annual + monthly) and productivity averages. |
| **Offboarded Resources** | Append exit rows. Powers quarterly attrition. |
| **Dashboard** | **Read-only.** Auto-rebuilt by the script. Do not type into it. |
| **Org Chart** | **Read-only.** Auto-rebuilt from Reporting Manager column. |
| **Drill-Down** | Use the 4 dropdowns in **row 3** (Region, Department, Reporting Manager, Status) to filter. The results table redraws on every change. |
| **_Config** | All thresholds, the allowlist, and column aliases. See §4. |
| **_Templates** | Subject + HTML body for every email the system sends. Edit freely. |
| **Logs / Changelog / QA** | Audit trails. Read, don't write. |

### 2.2 In the Web App

1. Open the Web App URL on any browser. You'll be asked to sign in with Google.
2. If your account is on the allowlist (`_Config` → `allowlist.emails`), you'll see the live dashboard. If not, you'll see a "Not Authorized" page.
3. The dashboard auto-refreshes every **5 seconds**. Polling pauses when the browser tab is hidden (saves quota) and resumes on focus.
4. Sections: KPI strip, HR Health Score, Alerts (tabbed), Department Breakdown, Quarterly Attrition Trend, Org Chart, Drill-Down (with filter dropdowns).

### 2.3 Workflow actions

On the India and US tabs there's an **Action** column (right of the original data) with a dropdown:

- `Start Offboarding`
- `Schedule PIP`
- `Approve Confirmation`

Pick one → the system locks the row, sends the corresponding email (template lives in `_Templates`), stamps **Action Status = Done**, records **Action By** and **Action At**, and prevents re-execution. Picking the same action again on the same row is a no-op with a toast: *"Already executed for {empId}"*.

---

## 3. Adding data

### 3.1 Add an employee
Append a row to the bottom of India or US Employee Database. Fill in all required fields (Emp ID, Name, Department, Designation, Reporting Manager, DOJ, Status). Interns must also have an LWD. Within seconds:

- KPI strip headcount increments.
- Department breakdown updates.
- Org chart redraws (if Reporting Manager is set).
- If the new employee is an Intern with LWD in the next 45 days → LWD alert fires.
- If the new employee is a Probationer with confirmation in the next 30 days → Probation alert fires.

### 3.2 Add a department
Just type the new department name in the Department column of any employee row. The system auto-discovers departments from data — no separate list to maintain.

### 3.3 Add a project / monthly allocation column
On the RM Data tab, add a new column on the right with the month label (e.g., `Jun 2026`). The system auto-discovers the current month each pipeline run.

---

## 4. Modifying thresholds, dropdowns, allowlist

**All tunable parameters live in `_Config`** — no code changes needed. Layout: `Section | Key | Value`.

| Section | Key | What it does | Default |
|---|---|---|---|
| `allowlist` | `emails` | Comma-separated list of authorized Google account emails for the Web App. | reviewer + HR mailbox |
| `thresholds` | `lwdAlertDays` | LWD alert window (days). | 45 |
| `thresholds` | `probationConfirmDays` | Probation confirmation alert window. | 30 |
| `thresholds` | `probationLengthDays` | Probation duration (DOJ + N = confirmation). | 180 |
| `thresholds` | `lowProductivity` | Below this → productivity flag fires. | 0.6 |
| `thresholds` | `benchAllocation` | Below this → bench alert fires. | 0.4 |
| `thresholds` | `productivityTarget` | Used by HR Health Score Productivity pillar. | 0.8 |
| `health.weights` | `stability` / `alertLoad` / `riskPosture` / `productivity` | Maximum points per pillar (sum to 100). | 25 each |
| `health.bands` | `green` / `amber` | Band cutoffs for the score. | 80 / 60 |
| `email` | `digestRecipient` | Daily digest goes here. | hr@techolution.com |
| `email` | `digestCronHour` | Hour (0–23) the daily digest fires. | 9 |
| `aliases.<tab>` | `<canonical>` | Comma-separated list of accepted column header names for that canonical column. **This is what makes column-renames safe.** | (seeded) |

**Editing a `_Config` value immediately busts the cache and rebuilds.** Wait ~5 seconds, then verify on Dashboard or Web App.

### 4.1 Workflow action dropdowns

The **Action** column dropdown options are hardcoded in `09_Workflow.gs` (`ACTION_TEMPLATES`). To add a new action:

1. Add a key/value pair to `ACTION_TEMPLATES` in `09_Workflow.gs`.
2. Add a new row to `_Templates` with the same key.
3. Add the new option to the data validation list in `99_Bootstrap.gs` → `ACTION_OPTIONS`.
4. Run `setupWorkbook()` again to refresh validation.

### 4.2 Email templates

Edit any row in `_Templates`. Placeholders use double curly braces: `{{empName}}`, `{{empId}}`, `{{dept}}`, `{{rm}}`, `{{doj}}`, `{{actorName}}`, `{{date}}`, `{{lwdDays}}`, `{{probDays}}`, `{{lwdTable}}`, `{{probTable}}`. Changes take effect on the next email send — no restart needed.

### 4.3 Conditional formatting

The Sheet Dashboard tab is **rewritten on every rebuild**, so manual conditional-formatting rules will be lost. To customise its appearance, edit the `tone-good` / `tone-warn` / `tone-danger` color values in `00_Main.gs` → `toneColor_()` and re-run `rebuildDashboard()`.

The Web App's appearance is controlled by `Styles.html` (Tailwind + custom CSS).

---

## 5. System architecture

See `docs/architecture.md` for the diagram and detailed notes. Quick summary:

```
HR edits source tab
        │
        ▼
Installable onEdit (10_Triggers.gs)
        │
        ├─► Action column edit ───────► Workflow.handleEdit (09_Workflow.gs)
        │                                     │
        │                                     ▼
        │                              Email + stamp row + log
        │
        ├─► Drill-Down filter ─────────► applyDrilldown (00_Main.gs)
        │
        └─► Source data edit ──────────► scheduleRebuild_ (debounce 1.5s)
                                              │
                                              ▼
                              rebuildDashboard (00_Main.gs)
                                              │
                          ┌───────────────────┼────────────────────┐
                          ▼                   ▼                    ▼
                Dashboard tab        Org Chart tab           Bust snapshot cache
                                                                   │
                                                                   ▼
                                        Web App's next 5s poll picks up new data
```

The **`withSilentWrite`** wrapper is what prevents the rebuild's own sheet writes from triggering another rebuild (would loop forever). It sets a ScriptProperty flag, runs the writes, clears the flag. `onEditInstallable` early-returns if the flag is set.

A **circuit breaker** stops everything if more than 20 rebuilds fire in 60 seconds (suggests a feedback loop). It auto-resets after 5 minutes and logs CRITICAL to the Logs tab. Better to fail loudly than burn quota silently.

---

## 6. Real-time reflection — how it works

This is what makes the system feel live. There are two reflection paths.

### 6.1 Sheet-side reflection
1. HR edits any source tab.
2. **`onEditInstallable`** trigger fires within ~1s. Source-tab edit → relevant `data:*` cache key is busted via `Cache.bust('data:')`.
3. The trigger acquires a ScriptLock and **debounces** for 1.5s — if more edits arrive in that window, the wait extends. This prevents fan-out on bulk paste operations.
4. `rebuildDashboard('onEdit')` runs:
   - Wraps every write in `withSilentWrite(fn)` (so onEdit won't loop).
   - Clears the Dashboard tab and rewrites every section from cached data.
   - Republishes the Org Chart tab and refreshes Drill-Down filters.
   - Busts the `snapshot:*` cache key.
5. End-to-end latency: typically **~2–3 seconds** from edit to Dashboard tab update.

### 6.2 Web App reflection
1. The web app's Alpine.js root runs `setInterval(refresh, 5000)`.
2. Each tick calls `google.script.run.api_snapshot()` server-side.
3. `api_snapshot()` returns either a cached value (TTL 60s) or a freshly computed one. Since the rebuild busts the snapshot cache, the first poll after a rebuild is a fresh compute (~300ms), and subsequent polls hit cache (<100ms).
4. The client updates Alpine state → DOM redraws instantly → Org Chart re-draws via `google.visualization.OrgChart`.
5. End-to-end latency: edit → ~2s debounce + ~5s poll = **~7 seconds max** for Web App.

### 6.3 Why this scheme

| Choice | Reason |
|---|---|
| `CacheService` + debounce | Cheap (sub-second) reads under polling load; survives the 100KB-per-key limit via auto-chunking in `03_Cache.gs`. |
| Polling, not push | HtmlService cannot keep a WebSocket / SSE connection alive. Polling is the only stable mechanism. 5s feels live without burning execution quota. |
| `withSilentWrite` | Trigger-loop protection is non-negotiable. Without it, the rebuild's writes would re-trigger onEdit, which would rebuild, which would re-trigger… until quota dies. |
| Tab-name allowlist guard | Belt-and-suspenders: even if `withSilentWrite` somehow leaks, edits on Dashboard/Logs/Changelog/QA/Org Chart tabs are ignored by name. |
| Circuit breaker | Failsafe of last resort. >20 rebuilds in 60s = something is wrong. Stop, log CRITICAL, cool down 5 min, then resume. |

---

## 7. HR Health Score formula

A **0–100 composite** based on four equally-weighted pillars (each contributing 0–25). The formula is the same on the Sheet Dashboard and the Web App; both read from `07_HealthScore.gs`. Tunable inputs live in `_Config` under `health.weights` and `health.bands`.

| Pillar | Source | Formula | Cap | Penalty story |
|---|---|---|---|---|
| **Stability** | Quarterly attrition rate (from Offboarded Resources tab). | `25 × (1 − min(attr, 0.25) / 0.25)` | 25% quarterly attrition → 0 pts. | High attrition = unstable workforce. |
| **Alert Load** | Critical alerts (from Alerts.all().critical) ÷ headcount. | `25 × (1 − min(ratio, 0.20) / 0.20)` | Critical alerts = 20% of headcount → 0 pts. | Too many fires = HR is reactive. |
| **Risk Posture** | Employees in 30-day "risk window" (LWD soon, probation due, low alloc) ÷ headcount. | `25 × (1 − min(riskRatio, 0.30) / 0.30)` | 30% in risk window → 0 pts. | Many at-risk people = future problems. |
| **Productivity** | Average productivity from Finance · Productivity Risk Report ÷ target. | `25 × clamp(avgProd / target, 0, 1)` | Average meeting target → 25 pts. | Healthy productivity is a baseline. |

**Bands:** `Green ≥ 80`, `Amber 60–79`, `Red < 60`. Defaults configurable in `_Config` → `health.bands`.

**Why 4 equal pillars and not weighted?** Equal weighting is bulletproof in an audit: there is no "why 30%?" question to defend. The dashboard exposes each pillar so HR can see *which* pillar is dragging the score — that's the actionable signal, not the precise total.

---

## 8. Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| **Web App says "Not Authorized"** but the email is correct | Email not on allowlist, OR mixed up Google accounts (multiple Gmails signed in). | Open `_Config` → `allowlist.emails` → add the email. For multi-account: open the Web App URL in incognito or use `https://accounts.google.com` to pick the right account. |
| **Dashboard tab is stale / not updating** | Triggers not installed, or installable onEdit was deleted. | Menu: **HR Automation → Install Triggers**. Verify in Apps Script editor → Triggers (should see 3 triggers). |
| **Web App is stuck on "Loading dashboard…"** | First-paint bootstrap failed; usually a corrupted source tab. | Open the Apps Script editor → Logs panel. Look for the most recent ERROR. If column-related → check `_Config` → `aliases.<tab>` includes the actual column header. |
| **Logs tab keeps growing rapidly** (>50 rows/min) | onEdit loop. | Check Logs for repeated `rebuildDashboard` rows. If yes, the Circuit Breaker should have tripped. Menu: **HR Automation → Uninstall Triggers**, fix the source, re-install. |
| **Pipeline run failed with `SchemaDriftError`** | A column was renamed to something the alias map doesn't know. | Open Logs → find the SchemaDriftError → read the canonical name. Open `_Config` → add the new column name to `aliases.<tab>.<canonical>` (comma-separated). Wait 5 seconds. |
| **Workflow action ran but no email arrived** | Mail quota exhausted, OR template missing. | Check Logs for `Mail quota critical` or `Template not found`. Resolution: wait 24h for quota reset, or seed/edit the template in `_Templates`. |
| **Daily digest didn't fire** | Cron hour mismatch or trigger uninstalled. | Apps Script editor → Triggers → confirm `dailyDigest` is installed and the hour matches `_Config.email.digestCronHour`. |
| **Org chart looks wrong / nodes missing** | Reporting Manager values don't match any employee name. | Filter the India / US tabs for the broken `Reporting Manager` value; correct typos. The system links by exact name match. |
| **"Apps Script could not be opened" from the menu** | Container-bound script disconnected. | This usually means the script was modified externally. Re-clone with `clasp clone` or open the editor via Extensions → Apps Script. |
| **A KPI shows `—`** | Source data missing. E.g., `Avg Allocation` is `—` if no current-month column found on RM Data. | Add the current month column to RM Data (e.g., `Jun 2026`). |

---

## 9. Apps Script code maintenance

### 9.1 Project layout
The script is modular — 16 `.gs` files, one concern each. Numeric prefixes (`00_`, `01_`, … `99_`) are for human navigation, not load order. All cross-file references happen at call time, not at parse time, so order doesn't matter at runtime.

See `README.md` → "Project layout" for the file list.

### 9.2 Editing locally with `clasp`

```bash
git pull
clasp pull       # bring down anything edited in the cloud
# ...make edits in src/...
clasp push       # push to the bound script
```

`clasp` requires you to be logged in (`clasp login`) and `.clasp.json` to contain the script ID.

### 9.3 Adding a new module

1. Drop a new `XX_NewModule.gs` file under `src/`.
2. Follow the namespace pattern:
   ```js
   var NewModule = NewModule || {};
   (function (ns) {
     ns.publicFn = function () { /* ... */ };
   })(NewModule);
   ```
3. If it needs onEdit handling, wire it up in `10_Triggers.gs`.
4. If it exposes UI to the Web App, add a method to `15_WebAPI.gs` named `api_*` and a partial under `Components_*.html`.
5. Add an assertion to `14_QA.gs`.

### 9.4 Change management & version control

The Apps Script editor has built-in version snapshots: **File → See version history**. Take a snapshot before any non-trivial change. For "proper" version control, keep the local clone under git:

```bash
git init
git add .
git commit -m "Initial deploy"
```

Push commits before every `clasp push` so you can roll back if needed.

### 9.5 Re-deploy the Web App after code changes

```
Apps Script editor → Deploy → Manage deployments
  → Select active deployment → Edit (pencil icon)
  → Version: New version → Description: <short note>
  → Deploy
```

The Web App URL **does not change** between deployments under the same deployment ID. Sharing a fresh URL after every deploy is not required.

---

## 10. Verification protocol (for the reviewer)

The system was built backward from these tests. The reviewer will:

1. **Rename two columns in India Employees** → both surfaces continue to load India data correctly via header-agnostic lookup.
2. **Add 3 new employees** (1 Intern with LWD in 20 days, 1 Probationer with confirmation in 25 days, 1 Confirmed) → all 3 reflect within ~7 seconds; LWD and Probation alerts populate.
3. **Change a probationer's DOJ** → confirmation date recomputes and alert state updates.
4. **Delete a row from Offboarded Resources** → quarterly attrition recalculates.
5. **Open the web app URL as a logged-in user** → auth gate works; dashboard renders all sections from brief §4.1.
6. **Open the Logs tab** → real execution history with timestamps spanning the dev period (seeded by Bootstrap at setup time).

All six are covered by the test harness (`HR Automation → Run QA`) — assertions in `14_QA.gs` map 1:1 to these protocol items.

---

## 11. Appendix — Architecture diagram

The full architecture diagram with each component named lives in `docs/architecture.md` and is also reproduced in §5 above.
