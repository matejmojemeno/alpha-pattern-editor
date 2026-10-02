/**
 * The import screen's side of reading a chart or turning a picture into a pattern (§5a):
 * what the screen says it read, and a picture's settings. The reading and the converting
 * are the Python's (core/kind.py, core/convert.py); this is only wording and arithmetic.
 */
import type { Mode, PictureSettings, Reading } from '../detect/protocol.ts'
import type { Swatch } from '../yarn/usage.ts'

const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0

/** One stitch's width and one row's height in cm, as yarn/usage.ts's `stitchSize` (and
 *  tests/importer/picture.test.ts checks the two agree). Not imported from there: the
 *  import screen would then share usage.ts with the Design stage, and Rollup would split
 *  it into a chunk of its own. */
function stitchSize(s: Swatch): { widthCm: number | null; heightCm: number | null } {
  return {
    widthCm: positive(s.widthCm) && s.stitches > 0 ? s.widthCm / s.stitches : null,
    heightCm: positive(s.heightCm) && s.rows > 0 ? s.heightCm / s.rows : null,
  }
}

/** The fewest and most colours a picture can be made in (convert.MAX_COLOURS). */
export const MIN_COLOURS = 2
export const MAX_COLOURS = 24
/** The narrowest a picture can be made (convert.MIN_WIDTH). */
export const MIN_WIDTH = 4

/** A stitch's height over its width, from the swatch; undefined (square stitches) until
 *  both its width and height are measured. */
export function swatchAspect(s: Swatch): number | undefined {
  const one = stitchSize(s)
  if (one.widthCm === null || one.heightCm === null) return undefined
  const aspect = one.heightCm / one.widthCm
  return Number.isFinite(aspect) && aspect > 0 ? aspect : undefined
}

/** "about 38 × 28 cm", or null until the swatch is measured both ways. */
export function sizeText(cols: number, rows: number, s: Swatch): string | null {
  const one = stitchSize(s)
  if (one.widthCm === null || one.heightCm === null) return null
  return `about ${Math.round(cols * one.widthCm)} × ${Math.round(rows * one.heightCm)} cm`
}

/** The name of the other way in, on the home screen and the buttons that lead to it. */
export const PHOTO_TO_PATTERN = 'Photo to pattern'

/** A line above the stages, when there's something to say about what was read. */
export interface ReadingNote {
  text: string
  /** A chart read with doubts: set apart, as a warning. */
  warning: boolean
  /** Offer "Photo to pattern" with the same image. */
  offerPhoto: boolean
}

/** What to say about an image read as `mode`. Nothing for a chart read cleanly, or for a
 *  picture, whose screen is named for it; a note for pixel art, read block by block; a
 *  warning for a chart with many unsure squares, where the image may be a photo after
 *  all. */
export function readingNote(mode: Mode, reading: Reading): ReadingNote | null {
  if (mode === 'pixels') {
    return { text: 'Read as pixel art: each block of your image is one stitch.', warning: false, offerPhoto: false }
  }
  if (mode === 'chart' && !reading.sure) {
    return {
      text: 'Many squares were hard to read. Check the pattern against your image before you save.',
      warning: true,
      offerPhoto: true,
    }
  }
  return null
}

/** The colour count's − and + for a picture: one colour fewer or more, within bounds. */
export function colourSteps(p: PictureSettings, shown: number): { fewer: number | null; more: number | null } {
  // What the stepper shows is the palette, which may have fewer colours than asked for
  // (a colour no stitch ended up using is dropped); step from what's shown.
  const from = Math.min(p.colours, shown)
  return {
    fewer: from > MIN_COLOURS ? from - 1 : null,
    more: from < MAX_COLOURS ? from + 1 : null,
  }
}

/** A width typed or stepped to, within what the picture allows. */
export function clampWidth(width: number, p: PictureSettings): number {
  if (!Number.isFinite(width)) return p.width
  return Math.max(Math.min(MIN_WIDTH, p.maxWidth), Math.min(p.maxWidth, Math.round(width)))
}

/** The Detail slider's label for a value. */
export function detailText(detail: number): string {
  if (detail <= 0.2) return 'Smoothest'
  if (detail < 0.45) return 'Smooth'
  if (detail <= 0.55) return 'Balanced'
  if (detail < 0.8) return 'Detailed'
  return 'Every stitch'
}
