"""The browser bridge (core/bridge.py): what crosses into JavaScript, and when detection
runs. The worker converts every payload with `create_pyproxies: false`, so anything here
that isn't plain data or a 1-D typed-array-shaped numpy array would throw in the browser."""
from __future__ import annotations

import numpy as np
import pytest

from ..core import bridge
from ..core.confirm import ConfirmState, pattern_from_preview
from ..core.detect import detect_pattern
from ..core.model import DetectionError
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

    monkeypatch.setattr(bridge, "detect_pattern", counting)
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
        _open(np.full((8, 8, 3), 255, np.uint8)),   # TOO_SMALL
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


def test_alpha_is_dropped_not_composited():
    """Pillow's convert('RGB') discards alpha; so does the bridge."""
    img = _chart()
    h, w = img.shape[:2]
    rgba = np.concatenate([img, np.zeros((h, w, 1), np.uint8)], axis=2)   # all transparent
    a = bridge.commit(bridge.open_session(rgba.tobytes(), w, h)["session"], "a")["pattern"]
    b = bridge.commit(_open(img)["session"], "b")["pattern"]
    assert np.array_equal(a["cells"], b["cells"])


def test_warnings_at_the_detected_settings_match_detection():
    """The bridge rewords nothing: before any change, its warnings are detection's own."""
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
    assert sorted(p["warnings"]) == sorted(result.warnings)


def test_sampled_warnings_follow_the_settings():
    img = _chart()
    p = _open(img)
    assert not any("low confidence" in w for w in p["warnings"])
    sid = p["session"]
    # Half a cell's worth of misalignment samples across gridlines.
    bridge.set_params(sid, rows=p["rows"] * 2 - 1, cols=p["cols"] * 2 - 1)
    worse = bridge.preview(sid)
    assert any("low confidence" in w for w in worse["warnings"])
    assert worse["lowConfidenceFraction"] > 0.02


# --- errors as data -----------------------------------------------------------------------

@pytest.mark.parametrize("code", DetectionError.CODES)
def test_each_detection_error_is_returned_not_raised(monkeypatch, code):
    def failing(img, **kw):
        raise DetectionError(code, f"failed with {code}")

    monkeypatch.setattr(bridge, "detect_pattern", failing)
    out = _open(_chart())
    assert out == {"ok": False, "code": code, "message": f"failed with {code}",
                   "session": out["session"]}
    # The session stays open so the user can crop and try again; the retry fails the same way.
    again = bridge.redetect(out["session"], crop=(0, 0, 100, 100))
    assert again["ok"] is False and again["code"] == code
    assert bridge.preview(out["session"])["code"] == "NO_DETECTION"
    assert bridge.commit(out["session"], "x")["code"] == "NO_DETECTION"


def test_real_failures_come_back_as_data():
    tiny = _open(np.full((10, 10, 3), 200, np.uint8))
    assert (tiny["ok"], tiny["code"]) == (False, "TOO_SMALL")
    gradient = np.linspace(0, 255, 320)[None, :, None].repeat(240, 0).repeat(3, 2)
    blank = _open(gradient.astype(np.uint8))
    assert (blank["ok"], blank["code"]) == (False, "NO_GRIDLINES")


def test_bad_input_and_unknown_sessions():
    assert bridge.open_session(b"\x00" * 10, 4, 4)["code"] == "BAD_IMAGE"
    assert bridge.open_session(b"", 0, 0)["code"] == "BAD_IMAGE"
    for call in (lambda: bridge.preview(99999), lambda: bridge.redetect(99999),
                 lambda: bridge.set_params(99999, rows=3), lambda: bridge.commit(99999, "x"),
                 lambda: bridge.close_session(99999)):
        assert call()["code"] == "NO_SESSION"


def test_a_crop_that_misses_the_image_is_too_small():
    sid = _open(_chart())["session"]
    out = bridge.redetect(sid, crop=(-50, -50, 3, 3))
    assert (out["ok"], out["code"]) == (False, "TOO_SMALL")


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
    held = [v for v in vars(s).values()] + [v for v in vars(s.state).values()]
    assert not any(type(v).__name__ in ("DebugLayers", "DetectionResult") for v in held)


# --- shrinking large images ------------------------------------------------------------------

def test_shrink_is_a_rounded_box_average():
    img = np.arange(5 * 7 * 3, dtype=np.uint8).reshape(5, 7, 3)
    out = bridge.shrink(img, 2)
    assert out.shape == (2, 3, 3) and out.dtype == np.uint8
    expect = np.floor(img[:4, :6].reshape(2, 2, 3, 2, 3).mean(axis=(1, 3)) + 0.5)
    assert np.array_equal(out, expect.astype(np.uint8))
    assert bridge.shrink(img, 1) is not img and np.array_equal(bridge.shrink(img, 1), img)
    assert [bridge.shrink_factor(w, h, 1600) for w, h in
            ((1600, 900), (1601, 900), (3000, 2000), (3000, 4000), (800, 3300))] == [1, 2, 2, 3, 3]
    assert bridge.shrink_factor(4000, 3000, None) == 1


def test_a_shrunk_image_reports_whole_image_coordinates():
    small = _chart(rows=14, cols=20)
    big = np.repeat(np.repeat(small, 3, axis=0), 3, axis=1)     # exactly 3× each way
    ref = _open(small)
    p = _open(big, max_edge=max(small.shape[:2]))
    assert p["scale"] == 3
    assert (p["imageWidth"], p["imageHeight"]) == (big.shape[1], big.shape[0])
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
    p = _open(img, max_edge=max(img.shape[:2]))
    assert p["scale"] == 1
