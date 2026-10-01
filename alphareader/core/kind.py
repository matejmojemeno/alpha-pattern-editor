"""Chart or picture? The import decides by itself (§5a).

A chart's squares are read; a picture is turned into a pattern (convert.py). Detection
alone can't tell them apart, measured on test_images/ and test_images/pictures/:

- **Failing doesn't mean "picture".** Most photos fail with LOW_RESOLUTION, because fine
  texture fits a grid of 3–5 px squares, but so does garment.png, a real chart with 5 px
  squares. Converting that chart as a picture would give a plausible, wrong pattern.
- **Succeeding doesn't mean "chart".** A picture can fit a grid: the dice fit 10×4 with
  78% of cells unsure, a tiled LCD floor fits 93×11 over 15% of the image.

So the decision rests on what a grid *looks like*: square-ish cells that agree across
both axes, lines that span the image, and edge strength concentrated on the lattice
(`line_contrast`: the edge profile on the lattice over the profile half a square off it).
Over each grid's own extent, every chart in the corpus scores 5.8 or more and no picture
more than 1.5. Thresholds are checked image by image in test_kind.py.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .detect import detect_pattern
from .detect import periodic
from .detect.palette import DEFAULT_DELTA_E
from .model import DetectionError, DetectionResult

# A fitted grid is a chart when all three hold ...
_MAX_CELL_RATIO = 1.5       # long side over short side of a square
_MIN_SPAN = 0.6             # the grid covers at least this share of each side
_MIN_CONTRAST = 2.0         # edge strength on the lattice over half a square off it
# ... and it is surely one when few of its cells are unsure, else a chart shown with a
# visible way to read it as a picture instead.
_SURE_UNSURE = 0.15
# Above this share of unsure cells, the colours don't sit in the squares: a picture.
_MAX_UNSURE = 0.6
# A LOW_RESOLUTION or ROTATED failure is kept as a chart's failure only when a fit below
# the minimum square size also looks like a grid (garment.png: ratio 1.14, contrast 1.35,
# agreement 0.83; the pictures that fail so score at most 1.12 contrast at a ratio under
# 1.2, with agreement mostly under 0.3).
_FINE_MAX_RATIO = 1.2
_FINE_MIN_CONTRAST = 1.25
_FINE_MIN_AGREEMENT = 0.7
_CHART_FAILURES = ("LOW_RESOLUTION", "ROTATED")


@dataclass
class Reading:
    """What the import makes of an image.

    kind:    "chart" or "picture".
    sure:    False for a chart read with doubts: shown with a visible way to turn it into
             a pattern instead.
    result:  the detected grid, when there is one: also kept for a picture, so it can
             still be read as a chart.
    error:   detection's refusal, when the image looks like a chart it can't read
             (LOW_RESOLUTION, ROTATED); None otherwise.
    reason:  a short note on why, for tests and bug reports (never shown as advice).
    """
    kind: str
    sure: bool
    result: DetectionResult | None
    error: DetectionError | None
    reason: str


def line_contrast(prof: np.ndarray, x0: float, pitch: float, lo: float = 0.0,
                  hi: float | None = None) -> float:
    """Mean edge strength on the lattice over the mean half a square off it, between
    `lo` and `hi` (default: the whole profile)."""
    prof = periodic._smooth(prof)
    n = prof.size
    hi = n - 1 if hi is None else min(hi, n - 1)
    k0 = int(np.ceil((max(lo, 0.0) - x0) / pitch))
    k1 = int(np.floor((hi - x0) / pitch))
    if k1 - k0 < 1:
        return 0.0
    on = x0 + np.arange(k0, k1 + 1) * pitch
    off = (on + pitch / 2)[:-1]
    return float(periodic._sample(prof, on).mean() / (periodic._sample(prof, off).mean() + 1e-9))


def _grid_signals(img: np.ndarray, result: DetectionResult) -> tuple[float, float, float, float]:
    """(cell ratio, span, unsure share, contrast) of a detected grid."""
    lat = result.lattice
    H, W = img.shape[:2]
    ratio = max(lat.pitch_x, lat.pitch_y) / max(min(lat.pitch_x, lat.pitch_y), 1e-9)
    span = min((lat.row_lines[-1] - lat.row_lines[0]) / H, (lat.col_lines[-1] - lat.col_lines[0]) / W)
    unsure = float(np.mean(result.confidence < 0.6))
    dh, dv = periodic.edge_maps(img)
    c0, c1 = int(lat.col_lines[0]), int(np.ceil(lat.col_lines[-1]))
    r0, r1 = int(lat.row_lines[0]), int(np.ceil(lat.row_lines[-1]))
    prof_r, prof_c = periodic.profiles_from_maps(dh, dv, row_span=(r0, r1), col_span=(c0, c1))
    contrast = min(line_contrast(prof_r, lat.y0, lat.pitch_y, lat.row_lines[0], lat.row_lines[-1]),
                   line_contrast(prof_c, lat.x0, lat.pitch_x, lat.col_lines[0], lat.col_lines[-1]))
    return float(ratio), float(span), unsure, contrast


def looks_like_fine_grid(img: np.ndarray) -> bool:
    """Whether an image refused as too fine (or rotated) still has a grid's structure:
    a fit below the minimum square size with square cells, lines on the lattice, and
    most lattice positions on a detected line."""
    dh, dv = periodic.edge_maps(img)
    pr, pc = periodic.profiles_from_maps(dh, dv)
    try:
        fr = periodic.fit_periodic_axis(pr, img.shape[0], min_pitch=periodic._SEARCH_FLOOR)
        fc = periodic.fit_periodic_axis(pc, img.shape[1], min_pitch=periodic._SEARCH_FLOOR)
    except DetectionError:
        return False
    ratio = max(fr.pitch, fc.pitch) / min(fr.pitch, fc.pitch)
    contrast = min(line_contrast(pr, fr.x0, fr.pitch), line_contrast(pc, fc.x0, fc.pitch))
    agreement = min(periodic._peak_agreement(fr.peaks, fr.x0, fr.pitch, pr.size),
                    periodic._peak_agreement(fc.peaks, fc.x0, fc.pitch, pc.size))
    return (ratio <= _FINE_MAX_RATIO and contrast >= _FINE_MIN_CONTRAST
            and agreement >= _FINE_MIN_AGREEMENT)


def read_image(img: np.ndarray, *, delta_e_threshold: float = DEFAULT_DELTA_E,
               crop: tuple[int, int, int, int] | None = None) -> Reading:
    """Detect, then decide whether `img` (or `crop` of it) is a chart or a picture."""
    try:
        result = detect_pattern(img, delta_e_threshold=delta_e_threshold, crop=crop)
    except DetectionError as err:
        region = img if crop is None else img[crop[1]:crop[3], crop[0]:crop[2]]
        if err.code in _CHART_FAILURES and looks_like_fine_grid(region):
            return Reading("chart", True, None, err, f"{err.code}, and a grid's structure")
        return Reading("picture", True, None, None, f"{err.code}")

    region = img if crop is None else img[crop[1]:crop[3], crop[0]:crop[2]]
    ratio, span, unsure, contrast = _grid_signals(region, result)
    signals = f"ratio {ratio:.2f}, span {span:.2f}, unsure {unsure:.2f}, contrast {contrast:.2f}"
    if (ratio > _MAX_CELL_RATIO or span < _MIN_SPAN or contrast < _MIN_CONTRAST
            or unsure > _MAX_UNSURE):
        return Reading("picture", True, result, None, f"not a grid: {signals}")
    return Reading("chart", unsure <= _SURE_UNSURE, result, None, signals)
