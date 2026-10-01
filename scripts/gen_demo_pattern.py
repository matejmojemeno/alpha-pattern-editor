"""Write fixtures/demo/demo.alpha: the demo pattern the docs' screenshots and tour use.

    python scripts/gen_demo_pattern.py           # rewrite
    python scripts/gen_demo_pattern.py --check   # exit 1 if the file on disk differs

A toadstool, drawn for this repo (see fixtures/demo/README.md): 30 x 30 stitches, five
colours, framed by a one-stitch red border. The drawing is below, one character per
stitch, top row first as the chart shows it. Ids and timestamps are fixed, so the file
is the same on every run.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from alphareader.core import io  # noqa: E402
from alphareader.core.detect.names import simple_names  # noqa: E402
from alphareader.core.model import PaletteEntry, Pattern, Project  # noqa: E402

OUT = ROOT / "fixtures/demo/demo.alpha"

# One character per stitch: . sky, R red, W white, T tan, G green.
COLOURS = {".": "#bcdcef", "R": "#c8312f", "W": "#fbf7ee", "T": "#d6a878", "G": "#4f9a3a"}

INNER = [
    "............................",
    "............................",
    "............................",
    "...........RRRRRR...........",
    "........RRRRRRRRRRRR........",
    "......RRRWWRRRRRRRRRRR......",
    ".....RRRWWWWRRRRRRWWRRR.....",
    "....RRRRWWWWRRRRRRWWRRRR....",
    "...RRRRRWWRRRRRRRRRRRRRRR...",
    "..RRWWRRRRRRRRRRRRRWWWRRRR..",
    "..RWWWWRRRRRRRRRRRWWWWWRRR..",
    ".RRWWWWRRRRRWWRRRRRWWWRRRRR.",
    ".RRRWWRRRRRWWWWRRRRRRRRRRRR.",
    ".RRRRRRRRRRWWWWRRRRRRRRWWRR.",
    ".RRRRRRRRRRRWWRRRRRRRRWWWWR.",
    ".RRRRRRRRRRRRRRRRRRRRRRWWRR.",
    "..TTTTTTTTTTTTTTTTTTTTTTTT..",
    ".........WWWWWWWWTT.........",
    ".........WWWWWWWWTT.........",
    ".........WWWWWWWWTT.........",
    ".........WWWWWWWWTT.........",
    ".........WWWWWWWWTT.........",
    "........WWWWWWWWWWTT........",
    ".......GWWWWWWWWWWTTG.......",
    "GG.G.GGGWWWWWWWWWWTTGGG.G.GG",
    "GGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    "GGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    "GGGGGGGGGGGGGGGGGGGGGGGGGGGG",
]


def drawing() -> list[str]:
    """The whole chart: the inner drawing inside a one-stitch red border."""
    width = len(INNER[0])
    assert all(len(row) == width for row in INNER), "every row must be the same width"
    edge = "R" * (width + 2)
    return [edge, *("R" + row + "R" for row in INNER), edge]


def project() -> Project:
    rows = drawing()
    order = list(COLOURS)  # palette order: sky first, the background
    cells = np.array([[order.index(ch) for ch in row] for row in rows], dtype=np.uint16)
    hexes = [COLOURS[k] for k in order]
    palette = [
        PaletteEntry(id=f"{i + 1:032x}", hex=h, name=n, count=int((cells == i).sum()))
        for i, (h, n) in enumerate(zip(hexes, simple_names(hexes)))
    ]
    pattern = Pattern(
        id="d0000000000000000000000000000001",
        name="Toadstool",
        created_at=1_790_000_000.0,
        updated_at=1_790_000_000.0,
        cols=cells.shape[1],
        rows=cells.shape[0],
        row_ids=[f"d1{r:030x}" for r in range(cells.shape[0])],
        cells=cells,
        palette=palette,
    )
    return Project(pattern=pattern)


def _entries(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in sorted(z.namelist())}


def main() -> int:
    check = "--check" in sys.argv[1:]
    target = OUT.with_suffix(".tmp") if check else OUT
    io.save_project(project(), str(target), now=1_790_000_000.0)
    if not check:
        print(f"wrote {OUT.relative_to(ROOT)}")
        return 0
    same = OUT.exists() and _entries(OUT) == _entries(target)
    target.unlink()
    print("up to date" if same else f"{OUT.relative_to(ROOT)} is stale: run scripts/gen_demo_pattern.py")
    return 0 if same else 1


if __name__ == "__main__":
    sys.exit(main())
