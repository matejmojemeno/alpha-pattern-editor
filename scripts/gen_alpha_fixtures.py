"""Write reference `.alpha` files with the desktop's own io.save_project.

The web app's storage layer (web/src/storage/) reads and writes `.alpha` archives in
TypeScript. These files are what "a file the desktop app wrote" means in its tests:
they come from the real save_project, and `expected.json` records what the real
load_project reads back from each one. The TS suite must read every file the same way.

    python scripts/gen_alpha_fixtures.py            # rewrite fixtures/alpha/desktop/
    python scripts/gen_alpha_fixtures.py --check    # exit 1 if the committed files are stale

Some files are edited after saving to look like older or newer desktop builds (no
current_run_stitches, no direction fields, format_version 999). `expected.json` marks
those as not `pristine`: only pristine files are byte-for-byte what save_project writes.

Zip entries carry timestamps, so --check compares archive *contents*, not bytes.
alphareader/tests/test_alpha_compat.py runs the check. The reverse direction, files the
TS layer writes, lives in fixtures/alpha/from-ts/ (see fixtures/alpha/README.md).
"""
from __future__ import annotations

import argparse
import hashlib
import io as _io
import json
import os
import sys
import tempfile
import zipfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from alphareader.core import io  # noqa: E402
from alphareader.core.model import (  # noqa: E402
    SKIP_INDEX, PaletteEntry, Pattern, Progress, Project,
)

OUT = os.path.join(ROOT, "fixtures", "alpha", "desktop")
# Fractional stamps, so float formatting is exercised on both sides.
CREATED = 1_758_600_000.125
SAVED = 1_758_700_000.123456

COLOURS = [
    ("#ffffff", "White", "B5200"), ("#6b3e26", "Brown", "433"), ("#d93a3a", "Red", "321"),
    ("#2f5fb0", "Blue", None), ("#f2c230", "Yellow", "725"),
]


def _ids(tag: str, n: int) -> list[str]:
    """Stable stand-ins for uuid4().hex, which is what the desktop mints."""
    return [hashlib.md5(f"{tag}/{i}".encode()).hexdigest() for i in range(n)]


def _palette(n: int, names: list[str] | None = None) -> list[PaletteEntry]:
    out = []
    for i in range(n):
        hex_, name, dmc = COLOURS[i % len(COLOURS)]
        out.append(PaletteEntry(id=f"c{i}", hex=hex_, name=names[i] if names else name,
                                dmc=dmc, count=0))
    return out


def _pattern(tag: str, cells, n_colours: int, *, name: str | None = None,
             names: list[str] | None = None, **flags) -> Pattern:
    cells = np.asarray(cells, dtype=np.uint16)
    rows, cols = cells.shape
    palette = _palette(n_colours, names)
    for i, e in enumerate(palette):
        e.count = int((cells == i).sum())
    return Pattern(id=hashlib.md5(tag.encode()).hexdigest(), name=name or tag,
                   created_at=CREATED, updated_at=0.0, cols=cols, rows=rows,
                   row_ids=_ids(tag, rows), cells=cells, palette=palette, **flags)


def _source_image() -> np.ndarray:
    y, x = np.mgrid[0:18, 0:24]
    return np.stack([x * 10, y * 14, (x + y) * 6], axis=-1).astype(np.uint8)


def _rewrite(path: str, edit) -> None:
    """Re-zip `path` after `edit(name, data) -> data | None` (None drops the entry)."""
    with zipfile.ZipFile(path) as z:
        entries = [(n, z.read(n)) for n in z.namelist()]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in entries:
            data = edit(n, data)
            if data is not None:
                z.writestr(n, data)


def _edit_json(name: str, fn):
    def edit(n, data):
        if n != name:
            return data
        d = json.loads(data)
        fn(d)
        return json.dumps(d)
    return edit


def build(out: str) -> dict:
    rng = np.random.default_rng(20260924)
    files: dict[str, dict] = {}

    def save(fname: str, pattern: Pattern, progress: Progress = None, stage="design",
             source=None, post=None):
        path = os.path.join(out, fname)
        io.save_project(Project(pattern=pattern, progress=progress or Progress(), stage=stage),
                        path, source_img=source, now=SAVED)
        if post is not None:
            _rewrite(path, post)
        files[fname] = {"pristine": post is None}

    # Straight out of save_project with dataclass defaults.
    save("basic.alpha", _pattern("basic", rng.integers(0, 3, size=(5, 7)), 3))

    # An embedded source image, and a project in the Work stage.
    p = _pattern("with-source", rng.integers(0, 4, size=(6, 8)), 4)
    save("with-source.alpha", p,
         Progress(completed_row_ids={p.row_ids[-1], p.row_ids[-2]},
                  current_row_id=p.row_ids[-3], current_run_index=1,
                  current_run_stitches=0, started_at=1_758_650_000.5),
         stage="work", source=_source_image())

    # Progress partway through a row: two segments done, 2 stitches into the third.
    p = _pattern("partial-row", [[0, 0, 1, 1, 1, 2, 2, 2, 2, 0]] * 4
                 + rng.integers(0, 3, size=(4, 10)).tolist(), 3,
                 start_direction="LTR", alternate_direction=False, bottom_up=False)
    save("partial-row.alpha", p,
         Progress(completed_row_ids=set(p.row_ids[:3]), current_row_id=p.row_ids[3],
                  current_run_index=2, current_run_stitches=2, started_at=1_758_650_000.0),
         stage="work")

    # SKIP_INDEX (0xFFFF) cells, the highest value a uint16 holds.
    cells = rng.integers(0, 2, size=(4, 6))
    cells[0, :2] = SKIP_INDEX
    cells[2, 3:] = SKIP_INDEX
    save("skip-cells.alpha", _pattern("skip-cells", cells, 2), stage="work")

    # progress.json from before current_run_stitches existed.
    p = _pattern("old-progress", rng.integers(0, 3, size=(4, 5)), 3)
    save("old-progress.alpha", p,
         Progress(completed_row_ids={p.row_ids[-1]}, current_row_id=p.row_ids[-2],
                  current_run_index=1, started_at=1_758_650_000.0),
         stage="work",
         post=_edit_json("progress.json", lambda d: d.pop("current_run_stitches")))

    # pattern.json and meta.json from before direction settings and stage existed, with
    # palette entries that only have the required fields. start_direction must read as
    # "LTR" (not the dataclass's "RTL"), so old projects are not mirrored.
    def legacy(n, data):
        if n == "meta.json":
            return json.dumps({"format_version": 1})
        if n == "pattern.json":
            d = json.loads(data)
            for k in ("start_direction", "alternate_direction", "bottom_up"):
                d.pop(k)
            d["palette"] = [{"id": e["id"], "hex": e["hex"], "name": e["name"]}
                            for e in d["palette"]]
            return json.dumps(d)
        return data
    save("legacy-pattern.alpha",
         _pattern("legacy-pattern", rng.integers(0, 2, size=(3, 4)), 2,
                  start_direction="RTL", alternate_direction=False, bottom_up=False),
         post=legacy)

    # Non-ASCII text everywhere json.dumps escapes it (ensure_ascii), including an
    # astral-plane character and control characters.
    save("unicode.alpha",
         _pattern("unicode", rng.integers(0, 3, size=(3, 3)), 3,
                  name='Žlutý kůň 🐴 "quoted"\ttab\\slash',
                  names=["Béžová", "", "日本"]))

    # Large enough that the .npy shape has 3-digit dimensions.
    save("large.alpha", _pattern("large", rng.integers(0, 40, size=(120, 150)), 5))

    # A newer desktop build's file: both sides must refuse it.
    save("newer-format.alpha", _pattern("newer-format", [[0, 1]], 2),
         post=_edit_json("meta.json", lambda d: d.update(format_version=999)))

    for fname, rec in files.items():
        rec.update(_expected(os.path.join(out, fname)))
    return files


def _expected(path: str) -> dict:
    """What the desktop reads back from `path`."""
    try:
        proj = io.load_project(path)
    except ValueError as e:
        return {"rejected": str(e)}
    p, pr = proj.pattern, proj.progress
    with zipfile.ZipFile(path) as z:
        src = z.read("source.png") if "source.png" in z.namelist() else None
    return {
        "stage": proj.stage,
        "pattern": {
            "id": p.id, "name": p.name, "created_at": p.created_at, "updated_at": p.updated_at,
            "rows": p.rows, "cols": p.cols, "row_ids": list(p.row_ids),
            "cells": p.cells.astype(int).tolist(),
            "palette": [{"id": e.id, "hex": e.hex, "name": e.name, "dmc": e.dmc,
                         "count": e.count} for e in p.palette],
            "start_direction": p.start_direction,
            "alternate_direction": p.alternate_direction, "bottom_up": p.bottom_up,
        },
        "progress": {
            "completed_row_ids": sorted(pr.completed_row_ids),
            "current_row_id": pr.current_row_id,
            "current_run_index": pr.current_run_index,
            "current_run_stitches": pr.current_run_stitches,
            "started_at": pr.started_at,
        },
        "source_png_sha256": hashlib.sha256(src).hexdigest() if src else None,
    }


def render(expected: dict) -> str:
    return json.dumps({"files": expected}, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def _contents(path: str) -> dict:
    """An archive's contents, independent of zip timestamps and PNG encoder details."""
    from PIL import Image
    out = {}
    with zipfile.ZipFile(path) as z:
        for n in sorted(z.namelist()):
            data = z.read(n)
            if n.endswith(".json"):
                out[n] = json.loads(data)
            elif n == "source.png":
                out[n] = np.asarray(Image.open(_io.BytesIO(data)).convert("RGB")).tolist()
            else:
                out[n] = data
    return out


def check() -> list[str]:
    problems = []
    with tempfile.TemporaryDirectory() as tmp:
        text = render(build(tmp))
        try:
            committed = open(os.path.join(OUT, "expected.json"), encoding="utf-8").read()
        except FileNotFoundError:
            return [f"{OUT}/expected.json missing"]
        if committed != text:
            problems.append("expected.json")
        for fname in sorted(os.listdir(tmp)):
            have = os.path.join(OUT, fname)
            if not os.path.exists(have) or _contents(have) != _contents(os.path.join(tmp, fname)):
                problems.append(fname)
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed files do not match what io.py writes")
    args = ap.parse_args()
    if args.check:
        stale = check()
        if stale:
            print(f"stale in {OUT}: {', '.join(stale)}; run scripts/gen_alpha_fixtures.py")
            return 1
        print("alpha fixtures up to date")
        return 0
    os.makedirs(OUT, exist_ok=True)
    for fname in os.listdir(OUT):
        if fname.endswith(".alpha"):
            os.remove(os.path.join(OUT, fname))
    expected = build(OUT)
    with open(os.path.join(OUT, "expected.json"), "w", encoding="utf-8") as fh:
        fh.write(render(expected))
    print(f"wrote {len(expected)} archives to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
