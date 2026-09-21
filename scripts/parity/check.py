"""Prove that detection under Pyodide matches detection on the desktop.

This is the load-bearing assumption of the web port: `alphareader/core/detect` is the one
part of the app that is *not* being reimplemented, so if WASM numpy disagrees with the
desktop build the whole plan needs rethinking. Run this whenever `core/detect` changes.

    python scripts/parity/check.py            # real charts + 80 synthetic
    python scripts/parity/check.py --synth 0  # real charts only (fast)

Requires node and a one-off `npm install` in scripts/parity/.
Exits non-zero on any mismatch, so it can gate CI.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, "scripts", "parity")

# Everything the digest reports except timings, which legitimately differ.
COMPARED = ("ok", "code", "rows", "cols", "cells_sha", "palette", "warnings",
            "pitch_x", "pitch_y", "x0", "y0", "conf_mean")


def _decode_real(dest: str) -> int:
    """Decode the committed chart images once, here, so both runtimes see identical bytes."""
    from PIL import Image
    patterns = ("test_images/*.png", "test_images/*.jpg", "test_images/failed/*.jpg")
    files = sorted(f for p in patterns for f in glob.glob(os.path.join(ROOT, p)))
    for f in files:
        arr = np.asarray(Image.open(f).convert("RGB"), dtype=np.uint8)
        np.save(os.path.join(dest, os.path.basename(f).rsplit(".", 1)[0] + ".npy"), arr)
    return len(files)


def _render_synth(dest: str, n: int) -> int:
    """Synthetic charts carry the adversarial traps (JPEG, rotation, watermarks, odd
    downscales) that stress the numeric paths far harder than the real photos do."""
    sys.path.insert(0, ROOT)
    from alphareader.tests import synth
    for seed in range(n):
        spec = synth.random_spec(np.random.default_rng(seed))
        np.save(os.path.join(dest, f"synth{seed:03d}.npy"), synth.render(spec))
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--synth", type=int, default=80, help="synthetic charts (0 to skip)")
    ap.add_argument("--keep", action="store_true", help="keep the .npy corpus on disk")
    args = ap.parse_args()

    if shutil.which("node") is None:
        print("node not found — install node and run `npm install` in scripts/parity/")
        return 2
    if not os.path.isdir(os.path.join(HERE, "node_modules")):
        print(f"run `npm install` in {HERE} first")
        return 2

    work = tempfile.mkdtemp(prefix="alpha-parity-")
    npy = os.path.join(work, "npy")
    os.makedirs(npy)
    try:
        n = _decode_real(npy)
        if args.synth:
            n += _render_synth(npy, args.synth)
        print(f"corpus: {n} charts")

        env = dict(os.environ, PYTHONPATH=ROOT)
        native = json.loads(subprocess.run(
            [sys.executable, os.path.join(HERE, "digest.py"), *sorted(glob.glob(f"{npy}/*.npy"))],
            check=True, capture_output=True, text=True, env=env).stdout)

        wasm_path = os.path.join(work, "pyodide.json")
        subprocess.run(["node", os.path.join(HERE, "run_pyodide.mjs"), ROOT, npy, wasm_path],
                       check=True, cwd=HERE)
        wasm = json.loads(open(wasm_path).read())

        print(f"native : python {native['python']}  numpy {native['numpy']}")
        print(f"pyodide: python {wasm['python']}  numpy {wasm['numpy']}"
              f"  (scipy loaded: {wasm['timing']['scipy_loaded']})")

        nat = {r["file"]: r for r in native["results"]}
        was = {r["file"]: r for r in wasm["results"]}
        mismatches = []
        for name in sorted(nat):
            a, b = nat[name], was.get(name)
            if b is None:
                mismatches.append((name, ["MISSING FROM PYODIDE"]))
                continue
            bad = [k for k in COMPARED if a.get(k) != b.get(k)]
            if bad:
                mismatches.append((name, bad))
                for k in bad:
                    print(f"  {name} {k}:\n    native ={a.get(k)}\n    pyodide={b.get(k)}")

        tn = sum(r["ms"] for r in nat.values()) / 1000
        tw = sum(r["ms"] for r in was.values()) / 1000
        print(f"detect : native {tn:.1f}s  wasm {tw:.1f}s  ({tw / tn:.2f}x)")
        print(f"result : {len(nat) - len(mismatches)}/{len(nat)} bit-identical")
        if mismatches:
            print(f"FAILED — {len(mismatches)} chart(s) differ")
            return 1
        print("PASS")
        return 0
    finally:
        if args.keep:
            print(f"corpus kept at {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
