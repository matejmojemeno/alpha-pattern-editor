"""Synthetic chart generator (§11.1).

Render a chart from a KNOWN grid so detection can be checked cell-by-cell. Covers
the traps in §11: edge numbering, watermarks, colored margins, pure white/black
palettes, solid dark rows, non-integer downscale, JPEG re-encode, rotation.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFont


@dataclass
class SynthSpec:
    rows: int
    cols: int
    palette: list[tuple[int, int, int]]     # RGB colors
    cells: np.ndarray                        # (rows, cols) indices into palette
    pitch: int = 16
    line_width: int = 1
    line_color: tuple[int, int, int] = (0, 0, 0)
    margin: int = 20
    margin_color: tuple[int, int, int] = (255, 255, 255)
    edge_numbers: bool = False
    watermark: str | None = None
    downscale: float = 1.0                   # <1 shrinks (browser-zoom sim)
    jpeg_quality: int | None = None
    rotate_deg: float = 0.0


def random_spec(rng: np.random.Generator) -> SynthSpec:
    rows = int(rng.integers(4, 60))
    cols = int(rng.integers(4, 80))
    n_colors = int(rng.integers(2, 8))
    palette = _random_palette(rng, n_colors)
    cells = rng.integers(0, n_colors, size=(rows, cols)).astype(np.uint16)

    # §4.3 trap: sometimes make a whole row/column the darkest color.
    if rng.random() < 0.3:
        dark_idx = int(np.argmin([sum(c) for c in palette]))
        cells[int(rng.integers(0, rows))] = dark_idx
    # §4.1 trap: sometimes an almost-all-white grid with a few off cells.
    if rng.random() < 0.2 and (255, 255, 255) in palette:
        w = palette.index((255, 255, 255))
        cells[:] = w
        for _ in range(int(rng.integers(1, 6))):
            cells[int(rng.integers(0, rows)), int(rng.integers(0, cols))] = int(rng.integers(0, n_colors))

    return SynthSpec(
        rows=rows, cols=cols, palette=palette, cells=cells,
        pitch=int(rng.integers(10, 34)),
        line_width=int(rng.integers(1, 4)),
        line_color=(int(rng.integers(0, 60)),) * 3,
        margin=int(rng.integers(0, 40)),
        edge_numbers=bool(rng.random() < 0.5),
        watermark="friendship-bracelets.net" if rng.random() < 0.4 else None,
        downscale=float(rng.choice([1.0, 1.0, 0.83, 1.37, 0.91])),
        jpeg_quality=int(rng.choice([0, 0, 60, 80, 95])) or None,
        rotate_deg=0.0,
    )


def _random_palette(rng: np.random.Generator, n: int) -> list[tuple[int, int, int]]:
    # Well-separated colors so cluster identity is unambiguous; force white+black in sometimes.
    base = [
        (255, 255, 255), (0, 0, 0), (200, 40, 40), (40, 120, 200),
        (40, 160, 60), (230, 190, 40), (150, 90, 40), (120, 60, 160),
        (240, 130, 40), (90, 90, 90),
    ]
    idx = list(rng.permutation(len(base))[:n])
    return [base[i] for i in idx]


def render(spec: SynthSpec) -> np.ndarray:
    """Render spec to an RGB uint8 array, applying all requested degradations."""
    p = spec.pitch
    gw, gh = spec.cols * p, spec.rows * p
    W = gw + 2 * spec.margin + spec.line_width
    H = gh + 2 * spec.margin + spec.line_width
    img = Image.new("RGB", (W, H), spec.margin_color)
    d = ImageDraw.Draw(img)
    ox, oy = spec.margin, spec.margin

    # Cells
    for r in range(spec.rows):
        for c in range(spec.cols):
            color = spec.palette[int(spec.cells[r, c])]
            d.rectangle([ox + c * p, oy + r * p, ox + (c + 1) * p, oy + (r + 1) * p],
                        fill=color)
    # Gridlines
    lw = spec.line_width
    for c in range(spec.cols + 1):
        x = ox + c * p
        d.rectangle([x, oy, x + lw - 1, oy + gh], fill=spec.line_color)
    for r in range(spec.rows + 1):
        y = oy + r * p
        d.rectangle([ox, y, ox + gw, y + lw - 1], fill=spec.line_color)

    if spec.edge_numbers:
        _draw_edge_numbers(d, spec, ox, oy, gw, gh)
    if spec.watermark:
        d.text((W - 160, H - 12), spec.watermark, fill=(150, 150, 150))

    if spec.rotate_deg:
        img = img.rotate(spec.rotate_deg, resample=Image.BICUBIC,
                         fillcolor=spec.margin_color, expand=True)
    if spec.downscale != 1.0:
        nw, nh = max(1, round(W * spec.downscale)), max(1, round(H * spec.downscale))
        img = img.resize((nw, nh), Image.BILINEAR)
    if spec.jpeg_quality:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=spec.jpeg_quality)
        buf.seek(0)
        img = Image.open(buf).convert("RGB")

    return np.asarray(img, dtype=np.uint8)


def _draw_edge_numbers(d: ImageDraw.ImageDraw, spec: SynthSpec, ox, oy, gw, gh) -> None:
    step = max(1, spec.cols // 10)
    for c in range(0, spec.cols, step):
        d.text((ox + c * spec.pitch + 2, max(0, oy - 12)), str(c + 1), fill=(80, 80, 80))
    step = max(1, spec.rows // 10)
    for r in range(0, spec.rows, step):
        d.text((max(0, ox - 14), oy + r * spec.pitch + 2), str(r + 1), fill=(80, 80, 80))


def cells_to_palette_labels(cells: np.ndarray, palette: list[tuple[int, int, int]]) -> np.ndarray:
    """Ground-truth in a canonical form: map each cell to its RGB tuple for comparison,
    since detection assigns its own palette indices."""
    lut = np.array(palette, dtype=np.uint8)
    return lut[cells]
