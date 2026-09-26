/**
 * How much yarn of each colour a pattern needs: an estimate, for buying.
 *
 *   length = stitches × yarn per stitch × (1 + margin)
 *   balls  = ⌈length ÷ ball length⌉, per colour (each colour is bought on its own)
 *
 * Stitches are the palette's counts, which edit.ts's recount keeps: one stitch per cell,
 * with skip cells (SKIP_INDEX) and indices past the palette counting towards no colour.
 * Not counted: yarn carried inside the stitches in tapestry crochet, ends woven in, a
 * foundation chain, a border. The margin is there for those and for tension.
 *
 * Everything is kept in metric; `units` only changes what is shown.
 */
import type { PaletteEntry } from '../model/types.ts'
import type { Units } from '../settings/store.ts'

export const CM_PER_INCH = 2.54
export const METRES_PER_YARD = 0.9144

export interface UsageInputs {
  /** Yarn one stitch uses, in centimetres. */
  readonly yarnPerStitchCm: number
  /** One ball's length in metres; null when unknown, and then no balls are counted. */
  readonly ballMetres: number | null
  /** Extra on top, in percent (10 → ×1.1). */
  readonly marginPercent: number
}

export interface ColourUsage {
  /** The palette index. */
  readonly index: number
  readonly entry: PaletteEntry
  readonly stitches: number
  readonly metres: number
  /** Whole balls to buy, or null when the ball length is unknown. */
  readonly balls: number | null
}

export interface Usage {
  readonly colours: readonly ColourUsage[]
  readonly stitches: number
  readonly metres: number
  readonly balls: number | null
}

/**
 * Whole balls for `metres`. The tiny allowance keeps floating-point noise from buying a
 * ball too many: 3 balls' worth computed as 3.0000000000000004 is still 3.
 */
export function ballsFor(metres: number, ballMetres: number): number {
  return metres <= 0 ? 0 : Math.ceil(metres / ballMetres - 1e-9)
}

export function yarnUsage(palette: readonly PaletteEntry[], inputs: UsageInputs): Usage {
  const factor = (inputs.yarnPerStitchCm / 100) * (1 + inputs.marginPercent / 100)
  const colours = palette.map((entry, index): ColourUsage => {
    const stitches = Math.max(0, entry.count)
    const metres = stitches * factor
    return { index, entry, stitches, metres, balls: inputs.ballMetres ? ballsFor(metres, inputs.ballMetres) : null }
  })
  return {
    colours,
    stitches: colours.reduce((n, c) => n + c.stitches, 0),
    metres: colours.reduce((n, c) => n + c.metres, 0),
    balls: inputs.ballMetres ? colours.reduce((n, c) => n + c.balls!, 0) : null,
  }
}

/** A length of yarn to buy, rounded up to a whole metre or yard: "12 m", "14 yd". */
export function formatLength(metres: number, units: Units): string {
  const n = units === 'metric' ? metres : metres / METRES_PER_YARD
  return `${Math.max(0, Math.ceil(n - 1e-9)).toLocaleString('en-GB')} ${units === 'metric' ? 'm' : 'yd'}`
}

// The inputs, shown and typed in the chosen units and stored in metric.

/** Yarn per stitch in cm or inches. */
export const perStitchIn = (cm: number, units: Units) => (units === 'metric' ? cm : cm / CM_PER_INCH)
export const perStitchFrom = (v: number, units: Units) => (units === 'metric' ? v : v * CM_PER_INCH)
/** A ball's length in metres or yards. */
export const ballIn = (m: number, units: Units) => (units === 'metric' ? m : m / METRES_PER_YARD)
export const ballFrom = (v: number, units: Units) => (units === 'metric' ? v : v * METRES_PER_YARD)

/** A number for an input field: at most `places` decimals, no trailing zeros. */
export const fieldValue = (n: number, places: number) => String(Number(n.toFixed(places)))

export interface UsageTextOptions {
  readonly patternName: string
  readonly inputs: UsageInputs
  readonly units: Units
  /** Where the ball length came from, e.g. "Stylecraft Special DK, 295 m per 100 g". */
  readonly ballNote: string | null
  /** The matched shade for each palette index, e.g. "Stylecraft Special DK 1001 White". */
  readonly shades?: readonly (string | null)[]
}

/** The estimate as plain text, for "Export yarn list". */
export function usageText(usage: Usage, o: UsageTextOptions): string {
  const perStitch = `${fieldValue(perStitchIn(o.inputs.yarnPerStitchCm, o.units), 2)} ${o.units === 'metric' ? 'cm' : 'in'}`
  const ball =
    o.inputs.ballMetres === null
      ? 'unknown, so no balls are counted'
      : `${formatLength(o.inputs.ballMetres, o.units)}${o.ballNote ? ` (${o.ballNote})` : ''}`
  const lines = [
    `${o.patternName}: yarn estimate`,
    '',
    `Yarn per stitch: ${perStitch}. Ball: ${ball}. Extra: ${fieldValue(o.inputs.marginPercent, 1)}%.`,
    'An estimate: one stitch per cell; yarn carried inside the stitches (tapestry crochet),',
    'ends, a foundation chain and borders are not counted. Lengths and balls are rounded up.',
    '',
  ]
  for (const c of usage.colours) {
    const shade = o.shades?.[c.index]
    const balls = c.balls === null ? '' : `, ${c.balls} ${c.balls === 1 ? 'ball' : 'balls'}`
    lines.push(
      `${c.entry.name || 'Unnamed'} (${c.entry.hex})${shade ? `, nearest ${shade}` : ''}: ` +
        `${c.stitches} ${c.stitches === 1 ? 'stitch' : 'stitches'}, ${formatLength(c.metres, o.units)}${balls}`,
    )
  }
  const total = usage.balls === null ? '' : `, ${usage.balls} ${usage.balls === 1 ? 'ball' : 'balls'}`
  lines.push('', `Total: ${usage.stitches} stitches, ${formatLength(usage.metres, o.units)}${total}`)
  return lines.join('\n') + '\n'
}
