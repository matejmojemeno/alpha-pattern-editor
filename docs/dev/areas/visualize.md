# Visualize

Visualize: the Design stage's dialog that draws the pattern as crocheted fabric. Code:
[`web/src/stitch/`](../../../web/src/stitch/) (the sources for its figures are in its
[README](../../../web/src/stitch/README.md)) and
[`web/src/ui/design/Visualize.tsx`](../../../web/src/ui/design/Visualize.tsx).

## After the port

Newest last, as they were built.

- <a id="visualize"></a>**Visualize** (`web/src/stitch/`, `ui/design/Visualize.tsx`; Tier A, in the Design
  stage's chunk since ["A focused import screen"](import.md#focused-import), the import screen's before): beside
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
