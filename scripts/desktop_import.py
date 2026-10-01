"""What the Python reference (alphareader/core/, driven as the removed desktop app drove
it) makes of a file, as JSON: the reference web/e2e/ checks the browser against
(web/e2e/desktop.ts). The desktop files named below (confirm_window.py, design_window.py)
are in git history; see docs/dev/architecture.md#desktop-app.

    python scripts/desktop_import.py detect <image> [correction ...]
    python scripts/desktop_import.py picture <image> [setting ...]   # the web's picture import
    python scripts/desktop_import.py pixels <image>                  # the web's pixel art
    python scripts/desktop_import.py load <file.alpha>   # as the desktop opens a project
    python scripts/desktop_import.py png <file.alpha> <exported.png>
                                            # whether the PNG is the desktop's Export PNG

`detect` follows confirm_window.py: Pillow decodes to RGB, then detect_pattern →
ConfirmState.from_detection, then each correction in order, as the confirm screen's
controls make it, then preview → pattern_from_preview. A correction is one of:

    rows=N  cols=N            the spinboxes (_on_dims_changed → set_dims)
    de=X                      the colour-detail slider, as ΔE (_on_delta_e_changed)
    crop=x0,y0,x1,y1          a crop, in image pixels (_on_crop_requested → _run_detection)
    redetect                  the Re-detect button (_run_detection with no crop)
    extent=x0,y0,x1,y1        the grid's outline moved, in image pixels (set_extent); the
                              web app only, which sends rows and cols with it
    remove=#rrggbb            a colour removed from the list (the web app only): after the
                              other corrections, in order, the entry nearest #rrggbb within
                              half the merge threshold is deleted as Design's Delete does
                              (edit.delete_palette_entry_nearest); none that near, skipped.
                              The colours left are then named again (detect/names.py),
                              as the web's importer/removals.ts does

Detection always runs at the slider's current ΔE, as the desktop's does.
"""
from __future__ import annotations

import dataclasses
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from alphareader.core import edit, io  # noqa: E402
from alphareader.core.confirm import ConfirmState, Extent, pattern_from_preview  # noqa: E402
from alphareader.core.detect import detect_pattern  # noqa: E402
from alphareader.core.detect.names import simple_names  # noqa: E402
from alphareader.core.detect.palette import DEFAULT_DELTA_E, hex_to_rgb, srgb_to_lab  # noqa: E402
from alphareader.core.model import DetectionError  # noqa: E402



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
    removals = []
    try:
        state = _run_detection(img, delta_e)
        for c in corrections:
            op, _, arg = c.partition("=")
            if op == "remove":
                removals.append(arg)
            elif op == "rows":
                state.set_dims(rows=int(arg))
            elif op == "cols":
                state.set_dims(cols=int(arg))
            elif op == "de":
                delta_e = float(arg)
                state.set_delta_e(delta_e)
            elif op == "crop":
                x0, y0, x1, y1 = (int(v) for v in arg.split(","))
                state = _run_detection(img, delta_e, crop=(x0, y0, x1, y1))
            elif op == "extent":
                x0, y0, x1, y1 = (float(v) for v in arg.split(","))
                state.set_extent(Extent(x0, y0, x1, y1))
            elif op == "redetect":
                state = _run_detection(img, delta_e)
            else:
                raise SystemExit(f"unknown correction {c!r}")
    except DetectionError as e:
        return {"ok": False, "code": e.code}
    p = pattern_from_preview(state.preview(), "x")
    before = len(p.palette)
    for hex_str in removals:
        p = _remove(p, hex_str, delta_e / 2)
    if len(p.palette) < before:
        names = simple_names([e.hex for e in p.palette])
        p = dataclasses.replace(p, palette=[dataclasses.replace(e, name=n) for e, n in zip(p.palette, names)])
    return {"ok": True, **_pattern(p)}


def _remove(p, hex_str: str, tolerance: float):
    """The entry nearest `hex_str`, if within `tolerance` (CIELAB ΔE) and not the last,
    deleted into its nearest neighbour."""
    if len(p.palette) <= 1:
        return p
    labs = srgb_to_lab(np.array([hex_to_rgb(e.hex) for e in p.palette], dtype=float))
    want = srgb_to_lab(np.array([hex_to_rgb(hex_str)], dtype=float))[0]
    d = np.linalg.norm(labs - want, axis=1)
    i = int(np.argmin(d))
    return edit.delete_palette_entry_nearest(p, p.palette[i].id) if d[i] <= tolerance else p


def picture(path: str, *settings: str) -> dict:
    """What the web app makes of `path` as a picture (the desktop app has no picture
    import; this is core/convert.py, as bridge.py runs it): kind.py's verdict, then the
    conversion with `settings` applied in order, each one of

        width=N  colours=N  detail=X  aspect=X   the picture's controls, and the stitch
        outlines=1                                "Keep outlines" on
        extent=x0,y0,x1,y1                        a crop, in image pixels (edges)

    A transparent background is white, as in bridge._on_white. Images over 4 MP aren't
    supported here (the browser shrinks them first)."""
    from alphareader.core.bridge import _on_white
    from alphareader.core.convert import PictureState, whole
    from alphareader.core.kind import read_image

    with Image.open(path) as im:
        rgba = np.array(im.convert("RGBA"), dtype=np.uint8)
    h, w = rgba.shape[:2]
    rgb = np.ascontiguousarray(rgba[:, :, :3])
    reading = read_image(rgb)
    flat = _on_white(rgba.tobytes(), w, h)
    img = rgb if flat is None else flat
    state = PictureState(img=img, extent=whole(img))
    for s in settings:
        op, _, arg = s.partition("=")
        if op == "width":
            state.set_width(int(arg))
        elif op == "colours":
            state.set_colours(int(arg))
        elif op == "detail":
            state.set_detail(float(arg))
        elif op == "aspect":
            state.set_cell_aspect(float(arg))
        elif op == "outlines":
            state.set_outlines(arg == "1")
        elif op == "extent":
            state.set_extent(Extent(*(float(v) for v in arg.split(","))))
        else:
            raise SystemExit(f"unknown setting {s!r}")
    p = pattern_from_preview(state.preview(), "x")
    return {"ok": True, "kind": reading.kind, **_pattern(p)}


def pixels(path: str) -> dict:
    """What the web app makes of `path` as pixel art (core/pixels.py, as bridge.py reads
    it: transparency flattened onto white): kind.py's verdict, and the pattern, a stitch
    per block."""
    from alphareader.core.bridge import _on_white
    from alphareader.core.kind import read_image
    from alphareader.core.pixels import pixel_preview

    with Image.open(path) as im:
        rgba = np.array(im.convert("RGBA"), dtype=np.uint8)
    h, w = rgba.shape[:2]
    rgb = np.ascontiguousarray(rgba[:, :, :3])
    reading = read_image(rgb, flat=_on_white(rgba.tobytes(), w, h))
    if reading.pixels is None:
        return {"ok": False, "kind": reading.kind}
    p = pattern_from_preview(pixel_preview(reading.pixels), "x")
    return {"ok": True, "kind": reading.kind, **_pattern(p)}


def load(path: str) -> dict:
    project = io.load_project(path)
    source = io.load_source_image(path)
    return {
        "name": project.pattern.name,
        "stage": project.stage,
        "completed": len(project.progress.completed_row_ids),
        "completed_row_ids": sorted(project.progress.completed_row_ids),
        "current_row_id": project.progress.current_row_id,
        "row_ids": list(project.pattern.row_ids),
        "source": None if source is None else list(source.shape),
        **_pattern(project.pattern),
    }


def png(path: str, exported: str) -> dict:
    """Export `path` as design_window.py's Export PNG… does, and compare the pixels with
    `exported`."""
    import tempfile
    project = io.load_project(path)
    with tempfile.TemporaryDirectory() as d:
        mine = str(Path(d) / "desktop.png")
        io.export_pattern_png(project.pattern, mine)
        with Image.open(mine) as a, Image.open(exported) as b:
            x = np.asarray(a.convert("RGB"))
            y = np.asarray(b.convert("RGB"))
    same = x.shape == y.shape and bool(np.array_equal(x, y))
    return {"same": same, "desktop": list(x.shape), "exported": list(y.shape)}


if __name__ == "__main__":
    mode, path, *rest = sys.argv[1:]
    print(json.dumps({"detect": detect, "picture": picture, "pixels": pixels, "load": load,
                      "png": png}[mode](path, *rest)))
