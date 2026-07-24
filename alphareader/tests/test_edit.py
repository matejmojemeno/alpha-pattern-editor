"""Tests for pattern mutations (§9) and row-id stability (§4.5, §13.5)."""
from __future__ import annotations

import numpy as np

from ..core import edit
from ..core.model import PaletteEntry, Pattern


def _pattern(cells, ncolors=3):
    cells = np.array(cells, dtype=np.uint16)
    rows, cols = cells.shape
    palette = [PaletteEntry(id=f"p{i}", hex="#000000", name=f"c{i}") for i in range(ncolors)]
    return Pattern(id="x", name="t", created_at=0, updated_at=0, cols=cols, rows=rows,
                   row_ids=[f"r{i}" for i in range(rows)], cells=cells, palette=palette)


def test_functions_are_pure():
    p = _pattern([[0, 1], [2, 0]])
    before = p.cells.copy()
    q = edit.set_cell(p, 0, 0, 2)
    assert np.array_equal(p.cells, before)     # original untouched
    assert q.cells[0, 0] == 2
    assert q is not p


def test_set_cell_updates_counts():
    p = _pattern([[0, 0], [0, 0]])
    q = edit.set_cell(p, 0, 0, 1)
    assert q.palette[0].count == 3 and q.palette[1].count == 1


def test_flood_fill():
    p = _pattern([[0, 0, 1], [0, 1, 1], [1, 1, 1]])
    q = edit.flood_fill(p, 0, 0, 2)
    assert q.cells[0, 0] == 2 and q.cells[1, 0] == 2
    assert q.cells[0, 2] == 1                   # not connected to the 0-region


def test_fill_rect_row_column():
    p = _pattern([[0, 0, 0], [0, 0, 0], [0, 0, 0]])
    assert np.all(edit.fill_rect(p, 0, 0, 1, 1, 1).cells[0:2, 0:2] == 1)
    assert np.all(edit.fill_row(p, 1, 2).cells[1, :] == 2)
    assert np.all(edit.fill_column(p, 2, 1).cells[:, 2] == 1)


def test_add_top_border_preserves_row_ids():
    """§13.5: adding a top border keeps existing rows' ids (progress survives)."""
    p = _pattern([[0, 1], [1, 0], [0, 1]])
    original_ids = list(p.row_ids)
    q = edit.add_border(p, top=3, palette_index=0)
    assert q.rows == 6
    assert q.row_ids[3:] == original_ids        # original ids shifted down, intact
    assert len(set(q.row_ids)) == 6             # new ids are unique
    assert np.all(q.cells[0:3] == 0)


def test_add_border_all_sides():
    p = _pattern([[1, 1], [1, 1]])
    q = edit.add_border(p, top=1, bottom=1, left=2, right=2, palette_index=0)
    assert (q.rows, q.cols) == (4, 6)


def test_negative_border_removes():
    p = _pattern([[0, 1, 2], [0, 1, 2], [0, 1, 2]])
    q = edit.add_border(p, left=-1)
    assert q.cols == 2 and np.all(q.cells[:, 0] == 1)


def test_insert_delete_row_ids():
    p = _pattern([[0, 1], [1, 0]])
    q = edit.insert_row(p, 1)
    assert q.rows == 3 and q.row_ids[0] == "r0" and q.row_ids[2] == "r1"
    back = edit.delete_row(q, 1)
    assert back.row_ids == ["r0", "r1"]


def test_insert_delete_column():
    p = _pattern([[0, 1], [1, 0]])
    q = edit.insert_column(p, 1, palette_index=2)
    assert q.cols == 3 and np.all(q.cells[:, 1] == 2)
    assert edit.delete_column(q, 1).cols == 2


def test_mirror_and_rotate():
    p = _pattern([[0, 1, 2]])
    assert np.array_equal(edit.mirror_h(p).cells, [[2, 1, 0]])
    p2 = _pattern([[0, 1], [2, 3]], ncolors=4)
    assert edit.mirror_v(p2).row_ids == ["r1", "r0"]
    assert np.array_equal(edit.rotate_180(p2).cells, [[3, 2], [1, 0]])


def test_recolor_and_rename():
    p = _pattern([[0, 1]])
    q = edit.recolor_palette_entry(p, "p1", "#ff0000")
    assert q.palette[1].hex == "#ff0000"
    q = edit.rename_palette_entry(q, "p0", "White")
    assert q.palette[0].name == "White"


def test_merge_palette_entries_reindexes():
    p = _pattern([[0, 1, 2], [2, 1, 0]])        # indices 0,1,2 used
    q = edit.merge_palette_entries(p, from_id="p1", into_id="p2")
    assert len(q.palette) == 2
    # every old 1 became the (reindexed) 'p2' colour; no cell references a dead index
    assert q.cells.max() < len(q.palette)
    assert "p1" not in [e.id for e in q.palette]


def test_delete_palette_entry_repaints():
    p = _pattern([[0, 1, 2], [2, 1, 0]])
    q = edit.delete_palette_entry(p, entry_id="p0", replacement_id="p2")
    assert len(q.palette) == 2
    assert q.cells.max() < len(q.palette)
    assert "p0" not in [e.id for e in q.palette]


def test_trim_uniform_edges():
    p = _pattern([[0, 0, 0], [0, 1, 0], [0, 0, 0]])
    q = edit.trim_uniform_edges(p, top=True, bottom=True)
    assert q.rows == 1 and np.array_equal(q.cells, [[0, 1, 0]])
