# Web port plan: Alpha Pattern Editor → Pyodide web app

This is the implementation plan for turning the PySide6 desktop app into a hosted web app.
The product spec, with the § numbers cited throughout the code, is `plan.md` at the repo
root. This document covers *how* the app moves to the web, not *what* it does.

## Status

| Phase | State |
|---|---|
| 0 — core preparation | **done** |
| 1 — Library + Work + storage | **done** (`newPattern` and its dialog landed with Phase 3, part 1) |
| 2 — Import wizard + Pyodide | **done**: part 1 (the worker boundary and a minimal photo import, end to end) and part 2 (the correction controls, the shrink rule, the watchdog) |
| 3 — Design stage | **done**: part 1 (the editing logic and the Design screen) and part 2 (the structural panel, progress across structural edits, PNG export, the tablet layout and touch, pinch-zoom on the Work chart). The desktop app (`alphareader/ui/`) is still in the repo; retiring it is the owner's call |

### After the port

- **Yarn colour libraries** (`web/src/yarn/`, Tier A, no Pyodide). Alpha crochet is
  worked in acrylic yarn ranges, not DMC floss, so each palette colour can be matched
  to Stylecraft Special DK (125 shades), Paintbox Yarns Simply DK (63) or Scheepjes Colour
  Crafter (90), besides DMC (119, the table detection takes the `dmc` code from). Off by
  default since everyday colour names (below): chosen under "Advanced: match to yarn". Hex values and names come
  from temperature-blanket.com's yarn colorway data (CC BY 4.0, credited in the UI);
  Scheepjes shade numbers from scheepjes.com; three contradictory Scheepjes entries are
  left out. Provenance: `web/src/yarn/data/README.md`. Each table is its own lazily
  loaded chunk (`e2e/bundle.spec.ts`). The nearest shade is the Python's
  (`fixtures/yarn_nearest.json`). Shown in the "Yarn & size" dialog only, in the Design
  stage (since "A focused import screen", below; before, in the import screen's colour
  list): the Design stage's shade chips and "Use shade" went with "Yarn and size"
  (below). The choice is app-wide (the settings store): it describes the crocheter's
  yarn, not the chart, and nothing new goes into `.alpha` files.
- **Yarn estimate:** first a panel in the Design stage (stitches × yarn per stitch ×
  (1 + extra %)); since "Yarn and size" (below), a dialog, on the import screen and now
  in the Design stage's header.
- Tier A: the main entry chunk is 102.9 KB gzipped (Vite's figure); the Design chunk
  16.7 KB (+2.5 KB CSS); the Import chunk 11.7 KB, with the colour name table; each
  library 1.1–2.1 KB, fetched on first use.
- **Rule:** after changing a library or `palette.srgb_to_lab`, run
  `python scripts/gen_yarn_fixture.py`; `test_yarn_fixture.py` fails until you do.
- **Rotate a quarter turn** (`edit.rotate_90(p, clockwise=True)`, `edit.ts` `rotate90`):
  "Rotate ↻ 90°" and "Rotate ↺ 90°" replace "Rotate 180°" in the structural panel, so a
  chart can go from horizontal to vertical; two clicks still make a half turn.
  `rotate_180` stays in `edit.py`/`edit.ts` and the fixtures. Seen with row 0 at the top,
  clockwise takes the top row to the right-hand column (new[i, j] = old[R-1-j, i]),
  anticlockwise to the left-hand one read upwards (new[i, j] = old[j, C-1-i]). The old
  rows no longer exist as rows, so every row gets a fresh id, as with Scale: with rows
  done in Work it asks first ("Rotating gives every row a new place, so your progress in
  the Work stage (N rows done) starts again from the first row. Undo brings it all
  back."), and undo does. Each click is one undo step; the pad-to-size target turns with
  the pattern (undo too), and dragged offsets go back to centred (since "Border & size",
  the four sides turn instead, placement kept). Fixtures: 166 calls.
  Tier A: main chunk 102.6 KB gzipped, Design 16.3 KB (+2.5 KB CSS).
- **Add row and Add column tools** (`editor.ts` `addLine`, `render/design.ts`
  `insertAt`), `Shift+H` and `Shift+V` beside fill row and fill column, in place of the
  structural panel's "Rows and columns" section. Pointing at the chart (a mouse or pen
  needn't press) shows the pattern with the new row or column already in place, in the
  colour being painted with and outlined, where the pointer is: it goes before the row
  (column) under the pointer, so the new one is always under it, and anywhere past the
  last one adds one at the end. A click adds it, one undo step; what was added is then
  highlighted until the pointer moves to another row. On touch, the finger drags it into
  place and it is added on release; a second finger cancels it. The preview doesn't
  change the fit, so the zoom never jumps under the pointer. Deleting stays on the menu
  on the numbers, which the tool's hint says. Inserting never loses progress (row ids).
- **A simpler import screen**: the rows and cols boxes and "Flag unsure cells" are
  gone, and so are the red Xs and the low-confidence warning (`bridge._warnings` no
  longer adds it; the pipeline's copy was already filtered as a sampled warning). A
  wrong size is fixed in Design, with the row and column tools; the shrink notice says
  so. The controls left were Crop, Re-detect and Colour detail (since gone or changed). `set_params` still takes
  rows and cols, and previews still carry `confidence`; the UI just doesn't use them.
- **The grid's outline moves, and Crop is gone** (§7.2's "draggable extent handles …
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
- **No colour setting** (`alphareader/core/detect/palette.py`, `DEFAULT_DELTA_E`): the
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
- **Colours on the import screen** (`ui/import/Palette.tsx`, `importer/removals.ts`):
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
- **Everyday colour names** (`core/detect/names.py`, ported as `importer/names.ts`):
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
- **The import screen, redesigned** (`ui/screens/Import.tsx`, `ui/import.css`):
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
    ΔE 15 note above calls out. `e2e/corrections.spec.ts` checks a merge against the
    desktop removing that colour.
  - Four text styles only, spacing in 8/16/24/32 px. `e2e/corrections.spec.ts` checks
    the stages' sizes and alignment at 1280, 900 and 400 px, and Reset against the
    desktop's crop then Re-detect.
- **Where to carry yarn** (`web/src/logic/carry.ts`; Work stage, "Show where to carry
  yarn" in Options and Settings, off by default, app-wide in `settings.showCarries`).
  For tapestry crochet worked over the strands, with no floats, that keeps each colour
  only until the next row needs it. After a colour's last stitch in a row, it is carried
  on inside the following stitches up to the column where the next row first uses it
  when that lies further along (the next row could not reach the strand in time);
  otherwise the next row passes the dropped strand first, and it's picked up there and
  carried up to its first stitch. Either way |q − p| stitches between consecutive rows,
  never more. Carrying between two runs of one colour in a row isn't shown (it's done
  anyway), a colour missing from the next row is dropped, and when rows don't alternate
  a strand the next row needs behind it gets no suggestion (it can't be reached without a
  float). The chart draws each strand as a band of its colour through the middle of the
  stitches it's carried in (rows under 6 px tall get none), and each chip of the current
  row says "carry Black over the first 2" or "pick up Black, carry over the last 3". Not
  in the Python: the desktop never showed it, and it only reads the pattern. Tested
  against the strands themselves: over 800 random patterns, every strand enters a row
  where it left the one before when rows alternate, carried exactly |q − p|.
- **Yarn and size** (`yarn/usage.ts`, `ui/design/YarnEstimate.tsx`): the Design stage's
  "Advanced: match to yarn", its shade chips, "Use shade" and the yarn estimate panel
  are gone. **"Yarn & size"** opens a dialog: first beside "Save & edit pattern" on the
  import screen, for the pattern as it would be saved; since "A focused import screen"
  (below), in the Design stage's header, for the pattern as it is, with "Advanced: match
  to yarn" and each colour's nearest shade inside it. The method follows how crocheters
  estimate, from one swatch in their own yarn, hook and stitch:
  - **Swatch:** stitches × rows (10 × 10 to start, the swatch Magic Yarn Pixels'
    calculators ask for, <https://magicyarnpixels.com/finished-size-yarn-quantity-calculators/>),
    its width and height, and optionally its weight.
  - **Finished size** = columns × (width ÷ stitches) by rows × (height ÷ rows), before
    any border. No default gauge: the Craft Yarn Council publishes stitch ranges per yarn
    weight (DK 12–17 sc to 4 in, <https://www.craftyarncouncil.com/standards/yarn-weight-system>)
    but nothing for rows, and a range isn't a size.
  - **Yarn by weight** when the swatch is weighed: grams per stitch = swatch grams ÷
    (stitches × rows), the method yardage guides recommend over generic charts
    (<https://www.petalstopicots.com/yardage-calculator/>; weighing a swatch and scaling
    by area, then 10% extra). Otherwise **by length**: yarn per stitch (2.5 cm, the old
    round figure; the dialog says how to measure your own: work 10, unravel, divide).
    Metres and grams convert through the ball (its length and weight, the library's own
    by default); balls are counted by the estimate's own measure, else the other.
  - **Carried yarn** (tapestry crochet, off by default): `carry.carriedStitches` counts,
    per colour, the stitches it is carried inside when worked as the Work stage's carry
    hints say (between its runs in a row, and to or from the next row), with the
    pattern's own row directions (on the import screen, before saving, the ones a new
    pattern gets, `PATTERN_DEFAULTS`). Each takes one stitch's width of
    yarn (a strand runs straight through): geometry, not a published figure, as none was
    found. By weight it needs the ball's grams per metre, and says so when missing.
  - Inputs are app-wide settings (`swatch*`, `ballGrams`, `countCarried` beside the
    old ones). "Export yarn list" is in the dialog, named after the pattern.
  - Tier A: main entry chunk 104.3 KB gzipped (Vite's figure; `bundle.spec.ts` counts
    100.7 KB), Design 14.6 KB (from 16.7), Import 17.1 KB.
- **Home screen** (`ui/screens/Landing.tsx`): "Import pattern" is a large dashed drop
  zone on the left (click it, drop on it or anywhere on the page, or paste), and
  **Library**, **Design pattern**, **Settings** and **Feedback** are stacked beside it;
  one column under 44rem, drop zone first. The zone highlights while a file is dragged
  over the page, and on touch screens (`hover: none` and `pointer: coarse`) says "Tap to
  choose a file" instead of drop or paste. There is no backend, so **Feedback** opens
  the public repo's GitHub "New issue" page in a new tab (needs a GitHub account).
- **A menu for each colour in Design** (`ui/design/ColoursPanel.tsx`,
  `ui/design/ColourPicker.tsx`, `editor.editColour`): the Recolour, Rename and Delete
  buttons and the colour well beside "Add colour" are gone.
  - **Clicking a colour** picks it to paint with and opens its menu under it, as wide as
    the list (above it when there's no room). It covers the panel, never the chart: a
    first version sat beside the panel, over the chart's right edge, and swallowed the
    presses meant for the last columns there. The menu holds its name, and a picker drawn on the page (a saturation–brightness square, a hue
    slider, a hex field) in place of the browser's own, which on Chrome for macOS is a
    separate window that reports only when closed and ignores clicks on the page. Every
    move shows on the chart and in the list at once, as a preview (Design's
    `colourPreview`), not an edit. **Save** (or Enter) keeps it as one undo step, colour
    and name together; **Cancel** or **Escape** drops it.
  - **A press anywhere else keeps the change**, as the platform's popovers do: a kept
    change is one Undo away, a dropped one would be gone. The press still does its job,
    so a press on the chart closes the menu and paints with the colour just made, and a
    press on another colour opens that one's menu. Pressing the open colour again closes
    it. Opened by a press, the focus stays on the colour (tool shortcuts still work, and
    a phone raises no keyboard); opened from the keyboard, it goes to the name field and
    comes back on Save, Cancel or Escape.
  - **Each colour has a ×**, as on the import screen (over the count on hover or focus,
    beside it on touch): Delete as before, its cells taking the nearest remaining colour.
  - **"+ Add colour" opens the same menu** for a new colour, rather than choosing a colour
    first and then pressing Add: one act instead of two, the name is set at the same
    time, and the colour can be judged in the list before it exists. It starts as the
    colour being painted with and is named after what it looks like (`simpleNames`
    against the palette, so a second green is "Light green"), until a name is typed. It
    shows at the end of the list (dashed) while chosen; **Add** keeps it; a press
    elsewhere adds it only if something was changed, so opening and leaving it adds no
    copy of the current colour.
  - Differs from the desktop, which recolours through Qt's colour dialog and renames and
    deletes with buttons; the `.alpha` file is unchanged.
  - Tier A: main entry chunk 104.5 KB gzipped, Design 16.5 KB (+2.6 KB CSS); the colour
    name table is now a 3.3 KB chunk the import screen and Design share, loaded with
    either.
- **Visualize** (`web/src/stitch/`, `ui/design/Visualize.tsx`; Tier A, in the Design
  stage's chunk since "A focused import screen", below, the import screen's before): beside
  "Yarn & size", a dialog showing the pattern as
  crocheted fabric, in single crochet, single crochet back or front loop only, half
  double, double, waistcoat stitch or C2C, with rows turned at each end or the right side
  always facing, and optionally the carried yarn. What is data and what is drawn:
  - **Proportions** are data: each stitch's height over width is the median of published
    gauges (sc 0.80, hdc 1.30, dc 2.00, waistcoat 0.81, C2C tile 1.00; sources and
    arithmetic in `web/src/stitch/README.md`), or the swatch from "Yarn & size" ("My
    swatch"). The caption says what that does to the picture ("comes out 20% shorter than
    the chart"). Back and front loop only use single crochet's: no measured figure was
    found. Treble is left out for want of a trustworthy gauge.
  - **Behaviour** follows how the stitches are made (`faces.ts`): in turned rows every
    other row shows its stitches' backs; back loop only leaves the stitch below's loop as
    a ridge, in that row's colour, on the side the crocheter faced (front loop only, the
    other side), so in turned rows the ridges fall on alternate rows; waistcoat stitches
    stack in rounds and slant alternately in turned rows; C2C tiles of neighbouring
    diagonals lie at right angles (derived from the construction, not a photograph).
    Carried yarn lies in the feet of the stitches, where `carry.ts` carries it and between
    a colour's runs in a row, and shows through the gaps of tall stitches.
  - **The look** is drawn (`geometry.ts`): each stitch is strands of yarn, rasterised
    (`raster.ts`) as lit tubes with ply twist, fuzz and contact shadows into a sprite of
    shade and coverage, tinted per colour in linear light with a gloss term so black yarn
    keeps its shape, and cached; the fabric (`fabric.ts`) is drawn in layers (depth,
    carried strands, stitches in working order, top loops, ridges), only the cells in
    view. Wheel, drag and pinch zoom; −, Fit, +.
  - The choices are app-wide settings (`visualStitch`, `visualRows`, `visualCarried`,
    `visualSwatch`), like the swatch. Not in the Python: the desktop has nothing like it,
    and it only reads the pattern.
  - Tier A: main entry chunk 104.7 KB gzipped (Vite's figure; 104.5 before), Import
    20.3 KB (13.9 before), Design 16.5 KB; nothing else loaded up front.
- **The import screen fits the window** (`ui/import.css`, `ui/screens/Import.tsx`): from
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
- **A focused import screen** (`ui/screens/Import.tsx`, `ui/import/Palette.tsx`): the
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
    it has the saved pattern's own (Rules). Visualize still draws with the defaults.
  - Tier A (Vite's figures, gzipped, measured before and after): main entry chunk
    104.7 KB (unchanged), Import 9.0 KB (from 20.3) + 2.4 KB CSS (from 3.7), Design
    27.4 KB (from 16.5) + 3.5 KB CSS (from 2.6); nothing else loaded up front.
- **Border & size** (`ui/design/StructurePanel.tsx`, `design/structure.ts`,
  `design/structureForm.ts`): the Design stage's "Border" and "Pad to size" sections are
  one. Padding was always a border (`pad_to_size` calls `add_border`), and its Left and
  Top fields, locked at 0 until the size grew, said nothing the four sides don't.
  - **Width and Height** sit above Top/Right/Bottom/Left and are worked out from them.
    Typing a size shares the change between the two opposite sides (half each, the odd
    one right or down), so from no border it centres exactly as `pad_to_size` does, and
    from a placed pattern it keeps the pattern where it was. A size smaller than the
    pattern crops, through the border's "Remove part of the pattern?" question.
  - **Dragging the pattern** on the preview moves it a cell at a time, the size kept:
    what one side gains the other loses. It stops at an edge: where cells are only added
    it never starts removing any, and the other way round. "Centre the pattern" shows
    when it isn't centred.
  - When only cells are added, the preview outlines where the pattern sits (it was the
    whole result, which the preview already is); when cells go, the result, as before.
  - A size past 2000 on a side is refused (the desktop's pad-to-size limit, which the
    web's padding had; the border had none). A quarter turn swaps the sides across, so
    a size set turns with the pattern, as the pad target did.
  - The Python is unchanged: `pad_to_size` stays in `edit.py`/`edit.ts` and the
    fixtures; the panel calls `addBorder`, and a unit test checks every size up to 12 × 11
    gives exactly what `padToSize` gives.
  - Differs from the desktop, which keeps separate Border and Pad to size boxes.
  - Tier A (Vite's figures, gzipped): main entry chunk 104.5 KB, Design 27.1 KB
    (104.7 and 27.4 were recorded for "A focused import screen"; not rebuilt here).
- **Hosting** (`web/wrangler.jsonc`, `web/public/_headers`): Cloudflare Workers static
  assets at the free `*.workers.dev` address, deployed by Cloudflare's Git integration on
  every push to `main` (setup in `web/README.md`, "Deploying"). `/assets/*`, `/pyodide/*`
  and `/py/*` are cached immutably. `e2e/bundle.spec.ts` checks that every file there has
  a versioned name, and that the site stays within the free plan's limits (25 MiB a file,
  20,000 files; today 16 MB in all). Verified with `wrangler dev`: the import, Design and
  persistence e2e specs pass against it, and `.wasm` is served as `application/wasm`.
  **Rule:** a new file under those three folders must carry a version or content hash in
  its name, or returning visitors never see it change.
- **`CLAUDE.md`** (repo root): how this project is developed, for future sessions.

What Phase 3, part 2 delivered:

- **The SKIP_INDEX bug, fixed in `edit.py` first:** deleting or merging a colour shifted
  every index above it, `SKIP_INDEX` included, so skip cells became 65534. Now only
  indices that name a palette entry move; skip cells and any other index past the
  palette keep their value (the decision and why: `fixtures/README.md`, porting notes).
  Fixtures regenerated, `edit.ts` replays them.
- **The structural panel** (`ui/design/StructurePanel.tsx`, geometry in
  `design/structure.ts`), each edit one undo step, the canvas, stats bar and size fields
  updating at once:
  - **Borders:** top/right/bottom/left, linked or not, a palette colour defaulting to
    `major_border_index`, and a live preview on the canvas (added cells in the border
    colour, removed ones hatched in red, the result outlined). Negative values remove
    cells; a removal that cuts into cells that aren't all one colour asks first, and
    one that leaves nothing is refused with the Python's message.
  - **Pad to size:** width and height (at least the current size), the colour, and
    left/top offsets (0..added, centred by default); on the preview the pattern can be
    dragged into place a whole cell at a time, kept in step with the fields. (Now part
    of "Border & size"; see "After the port".)
  - **Scale ×2–×12**, showing the size first and warning above 999 on a side.
  - **Mirror ⇄, Flip ⇅, Rotate 180°, Trim edges** (all four). (Rotate 180° is now two
    quarter-turn buttons; see "After the port".)
  - **Insert and delete rows and columns** from a small menu on the chart's row and
    column numbers. The Design stage has no selection, every tool acts on a press, so a
    menu on the numbers is where the target already is, and it works the same by finger.
    New rows and columns take the colour being painted with. (The panel's "Rows and
    columns" section, by number, is now the Add row and Add column tools; see "After
    the port".)
- **Progress stays sound** (`logic/progress.ts`, not in the Python). The Work stage
  repairs progress on load: completed ids that name no row are dropped, a missing current
  row moves to the first row not done, a cursor past its row goes back to the row's
  start. The Design stage saves `carryProgress(opened pattern, opened progress, now)`,
  which also puts the cursor back at the start of its row when that row's segments
  changed (columns edited, or its direction flipped because rows were added or removed
  below it); computing from what it opened with is what lets undo bring progress back.
  An edit that would drop rows marked done or the row partway through (delete, trim, a
  border removed) or start progress again (scale) asks first.
- **Export PNG** (`render/png.ts`): pixel for pixel `io.export_pattern_png` (16 px
  cells, a 1 px grid in (170,170,170), a (200,200,200) background), encoded in TypeScript,
  saved as "<pattern name>.png". Checked against the desktop's output in
  `fixtures/png/` (`scripts/gen_png_golden.py`). Skip cells come out as empty grey cells;
  the desktop can't export a pattern that has any.
- **Photo import opens the Design stage** after saving (§7.3), "Save & edit pattern".
- **Tablets and touch:** under 1100 px the tools become a toolbar over the chart and the
  colours and the structural panel open as drawers; under 700 px the Design stage says it
  needs a larger screen and offers Start working and the Library. One finger or a pen
  uses the tool; two fingers pan and pinch-zoom about their midpoint and never paint (a
  stroke the first finger started is taken back with no undo step; on touch, fill, pick
  and fill row/column act on release; Add row and Add column follow the finger and add on
  release). `ui/gestures.ts` is shared with the Work chart.
- **Pinch-zoom on the Work chart** (see "Chart layout" below): `computeLayout` takes a
  zoom (1–8×) on the base cell size; two fingers (or Ctrl/⌘ + wheel) zoom about the
  fingers, one finger still scrolls natively, the next progress change follows as ever,
  and the zoom resets when the Work stage opens.
- Tier A (`npm run build`): the main entry chunk is 102.1 KB gzipped (99.1 KB on main
  before this part: progress repair, the gesture module, the Work zoom); the Design chunk
  is 14.1 KB (+2.2 KB CSS), still loaded only by the Design stage. Neither stage makes a
  Pyodide request (`e2e/design.spec.ts`, `e2e/structure.spec.ts`, `e2e/touch.spec.ts`).

What Phase 3, part 1 delivered:

- **`edit.py` in TypeScript** (`web/src/logic/edit.ts`): pure and copy-on-write. Existing
  `row_ids` are kept exactly and new rows get fresh ids, so Work-stage progress survives
  edits; counts are recomputed as `_recount` does. `fixtures/edit_golden.json` records
  every public function in `edit.py` (146 calls over 11 patterns, the `ValueError` paths
  included), with made-up ids recorded as `"new"` and checked fresh and unique.
  `pad_to_size` takes `offset_left`/`offset_top` (Python and TS), defaulting to today's
  centring.
- **Designing from blank:** `newPattern(cols, rows, hex)` and a size-and-colour dialog,
  from the Landing screen's "Design pattern" and the Library.
- **The Design stage** at `#/design/<id>`, loaded lazily, desktop-first:
  - A Canvas 2D chart drawn from an offscreen image of the cells, blitting only what is
    in view, with gridlines and row (working order) and column numbers. Zoom with
    Ctrl/⌘ + wheel about the pointer, `+`/`−` or Fit, shown as px per cell. At 200×200
    every frame stays at 16.7 ms while painting and scrolling, at 4× CPU throttling too.
  - Paint `B`, fill `F`, rectangle `R` (previewed while dragged, Escape drops it),
    eyedropper `I`, fill row `H`, fill column `V`, on pointer events. A fast drag paints a
    joined-up line.
  - Colours with name, hex and count: select, add, recolour, rename, and delete into the
    nearest colour (never the last one).
  - Undo/redo (`Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, `Ctrl+Y`, and buttons). A drag-paint
    stroke is one step, taken the first time a cell changes, and any edit that changes
    nothing records nothing (`design/editor.ts`).
  - **Undo keeps whole-pattern snapshots,** as on the desktop, not diffs. Measured
    (`web/scripts/undo-bench.ts`): a 200×200 snapshot is 78 KB, 50 of them 3.8 MB, and an
    edit's copy ~0.1 ms. The stack stops at 50 steps or 32 MB, which only bites on huge
    patterns (999×999: 1.9 MB each, 16 steps kept).
  - A bottom bar with the size, stitches, colours and strings needed. Saved automatically,
    as a Design-stage project, with progress carried through untouched.
- **Moving between stages (§6.4):** "Start working →" in Design and "Edit pattern…" in the
  Work stage's Options menu each save the new stage, then open it; the stage arriving waits
  for that save (`app/saving.ts`). Design warns "You're N rows into this project…" when
  there is progress. Library cards open Work if there's progress, otherwise the stage the
  project was last in, so desktop files saved in Design with no progress now open there.
- Tier A: the main entry chunk is 95.7 KB gzipped (92.9 KB before); the Design stage is a
  lazy 6.5 KB (+1.2 KB CSS) chunk that the Work stage never loads. Neither stage makes a
  Pyodide request (`e2e/design.spec.ts`).

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

- **In "Border & size" the four sides are the only truth; Width and Height are worked out
  from them.** While a size is being typed, the text is kept with the sides typing began
  from (`structureForm.ts`, `border.size`), and each keystroke sets the sides afresh from
  those. Resizing from the current sides instead makes typing "70" pass through a
  7-wide pattern and leaves the pattern off-centre. Blurring the field, or the pattern
  changing shape, drops the typed text.
- **The import screen's two stages both take the source image's shape** (`--source-ratio`
  on `.confirm`), never the pattern's: that is what makes them the same size and line
  up, whatever a crop or a border does to the pattern's own shape. The pattern is fitted
  inside its stage instead. A stage holding words (`.stage--message`) keeps the size
  from an invisible stand-in, so it grows rather than clips. `e2e/corrections.spec.ts`
  measures both at three widths.
- **On a wide screen the import grid is a size container** (`container-type: size` on
  `.confirm__grid`), and the stage width (`--stage-w`, from `cqw`/`cqh` and the numeric
  `--source-aspect`) is applied to the *columns*, never to the grid's own
  `grid-template-columns`: a container's own properties can't use its container units
  (they resolve against an ancestor, here the window), and the grid then ran off the
  right edge. If the column header or the row under a stage changes height, change
  `--col-chrome` with it, or the stages overflow the window.

- **The import overlay is drawn from the extent, rows and cols** (`outline.gridLines`),
  not from the preview's `rowLines`/`colLines`, so a dragged outline shows its lines
  before the resample answers. That's the same picture only because `confirm.resample`
  divides the extent evenly (`np.linspace`). If resampling ever follows an uneven
  lattice, draw the preview's lines again.

- **"Yarn & size" counts carried yarn with the pattern's own row directions, and
  "Visualize" with `PATTERN_DEFAULTS`'.** How much is carried depends on which way each
  row runs. "Yarn & size" (`ui/design/YarnEstimate.tsx`) is given the saved pattern, so it
  counts as the Work stage's carry hints show. "Visualize" draws the first row worked as
  the bottom one, facing the right side (`stitch/faces.ts`), so it lays its defaults
  (`bottom_up`, `start_direction`) over the pattern's before `carryPlan`, or the carried
  strands would lie where the stitches aren't drawn. To show a pattern worked top down or
  from the left, teach `faces.ts` first, then drop that override.
- **Don't lazily import a chunk from inside a lazily loaded chunk.** Visualize, first
  loaded by `import()` from the (lazy) import screen, made Rollup split whatever it
  shared with the entry chunk (the Work stage's logic, then the shared components) into
  new chunks that `index.html` preloads: the entry chunk measured about 20 KB smaller while the
  page loaded 2 KB more, in two requests. Code only a lazy screen uses belongs in that
  screen's chunk, imported statically. `e2e/bundle.spec.ts` fails if `index.html`
  preloads anything.
- **A colour merged on the import screen is remembered by its hex, never its id.**
  Every resample builds a fresh palette with fresh `uuid4` ids
  (`palette.build_palette`), so each preview is kept as detection answered it and the
  removals are replayed on it in order, each taking the entry nearest its hex within half
  the merge threshold (`importer/removals.ts`). Saving replays them on the committed
  pattern, built from the same cached preview (`bridge.commit`), so what is saved is
  what was shown.
- **The colour-merge threshold is set in one place,** `palette.DEFAULT_DELTA_E`. The web
  sends no ΔE, so the worker must leave `delta_e` out and let the bridge's default apply;
  don't hard-code a number in `worker.ts` again. Before moving it, rerun the real-chart
  test in `test_palette.py`: real colour pairs sit only ~18 apart in CIE76, and phantom
  shades up to ~17.
- **Colour names depend on the whole palette.** "Dark blue" means "the darker of this
  palette's blues", so whenever the set of colours changes before saving (a removal on
  the import screen, here and in `scripts/desktop_import.py`), every colour is named
  again. After saving, names are the user's (Rename), so Design never renames. After
  changing `names.py` or the table, rerun `python scripts/import_colour_names.py` (for
  the table) and `python scripts/gen_names_fixture.py`; `test_names_fixture.py` fails
  until you do.
- **Settings saved before the yarn libraries went off by default still say `"dmc"`.**
  The store writes every field whenever one changes, so an old `"dmc"` can't be told
  from a choice. Such a browser keeps showing DMC shades until "Nothing" is picked.
- **After any change to `alphareader/core/detect`, run `python scripts/parity/check.py`.**
  It must report 89/89 bit-identical. It exits non-zero otherwise. Run `npm install` in
  `scripts/parity/` once first.
- **The Python is the spec for readout, progress and editing.** If `readout.ts`/`work.ts`
  disagree with `fixtures/logic_golden.json`, or `edit.ts` with `fixtures/edit_golden.json`,
  the TypeScript is wrong. If you change `readout.py`, `work.py` or `edit.py`, run
  `python scripts/gen_fixtures.py` and commit the result; `test_golden_fixtures.py` fails
  until you do.
- **Colour library data is sourced, never typed in.** Every table in
  `web/src/yarn/data/` comes from `scripts/import_yarn_libraries.py` and a source named
  in its README, with its licence. After changing one, or `palette.srgb_to_lab`, run
  `python scripts/gen_yarn_fixture.py`.
- **Edits never renumber rows.** `edit.ts` keeps every existing `row_id` exactly and gives
  only new rows fresh ids; progress is a set of row ids, so that is what keeps the Work
  stage's place across a trip to Design.
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
- **The Design stage carries progress from what it opened with.** It saves
  `carryProgress(openedPattern, openedProgress, pattern)`, never progress updated edit by
  edit: that is what lets undo bring back the rows a structural edit dropped. The Work
  stage runs `repairProgress` on load, for files edited anywhere else.
- **The Work and Design stages make zero Pyodide requests.** Keeping Pyodide out of the
  Work stage is what makes the app usable on a phone, and Design has no use for it
  either since `edit.py` moved to TypeScript. Treat any regression here as a bug.
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
  alphareader/            # ui/ (the desktop app) goes when the owner decides
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
   out-of-range indices, stale cursors and partial stitches. Since Phase 3 it also writes
   `fixtures/edit_golden.json` for `edit.py`.

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

**Landing screen.** The first screen offers four entry points instead of opening straight
onto the project grid: **Import pattern**, **Design pattern** (start from blank),
**Library** and **Settings**. (Since reshaped: Import is a large drop zone with the
others, plus Feedback, beside it; see "Home screen" under Status.) On the desktop, the Library *is* the landing screen, with
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
- Hosted on Cloudflare Workers static assets at the free `*.workers.dev` address. This
  replaced Cloudflare Pages, which Cloudflare no longer develops; for static files the two
  are equivalent. Setup and the caching rules are in `web/README.md` ("Deploying").

React is justified by how much state the UI holds (four stages, tool state, undo, live
preview). Canvas 2D is enough, and WebGL isn't needed: drawing every cell is already fast
at these chart sizes once the result is cached and copied rather than redrawn per frame.

Pyodide threading needs the `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` headers. Nothing requires threading today.
`web/public/_headers` can set them if that changes.

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
