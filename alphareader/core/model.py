"""Core dataclasses shared across the app. Pure Python, zero UI imports."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

# Reserved sentinel palette index for skipped / 0-knot cells (§14). Not used by
# detection yet, but reserved now to avoid a later migration.
SKIP_INDEX = 0xFFFF


@dataclass
class PaletteEntry:
    id: str
    hex: str                 # '#rrggbb'
    name: str                # editable, seeded from nearest DMC
    dmc: str | None = None
    count: int = 0           # number of cells using this entry


@dataclass
class Pattern:
    id: str
    name: str
    created_at: float
    updated_at: float
    cols: int
    rows: int
    row_ids: list[str]                    # len == rows, stable across structural edits
    cells: np.ndarray                     # uint16, shape (rows, cols), palette indices
    palette: list[PaletteEntry]
    start_direction: Literal["LTR", "RTL"] = "LTR"
    alternate_direction: bool = True
    bottom_up: bool = True                # work is followed bottom row first (§4.4)


@dataclass
class Progress:
    completed_row_ids: set[str] = field(default_factory=set)
    current_row_id: str | None = None
    current_run_index: int = 0
    started_at: float | None = None


@dataclass
class Project:
    pattern: Pattern
    progress: Progress = field(default_factory=Progress)
    stage: Literal["design", "work"] = "design"


@dataclass(frozen=True)
class Lattice:
    x0: float
    pitch_x: float
    y0: float
    pitch_y: float
    col_lines: np.ndarray    # float, positions of vertical gridlines
    row_lines: np.ndarray    # float, positions of horizontal gridlines


@dataclass
class DebugLayers:
    """Intermediate products for the dev overlay (§5)."""
    mask: np.ndarray | None = None
    run_h: np.ndarray | None = None
    run_v: np.ndarray | None = None
    row_bands: list[tuple] = field(default_factory=list)   # (start, end, thickness, weight, kept)
    col_bands: list[tuple] = field(default_factory=list)


@dataclass
class DetectionResult:
    cols: int
    rows: int
    lattice: Lattice
    cells: np.ndarray                # uint16, shape (rows, cols), palette indices
    palette: list[PaletteEntry]
    confidence: np.ndarray           # float32, shape (rows, cols), 0..1
    warnings: list[str]
    debug: DebugLayers


class DetectionError(Exception):
    """Named detection failure. `code` is one of the documented reasons."""

    CODES = ("NO_GRIDLINES", "LOW_RESOLUTION", "ROTATED", "TOO_SMALL")

    def __init__(self, code: str, message: str):
        assert code in self.CODES, code
        self.code = code
        super().__init__(message)