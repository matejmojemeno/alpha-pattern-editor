# Pyodide parity harness

Proves that `alphareader/core/detect` produces **identical** results under Pyodide (WASM)
and desktop CPython.

This matters because of how the web port is built: everything else in the app is being
reimplemented in TypeScript, but the detection pipeline is not — it runs as the same
Python source inside Pyodide. If WASM numpy disagreed with the desktop build, the port's
central assumption would be wrong. Run this whenever `core/detect` changes.

## Setup

```bash
cd scripts/parity && npm install      # one-off; pulls the pyodide runtime (~300MB)
```

## Run

```bash
python scripts/parity/check.py             # 9 real charts + 80 synthetic
python scripts/parity/check.py --synth 0   # real charts only, ~20s
python scripts/parity/check.py --keep      # leave the .npy corpus for inspection
```

Exits non-zero on any mismatch, so it can gate CI.

## How it works

Images are decoded **once**, in CPython, into raw `uint8 (H, W, 3)` arrays. Both runtimes
then read those identical bytes. This keeps Pillow's version out of the comparison and
mirrors the real web architecture, where the browser decodes the image and hands Python
an array.

The repo is *mounted* into Pyodide's filesystem rather than copied, so both runtimes
execute the same source with no build step to fall out of date.

`digest.py` runs unchanged under both. It reports the cells SHA-256, the palette, the
warnings, the lattice floats to 9 decimal places and the mean confidence — the float
fields are included deliberately, since a differing numpy build would perturb those long
before it moved a quantised cell index.

## Baseline

As of 2026-09-22, with **89/89 bit-identical**:

| | desktop | Pyodide 314.0.7 |
|---|---|---|
| Python | 3.14.6 | 3.14.2 |
| numpy | 2.5.1 | 2.4.6 |

Parity holds *despite* the numpy version gap. Detection runs 1.6–2.9x slower under WASM
(71–908 ms per real chart).
