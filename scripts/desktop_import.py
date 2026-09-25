"""What the desktop app makes of a file, as JSON: the reference web/e2e/import.spec.ts
checks the browser against.

    python scripts/desktop_import.py detect <image>   # as the desktop's import window
    python scripts/desktop_import.py load <file.alpha>  # as the desktop opens a project

`detect` follows confirm_window.py: Pillow decodes to RGB, then detect_pattern →
ConfirmState.from_detection → preview → pattern_from_preview.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from alphareader.core import io  # noqa: E402
from alphareader.core.confirm import ConfirmState, pattern_from_preview  # noqa: E402
from alphareader.core.detect import detect_pattern  # noqa: E402
from alphareader.core.model import DetectionError  # noqa: E402


def _pattern(p) -> dict:
    return {
        "rows": p.rows,
        "cols": p.cols,
        "cells": p.cells.ravel().tolist(),
        "palette": [[e.hex, e.name, e.count] for e in p.palette],
    }


def detect(path: str) -> dict:
    with Image.open(path) as im:
        img = np.array(im.convert("RGB"), dtype=np.uint8)
    try:
        result = detect_pattern(img)
    except DetectionError as e:
        return {"ok": False, "code": e.code}
    preview = ConfirmState.from_detection(img, result).preview()
    return {"ok": True, **_pattern(pattern_from_preview(preview, "x"))}


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
    mode, path = sys.argv[1], sys.argv[2]
    print(json.dumps({"detect": detect, "load": load}[mode](path)))
