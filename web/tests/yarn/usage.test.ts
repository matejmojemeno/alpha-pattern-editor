import { describe, expect, it } from 'vitest'

import { countCells } from '../../src/logic/edit.ts'
import { SKIP_INDEX, type PaletteEntry } from '../../src/model/types.ts'
import {
  ballsFor,
  cmFrom,
  cmIn,
  fieldValue,
  finishedSize,
  formatLength,
  formatSize,
  formatWeight,
  metresFrom,
  metresIn,
  usageText,
  yarnUsage,
  type Swatch,
  type UsageInputs,
} from '../../src/yarn/usage.ts'

const entry = (name: string, hex: string, count: number): PaletteEntry => ({ id: name, hex, name, dmc: null, count })

const UNMEASURED: Swatch = { stitches: 10, rows: 10, widthCm: null, heightCm: null, grams: null }
/** 10 × 10 stitches, 10 cm wide (1 cm a stitch), 8 cm tall, 5 g (0.05 g a stitch). */
const SWATCH: Swatch = { stitches: 10, rows: 10, widthCm: 10, heightCm: 8, grams: 5 }
/** Stylecraft Special DK's ball: 295 m in 100 g. */
const BALL = { metres: 295, grams: 100 }

const inputs = (o: Partial<UsageInputs> = {}): UsageInputs => ({
  swatch: UNMEASURED,
  yarnPerStitchCm: 2.5,
  ball: { metres: 295, grams: null },
  marginPercent: 10,
  carried: null,
  ...o,
})

describe('yarnUsage by length (no weighed swatch)', () => {
  const palette = [entry('White', '#ffffff', 1000), entry('Black', '#000000', 1), entry('Unused', '#ff0000', 0)]

  it('is stitches × yarn per stitch × (1 + margin), per colour', () => {
    const u = yarnUsage(palette, inputs())
    expect(u.basis).toBe('length')
    expect(u.colours.map((c) => c.metres)).toEqual([expect.closeTo(27.5, 12), expect.closeTo(0.0275, 12), 0])
    expect(u.colours.map((c) => c.balls)).toEqual([1, 1, 0])
    expect(u.stitches).toBe(1001)
    expect(u.metres).toBeCloseTo(27.5275, 12)
    expect(u.balls).toBe(2) // each colour bought on its own
    expect(u.grams).toBeNull() // the ball's weight isn't known
  })

  it('rounds balls up, and not past an exact multiple', () => {
    expect(ballsFor(295, 295)).toBe(1)
    expect(ballsFor(295.01, 295)).toBe(2)
    expect(ballsFor(0.1 + 0.2, 0.1)).toBe(3) // 3.0000000000000004 balls' worth
    expect(ballsFor(0, 295)).toBe(0)
    // 11,800 stitches × 2.5 cm = 295 m exactly, with no margin: one ball.
    expect(yarnUsage([entry('A', '#000000', 11_800)], inputs({ marginPercent: 0 })).balls).toBe(1)
    expect(yarnUsage([entry('A', '#000000', 11_801)], inputs({ marginPercent: 0 })).balls).toBe(2)
  })

  it('counts the margin', () => {
    const at = (marginPercent: number) => yarnUsage([entry('A', '#000000', 11_800)], inputs({ marginPercent }))
    expect(at(0).metres).toBeCloseTo(295, 9)
    expect(at(20).metres).toBeCloseTo(354, 9)
    expect(at(20).balls).toBe(2)
  })

  it('gives grams, and counts balls by weight, from a ball that gives its weight', () => {
    const both = yarnUsage([entry('A', '#000000', 11_800)], inputs({ marginPercent: 0, ball: BALL }))
    expect(both.grams).toBeCloseTo(100, 9)
    expect(both.balls).toBe(1)
    const weightOnly = yarnUsage([entry('A', '#000000', 11_800)], inputs({ marginPercent: 0, ball: { metres: null, grams: 100 } }))
    expect(weightOnly.grams).toBeNull() // no way from metres to grams
    expect(weightOnly.balls).toBeNull()
  })

  it('counts no balls when the ball is unknown', () => {
    const u = yarnUsage(palette, inputs({ ball: { metres: null, grams: null } }))
    expect(u.colours.every((c) => c.balls === null)).toBe(true)
    expect(u.balls).toBeNull()
  })

  it("takes recount's counts: skip cells and out-of-range indices count towards no colour", () => {
    // The counts every edit recomputes (edit.ts's `_recount`).
    const counts = countCells(Uint16Array.from([0, 1, SKIP_INDEX, 7, 0, 0]), 2)
    const palette = counts.map((n, i) => entry(String(i), '#000000', n))
    const u = yarnUsage(palette, inputs({ yarnPerStitchCm: 10, ball: { metres: 1, grams: null }, marginPercent: 0 }))
    expect(u.colours.map((c) => c.stitches)).toEqual([3, 1])
    expect(u.stitches).toBe(4)
    expect(u.colours.map((c) => c.balls)).toEqual([1, 1])
  })
})

describe('yarnUsage by weight (a weighed swatch)', () => {
  const palette = [entry('White', '#ffffff', 1000), entry('Black', '#000000', 1)]

  it('is stitches × (swatch grams ÷ its stitches) × (1 + margin), and ignores yarn per stitch', () => {
    const u = yarnUsage(palette, inputs({ swatch: SWATCH, ball: BALL, yarnPerStitchCm: 999 }))
    expect(u.basis).toBe('weight')
    expect(u.colours.map((c) => c.grams)).toEqual([expect.closeTo(55, 9), expect.closeTo(0.055, 12)])
    // 55 g of a 295 m / 100 g yarn is 162.25 m.
    expect(u.colours[0]!.metres).toBeCloseTo(162.25, 9)
    expect(u.colours.map((c) => c.balls)).toEqual([1, 1])
    expect(u.grams).toBeCloseTo(55.055, 9)
  })

  it('counts balls by weight first, by length when only that is known', () => {
    const at = (ball: { metres: number | null; grams: number | null }) =>
      yarnUsage([entry('A', '#000', 4000)], inputs({ swatch: SWATCH, ball, marginPercent: 0 })) // 200 g
    expect(at({ metres: 295, grams: 100 }).balls).toBe(2)
    expect(at({ metres: null, grams: 100 }).balls).toBe(2)
    expect(at({ metres: null, grams: 100 }).metres).toBeNull()
    // By length the grams can't become metres without the ball's weight: no balls.
    expect(at({ metres: 295, grams: null }).balls).toBeNull()
  })

  it('needs stitches and rows to weigh by', () => {
    expect(yarnUsage(palette, inputs({ swatch: { ...SWATCH, rows: 0 } })).basis).toBe('length')
    expect(yarnUsage(palette, inputs({ swatch: { ...SWATCH, grams: 0 } })).basis).toBe('length')
  })
})

describe('carried yarn', () => {
  const palette = [entry('White', '#ffffff', 1000), entry('Black', '#000000', 10)]
  const carried = [100, 0]

  it('adds one stitch width of yarn for each stitch a colour is carried inside, by length', () => {
    // 1000 × 2.5 cm + 100 × 1 cm = 26 m.
    const u = yarnUsage(palette, inputs({ swatch: { ...SWATCH, grams: null }, marginPercent: 0, carried }))
    expect(u.carriedMissing).toBeNull()
    expect(u.colours.map((c) => c.carried)).toEqual([100, 0])
    expect(u.colours[0]!.metres).toBeCloseTo(26, 9)
    expect(u.colours[1]!.metres).toBeCloseTo(0.25, 9)
    expect(u.carried).toBe(100)
  })

  it('by weight, at the ball’s grams per metre', () => {
    // 1000 × 0.05 g + 1 m × 100/295 g.
    const u = yarnUsage(palette, inputs({ swatch: SWATCH, ball: BALL, marginPercent: 0, carried }))
    expect(u.colours[0]!.grams).toBeCloseTo(50 + 100 / 295, 9)
  })

  it('says why it could not be counted, and leaves it out', () => {
    const noWidth = yarnUsage(palette, inputs({ marginPercent: 0, carried }))
    expect(noWidth.carriedMissing).toBe('width')
    expect(noWidth.colours[0]!.metres).toBeCloseTo(25, 9)
    expect(noWidth.carried).toBe(0)
    const noBall = yarnUsage(palette, inputs({ swatch: SWATCH, ball: { metres: 295, grams: null }, marginPercent: 0, carried }))
    expect(noBall.carriedMissing).toBe('ball')
    expect(noBall.colours[0]!.grams).toBeCloseTo(50, 9)
    expect(yarnUsage(palette, inputs({ carried: null })).carriedMissing).toBeNull()
  })
})

describe('finishedSize', () => {
  it('is columns × stitch width and rows × row height, from the swatch', () => {
    // 60 × 40 cells, a 10 × 10 swatch of 12 × 8 cm.
    expect(finishedSize(60, 40, { ...SWATCH, widthCm: 12 })).toEqual({ widthCm: expect.closeTo(72, 9), heightCm: expect.closeTo(32, 9) })
    expect(finishedSize(60, 40, { ...SWATCH, stitches: 20, rows: 16 })).toEqual({ widthCm: 30, heightCm: 20 })
  })

  it('is unknown where the swatch is unmeasured', () => {
    expect(finishedSize(60, 40, UNMEASURED)).toEqual({ widthCm: null, heightCm: null })
    expect(finishedSize(60, 40, { ...UNMEASURED, widthCm: 10 })).toEqual({ widthCm: 60, heightCm: null })
  })

  it('shows it in cm or inches, to a tenth under 100', () => {
    expect(formatSize(72, 32, 'metric')).toBe('72 × 32 cm')
    expect(formatSize(72.04, 150.26, 'metric')).toBe('72 × 150 cm')
    expect(formatSize(72, 32, 'imperial')).toBe('28.3 × 12.6 in')
  })
})

describe('units', () => {
  it('shows lengths and weights rounded up', () => {
    expect(formatLength(27.01, 'metric')).toBe('28 m')
    expect(formatLength(27, 'metric')).toBe('27 m')
    expect(formatLength(0, 'metric')).toBe('0 m')
    expect(formatLength(91.44, 'imperial')).toBe('100 yd')
    expect(formatLength(91.45, 'imperial')).toBe('101 yd')
    expect(formatLength(1234.5, 'metric')).toBe('1,235 m')
    expect(formatWeight(54.2)).toBe('55 g')
    expect(formatWeight(1200)).toBe('1,200 g')
  })

  it('converts the inputs both ways', () => {
    expect(cmIn(2.54, 'imperial')).toBeCloseTo(1, 12)
    expect(cmFrom(1, 'imperial')).toBeCloseTo(2.54, 12)
    expect(cmIn(2.5, 'metric')).toBe(2.5)
    expect(metresIn(295, 'imperial')).toBeCloseTo(322.6159, 3) // the ball band says 322 yds
    expect(metresFrom(metresIn(295, 'imperial'), 'imperial')).toBeCloseTo(295, 12)
    expect(metresFrom(100, 'metric')).toBe(100)
    expect(fieldValue(0.98425196, 2)).toBe('0.98')
    expect(fieldValue(2.5, 2)).toBe('2.5')
  })
})

describe('usageText', () => {
  it('lists the size, the swatch, each colour and the total', () => {
    const palette = [entry('White', '#ffffff', 1000), entry('Black', '#000000', 1)]
    const i = inputs({ swatch: SWATCH, ball: BALL })
    const text = usageText(yarnUsage(palette, i), {
      patternName: 'Heart',
      cols: 60,
      rows: 40,
      inputs: i,
      units: 'metric',
      ballNote: 'Stylecraft Special DK',
      shades: ['Stylecraft Special DK 1001 White', null],
    })
    expect(text).toBe(
      [
        'Heart: yarn estimate',
        '',
        'Pattern: 60 columns × 40 rows. Finished size: 60 × 32 cm.',
        'Swatch: 10 stitches × 10 rows, 10 × 8 cm, 5 g.',
        'By the swatch’s weight. Ball: 295 m, 100 g (Stylecraft Special DK). Extra: 10%.',
        'Yarn carried inside the stitches (tapestry crochet) is not counted.',
        'An estimate: one stitch per cell; ends, a foundation chain and borders are not counted. Amounts are rounded up.',
        '',
        'White (#ffffff), nearest Stylecraft Special DK 1001 White: 1000 stitches, 163 m, 55 g, 1 ball',
        'Black (#000000): 1 stitch, 1 m, 1 g, 1 ball',
        '',
        'Total: 1001 stitches, 163 m, 56 g, 2 balls',
        '',
      ].join('\n'),
    )
  })

  it('in inches and yards, by length, with no ball, and carried yarn that needs a width', () => {
    const i = inputs({ yarnPerStitchCm: 2.54, ball: { metres: null, grams: null }, marginPercent: 0, carried: [5] })
    const text = usageText(yarnUsage([entry('A', '#000000', 36)], i), {
      patternName: 'P',
      cols: 6,
      rows: 6,
      inputs: i,
      units: 'imperial',
      ballNote: null,
    })
    expect(text).toContain('Pattern: 6 columns × 6 rows.\n')
    expect(text).toContain('Swatch: 10 stitches × 10 rows.\n')
    expect(text).toContain('Yarn per stitch: 1 in. Ball: unknown, so no balls are counted. Extra: 0%.')
    expect(text).toContain('Yarn carried inside the stitches could not be counted: the swatch’s width is needed.')
    expect(text).toContain('A (#000000): 36 stitches, 1 yd\n')
    expect(text).toContain('Total: 36 stitches, 1 yd\n')
  })

  it('says how many stitches a colour is carried inside', () => {
    const i = inputs({ swatch: { ...SWATCH, grams: null }, carried: [12] })
    const text = usageText(yarnUsage([entry('A', '#000000', 36)], i), { patternName: 'P', cols: 6, rows: 6, inputs: i, units: 'metric', ballNote: null })
    expect(text).toContain('is counted, one stitch’s width per stitch carried.')
    expect(text).toContain('A (#000000): 36 stitches (and carried inside 12), 2 m, 1 ball\n')
  })
})
