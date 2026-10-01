# Work

The Work stage: following a pattern row by row, with progress saved. Code:
[`web/src/ui/work/`](../../../web/src/ui/work/),
[`web/src/ui/screens/Work.tsx`](../../../web/src/ui/screens/Work.tsx),
[`web/src/render/chart.ts`](../../../web/src/render/chart.ts) and
[`web/src/render/layout.ts`](../../../web/src/render/layout.ts), over the logic in
[`web/src/logic/`](../../../web/src/logic/) (`readout.ts`, `work.ts`, `progress.ts`,
`carry.ts`).

## After the port

Newest last, as they were built.

- <a id="carry-hints"></a>**Where to carry yarn** (`web/src/logic/carry.ts`; Work stage, "Show where to carry
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
  stitches it's carried in (rows under 6 px tall get none), or along their foot when
  they're numbered (see [Stitch numbers](#stitch-numbers)), and each chip of the current
  row says "carry Black over the first 2" or "pick up Black, carry over the last 3". Not
  in the Python: the desktop never showed it, and it only reads the pattern. Tested
  against the strands themselves: over 800 random patterns, every strand enters a row
  where it left the one before when rows alternate, carried exactly |q − p|.
  - <a id="counted-carries"></a>**Only carries you count are shown** (`countedCarries`). A carry that
    runs to either end of its row is left off the chart and the chips: carrying on to
    the end of the row, or holding the strand from the start of one, is what a tapestry
    crocheter does anyway, with nothing to count. Shown are those that start or stop
    partway through a row, where you must know after how many stitches to drop a strand
    or where to pick it up. The owner's two-colour cats had a strand along every row
    where a cat met the side of the chart, which hid the few that matter. Everything is
    still carried: the yarn estimate (`carriedStitches`) and Visualize use the whole
    plan.
  - The strands are lines, 2 or 3 px with 1 px edges (`carryThickness`, a tenth of the
    row), not the band of up to 8 px (a third of the row) they began as, which hid the
    stitches it crossed.
- <a id="tall-only-scroll"></a>**Only tall charts scroll** (`render/layout.ts`,
  `shouldScroll`). A chart more than 2:1 taller than wide is sized to its width and
  scrolls down, following the current row, as before. A chart more than 2:1 wider than
  tall used to be sized to its height and scroll across; it now fits like any other
  chart. A row is worked whole, so it should be on screen in one piece, not scrolled
  along stitch by stitch. A wide chart still scrolls across, following your place
  (`followCurrentX`), once its cells reach `MIN_CELL` or when zoomed in. The Python had
  no scroll mode (it always fit), so nothing to keep in step.
- <a id="crafts"></a>**Crafts** (`web/src/craft/crafts.ts`, §15; Work stage, **Options**).
  - **Craft** (tapestry crochet, intarsia crochet, stranded knitting, intarsia knitting,
    alpha friendship bracelet, bead loom) is saved on the pattern as `craft`.
  - Picking one sets the reading order its source gives. Each convention is cited in
    [`craft/README.md`](../../../web/src/craft/README.md).
  - It also sets the unit in the stitch count and the **Record progress** dialog
    ("knots", "beads").
  - **Show where to carry yarn** shows only for tapestry crochet. Other crafts don't carry
    inside stitches, and the app-wide setting is left as it is.
  - **Start from the top row** (`bottom_up`) and **Rows turn** (`alternate_direction`)
    join **Start rows from the right**.
  - Every one of these changes goes through `reorder` (`logic/progress.ts`):
    - Rows marked done stay done, as row ids do.
    - When the row partway through would read differently, the Work stage asks
      (**Start row N again?**) before sending it back to the start of the row.
    - With nothing recorded yet, the place moves to the first row of the new order.
  - Before this, **Start rows from the right** kept the cursor's segment index on a row
    that now read the other way. It then pointed at a different stitch than the maker
    had reached.
  - Not in the Python: `craft` is stored there (`model.py`, `io.py`, sent by
    `bridge.commit`), but nothing reads it.
  - The other crafts considered, and what each would take, are in
    [`crafts.md`](../crafts.md).
- <a id="full-width"></a>**The window's whole width**: the Work screen was capped at 90rem
  (1440 px), so on a wide monitor it sat in the middle with empty margins while Import
  and Design filled the window. Now it has no cap, like them, and the chart can use the
  extra width.

- <a id="stitch-numbers"></a>**Stitch numbers** (`render/chart.ts`, `stitchNumbers`;
  "Number the stitches" in Options and Settings, **on** by default, app-wide in
  `settings.stitchNumbers`). Every stitch on the chart shows its place in its run of one
  colour, counted in the row's working direction (`encodeRow` and `rowDirection`, so it
  agrees with the chips), from 1 at the start of each run. Skipped cells get none.
  - Drawn per frame for the visible cells, under the done wash, in black or white by
    `contrastOn` of the stitch's colour.
  - With carry hints on, a numbered row's strands move from the middle of the stitches,
    where they covered the numbers, to a strip along their foot (`carryStrip`: 2 to 4 px
    per strand), and the numbers are centred above it. They keep the size of a row
    without strands as long as the digits (about ¾ of the font size, `DIGIT_HEIGHT`)
    clear the strip, which they do on a plain 14 px row with one strand. Where they
    can't, the strands stay in the middle and the stitches they cross get no number:
    the strand is the instruction, so it is never the one hidden. An outline round
    the numbers over a middle strand was tried first; it was legible but busy.
  - One font size per row, set by its longest number (so a 10 isn't smaller than the 9
    beside it), at most 16 px; under `NUMBER_MIN_FONT` (8 px) the cell stays plain, so a
    big chart shows numbers only on its taller rows, or once zoomed in.
  - Not in the Python: the desktop never showed it, and it only reads the pattern.

## During the port

What each phase of the port built here, newest first. The plan each phase followed is in
[`history/web-port.md`](../history/web-port.md).

### Phase 3, part 2

- <a id="progress-across-edits"></a>**Progress stays sound** (`logic/progress.ts`, not in the Python). The Work stage
  repairs progress on load: completed ids that name no row are dropped, a missing current
  row moves to the first row not done, a cursor past its row goes back to the row's
  start. The Design stage saves `carryProgress(opened pattern, opened progress, now)`,
  which also puts the cursor back at the start of its row when that row's segments
  changed (columns edited, or its direction flipped because rows were added or removed
  below it); computing from what it opened with is what lets undo bring progress back.
  An edit that would drop rows marked done or the row partway through (delete, trim, a
  border removed) or start progress again (scale) asks first.
- **Pinch-zoom on the Work chart** (see ["Chart layout"](../history/web-port.md#chart-layout)): `computeLayout` takes a
  zoom (1–8×) on the base cell size; two fingers (or Ctrl/⌘ + wheel) zoom about the
  fingers, one finger still scrolls natively, the next progress change follows as ever,
  and the zoom resets when the Work stage opens.

### Hardening before hosting (after Phase 2, one PR)

- **Work chart:** laid out in the scroller's content box, so a classic scrollbar hides
  none of it (`e2e/scrollbar.spec.ts`); and the cells are sized as if the whole band
  around the current row were there, so the chart no longer zooms ~10% as the current
  row reaches the first or last rows.

### Phase 1

- **Work stage** (PR #8), at `#/work/<id>`:
  - `render/layout.ts`: per-row heights, `yOffsets`, and a viewport that keeps the
    current row centred. Charts past 2:1 are sized to their short axis and scroll along
    the long one (later only tall ones: see
    [Only tall charts scroll](#tall-only-scroll)). Row emphasis and focus mode share one
    "rows around the current one" range (`nearRows`, current ± 2).
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

### Phase 0

- **`fixtures/logic_golden.json`** — the golden corpus the TypeScript ports of
  `readout.py` and `work.py` must reproduce. Schema in `fixtures/README.md`.
