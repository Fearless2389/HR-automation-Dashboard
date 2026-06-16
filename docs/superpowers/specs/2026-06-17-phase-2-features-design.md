# Phase 2 — Feature Build Design

**Date:** 2026-06-17
**Deadline:** Today, EOD (Aadish's reviewer email)
**Status:** Locked, ready for implementation plan

## 1. Context

Phase 1 (initial submission) passed review and was advanced to the next stage. The reviewer (Aadish Jain) responded with a detailed list of additional requirements that are graded against a virtual demo + COO interview. This spec covers what we build in the remaining hours.

Two prerequisite issues from Aadish's email are already handled and not re-litigated here:

- **Web App open access** — `doGet()` now passes through anonymous viewers when `_Config.allowlist.emails` contains `*`. Deployment is `Access: Anyone`. Verified in signed-out incognito.
- **Email recipient hygiene** — Demo mode is on (`Config.isDemoMode() === true`), `_Config.email.digestRecipient` is blank, and the `dailyDigest` trigger is uninstalled. `MailApp.sendEmail` is unreachable in the current configuration.

## 2. Goals

Ship the five mandatory features below with a coherent UX, on a hard deadline of today EOD, and survive a virtual demo where the candidate must explain every part of the system.

Aadish's mandatory requirements, in his priority order:

1. **Alert Email Engine** — per-alert outbound emails for LWD and probation alerts, with dedup ("zero false positives"). His "highest priority feature."
2. **Bidirectional editing** — full CRUD on employees from the Web App, writing back to the Sheet in real time. His "non-negotiable architectural requirement."
3. **Alert Engine tab** — smart, contextual recommendations (not just lists of names) generated from live data.
4. **Finance tab** — project / department / region cost breakdown with drill-down.
5. **Productivity tab** — ranked performers, filterable, with trend indicators and an "email manager" button.
6. **UX overhaul** — clean, minimalistic, clickable cards, hover tooltips, explicit empty/loading states, navigation between all tabs.

## 3. Non-Goals

Explicitly out of scope for this push:

- Aadish's optional features we are NOT building: PDF export for Finance/Productivity, role-based toggle (HR view vs Manager view).
- Real-time WebSocket push to the Web App. Current 5s polling stays.
- Re-skinning the Web App from scratch. We polish what's there.
- A separate Sheet-side dashboard for Finance/Productivity. Those tabs are Web App only — the existing sheet-side Dashboard tab stays as-is.
- Sidebar navigation. Top-nav stays per Q7.

### 3.1 Optional features included (because they're cheap)

Three of Aadish's "additional features" are pulled into scope:

- **Audit log** — dedicated `Audit Log` tab capturing every web-app write (field, old value, new value, timestamp, actor). Near-free because the write endpoints already log via `Log.start/info/end`; we add one helper that writes a structured row per change to a dedicated tab. Spec in §5.4.
- **Search bar across employee records** — text input on Drill-Down, Manage Employees, and Productivity tabs. Server-side substring match on name + empId + skillset + designation + project. ~30 LOC.
- **Color-coded risk indicators** — left-border tint or leading dot on every employee row, computed by a single `Risk.tier(emp)` function. Green/amber/red rules in §6.5. Reused across Drill-Down, Manage Employees, and Productivity tabs.

## 4. Decisions Locked (Q1–Q7)

| # | Decision | Choice | Rationale (one-line) |
|---|---|---|---|
| Q1 | Bidirectional editing UX | **Dedicated `Manage Employees` tab** | Discoverable from top nav, clean read/write separation, demo-grade legibility |
| Q2 | Alert email cadence | **Per-alert, sent once, deduped via ScriptProperties** | Matches Aadish's "trigger outbound emails" language and "zero false positives" requirement |
| Q3 | New columns (`Project`, India `Allocation %`) | **Synthetic backfill** (~6–8 fixed projects, plausible allocation bands) | Finance/Productivity tabs can't demo with empty buckets |
| Q4 | Productivity trend source | **Seeded 12-month `Productivity History` helper tab** | Only option that survives "how does this update over time" probing in the demo |
| Q5 | Alert Engine tab structure | **Recommendations on top, raw alerts collapsed below** | Honors Aadish's "not just a list of names" while keeping the underlying data accessible |
| Q6 | Delete employee semantics | **Soft delete → "Mark as Offboarded" with reason** | Preserves Attrition/Quarterly trend math; matches the existing Offboarded Resources flow |
| Q7 | UX overhaul scope | **Polish over rebuild, top nav stays, KPI cards become clickable** | The Linear/Stripe-clean baseline already matches Aadish's bar; rebuild costs hours we don't have |

## 5. Data Model Changes

### 5.1 `India Employee Database` + `US Employee Database`

Two new columns added by bootstrap if missing:

| Column | Type | Backfill rule | Editable in UI |
|---|---|---|---|
| `Project` | string | Pick from a fixed 8-element list keyed by dept (Engineering → Apollo/Phoenix/Helios, Finance → Atlas/Vega, Operations → Orion, HR → Nimbus, Sales → Lyra). Seed value derived from `hash(empId) % len(deptProjects)` for stability. | Yes (Manage Employees) |
| `Allocation %` | number | Random in `[60, 100]` seeded from `hash(empId)` so the value is stable across bootstrap runs. India tab only — US already has this. | Yes (Manage Employees, Productivity) |

Both columns are added via `_Config.aliases.india.project` and `_Config.aliases.us.project` so the header resolver picks them up. Aliases include `Project`, `Project Name`, `Project Assignment`.

### 5.2 `Productivity History` (new helper tab)

Single tab with columns: `Emp ID`, `Month` (YYYY-MM), `Productivity`. Bootstrap seeds 12 rows per employee covering the last 12 months. Generator logic:

```
for each employee:
  target = current productivity (from Finance tab)
  for month in [t-11, t-10, ..., t-1, t]:
    base = target + noise(σ=0.04)         # gaussian-ish noise
    drift = (month - t+12) * 0.005 * sign # gentle drift toward target
    value = clamp(base + drift, 0.30, 0.99)
  set the value for month t = exact target (anchor)
```

`onSchedulePulse` (already running every 5 min) gets a `maybeCaptureMonthlySnapshot_()` call that no-ops unless the most recent snapshot per employee is in a prior month, in which case it appends a new row using the current Finance-tab productivity. This makes the data evolve organically after submission — important for the COO interview.

### 5.3 `_Config` additions

| Section | Key | Default | Purpose |
|---|---|---|---|
| `email` | `alertEmailRecipient` | `''` (HR fills with own email for testing) | Per-alert email destination. When blank, emails are skipped with a warn-log. |
| `thresholds` | `recommendationsCacheSeconds` | `60` | TTL of the `api_recommendations` cache entry. Rules re-run on cache miss. |
| `aliases.india` / `aliases.us` | `project`, `allocationPct` | (see above) | Header resolver entries for the new columns. |

`Project` list ("Apollo", "Phoenix", "Helios", "Atlas", "Vega", "Orion", "Nimbus", "Lyra") lives in `99_Bootstrap.gs` as a constant for now. Bootstrap is column-creation-only: if the `Project` column already exists with values, bootstrap leaves every cell untouched. HR can add new project strings freely via the Manage Employees tab — the dropdown accepts arbitrary text in addition to the constant list.

### 5.4 `Audit Log` (new helper tab)

Append-only log of every write made via the web app. Columns:

| # | Column | Notes |
|---|---|---|
| 1 | `Timestamp` | ISO 8601 in script timezone |
| 2 | `Actor` | `Session.getActiveUser().getEmail()` or `'anonymous'` in open-access mode |
| 3 | `Operation` | `update` / `add` / `offboard` |
| 4 | `Emp ID` | Subject of the change |
| 5 | `Field` | Canonical field name (`designation`, `project`, `allocationPct`, `status`, `rm`) — blank for `add` rows |
| 6 | `Old Value` | Before-image (blank for `add`) |
| 7 | `New Value` | After-image (the full payload for `add`) |
| 8 | `Run ID` | Links back to the `Logs` tab entry for the same operation |

One row per field changed in an `update` operation (so editing designation + project = 2 rows). One row for `add` and `offboard`. Written via `AuditLog.record(...)` helper called from each `api_*` write endpoint. The tab is created by bootstrap and protected from manual edits via a sheet-level protection so HR doesn't accidentally modify history.

## 6. Architecture Additions

### 6.1 New `.gs` modules

| File | Purpose | Approx. LOC |
|---|---|---|
| `17_Recommendations.gs` | Rule engine for Alert Engine tab. Each rule is a function returning `{ id, headline, body, severity, action, computedAt }` or `null`. `Recommendations.all(snapshot)` runs every rule and returns the truthy results. ~8 rules at submit. | ~250 |
| `18_Finance.gs` | Project / Dept / Region aggregations (CTC totals, per-project headcount, drill-down arrays). | ~180 |
| `19_Productivity.gs` | Trend computation from `Productivity History`. Returns `{ empId, current, trend: 'up'|'flat'|'down', delta, history: [...] }` per employee. Also exposes the manager-email template hook. | ~220 |
| `20_AlertEmails.gs` | Per-alert email send loop with ScriptProperties-based dedup. Triggered from `onSchedulePulse` (rate-limited to once per hour). | ~150 |
| `21_AuditLog.gs` | `AuditLog.record({op, empId, field, oldVal, newVal, runId})` appends a structured row to the Audit Log tab. Bootstrap creates the tab + protection. | ~80 |
| `22_Risk.gs` | `Risk.tier(emp)` returns `'green' | 'amber' | 'red'` from a single set of rules (§6.5). Pure function, no I/O. | ~60 |

Numbered prefixes follow the existing convention; the actual load order doesn't matter because Apps Script hoists all globals.

### 6.2 New API endpoints in `15_WebAPI.gs`

| Endpoint | Purpose |
|---|---|
| `api_snapshot()` (extended) | Adds `finance`, `productivity`, `recommendations`, `productivityHistory` fields. Cache TTL unchanged (60s). |
| `api_addEmployee(payload)` | Creates a new row on India or US tab. Returns `{ ok, empId, message }`. Server generates empId (`IN1XXX` or `US1XXX`) by max-existing+1. |
| `api_updateEmployee(empId, patch)` | Patches existing row. Validates `patch.field` is in editable allowlist. Wraps the write in `withSilentWrite` to avoid trigger loops. Returns `{ ok, message }`. |
| `api_offboardEmployee(empId, reason)` | Soft delete (Q6): appends to Offboarded Resources, sets status to `Offboarded`, leaves the source row in place. |
| `api_recommendations()` | Server-side compute on demand; cached for 60s. Returns array of recommendation cards. |
| `api_sendManagerEmail(empId)` | Builds a pre-populated draft from `_Templates.productivity.summary` for the employee's manager. Returns subject + body (does not send by default; calling site provides a "Send" button that calls `Email.send` with demo-mode aware behaviour). |

All new write endpoints share four properties: (1) wrapped in `LockService.getDocumentLock`, (2) wrapped in `withSilentWrite`, (3) every operation logged via `Log.start/info/end` (Logs tab — engineering trail), (4) every field-level change written via `AuditLog.record(...)` to the dedicated Audit Log tab (HR-facing audit trail).

Also extended: `api_drilldown(filter)` now accepts `filter.text` and matches case-insensitive substring against `name + empId + skillset + designation + project`. Same matcher reused by Manage Employees and Productivity tabs.

### 6.3 Write-back path (the real-time both-ways loop)

```
HR opens Manage Employees → clicks Edit → modal form pre-filled from snapshot
HR changes fields → clicks Save
  └─→ google.script.run.api_updateEmployee(empId, patch)
        └─→ LockService.tryLock(5000)
        └─→ withSilentWrite { Header.col → setValues(patch) }
        └─→ Log.info('employee.update', { empId, patchKeys, actor })
        └─→ Data.bustAll() + Cache.bust('snapshot:')
        └─→ return { ok: true }

5s later: next poll of api_snapshot returns fresh data → UI updates
```

The `withSilentWrite` flag prevents the onEdit handler from re-triggering a rebuild on the cell we just wrote. This is the same defense used by `rebuildDashboard` writes — we extend it to web-app writes.

### 6.4 Recommendation rule shape

Each rule in `17_Recommendations.gs` is a function: `function rule_X(snapshot) → {id, headline, body, severity, action} | null`. Rules read from the snapshot only — no fresh sheet reads — so 8 rules cost a single cache hit, not 8.

Initial rule set:

| ID | Fires when | Example headline |
|---|---|---|
| `intern_backfill` | ≥3 interns exiting within 30 days | "3 interns exiting within 30 days — consider backfill" |
| `probation_review_due` | Any probation confirmation due in ≤7 days | "IN1054's probation confirmation is due in 5 days — initiate review" |
| `attrition_spike` | Current quarter attrition rate > prior quarter by ≥30% | "Attrition up 35% this quarter — flag to HR lead" |
| `productivity_decline` | ≥5 employees with declining trend in same dept | "Engineering has 6 declining performers — schedule team review" |
| `bench_risk` | ≥4 employees at <40% allocation | "4 employees under-allocated — reassign to active projects" |
| `mgr_overload` | Any manager with >10 direct reports | "Anjali Garcia manages 12 direct reports — consider org split" |
| `health_score_drop` | HR Health Score dropped below 70 | "HR Health Score fell to 64 — investigate driver pillar" |
| `no_recent_offboard_review` | No offboarding processed in 14 days | "No offboardings in 2 weeks — verify Offboarded tab is current" |

Each card has a "Why this fires" expandable showing the underlying numbers. Action buttons either open the relevant tab (Drill-Down filtered, Productivity filtered) or fire a workflow (`Mark Reviewed` writes a ScriptProperty so the card hides for 7 days).

### 6.5 Risk tier rules (`Risk.tier(emp)`)

Single source of truth for the green/amber/red dot rendered on employee rows across Drill-Down, Manage Employees, and Productivity tabs. Pure function — no I/O, deterministic.

```
tier(emp):
  if status == 'Offboarded'                              → 'red'
  if lwd && (lwd - today) < 14 days                      → 'red'
  if productivity < 0.50                                 → 'red'
  if lwd && (lwd - today) < 45 days                      → 'amber'
  if status == 'Under Probation' && probationConfDays < 30 → 'amber'
  if productivity < 0.70                                 → 'amber'
  if allocationPct < 0.40                                → 'amber'
  else                                                   → 'green'
```

The dot has `title=""` hover text explaining the active trigger (e.g. *"Amber: LWD in 28 days · Productivity 0.65"*). When multiple amber triggers fire the tooltip lists all of them. Rendered as `<span class="risk-dot risk-{tier}">`.

## 7. UX Overhaul Plan

The current visual baseline (Inter typography, neutral zinc palette, indigo-600 accent, white cards on light gray background, no gradients) already matches Aadish's stated bar. We're not redesigning — we're polishing.

Concrete changes:

1. **Top nav grows from 4 to 8 tabs:** Overview · Alerts · Org View · Drill-Down · **Manage Employees** · **Finance** · **Productivity** · **Alert Engine**. At 8 items, the horizontal nav is just shy of overflow at 1280px. We compress padding from `px-4` to `px-3` on tab links to fit.
2. **Clickable KPI cards:** each KPI on the Overview tab gets `cursor: pointer` + a click handler that opens a detail modal. Detail modal contents per KPI:
   - Headcount → list by region/dept.
   - Active Alerts → links to Alerts tab with relevant filter applied.
   - HR Health Score → opens a popup explaining the pillar breakdown formula.
   - Quarterly Attrition → bar chart of last 4 quarters.
3. **Hover tooltips on every metric label.** Pure CSS `title=""` attribute is enough — no library needed. Tooltip content = the metric's definition and computation source.
4. **Explicit empty states.** Every section's "no data" path returns a styled `<div class="empty-state">` with an icon-like glyph (`···`) and a one-line explanation, never a blank card.
5. **Skeleton loading states.** Before the first snapshot arrives (or during demo-mode polling), KPI cards show animated `<div class="skeleton">` placeholders matching the final shape. Three lines of CSS for the keyframe; cheap.
6. **Audit grep for emojis.** No emojis in source per Aadish. Run `grep -P "[\x{1F300}-\x{1FAFF}]"` on `src/` and remove any hit.
7. **403 page tone.** Currently friendly. Make it terse — title only.

## 8. Tab-by-Tab Spec

### 8.1 Manage Employees

Layout: filter strip (Region · Dept · Status · RM) + **text search input** + "+ Add Employee" button, table below.

Table columns: **Risk** (colored dot, hover for reason) · Emp ID · Name · Region · Dept · Designation · Project · Allocation · Status · RM · Actions (Edit / Mark Offboarded).

Search behaviour: 250 ms debounce, server-side `api_drilldown({text, ...})`, substring match against name + empId + skillset + designation + project. Empty input = no text filter.

Click row → opens right-side panel (480px wide). Form fields grouped into three sections:

- **Employment** — Emp ID (readonly), Name, Region (readonly), Dept (dropdown), Designation (text), Status (dropdown).
- **Reporting** — RM (dropdown of all employees + free text), DOJ (date picker).
- **Project & Allocation** — Project (dropdown of 8 + add-new), Allocation % (number 0–100).

Buttons: Save · Cancel · Mark Offboarded. Save calls `api_updateEmployee`; UI shows `Saving…` then a toast on success. The Drill-Down filter UI is copied for the search/filter row at the top of this tab (region/dept/status/RM/text search).

Add Employee: same modal, prefilled with sensible defaults (Region defaults from "what's selected in filter," Status = "Confirmed", Project = "Unassigned"). Empolid is server-generated.

Mark Offboarded: confirm dialog with reason field → calls `api_offboardEmployee`.

### 8.2 Finance

Three section cards on the tab:

1. **Project-wise breakdown** — bar chart (HTML/CSS, no JS chart lib) of total CTC INR per project, sorted descending. Click bar → drill-down list of employees on that project with name, designation, CTC.
2. **Department-wise** — same shape, grouped by dept.
3. **Region-wise** — two donuts (India INR / US USD) with total + headcount.

Filter strip at top: month (single dropdown for now — we'll just always show current month; "month-over-month" comparison is a stretch goal). All values computed live from the snapshot's `finance` field.

### 8.3 Productivity

Three sections:

1. **Top 5 performers** — list with name, dept, current productivity, trend chip (up/flat/down).
2. **Bottom 5 performers** — same.
3. **All employees, sortable table** — columns: **Risk** (colored dot) · Name · Dept · Region · Project · Current · Trend · Last 6 months sparkline (inline SVG, 60×16px).

Filter strip: Region · Dept · Project (dropdowns) + **text search input** (same matcher as Manage Employees). Each row has a "Email Manager" button → opens a modal showing the pre-populated draft email body and a Send button. Send respects demo mode.

The sparkline reads from `productivityHistory[empId]` which is part of the snapshot (last 6 months only to keep payload small).

### 8.4 Drill-Down (existing tab — minor extensions)

Existing filter strip (Region · Dept · RM · Status) gains a **text search input** with the same 250ms-debounced server-side matcher used by Manage Employees / Productivity. Table gains a leading **Risk** column showing the colored dot.

These two are the same code paths as §8.1 and §8.3, copy-pasted into Drill-Down. No new server logic.

### 8.5 Alert Engine

Layout per Q5: recommendation cards on top in a 2-column grid, raw alerts collapsed below.

Recommendation card structure:
```
┌──────────────────────────────────────────┐
│ [severity dot] Headline (one line)       │
│ Body (two lines max)                     │
│                                          │
│ Why this fires ▾  ·  [Primary Action]    │
└──────────────────────────────────────────┘
```

Severity dots: red (critical) · amber (warning) · gray (info). Each card has stable `id` so "dismissed for 7 days" persists across reloads. The disclosure `Why this fires ▾` expands to show the computation: e.g. for `intern_backfill`, lists the 3+ intern names and their LWD dates.

Below the recommendations grid: `[+] View raw alerts` disclosure that expands to the existing Alerts tabbed table.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 8 top-nav tabs overflow at 1280px width | Compress padding to `px-3` on tab links; test in incognito at common widths (1280/1366/1440). If overflow, drop "Org View" tab into a "More ▾" overflow menu. |
| Synthetic productivity history is too obvious in the demo | Anchor every employee's `t-12` to `t` value such that the visible trend looks plausible. Noise model is gaussian-ish with σ=0.04 (≈5% step-over-step variance — realistic for a productivity metric). |
| Adding 4 new tabs blows up snapshot payload size | `api_snapshot` already chunks via `Cache.put` 90KB guard. New fields are aggregates not per-row arrays except `productivityHistory` (capped at last 6 months per employee). Estimated snapshot size at submit: ~50–70KB. |
| Write conflicts when two windows edit same employee | `LockService.getDocumentLock().tryLock(5000)` serializes writes per spreadsheet. Last-write-wins beyond that. No optimistic locking — overkill for this scope. |
| Email engine fires duplicate emails on re-bootstrap | Dedup keys live in `ScriptProperties`, not in the sheet. Bootstrap does not clear them by default. We add `Bootstrap.resetEmailDedup()` as an explicit menu item for testing — never auto. |
| Productivity Snapshot trigger creates orphan rows when bootstrap re-seeds | `maybeCaptureMonthlySnapshot_()` checks for existing row with same `(empId, month)` before appending. Idempotent. |
| Web App URL unchanged after deploy but cached HTML in reviewer's browser | We add a `?v=<deploy_ts>` query param hint in SUBMISSION.md instructions. Apps Script web app URLs don't actually need this (no client-side caching), but if a reviewer reports staleness, this is the workaround. |

## 10. Rejected Alternatives (with reasons)

- **Inline cell editing on Drill-Down (Q1 A)** — quick to build but no good UX for Add/Delete. Modal pattern is what HR tools converge on for a reason.
- **Daily digest only (Q2 B)** — Aadish's language is per-alert. Digest is also harder to dedup cleanly across days.
- **Empty new columns (Q3 A)** — Finance/Productivity tabs degrade to "Unassigned" buckets, missing the demo opportunity.
- **Trend by single-snapshot heuristic (Q4 B)** — doesn't survive "show me how this updates" probing.
- **Hard delete employees** — destroys Attrition/Quarterly math; HR can hard-delete from the sheet directly if they really want to.
- **Sidebar nav (Q7)** — 3+ hours of refactor for no measurable UX win at 8 tabs.
- **WebSocket push instead of polling** — Apps Script HtmlService doesn't support persistent connections. 5s polling stays.

## 11. Implementation Order (for the plan to come)

Sequenced by Aadish's stated priority and risk:

1. **Bootstrap extensions** (add `Project`, India `Allocation %`, `Productivity History` seed, **`Audit Log` tab + protection**). Foundational — everything downstream needs the data.
2. **API endpoints in `15_WebAPI.gs`** (`api_addEmployee`, `api_updateEmployee`, `api_offboardEmployee`) + **`21_AuditLog.gs`** helper called from each. Server-side correct + locked + audited.
3. **`22_Risk.gs`** — pure tier function + the CSS for `.risk-green/.risk-amber/.risk-red`. Trivial.
4. **`Manage Employees` tab** — table (with risk dot) + side-panel modal + Add + Offboard + **text search**.
5. **`20_AlertEmails.gs`** — per-alert send loop with dedup. Test by sending 3 emails to user's own ID.
6. **`17_Recommendations.gs`** + **Alert Engine tab** — rules + cards UI.
7. **`18_Finance.gs`** + **Finance tab** — aggregations + bar charts.
8. **`19_Productivity.gs`** + **Productivity tab** — trend + ranked + email-manager + risk dot + text search.
9. **Drill-Down tab extensions** — risk dot column + text search (copy from Manage Employees).
10. **UX polish** — clickable KPI cards, hover tooltips, empty states, skeleton loaders, emoji grep, 403 trim.
11. **SOP update** — document Phase 2 features in `docs/build_sop.py`, regenerate PDF.
12. **Pre-submit verification** — incognito open, 3 test emails, every tab, every filter, KPI click, audit-log row inspection.

If we run out of time, the cut order (last first) is: SOP rebuild → Productivity trend (degrade to single-snapshot heuristic) → Finance drill-down modal (keep aggregations) → Recommendation rule count (ship with 4 of 8) → Drill-Down extensions (search + risk dot stay on Manage Employees + Productivity only).

The Alert Email Engine and Bidirectional Editing are not negotiable per Aadish's email and ship even if everything else is degraded. The Audit Log is also non-negotiable once we've committed to having it — half-implemented audit trails are worse than none.

## 12. Success Criteria

Spec is shippable when, in signed-out incognito:

- [ ] Web App URL loads immediately without sign-in prompts.
- [ ] All 8 tabs render with no console errors.
- [ ] Manage Employees: add a new employee, edit their designation, mark them offboarded — all changes visible in the Sheet within ~7s.
- [ ] Alert Engine: at least 4 recommendation cards visible, each with working "Why this fires" disclosure.
- [ ] Finance: project-wise + dept-wise + region-wise sections all show non-zero non-"Unassigned" data.
- [ ] Productivity: trend chips visible, sparklines render, "Email Manager" button opens the draft modal.
- [ ] Run `_Config.email.alertEmailRecipient` = user's own email, then trigger `Alerts.runEmailEngine()` from the menu — 3 emails arrive in user's inbox, content accurate.
- [ ] No emails to `hr@techolution.com` anywhere in the Logs tab.
- [ ] Audit Log tab populated: edit one employee, add one, offboard one → exactly the expected rows appear with correct old/new values.
- [ ] Text search works on Drill-Down, Manage Employees, and Productivity — typing a partial name narrows the list; clearing it restores.
- [ ] Risk dots visible on all three employee-row tables; hovering a non-green dot explains why.
- [ ] `clasp push` clean, no errors. New deployment version. URL unchanged.

Submission email reply to Aadish includes: Web App URL, Sheet link, resume.
