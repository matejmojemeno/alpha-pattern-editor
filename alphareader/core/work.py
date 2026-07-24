"""Work-stage progress operations (§4.5, §6.3). Pure functions returning a new Progress.

Progress is keyed by stable row_id (survives structural edits), plus a
(current_row_id, current_run_index) cursor. Rows are worked in index order (row 1 first).
Runs before the cursor in the current row are done; the cursor sits on the active run.
"""
from __future__ import annotations

import copy
import time

from .model import Pattern, Progress
from .readout import encode_row


def _copy(pr: Progress) -> Progress:
    return Progress(
        completed_row_ids=set(pr.completed_row_ids),
        current_row_id=pr.current_row_id,
        current_run_index=pr.current_run_index,
        started_at=pr.started_at,
    )


def row_index(p: Pattern, row_id: str | None) -> int | None:
    if row_id is None or row_id not in p.row_ids:
        return None
    return p.row_ids.index(row_id)


def num_runs(p: Pattern, r: int) -> int:
    return len(encode_row(p, r))


def work_sequence(p: Pattern) -> list[int]:
    """Image row indices in the order they are worked (bottom row first if bottom_up)."""
    return list(range(p.rows - 1, -1, -1)) if p.bottom_up else list(range(p.rows))


def _row_ids_in_work_order(p: Pattern) -> list[str]:
    return [p.row_ids[i] for i in work_sequence(p)]


def first_incomplete_row(p: Pattern, pr: Progress) -> str | None:
    for rid in _row_ids_in_work_order(p):
        if rid not in pr.completed_row_ids:
            return rid
    return None


def ensure_started(p: Pattern, pr: Progress) -> Progress:
    """Place the cursor on the first unfinished row and stamp started_at (§6.4)."""
    pr = _copy(pr)
    if pr.started_at is None:
        pr.started_at = time.time()
    if pr.current_row_id is None or pr.current_row_id not in p.row_ids:
        pr.current_row_id = first_incomplete_row(p, pr) or (p.row_ids[-1] if p.row_ids else None)
        pr.current_run_index = 0
    return pr


def set_run_index(p: Pattern, pr: Progress, index: int) -> Progress:
    """Tap a chip to make it the active run."""
    pr = ensure_started(p, pr)
    r = row_index(p, pr.current_row_id)
    if r is None:
        return pr
    pr.current_run_index = max(0, min(index, num_runs(p, r) - 1))
    return pr


def _work_neighbour(p: Pattern, row_id: str, step: int) -> str | None:
    """The row_id `step` positions away in working order (+1 = next, -1 = previous)."""
    seq = _row_ids_in_work_order(p)
    if row_id not in seq:
        return None
    i = seq.index(row_id) + step
    return seq[i] if 0 <= i < len(seq) else None


def complete_current_row(p: Pattern, pr: Progress) -> Progress:
    """Mark the whole current row done and move to the next row in working order. This is
    what the big 'Row complete' button does — a row at a time, not a run at a time."""
    pr = ensure_started(p, pr)
    if pr.current_row_id is None:
        return pr
    pr.completed_row_ids.add(pr.current_row_id)
    nxt = first_incomplete_row(p, pr) or _work_neighbour(p, pr.current_row_id, +1)
    if nxt is not None:
        pr.current_row_id = nxt
    pr.current_run_index = 0
    return pr


def go_previous_row(p: Pattern, pr: Progress) -> Progress:
    """Step back a whole row in working order, reopening it for re-working."""
    pr = ensure_started(p, pr)
    if pr.current_row_id is None:
        return pr
    prev = _work_neighbour(p, pr.current_row_id, -1)
    if prev is None:
        return pr
    pr.completed_row_ids.discard(prev)
    pr.completed_row_ids.discard(pr.current_row_id)
    pr.current_row_id = prev
    pr.current_run_index = 0
    return pr


def advance(p: Pattern, pr: Progress) -> Progress:
    """Move the cursor to the next run; past the last run, complete the row (§10). Used
    for fine, colour-by-colour tracking with the arrow keys."""
    pr = ensure_started(p, pr)
    r = row_index(p, pr.current_row_id)
    if r is None:
        return pr
    if pr.current_run_index + 1 < num_runs(p, r):
        pr.current_run_index += 1
        return pr
    return complete_current_row(p, pr)


def retreat(p: Pattern, pr: Progress) -> Progress:
    """Step the cursor back one run; from the first run, reopen the previous work row."""
    pr = ensure_started(p, pr)
    r = row_index(p, pr.current_row_id)
    if r is None:
        return pr
    if pr.current_run_index > 0:
        pr.current_run_index -= 1
        return pr
    prev = _work_neighbour(p, pr.current_row_id, -1)
    if prev is None:
        return pr
    pr.completed_row_ids.discard(prev)
    pr.completed_row_ids.discard(pr.current_row_id)
    pr.current_row_id = prev
    pr.current_run_index = max(0, num_runs(p, row_index(p, prev)) - 1)
    return pr


def remaining_stitches(p: Pattern, pr: Progress) -> int:
    """Stitches left: all cells in unfinished rows, minus runs already passed in the
    current row (the active run still counts as remaining)."""
    total = 0
    for rid in p.row_ids:
        if rid in pr.completed_row_ids:
            continue
        total += p.cols
    r = row_index(p, pr.current_row_id)
    if r is not None and pr.current_row_id not in pr.completed_row_ids:
        runs = encode_row(p, r)
        total -= sum(run.count for run in runs[: pr.current_run_index])
    return max(0, total)


def completed_count(p: Pattern, pr: Progress) -> int:
    return sum(1 for rid in p.row_ids if rid in pr.completed_row_ids)


def is_complete(p: Pattern, pr: Progress) -> bool:
    return all(rid in pr.completed_row_ids for rid in p.row_ids) and p.rows > 0
