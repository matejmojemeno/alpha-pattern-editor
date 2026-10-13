"""Marking one square to find the grid again (pipeline.detect_with_square,
periodic.fit_periodic_near, kind.read_marked, bridge.mark_square).

The mark only says roughly how big a square is: on the import screen it's drawn on a
scaled-down image, a pixel or two off. The gridlines decide the rest, so a grid detection
got right comes back exactly as detection found it, and one it got wrong (squares read at
twice their size) is put right."""
from __future__ import annotations

import os

import numpy as np
import pytest
from PIL import Image

from ..core import bridge
from ..core.detect import detect_pattern
from ..core.detect.pipeline import detect_with_square
from ..core.kind import read_marked
from ..core.model import DetectionError
from . import synth
from .test_detect import partitions_match

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMAGES = os.path.join(ROOT, "test_images")


def _load(name: str) -> np.ndarray:
    return np.asarray(Image.open(os.path.join(IMAGES, name)).convert("RGB"), dtype=np.uint8)


def _heavy_every_other(seed: int = 54) -> tuple[np.ndarray, synth.SynthSpec]:
    """A chart with a heavy line on every other gridline and faint ones between: the
    classic trap that reads as squares twice their size. With this seed, detection reads
    its 24 columns as 12."""
    rng = np.random.default_rng(seed)
    rows, cols = 2 * int(rng.integers(8, 25)), 2 * int(rng.integers(8, 30))
    cells = rng.integers(0, 4, size=(rows + 1, cols + 1))[:rows, :cols].astype(np.uint16)
    pitch = int(rng.integers(8, 20))
    spec = synth.SynthSpec(rows=rows, cols=cols, cells=cells, pitch=pitch, margin=15,
                           palette=[(250, 250, 250), (40, 90, 200), (220, 60, 60), (250, 210, 60)],
                           line_color=(235, 235, 235))
    img = synth.render(spec).copy()
    o = spec.margin
    for c in range(0, cols + 1, 2):
        img[o:o + rows * pitch + 1, o + c * pitch:o + c * pitch + 2] = 20
    for r in range(0, rows + 1, 2):
        img[o + r * pitch:o + r * pitch + 2, o:o + cols * pitch + 1] = 20
    return img, spec


def _square(result, i: int, j: int, off=(0.0, 0.0, 0.0, 0.0)) -> tuple[float, ...]:
    """The square at column i, row j of a detection, its corners moved by `off`."""
    cl, rl = result.lattice.col_lines, result.lattice.row_lines
    return tuple(float(v) + d for v, d in zip((cl[i], rl[j], cl[i + 1], rl[j + 1]), off))


# --- detect_with_square -------------------------------------------------------------------

def test_a_square_marked_puts_right_squares_read_at_twice_their_size():
    img, spec = _heavy_every_other()
    wrong = detect_pattern(img)
    assert (wrong.rows, wrong.cols) == (spec.rows, spec.cols // 2)   # the trap works
    o, p = spec.margin, spec.pitch
    # A square in the chart, its corners up to 2 px off.
    marked = detect_with_square(img, (o + 3 * p + 1.6, o + 2 * p - 1.2,
                                      o + 4 * p - 1.8, o + 3 * p + 1.9))
    assert (marked.rows, marked.cols) == (spec.rows, spec.cols)
    assert partitions_match(marked.cells, spec.cells)


@pytest.mark.parametrize("name, off", [
    ("cats.png", (1.5, -2.0, -1.0, 2.0)),
    ("monkeys.png", (-2.0, 1.0, 2.0, -1.5)),
    ("bug.jpg", (0.5, 0.5, -0.5, -0.5)),
    ("failed/bunny.jpg", (1.5, 1.0, -1.0, -1.5)),       # 2.5 px small on 9 px squares
    # A mark on lisa's 7 px squares a third too narrow, and one on shizuku's 10 px squares
    # small enough to let half the pitch into the search: both went wrong before
    # fit_periodic_near searched both sides and doubled a lattice with nothing between.
    ("failed/lisa.jpg", (1.7, -0.5, -1.9, 0.8)),
    ("failed/shizuku.jpg", (1.9, -1.0, -1.4, 1.2)),
])
def test_a_square_marked_on_a_grid_detection_got_right_gives_it_back_exactly(name, off):
    img = _load(name)
    ref = detect_pattern(img)
    marked = detect_with_square(img, _square(ref, ref.cols // 2, ref.rows // 2, off))
    assert (marked.rows, marked.cols) == (ref.rows, ref.cols)
    # The same lattice, refitted from another start: equal but for rounding.
    np.testing.assert_allclose(marked.lattice.col_lines, ref.lattice.col_lines, rtol=0, atol=1e-9)
    np.testing.assert_allclose(marked.lattice.row_lines, ref.lattice.row_lines, rtol=0, atol=1e-9)
    np.testing.assert_array_equal(marked.cells, ref.cells)


def test_corners_in_any_order_mark_the_same_square():
    img, spec = _heavy_every_other()
    o, p = spec.margin, spec.pitch
    a = detect_with_square(img, (o + 3 * p, o + 2 * p, o + 4 * p, o + 3 * p))
    b = detect_with_square(img, (o + 4 * p, o + 3 * p, o + 3 * p, o + 2 * p))
    np.testing.assert_array_equal(a.lattice.col_lines, b.lattice.col_lines)
    np.testing.assert_array_equal(a.lattice.row_lines, b.lattice.row_lines)


def test_a_square_marked_on_a_photo_without_a_grid_is_refused():
    img = _load("pictures/lake-mountains.jpg")
    with pytest.raises(DetectionError) as err:
        detect_with_square(img, (100, 100, 112, 112))
    assert err.value.code in ("NO_GRIDLINES", "ROTATED")


def test_a_square_under_six_pixels_is_too_low_a_resolution():
    # garment.png's squares are about 5 px: detection refuses it, and so does a mark.
    img = _load("garment.png")
    with pytest.raises(DetectionError) as err:
        detect_with_square(img, (300, 300, 305, 305))
    assert err.value.code == "LOW_RESOLUTION"


@pytest.mark.parametrize("name, square", [
    # Each of these fits a lattice (detect_with_square finds 16 × 3, 4 × 30, 46 × 22 and
    # 3 × 3), but none has a chart's lines.
    ("pictures/lake-mountains.jpg", (300, 200, 310, 210)),
    ("pictures/lake-mountains.jpg", (50, 50, 70, 70)),
    ("pictures/dog-beach.jpg", None),
    ("pictures/smiley.png", None),
])
def test_a_square_marked_on_a_photo_finds_no_chart(name, square):
    img = _load(name)
    if square is None:
        h, w = img.shape[:2]
        square = (w / 2, h / 2, w / 2 + 8, h / 2 + 8)
    detect_with_square(img, square)                         # a lattice is fitted ...
    with pytest.raises(DetectionError) as err:              # ... but it isn't a chart's
        read_marked(img, square)
    assert err.value.code == "NO_GRIDLINES"


def test_read_marked_is_always_a_chart():
    img, spec = _heavy_every_other()
    o, p = spec.margin, spec.pitch
    reading = read_marked(img, (o + 3 * p, o + 2 * p, o + 4 * p, o + 3 * p))
    assert reading.kind == "chart" and reading.error is None and reading.sure
    assert (reading.result.rows, reading.result.cols) == (spec.rows, spec.cols)


# --- bridge.mark_square ------------------------------------------------------------------

def _open(img: np.ndarray, **kw) -> dict:
    h, w = img.shape[:2]
    rgba = np.concatenate([img, np.full((h, w, 1), 255, np.uint8)], axis=2).tobytes()
    return bridge.open_session(rgba, w, h, **kw)


@pytest.fixture(autouse=True)
def _no_leaks():
    before = set(bridge._sessions)
    yield
    for sid in set(bridge._sessions) - before:
        bridge.close_session(sid)


def test_mark_square_resets_the_grid_and_saves_it():
    img, spec = _heavy_every_other()
    first = _open(img)
    # The import reads it as pixel art, one block per pixel (kind.read_chart).
    assert first["mode"] == "pixels" and (first["rows"], first["cols"]) != (spec.rows, spec.cols)
    o, p = spec.margin, spec.pitch
    out = bridge.mark_square(first["session"], [o + 3 * p, o + 2 * p, o + 4 * p, o + 3 * p])
    assert out["ok"] and out["mode"] == "chart"
    assert (out["rows"], out["cols"]) == (spec.rows, spec.cols)
    assert out["reading"]["kind"] == "chart" and out["reading"]["failure"] is None
    saved = bridge.commit(first["session"], "marked")["pattern"]
    assert (saved["rows"], saved["cols"]) == (spec.rows, spec.cols)


def test_a_failed_mark_keeps_the_grid_there_was():
    img, spec = _heavy_every_other()
    first = _open(img)
    sid = first["session"]
    out = bridge.mark_square(sid, [0, 0, 2, 2])           # a slip: nothing that small
    assert out["ok"] is False and out["session"] == sid
    after = bridge.preview(sid)
    assert (after["rows"], after["cols"]) == (first["rows"], first["cols"])
    np.testing.assert_array_equal(after["colLines"], first["colLines"])


def test_mark_square_after_a_failed_detection_finds_the_grid():
    img, spec = _heavy_every_other()
    o, p = spec.margin, spec.pitch
    # Detect only a sliver of margin first: no grid, but the session stays open.
    first = _open(img, crop=(0, 0, o - 2, o - 2))
    assert first["ok"] is False
    out = bridge.mark_square(first["session"], [o + 3 * p, o + 2 * p, o + 4 * p, o + 3 * p])
    assert out["ok"] and (out["rows"], out["cols"]) == (spec.rows, spec.cols)


def test_mark_square_is_in_image_pixels_when_the_image_was_shrunk():
    img, spec = _heavy_every_other()
    big = np.kron(img, np.ones((2, 2, 1), np.uint8))       # twice the size
    first = _open(big, max_pixels=big.shape[0] * big.shape[1] // 3)
    o, p = 2 * spec.margin, 2 * spec.pitch
    out = bridge.mark_square(first["session"], [o + 3 * p, o + 2 * p, o + 4 * p, o + 3 * p])
    assert out["ok"] and (out["rows"], out["cols"]) == (spec.rows, spec.cols)
    assert out["detectedWidth"] < big.shape[1]
    # The lines come back in the big image's pixels: about twice the spec's pitch apart.
    assert abs(float(np.diff(out["colLines"]).mean()) - p) < 0.5


def test_a_picture_has_no_squares_to_mark():
    img, _ = _heavy_every_other()
    first = _open(img, intent="picture")
    out = bridge.mark_square(first["session"], [10, 10, 20, 20])
    assert out == {"ok": False, "code": "BAD_MODE", "message": "A picture has no squares to mark."}


def test_bad_squares_and_unknown_sessions():
    img, _ = _heavy_every_other()
    sid = _open(img)["session"]
    assert bridge.mark_square(sid, ["a", 1, 2, 3])["code"] == "BAD_SQUARE"
    assert bridge.mark_square(10 ** 6, [0, 0, 10, 10])["code"] == "NO_SESSION"
