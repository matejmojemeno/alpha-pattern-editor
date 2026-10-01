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
  stitches it's carried in (rows under 6 px tall get none), and each chip of the current
  row says "carry Black over the first 2" or "pick up Black, carry over the last 3". Not
  in the Python: the desktop never showed it, and it only reads the pattern. Tested
  against the strands themselves: over 800 random patterns, every strand enters a row
  where it left the one before when rows alternate, carried exactly |q − p|.

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

### Phase 0

- **`fixtures/logic_golden.json`** — the golden corpus the TypeScript ports of
  `readout.py` and `work.py` must reproduce. Schema in `fixtures/README.md`.
