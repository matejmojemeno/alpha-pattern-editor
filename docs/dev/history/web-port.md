# The web port: Alpha Pattern Editor → Pyodide web app

> **A frozen record** of how the PySide6 desktop app was ported to the web (Phases 0–3),
> kept as it was when the port finished; nobody updates it. What is true now is in
> [`../architecture.md`](../architecture.md), [`../rules.md`](../rules.md) and
> [`../areas/`](../areas/).

This is the implementation plan for turning the PySide6 desktop app into a hosted web app.
The product spec, with the § numbers cited throughout the code, is `plan.md` at the repo
root (now [`docs/dev/spec.md`](../spec.md)). This document covers *how* the app moves to the web, not *what* it does.

## Status

| Phase | State |
|---|---|
| 0 — core preparation | **done** |
| 1 — Library + Work + storage | **done** (`newPattern` and its dialog landed with Phase 3, part 1) |
| 2 — Import wizard + Pyodide | **done**: part 1 (the worker boundary and a minimal photo import, end to end) and part 2 (the correction controls, the shrink rule, the watchdog) |
| 3 — Design stage | **done**: part 1 (the editing logic and the Design screen) and part 2 (the structural panel, progress across structural edits, PNG export, the tablet layout and touch, pinch-zoom on the Work chart). The desktop app (`alphareader/ui/`) is still in the repo; retiring it is the owner's call |

What each phase delivered, and everything built after the port, is recorded by area in
[`../areas/`](../areas/), under "During the port" and "After the port".

### Where to start

Tasks that can safely run in parallel, in dependency order:

1. **In parallel:**
   - **Storage layer**, `web/src/storage/`. Self-contained: it's specified entirely by the
     `.alpha` format and can be tested against a file written by the desktop app.
   - **Readout/work port**, `web/src/logic/`. Must replay `fixtures/logic_golden.json`.
2. **Landing screen, Library and Work UI.** Done. The settings question is decided
   (app-wide, in `localStorage`).
3. **Phase 2.** Everything in it depends on the worker boundary, so build that first and
   only then split the rest of Phase 2 across tasks.

- **Next:** `newPattern(cols, rows, hex)` with its size-and-colour dialog (the Design
  entry stays disabled until Phase 3), then Phase 2.

<a id="phase-0"></a>

## Phase 0 — Core preparation: done

Done in Python and validated against the existing test suite before any web code was
written.

1. **`dmc.json` loading** now goes through `importlib.resources` (cached, with the Lab
   array frozen read-only), so it works once `core/` is packaged. The cache isn't a speed
   fix. The table is 119 entries, and an uncached load takes ~0.15 ms.
2. **`save_project` no longer mutates its argument.** It stamps `updated_at` on a copy
   and returns the new `Project`.
3. **SciPy removed** (`core/detect/_nd.py`). It replaces the five SciPy calls: one-axis
   `binary_closing`, `uniform_filter1d`, `find_peaks` (distance/prominence subset), and
   complete-linkage clustering. Details:
   - **Tested against SciPy itself** by `test_nd.py`, over randomised inputs.
   - **Clustering speed:** the obvious clustering was 28.9× slower than SciPy. A
     nearest-neighbour cache fixed that; detection now costs ~1.4× SciPy's time.
   - **One deliberate behaviour change:** palette order now breaks count ties on the
     centroid colour. Before, two colours with equal counts were ordered by an internal
     detail of the clustering library.
   - Corpus accuracy is unchanged.
4. **`scripts/gen_fixtures.py`** writes `fixtures/logic_golden.json`: 15 patterns and
   1,347 progress steps. It covers all 8 direction/numbering combinations, clamped
   out-of-range indices, stale cursors and partial stitches. Since Phase 3 it also writes
   `fixtures/edit_golden.json` for `edit.py`.

Also landed in this phase:
- **Case-119 fix.** The palette used to silently drop rare colours on sparse charts. It
  now recovers them, and warns when a cell matches no detected colour.
- **One item dropped.** The import-time `__file__` in `io.py` was left alone: it only
  computes a string, and `io.py` never ships to the browser.

<a id="phase-1"></a>

## Phase 1 — Library + Work, no Pyodide (~3 weeks)

Build this before Import, even though Import comes first for a user. It needs no WASM,
so it's demoable within days. It can be tested with `.alpha` files from the desktop app,
which also proves format compatibility early.

**Storage (`web/src/storage/`)** replaces `io.py` entirely. Zip and `.npy` handling live
in **TypeScript, not Python**, so that opening a project never boots Pyodide.
- **`alpha.ts`** reads and writes the `.alpha` zip with `fflate` (smaller and faster than
  JSZip). It must stay byte-compatible with the desktop format: `meta.json`,
  `pattern.json`, `progress.json`, `cells.npy`, and an optional `source.png`.
- **`.npy` handling:** the v1 header for a C-order `uint16` array takes ~10 lines to parse
  and ~10 to write. Write it by hand rather than pulling in a library.
- **Keep the desktop's loading rules:** reject files with `format_version > 1`, and
  tolerate missing fields (`progress.json` files in the wild already lack
  `current_run_stitches`). See the [`start_direction` rule](../rules.md#start-direction).
- **`db.ts`** is IndexedDB via `idb`, with two stores:
  - `projects`: the `.alpha` file as a Blob, keyed by pattern id.
  - `summaries`: name, rows, cols, progress %, `updated_at` and a thumbnail Blob.

  The Library renders from `summaries` without opening every archive, which is the job
  `list_saved_projects()` does today.
- **Export and import `.alpha` files** via download and a file picker. **Ship this in the
  first build.** It's the only backup, and the only way to move a project to another
  device.

**Work stage.** Port `readout.py` → `logic/readout.ts` and `work.py` → `logic/work.ts`,
and test both against `fixtures/logic_golden.json`. Then build the UI: header, progress
bar, colour-segment chips, chart, bottom bar. Behaviours to reproduce:
- **Chip states:**
  - done: `✓`, raised background
  - current: `· {done}/{count}`, 2 px accent border
  - pending: plain

  Tapping a chip opens the segment dialog (stitches spinner plus "mark complete").
- **Keyboard:** `→`/`↓` complete the row, `←`/`↑` go to the previous row, `Space`/`Return`
  complete the row, `Cmd/Ctrl+S` saves.
- **View options:**
  - Focus mode: the chart draws only the current row ± 2, not just scrolls to it
    (`chart_view.py:46-52`).
  - High contrast.
  - "Start rows from the right".
- **Export the readout as `.txt`** (`export_all_rows_text`).

**Chart rendering (`render/chart.ts`).** The drawing in `chart_view.py:54-119` maps 1:1
onto Canvas 2D. Its *layout* does not, because of the next section. Port the drawing
faithfully, including these deliberate choices:
- **Gridlines are near-black on purpose.** They sit on yarn colours, not on the page
  (`theme.py:71-77`).
- **The done-wash is neutral grey,** `rgba(128,128,128,150)`, chosen to look faded over
  both pale and dark patterns.
- **Axis numbers:** they sit in 34 px / 22 px margins, are labelled every 5th line on charts
  wider or taller than 15 cells, and are numbered with `working_number` so they follow
  working order.

Draw into an offscreen canvas when state changes and copy it to the screen, rather than
calling `fillRect` per cell on every frame.

<a id="chart-layout"></a>**Chart layout: per-row heights, not one cell size.** The desktop sizes every row with
one number, `cell = max(3, min(avail_w/cols, avail_h/rows))` (`chart_view.py:69`). Two
wanted behaviours break that, and **both must be designed in from the start**. Building
the single-number version first and retrofitting means doing the layout twice.

- **Scroll long charts instead of shrinking them.** Beyond an aspect ratio of roughly
  2:1, size cells to the chart's *shorter* axis and scroll along the longer one. Today a
  40×200 chart (common for blankets and scarves) renders at near-unusable cell sizes.
  **Automatically keeping the current row in view is non-negotiable**, so you never
  lose your place. This matches `plan.md` (now `docs/dev/spec.md`) §6.3, which already asks for the chart to be
  "scrolled to keep the current row centred". It's the README's "fits fully on screen
  (no scrolling)" that describes the current implementation, and that sentence changes
  when this ships.
- **Taller current row.** The row being worked, and the few either side of it, render
  taller than the rest, so the colours are easier to read and your place is easier to
  find again after looking away. It can be switched off in Settings.

Both are handled by the same layout:

```
rowHeight(r)  -> emphasised height if |r - current| <= radius, else base height
yOffsets      -> running sum of rowHeight
viewport      -> scroll offset into yOffsets, following `current`
```

Everything drawn from `y` then works unchanged: fills, gridlines, strike-through, row
numbers, the current-row outline. Put this in `render/layout.ts` as pure functions and
unit-test them. That's where the bugs will be, not in the canvas calls.

The emphasis radius is related to focus mode, which already narrows drawing to the
current row ± 2 (`_visible_rows`, `chart_view.py:46`). Treat them as one concept, "rows
around the current one", rather than two overlapping settings.

**Following your place across.** A chart wider than its view (a scarf worked sideways,
say 98 columns on a phone) also follows *horizontally*: `followCurrentX` keeps the next
stitch to work in view, from the current segment and its partial stitches. `Run.start_col`
counts in working order, so on a right-to-left row it's mirrored (`cols - 1 - position`).
A new row starts at the side it's worked from. The chart only moves when your place
nears the edge of the view, a view at a time, never on every stitch. A scroll by hand is
left alone until the next progress change. Charts that fit across never scroll sideways.

**Pinch-zoom on the Work chart (built in Phase 3, part 2).** The owner wanted
pinch-to-zoom (and a matching zoom on desktop: Ctrl/⌘ + wheel, which is also a trackpad's
pinch) so a small chart can be blown up, or a large one read in more detail, on a phone.
It works *with* the row and column following, not around it:

- Zoom scales the base cell size that `computeLayout` picks, so per-row heights, emphasis
  and focus mode keep working, and `followCurrent`/`followCurrentX` keep doing the
  scrolling. It must not become a CSS transform over the canvas, which would blur it and
  put the scroll offsets out of step with the layout.
- Zooming keeps the point under the fingers still, then the next progress change follows
  your place as usual, like a scroll by hand does.
- A chart that fits across at 1× may scroll across once zoomed in; following then applies.
- Pinch must not fight native touch scrolling or trigger the browser's page zoom.

**Mobile.** Work is the stage that most needs to work on a phone:
- Single-column layout under ~700 px: chart on top, chips underneath.
- Large tap targets.
- Screen Wake Lock, so the screen doesn't sleep mid-row.
- Generous default type size.

<a id="landing-screen"></a>**Landing screen.** The first screen offers four entry points instead of opening straight
onto the project grid: **Import pattern**, **Design pattern** (start from blank),
**Library** and **Settings**. (Since reshaped: Import is a large drop zone with the
others, plus Feedback, beside it; see ["Home screen"](../areas/library.md#home-screen).) On the desktop, the Library *is* the landing screen, with
only "Import new chart…" and "Refresh". The web app gets this from the start rather than
porting that. Two parts need real work:
- **Designing from blank has no code path yet.** Every `Project` today comes from loading
  a `.alpha` file or from detection. Add `newPattern(cols, rows, hex)` to `web/src/logic/`.
  It returns a pattern with a one-entry palette and fresh `row_ids`, and needs a small
  size-and-colour dialog in front of it. It belongs with the other pure logic, so it's
  cheap. (If a Python `new_pattern` lands on the desktop first, port it and add it to the
  golden fixtures.) "Design pattern" opens the Design stage, which arrives in Phase 3.
  Until then, hide the entry or show it disabled.
- **Settings need a store, and a decision first.** Nothing in the desktop app persists
  preferences. Each toggle is either per-window and forgotten on close (focus mode, high
  contrast) or saved on the pattern (`start_direction`). **Decide per-app versus
  per-project before building any setting.** The taller-row switch below depends on it.
  Recommended: app-wide display preferences in `localStorage`, and anything that changes
  how a pattern is read (like `start_direction`) stays on the pattern, as today.

**Library.** A card grid: thumbnail, name, `{cols}×{rows}`, progress bar, and delete
with a confirmation. Cards can be opened from the keyboard. The desktop's file watcher
and single-window logic have no web equivalent and are dropped; a route replaces them.

**Theme (`theme/tokens.css`).** `theme.py` ports almost mechanically:
- The fixed colours `ACCENT #f0a800`, `WARN #b26a00` and `DANGER #d33` become CSS custom
  properties.
- The helpers derived from the Qt palette (`axis_color`, `muted_hex`, `border_hex`,
  `raised_hex`) are linear mixes between text and background colour, which is exactly
  what CSS `color-mix()` does.
- `prefers-color-scheme` replaces reading the Qt palette.
- `font_css()`'s OS-relative sizing becomes `rem` units.

**Write one text-contrast helper.** "Black or white text on this swatch?" is computed
twice, both times as luma > 140 (`confirm_window.py:423`, `design_window.py:397`). Port
it once as `contrastOn(hex)`. `chips.py:55` looks like a third copy but isn't: it picks
the *outline* drawn around a swatch, using `r+g+b > 180`. That's a separate decision,
so don't fold it into `contrastOn`.

<a id="phase-2"></a>

## Phase 2 — Import wizard and the Pyodide boundary (~2.5 weeks)

**Worker (`detect/worker.ts`).** Pyodide runs in a web worker and never on the main
thread. `detect_pattern` is 100–500 ms of solid numpy and would freeze a crop drag.

**Keep the existing fast/slow split.** Full `detect_pattern` runs in only three places:
- image load (`confirm_window.py:211`)
- the Re-detect button (`:82`)
- applying a crop (`:301`)

The rows/cols spinboxes, the ΔE slider and the low-confidence checkbox only **resample**,
via `ConfirmState.preview()` → `confirm.resample()`. So the protocol needs two kinds of
request: `detect` (slow, rare) and `setParams` + `preview` (fast, on every change). Core
already gets this right; keep it.

**Boundary design.** Keep it narrow and typed. Only plain data crosses, and no `PyProxy`
ever leaves the worker.
- JS → worker: `{ sessionId, rgb: Uint8Array, width, height, deltaE, crop? }`
- worker → JS: `{ cols, rows, cells: Uint16Array, palette: PaletteEntry[],
  confidence: Float32Array, warnings: string[], lattice: {...} }`
- Arrays are transferred, not copied.
- Strip `DebugLayers` in the bridge, and assert in a test that it never appears.
- Errors cross as data (`{ok: false, code, message}`), not as exceptions.

**`ConfirmState` stays inside the worker.** It's stateful: `set_dims`, `set_extent` and
`set_delta_e` mutate it and invalidate a cached `Preview` (`confirm.py:55-90`). Keep it
in the worker, keyed by `sessionId`, and expose `setDims`, `setExtent`, `setDeltaE` and
`preview` as messages. Don't mirror it in TypeScript; its whole purpose is caching an
expensive resample.

<a id="cancellation"></a>**Cancellation.**
- Tag each request with an increasing id, and discard responses that arrive out of date.
- Send the first change immediately. While a request is in flight, fold any further
  changes into a single pending request. A 40-tick slider drag then produces 2–3
  resamples, and the preview still moves on the first tick. This beats a plain trailing
  debounce.
- Keep showing the last good preview, and dim it after ~200 ms. Never blank the pane.

<a id="pillow"></a>**Pillow isn't needed in the browser.** `core/` only uses Pillow in `io.py`, which isn't
shipped. The browser decodes the image itself (`createImageBitmap` →
`OffscreenCanvas.getImageData`), hands Python a raw RGB array, and re-encodes
`source.png` itself. That's also how `scripts/parity/` feeds images to Pyodide.

**UI.** The three-pane splitter becomes a responsive layout that stacks or turns into
tabs under ~900 px. Reproduce:
- the rows/cols inputs
- the "colour detail" slider, which runs opposite to ΔE: moving it right gives more
  colours, which means a lower ΔE
- the crop rubber-band, with its letterboxed coordinate mapping (`source_view.py:46-54`)
- "flag unsure cells", and the red X drawn over cells with `confidence < 0.6`
- the low-confidence warning, and the new "cell matches no detected colour" warning
- drag-and-drop and paste for adding images
- the friendly `_FAILURE_HINTS` text for all four `DetectionError` codes

**First load.** Pyodide only downloads when the user actually imports an image. Show real
progress, and start preloading when the pointer hovers over, or focus lands on, the
import button.

<a id="phase-3"></a>

## Phase 3 — Design stage (~3.5 weeks)

Port `edit.py` → `logic/edit.ts` (pure, copy-on-write, ~300 lines) instead of calling it
through Pyodide. After this, Pyodide is *only* used for detection. First extend
`scripts/gen_fixtures.py` to record `edit.py`, the same way it records readout and work.

Then build the Design stage:
- Six tools with shortcuts: paint `B`, fill `F`, rectangle `R`, eyedropper `I`, fill row
  `H`, fill column `V`.
- Palette editing: add, recolour, delete.
- The structural panel: pad, scale, mirror, flip, rotate 180°, trim uniform edges.
- **Pad to size with positioning.** Padding currently always centres the pattern
  (`left, top = dc // 2, dr // 2` at `edit.py:304`). Let it be offset instead, so 10
  added rows can land as 2 at the top and 8 at the bottom. The model already supports
  this: `add_border` takes independent top, bottom, left and right amounts and keeps
  `row_ids`, so Work-stage progress survives. `padToSize` just takes optional
  `offsetTop`/`offsetLeft`, validated as `0 ≤ offset ≤ added`, defaulting to centred.
  Ship numeric offset fields first; they cost almost nothing and cover the need.
  Dragging the pattern on a live preview is a nice extra. If the Python change lands on
  the desktop first, the `edit.py` fixtures will pick it up.
- Undo/redo on `Cmd+Z` / `Cmd+Shift+Z`.

Two things to reconsider rather than copy:
- **Undo stores 50 full `Pattern` snapshots** (`design_window.py:22`). That's fine in Qt;
  in a browser tab, consider storing diffs if patterns get large.
- **A drag-paint stroke is one undo entry,** recorded the first time a cell actually
  changes (`design_window.py:326-333`). Keep this behaviour; it's easy to get wrong.

Desktop-first layout that degrades on tablets. Explicitly unsupported on phones.

## Verification

- **Python:** `.venv/bin/python -m pytest alphareader/tests/ -q`. Expect only the one known
  failure listed under Rules.
- **Detection parity:** `python scripts/parity/check.py` after any change to
  `core/detect`. It must report 89/89 bit-identical.
- **TS/Python logic parity:** `logic/readout.ts` and `logic/work.ts` replay
  `fixtures/logic_golden.json` in Vitest. Compare `completed_row_ids` as a set.
- **Chart layout:** unit-test `render/layout.ts`:
  - row heights, with emphasis on and off
  - the y-offset table
  - the switch from fitting to scrolling at the aspect-ratio threshold
  - that the current row stays in view as it moves
  - that your place in the row stays in view across, on rows worked either way
- **Format compatibility:** take a `.alpha` file written by the desktop app, load and save
  it through the web storage layer, and check the desktop app still opens the result.
  Include a `format_version: 999` archive to confirm it's still rejected.
- **End to end (Phase 2):** Playwright:
  1. Drop a chart from `test_images/` into the importer.
  2. Confirm detection, then save.
  3. Reload the page.
  4. Check the project reopens from IndexedDB with its progress intact.

  Include a phone-sized viewport for the Work stage.
- **Bundle budget:** assert Tier A stays under ~250 KB gzipped, and that the Work stage
  makes zero Pyodide requests.

## Effort

| Phase | Estimate |
|---|---|
| 0 — core prep | done |
| 1 — Library + Work + storage | ~3 weeks (includes the landing screen, settings and chart layout) |
| 2 — Import + Pyodide | ~2.5 weeks |
| **First release** | **~5.5 weeks from here** |
| 3 — Design | ~3.5 weeks |

## Risks

Ranked by what could still go wrong.

1. <a id="risk-1"></a>**iOS Safari deletes IndexedDB data for sites that aren't installed, after ~7 days
   without a visit.** That directly undermines "local-only, no accounts" for exactly the
   user who picks a project up every other weekend. It needs a product answer, not just
   code:
   - Call `navigator.storage.persist()`. Safari grants it far more readily to sites added
     to the Home Screen.
   - Prompt the user to "Add to Home Screen".
   - Make Export Backup prominent.
   - Nag when a project with real progress has never been exported.

   Check the actual behaviour early.
2. <a id="risk-2"></a>**Detection speed and memory on phones.** WASM runs detection ~2× slower than native
   (1.6–2.9× measured), and phone CPUs are slower again. A 4000×3000 phone photo through
   `edge_maps()` could plausibly use 300–500 MB of memory. Mitigations:
   - Shrink large images before detection, then map the lattice back to the image's
     own pixels. Detection only needs to resolve a pitch of ≥6 px (`periodic.MIN_PITCH`).
   - Terminate the worker when the user leaves `/import`, to free the memory.
   - A watchdog terminates a detection that runs past 20 s (Phase 2, part 2).

   **The rule (Phase 2, part 2):** the smallest whole factor that brings the image to
   4 MP or fewer (`bridge.shrink_factor`). Part 1 used ceil(long edge / 1600), which
   halved the owner's 1145×2497 chart to ~6.5 px per cell: 87×191 against the desktop's
   88×192. A pixel budget leaves that chart whole, because memory follows the pixel
   count, not the long edge. A fractional area-average was tried and rejected: it beats
   against thin gridlines (that chart came out 88×115 at 2000 px).

   `scripts/downscale_study.py`, each chart upscaled (Lanczos) to 2000, 3000 and 4000 px:

   | rule | same size as full size | true size |
   |---|---|---|
   | synthetic, 600 images | | full size: 543 |
   | part 1, ceil(edge / 1600) | 547 | 557 |
   | **4 MP, whole factor** | **576** | 546 |
   | real (8 test charts + the owner's 23 saved charts), 93 images | | full size: 53 |
   | part 1 | 63 | 55 |
   | **4 MP, whole factor** | **75** | 56 |

   Shrinking hard slightly helps crisp synthetic renders; on real charts keeping
   resolution matters more. The real corpus's "true size" is what the owner saved.

   `web/e2e/large-photo.bench.spec.ts`, desktop Chromium, peak WASM memory:

   | image | full size | part 1 | 4 MP rule |
   |---|---|---|---|
   | dachshund 4000×3000 | 2.2 s, 528 MB | 1.1 s, 142 MB (1333×1000) | 1.6 s, 185 MB (2000×1500) |
   | monkeys 4000×3820 | 2.5 s, 663 MB, 47×47 | 1.3 s, 164 MB, **47×48** | 1.7 s, 226 MB, 47×47 |
   | cats 4000×1801 | 2.0 s, 398 MB | 1.2 s, 92 MB | 1.5 s, 126 MB |
   | monkeys 2046×1954 (the most left whole) | 1.0 s, 200 MB | 0.7 s, 91 MB, **47×48** | same as full size |
   | garment 2974×4000 | 38 s, 3.5 GB, wrong | 17 s, 2.0 GB, wrong (106×166) | 1.5 s, 221 MB, refused (LOW_RESOLUTION, as the desktop refuses the original) |

   Still open: nothing has been timed on a real phone (DevTools CPU throttling doesn't
   reach workers). The watchdog bounds time, not memory: a chart as pathological as
   garment but readable at 4 MP could still need a lot, until `_nd.complete_linkage_labels`
   stops building an n×n×3 float64 difference array (a separate fix to `core/detect`).
3. **Data loss in general.** See risk 1. Ship `.alpha` export in the first build.
4. **Two implementations of the readout/work logic.** The fixture corpus guards against
   drift, but maintaining two copies is an ongoing cost. That's why `edit.py` should also
   move to TypeScript in Phase 3 instead of being called through the worker.

**Resolved during Phase 0:**
- **numpy versions differ** between the desktop (2.5.1) and Pyodide (2.4.6), but
  detection is still bit-identical.
- **Replacing SciPy** didn't change results: output is byte-identical and corpus accuracy
  is unchanged.
- **Randomness and time work in Pyodide:** `uuid.uuid4()` and `time.time()` behave as on
  the desktop.
