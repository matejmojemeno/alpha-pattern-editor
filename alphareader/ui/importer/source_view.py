"""Source-image view with an optional rubber-band crop selection (§7.2 escape hatch)."""
from __future__ import annotations

from PySide6.QtCore import QPoint, QRect, Qt, Signal
from PySide6.QtGui import QColor, QMouseEvent, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QWidget

from .. import theme


class SourceView(QWidget):
    """Displays a pixmap scaled to fit (letterboxed), preserving aspect ratio. In crop
    mode a drag draws a rectangle and emits cropRequested with image-pixel coordinates."""

    cropRequested = Signal(int, int, int, int)   # x0, y0, x1, y1 in image pixels

    def __init__(self, parent=None):
        super().__init__(parent)
        self._pixmap: QPixmap | None = None
        self._crop_mode = False
        self._drag_start: QPoint | None = None
        self._drag_now: QPoint | None = None
        self.setMinimumSize(320, 240)

    def set_pixmap(self, pixmap: QPixmap) -> None:
        self._pixmap = pixmap
        self.update()

    def set_crop_mode(self, on: bool) -> None:
        self._crop_mode = on
        self.setCursor(Qt.CrossCursor if on else Qt.ArrowCursor)
        self._drag_start = self._drag_now = None
        self.update()

    # --- geometry mapping ----------------------------------------------------
    def _draw_rect(self) -> QRect:
        """Where the pixmap is drawn inside the widget (letterboxed)."""
        if self._pixmap is None:
            return QRect()
        pw, ph = self._pixmap.width(), self._pixmap.height()
        ww, wh = self.width(), self.height()
        scale = min(ww / pw, wh / ph)
        dw, dh = int(pw * scale), int(ph * scale)
        return QRect((ww - dw) // 2, (wh - dh) // 2, dw, dh)

    def _widget_to_image(self, pt: QPoint) -> tuple[int, int]:
        dr = self._draw_rect()
        if dr.width() == 0 or self._pixmap is None:
            return 0, 0
        fx = (pt.x() - dr.x()) / dr.width()
        fy = (pt.y() - dr.y()) / dr.height()
        fx = min(max(fx, 0.0), 1.0)
        fy = min(max(fy, 0.0), 1.0)
        return int(fx * self._pixmap.width()), int(fy * self._pixmap.height())

    # --- painting ------------------------------------------------------------
    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.fillRect(self.rect(), theme.LETTERBOX)
        if self._pixmap is not None:
            p.drawPixmap(self._draw_rect(), self._pixmap)
        if self._crop_mode and self._drag_start and self._drag_now:
            p.setPen(QPen(theme.ACCENT_COLOR, 2, Qt.DashLine))
            p.drawRect(QRect(self._drag_start, self._drag_now).normalized())
        p.end()

    # --- crop interaction ----------------------------------------------------
    def mousePressEvent(self, e: QMouseEvent) -> None:
        if self._crop_mode and e.button() == Qt.LeftButton:
            self._drag_start = e.position().toPoint()
            self._drag_now = self._drag_start

    def mouseMoveEvent(self, e: QMouseEvent) -> None:
        if self._crop_mode and self._drag_start is not None:
            self._drag_now = e.position().toPoint()
            self.update()

    def mouseReleaseEvent(self, e: QMouseEvent) -> None:
        if not (self._crop_mode and self._drag_start and self._drag_now):
            return
        rect = QRect(self._drag_start, self._drag_now).normalized()
        self._drag_start = self._drag_now = None
        self.update()
        if rect.width() < 8 or rect.height() < 8:
            return
        x0, y0 = self._widget_to_image(rect.topLeft())
        x1, y1 = self._widget_to_image(rect.bottomRight())
        if x1 - x0 >= 8 and y1 - y0 >= 8:
            self.cropRequested.emit(x0, y0, x1, y1)
