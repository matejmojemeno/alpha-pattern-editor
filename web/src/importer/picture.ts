/**
 * The import screen's side of reading a chart or turning a picture into a pattern (§5a):
 * what the screen says it read, and a picture's settings. The reading and the converting
 * are the Python's (core/kind.py, core/convert.py); this is only wording and arithmetic.
 */
import type { Mode, PictureSettings, Reading } from '../detect/protocol.ts'
import type { Units } from '../settings/store.ts'
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

/** As yarn/usage.ts's CM_PER_INCH. */
const CM_PER_INCH = 2.54

/** One stitch's width and one row's height in `units` (cm or inches), or null until the
 *  swatch is measured both ways: the finished size is shown, and typed, with both. */
export function stitchLength(s: Swatch, units: Units): { across: number; up: number } | null {
  const one = stitchSize(s)
  if (one.widthCm === null || one.heightCm === null) return null
  const k = units === 'metric' ? 1 : 1 / CM_PER_INCH
  return { across: one.widthCm * k, up: one.heightCm * k }
}

/** A finished length as a field shows it: a decimal under 100, as "Yarn & size" does
 *  (usage.ts formatSize), and nothing a field couldn't read back (no thousands comma). */
export function lengthText(n: number): string {
  return String(Number(n.toFixed(n < 100 ? 1 : 0)))
}

/** The stitches (or rows) nearest to a finished length, each `per` long; at least one. */
export function stitchesFor(length: number, per: number): number {
  return Math.max(1, Math.round(length / per))
}

/** The name of the other way in, on the home screen and the buttons that lead to it. */
export const PHOTO_TO_PATTERN = 'Photo to pattern'

/** The one short note above the stages, when there's something to say about what was
 *  read: a title, and the reasons behind it in a few words each. */
export interface Check {
  /** Something may be wrong with the pattern: set apart, as a warning. */
  warning: boolean
  title: string
  reasons: string[]
  /** Offer "Photo to pattern" with the same image. */
  offerPhoto: boolean
}

/** What to say about an image read as `mode`, with the bridge's warnings (already in a
 *  few words each). Nothing for a chart read cleanly, or for a picture, whose screen is
 *  named for it; nor that a large image was shrunk to be read, as most phone photos are,
 *  which is no reason on its own to doubt the pattern. Any reason to doubt the pattern
 *  makes it "Check it against your image", with the reasons; otherwise a note for pixel
 *  art, read block by block, or for a grid that looked more
 *  like a photo's (most such are photos, with a nonsense grid; some are charts, read all
 *  the same). A chart read with doubts, or that looked like a photo, offers Photo to
 *  pattern, should the image be a photo after all. */
export function check(mode: Mode, reading: Reading, warnings: readonly string[]): Check | null {
  if (mode === 'picture') return null
  const offerPhoto = mode === 'chart' && (!reading.sure || reading.photoLike)
  const reasons = [...(mode === 'chart' && !reading.sure ? ['Many squares are hard to read'] : []), ...warnings]
  if (reasons.length > 0) return { warning: true, title: 'Check it against your image', reasons, offerPhoto }
  if (mode === 'pixels') {
    return { warning: false, title: 'Read as pixel art: each block is one stitch', reasons, offerPhoto }
  }
  if (reading.photoLike) {
    return { warning: false, title: 'Looks like a photo, not a chart', reasons, offerPhoto }
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

/** A height typed or stepped to, within what the picture allows. */
export function clampHeight(height: number, p: PictureSettings): number {
  if (!Number.isFinite(height)) return p.height
  return Math.max(p.minHeight, Math.min(p.maxHeight, Math.round(height)))
}

/** The rows of a picture cropped to `w` × `h` image pixels at `cols` stitches across, as
 *  the Python will count them (convert.PictureState.rows): with the shape kept, the ones
 *  that keep it; otherwise the height as set, at most one row per pixel. */
export function croppedRows(cols: number, w: number, h: number, p: PictureSettings): number {
  if (!p.keepShape) return Math.max(1, Math.min(p.height, Math.floor(h)))
  return Math.max(1, Math.round((cols * h) / Math.max(w, 1e-9) / p.cellAspect))
}

/** The Detail slider's label for a value. */
export function detailText(detail: number): string {
  if (detail <= 0.2) return 'Smoothest'
  if (detail < 0.45) return 'Smooth'
  if (detail <= 0.55) return 'Balanced'
  if (detail < 0.8) return 'Detailed'
  return 'Every stitch'
}
