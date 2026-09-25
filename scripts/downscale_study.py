"""Does shrinking a large photo before detection cost accuracy? (docs/web-port-plan.md,
Risks #2.)

Grades the synthetic corpus of alphareader/tests/test_detect.py (same generator, same
seed, same exact / recoverable / bad tiers) with and without core.bridge.shrink:

  photo   each chart upscaled (Lanczos) so its long edge is PHOTO_EDGE px, like a phone
          photo of a screen or a page, then detected at that size vs shrunk to <= MAX_EDGE
  native  the corpus at its own size (up to ~2,700 px); only charts over MAX_EDGE differ

    .venv/bin/python scripts/downscale_study.py [--n 200] [--max-edge 1600]
"""
from __future__ import annotations

import argparse
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from alphareader.core.bridge import shrink, shrink_factor  # noqa: E402
from alphareader.core.detect import detect_pattern  # noqa: E402
from alphareader.core.model import DetectionError  # noqa: E402
from alphareader.tests import synth  # noqa: E402
from alphareader.tests.test_detect import _is_refinement, _label_grid, partitions_match  # noqa: E402

PHOTO_EDGE = 4000


def _grade(img: np.ndarray, spec: synth.SynthSpec, gt: np.ndarray) -> tuple[str, bool, float]:
    t = time.perf_counter()
    try:
        r = detect_pattern(img)
    except DetectionError as e:
        return f"error", False, time.perf_counter() - t
    dt = time.perf_counter() - t
    warned = bool(r.warnings)
    same_dims = (r.rows, r.cols) == (spec.rows, spec.cols)
    if same_dims and partitions_match(r.cells, gt):
        return "exact", warned, dt
    near = abs(r.rows - spec.rows) <= 1 and abs(r.cols - spec.cols) <= 1
    if near and (not same_dims or _is_refinement(r.cells, gt)):
        return "recoverable", warned, dt
    return "bad", warned, dt


def _case(args):
    i, spec, mode, max_edge, rounding = args
    img = synth.render(spec)
    gt = _label_grid(synth.cells_to_palette_labels(spec.cells, spec.palette))
    if mode == "photo":
        h, w = img.shape[:2]
        s = PHOTO_EDGE / max(h, w)
        img = np.asarray(Image.fromarray(img).resize((round(w * s), round(h * s)), Image.LANCZOS))
    k = shrink_factor(img.shape[1], img.shape[0], max_edge)
    if rounding == "down":
        k = max(1, max(img.shape[:2]) // max_edge)
    full = _grade(img, spec, gt)
    small = _grade(shrink(img, k), spec, gt) if k > 1 else full
    return i, img.shape[:2], k, full, small


def _summary(label: str, rows) -> None:
    for which in (3, 4):
        tally = {"exact": 0, "recoverable": 0, "bad": 0, "error": 0}
        silent = 0
        times = []
        for r in rows:
            status, warned, dt = r[which]
            tally[status] += 1
            silent += status == "bad" and not warned
            times.append(dt)
        produced = tally["exact"] + tally["recoverable"] + tally["bad"]
        name = "full size" if which == 3 else "shrunk"
        print(f"  {label:6} {name:9} {tally}  exact={tally['exact'] / produced:.3f} "
              f"recoverable={(tally['exact'] + tally['recoverable']) / produced:.3f} "
              f"silent-bad={silent}  median {np.median(times) * 1000:.0f} ms, "
              f"max {max(times) * 1000:.0f} ms")
    worse = [(r[0], r[3][0], r[4][0]) for r in rows
             if _rank(r[4][0]) > _rank(r[3][0])]
    better = [(r[0], r[3][0], r[4][0]) for r in rows
              if _rank(r[4][0]) < _rank(r[3][0])]
    print(f"  {label:6} shrinking made {len(worse)} worse {worse[:10]}, "
          f"{len(better)} better {better[:10]}")


def _rank(status: str) -> int:
    return {"exact": 0, "recoverable": 1, "error": 2, "bad": 3}[status]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--max-edge", type=int, default=1600)
    ap.add_argument("--modes", default="native,photo")
    ap.add_argument("--round", choices=("up", "down"), default="up",
                    help="up: long edge <= max-edge; down: long edge stays >= max-edge")
    args = ap.parse_args()

    rng = np.random.default_rng(12345)          # test_batch_accuracy's corpus
    specs = [synth.random_spec(rng) for _ in range(args.n)]
    with Pool() as pool:
        for mode in args.modes.split(","):
            t = time.perf_counter()
            rows = sorted(pool.map(_case, [(i, s, mode, args.max_edge, args.round) for i, s in enumerate(specs)]))
            shrunk = sum(r[2] > 1 for r in rows)
            print(f"{mode}: {len(rows)} charts, {shrunk} shrunk (factor "
                  f"{sorted({r[2] for r in rows})}), {time.perf_counter() - t:.0f} s")
            _summary(mode, rows)


if __name__ == "__main__":
    main()
