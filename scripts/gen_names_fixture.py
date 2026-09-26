"""Write fixtures/colour_names.json: everyday colour names as the Python gives them, for
web/tests/importer/names.test.ts to reproduce.

    python scripts/gen_names_fixture.py

Detection names a palette in Python (core/detect/names.py); the import screen names it
again in TypeScript after a colour is removed (web/src/importer/names.ts). This records
the Python's nearest anchor and CIEDE2000 distance for 2,000 random colours and a grey
ramp, and its names for 600 random palettes of 1 to 40 colours, including palettes
built to share a name (shades of one colour, and near-greys).
alphareader/tests/test_names_fixture.py fails if this file is stale.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from alphareader.core.detect.names import (  # noqa: E402
    _anchors, _lab, ciede2000, nearest_anchor, simple_names)

OUT = ROOT / "fixtures" / "colour_names.json"


def _hex(c) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(int(v) for v in np.clip(c, 0, 255)))


def outputs() -> list[tuple[Path, str]]:
    rng = np.random.default_rng(20260927)
    colours = [_hex(c) for c in rng.integers(0, 256, size=(2000, 3))]
    colours += ["#{0:02x}{0:02x}{0:02x}".format(v) for v in range(0, 256, 5)]
    anchors, _ = _anchors()
    nearest = []
    for h in colours:
        i = nearest_anchor(_lab(h))
        nearest.append([i, ciede2000(_lab(h), anchors[i][2])])

    palettes = []
    for _ in range(300):
        n = int(rng.integers(1, 41))
        palettes.append([_hex(c) for c in rng.integers(0, 256, size=(n, 3))])
    for _ in range(200):
        # Shades of one colour: a base scaled darker and lighter.
        base = rng.integers(0, 256, size=3)
        n = int(rng.integers(2, 9))
        palettes.append([_hex(base * f + 255 * (1 - f) * (f > 1))
                         for f in rng.uniform(0.15, 1.6, size=n)])
    for _ in range(100):
        n = int(rng.integers(2, 9))
        palettes.append([_hex(np.full(3, v) + rng.integers(-6, 7, size=3))
                         for v in rng.integers(0, 256, size=n)])
    doc = {
        "about": "Nearest name anchor (index into colour_names.json's anchors, in order) "
                 "and CIEDE2000 distance per colour, and simple_names per palette "
                 "(scripts/gen_names_fixture.py).",
        "colours": colours,
        "nearest": nearest,
        "palettes": [{"hexes": p, "names": simple_names(p)} for p in palettes],
    }
    return [(OUT, json.dumps(doc, separators=(",", ":")) + "\n")]


def main() -> None:
    for path, text in outputs():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(text) // 1024} KB)")


if __name__ == "__main__":
    main()
