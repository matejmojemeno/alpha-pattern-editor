"""How should a large photo be shrunk before detection? (docs/web-port-plan.md, Risks #2;
core/bridge.py `shrink_factor`.)

Each chart is upscaled (Lanczos) to a phone-photo size, then detected at that size and
after each candidate shrink rule. Reported per rule:

  same as full   the shrunk image gives the same rows × cols as the full-size one
  true size      it gives the chart's real rows × cols

Corpora:
  synth   the synthetic corpus of alphareader/tests/test_detect.py (same generator and
          seed), whose true size is known
  real    test_images/, whose "true" size is the desktop's own at native size, plus the
          sources of any projects in saved/ (gitignored: the owner's real charts), whose
          true size is what the owner saved

Rules:
  edge:N   today's rule until Phase 2 part 2: the whole factor ceil(long edge / N)
  px:M     the smallest whole factor that brings the image to M megapixels or fewer (the
           rule chosen: px:4)
  area:N   a fractional, exact integer area-average to a long edge of N (rejected: it
           beats against thin gridlines, see the PR)
  apx:M    the same, to M megapixels (rejected, likewise)

    .venv/bin/python scripts/downscale_study.py [--corpus synth,real] [--n 200]
        [--edges 2000,3000,4000] [--rules edge:1600,px:3,px:4,px:5,area:2000,apx:4]
        [--saved DIR] [-v]
"""
from __future__ import annotations

import argparse
import glob
import json
import sys
import zipfile
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from alphareader.core.bridge import shrink, shrink_factor  # noqa: E402
from alphareader.core.detect import detect_pattern  # noqa: E402
from alphareader.core.model import DetectionError  # noqa: E402
from alphareader.tests import synth  # noqa: E402

REAL = ["bug.jpg", "cats.png", "dachshund.png", "monkeys.png", "failed/bunny.jpg",
        "failed/face.jpg", "failed/lisa.jpg", "failed/shizuku.jpg"]


# --- the rejected fractional resampler, kept for comparison -------------------------------

def _axis_weights(n: int, m: int):
    """Output j covers input [j*n/m, (j+1)*n/m). In units of 1/m of an input pixel it spans
    [j*n, (j+1)*n), and input i spans [i*m, (i+1)*m): integer overlaps summing to n."""
    k = -(-n // m) + 1
    j = np.arange(m, dtype=np.int64)[:, None]
    idx = (j * n) // m + np.arange(k, dtype=np.int64)[None, :]
    w = np.maximum(np.minimum((idx + 1) * m, (j + 1) * n) - np.maximum(idx * m, j * n), 0)
    return np.minimum(idx, n - 1), w


def area_shrink(img: np.ndarray, out_w: int, out_h: int, band: int = 64) -> np.ndarray:
    """An exact (integer) area-average to any size, in bands of rows to bound memory."""
    h, w = img.shape[:2]
    iy, wy = _axis_weights(h, out_h)
    ix, wx = _axis_weights(w, out_w)
    div = np.int64(w) * np.int64(h)
    out = np.empty((out_h, out_w, img.shape[2]), np.uint8)
    for a in range(0, out_h, band):
        b = min(out_h, a + band)
        v = np.zeros((b - a, w, img.shape[2]), np.int64)
        for k in range(iy.shape[1]):
            v += wy[a:b, k, None, None] * img[iy[a:b, k]]
        t = np.zeros((b - a, out_w, img.shape[2]), np.int64)
        for k in range(ix.shape[1]):
            t += wx[None, :, k, None] * v[:, ix[:, k]]
        out[a:b] = (t + div // 2) // div
    return out


# --- rules ----------------------------------------------------------------------------------

def apply_rule(rule: str, img: np.ndarray) -> np.ndarray | None:
    """The image as `rule` would detect it, or None if the rule leaves it whole."""
    h, w = img.shape[:2]
    kind, arg = rule.split(":")
    n = float(arg)
    if kind == "edge":
        k = -(-max(w, h) // int(n)) if max(w, h) > n else 1
    elif kind == "px":
        k = shrink_factor(w, h, int(n * 1_000_000))
    elif kind in ("area", "apx"):
        s = n / max(w, h) if kind == "area" else (n * 1_000_000 / (w * h)) ** 0.5
        if s >= 1:
            return None
        return area_shrink(img, max(1, round(w * s)), max(1, round(h * s)))
    else:
        raise ValueError(rule)
    return None if k == 1 else shrink(img, k)


def _size(img: np.ndarray):
    try:
        r = detect_pattern(img)
        return [r.cols, r.rows]
    except DetectionError as e:
        return e.code


def _upscale(img: np.ndarray, edge: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = edge / max(h, w)
    return np.asarray(Image.fromarray(img).resize((round(w * s), round(h * s)), Image.LANCZOS))


def _case(args):
    name, truth, source, edge, rules = args
    img = synth.render(source) if isinstance(source, synth.SynthSpec) else \
        np.asarray(Image.open(source).convert("RGB"))
    img = _upscale(img, edge)
    full = _size(img)
    out = {}
    for rule in rules:
        small = apply_rule(rule, img)
        out[rule] = full if small is None else _size(small)
    return name, edge, truth, full, out


def _real_cases(saved: Path):
    cases = []
    for f in REAL:
        path = ROOT / "test_images" / f
        cases.append((f, _size(np.asarray(Image.open(path).convert("RGB"))), str(path)))
    tmp = Path(__file__).resolve().parent / ".downscale_study"
    for f in sorted(glob.glob(str(saved / "*.alpha"))):
        with zipfile.ZipFile(f) as z:
            if "source.png" not in z.namelist():
                continue
            pattern = json.loads(z.read("pattern.json"))
            tmp.mkdir(exist_ok=True)
            png = tmp / (Path(f).stem + ".png")
            png.write_bytes(z.read("source.png"))
        cases.append((Path(f).stem, [pattern["cols"], pattern["rows"]], str(png)))
    return cases


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="synth,real")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--edges", default="2000,3000,4000")
    ap.add_argument("--rules", default="edge:1600,px:3,px:4,px:5,area:2000,apx:4")
    ap.add_argument("--saved", type=Path, default=ROOT / "saved",
                    help="projects whose sources join the real corpus (from a worktree, "
                         "point this at the main checkout's saved/)")
    ap.add_argument("-v", action="store_true", help="list every chart a rule changes")
    args = ap.parse_args()
    rules = args.rules.split(",")
    edges = [int(e) for e in args.edges.split(",")]

    with Pool() as pool:
        for corpus in args.corpus.split(","):
            if corpus == "synth":
                rng = np.random.default_rng(12345)          # test_batch_accuracy's corpus
                specs = [synth.random_spec(rng) for _ in range(args.n)]
                cases = [(f"synth {i}", [s.cols, s.rows], s) for i, s in enumerate(specs)]
            else:
                cases = _real_cases(args.saved)
            rows = pool.map(_case, [(n, t, src, e, rules) for n, t, src in cases for e in edges])
            _report(corpus, rows, rules, args.v)


def _report(corpus: str, rows, rules, verbose: bool) -> None:
    same = defaultdict(int)
    true = defaultdict(int)
    full_true = sum(r[3] == r[2] for r in rows)
    print(f"\n{corpus}: {len(rows)} images; full size has the true size {full_true}")
    for name, edge, truth, full, out in rows:
        for rule in rules:
            same[rule] += out[rule] == full
            true[rule] += out[rule] == truth
        if verbose and any(out[r] != full for r in rules):
            print(f"  {name} @{edge}: true {truth}, full {full}; " +
                  ", ".join(f"{r} {out[r]}" for r in rules if out[r] != full))
    for rule in rules:
        print(f"  {rule:10} same as full {same[rule]:4}/{len(rows)}   true size {true[rule]:4}/{len(rows)}")


if __name__ == "__main__":
    main()
