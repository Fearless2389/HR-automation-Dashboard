/**
 * 01_Config.gs — Reads the `_Config` tab into a typed object.
 *
 * `_Config` is the single source of truth for:
 *   - HR allowlist (who can open the Web App)
 *   - Alert thresholds (LWD window, probation duration, productivity floor)
 *   - HR Health Score weights and band thresholds
 *   - Column aliases per source tab (header-rename resilience)
 *   - Email digest cadence + recipient
 *
 * No hardcoded thresholds in code — everything tunable lives here.
 *
 * Public API:
 *   Config.load()                            → cached structured object
 *   Config.isAllowed(email)                  → boolean
 *   Config.threshold(key)                    → number
 *   Config.aliasesFor(tabKey, canonicalCol)  → string[]
 *   Config.canonicalCols(tabKey)             → string[]
 *   Config.healthWeights()                   → { stability, alertLoad, riskPosture, productivity }
 *   Config.healthBands()                     → { green, amber }
 *   Config.canonicalToTabName(tabKey)        → string  (e.g. 'india' → 'India Employee Database')
 */

var Config = Config || {};

(function (ns) {
  var CONFIG_TAB = '_Config';
  var CACHE_KEY = 'config:loaded:v1';
  var CACHE_TTL = 300; // 5 min — busted on edits to _Config via onEditInstallable

  /**
   * Map from short tab key (used internally) to the actual sheet tab name.
   * The actual sheet tab name can be customized by the user via _Config
   * row `tabs | <key> | <actual name>`, but we provide defaults.
   */
  var DEFAULT_TAB_NAMES = {
    india: 'India Employee Database',
    us: 'US Employee Database',
    rm: 'RM Data',
    finance: 'Finance · Productivity Risk Report',
    offboarded: 'Offboarded Resources'
  };

  /**
   * Load the full config, cached.
   */
  ns.load = function () {
    return Cache.wrap(CACHE_KEY, CACHE_TTL, loadRaw_);
  };

  /**
   * Allowlist entries support:
   *   - Exact email:   "aadish.jain@techolution.com"
   *   - Domain wildcard: "*@techolution.com"  (any address at that domain)
   *   - Open wildcard:  "*"  (any authenticated Google user)
   *
   * Use the domain form for review periods so any Techolution reviewer can
   * access without requiring you to pre-list their address.
   */
  ns.isAllowed = function (email) {
    var cfg = ns.load();
    var allowlist = cfg.allowlist || [];
    var lower = String(email || '').trim().toLowerCase();
    for (var i = 0; i < allowlist.length; i++) {
      var entry = String(allowlist[i]).trim().toLowerCase();
      if (!entry) continue;
      if (entry === '*') return true;                              // open mode: anyone, including anonymous
      if (!lower) continue;                                         // remaining checks need an email
      if (entry.indexOf('*@') === 0 && lower.length > entry.length - 1
          && lower.substring(lower.length - (entry.length - 1)) === entry.substring(1)) {
        return true;                                                // domain wildcard
      }
      if (entry === lower) return true;                            // exact match
    }
    return false;
  };

  ns.threshold = function (key) {
    var cfg = ns.load();
    return cfg.thresholds[key];
  };

  ns.canonicalCols = function (tabKey) {
    var cfg = ns.load();
    var section = cfg.aliases[tabKey] || {};
    return Object.keys(section);
  };

  ns.aliasesFor = function (tabKey, canonicalCol) {
    var cfg = ns.load();
    var section = cfg.aliases[tabKey] || {};
    var list = section[canonicalCol] || [];
    // Ensure canonical itself is always treated as an alias too.
    if (list.indexOf(canonicalCol) === -1) list = list.concat([canonicalCol]);
    return list;
  };

  ns.healthWeights = function () {
    return ns.load().health.weights;
  };

  ns.healthBands = function () {
    return ns.load().health.bands;
  };

  ns.canonicalToTabName = function (tabKey) {
    var cfg = ns.load();
    return cfg.tabs[tabKey] || DEFAULT_TAB_NAMES[tabKey] || tabKey;
  };

  ns.allTabKeys = function () {
    return Object.keys(DEFAULT_TAB_NAMES);
  };

  ns.emailDigestRecipient = function () {
    return ns.load().email.digestRecipient;
  };

  ns.emailDigestCronHour = function () {
    return ns.load().email.digestCronHour;
  };

  ns.alertEmailRecipient = function () {
    return ns.load().email.alertEmailRecipient || '';
  };

  ns.recommendationsCacheSeconds = function () {
    return ns.load().thresholds.recommendationsCacheSeconds || 60;
  };

  /**
   * Demo mode — when true, Email.send() does NOT actually dispatch via MailApp.
   * It logs the would-send payload and returns ok. Used during the assignment
   * review so workflow actions and digests don't email real inboxes. Default: true.
   */
  ns.isDemoMode = function () {
    var v = ns.load().email.demoMode;
    return v === undefined || v === null ? true : !!v;
  };

  ns.bust = function () {
    Cache.bust('config:');
    // Headers cache embeds the resolved alias-to-column mapping, so its result
    // depends on Config. Whenever Config changes, headers must be re-resolved.
    Cache.bust('headers:');
  };

  // ───────── internals ─────────

  function loadRaw_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(CONFIG_TAB);
    if (!sh) {
      // _Config tab missing — return defaults so doGet auth still works in a degenerate state.
      return seedDefaults_();
    }
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return seedDefaults_();

    var values = sh.getRange(2, 1, lastRow - 1, 3).getValues();
    // Each row: [Section, Key, Value]
    var raw = {
      allowlist: [],
      thresholds: {},
      health: { weights: { stability: 25, alertLoad: 25, riskPosture: 25, productivity: 25 }, bands: { green: 80, amber: 60 } },
      aliases: { india: {}, us: {}, rm: {}, finance: {}, offboarded: {} },
      tabs: {},
      email: { digestRecipient: '', digestCronHour: 9, demoMode: true, alertEmailRecipient: '' }
    };

    for (var i = 0; i < values.length; i++) {
      var section = String(values[i][0] || '').trim();
      var key = String(values[i][1] || '').trim();
      var val = values[i][2];
      if (!section || !key) continue;

      switch (section) {
        case 'allowlist':
          if (key === 'emails') raw.allowlist = splitCsv_(val);
          break;
        case 'thresholds':
          raw.thresholds[key] = coerceNumber_(val);
          break;
        case 'health.weights':
          raw.health.weights[key] = coerceNumber_(val);
          break;
        case 'health.bands':
          raw.health.bands[key] = coerceNumber_(val);
          break;
        case 'email':
          if (key === 'digestCronHour') raw.email.digestCronHour = coerceNumber_(val);
          else if (key === 'demoMode') raw.email.demoMode = (String(val).toLowerCase() === 'true' || val === true);
          else if (key === 'alertEmailRecipient') raw.email.alertEmailRecipient = String(val || '');
          else raw.email[key] = String(val);
          break;
        case 'tabs':
          raw.tabs[key] = String(val);
          break;
        default:
          // aliases.<tabKey>
          if (section.indexOf('aliases.') === 0) {
            var tabKey = section.substring('aliases.'.length);
            if (!raw.aliases[tabKey]) raw.aliases[tabKey] = {};
            raw.aliases[tabKey][key] = splitCsv_(val);
          }
      }
    }

    return raw;
  }

  function splitCsv_(v) {
    if (v === null || v === undefined) return [];
    return String(v).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  }

  function coerceNumber_(v) {
    if (typeof v === 'number') return v;
    var n = Number(v);
    return isNaN(n) ? v : n;
  }

  /**
   * Default config used if the _Config tab is absent or empty. Mirrors what
   * 99_Bootstrap.setupWorkbook() seeds, so behaviour matches even before
   * bootstrap has been run.
   */
  function seedDefaults_() {
    return {
      allowlist: ['aadish.jain@techolution.com', 'ruthviknagulapally@gmail.com', 'hr@techolution.com'],
      thresholds: {
        lwdAlertDays: 45,
        probationConfirmDays: 30,
        probationLengthDays: 180,
        lowProductivity: 0.6,
        benchAllocation: 0.4,
        productivityTarget: 0.8,
        recommendationsCacheSeconds: 60
      },
      health: { weights: { stability: 25, alertLoad: 25, riskPosture: 25, productivity: 25 }, bands: { green: 80, amber: 60 } },
      aliases: {
        india: defaultEmployeeAliases_(),
        us: Object.assign({}, defaultEmployeeAliases_(), {
          allocationPct: ['Allocation %', 'Allocation', 'AllocationPct', 'Allocation Percent', 'Alloc %'],
          ctc: ['CTC', 'CTC USD', 'CTC (USD)', 'Annual CTC', 'Cost To Company']
        }),
        rm: { empId: ['Emp ID', 'Employee ID', 'EmployeeID', 'ID'], name: ['Name', 'Employee Name'] },
        finance: {
          empId: ['Emp ID', 'Employee ID'],
          ctcInrAnnual: ['CTC INR Annual', 'CTC (INR)', 'CTC INR'],
          ctcUsdAnnual: ['CTC USD Annual', 'CTC (USD)', 'CTC USD'],
          ctcInrMonthly: ['CTC INR Monthly', 'Monthly CTC INR'],
          ctcUsdMonthly: ['CTC USD Monthly', 'Monthly CTC USD'],
          productivity: ['Productivity', 'Avg Productivity', 'Productivity Score']
        },
        offboarded: {
          empId: ['Emp ID', 'Employee ID'],
          name: ['Name', 'Employee Name'],
          dept: ['Dept', 'Department'],
          dol: ['DOL', 'Date of Leaving', 'Last Working Day', 'Exit Date'],
          reason: ['Reason', 'Exit Reason', 'Reason for Leaving']
        }
      },
      tabs: {},
      email: { digestRecipient: '', digestCronHour: 9, demoMode: true, alertEmailRecipient: '' }
    };
  }

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
})(Config);
