"""The browser bridge (core/bridge.py): what crosses into JavaScript, and when detection
runs. The worker converts every payload with `create_pyproxies: false`, so anything here
that isn't plain data or a 1-D typed-array-shaped numpy array would throw in the browser."""
from __future__ import annotations

import dataclasses
import numpy as np
import pytest

from ..core import bridge, convert, kind
from ..core.confirm import ConfirmState, pattern_from_preview
from ..core.detect import detect_pattern
from ..core.model import DetectionError, Pattern
from . import synth

# numpy dtypes Pyodide turns into typed arrays of the same element type.
_TYPED = {np.dtype(np.uint16), np.dtype(np.float32), np.dtype(np.float64)}


def _chart(seed: int = 5, rows: int = 14, cols: int = 20) -> np.ndarray:
    rng = np.random.default_rng(seed)
    spec = synth.SynthSpec(rows=rows, cols=cols,
                           palette=[(255, 255, 255), (30, 60, 160), (200, 40, 40)],
                           cells=rng.integers(0, 3, size=(rows, cols)).astype(np.uint16),
                           pitch=18, margin=14)
    return synth.render(spec)


def _rgba(img: np.ndarray) -> tuple[bytes, int, int]:
    h, w = img.shape[:2]
    alpha = np.full((h, w, 1), 255, np.uint8)
    return np.concatenate([img, alpha], axis=2).tobytes(), w, h


def _open(img: np.ndarray, **kw) -> dict:
    data, w, h = _rgba(img)
    return bridge.open_session(data, w, h, **kw)


def _walk(value, path="payload"):
    """Yield (path, value) for everything in a payload."""
    yield path, value
    if isinstance(value, dict):
        for k, v in value.items():
            assert isinstance(k, str), f"{path}: non-string key {k!r}"
            yield from _walk(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from _walk(v, f"{path}[{i}]")


def _assert_plain(payload: dict) -> None:
    for path, v in _walk(payload):
        if isinstance(v, np.ndarray):
            assert v.ndim == 1 and v.flags.c_contiguous, f"{path}: {v.shape}"
            assert v.dtype in _TYPED, f"{path}: {v.dtype}"
        else:
            # bool is an int; np.generic scalars (np.float64 etc.) are not allowed.
            assert type(v) in (dict, list, str, int, float, bool, type(None)), \
                f"{path}: {type(v).__name__}"


def _no_debug(payload: dict) -> None:
    for path, v in _walk(payload):
        if isinstance(v, dict):
            assert not any("debug" in k.lower() or k in ("mask", "run_h", "run_v")
                           for k in v), path


@pytest.fixture(autouse=True)
def _no_leaks():
    before = set(bridge._sessions)
    yield
    for sid in set(bridge._sessions) - before:
        bridge.close_session(sid)


@pytest.fixture
def count_detections(monkeypatch):
    calls = []

    def counting(img, **kw):
        calls.append(kw)
        return detect_pattern(img, **kw)

    # The bridge detects through kind.read_image, which decides chart or picture.
    monkeypatch.setattr(kind, "detect_pattern", counting)
    return calls


# --- payload shape ----------------------------------------------------------------------

def test_every_payload_is_plain_data_without_debug_layers():
    img = _chart()
    opened = _open(img)
    assert opened["ok"] is True
    sid = opened["session"]
    payloads = [
        opened,
        bridge.set_params(sid, rows=opened["rows"] + 1, cols=opened["cols"] - 1),
        bridge.preview(sid),
        bridge.set_params(sid, delta_e=9.0),
        bridge.preview(sid),
        bridge.set_params(sid, extent={"x0": 10, "y0": 10, "x1": 200, "y1": 150}),
        bridge.preview(sid),
        bridge.redetect(sid),
        bridge.redetect(sid, crop=(5, 5, img.shape[1] - 5, img.shape[0] - 5)),
        bridge.commit(sid, "Test"),
        bridge.close_session(sid),
        bridge.preview(sid),                        # NO_SESSION
        _open(np.full((8, 8, 3), 255, np.uint8)),   # too small for a chart: TOO_SMALL
        _open(img, intent="sideways"),              # BAD_MODE
    ]
    pic = _open(img, intent="picture")
    payloads += [
        pic,
        bridge.set_params(pic["session"], width=30, colours=4, detail=0.2, cell_aspect=0.9,
                          extent={"x0": 10, "y0": 10, "x1": 200, "y1": 150}),
        bridge.preview(pic["session"]),
        bridge.commit(pic["session"], "Picture"),
    ]
    for p in payloads:
        _assert_plain(p)
        _no_debug(p)


def test_preview_arrays_have_the_grid_shape():
    img = _chart(rows=12, cols=17)
    p = _open(img)
    assert (p["rows"], p["cols"]) == (12, 17)
    assert p["cells"].dtype == np.uint16 and p["cells"].size == 12 * 17
    assert p["confidence"].dtype == np.float32 and p["confidence"].size == 12 * 17
    assert p["rowLines"].size == 13 and p["colLines"].size == 18
    assert (p["imageWidth"], p["imageHeight"]) == (img.shape[1], img.shape[0])
    assert sum(e["count"] for e in p["palette"]) == 12 * 17
    assert int(p["cells"].max()) < len(p["palette"])


def test_the_result_is_what_the_desktop_commits():
    """open → commit gives exactly the cells the desktop's import produces:
    detect_pattern → ConfirmState.from_detection → preview → pattern_from_preview."""
    img = _chart(seed=9)
    result = detect_pattern(img)
    desktop = pattern_from_preview(ConfirmState.from_detection(img, result).preview(), "x")

    sid = _open(img)["session"]
    web = bridge.commit(sid, "x")["pattern"]
    assert (web["rows"], web["cols"]) == (desktop.rows, desktop.cols)
    assert np.array_equal(web["cells"].reshape(web["rows"], web["cols"]), desktop.cells)
    assert [(e["hex"], e["name"], e["dmc"], e["count"]) for e in web["palette"]] == \
        [(e.hex, e.name, e.dmc, e.count) for e in desktop.palette]
    assert len(web["row_ids"]) == web["rows"] == len(set(web["row_ids"]))
    assert web["start_direction"] == "RTL"
    # Every field a Pattern has, so the web app gets a whole one (craft included).
    assert set(web) == {f.name for f in dataclasses.fields(Pattern)}
    assert web["craft"] == "tapestry"


def test_alpha_is_dropped_not_composited():
    """Pillow's convert('RGB') discards alpha; so does the bridge."""
    img = _chart()
    h, w = img.shape[:2]
    rgba = np.concatenate([img, np.zeros((h, w, 1), np.uint8)], axis=2)   # all transparent
    a = bridge.commit(bridge.open_session(rgba.tobytes(), w, h)["session"], "a")["pattern"]
    b = bridge.commit(_open(img)["session"], "b")["pattern"]
    assert np.array_equal(a["cells"], b["cells"])


def test_warnings_at_the_detected_settings_match_detection():
    """The bridge rewords nothing: before any change, its warnings are detection's own
    (less the low-confidence one)."""
    # Near colours and JPEG noise, so the sampled warnings actually fire.
    rng = np.random.default_rng(4)
    spec = synth.SynthSpec(rows=16, cols=22,
                           palette=[(255, 255, 255), (200, 40, 40), (212, 58, 52), (20, 20, 20)],
                           cells=rng.integers(0, 4, size=(16, 22)).astype(np.uint16),
                           pitch=12, margin=10, jpeg_quality=35)
    img = synth.render(spec)
    result = detect_pattern(img)
    assert result.warnings, "the fixture should produce warnings"
    p = _open(img)
    # All but the low-confidence one, which the web doesn't show.
    want = [w for w in result.warnings if "low confidence" not in w]
    assert sorted(p["warnings"]) == sorted(want)


def test_no_low_confidence_warning_even_when_cells_are_unsure():
    img = _chart()
    p = _open(img)
    sid = p["session"]
    # Half a cell's worth of misalignment samples across gridlines.
    bridge.set_params(sid, rows=p["rows"] * 2 - 1, cols=p["cols"] * 2 - 1)
    worse = bridge.preview(sid)
    assert worse["lowConfidenceFraction"] > 0.02
    assert not any("low confidence" in w for w in worse["warnings"])


# --- errors as data -----------------------------------------------------------------------

@pytest.mark.parametrize("code", ["LOW_RESOLUTION", "ROTATED"])
def test_a_charts_refusal_is_returned_not_raised(monkeypatch, code):
    """A chart detection refuses (too fine, rotated) stays a chart's failure: the image
    has a grid's structure."""
    def failing(img, **kw):
        raise DetectionError(code, f"failed with {code}")

    monkeypatch.setattr(kind, "detect_pattern", failing)
    out = _open(_chart())
    reading = {"kind": "chart", "sure": True, "photoLike": False, "failure": code}
    assert out == {"ok": False, "code": code, "message": f"failed with {code}",
                   "session": out["session"], "reading": reading}
    # The session stays open so the user can crop and try again; the retry fails the same way.
    again = bridge.redetect(out["session"], crop=(0, 0, 100, 100))
    assert again["ok"] is False and again["code"] == code
    assert bridge.preview(out["session"])["code"] == "NO_DETECTION"
    assert bridge.commit(out["session"], "x")["code"] == "NO_DETECTION"
    # "Convert as a photo" opens the image again as a picture, which detects nothing.
    anyway = _open(_chart(), intent="picture")
    assert anyway["ok"] is True and anyway["mode"] == "picture"
    assert bridge.commit(anyway["session"], "x")["ok"] is True


@pytest.mark.parametrize("code", DetectionError.CODES)
def test_an_image_without_a_chart_is_a_charts_failure_never_a_picture(monkeypatch, code):
    """Asked to read a chart, an image with no grid in it fails for detection's reason; it
    is never turned into a pattern unasked. Asked for a picture, it is one."""
    def failing(img, **kw):
        raise DetectionError(code, f"failed with {code}")

    monkeypatch.setattr(kind, "detect_pattern", failing)
    gradient = np.linspace(0, 255, 320)[None, :, None].repeat(240, 0).repeat(3, 2)
    out = _open(gradient.astype(np.uint8))
    assert out["ok"] is False and out["code"] == code
    assert out["reading"] == {"kind": "chart", "sure": True, "photoLike": False, "failure": code}
    pic = _open(gradient.astype(np.uint8), intent="picture")
    assert pic["ok"] is True and pic["mode"] == "picture"
    assert pic["reading"] == {"kind": "picture", "sure": True, "photoLike": False, "failure": None}
    assert pic["warnings"] == [] and pic["picture"]["width"] == 60


def test_running_out_of_memory_is_returned_not_raised(monkeypatch):
    # What numpy raises when Pyodide's WebAssembly memory can't grow any further.
    def exhausted(*args, **kw):
        raise MemoryError("Unable to allocate 1.72 GiB for an array")

    sid = _open(_chart())["session"]
    monkeypatch.setattr(kind, "detect_pattern", exhausted)
    for out in (_open(_chart()), bridge.redetect(sid)):
        assert out["ok"] is False and out["code"] == "OUT_OF_MEMORY"
        assert "1.72 GiB" in out["message"]
        _assert_plain(out)
    # Resampling and saving allocate too.
    monkeypatch.undo()
    sid = _open(_chart())["session"]
    monkeypatch.setattr(bridge, "_preview_payload", exhausted)
    assert bridge.preview(sid)["code"] == "OUT_OF_MEMORY"
    monkeypatch.setattr(bridge, "pattern_from_preview", exhausted)
    assert bridge.commit(sid, "x")["code"] == "OUT_OF_MEMORY"


def test_real_images_without_a_chart_fail_as_charts_and_convert_as_pictures():
    """Too small for a chart, or no grid at all: read as charts they fail; as pictures
    both are turned into a pattern, the tiny one no wider than its pixels."""
    tiny = np.full((10, 10, 3), 200, np.uint8)
    gradient = (np.linspace(0, 255, 320)[None, :, None].repeat(240, 0).repeat(3, 2)).astype(np.uint8)
    assert _open(tiny)["code"] == "TOO_SMALL"
    assert _open(gradient)["ok"] is False
    t = _open(tiny, intent="picture")
    assert (t["ok"], t["mode"], t["cols"]) == (True, "picture", 10)
    assert _open(gradient, intent="picture")["mode"] == "picture"


def test_bad_input_and_unknown_sessions():
    assert bridge.open_session(b"\x00" * 10, 4, 4)["code"] == "BAD_IMAGE"
    assert bridge.open_session(b"", 0, 0)["code"] == "BAD_IMAGE"
    for call in (lambda: bridge.preview(99999), lambda: bridge.redetect(99999),
                 lambda: bridge.set_params(99999, rows=3), lambda: bridge.commit(99999, "x"),
                 lambda: bridge.close_session(99999)):
        assert call()["code"] == "NO_SESSION"


def test_a_crop_that_misses_the_image_is_too_small():
    """Too small to hold a chart; a picture's is a pattern of at most one stitch per
    pixel."""
    sid = _open(_chart())["session"]
    assert bridge.redetect(sid, crop=(-50, -50, 3, 3))["code"] == "TOO_SMALL"
    sid = _open(_chart(), intent="picture")["session"]
    out = bridge.redetect(sid, crop=(-50, -50, 3, 3))
    assert (out["ok"], out["mode"]) == (True, "picture")
    assert out["cols"] <= 3 and out["rows"] <= 3


# --- the fast/slow split --------------------------------------------------------------------

def test_set_params_and_preview_never_rerun_detection(count_detections):
    p = _open(_chart())
    sid = p["session"]
    assert len(count_detections) == 1
    for _ in range(3):
        bridge.set_params(sid, rows=p["rows"] + 2)
        bridge.preview(sid)
        bridge.set_params(sid, delta_e=3.0)
        bridge.preview(sid)
        bridge.set_params(sid, cols=p["cols"] - 1, extent=p["extent"])
        bridge.preview(sid)
    bridge.commit(sid, "x")
    assert len(count_detections) == 1
    bridge.redetect(sid)
    bridge.redetect(sid, crop=(0, 0, 200, 200))
    assert len(count_detections) == 3


def test_preview_is_cached_until_a_setting_changes(monkeypatch):
    sid = _open(_chart())["session"]
    calls = []
    real = bridge.ConfirmState.preview

    def counting(self):
        calls.append(self._cache is None)
        return real(self)

    monkeypatch.setattr(bridge.ConfirmState, "preview", counting)
    bridge.preview(sid)
    bridge.preview(sid)
    assert calls == [False, False]          # the open already resampled
    bridge.set_params(sid, delta_e=10.0)
    bridge.preview(sid)
    bridge.preview(sid)
    assert calls[2:] == [True, False]


def test_settings_change_the_result():
    rng = np.random.default_rng(3)
    spec = synth.SynthSpec(rows=14, cols=20,
                           palette=[(255, 255, 255), (200, 40, 40), (210, 55, 55)],  # near reds
                           cells=rng.integers(0, 3, size=(14, 20)).astype(np.uint16),
                           pitch=18, margin=10)
    sid = _open(synth.render(spec), delta_e=2.0)["session"]
    split = len(bridge.preview(sid)["palette"])
    bridge.set_params(sid, delta_e=15.0)
    assert len(bridge.preview(sid)["palette"]) < split
    bridge.set_params(sid, rows=10, cols=11)
    q = bridge.preview(sid)
    assert (q["rows"], q["cols"]) == (10, 11) and q["cells"].size == 110
    assert bridge.commit(sid, "x")["pattern"]["cols"] == 11


def test_redetect_keeps_colour_detail_and_resets_the_grid():
    img = _chart(rows=14, cols=20)
    sid = _open(img)["session"]
    bridge.set_params(sid, rows=5, cols=5, delta_e=8.0)
    again = bridge.redetect(sid)
    assert (again["rows"], again["cols"]) == (14, 20)
    assert again["deltaE"] == 8.0


def test_a_crop_is_reported_in_whole_image_coordinates():
    img = _chart(rows=14, cols=20)
    full = _open(img)
    ext = full["extent"]
    pad = 4
    crop = (int(ext["x0"]) - pad, int(ext["y0"]) - pad, int(ext["x1"]) + pad, int(ext["y1"]) + pad)
    cropped = bridge.redetect(full["session"], crop=crop)
    assert (cropped["rows"], cropped["cols"]) == (14, 20)
    for k in ("x0", "y0", "x1", "y1"):
        assert abs(cropped["extent"][k] - ext[k]) <= 1.0, k
    assert np.array_equal(cropped["cells"], full["cells"])


# --- sessions are freed -------------------------------------------------------------------------

def test_sessions_are_freed():
    start = bridge.session_count()
    ids = [_open(_chart(seed=s))["session"] for s in range(3)]
    assert len(set(ids)) == 3 and bridge.session_count() == start + 3
    for sid in ids:
        assert bridge.close_session(sid) == {"ok": True}
    assert bridge.session_count() == start
    assert bridge.close_session(ids[0])["code"] == "NO_SESSION"


def test_a_failed_open_still_has_a_session_to_close():
    out = _open(np.full((10, 10, 3), 200, np.uint8))
    assert bridge.close_session(out["session"]) == {"ok": True}


def test_no_detection_result_is_kept_with_its_debug_layers(count_detections):
    sid = _open(_chart())["session"]
    s = bridge._sessions[sid]
    held = ([v for v in vars(s).values()] + [v for v in vars(s.state).values()]
            + [v for v in vars(s.reading).values()])
    assert not any(type(v).__name__ in ("DebugLayers", "DetectionResult") for v in held)


# --- shrinking large images ------------------------------------------------------------------

def test_shrink_is_a_rounded_box_average():
    img = np.arange(5 * 7 * 3, dtype=np.uint8).reshape(5, 7, 3)
    out = bridge.shrink(img, 2)
    assert out.shape == (2, 3, 3) and out.dtype == np.uint8
    expect = np.floor(img[:4, :6].reshape(2, 2, 3, 2, 3).mean(axis=(1, 3)) + 0.5)
    assert np.array_equal(out, expect.astype(np.uint8))
    assert bridge.shrink(img, 1) is not img and np.array_equal(bridge.shrink(img, 1), img)


def test_shrink_factor_is_the_smallest_whole_factor_within_the_pixel_budget():
    budget = 4_000_000
    cases = {
        (2000, 2000): 1,          # exactly on budget
        (2001, 2000): 2,
        (4000, 3000): 2,          # 12 MP → 2000×1500, not 1333×1000
        (1145, 2497): 1,          # the owner's tall chart: 2.9 MP, kept whole
        (4032, 3024): 2,          # an iPhone photo
        (8000, 6000): 4,          # 48 MP: ÷3 is 5.3 MP, over budget
        (6000, 4000): 3,          # ÷2 is 6 MP; ÷3 is 2000×1333
        (100, 60_000): 2,         # a long strip: the pixel count decides, not the edge
    }
    for (w, h), k in cases.items():
        assert bridge.shrink_factor(w, h, budget) == k, (w, h)
        assert (w // k) * (h // k) <= budget
        if k > 1:                 # and no smaller factor would do
            assert (w // (k - 1)) * (h // (k - 1)) > budget
    assert bridge.shrink_factor(4000, 3000, None) == 1
    assert bridge.shrink_factor(4000, 3000, 0) == 1


def test_shrunk_pixels_are_identical_on_every_run():
    rng = np.random.default_rng(3)
    rgba = rng.integers(0, 256, (901, 1203, 4), dtype=np.uint8)
    runs = [bridge._rgb_from_rgba(rgba.tobytes(), 1203, 901, k=3) for _ in range(3)]
    assert runs[0].shape == (300, 401, 3) and runs[0].dtype == np.uint8
    assert all(np.array_equal(runs[0], r) for r in runs[1:])
    # The same pixels as an exact rounded mean, computed independently.
    blocks = rgba[:900, :1203, :3].astype(np.int64).reshape(300, 3, 401, 3, 3).sum(axis=(1, 3))
    assert np.array_equal(runs[0], ((blocks * 2 + 9) // 18).astype(np.uint8))


def test_a_shrunk_image_reports_whole_image_coordinates():
    small = _chart(rows=14, cols=20)
    big = np.repeat(np.repeat(small, 3, axis=0), 3, axis=1)     # exactly 3× each way
    ref = _open(small)
    p = _open(big, max_pixels=small.shape[0] * small.shape[1])
    assert (p["imageWidth"], p["imageHeight"]) == (big.shape[1], big.shape[0])
    assert (p["detectedWidth"], p["detectedHeight"]) == (small.shape[1], small.shape[0])
    assert (p["rows"], p["cols"]) == (14, 20)
    assert np.array_equal(p["cells"], ref["cells"])
    for k in ("x0", "y0", "x1", "y1"):
        assert p["extent"][k] == pytest.approx(ref["extent"][k] * 3 + 1)
    assert np.allclose(p["rowLines"], ref["rowLines"] * 3 + 1)
    # A crop and an extent given in image pixels land where they should.
    e = p["extent"]
    cropped = bridge.redetect(p["session"], crop=(e["x0"] - 9, e["y0"] - 9, e["x1"] + 9, e["y1"] + 9))
    assert (cropped["rows"], cropped["cols"]) == (14, 20)
    assert np.array_equal(cropped["cells"], ref["cells"])
    bridge.set_params(p["session"], extent=e)
    assert bridge.preview(p["session"])["extent"] == pytest.approx(e)


def test_no_shrink_below_the_limit():
    img = _chart()
    p = _open(img, max_pixels=img.shape[0] * img.shape[1])
    assert (p["detectedWidth"], p["detectedHeight"]) == (p["imageWidth"], p["imageHeight"])


def test_open_can_detect_just_a_crop():
    small = _chart(rows=14, cols=20)
    big = np.repeat(np.repeat(small, 3, axis=0), 3, axis=1)
    ref = _open(big)
    e = ref["extent"]
    crop = (int(e["x0"]) - 9, int(e["y0"]) - 9, int(e["x1"]) + 9, int(e["y1"]) + 9)
    # Straight from open (a retry after a timeout), shrunk or not, as redetect would.
    for kw in ({}, {"max_pixels": small.shape[0] * small.shape[1]}):
        p = _open(big, crop=crop, **kw)
        again = bridge.redetect(_open(big, **kw)["session"], crop=crop)
        assert (p["rows"], p["cols"]) == (again["rows"], again["cols"]) == (14, 20)
        assert np.array_equal(p["cells"], again["cells"])
        assert p["extent"] == pytest.approx(again["extent"])


def test_redetect_can_set_the_colour_detail_first():
    img = _chart()
    sid = _open(img)["session"]
    p = bridge.redetect(sid, delta_e=11.0)
    assert p["deltaE"] == 11.0
    want = ConfirmState.from_detection(img, detect_pattern(img, delta_e_threshold=11.0), delta_e=11.0).preview()
    assert np.array_equal(p["cells"], want.cells.ravel())
    assert bridge.redetect(sid)["deltaE"] == 11.0          # and it stays


# --- pictures (kind.py, convert.py) ---------------------------------------------------------

def _photo(h: int = 240, w: int = 320) -> np.ndarray:
    """A picture, not a chart: smooth gradients with a small dark disc (a 'pupil')."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    img = np.stack([120 + 100 * x / w, 90 + 120 * y / h, 160 - 60 * x / w], axis=2)
    img[(x - 200) ** 2 + (y - 100) ** 2 < 9 ** 2] = (20, 20, 30)
    return np.clip(img, 0, 255).astype(np.uint8)


def test_a_chart_is_read_as_a_chart():
    p = _open(_chart())
    assert p["mode"] == "chart" and p["picture"] is None
    assert p["reading"] == {"kind": "chart", "sure": True, "photoLike": False, "failure": None}


def test_a_picture_opens_as_a_picture_and_saves_what_convert_makes(count_detections):
    img = _photo()
    p = _open(img, intent="picture")
    assert count_detections == []                     # nothing is detected in a picture
    assert (p["mode"], p["reading"]["kind"]) == ("picture", "picture")
    assert p["picture"] == {"width": 60, "maxWidth": 320, "colours": 6, "detail": 0.5,
                            "cellAspect": 1.0, "outlines": False}
    assert (p["cols"], p["rows"]) == (60, 45)
    assert p["confidence"].min() == 1.0 and p["lowConfidenceFraction"] == 0.0
    want = convert.convert_picture(img)
    saved = bridge.commit(p["session"], "x")["pattern"]
    assert np.array_equal(saved["cells"].reshape(want.rows, want.cols), want.cells)
    assert [e["hex"] for e in saved["palette"]] == [e.hex for e in want.palette]


def test_picture_settings_change_the_pattern_without_detecting_again(count_detections):
    sid = _open(_photo(), intent="picture")["session"]
    bridge.set_params(sid, width=40)
    p = bridge.preview(sid)
    assert (p["cols"], p["rows"]) == (40, 30)
    bridge.set_params(sid, cell_aspect=0.75)          # stitches wider than tall: more rows
    assert bridge.preview(sid)["rows"] == 40
    bridge.set_params(sid, colours=3)
    assert len(bridge.preview(sid)["palette"]) <= 3
    bridge.set_params(sid, detail=1.0)
    assert bridge.preview(sid)["picture"]["detail"] == 1.0
    bridge.set_params(sid, extent={"x0": 0, "y0": 0, "x1": 160, "y1": 240})
    p = bridge.preview(sid)
    assert p["extent"] == {"x0": 0.0, "y0": 0.0, "x1": 160.0, "y1": 240.0}
    assert p["picture"]["maxWidth"] == 160
    # Rows and colour detail are the chart's; a picture ignores them.
    bridge.set_params(sid, rows=5, delta_e=3.0)
    assert bridge.preview(sid)["rows"] == p["rows"]
    assert len(count_detections) == 0


def test_a_chart_asked_for_as_a_picture_is_converted():
    """"Convert as a photo" on a chart: its squares are not read."""
    p = _open(_chart(), intent="picture")
    assert p["mode"] == "picture" and p["reading"]["kind"] == "picture"
    assert p["cols"] == 60


def test_a_photo_opened_as_a_chart_fails_rather_than_converting():
    out = _open(_photo())
    assert out["ok"] is False and out["reading"]["kind"] == "chart"


def _noisy_chart() -> np.ndarray:
    """A chart with a little noise, as a screenshot's JPEG has: not exact blocks, so never
    pixel art, however kind.py judges it."""
    noise = np.random.default_rng(4).integers(-4, 5, size=_chart().shape)
    return np.clip(_chart().astype(int) + noise, 0, 255).astype(np.uint8)


def test_a_grid_judged_a_pictures_is_still_read_as_a_chart(monkeypatch):
    """Asked for a chart, a grid detection found is read even when kind.py would call the
    image a picture: the screen shows it beside the image, and a chart called a picture
    was a dead end. Sure only when few squares are unsure."""
    want = _open(_noisy_chart())
    assert want["mode"] == "chart"
    real = kind._chart_or_picture

    def as_picture(*args):
        r = real(*args)
        return kind.Reading("picture", True, r.result, None, "forced")

    monkeypatch.setattr(kind, "_chart_or_picture", as_picture)
    p = _open(_noisy_chart())
    assert (p["ok"], p["mode"], p["rows"]) == (True, "chart", 14)
    assert p["reading"] == {"kind": "chart", "sure": True, "photoLike": True, "failure": None}
    assert np.array_equal(p["cells"], want["cells"])


def test_a_forced_chart_with_many_unsure_squares_is_not_sure(monkeypatch):
    real = kind._chart_or_picture

    def unsure(*args):
        r = real(*args)
        r.result.confidence[:] = 0.1
        return kind.Reading("picture", True, r.result, None, "forced")

    monkeypatch.setattr(kind, "_chart_or_picture", unsure)
    p = _open(_noisy_chart())
    assert (p["mode"], p["reading"]["sure"]) == ("chart", False)


def test_a_picture_flattens_transparency_onto_white_but_detection_does_not():
    img = _photo()
    h, w = img.shape[:2]
    alpha = np.full((h, w, 1), 255, np.uint8)
    alpha[:, : w // 2] = 0                            # left half transparent
    p = bridge.open_session(np.concatenate([img, alpha], axis=2).tobytes(), w, h, intent="picture")
    cells = p["cells"].reshape(p["rows"], p["cols"])
    left = {p["palette"][i]["hex"] for i in np.unique(cells[:, : p["cols"] // 2 - 1])}
    assert left == {"#ffffff"}
    assert np.array_equal(bridge._sessions[p["session"]].img, img)     # detection's own


def test_a_crop_read_as_a_picture_uses_just_the_crop():
    sid = _open(_photo(), intent="picture")["session"]
    p = bridge.redetect(sid, crop=(100, 40, 300, 200))
    assert p["mode"] == "picture"
    assert p["extent"] == {"x0": 100.0, "y0": 40.0, "x1": 300.0, "y1": 200.0}


def test_a_shrunk_picture_reports_image_coordinates():
    img = np.repeat(np.repeat(_photo(), 2, axis=0), 2, axis=1)       # 640×480
    p = _open(img, max_pixels=320 * 240, intent="picture")
    assert p["detectedWidth"] == 320
    assert p["extent"]["x1"] == pytest.approx(640, abs=1)
    bridge.set_params(p["session"], extent={"x0": 0, "y0": 0, "x1": 320, "y1": 480})
    q = bridge.preview(p["session"])
    assert q["extent"]["x1"] == pytest.approx(320, abs=1)
    assert q["picture"]["maxWidth"] == 160            # one stitch per detected pixel


def test_a_bad_stitch_shape_is_ignored():
    sid = _open(_photo(), cell_aspect=0, intent="picture")["session"]
    assert bridge.preview(sid)["picture"]["cellAspect"] == 1.0
    bridge.set_params(sid, cell_aspect=-3)
    assert bridge.preview(sid)["picture"]["cellAspect"] == 1.0


# --- pixel images (pixels.py) ---------------------------------------------------------------

def _pixel_art(k: int = 6) -> tuple[np.ndarray, np.ndarray]:
    """A 20 × 14 sprite of 4 colours, and the same enlarged k× with no gridlines."""
    rng = np.random.default_rng(2)
    colours = np.array([(255, 255, 255), (20, 20, 30), (200, 40, 40), (40, 90, 200)], np.uint8)
    sprite = colours[rng.integers(0, 4, size=(14, 20))]
    return sprite, np.repeat(np.repeat(sprite, k, axis=0), k, axis=1)


def test_pixel_art_is_read_block_by_block_and_saved_exactly():
    sprite, img = _pixel_art()
    p = _open(img)
    assert (p["mode"], p["reading"]["kind"]) == ("pixels", "pixels")
    assert (p["cols"], p["rows"]) == (20, 14)
    assert p["extent"] == {"x0": 0.0, "y0": 0.0, "x1": 120.0, "y1": 84.0}
    assert p["warnings"] == [] and p["picture"] is None
    saved = bridge.commit(p["session"], "Sprite")["pattern"]
    colours = np.array([[int(e["hex"][i:i + 2], 16) for i in (1, 3, 5)] for e in saved["palette"]])
    assert np.array_equal(colours[saved["cells"].reshape(14, 20)], sprite)


def test_pixel_art_asked_for_as_a_picture_is_converted_not_read_by_block():
    _, img = _pixel_art()
    p = _open(img, intent="picture")
    assert p["mode"] == "picture" and p["picture"] is not None
    # Read as a chart, its settings are ignored: there's nothing to adjust.
    sid = _open(img)["session"]
    assert bridge.set_params(sid, rows=3, width=50, extent={"x0": 0, "y0": 0, "x1": 10, "y1": 10}) == {"ok": True}
    assert bridge.preview(sid)["cols"] == 20


def test_pixel_art_in_a_crop_is_placed_in_the_whole_image():
    _, art = _pixel_art(4)
    img = np.full((art.shape[0] + 40, art.shape[1] + 60, 3), 90, np.uint8)
    img[20:20 + art.shape[0], 30:30 + art.shape[1]] = art
    sid = _open(img)["session"]
    p = bridge.redetect(sid, crop=(30, 20, 30 + art.shape[1], 20 + art.shape[0]))
    assert (p["mode"], p["cols"], p["rows"]) == ("pixels", 20, 14)
    assert p["extent"] == {"x0": 30.0, "y0": 20.0, "x1": 110.0, "y1": 76.0}


def test_transparent_pixel_art_is_read_on_white():
    _, img = _pixel_art(3)
    h, w = img.shape[:2]
    alpha = np.full((h, w, 1), 255, np.uint8)
    alpha[:, :9] = 0                                  # the first three columns of stitches
    p = bridge.open_session(np.concatenate([img, alpha], axis=2).tobytes(), w, h)
    assert p["mode"] == "pixels"
    cells = p["cells"].reshape(p["rows"], p["cols"])
    assert {p["palette"][i]["hex"] for i in np.unique(cells[:, :3])} == {"#ffffff"}


def test_keep_outlines_is_a_pictures_setting_and_is_saved(count_detections):
    """A circle drawn as a line on white: gone without outlines, kept with them, and the
    saved pattern is what the preview showed. Nothing is detected."""
    h = w = 300
    y, x = np.mgrid[0:h, 0:w]
    # A soft gradient behind it, as a scanned or smoothed drawing has: not pixel art.
    img = np.stack([235 + 20 * x / w, 235 + 20 * y / h, 245 - 10 * x / w], axis=2).astype(np.uint8)
    img[np.abs(np.hypot(y - 150, x - 150) - 110) < 1.5] = (20, 20, 20)
    p = _open(img, intent="picture")
    sid = p["session"]
    assert p["mode"] == "picture" and p["picture"]["outlines"] is False
    bridge.set_params(sid, width=30, outlines=True)
    q = bridge.preview(sid)
    assert q["picture"]["outlines"] is True
    dark = [i for i, e in enumerate(q["palette"]) if int(e["hex"][1:3], 16) < 80]
    assert len(dark) == 1 and int((q["cells"] == dark[0]).sum()) >= 50
    saved = bridge.commit(sid, "Ring")["pattern"]
    assert np.array_equal(saved["cells"], q["cells"])
    bridge.set_params(sid, outlines=False)
    assert bridge.preview(sid)["picture"]["outlines"] is False
    assert len(count_detections) == 0
