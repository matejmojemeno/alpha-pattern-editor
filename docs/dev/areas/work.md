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
  anyway), and a colour missing from the next row is dropped. When rows don't alternate
  the work is in rounds, the last stitch of a round followed by the first of the next: a
  strand the next round needs behind where it was left is carried on round that join
  (over the rest of the round, then the next round's stitches up to its first, cols − 1 −
  (p − q) in working positions), and one needed right above where it was left waits
  there. That can mean carrying a colour nearly all the time; the owner accepted that
  over cutting and rejoining. (Until this, rounds got no suggestion there at all.) The
  chart draws each strand as a band of its colour through the middle of the stitches
  it's carried in (rows under 6 px tall get none), or along their foot when they're
  numbered (see [Stitch numbers](#stitch-numbers)), and each chip of the current row says
  "carry Black over the first 2" or "pick up Black, carry over the last 3". Not in the
  Python: the desktop never showed it, and it only reads the pattern. Tested against the
  strands themselves: over 800 random patterns, every strand enters a row where it left
  the one before (or, in rounds, leaves at the end of a round and enters at the start of
  the next), carried exactly |q − p| when rows alternate and exactly as far along the
  rounds as needed when they don't.
  - <a id="counted-carries"></a>**A carry to an end of the row is an arrow, not a line**
    (`carryReach`, `drawCarryArrow`). The owner's two-colour cats had a line along every
    row where a cat met the side of the chart, which buried the few that need counting.
    A carry that runs on to the end of its row, or from its start, needs no counting:
    what matters is not dropping the strand. So it's drawn as a one-stitch arrow in its
    colour where it begins (right after the colour's last stitch, or in the row's first
    stitch), pointing the way the row is worked. Its chip note says it once, on the run
    it begins in: "carry Black on to the end of the row" or "carry Black from the start
    of the row" (`carriesByRun`, `carryNote`). A carry that starts and stops partway
    through a row keeps its full line and its count. The yarn estimate and Visualize use
    the whole plan as before. A first version hid these carries altogether; the owner
    asked for them to be marked without the line.
    In rounds the same carries say "round": "carry Black on to the end of the round",
    "carry Black from the start of the round". Every carry round the join is one of these
    two, so rounds are drawn with arrows only.
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
  - The reading order is set under **How you work it** (see
    [Options menu](#options-menu)): **First stitch** (one of four corners, setting
    `bottom_up` and `start_direction` together) and **Rows** (**Back and forth**, or
    `alternate_direction` off: **In the round**, or **All the same way** for a bracelet or
    bead loom, whose `inRounds` is false).
  - Every one of these changes goes through `reorder` (`logic/progress.ts`):
    - Rows marked done stay done, as row ids do.
    - When the row partway through would read differently, the Work stage asks
      (**Start row N again?**) before sending it back to the start of the row.
    - With nothing recorded yet, the place moves to the first row of the new order.
  - Before this, starting rows from the other side kept the cursor's segment index on a row
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
  "Number the stitches" in Options (Chart) and Settings, **on** by default, app-wide in
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
- <a id="options-menu"></a>**The Options menu in three groups** (`ui/work/OptionsMenu.tsx`,
  `ui/chartOptions.ts`). It was one column of nine checkboxes and three buttons, in no
  order. Now:
  - **How you work it** (saved with the pattern): **Craft**; **First stitch**, a 2×2 set
    of radio buttons laid out like the chart's corners (**Top left** … **Bottom right**),
    in place of "Start rows from the right" and "Start from the top row"; and **Rows**,
    **Back and forth** or **In the round** (**All the same way** for a bracelet or bead
    loom), in place of "Work in rounds (every row the same way)". A checkbox for a choice
    with two named sides hides the side that isn't ticked (what does an unticked "Start
    rows from the right" start from?), so these are segmented radio groups that show
    both. One corner sets `bottom_up` and `start_direction` in one `reread`, so it asks
    **Start row N again?** once at most, where two checkboxes could ask twice. Under them,
    `readingOrder` (`ui/work/segments.ts`) says the result in a sentence ("Row 1 is the
    bottom row of the chart, worked right to left; row 2 comes back left to right.").
  - **Chart** (app-wide, switches with a one-line hint, the same list as Settings):
    **Number the stitches**, **Show where to carry yarn** (tapestry crochet only),
    **Enlarge the current row** (was "Taller rows around the current one" here and
    "Emphasise the rows around the current one" in Settings), **Focus mode** (renamed
    "Hide the rest of the chart" for a while; the owner preferred the old name, and the
    hint says what it does). The setting keys are unchanged, so stored preferences carry
    over.
  - **Pattern**: **Rename…**, **Edit in Design** (was "Edit pattern…", which didn't say
    it leaves the Work stage), **Export PNG** (see [Export PNG](#work-png)), **Help**.
    "Export readout" (a .txt of every row) is gone: the owner saw no use for it.
    `exportAllRowsText` stays in `logic/readout.ts`, a port of the Python kept in step by
    the golden fixtures.
  - From 56rem wide the two settings groups sit side by side (the menu is 42rem); on a
    phone it's one column that scrolls inside itself (`max-height: 100dvh − 5rem`).
  - `Craft.sameWay` (a checkbox label) became `Craft.inRounds`.
- <a id="work-png"></a>**Export PNG from Work** (`render/chartPng.ts`, web only). The
  chart drawn by the Work stage's own `drawChart`, on a canvas the size of the whole
  chart, with the stitch numbers and carried strands when they're switched on and the
  axis numbers, but no progress: the layout has no current row and no emphasis
  (`computeLayout` with `current: null`, every row 24 px), `completed` is empty and
  `place` is null, so there is no outline, no done wash and no taller rows, and focus
  mode is ignored. Always the light page colours (`CHART_PNG_COLORS`), so the same
  settings give the same file whatever the theme. 24 px cells fit a two-digit stitch
  number (`numberFont` needs about 11.3 px); a chart whose picture would pass 16 MP
  (Safari's canvas limit) gets smaller cells, down to 8 px (`chartPngCell`). Design's
  Export PNG (`render/png.ts`, the desktop's pixels) is unchanged.
  - Tested in `e2e/work-png.spec.ts`: the PNG is decoded in Chromium and every cell
    checked. With numbers and carrying off, every stitch's inside is its own colour and no
    pixel is the outline's; it's byte-identical after rows are done, with focus mode on and
    in dark mode; numbers mark every stitch, and carrying marks some. Planting a done row in
    the export fails it (7 cells washed).
- <a id="no-high-contrast"></a>**High contrast removed**, app-wide: the setting, the
  `[data-contrast]` tokens and rules, and the canvases' `themeKey`. A stored
  `highContrast` from an earlier version is ignored on load (as any unknown key is) and
  dropped at the next change. The canvases still re-read their colours when the system
  switches between light and dark.
- <a id="segment-flow"></a>**Marking segments done quickly** (`ui/work/Chips.tsx`,
  `ui/work/SegmentDialog.tsx`, `ui/screens/Work.tsx`, `ui/work/ChartView.tsx`; layout
  helpers `placeThrough` and `cellAt` in `render/layout.ts`). The owner's rows had 20 or
  more segments, so the chips ran off the screen and each segment took two taps and a
  scroll.
  - **A tick on every chip.** A chip is now a list item holding two sibling buttons
    inside one outline: the chip, which opens **Record progress** as before, and a round
    tick at its end (`aria-pressed`). A button can't sit inside a button, so the tick is
    beside it, not in it. An empty ring marks that segment done (`markSegmentComplete`,
    so every segment before it too, as the dialog does). A ticked one unticks to the
    start of that segment (`setRunStitches(i, 0)`), so a stray tap is undone with
    another. The "✓" and "·" text marks are gone: the tick says done, and a started
    segment shows "2/5" in muted text.
  - **The dialog leads with Mark segment complete**, the one primary button, with the
    focus (Return presses it, and a phone's keyboard no longer opens with the dialog).
    The stitch count is under an "or" rule, its label on a line of its own so "of N"
    no longer wraps away on a phone; **Save progress** is an ordinary button beside
    **Cancel**.
  - **The chips follow your place.** On every progress change the list scrolls so the
    current segment is at its top, with up to 24 px of the one before it showing; at
    the first segment of a row it goes to the very top. It moves only when the list is
    longer than its space, and glides unless reduced motion is asked for. A scroll by
    hand stays until the next change, like the chart.
  - **A tap on a stitch of the current row** marks it and every stitch before it done
    (`placeThrough`, then `setRunStitches`, which finishes the row on its last stitch).
    The worry was accidental taps, so: only the current row responds, and nothing
    elsewhere on the chart does; only a tap counts (one finger or the main mouse button,
    under 10 px of drift, under 600 ms, no second finger); and a touch that lands while
    the chart is moving, or within 250 ms of it stopping, is taken as stopping a fling
    and ignored. A wrong tap can only move your place along the row you're on, and
    tapping the right stitch puts it back. With a mouse, the pointer is a hand over the
    current row only.
  - Not in the Python: chips.py had one button per chip, its dialog put the count first,
    and the desktop chart took no clicks. The progress operations are the ported ones,
    unchanged.
  - Tested in `e2e/work-chips.spec.ts` on a phone-sized screen: the current chip stays at
    the top of the list as a 12-segment row is ticked through, and the list is back at
    the top for the next row, after finishing it by its last tick and after a scroll by
    hand and **Row complete**. Taps on the chart give exact stitch counts both ways
    along a row; taps on other rows, on the axis, a drag, and a tap right after a scroll
    change nothing. Switching off the list's scrolling, the tap handler, or the
    still-moving check each fails the spec. `placeThrough` is checked as the inverse
    of `placeColumn` over 200 random rows both ways.

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
    keyboard, the reading order (on the pattern), Export PNG, and rename
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
