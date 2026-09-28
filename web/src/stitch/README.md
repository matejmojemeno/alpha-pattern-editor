# Stitches for "Visualize"

What `catalogue.ts` states as fact, where it comes from, and what is drawn rather than
measured. Retrieved 2026-09-28.

## Proportions (the data)

A stitch's proportion is its height over its width. A gauge of S stitches and R rows over
the same length gives S / R. Where there are several gauges, the median is used.

| Stitch | Gauge (stitches × rows over 4 in) | Height ÷ width | Source |
|---|---|---|---|
| Single crochet | 12 × 15 | 0.80 | Red Heart Super Saver ball band, 5.5 mm (I-9) hook, as quoted by Herrschners: <https://herrschners.com/red-heart-super-saver-yarn/> |
| Half double crochet | 9 swatches, one yarn and hook: 14×9, 13×10, 12×10, 15×10, 14×10, 14×10, 13×11, 13×10, 13×10 | 1.30 (median) | Sincerely Pam, "Gauge Swatches: A Comparison" (Red Heart Soft, I hook): <https://www.sincerelypam.com/gauge-swatches-a-comparison/> |
| Double crochet | 12 × 6.5; 15 × 7.5; 8 × 4 | 2.00 (median of 1.85, 2.0, 2.0) | Lion Brand patterns, all worsted: Circular Motion Sweater <https://www.lionbrand.com/products/crochet-pattern-circular-motion-sweater-2>, Spring Fling Shorts <https://www.lionbrand.com/products/spring-fling-shorts-crochet>, Tea Wrap <https://www.lionbrand.com/products/crochet-pattern-tea-wrap-1> |
| Waistcoat stitch | 14 × 17.25 | 0.81 | Darn Good Yarn, waistcoat stitch tutorial (medium yarn, 5 mm hook): <https://www.darngoodyarn.com/blogs/stitch-learning-center/crochet-waistcoat-stitch> |
| C2C tile | 10 × 10 tiles = 7.75 × 7.75 in | 1.00 | Pixel Crochet, C2C gauge swatch (worsted, 5 mm hook): <https://pixelcrochet.com/crochet-a-c2c-gauge-swatch-and-calculate-finished-dimensions/> |
| Single crochet, back or front loop only | none found | 0.80 (single crochet's) | No measured figure was found. Interweave's tapestry article is said to note that back loop only works up a little taller, but its page refused to load, so it isn't relied on. |

A second single crochet figure agrees: Craftematics' example swatch, 15 sts = 4 in and
14 rows = 3 in, is 15 ÷ 18.67 = 0.80 (<https://www.craftematics.com/post/gauge>).
Not used: a treble crochet gauge (15 × 10) seen only in a search summary, which would make
treble shorter for its width than double; treble is left out until a trustworthy figure is
found.

These are typical figures from one yarn each. Everyone's tension differs (the nine hdc
swatches above range from 1.18 to 1.56), so the dialog offers the swatch entered in
"Yarn & size" instead.

## How the stitches behave (the rules the renderer follows)

- **Turned rows:** worked flat and turned at each end, every other row is worked from the
  wrong side, so the right side shows those stitches' backs. With the right side always
  facing (in rounds, or cutting the yarn at each row end), every stitch shows its front.
- **Back and front loop only:** working one loop leaves the other lying across the fabric
  as a ridge. "The front loops left unworked leave a horizontal rib on the surface" and
  it "emphasizes the traditional Nordic patterning" (Interweave, "What is Back Loop Only
  Crochet?", <https://www.interweave.com/article/crochet/what-is-back-loop-only-crochet/>,
  as quoted in search results). The ridge is the stitch below's loop, so it is in the
  row below's colour. In turned rows the ridges fall on alternate rows (ribbing).
- **Waistcoat stitch:** worked into the middle of the stitch below. In rounds it "appears
  very similar to knitted fabric"; worked flat it "still has a knit look but more slanted
  instead of lining up directly on top of each other" (Heart Hook Home,
  <https://hearthookhome.com/waistcoat-crochet-stitch/>). The slant's size (0.12 of a
  stitch's width across its height) is drawn, not measured.
- **C2C:** each tile is "3 double crochet stitches, plus their corresponding 3-ch turning
  chain", and each new tile is worked "3 dc into the same ch-3-sp" of a tile in the row
  before (Sarah Maker, <https://sarahmaker.com/c2c-crochet/>). Stitches worked into the
  side of a tile grow at right angles to it, so neighbouring diagonals lie at right angles.
  That's derived from the construction, not checked against a photograph.
- **Carried yarn** (tapestry crochet): lies inside the foot of the stitches worked over it
  and shows through the gaps between tall stitches. Where each colour is carried is the
  Work stage's plan (`logic/carry.ts`), plus the stretches between a colour's runs in a
  row.

## What is drawn, not measured

The look of each stitch in `geometry.ts` (where its legs, wraps and loops lie, and how
thick the yarn is) is drawn from how the stitch is made, and tuned by eye. The renderer
does not model yarn fuzz, blocking, stitch slant in rounds (beyond waistcoat), or the
colour of a stitch bleeding into its neighbour at a colour change.
