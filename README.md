# Alpha Pattern Editor

Turn an image of an existing alpha / tapestry-crochet chart into an editable, trackable
pattern. See [`plan.md`](plan.md) for the full product spec.

## Status

- **M0 — detection pipeline (the "reader"):** done. A pure-NumPy pipeline that recovers
  the grid, per-cell colours and a palette from a chart image, plus a synthetic test
  harness (`plan.md` §5, §11).
- **M1 — import + confirmation wizard:** done. Load an image (file / drag-drop / paste),
  review and correct the detection, and commit to a stored `.alpha` project (§7, §8).
- **M2 — Work stage:** done. Read-only, glanceable row-by-row following with run-length
  chips, alternating direction, progress tracking and auto-save (§6.3, §10, §4.4–4.5).
- **M3 — Design stage:** done. Paint / fill / rectangle / eyedropper / row-column fill,
  palette editing, structural ops (borders, mirror, flip, rotate, trim), full undo/redo,
  zoom, and PNG export (§6.2, §9). Structural edits preserve stable row_ids so Work-stage
  progress survives (§4.5).

```
alphareader/
  core/
    model.py            # Pattern / Project / Progress / DetectionResult dataclasses
    confirm.py          # confirmation-screen re-derivation (dims / ΔE / crop)
    io.py               # .alpha project save/load, PNG export
    readout.py          # run-length encoding + direction resolution (§10)
    work.py             # progress-cursor operations (advance/retreat/remaining)
    edit.py             # pure pattern mutations for the Design stage (§9)
    detect/
      mask.py           # dark mask, axis-closing, longest-run profiles
      lattice.py        # bands -> pitch -> phase -> extent
      sample.py         # per-cell median sampling
      palette.py        # sRGB->Lab, clustering, confidence, DMC naming
      pipeline.py       # detect_pattern() orchestration
      dmc.json          # DMC floss colour table for naming
  ui/
    canvas.py           # numpy<->Qt, overlay + reconstruction rendering
    importer/           # confirmation window + croppable source view
    work/               # Work-stage window, run chips, read-only chart view
    design/             # Design-stage window + editable zoomable canvas
    library/            # project library (auto-refreshing preview cards)
  app.py                # GUI entry point
  tests/
detect_cli.py           # headless: run detection on an image, print + visualise
test_images/            # drop your charts here
```

## Launch the app

```bash
.venv/bin/python -m alphareader.app            # project library (landing screen)
.venv/bin/python -m alphareader.app chart.png   # jump into the import wizard
.venv/bin/python -m alphareader.app proj.alpha  # open a saved project in the Work stage
```

Projects are saved as `.alpha` files in a **`saved/`** folder in the project root, with
one-click saving (no dialog). The landing screen is a **library** of preview cards
(source thumbnail, dimensions, % done); click one to resume it, or the **✕** in a card's
corner to remove it from the library.

Load a chart (button / drag-drop / Ctrl+V), then on the confirmation screen:

- the **source** shows the fitted grid and detected extent;
- **Rows / Cols** spinners re-derive the lattice over the same region;
- the **ΔE slider** merges/splits similar colours with a live palette preview;
- **Crop** lets you drag a box around just the grid and re-detect (the escape hatch for
  numbering inside border cells, etc.);
- low-confidence cells are crossed out in the reconstruction;
- **Commit** writes a `.alpha` project (round-trippable, embeds the source image), then
  offers to start working on it.

## Work stage

Open a saved project straight into the Work stage:

```bash
.venv/bin/python -m alphareader.app project.alpha
```

Read-only by design (§6.1) — no editing tool is reachable. Work runs **bottom row first**
(row 1 is the bottom of the chart). The current row's stitches show as large run-length
chips (`27 White`, `1 Very Dark Topaz`, …) with the working **direction arrow** that flips
every row (§4.4). **Row complete →** finishes the whole current row and moves up; ← / →
step through individual colour runs for finer tracking. The chart fits fully on screen
(no scrolling), with **black gridlines** and **row/column numbers** to help counting;
completed rows are dimmed and struck through, the current one outlined. **Save** writes to
`saved/`, and closing prompts to save. Focus mode / high-contrast are in the View menu;
Project → Export readout writes the whole pattern as text.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Try it

```bash
.venv/bin/python detect_cli.py test_images/dachshund.png \
    --overlay overlay.png --reconstruct reconstruct.png
```

See [`test_images/README.md`](test_images/README.md) for where to put your own images and
what kinds of charts work.

## Run the tests

```bash
.venv/bin/python -m pytest alphareader/tests/ -q
```

The harness renders charts from known grids and checks recovery, exercising the traps
from `plan.md` §11: edge numbering, watermarks, coloured margins, white-on-white,
solid-black rows, non-integer downscale and JPEG re-encode.

**Guarantees enforced by the suite**

- **Never a silently wrong pattern** (§13.8): any result that is materially wrong carries
  a warning, so the (future) confirmation screen surfaces it. This is asserted absolutely.
- Detection **refuses** rather than guesses on low-resolution or rotated input, with a
  named reason.
- On a deliberately adversarial randomized corpus: ~87% exact cell-by-cell recovery, ~95%
  either exact or fixable in one gesture at the confirmation step (off-by-one dimension /
  over-segmented palette). The remaining warned failures are pitch-halving on aggressive
  downscale — see the note in `test_detect.py`.

## Design stage

Opened for a project with no progress yet (or via **Back to Design** from the Work stage,
and **Work on this →** the other way). Left: paint / fill / rectangle / eyedropper /
fill-row / fill-column tools and zoom. Centre: the editable chart (black gridlines, axis
numbers). Right: the palette and a structure panel:

- **Palette** — add, recolour, or **delete** a colour. Deleting repaints its cells with
  the perceptually nearest remaining colour, so unwanted colours collapse cleanly.
- **Pad to size** — type a target width × height and it grows the chart to that size by
  adding a border in the pattern's dominant border colour (padding only, never crops).
- **Scale ×N** — integer, pixel-exact upscaling (each cell becomes an N×N block); no
  interpolation, no new colours.
- **Mirror / Flip / Rotate 180° / Trim uniform edges.**

Full undo/redo (Ctrl+Z / Ctrl+Shift+Z, a paint stroke is one step), Save to `saved/`, and
Export PNG.

## Not yet built

Packaging as a standalone app (M6) and the optional self-contained HTML work sheet (M7).
`core/` deliberately has zero UI imports, so every stage's logic — detection, confirmation
re-derivation, Work-stage progress, and Design-stage edits — lives in the core and is
tested headlessly.
