"""detect_pattern() orchestration (§5). Pure NumPy/scipy, no UI imports.

Gridlines are usually dark, but some charts draw them in a light grey with black/white
cells (the dark mask would then lock onto the cells, not the grid). So we fit the lattice
two ways — a dark-line mask and a polarity-independent gradient projection — and keep
whichever samples cleaner cells (lower low-confidence fraction). The correct grid samples
solid cell colours; a wrong grid samples across lines and scores poorly, so confidence is
a reliable selector. The gradient pass only runs when the dark pass looks doubtful, so
ordinary charts stay fast and unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import binary_closing

from ..model import (
    DebugLayers,
    DetectionError,
    DetectionResult,
    Lattice,
)
from .lattice import fit_axis, walk_extent
from .mask import dark_mask, extent_mask, line_response, luminance, run_profiles
from .palette import build_palette, compute_confidence
from .sample import sample_cells

MAX_ROTATION_DEG = 1.5
_DARK_OK_FRACTION = 0.15     # at/below this, trust the dark pass and skip the gradient one
_DARK_BAD_FRACTION = 0.35    # only this bad a dark pass may be overridden by the gradient one
_VERIFY_MSG = ("Grid found via a fallback for faint / low-contrast gridlines — "
               "please double-check the dimensions before committing.")


@dataclass
class _Fit:
    """A fitted lattice plus the per-axis evidence masks used for the rotation check."""
    row_lines: np.ndarray
    col_lines: np.ndarray
    x0: float
    y0: float
    pitch_x: float
    pitch_y: float
    row_mask: np.ndarray        # boolean, horizontal-line evidence
    col_mask: np.ndarray        # boolean, vertical-line evidence
    debug: DebugLayers = field(default_factory=DebugLayers)


def _line_drift_angle(mask: np.ndarray, ref: float, pitch: float, axis: int) -> float | None:
    """Angle (deg) of one gridline, from the drift of its evidence centroid across the
    perpendicular span. Returns None if the span is too short to measure reliably."""
    tol = max(2, int(round(0.2 * pitch)))
    p = int(round(ref))
    H, W = mask.shape
    if axis == 0:
        band = mask[max(0, p - tol):p + tol + 1, :]
        base = max(0, p - tol)
        xs = np.flatnonzero(band.any(axis=0))
        if xs.size < 40 or (xs.max() - xs.min()) < 120:
            return None
        ys = np.array([base + np.flatnonzero(band[:, x]).mean() for x in xs])
    else:
        band = mask[:, max(0, p - tol):p + tol + 1]
        base = max(0, p - tol)
        xs = np.flatnonzero(band.any(axis=1))
        if xs.size < 40 or (xs.max() - xs.min()) < 120:
            return None
        ys = np.array([base + np.flatnonzero(band[y, :]).mean() for y in xs])
    slope = np.polyfit(xs, ys, 1)[0]
    return float(np.degrees(np.arctan(slope)))


def _rotation_angle(mask: np.ndarray, lines: np.ndarray, pitch: float, axis: int) -> float:
    """Median line-drift across several evenly-spaced gridlines (0 if unmeasurable)."""
    if len(lines) < 3:
        return 0.0
    sample = lines[1:-1]
    if sample.size > 9:
        sample = sample[np.linspace(0, sample.size - 1, 9).round().astype(int)]
    angles = [a for a in (_line_drift_angle(mask, ref, pitch, axis) for ref in sample)
              if a is not None]
    return float(np.median(angles)) if angles else 0.0


# --- lattice fitters ---------------------------------------------------------

def _fit_dark(img: np.ndarray, dark_threshold: int) -> tuple[_Fit, list[str]]:
    """Fit the lattice assuming dark gridlines (the common case, §5)."""
    warnings: list[str] = []
    mask, used_thr = dark_mask(img, dark_threshold)
    if used_thr != dark_threshold:
        warnings.append(f"Used tighter dark threshold ({used_thr}) for a dark image.")
    H, W = mask.shape
    run_h, run_v, mask_h, mask_v = run_profiles(mask)
    row_fit, row_bands = fit_axis(run_h, H)
    col_fit, col_bands = fit_axis(run_v, W)

    ext_h, ext_v = extent_mask(img, used_thr)
    rk_min, rk_max = walk_extent(ext_h, 0, row_fit.x0, row_fit.pitch,
                                 row_fit.seed_k, col_fit.seed_lo, col_fit.seed_hi)
    ck_min, ck_max = walk_extent(ext_v, 1, col_fit.x0, col_fit.pitch,
                                 col_fit.seed_k, row_fit.seed_lo, row_fit.seed_hi)
    row_lines = row_fit.x0 + np.arange(rk_min, rk_max + 1) * row_fit.pitch
    col_lines = col_fit.x0 + np.arange(ck_min, ck_max + 1) * col_fit.pitch
    debug = DebugLayers(
        mask=mask, run_h=run_h, run_v=run_v,
        row_bands=[(b.start, b.end, b.thickness, b.weight, b.kept) for b in row_bands],
        col_bands=[(b.start, b.end, b.thickness, b.weight, b.kept) for b in col_bands],
    )
    fit = _Fit(row_lines=row_lines, col_lines=col_lines, x0=col_fit.x0, y0=row_fit.x0,
               pitch_x=col_fit.pitch, pitch_y=row_fit.pitch,
               row_mask=mask, col_mask=mask, debug=debug)
    return fit, warnings


def _fit_gradient(img: np.ndarray) -> tuple[_Fit, list[str]]:
    """Fit the lattice from gradient projections — works whether gridlines are darker or
    lighter than the cells, since it responds to any colour transition at a cell edge."""
    lum = luminance(img).astype(np.float64)
    H, W = lum.shape
    gy = np.zeros_like(lum); gy[1:, :] = np.abs(np.diff(lum, axis=0))
    gx = np.zeros_like(lum); gx[:, 1:] = np.abs(np.diff(lum, axis=1))

    # Projection profiles peak at every horizontal / vertical cell edge (i.e. gridlines).
    row_fit, row_bands = fit_axis(gy.sum(axis=1), H)
    col_fit, col_bands = fit_axis(gx.sum(axis=0), W)

    # Extent evidence: thin-line response near a predicted line (rejects the wide,
    # patchy structure of edge row/column numbers better than raw gradient does).
    thr = 12.0
    eh = binary_closing(line_response(lum, 0) > thr, structure=np.ones((1, 3), dtype=bool))
    ev = binary_closing(line_response(lum, 1) > thr, structure=np.ones((3, 1), dtype=bool))
    rk_min, rk_max = walk_extent(eh, 0, row_fit.x0, row_fit.pitch,
                                 row_fit.seed_k, col_fit.seed_lo, col_fit.seed_hi,
                                 coverage_thr=0.7)
    ck_min, ck_max = walk_extent(ev, 1, col_fit.x0, col_fit.pitch,
                                 col_fit.seed_k, row_fit.seed_lo, row_fit.seed_hi,
                                 coverage_thr=0.7)
    row_lines = row_fit.x0 + np.arange(rk_min, rk_max + 1) * row_fit.pitch
    col_lines = col_fit.x0 + np.arange(ck_min, ck_max + 1) * col_fit.pitch
    fit = _Fit(row_lines=row_lines, col_lines=col_lines, x0=col_fit.x0, y0=row_fit.x0,
               pitch_x=col_fit.pitch, pitch_y=row_fit.pitch, row_mask=eh, col_mask=ev)
    return fit, []


# --- finishing (sample -> palette -> confidence) -----------------------------

def _finish(img: np.ndarray, fit: _Fit, delta_e_threshold: float,
            warnings: list[str]) -> tuple[DetectionResult, float]:
    """Sample cells for a fitted lattice and score it. Returns (result, low_conf_frac)."""
    angle = max(abs(_rotation_angle(fit.row_mask, fit.row_lines, fit.pitch_y, 0)),
                abs(_rotation_angle(fit.col_mask, fit.col_lines, fit.pitch_x, 1)))
    if angle > MAX_ROTATION_DEG:
        raise DetectionError("ROTATED", f"Image looks rotated (~{angle:.1f}°).")

    rows = len(fit.row_lines) - 1
    cols = len(fit.col_lines) - 1
    if rows < 2 or cols < 2:
        raise DetectionError("NO_GRIDLINES", "Couldn't find gridlines (grid too small).")

    colors, spread = sample_cells(img, fit.col_lines, fit.row_lines, fit.pitch_x, fit.pitch_y)
    cells, palette = build_palette(colors, delta_e_threshold, spread=spread)
    conf = compute_confidence(colors, cells, palette, spread, delta_e_threshold)

    flagged = int(np.count_nonzero(conf < 0.6))
    total = rows * cols
    frac = flagged / total
    warns = list(warnings)
    if frac > 0.02:
        warns.append(f"{flagged}/{total} cells ({100*frac:.1f}%) have low confidence — "
                     f"review before committing.")

    lattice = Lattice(x0=fit.x0, pitch_x=fit.pitch_x, y0=fit.y0, pitch_y=fit.pitch_y,
                      col_lines=fit.col_lines, row_lines=fit.row_lines)
    result = DetectionResult(cols=cols, rows=rows, lattice=lattice, cells=cells,
                             palette=palette, confidence=conf, warnings=warns, debug=fit.debug)
    return result, frac


def _spans_image(result: DetectionResult, img: np.ndarray, min_frac: float = 0.4) -> bool:
    """True unless the grid covers implausibly little of the image — a strong sign the
    extent collapsed (e.g. a light-gridline chart where the dark mask followed dark cells
    and stopped at a band of light ones)."""
    H, W = img.shape[:2]
    rl, cl = result.lattice.row_lines, result.lattice.col_lines
    return min((rl[-1] - rl[0]) / H, (cl[-1] - cl[0]) / W) >= min_frac


def detect_pattern(
    img: np.ndarray,
    *,
    delta_e_threshold: float = 6.0,
    dark_threshold: int = 100,
    crop: tuple[int, int, int, int] | None = None,
) -> DetectionResult:
    """Recover grid dimensions, per-cell colors and a palette from a chart image."""
    if img.ndim != 3 or img.shape[2] < 3:
        raise DetectionError("TOO_SMALL", "Expected an RGB image.")
    if crop is not None:
        x0, y0, x1, y1 = crop
        img = img[y0:y1, x0:x1]
    if min(img.shape[0], img.shape[1]) < 16:
        raise DetectionError("TOO_SMALL", "Image is too small to contain a grid.")

    def attempt(fitter):
        try:
            fit, warns = fitter(img)
            return _finish(img, fit, delta_e_threshold, warns)
        except DetectionError as e:
            return e

    dark = attempt(lambda i: _fit_dark(i, dark_threshold))
    dark_ok = isinstance(dark, tuple)
    dark_collapsed = dark_ok and not _spans_image(dark[0], img)
    if dark_ok and dark[1] <= _DARK_OK_FRACTION and not dark_collapsed:
        return dark[0]                                  # clean, plausible dark fit — done

    # Reach for the gradient fallback when the dark pass failed, looks like garbage (very
    # high low-confidence — it locked onto filled cells, not gridlines), or its extent
    # collapsed. A merely-noisy-but-plausible dark fit (downscaled scans) is kept as-is so
    # the fallback can't override a correct grid with a confidently-wrong one.
    if dark_ok and dark[1] < _DARK_BAD_FRACTION and not dark_collapsed:
        return dark[0]

    grad = attempt(_fit_gradient)
    if isinstance(grad, tuple) and (not dark_ok or grad[1] < 0.5 * dark[1]):
        result = grad[0]
        if not any("verify" in w.lower() or "double-check" in w.lower()
                   for w in result.warnings):
            result.warnings.append(_VERIFY_MSG)         # fallback is uncertain (§13.8)
        return result
    if dark_ok:
        return dark[0]
    raise dark if isinstance(dark, DetectionError) else grad
