/** The import screen's wording and arithmetic for charts and pictures (importer/picture.ts). */
import { describe, expect, it } from 'vitest'

import type { PictureSettings, Reading } from '../../src/detect/protocol.ts'
import { clampWidth, colourSteps, detailText, MAX_COLOURS, readingNote, sizeText, swatchAspect } from '../../src/importer/picture.ts'
import { finishedSize, type Swatch } from '../../src/yarn/usage.ts'

const swatch = (over: Partial<Swatch> = {}): Swatch => ({ stitches: 10, rows: 10, widthCm: null, heightCm: null, grams: null, ...over })
const reading = (over: Partial<Reading> = {}): Reading => ({ kind: 'chart', sure: true, failure: null, ...over })
const picture = (over: Partial<PictureSettings> = {}): PictureSettings => ({
  width: 60,
  maxWidth: 320,
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
    expect(readingNote('chart', reading())).toBeNull()
    expect(readingNote('picture', reading({ kind: 'picture' }))).toBeNull()
  })

  it('warns of a chart read with doubts, and offers Photo to pattern', () => {
    expect(readingNote('chart', reading({ sure: false }))).toEqual({
      text: 'Many squares were hard to read. Check the pattern against your image before you save.',
      warning: true,
      offerPhoto: true,
    })
  })

  it('says pixel art is read block by block, with nothing to switch to', () => {
    expect(readingNote('pixels', reading({ kind: 'pixels' }))).toEqual({
      text: 'Read as pixel art: each block of your image is one stitch.',
      warning: false,
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

  it('names the Detail slider’s positions', () => {
    expect([0, 0.3, 0.5, 0.7, 1].map(detailText)).toEqual(['Smoothest', 'Smooth', 'Balanced', 'Detailed', 'Every stitch'])
  })
})
