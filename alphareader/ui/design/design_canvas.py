"""Editable, zoomable chart canvas for the Design stage (§6.2).

Emits cell-level mouse events; the window interprets them per the active tool. Draws
black gridlines and optional row/column numbers (image order — 1 at the top)."""
from __future__ import annotations

from PySide6.QtCore import QEvent, QRect, QSize, Qt, Signal
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QWidget

from ...core.detect.palette import hex_to_rgb
from ...core.model import Pattern
from .. import theme

MARGIN = 26

# Cursor per tool: a crosshair where you're placing cells precisely, a hand where you're
# picking something that already exists.
_CURSORS = {"paint": Qt.CrossCursor, "rect": Qt.CrossCursor,
            "row": Qt.CrossCursor, "col": Qt.CrossCursor,
            "fill": Qt.PointingHandCursor, "eyedropper": Qt.PointingHandCursor}


class DesignCanvas(QWidget):
    pressed = Signal(int, int)      # (row, col)
    dragged = Signal(int, int)
    released = Signal(int, int)
    cancelled = Signal()            # Escape during a drag
    zoomed = Signal(int)            # wheel zoom: the new cell size

    def __init__(self, cell: int = 22):
        super().__init__()
        self.cell = cell
        self._pattern: Pattern | None = None
        self._pal: list[QColor] = []
        self._dragging = False
        self._preview_rect: tuple[int, int, int, int] | None = None
        self.setMouseTracking(False)
        self.setFocusPolicy(Qt.StrongFocus)     # so Escape reaches keyPressEvent
        self.set_tool_cursor("paint")

    def set_tool_cursor(self, tool: str):
        self.setCursor(_CURSORS.get(tool, Qt.ArrowCursor))

    def set_pattern(self, pattern: Pattern):
        self._pattern = pattern
        self._pal = [QColor(*(int(v) for v in hex_to_rgb(e.hex))) for e in pattern.palette]
        self.setFixedSize(self.sizeHint())
        self.update()

    def set_cell_size(self, px: int):
        self.cell = max(4, min(60, px))
        if self._pattern is not None:
            self.setFixedSize(self.sizeHint())
        self.update()

    def set_preview_rect(self, rect):
        self._preview_rect = rect
        self.update()

    def sizeHint(self) -> QSize:
        if self._pattern is None:
            return QSize(200, 200)
        return QSize(MARGIN + self._pattern.cols * self.cell + 1,
                     MARGIN + self._pattern.rows * self.cell + 1)

    def _cell_at(self, pos) -> tuple[int, int] | None:
        if self._pattern is None:
            return None
        c = (pos.x() - MARGIN) // self.cell
        r = (pos.y() - MARGIN) // self.cell
        if 0 <= r < self._pattern.rows and 0 <= c < self._pattern.cols:
            return int(r), int(c)
        return None

    # --- mouse ---------------------------------------------------------------
    def mousePressEvent(self, e):
        rc = self._cell_at(e.position().toPoint())
        if rc is not None and e.button() == Qt.LeftButton:
            self._dragging = True
            self.pressed.emit(*rc)

    def mouseMoveEvent(self, e):
        if self._dragging:
            rc = self._cell_at(e.position().toPoint())
            if rc is not None:
                self.dragged.emit(*rc)

    def mouseReleaseEvent(self, e):
        if self._dragging and e.button() == Qt.LeftButton:
            self._dragging = False
            rc = self._cell_at(e.position().toPoint())
            if rc is not None:
                self.released.emit(*rc)

    def wheelEvent(self, e):
        """Ctrl/⌘ + wheel zooms; a bare wheel scrolls the surrounding scroll area."""
        if e.modifiers() & (Qt.ControlModifier | Qt.MetaModifier):
            step = 1 if e.angleDelta().y() > 0 else -1
            self.set_cell_size(self.cell + step * 2)
            self.zoomed.emit(self.cell)
            e.accept()
        else:
            e.ignore()

    def keyPressEvent(self, e):
        """Escape abandons an in-progress drag (a rectangle you don't want to commit)."""
        if e.key() == Qt.Key_Escape:
            self._dragging = False
            self.set_preview_rect(None)
            self.cancelled.emit()
        else:
            super().keyPressEvent(e)

    # --- paint ---------------------------------------------------------------
    def paintEvent(self, _e):
        if self._pattern is None:
            return
        p = self._pattern
        painter = QPainter(self)
        painter.fillRect(self.rect(), self.palette().base())
        cell = self.cell
        grid = QPen(theme.grid_color(self), 1)
        for r in range(p.rows):
            for c in range(p.cols):
                x, y = MARGIN + c * cell, MARGIN + r * cell
                idx = int(p.cells[r, c])
                painter.fillRect(x, y, cell, cell,
                                 self._pal[idx] if idx < len(self._pal) else QColor(200, 200, 200))
                painter.setPen(grid)
                painter.drawRect(x, y, cell, cell)

        # Axis numbers (every 5 on large charts, every 1 on small).
        step_c = 1 if p.cols <= 20 else 5
        step_r = 1 if p.rows <= 20 else 5
        painter.setPen(theme.axis_color(self))
        for c in range(p.cols):
            if (c + 1) % step_c == 0 or c == 0:
                cx = MARGIN + c * cell + cell / 2
                painter.drawText(QRect(int(cx - cell), 0, int(cell * 2), MARGIN - 2),
                                 Qt.AlignHCenter | Qt.AlignBottom, str(c + 1))
        for r in range(p.rows):
            if (r + 1) % step_r == 0 or r == 0:
                cy = MARGIN + r * cell
                painter.drawText(QRect(0, int(cy), MARGIN - 4, int(cell)),
                                 Qt.AlignRight | Qt.AlignVCenter, str(r + 1))

        if self._preview_rect is not None:
            r0, c0, r1, c1 = self._preview_rect
            y0, y1 = sorted((r0, r1)); x0, x1 = sorted((c0, c1))
            painter.setPen(QPen(theme.ACCENT_COLOR, 2, Qt.DashLine))
            painter.drawRect(MARGIN + x0 * cell, MARGIN + y0 * cell,
                             (x1 - x0 + 1) * cell, (y1 - y0 + 1) * cell)
        painter.end()

    def changeEvent(self, e):
        # Gridlines and axis numbers come from the palette, so a theme switch needs a
        # repaint or they keep the old theme's colours.
        if e.type() == QEvent.PaletteChange:
            self.update()
        super().changeEvent(e)
