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

    colors = np.zeros((rows, cols, 3), dtype=np.uint8)
    spread = np.zeros((rows, cols), dtype=np.float32)

    rgb = img[..., :3]
    for r in range(rows):
        y0 = int(round(row_lines[r])) + inset_y
        y1 = int(round(row_lines[r + 1])) - inset_y
        if y1 - y0 < 2:
            raise DetectionError(
                "LOW_RESOLUTION",
                "Image resolution too low — cell interiors are too small to sample.",
            )
        for c in range(cols):
            x0 = int(round(col_lines[c])) + inset_x
            x1 = int(round(col_lines[c + 1])) - inset_x
            if x1 - x0 < 2:
                raise DetectionError(
                    "LOW_RESOLUTION",
                    "Image resolution too low — cell interiors are too small to sample.",
                )
            patch = rgb[y0:y1, x0:x1].reshape(-1, 3).astype(np.float32)
            colors[r, c] = np.median(patch, axis=0).astype(np.uint8)
            q75, q25 = np.percentile(patch, [75, 25], axis=0)
            spread[r, c] = float(np.mean(q75 - q25))

    return colors, spread
