"""Palette recovery via CIELAB agglomerative clustering (§5 step 8). Pure NumPy."""
from __future__ import annotations

import json
import uuid
from functools import lru_cache
from importlib import resources

import numpy as np
from ._nd import complete_linkage_labels

from ..model import PaletteEntry


def hex_to_rgb(hex_str: str) -> np.ndarray:
    return np.array([int(hex_str[1:3], 16), int(hex_str[3:5], 16), int(hex_str[5:7], 16)])


def compute_confidence(
    colors: np.ndarray,          # (rows, cols, 3) sampled colors
    cells: np.ndarray,           # (rows, cols) palette indices
    palette: list[PaletteEntry],
    spread: np.ndarray,          # (rows, cols) per-cell IQR spread
    delta_e_threshold: float,
) -> np.ndarray:
    """Per-cell confidence 0..1 (§5 step 9): high when the cell sits close to its
    assigned palette centroid and its interior sampled cleanly."""
    rows, cols, _ = colors.shape
    palette_lab = srgb_to_lab(np.array([hex_to_rgb(e.hex) for e in palette]))
    cell_lab = srgb_to_lab(colors.reshape(-1, 3)).reshape(rows, cols, 3)
    dE = np.linalg.norm(cell_lab - palette_lab[cells], axis=2)
    return np.clip(1 - np.maximum(dE / (2 * delta_e_threshold), spread / 40.0), 0, 1).astype(np.float32)


# --- sRGB -> CIELAB, hand-rolled and vectorized (~25 lines) -------------------

def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """rgb: (..., 3) uint8 or float 0-255 -> Lab (..., 3)."""
    srgb = np.asarray(rgb, dtype=np.float64) / 255.0
    # sRGB -> linear
    lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    # linear RGB -> XYZ (D65)
    m = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ])
    xyz = lin @ m.T
    # normalize by D65 white
    white = np.array([0.95047, 1.0, 1.08883])
    xyz = xyz / white
    eps = 216 / 24389
    kappa = 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    lab = np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], axis=-1)
    return lab


@lru_cache(maxsize=1)
def _load_dmc() -> tuple[np.ndarray, list[dict]]:
    """The DMC floss table, loaded and Lab-converted once per process.

    Read as a package *resource* rather than relative to `__file__`: that is what keeps it
    resolvable once the package is installed as a wheel (as it will be for the browser
    build) instead of run from a checkout.

    The cache is a tidy-up, not a speed fix — `build_palette` calls this on every
    detection and every confirm-screen resample, but the table is only 119 entries and an
    uncached load measures ~0.15 ms, so the saving is negligible on desktop. It is kept
    because it costs nothing and removes a repeated virtual-filesystem read under Pyodide.
    """
    with resources.files(__package__).joinpath("dmc.json").open() as fh:
        entries = json.load(fh)
    rgb = np.array([e["rgb"] for e in entries], dtype=np.float64)
    lab = srgb_to_lab(rgb)
    # The cached arrays are handed to every caller; freeze them so a stray in-place write
    # can't poison the cache for the rest of the process.
    lab.setflags(write=False)
    return lab, entries


def _nearest_dmc(lab: np.ndarray, dmc_lab: np.ndarray, dmc_entries: list[dict]) -> dict:
    d = np.linalg.norm(dmc_lab - lab, axis=1)
    return dmc_entries[int(np.argmin(d))]


def build_palette(
    colors: np.ndarray,           # (rows, cols, 3) uint8
    delta_e_threshold: float = 6.0,
    spread: np.ndarray | None = None,   # (rows, cols) per-cell IQR spread
    spread_thr: float = 18.0,
) -> tuple[np.ndarray, list[PaletteEntry]]:
    """Cluster cell colors in Lab; return (index_grid, palette).

    Only *reliably*-sampled cells (low IQR spread) shape the palette — a cell whose
    inner rect straddled a gridline or antialiasing halo has a mixed median that would
    otherwise mint a phantom one-off color. Every cell (reliable or not) is then
    assigned to its nearest palette centroid, so noisy cells fold into a real color
    instead of fragmenting the palette.

    index_grid: uint16 (rows, cols) palette indices.
    palette: sorted by descending cell count.
    """
    rows, cols, _ = colors.shape
    flat = colors.reshape(-1, 3)

    # Reliable subset for palette formation. Fall back to all cells if too few survive
    # (e.g. heavy JPEG) so a color that only occurs in noisy cells is not lost.
    if spread is not None:
        reliable = spread.reshape(-1) <= spread_thr
        if reliable.sum() < max(4, 0.5 * reliable.size):
            reliable = np.ones(flat.shape[0], dtype=bool)
        else:
            reliable = _keep_unexplained(flat, reliable, delta_e_threshold)
    else:
        reliable = np.ones(flat.shape[0], dtype=bool)

    rel_colors = flat[reliable]
    uniq, _ = np.unique(rel_colors, axis=0, return_inverse=True)
    uniq_lab = srgb_to_lab(uniq)
    uniq_weight = np.array(
        [np.count_nonzero(np.all(rel_colors == u, axis=1)) for u in uniq],
        dtype=np.float64,
    )

    if len(uniq) == 1:
        labels = np.zeros(1, dtype=int)
    else:
        labels = complete_linkage_labels(uniq_lab, delta_e_threshold)

    # Merge clusters whose centroids fall within delta_e (complete linkage over-splits a
    # single color once intra-color noise stretches it past the cut). Final entries end
    # up at least delta_e apart — the rule the ΔE slider exposes.
    labels = _merge_close_centroids(labels, uniq, uniq_weight, delta_e_threshold)

    # Final centroids (weighted mean in sRGB) per surviving cluster.
    cluster_ids = np.unique(labels)
    centroids = np.array([
        np.average(uniq[labels == cid], axis=0, weights=uniq_weight[labels == cid])
        for cid in cluster_ids
    ])
    centroids_lab = srgb_to_lab(centroids)

    # Assign EVERY cell to its nearest centroid in Lab.
    all_lab = srgb_to_lab(flat)
    d = np.linalg.norm(all_lab[:, None, :] - centroids_lab[None, :, :], axis=2)
    nearest = np.argmin(d, axis=1)

    counts = np.bincount(nearest, minlength=len(cluster_ids))
    # Order by descending cell count, breaking ties on the centroid colour. Without the
    # tie-break, two colours with the same count are ordered by whatever internal
    # numbering the clustering produced — so the palette order, and therefore every cell
    # index, depended on an implementation detail of the clustering library.
    order = np.lexsort((centroids[:, 2], centroids[:, 1], centroids[:, 0], -counts))
    remap = np.zeros(len(cluster_ids), dtype=np.uint16)
    for new_idx, old_idx in enumerate(order):
        remap[old_idx] = new_idx
    index_grid = remap[nearest].reshape(rows, cols).astype(np.uint16)

    dmc_lab, dmc_entries = _load_dmc()
    palette: list[PaletteEntry] = []
    for old_idx in order:
        centroid_u8 = np.clip(np.round(centroids[old_idx]), 0, 255).astype(int)
        hex_str = "#{:02x}{:02x}{:02x}".format(*centroid_u8)
        dmc = _nearest_dmc(centroids_lab[old_idx], dmc_lab, dmc_entries)
        palette.append(PaletteEntry(
            id=uuid.uuid4().hex,
            hex=hex_str,
            name=dmc["name"],
            dmc=dmc["code"],
            count=int(counts[old_idx]),
        ))

    return index_grid, palette


def count_unmatched(colors: np.ndarray, cells: np.ndarray, palette: list[PaletteEntry],
                    delta_e_threshold: float) -> int:
    """Cells whose sampled colour no palette entry explains.

    Every cell is assigned to its *nearest* centroid, so a cell is never unassigned — but
    if the palette collapsed two real colours into one, the cells of the losing colour end
    up a long way from the entry they were given. That distance is the signature of a
    missing colour, and unlike a low-confidence count it does not wash out on a chart that
    is overwhelmingly one colour (where the handful of rare cells *are* the content).
    """
    if not palette:
        return 0
    entries = srgb_to_lab(np.array([hex_to_rgb(e.hex) for e in palette]))
    rows, cols, _ = colors.shape
    cell_lab = srgb_to_lab(colors.reshape(-1, 3)).reshape(rows, cols, 3)
    dE = np.linalg.norm(cell_lab - entries[cells], axis=2)
    return int(np.count_nonzero(dE > 2 * delta_e_threshold))


def _provisional_centroids(subset: np.ndarray, delta_e: float) -> np.ndarray:
    """Lab centroids of `subset` under the same clustering the palette itself uses."""
    uniq = np.unique(subset, axis=0)
    if uniq.shape[0] == 0:
        return np.zeros((0, 3))
    lab = srgb_to_lab(uniq)
    if uniq.shape[0] == 1:
        return lab
    weight = np.ones(uniq.shape[0], dtype=np.float64)
    labels = _merge_close_centroids(complete_linkage_labels(lab, delta_e), uniq, weight,
                                    delta_e)
    return srgb_to_lab(np.array([uniq[labels == cid].mean(axis=0)
                                 for cid in np.unique(labels)]))


def _segment_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    """Distance from `p` to the line segment ab — how blend-like a colour is."""
    ab = b - a
    denom = float(ab @ ab)
    if denom < 1e-12:
        return float(np.linalg.norm(p - a))
    t = float(np.clip(((p - a) @ ab) / denom, 0.0, 1.0))
    return float(np.linalg.norm(p - (a + t * ab)))


def _keep_unexplained(flat: np.ndarray, reliable: np.ndarray, delta_e: float) -> np.ndarray:
    """Re-admit excluded cells whose colour the reliable cells cannot account for.

    The spread filter exists to stop a cell that straddled a gridline from minting a
    phantom colour out of its mixed median. But it is a blunt instrument: on a chart that
    is almost entirely one colour, the handful of cells carrying every *other* colour are
    also the noisiest — small isolated blocks ring badly under JPEG — so the filter can
    discard a real colour wholesale and the palette silently collapses.

    So rather than trusting spread alone, ask what the excluded colour *is*. A cell that
    merely straddled a gridline is a blend, and a blend lies close to the line between the
    two colours it mixes. A genuinely missing colour sits off on its own, far from every
    centroid and far from any line between them — and that is worth re-admitting.
    """
    excluded = ~reliable
    if not excluded.any():
        return reliable

    centroids = _provisional_centroids(flat[reliable], delta_e)
    if centroids.shape[0] == 0:
        return np.ones(flat.shape[0], dtype=bool)

    uniq, inverse = np.unique(flat[excluded], axis=0, return_inverse=True)
    lab = srgb_to_lab(uniq)
    d = np.linalg.norm(lab[:, None, :] - centroids[None, :, :], axis=2)
    nearest = np.argsort(d, axis=1)

    # Well inside delta_e of a known colour: ordinary noise, leave it excluded.
    far = d[np.arange(len(uniq)), nearest[:, 0]] > 2 * delta_e
    keep_uniq = np.zeros(len(uniq), dtype=bool)
    for i in np.flatnonzero(far):
        if centroids.shape[0] < 2:
            keep_uniq[i] = True
            continue
        a, b = centroids[nearest[i, 0]], centroids[nearest[i, 1]]
        keep_uniq[i] = _segment_distance(lab[i], a, b) > 2 * delta_e

    if not keep_uniq.any():
        return reliable
    out = reliable.copy()
    out[np.flatnonzero(excluded)[keep_uniq[inverse]]] = True
    return out


def _merge_close_centroids(labels: np.ndarray, uniq: np.ndarray, uniq_weight: np.ndarray,
                           delta_e: float) -> np.ndarray:
    """Greedily merge clusters whose weighted Lab centroids are within delta_e."""
    labels = labels.copy()
    while True:
        ids = np.unique(labels)
        if ids.size < 2:
            break
        cents = np.array([
            np.average(uniq[labels == cid], axis=0, weights=uniq_weight[labels == cid])
            for cid in ids
        ])
        cents_lab = srgb_to_lab(cents)
        # Pairwise distances; find the closest pair.
        diff = cents_lab[:, None, :] - cents_lab[None, :, :]
        dist = np.linalg.norm(diff, axis=2)
        np.fill_diagonal(dist, np.inf)
        i, j = np.unravel_index(np.argmin(dist), dist.shape)
        if dist[i, j] >= delta_e:
            break
        labels[labels == ids[j]] = ids[i]      # fold j into i
    return labels
