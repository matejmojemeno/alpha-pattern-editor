"""Keeping a drawing's outlines when it is turned into a pattern ("Keep outlines", §5a).

A cartoon's black lines are 2–5 px wide; a stitch of a 40-wide pattern is 15–25 px. Averaged
into stitches they vanish, and with them shapes that are nothing but a line (the white half
of the Moon Stick's crescent is white on white, drawn only by its outline). So when asked:

1. **Ink:** pixels dark (L* < 55) and darker by 12 or more than the pixels on both sides
   of them, 3 or 6 pixels away across, down or diagonally: a dark ridge, which a drawn
   line is and the edge of a dark area isn't. 55, not darker: drawn lines taper, and the
   Moon Stick's get as light as L* 49 at their ends. The ridge must go on along itself,
   give or take a pixel; beyond the picture's edge counts as lighter (see ink_mask).
2. **Centrelines:** the ink thinned to one pixel (Zhang–Suen), so a line is followed
   wherever it goes and stays connected, however it crosses the stitches.
3. **Stitches:** every stitch a centreline passes through, less those it only clips (under
   a third of a stitch of centreline), where dropping one keeps the line connected. Then
   the detail budget, since a pattern can hold fewer lines than a drawing:
   - a clump of lines (every neighbour marked) is hollowed to its ring, so an ornament
     full of little outlines keeps its outline and the colours inside it;
   - lines that touch side by side are thinned to one (Zhang–Suen again, on the stitches);
   - specks of fewer than 3 stitches are dropped.
4. **Colour:** the darkest quarter of the ink, so blurred edges don't lighten it. It is
   the palette's own colour if one is within ΔE 20 of it, else it replaces the palette's
   colour nearest to it (within ΔE 45), else it is added.

Whether an image has drawn outlines at all can't be told reliably from simple measures
(docs/web-port-plan.md, "Keep outlines"), so this is the user's switch, off by default,
with the result shown live. Deterministic: integers and booleans throughout, and L*
rounded as convert.py rounds its Lab values.
"""
from __future__ import annotations

import numpy as np

from .confirm import Extent
from .detect.palette import srgb_to_lab

_INK_L = 55.0            # darker than this (L*): a tapered line end is ~50 ...
_INK_CONTRAST = 12.0     # ... and than the mean around it by this much
_INK_REACH = (3, 6)      # "both sides": this many pixels away, for lines up to ~10 px
_CLIP = 1 / 3            # a stitch the centreline crosses for less than this share is clipped
_MIN_SPECK = 3           # fewer stitches than this, alone, is a speck
_CLUMP = 6               # lines in this many of a stitch's 3 × 3 make a clump
_OUTSIDE_L = 100.0       # L* taken for beyond the image's edge, when looking across a line
_DECIMALS = 6


def _shifted(L: np.ndarray, dy: int, dx: int, fill: float | None = None) -> np.ndarray:
    """L moved by (dy, dx): out[y, x] = L[y + dy, x + dx], with the edges repeated beyond
    the image, or `fill` there if given."""
    h, w = L.shape
    r = max(abs(dy), abs(dx))
    p = np.pad(L, r, mode="edge") if fill is None else np.pad(L, r, constant_values=fill)
    return p[r + dy:r + dy + h, r + dx:r + dx + w]


def ink_mask(img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(ink, L*): the drawn lines of a picture, and the lightness they were judged by.

    A line is a dark ridge: darker than the pixels on both sides of it, across, down or
    diagonally, a few pixels away. The edge of a dark area is dark on one side only, so
    a red shield or a burgundy mouth isn't outlined along its own edge."""
    L = np.round(srgb_to_lab(img[..., :3])[..., 0], _DECIMALS)
    dark = L < _INK_L
    ridge = np.zeros(L.shape, bool)
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        for d in _INK_REACH:
            # A line runs across (dy, dx): it goes on along (dx, -dy), both ways, in the same
            # ink, at least as far as it is looked across. Near the corner of a dark shape
            # both diagonal sides are lighter too, but the shape doesn't go on that far.
            # "Goes on" allows a pixel either side across, and ink as dark or darker: a thin
            # anti-aliased line drifts by a pixel within a few pixels' length, darker where
            # it fills a pixel, and looked for exactly in line in exactly the same ink, the
            # Moon Stick's thin outer circle was missed for a third of its length.
            goes_on = dark
            for sy, sx in ((dx * d, -dy * d), (-dx * d, dy * d)):
                on = np.minimum(_shifted(L, sy, sx),
                                np.minimum(_shifted(L, sy + dy, sx + dx), _shifted(L, sy - dy, sx - dx)))
                goes_on = goes_on & (on - L < _INK_CONTRAST)
            # Beyond the image is background, looking straight across or down: a line the
            # picture's edge cuts through (the top of the Moon Stick's circle) is still a
            # line, and a dark area's edge isn't, as inside it, it isn't lighter. Not
            # diagonally: there, the corner of a dark area at the edge would be a line.
            outside = _OUTSIDE_L if dy == 0 or dx == 0 else None
            ridge |= goes_on & ((_shifted(L, dy * d, dx * d, outside) - L >= _INK_CONTRAST)
                                & (_shifted(L, -dy * d, -dx * d, outside) - L >= _INK_CONTRAST))
    return ridge, L


def _neighbours(m: np.ndarray) -> list[np.ndarray]:
    """P2..P9, clockwise from north, as Zhang and Suen number them (0 beyond the edge)."""
    p = np.pad(m, 1)
    return [p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]]


def thin(mask: np.ndarray) -> np.ndarray:
    """Zhang–Suen thinning: every stroke down to one pixel wide, connectivity kept."""
    m = mask.astype(np.uint8)
    while True:
        changed = False
        for step in (0, 1):
            n = _neighbours(m)
            b = sum(x.astype(np.int32) for x in n)
            ring = n + [n[0]]
            a = sum(((ring[i] == 0) & (ring[i + 1] == 1)).astype(np.int32) for i in range(8))
            p2, p4, p6, p8 = n[0], n[2], n[4], n[6]
            if step == 0:
                keep_shape = ((p2 & p4 & p6) == 0) & ((p4 & p6 & p8) == 0)
            else:
                keep_shape = ((p2 & p4 & p8) == 0) & ((p2 & p6 & p8) == 0)
            gone = (m == 1) & (b >= 2) & (b <= 6) & (a == 1) & keep_shape
            if gone.any():
                m[gone] = 0
                changed = True
        if not changed:
            return m.astype(bool)


def centrelines(img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(centrelines, ink colour): the drawing's lines, one pixel wide, and their colour as
    an sRGB triple of floats (the darkest quarter of the ink), or None if there's no ink."""
    ink, L = ink_mask(img)
    if not ink.any():
        return np.zeros(ink.shape, bool), None
    lightness = L[ink]
    darkest = ink & (L <= np.percentile(lightness, 25))
    colour = np.round(img[darkest][:, :3].astype(np.float64).mean(axis=0), _DECIMALS)
    return thin(ink), colour


def _edges(lo: float, hi: float, n: int, limit: int) -> np.ndarray:
    """The pixel where each of n equal parts of [lo, hi) starts, as convert samples them."""
    e = np.floor(np.linspace(lo, hi, n + 1)).astype(np.int64)
    return np.clip(e, 0, limit)


def _simple(b: np.ndarray, r: int, c: int) -> bool:
    """Whether (r, c) can go without splitting its marked 8-neighbours into two groups."""
    around = [(-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1)]
    on = [(dr, dc) for dr, dc in around
          if 0 <= r + dr < b.shape[0] and 0 <= c + dc < b.shape[1] and b[r + dr, c + dc]]
    if len(on) < 2:
        return False                                  # an end: keep the line's length
    seen = {on[0]}
    stack = [on[0]]
    while stack:
        a = stack.pop()
        for o in on:
            if o not in seen and max(abs(o[0] - a[0]), abs(o[1] - a[1])) <= 1:
                seen.add(o)
                stack.append(o)
    return len(seen) == len(on)


def _components(b: np.ndarray) -> list[list[tuple[int, int]]]:
    """The 8-connected groups of marked stitches, in reading order."""
    seen = np.zeros(b.shape, bool)
    out = []
    for r, c in zip(*np.nonzero(b)):
        if seen[r, c]:
            continue
        group, stack = [], [(int(r), int(c))]
        seen[r, c] = True
        while stack:
            y, x = stack.pop()
            group.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < b.shape[0] and 0 <= xx < b.shape[1] and b[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True
                        stack.append((yy, xx))
        out.append(group)
    return out


def _count3(b: np.ndarray) -> np.ndarray:
    """How many of each stitch's 3 × 3 (itself included) are marked."""
    return sum(x.astype(np.int32) for x in _neighbours(b.astype(np.uint8))) + b.astype(np.int32)


def _hollow_clumps(marked: np.ndarray) -> np.ndarray:
    dense = _count3(marked) >= _CLUMP
    if not dense.any():
        return marked
    area = _count3(dense) > 0                        # widened by a stitch
    inside = area.copy()
    p = np.pad(area, 1)
    inside &= p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    edge = area & ~inside
    return (marked & ~area) | edge


def outline_stitches(lines: np.ndarray, extent: Extent, rows: int, cols: int) -> np.ndarray:
    """(rows, cols) bool: the stitches that draw the lines within `extent` (see module)."""
    h, w = lines.shape
    ys = _edges(extent.y0, extent.y1, rows, h)
    xs = _edges(extent.x0, extent.x1, cols, w)
    py, px = np.nonzero(lines[ys[0]:ys[-1], xs[0]:xs[-1]])
    r = np.searchsorted(ys, py + ys[0], side="right") - 1
    c = np.searchsorted(xs, px + xs[0], side="right") - 1
    ok = (r >= 0) & (r < rows) & (c >= 0) & (c < cols)
    count = np.zeros((rows, cols), np.int64)
    np.add.at(count, (r[ok], c[ok]), 1)
    marked = count > 0
    if not marked.any():
        return marked

    # Clipped stitches, weakest first, where the line stays connected without them.
    stitch = min((extent.y1 - extent.y0) / rows, (extent.x1 - extent.x0) / cols)
    enough = max(1.0, _CLIP * stitch)
    order = np.lexsort((np.arange(count.size), count.ravel()))
    for idx in order:
        y, x = divmod(int(idx), cols)
        if marked[y, x] and count[y, x] < enough and _simple(marked, y, x):
            marked[y, x] = False

    # A clump of lines, more than the stitches can hold, is replaced by its outline: where
    # most of a stitch's 3 × 3 are lines, the area they make (widened by a stitch, to take in
    # its gaps) keeps only its edge, and the inside goes back to its colours.
    marked = _hollow_clumps(marked)

    # Lines touching side by side become one, and specks go.
    marked = thin(marked)
    for group in _components(marked):
        if len(group) < _MIN_SPECK:
            for y, x in group:
                marked[y, x] = False
    return marked
