# Import

The import screen: a photo or screenshot of a chart becomes a pattern, checked and
corrected before it is saved. Code: [`web/src/importer/`](../../../web/src/importer/),
[`web/src/ui/import/`](../../../web/src/ui/import/) and
[`web/src/ui/screens/Import.tsx`](../../../web/src/ui/screens/Import.tsx). Detection itself
is in [`detection.md`](detection.md).

## After the port

Newest last, as they were built.

- <a id="simpler-import-screen"></a>**A simpler import screen**: the rows and cols boxes and "Flag unsure cells" are
  gone, and so are the red Xs and the low-confidence warning (`bridge._warnings` no
  longer adds it; the pipeline's copy was already filtered as a sampled warning). A
  wrong size is fixed in Design, with the row and column tools; the shrink notice says
  so. The controls left were Crop, Re-detect and Colour detail (since gone or changed). `set_params` still takes
  rows and cols, and previews still carry `confidence`; the UI just doesn't use them.
- <a id="outline"></a>**The grid's outline moves, and Crop is gone** (§7.2's "draggable extent handles …
  snapping to pitch increments"; `web/src/importer/outline.ts`,
  `web/src/ui/import/SourceView.tsx`). The blue outline over the image has a handle on
  each edge and corner. Dragging one moves that side in whole cells at the detected
  pitch, taking in (or leaving out) the rows and columns detection missed there, live
  as the finger moves; a focused edge moves a cell per arrow key. It only resamples:
  `set_params(extent, rows, cols)`, no new detection. From a detection of just the
  middle of a chart, this gives back the whole-image detection cell for cell on cats,
  dachshund and monkeys, and on bug.jpg bar one colour merged differently (2 of 1,815
  cells). The Crop button is gone: a box drawn anywhere else on the image, or straight
  away when there's no grid (a failure, the watchdog, running out of memory), detects
  again inside it. On a phone the failure screens offer "Draw a box", which shows the
  image tab. `scripts/desktop_import.py` takes `extent=x0,y0,x1,y1` for the e2e check.
- <a id="import-colours"></a>**Colours on the import screen** (`ui/import/Palette.tsx`, `importer/removals.ts`):
  the list sits on the page (a swatch, the name, the count, the nearest shade, wrapping
  rather than scrolling sideways; the desktop painted each row in its colour), and the
  colour count moved from the size summary to the list's heading and tab. Pointing at
  or focusing a colour fades every other one in the pattern 80% towards a neutral that
  contrasts with it (dark grey behind a light colour, light grey behind a dark one, so
  white and black both stand out; `chart.spotlightPixels`); a click or tap keeps it
  showing, which is how a phone sees it on the Pattern tab ("Show all colours" ends it).
  Its × removed it as Design's Delete does (`edit.deletePaletteEntryNearest`), with
  Restore, until "A focused import screen" (below) took the × and the nearest shade away:
  removing a colour is Design's Delete now, and the import screen's only colour
  correction is the count's merge. Removals (merges now) survive moving the outline and
  detecting again, and are applied to the committed pattern on saving.
  `scripts/desktop_import.py` takes `remove=#rrggbb`, and `e2e/corrections.spec.ts`
  checks a merge's saved pattern cell for cell against the Python's
  `delete_palette_entry_nearest`.
- <a id="import-redesign"></a>**The import screen, redesigned** (`ui/screens/Import.tsx`, `ui/import.css`):
  - **Top bar:** "Pattern name" (a caption-sized label over an empty field, placeholder
    "Untitled pattern") and "Save & edit pattern" at the right; it stays at the top as
    the page scrolls, so Save is always in reach. Saved empty, a pattern is named when
    it's saved, `YYYY-MM-DD-HHMMSS` in local time (`timestampName`); file names are no
    longer used, and a typed name survives "Replace image" (in the image's header).
  - **Stages:** the image and the pattern each sit on a stage of one size: the column's
    width, the *source image's* shape, at most min(70vh, 720px) tall (on a wide screen,
    fitted to the window instead: "The import screen fits the window" below). The image fills
    its stage; the pattern is fitted into its own, centred, with square whole-pixel
    cells, and the stage's background shows round it. Loading and failure messages sit
    on a stage-sized box that grows rather than clips. The size ("76 columns × 24 rows") is a
    caption under the pattern's stage.
  - **Grid:** image, pattern and a 280 px colour sidebar from 1100 px; the sidebar drops
    below from 700 px; narrower, everything stacks. The phone tabs are gone.
  - **Cropping:** outside the grid's outline is dimmed on the image; the handles already
    moved in whole cells. **Re-detect is "Reset to detected grid"**, under the image,
    enabled once a box has been drawn or the outline moved; it
    detects the whole image again. A box drawn by hand round the whole image is no
    substitute: on cats.png, whose chart runs to the image's edges, one begun a single
    screen pixel in loses the outermost column and row (99 × 44 for 100 × 45), and
    snapping boxes to the edge would fight cropping off edge numbers.
  - **Colours:** counts end at the dividers' right edge (the × sits over the count on
    hover, beside it on touch), a total at the foot, and "Advanced: match to yarn" is a
    body-sized disclosure with a chevron and hover state. **The colour
    count is a stepper:** − merges the two most alike colours (CIELAB ΔE, the measure
    Delete uses) by removing the one used less, so its stitches go to the other
    (`removals.mergeCandidate`); + undoes the last merge. Merges are removals marked
    `merged`, so they survive moving the outline and are saved like any removal, but
    they aren't listed under "Removed": + is their undo. On lisa.jpg the first − merges
    the phantom olive into the charcoal outline (116 stitches into 404), the colour the
    [ΔE 15 note](detection.md#fixed-delta-e) calls out. `e2e/corrections.spec.ts` checks a merge against the
    desktop removing that colour.
  - Four text styles only, spacing in 8/16/24/32 px. `e2e/corrections.spec.ts` checks
    the stages' sizes and alignment at 1280, 900 and 400 px, and Reset against the
    desktop's crop then Re-detect.
- <a id="fits-window"></a>**The import screen fits the window** (`ui/import.css`, `ui/screens/Import.tsx`): from
  1100 px wide and 600 px tall (a laptop, a monitor), the screen is the window's height
  and its full width (the 72rem cap is gone there), and the page doesn't scroll.
  - **The stages are the largest box of the image's shape** that fits both half the
    width left beside the 280 px colour column and the height left under the save bar,
    less a column's header and the row under the stage. The columns take the stages'
    width and the three are centred, so a tall image on a wide monitor sits in the middle
    rather than being letterboxed in a wide stage. No narrower than 16rem: past that (a
    very tall, thin image), the height cap letterboxes it as before.
  - **The colour list scrolls on its own**, under the Colours heading and its count,
    which stay put; the total scrolls with it.
  - Narrower or shorter windows (tablet, phone, a squat browser window) keep the layout
    as it was: the page scrolls and the colours drop below or stack.
  - Before, the screen was at most 72rem (1152 px) wide and each stage at most
    min(70vh, 720px) tall: a tall image scrolled on a laptop, and a monitor left most of
    its area empty. On 1920 × 1000 the stages of a landscape chart went from about
    390 px wide to 770 px.
  - `e2e/corrections.spec.ts` checks the stages keep the image's shape and the page
    doesn't scroll at 1280 × 900 and 1920 × 1000, and, with a made-up 24 × 30 chart of 23
    colours at 1440 × 800, that the page doesn't scroll, "Reset to detected grid" is in
    view, and the list scrolls to its total while its heading stays put. The last test
    fails on the old layout (the page was 1324 px tall in an 800 px window).
- <a id="focused-import"></a>**A focused import screen** (`ui/screens/Import.tsx`, `ui/import/Palette.tsx`): the
  import screen is for getting the grid right, and the Design stage for changing the
  pattern, so nothing on the import screen duplicates Design any more.
  - **Kept:** the image and its outline, "Reset to detected grid", "Replace image", the
    pattern and its size, the warnings, the name and "Save & edit pattern", the colour
    list's spotlight (pointing at a colour shows where it is: checking, not editing), and
    the colour count's − and + (merging colours detection split is correcting detection,
    and it has to survive moving the outline, which Design can't do).
  - **Gone:** each colour's × and the "Removed" list with Restore. It called Design's own
    Delete (`edit.deletePaletteEntryNearest`), so the result is the same one click later,
    in Design, with Design's undo.
  - **Moved to the Design stage's header**, beside Export PNG: **"Yarn & size"** and
    **"Visualize"**. Neither needs the photo, and both now show the pattern as edited.
    "Advanced: match to yarn" and each colour's nearest shade moved into "Yarn & size",
    with buying: they were the only place a yarn range was chosen, and the dialog already
    used it for the ball and the exported list.
  - Before, "Yarn & size" counted carried yarn with a new pattern's directions; in Design
    it has the saved pattern's own ([Rules](../rules.md#carried-yarn-directions)). Visualize still draws with the defaults.
  - Tier A (Vite's figures, gzipped, measured before and after): main entry chunk
    104.7 KB (unchanged), Import 9.0 KB (from 20.3) + 2.4 KB CSS (from 3.7), Design
    27.4 KB (from 16.5) + 3.5 KB CSS (from 2.6); nothing else loaded up front.

## During the port

What each phase of the port built here, newest first. The plan each phase followed is in
[`history/web-port.md`](../history/web-port.md).

### Phase 3, part 2

- **Photo import opens the Design stage** after saving (§7.3), "Save & edit pattern".

### Phase 2, part 2

- <a id="correction-controls"></a>**Part 2: the correction controls** (`web/src/ui/import/`, `web/src/importer/`).
  - The desktop confirm screen: rows and cols (1–999, typed or −/+), the inverted
    "Colour detail" slider (ΔE 2–15), "Flag unsure cells" (a red X below 0.6
    confidence), Crop (a pointer-event rubber band mapped through the letterboxed fit,
    `letterbox.ts`), Re-detect, the gridline and extent overlay, the palette on its own
    colours, and the warnings, recomputed with every preview. (Rows, cols and the
    unsure-cell flag have since been removed; see "After the port".)
  - Only Crop and Re-detect detect again; everything else resamples. Changes made while
    one is in flight are folded into one request, stale answers are dropped, and the
    last preview stays up, dimmed after 200 ms. Saving waits for a change still on its
    way (`DetectSession.idle`).
  - Under 900 px the image, pattern and colours were tabs (since stacked instead) and the save bar stuck to the
    bottom; wider, three panes.
  - **Shrink rule:** the smallest whole factor that brings the image to **4 MP** or
    fewer (`bridge.shrink_factor`), replacing part 1's ceil(long edge / 1600). A quiet
    notice says when a photo was shrunk. Evidence in [Risk 2](../history/web-port.md#risk-2).
  - **Watchdog:** a detection (open or redetect) that runs past 20 s terminates the
    worker; the screen says so and offers Crop (which starts over on just the crop,
    `open_session(crop=)`) or Try again.
  - Parity: `web/e2e/corrections.spec.ts` makes each correction in Chromium with real
    Pyodide and compares the saved pattern cell for cell with the desktop making the
    same corrections (`scripts/desktop_import.py detect IMAGE rows=… cols=… de=… crop=…
    redetect`).
