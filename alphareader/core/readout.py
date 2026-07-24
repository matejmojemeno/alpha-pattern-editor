"""Row readout: run-length encoding with direction resolution (§10, §4.4). Pure core.

Work turns at the end of each row (row 1 L→R, row 2 R→L, ...), so a readout that always
read left-to-right would be mirrored on every even row. Direction is modelled explicitly
and the row is reversed before encoding when it resolves to RTL.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from .model import SKIP_INDEX, Pattern


@dataclass(frozen=True)
class Run:
    palette_index: int
    count: int
    start_col: int          # position in working order, not raw column index


def working_position(p: Pattern, r: int) -> int:
    """0-based position of image row `r` in working order. Bottom-up means the last
    image row is worked first (§4.4)."""
    return (p.rows - 1 - r) if p.bottom_up else r


def working_number(p: Pattern, r: int) -> int:
    """1-based row number as the maker counts it (1 = first row worked)."""
    return working_position(p, r) + 1


def row_direction(p: Pattern, r: int) -> Literal["LTR", "RTL"]:
    """Working direction of row `r`, honouring start_direction and alternation (§4.4).
    Alternation is keyed to the working position, not the image row."""
    if not p.alternate_direction:
        return p.start_direction
    if working_position(p, r) % 2 == 0:
        return p.start_direction
    return "RTL" if p.start_direction == "LTR" else "LTR"


def encode_row(p: Pattern, r: int) -> list[Run]:
    """Run-length encode row `r` in working order (reversed for RTL rows)."""
    row = p.cells[r]
    if row_direction(p, r) == "RTL":
        row = row[::-1]
    runs: list[Run] = []
    if row.size == 0:
        return runs
    # Boundaries where the value changes.
    changes = np.flatnonzero(np.diff(row)) + 1
    starts = np.concatenate(([0], changes))
    ends = np.concatenate((changes, [row.size]))
    for s, e in zip(starts, ends):
        runs.append(Run(palette_index=int(row[s]), count=int(e - s), start_col=int(s)))
    return runs


def _label(p: Pattern, palette_index: int) -> str:
    if palette_index == SKIP_INDEX:
        return "skip"
    if 0 <= palette_index < len(p.palette):
        return p.palette[palette_index].name
    return f"#{palette_index}"


def _initial(name: str) -> str:
    return name[0].upper() if name else "?"


def format_row_text(p: Pattern, r: int) -> str:
    """e.g. '1 Brown, 3 White, 5 Brown, 1 White'."""
    return ", ".join(f"{run.count} {_label(p, run.palette_index)}" for run in encode_row(p, r))


def format_row_compact(p: Pattern, r: int) -> str:
    """e.g. '1B 3W 5B 1W'."""
    return " ".join(f"{run.count}{_initial(_label(p, run.palette_index))}"
                    for run in encode_row(p, r))


def export_all_rows_text(p: Pattern) -> str:
    """Full printable readout in working order, one line per row with its number and
    direction arrow."""
    order = range(p.rows - 1, -1, -1) if p.bottom_up else range(p.rows)
    lines = []
    for r in order:
        arrow = "→" if row_direction(p, r) == "LTR" else "←"
        lines.append(f"Row {working_number(p, r)} {arrow}  {format_row_text(p, r)}")
    return "\n".join(lines)
