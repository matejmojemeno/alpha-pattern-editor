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
| **ch 2, dc** (the default): a block is **3 dc**, a space **ch 2, dc** | Stitches n Scraps (above): "An open square is a ch 2 space and a dc… a filled square is just 3 dc stitches." Dummies, [How to Filet Crochet Spaces](https://www.dummies.com/article/home-auto-hobbies/crafts/knitting-crocheting/how-to-filet-crochet-spaces-206607/): chain 2, skip the next 2, double crochet in the next. |
| **ch 1, dc**: a square is 2 stitches, so a block is **2 dc**, a space **ch 1, dc** | Checked on 2026-11-07. Crochet Cabana, [Filet Crochet](https://crochetcabana.blogspot.com/p/filet-crochet.html): "(dc, ch 1, sk 1, dc) which is called a 3-dc mesh"; "Every mesh has 2 posts or dcs for itself and shares one"; for 7 squares, "7 x 2 + tch (3 if solid, 4 if open)". Nicki's Homemade Crafts, [How to Filet Crochet 2 Ways](https://www.nickishomemadecrafts.com/filet-crochet-3dc-vs-4dc/): "the number of chains equals 2 times the number of blocks in a row on the graph", then the turning chain. Its names count the shared stitch, so ch 1 is "3 dc" and ch 2 "4 dc"; the app names a mesh by its space instead. |
| **ch 2, tr**: ch 2, dc with every dc a treble, so a block is **3 tr**, a space **ch 2, tr** | Checked on 2026-11-07. CrochetSpot, [When Your Filet Crochet "Squares" Look "Rectangular"](https://www.crochetspot.com/when-your-filet-crochet-squares-look-rectangular/): a closed space "is made with three double crochets", and to fix rectangles, "Wherever a double crochet is needed, go ahead and do triple crochets." Nicki's Homemade Crafts, [Treble Filet Crochet](https://www.nickishomemadecrafts.com/treble-filet-crochet/): "skip 2 and chain 2, 1 tr stitch in the following chain", on "a chain with a multiple of 3 plus 1 plus 1" (its last 1 is for a row of sc first). Crochet Cabana (above): a block uses "generally double crochet though sometimes triple crochet". |
| A treble is **tr**, in US terms like the app's dc | Craft Yarn Council, [Crochet Abbreviations](https://craftyarncouncil.com/standards/crochet-abbreviations): "tr" is "treble crochet". The list has no "tc". |
| A **turning chain** is **ch 3** for dc and **ch 4** for tr, and counts as the row's first stitch, the one at its edge | Checked on 2026-11-07. Dummies, [How to Crochet a Turning Chain](https://www.dummies.com/article/home-auto-hobbies/crafts/knitting-crocheting/how-to-crochet-a-turning-chain-197695/): "Double crochet (dc): 3", "Triple crochet (tr): 4", and it "almost always counts as the first stitch of the next row, except for the single crochet". CrochetSpot, [Crochet Basics: Understanding Turning Chains](https://crochetspot.com/?p=19939): "double crochet – ch 3", "triple crochet – ch 4". |
| Every row after the first: **Turn and ch 3** (or ch 4), then the squares as the chips say, a first space's ch 2 included | Stitches n Scraps (above): each row begins with "a chainless starting double crochet stitch (csdc), or (ch 3, turn, counts as a dc)", also when "The first square is empty", which is then worked ch 2, skip, dc. Craftsy, [How to Filet Crochet](https://www.craftsy.com/post/how-to-filet-crochet): "If the first grid of a row is filled, the beginning of the row will be a chain 3… If it is empty, the beginning is chain 5" (3, then the space's 2). |
| **Foundation chain** = a square's stitches × squares, + the turning chain, + a space's chains when row 1 starts with a space. The first stitch goes in the chain after the turning chain, or, for a space, after its top and as many chains skipped. | Checked on 2026-11-07, ch 2, dc: Dream a Little Bigger, [How to Filet Crochet](https://www.dreamalittlebigger.com/post/how-to-filet-crochet.html): "(#columns x 3) + 3" for a first block, "(#columns x 3) + 5" for a first space, first dc "in the fourth chain from the hook". Craftsy (above): "add five (three for the edge/first stitch and two for the first space)", "DC in the 8th chain from your hook". CrochetSpot (above) and Dummies (spaces, above) give the same totals in two steps: 3 × squares + 1, then ch 2 (block) or ch 4 (space); 3 × squares + 3, then ch 2 for "the top of the first space", dc "in the eighth chain from your hook". ch 1, dc: Crochet Cabana (above): "7 x 2 + tch (3 if solid, 4 if open) = 17, 18 (go into the 4th chain for a closed block, and 6th chain for an open mesh)". ch 2, tr: the same rule with the treble's ch 4 gives 3 × squares + 4, or + 6 with a first space; no written source found here states those totals; they follow from the rule and the turning chain above. |

Row 1's first square is read from the chart, so the app gives one number, with its parts:
"Chain 66: 3 × 20 for the squares, 4 for the turning chain (it counts as the first tr) and
2 for the first space. Then tr in the 9th chain from the hook." Makers differ in how they
start a row, and the parts are said so they can adjust it:
- **A shorter or taller turning chain.** CrochetSpot (first piece, above) notes some chain 3
  where it chains 2; Crochet Cabana (above): "If you normally work a ch-2 for your turning
  chains in double crochet, you might want to work 6 chains instead of 7." Change the
  turning chain's part by as much.
- **No turning chain**: a chainless starting dc (Stitches n Scraps, above), or a row of
  foundation stitches, which needs no chain at all (Stitches n Scraps used foundation single
  crochet: "you can start with any sort of edge that you like, even just a chain").
- One source (AllFreeCrochet, which refused to be read here; quoted by a search summary)
  adds 5 to 3 × squares + 1 for a first space in dc, one more than every source above.
  It isn't followed.

The maker picks one of the three meshes above (`MESHES`), saved as `Pattern.filet_mesh`.
Sources describe other meshes, such as ch 3, dc with a 4-dc block (CrochetSpot, "Rectangular"
above). Anyone using one of those still has the blocks and spaces right; only the stitch
counts would differ.

## Left out, for now

- Left-handed variants aren't crafts of their own. Every source above mirrors for the
  left hand, and **First stitch** in the other bottom corner (**Bottom left**) does that.
