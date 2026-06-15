/**
 * 08_OrgChart.gs — Org chart rendering.
 *
 * Sheet-side: builds the org tree as a 3-column data table (Name, Manager,
 * Tooltip) on the "Org Chart" tab, then attaches an embedded ORG chart
 * referencing that range. Google Sheets re-renders the chart whenever the
 * data range changes — no PNG regeneration needed.
 *
 * Web-app-side: returns the tree as JSON (`OrgChart.buildTree()`) for the
 * google.visualization.OrgChart on the front-end.
 *
 * Public API:
 *   OrgChart.buildTree()       → [{ id, name, dept, designation, managerId }]
 *   OrgChart.publishToSheet()  → updates the "Org Chart" tab data + embed
 *   OrgChart.nodesForChart()   → DataTable-compatible rows for google.visualization.OrgChart
 */

var OrgChart = OrgChart || {};

(function (ns) {
  var TAB_NAME = 'Org Chart';
  var CHART_DATA_START_ROW = 3; // Row 1 = title; Row 2 = data headers; data starts row 3.

  /**
   * Build a flat list of nodes from all employees. Manager link is by name OR
   * by Emp ID — the source sheet's Reporting Manager column may contain either.
   *
   * Matching strategy (in order):
   *   1. Exact Employee Name (case-sensitive)
   *   2. Trimmed + lowercased Employee Name
   *   3. Emp ID (in case some rows reference manager by ID)
   *   4. Substring containment (handles "Ruth N." vs "Ruthvik Nagulapally")
   *
   * When no employee match is found but the Reporting Manager cell has a
   * value, we synthesise an "external" node so the hierarchy still trees up
   * instead of collapsing into a flat row of roots. External nodes share an
   * ID across all employees pointing to the same RM string, so siblings
   * cluster naturally.
   */
  ns.buildTree = function () {
    var emps = Data.allEmployees();
    var byName = {};
    var byNameLower = {};
    var byEmpId = {};
    emps.forEach(function (e) {
      if (e.name) {
        byName[String(e.name)] = e;
        byNameLower[normalize_(e.name)] = e;
      }
      if (e.empId) byEmpId[String(e.empId).trim()] = e;
    });

    function findManager(rm) {
      if (!rm) return null;
      var rmStr = String(rm).trim();
      if (!rmStr) return null;
      if (byName[rmStr]) return byName[rmStr];
      var rmNorm = normalize_(rmStr);
      if (byNameLower[rmNorm]) return byNameLower[rmNorm];
      if (byEmpId[rmStr]) return byEmpId[rmStr];
      // Substring fallback — match longest-name first so "Ruthvik Nagulapally"
      // beats "Ruth" if both could match.
      var best = null, bestLen = 0;
      for (var i = 0; i < emps.length; i++) {
        var empNameNorm = normalize_(emps[i].name || '');
        if (!empNameNorm) continue;
        if (empNameNorm.indexOf(rmNorm) !== -1 || rmNorm.indexOf(empNameNorm) !== -1) {
          if (empNameNorm.length > bestLen) {
            best = emps[i];
            bestLen = empNameNorm.length;
          }
        }
      }
      return best;
    }

    var externalsByKey = {};
    function getOrCreateExternal(rmStr) {
      var key = normalize_(rmStr);
      if (externalsByKey[key]) return externalsByKey[key];
      var ext = {
        id: 'EXT:' + key.replace(/[^a-z0-9]+/g, '_'),
        name: rmStr,
        dept: 'External',
        designation: 'Reporting Manager (external)',
        managerId: '',
        isExternal: true
      };
      externalsByKey[key] = ext;
      return ext;
    }

    var resolved = 0;
    var nodes = emps.map(function (e) {
      var manager = findManager(e.rm);
      var managerId = '';
      if (manager) {
        resolved++;
        managerId = manager.empId;
      } else if (e.rm && String(e.rm).trim()) {
        managerId = getOrCreateExternal(String(e.rm).trim()).id;
      }
      return {
        id: e.empId,
        name: e.name,
        dept: e.dept,
        designation: e.designation,
        managerId: managerId,
        isExternal: false
      };
    });

    // Append externals so the chart can root the hierarchy under them.
    var externalCount = 0;
    for (var k in externalsByKey) {
      if (externalsByKey.hasOwnProperty(k)) {
        nodes.push(externalsByKey[k]);
        externalCount++;
      }
    }

    // Diagnostic — flag low *internal* resolution so HR knows the source
    // data is using off-roster manager names. The chart still trees thanks
    // to the external nodes, but this is worth logging once per build.
    if (emps.length > 0 && (resolved / emps.length) < 0.30) {
      var runId = Log.start('OrgChart.buildTree', 'internal');
      Log.warn(runId, 'Low internal manager-link resolution; using external nodes', {
        totalEmployees: emps.length,
        resolvedInternal: resolved,
        externalManagers: externalCount,
        ratio: Math.round((resolved / emps.length) * 100) + '%',
        suggestion: 'Reporting Manager values do not match Employee Name values. External-manager placeholders shown; align names (or use Emp IDs) to remove them.'
      });
      Log.end(runId, { resolved: resolved, total: emps.length, externals: externalCount });
    }

    return nodes;
  };

  function normalize_(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Return DataTable-compatible rows for google.visualization.OrgChart.
   * Each row: [ {v: id, f: htmlLabel}, managerId, tooltip ]
   * On the front end we just pass these to the OrgChart draw().
   */
  /**
   * Group employees by Reporting Manager string (raw, no resolution).
   * Returns an array sorted by group size (descending) then manager name,
   * so the biggest teams float to the top of the grid.
   *
   * Output shape:
   *   [{ manager: 'Anjali Garcia', count: 8,
   *      reports: [{ empId, name, dept, designation, status, region }, ...] }, ...]
   *
   * Employees with a blank Reporting Manager bucket under "No Manager".
   */
  ns.buildGroups = function () {
    var emps = Data.allEmployees();
    var groups = {};
    emps.forEach(function (e) {
      var rm = (e.rm && String(e.rm).trim()) || 'No Manager';
      if (!groups[rm]) groups[rm] = { manager: rm, reports: [] };
      groups[rm].reports.push({
        empId: e.empId,
        name: e.name,
        dept: e.dept,
        designation: e.designation,
        status: e.status,
        region: e.__region
      });
    });
    var arr = Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.reports.sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      g.count = g.reports.length;
      return g;
    });
    arr.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.manager).localeCompare(String(b.manager));
    });
    return arr;
  };

  ns.nodesForChart = function () {
    var nodes = ns.buildTree();
    return nodes.map(function (n) {
      var label, tooltip;
      if (n.isExternal) {
        label = n.name + '\nExternal Manager';
        tooltip = 'External · ' + n.name + ' (not in employee roster)';
      } else {
        label = n.name + '\n' + (n.designation || '') + (n.dept ? ' · ' + n.dept : '');
        tooltip = (n.id || '') + ' · ' + (n.dept || '') + ' · ' + (n.designation || '');
      }
      return {
        id: n.id,
        label: label,
        managerId: n.managerId,
        tooltip: tooltip,
        isExternal: !!n.isExternal
      };
    });
  };

  /**
   * Update the Org Chart tab — overwrites the data table and (re)attaches the
   * embedded chart pointing at it. Called from rebuildDashboard + onEdit when
   * the Reporting Manager column changes.
   */
  ns.publishToSheet = function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB_NAME);
    if (!sh) return;

    var nodes = ns.buildTree();
    if (!nodes.length) return;

    // Write a title + data table.
    sh.clear({ contentsOnly: true });
    sh.getRange(1, 1).setValue('TECHOLUTION ORG CHART').setFontSize(16).setFontWeight('bold').setFontColor('#4F46E5');
    sh.getRange(2, 1, 1, 3).setValues([['Name', 'Manager', 'Tooltip']]).setFontWeight('bold').setBackground('#1F2937').setFontColor('#FFFFFF');

    var rows = nodes.map(function (n) {
      var managerName = '';
      if (n.managerId) {
        // The OrgChart embedded chart wants the manager VALUE in column B
        // to match a value in column A. Since our IDs are emp IDs but the
        // chart displays names, write names as the primary key here.
        for (var i = 0; i < nodes.length; i++) { if (nodes[i].id === n.managerId) { managerName = nodes[i].name; break; } }
      }
      var tooltip = n.isExternal
        ? 'External Manager (not in employee roster)'
        : (n.dept || '') + (n.designation ? ' · ' + n.designation : '');
      return [n.name, managerName, tooltip];
    });
    sh.getRange(CHART_DATA_START_ROW, 1, rows.length, 3).setValues(rows);

    // Attach or refresh embedded ORG chart.
    var dataRange = sh.getRange(2, 1, rows.length + 1, 2); // Name | Manager
    var existing = sh.getCharts();
    if (existing.length === 0) {
      var chart = sh.newChart()
        .setChartType(Charts.ChartType.ORG)
        .addRange(dataRange)
        .setPosition(2, 5, 0, 0)
        .setOption('allowHtml', true)
        .setOption('size', 'medium')
        .build();
      sh.insertChart(chart);
    } else {
      var rebuilt = existing[0].modify()
        .clearRanges()
        .addRange(dataRange)
        .build();
      sh.updateChart(rebuilt);
    }
  };
})(OrgChart);
