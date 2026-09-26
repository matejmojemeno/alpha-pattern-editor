"""Generate the golden corpora the TypeScript ports of readout.py, work.py and edit.py
must match.

The web port reimplements row readout and progress tracking in TypeScript, so the
Work stage can run without Pyodide. That leaves two implementations of the subtlest
logic in the app: direction alternation, bottom-up numbering, run-length encoding and
the progress cursor. The Python stays the spec. This script records what it does over
a set of deliberately awkward patterns and operation sequences, and the TS test suite
replays the file and must reproduce every value.

The Design stage's port gets the same for edit.py (fixtures/edit_golden.json): every
public function over small patterns chosen for their edge cases, the ValueError paths
included.

    python scripts/gen_fixtures.py            # rewrite both fixture files
    python scripts/gen_fixtures.py --check    # exit 1 if a committed file is stale

alphareader/tests/test_golden_fixtures.py runs the --check comparison, so changing
readout.py, work.py or edit.py without regenerating fails the Python suite, before the
drift can reach the TS side. Schema: fixtures/README.md.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import types

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from alphareader.core import edit, readout, work  # noqa: E402
from alphareader.core.model import SKIP_INDEX, PaletteEntry, Pattern, Progress  # noqa: E402

OUT = os.path.join(ROOT, "fixtures", "logic_golden.json")
EDIT_OUT = os.path.join(ROOT, "fixtures", "edit_golden.json")
FORMAT = 1
EDIT_FORMAT = 1
# An id an edit made up (uuid4) rather than kept. It can't be recorded literally, so it
# is recorded as this marker, and the TS replay checks that it is fresh and unique.
NEW_ID = "new"
# work.ensure_started stamps time.time() into Progress.started_at. A fixed clock keeps
# the output reproducible; the TS side should treat started_at as "was it set" plus
# "was it preserved", not compare it to a wall clock.
CLOCK = 1_700_000_000.0

PALETTE = [
    ("#ffffff", "White"), ("#6b3e26", "Brown"), ("#d93a3a", "Red"),
    ("#2f5fb0", "Blue"), ("#f2c230", "Yellow"),
]


def _palette(n: int, *, blank_name: bool = False) -> list[PaletteEntry]:
    out = []
    for i in range(n):
        hex_, name = PALETTE[i % len(PALETTE)]
        out.append(PaletteEntry(id=f"pal{i}", hex=hex_, name="" if blank_name and i == 1
                                else name, dmc=None, count=0))
    return out


def _pattern(name: str, cells, n_colours: int, *, start: str = "RTL",
             alternate: bool = True, bottom_up: bool = True,
             blank_name: bool = False) -> Pattern:
    cells = np.asarray(cells, dtype=np.uint16)
    rows, cols = cells.shape
    return Pattern(id=f"pat-{name}", name=name, created_at=0.0, updated_at=0.0,
                   cols=cols, rows=rows, row_ids=[f"r{i}" for i in range(rows)],
                   cells=cells, palette=_palette(n_colours, blank_name=blank_name),
                   start_direction=start, alternate_direction=alternate,
                   bottom_up=bottom_up)


def patterns() -> list[Pattern]:
    rng = np.random.default_rng(20260924)
    base = rng.integers(0, 3, size=(5, 7))
    out = []
    # Every direction/numbering combination on the same grid, so a TS bug in one axis of
    # the logic cannot hide behind another.
    for bottom_up in (True, False):
        for start in ("LTR", "RTL"):
            for alternate in (True, False):
                tag = f"{'bu' if bottom_up else 'td'}-{start.lower()}-{'alt' if alternate else 'same'}"
                out.append(_pattern(f"grid-{tag}", base, 3, start=start,
                                    alternate=alternate, bottom_up=bottom_up))
    # Even row count, so the alternation parity differs from the 5-row grid above.
    out.append(_pattern("even-rows", rng.integers(0, 4, size=(6, 5)), 4))
    out.append(_pattern("single-cell", [[0]], 1))
    out.append(_pattern("single-column", [[0], [1], [1], [0]], 2))
    out.append(_pattern("single-row", [[0, 0, 1, 1, 1, 2]], 3))
    # A solid row has exactly one run, which is where advance() completes a row at once.
    out.append(_pattern("solid-rows", [[0, 0, 0, 0], [1, 1, 1, 1], [0, 1, 0, 1]], 2))
    # Readout labels: SKIP_INDEX reads "skip", an index past the palette reads "#N", and a
    # blank colour name gives the compact initial "?".
    out.append(_pattern("labels", [[0, SKIP_INDEX, SKIP_INDEX, 1], [7, 7, 0, 1]], 2,
                        blank_name=True))
    out.append(_pattern("wide", rng.integers(0, 5, size=(4, 23)), 5))
    return out


def _progress(pr: Progress) -> dict:
    return {
        "completed_row_ids": sorted(pr.completed_row_ids),
        "current_row_id": pr.current_row_id,
        "current_run_index": pr.current_run_index,
        "current_run_stitches": pr.current_run_stitches,
        "started_at": pr.started_at,
    }


def _run(p: Pattern, name: str, initial: Progress, ops: list[tuple]) -> dict:
    pr = initial
    steps = []
    for op, *args in ops:
        pr = getattr(work, op)(p, pr, *args)
        steps.append({
            "op": op,
            "args": list(args),
            "progress": _progress(pr),
            "remaining_stitches": work.remaining_stitches(p, pr),
            "completed_count": work.completed_count(p, pr),
            "is_complete": work.is_complete(p, pr),
            "first_incomplete_row": work.first_incomplete_row(p, pr),
        })
    return {"name": name, "initial": _progress(initial), "steps": steps}


def scenarios(p: Pattern, seed: int) -> list[dict]:
    total_runs = sum(work.num_runs(p, r) for r in range(p.rows))
    out = [
        _run(p, "complete-every-row", Progress(),
             [("complete_current_row",)] * (p.rows + 2)),
        _run(p, "advance-through", Progress(), [("advance",)] * (total_runs + 2)),
        _run(p, "retreat-from-start", Progress(), [("retreat",)] * 3),
        _run(p, "back-and-forth", Progress(),
             [("complete_current_row",)] * 2 + [("go_previous_row",)] * 3
             + [("advance",), ("retreat",), ("retreat",)]),
        # A saved project whose current row was deleted in Design: the cursor must re-seat.
        _run(p, "stale-cursor",
             Progress(completed_row_ids={p.row_ids[-1]}, current_row_id="deleted-row",
                      current_run_index=5, current_run_stitches=2, started_at=123.0),
             [("ensure_started",), ("advance",)]),
    ]
    # Partial progress inside a segment is the state remaining_stitches finds hardest:
    # it must subtract the finished segments *and* the partial count of the active one.
    # Random scripts rarely land there, so walk it explicitly on the first worked row.
    first = work.work_sequence(p)[0]
    runs = readout.encode_row(p, first)
    partial = [("set_run_stitches", i, max(1, run.count // 2)) for i, run in enumerate(runs)]
    partial += [("set_run_stitches", 0, 0), ("retreat",), ("advance",),
                ("set_run_index", len(runs) - 1),
                ("set_run_stitches", len(runs) - 1, runs[-1].count)]
    out.append(_run(p, "partial-stitches", Progress(), partial))

    rng = np.random.default_rng(seed)
    ops = ["advance", "retreat", "complete_current_row", "go_previous_row",
           "set_run_index", "mark_segment_complete", "set_run_stitches", "ensure_started"]
    for k in range(2):
        script = []
        for _ in range(20):
            op = ops[int(rng.integers(len(ops)))]
            # Indices deliberately run out of range in both directions: the Python clamps,
            # and the TS must clamp identically rather than throw or wrap.
            if op in ("set_run_index", "mark_segment_complete"):
                script.append((op, int(rng.integers(-2, p.cols + 2))))
            elif op == "set_run_stitches":
                script.append((op, int(rng.integers(-2, p.cols + 2)),
                               int(rng.integers(-3, p.cols + 3))))
            else:
                script.append((op,))
        out.append(_run(p, f"random-{k}", Progress(), script))
    return out


def readout_record(p: Pattern) -> dict:
    return {
        "rows": [{
            "row": r,
            "working_position": readout.working_position(p, r),
            "working_number": readout.working_number(p, r),
            "row_direction": readout.row_direction(p, r),
            "runs": [{"palette_index": run.palette_index, "count": run.count,
                      "start_col": run.start_col} for run in readout.encode_row(p, r)],
            "text": readout.format_row_text(p, r),
            "compact": readout.format_row_compact(p, r),
        } for r in range(p.rows)],
        "export_all_rows_text": readout.export_all_rows_text(p),
        "format_stats": readout.format_stats(p.cols, p.rows, len(p.palette)),
    }


def pattern_record(p: Pattern) -> dict:
    return {
        "id": p.id, "name": p.name, "rows": p.rows, "cols": p.cols,
        "row_ids": list(p.row_ids),
        "cells": p.cells.astype(int).tolist(),
        "palette": [{"id": e.id, "hex": e.hex, "name": e.name, "dmc": e.dmc,
                     "count": e.count} for e in p.palette],
        "start_direction": p.start_direction,
        "alternate_direction": p.alternate_direction,
        "bottom_up": p.bottom_up,
    }


def build() -> dict:
    real_time = work.time
    work.time = types.SimpleNamespace(time=lambda: CLOCK)
    try:
        cases = []
        for i, p in enumerate(patterns()):
            cases.append({
                "pattern": pattern_record(p),
                "readout": readout_record(p),
                "work": {
                    "work_sequence": work.work_sequence(p),
                    "num_runs": [work.num_runs(p, r) for r in range(p.rows)],
                    "scenarios": scenarios(p, seed=1000 + i),
                },
            })
    finally:
        work.time = real_time
    return {"format": FORMAT, "clock": CLOCK, "skip_index": SKIP_INDEX, "cases": cases}


# --- edit.py ---------------------------------------------------------------------------

def edit_patterns() -> dict[str, Pattern]:
    """Small inputs, each there for an edge case the operations must get right."""
    rng = np.random.default_rng(20260926)
    out = {
        # A coloured frame around mixed artwork, with a notch in the bottom row.
        "framed": _pattern("framed", [
            [2, 2, 2, 2, 2],
            [2, 0, 1, 0, 2],
            [2, 1, 1, 3, 2],
            [2, 0, 3, 0, 2],
            [2, 2, 2, 2, 2],
            [2, 2, 1, 2, 2],
        ], 4),
        "random": _pattern("random", rng.integers(0, 5, size=(7, 9)), 5),
        "single-cell": _pattern("single-cell", [[0]], 1),
        "single-row": _pattern("single-row", [[0, 1, 1, 0, 2]], 3),
        "single-column": _pattern("single-column", [[1], [1], [0], [2]], 3),
        # Uniform edges, a different colour on each side, for trim_uniform_edges.
        "margins": _pattern("margins", [
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [1, 2, 3, 2, 0, 4],
            [1, 3, 2, 3, 0, 4],
            [4, 4, 4, 4, 4, 4],
        ], 5),
        "uniform": _pattern("uniform", np.full((3, 4), 1), 2),
        # Two colours tie around the border: major_border_index takes the lower index.
        "border-tie": _pattern("border-tie", [[0, 1, 0], [1, 2, 1], [0, 1, 1], [0, 0, 1]], 3),
        # SKIP_INDEX and indices past the palette (3, just past it, and 7): counts ignore
        # them, and deleting or merging an entry leaves them exactly as they are.
        "odd-indices": _pattern("odd-indices", [[0, SKIP_INDEX, 1, 3], [7, 2, 0, 1]], 3),
        # Regions that touch only at corners: fill must stay 4-connected.
        "fill-maze": _pattern("fill-maze", [
            [0, 0, 1, 0, 0],
            [0, 1, 0, 0, 1],
            [1, 0, 0, 1, 0],
            [0, 0, 1, 0, 0],
        ], 2),
    }
    # For nearest_entry_id: colours with clear Lab distances, and an exact tie (the same
    # hex twice), where the first entry wins as np.argmin picks it.
    near = _pattern("nearest", [[0, 1, 2, 3], [4, 5, 0, 1]], 6)
    for e, h in zip(near.palette, ["#ffffff", "#f4f0e8", "#1a1a1a", "#d93a3a", "#c83030",
                                   "#c83030"]):
        e.hex = h
    out["nearest"] = near
    for p in out.values():
        edit._recount(p.palette, p.cells)
    return out


def edit_pattern_record(p: Pattern, before: Pattern | None = None) -> dict:
    """pattern_record plus created_at, with ids the edit made up replaced by NEW_ID.
    updated_at is left out: every edit stamps time.time() into it."""
    rec = pattern_record(p)
    rec["created_at"] = p.created_at
    if before is not None:
        old_rows = set(before.row_ids)
        old_pal = {e.id for e in before.palette}
        fresh = [i for i in p.row_ids if i not in old_rows] + \
                [e.id for e in p.palette if e.id not in old_pal]
        assert len(set(fresh)) == len(fresh), "made-up ids must be unique"
        rec["row_ids"] = [i if i in old_rows else NEW_ID for i in rec["row_ids"]]
        for e in rec["palette"]:
            if e["id"] not in old_pal:
                e["id"] = NEW_ID
    return rec


def edit_calls() -> list[tuple[str, str, list, dict]]:
    """(input pattern, function, args, kwargs) for every call recorded. Row and column
    indices are always in range: edit.py doesn't clamp them (numpy wraps negative ones
    and raises IndexError past the end), and the Design stage never passes others."""
    calls: list[tuple[str, str, list, dict]] = []

    def add(name: str, fn: str, *args, **kwargs) -> None:
        calls.append((name, fn, list(args), kwargs))

    for name in ("framed", "random", "odd-indices"):
        add(name, "set_cell", 0, 0, 1)
    add("single-cell", "set_cell", 0, 0, 0)            # already that colour
    add("framed", "set_cell", 2, 3, 2)
    add("framed", "set_cell", 5, 4, 5)                 # an index past the palette

    add("fill-maze", "flood_fill", 0, 0, 1)
    add("fill-maze", "flood_fill", 1, 2, 1)
    add("fill-maze", "flood_fill", 0, 3, 0)            # already this colour
    add("fill-maze", "flood_fill", 3, 4, 1)
    add("framed", "flood_fill", 0, 0, 3)               # the frame, around the art
    add("uniform", "flood_fill", 1, 2, 0)
    add("odd-indices", "flood_fill", 0, 1, 2)          # a SKIP cell

    add("framed", "fill_rect", 1, 1, 3, 3, 3)
    add("framed", "fill_rect", 4, 3, 0, 1, 1)          # corners the other way round
    add("framed", "fill_rect", 2, 2, 2, 2, 0)          # one cell
    add("random", "fill_rect", 0, 8, 6, 0, 4)          # everything
    for name, r, i in (("framed", 0, 3), ("framed", 5, 3), ("single-row", 0, 1),
                       ("single-column", 2, 1)):
        add(name, "fill_row", r, i)
    for name, c, i in (("framed", 0, 3), ("framed", 4, 3), ("single-row", 3, 2),
                       ("single-column", 0, 2)):
        add(name, "fill_column", c, i)

    add("framed", "add_border", top=1, right=2, bottom=3, left=4, palette_index=3)
    add("framed", "add_border", top=2)
    add("framed", "add_border", bottom=1, palette_index=1)
    add("framed", "add_border", top=-1, right=-2, bottom=-1, left=-1)
    add("framed", "add_border", top=-2, bottom=3, left=1, right=-4, palette_index=2)
    add("framed", "add_border", top=-6)                # every row: ValueError
    add("framed", "add_border", left=-3, right=-3)     # overlapping: ValueError
    add("framed", "add_border", top=-9, bottom=2)      # clamps to empty, then refilled
    add("framed", "add_border", left=-5, right=2)      # emptied, then refilled
    add("single-cell", "add_border", top=1, right=1, bottom=1, left=1, palette_index=0)
    add("random", "add_border")                        # all zero: a copy

    for name, at in (("framed", 0), ("framed", 3), ("framed", 6), ("single-cell", 1)):
        add(name, "insert_row", at)
    add("framed", "insert_row", 2, 3)
    for name, at in (("framed", 0), ("framed", 5), ("single-column", 3), ("single-row", 0)):
        add(name, "delete_row", at)
    add("single-cell", "delete_row", 0)
    for name, at in (("framed", 0), ("framed", 2), ("framed", 5), ("single-column", 1)):
        add(name, "insert_column", at)
    add("random", "insert_column", 4, 2)
    for name, at in (("framed", 0), ("framed", 4), ("single-row", 2), ("single-column", 0)):
        add(name, "delete_column", at)
    add("single-cell", "delete_column", 0)

    every_edge = {"top": True, "right": True, "bottom": True, "left": True}
    for kw in ({}, {"top": True}, {"bottom": True}, {"left": True}, {"right": True},
               every_edge):
        add("margins", "trim_uniform_edges", **kw)
    add("uniform", "trim_uniform_edges", **every_edge)  # stops at one row and column
    add("uniform", "trim_uniform_edges", left=True)
    add("framed", "trim_uniform_edges", **every_edge)
    add("single-cell", "trim_uniform_edges", **every_edge)

    for fn in ("mirror_h", "mirror_v", "rotate_180"):
        for name in ("framed", "random", "single-row", "single-column", "single-cell"):
            add(name, fn)

    add("framed", "recolor_palette_entry", "pal1", "#123456")
    add("framed", "recolor_palette_entry", "missing", "#123456")   # unknown id: a copy
    add("framed", "rename_palette_entry", "pal2", "Terracotta")
    add("framed", "rename_palette_entry", "pal0", "")
    add("framed", "rename_palette_entry", "missing", "Nobody")
    add("framed", "add_palette_entry", "#abcdef")
    add("framed", "add_palette_entry", "#abcdef", "Sky")
    add("single-cell", "add_palette_entry", "#000000", "Black")

    add("framed", "merge_palette_entries", "pal1", "pal3")
    add("framed", "merge_palette_entries", "pal3", "pal0")
    add("framed", "merge_palette_entries", "pal2", "pal2")         # itself: a copy
    add("odd-indices", "merge_palette_entries", "pal0", "pal2")
    add("framed", "merge_palette_entries", "missing", "pal0")      # KeyError
    add("framed", "delete_palette_entry", "pal0", "pal2")
    add("framed", "delete_palette_entry", "pal2", "pal1")
    add("framed", "delete_palette_entry", "pal3", "pal3")          # ValueError
    add("framed", "delete_palette_entry", "pal0", "missing")       # KeyError
    add("odd-indices", "delete_palette_entry", "pal1", "pal0")
    add("odd-indices", "delete_palette_entry", "pal2", "pal0")     # the last entry
    add("odd-indices", "merge_palette_entries", "pal0", "pal1")

    for i in range(6):
        add("nearest", "nearest_entry_id", f"pal{i}")
    add("single-cell", "nearest_entry_id", "pal0")                 # nothing else: itself
    add("framed", "nearest_entry_id", "missing")
    for i in range(6):
        add("nearest", "delete_palette_entry_nearest", f"pal{i}")
    add("single-cell", "delete_palette_entry_nearest", "pal0")     # the only colour

    for name, f in (("framed", 1), ("framed", 2), ("single-cell", 3), ("single-row", 2),
                    ("odd-indices", 2)):
        add(name, "scale", f)
    add("framed", "scale", 0)
    add("framed", "scale", -2)

    for name in ("framed", "random", "single-cell", "single-row", "single-column",
                 "margins", "uniform", "border-tie", "odd-indices"):
        add(name, "major_border_index")

    add("framed", "pad_to_size", 5, 6)                             # already that size
    add("framed", "pad_to_size", 9, 11)                            # centred, uneven
    add("framed", "pad_to_size", 8, 8, 1)
    add("framed", "pad_to_size", 9, 16, offset_left=0, offset_top=2)
    add("framed", "pad_to_size", 9, 16, offset_left=4, offset_top=10)
    add("framed", "pad_to_size", 9, 16, offset_top=0)              # left still centred
    add("framed", "pad_to_size", 9, 16, 0, offset_left=1)
    add("border-tie", "pad_to_size", 5, 6)                         # the tie's colour
    add("single-cell", "pad_to_size", 3, 1)
    add("framed", "pad_to_size", 4, 6)                             # shrinks: ValueError
    add("framed", "pad_to_size", 5, 5)
    add("framed", "pad_to_size", 9, 16, offset_left=5)             # past the 4 added
    add("framed", "pad_to_size", 9, 16, offset_left=-1)
    add("framed", "pad_to_size", 9, 16, offset_top=11)
    add("framed", "pad_to_size", 9, 16, offset_top=-1)
    add("framed", "pad_to_size", 5, 6, offset_left=1)              # nothing added
    return calls


def build_edit() -> dict:
    ps = edit_patterns()
    cases = []
    for name, fn, args, kwargs in edit_calls():
        p = ps[name]
        before = pattern_record(p)
        case: dict = {"pattern": name, "fn": fn, "args": args, "kwargs": kwargs}
        try:
            result = getattr(edit, fn)(p, *args, **kwargs)
        except (ValueError, KeyError) as e:
            case["raises"] = type(e).__name__
            if isinstance(e, ValueError):
                case["message"] = str(e)
        else:
            if isinstance(result, Pattern):
                assert result is not p
                case["result"] = edit_pattern_record(result, p)
            else:
                case["value"] = result
        assert pattern_record(p) == before, f"{fn} changed its argument"
        cases.append(case)
    return {
        "format": EDIT_FORMAT,
        "new_id": NEW_ID,
        "skip_index": SKIP_INDEX,
        "patterns": {k: edit_pattern_record(v) for k, v in ps.items()},
        "cases": cases,
    }


def render(data: dict) -> str:
    return json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def outputs() -> list[tuple[str, str]]:
    """Each fixture file and what it should contain."""
    return [(OUT, render(build())), (EDIT_OUT, render(build_edit()))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if a committed file does not match the Python")
    args = ap.parse_args()
    files = outputs()
    if args.check:
        stale = False
        for path, text in files:
            try:
                current = open(path, encoding="utf-8").read()
            except FileNotFoundError:
                print(f"{path} missing; run scripts/gen_fixtures.py")
                stale = True
                continue
            if current != text:
                print(f"{path} is stale; run scripts/gen_fixtures.py and commit it")
                stale = True
        if not stale:
            print("golden fixtures up to date")
        return 1 if stale else 0
    for path, text in files:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
    logic, edits = (json.loads(text) for _, text in files)
    n_steps = sum(len(s["steps"]) for c in logic["cases"] for s in c["work"]["scenarios"])
    print(f"wrote {OUT}: {len(logic['cases'])} patterns, {n_steps} progress steps")
    print(f"wrote {EDIT_OUT}: {len(edits['patterns'])} patterns, {len(edits['cases'])} calls")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
