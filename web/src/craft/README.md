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
| Tapestry crochet | bottom row first, row 1 right to left, rows turn | Sarah Maker, [Tapestry Crochet for Beginners](https://sarahmaker.com/tapestry-crochet/): "Start the first row at the bottom right corner, and work your way from right to left. Then, move up to the second row, and work your way back from left to right." In rounds, "you will always read the pattern from right to left" (Rows: In the round). |
| Intarsia crochet | as tapestry crochet | Crochetgasm, [How to Read and Work Crochet Graphs](https://crochetgasm.com/how-to-read-and-work-crochet-graphs/): graphs "are read from the bottom up… The first row is read from right to left. The second row is read from left to right." Intarsia "uses separate bobbins for each color… Colors are not carried across the work", so no carry hints. |
| Stranded knitting (Fair Isle) | bottom row first, row 1 right to left, rows turn | Tin Can Knits, [How to Read a Knitting Chart](https://blog.tincanknits.com/2014/06/06/how-to-read-a-knitting-chart/): charts are read from the bottom up, "RS rows from RIGHT to LEFT, and the WS rows from LEFT to RIGHT"; "in the round, then you will read every round from right to left" (Rows: In the round). Floats lie behind the work, so no carry hints. |
| Intarsia knitting | as stranded knitting | The same Tin Can Knits page: it covers every knitting chart, not one technique. No carry hints (a bobbin per area, as for intarsia crochet). |
| Alpha friendship bracelet | top row first, row 1 left to right, rows turn; "knots" | BraceletBook [FAQ](https://www.braceletbook.com/faq/): for patterns whose strings change between top and bottom, "start over at the top". friendship-bracelets.net, [How to… Read Alpha/Letter patterns](https://friendship-bracelets.net/tutorials/2): the first row is "right-knots" from the left, then each row "change[s] direction". |
| Filet crochet | bottom row first, row 1 right to left, rows turn; "squares" | CrochetSpot, [Tips for Your First Filet Crochet Piece](https://www.crochetspot.com/?p=27448): "Filet crochet is worked from a chart, from the bottom row to the top, so your first row is the bottom row", and "odd-numbered rows are crocheted right to left, but even number rows go left to right". The squares, stitches and chain are below. |
| Bead loom | rows don't turn; "beads"; start row and side left as they are | Illinois State Museum, [Bead Weaving on a Loom](https://www.museum.state.il.us/ismdepts/anthro/beads/pdfs/Loombeadinglesson.pdf): pick up "the first row of beads… Follow the color sequence of your pattern… Repeat this sequence for each row", tying on at the side that "depends on whether you are left- or right-handed". Tutorials disagree on the first row (top or bottom), so it isn't set. |

## Filet crochet: blocks, spaces and the chain

[`filet.ts`](filet.ts) says what each square is and the stitches it takes. Checked on
2026-10-19.

| What the app says | Source, and what it says |
|---|---|
| A filled square is a **block**, an empty one a **space**; so the lightest colour is the spaces | CrochetSpot (above) and Dummies, [How to Filet Crochet Blocks](https://www.dummies.com/article/home-auto-hobbies/crafts/knitting-crocheting/how-to-filet-crochet-blocks-206608): filled chart squares are blocks, empty ones spaces. A chart of more colours has no rule; the app reads every colour but the lightest as blocks. |
| A square is 3 stitches, and each row has 1 more at its starting edge | Stitches n Scraps, [Tutorial – Basic Filet Crochet](https://stitchesnscraps.com/tutorial-basic-filet-crochet/): "Each square on the chart represents 3 stitches, with one extra stitch at the starting edge of each row." |
| A block is **3 dc**; a space is **ch 2, dc** | Stitches n Scraps (above): "An open square is a ch 2 space and a dc… a filled square is just 3 dc stitches." Dummies, [How to Filet Crochet Spaces](https://www.dummies.com/article/home-auto-hobbies/crafts/knitting-crocheting/how-to-filet-crochet-spaces-206607/): chain 2, skip the next 2, double crochet in the next. |
| Start the row with **1 dc at the edge** (a turning chain can count as it) | Stitches n Scraps (above): each row begins with "a chainless starting double crochet stitch (csdc), or (ch 3, turn, counts as a dc)". |
| **Foundation chain** = 3 × squares + 1, **plus your turning chain** | CrochetSpot (above): "count the number of squares in the first row (bottom row) and multiply by 3, then add 1"; Dummies (spaces, above): "each row of filet crochet has a multiple of 3 stitches plus 1 double crochet at the end". The turning chain added on top differs: CrochetSpot says ch 2 for a first block and ch 4 for a first space; Dummies adds 3, then works the first space into the eighth chain. So the app gives the 3 × squares + 1 and leaves the turning chain to the pattern. |

Some patterns use other meshes (a 4-dc block, or a 2-stitch square). The app counts the
3-stitch square every source above uses; anyone using another mesh still has the blocks
and spaces right, only the dc counts would differ.

## Left out, for now

- Left-handed variants aren't crafts of their own. Every source above mirrors for the
  left hand, and **First stitch** in the other bottom corner (**Bottom left**) does that.
