/** The import screen's wording and arithmetic for charts and pictures (importer/picture.ts). */
import { describe, expect, it } from 'vitest'

import type { PictureSettings, Reading } from '../../src/detect/protocol.ts'
import { clampWidth, colourSteps, detailText, kindLine, MAX_COLOURS, sizeText, swatchAspect } from '../../src/importer/picture.ts'
import { finishedSize, type Swatch } from '../../src/yarn/usage.ts'

const swatch = (over: Partial<Swatch> = {}): Swatch => ({ stitches: 10, rows: 10, widthCm: null, heightCm: null, grams: null, ...over })
const reading = (over: Partial<Reading> = {}): Reading => ({ kind: 'chart', sure: true, canChart: true, failure: null, ...over })
const picture = (over: Partial<PictureSettings> = {}): PictureSettings => ({
  width: 60,
  maxWidth: 320,
  colours: 6,
  detail: 0.5,
  cellAspect: 1,
  ...over,
})

describe('the stitch shape and size from the swatch', () => {
  it('is square until the swatch is measured both ways', () => {
    expect(swatchAspect(swatch())).toBeUndefined()
    expect(swatchAspect(swatch({ widthCm: 10 }))).toBeUndefined()
    // 16 stitches and 20 rows over 10 cm: a stitch 0.625 wide, a row 0.5 tall.
    expect(swatchAspect(swatch({ stitches: 16, rows: 20, widthCm: 10, heightCm: 10 }))).toBeCloseTo(0.8)
  })

  it('gives the finished size once it can, as "Yarn & size" does', () => {
    expect(sizeText(60, 45, swatch())).toBeNull()
    const s = swatch({ stitches: 16, rows: 20, widthCm: 10, heightCm: 10 })
    expect(sizeText(60, 45, s)).toBe('about 38 × 23 cm')
    // The same arithmetic as yarn/usage.ts, which this doesn't import (bundle size).
    for (const sw of [s, swatch({ stitches: 7, rows: 9, widthCm: 4.2, heightCm: 3.1 }), swatch({ widthCm: 10 })]) {
      const want = finishedSize(33, 21, sw)
      const got = sizeText(33, 21, sw)
      expect(got).toBe(want.widthCm === null || want.heightCm === null ? null : `about ${Math.round(want.widthCm)} × ${Math.round(want.heightCm)} cm`)
    }
  })
})

describe('the line that says what the image was read as', () => {
  it('is quiet for a chart, with the way to a picture', () => {
    expect(kindLine('chart', reading())).toEqual({
      text: 'Read from the squares of your chart.',
      action: { label: 'Turn it into a pattern instead', mode: 'picture' },
      prominent: false,
    })
  })

  it('stands out for a chart read with doubts', () => {
    const line = kindLine('chart', reading({ sure: false }))
    expect(line.prominent).toBe(true)
    expect(line.action?.mode).toBe('picture')
  })

  it('offers the chart reading back only when a grid was found', () => {
    expect(kindLine('picture', reading({ kind: 'picture', canChart: false })).action).toBeNull()
    expect(kindLine('picture', reading({ kind: 'picture', canChart: true })).action).toEqual({
      label: 'Read it as a chart instead',
      mode: 'chart',
    })
  })

  it('says why when the app chose the picture, and not when the user did', () => {
    expect(kindLine('picture', reading({ kind: 'picture' })).text).toMatch(/looks like a picture/)
    expect(kindLine('picture', reading({ kind: 'chart' })).text).toBe('Turned into a pattern from your picture.')
  })
})

describe("a picture's settings", () => {
  it('steps the colours from what is shown, within bounds', () => {
    expect(colourSteps(picture(), 6)).toEqual({ fewer: 5, more: 7 })
    // Asked for 6, but only 4 were used: − and + step from 4.
    expect(colourSteps(picture(), 4)).toEqual({ fewer: 3, more: 5 })
    expect(colourSteps(picture({ colours: 2 }), 2).fewer).toBeNull()
    expect(colourSteps(picture({ colours: MAX_COLOURS }), MAX_COLOURS).more).toBeNull()
  })

  it('keeps the width within what the picture allows, as the Python clamps it', () => {
    expect(clampWidth(1, picture())).toBe(4)
    expect(clampWidth(1000, picture())).toBe(320)
    expect(clampWidth(40.4, picture())).toBe(40)
    expect(clampWidth(Number.NaN, picture())).toBe(60)
    expect(clampWidth(10, picture({ maxWidth: 3 }))).toBe(3)
  })

  it('names the Detail slider’s positions', () => {
    expect([0, 0.3, 0.5, 0.7, 1].map(detailText)).toEqual(['Smoothest', 'Smooth', 'Balanced', 'Detailed', 'Every stitch'])
  })
})
