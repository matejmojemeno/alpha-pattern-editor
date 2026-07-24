"""Confirmation-screen logic (§7.2). Pure core: given the source image and a user-chosen
extent / dimensions / ΔE, re-derive the pattern preview. No UI imports.

The confirmation screen is the reliability gate (§4.8): every import passes through it
before becoming a stored Pattern. Keeping this logic here (not in the widget) means the
same re-derivation is testable headlessly.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

import numpy as np

from .detect.palette import build_palette, compute_confidence
from .detect.sample import sample_cells
from .model import DetectionResult, Pattern, PaletteEntry


@dataclass
class Extent:
    """Grid bounding box in source-image pixel coordinates (inclusive of the outer
    gridlines): the region divided evenly into `rows` x `cols` cells."""
    x0: float
    y0: float
    x1: float
    y1: float

    def clamped(self, w: int, h: int) -> "Extent":
        x0, x1 = sorted((self.x0, self.x1))
        y0, y1 = sorted((self.y0, self.y1))
        return Extent(max(0, x0), max(0, y0), min(w - 1, x1), min(h - 1, y1))


@dataclass
class Preview:
    rows: int
    cols: int
    row_lines: np.ndarray
    col_lines: np.ndarray
    cells: np.ndarray               # (rows, cols) uint16 palette indices
    palette: list[PaletteEntry]
    confidence: np.ndarray          # (rows, cols) float32
    extent: Extent
    delta_e: float

    @property
    def low_confidence_fraction(self) -> float:
        total = self.rows * self.cols
        return float(np.count_nonzero(self.confidence < 0.6)) / total if total else 0.0


@dataclass
class ConfirmState:
    """Mutable state the confirmation screen edits. `dirty` avoids needless resampling."""
    img: np.ndarray
    extent: Extent
    rows: int
    cols: int
    delta_e: float = 6.0
    _cache: Preview | None = field(default=None, repr=False)

    @classmethod
    def from_detection(cls, img: np.ndarray, result: DetectionResult,
                       delta_e: float = 6.0) -> "ConfirmState":
        rl, cl = result.lattice.row_lines, result.lattice.col_lines
        extent = Extent(float(cl[0]), float(rl[0]), float(cl[-1]), float(rl[-1]))
        return cls(img=img, extent=extent, rows=result.rows, cols=result.cols,
                   delta_e=delta_e)

    def set_dims(self, rows: int | None = None, cols: int | None = None) -> None:
        if rows is not None:
            self.rows = max(1, int(rows))
        if cols is not None:
            self.cols = max(1, int(cols))
        self._cache = None

    def set_extent(self, extent: Extent) -> None:
        self.extent = extent
        self._cache = None

    def set_delta_e(self, delta_e: float) -> None:
        self.delta_e = float(delta_e)
        self._cache = None

    def preview(self) -> Preview:
        if self._cache is None:
            self._cache = resample(self.img, self.extent, self.rows, self.cols, self.delta_e)
        return self._cache


def resample(img: np.ndarray, extent: Extent, rows: int, cols: int, delta_e: float) -> Preview:
    """Divide `extent` into rows x cols cells, sample and cluster. This is what the
    spinners (new rows/cols over the same extent) and the ΔE slider both call."""
    h, w = img.shape[:2]
    ext = extent.clamped(w, h)
    row_lines = np.linspace(ext.y0, ext.y1, rows + 1)
    col_lines = np.linspace(ext.x0, ext.x1, cols + 1)
    pitch_y = (ext.y1 - ext.y0) / rows
    pitch_x = (ext.x1 - ext.x0) / cols

    colors, spread = sample_cells(img, col_lines, row_lines, pitch_x, pitch_y)
    cells, palette = build_palette(colors, delta_e, spread=spread)
    conf = compute_confidence(colors, cells, palette, spread, delta_e)
    return Preview(rows=rows, cols=cols, row_lines=row_lines, col_lines=col_lines,
                   cells=cells, palette=palette, confidence=conf, extent=ext, delta_e=delta_e)


def pattern_from_preview(preview: Preview, name: str) -> Pattern:
    """Commit a confirmed preview to a Pattern, assigning stable row_ids (§4.5, §7.3)."""
    now = time.time()
    return Pattern(
        id=uuid.uuid4().hex,
        name=name,
        created_at=now,
        updated_at=now,
        cols=preview.cols,
        rows=preview.rows,
        row_ids=[uuid.uuid4().hex for _ in range(preview.rows)],
        cells=preview.cells.copy(),
        palette=[PaletteEntry(id=e.id, hex=e.hex, name=e.name, dmc=e.dmc, count=e.count)
                 for e in preview.palette],
    )
