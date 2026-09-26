# Alpha Pattern Reader — Build Specification (v2, Python)

A desktop app that ingests an **image of an existing alpha pattern chart**, recovers the underlying grid as structured data, and provides two separate workspaces: a **Design stage** for editing the pattern, and a **Work stage** for following it while crocheting or knotting.

This document is the implementation brief. Read the whole thing before writing code — decisions in later sections constrain the data model in earlier ones.

---

## 1. Scope

### In scope (v1)

- Import a raster image (PNG/JPEG/WebP) of an alpha pattern chart.
- Chart has **uniform (non-staggered) rows** and **black gridlines**.
- Chart may have **arbitrary content outside the grid**: row/column numbering, watermarks, page chrome, margins, captions. This must be tolerated automatically.
- **White is a normal pattern color.** It is never assumed to be background, never auto-trimmed, never treated specially anywhere in the pipeline.
- Recover grid dimensions, per-cell colors, and a minimal palette.
- **Design stage**: full editing — cells, palette, borders, structural ops, undo/redo.
- **Work stage**: read-only, distraction-free row-by-row following with progress tracking and run-length stitch readouts.
- Local persistence, multiple projects, export.

### Explicitly out of scope (v1)

| Case | Behavior |
| --- | --- |
| Staggered / brick-offset rows | Reject: "Staggered charts aren't supported yet." |
| Gridless charts (color blocks, no lines) | Reject: "Couldn't find gridlines." |
| Symbol charts (glyphs not colors) | Will fail naturally at the palette step. Acceptable. |
| Photographs of paper or screens, perspective skew | Reject via rotation check. |
| Rotation beyond ±1.5° | Reject: "Image looks rotated." |
| Numbers rendered *inside* border cells of the grid | Known limitation. Manual crop is the escape hatch. |

---

## 2. Glossary

- **Cell** — one square of the chart = one stitch or knot.
- **Pitch** — center-to-center spacing of gridlines, in image pixels. Separate `pitch_x` and `pitch_y`; do not assume they're equal.
- **Lattice** — the fitted model `x_k = x0 + k·pitch_x`, `y_k = y0 + k·pitch_y`.
- **Extent** — the index range `[k_min, k_max]` of lattice lines with actual image evidence. Defines where the grid starts and stops.
- **Run** — a maximal sequence of same-colored cells within a row.
- **Design stage / Work stage** — the two top-level modes. See §6.

---

## 3. Tech stack and architecture

**Language: Python 3.11+.** The detection pipeline is genuinely better expressed in NumPy than in any other ecosystem, and it is the highest-risk part of this project.

### The rule that makes the framework choice reversible

`core/` is **pure Python with zero UI imports**. No Qt, no widgets, no file dialogs. It takes arrays and dataclasses in, returns arrays and dataclasses out. All UI lives in `ui/` and is a thin shell over it.

Follow this strictly and the GUI framework becomes a swappable detail. If the app later needs to run on a phone, only `ui/` is rewritten.

```
alphareader/
  core/
    detect/          # image -> Pattern. Pure NumPy.
      mask.py        # dark mask, longest-run profiles
      lattice.py     # autocorrelation, band grouping, least-squares fit
      sample.py      # cell sampling
      palette.py     # Lab conversion, agglomerative clustering, DMC naming
      pipeline.py    # detect_pattern() orchestration
    model.py         # Pattern, Progress, PaletteEntry dataclasses
    edit.py          # all pattern mutations (pure functions, return new Pattern)
    readout.py       # run-length encoding, direction resolution
    io.py            # .alpha file read/write, PNG/text export
  ui/
    design/          # Design stage widgets
    work/            # Work stage widgets
    importer/        # upload + confirmation wizard
    canvas.py        # shared grid renderer
  tests/
    synth.py         # synthetic chart generator
```

### Dependencies

| Package | Purpose |
| --- | --- |
| `numpy` | Everything in detection |
| `Pillow` | Image loading, synthetic chart rendering |
| `scipy` | `scipy.cluster.hierarchy` for agglomerative clustering, `scipy.signal` for peak finding |
| `PySide6` | GUI (Qt6, LGPL) |
| `pytest` | Tests |

Do **not** add scikit-image or scikit-learn. sRGB→Lab is ~25 lines of vectorized NumPy and `scipy.cluster.hierarchy.linkage` + `fcluster` covers the clustering. Keeping the dependency tree small makes packaging with PyInstaller far less painful.

### GUI framework

**PySide6 (Qt).** Mature canvas via `QWidget.paintEvent`, real keyboard handling, native file dialogs, and PyInstaller packages it to a standalone `.exe`/`.app`.

Alternatives, if the requirements change:

- **Flet** — Python API over Flutter, builds to web and mobile from the same source. Choose this instead *if using the app on a phone is a hard requirement*. Canvas support is weaker; the Design stage will be harder to build.
- **Streamlit / Gradio** — do not use. They re-run the script on every interaction; per-cell painting and keyboard shortcuts will be unusable.
- **Pyodide** — real option for browser delivery, but adds a ~10MB payload and a startup delay. Not worth it for v1.

### Getting the pattern onto a phone (optional, M7)

If a phone is desirable but not worth rewriting the app for: add an **"Export work sheet"** action that writes a **single self-contained HTML file** with the pattern embedded as inline JSON and ~150 lines of vanilla JS implementing Work stage only (row navigation, run chips, progress in `localStorage`). No server, no build step, works by emailing the file to yourself. The Design stage stays Python. This is a small, isolated piece of JS the agent writes once and rarely touches.

---

## 4. Issues to resolve before coding

Each has a recommended resolution — follow it unless there's a reason not to.

### 4.1 White is a valid color, so grid extent cannot come from color

The naive "bounding box of non-white pixels" approach is wrong here. A chart can be white cells on a white page.

**Resolution:** grid extent is defined *purely by the black lattice*, never by cell colors. Find where periodic black lines exist; that region is the grid. Corollary: **never auto-trim uniform border rows/columns.** A white margin inside the grid may be intentional. Trimming is a manual, explicit user action only.

### 4.2 Border numbering must not corrupt line detection

**Resolution:** filter by **run length, not darkness**. For each image row, compute the *longest contiguous run of dark pixels*. A gridline produces a run spanning the whole grid (hundreds of px). A digit glyph produces a run of ~10–20px. The separation is enormous, and a single threshold eliminates all text, watermarks and captions. Same logic transposed for columns. This is the most important trick in the pipeline.

### 4.3 A full row of dark cells looks exactly like a gridline

**Resolution:** discriminate by **thickness**. Gridlines are 1–3px; a row of dark cells is ~`pitch_y` thick. Group adjacent candidate rows into bands and reject bands thicker than `0.45 × pitch`. Pitch isn't known until after peak detection, so do this in two passes: estimate pitch by autocorrelation (robust to a few fat bands), thickness-filter, then refit.

### 4.4 Rows alternate direction while working

In both tapestry crochet and alpha bracelets, work turns at the end of each row: row 1 left→right, row 2 right→left. **A readout that always reads left-to-right will be wrong on every even row** and will silently produce mirrored output.

**Resolution:** model direction explicitly. Store `start_direction: Literal['LTR','RTL']` and `alternate_direction: bool` (default `True`). The readout reverses the row when direction is RTL. Show the direction arrow prominently. Keep it user-configurable — conventions vary, and some techniques (working in the round, or cutting and rejoining) never turn.

### 4.5 Structural edits invalidate progress state

Pad two rows onto the top and every completed row index shifts, losing the user's place mid-project.

**Resolution:** every row carries a stable `row_id` (uuid4 hex) that survives insert/delete/pad. Progress is a `set[str]` of row IDs and a `(row_id, run_index)` cursor. Structural ops mutate the `row_ids` list; progress needs no remapping. Any *column*-structural edit must reset `run_index` to 0, since run boundaries move.

The Design/Work separation (§6) reduces the blast radius here considerably, but does not remove the need for stable IDs.

### 4.6 Perceptually close colors collide

Charts often use two similar shades. RGB distance will either merge them or split noise into phantom colors.

**Resolution:** cluster in **CIELAB** with a ΔE threshold, exposed as a slider in the import confirmation step with a live palette preview. Let the user merge or split clusters before committing.

### 4.7 Low-resolution input is unrecoverable

Below ~6px per cell, gridline antialiasing consumes the cell interior.

**Resolution:** if `pitch < 6`, reject with "Image resolution too low — need at least ~6 pixels per square." Do not attempt a best-effort guess; a silently wrong pattern is worse than a refusal.

### 4.8 Never go straight from import to pattern

**Resolution:** a mandatory confirmation step (§7.2). This single screen is worth more for reliability than any algorithmic improvement.

---

## 5. Detection pipeline

Module: `core/detect/`. Pure functions, no side effects, no UI imports.

```python
@dataclass(frozen=True)
class DetectionResult:
    cols: int
    rows: int
    lattice: Lattice                 # x0, pitch_x, y0, pitch_y, col_lines, row_lines
    cells: np.ndarray                # uint16, shape (rows, cols), palette indices
    palette: list[PaletteEntry]
    confidence: np.ndarray           # float32, shape (rows, cols), 0..1
    warnings: list[str]
    debug: DebugLayers               # profiles, masks, bands — for the dev overlay

class DetectionError(Exception):
    code: Literal['NO_GRIDLINES','LOW_RESOLUTION','ROTATED','TOO_SMALL']

def detect_pattern(
    img: np.ndarray,                 # uint8, shape (H, W, 3)
    *,
    delta_e_threshold: float = 6.0,
    dark_threshold: int = 100,
    crop: tuple[int,int,int,int] | None = None,
) -> DetectionResult: ...
```

`crop` lets the confirmation UI re-run detection on a user-selected region.

### Step 1 — Dark mask

```python
lum = img @ np.array([0.2126, 0.7152, 0.0722])
mask = lum < dark_threshold
```

If `mask.mean() > 0.40`, the threshold is too loose (dark-themed screenshot). Retry at 60. If still >0.40, raise `NO_GRIDLINES`.

### Step 2 — Longest-run profiles

For each image row, the longest contiguous run of `True` in `mask`; same per column. Vectorize with a run-length approach over the flattened mask rather than a Python loop per row.

```
run_h[y] = longest run in row y      # shape (H,)
run_v[x] = longest run in column x   # shape (W,)
```

Candidates: `run_h > 0.6 * run_h.max()`, `run_v > 0.6 * run_v.max()`.

Text, watermarks and captions are eliminated here. **Verify this visually in the dev overlay before proceeding.**

### Step 3 — Band grouping

Group consecutive candidate indices into bands: `(start, end, thickness, weight)` where `weight = run_h[start:end].sum()`. Band center = weighted centroid, giving subpixel precision (important for browser-zoom screenshots at non-integer scale).

Fewer than 4 bands on either axis → `NO_GRIDLINES`.

### Step 4 — Pitch by autocorrelation

Build a sparse impulse signal from band centers, autocorrelate via `np.correlate` or FFT, search lags in `[4, dim//3]`, take the highest peak, refine subpixel by parabolic interpolation on the three samples around it.

`pitch < 6` → `LOW_RESOLUTION`. `pitch > dim/3` → `NO_GRIDLINES`.

### Step 5 — Thickness filter and refit

Drop bands with `thickness > 0.45 * pitch` (solid dark *cells*, per §4.3) and any with `thickness > 8`. Recompute pitch on the filtered set.

Find phase `y0` by maximizing total matched band weight over `y0 ∈ [0, pitch)` in 100 steps, then refine `(y0, pitch)` jointly by least squares against matched centers — two unknowns, closed form via `np.polyfit(k, centers, 1)`.

**Rotation check:** fit band center position against the perpendicular coordinate. Implied angle > 1.5° → `ROTATED`.

### Step 6 — Extent

From the strongest band, walk outward. At each predicted position `y0 + k·pitch`, look for a band within `±0.3 · pitch`. Extend while supported; stop after **two consecutive** misses (tolerates one dropped line). Yields `k_min, k_max`, and `rows = k_max - k_min` (cells, not lines).

`rows < 2` or `cols < 2` → `NO_GRIDLINES`.

### Step 7 — Cell sampling

Inset each cell rectangle by `max(1, round(0.22 * pitch))` on all sides. Inner rect smaller than 2×2 → `LOW_RESOLUTION`.

Take the **per-channel median** of inner pixels — median rejects antialiasing halos, JPEG ringing and stray watermark pixels; mean does not. Also record the interquartile range for the confidence score.

Vectorize: build an index array for all cells at once rather than looping, or accept a loop for v1 — even 15,000 cells is fast enough.

### Step 8 — Palette by Lab clustering

sRGB → linear → XYZ (D65) → Lab, hand-rolled and vectorized (~25 lines).

Pre-quantize identical medians (typically collapses 15,000 cells to a few dozen unique colors), then `scipy.cluster.hierarchy.linkage(method='complete')` + `fcluster(t=delta_e_threshold, criterion='distance')`. CIE76 distance is sufficient; CIEDE2000 is unnecessary here.

Cluster centroid → palette hex. Sort palette by descending cell count. **Do not special-case white, black or the most frequent color.**

Name each entry by nearest DMC floss color from a static JSON table. Names are user-editable.

### Step 9 — Confidence

```python
conf = np.clip(1 - np.maximum(dE / (2 * delta_e_threshold), iqr / 40), 0, 1)
```

Flag cells below 0.6. Warn if more than 2% of cells are flagged.

### Dev overlay

Build a debug window early — not last — rendering: dark mask, `run_h`/`run_v` profiles, detected bands color-coded by kept/rejected, fitted lattice, and a confidence heatmap. You will use it constantly.

---

## 6. The two stages

The central UI decision: **Design and Work are separate stages, not a toolbar toggle.** They have different layouts, different information density, and different input models. A project is in exactly one stage at a time.

### 6.1 Why the split pays for itself

- The Work stage becomes **read-only**, which structurally prevents the worst bug in this class of app: nudging the mouse mid-project and silently repainting a cell.
- Progress state exists only in Work; the Design canvas never renders strike-throughs, halving its rendering logic.
- Each stage can optimize for its own device and posture — Design at a desk with a mouse, Work at arm's length with large tap targets.
- The two share exactly one thing: the `Pattern`. Keeping that interface narrow keeps both simple.

### 6.2 Design stage

Dense, tool-oriented, desktop layout.

- Left: tool palette (paint, fill, rect, eyedropper, row/column fill).
- Right: color palette with swatches, counts, names; structural panel (borders, insert/delete row/column, mirror, rotate, trim).
- Center: zoomable canvas with rulers, gridlines, optional row/column numbers.
- Bottom: dimensions, stitch/knot count, strings-needed readout (`cols + 1`).
- Full undo/redo. No progress display anywhere.

### 6.3 Work stage

Minimal, high-contrast, glanceable. The design goal is that a person mid-row can read it from a metre away without touching anything.

- **Dominant element**: the current row's run-length chips, rendered large — `[■ 1 Brown] [□ 3 White] [■ 5 Brown]` — with the direction arrow and row number.
- Below: a compact chart view with completed rows dimmed and struck through, the current row outlined, scrolled to keep the current row centred.
- Above or below the chips: the next row previewed, smaller and dimmed.
- Large primary button: **Row complete →**. Secondary: back.
- Progress bar with `row N of M` and remaining stitch count.
- **No editing tools are present or reachable.** Returning to Design is a deliberate action in the menu bar.
- Optional focus mode: hide everything except chips and the current row ±2.
- Optional high-contrast / large-text toggle and a light/dark switch.

### 6.4 Transitions

- Entering Work stage for the first time sets `started_at` and snapshots nothing — the pattern remains editable, but see below.
- Returning to Design while progress exists shows a non-blocking warning: *"You're 40 rows into this project. Structural edits may shift your place."* Stable row IDs (§4.5) mean cell edits and border additions are actually safe; the warning is informational, not a block.
- Opening a project defaults to **Work stage if progress > 0**, Design otherwise.
- Stage is persisted per project.

---

## 7. Import flow

### 7.1 Import

File dialog, drag-and-drop, and **paste from clipboard** (`Ctrl+V` of a screenshot is the most common real-world path — support it via `QGuiApplication.clipboard().image()`).

### 7.2 Confirmation — the reliability gate

- Source image with the fitted lattice overlaid and the detected extent outlined.
- Editable numeric spinners for **columns** and **rows**. Changing them re-derives the lattice from the same extent — this alone rescues most misdetections.
- Draggable extent handles on all four edges, snapping to pitch increments.
- Crop tool that re-runs `detect_pattern(crop=...)` — the manual escape hatch.
- **Color similarity slider** (ΔE 2–15) with live palette preview: swatches, cell counts, merge/split controls.
- Reconstructed pattern rendered **side by side** with the source. Visual diff is the fastest way for a human to spot an error.
- Low-confidence cells highlighted in the reconstruction.
- Failure states show the reason plus a "crop manually" path, never a dead end.

### 7.3 Commit

Build the `Pattern`, assign `row_id`s, persist, open in **Design stage**.

---

## 8. Data model

```python
@dataclass
class PaletteEntry:
    id: str
    hex: str                 # '#rrggbb'
    name: str                # editable, seeded from nearest DMC
    dmc: str | None = None

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
    start_direction: Literal['LTR','RTL'] = 'LTR'
    alternate_direction: bool = True

@dataclass
class Progress:
    completed_row_ids: set[str]
    current_row_id: str | None
    current_run_index: int = 0
    started_at: float | None = None

@dataclass
class Project:
    pattern: Pattern
    progress: Progress
    stage: Literal['design','work'] = 'design'
```

All mutations in `core/edit.py` are **pure functions returning a new `Pattern`**. This makes undo/redo a list of snapshots (a 60×250 `uint16` array is 30KB — snapshotting is cheap and far less bug-prone than inverse commands). Cap the stack at 50.

```python
def row_direction(p: Pattern, r: int) -> Literal['LTR','RTL']:
    if not p.alternate_direction:
        return p.start_direction
    flipped = (r % 2 == 1)
    if not flipped:
        return p.start_direction
    return 'RTL' if p.start_direction == 'LTR' else 'LTR'
```

### File format

A project is a `.alpha` file: a **zip archive** containing `pattern.json`, `progress.json`, `source.png`, and `cells.npy`. Inspectable, portable, trivially versioned via a `format_version` key. Reject unknown major versions on load.

Project library lives in the platform app-data directory, indexed by a small SQLite table (id, name, path, thumbnail, progress %, last opened) — or just a directory scan for v1.

---

## 9. Editing operations (`core/edit.py`)

```python
def set_cell(p, r, c, palette_index) -> Pattern
def flood_fill(p, r, c, palette_index) -> Pattern      # 4-connected, bounded by extent
def fill_rect(p, r0, c0, r1, c1, palette_index) -> Pattern
def fill_row(p, r, palette_index) -> Pattern
def fill_column(p, c, palette_index) -> Pattern

def add_border(p, *, top, right, bottom, left, palette_index) -> Pattern
def insert_row(p, at) -> Pattern
def delete_row(p, at) -> Pattern
def insert_column(p, at) -> Pattern
def delete_column(p, at) -> Pattern
def trim_uniform_edges(p, *, top, right, bottom, left) -> Pattern

def mirror_h(p) -> Pattern
def mirror_v(p) -> Pattern
def rotate_180(p) -> Pattern
def rotate_90(p, *, clockwise=True) -> Pattern   # C x R; every row a fresh row_id

def recolor_palette_entry(p, entry_id, new_hex) -> Pattern
def merge_palette_entries(p, from_id, into_id) -> Pattern
def delete_palette_entry(p, entry_id, replacement_id) -> Pattern
```

`add_border` is the headline feature — widen a piece without altering the artwork. A single panel with four numeric inputs, a linked/unlinked toggle, a palette color picker and a live preview. Negative values remove cells from that edge, with confirmation when non-uniform cells would be destroyed. New rows get fresh `row_id`s; existing IDs are untouched, so progress survives.

---

## 10. Readout (`core/readout.py`)

```python
@dataclass(frozen=True)
class Run:
    palette_index: int
    count: int
    start_col: int          # in working order, not raw column index

def encode_row(p: Pattern, r: int) -> list[Run]:
    """Apply row_direction, reverse if RTL, then run-length encode."""
```

Also provide `format_row_text(p, r) -> str` producing `1 Brown, 3 White, 5 Brown, 1 White` and a compact form `1B 3W 5B 1W`, plus `export_all_rows_text(p) -> str` for printing.

In the Work stage, tapping a chip sets `current_run_index`; completed chips dim and the active chip is outlined. Left/right arrow keys move through runs; advancing past the last run marks the row complete and moves on.

---

## 11. Testing

Reliability comes from the harness more than from the algorithm. Build it alongside §5, not after.

### 11.1 Synthetic generator (`tests/synth.py`)

Render a chart from a **known** grid with Pillow, feed it through `detect_pattern`, assert an exact cell-by-cell match.

Randomize across:

- Palette size 2–10, including palettes containing pure white **and** pure black.
- Pitch 6–40px, with `pitch_x != pitch_y`.
- Gridline width 1–3px, color from pure black through `#333`.
- Dimensions from 4×4 to 80×300.
- Outside-the-grid content: row/column numbers on all four edges, corner watermark, caption line, colored page margins.
- Non-integer downscale (×0.83, ×1.37) simulating browser-zoom screenshots.
- JPEG re-encode at quality 60/80/95.
- Rotation 0 to ±1.2° (must pass) and ±3° (must be rejected).
- Full rows/columns of solid black cells (the §4.3 trap).
- A pattern entirely white except a few cells (the §4.1 trap).

Run 500 randomized cases in CI. **Target: ≥99.5% exact match; zero cases producing a wrong result without a warning.**

### 11.2 Real-image corpus

20–30 real screenshots — tightly cropped, with full browser chrome, and with edge numbering. Hand-label correct dimensions, store as fixtures, assert dimensions and spot-check cells.

### 11.3 Unit tests

Lattice fitting against synthetic 1-D signals with dropped and spurious lines. Lab conversion against reference values. Run-length encoding **including direction alternation**. Structural ops preserving row-ID continuity and progress. Undo/redo round-trips. `.alpha` file round-trips.

---

## 12. Build order

| Milestone | Deliverable | Done when |
| --- | --- | --- |
| **M0** | `core/detect/` + synthetic harness + dev overlay. Headless, no app UI. | 500 synthetic cases ≥99.5% exact match |
| **M1** | Import wizard: load → confirm → commit | A real screenshot becomes a stored `Pattern` |
| **M2** | Work stage: canvas, progress, run chips, direction | A full piece can be worked from the app |
| **M3** | Design stage: paint, fill, palette, undo/redo | Round-trip edit and export |
| **M4** | Structural ops, borders | Progress survives a top-border insert |
| **M5** | Project library, `.alpha` persistence, exports | Multiple projects, restart-safe |
| **M6** | Packaging (PyInstaller), polish, shortcuts | Runs as a standalone app |
| **M7** *(optional)* | Export self-contained HTML work sheet | Pattern followable on a phone |

M0 carries all the risk and everything depends on its output shape. Don't start M1 until the harness is green. Note that **M2 precedes M3** — the Work stage is the smaller, more valuable half, and building it first means the app is useful before the editor exists.

---

## 13. Acceptance criteria

1. A chart with numbers along all four edges imports with correct dimensions and zero incorrect cells, no manual intervention.
2. A chart using white as a foreground color on a white page imports without any cells being trimmed or misread.
3. A chart containing a full row of black cells imports without that row being consumed as a gridline.
4. Detection completes in under 500ms for a 2000×1500 image.
5. Adding a 3-cell top border to a pattern with rows 1–10 complete leaves exactly those same 10 rows complete.
6. The readout for row 2 with `alternate_direction=True` reads right-to-left.
7. No editing tool is reachable from the Work stage.
8. Any detection failure produces a named reason and a manual-crop path, never a silently wrong pattern.
9. Closing and reopening the app restores every project with progress and stage intact.

---

## 14. Deferred, but keep the model compatible

- **Skipped cells / 0-knots.** Reserve palette index `0xFFFF` as a sentinel now to avoid a later migration.
- Staggered-row charts — would need per-row phase in the lattice model.
- Stitch aspect ratio: real stitches aren't square, so a "true proportions" preview would render cells at roughly 5:6 or 2:3. Rendering-only; the data model is unaffected.
- Yarn/thread length estimation from per-color counts.
- Photo-of-paper import via four-corner homography.
