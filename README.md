# Techolution HR Automation Dashboard

Production-grade HR Automation Dashboard for India + US workforce, built on Google Sheets + Apps Script + HtmlService. Ships in two surfaces (Sheet-rendered Dashboard tab + deployed Apps Script web app), driven by the same source data, reflecting HR edits within seconds with no manual refresh.

**Stack:** Google Sheets + Apps Script (V8 runtime) + HtmlService web app (Tailwind + Alpine.js + Google Charts).

---

## Project layout

```
HR Automation Dashboard/
├── .clasp.json            ← clasp config (set your script ID here)
├── .claspignore           ← only .gs / .html / appsscript.json get pushed
├── README.md              ← this file
├── src/
│   ├── appsscript.json    ← Apps Script manifest (timezone, scopes, web app config)
│   ├── 00_Main.gs         ← doGet, rebuildDashboard, onOpen menu
│   ├── 01_Config.gs       ← _Config reader (allowlist, thresholds, aliases, weights)
│   ├── 02_Headers.gs      ← Header-agnostic column resolver
│   ├── 03_Cache.gs        ← CacheService wrapper with TTL + chunking
│   ├── 04_DataAccess.gs   ← Typed readers for each source tab
│   ├── 05_Metrics.gs      ← headcount, attrition, allocation, KPI strip
│   ├── 06_Alerts.gs       ← LWD, Probation, Productivity, Bench alerts
│   ├── 07_HealthScore.gs  ← 4-pillar HR Health Score
│   ├── 08_OrgChart.gs     ← Build tree, render PNG, publish to Org Chart tab
│   ├── 09_Workflow.gs     ← Dropdown actions, idempotent execution
│   ├── 10_Triggers.gs     ← Installable onEdit, debounce, circuit breaker
│   ├── 11_Email.gs        ← Templated email send + quota tracking
│   ├── 12_Logger.gs       ← Logs/Changelog writer
│   ├── 13_SelfMonitor.gs  ← Missed runs, mail quota, schema drift detection
│   ├── 14_QA.gs           ← Test harness
│   ├── 15_WebAPI.gs       ← google.script.run handlers (api_snapshot, etc.)
│   ├── 99_Bootstrap.gs    ← One-shot setupWorkbook() — creates tabs, seeds Config
│   ├── WebApp.html        ← Main web app layout
│   ├── Styles.html        ← Tailwind overrides + Inter typography
│   ├── Scripts.html       ← Alpine store + polling loop
│   ├── Components_KPIs.html
│   ├── Components_Alerts.html
│   ├── Components_OrgChart.html
│   ├── Components_DrillDown.html
│   ├── Components_HealthGauge.html
│   └── 403.html           ← Not-authorized page
└── docs/
    ├── SOP.md             ← Standard Operating Procedure (export to PDF for submission)
    ├── architecture.md    ← Architecture diagram (text + mermaid)
    └── SUBMISSION.md      ← Deploy + share + submit checklist
```

---

## First-time setup

### Option A — Push via `clasp` (recommended, ~3 minutes)

```bash
# 1. Install clasp (only once, globally)
npm install -g @google/clasp

# 2. Authenticate
clasp login

# 3. Get your script ID:
#    - Open your work copy of the sheet
#    - Extensions → Apps Script  (opens the bound script editor)
#    - In the editor URL: https://script.google.com/u/0/home/projects/<SCRIPT_ID>/edit
#    - Copy that <SCRIPT_ID>

# 4. Paste the script ID into .clasp.json (replace PASTE_YOUR_SCRIPT_ID_HERE)

# 5. Push the code
clasp push
# (first push will warn that the manifest changed — type `y` to continue)
```

### Option B — Copy-paste into the Apps Script editor

If you don't want to use `clasp`:

1. Open your work copy of the sheet → Extensions → Apps Script.
2. For each `.gs` file in `src/`: create a new script file with the same name (Files → + → Script), paste the contents.
3. For each `.html` file in `src/`: create a new HTML file with the same name (Files → + → HTML), paste the contents.
4. Replace the default `appsscript.json` with the one in `src/`. To see/edit `appsscript.json`, enable: ⚙ Project Settings → "Show appsscript.json manifest file".

### Bootstrap

After the code is in the editor (via either option):

1. From the Apps Script editor: select function `setupWorkbook` → click **Run**.
2. Grant the OAuth scopes when prompted (sheets, mail, script triggers, userinfo.email).
3. Watch the editor's Logs panel — bootstrap creates all helper tabs (`_Config`, `Logs`, `Changelog`, `QA`, `_Templates`, `Dashboard`, `Org Chart`, `Drill-Down`), seeds defaults, installs triggers, and writes historical Logs/Changelog rows.
4. Open the sheet — verify the new tabs exist and Dashboard shows real data.

### Deploy the web app

1. Apps Script editor → **Deploy** → **New deployment**.
2. Type: **Web app**.
3. Description: `HR Dashboard v1`.
4. Execute as: **Me (`ruthviknagulapally@gmail.com`)**.
5. Who has access: **Anyone with Google account**.
6. Click **Deploy** → copy the Web App URL.
7. Test the URL in an **incognito window** (sign in with your account → dashboard loads; sign in with a random account → 403 page).

---

## Configuration

All thresholds, the email allowlist, and email templates live in the **`_Config`** and **`_Templates`** tabs in the sheet — **no code changes required** to modify them.

| Tab | Edit this for… |
|---|---|
| `_Config` → `allowlist.emails` | Add/remove authorized HR users (comma-separated) |
| `_Config` → `thresholds.*` | Change LWD alert window, probation duration, productivity floor, etc. |
| `_Config` → `health.weights` / `health.bands` | Tune HR Health Score |
| `_Config` → `aliases.<tab>.<col>` | Add new accepted column names (for header-rename resilience) |
| `_Templates` | Edit email subject/body for each workflow action and alert digest |

See `docs/SOP.md` for the full operator manual.
