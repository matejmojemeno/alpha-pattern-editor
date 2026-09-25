"""What the desktop app makes of a file, as JSON: the reference web/e2e/ checks the
browser against (web/e2e/desktop.ts).

    python scripts/desktop_import.py detect <image> [correction ...]
    python scripts/desktop_import.py load <file.alpha>   # as the desktop opens a project

`detect` follows confirm_window.py: Pillow decodes to RGB, then detect_pattern →
ConfirmState.from_detection, then each correction in order, as the confirm screen's
controls make it, then preview → pattern_from_preview. A correction is one of:

    rows=N  cols=N            the spinboxes (_on_dims_changed → set_dims)
    de=X                      the colour-detail slider, as ΔE (_on_delta_e_changed)
    crop=x0,y0,x1,y1          a crop, in image pixels (_on_crop_requested → _run_detection)
    redetect                  the Re-detect button (_run_detection with no crop)

Detection always runs at the slider's current ΔE, as the desktop's does.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from alphareader.core import io  # noqa: E402
from alphareader.core.confirm import ConfirmState, Extent, pattern_from_preview  # noqa: E402
from alphareader.core.detect import detect_pattern  # noqa: E402
from alphareader.core.model import DetectionError  # noqa: E402

DEFAULT_DELTA_E = 6.0         # confirm_window.load_array sets the slider to 6


def _pattern(p) -> dict:
    return {
        "rows": p.rows,
        "cols": p.cols,
        "cells": p.cells.ravel().tolist(),
        "palette": [[e.hex, e.name, e.count] for e in p.palette],
    }


def _run_detection(img: np.ndarray, delta_e: float, crop=None) -> ConfirmState:
    """confirm_window._run_detection, without the widgets."""
    result = detect_pattern(img, delta_e_threshold=delta_e, crop=crop)
    state = ConfirmState.from_detection(img, result, delta_e=delta_e)
    if crop is not None:
        ox, oy = crop[0], crop[1]
        e = state.extent
        state.set_extent(Extent(e.x0 + ox, e.y0 + oy, e.x1 + ox, e.y1 + oy))
    return state


def detect(path: str, *corrections: str) -> dict:
    with Image.open(path) as im:
        img = np.array(im.convert("RGB"), dtype=np.uint8)
    delta_e = DEFAULT_DELTA_E
    try:
        state = _run_detection(img, delta_e)
        for c in corrections:
            op, _, arg = c.partition("=")
            if op == "rows":
                state.set_dims(rows=int(arg))
            elif op == "cols":
                state.set_dims(cols=int(arg))
            elif op == "de":
                delta_e = float(arg)
                state.set_delta_e(delta_e)
            elif op == "crop":
                x0, y0, x1, y1 = (int(v) for v in arg.split(","))
                state = _run_detection(img, delta_e, crop=(x0, y0, x1, y1))
            elif op == "redetect":
                state = _run_detection(img, delta_e)
            else:
                raise SystemExit(f"unknown correction {c!r}")
    except DetectionError as e:
        return {"ok": False, "code": e.code}
    return {"ok": True, **_pattern(pattern_from_preview(state.preview(), "x"))}


def load(path: str) -> dict:
    project = io.load_project(path)
    source = io.load_source_image(path)
    return {
        "name": project.pattern.name,
        "stage": project.stage,
        "completed": len(project.progress.completed_row_ids),
        "source": None if source is None else list(source.shape),
        **_pattern(project.pattern),
    }


if __name__ == "__main__":
    mode, path, *rest = sys.argv[1:]
    print(json.dumps({"detect": detect, "load": load}[mode](path, *rest)))
