"""The app's visual language in one place: colour tokens, palette-derived helpers and
font sizing.

Two rules keep the UI correct on light *and* dark desktops:

1. Anything painted by hand (gridlines, axis numbers, the completed-row wash) must be
   derived from the widget's palette, never hardcoded — a black gridline or a white wash
   is invisible or actively misleading on a dark background.
2. Font sizes are expressed in design-time pixels here but emitted as *points* scaled
   against the app font, so the app follows the OS text-size setting. We still set sizes
   through stylesheets rather than QFont(): constructing a QFont() with an empty family
   substitutes a fallback that spaces digits out oddly on macOS ("791/4096" ->
   "7 9 1 / 4 0 9 6"). Only the size is ours; the family stays inherited.
"""
from __future__ import annotations

from PySide6.QtGui import QColor
from PySide6.QtWidgets import QApplication, QWidget

# --- fixed tokens ----------------------------------------------------------------
# The accent is the app's one "you are here" colour: current row, current chip, card
# hover, rubber bands.
ACCENT = "#f0a800"
ACCENT_COLOR = QColor(240, 168, 0)
WARN = "#b26a00"
DANGER = "#d33"

RADIUS_SM = 4
RADIUS_MD = 8
RADIUS_LG = 10

CARD_W = 240
CARD_H = 240
CARD_PAD = 10
CARD_THUMB_W = 218
CARD_THUMB_H = 150
CHIP_PAD = (12, 8, 14, 8)

# Detection overlays (importer). Semantic, not incidental: red = the fitted lattice,
# cyan = the detected extent, red X = a cell the detector isn't sure about.
OVERLAY_GRID = QColor(255, 40, 40, 130)
OVERLAY_EXTENT = QColor(0, 180, 255)
OVERLAY_LOW_CONF = QColor(255, 0, 0)
LETTERBOX = QColor(30, 30, 30)

# High-contrast (Work stage View menu).
HC_BG = "#111111"
HC_FG = "#eeeeee"
HC_BUTTON = "#2a2a2a"
HC_BORDER = "#555555"
HC_DEFAULT = "#0a7d33"


# --- palette-derived -------------------------------------------------------------
def _luma(c: QColor) -> float:
    return 0.2126 * c.red() + 0.7152 * c.green() + 0.0722 * c.blue()


def _mix(a: QColor, b: QColor, t: float) -> QColor:
    """Blend `a` toward `b` by `t` (0 = all a, 1 = all b)."""
    return QColor(int(a.red() + (b.red() - a.red()) * t),
                  int(a.green() + (b.green() - a.green()) * t),
                  int(a.blue() + (b.blue() - a.blue()) * t))


def is_dark(w: QWidget) -> bool:
    """True when the widget draws onto a dark background."""
    return _luma(w.palette().base().color()) < 128


def grid_color(w: QWidget) -> QColor:
    """Gridlines between chart cells.

    Deliberately *not* palette-derived: these lines are drawn on top of the pattern's own
    colours, which don't change with the desktop theme, so they must read against yarn —
    not against the page. Keeping them near-black keeps them crisp for counting."""
    return QColor(0, 0, 0)


def done_wash(w: QWidget) -> QColor:
    """Semi-transparent overlay marking a completed row.

    Neutral grey rather than white or black: it composites over pattern colours, so the
    job is to pull the row toward flat and low-contrast whatever the yarn is. A white wash
    is only 'faded' over pale patterns, and a black one only over dark ones."""
    return QColor(128, 128, 128, 150)


def done_strike(w: QWidget) -> QColor:
    """The line struck through a completed row — also drawn over pattern colours."""
    return QColor(60, 60, 60)


def axis_color(w: QWidget) -> QColor:
    """Row/column numbers in the margins: readable but subordinate to the chart."""
    return _mix(w.palette().text().color(), w.palette().base().color(), 0.42)


def muted_hex(w: QWidget) -> str:
    """Secondary text (meta lines, hints, faded chips)."""
    return _mix(w.palette().text().color(), w.palette().base().color(), 0.45).name()


def border_hex(w: QWidget) -> str:
    """Hairline borders on cards and chips: visible on both themes, never assertive."""
    return _mix(w.palette().text().color(), w.palette().base().color(), 0.68).name()


def muted_css(w: QWidget) -> str:
    return f"color:{muted_hex(w)};"


def base_hex(w: QWidget) -> str:
    """The surface colour, as a literal.

    Prefer this over the QSS `palette(base)` function for anything inside a scroll area:
    the viewport carries its own palette, so `palette(base)` there can resolve against the
    wrong one and ignore a palette we set on the window."""
    return w.palette().base().color().name()


def raised_hex(w: QWidget) -> str:
    """A surface a step away from the background — used for a chip that's already done."""
    pal = w.palette()
    return _mix(pal.base().color(), pal.text().color(), 0.10).name()


# --- fonts -----------------------------------------------------------------------
_BASE_PT = 13.0        # the macOS system size the px numbers below were designed against


def font_css(px: float, weight: int | None = None) -> str:
    """A design-time pixel size, emitted as a point size that scales with the OS font.

    At the default system size this reproduces the original pixel sizes; when the user
    raises their text size, the whole app grows with it."""
    app = QApplication.instance()
    app_pt = QApplication.font().pointSizeF() if app is not None else _BASE_PT
    if app_pt <= 0:
        app_pt = _BASE_PT
    pt = px * 0.75 * (app_pt / _BASE_PT)
    css = f"font-size:{pt:.1f}pt;"
    if weight is not None:
        css += f" font-weight:{weight};"
    return css
