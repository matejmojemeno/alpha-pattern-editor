# Design

The Design stage: painting, colours, structural edits, undo and PNG export. Code:
[`web/src/design/`](../../../web/src/design/), [`web/src/ui/design/`](../../../web/src/ui/design/),
[`web/src/ui/screens/Design.tsx`](../../../web/src/ui/screens/Design.tsx),
[`web/src/render/design.ts`](../../../web/src/render/design.ts) and
[`web/src/render/png.ts`](../../../web/src/render/png.ts); the edits themselves are
[`web/src/logic/edit.ts`](../../../web/src/logic/edit.ts), the port of `core/edit.py`.

## After the port

Newest last, as they were built.

- <a id="rotate-90"></a>**Rotate a quarter turn** (`edit.rotate_90(p, clockwise=True)`, `edit.ts` `rotate90`):
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
- <a id="add-row-column"></a>**Add row and Add column tools** (`editor.ts` `addLine`, `render/design.ts`
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
- <a id="colour-menu"></a>**A menu for each colour in Design** (`ui/design/ColoursPanel.tsx`,
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
- <a id="border-and-size"></a>**Border & size** (`ui/design/StructurePanel.tsx`, `design/structure.ts`,
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
- <a id="select-tool"></a>**A Select tool** (`S`; `design/editor.ts`, `design/selection.ts`, the one new
  edit `edit.paste_block`): part of the pattern can be copied, cut, pasted, moved and
  turned.
  - **Selecting:** a drag selects the cells between its corners, outlined dark over
    light so it shows on any colour. A click selects one cell; a click outside a
    selection drops it, as Escape does. `Cmd/Ctrl+A` selects everything. The selection
    belongs to the tool: choosing another tool drops it.
  - **Moving:** a drag inside the selection, or the arrow keys, moves its cells, leaving
    the background colour where they were. The background is the colour most of the edge
    is (`major_border_index`, which a border defaults to as well).
  - **Floating:** moving, turning or pasting makes the selection float. The block is kept
    whole, with the pattern under it, and the pattern is always that pattern with the
    block written over it (`paste_block`, clipped to the chart). So a block dragged past
    an edge comes back whole, while what is saved, counted and shown in the colours list
    is always the plain pattern: nothing is lost by leaving mid-move. What still hangs
    over an edge is dropped when the selection is put down (a click outside, Enter,
    another tool, any other edit). See [the rule](../rules.md#floating-selection).
  - **The buttons** (under the tools on a desktop; over the bottom of the chart on a
    tablet, which then scrolls further so no row stays hidden under them): Copy, Cut,
    Paste (`Cmd/Ctrl+C`, `X`, `V`), Delete (the Delete key: empties it to the background;
    a floating block is taken away instead), Mirror, Flip, Rotate clockwise and anticlockwise (a quarter
    turn about its centre; see [the rule](../rules.md#turn-rect) for the odd half cell),
    Remove background (below), Fill with the colour
    painted with, Crop to selection (`add_border` with negative sides, so the rows kept
    keep their ids and their progress; it asks first when rows done in Work go), Select
    all and Deselect.
  - **Undo:** each drag, nudge, turn, paste, cut, delete and fill is one undo step, as a
    stroke is; a drag that never changes a cell records nothing. Undo puts the pattern back
    exactly and drops the selection (history holds patterns, not selections).
  - **The clipboard** is the tab's, not the system's (which can't hold cells and
    colours, and asks permission to be read): it lasts across patterns until the page is
    reloaded. A paste goes where the selection is, or else where it was copied from,
    moved onto the chart; it is chosen as the Select tool, floating, ready to drag. Into
    another pattern, each colour is found by id (with the same hex), then by hex, and any
    it lacks is added under its own name, all in the same undo step. Skip cells stay skip
    cells.
  - <a id="remove-background"></a>**Remove background** (a toggle; the button then reads Put background back):
    the floating block gets a see-through mask (`Floating.clear`), and every write of the
    block (`over` in `editor.ts`) first fills its see-through cells from `under`
    (`seeThrough`), so `paste_block` itself is unchanged. The background is the block's
    own edge majority (not the pattern's), and only the cells of it joined to the edge
    side by side go (`backgroundMask`), so a motif keeps that colour inside it. The mask
    turns with the block and rides the clipboard (`Clip.clear`). One undo step when the
    chart changes; in place it usually doesn't, since the lifted cells are already the
    pattern's background.
  - Web only: the desktop has no selection. The `.alpha` file is unchanged.
  - `paste_block` went into `edit.py` first, with tests and ten golden cases (176 calls
    now); `edit.ts` replays them, and 1,159 random pastes in 300 chains over random
    patterns (blocks over every edge, skip cells, indices past the palette) came out the
    same in both.
  - Tier A (Vite's figures, gzipped): main entry chunk 104.7 KB (104.5 on `main` before),
    Design 30.1 KB (27.1) with 3.6 KB of CSS (3.5).

- <a id="icons"></a>**Icons that say what the tool does** (`ui/design/icons.tsx`, from Lucide): every
  tool was the same 3×3 grid with a different few cells inked (Paint one cell, Fill an
  L, Pick colour a diagonal), so on a tablet, where the toolbar shows icons without
  words, they couldn't be told apart, and Fill row and Add row differed only by a small
  plus. Now: a dashed marquee (Select), a pencil (Paint), a paint bucket (Fill), a
  rectangle, a pipette (Pick colour), the grid with its middle row or column inked in
  the accent colour (Fill row, Fill column: drawn here in Lucide's style, since Lucide
  has the grid but not the inked band), and Lucide's "insert between" for Add row and
  Add column. Mirror, Flip and the two Rotates, in the Structure panel and the
  selection's buttons, show the flip and turn icons instead of ⇄ ⇅ ↻ ↺, whose look
  depended on the font and which a screen reader read out as arrow names; their
  accessible names now say which way ("Rotate 90° clockwise"). Deleting a colour is a
  bin, not ×, which elsewhere means close. Tier A: main chunk 106.8 KB gzipped (+2.1 KB),
  Design 31.8 KB (+1.7 KB).

## During the port

What each phase of the port built here, newest first. The plan each phase followed is in
[`history/web-port.md`](../history/web-port.md).

### Phase 3, part 2

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
    columns" section, by number, is now the Add row and Add column tools, and there is a
    Select tool now; see "After the port".)
- **Export PNG** (`render/png.ts`): pixel for pixel `io.export_pattern_png` (16 px
  cells, a 1 px grid in (170,170,170), a (200,200,200) background), encoded in TypeScript,
  saved as "<pattern name>.png". Checked against the desktop's output in
  `fixtures/png/` (`scripts/gen_png_golden.py`). Skip cells come out as empty grey cells;
  the desktop can't export a pattern that has any.
- **Tablets and touch:** under 1100 px the tools become a toolbar over the chart and the
  colours and the structural panel open as drawers; under 700 px the Design stage says it
  needs a larger screen and offers Start working and the Library. One finger or a pen
  uses the tool; two fingers pan and pinch-zoom about their midpoint and never paint (a
  stroke the first finger started is taken back with no undo step; on touch, fill, pick
  and fill row/column act on release; Add row and Add column follow the finger and add on
  release). `ui/gestures.ts` is shared with the Work chart.
- Tier A (`npm run build`): the main entry chunk is 102.1 KB gzipped (99.1 KB on main
  before this part: progress repair, the gesture module, the Work zoom); the Design chunk
  is 14.1 KB (+2.2 KB CSS), still loaded only by the Design stage. Neither stage makes a
  Pyodide request (`e2e/design.spec.ts`, `e2e/structure.spec.ts`, `e2e/touch.spec.ts`).

### Phase 3, part 1

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
