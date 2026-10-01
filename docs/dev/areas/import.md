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
- <a id="picture-import"></a>**Picture import** (`core/kind.py`, `core/convert.py`, the bridge,
  `ui/screens/Import.tsx`, `importer/picture.ts`; spec.md §5a). Any image can be
  imported, from the same drop zone, paste or picker: a chart is read, anything else is
  turned into a pattern, and there is no choice to make up front.
  - **The screen:** one line above the stages says what was read ("Read from the squares
    of your chart." / "This looks like a picture, not a chart, so it was turned into a
    pattern."), in muted text, with a small button to the other reading ("Turn it into a
    pattern instead" / "Read it as a chart instead", the latter only if a grid was
    found). A chart read with doubts (over 15% unsure) says "Not sure this is a chart" in
    the warning colour. A chart detection refuses as too fine or tilted keeps its advice
    and adds "Turn it into a pattern anyway": such an image is never converted unasked.
    For a chart, that one line is all that changes.
  - **A picture's controls:** Width (a slider, stitches across; rows follow; "60 × 45
    stitches, about 38 × 28 cm" once the swatch is measured) and Detail (Smoothest …
    Every stitch) sit above the colour list, so the stages' chrome (`--col-chrome`) is
    unchanged. The colour count's − and + make it again with one colour fewer or more
    (from what's shown, 2–24). The outline and a box drawn on the image crop what's used,
    the width staying; "Reset to detected grid" becomes "Use the whole picture". No
    warnings or shrink notice. The stitch shape is the swatch's (square until measured).
  - Behaviour that differs from the desktop: the desktop imports charts only.
  - **Why not just "detection failed = picture":** of 25 CC0 pictures in
    `test_images/pictures/` (fetched with provenance by `scripts/fetch_test_pictures.py`),
    11 fail as LOW_RESOLUTION, like `garment.png`, a real chart; 12 fit a grid, the dice
    10×4 at 78% unsure. `kind.py` asks whether the grid looks like one: square-ish cells,
    spanning the image, edge strength on the lattice at least twice that between lines
    (every chart 5.8–108, every picture 1.5 or less). All 9 charts and 25 pictures come out
    right; `bunny.jpg` (34% unsure) is a chart with doubts.
  - **Why not the other tools' method:** research (Stitch Fiddle, ArtPatt, Stitchmate and
    others; users' #1 complaint is confetti, lone stitches) and a prototype showed that
    shrinking, reducing colours by area and a majority filter erase eyes and dots with the
    noise. `convert.py` scores each stitch against all the pixels it covers, charges for
    colour changes (twice as much along a row as up a column), and gives a colour to any
    small group far from every colour. Tests: a pupil in a gradient keeps its colour, a
    white half keeps white, a one-stitch line survives, speckle drops by over 3×.
  - Bridge: `open_session(cell_aspect=)`, `set_mode`, picture parameters in `set_params`
    (width, colours, detail, cell_aspect, extent), `mode`/`reading`/`picture` in every
    preview; a chart's refusal carries `reading` so the screen can offer the picture.
  - Speed (desktop, 60 wide): first conversion 0.2–0.6 s, Detail 0.01 s, colours
    0.15–0.6 s, 120 wide 0.3–0.9 s. Pyodide runs detection and conversion about 2.1× slower.
  - e2e (`import.spec.ts`): a generated picture, and the same at 40 wide, 5 colours and
    detail 0.2 set through the controls, save exactly the cells `scripts/desktop_import.py
    picture` makes; so does garment.png turned into a pattern anyway; a chart switched to a
    picture and back saves the desktop's chart.
  - Tier A: the main entry chunk 104.7 KB gzipped (unchanged), Import 10.6 KB (from 9.0)
    + 2.6 KB CSS, Design 27.4 KB (unchanged). `importer/picture.ts` repeats usage.ts's
    four-line stitch size instead of importing it, which split usage.ts into a shared
    4.8 KB chunk.
- <a id="pixel-images"></a>**Pixel images** (`core/pixels.py`, `kind.py`, the bridge's `pixels` mode; spec.md
  §5a). Pixel art without gridlines is read exactly, a stitch per block: "Read pixel by
  pixel: each block of your image is one stitch.", with "Turn it into a pattern instead"
  and back ("Read it pixel by pixel instead"). No outline or box; colours merge as a
  chart's. Before, an 8× sprite came out cropped (60×60 as 51×58), 4× and 1:1 were
  refused, and a real 8× city (137×126) was a "sure chart" spanning 69% of it.
  - Found by testing real CC0 pixel art (`test_images/pixels/`, fetched with provenance by
    `scripts/fetch_test_pictures.py`): images resized by a fraction (32 → 300 px, blocks
    of 9 and 10) are common, and tools round the block edges differently (Pillow rounds a
    half down), so a colour change within a pixel of each ideal edge is accepted and the
    image must then be exactly its blocks. A 1:1 sprite with two equal rows once read as
    63 rows stretched by 64/63, and a crisp chart with 2 px lines as a 1.5× enlargement:
    hence the 2× minimum.
  - All 7 pixel images, 9 charts and 25 pictures are read as what they are; the real city
    and a generated 7× sprite save exactly in the browser (e2e). Parity 122/122.
  - **Why not just "detection failed = picture":** of 25 CC0 pictures in
    `test_images/pictures/` (fetched with provenance by `scripts/fetch_test_pictures.py`),
    11 fail as LOW_RESOLUTION, like `garment.png`, a real chart; 12 fit a grid, the dice
    10×4 at 78% unsure. `kind.py` asks whether the grid looks like one: square-ish cells,
    spanning the image, edge strength on the lattice at least twice that between lines
    (every chart 5.8–108, every picture 1.5 or less). All 9 charts and 25 pictures come out
    right; `bunny.jpg` (34% unsure) is a chart with doubts.
  - **Why not the other tools' method:** research (Stitch Fiddle, ArtPatt, Stitchmate and
    others; users' #1 complaint is confetti, lone stitches) and a prototype showed that
    shrinking, reducing colours by area and a majority filter erase eyes and dots with the
    noise. `convert.py` scores each stitch against all the pixels it covers, charges for
    colour changes (twice as much along a row as up a column), and gives a colour to any
    small group far from every colour. Tests: a pupil in a gradient keeps its colour, a
    white half keeps white, a one-stitch line survives, speckle drops by over 3×.
  - Bridge: `open_session(cell_aspect=)`, `set_mode`, picture parameters in `set_params`
    (width, colours, detail, cell_aspect, extent), `mode`/`reading`/`picture` in every
    preview; a chart's refusal carries `reading` so the screen can offer the picture.
  - Speed (desktop, 60 wide): first conversion 0.2–0.6 s, Detail 0.01 s, colours
    0.15–0.6 s, 120 wide 0.3–0.9 s. Pyodide runs detection and conversion about 2.1× slower.
  - e2e (`import.spec.ts`): a generated picture, and the same at 40 wide, 5 colours and
    detail 0.2 set through the controls, save exactly the cells `scripts/desktop_import.py
    picture` makes; so does garment.png turned into a pattern anyway; a chart switched to a
    picture and back saves the desktop's chart.
  - Tier A: the main entry chunk 104.7 KB gzipped (unchanged), Import 10.6 KB (from 9.0)
    + 2.6 KB CSS, Design 27.4 KB (unchanged). `importer/picture.ts` repeats usage.ts's
    four-line stitch size instead of importing it, which split usage.ts into a shared
    4.8 KB chunk.
- <a id="keep-outlines"></a>**Keep outlines** (`core/outlines.py`, `convert.PictureState.outlines`, a switch under
  Detail; spec.md §5a). Off by default. On the Moon Stick (a user's example, not in the
  repo), 40 wide: the full moon circle appears (off, half the moon is missing: its white
  half is drawn only by a line), the handle is outlined, and the ornament keeps one ring
  with its gold inside; about 0.9 s in Chromium. The coat of arms goes from 6 colours to
  3 with a continuous outline; the smiley (lines ~20 px, already kept) doesn't change.
  - Reached by testing, not guessed: a first version (mark stitches with ink, thin them)
    broke lines into dots; tracing centrelines keeps them whole. A darker ink threshold
    (L* 40) broke the moon's tapered line ends (L* 49); a lighter one traced the edges of
    a red shield and a burgundy mouth, hence a ridge test; a ridge test alone took the
    corners of dark shapes, hence "goes on along itself in the same ink".
  - No automatic "is it a drawing?": a flat-colour score put the arctic fox photo at 1.00
    and the coat of arms at 0.59, and "edges with ink beside them" scored photos 0.87–0.93.
  - Found on the way, in `kind.py`: a drawing of two outlined circles read as a 5 × 3 (and
    an 8 × 8) chart. A chart's gridlines now need an edge along half their length (real
    charts 0.95+, 40 synthetic ones down to 4 × 7 cells 0.76+, the drawing 0.08–0.17);
    every corpus image is read as before.
  - Parity: every image is also converted with outlines on, 122/122 bit-identical.
  - **The whole outline, and no olive** (stacked on Keep outlines). On the Moon Stick at
    some widths the crescent was olive: with 6 colours, yellow and orange shared one and
    it was their mean (122 wide `#d9c37e`; the owner saw `#b5a35a` at 156), and the
    lines' ink, averaged with yellow, white or pink, won colours of its own (a grey at
    60 wide, where yellow had none). Then the ink replaced the colour within ΔE 45 of
    it, at 122 wide the pink handle's, which became the gem's red. Now, for a picture
    that is mostly flat colour (`convert.flat_share` ≥ 0.6), each colour is the shade
    most of its samples have (`_dominant`), edge samples (`edge_blends`) and samples
    within 2 px of the ink don't choose colours, the rescue gives none to a mix of two
    colours, and colours within ΔE 6 merge; the ink never replaces a colour and is one
    of the colours asked for. Every width 20–200 of the Moon Stick is now white,
    mustard, pink, burgundy ink, and orange, cream, dark pink, red or green as room
    allows; the smiley is its 5 colours (its pink tongue had become white, and an olive
    took a sixth). Photos (flat share 0.37 or less) are converted exactly as before with
    outlines off.
  - The outline was broken where the line is thin: a 2 px anti-aliased line drifts a
    pixel within a few pixels, and was looked for exactly in line, in the same ink (a
    third of the Moon Stick's outer circle was missed; a thin synthetic circle was found
    at 68 of 360 angles, now 360). And a line the picture's edge cuts through (the top
    of the circle) had nothing lighter beyond the edge.
  - The gem's green was named "Olive": the green family had no mid green, so `#227e23`
    was nearest olive. "tree green" (`#2a7e19`, from the xkcd survey) is now an anchor.
  - Speed, natively: a drawing's preview 0.7–0.9 s at 122–156 wide (was 0.6–0.7 s);
    photos unchanged.

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
