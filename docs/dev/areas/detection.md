# Detection

Finding the grid, the cells and the colours in a chart image: the Python pipeline in
[`alphareader/core/detect/`](../../../alphareader/core/detect/), run in the browser by
Pyodide through [`alphareader/core/bridge.py`](../../../alphareader/core/bridge.py) and the
worker in [`web/src/detect/`](../../../web/src/detect/). Parity with the desktop is checked
by [`scripts/parity/`](../../../scripts/parity/README.md).

## What the test suite guarantees

Moved from the old README. The harness (`alphareader/tests/`) renders charts from known
grids and checks recovery, exercising the traps from [`spec.md`](../spec.md) §11: edge
numbering, watermarks, coloured margins, white-on-white, solid-black rows, non-integer
downscale and JPEG re-encode.

- **Never a silently wrong pattern** (§13.8): any result that is materially wrong carries
  a warning, so the import screen surfaces it. This is asserted absolutely.
- Detection **refuses** rather than guesses on low-resolution or rotated input, with a
  named reason.
- On a deliberately adversarial randomized corpus: ~87% exact cell-by-cell recovery, ~95%
  either exact or fixable in one gesture at the confirmation step (off-by-one dimension /
  over-segmented palette). The remaining warned failures are pitch-halving on aggressive
  downscale — see the note in `test_detect.py`.

## After the port

Newest last, as they were built.

- <a id="fixed-delta-e"></a>**No colour setting** (`alphareader/core/detect/palette.py`, `DEFAULT_DELTA_E`): the
  "Colour detail" slider is gone, and similar colours are merged at a fixed ΔE 15
  instead of the old default of 6. A colour is a yarn to buy, and the slider meant
  nothing to the people it was for. Measured on `test_images/`: at 6, a noisy JPEG splits
  its outlines into phantom in-between shades (lisa.jpg 38 colours for 9 real ones,
  bunny.jpg 6 for 3); the clean charts give the same palette anywhere from ΔE 4 to 15;
  the closest real pair seen is about 18 apart (face.jpg's white and pale pink), and at
  20 it merges. At 15, lisa.jpg keeps one phantom (a dark brown next to its charcoal
  outline, ~17 apart); deleting it in Design gives its cells the nearest colour. The web never sends a ΔE,
  so the constant is the one place it is set; the desktop's slider starts there too.
  `test_palette.py` pins it on four real charts.
- <a id="colour-names"></a>**Everyday colour names** (`core/detect/names.py`, ported as `importer/names.ts`):
  detection used to name colours after the nearest of 119 DMC flosses, a table with
  almost no saturated blues or purples and one made-up entry ("820b Dark Blue"), so most
  vivid blues, violets and purples came out "Dark Blue". Colours now take one of 22
  everyday names (blue, turquoise, burgundy…) from the nearest anchor in the xkcd colour
  survey's averages (CC0; provenance `web/src/importer/README.md`), by CIEDE2000, and
  shades sharing a name are told apart within the palette: one blue is "Blue", two are
  "Dark blue" and "Light blue" (rules in `names.py`). Names are chosen for the palette
  as a whole: a strong border colour leaves a name three or more share for its second
  name, so a reported chart's blue-violet (#5539d3, the survey's "blurple") is
  "Bright purple" beside three blues, and its dusty purple "Muted purple". Two of one
  name that differ mostly in hue lean either way ("Bluish purple", "Pinkish purple").
  No two names in a palette are the same. The DMC code is still stored in `dmc`. The import screen names the colours left
  again after a removal, so one blue left alone is "Blue". The yarn libraries moved
  behind "Advanced: match to yarn", off by default (`settings.colourLibrary` is null);
  the disclosure starts open when a library is already chosen. Checked against the
  owner's 23 saved projects by eye, and `fixtures/colour_names.json` proves the port.

## During the port

What each phase of the port built here, newest first. The plan each phase followed is in
[`history/web-port.md`](../history/web-port.md).

### Hardening before hosting (after Phase 2, one PR)

- <a id="detection-memory"></a>**Detection memory.** Complete linkage (`_nd.py`) fills one n×n float64 matrix in bands
  of 64 rows, in place and bit-identical, instead of an (n, n, 3) broadcast and copies.
  garment.png at 4000 px saved as a JPEG and shrunk to 4 MP (n = 6,254 colours): the
  clustering peaked at 2,190 MB, now 332 MB (tracemalloc).
- <a id="out-of-memory"></a>**Running out of memory** ends on a friendly screen: `bridge.py` answers MemoryError as
  `OUT_OF_MEMORY`; the worker marks Pyodide's fatal errors (a nearly full heap can trap
  as "memory access out of bounds") and always answers; the client terminates the worker
  on either, which gives the memory back; the import screen offers Crop, which starts
  over in a fresh worker. `e2e/corrections.spec.ts` fills the worker's memory with a
  test hook and lets the real detection run out.

### Phase 2, part 1

- <a id="browser-detection"></a>**Part 1: detection in the browser.**
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
  - Large images are shrunk by a whole-number factor before detection ([Risk 2](../history/web-port.md#risk-2)); the
    saved source stays full size. (Part 2 changed the rule.)
  - Parity through the UI: `dachshund.png` saves exactly the desktop's cells. All five
    test JPEGs currently match exactly too (reported, not enforced).

### Phase 0

- **`scripts/parity/`** — proves `core/detect` gives byte-identical results under Pyodide
  and desktop CPython. 89/89 charts identical, even though the desktop runs numpy 2.5.1
  and Pyodide numpy 2.4.6.
- **`core/detect/_nd.py`** — NumPy replacements for SciPy. SciPy is no longer imported by
  the app, and the download needed to import a chart fell from ~22.7 MB to ~8.9 MB.
