# Crafts: where each reading order comes from

[`crafts.ts`](crafts.ts) lists the crafts the Work stage can follow a pattern in. Picking
one sets the pattern's reading order: which row is first (`bottom_up`), which side row 1
starts from (`start_direction`) and whether rows turn (`alternate_direction`). Each of
those comes from a source below. When the sources don't settle something, the craft leaves
that setting as the pattern has it, and the maker sets it with the Work stage's options.
The words ("stitches", "knots", "beads") are the ones the same sources use.

Checked on 2026-10-01.

| Craft | Reading order set | Source, and what it says |
|---|---|---|
| Tapestry crochet | bottom row first, row 1 right to left, rows turn | Sarah Maker, [Tapestry Crochet for Beginners](https://sarahmaker.com/tapestry-crochet/): "Start the first row at the bottom right corner, and work your way from right to left. Then, move up to the second row, and work your way back from left to right." In rounds, "you will always read the pattern from right to left" (Rows turn off). |
| Intarsia crochet | as tapestry crochet | Crochetgasm, [How to Read and Work Crochet Graphs](https://crochetgasm.com/how-to-read-and-work-crochet-graphs/): graphs "are read from the bottom up… The first row is read from right to left. The second row is read from left to right." Intarsia "uses separate bobbins for each color… Colors are not carried across the work", so no carry hints. |
| Stranded knitting (Fair Isle) | bottom row first, row 1 right to left, rows turn | Tin Can Knits, [How to Read a Knitting Chart](https://blog.tincanknits.com/2014/06/06/how-to-read-a-knitting-chart/): charts are read from the bottom up, "RS rows from RIGHT to LEFT, and the WS rows from LEFT to RIGHT"; "in the round, then you will read every round from right to left" (Rows turn off). Floats lie behind the work, so no carry hints. |
| Intarsia knitting | as stranded knitting | The same Tin Can Knits page: it covers every knitting chart, not one technique. No carry hints (a bobbin per area, as for intarsia crochet). |
| Alpha friendship bracelet | top row first, row 1 left to right, rows turn; "knots" | BraceletBook [FAQ](https://www.braceletbook.com/faq/): for patterns whose strings change between top and bottom, "start over at the top". friendship-bracelets.net, [How to… Read Alpha/Letter patterns](https://friendship-bracelets.net/tutorials/2): the first row is "right-knots" from the left, then each row "change[s] direction". |
| Bead loom | rows don't turn; "beads"; start row and side left as they are | Illinois State Museum, [Bead Weaving on a Loom](https://www.museum.state.il.us/ismdepts/anthro/beads/pdfs/Loombeadinglesson.pdf): pick up "the first row of beads… Follow the color sequence of your pattern… Repeat this sequence for each row", tying on at the side that "depends on whether you are left- or right-handed". Tutorials disagree on the first row (top or bottom), so it isn't set. |

## Left out, for now

- **Filet crochet:** a chart of filled and open squares, read like a crochet graph. The
  readout fits, but how many stitches make a square varies by pattern, and nothing here
  would change but the word. See [`docs/dev/crafts.md`](../../../docs/dev/crafts.md).
- Left-handed variants aren't crafts of their own. Every source above mirrors for the
  left hand, and **Start rows from the right** does that.
