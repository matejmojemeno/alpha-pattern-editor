"""Editable, zoomable chart canvas for the Design stage (§6.2).

Emits cell-level mouse events; the window interprets them per the active tool. Draws
black gridlines and optional row/column numbers (image order — 1 at the top)."""
from __future__ import annotations

from PySide6.QtCore import QRect, QSize, Qt, Signal
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QWidget

from ...core.detect.palette import hex_to_rgb
from ...core.model import Pattern

MARGIN = 26


class DesignCanvas(QWidget):
    pressed = Signal(int, int)      # (row, col)
    dragged = Signal(int, int)
    released = Signal(int, int)

    def __init__(self, cell: int = 22):
        super().__init__()
        self.cell = cell
        self._pattern: Pattern | None = None
        self._pal: list[QColor] = []
        self._dragging = False
        self._preview_rect: tuple[int, int, int, int] | None = None
        self.setMouseTracking(False)

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

    # --- paint ---------------------------------------------------------------
    def paintEvent(self, _e):
        if self._pattern is None:
            return
        p = self._pattern
        painter = QPainter(self)
        painter.fillRect(self.rect(), self.palette().base())
        cell = self.cell
        black = QPen(QColor(0, 0, 0), 1)
        for r in range(p.rows):
            for c in range(p.cols):
                x, y = MARGIN + c * cell, MARGIN + r * cell
                idx = int(p.cells[r, c])
                painter.fillRect(x, y, cell, cell,
                                 self._pal[idx] if idx < len(self._pal) else QColor(200, 200, 200))
                painter.setPen(black)
                painter.drawRect(x, y, cell, cell)

        # Axis numbers (every 5 on large charts, every 1 on small).
        step_c = 1 if p.cols <= 20 else 5
        step_r = 1 if p.rows <= 20 else 5
        painter.setPen(QColor(120, 120, 120))
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
            painter.setPen(QPen(QColor(240, 168, 0), 2, Qt.DashLine))
            painter.drawRect(MARGIN + x0 * cell, MARGIN + y0 * cell,
                             (x1 - x0 + 1) * cell, (y1 - y0 + 1) * cell)
        painter.end()
