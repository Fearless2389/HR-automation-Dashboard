# Architecture — Techolution HR Automation Dashboard

This document is referenced from `docs/SOP.md` §5 and is included verbatim in the SOP PDF appendix.

---

## High-level diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                     GOOGLE SHEET — THE DATABASE                         │
│                                                                         │
│   ┌─ SOURCE TABS (HR edits) ──────┐   ┌─ HELPER TABS (script writes) ─┐│
│   │  India Employee Database      │   │  _Config       (HR tunables)  ││
│   │  US Employee Database         │   │  Logs          (audit trail)  ││
│   │  RM Data                      │   │  Changelog     (run summary)  ││
│   │  Finance · Productivity Risk  │   │  QA            (test results) ││
│   │  Offboarded Resources         │   │  _Templates    (emails)       ││
│   └───────────────────────────────┘   │  Dashboard     (rendered)     ││
│                                       │  Org Chart     (rendered)     ││
│                                       │  Drill-Down    (interactive)  ││
│                                       └───────────────────────────────┘│
└─────────────────────────────────────────┬──────────────────────────────┘
                                          │
                                          │ onEditInstallable (event)
                                          │ onSchedulePulse (every 5 min)
                                          │ dailyDigest (daily, configurable hour)
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  APPS SCRIPT BACKEND (V8 runtime)                       │
│                                                                         │
│  ┌──── Entry layer ───────────────────────────────────────────┐         │
│  │  00_Main.gs            doGet, rebuildDashboard, onOpen     │         │
│  │  10_Triggers.gs        onEditInstallable, onSchedulePulse, │         │
│  │                        debounce, circuit breaker            │         │
│  └────────────────────────────────────────────────────────────┘         │
│                  │                                                      │
│                  ▼                                                      │
│  ┌──── Data layer ────────────────────────────────────────────┐         │
│  │  01_Config.gs          _Config reader (alias / threshold)  │         │
│  │  02_Headers.gs         Header-agnostic column resolver     │         │
│  │                        (alias → exact → fuzzy)             │         │
│  │  03_Cache.gs           CacheService wrapper (TTL +         │         │
│  │                        100KB chunking + prefix-bust)       │         │
│  │  04_DataAccess.gs      Typed readers per source tab        │         │
│  └────────────────────────────────────────────────────────────┘         │
│                  │                                                      │
│                  ▼                                                      │
│  ┌──── Computation layer ─────────────────────────────────────┐         │
│  │  05_Metrics.gs         Headcount, attrition, alloc, KPIs   │         │
│  │  06_Alerts.gs          LWD, Probation, Productivity, Bench │         │
│  │  07_HealthScore.gs     4-pillar additive composite (0-100) │         │
│  └────────────────────────────────────────────────────────────┘         │
│                  │                                                      │
│                  ├──────────────────────┐                               │
│                  │                      │                               │
│                  ▼                      ▼                               │
│  ┌──── Rendering ─────┐   ┌──── Workflows ──────────────────┐           │
│  │  00_Main:          │   │  09_Workflow.gs    onEdit-driven │           │
│  │   rebuildDashboard │   │                    actions w/    │           │
│  │  08_OrgChart.gs    │   │                    idempotency   │           │
│  │  15_WebAPI.gs      │   │                    + locks       │           │
│  └────────────────────┘   │  11_Email.gs       Templated     │           │
│                           │                    send + quota  │           │
│                           └─────────────────────────────────┘            │
│                                                                         │
│  ┌──── Cross-cutting ──────────────────────────────────────────┐        │
│  │  12_Logger.gs          Structured logger → Logs + Changelog │        │
│  │  13_SelfMonitor.gs     Missed runs, mail quota, schema      │        │
│  │                        drift, circuit-breaker status        │        │
│  │  14_QA.gs              Test harness → QA tab                │        │
│  │  99_Bootstrap.gs       One-shot workbook setup              │        │
│  └─────────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────┬──────────────────────────────┘
                                          │
                                          │ google.script.run.api_snapshot()
                                          │   poll every 5s, paused on tab hide
                                          ▼
┌────────────────────────────────────────────────────────────────────────┐
│              WEB APP (HtmlService, hosted by Apps Script)               │
│                                                                         │
│  WebApp.html (Alpine.js root)                                           │
│  ├── Styles.html              Tailwind CDN + Inter typography           │
│  ├── Scripts.html             Alpine store, polling, Google Charts      │
│  ├── Components_KPIs                                                    │
│  ├── Components_HealthGauge                                             │
│  ├── Components_Alerts        (tabbed: Critical / Warning / LWD / Prob) │
│  ├── Components_DepartmentBreakdown                                     │
│  ├── Components_AttritionTrend                                          │
│  ├── Components_OrgChart      (google.visualization.OrgChart)           │
│  └── Components_DrillDown     (4 filter dropdowns + table)              │
│                                                                         │
│  Auth: doGet checks Session.getActiveUser().email against               │
│        _Config.allowlist.emails. Non-allowlist → 403.html.              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Data flow (single edit lifecycle)

```
HR edits cell B5 on India Employee Database  →  onEditInstallable fires (~1s)
                                                       │
                                                       ▼
                                          (silent write flag set?) ─── yes ──► no-op (rebuild's own write)
                                                       │
                                                       no
                                                       ▼
                                          (Drill-Down filter cell?) ── yes ──► applyDrilldown
                                                       │
                                                       no
                                                       ▼
                                          (Action column on India/US?) ─ yes ──► Workflow.handleEdit
                                                       │
                                                       no
                                                       ▼
                                          Cache.bust('data:')
                                          CacheService.put('rebuild:lastEditTs', now)
                                                       │
                                                       ▼
                                          LockService.getScriptLock().tryLock(0)
                                                       │
                                              ┌────────┴────────┐
                                              │                 │
                                          got lock           did not
                                              │                 │
                                              ▼                 ▼
                                      poll-and-debounce       return
                                      (until 1.5s with
                                       no new edits)
                                              │
                                              ▼
                                      incrementRebuildCounter_()
                                              │
                                       > 20/min? ── yes ──► tripCircuit_() (5 min cooldown)
                                              │
                                              no
                                              ▼
                                  rebuildDashboard('onEdit')  (~300ms)
                                              │
                                  ┌───────────┼────────────┐
                                  ▼           ▼            ▼
                          Dashboard tab    Org Chart    Cache.bust('snapshot:')
                                                              │
                                                              ▼
                                              (web app polls 5s later)
                                                              │
                                                              ▼
                                              api_snapshot() returns fresh data
                                                              │
                                                              ▼
                                              Alpine updates DOM, OrgChart redraws
```

End-to-end latency: typically **2–3s** for Sheet, **5–7s** for Web App.

---

## Trigger inventory

| Trigger | Type | Frequency | Handler | Purpose |
|---|---|---|---|---|
| `onOpen` | Simple | On sheet open | `00_Main.onOpen` | Adds the `HR Automation` custom menu. |
| `onEditInstallable` | Installable | On every edit | `10_Triggers.onEditInstallable` | Classifies the edit → workflow / drilldown / rebuild. |
| `onSchedulePulse` | Time-based | Every 5 min | `10_Triggers.onSchedulePulse` | Self-monitor sweep + cache warm. |
| `dailyDigest` | Time-based | Daily at configured hour | `10_Triggers.dailyDigest` | Sends the alert digest if anything is active. |
| `circuitBreakerReset_` | One-shot | 5 min after breaker trips | `10_Triggers.circuitBreakerReset_` | Re-enables rebuilds and auto-deletes itself. |

---

## Failure modes & defences

| Failure mode | Defence | Recovery |
|---|---|---|
| onEdit infinite loop (rebuild's writes re-trigger onEdit) | `withSilentWrite` ScriptProperty flag + tab-name allowlist guard | Circuit breaker trips after 20 rebuilds in 60s; logs CRITICAL; auto-reset in 5 min. |
| Column renamed unknown alias | `Header.resolve` fuzzy fallback (similarity ≥0.85, unique candidate); on failure throws `SchemaDriftError` | Logs WARN with the rename mapping; HR adds the new alias to `_Config`. |
| CacheService 100KB-per-key cap | `Cache.put` auto-chunks payloads >90KB into `key:part0..N` + manifest | Transparent to callers; `Cache.get` reassembles. |
| Mail quota exhausted | `Email.send` checks `MailApp.getRemainingDailyQuota()` before sending | Send is skipped at <10 quota; logged as ERROR; SelfMonitor surfaces it on the Web App. |
| Triggers manually deleted | `Triggers.installAll()` is idempotent and re-callable from the menu | Run `HR Automation → Install Triggers`. |
| Workflow action triggered twice | Double-check: ScriptProperty `wf:done:<rowKey>` AND `Action Status === 'Done'` | Second pick reverts the dropdown to `—` with a toast. |
| Concurrent edits during action | `LockService.getDocumentLock().tryLock(5000)` | Caller gets a clear error; HR retries. |
| Web App polling burns quota | `snapshot:dashboard:v1` cache (TTL 60s); polling pauses on `document.hidden` | Most polls hit cache (<100ms); inactive tabs cost zero. |

---

## OAuth scopes used

Declared in `appsscript.json`:

- `spreadsheets` — read/write the workbook.
- `script.container.ui` — show toasts and the custom menu.
- `script.send_mail` — send workflow + digest emails.
- `script.scriptapp` — install / remove triggers programmatically.
- `userinfo.email` — read the authenticated user for the allowlist check.
- `script.external_request` — none required currently; reserved for future Slack / webhook integrations.
