"""Read-only chart view for the Work stage (§6.3).

Scales the whole chart to fit (no scrolling), draws black gridlines and axis numbers to
aid counting, dims/strikes completed rows and outlines the current one. Read-only by
construction — there is no cell-editing path here (§6.1)."""
from __future__ import annotations

from PySide6.QtCore import QRect, Qt
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QWidget

from ...core.detect.palette import hex_to_rgb
from ...core.model import Pattern
from ...core.readout import working_number


class WorkChartView(QWidget):
    def __init__(self):
        super().__init__()
        self._pattern: Pattern | None = None
        self._completed: set[int] = set()
        self._current: int | None = None
        self._focus: tuple[int, int] | None = None
        self._pal: list[QColor] = []
        self.setMinimumHeight(220)

    def set_state(self, pattern, completed_indices, current_index):
        self._pattern = pattern
        self._completed = completed_indices
        self._current = current_index
        self._pal = [QColor(*(int(v) for v in hex_to_rgb(e.hex))) for e in pattern.palette]
        self.update()

    def set_focus(self, focus):
        self._focus = focus
        self.update()

    def _visible_rows(self) -> range:
        if self._pattern is None:
            return range(0)
        if self._focus is not None and self._current is not None:
            c, rad = self._focus
            return range(max(0, c - rad), min(self._pattern.rows, c + rad + 1))
        return range(self._pattern.rows)

    def paintEvent(self, _e):
        if self._pattern is None:
            return
        p = self._pattern
        vis = self._visible_rows()
        nrows = len(vis)
        if nrows == 0:
            return
        painter = QPainter(self)
        painter.fillRect(self.rect(), self.palette().base())

        # Reserve margins for axis numbers, then fit the grid into what's left.
        left, top, pad = 34, 22, 6
        avail_w = self.width() - left - pad
        avail_h = self.height() - top - pad
        cell = max(3, min(avail_w / p.cols, avail_h / nrows))
        gw, gh = cell * p.cols, cell * nrows
        ox, oy = left, top

        # Label every 5th line (plus the first) on larger charts; every line on small
        # ones — keeps two-digit numbers from overlapping.
        show_every_c = 1 if p.cols <= 15 else 5
        show_every_r = 1 if p.rows <= 15 else 5
        fs = int(max(8, min(13, cell * 0.5)))
        font = self.font()            # keep the real inherited family (empty family spaces digits oddly)
        font.setPixelSize(fs)
        painter.setFont(font)

        black = QPen(QColor(0, 0, 0), 1)
        for draw_i, r in enumerate(vis):
            y = oy + draw_i * cell
            done = r in self._completed
            for c in range(p.cols):
                x = ox + c * cell
                idx = int(p.cells[r, c])
                color = self._pal[idx] if idx < len(self._pal) else QColor(200, 200, 200)
                rect = QRect(int(x), int(y), int(cell) + 1, int(cell) + 1)
                painter.fillRect(rect, color)
                painter.setPen(black)
                painter.drawRect(int(x), int(y), int(cell), int(cell))
            if done:
                painter.fillRect(int(ox), int(y), int(gw), int(cell), QColor(255, 255, 255, 140))
                painter.setPen(QPen(QColor(70, 70, 70), 2))
                painter.drawLine(int(ox), int(y + cell / 2), int(ox + gw), int(y + cell / 2))
            # Row number (working order) on the left.
            num = working_number(p, r)
            if num % show_every_r == 0 or num == 1 or r == self._current:
                painter.setPen(QColor(90, 90, 90))
                painter.drawText(QRect(0, int(y), left - 4, int(cell)),
                                 Qt.AlignRight | Qt.AlignVCenter, str(num))
            if r == self._current:
                painter.setPen(QPen(QColor(240, 168, 0), 3))
                painter.drawRect(int(ox) + 1, int(y) + 1, int(gw) - 2, int(cell) - 2)

        # Column numbers along the top, centred over each labelled column with a rect
        # wide enough that two digits never clip (labels are >=5 cells apart).
        painter.setPen(QColor(90, 90, 90))
        for c in range(p.cols):
            if (c + 1) % show_every_c == 0 or c == 0:
                cx = ox + c * cell + cell / 2
                painter.drawText(QRect(int(cx - cell), 0, int(cell * 2), top - 2),
                                 Qt.AlignHCenter | Qt.AlignBottom, str(c + 1))
        painter.end()
