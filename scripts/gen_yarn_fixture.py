"""Write fixtures/yarn_nearest.json: the nearest shade of each colour library, as the
Python finds it, for web/tests/yarn/match.test.ts to reproduce.

    python scripts/gen_yarn_fixture.py

The web app matches palette colours against the libraries in web/src/yarn/data/ in
TypeScript. This records what detection's own matching (palette.srgb_to_lab, then the
argmin of np.linalg.norm over the table, as `_nearest_dmc` does) makes of the same tables:
1,000 random colours from a fixed seed, plus every shade's own hex and a grey ramp. Also
the Lab of each colour, so the conversion itself is compared, not just the winners.
alphareader/tests/test_yarn_fixture.py fails if this file is stale.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from alphareader.core.detect.palette import hex_to_rgb, srgb_to_lab  # noqa: E402

DATA = ROOT / "web" / "src" / "yarn" / "data"
OUT = ROOT / "fixtures" / "yarn_nearest.json"
LIBRARIES = ["dmc", "stylecraft-special-dk", "paintbox-simply-dk", "scheepjes-colour-crafter"]
RANDOM = 1000


def colours(tables: dict[str, list[str]]) -> list[str]:
    rng = np.random.default_rng(20260926)
    rgb = rng.integers(0, 256, size=(RANDOM, 3))
    out = ["#{:02x}{:02x}{:02x}".format(*c) for c in rgb]
    out += ["#{0:02x}{0:02x}{0:02x}".format(v) for v in range(0, 256, 15)]
    for lib in LIBRARIES:
        out += tables[lib]
    return out


def outputs() -> list[tuple[Path, str]]:
    tables = {lib: [s["hex"] for s in json.loads((DATA / f"{lib}.json").read_text())["shades"]]
              for lib in LIBRARIES}
    hexes = colours(tables)
    lab = srgb_to_lab(np.array([hex_to_rgb(h) for h in hexes], dtype=np.float64))
    nearest = {}
    for lib in LIBRARIES:
        table = srgb_to_lab(np.array([hex_to_rgb(h) for h in tables[lib]], dtype=np.float64))
        nearest[lib] = [int(np.argmin(np.linalg.norm(table - c, axis=1))) for c in lab]
    doc = {
        "about": "Nearest shade per library, by detection's Lab conversion and argmin of "
                 "the Euclidean distance (scripts/gen_yarn_fixture.py).",
        "shades": {lib: len(tables[lib]) for lib in LIBRARIES},
        "colours": hexes,
        "lab": [[float(v) for v in c] for c in lab],
        "nearest": nearest,
    }
    return [(OUT, json.dumps(doc, separators=(",", ":")) + "\n")]


def main() -> None:
    for path, text in outputs():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(text) // 1024} KB)")


if __name__ == "__main__":
    main()
