"""Turning a picture into a pattern (§5a). Pure NumPy, like detection.

A chart is *read*: its squares are already there. A picture has to be *made* into
squares, and the goal is the best pattern, not the most faithful shrink. Other tools
shrink the picture, reduce its colours by area, then sweep up lone stitches with a
majority filter; measured on real images (docs/dev/areas/import.md#picture-import), that
spends the colours on large dull areas and erases eyes, dots and outlines along with the
noise. Here:

1. **Sampling.** Each stitch keeps up to 4×4 area-averaged samples of the pixels it
   covers, not one average, so a thin dark line crossing a third of a stitch still pulls
   it towards dark.
2. **Colours** are chosen by a weighted k-means in CIELAB, the weight favouring stitches
   with detail (contrast within the stitch) and vivid colour, so small important areas
   get a colour of their own. Seeded deterministically (principal-axis splits, power
   iteration), never randomly: the desktop and Pyodide must agree bit for bit.
   In a drawing (mostly flat colour, flat_share), each colour is then the shade most of
   its samples have, not their mean, and the edges between colours, averaged, choose
   none: a drawing's colours are its own, never a blend of two of them.
3. **Stitches** are coloured by minimising colour error plus a cost for every colour
   change to a neighbour, higher along a row (a yarn change) than up a column. Stitches
   with detail count for more, so smoothing takes flat noise first. Solved by iterated
   conditional modes on a checkerboard. `detail` (0..1) sets the cost of a change.

`convert_picture` returns the same `confirm.Preview` a chart gives, so the bridge, the
import screen and saving treat the two alike.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .confirm import Extent, Preview
from .detect.palette import DEFAULT_DELTA_E, palette_entries, srgb_to_lab
from .outlines import drawn_lines, outline_stitches

DEFAULT_WIDTH = 60          # stitches across, for a picture not yet sized
DEFAULT_COLOURS = 6         # graphghans work best with about 4–10 (docs, "Picture import")
DEFAULT_DETAIL = 0.5
MAX_COLOURS = 24
MIN_WIDTH = 4
MAX_WIDTH = 400
_SUB = 4                    # samples per stitch, per axis, at most
_MAX_CHANGE_COST = 100.0    # ΔE a colour change along a row costs at detail 0
_COLUMN_SHARE = 0.5         # a change up a column costs this share of one along a row
_SWEEPS = 12
_LLOYD = 12
_MAX_POINTS = 120_000       # k-means sees at most this many samples (strided, not random)
_MAX_WEIGHT = 4.0           # a detailed, vivid stitch counts at most this many plain ones
_MISSING_DE = 25.0          # a sample this far (CIE76) from every colour is unexplained ...
_MIN_FEATURE_STITCHES = 2   # ... and this many stitches' worth of them earn a colour
_GROUP_DE = 15.0            # the samples within this of the worst one are its group
_DECIMALS = 6               # Lab and costs are rounded to this, for bit-identical results
_INK_SAME = 20.0            # an outline ink this near a palette colour is that colour; further, it's added
_FIXED = 1e9                # the cost that rules a colour out of a stitch
_MODE_BIN = 6.0             # a colour is its samples' most common shade: Lab cells this big ...
_MODE_DE = 12.0             # ... refined over the samples this near (yellow to orange: ~19)
_MODE_STEPS = 3
_MIX_DE = 8.0               # a sample this near a blend of two colours is their edge, averaged
_EDGE_DE = 20.0             # samples either side this different make an edge ...
_BLEND_RGB = 10.0           # ... and one between them, this near the line joining them in sRGB,
_SIDE_DE = 6.0              # ... and this far from both, is a blend of them
_SAME_DE = 6.0              # colours this near are the same colour
_FLAT_DE = 2.0              # a sample this near all its neighbours is flat colour ...
_FLAT_SHARE = 0.6           # ... and a picture this much of it, a drawing


def picture_rows(extent: Extent, cols: int, cell_aspect: float) -> int:
    """Rows for `cols` stitches across, so the crocheted piece keeps the picture's shape.

    `cell_aspect` is a stitch's height over its width, from the crocheter's swatch: 1 for
    square stitches, less for stitches wider than they are tall."""
    w, h = extent.x1 - extent.x0, extent.y1 - extent.y0
    if w <= 0 or h <= 0:
        return 1
    return max(1, int(round(cols * (h / w) / max(cell_aspect, 1e-3))))


def clamp_edges(extent: Extent, w: int, h: int) -> Extent:
    """The extent inside an image of w × h, at least a pixel each way. A picture's extent
    is its edges, from 0 to w, unlike a chart's, whose outer gridlines sit on pixels
    (`Extent.clamped` stops at w - 1)."""
    x0, x1 = sorted((float(extent.x0), float(extent.x1)))
    y0, y1 = sorted((float(extent.y0), float(extent.y1)))
    x0, y0 = min(max(0.0, x0), w - 1.0), min(max(0.0, y0), h - 1.0)
    x1, y1 = max(min(float(w), x1), x0 + 1.0), max(min(float(h), y1), y0 + 1.0)
    return Extent(x0, y0, x1, y1)


def clamp_width(cols: int, extent: Extent) -> int:
    """At least MIN_WIDTH stitches, at most MAX_WIDTH or one per pixel."""
    px = max(1, int(np.floor(extent.x1 - extent.x0)))
    return int(max(1, min(max(MIN_WIDTH, int(cols)), MAX_WIDTH, px)))


# --- 1. sampling -------------------------------------------------------------------------

@dataclass
class Samples:
    rows: int
    cols: int
    rgb: np.ndarray           # (rows, cols, S, 3) float64, S = sub*sub
    lab: np.ndarray           # (rows, cols, S, 3) float64
    detail: np.ndarray        # (rows, cols) float64: 1 + contrast within the stitch
    weight: np.ndarray        # (rows, cols) float64: how much a stitch counts for colours
    flat: float = 0.0         # share of samples like all their neighbours: a drawing's is high
    blend: np.ndarray | None = None   # (rows, cols, S) bool: samples that are an edge, averaged


def _bounds(lo: float, hi: float, n: int, limit: int) -> tuple[np.ndarray, np.ndarray]:
    """Integer pixel spans [a, b) for n equal parts of [lo, hi), each at least one pixel."""
    edges = np.linspace(lo, hi, n + 1)
    a = np.clip(np.floor(edges[:-1]).astype(np.intp), 0, limit - 1)
    b = np.clip(np.floor(edges[1:]).astype(np.intp), 0, limit)
    b = np.maximum(b, a + 1)
    return a, b


def _spans(shape: tuple, extent: Extent, rows: int, cols: int):
    """(sub, ya, yb, xa, xb): samples per stitch per axis, and each sample's pixel span."""
    H, W = shape[:2]
    ext = clamp_edges(extent, W, H)
    pw, ph = (ext.x1 - ext.x0) / cols, (ext.y1 - ext.y0) / rows
    sub = int(max(1, min(_SUB, np.floor(min(pw, ph)))))
    ya, yb = _bounds(ext.y0, ext.y1, rows * sub, H)
    xa, xb = _bounds(ext.x0, ext.x1, cols * sub, W)
    return sub, ya, yb, xa, xb


def _box_sums(values: np.ndarray, ya, yb, xa, xb) -> np.ndarray:
    """Exact sums of `values` (H, W, ...) over each sample's span, by an integral image."""
    H, W = values.shape[:2]
    integral = np.zeros((H + 1, W + 1) + values.shape[2:], dtype=np.int64)
    integral[1:, 1:] = values.astype(np.int64).cumsum(0).cumsum(1)
    return (integral[yb[:, None], xb[None, :]] - integral[ya[:, None], xb[None, :]]
            - integral[yb[:, None], xa[None, :]] + integral[ya[:, None], xa[None, :]])


def _per_stitch(fine: np.ndarray, rows: int, cols: int, sub: int) -> np.ndarray:
    """(rows*sub, cols*sub, ...) → (rows, cols, sub*sub, ...)."""
    tail = fine.shape[2:]
    return fine.reshape((rows, sub, cols, sub) + tail).swapaxes(1, 2).reshape((rows, cols, sub * sub) + tail)


def sample_stitches(img: np.ndarray, extent: Extent, rows: int, cols: int) -> Samples:
    """Area-averaged samples for each stitch, through an integral image (exact sums)."""
    sub, ya, yb, xa, xb = _spans(img.shape, extent, rows, cols)
    total = _box_sums(img[..., :3], ya, yb, xa, xb)
    area = ((yb - ya)[:, None] * (xb - xa)[None, :]).astype(np.float64)
    mean = total / area[..., None]                                  # (rows*sub, cols*sub, 3)

    rgb = _per_stitch(mean, rows, cols, sub)
    # Rounded, like the costs below: transcendental functions (the cube root, the power)
    # may differ in the last bit between numpy builds, and a stitch halfway between two
    # colours would then go either way. Measured: 5 of 114 images differed between the
    # desktop and Pyodide before rounding (scripts/parity).
    lab = np.round(srgb_to_lab(rgb), _DECIMALS)
    contrast = lab.std(axis=2).sum(axis=2)
    chroma = np.hypot(lab[..., 1], lab[..., 2]).mean(axis=2)
    detail = 1.0 + contrast / (contrast.mean() + 1e-9)
    # Capped, so detail wins small areas a colour without costing a large plain one its
    # own: uncapped (and squared, as first tried), a white background covering half the
    # picture weighed 1/156 of the rest and was folded into beige.
    weight = np.minimum(detail * (1.0 + chroma / (chroma.mean() + 1e-9)), _MAX_WEIGHT)
    fine_lab = _per_stitch_inverse(lab, rows, cols, sub)
    flat = flat_share(fine_lab)
    blend = None
    if flat >= _FLAT_SHARE:
        blend = _per_stitch(edge_blends(mean, fine_lab), rows, cols, sub)
    return Samples(rows=rows, cols=cols, rgb=rgb, lab=lab, detail=detail, weight=weight,
                   flat=flat, blend=blend)


def _per_stitch_inverse(per: np.ndarray, rows: int, cols: int, sub: int) -> np.ndarray:
    """(rows, cols, sub*sub, ...) → (rows*sub, cols*sub, ...), undoing _per_stitch."""
    tail = per.shape[3:]
    return per.reshape((rows, cols, sub, sub) + tail).swapaxes(1, 2).reshape((rows * sub, cols * sub) + tail)


def flat_share(lab: np.ndarray) -> float:
    """The share of a grid of samples within _FLAT_DE of all 8 neighbours. A drawing is
    flat colour: measured on the pictures corpus and the Moon Stick, drawings score 0.68 or
    more at 30 to 120 wide, the photos whose colours suffer from being a drawing's (a
    parrot, a cat, a sunflower, a butterfly) 0.37 or less. Photos that score high are
    mostly one plain area (snow, a white background), and treated as a drawing they keep
    the same colours."""
    h, w = lab.shape[:2]
    p = np.pad(lab, ((1, 1), (1, 1), (0, 0)), mode="edge")
    flat = np.ones((h, w), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            n = p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
            flat &= np.round(((n - lab) ** 2).sum(-1), _DECIMALS) < _FLAT_DE ** 2
    return float(flat.mean())


def edge_blends(rgb: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """(h, w) bool over a grid of samples: those that are the edge between two colours,
    averaged. A sample is an average of sRGB pixel values, so one straddling the edge
    between two colours lies on the line between the samples either side of it (across,
    down or diagonally), when those differ by _EDGE_DE or more and it is neither of them.
    These aren't colours of the picture: the Moon Stick's crescent edged in its burgundy
    ink made olives and browns that won colours of their own, the smiley's outline a grey
    and an olive. A smooth gradient isn't an edge (its neighbours differ by little), nor
    is a line narrower than a sample (lighter on both sides, it is no blend of them).

    If most samples are blends (a fine texture, all edges), none are counted as blends."""
    h, w = lab.shape[:2]

    def shifted(a: np.ndarray, dy: int, dx: int) -> np.ndarray:
        p = np.pad(a, ((1, 1), (1, 1), (0, 0)), mode="edge")
        return p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]

    def de(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        return np.round(np.sqrt(((a - b) ** 2).sum(-1)), _DECIMALS)

    out = np.zeros((h, w), dtype=bool)
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        p_rgb, q_rgb = shifted(rgb, dy, dx), shifted(rgb, -dy, -dx)
        p_lab, q_lab = shifted(lab, dy, dx), shifted(lab, -dy, -dx)
        d = p_rgb - q_rgb
        dd = (d * d).sum(-1)
        t = np.clip(((rgb - q_rgb) * d).sum(-1) / np.maximum(dd, 1e-9), 0.0, 1.0)
        off = np.round(np.sqrt(((q_rgb + t[..., None] * d - rgb) ** 2).sum(-1)), _DECIMALS)
        out |= ((de(p_lab, q_lab) >= _EDGE_DE) & (off <= _BLEND_RGB)
                & (de(lab, p_lab) >= _SIDE_DE) & (de(lab, q_lab) >= _SIDE_DE))
    return out if out.mean() <= 0.5 else np.zeros((h, w), dtype=bool)


def touched(mask: np.ndarray, extent: Extent, rows: int, cols: int) -> np.ndarray:
    """(rows, cols, S) bool: the samples whose pixels include any of `mask` (H, W)."""
    sub, ya, yb, xa, xb = _spans(mask.shape, extent, rows, cols)
    return _per_stitch(_box_sums(mask, ya, yb, xa, xb) > 0, rows, cols, sub)


# --- 2. colours ----------------------------------------------------------------------------

def _principal_axis(x: np.ndarray, w: np.ndarray) -> np.ndarray:
    """The direction of greatest weighted spread, by power iteration from a fixed start
    (not LAPACK, whose builds may differ in the last bits)."""
    mean = (x * w[:, None]).sum(0) / w.sum()
    d = x - mean
    cov = (d * w[:, None]).T @ d / w.sum()
    v = np.array([1.0, 0.577, 0.577])
    for _ in range(40):
        nv = cov @ v
        norm = np.sqrt((nv * nv).sum())
        if norm < 1e-12:
            break
        v = nv / norm
    return v


def choose_colours(samples: Samples, k: int, exclude: np.ndarray | None = None,
                   skip: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """k palette colours as (lab (k, 3), rgb (k, 3)), fewer if the picture has fewer.
    Stitches in `exclude` (rows, cols) and samples in `skip` (rows, cols, S) are left out
    of the choosing."""
    S = samples.lab.shape[2]
    lab = samples.lab.reshape(-1, 3)
    rgb = samples.rgb.reshape(-1, 3)
    w = np.repeat(samples.weight.reshape(-1), S)
    # Stitches that will be outline don't choose colours, nor do the samples the lines'
    # ink blends into: their smudge of ink and colour would otherwise win a colour of its
    # own (a grey, an olive) in place of one of the picture's.
    keep = np.ones(lab.shape[0], dtype=bool)
    if samples.blend is not None:
        keep &= ~samples.blend.reshape(-1)
    if exclude is not None:
        keep &= np.repeat(~exclude.reshape(-1), S)
    if skip is not None:
        keep &= ~skip.reshape(-1)
    if keep.any() and not keep.all():
        lab, rgb, w = lab[keep], rgb[keep], w[keep]
    step = max(1, int(np.ceil(lab.shape[0] / _MAX_POINTS)))
    lab, rgb, w = lab[::step], rgb[::step], w[::step]

    # Seed by splitting: repeatedly halve the cluster with the largest weighted error
    # across its principal axis, at its weighted mean.
    labels = np.zeros(lab.shape[0], dtype=np.intp)
    for n in range(1, k):
        errs = []
        for c in range(n):
            m = labels == c
            if m.sum() < 2:
                errs.append(-1.0)
                continue
            mu = (lab[m] * w[m, None]).sum(0) / w[m].sum()
            errs.append(float((((lab[m] - mu) ** 2).sum(1) * w[m]).sum()))
        c = int(np.argmax(errs))
        if errs[c] <= 1e-9:
            break                                   # nothing left to split
        m = np.flatnonzero(labels == c)
        v = _principal_axis(lab[m], w[m])
        proj = lab[m] @ v
        cut = float((proj * w[m]).sum() / w[m].sum())
        side = proj > cut
        if side.all() or not side.any():
            break
        labels[m[side]] = n

    n = int(labels.max()) + 1

    def centroids(lbl: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        cl, cr = np.zeros((n, 3)), np.zeros((n, 3))
        for c in range(n):
            m = lbl == c
            ws = w[m].sum()
            if ws > 0:
                cl[c] = (lab[m] * w[m, None]).sum(0) / ws
                cr[c] = (rgb[m] * w[m, None]).sum(0) / ws
        return cl, cr

    def lloyd(cl, cr, labels):
        for _ in range(_LLOYD):
            d = ((lab[:, None, :] - cl[None, :, :]) ** 2).sum(2)
            new = np.argmin(d, axis=1)
            if np.array_equal(new, labels):
                break
            labels = new
            ncl, ncr = centroids(labels)
            # A colour that lost every sample keeps its place rather than collapsing to black.
            keep = np.zeros(n, dtype=bool)
            keep[np.unique(labels)] = True
            cl = np.where(keep[:, None], ncl, cl)
            cr = np.where(keep[:, None], ncr, cr)
        return cl, cr, labels

    # A drawing's colours are flat, and each is the shade most of its samples have, not
    # their mean (_dominant). A photo's are spreads of shades, and their mean is the
    # better stand-in for them (as the most common shade, a parrot's red beak, sharing a
    # colour with the brown ground, became brown).
    drawing = samples.flat >= _FLAT_SHARE

    def snap(cl: np.ndarray, cr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return _dominant(lab, rgb, cl, cr) if drawing else (cl, cr)

    cl, cr, labels = lloyd(*centroids(labels), labels)
    cl, cr = snap(cl, cr)

    # Weighting favours detail, but a small area of a colour unlike any other (an eye, a
    # dot, a mouth) can still lose out to the shades of a large one: squared error is an
    # area measure, whatever the weights. So look at the *worst* error instead: while a
    # group of samples filling a couple of stitches sits further than _MISSING_DE from
    # every colour, give it the colour whose samples would suffer least without it (they
    # go to their second-nearest colour; measured at the 95th percentile), provided they
    # would still end up nearer a colour than the group is now. In a drawing, a sample
    # that is a mix of two of the colours isn't such a group: it's the edge between them, averaged (the
    # smiley's black outline on white made a grey, which took white's place, and the
    # pink tongue, left with the white, became white).
    min_points = _MIN_FEATURE_STITCHES * S / step
    for _ in range(n):
        d2 = ((lab[:, None, :] - cl[None, :, :]) ** 2).sum(2)
        near = np.sort(d2, axis=1)
        far = near[:, 0] > _MISSING_DE ** 2
        if drawing and far.sum() >= min_points and n >= 2:
            idx = np.flatnonzero(far)
            far[idx[_mixes(lab[idx], rgb[idx], cr)]] = False
        if far.sum() < min_points or n < 2:
            break
        worst = int(np.argmax(np.where(far, near[:, 0] * w, -1.0)))
        group = far & (((lab - lab[worst]) ** 2).sum(1) < _GROUP_DE ** 2)
        if group.sum() < min_points:
            break
        cand = (lab[group] * w[group, None]).sum(0) / w[group].sum()
        cand_rgb = (rgb[group] * w[group, None]).sum(0) / w[group].sum()
        own = np.argmin(d2, axis=1)
        after = np.array([float(np.percentile(near[own == c, 1], 95)) if (own == c).any() else 0.0
                          for c in range(n)])
        shift = np.array([float((w[own == c] * (near[own == c, 1] - near[own == c, 0])).sum())
                          for c in range(n)])
        drop = int(np.lexsort((shift, after))[0])
        if after[drop] >= float(np.median(near[group, 0])):
            break
        cl, cr = cl.copy(), cr.copy()
        cl[drop], cr[drop] = cand, cand_rgb
        cl, cr, labels = lloyd(cl, cr, np.argmin(((lab[:, None, :] - cl[None]) ** 2).sum(2), axis=1))
        cl, cr = snap(cl, cr)
    if not drawing:
        return cl, cr
    # Two colours may come to the same shade (the smiley has five colours; asked for six,
    # the sixth was a second black). One is enough.
    kept: list[int] = []
    for c in range(cl.shape[0]):
        if all(((cl[c] - cl[o]) ** 2).sum() >= _SAME_DE ** 2 for o in kept):
            kept.append(c)
    return cl[kept], cr[kept]


def _mixes(lab: np.ndarray, rgb: np.ndarray, pal_rgb: np.ndarray) -> np.ndarray:
    """Which samples are a mix of two of the colours: within _MIX_DE of a blend of them.
    Samples are averages of sRGB pixel values, so a sample across the edge between two
    colours lies on the straight line between them in sRGB."""
    out = np.zeros(lab.shape[0], dtype=bool)
    k = pal_rgb.shape[0]
    for i in range(k):
        for j in range(i + 1, k):
            a, d = pal_rgb[j], pal_rgb[i] - pal_rgb[j]
            dd = float((d * d).sum())
            if dd <= 0:
                continue
            t = np.clip(((rgb - a) @ d) / dd, 0.0, 1.0)
            blend = np.round(srgb_to_lab(a[None, :] + t[:, None] * d[None, :]), _DECIMALS)
            out |= ((blend - lab) ** 2).sum(1) < _MIX_DE ** 2
    return out


def _cell_keys(cells: np.ndarray) -> np.ndarray:
    """One integer per Lab cell, in the cells' lexicographic order, and linear in them: the
    key of a neighbour is the key plus a fixed step (_CELL_STEPS)."""
    return ((cells[..., 0] + 512) * 1024 + (cells[..., 1] + 512)) * 1024 + (cells[..., 2] + 512)


_CELL_STEPS = np.array([(a * 1024 + b) * 1024 + c
                        for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)], dtype=np.int64)


def _dominant(lab: np.ndarray, rgb: np.ndarray, cl: np.ndarray, cr: np.ndarray
              ) -> tuple[np.ndarray, np.ndarray]:
    """Each colour as the most common shade among its samples, not their mean.

    With fewer colours than the picture has, a colour stands for two of them, and their
    mean is neither: the Moon Stick's yellow and orange averaged to an olive beige, and its
    crescent was crocheted in it. The most common shade is one of them (the larger), a
    colour the picture has. Counted by area, not by the weights that chose the colours:
    those favour detail, and the most detailed samples are the blurred edges between two
    colours. Found deterministically: the fullest _MODE_BIN cell in Lab, counting its 26
    neighbours, then _MODE_STEPS mean-shift steps over the samples within _MODE_DE. Twice:
    the samples nearest a mean aren't those nearest the shade it moves to (the crescent's
    orange went with the yellow, whose mean leant towards it, and its own colour became a
    dull gold that a few hundred pixels of the ornament have)."""
    cl, cr = cl.copy(), cr.copy()
    for _ in range(2):
        cl, cr = _dominant_once(lab, rgb, cl, cr)
    return cl, cr


def _dominant_once(lab: np.ndarray, rgb: np.ndarray, cl: np.ndarray, cr: np.ndarray
                   ) -> tuple[np.ndarray, np.ndarray]:
    own = np.argmin(((lab[:, None, :] - cl[None, :, :]) ** 2).sum(2), axis=1)
    cl, cr = cl.copy(), cr.copy()
    all_keys = _cell_keys(np.floor(lab / _MODE_BIN).astype(np.int64))
    for c in range(cl.shape[0]):
        m = own == c
        x, xr = lab[m], rgb[m]
        if x.shape[0] == 0:
            continue
        keys, inv = np.unique(all_keys[m], return_inverse=True)     # sorted
        inv = inv.reshape(-1)
        count = np.bincount(inv, minlength=keys.shape[0])
        density = np.zeros(keys.shape[0], dtype=np.int64)
        for step in _CELL_STEPS:
            k2 = keys + step
            pos = np.minimum(np.searchsorted(keys, k2), keys.size - 1)
            hit = keys[pos] == k2
            density[hit] += count[pos[hit]]
        near = inv == int(np.argmax(density))               # first of equals: the lowest cell
        for _ in range(_MODE_STEPS + 1):
            centre = x[near].mean(axis=0)
            ball = ((x - centre) ** 2).sum(1) <= _MODE_DE ** 2
            if not ball.any():
                break
            near = ball
        cl[c], cr[c] = x[near].mean(axis=0), xr[near].mean(axis=0)
    return cl, cr


# --- 3. stitches ------------------------------------------------------------------------

def colour_costs(samples: Samples, pal_lab: np.ndarray) -> np.ndarray:
    """(rows, cols, k): mean ΔE (CIE76) from a stitch's samples to each colour, times the
    stitch's detail weight. Built a band of rows at a time to bound memory."""
    rows, cols = samples.rows, samples.cols
    k = pal_lab.shape[0]
    out = np.empty((rows, cols, k), dtype=np.float64)
    band = max(1, int(2_000_000 // max(1, cols * samples.lab.shape[2] * k)))
    for r0 in range(0, rows, band):
        blk = samples.lab[r0:r0 + band]                                 # (b, cols, S, 3)
        d = np.sqrt(((blk[:, :, :, None, :] - pal_lab[None, None, None]) ** 2).sum(-1))
        out[r0:r0 + band] = d.mean(axis=2)
    return np.round(out * samples.detail[..., None], _DECIMALS)


def assign_stitches(costs: np.ndarray, detail: float) -> np.ndarray:
    """Each stitch's colour: the colour error plus the cost of every change to a
    neighbour, minimised by iterated conditional modes over a checkerboard (half the
    stitches at a time, so neighbours never update together)."""
    rows, cols, k = costs.shape
    labels = np.argmin(costs, axis=2)
    change = _MAX_CHANGE_COST * (1.0 - float(np.clip(detail, 0.0, 1.0)))
    if change <= 0 or k < 2:
        return labels
    row_cost, col_cost = change, change * _COLUMN_SHARE
    ks = np.arange(k)
    board = (np.add.outer(np.arange(rows), np.arange(cols)) % 2).astype(bool)
    # How many neighbours each stitch has along its row and up its column.
    n_row = np.full((rows, cols), 2.0)
    n_row[:, 0] -= 1
    n_row[:, -1] -= 1
    n_col = np.full((rows, cols), 2.0)
    n_col[0, :] -= 1
    n_col[-1, :] -= 1

    def same(shifted: np.ndarray) -> np.ndarray:
        return (shifted[..., None] == ks).astype(np.float64)

    for _ in range(_SWEEPS):
        changed = False
        for parity in (False, True):
            pad = np.pad(labels, 1, constant_values=-1)
            eq_row = same(pad[1:-1, :-2]) + same(pad[1:-1, 2:])
            eq_col = same(pad[:-2, 1:-1]) + same(pad[2:, 1:-1])
            total = (costs + row_cost * (n_row[..., None] - eq_row)
                     + col_cost * (n_col[..., None] - eq_col))
            best = np.argmin(total, axis=2)
            upd = (board == parity) & (best != labels)
            if upd.any():
                labels = np.where(upd, best, labels)
                changed = True
        if not changed:
            break
    return labels


# --- the whole of it ---------------------------------------------------------------------

def with_ink(pal_lab: np.ndarray, pal_rgb: np.ndarray, ink_rgb: np.ndarray
             ) -> tuple[np.ndarray, np.ndarray, int, bool]:
    """The palette with the outlines' ink in it: (lab, rgb, ink index, added). The palette's
    own colour if one is within ΔE 20 of the ink (a black the picture already has), else
    it is added. `added` says the ink is no colour of the picture's, only its lines'.

    It never replaces a colour: the palette is chosen without the ink's smudge, so the
    colour nearest the ink is one of the picture's (replacing the one within ΔE 45, as
    this did, turned the Moon Stick's pink handle into its gem's red)."""
    ink_lab = np.round(srgb_to_lab(ink_rgb[None])[0], _DECIMALS)
    d = np.sqrt(((pal_lab - ink_lab) ** 2).sum(axis=1))
    near = int(np.argmin(d))
    if d[near] < _INK_SAME:
        return pal_lab, pal_rgb, near, False
    return np.vstack([pal_lab, ink_lab]), np.vstack([pal_rgb, ink_rgb]), pal_lab.shape[0], True


def _paints_in(samples: Samples, ink_rgb: np.ndarray, mask: np.ndarray,
               inked: np.ndarray | None) -> bool:
    """Whether the picture has areas in the ink's colour besides its lines: a couple of
    stitches' worth of the samples that choose colours within ΔE 20 of it. Saves choosing
    the colours twice (once to find the ink isn't among them): the slowest step."""
    ink_lab = np.round(srgb_to_lab(ink_rgb[None])[0], _DECIMALS)
    S = samples.lab.shape[2]
    keep = np.repeat(~mask.reshape(-1), S)
    if inked is not None:
        keep &= ~inked.reshape(-1)
    near = ((samples.lab.reshape(-1, 3)[keep] - ink_lab) ** 2).sum(1) < _INK_SAME ** 2
    return int(near.sum()) >= _MIN_FEATURE_STITCHES * S


def _finish(samples: Samples, pal_rgb: np.ndarray, labels: np.ndarray, extent: Extent) -> Preview:
    """Order the colours as a chart's palette is ordered (most used first, ties by colour),
    drop any no stitch ended up using, and build the preview."""
    rows, cols = samples.rows, samples.cols
    counts = np.bincount(labels.reshape(-1), minlength=pal_rgb.shape[0])
    used = np.flatnonzero(counts)
    order = used[np.lexsort((pal_rgb[used, 2], pal_rgb[used, 1], pal_rgb[used, 0], -counts[used]))]
    remap = np.zeros(pal_rgb.shape[0], dtype=np.uint16)
    remap[order] = np.arange(order.size, dtype=np.uint16)
    cells = remap[labels].astype(np.uint16)
    palette = palette_entries(pal_rgb[order], counts[order])
    return Preview(rows=rows, cols=cols,
                   row_lines=np.linspace(extent.y0, extent.y1, rows + 1),
                   col_lines=np.linspace(extent.x0, extent.x1, cols + 1),
                   cells=cells, palette=palette,
                   confidence=np.ones((rows, cols), dtype=np.float32),
                   extent=extent, delta_e=DEFAULT_DELTA_E)


def convert_picture(img: np.ndarray, extent: Extent | None = None, cols: int = DEFAULT_WIDTH,
                    cell_aspect: float = 1.0, colours: int = DEFAULT_COLOURS,
                    detail: float = DEFAULT_DETAIL, outlines: bool = False) -> Preview:
    """The whole conversion in one call (PictureState caches the steps between calls)."""
    state = PictureState(img=img, extent=extent or whole(img), cols=cols,
                         cell_aspect=cell_aspect, colours=colours, detail=detail, outlines=outlines)
    return state.preview()


def whole(img: np.ndarray) -> Extent:
    return Extent(0.0, 0.0, float(img.shape[1]), float(img.shape[0]))


@dataclass
class PictureState:
    """What the import screen edits for a picture, with each step cached until something
    it depends on changes: moving the Detail slider reruns only the stitch assignment,
    changing the number of colours only the colours onwards."""
    img: np.ndarray
    extent: Extent
    cols: int = DEFAULT_WIDTH
    cell_aspect: float = 1.0
    colours: int = DEFAULT_COLOURS
    detail: float = DEFAULT_DETAIL
    outlines: bool = False          # "Keep outlines" (outlines.py)
    _lines: tuple | None = field(default=None, repr=False)
    _outline: tuple | None = field(default=None, repr=False)
    _samples: tuple | None = field(default=None, repr=False)
    _colours: tuple | None = field(default=None, repr=False)
    _costs: tuple | None = field(default=None, repr=False)
    _preview: tuple | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        H, W = self.img.shape[:2]
        self.extent = clamp_edges(self.extent, W, H)
        self.cols = clamp_width(self.cols, self.extent)
        self.colours = int(np.clip(self.colours, 1, MAX_COLOURS))

    @property
    def rows(self) -> int:
        H = self.img.shape[0]
        return int(min(picture_rows(self.extent, self.cols, self.cell_aspect), max(1, H), MAX_WIDTH * 4))

    def set_extent(self, extent: Extent) -> None:
        H, W = self.img.shape[:2]
        self.extent = clamp_edges(extent, W, H)
        self.cols = clamp_width(self.cols, self.extent)

    def set_width(self, cols: int) -> None:
        self.cols = clamp_width(cols, self.extent)

    def set_cell_aspect(self, aspect: float) -> None:
        if aspect > 0:
            self.cell_aspect = float(aspect)

    def set_colours(self, colours: int) -> None:
        self.colours = int(np.clip(colours, 1, MAX_COLOURS))

    def set_detail(self, detail: float) -> None:
        self.detail = float(np.clip(detail, 0.0, 1.0))

    def set_outlines(self, on: bool) -> None:
        self.outlines = bool(on)

    def _outline_stitches(self, skey: tuple) -> tuple[np.ndarray | None, ...]:
        """(outline stitches, ink colour, samples the ink touches), or Nones with outlines
        off or no ink. The lines are found once per image; the rest once per size and crop."""
        if not self.outlines:
            return None, None, None
        if self._lines is None:
            self._lines = drawn_lines(self.img)
        lines, ink, fringe = self._lines
        if ink is None:
            return None, None, None
        if self._outline is None or self._outline[0] != skey:
            self._outline = (skey, outline_stitches(lines, self.extent, self.rows, self.cols),
                             touched(fringe, self.extent, self.rows, self.cols))
        mask, inked = self._outline[1], self._outline[2]
        return (mask, ink, inked) if mask.any() else (None, None, None)

    def preview(self) -> Preview:
        e = self.extent
        skey = (e.x0, e.y0, e.x1, e.y1, self.rows, self.cols)
        if self._samples is None or self._samples[0] != skey:
            self._samples = (skey, sample_stitches(self.img, e, self.rows, self.cols))
        samples = self._samples[1]
        mask, ink, inked = self._outline_stitches(skey)
        if samples.flat < _FLAT_SHARE:
            # In a photo, fur, grass and feathers are full of dark ridges, and the samples
            # beside them are most of the picture (a lawn's green went with them).
            inked = None
        ckey = (skey, self.colours, mask is not None)
        if self._colours is None or self._colours[0] != ckey:
            # The ink is one of the colours asked for, not one more: unless the picture
            # paints in it too, choose one fewer and add it.
            k = self.colours
            if mask is not None and k > 1 and not _paints_in(samples, ink, mask, inked):
                k -= 1
            lab, rgb = choose_colours(samples, k, exclude=mask, skip=inked)
            fixed = None
            if mask is not None:
                lab, rgb, index, added = with_ink(lab, rgb, ink)
                if added and k == self.colours and k > 1:
                    lab, rgb = choose_colours(samples, k - 1, exclude=mask, skip=inked)
                    lab, rgb, index, added = with_ink(lab, rgb, ink)
                fixed = (index, added)
            self._colours = (ckey, (lab, rgb, fixed))
        pal_lab, pal_rgb, fixed = self._colours[1]
        if self._costs is None or self._costs[0] != ckey:
            costs = colour_costs(samples, pal_lab)
            if fixed is not None:
                # Outline stitches are the ink, whatever smoothing would prefer; the ink is
                # no other stitch's colour when it's only the lines'.
                index, added = fixed
                if added:
                    costs[..., index] = _FIXED
                costs[mask] = _FIXED
                costs[mask, index] = 0.0
            self._costs = (ckey, costs)
        pkey = (ckey, self.detail)
        if self._preview is None or self._preview[0] != pkey:
            labels = assign_stitches(self._costs[1], self.detail)
            self._preview = (pkey, _finish(samples, pal_rgb, labels, e))
        return self._preview[1]
