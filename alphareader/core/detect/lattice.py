"""Lattice recovery: bands -> pitch -> phase -> extent (§5 steps 3-6). Pure NumPy."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..model import DetectionError


@dataclass
class Band:
    start: int
    end: int           # exclusive
    center: float      # weight-centroid, subpixel
    thickness: int
    weight: float
    kept: bool = True


def find_bands(run: np.ndarray, frac: float = 0.6) -> list[Band]:
    """Group consecutive candidate indices (run > frac*max) into bands (§5 step 3)."""
    if run.max() <= 0:
        return []
    candidate = run > frac * run.max()
    bands: list[Band] = []
    idx = np.flatnonzero(candidate)
    if idx.size == 0:
        return []
    # Split where the index jumps by more than 1.
    splits = np.flatnonzero(np.diff(idx) > 1) + 1
    for group in np.split(idx, splits):
        w = run[group].astype(np.float64)
        center = float((group * w).sum() / w.sum())
        bands.append(
            Band(
                start=int(group[0]),
                end=int(group[-1]) + 1,
                center=center,
                thickness=int(group[-1] - group[0] + 1),
                weight=float(w.sum()),
            )
        )
    return bands


def _estimate_pitch(centers: np.ndarray, dim: int) -> float:
    """Estimate gridline pitch from band-center spacings (§5 step 4).

    Robust to missing lines (which produce integer-multiple gaps) and to a few
    spurious/fat bands. This is preferred over integer-lag autocorrelation, which
    aliases onto harmonics when the true pitch is non-integer (e.g. browser-zoom
    screenshots at 18.5px/cell).
    """
    c = np.sort(centers)
    gaps = np.diff(c)
    gaps = gaps[gaps > 2.0]                     # ignore merged/duplicate bands
    if gaps.size == 0:
        raise DetectionError("NO_GRIDLINES", "Grid too small to establish spacing.")
    # Rough fundamental = median of the smaller half of gaps (single-pitch steps).
    rough = float(np.median(np.sort(gaps)[: max(1, gaps.size // 2)]))
    if rough < 1:
        rough = float(np.median(gaps))
    # Refine using only single-pitch gaps, and take their MEAN. The mean is unbiased
    # for a non-integer pitch (pixel-quantized gaps alternate e.g. 18/19 around a true
    # 18.35); the median snaps to a whole pixel and biases the estimate low, which is
    # enough to mis-label k across a wide grid.
    single = gaps[gaps < 1.5 * rough]
    pitch = float(np.mean(single)) if single.size else rough
    return pitch


def _fit_phase(centers: np.ndarray, pitch: float, dim: int) -> tuple[float, float, np.ndarray]:
    """Find phase by maximizing matched weight, then refit (x0, pitch) by least squares.

    Returns (x0, pitch, matched_indices_k). matched_indices_k are the integer lattice
    indices assigned to each center (used later for the rotation check).
    """
    # Coarse phase search over [0, pitch) maximizing how well centers land on the lattice.
    best_phase, best_score = 0.0, -1.0
    for phase in np.linspace(0, pitch, 100, endpoint=False):
        k = np.round((centers - phase) / pitch)
        resid = np.abs(centers - (phase + k * pitch))
        best_score_candidate = np.sum(resid < 0.3 * pitch)
        if best_score_candidate > best_score:
            best_score, best_phase = best_score_candidate, phase

    # Assign each center to its nearest lattice index, then least-squares refit. Iterate:
    # a refined pitch reassigns k for far-out lines, which tightens the fit further. Only
    # well-fit centers vote, so a mislabeled outlier can't drag the slope.
    x0, p = best_phase, pitch
    k = np.round((centers - x0) / p)
    for _ in range(5):
        k = np.round((centers - x0) / p)
        resid = np.abs(centers - (x0 + k * p))
        good = resid < 0.3 * p
        if good.sum() < 2:
            good = np.ones_like(centers, dtype=bool)
        slope, intercept = np.polyfit(k[good], centers[good], 1)
        if abs(slope - p) < 1e-4 and abs(intercept - x0) < 1e-4:
            x0, p = intercept, slope
            break
        x0, p = intercept, slope
    return float(x0), float(p), np.round((centers - x0) / p)


def line_coverage(mask: np.ndarray, axis: int, pos: float, pitch: float,
                  lo: int, hi: int) -> float:
    """Fraction of the perpendicular grid span [lo, hi) covered by dark pixels near a
    predicted gridline at `pos`.

    axis=0 -> horizontal line at row `pos`, spanning columns [lo, hi).
    axis=1 -> vertical line at column `pos`, spanning rows [lo, hi).

    Uses pixel evidence so faint lines (never strong enough to form a band) still
    register, which is what makes the extent robust to downscale/JPEG fading.
    """
    tol = max(1, int(round(0.18 * pitch)))
    p = int(round(pos))
    H, W = mask.shape
    if axis == 0:
        y0, y1 = max(0, p - tol), min(H, p + tol + 1)
        c0, c1 = max(0, lo), min(W, hi)
        if y1 <= y0 or c1 <= c0:
            return 0.0
        strip = mask[y0:y1, c0:c1]
        return float(strip.any(axis=0).mean())
    else:
        x0, x1 = max(0, p - tol), min(W, p + tol + 1)
        r0, r1 = max(0, lo), min(H, hi)
        if x1 <= x0 or r1 <= r0:
            return 0.0
        strip = mask[r0:r1, x0:x1]
        return float(strip.any(axis=1).mean())


def walk_extent(mask: np.ndarray, axis: int, x0: float, pitch: float,
                seed_k: int, perp_lo: int, perp_hi: int,
                coverage_thr: float = 0.5) -> tuple[int, int]:
    """Walk outward from a seed lattice index while gridline pixel-coverage holds,
    stopping after two consecutive unsupported positions (§5 step 6)."""
    dim = mask.shape[0] if axis == 0 else mask.shape[1]

    def walk(step: int) -> int:
        k = seed_k
        last = seed_k
        misses = 0
        while misses < 2:
            k += step
            pos = x0 + k * pitch
            # Stop once we've stepped fully outside the image (a line sitting right on
            # the edge, i.e. pos ≈ 0 or ≈ dim, is still valid and must be checked).
            if pos < -0.5 * pitch or pos > dim + 0.5 * pitch:
                break
            if line_coverage(mask, axis, pos, pitch, perp_lo, perp_hi) >= coverage_thr:
                last = k
                misses = 0
            else:
                misses += 1
        return last

    return walk(-1), walk(+1)


@dataclass
class AxisFit:
    x0: float
    pitch: float
    seed_k: int            # a lattice index known to sit on a real gridline
    seed_lo: int           # rough perpendicular span (for extent coverage tests)
    seed_hi: int


def fit_axis(run: np.ndarray, dim: int) -> tuple[AxisFit, list[Band]]:
    """Fit phase and pitch for one axis. Extent is resolved later against the mask.
    Returns (AxisFit, bands-with-kept-flags)."""
    bands = find_bands(run)
    if len(bands) < 4:
        raise DetectionError("NO_GRIDLINES", "Couldn't find gridlines (too few grid bands).")

    centers = np.array([b.center for b in bands])
    pitch = _estimate_pitch(centers, dim)
    if pitch < 6:
        raise DetectionError("LOW_RESOLUTION",
                             "Image resolution too low — need at least ~6 pixels per square.")
    if pitch > dim / 3:
        raise DetectionError("NO_GRIDLINES", "Couldn't find gridlines (spacing implausible).")

    # Thickness filter: drop solid dark *cells* (§4.3) and anything too fat.
    max_thick = min(0.45 * pitch, 8)
    for b in bands:
        b.kept = b.thickness <= max_thick
    kept = [b for b in bands if b.kept]
    if len(kept) < 4:
        # Everything got filtered — likely all thin already; fall back to all bands.
        for b in bands:
            b.kept = True
        kept = bands

    kcenters = np.array([b.center for b in kept])
    pitch = _estimate_pitch(kcenters, dim)
    x0, pitch, _ = _fit_phase(kcenters, pitch, dim)

    # Seed = the lattice index nearest the median band, guaranteed to be a real line.
    seed_k = int(round((np.median(kcenters) - x0) / pitch))
    return AxisFit(x0=x0, pitch=pitch, seed_k=seed_k,
                   seed_lo=int(kcenters.min()), seed_hi=int(kcenters.max())), bands