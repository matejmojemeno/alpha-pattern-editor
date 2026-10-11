/** The import screen's wording and arithmetic for charts and pictures (importer/picture.ts). */
import { describe, expect, it } from 'vitest'

import type { PictureSettings, Reading } from '../../src/detect/protocol.ts'
import { check, clampHeight, clampWidth, colourSteps, croppedRows, detailText, MAX_COLOURS, sizeText, swatchAspect } from '../../src/importer/picture.ts'
import { finishedSize, type Swatch } from '../../src/yarn/usage.ts'

const swatch = (over: Partial<Swatch> = {}): Swatch => ({ stitches: 10, rows: 10, widthCm: null, heightCm: null, grams: null, ...over })
const reading = (over: Partial<Reading> = {}): Reading => ({ kind: 'chart', sure: true, photoLike: false, failure: null, ...over })
const picture = (over: Partial<PictureSettings> = {}): PictureSettings => ({
  width: 60,
  maxWidth: 320,
  height: 45,
  minHeight: 3,
  maxHeight: 240,
  keepShape: true,
  colours: 6,
  detail: 0.5,
  cellAspect: 1,
  outlines: false,
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

describe('the note on what was read', () => {
  it('says nothing of a chart read cleanly, or of a picture', () => {
    expect(check('chart', reading(), [])).toBeNull()
    expect(check('picture', reading({ kind: 'picture' }), [])).toBeNull()
  })

  it('warns of a chart read with doubts, and offers Photo to pattern', () => {
    expect(check('chart', reading({ sure: false }), [])).toEqual({
      warning: true,
      title: 'Check it against your image',
      reasons: ['Many squares are hard to read'],
      offerPhoto: true,
    })
  })

  it('gathers every reason to doubt the pattern into the one note', () => {
    const warnings = ['The grid lines are faint', '12 squares match none of the colours']
    expect(check('chart', reading({ sure: false }), warnings)?.reasons).toEqual(['Many squares are hard to read', ...warnings])
    // The warnings alone: still a check, but a chart read surely is no photo.
    expect(check('chart', reading(), warnings)).toEqual({
      warning: true,
      title: 'Check it against your image',
      reasons: warnings,
      offerPhoto: false,
    })
  })

  it('offers Photo to pattern quietly for a grid that looked more like a photo’s', () => {
    expect(check('chart', reading({ photoLike: true }), [])).toEqual({
      warning: false,
      title: 'Looks like a photo, not a chart',
      reasons: [],
      offerPhoto: true,
    })
    // A reason to doubt the pattern says more, and wins; the offer stays.
    expect(check('chart', reading({ photoLike: true }), ['The grid lines are faint'])).toMatchObject({
      warning: true,
      offerPhoto: true,
    })
  })

  it('says pixel art is read block by block, with nothing to switch to', () => {
    expect(check('pixels', reading({ kind: 'pixels' }), [])).toEqual({
      warning: false,
      title: 'Read as pixel art: each block is one stitch',
      reasons: [],
      offerPhoto: false,
    })
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

  it('keeps a height within what the picture allows', () => {
    expect(clampHeight(1, picture())).toBe(3)
    expect(clampHeight(1000, picture())).toBe(240)
    expect(clampHeight(30.6, picture())).toBe(31)
    expect(clampHeight(Number.NaN, picture())).toBe(45)
  })

  it('counts a cropped picture’s rows as convert.PictureState does', () => {
    // Kept in shape, the rows follow the width: 40 across 160 × 240 pixels, square or
    // wider than tall stitches.
    expect(croppedRows(40, 160, 240, picture())).toBe(60)
    expect(croppedRows(40, 160, 240, picture({ cellAspect: 0.75 }))).toBe(80)
    // Let go, they stay as set, but no more than one a pixel.
    expect(croppedRows(40, 160, 240, picture({ keepShape: false, height: 20 }))).toBe(20)
    expect(croppedRows(40, 160, 10.5, picture({ keepShape: false, height: 20 }))).toBe(10)
  })

  it('names the Detail slider’s positions', () => {
    expect([0, 0.3, 0.5, 0.7, 1].map(detailText)).toEqual(['Smoothest', 'Smooth', 'Balanced', 'Detailed', 'Every stitch'])
  })
})
