"""The browser's entry point into detection (docs/web-port-plan.md, Phase 2).

This is the only Python that knows JavaScript is calling it. The web worker
(web/src/detect/worker.ts) imports this module inside Pyodide and calls nothing else.
Everything it returns converts cleanly to JavaScript:

- dicts with str keys, lists, str, int, float, bool and None;
- 1-D contiguous numpy arrays, which arrive in JavaScript as typed arrays (uint16 →
  Uint16Array, float32 → Float32Array, float64 → Float64Array).

No other object ever crosses. The worker converts with `create_pyproxies: false`, which
throws rather than leak a PyProxy, and test_bridge.py walks every payload.

`DebugLayers` never crosses: it holds full-resolution masks, megabytes per message.

A `DetectionError` comes back as `{"ok": False, "code", "message"}`, never as an
exception. So do the bridge's own refusals, with codes of their own (`NO_SESSION`,
`NO_DETECTION`, `BAD_IMAGE`), and running out of memory (`OUT_OF_MEMORY`): Pyodide's
WebAssembly memory stops at 4 GB, less on a phone, and numpy raises MemoryError there.

The desktop's fast/slow split is kept (confirm_window.py): full detection runs only in
`open_session` and `redetect`. `set_params` and `preview` only resample, through the
session's `ConfirmState`, which caches the result until a setting changes.

Keys are camelCase, the convention on the JavaScript side, except in `commit`'s pattern,
which mirrors model.Pattern field for field, as web/src/model/types.ts does.
"""
from __future__ import annotations

import functools
import itertools
import re
from dataclasses import dataclass

import numpy as np

from .confirm import ConfirmState, Extent, Preview, pattern_from_preview
from .detect import detect_pattern
from .model import DetectionError

DEFAULT_DELTA_E = 6.0

# The detection warnings that come from sampling the cells rather than from fitting the
# lattice. They are recomputed on every preview, because changing the dimensions or the
# colour detail changes them; the lattice warnings stand until the next detection. The
# texts match pipeline._finish, and test_bridge.py checks the two agree.
_SAMPLED_WARNING = re.compile(r"have low confidence|don't closely match any detected colour")


@dataclass
class _Session:
    img: np.ndarray                 # (H, W, 3) uint8: the whole image even after a crop,
                                    # shrunk by `scale`
    width: int                      # the image as the browser has it, before shrinking
    height: int
    scale: int                      # whole-number shrink factor (shrink_factor); 1 = none
    delta_e: float
    state: ConfirmState | None      # None while the last detection failed
    lattice_warnings: list[str]

    # Everything that crosses the boundary is in the browser's image pixels; `img` is
    # smaller by `scale`. A shrunk pixel i covers image pixels [i*k, (i+1)*k).
    def to_image(self, v):
        return v * self.scale + (self.scale - 1) / 2

    def to_work(self, v):
        return (v - (self.scale - 1) / 2) / self.scale


_sessions: dict[int, _Session] = {}
_ids = itertools.count(1)


# --- helpers ----------------------------------------------------------------------------

def _error(code: str, message: str, **extra) -> dict:
    return {"ok": False, "code": code, "message": message, **extra}


def shrink_factor(width: int, height: int, max_pixels: int | None) -> int:
    """The smallest whole-number factor that brings the image to `max_pixels` or fewer
    (1 = no shrinking).

    Whole numbers, because a k×k block average is exact integer arithmetic, so the desktop
    and every browser get the same pixels, and because a fractional resample beats against
    thin gridlines: scripts/downscale_study.py found it turning a correct 88×192 chart
    into 88×115. The smallest factor, to keep as much resolution as memory allows: a
    budget in pixels rather than a long edge, since detection's memory grows with the pixel
    count, and a tall narrow chart shouldn't be halved because one edge is long.
    """
    if not max_pixels:
        return 1
    k = 1
    while (width // k) * (height // k) > max_pixels:
        k += 1
    return k


def shrink(img: np.ndarray, k: int) -> np.ndarray:
    """Average each k×k block into one pixel (a box filter), dropping the last partial
    block on each axis. Deterministic, so the desktop and every browser see the same
    pixels. Works on a strided view, such as the RGB channels of an RGBA array. Always
    returns a new array, so nothing keeps the caller's buffer alive."""
    if k == 1:
        return np.array(img, order="C")
    h, w = (img.shape[0] // k) * k, (img.shape[1] // k) * k
    blocks = img[:h, :w].reshape(h // k, k, w // k, k, img.shape[2])
    total = blocks.sum(axis=(1, 3), dtype=np.uint32)
    return ((total + (k * k) // 2) // (k * k)).astype(np.uint8)


def _rgb_from_rgba(rgba, width: int, height: int, k: int = 1) -> np.ndarray:
    """An owned (H, W, 3) uint8 array from RGBA bytes, as canvas getImageData gives them,
    shrunk by `k`.

    Alpha is dropped rather than composited, which is what Pillow's convert("RGB") does on
    the desktop."""
    if hasattr(rgba, "to_memoryview"):          # a JsProxy of a Uint8Array
        rgba = rgba.to_memoryview()
    width, height = int(width), int(height)
    flat = np.frombuffer(rgba, dtype=np.uint8)
    if width <= 0 or height <= 0 or flat.size != width * height * 4:
        raise ValueError(f"expected {width}×{height} RGBA pixels, got {flat.size} bytes")
    return shrink(flat.reshape(height, width, 4)[:, :, :3], k)


def _out_of_memory_as_data(fn):
    """Answer a MemoryError as `OUT_OF_MEMORY` data. The arrays being built are freed as
    the exception unwinds; the worker's client then terminates the worker anyway, since
    WebAssembly memory never shrinks once grown."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except MemoryError as err:
            return _error("OUT_OF_MEMORY", f"Ran out of memory: {err}")
    return wrapper


def _warnings(session: _Session, preview: Preview) -> list[str]:
    """The lattice warnings from the last detection, then the ones this preview earns.
    Worded as in pipeline._finish."""
    out = list(session.lattice_warnings)
    total = preview.rows * preview.cols
    flagged = int(np.count_nonzero(preview.confidence < 0.6))
    frac = flagged / total if total else 0.0
    if frac > 0.02:
        out.append(f"{flagged}/{total} cells ({100*frac:.1f}%) have low confidence — "
                   f"review before committing.")
    if preview.unmatched:
        out.append(f"{preview.unmatched} cell(s) don't closely match any detected colour — a "
                   f"colour may be missing; check them before committing.")
    return out


def _preview_payload(session_id: int, session: _Session) -> dict:
    p = session.state.preview()
    e = p.extent
    img = session.to_image
    return {
        "ok": True,
        "session": session_id,
        "rows": int(p.rows),
        "cols": int(p.cols),
        "cells": np.ascontiguousarray(p.cells, dtype=np.uint16).ravel(),
        "confidence": np.ascontiguousarray(p.confidence, dtype=np.float32).ravel(),
        "palette": [{"id": en.id, "hex": en.hex, "name": en.name, "dmc": en.dmc,
                     "count": int(en.count)} for en in p.palette],
        "warnings": _warnings(session, p),
        "lowConfidenceFraction": float(p.low_confidence_fraction),
        "extent": {"x0": img(float(e.x0)), "y0": img(float(e.y0)),
                   "x1": img(float(e.x1)), "y1": img(float(e.y1))},
        "rowLines": img(np.asarray(p.row_lines, dtype=np.float64).ravel()),
        "colLines": img(np.asarray(p.col_lines, dtype=np.float64).ravel()),
        "deltaE": float(p.delta_e),
        "imageWidth": session.width,
        "imageHeight": session.height,
        "detectedWidth": int(session.img.shape[1]),
        "detectedHeight": int(session.img.shape[0]),
    }


def _detect(session_id: int, session: _Session, crop=None) -> dict:
    """Run full detection on the session's image (or a crop of it) and reset its state."""
    session.state = None
    session.lattice_warnings = []
    if crop is not None:
        k = session.scale
        x0, y0 = (int(np.floor(float(v) / k)) for v in crop[:2])
        x1, y1 = (int(np.ceil(float(v) / k)) for v in crop[2:])
        h, w = session.img.shape[:2]
        x0, x1 = sorted((max(0, min(w, x0)), max(0, min(w, x1))))
        y0, y1 = sorted((max(0, min(h, y0)), max(0, min(h, y1))))
        crop = (x0, y0, x1, y1)
    try:
        result = detect_pattern(session.img, delta_e_threshold=session.delta_e, crop=crop)
    except DetectionError as err:
        return _error(err.code, str(err), session=session_id)
    result.debug = None                              # never kept, never sent
    state = ConfirmState.from_detection(session.img, result, delta_e=session.delta_e)
    if crop is not None:
        # Detection saw only the crop; move the extent back into whole-image coordinates,
        # as the desktop does, so resampling and the overlay line up with the source.
        ox, oy = crop[0], crop[1]
        e = state.extent
        state.set_extent(Extent(e.x0 + ox, e.y0 + oy, e.x1 + ox, e.y1 + oy))
    session.state = state
    session.lattice_warnings = [w for w in result.warnings if not _SAMPLED_WARNING.search(w)]
    return _preview_payload(session_id, session)


def _session(session_id) -> _Session | dict:
    s = _sessions.get(int(session_id))
    return s if s is not None else _error("NO_SESSION", f"No detection session {session_id}.")


# --- the API the worker calls --------------------------------------------------------------

@_out_of_memory_as_data
def open_session(rgba, width: int, height: int, delta_e: float = DEFAULT_DELTA_E,
                 max_pixels: int | None = None, crop=None) -> dict:
    """Start a session on an image and detect it, or only `crop` = (x0, y0, x1, y1) of it
    (image pixels). The session stays open when detection fails, so the user can crop and
    `redetect`; the failure carries its id.

    With `max_pixels`, a bigger image is shrunk by a whole-number factor first
    (`shrink_factor`, `shrink`); coordinates in and out stay in the image's own pixels."""
    k = shrink_factor(int(width), int(height), max_pixels)
    try:
        img = _rgb_from_rgba(rgba, width, height, k)
    except ValueError as err:
        return _error("BAD_IMAGE", str(err))
    session_id = next(_ids)
    session = _Session(img=img, width=int(width), height=int(height), scale=k,
                       delta_e=float(delta_e), state=None, lattice_warnings=[])
    _sessions[session_id] = session
    return _detect(session_id, session, crop=None if crop is None else tuple(crop))


@_out_of_memory_as_data
def redetect(session: int, crop=None, delta_e: float | None = None) -> dict:
    """Full detection again, on the whole image or on `crop` = (x0, y0, x1, y1) in image
    pixels. Resets rows, cols and extent to what is found; keeps the colour detail, or
    sets it to `delta_e` first."""
    s = _session(session)
    if isinstance(s, dict):
        return s
    if delta_e is not None:
        s.delta_e = float(delta_e)
    return _detect(int(session), s, crop=None if crop is None else tuple(crop))


@_out_of_memory_as_data
def set_params(session: int, rows: int | None = None, cols: int | None = None,
               delta_e: float | None = None, extent=None) -> dict:
    """Change the settings. Nothing is detected or resampled until `preview`. `extent` is
    a dict with x0, y0, x1, y1 in image pixels."""
    s = _session(session)
    if isinstance(s, dict):
        return s
    if delta_e is not None:
        s.delta_e = float(delta_e)
    if s.state is None:
        if rows is None and cols is None and extent is None:
            return {"ok": True}                      # colour detail waits for the next detect
        return _error("NO_DETECTION", "There is no detected grid to adjust.")
    if rows is not None or cols is not None:
        s.state.set_dims(rows=rows, cols=cols)
    if delta_e is not None:
        s.state.set_delta_e(s.delta_e)
    if extent is not None:
        w = s.to_work
        s.state.set_extent(Extent(w(float(extent["x0"])), w(float(extent["y0"])),
                                  w(float(extent["x1"])), w(float(extent["y1"]))))
    return {"ok": True}


@_out_of_memory_as_data
def preview(session: int) -> dict:
    """The current result: resampled if a setting changed, otherwise the cached one."""
    s = _session(session)
    if isinstance(s, dict):
        return s
    if s.state is None:
        return _error("NO_DETECTION", "There is no detected grid to preview.")
    return _preview_payload(int(session), s)


@_out_of_memory_as_data
def commit(session: int, name: str) -> dict:
    """The confirmed preview as a new Pattern (fresh id and row ids)."""
    s = _session(session)
    if isinstance(s, dict):
        return s
    if s.state is None:
        return _error("NO_DETECTION", "There is no detected grid to save.")
    p = pattern_from_preview(s.state.preview(), str(name))
    return {
        "ok": True,
        "pattern": {
            "id": p.id,
            "name": p.name,
            "created_at": float(p.created_at),
            "updated_at": float(p.updated_at),
            "cols": int(p.cols),
            "rows": int(p.rows),
            "row_ids": list(p.row_ids),
            "cells": np.ascontiguousarray(p.cells, dtype=np.uint16).ravel(),
            "palette": [{"id": e.id, "hex": e.hex, "name": e.name, "dmc": e.dmc,
                         "count": int(e.count)} for e in p.palette],
            "start_direction": p.start_direction,
            "alternate_direction": bool(p.alternate_direction),
            "bottom_up": bool(p.bottom_up),
        },
    }


def close_session(session: int) -> dict:
    """Forget a session and its image."""
    if _sessions.pop(int(session), None) is None:
        return _error("NO_SESSION", f"No detection session {session}.")
    return {"ok": True}


def session_count() -> int:
    """How many sessions are open (for tests and the worker's own checks)."""
    return len(_sessions)
