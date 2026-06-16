# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Techolution HR Automation Dashboard internship assignment. Google Sheet + Apps Script + HtmlService Web App for India + US workforce. Two surfaces (Sheet-rendered `Dashboard` tab + deployed Web App) backed by the same Apps Script code, expected to reflect HR's source edits within ~7 seconds with no manual refresh.

The reviewer is Aadish Jain (`aadish.jain@techolution.com`); the assignment is graded against the verification protocol in the brief (column rename → add/delete rows → DOJ change → auth gate → Logs realism).

## Commands

This is not a Node/Python project — it's an Apps Script project pushed via `clasp`, plus a Python build script for the SOP PDF.

**Push code to Apps Script**
```bash
clasp push          # uploads src/*.gs and src/*.html to the bound script project
clasp push --watch  # auto-push on save during dev
```

`clasp` **must** be pinned to v2.4.2 (`npm install -g @google/clasp@2.4.2`). v3.x has a regression that breaks `clasp push` with a useless "invalid argument" error. The Apps Script API must also be enabled at `script.google.com/home/usersettings`, otherwise push fails with "Could not find script."

**`clasp push` ≠ deploy.** After pushing, the live Web App still serves the old version until you go to Apps Script editor → **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. Forgetting this is the most common source of "my changes aren't showing up."

**Rebuild the SOP PDF**
```bash
cd docs && python build_sop.py
```
Writes `docs/SOP.docx` and `docs/SOP.pdf`. Uses `python-docx` + `matplotlib` (for architecture diagram + health-score bars) + `docx2pdf` (Word COM on Windows — requires Word installed).

**There is no test runner.** Tests live inside Apps Script as a custom function suite:
- Run via Sheet menu **HR Automation → Run QA** (or call `QA.runAll()` from the editor). Results land on the `QA` tab.
- The reviewer-protocol verification suite runs from menu **HR Automation → Run Verification Protocol** (or `runVerificationProtocol()`). It mutates the sheet and restores state in a try/finally.

**Bootstrap a fresh workbook**
Sheet menu **HR Automation → Setup Workbook** (or `setupWorkbook()` in the editor). Idempotent — safe to re-run. Creates `_Config`, `Logs`, `Changelog`, `QA`, `_Templates`, `Dashboard`, `Org Chart`, `Drill-Down` tabs and seeds defaults, installs triggers, writes historical Logs/Changelog rows for verification step 6.

## Architecture — the big picture

### Two surfaces, one source of truth
The Google Sheet **is** the database. Every change flows: source tabs (India / US / RM / Finance / Offboarded) → installable `onEdit` → cache bust → debounced rebuild → both the `Dashboard` tab and the Web App `api_snapshot` cache. The Web App polls `api_snapshot` every 5s, so end-to-end reflection is ~2s debounce + ~5s poll = ~7s.

### Real-time reflection has three defense layers against trigger loops
1. **`withSilentWrite` flag** — every write the rebuild itself performs is wrapped in a `ScriptProperties.silentWriteRunId` set/clear. The `onEditInstallable` handler early-returns when this flag is set.
2. **Tab allowlist** — edits on `Dashboard`, `Logs`, `Changelog`, `QA`, `Org Chart`, `_Templates` never trigger a rebuild (they're outputs, not inputs).
3. **Circuit breaker** — `SelfMonitor` disables the onEdit trigger if it sees >20 rebuilds in 60s, logs CRITICAL.

If you change anything in `10_Triggers.gs` or `00_Main.rebuildDashboard`, **all three** layers need to keep working. Adding a fourth write path that bypasses `withSilentWrite` is how you get infinite-loop quota burn.

### Numeric file prefixes are for humans, not load order
`00_Main.gs` … `99_Bootstrap.gs` — Apps Script concatenates all `.gs` files at parse time, so global names (`Config`, `Cache`, `Data`, `Metrics`, `Alerts`, `HealthScore`, `OrgChart`, `Workflow`, `Triggers`, `Email`, `Log`, `SelfMonitor`, `QA`) hoist across files. The numbers just sort the file list for navigation. Each file declares a single global namespace via the `var X = X || {}; (function (ns) { ... })(X);` pattern.

### Header-agnostic column lookup (passes verification step 1)
The reviewer renames columns. `02_Headers.gs` resolves canonical names (`empId`, `name`, `dept`, `doj`, `lwd`, etc.) against the alias map in `_Config.aliases.<tabKey>.<canonical>` (comma-separated alternatives). If no alias hits, fuzzy match with confidence ≥0.85 + uniqueness check — otherwise throw `SchemaDriftError`. **Never hardcode column letters or `getRange('A2:A')`** — always go through `Header.col(sh, tabKey, canonical)` or `Header.rows(sh, tabKey)`.

The headers cache key embeds a hash of row 1, so a rename auto-invalidates. `Config.bust()` busts the headers cache too because the alias map is part of the resolution.

### Cache layer is JSON-serialized
`CacheService` JSON-stringifies everything → `Date` becomes string on the way out. `04_DataAccess` calls `rehydrateDates_(rows, ['doj', 'lwd'])` on every cached read. Downstream code in `06_Alerts`, `07_HealthScore`, `08_OrgChart` uses a defensive `toDate_()` helper that tolerates string-or-Date input. **Adding a new Date field requires updating the rehydrate list** or the downstream code blows up with `d.getTime is not a function`.

`Cache.put` chunks values >90KB across `key:part0..N` + a manifest key (CacheService has a 100KB-per-key limit).

### Web App rendering is vanilla JS, not Alpine
Apps Script's HtmlService runs in a sandboxed iframe with a strict CSP that **blocks `eval`**. Alpine.js (any version) and Tailwind v3 Play CDN both use `eval` internally → 3K console errors. The Web App uses **Tailwind v2 static CSS + vanilla JS** (`Scripts.html`). Don't reintroduce Alpine.

Scriptlets (`<?!= ?>`) only evaluate in the **top template** passed to `createTemplateFromFile()`. They do **not** run inside `include()`'d files. Bootstrap data and user info are injected into `<script type="application/json">` tags in `WebApp.html` (not in Scripts.html or Components_*.html) and parsed client-side. The injection escapes `<` to `<` so a stray `</script>` inside the JSON doesn't break the page.

### Email is in demo mode by default
`_Config.email.demoMode = true` (default). `Email.send()` checks `Config.isDemoMode()` and **returns ok without calling `MailApp.sendEmail`** — it just logs the would-send payload. This protects against the assignment-period footgun where workflow actions or digests would email real Techolution inboxes from the candidate's personal Gmail. To enable real sends, flip `demoMode` to `false` in `_Config`.

The daily digest trigger is **not installed in demo mode** by `Triggers.installAll()`. If one is already installed from a prior bootstrap, menu item **HR Automation → Stop Daily Digest** surgically removes it without touching `onEditInstallable` / `onSchedulePulse` (which power the live reflection).

### Web App auth model
`doGet()` in `00_Main.gs` calls `Session.getActiveUser().getEmail()` and checks `Config.isAllowed(email)`. Allowlist entries support:
- Exact: `aadish.jain@techolution.com`
- Domain wildcard: `*@techolution.com`
- Open: `*` (any signed-in Google user)

The deployment must be `Execute as: Me` + `Access: Anyone with Google account` for the auth flow to work. `Access: Anyone` (no login) would mean `Session.getActiveUser().getEmail()` returns empty.

### Org View on the Web App is grouped cards, not a hierarchy
The Web App's Org View groups employees by raw `Reporting Manager` string (largest team first) rendered as a card grid with pill chips. This is **separate from** the sheet-side `Org Chart` tab, which still uses Google Sheets' embedded `OrgChart` with `buildTree()` producing a parent-child structure (employees whose RM doesn't match any employee name are bucketed under synthesized `EXT:` external nodes so the tree doesn't flatten).

Status-tinted pills: `Under Probation` → amber, `Intern` → indigo, others → neutral. A legend on the Org View tab explains the colors.

### Tabbed Web App layout
Top-level tabs in `WebApp.html`: **Overview** (KPIs + Health Score + Dept + Attrition), **Alerts** (with internal critical/warning/lwd/probation sub-tabs), **Org View** (grouped card grid), **Drill-Down** (filtered employee table). `Scripts.html` manages `state.activeTab` and toggles `.hidden` on `[data-tab-content]` panels. The page-level tabs use class `tab-link` / `tab-link-active` — distinct from the alerts internal `tab` / `tab-active` class to avoid collisions.

## What lives where for common tasks

- **Adjust a threshold** (LWD alert window, probation duration, productivity floor) → `_Config` tab → `thresholds.*` row. No code change.
- **Add an authorized email** → `_Config` tab → `allowlist.emails` row (comma-separated). Use `*@domain.com` form for org-wide access.
- **Tune the HR Health Score** → `_Config.health.weights` (4 pillars, default 25 each) and `_Config.health.bands` (green ≥80, amber ≥60). Formula lives in `07_HealthScore.compute()`.
- **Add a new email template** → `_Templates` tab. `{{placeholder}}` substitution is in `11_Email.substitute_()`.
- **New source column** → add the canonical name + aliases in `_Config.aliases.<tabKey>` so the resolver picks it up. Bump the readers in `04_DataAccess` only if it's a typed field consumers care about.
- **New alert type** → extend `06_Alerts` (one function per type, `Alerts.all()` aggregates), then surface in `15_WebAPI.api_snapshot` and `Scripts.html renderAlerts`.

## SOP & docs

`docs/SOP.pdf` is the operator manual handed to HR / the reviewer. Source is `docs/SOP.md` + `docs/build_sop.py`. The Markdown file is *not* the source — `build_sop.py` is, and it writes `SOP.docx` + `SOP.pdf` from inline Python strings + matplotlib-rendered diagrams in `docs/_sop_images/`. If you edit the SOP, edit `build_sop.py` and re-run.

`docs/architecture.md` is the longer-form architecture write-up; `docs/SUBMISSION.md` is the deploy + share + submit checklist.
