"""Detection digest for one or more raw-RGB .npy files.

Deliberately runs unchanged under desktop CPython and under Pyodide: the only input is
a uint8 (H, W, 3) array, so image *decoding* — and therefore Pillow's version — stays
out of the comparison. That also mirrors the real web architecture, where the browser
decodes the image and hands Python an array.

Usage:  python digest.py a.npy b.npy ...   ->  one JSON object on stdout
"""
from __future__ import annotations

import hashlib
import json
import sys
import time

import numpy as np

from alphareader.core.detect import detect_pattern
from alphareader.core.model import DetectionError


def digest(path: str) -> dict:
    img = np.load(path)
    name = path.replace("\\", "/").split("/")[-1]
    t0 = time.perf_counter()
    try:
        r = detect_pattern(img)
    except DetectionError as e:
        return {"file": name, "ok": False, "code": e.code,
                "ms": round((time.perf_counter() - t0) * 1000, 1)}
    ms = round((time.perf_counter() - t0) * 1000, 1)
    return {
        "file": name,
        "ok": True,
        "rows": int(r.rows),
        "cols": int(r.cols),
        "cells_sha": hashlib.sha256(r.cells.astype(np.uint16).tobytes()).hexdigest(),
        "palette": [e.hex for e in r.palette],
        "warnings": sorted(r.warnings),
        # Lattice floats and the confidence mean are where a differing numpy build would
        # show up first, well before the quantised cell indices moved.
        "pitch_x": round(float(r.lattice.pitch_x), 9),
        "pitch_y": round(float(r.lattice.pitch_y), 9),
        "x0": round(float(r.lattice.x0), 9),
        "y0": round(float(r.lattice.y0), 9),
        "conf_mean": round(float(r.confidence.mean()), 9),
        "ms": ms,
    }


def main(paths: list[str]) -> dict:
    return {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "results": [digest(p) for p in paths],
    }


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1:])))
