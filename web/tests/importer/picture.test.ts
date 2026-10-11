/** The import screen's wording and arithmetic for charts and pictures (importer/picture.ts). */
import { describe, expect, it } from 'vitest'

import type { PictureSettings, Reading } from '../../src/detect/protocol.ts'
import {
  check,
  clampHeight,
  clampWidth,
  colourSteps,
  croppedRows,
  detailText,
  lengthText,
  MAX_COLOURS,
  stitchesFor,
  stitchLength,
  swatchAspect,
} from '../../src/importer/picture.ts'
import { cmIn, finishedSize, formatSize, type Swatch } from '../../src/yarn/usage.ts'

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
    expect(stitchLength(swatch(), 'metric')).toBeNull()
    expect(stitchLength(swatch({ widthCm: 10 }), 'metric')).toBeNull()
    const s = swatch({ stitches: 16, rows: 20, widthCm: 10, heightCm: 10 })
    expect(stitchLength(s, 'metric')).toEqual({ across: 0.625, up: 0.5 })
    // The same arithmetic and rounding as yarn/usage.ts, which this doesn't import (bundle
    // size), in either units.
    for (const units of ['metric', 'imperial'] as const) {
      for (const sw of [s, swatch({ stitches: 7, rows: 9, widthCm: 4.2, heightCm: 3.1 })]) {
        for (const [cols, rows] of [[33, 21], [180, 240], [999, 4]] as const) {
          const want = finishedSize(cols, rows, sw)
          const one = stitchLength(sw, units)!
          expect(cols * one.across).toBeCloseTo(cmIn(want.widthCm!, units), 9)
          expect(`${lengthText(cols * one.across)} × ${lengthText(rows * one.up)} ${units === 'metric' ? 'cm' : 'in'}`).toBe(
            formatSize(want.widthCm!, want.heightCm!, units).replace(/,/g, ''),
          )
        }
      }
    }
  })

  it('turns a finished size typed into the nearest stitches, at least one', () => {
    expect(stitchesFor(120, 0.625)).toBe(192)
    expect(stitchesFor(120.2, 0.625)).toBe(192)
    expect(stitchesFor(48, 1 / 3)).toBe(144) // 48 inches at 3 stitches an inch
    expect(stitchesFor(0.1, 0.625)).toBe(1)
    expect(lengthText(119.99)).toBe('120')
    expect(lengthText(1234.4)).toBe('1234') // no thousands comma: the field reads it back
    expect(lengthText(37.5)).toBe('37.5')
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
