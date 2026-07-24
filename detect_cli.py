#!/usr/bin/env python3
"""CLI for the alpha pattern reader (M0).

Usage:
    python detect_cli.py IMAGE [--delta-e 6] [--dark 100] [--overlay OUT.png] [--reconstruct OUT.png]

Prints detected dimensions, palette and warnings. Optionally writes:
  --overlay      the dev overlay (mask, run profiles, detected bands, fitted lattice)
  --reconstruct  the reconstructed pattern as a clean chart image
"""
from __future__ import annotations

import argparse
import sys
import time

import numpy as np
from PIL import Image

from alphareader.core.detect import detect_pattern
from alphareader.core.model import DetectionError


def load_rgb(path: str) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    return np.asarray(im, dtype=np.uint8)


def draw_overlay(img: np.ndarray, result, out_path: str) -> None:
    from PIL import ImageDraw
    H, W = img.shape[:2]
    canvas = Image.fromarray(img).convert("RGB")
    d = ImageDraw.Draw(canvas)
    lat = result.lattice
    for x in lat.col_lines:
        d.line([(x, lat.row_lines[0]), (x, lat.row_lines[-1])], fill=(255, 0, 0), width=1)
    for y in lat.row_lines:
        d.line([(lat.col_lines[0], y), (lat.col_lines[-1], y)], fill=(255, 0, 0), width=1)
    # extent box
    d.rectangle(
        [lat.col_lines[0], lat.row_lines[0], lat.col_lines[-1], lat.row_lines[-1]],
        outline=(0, 180, 255), width=2,
    )
    canvas.save(out_path)
    print(f"  wrote overlay -> {out_path}")


def draw_reconstruction(result, out_path: str, cell: int = 16) -> None:
    from PIL import ImageDraw
    rows, cols = result.rows, result.cols
    pal_rgb = [
        (int(e.hex[1:3], 16), int(e.hex[3:5], 16), int(e.hex[5:7], 16))
        for e in result.palette
    ]
    W, H = cols * cell + 1, rows * cell + 1
    canvas = Image.new("RGB", (W, H), (200, 200, 200))
    d = ImageDraw.Draw(canvas)
    for r in range(rows):
        for c in range(cols):
            color = pal_rgb[int(result.cells[r, c])]
            d.rectangle([c * cell, r * cell, (c + 1) * cell, (r + 1) * cell],
                        fill=color, outline=(160, 160, 160))
    canvas.save(out_path)
    print(f"  wrote reconstruction -> {out_path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--delta-e", type=float, default=6.0)
    ap.add_argument("--dark", type=int, default=100)
    ap.add_argument("--overlay")
    ap.add_argument("--reconstruct")
    args = ap.parse_args()

    img = load_rgb(args.image)
    print(f"Loaded {args.image}: {img.shape[1]}x{img.shape[0]}")

    t0 = time.perf_counter()
    try:
        result = detect_pattern(img, delta_e_threshold=args.delta_e, dark_threshold=args.dark)
    except DetectionError as e:
        print(f"\n  DETECTION FAILED [{e.code}]: {e}")
        print("  -> Try cropping tightly to just the grid, or adjust --dark / --delta-e.")
        return 1
    dt = (time.perf_counter() - t0) * 1000

    print(f"\n  Grid: {result.cols} cols x {result.rows} rows   ({dt:.0f} ms)")
    print(f"  Pitch: x={result.lattice.pitch_x:.2f}px  y={result.lattice.pitch_y:.2f}px")
    print(f"  Palette ({len(result.palette)} colors):")
    for i, e in enumerate(result.palette):
        bar = "#" * min(40, e.count * 40 // max(1, result.rows * result.cols) + 1)
        print(f"    [{i}] {e.hex}  {e.count:5d} cells  {e.name} (DMC {e.dmc})")
    if result.warnings:
        print("  Warnings:")
        for w in result.warnings:
            print(f"    - {w}")

    if args.overlay:
        draw_overlay(img, result, args.overlay)
    if args.reconstruct:
        draw_reconstruction(result, args.reconstruct)
    return 0


if __name__ == "__main__":
    sys.exit(main())
