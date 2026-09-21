"""Cell sampling (§5 step 7). Per-cell median color + IQR spread. Pure NumPy."""
from __future__ import annotations

import numpy as np

from ..model import DetectionError


def sample_cells(
    img: np.ndarray,
    col_lines: np.ndarray,
    row_lines: np.ndarray,
    pitch_x: float,
    pitch_y: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Sample each cell's color as the per-channel median of an inset inner rectangle.

    Returns:
        colors: uint8, shape (rows, cols, 3)
        spread: float32, shape (rows, cols) — mean channel IQR, for the confidence score.
    """
    rows = len(row_lines) - 1
    cols = len(col_lines) - 1
    inset_x = max(1, round(0.22 * pitch_x))
    inset_y = max(1, round(0.22 * pitch_y))

    ry0 = np.rint(row_lines[:-1]).astype(np.intp) + inset_y
    ry1 = np.rint(row_lines[1:]).astype(np.intp) - inset_y
    cx0 = np.rint(col_lines[:-1]).astype(np.intp) + inset_x
    cx1 = np.rint(col_lines[1:]).astype(np.intp) - inset_x
    if (ry1 - ry0).min() < 2 or (cx1 - cx0).min() < 2:
        raise DetectionError(
            "LOW_RESOLUTION",
            "Image resolution too low — cell interiors are too small to sample.",
        )

    H, W = img.shape[:2]
    rgb = img[..., :3]
    # Sample a fixed grid of points inside each cell rather than looping over cells: the
    # detector now routinely resolves grids of 10k+ cells, where a per-cell median call
    # dominates the whole detection. Points are spread across the inset interior, so the
    # median and IQR still describe the cell body and ignore the gridlines.
    ny = int(min(7, (ry1 - ry0).min()))
    nx = int(min(7, (cx1 - cx0).min()))
    fy = (np.arange(ny) + 0.5) / ny
    fx = (np.arange(nx) + 0.5) / nx
    ys = np.clip((ry0[:, None] + fy * (ry1 - ry0)[:, None]).astype(np.intp), 0, H - 1)
    xs = np.clip((cx0[:, None] + fx * (cx1 - cx0)[:, None]).astype(np.intp), 0, W - 1)

    # (rows, cols, ny, nx, 3)
    patches = rgb[ys[:, None, :, None], xs[None, :, None, :]].astype(np.float32)
    flat = patches.reshape(rows, cols, ny * nx, 3)

    colors = np.median(flat, axis=2).astype(np.uint8)
    q25, q75 = np.percentile(flat, [25, 75], axis=2)
    spread = (q75 - q25).mean(axis=2).astype(np.float32)

    return colors, spread
