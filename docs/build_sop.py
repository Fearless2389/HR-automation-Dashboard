"""
build_sop.py — Generates the Techolution HR Dashboard SOP as a .docx.

Usage:
  python build_sop.py

Output:
  docs/SOP.docx
  docs/_sop_images/*.png  (generated flowchart + architecture diagrams)
"""

from pathlib import Path
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyArrowPatch
from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

DOCS_DIR = Path(__file__).parent
IMG_DIR = DOCS_DIR / "_sop_images"
IMG_DIR.mkdir(exist_ok=True)

# Color palette (Linear/Stripe-style executive)
INDIGO = RGBColor(0x4F, 0x46, 0xE5)
SLATE_900 = RGBColor(0x18, 0x18, 0x1B)
SLATE_600 = RGBColor(0x52, 0x52, 0x5B)
SLATE_400 = RGBColor(0xA1, 0xA1, 0xAA)
GREEN = RGBColor(0x05, 0x96, 0x69)
AMBER = RGBColor(0xD9, 0x77, 0x06)
RED = RGBColor(0xDC, 0x26, 0x26)

doc = Document()

# ─────────────────────────────────────────────────────────────────────────
# Document-wide style
# ─────────────────────────────────────────────────────────────────────────
styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Calibri"
normal.font.size = Pt(11)
normal.paragraph_format.space_after = Pt(6)

for level, size in [(1, 22), (2, 16), (3, 13), (4, 11)]:
    h = styles[f"Heading {level}"]
    h.font.name = "Calibri"
    h.font.size = Pt(size)
    h.font.bold = True
    h.font.color.rgb = INDIGO if level <= 2 else SLATE_900

# Wider margins
for section in doc.sections:
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)


# ─────────────────────────────────────────────────────────────────────────
# DOCX helpers
# ─────────────────────────────────────────────────────────────────────────
def H1(text):
    p = doc.add_heading(text, level=1)
    p.paragraph_format.space_before = Pt(18)
    return p

def H2(text):
    p = doc.add_heading(text, level=2)
    p.paragraph_format.space_before = Pt(14)
    return p

def H3(text):
    p = doc.add_heading(text, level=3)
    p.paragraph_format.space_before = Pt(10)
    return p

def H4(text):
    p = doc.add_heading(text, level=4)
    p.paragraph_format.space_before = Pt(8)
    return p

def P(text, bold=False, italic=False, color=None, size=None):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.bold = bold
    r.italic = italic
    if color is not None:
        r.font.color.rgb = color
    if size is not None:
        r.font.size = Pt(size)
    return p

def P_runs(runs):
    """Add a paragraph with mixed-style runs.
    runs: list of (text, dict) where dict can have bold, italic, color, code."""
    p = doc.add_paragraph()
    for text, opts in runs:
        r = p.add_run(text)
        r.bold = opts.get("bold", False)
        r.italic = opts.get("italic", False)
        if opts.get("code"):
            r.font.name = "Consolas"
            r.font.size = Pt(10)
        if "color" in opts:
            r.font.color.rgb = opts["color"]
    return p

def CODE(text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.5)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    r.font.name = "Consolas"
    r.font.size = Pt(9)
    r.font.color.rgb = SLATE_900
    shade = OxmlElement("w:shd")
    shade.set(qn("w:val"), "clear")
    shade.set(qn("w:color"), "auto")
    shade.set(qn("w:fill"), "F4F4F5")
    p._p.get_or_add_pPr().append(shade)
    return p

def BULLET(text):
    p = doc.add_paragraph(text, style="List Bullet")
    return p

def NUM(text):
    p = doc.add_paragraph(text, style="List Number")
    return p

def PAGE_BREAK():
    doc.add_page_break()

def TABLE(headers, rows, widths=None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Light Grid Accent 1"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        r.font.size = Pt(10)
        tcPr = hdr[i]._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:fill"), "4F46E5")
        tcPr.append(shd)
    for ri, row in enumerate(rows, start=1):
        cells = table.rows[ri].cells
        for ci, v in enumerate(row):
            cells[ci].text = ""
            cells[ci].paragraphs[0].add_run(str(v)).font.size = Pt(10)
    if widths is not None:
        for col_idx, w in enumerate(widths):
            for r in table.rows:
                r.cells[col_idx].width = Cm(w)
    return table

def IMAGE(path, width_inches=6.0, caption=None):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Inches(width_inches))
    if caption:
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = cap.add_run(caption)
        r.italic = True
        r.font.size = Pt(9)
        r.font.color.rgb = SLATE_600


# ─────────────────────────────────────────────────────────────────────────
# Flowchart / diagram generators (matplotlib)
# ─────────────────────────────────────────────────────────────────────────
def draw_box(ax, x, y, w, h, text, fill="#FFFFFF", edge="#4F46E5", text_color="#18181B", fontsize=9, bold=False):
    rect = mpatches.FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.04",
        linewidth=1.2, edgecolor=edge, facecolor=fill, zorder=2,
    )
    ax.add_patch(rect)
    ax.text(
        x + w / 2, y + h / 2, text,
        ha="center", va="center", fontsize=fontsize,
        color=text_color, fontweight="bold" if bold else "normal",
        wrap=True, zorder=3,
    )
    return (x + w / 2, y + h / 2)

def draw_diamond(ax, x, y, w, h, text, fill="#FEF3C7", edge="#D97706", fontsize=9):
    diamond = mpatches.FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.08",
        linewidth=1.2, edgecolor=edge, facecolor=fill, zorder=2,
    )
    ax.add_patch(diamond)
    ax.text(
        x + w / 2, y + h / 2, text,
        ha="center", va="center", fontsize=fontsize, color="#7C2D12",
        fontweight="bold", wrap=True, zorder=3,
    )
    return (x + w / 2, y + h / 2)

def arrow(ax, x1, y1, x2, y2, label=None, color="#52525B"):
    a = FancyArrowPatch(
        (x1, y1), (x2, y2),
        arrowstyle="-|>", mutation_scale=12,
        color=color, linewidth=1.0, zorder=1,
    )
    ax.add_patch(a)
    if label:
        ax.text((x1 + x2) / 2, (y1 + y2) / 2, label, fontsize=8, color="#52525B",
                ha="center", va="center", backgroundcolor="white", zorder=4)

def setup_canvas(figsize=(10, 7), xlim=(0, 10), ylim=(0, 10)):
    fig, ax = plt.subplots(figsize=figsize)
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.set_aspect("equal")
    ax.axis("off")
    return fig, ax

def save_fig(fig, name, dpi=150):
    path = IMG_DIR / name
    fig.savefig(path, dpi=dpi, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return path


def gen_architecture_diagram():
    fig, ax = setup_canvas(figsize=(11, 8.5), xlim=(0, 11), ylim=(0, 9))

    # Layer 1: Google Sheet
    ax.add_patch(mpatches.Rectangle((0.3, 6.5), 10.4, 2.2, linewidth=1.5,
                                    edgecolor="#A1A1AA", facecolor="#F4F4F5", zorder=1))
    ax.text(0.5, 8.45, "GOOGLE SHEET — the database", fontsize=10, fontweight="bold", color="#52525B")

    # Source tabs
    for i, name in enumerate(["India Employees", "US Employees", "RM Data", "Finance / Risk", "Offboarded"]):
        draw_box(ax, 0.5 + i*2.0, 7.4, 1.8, 0.7, name, fill="#EEF2FF", edge="#4F46E5", fontsize=8)
    ax.text(0.5, 7.18, "Source tabs", fontsize=8, color="#71717A", style="italic")

    # Helper tabs
    helpers = ["_Config", "Logs", "Changelog", "QA", "_Templates", "Dashboard"]
    for i, name in enumerate(helpers):
        draw_box(ax, 0.5 + i*1.7, 6.65, 1.6, 0.5, name, fill="#FFFFFF", edge="#A1A1AA", fontsize=7)

    # Triggers arrow
    arrow(ax, 5.5, 6.5, 5.5, 5.5, label="onEdit / pulse / daily")

    # Apps Script backend
    ax.add_patch(mpatches.Rectangle((0.3, 2.5), 10.4, 3.0, linewidth=1.5,
                                    edgecolor="#A1A1AA", facecolor="#FAFAFA", zorder=1))
    ax.text(0.5, 5.25, "APPS SCRIPT BACKEND  (V8)", fontsize=10, fontweight="bold", color="#52525B")

    draw_box(ax, 0.5, 4.5, 2.1, 0.5, "10_Triggers", fill="#FEF3C7", edge="#D97706", fontsize=8)
    draw_box(ax, 2.8, 4.5, 2.0, 0.5, "02_Headers", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 5.0, 4.5, 2.0, 0.5, "03_Cache", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 7.2, 4.5, 2.0, 0.5, "04_DataAccess", fill="#FFFFFF", edge="#4F46E5", fontsize=8)

    draw_box(ax, 0.5, 3.7, 2.1, 0.5, "05_Metrics", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 2.8, 3.7, 2.0, 0.5, "06_Alerts", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 5.0, 3.7, 2.0, 0.5, "07_HealthScore", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 7.2, 3.7, 2.0, 0.5, "09_Workflow", fill="#FFFFFF", edge="#4F46E5", fontsize=8)

    draw_box(ax, 0.5, 2.9, 2.1, 0.5, "11_Email", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 2.8, 2.9, 2.0, 0.5, "12_Logger", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 5.0, 2.9, 2.0, 0.5, "13_SelfMonitor", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 7.2, 2.9, 2.0, 0.5, "14_QA / 16_Verify", fill="#FFFFFF", edge="#4F46E5", fontsize=8)

    arrow(ax, 5.5, 2.5, 5.5, 1.7, label="api_snapshot poll, 5s")

    # Web App
    ax.add_patch(mpatches.Rectangle((0.3, 0.2), 10.4, 1.5, linewidth=1.5,
                                    edgecolor="#A1A1AA", facecolor="#F4F4F5", zorder=1))
    ax.text(0.5, 1.45, "WEB APP  (HtmlService)", fontsize=10, fontweight="bold", color="#52525B")
    draw_box(ax, 0.5, 0.4, 1.8, 0.6, "doGet + auth", fill="#EEF2FF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 2.6, 0.4, 1.8, 0.6, "WebApp.html", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 4.7, 0.4, 1.8, 0.6, "Vanilla JS render", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 6.8, 0.4, 1.8, 0.6, "Google Charts", fill="#FFFFFF", edge="#4F46E5", fontsize=8)
    draw_box(ax, 8.9, 0.4, 1.6, 0.6, "5s polling", fill="#D1FAE5", edge="#059669", fontsize=8)

    return save_fig(fig, "architecture.png")


def gen_real_time_flowchart():
    fig, ax = setup_canvas(figsize=(8.5, 11), xlim=(0, 10), ylim=(0, 14))

    draw_box(ax, 3, 13, 4, 0.6, "HR edits a source cell", fill="#EEF2FF", edge="#4F46E5", bold=True)
    arrow(ax, 5, 13, 5, 12.3)
    draw_box(ax, 2.5, 11.6, 5, 0.7, "onEditInstallable fires (~<1s)", fill="#FFFFFF", edge="#4F46E5", bold=True)
    arrow(ax, 5, 11.6, 5, 10.9)
    draw_diamond(ax, 2.5, 10.0, 5, 0.9, "silentWrite flag set?\n(rebuild's own write)")
    arrow(ax, 7.5, 10.4, 9.0, 10.4, label="yes")
    draw_box(ax, 8.6, 10.05, 1.4, 0.7, "ignore", fill="#FEE2E2", edge="#DC2626")
    arrow(ax, 5, 10.0, 5, 9.4, label="no")
    draw_diamond(ax, 2.5, 8.5, 5, 0.9, "tab in blocklist?\n(Dashboard / Logs / etc.)")
    arrow(ax, 7.5, 8.9, 9.0, 8.9, label="yes")
    draw_box(ax, 8.6, 8.55, 1.4, 0.7, "ignore", fill="#FEE2E2", edge="#DC2626")
    arrow(ax, 5, 8.5, 5, 7.9, label="no")
    draw_diamond(ax, 2.5, 7.0, 5, 0.9, "Action column?\n(workflow trigger)")
    arrow(ax, 7.5, 7.4, 9.0, 7.4, label="yes")
    draw_box(ax, 8.0, 6.65, 2.0, 1.5, "Workflow.\nhandleEdit:\nlock + email\n+ stamp",
             fill="#FFFBEB", edge="#D97706")
    arrow(ax, 5, 7.0, 5, 6.4, label="no")

    draw_box(ax, 2.5, 5.7, 5, 0.7, "Cache.bust('data:')  +  set lastEditTs", fill="#FFFFFF", edge="#4F46E5")
    arrow(ax, 5, 5.7, 5, 5.0)
    draw_box(ax, 2.5, 4.3, 5, 0.7, "ScriptLock.tryLock(0)\n(only first onEdit wins)", fill="#FFFFFF", edge="#4F46E5")
    arrow(ax, 5, 4.3, 5, 3.6)
    draw_box(ax, 2.5, 2.9, 5, 0.7, "Poll until burst settles (≥1.5s idle)", fill="#FFFFFF", edge="#4F46E5")
    arrow(ax, 5, 2.9, 5, 2.2)
    draw_diamond(ax, 2.5, 1.3, 5, 0.9, ">20 rebuilds in 60s?\n(circuit breaker)")
    arrow(ax, 7.5, 1.7, 9.0, 1.7, label="yes")
    draw_box(ax, 8.6, 1.35, 1.4, 0.7, "trip 5min", fill="#FEE2E2", edge="#DC2626", bold=True)
    arrow(ax, 5, 1.3, 5, 0.6, label="no")
    draw_box(ax, 2.5, 0.0, 5, 0.6, "rebuildDashboard  →  bust snapshot:* cache",
             fill="#D1FAE5", edge="#059669", bold=True)

    return save_fig(fig, "real_time_flow.png")


def gen_diag_webapp_blank():
    fig, ax = setup_canvas(figsize=(9, 9), xlim=(0, 10), ylim=(0, 11))
    draw_box(ax, 3, 10.2, 4, 0.6, "Web App URL shows blank / loading", fill="#FEE2E2", edge="#DC2626", bold=True)
    arrow(ax, 5, 10.2, 5, 9.5)
    draw_diamond(ax, 2.5, 8.6, 5, 0.9, "Header visible?")
    arrow(ax, 2.5, 9.0, 0.6, 9.0, label="no")
    draw_box(ax, 0.0, 8.6, 2.4, 0.8, "Auth gate failed.\nCheck _Config\nallowlist.emails", fill="#FEF3C7", edge="#D97706")
    arrow(ax, 5, 8.6, 5, 7.8, label="yes")
    draw_diamond(ax, 2.5, 6.9, 5, 0.9, "DevTools Console\nshows errors?")
    arrow(ax, 5, 6.9, 5, 6.1, label="yes")
    draw_box(ax, 2.0, 5.1, 6.0, 0.9, "Look for ReferenceError on api_snapshot\n→ check Apps Script Executions tab for doGet errors", fill="#FFFFFF", edge="#4F46E5")
    arrow(ax, 5, 6.9, 8.5, 6.5, label="no")
    draw_box(ax, 7.5, 6.05, 2.5, 0.9, "Hard-refresh\nincognito,\nor redeploy", fill="#EEF2FF", edge="#4F46E5")
    arrow(ax, 5, 5.1, 5, 4.4)
    draw_diamond(ax, 2.5, 3.4, 5, 0.9, "api_snapshot fails\nin editor too?")
    arrow(ax, 5, 3.4, 5, 2.6, label="yes")
    draw_box(ax, 2.0, 1.7, 6.0, 0.8, "Run setupWorkbook again (flushes cache).\nThen test api_snapshot from the editor.", fill="#FFFBEB", edge="#D97706")
    arrow(ax, 5, 3.4, 8.0, 3.0, label="no")
    draw_box(ax, 7.0, 2.6, 3.0, 0.8, "Open Manage Deployments\n→ new version → Deploy.", fill="#EEF2FF", edge="#4F46E5")
    arrow(ax, 5, 1.7, 5, 0.9)
    draw_box(ax, 2.5, 0.2, 5.0, 0.6, "Dashboard should now render", fill="#D1FAE5", edge="#059669", bold=True)
    return save_fig(fig, "diag_webapp.png")


def gen_diag_sheet_stale():
    fig, ax = setup_canvas(figsize=(9, 8.5), xlim=(0, 10), ylim=(0, 10))
    draw_box(ax, 3, 9.2, 4, 0.6, "Sheet Dashboard not updating", fill="#FEE2E2", edge="#DC2626", bold=True)
    arrow(ax, 5, 9.2, 5, 8.5)
    draw_diamond(ax, 2.5, 7.6, 5, 0.9, "Edit source cell —\nany activity in Logs?")
    arrow(ax, 5, 7.6, 5, 6.8, label="no")
    draw_box(ax, 2.0, 5.9, 6.0, 0.8, "Triggers not installed.\nMenu: HR Automation → Install Triggers", fill="#FFFBEB", edge="#D97706")
    arrow(ax, 5, 7.6, 8.5, 7.2, label="yes")
    draw_diamond(ax, 7.0, 5.9, 3.0, 0.9, "Logs show errors?")
    arrow(ax, 8.5, 5.9, 8.5, 5.1, label="yes")
    draw_box(ax, 7.0, 4.2, 3.0, 0.8, "Read top error.\nFix root cause.", fill="#FEE2E2", edge="#DC2626")
    arrow(ax, 8.5, 5.9, 8.5, 3.0, label="no")
    draw_box(ax, 7.0, 2.1, 3.0, 0.8, "Check Circuit Breaker.\nProps: circuit:tripped", fill="#FEF3C7", edge="#D97706")
    arrow(ax, 5, 5.9, 5, 5.1)
    draw_box(ax, 2.0, 4.3, 6.0, 0.8, "Check Executions tab:\nfind onEditInstallable, look for failures", fill="#FFFFFF", edge="#4F46E5")
    arrow(ax, 5, 4.3, 5, 3.5)
    draw_diamond(ax, 2.5, 2.6, 5, 0.9, "Web App lags but Sheet OK?")
    arrow(ax, 5, 2.6, 5, 1.8, label="yes")
    draw_box(ax, 2.0, 0.9, 6.0, 0.8, "Web App is on OLD deployment.\nManage Deployments → new version.", fill="#EEF2FF", edge="#4F46E5")
    arrow(ax, 5, 0.9, 5, 0.4)
    draw_box(ax, 2.5, 0.0, 5.0, 0.4, "Confirm both surfaces reflect within ~7s", fill="#D1FAE5", edge="#059669", bold=True)
    return save_fig(fig, "diag_sheet.png")


def gen_diag_email():
    fig, ax = setup_canvas(figsize=(8.5, 8), xlim=(0, 10), ylim=(0, 9.5))
    draw_box(ax, 3, 8.7, 4, 0.6, "Workflow email did not arrive", fill="#FEE2E2", edge="#DC2626", bold=True)
    arrow(ax, 5, 8.7, 5, 8.0)
    draw_diamond(ax, 2.5, 7.1, 5, 0.9, "Action Status === 'Done'?")
    arrow(ax, 5, 7.1, 5, 6.3, label="no")
    draw_box(ax, 2.0, 5.4, 6.0, 0.8, "Workflow handler did not run.\nCheck Logs for Workflow.handleEdit ERROR.", fill="#FEE2E2", edge="#DC2626")
    arrow(ax, 5, 7.1, 8.5, 6.7, label="yes")
    draw_diamond(ax, 6.5, 5.6, 3.5, 0.9, "MailApp quota left > 10?")
    arrow(ax, 6.5, 6.0, 5, 5.1, label="no")
    draw_box(ax, 2.0, 4.3, 6.0, 0.7, "Mail quota exhausted (100/day for personal Gmail).\nWait 24h for reset.", fill="#FEF3C7", edge="#D97706")
    arrow(ax, 8.0, 5.6, 8.0, 4.8, label="yes")
    draw_diamond(ax, 6.5, 3.9, 3.5, 0.9, "Template exists in _Templates?")
    arrow(ax, 6.5, 4.3, 5, 3.4, label="no")
    draw_box(ax, 2.0, 2.6, 6.0, 0.7, "Template missing. Re-seed _Templates from Bootstrap.", fill="#FEF3C7", edge="#D97706")
    arrow(ax, 8.0, 3.9, 8.0, 3.1, label="yes")
    draw_box(ax, 6.0, 2.2, 4.0, 0.8, "Check spam folder on recipient mailbox.\nVerify Apps Script user matches sender.",
             fill="#EEF2FF", edge="#4F46E5")
    arrow(ax, 5, 2.6, 5, 1.8)
    draw_box(ax, 2.5, 0.9, 5.0, 0.8, "Resolve template / quota / address.\nRetry by picking Action dropdown again.", fill="#FFFFFF", edge="#4F46E5")
    arrow(ax, 5, 0.9, 5, 0.4)
    draw_box(ax, 2.5, 0.0, 5.0, 0.4, "Email arrives + Action Status = Done", fill="#D1FAE5", edge="#059669", bold=True)
    return save_fig(fig, "diag_email.png")


def gen_health_score_bars():
    """Worked example chart for HR Health Score."""
    fig, ax = plt.subplots(figsize=(9, 4))
    pillars = ["Stability", "Alert Load", "Risk Posture", "Productivity"]
    earned = [22.5, 18.8, 20.0, 18.8]
    max_v = [25, 25, 25, 25]
    colors = ["#059669", "#D97706", "#059669", "#D97706"]
    y = range(len(pillars))
    ax.barh(y, max_v, color="#F4F4F5", height=0.55, edgecolor="#E4E4E7")
    ax.barh(y, earned, color=colors, height=0.55)
    for i, (e, m) in enumerate(zip(earned, max_v)):
        ax.text(e + 0.4, i, f"{e:.1f} / {m}", va="center", fontsize=10, color="#18181B")
    ax.set_yticks(list(y))
    ax.set_yticklabels(pillars, fontsize=10)
    ax.set_xlim(0, 30)
    ax.set_xticks([0, 5, 10, 15, 20, 25])
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#E4E4E7")
    ax.spines["bottom"].set_color("#E4E4E7")
    ax.set_title("HR Health Score — worked example  ·  Total = 80.1 / 100 (Green)",
                 fontsize=11, color="#18181B", loc="left")
    return save_fig(fig, "health_score.png")


# ─────────────────────────────────────────────────────────────────────────
# Sections
# ─────────────────────────────────────────────────────────────────────────
def section_cover():
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run("\n\nStandard Operating Procedure")
    r.font.size = Pt(30); r.font.bold = True; r.font.color.rgb = INDIGO

    s = doc.add_paragraph()
    s.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = s.add_run("Techolution HR Automation Dashboard")
    r.font.size = Pt(17); r.font.color.rgb = SLATE_900

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = sub.add_run("Google Sheets · Apps Script · HtmlService Web App")
    r.font.size = Pt(11); r.font.italic = True; r.font.color.rgb = SLATE_600

    doc.add_paragraph("\n" * 6)

    TABLE(
        headers=["", ""],
        rows=[
            ["Author", "Ruthvik Nagulapally · ruthviknagulapally@gmail.com"],
            ["For", "Aadish Jain · aadish.jain@techolution.com"],
            ["Date", "14 June 2026"],
            ["Stack", "Google Sheets + Apps Script (V8) + HtmlService"],
        ],
        widths=[3.5, 13.0],
    )
    PAGE_BREAK()


def section_executive_summary():
    H1("1.  What this is")
    P("A live HR dashboard for Techolution's India + US workforce. Two surfaces — a Dashboard tab inside the "
      "workbook and a deployed Web App URL — both fed by the same source data, both reflecting HR edits within "
      "~7 seconds. No buttons, no manual refresh.")

    P("Everything required by §4.1–§4.6 of the brief is in. All seven differentiators from §5 are in too: modular "
      "project (17 files), workflow engine, HR Health Score, test harness, self-monitoring, changelog, "
      "and this diagram (next page).")

    H2("Verification protocol coverage")
    rows = [
        ["1", "Rename columns", "Alias map + uniqueness-guarded fuzzy fallback in 02_Headers.gs"],
        ["2", "Add 3 employees", "onEdit + 1.5s debounce + 5s poll = ~7s end-to-end"],
        ["3", "Change DOJ", "Confirmation = DOJ + 180; recomputed live"],
        ["4", "Delete offboarded row", "Cache busted; quarterly attrition recomputes"],
        ["5", "Auth gate", "doGet checks Session email against _Config allowlist"],
        ["6", "Logs history", "Bootstrap seeds ~100 backdated rows; every trigger adds more"],
    ]
    TABLE(["#", "Reviewer step", "How it's handled"], rows, widths=[1.0, 4.0, 11.5])
    P_runs([("There's also an automated harness for this — run ", {}),
            ("HR Automation → Run Verification Protocol", {"bold": True}),
            (" from the sheet menu. It mutates the sheet, asserts each step, restores state. Results land in the "
             "QA tab. All six PASS in the latest run.", {})])
    PAGE_BREAK()


def section_architecture():
    H1("2.  Architecture")
    P("Three layers: the Google Sheet (database), the Apps Script backend (compute), and an HtmlService Web App "
      "(UI). Source edits flow through trigger-driven cache invalidation. The Web App polls a cached snapshot "
      "every 5 seconds so server load stays bounded under multi-user load.")
    IMAGE(IMG_DIR / "architecture.png", width_inches=6.6,
          caption="System architecture — 17 Apps Script modules; Web App polls api_snapshot every 5s.")

    H2("Helper tabs")
    rows = [
        ["_Config", "Every threshold, the allowlist, the column aliases. Only place to tune the system."],
        ["Logs", "Append-only execution history with timestamps, RunId, level, function, message, duration."],
        ["Changelog", "One row per pipeline run. Useful for trend reading."],
        ["QA", "Test harness output — both the 11-assertion run and the 6-step verification harness."],
        ["_Templates", "Email subject + HTML body per template key."],
        ["Dashboard / Org Chart / Drill-Down", "Rendered by the script. Don't type into Dashboard."],
    ]
    TABLE(["Tab", "Role"], rows, widths=[4.0, 12.5])

    H2("Web App tabs (Phase 2)")
    P("Four additional main tabs live in the Web App (not the Sheet): Manage Employees, Finance, Productivity, "
      "and Alert Engine. Two more helper-style tabs — Audit Log and Productivity History — support those "
      "primary views.")
    rows = [
        ["Manage Employees", "Full employee roster with Add, Edit (side-panel modal), and Offboard flows. "
         "Writes go through api_addEmployee / api_updateEmployee / api_offboardEmployee."],
        ["Finance", "Finance & Risk Report metrics pulled from the Finance · Productivity Risk Report tab."],
        ["Productivity", "Allocation and productivity scores per employee, sourced from RM Data."],
        ["Alert Engine", "Recommendation rules engine. Shows fired rules; HR can dismiss or action items."],
        ["Audit Log", "Every web-app write — add, update, offboard — with old vs new values and the actor email."],
        ["Productivity History", "Snapshot history of allocation trends over time for trend analysis."],
    ]
    TABLE(["Tab", "Role"], rows, widths=[4.0, 12.5])
    PAGE_BREAK()


def section_real_time_pattern():
    H1("3.  Real-time reflection")
    P("§4.3 is the strictest mandate in the brief — both surfaces have to update without HR doing anything. Here's "
      "how that works.")

    H2("Latency budget")
    rows = [
        ["onEdit fires + cache bust + lock acquire", "~0.4 s"],
        ["Burst-coalesce wait (1.5s of edit-idle)", "+ 1.5 s"],
        ["rebuildDashboard run", "+ 0.5–2 s"],
        ["Web App's next poll", "+ up to 5 s"],
        ["TOTAL worst case", "≈ 7 s"],
    ]
    TABLE(["Stage", "Time"], rows, widths=[11.0, 5.5])

    H2("Why this design")
    P("The hard problem is preventing the rebuild's own writes from re-triggering onEdit forever. Three layers of "
      "defence:")
    BULLET("withSilentWrite — sets a ScriptProperty before writes, clears it in finally. onEdit early-returns "
           "if the flag is set.")
    BULLET("Tab-name allowlist — even if the flag leaks, onEdit ignores edits to Dashboard / Logs / Changelog / QA / "
           "Org Chart / _Templates by name.")
    BULLET("Circuit breaker — if more than 20 rebuilds fire in 60s, the trigger logs CRITICAL and suppresses "
           "rebuilds for 5 minutes. A one-shot reset trigger re-enables and deletes itself.")
    P("Polling instead of push is forced by the platform — HtmlService web apps can't keep a WebSocket open. "
      "5 seconds is the sweet spot: feels live, stays within execution quota.")
    IMAGE(IMG_DIR / "real_time_flow.png", width_inches=4.8,
          caption="The full path from cell edit to rendered update.")
    PAGE_BREAK()


def section_health_score():
    H1("4.  HR Health Score")
    P("A 0–100 composite of four equally-weighted pillars (0–25 each). Equal weighting is a deliberate audit "
      "choice — there's no \"why 30%?\" question to defend. Bands: ≥80 Green, 60–79 Amber, <60 Red.")

    rows = [
        ["Stability", "Quarterly attrition rate", "25 × (1 − min(attr, 0.25) / 0.25)"],
        ["Alert Load", "Critical alerts ÷ headcount", "25 × (1 − min(ratio, 0.20) / 0.20)"],
        ["Risk Posture", "Employees in 30-day risk window ÷ headcount", "25 × (1 − min(risky / hc, 0.30) / 0.30)"],
        ["Productivity", "Average productivity ÷ target", "25 × clamp(avgProd / target, 0, 1)"],
    ]
    TABLE(["Pillar", "Source signal", "Formula"], rows, widths=[3.0, 5.5, 8.0])

    H2("Worked example")
    P("Illustrative numbers — 95-employee workforce, end of Q2 2026:")
    rows = [
        ["Stability", "1.5% quarterly attrition", "25 × 0.94", "23.5"],
        ["Alert Load", "5 critical alerts / 95 employees", "25 × 0.735", "18.4"],
        ["Risk Posture", "9 employees in 30-day risk window", "25 × 0.683", "17.1"],
        ["Productivity", "Avg 0.74 vs target 0.80", "25 × 0.925", "23.1"],
        ["", "", "Total", "82.1 → Green"],
    ]
    TABLE(["Pillar", "Input", "Maths", "Earned"], rows, widths=[3.0, 5.0, 4.5, 4.0])
    IMAGE(IMG_DIR / "health_score.png", width_inches=5.8)

    P_runs([("Pillar weights, productivity target, and the band cutoffs all live in ", {}),
            ("_Config", {"code": True}),
            (". No code change to tune.", {})])
    PAGE_BREAK()


def section_hr_use():
    H1("5.  Daily use")
    H2("In the sheet")
    P("HR works on the source tabs — India Employee Database, US Employee Database, RM Data, Finance · Productivity "
      "Risk Report, Offboarded Resources. Within ~2 seconds of any edit, the Dashboard tab re-renders. The "
      "Drill-Down tab has four filter dropdowns in row 3 (Region, Department, Reporting Manager, Status) that "
      "redraw the results table on change.")

    P_runs([("To add a new monthly allocation column on RM Data, just append a column on the right with the month "
             "label (e.g. ", {}),
            ("Jun 2026", {"code": True}),
            ("). The current month is auto-discovered each run — no config to update.", {})])

    H2("In the Web App")
    P("Sign in with Google. If your email is on the allowlist (see §6), the dashboard loads. It auto-refreshes every "
      "5 seconds and pauses when the tab is hidden. Sections: KPI strip, HR Health Score, alerts (tabbed Critical / "
      "Warning / LWD / Probation), Department Breakdown, Attrition Trend, Org Chart, Drill-Down.")

    H2("Workflow actions")
    P_runs([("India and US tabs have an ", {}), ("Action", {"code": True}),
            (" column with three dropdown choices: Start Offboarding, Schedule PIP, Approve Confirmation. "
             "Picking one sends the corresponding email, stamps ", {}),
            ("Action Status = Done", {"code": True}),
            (", and prevents a second pick. The same dropdown selection on the same row is a no-op with a toast — "
             "the engine reverts the cell to ", {}),
            ("—", {"code": True}),
            (" and logs a WARN.", {})])

    H2("Managing employees from the Web App")
    P("The Manage Employees tab is the fastest way to make individual employee changes without opening the Sheet. "
      "Click any row to open the side-panel modal — every editable field is there. Save writes directly to the "
      "India or US source tab via api_updateEmployee and busts the dashboard cache, so the Overview KPIs update "
      "within the usual ~7 seconds. The Add Employee button at the top right runs the same onboarding flow as the "
      "Sheet-side bootstrap. Offboarding moves the row to the Offboarded tab and stamps the exit date.")
    P("The Audit Log tab records every one of those writes: who did it, when, what field changed, and the old vs "
      "new values. It's append-only — nothing in the UI can delete a row. If you need to investigate a bad edit, "
      "filter by employee name or actor email. The search bar at the top of the Audit Log (and the same pattern on "
      "Manage Employees, Drill-Down, and Productivity) does a live client-side filter across all visible columns. "
      "Risk dots — red / amber / green — appear on Manage Employees and Productivity rows to give an at-a-glance "
      "posture without opening a modal.")

    H2("The Reporting Manager / Org Chart caveat")
    P("The org chart links each row's Reporting Manager value to another row's Employee Name. In the starter "
      "dataset shipped with the assignment, none of those values actually match — so every employee ends up "
      "looking like a root, and the chart is a flat row of cards.")
    P("The resolver tries hard before giving up — exact match, then case-insensitive, then Emp ID, then substring "
      "(so \"Ruth N.\" matches \"Ruthvik Nagulapally\"). When fewer than 30% of links resolve, it logs a WARN. "
      "The fix is in the source data, not the code: clean the Reporting Manager column so the values appear in "
      "the Employee Name column too. Within ~7 seconds, the chart picks up the hierarchy.")
    PAGE_BREAK()


def section_config():
    H1("6.  Configuration")
    P_runs([("Everything tunable lives in two tabs. ", {}), ("_Config", {"code": True}),
            (" holds thresholds, the allowlist, and column aliases. ", {}),
            ("_Templates", {"code": True}),
            (" holds email subject + HTML body per template key. No code changes needed.", {})])

    H2("Key _Config rows")
    rows = [
        ["allowlist · emails",
         "Who can open the Web App. Supports exact emails (aadish.jain@techolution.com), domain wildcards "
         "(*@techolution.com), and full open (*). For review periods, the domain wildcard is the right choice — "
         "any Techolution Google account gets through, non-Techolution doesn't."],
        ["thresholds · lwdAlertDays / probationConfirmDays / probationLengthDays",
         "Alert windows. Defaults 45 / 30 / 180 per brief §4.4."],
        ["thresholds · productivityTarget / lowProductivity / benchAllocation",
         "Productivity floor and allocation floor. Used by alerts + Health Score productivity pillar."],
        ["health.weights · *  /  health.bands · green / amber",
         "Tune the Health Score weights (default 25 each, sum to 100) and band cutoffs (default 80 / 60)."],
        ["thresholds · recommendationsCacheSeconds",
         "How long the Alert Engine's snapshot is cached before the next api_getRecommendations call hits "
         "the backend again. Default 60. Drop to 10 during development; raise to 300 in stable prod to reduce "
         "quota usage."],
        ["email · alertEmailRecipient",
         "The email address that receives alert notification emails from the Alert Email Engine. Intended for "
         "HR's own inbox during testing so real employee addresses aren't hit. Leave blank to disable alert "
         "emails entirely without touching demoMode."],
        ["aliases.<tab> · <canonical>",
         "Comma-separated list of accepted column header names per canonical name (empId, doj, lwd, etc.). "
         "This is what makes column renames safe — add a new alias here when your sheet's headers diverge."],
    ]
    TABLE(["Section · Key", "What it controls"], rows, widths=[5.5, 11.0])

    H2("Email templates")
    P_runs([("Edit ", {}), ("_Templates", {"code": True}),
            (" rows. Placeholders are double curly braces — ", {}),
            ("{{empName}}", {"code": True}), (", ", {}),
            ("{{empId}}", {"code": True}), (", ", {}),
            ("{{dept}}", {"code": True}), (", ", {}),
            ("{{rm}}", {"code": True}), (", ", {}),
            ("{{doj}}", {"code": True}), (", ", {}),
            ("{{actorName}}", {"code": True}),
            (". The daily digest template also gets ", {}),
            ("{{lwdTable}}", {"code": True}), (" and ", {}),
            ("{{probTable}}", {"code": True}),
            (" — pre-rendered HTML tables of active alerts. Changes apply on the next email send.", {})])
    PAGE_BREAK()


def section_troubleshooting():
    H1("7.  Troubleshooting")
    P("Most common symptoms, what causes them, and what to do.")
    rows = [
        ["Web App is blank",
         "Deployed version is on old code, OR doGet caught an error and bootstrapSnapshot has an error field.",
         "Manage Deployments → New version. Open DevTools console — if there's a ReferenceError, the JSON injection "
         "rendered wrong. Check the Apps Script editor's Executions tab for the failing doGet."],
        ["Sheet Dashboard not updating after an edit",
         "Triggers not installed, OR circuit breaker tripped (suspected loop), OR rebuild errored.",
         "Menu: HR Automation → Install Triggers. Check Logs for repeated rebuildDashboard ERROR rows. "
         "Circuit breaker auto-resets in 5 min."],
        ["Workflow email didn't arrive",
         "Mail quota exhausted (100/day on personal Gmail), template missing, or recipient mistyped.",
         "Check Logs for the workflow run. Look at MailApp.getRemainingDailyQuota(). Confirm template exists in "
         "_Templates."],
        ["SchemaDriftError in Logs",
         "A column was renamed to something the alias map doesn't know AND fuzzy match couldn't resolve.",
         "Add the new column name to _Config aliases.<tab>.<canonical> as a new comma-separated entry."],
        ["Org Chart shows employees side-by-side, no hierarchy",
         "Reporting Manager values don't match any Employee Name (true for the starter dataset).",
         "Clean the source data — match values across the two columns. Code requires no change."],
        ["clasp push fails: \"invalid argument\"",
         "Using clasp 3.x (broken), OR Apps Script API not enabled in user settings.",
         "Pin clasp at v2.4.2. Enable the API at script.google.com/home/usersettings."],
        ["Web App still shows old data after clasp push",
         "clasp push only updates HEAD code. The deployed URL is pinned to a specific version.",
         "Deploy → Manage Deployments → pencil → New version → Deploy."],
        ["No recommendations show on Alert Engine tab",
         "Snapshot is fresh but either no rules fire against current data, OR the snapshot cache hasn't "
         "busted since the last data change.",
         "Menu → HR Automation → Rebuild Dashboard to force a fresh snapshot. If rules still don't fire, "
         "check that the relevant threshold values in _Config actually match the current data state."],
        ["Audit Log empty after edits",
         "A mid-write exception prevented the audit entry from being appended. The employee change may or "
         "may not have landed.",
         "Check the Logs tab for any api_updateEmployee / api_addEmployee / api_offboardEmployee ERROR rows. "
         "The error message will show which field write failed and why."],
        ["Alert emails not sending",
         "Either _Config.email.alertEmailRecipient is blank (no target address) or email.demoMode is true "
         "(emails are suppressed globally).",
         "Menu → HR Automation → Run Alert Email Engine — the toast result will confirm whether an email "
         "was sent or blocked. Fill in alertEmailRecipient and/or set demoMode to false to enable real sends."],
    ]
    TABLE(["Symptom", "Cause", "Fix"], rows, widths=[4.5, 5.5, 6.5])
    PAGE_BREAK()


def section_developer():
    H1("8.  Maintaining the code")
    H2("Toolchain gotchas worth saving you a day")
    BULLET("Pin clasp at v2.4.2. clasp 3.x has a regression that breaks push with an opaque \"invalid argument\" error.")
    BULLET("Enable the Apps Script API at script.google.com/home/usersettings on the Google account you deploy from. "
           "Without it, clasp push fails the same way.")
    BULLET("clasp push updates HEAD, but the Web App URL is pinned to a specific deployment version. "
           "After every push, go to Manage Deployments → pencil → New version → Deploy. The URL stays the same.")
    BULLET("Apps Script's HtmlService CSP blocks eval and Function() — that rules out standard Alpine.js and "
           "Tailwind v3 Play CDN. The Web App is vanilla JS + Tailwind v2 static CSS. Stick to that for future UI work.")

    H2("Project structure")
    P("23 .gs files, single concern each. Numeric prefixes (00 → 99) are for human navigation; load order doesn't "
      "matter since all cross-file references happen at call time. Each module uses the same namespace-on-IIFE "
      "pattern — see 03_Cache.gs for a clean example.")

    H3("Phase 2 modules (17 → 22)")
    rows = [
        ["17_Recommendations.gs", "Alert Engine rules engine. Evaluates rule definitions against the "
         "current snapshot and returns fired recommendations for the web app to display."],
        ["18_Finance.gs", "Reads Finance · Productivity Risk Report tab; exposes api_getFinanceData "
         "for the Finance tab."],
        ["19_Productivity.gs", "Reads RM Data allocation columns; exposes api_getProductivityData "
         "for the Productivity tab."],
        ["20_AlertEmails.gs", "Sends alert notification emails to _Config.email.alertEmailRecipient. "
         "Respects demoMode."],
        ["21_AuditLog.gs", "Appends audit rows on every web-app write (add / update / offboard). "
         "Exposes api_getAuditLog for the Audit Log tab."],
        ["22_Risk.gs", "Computes per-employee risk dots (red / amber / green) used by Manage "
         "Employees and Productivity tab row decorations."],
    ]
    TABLE(["File", "Responsibility"], rows, widths=[4.5, 12.0])

    H2("Adding a new module")
    NUM("New file under src/, named like XX_NewModule.gs.")
    NUM("Wrap it in the namespace pattern: var NewModule = NewModule || {}; (function(ns){ ns.fn = ... })(NewModule);")
    NUM("If it needs onEdit handling, add a branch in 10_Triggers.gs's onEditInstallable.")
    NUM("If it exposes a Web App call, name the function api_* in 15_WebAPI.gs.")
    NUM("Add at least one assertion in 14_QA.gs that exercises the happy path.")

    H2("Version control")
    P_runs([("Apps Script has built-in version history (", {}),
            ("File → See version history", {"bold": True}),
            ("), and the local clone is a git repo too. Both are useful — Apps Script version history is the "
             "fastest rollback path, git history is the trail of why a change happened.", {})])
    P("To roll back the Web App: Manage Deployments → edit the active deployment → pick the prior version → "
      "Deploy. URL is unchanged.")
    PAGE_BREAK()


def section_appendix_b():
    H1("Appendix.  Brief requirement mapping")
    P("Every §4 and §5 line in the brief, mapped to the SOP section and file that satisfies it.")
    rows = [
        ["§4.1 Sheet Dashboard sections (KPI / LWD / Probation / Dept / Attrition / Risk)", "§2, §5 · rendered by 00_Main.rebuildDashboard"],
        ["§4.1 Org chart on separate tab", "§5 (caveat) · 08_OrgChart.gs"],
        ["§4.1 Drill-Down filters", "§5 · 00_Main.applyDrilldown"],
        ["§4.2 Web App deployed + authentication", "§5, §6, §8 · doGet in 00_Main.gs"],
        ["§4.3 Real-time reflection", "§3 entire · 10_Triggers.gs"],
        ["§4.4 Intern LWD alerts (45d window)", "§5 · 06_Alerts.gs lwdWithin"],
        ["§4.4 Probation alerts (DOJ + 180)", "§4, §5 · 06_Alerts.gs probationDue"],
        ["§4.4 Daily email digest", "§6 · 11_Email.gs sendDailyDigest"],
        ["§4.4 Thresholds in _Config, not in code", "§6 · 01_Config.gs"],
        ["§4.5 Time-based + event-driven triggers", "§3 · 10_Triggers.gs"],
        ["§4.5 Append-only Logs tab", "§2 · 12_Logger.gs"],
        ["§4.5 Header-agnostic column lookup", "§1, §7 · 02_Headers.gs"],
        ["§4.5 Human-readable input validation", "§7 · every catch path returns text, not stack"],
        ["§4.6 SOP — daily use, config, troubleshooting, code maintenance", "§5, §6, §7, §8"],
        ["§5 #1 Modular Apps Script project", "§2 (17 .gs files)"],
        ["§5 #2 Workflow engine", "§5 · 09_Workflow.gs"],
        ["§5 #3 HR Health Score", "§4 · 07_HealthScore.gs"],
        ["§5 #4 Built-in test harness", "§1 · 14_QA.gs + 16_Verification.gs"],
        ["§5 #5 Self-monitoring", "§7 · 13_SelfMonitor.gs"],
        ["§5 #6 Changelog tab", "§2 · 12_Logger.gs"],
        ["§5 #7 Architecture diagram in SOP", "§2"],
    ]
    TABLE(["Brief requirement", "Where to find it"], rows, widths=[11.0, 5.5])


# ─────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────
def main():
    gen_architecture_diagram()
    gen_real_time_flowchart()
    gen_diag_webapp_blank()
    gen_diag_sheet_stale()
    gen_diag_email()
    gen_health_score_bars()

    section_cover()
    section_executive_summary()
    section_architecture()
    section_real_time_pattern()
    section_health_score()
    section_hr_use()
    section_config()
    section_troubleshooting()
    section_developer()
    section_appendix_b()

    out_docx = DOCS_DIR / "SOP.docx"
    doc.save(out_docx)
    print(f"Wrote {out_docx}")

    # Convert to PDF via Word COM (docx2pdf). Word must be installed.
    try:
        from docx2pdf import convert
        out_pdf = DOCS_DIR / "SOP.pdf"
        convert(str(out_docx), str(out_pdf))
        print(f"Wrote {out_pdf}")
    except Exception as e:
        print(f"PDF conversion failed: {e}")
        print("Open SOP.docx in Word and use File -> Save as PDF as a fallback.")


if __name__ == "__main__":
    main()
