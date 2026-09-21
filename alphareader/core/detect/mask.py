"""Dark mask and longest-run profiles (§5 steps 1-2). Pure NumPy."""
from __future__ import annotations

import numpy as np
from ._nd import binary_closing

_LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def luminance(img: np.ndarray) -> np.ndarray:
    """Rec.709 luma, float32."""
    return img[..., :3].astype(np.float32) @ _LUMA


def line_response(lum: np.ndarray, axis: int, d: int = 2) -> np.ndarray:
    """Thin-line response: how much each pixel differs from its perpendicular neighbours
    `d` away on BOTH sides. High on a thin line (dark or light), ~0 inside a solid cell.
    Polarity-independent, so it finds grey gridlines as well as black ones."""
    L = lum
    up = np.empty_like(L); dn = np.empty_like(L)
    if axis == 1:                       # vertical lines: compare left/right
        up[:, d:] = L[:, :-d]; up[:, :d] = L[:, :d]
        dn[:, :-d] = L[:, d:]; dn[:, -d:] = L[:, -d:]
    else:                               # horizontal lines: compare up/down
        up[d:] = L[:-d]; up[:d] = L[:d]
        dn[:-d] = L[d:]; dn[-d:] = L[-d:]
    return np.minimum(np.abs(L - up), np.abs(L - dn))


def dark_mask(img: np.ndarray, dark_threshold: int = 100) -> tuple[np.ndarray, int]:
    """Boolean mask of dark pixels. Retries at a tighter threshold for dark-themed
    screenshots; raises NO_GRIDLINES if the image is dark everywhere.

    Returns (mask, used_threshold).
    """
    lum = luminance(img)
    mask = lum < dark_threshold
    # A light chart can legitimately be mostly dark cells (a black-heavy pattern), so a
    # high dark fraction is NOT grounds to reject — the run-length + thickness filters
    # still isolate the gridlines, and a genuine dark-themed screenshot (no periodic
    # dark line structure) fails naturally later at band/pitch detection. When the frame
    # is very dark, try a tighter threshold too and keep whichever retains structure
    # without saturating, which better separates lines in a dark-background screenshot.
    if mask.mean() > 0.55:
        tighter = lum < 60
        if 0.01 <= tighter.mean() < mask.mean():
            return tighter, 60
    return mask, dark_threshold


def extent_mask(img: np.ndarray, used_threshold: int) -> tuple[np.ndarray, np.ndarray]:
    """Lenient dark mask (axis-closed) used only for the extent walk.

    Border gridlines anti-alias against a light margin to mid-grey — above the strict
    dark threshold but still clearly a line (dark across the full span, unlike a
    cell-interior row which only darkens where perpendicular lines cross). A more
    permissive threshold recovers those faded edge lines without loosening cell
    sampling or band/pitch detection, which keep the strict mask.
    """
    lenient = min(used_threshold + 55, 165)
    m = luminance(img) < lenient
    mask_h = binary_closing(m, structure=np.ones((1, 3), dtype=bool))
    mask_v = binary_closing(m, structure=np.ones((3, 1), dtype=bool))
    return mask_h, mask_v


def longest_run_axis(mask: np.ndarray, axis: int) -> np.ndarray:
    """For each line along `axis`, the length of the longest contiguous run of True.

    axis=1 -> per-row longest horizontal run, shape (H,)
    axis=0 -> per-column longest vertical run, shape (W,)

    Vectorized: no Python loop over rows/columns.
    """
    # Orient so runs go along the last axis.
    m = mask if axis == 1 else mask.T          # shape (N, L), runs along L
    n, length = m.shape

    # Pad with a False column on each side so every run has a rising and falling edge.
    padded = np.zeros((n, length + 2), dtype=bool)
    padded[:, 1:-1] = m
    diff = padded.astype(np.int8)
    diff = diff[:, 1:] - diff[:, :-1]          # +1 at run starts, -1 at run ends

    rows, cols = np.nonzero(diff)
    # For each detected edge, +1 marks a start, -1 marks an end.
    starts_mask = diff[rows, cols] == 1
    # Starts and ends interleave per row; pair them up.
    start_pos = cols[starts_mask]
    end_pos = cols[~starts_mask]
    run_row = rows[starts_mask]                 # same row order for starts and ends
    run_len = end_pos - start_pos

    out = np.zeros(n, dtype=np.int32)
    if run_len.size:
        np.maximum.at(out, run_row, run_len)
    return out


def run_profiles(mask: np.ndarray, close_len: int = 3):
    """Longest-run profiles and the axis-closed masks used to compute them.

    Real charts anti-alias thin gridlines to grey where they cross cell corners,
    breaking a full-width line into short segments that fall below the run-length
    threshold. A 1-D morphological closing along the line's own axis bridges those
    sub-threshold gaps (restoring the line to full span) without lengthening text
    glyphs enough to be mistaken for a gridline.

    Returns (run_h, run_v, mask_h, mask_v) where mask_h is closed horizontally (for
    horizontal gridlines) and mask_v vertically. The closed masks are reused for the
    pixel-evidence extent walk.
    """
    if close_len > 1:
        mask_h = binary_closing(mask, structure=np.ones((1, close_len), dtype=bool))
        mask_v = binary_closing(mask, structure=np.ones((close_len, 1), dtype=bool))
    else:
        mask_h = mask_v = mask
    run_h = longest_run_axis(mask_h, axis=1)   # per row -> horizontal gridlines
    run_v = longest_run_axis(mask_v, axis=0)   # per column -> vertical gridlines
    return run_h, run_v, mask_h, mask_v