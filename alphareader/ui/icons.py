"""Tool icons, drawn in code.

No image assets: the icons are painted from the widget's palette so they stay legible on
a light or dark desktop, and there's nothing to ship or keep in sync. They share one
grid-of-cells metaphor because that's what every tool here operates on — which cells a
gesture affects is the only thing that distinguishes Paint from Fill row from Rectangle.
"""
from __future__ import annotations

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPen, QPixmap

from . import theme

SIZE = 20           # logical px; drawn at 3x for retina
_SIZE = SIZE       # kept as the internal alias used below
_SCALE = 3
_CELL = 6          # per grid cell — smaller than this and filled vs empty stops reading

# Which of the 3x3 cells each tool fills. The shape *is* the explanation.
_CELLS = {
    "paint": {(1, 1)},                                       # one cell at a time
    "fill": {(0, 1), (1, 0), (1, 1), (1, 2), (2, 1)},        # a spreading region
    "rect": {(0, 0), (0, 1), (1, 0), (1, 1)},                # a rectangular block
    "row": {(1, 0), (1, 1), (1, 2)},                         # a whole row
    "col": {(0, 1), (1, 1), (2, 1)},                         # a whole column
}


def tool_icon(name: str, widget) -> QIcon:
    """An icon for one Design tool, tinted for `widget`'s current palette."""
    ink = widget.palette().text().color()
    pm = QPixmap(_SIZE * _SCALE, _SIZE * _SCALE)
    # setDevicePixelRatio already makes the painter's logical space _SIZE x _SIZE and
    # renders it at _SCALE for retina — scaling the painter on top of that would draw
    # three times too large and clip everything but the top-left corner.
    pm.setDevicePixelRatio(_SCALE)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    if name == "eyedropper":
        p.setRenderHint(QPainter.Antialiasing, True)
        _draw_dropper(p, ink)
    else:
        _draw_grid(p, ink, _CELLS.get(name, set()))
    p.end()
    return QIcon(pm)


def _draw_grid(p: QPainter, ink: QColor, filled: set) -> None:
    """A 3x3 chart fragment with `filled` cells inked in the accent colour.

    Drawn on integer coordinates with antialiasing *off*: these are axis-aligned squares,
    and smoothing their edges only softens the filled/empty contrast that carries the
    entire meaning of the icon."""
    p.setRenderHint(QPainter.Antialiasing, False)
    pad, cell = 1, _CELL
    outline = QColor(ink)
    outline.setAlpha(170)
    for r in range(3):
        for c in range(3):
            x, y = pad + c * cell, pad + r * cell
            if (r, c) in filled:
                p.fillRect(x, y, cell, cell, theme.ACCENT_COLOR)
            p.setPen(QPen(outline, 1))
            p.drawRect(x, y, cell, cell)


def _draw_dropper(p: QPainter, ink: QColor) -> None:
    """A pipette: the one tool that reads a colour rather than writing cells."""
    p.setPen(QPen(ink, 1.8, Qt.SolidLine, Qt.RoundCap))
    p.drawLine(6, 15, 12, 9)                       # the barrel
    p.setPen(QPen(ink, 3.2, Qt.SolidLine, Qt.RoundCap))
    p.drawLine(12, 9, 16, 5)                       # the bulb end
    p.setPen(Qt.NoPen)
    p.setBrush(theme.ACCENT_COLOR)
    p.drawEllipse(QRectF(2.0, 12.0, 5.5, 5.5))     # the drop it picked up
