"""Tests for readout (§10) and work-stage progress (§4.4, §4.5, §6)."""
from __future__ import annotations

import numpy as np

from ..core import work
from ..core.model import PaletteEntry, Pattern, Progress
from ..core.readout import (
    encode_row, export_all_rows_text, format_row_compact, format_row_text, row_direction,
    working_number,
)


def _pattern(cells, names=("White", "Brown"), **kw):
    cells = np.array(cells, dtype=np.uint16)
    rows, cols = cells.shape
    palette = [PaletteEntry(id=f"p{i}", hex="#000000", name=n) for i, n in enumerate(names)]
    kw.setdefault("bottom_up", False)      # tests set order explicitly for clarity
    kw.setdefault("start_direction", "LTR")  # direction-mechanics tests pin the start side
    return Pattern(id="x", name="t", created_at=0, updated_at=0, cols=cols, rows=rows,
                   row_ids=[f"r{i}" for i in range(rows)], cells=cells, palette=palette, **kw)


# --- direction & encoding ----------------------------------------------------

def test_direction_alternates():
    p = _pattern([[0, 1], [0, 1]])
    assert row_direction(p, 0) == "LTR"
    assert row_direction(p, 1) == "RTL"


def test_direction_no_alternation():
    p = _pattern([[0, 1], [0, 1]], alternate_direction=False)
    assert row_direction(p, 0) == "LTR" and row_direction(p, 1) == "LTR"


def test_bottom_up_numbering_and_direction():
    # 3 rows, worked bottom-first: image row 2 is Row 1 (LTR), row 1 is Row 2 (RTL), etc.
    p = _pattern([[0, 1], [0, 1], [0, 1]], bottom_up=True)
    assert working_number(p, 2) == 1 and working_number(p, 0) == 3
    assert row_direction(p, 2) == "LTR"      # first worked row
    assert row_direction(p, 1) == "RTL"      # second worked row


def test_default_start_direction_is_right_to_left():
    """App default: row 1 (the bottom row, worked first) reads right-to-left."""
    from ..core.model import Pattern
    p = Pattern(id="x", name="t", created_at=0, updated_at=0, cols=2, rows=2,
                row_ids=["r0", "r1"], cells=np.zeros((2, 2), np.uint16), palette=[])
    assert p.start_direction == "RTL"
    assert p.bottom_up is True
    assert row_direction(p, 1) == "RTL"      # bottom row (worked first) -> right-to-left
    assert row_direction(p, 0) == "LTR"      # next row turns


def test_rtl_row_is_reversed():
    # row index 1 is RTL, so it reads right-to-left (§13.6).
    p = _pattern([[0, 0, 1], [0, 0, 1]])  # names White, Brown; bottom_up=False
    r0 = encode_row(p, 0)
    assert [(x.palette_index, x.count) for x in r0] == [(0, 2), (1, 1)]
    r1 = encode_row(p, 1)
    assert [(x.palette_index, x.count) for x in r1] == [(1, 1), (0, 2)]


def test_format_text_and_compact():
    p = _pattern([[1, 0, 0, 0, 1]])
    assert format_row_text(p, 0) == "1 Brown, 3 White, 1 Brown"
    assert format_row_compact(p, 0) == "1B 3W 1B"


def test_export_all_rows():
    p = _pattern([[0, 1], [1, 0]])
    text = export_all_rows_text(p)
    assert "Row 1 →" in text and "Row 2 ←" in text


# --- progress cursor ---------------------------------------------------------

def test_advance_through_runs_then_row():
    p = _pattern([[0, 1, 1], [0, 0, 0]])   # row0: 2 runs, row1: 1 run
    pr = work.ensure_started(p, Progress())
    assert pr.current_row_id == "r0" and pr.current_run_index == 0
    pr = work.advance(p, pr)               # -> run 1 of row 0
    assert pr.current_run_index == 1 and not pr.completed_row_ids
    pr = work.advance(p, pr)               # past last run -> complete row 0, move to row 1
    assert "r0" in pr.completed_row_ids
    assert pr.current_row_id == "r1" and pr.current_run_index == 0


def test_retreat_reopens_previous_row():
    p = _pattern([[0, 1, 1], [0, 0, 0]])
    pr = work.ensure_started(p, Progress())
    pr = work.advance(p, pr)
    pr = work.advance(p, pr)               # now on row 1, row 0 complete
    pr = work.retreat(p, pr)               # back into row 0, last run
    assert pr.current_row_id == "r0"
    assert "r0" not in pr.completed_row_ids
    assert pr.current_run_index == work.num_runs(p, 0) - 1


def test_mark_segment_complete_marks_previous():
    # one row, three runs: [0][1 1][0 0 0] -> runs of 1, 2, 3
    p = _pattern([[0, 1, 1, 0, 0, 0]])
    pr = work.ensure_started(p, Progress())
    pr = work.mark_segment_complete(p, pr, 1)     # finish 2nd segment -> also 1st
    assert pr.current_run_index == 2              # cursor now on the 3rd segment
    assert pr.current_run_stitches == 0
    # 1 (run0) + 2 (run1) done of 6 -> 3 left
    assert work.remaining_stitches(p, pr) == 3


def test_mark_last_segment_completes_row():
    p = _pattern([[0, 1, 1], [2, 2, 2]], names=("A", "B", "C"))
    pr = work.ensure_started(p, Progress())
    pr = work.mark_segment_complete(p, pr, 1)     # 2nd (last) segment of row 0
    assert "r0" in pr.completed_row_ids and pr.current_row_id == "r1"


def test_set_run_stitches_partial_and_full():
    p = _pattern([[0, 1, 1, 1, 1]])               # runs: 1 x'0', 4 x'1'
    pr = work.ensure_started(p, Progress())
    pr = work.set_run_stitches(p, pr, 1, 2)       # 2 of the 4 in segment 1
    assert pr.current_run_index == 1 and pr.current_run_stitches == 2
    assert work.remaining_stitches(p, pr) == 2    # 5 total - (1 seg0 + 2 partial) = 2
    pr = work.set_run_stitches(p, pr, 1, 4)       # fill the segment -> completes it
    assert pr.current_run_stitches == 0
    # last segment filled -> whole (single) row done
    assert work.is_complete(p, pr)


def test_partial_resets_when_row_completes():
    p = _pattern([[0, 1, 1, 1], [2, 2, 2, 2]], names=("A", "B", "C"))
    pr = work.ensure_started(p, Progress())
    pr = work.set_run_stitches(p, pr, 1, 2)       # partial on row 0
    pr = work.complete_current_row(p, pr)
    assert pr.current_run_stitches == 0 and pr.current_run_index == 0


def test_started_at_stamped_once():
    p = _pattern([[0, 1]])
    pr = work.ensure_started(p, Progress())
    t = pr.started_at
    assert t is not None
    pr2 = work.ensure_started(p, pr)
    assert pr2.started_at == t


def test_remaining_stitches_decreases():
    p = _pattern([[0, 1, 1], [0, 0, 0]])   # 6 stitches total
    pr = work.ensure_started(p, Progress())
    assert work.remaining_stitches(p, pr) == 6
    pr = work.advance(p, pr)               # passed run 0 (1 stitch) of row 0
    assert work.remaining_stitches(p, pr) == 5
    pr = work.advance(p, pr)               # completed row 0 (3 stitches), on row 1
    assert work.remaining_stitches(p, pr) == 3


def test_complete_when_all_rows_done():
    p = _pattern([[0], [1]])
    pr = Progress()
    pr = work.advance(p, pr)               # row 0 has 1 run -> completes, move to row 1
    assert not work.is_complete(p, pr)
    pr = work.advance(p, pr)               # completes row 1
    assert work.is_complete(p, pr)


def test_complete_current_row_finishes_whole_row():
    """The big button completes the whole row regardless of the run cursor."""
    p = _pattern([[0, 1, 0, 1, 0]])        # 5 runs in one row
    pr = work.set_run_index(p, Progress(), 2)   # cursor mid-row
    pr = work.complete_current_row(p, pr)
    assert p.row_ids[0] in pr.completed_row_ids
    assert work.is_complete(p, pr)


def test_bottom_up_work_order():
    """With bottom_up, the bottom image row is worked first and completion moves upward."""
    p = _pattern([[0, 0], [1, 1], [2, 2]], names=("A", "B", "C"), bottom_up=True)
    pr = work.ensure_started(p, Progress())
    assert pr.current_row_id == "r2"       # bottom row first
    pr = work.complete_current_row(p, pr)
    assert pr.current_row_id == "r1"       # moved up
    pr = work.complete_current_row(p, pr)
    assert pr.current_row_id == "r0"       # top row worked last


def test_go_previous_row_reopens():
    p = _pattern([[0, 0], [1, 1], [2, 2]], names=("A", "B", "C"), bottom_up=True)
    pr = work.ensure_started(p, Progress())
    pr = work.complete_current_row(p, pr)  # r2 done, on r1
    pr = work.go_previous_row(p, pr)       # back to r2
    assert pr.current_row_id == "r2"
    assert "r2" not in pr.completed_row_ids


def test_set_run_index_clamps():
    p = _pattern([[0, 1, 1]])
    pr = work.set_run_index(p, Progress(), 99)
    assert pr.current_run_index == work.num_runs(p, 0) - 1


def test_progress_survives_when_row_ids_shift():
    """Completed row_ids are stable identifiers, not indices (§4.5)."""
    p = _pattern([[0, 1], [0, 1], [0, 1]])
    pr = Progress(completed_row_ids={"r0", "r1"})
    # Simulate a top-border insert: a new row id prepended, existing ids kept.
    p.row_ids = ["new"] + p.row_ids
    p.rows = 4
    p.cells = np.vstack([[[0, 0]], p.cells]).astype(np.uint16)
    assert work.completed_count(p, pr) == 2          # r0, r1 still counted
    assert work.first_incomplete_row(p, pr) == "new"  # the new top row is next
