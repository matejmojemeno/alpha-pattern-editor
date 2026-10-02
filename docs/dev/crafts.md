# Other colourwork crafts: what fits the Work stage

The Work stage follows a pattern as a sequence of rows. Each row is read in a direction,
as runs of one colour, with your place kept as rows done plus a cursor in the current row
(`logic/readout.ts`, `logic/work.ts`). Many crafts that use pixel-grid ("alpha") charts are
followed in exactly that way. They differ in three things:

- **the reading order:** which row is first, which side row 1 starts from, whether rows turn;
- **the words:** stitches, knots, beads;
- **the helpful hint:** carrying (tapestry crochet), floats (stranded knitting), bobbins (intarsia).

This note sorts the crafts by how much of the Work stage each needs to change. **Level 1
is built** (the Work stage's **Craft** option, §15). The rest is the plan.

## Level 1: the same Work stage, different settings and words (built)

| Craft | What it changes | Status |
|---|---|---|
| Tapestry crochet, flat | nothing: the default | built |
| Tapestry crochet in the round | rows don't turn (**Work in rounds** on); carry hints go round the join | built, as an option on any craft |
| Stranded knitting (Fair Isle), flat | bottom right, rows turn; floats, so no carry hints | built |
| Stranded knitting in the round | every round right to left (**Work in rounds** on) | built |
| Intarsia crochet and intarsia knitting | same readout; no carry hints (a bobbin per area) | built |
| Alpha friendship bracelets | from the top, row 1 left to right, rows turn; "knots" | built |
| Bead loom | rows don't turn; "beads" | built; the first row isn't set, as sources disagree |
| Filet crochet | a two-colour chart of blocks and spaces | left out: only the word would change, and the stitches per square vary |

How it's built:
- The pattern stores `craft` (`Pattern.craft`, in `pattern.json`, left out for tapestry
  crochet).
- `web/src/craft/crafts.ts` gives each craft its reading order, unit and hints.
- Every convention is sourced in [`web/src/craft/README.md`](../../web/src/craft/README.md).
- The Work stage's area note says what the screen does:
  [Crafts](areas/work.md#crafts).

## Level 2: the same Work stage plus a new hint (next)

Both are pure functions over a row, like `logic/carry.ts`, testable the same way (random
patterns, then check the rule holds), and need no Python.

- **Float warnings for stranded knitting:** "catch the float after stitch N" wherever a
  colour goes unused for more than some number of stitches. The limit must be cited; it
  varies by source and gauge, so it may need to be a setting.
- **Bobbin count for intarsia:** how many separate areas of each colour a row crosses, so
  you know how many bobbins to wind, and where a new one joins.

## Level 3: a different order of working (medium to high effort)

- **Corner-to-corner (C2C) crochet.** Probably the most popular pixel-art crochet, and
  Visualize already draws it.
  - Rows are diagonals that grow and then shrink, alternating up and down.
  - The readout and progress would have to follow any line of cells, not just an image
    row.
  - Progress is keyed by stable row ids, and diagonals have none. Structural edits would
    need new rules to keep your place.
  - The chart's outline and done-wash would have to follow diagonals.
  - The best value here, and the largest change to the Work stage.
- **Double knitting:** every cell is a pair of stitches (the front colour, then the
  opposite one behind). A readout transform, mostly for two-colour charts.

## Level 4: doesn't fit the row-by-row model

- **Cross-stitch and needlepoint:** worked by colour and by area, not row by row. They'd
  need progress per cell and symbol charts.
- **Peyote and brick-stitch beading:** offset rows. Detection and the grid model would
  have to change (§14 "Staggered-row charts").
- **Mosaic and overlay crochet:** one colour per row with dropped stitches. An alpha chart
  doesn't map onto them directly.
