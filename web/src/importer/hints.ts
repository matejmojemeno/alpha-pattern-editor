/**
 * Plain-English explanations of why detection failed, ported from `_FAILURE_HINTS` in
 * alphareader/ui/importer/confirm_window.py. The person is looking at their chart, not at
 * the detector's vocabulary; the error code is shown only as small print.
 */
import type { DetectionErrorCode } from '../detect/protocol.ts'

export interface Hint {
  /** What went wrong. */
  title: string
  /** What to do about it. */
  advice: string
}

export const FAILURE_HINTS: Record<DetectionErrorCode, Hint> = {
  NO_GRIDLINES: {
    title: "I couldn't find the grid in this image.",
    advice: 'Turn on Crop, drag a box around just the squares, and let go.',
  },
  LOW_RESOLUTION: {
    title: 'This image is too small to read reliably.',
    advice: 'Each square needs about 6 pixels or more — try a larger copy.',
  },
  ROTATED: {
    title: 'The chart looks tilted.',
    advice: 'Straighten the image and import it again.',
  },
  TOO_SMALL: {
    title: 'This image is too small to contain a chart.',
    advice: '',
  },
}

/** Until the import screen has Crop (Phase 2, part 2), NO_GRIDLINES can't point to it. */
const NO_GRIDLINES_WITHOUT_CROP = 'Try an image of just the squares: crop it close to the grid, then import it again.'

export function hintFor(code: DetectionErrorCode, { canCrop = false }: { canCrop?: boolean } = {}): Hint {
  const hint = FAILURE_HINTS[code]
  return code === 'NO_GRIDLINES' && !canCrop ? { ...hint, advice: NO_GRIDLINES_WITHOUT_CROP } : hint
}
