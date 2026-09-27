/**
 * How much yarn of each colour a pattern needs, and how big it comes out: an estimate,
 * for buying, from one swatch worked in the crocheter's own yarn, hook and stitch.
 *
 * The swatch is how crocheters estimate both (docs/web-port-plan.md, "Yarn and size"):
 *
 *   size    = columns × (swatch width ÷ its stitches), rows × (swatch height ÷ its rows)
 *   weight  = stitches × (swatch grams ÷ (its stitches × its rows)) × (1 + margin)
 *   length  = stitches × yarn per stitch × (1 + margin)      when the swatch isn't weighed
 *   balls   = ⌈amount ÷ ball⌉, per colour (each colour is bought on its own)
 *
 * Weighing is the closer figure: a swatch averages the yarn over many stitches, where
 * unravelling a few measures just those. Either way one cell is one stitch, and the
 * margin is there for ends, a foundation chain, a border and tension.
 *
 * Carried yarn (tapestry crochet) can be counted too: a strand carried inside a stitch
 * runs straight through it, so it takes about one stitch's width of yarn. That is geometry,
 * not a measured figure: `carried` stitches × (swatch width ÷ its stitches), turned into
 * grams by the ball's weight per metre when the estimate is by weight.
 *
 * Everything is kept in metric; `units` only changes what is shown. Grams stay grams.
 */
import type { PaletteEntry } from '../model/types.ts'
import type { Units } from '../settings/store.ts'

export const CM_PER_INCH = 2.54
export const METRES_PER_YARD = 0.9144

/** A swatch of `stitches` × `rows`, as measured and, if it was, weighed. */
export interface Swatch {
  readonly stitches: number
  readonly rows: number
  readonly widthCm: number | null
  readonly heightCm: number | null
  readonly grams: number | null
}

/** One ball as sold; either may be unknown. */
export interface Ball {
  readonly metres: number | null
  readonly grams: number | null
}

export interface UsageInputs {
  readonly swatch: Swatch
  /** Yarn one stitch uses, in centimetres: used when the swatch isn't weighed. */
  readonly yarnPerStitchCm: number
  readonly ball: Ball
  /** Extra on top, in percent (10 → ×1.1). */
  readonly marginPercent: number
  /** Stitches each colour is carried inside, by palette index (logic/carry.ts
   *  `carriedStitches`), or null when carried yarn isn't counted. */
  readonly carried: readonly number[] | null
}

export type Basis = 'weight' | 'length'

export interface ColourUsage {
  /** The palette index. */
  readonly index: number
  readonly entry: PaletteEntry
  readonly stitches: number
  /** Stitches it is carried inside, 0 when carried yarn isn't counted. */
  readonly carried: number
  /** Known for an estimate by length, and by weight when the ball gives both. */
  readonly metres: number | null
  /** Known for an estimate by weight, and by length when the ball gives both. */
  readonly grams: number | null
  /** Whole balls to buy, or null when the ball isn't known in a measure there is. */
  readonly balls: number | null
}

export interface Usage {
  readonly basis: Basis
  readonly colours: readonly ColourUsage[]
  readonly stitches: number
  readonly carried: number
  readonly metres: number | null
  readonly grams: number | null
  readonly balls: number | null
  /**
   * Carried yarn was asked for but isn't in the figures: the swatch's width isn't known
   * ('width'), or, by weight, the ball's weight per metre isn't ('ball').
   */
  readonly carriedMissing: 'width' | 'ball' | null
}

/**
 * Whole balls for `amount`. The tiny allowance keeps floating-point noise from buying a
 * ball too many: 3 balls' worth computed as 3.0000000000000004 is still 3.
 */
export function ballsFor(amount: number, perBall: number): number {
  return amount <= 0 ? 0 : Math.ceil(amount / perBall - 1e-9)
}

const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0

/** One stitch's width and one row's height, in cm, from the swatch; null where unmeasured. */
export function stitchSize(s: Swatch): { widthCm: number | null; heightCm: number | null } {
  return {
    widthCm: positive(s.widthCm) && s.stitches > 0 ? s.widthCm / s.stitches : null,
    heightCm: positive(s.heightCm) && s.rows > 0 ? s.heightCm / s.rows : null,
  }
}

/** The finished piece's width and height in cm, before any border; null where unmeasured. */
export function finishedSize(cols: number, rows: number, s: Swatch): { widthCm: number | null; heightCm: number | null } {
  const one = stitchSize(s)
  return {
    widthCm: one.widthCm === null ? null : cols * one.widthCm,
    heightCm: one.heightCm === null ? null : rows * one.heightCm,
  }
}

export function yarnUsage(palette: readonly PaletteEntry[], inputs: UsageInputs): Usage {
  const { swatch, ball } = inputs
  const k = 1 + inputs.marginPercent / 100
  const basis: Basis = positive(swatch.grams) && swatch.stitches > 0 && swatch.rows > 0 ? 'weight' : 'length'
  const gramsPerMetre = positive(ball.metres) && positive(ball.grams) ? ball.grams / ball.metres : null
  const stitchWidthM = (stitchSize(swatch).widthCm ?? NaN) / 100
  const carriedMissing =
    inputs.carried === null ? null : !(stitchWidthM > 0) ? 'width' : basis === 'weight' && gramsPerMetre === null ? 'ball' : null
  const countCarried = inputs.carried !== null && carriedMissing === null

  const colours = palette.map((entry, index): ColourUsage => {
    const stitches = Math.max(0, entry.count)
    const carried = countCarried ? Math.max(0, inputs.carried![index] ?? 0) : 0
    const carriedM = carried * stitchWidthM || 0
    let metres: number | null
    let grams: number | null
    if (basis === 'weight') {
      grams = (stitches * (swatch.grams! / (swatch.stitches * swatch.rows)) + carriedM * (gramsPerMetre ?? 0)) * k
      metres = gramsPerMetre === null ? null : grams / gramsPerMetre
    } else {
      metres = (stitches * (inputs.yarnPerStitchCm / 100) + carriedM) * k
      grams = gramsPerMetre === null ? null : metres * gramsPerMetre
    }
    return { index, entry, stitches, carried, metres, grams, balls: balls(basis, metres, grams, ball) }
  })
  const sum = (f: (c: ColourUsage) => number | null) =>
    colours.some((c) => f(c) === null) ? null : colours.reduce((n, c) => n + f(c)!, 0)
  return {
    basis,
    colours,
    stitches: sum((c) => c.stitches)!,
    carried: sum((c) => c.carried)!,
    metres: sum((c) => c.metres),
    grams: sum((c) => c.grams),
    balls: sum((c) => c.balls),
    carriedMissing,
  }
}

/** Balls by the estimate's own measure when the ball gives it, else by the other. */
function balls(basis: Basis, metres: number | null, grams: number | null, ball: Ball): number | null {
  const byLength = metres !== null && positive(ball.metres) ? ballsFor(metres, ball.metres) : null
  const byWeight = grams !== null && positive(ball.grams) ? ballsFor(grams, ball.grams) : null
  return basis === 'weight' ? (byWeight ?? byLength) : (byLength ?? byWeight)
}

// --- showing it --------------------------------------------------------------------------

/** A length of yarn to buy, rounded up to a whole metre or yard: "12 m", "14 yd". */
export function formatLength(metres: number, units: Units): string {
  const n = units === 'metric' ? metres : metres / METRES_PER_YARD
  return `${Math.max(0, Math.ceil(n - 1e-9)).toLocaleString('en-GB')} ${units === 'metric' ? 'm' : 'yd'}`
}

/** A weight of yarn to buy, rounded up to a whole gram: "40 g". */
export const formatWeight = (grams: number) => `${Math.max(0, Math.ceil(grams - 1e-9)).toLocaleString('en-GB')} g`

/** A finished size in cm or inches, to a tenth under 100: "64 × 45.5 cm". */
export function formatSize(widthCm: number, heightCm: number, units: Units): string {
  const f = (cm: number) => {
    const n = cmIn(cm, units)
    return Number(n.toFixed(n < 100 ? 1 : 0)).toLocaleString('en-GB')
  }
  return `${f(widthCm)} × ${f(heightCm)} ${units === 'metric' ? 'cm' : 'in'}`
}

// The inputs, shown and typed in the chosen units and stored in metric.

/** A short length (a stitch, a swatch) in cm or inches. */
export const cmIn = (cm: number, units: Units) => (units === 'metric' ? cm : cm / CM_PER_INCH)
export const cmFrom = (v: number, units: Units) => (units === 'metric' ? v : v * CM_PER_INCH)
/** A ball's length in metres or yards. */
export const metresIn = (m: number, units: Units) => (units === 'metric' ? m : m / METRES_PER_YARD)
export const metresFrom = (v: number, units: Units) => (units === 'metric' ? v : v * METRES_PER_YARD)

/** A number for an input field: at most `places` decimals, no trailing zeros. */
export const fieldValue = (n: number, places: number) => String(Number(n.toFixed(places)))

export interface UsageTextOptions {
  readonly patternName: string
  readonly cols: number
  readonly rows: number
  readonly inputs: UsageInputs
  readonly units: Units
  /** Where the ball came from, e.g. "Stylecraft Special DK". */
  readonly ballNote: string | null
  /** The matched shade for each palette index, e.g. "Stylecraft Special DK 1001 White". */
  readonly shades?: readonly (string | null)[]
}

/** The estimate as plain text, for "Export yarn list". */
export function usageText(usage: Usage, o: UsageTextOptions): string {
  const { swatch, ball } = o.inputs
  const cm = o.units === 'metric' ? 'cm' : 'in'
  const measured =
    positive(swatch.widthCm) && positive(swatch.heightCm)
      ? `, ${fieldValue(cmIn(swatch.widthCm, o.units), 2)} × ${fieldValue(cmIn(swatch.heightCm, o.units), 2)} ${cm}`
      : ''
  const weighed = usage.basis === 'weight' ? `, ${fieldValue(swatch.grams!, 1)} g` : ''
  const size = finishedSize(o.cols, o.rows, swatch)
  const ballParts = [
    positive(ball.metres) ? formatLength(ball.metres, o.units) : null,
    positive(ball.grams) ? `${fieldValue(ball.grams, 1)} g` : null,
  ].filter(Boolean)
  const lines = [
    `${o.patternName}: yarn estimate`,
    '',
    `Pattern: ${o.cols} columns × ${o.rows} rows.` +
      (size.widthCm !== null && size.heightCm !== null ? ` Finished size: ${formatSize(size.widthCm, size.heightCm, o.units)}.` : ''),
    `Swatch: ${swatch.stitches} stitches × ${swatch.rows} rows${measured}${weighed}.`,
    (usage.basis === 'weight'
      ? 'By the swatch’s weight.'
      : `Yarn per stitch: ${fieldValue(cmIn(o.inputs.yarnPerStitchCm, o.units), 2)} ${cm}.`) +
      ` Ball: ${ballParts.length ? ballParts.join(', ') + (o.ballNote ? ` (${o.ballNote})` : '') : 'unknown, so no balls are counted'}.` +
      ` Extra: ${fieldValue(o.inputs.marginPercent, 1)}%.`,
    o.inputs.carried === null
      ? 'Yarn carried inside the stitches (tapestry crochet) is not counted.'
      : usage.carriedMissing === null
        ? 'Yarn carried inside the stitches (tapestry crochet) is counted, one stitch’s width per stitch carried.'
        : 'Yarn carried inside the stitches could not be counted: ' +
          (usage.carriedMissing === 'width' ? 'the swatch’s width is needed.' : 'the ball’s length and weight are needed.'),
    'An estimate: one stitch per cell; ends, a foundation chain and borders are not counted. Amounts are rounded up.',
    '',
  ]
  const amounts = (c: { metres: number | null; grams: number | null; balls: number | null }) =>
    [
      c.metres === null ? null : formatLength(c.metres, o.units),
      c.grams === null ? null : formatWeight(c.grams),
      c.balls === null ? null : `${c.balls} ${c.balls === 1 ? 'ball' : 'balls'}`,
    ]
      .filter(Boolean)
      .join(', ')
  for (const c of usage.colours) {
    const shade = o.shades?.[c.index]
    const carried = c.carried > 0 ? ` (and carried inside ${c.carried})` : ''
    lines.push(
      `${c.entry.name || 'Unnamed'} (${c.entry.hex})${shade ? `, nearest ${shade}` : ''}: ` +
        `${c.stitches} ${c.stitches === 1 ? 'stitch' : 'stitches'}${carried}, ${amounts(c)}`,
    )
  }
  lines.push('', `Total: ${usage.stitches} stitches, ${amounts(usage)}`)
  return lines.join('\n') + '\n'
}
