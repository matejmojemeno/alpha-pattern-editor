# Web port plan: Alpha Pattern Editor → Pyodide web app

This is the implementation plan for turning the PySide6 desktop app into a hosted web app.
The product spec, with the § numbers cited throughout the code, is `plan.md` at the repo
root. This document covers *how* the app moves to the web, not *what* it does.

## Status

| Phase | State |
|---|---|
| 0 — core preparation | **done** |
| 1 — Library + Work + storage | **in progress**: storage, logic, app shell, Library and Work stage done; `newPattern` and the design-from-blank dialog remain |
| 2 — Import wizard + Pyodide | **done**: part 1 (the worker boundary and a minimal photo import, end to end) and part 2 (the correction controls, the shrink rule, the watchdog) |
| 3 — Design stage | not started |

**Hardening before hosting** (after Phase 2, one PR):

- **Detection memory.** Complete linkage (`_nd.py`) fills one n×n float64 matrix in bands
  of 64 rows, in place and bit-identical, instead of an (n, n, 3) broadcast and copies.
  garment.png at 4000 px saved as a JPEG and shrunk to 4 MP (n = 6,254 colours): the
  clustering peaked at 2,190 MB, now 332 MB (tracemalloc).
- **Running out of memory** ends on a friendly screen: `bridge.py` answers MemoryError as
  `OUT_OF_MEMORY`; the worker marks Pyodide's fatal errors (a nearly full heap can trap
  as "memory access out of bounds") and always answers; the client terminates the worker
  on either, which gives the memory back; the import screen offers Crop, which starts
  over in a fresh worker. `e2e/corrections.spec.ts` fills the worker's memory with a
  test hook and lets the real detection run out.
- **Work chart:** laid out in the scroller's content box, so a classic scrollbar hides
  none of it (`e2e/scrollbar.spec.ts`); and the cells are sized as if the whole band
  around the current row were there, so the chart no longer zooms ~10% as the current
  row reaches the first or last rows.
- The flaky `repo.test.ts` change-events test awaits each listing.

What Phase 2 delivered:

- **Part 2: the correction controls** (`web/src/ui/import/`, `web/src/importer/`).
  - The desktop confirm screen: rows and cols (1–999, typed or −/+), the inverted
    "Colour detail" slider (ΔE 2–15), "Flag unsure cells" (a red X below 0.6
    confidence), Crop (a pointer-event rubber band mapped through the letterboxed fit,
    `letterbox.ts`), Re-detect, the gridline and extent overlay, the palette on its own
    colours, and the warnings, recomputed with every preview.
  - Only Crop and Re-detect detect again; everything else resamples. Changes made while
    one is in flight are folded into one request, stale answers are dropped, and the
    last preview stays up, dimmed after 200 ms. Saving waits for a change still on its
    way (`DetectSession.idle`).
  - Under 900 px the image, pattern and colours are tabs and the save bar sticks to the
    bottom; wider, three panes.
  - **Shrink rule:** the smallest whole factor that brings the image to **4 MP** or
    fewer (`bridge.shrink_factor`), replacing part 1's ceil(long edge / 1600). A quiet
    notice says when a photo was shrunk. Evidence in Risk 2.
  - **Watchdog:** a detection (open or redetect) that runs past 20 s terminates the
    worker; the screen says so and offers Crop (which starts over on just the crop,
    `open_session(crop=)`) or Try again.
  - Parity: `web/e2e/corrections.spec.ts` makes each correction in Chromium with real
    Pyodide and compares the saved pattern cell for cell with the desktop making the
    same corrections (`scripts/desktop_import.py detect IMAGE rows=… cols=… de=… crop=…
    redetect`).
- **Part 1: detection in the browser.**
  - `alphareader/core/bridge.py`, the only Python aware of JavaScript. A `ConfirmState`
    per session; `open_session`/`redetect` detect, `set_params`/`preview` only resample,
    `commit` returns a Pattern. Plain data and 1-D arrays only, no `DebugLayers`, and
    `DetectionError` as `{ok: false, code, message}` (`test_bridge.py`).
  - `scripts/build_core_bundle.py` zips `core/` without `io.py`. A Vite plugin
    (`web/scripts/detectAssets.ts`) self-hosts it with Pyodide **314.0.7** and numpy's
    wheel: no CDN at runtime, the build fails if the three version pins disagree or a
    file passes 25 MiB.
  - `web/src/detect/`: a module worker with boot progress by stage (runtime, numpy,
    core); a client with request ids, stale answers dropped, updates folded while one
    is in flight, and every failure as data. The `set_params`/`preview` path is built
    and tested for part 2.
  - `#/import`, loaded lazily: images by picker, drop or paste from the landing screen
    and the Library; real download progress (~9.3 MB gzipped the first time); the
    result; save with the source PNG and open the Work stage; the desktop's failure
    hints. Hovering "Import pattern" preloads; any other screen terminates the worker.
  - Large images are shrunk by a whole-number factor before detection (Risk 2); the
    saved source stays full size. (Part 2 changed the rule.)
  - Parity through the UI: `dachshund.png` saves exactly the desktop's cells. All five
    test JPEGs currently match exactly too (reported, not enforced).

What Phase 1 has delivered so far (`web/`):

- **Storage and logic** (PR #6): `.alpha` read/write compatible with the desktop in both
  directions, IndexedDB via `ProjectRepo`, and `readout.ts`/`work.ts` replaying the golden
  fixtures.
- **App shell, Landing, Library, Settings** (PR #7):
  - Hash routing (`#/library`, `#/work/<id>`), so deep links survive a refresh on any
    static host without an SPA fallback rule.
  - `theme/tokens.css` (the port of `theme.py`) and `contrastOn()`.
  - The settings decision is made: **app-wide display preferences in `localStorage`**
    (`src/settings/store.ts`: row emphasis, high contrast, focus mode). Anything that
    changes how a pattern is read stays on the pattern.
  - Library card grid with Export, delete, keyboard opening, and `.alpha` import by picker
    or drop. Thumbnails are downscaled at save time (DB version 2), and
    `navigator.storage.persist()` is requested after the first save or import.
  - Playwright (`npm run test:e2e`) proves persistence across a real reload.
- **Work stage** (PR #8), at `#/work/<id>`:
  - `render/layout.ts`: per-row heights, `yOffsets`, and a viewport that keeps the
    current row centred. Charts past 2:1 are sized to their short axis and scroll along
    the long one. Row emphasis and focus mode share one "rows around the current one"
    range (`nearRows`, current ± 2).
  - `render/chart.ts`: the cells are drawn once, a pixel per cell, into an offscreen
    image; each frame scales it onto a viewport-sized canvas in a few bands and draws
    the gridlines, done-wash, strike line, outline and axis numbers over it. An 88×194
    chart scrolls within one frame per step at 4× CPU throttling.
  - Header, chips, segment dialog, next-row preview, Previous row / Row complete, the
    keyboard, "Start rows from the right" (on the pattern), Export readout, and rename
    (also on each Library card).
  - Saving is automatic (`app/autosave.ts`): debounced ~300 ms, flushed on
    `visibilitychange`/`pagehide`/leaving, and stamps `stage: "work"`. There is no Save
    button.
  - A Screen Wake Lock is held while the Work stage shows (`app/wakeLock.ts`).
  - `ProjectRepo.subscribe`: the Library and the landing count re-list after every save,
    import and delete, which fixes the Library showing part of a list after a
    slow import.
- **Next:** `newPattern(cols, rows, hex)` with its size-and-colour dialog (the Design
  entry stays disabled until Phase 3), then Phase 2.

What Phase 0 delivered, and what later phases build on:

- **`scripts/parity/`** — proves `core/detect` gives byte-identical results under Pyodide
  and desktop CPython. 89/89 charts identical, even though the desktop runs numpy 2.5.1
  and Pyodide numpy 2.4.6.
- **`core/detect/_nd.py`** — NumPy replacements for SciPy. SciPy is no longer imported by
  the app, and the download needed to import a chart fell from ~22.7 MB to ~8.9 MB.
- **`fixtures/logic_golden.json`** — the golden corpus the TypeScript ports of
  `readout.py` and `work.py` must reproduce. Schema in `fixtures/README.md`.

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

## Rules for anyone working on this

These are the non-obvious constraints. Each one was learned the hard way or is easy to
break without noticing.

- **After any change to `alphareader/core/detect`, run `python scripts/parity/check.py`.**
  It must report 89/89 bit-identical. It exits non-zero otherwise. Run `npm install` in
  `scripts/parity/` once first.
- **The Python is the spec for readout and progress.** If `readout.ts`/`work.ts` disagree
  with `fixtures/logic_golden.json`, the TypeScript is wrong. If you change `readout.py`
  or `work.py`, run `python scripts/gen_fixtures.py` and commit the result;
  `test_golden_fixtures.py` fails until you do.
- **Out-of-range indices clamp, they don't throw.** The fixtures pass negative and
  too-large indices on purpose.
- **Do not "fix" the `start_direction` default asymmetry.** `io.py` defaults it to `"LTR"`
  when loading a file, while the `model.py` dataclass defaults to `"RTL"`. This is
  deliberate: it keeps files written before right-to-left became the default reading
  correctly. Unifying the two would silently mirror every old project.
- **`DebugLayers` never crosses the worker boundary.** It holds full-resolution masks,
  megabytes per message.
- **Don't "simplify" `_nd.py`.** `find_peaks` applies `distance` *before* `prominence`,
  exactly as SciPy does. Complete linkage uses a nearest-neighbour cache because the
  obvious version is O(n³) (23 s against SciPy's 1 s on a noisy chart), and fills its
  one n×n matrix in bands because the obvious broadcast peaks at ~2.2 GB on a JPEG with
  ~6,300 colours, which kills a phone tab. All three are load-bearing.
- **The Work chart lays out rows with per-row heights, never a single cell size.**
  Scrolling long charts and the taller current row both depend on it (see Phase 1), and
  retrofitting it later means redoing the layout.
- **The Work stage makes zero Pyodide requests.** Keeping Pyodide out of the Work stage is
  what makes the app usable on a phone. Treat any regression here as a bug.
- **The Python suite has one known failure,** `test_edge_numbers_all_sides`: a 44×5 chart
  whose dimensions come out one column short. It's documented in `test_images/README.md`.
  Any other failure is new.

## Context

Alpha Pattern Editor is a ~6,500 LOC PySide6 desktop app that turns a photo of a crochet
alpha chart into an editable, trackable pattern (Library → Import → Work → Design). It
only runs on a Mac with the repo checked out and a venv set up. That makes it impossible
to share, and unusable where the Work stage matters most: propped up on a table, or on a
phone, while crocheting.

The goal is a hosted web app with no backend and no accounts. What makes this feasible
is that `alphareader/core/` (~2,400 LOC) is already strictly UI-free, and it touches the
filesystem in only two places. So this is a frontend rewrite plus a storage swap, not a
ground-up rebuild.

**Decisions taken:**
- Pyodide (Python compiled to WASM), no backend, static hosting.
- The desktop Qt app is retired once the web app reaches parity, so `core/` may be
  restructured freely.
- Storage is local-only: IndexedDB plus `.alpha` import/export.
- The first release is Import + Work + Library. Design comes later.
- Import and Work must work on phones and tablets. Design is desktop-first.

## Central decision: Pyodide handles detection only

The obvious reading of "Pyodide rewrite" is to run all of `core/` in the browser behind a
JavaScript UI. That would be a mistake:

- `work.py` and `readout.py` together are ~300 lines of list indexing, set membership and
  string formatting. The **only** numpy in either is `np.diff`/`np.flatnonzero` for
  run-length encoding, which is a five-line loop in TypeScript.
- Neither returns a numpy array. Every public function returns `Progress`, `int`, `bool`,
  `str`, or `list[Run]` of plain ints.
- `edit.py` (Phase 3) is likewise pure copy-on-write over a small integer grid.

There's no reason to make a phone download a WASM runtime just to show a row of
stitch counts.

**So the app is split into two tiers:**

| Tier | Contents | Cost | When it loads |
|---|---|---|---|
| **A — TypeScript** | all UI, model types, `readout`, `work`, storage, `.alpha` read/write, later `edit` | ~150 KB | always |
| **B — Pyodide** | `detect/` + `confirm.py` only | ~8.9 MB (measured) | lazily, only when importing a *new image* |

The Work stage, the Library, and opening or saving `.alpha` files never touch Python. They
load instantly, work offline, and work on a phone. Pyodide sits behind a single call:
image in, detected pattern out. Detection is also the only code where a rewrite would be
reckless, because it's the part that took the most work to get right.

## Repo layout

Monorepo. The Python package stays where it is and keeps its pytest suite.

```
alpha-pattern-editor/
  plan.md                 # product spec (the § numbers cited in code)
  docs/web-port-plan.md   # this file
  alphareader/            # ui/ is deleted at the end of Phase 3
    core/                 # stays the detection source of truth
  fixtures/
    logic_golden.json     # contract for the readout/work TS ports (done)
  scripts/
    parity/               # desktop-vs-Pyodide detection parity (done)
    gen_fixtures.py       # regenerates fixtures/logic_golden.json (done)
    build_core_bundle.py  # packages alphareader/core/ for the browser (Phase 2)
  web/
    src/
      model/              # TS mirrors of the model.py dataclasses + .alpha JSON schema
      logic/              # readout.ts, work.ts (Phase 1); edit.ts (Phase 3)
      storage/            # npy.ts, alpha.ts (zip), db.ts (IndexedDB), repo.ts
      detect/             # worker.ts, client.ts: the Pyodide boundary
      render/             # chart.ts, reconstruction.ts (Canvas 2D)
      ui/                 # routes + components
      theme/              # tokens.css (port of theme.py)
    tests/
```

`alphareader/core/` is shipped to the browser as a **zip fetched at runtime and unpacked
into Pyodide's virtual filesystem**. It's pure Python with nothing to compile, so a wheel
would add packaging work for no benefit. `scripts/build_core_bundle.py` copies `core/`
without `io.py` (which the browser replaces) and puts a content hash in the filename for
cache-busting. `dmc.json` is loaded through `importlib.resources`, so it resolves from
the zip.

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
   out-of-range indices, stale cursors and partial stitches. `edit.py` fixtures aren't
   included yet; add them when Phase 3 starts.

Also landed in this phase:
- **Case-119 fix.** The palette used to silently drop rare colours on sparse charts. It
  now recovers them, and warns when a cell matches no detected colour.
- **One item dropped.** The import-time `__file__` in `io.py` was left alone: it only
  computes a string, and `io.py` never ships to the browser.

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
  `current_run_stitches`). See the `start_direction` rule above.
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

**Chart layout: per-row heights, not one cell size.** The desktop sizes every row with
one number, `cell = max(3, min(avail_w/cols, avail_h/rows))` (`chart_view.py:69`). Two
wanted behaviours break that, and **both must be designed in from the start**. Building
the single-number version first and retrofitting means doing the layout twice.

- **Scroll long charts instead of shrinking them.** Beyond an aspect ratio of roughly
  2:1, size cells to the chart's *shorter* axis and scroll along the longer one. Today a
  40×200 chart (common for blankets and scarves) renders at near-unusable cell sizes.
  **Automatically keeping the current row in view is non-negotiable**, so you never
  lose your place. This matches `plan.md` §6.3, which already asks for the chart to be
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

**Planned, not built yet: pinch-zoom on the Work chart.** The owner wants pinch-to-zoom
(and a matching zoom on desktop) so a small chart can be blown up, or a large one read in
more detail, on a phone. It must work *with* the row and column following, not around it:

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

**Landing screen.** The first screen offers four entry points instead of opening straight
onto the project grid: **Import pattern**, **Design pattern** (start from blank),
**Library** and **Settings**. On the desktop, the Library *is* the landing screen, with
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

**Cancellation.**
- Tag each request with an increasing id, and discard responses that arrive out of date.
- Send the first change immediately. While a request is in flight, fold any further
  changes into a single pending request. A 40-tick slider drag then produces 2–3
  resamples, and the preview still moves on the first tick. This beats a plain trailing
  debounce.
- Keep showing the last good preview, and dim it after ~200 ms. Never blank the pane.

**Pillow isn't needed in the browser.** `core/` only uses Pillow in `io.py`, which isn't
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

## Stack

- React, Vite and TypeScript.
- `fflate` for zip files and `idb` for IndexedDB.
- Canvas 2D for all chart rendering.
- Vitest and Playwright for tests.
- Hosted on Cloudflare Pages.

React is justified by how much state the UI holds (four stages, tool state, undo, live
preview). Canvas 2D is enough, and WebGL isn't needed: drawing every cell is already fast
at these chart sizes once the result is cached and copied rather than redrawn per frame.

Pyodide threading needs the `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` headers. Nothing requires threading today.
Cloudflare Pages can set the headers through `_headers` if that changes.

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

1. **iOS Safari deletes IndexedDB data for sites that aren't installed, after ~7 days
   without a visit.** That directly undermines "local-only, no accounts" for exactly the
   user who picks a project up every other weekend. It needs a product answer, not just
   code:
   - Call `navigator.storage.persist()`. Safari grants it far more readily to sites added
     to the Home Screen.
   - Prompt the user to "Add to Home Screen".
   - Make Export Backup prominent.
   - Nag when a project with real progress has never been exported.

   Check the actual behaviour early.
2. **Detection speed and memory on phones.** WASM runs detection ~2× slower than native
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
