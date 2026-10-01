"""Pixel images: pixel art without gridlines, read exactly (§5a).

A chart has gridlines between its squares; pixel art has none, only blocks of one colour.
Detection's lattice fitter finds the block size of enlarged pixel art, but it samples each
square's inside and walks the grid's extent by its lines, so plain borders are dropped
(an 8× cat, 60 × 60, came out 51 × 58) and blocks under 6 px are refused. A lossless image
made of uniform square blocks needs no fitting at all: every block is a stitch, and its
colour is exact.

`read_pixels` accepts an image only when:

- it is exactly a nearest-neighbour enlargement of a smaller image, by the same scale
  across and down: whole (k × k blocks; k = 1 is one pixel per stitch) or not (an image
  resized from 32 to 300 pixels has blocks of 9 and 10);
- it has at least 2 and at most MAX_COLOURS colours: more than that is a photo, or a
  drawing smoothed at its edges;
- it is at most MAX_STITCHES blocks each way.

Whether such an image is read as pixels or as a chart is kind.py's decision.
"""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np

from .confirm import Extent, Preview
from .detect.palette import DEFAULT_DELTA_E, palette_entries

MAX_COLOURS = 64
MAX_STITCHES = 400
_MIN_SCALE = 2.0            # an enlargement by less is read as one pixel per stitch


@dataclass
class PixelArt:
    block: float               # image pixels per stitch, across (whole or not: see below)
    cells: np.ndarray          # (rows, cols) uint16, indices into `colours`
    colours: np.ndarray        # (n, 3) uint8, in palette order (most used first)
    counts: np.ndarray         # (n,) stitches of each colour
    width: int                 # the image's size, in pixels
    height: int

    @property
    def rows(self) -> int:
        return int(self.cells.shape[0])

    @property
    def cols(self) -> int:
        return int(self.cells.shape[1])


def _axis(lines: np.ndarray) -> tuple[int, np.ndarray] | None:
    """How many source pixels the columns of `lines` (an (H, W) array of packed colours)
    enlarge, and the first column of each: the fewest n such that every column equals
    the first of its block, the blocks falling where an enlargement from n to W puts them.

    An enlargement's boundaries sit at i·W/n, each rounded one way or the other: tools
    differ (Pillow rounds a half down, others up, others from pixel edges rather than
    centres), so a colour change is accepted within a pixel of one. A boundary between
    two equal source columns shows no change, and is placed at i·W/n rounded. Whole
    numbers throughout, so the desktop and Pyodide agree. By a whole k, n = W / k; by
    9.375 (32 to 300 pixels), blocks alternate 9 and 10 pixels wide."""
    length = lines.shape[1]
    at = np.flatnonzero((lines[:, 1:] != lines[:, :-1]).any(axis=0)) + 1   # p differs from p - 1
    x = np.arange(length, dtype=np.int64)
    for n in range(at.size + 1, length + 1):
        # Under 2× it isn't an enlargement but one pixel per stitch: otherwise two equal
        # neighbouring rows of a 64-pixel sprite read as one row stretched by 64/63, and a
        # crisp chart drawn with 2 px lines as an enlargement by 1.5.
        if length / n < _MIN_SCALE:
            return length, x
        # The boundary nearest each change, and whether it is within a pixel: |p - iW/n| < 1.
        i = (2 * at * n + length) // (2 * length)
        if at.size and (np.any(i < 1) or np.any(i > n - 1) or np.any(np.abs(at * n - i * length) >= n)
                        or np.unique(i).size != i.size):
            continue
        bounds = (2 * np.arange(1, n, dtype=np.int64) * length + n) // (2 * n)
        bounds[i - 1] = at
        if np.any(np.diff(bounds) <= 0):
            continue
        src = np.searchsorted(bounds, x, side="right")
        first = np.r_[0, bounds]
        if np.array_equal(lines[:, first][:, src], lines):
            return n, first
    return None


def read_pixels(img: np.ndarray) -> PixelArt | None:
    """The image as uniform blocks, one per stitch, or None if it isn't one (see the
    module). Blocks are k × k for a whole k, or a nearest-neighbour enlargement by a
    fraction (blocks of two sizes, alternating), with the same scale across and down."""
    if img.ndim != 3 or img.shape[2] < 3:
        return None
    rgb = np.ascontiguousarray(img[..., :3])
    h, w = rgb.shape[:2]
    if h < 2 or w < 2:
        return None
    # Pack each pixel into one integer, so comparing and counting colours is exact.
    packed = (rgb[..., 0].astype(np.uint32) << 16) | (rgb[..., 1].astype(np.uint32) << 8) | rgb[..., 2]
    if (int((packed[:, 1:] != packed[:, :-1]).any(axis=0).sum()) + 1 > MAX_STITCHES
            or int((packed[1:, :] != packed[:-1, :]).any(axis=1).sum()) + 1 > MAX_STITCHES):
        return None                                 # too many stitches however read
    across = _axis(packed)
    down = _axis(packed.T)
    if across is None or down is None:
        return None
    (cols, first_x), (rows, first_y) = across, down
    if max(w / cols, h / rows) > 1.1 * min(w / cols, h / rows):
        return None                                 # not square: not pixel art
    blocks = packed[np.ix_(first_y, first_x)]
    block = w / cols
    uniq, inverse, counts = np.unique(blocks.ravel(), return_inverse=True, return_counts=True)
    if not 2 <= uniq.size <= MAX_COLOURS:
        return None
    colours = np.stack([(uniq >> 16) & 255, (uniq >> 8) & 255, uniq & 255], axis=1).astype(np.uint8)
    # Palette order as a chart's: most used first, ties by colour.
    order = np.lexsort((colours[:, 2], colours[:, 1], colours[:, 0], -counts))
    remap = np.empty(uniq.size, dtype=np.uint16)
    remap[order] = np.arange(uniq.size, dtype=np.uint16)
    cells = remap[inverse.reshape(-1)].reshape(rows, cols)
    return PixelArt(block=float(block), cells=cells, colours=colours[order], counts=counts[order],
                    width=w, height=h)


def pixel_preview(art: PixelArt, origin: tuple[float, float] = (0.0, 0.0)) -> Preview:
    """The pixel image as a preview: its whole extent (edges, moved to `origin` when it was
    read in a crop), a stitch per block."""
    x0, y0 = float(origin[0]), float(origin[1])
    x1, y1 = x0 + art.width, y0 + art.height
    return Preview(rows=art.rows, cols=art.cols,
                   row_lines=np.linspace(y0, y1, art.rows + 1),
                   col_lines=np.linspace(x0, x1, art.cols + 1),
                   cells=art.cells.copy(),
                   palette=palette_entries(art.colours.astype(np.float64), art.counts),
                   confidence=np.ones((art.rows, art.cols), dtype=np.float32),
                   extent=Extent(x0, y0, x1, y1), delta_e=DEFAULT_DELTA_E)
