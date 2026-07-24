"""Shared rendering helpers: numpy <-> Qt, and pattern/overlay drawing.

Kept UI-thin: these produce QPixmaps that widgets paint. No detection logic here.
"""
from __future__ import annotations

import numpy as np
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QImage, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QWidget

from ..core.confirm import Preview
from ..core.detect.palette import hex_to_rgb


def ndarray_to_qimage(rgb: np.ndarray) -> QImage:
    """(H, W, 3) uint8 -> QImage that fully owns its buffer.

    We build from an owned `bytes` copy and then .copy() the QImage, so the result
    never references the numpy array's memory — a dangling reference here is a classic
    intermittent-garble / segfault source."""
    rgb = np.ascontiguousarray(rgb[..., :3], dtype=np.uint8)
    h, w, _ = rgb.shape
    buf = rgb.tobytes()
    return QImage(buf, w, h, 3 * w, QImage.Format_RGB888).copy()


def source_pixmap_with_overlay(img: np.ndarray, preview: Preview,
                               show_grid: bool = True) -> QPixmap:
    """The source image with the fitted lattice and extent box drawn on top (§7.2)."""
    pix = QPixmap.fromImage(ndarray_to_qimage(img))
    if not show_grid:
        return pix
    p = QPainter(pix)
    p.setRenderHint(QPainter.Antialiasing, False)
    ext = preview.extent
    # Gridlines (thin, semi-transparent red).
    p.setPen(QPen(QColor(255, 40, 40, 130), 1))
    for x in preview.col_lines:
        p.drawLine(int(round(x)), int(round(ext.y0)), int(round(x)), int(round(ext.y1)))
    for y in preview.row_lines:
        p.drawLine(int(round(ext.x0)), int(round(y)), int(round(ext.x1)), int(round(y)))
    # Extent box (cyan).
    p.setPen(QPen(QColor(0, 180, 255), 2))
    p.drawRect(int(ext.x0), int(ext.y0),
               int(ext.x1 - ext.x0), int(ext.y1 - ext.y0))
    p.end()
    return pix


def reconstruction_pixmap(preview: Preview, cell: int = 18,
                          flag_low_conf: bool = True) -> QPixmap:
    """Redraw the recovered pattern; optionally hatch low-confidence cells (§7.2)."""
    rows, cols = preview.rows, preview.cols
    pal = [QColor(*(int(v) for v in hex_to_rgb(e.hex))) for e in preview.palette]
    w, h = cols * cell + 1, rows * cell + 1
    pix = QPixmap(w, h)
    pix.fill(QColor(0, 0, 0))
    p = QPainter(pix)
    grid_pen = QPen(QColor(0, 0, 0), 1)      # black lines between pixels
    for r in range(rows):
        for c in range(cols):
            idx = int(preview.cells[r, c])
            p.fillRect(c * cell, r * cell, cell, cell, pal[idx])
            p.setPen(grid_pen)
            p.drawRect(c * cell, r * cell, cell, cell)
            if flag_low_conf and preview.confidence[r, c] < 0.6:
                p.setPen(QPen(QColor(255, 0, 0), 2))
                p.drawLine(c * cell, r * cell, (c + 1) * cell, (r + 1) * cell)
                p.drawLine((c + 1) * cell, r * cell, c * cell, (r + 1) * cell)
    p.end()
    return pix


class PixmapView(QWidget):
    """Paints a pixmap scaled to fit (KeepAspectRatio), centred — so the whole image is
    always visible without scrolling."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._pixmap: QPixmap | None = None
        self.setMinimumSize(240, 200)

    def set_pixmap(self, pixmap: QPixmap):
        self._pixmap = pixmap
        self.update()

    def paintEvent(self, _e):
        p = QPainter(self)
        p.fillRect(self.rect(), self.palette().base())
        if self._pixmap is None or self._pixmap.isNull():
            p.end()
            return
        scaled = self._pixmap.scaled(self.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation)
        x = (self.width() - scaled.width()) // 2
        y = (self.height() - scaled.height()) // 2
        p.drawPixmap(x, y, scaled)
        p.end()
