"""Pattern mutations (§9). Every function is pure: it returns a NEW Pattern and never
mutates its argument. Undo/redo is therefore a stack of snapshots (§8) — a 60x250 uint16
grid is ~30KB, so snapshotting is cheap and far less bug-prone than inverse commands.

Structural edits preserve stable row_ids (§4.5): existing rows keep their ids, inserted
rows get fresh ones, so Work-stage progress survives.
"""
from __future__ import annotations

import time
import uuid

import numpy as np

from .model import PaletteEntry, Pattern


def _recount(palette: list[PaletteEntry], cells: np.ndarray) -> None:
    counts = np.bincount(cells.ravel().astype(np.int64), minlength=len(palette))
    for i, e in enumerate(palette):
        e.count = int(counts[i]) if i < len(counts) else 0


def _clone(p: Pattern, *, cells: np.ndarray | None = None,
           palette: list[PaletteEntry] | None = None,
           row_ids: list[str] | None = None) -> Pattern:
    cells = p.cells.copy() if cells is None else np.ascontiguousarray(cells, dtype=np.uint16)
    src_palette = p.palette if palette is None else palette
    palette = [PaletteEntry(id=e.id, hex=e.hex, name=e.name, dmc=e.dmc, count=e.count)
               for e in src_palette]
    rows, cols = cells.shape
    row_ids = list(p.row_ids) if row_ids is None else list(row_ids)
    assert len(row_ids) == rows, (len(row_ids), rows)
    new = Pattern(
        id=p.id, name=p.name, created_at=p.created_at, updated_at=time.time(),
        cols=cols, rows=rows, row_ids=row_ids, cells=cells, palette=palette,
        start_direction=p.start_direction, alternate_direction=p.alternate_direction,
        bottom_up=p.bottom_up,
    )
    _recount(new.palette, new.cells)
    return new


# --- cell painting -----------------------------------------------------------

def set_cell(p: Pattern, r: int, c: int, palette_index: int) -> Pattern:
    cells = p.cells.copy()
    cells[r, c] = palette_index
    return _clone(p, cells=cells)


def flood_fill(p: Pattern, r: int, c: int, palette_index: int) -> Pattern:
    """4-connected flood fill bounded by the grid extent."""
    cells = p.cells.copy()
    target = cells[r, c]
    if target == palette_index:
        return _clone(p, cells=cells)
    stack = [(r, c)]
    rows, cols = cells.shape
    while stack:
        y, x = stack.pop()
        if not (0 <= y < rows and 0 <= x < cols) or cells[y, x] != target:
            continue
        cells[y, x] = palette_index
        stack.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])
    return _clone(p, cells=cells)


def fill_rect(p: Pattern, r0: int, c0: int, r1: int, c1: int, palette_index: int) -> Pattern:
    cells = p.cells.copy()
    y0, y1 = sorted((r0, r1))
    x0, x1 = sorted((c0, c1))
    cells[y0:y1 + 1, x0:x1 + 1] = palette_index
    return _clone(p, cells=cells)


def fill_row(p: Pattern, r: int, palette_index: int) -> Pattern:
    cells = p.cells.copy()
    cells[r, :] = palette_index
    return _clone(p, cells=cells)


def fill_column(p: Pattern, c: int, palette_index: int) -> Pattern:
    cells = p.cells.copy()
    cells[:, c] = palette_index
    return _clone(p, cells=cells)


# --- structural: borders / insert / delete / trim ----------------------------

def add_border(p: Pattern, *, top: int = 0, right: int = 0, bottom: int = 0,
               left: int = 0, palette_index: int = 0) -> Pattern:
    """Widen (positive) or shrink (negative) each edge. New rows get fresh row_ids;
    existing ids are untouched so progress survives (§9)."""
    cells = p.cells
    row_ids = list(p.row_ids)

    # Vertical edges (rows).
    if top > 0:
        cells = np.vstack([np.full((top, cells.shape[1]), palette_index, np.uint16), cells])
        row_ids = [uuid.uuid4().hex for _ in range(top)] + row_ids
    elif top < 0:
        cut = min(-top, cells.shape[0])
        cells = cells[cut:]
        row_ids = row_ids[cut:]
    if bottom > 0:
        cells = np.vstack([cells, np.full((bottom, cells.shape[1]), palette_index, np.uint16)])
        row_ids = row_ids + [uuid.uuid4().hex for _ in range(bottom)]
    elif bottom < 0:
        cut = min(-bottom, cells.shape[0])
        cells = cells[:cells.shape[0] - cut]
        row_ids = row_ids[:len(row_ids) - cut]

    # Horizontal edges (columns).
    if left > 0:
        cells = np.hstack([np.full((cells.shape[0], left), palette_index, np.uint16), cells])
    elif left < 0:
        cells = cells[:, min(-left, cells.shape[1]):]
    if right > 0:
        cells = np.hstack([cells, np.full((cells.shape[0], right), palette_index, np.uint16)])
    elif right < 0:
        cut = min(-right, cells.shape[1])
        cells = cells[:, :cells.shape[1] - cut]

    if cells.shape[0] < 1 or cells.shape[1] < 1:
        raise ValueError("Border removal would leave an empty pattern.")
    return _clone(p, cells=cells, row_ids=row_ids)


def insert_row(p: Pattern, at: int, palette_index: int = 0) -> Pattern:
    cells = np.insert(p.cells, at, palette_index, axis=0)
    row_ids = list(p.row_ids)
    row_ids.insert(at, uuid.uuid4().hex)
    return _clone(p, cells=cells, row_ids=row_ids)


def delete_row(p: Pattern, at: int) -> Pattern:
    if p.rows <= 1:
        raise ValueError("Cannot delete the last row.")
    cells = np.delete(p.cells, at, axis=0)
    row_ids = list(p.row_ids)
    del row_ids[at]
    return _clone(p, cells=cells, row_ids=row_ids)


def insert_column(p: Pattern, at: int, palette_index: int = 0) -> Pattern:
    cells = np.insert(p.cells, at, palette_index, axis=1)
    return _clone(p, cells=cells)


def delete_column(p: Pattern, at: int) -> Pattern:
    if p.cols <= 1:
        raise ValueError("Cannot delete the last column.")
    cells = np.delete(p.cells, at, axis=1)
    return _clone(p, cells=cells)


def trim_uniform_edges(p: Pattern, *, top: bool = False, right: bool = False,
                       bottom: bool = False, left: bool = False) -> Pattern:
    """Explicitly remove uniform (single-colour) rows/columns from the chosen edges.
    Never automatic (§4.1) — white margins may be intentional."""
    cells = p.cells
    row_ids = list(p.row_ids)
    if top:
        while cells.shape[0] > 1 and np.all(cells[0] == cells[0, 0]):
            cells = cells[1:]; row_ids = row_ids[1:]
    if bottom:
        while cells.shape[0] > 1 and np.all(cells[-1] == cells[-1, 0]):
            cells = cells[:-1]; row_ids = row_ids[:-1]
    if left:
        while cells.shape[1] > 1 and np.all(cells[:, 0] == cells[0, 0]):
            cells = cells[:, 1:]
    if right:
        while cells.shape[1] > 1 and np.all(cells[:, -1] == cells[0, -1]):
            cells = cells[:, :-1]
    return _clone(p, cells=cells, row_ids=row_ids)


# --- structural: mirror / rotate ---------------------------------------------

def mirror_h(p: Pattern) -> Pattern:
    return _clone(p, cells=p.cells[:, ::-1])


def mirror_v(p: Pattern) -> Pattern:
    return _clone(p, cells=p.cells[::-1, :], row_ids=list(reversed(p.row_ids)))


def rotate_180(p: Pattern) -> Pattern:
    return _clone(p, cells=p.cells[::-1, ::-1], row_ids=list(reversed(p.row_ids)))


# --- palette -----------------------------------------------------------------

def recolor_palette_entry(p: Pattern, entry_id: str, new_hex: str) -> Pattern:
    palette = [PaletteEntry(id=e.id, hex=(new_hex if e.id == entry_id else e.hex),
                            name=e.name, dmc=e.dmc, count=e.count) for e in p.palette]
    return _clone(p, palette=palette)


def rename_palette_entry(p: Pattern, entry_id: str, new_name: str) -> Pattern:
    palette = [PaletteEntry(id=e.id, hex=e.hex,
                            name=(new_name if e.id == entry_id else e.name),
                            dmc=e.dmc, count=e.count) for e in p.palette]
    return _clone(p, palette=palette)


def add_palette_entry(p: Pattern, hex_color: str, name: str = "New colour") -> Pattern:
    palette = list(p.palette) + [PaletteEntry(id=uuid.uuid4().hex, hex=hex_color, name=name)]
    return _clone(p, palette=palette)


def _remove_index(cells: np.ndarray, remove_idx: int, replace_idx: int,
                  palette_len: int) -> np.ndarray:
    """Repaint `remove_idx` cells as `replace_idx`, then shift the palette indices above
    `remove_idx` down by one, as the entry goes.

    Only indices that name a palette entry (below `palette_len`) move. SKIP_INDEX, and any
    other index past the palette, names no entry, so it is left exactly as it was: a skip
    cell stays a skip cell."""
    cells = cells.copy()
    cells[cells == remove_idx] = replace_idx
    above = (cells > remove_idx) & (cells < palette_len)
    cells[above] -= 1
    return cells


def _index_of(p: Pattern, entry_id: str) -> int:
    for i, e in enumerate(p.palette):
        if e.id == entry_id:
            return i
    raise KeyError(entry_id)


def merge_palette_entries(p: Pattern, from_id: str, into_id: str) -> Pattern:
    """Fold `from` into `into`: cells are recoloured and the `from` entry removed."""
    fi, ti = _index_of(p, from_id), _index_of(p, into_id)
    if fi == ti:
        return _clone(p)
    cells = _remove_index(p.cells, fi, ti, len(p.palette))
    palette = [e for i, e in enumerate(p.palette) if i != fi]
    return _clone(p, cells=cells, palette=palette)


def delete_palette_entry(p: Pattern, entry_id: str, replacement_id: str) -> Pattern:
    """Remove an entry, repainting its cells with `replacement`."""
    di, ri = _index_of(p, entry_id), _index_of(p, replacement_id)
    if di == ri:
        raise ValueError("Replacement colour must differ from the deleted one.")
    cells = _remove_index(p.cells, di, ri, len(p.palette))
    palette = [e for i, e in enumerate(p.palette) if i != di]
    return _clone(p, cells=cells, palette=palette)


def nearest_entry_id(p: Pattern, entry_id: str) -> str:
    """The id of the palette entry perceptually closest (CIELAB) to `entry_id`."""
    from .detect.palette import hex_to_rgb, srgb_to_lab
    di = _index_of(p, entry_id)
    labs = srgb_to_lab(np.array([hex_to_rgb(e.hex) for e in p.palette], dtype=float))
    dists = np.linalg.norm(labs - labs[di], axis=1)
    dists[di] = np.inf
    return p.palette[int(np.argmin(dists))].id


def delete_palette_entry_nearest(p: Pattern, entry_id: str) -> Pattern:
    """Remove an entry, repainting its cells with the perceptually nearest remaining
    colour (so unwanted colours collapse into the closest one automatically)."""
    if len(p.palette) <= 1:
        raise ValueError("Cannot remove the only colour.")
    return delete_palette_entry(p, entry_id, nearest_entry_id(p, entry_id))


# --- scaling & sizing --------------------------------------------------------

def scale(p: Pattern, factor: int) -> Pattern:
    """Integer upscale: every cell becomes a factor x factor block. Pixel-exact — no
    interpolation or new colours, just a larger version of the same chart."""
    factor = int(factor)
    if factor < 1:
        raise ValueError("Scale factor must be a positive integer.")
    if factor == 1:
        return _clone(p)
    cells = np.repeat(np.repeat(p.cells, factor, axis=0), factor, axis=1)
    row_ids = [uuid.uuid4().hex for _ in range(cells.shape[0])]
    return _clone(p, cells=cells, row_ids=row_ids)


def major_border_index(p: Pattern) -> int:
    """The most common palette index around the outermost ring of cells — the colour a
    frame/border is drawn in."""
    c = p.cells
    if p.rows < 2 or p.cols < 2:
        perim = c.ravel()
    else:
        perim = np.concatenate([c[0, :], c[-1, :], c[1:-1, 0], c[1:-1, -1]])
    vals, counts = np.unique(perim, return_counts=True)
    return int(vals[int(np.argmax(counts))])


def pad_to_size(p: Pattern, target_cols: int, target_rows: int,
                palette_index: int | None = None, *, offset_left: int | None = None,
                offset_top: int | None = None) -> Pattern:
    """Grow the chart to target_cols x target_rows by adding a border. The border colour
    defaults to the pattern's major border colour (§9). Padding only — never crops, so
    the artwork is untouched.

    `offset_left`/`offset_top` place the pattern inside the new size: how many of the
    added columns go on the left and added rows on top (the rest go right and bottom).
    Each must be 0 <= offset <= added; left out, the pattern is centred as evenly as
    possible, the extra one going right/bottom."""
    if target_cols < p.cols or target_rows < p.rows:
        raise ValueError("Target size must be at least the current size (this only pads).")
    if palette_index is None:
        palette_index = major_border_index(p)
    dc, dr = target_cols - p.cols, target_rows - p.rows
    left = dc // 2 if offset_left is None else int(offset_left)
    top = dr // 2 if offset_top is None else int(offset_top)
    if not 0 <= left <= dc:
        raise ValueError(f"Left offset must be between 0 and {dc}.")
    if not 0 <= top <= dr:
        raise ValueError(f"Top offset must be between 0 and {dr}.")
    return add_border(p, top=top, bottom=dr - top, left=left, right=dc - left,
                      palette_index=palette_index)
