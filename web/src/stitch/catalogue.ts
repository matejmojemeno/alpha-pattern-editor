/**
 * The stitches "Visualize" can show, and their proportions. Sources and how each figure
 * was worked out: README.md beside this file. Only the proportions are data; the look of
 * each stitch (geometry.ts) is drawn from how it is made, not measured.
 *
 * A stitch's `aspect` is its height over its width. A gauge of S stitches and R rows in
 * the same length gives aspect = S / R: a stitch is length / S wide and length / R tall.
 */

import type { StitchId } from './ids.ts'

export { isStitchId, type StitchId } from './ids.ts'

export interface Gauge {
  readonly stitches: number
  readonly rows: number
  /** Where the gauge was published, and in what yarn and hook. */
  readonly source: string
}

export interface Stitch {
  readonly id: StitchId
  readonly label: string
  /** One line on how it looks, shown under the picker. */
  readonly note: string
  /** Height over width, from `gauges` (the median), or set where no gauge applies. */
  readonly aspect: number
  readonly gauges: readonly Gauge[]
  /** Worked in turned rows, the back of every other row faces the front. C2C is always
   *  turned, so the choice doesn't apply to it. */
  readonly turns: 'choice' | 'always'
}

/** The median of the gauges' height over width. */
export function gaugeAspect(gauges: readonly Gauge[]): number {
  const a = gauges.map((g) => g.stitches / g.rows).sort((x, y) => x - y)
  const mid = a.length >> 1
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2
}

const SC: Gauge[] = [
  { stitches: 12, rows: 15, source: 'Red Heart Super Saver ball band: 12 sc × 15 rows = 4 in, 5.5 mm hook' },
]
const HDC: Gauge[] = [
  // Nine crocheters, one yarn and hook: 14×9, 13×10, 12×10, 15×10, 14×10, 14×10, 13×11, 13×10, 13×10.
  ...[
    [14, 9],
    [13, 10],
    [12, 10],
    [15, 10],
    [14, 10],
    [14, 10],
    [13, 11],
    [13, 10],
    [13, 10],
  ].map(([stitches, rows]) => ({
    stitches: stitches!,
    rows: rows!,
    source: 'Sincerely Pam, “Gauge Swatches: A Comparison”: Red Heart Soft, I hook',
  })),
]
const DC: Gauge[] = [
  { stitches: 12, rows: 6.5, source: 'Lion Brand, Circular Motion Sweater: worsted, 12 sts + 6.5 rows = 4 in in dc' },
  { stitches: 15, rows: 7.5, source: 'Lion Brand, Spring Fling Shorts: worsted, 15 sts and 7.5 rows = 4 in in dc' },
  { stitches: 8, rows: 4, source: 'Lion Brand, Tea Wrap: worsted, 8 sts + 4 rows = 4 in in dc' },
]
const WAISTCOAT: Gauge[] = [
  { stitches: 14, rows: 17.25, source: 'Darn Good Yarn, waistcoat stitch tutorial: medium yarn, 5 mm hook' },
]
const C2C: Gauge[] = [
  // Tiles, not stitches: 10 × 10 tiles measured 7.75 × 7.75 in.
  { stitches: 10, rows: 10, source: 'Pixel Crochet, C2C gauge swatch: worsted, 5 mm hook, 10 × 10 tiles = 7.75 × 7.75 in' },
]

export const STITCHES: readonly Stitch[] = [
  {
    id: 'sc',
    label: 'Single crochet',
    note: 'The usual stitch for alpha charts: small, dense, a little wider than tall.',
    aspect: gaugeAspect(SC),
    gauges: SC,
    turns: 'choice',
  },
  {
    id: 'sc-blo',
    label: 'Single crochet, back loop only',
    note: 'Leaves the front loop of the row below showing as a ridge, in that row’s colour. Proportions as single crochet: no measured figure was found.',
    aspect: gaugeAspect(SC),
    gauges: SC,
    turns: 'choice',
  },
  {
    id: 'sc-flo',
    label: 'Single crochet, front loop only',
    note: 'Leaves the back loop of the row below as a ridge on the side away from you. Proportions as single crochet: no measured figure was found.',
    aspect: gaugeAspect(SC),
    gauges: SC,
    turns: 'choice',
  },
  {
    id: 'hdc',
    label: 'Half double crochet',
    note: 'Taller than wide, with a third loop as a bar across the back.',
    aspect: gaugeAspect(HDC),
    gauges: HDC,
    turns: 'choice',
  },
  {
    id: 'dc',
    label: 'Double crochet',
    note: 'About twice as tall as wide, with gaps between the posts where carried yarn shows.',
    aspect: gaugeAspect(DC),
    gauges: DC,
    turns: 'choice',
  },
  {
    id: 'waistcoat',
    label: 'Waistcoat (knit) stitch',
    note: 'Worked through the middle of the stitch below: dense Vs like knitting, stacked straight up in rounds, slanting in turned rows.',
    aspect: gaugeAspect(WAISTCOAT),
    gauges: WAISTCOAT,
    turns: 'choice',
  },
  {
    id: 'c2c',
    label: 'Corner to corner (C2C)',
    note: 'Each square of the chart is a square tile of three double crochets, worked in diagonal rows.',
    aspect: gaugeAspect(C2C),
    gauges: C2C,
    turns: 'always',
  },
]

export function stitchById(id: StitchId): Stitch {
  return STITCHES.find((s) => s.id === id)!
}

/** A swatch's height over width per stitch, or null while it isn't fully measured. */
export function swatchAspect(s: {
  stitches: number
  rows: number
  widthCm: number | null
  heightCm: number | null
}): number | null {
  if (!s.widthCm || !s.heightCm || s.stitches <= 0 || s.rows <= 0) return null
  return s.heightCm / s.rows / (s.widthCm / s.stitches)
}

/** How the picture's shape changes from the chart's square cells, in words. */
export function shapeText(aspect: number): string {
  const pct = Math.round(Math.abs(1 - aspect) * 100)
  if (pct < 3) return 'Stitches are about square, so the picture keeps the chart’s shape.'
  if (aspect < 1)
    return `Stitches are ${Math.round(aspect * 100)}% as tall as they are wide, so the picture comes out ${pct}% shorter than the chart.`
  const times = aspect.toFixed(aspect >= 1.95 ? 1 : 2).replace(/\.?0+$/, '')
  return `Stitches are ${times} times as tall as they are wide, so the picture comes out ${times} times as tall as the chart shows it.`
}
