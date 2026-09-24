"""Generate the golden corpus the TypeScript ports of readout.py and work.py must match.

The web port reimplements row readout and progress tracking in TypeScript, so the
Work stage can run without Pyodide. That leaves two implementations of the subtlest
logic in the app: direction alternation, bottom-up numbering, run-length encoding and
the progress cursor. The Python stays the spec. This script records what it does over
a set of deliberately awkward patterns and operation sequences, and the TS test suite
replays the file and must reproduce every value.

    python scripts/gen_fixtures.py            # rewrite fixtures/logic_golden.json
    python scripts/gen_fixtures.py --check    # exit 1 if the committed file is stale

alphareader/tests/test_golden_fixtures.py runs the --check comparison, so changing
readout.py or work.py without regenerating fails the Python suite, before the drift
can reach the TS side. Schema: fixtures/README.md.
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

from alphareader.core import readout, work  # noqa: E402
from alphareader.core.model import SKIP_INDEX, PaletteEntry, Pattern, Progress  # noqa: E402

OUT = os.path.join(ROOT, "fixtures", "logic_golden.json")
FORMAT = 1
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


def render(data: dict) -> str:
    return json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed file does not match the Python")
    args = ap.parse_args()
    text = render(build())
    if args.check:
        try:
            current = open(OUT, encoding="utf-8").read()
        except FileNotFoundError:
            print(f"{OUT} missing; run scripts/gen_fixtures.py")
            return 1
        if current != text:
            print(f"{OUT} is stale; run scripts/gen_fixtures.py and commit it")
            return 1
        print("golden fixtures up to date")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    data = json.loads(text)
    n_steps = sum(len(s["steps"]) for c in data["cases"] for s in c["work"]["scenarios"])
    print(f"wrote {OUT}: {len(data['cases'])} patterns, {n_steps} progress steps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
