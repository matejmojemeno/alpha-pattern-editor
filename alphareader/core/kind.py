"""Chart, picture or pixel art? (§5a)

The person says what they have: "Import a chart" reads it (`read_chart`), "Photo to
pattern" turns it into a pattern (convert.py) and reads nothing. `read_chart` still asks
`read_image` what the image looks like, but only to tell pixel art from a chart: a grid
detection found is always read as a chart there, however unlike one it looks, because a
chart called a picture is a dead end and a picture read as a chart is plain to see on
the import screen. The verdict between chart and picture rests on what follows.

Detection alone can't tell them apart, measured on test_images/ and test_images/pictures/:

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
from .detect.lattice import line_coverage
from .detect.palette import DEFAULT_DELTA_E
from .model import DetectionError, DetectionResult
from .pixels import PixelArt, read_pixels

# A fitted grid is a chart when all three hold ...
_MAX_CELL_RATIO = 1.5       # long side over short side of a square
_MIN_SPAN = 0.6             # the grid covers at least this share of each side
_MIN_CONTRAST = 2.0         # edge strength on the lattice over half a square off it
_MIN_COVERAGE = 0.5         # ... and its gridlines have an edge along half their length or
#                             more (real charts 0.95+, 40 synthetic ones down to 4 × 7 cells
#                             0.76+; a drawing of two circles fitted a 5 × 3 grid at 0.17)
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

    kind:    "chart", "picture" or "pixels" (pixel art without gridlines, read exactly).
    sure:    False for a chart read with doubts: shown with a visible way to turn it into
             a pattern instead.
    result:  the detected grid, when there is one: also kept for a picture, so it can
             still be read as a chart.
    error:   detection's refusal, when the image looks like a chart it can't read
             (LOW_RESOLUTION, ROTATED), or for a picture, when detection found no grid
             (`read_chart` reports it); None otherwise.
    reason:  a short note on why, for tests and bug reports (never shown as advice).
    pixels:  the image as uniform blocks (pixels.py), when it is read as pixels: kept
             after turning it into a pattern, to go back.
    """
    kind: str
    sure: bool
    result: DetectionResult | None
    error: DetectionError | None
    reason: str
    pixels: PixelArt | None = None


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


def _grid_signals(img: np.ndarray, result: DetectionResult) -> tuple[float, float, float, float, float]:
    """(cell ratio, span, unsure share, contrast, coverage) of a detected grid. Coverage is
    how much of its gridlines' length has an edge on it (the median over its lines): a
    chart's gridlines run the width of the grid, the lattice fitted to a drawing crosses
    its lines at a point or two."""
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
    eh, ev = periodic.evidence_from_maps(dh, dv, img.shape[:2])
    coverage = min(float(np.median([line_coverage(eh, 0, y, lat.pitch_y, c0, c1) for y in lat.row_lines])),
                   float(np.median([line_coverage(ev, 1, x, lat.pitch_x, r0, r1) for x in lat.col_lines])))
    return float(ratio), float(span), unsure, contrast, coverage


def looks_like_fine_grid(img: np.ndarray) -> bool:
    """Whether an image refused as too fine (or rotated) still has a grid's structure:
    a fit below the minimum square size with square cells, lines on the lattice, and
    most lattice positions on a detected line."""
    return fine_grid_pitch(img) is not None


def fine_grid_pitch(img: np.ndarray) -> float | None:
    """The square size of the grid `looks_like_fine_grid` sees, or None if it sees none."""
    dh, dv = periodic.edge_maps(img)
    pr, pc = periodic.profiles_from_maps(dh, dv)
    try:
        fr = periodic.fit_periodic_axis(pr, img.shape[0], min_pitch=periodic._SEARCH_FLOOR)
        fc = periodic.fit_periodic_axis(pc, img.shape[1], min_pitch=periodic._SEARCH_FLOOR)
    except DetectionError:
        return None
    ratio = max(fr.pitch, fc.pitch) / min(fr.pitch, fc.pitch)
    contrast = min(line_contrast(pr, fr.x0, fr.pitch), line_contrast(pc, fc.x0, fc.pitch))
    agreement = min(periodic._peak_agreement(fr.peaks, fr.x0, fr.pitch, pr.size),
                    periodic._peak_agreement(fc.peaks, fc.x0, fc.pitch, pc.size))
    if ratio <= _FINE_MAX_RATIO and contrast >= _FINE_MIN_CONTRAST and agreement >= _FINE_MIN_AGREEMENT:
        return (fr.pitch + fc.pitch) / 2
    return None


def read_image(img: np.ndarray, *, delta_e_threshold: float = DEFAULT_DELTA_E,
               crop: tuple[int, int, int, int] | None = None,
               flat: np.ndarray | None = None) -> Reading:
    """Detect, then decide whether `img` (or `crop` of it) is a chart, a picture, or a
    pixel image. `flat` is the image with transparency flattened (bridge._on_white), for
    the pixel check; `img` when omitted.

    A pixel image (pixels.py) of blocks 2 px or larger is read as pixels, unless it is
    a sure chart whose squares aren't its blocks (a chart drawn with lines 2 px thick is
    made of 2 px blocks too): its gridlines are then what the blocks draw. An image of
    one pixel per stitch is read so only when detection finds no chart in it at all: a
    small crisp chart is also uniform 1 px blocks, gridlines and all."""
    region = img if crop is None else img[crop[1]:crop[3], crop[0]:crop[2]]
    source = region if flat is None else (flat if crop is None else flat[crop[1]:crop[3], crop[0]:crop[2]])
    art = read_pixels(source)
    # Kept only when the image is read as pixels: a chart is uniform blocks too (a small
    # crisp one, gridlines and all), and reading it pixel by pixel is no use.
    reading = _chart_or_picture(img, region, delta_e_threshold, crop)
    if art is None:
        return reading
    note = f"uniform {art.block} px blocks, {art.cols}x{art.rows}, {art.colours.shape[0]} colours"
    if art.block >= 2:  # an enlargement (pixels._MIN_SCALE); else one pixel per stitch
        # A chart, read or refused, whose squares aren't the blocks is a chart drawn with
        # lines two or more pixels thick (a crisp chart is an enlargement of a thinner-lined
        # one): its lines would become stitches.
        if reading.kind == "chart" and reading.sure and reading.result is not None:
            pitch = (reading.result.lattice.pitch_x + reading.result.lattice.pitch_y) / 2
        elif reading.kind == "chart" and reading.error is not None:
            pitch = fine_grid_pitch(region)
        else:
            pitch = art.block
        if pitch is None or abs(pitch - art.block) / art.block > 0.1:
            return reading
        return Reading("pixels", True, reading.result, None, f"{note}; {reading.reason}", art)
    if reading.kind == "picture":
        return Reading("pixels", True, reading.result, None, f"{note}; {reading.reason}", art)
    return reading


def read_chart(img: np.ndarray, *, delta_e_threshold: float = DEFAULT_DELTA_E,
               crop: tuple[int, int, int, int] | None = None,
               flat: np.ndarray | None = None) -> Reading:
    """Read `img` (or `crop` of it) as the chart the person says it is: pixel art block by
    block, as `read_image` decides; anything else as a chart. A grid `read_image` judged
    a picture's is read all the same, `sure` only when few of its squares are unsure; with
    no grid, it is a chart detection refused, for detection's reason. Never a picture."""
    reading = read_image(img, delta_e_threshold=delta_e_threshold, crop=crop, flat=flat)
    if reading.kind != "picture":
        return reading
    if reading.result is not None:
        unsure = float(np.mean(reading.result.confidence < 0.6))
        return Reading("chart", unsure <= _SURE_UNSURE, reading.result, None,
                       f"read as a chart on request ({reading.reason})")
    error = reading.error or DetectionError("NO_GRIDLINES", "Couldn't find gridlines.")
    return Reading("chart", True, None, error, f"no grid ({reading.reason})")


def _chart_or_picture(img: np.ndarray, region: np.ndarray, delta_e_threshold: float,
                      crop: tuple[int, int, int, int] | None) -> Reading:
    try:
        result = detect_pattern(img, delta_e_threshold=delta_e_threshold, crop=crop)
    except DetectionError as err:
        if err.code in _CHART_FAILURES and looks_like_fine_grid(region):
            return Reading("chart", True, None, err, f"{err.code}, and a grid's structure")
        # The refusal is kept: read as a chart on request (`read_chart`), it is the reason.
        return Reading("picture", True, None, err, f"{err.code}")

    ratio, span, unsure, contrast, coverage = _grid_signals(region, result)
    signals = (f"ratio {ratio:.2f}, span {span:.2f}, unsure {unsure:.2f}, contrast {contrast:.2f}, "
               f"coverage {coverage:.2f}")
    if (ratio > _MAX_CELL_RATIO or span < _MIN_SPAN or contrast < _MIN_CONTRAST
            or unsure > _MAX_UNSURE or coverage < _MIN_COVERAGE):
        return Reading("picture", True, result, None, f"not a grid: {signals}")
    return Reading("chart", unsure <= _SURE_UNSURE, result, None, signals)
