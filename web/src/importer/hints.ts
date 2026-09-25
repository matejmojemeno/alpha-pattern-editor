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

/** When detection ran past its time budget and was stopped (client.ts's watchdog). A
 *  crop leaves the detector far less to consider, so it's the first suggestion. */
export const TIMEOUT_HINT: Hint = {
  title: 'This image is taking too long to read.',
  advice: 'Turn on Crop and drag a box around just the squares, or try again.',
}

/** When Pyodide ran out of memory (bridge.py's OUT_OF_MEMORY). Detection's memory grows
 *  with the pixels it reads, and a crop reads fewer; trying again would fail the same way. */
export const OUT_OF_MEMORY_HINT: Hint = {
  title: 'This image is too big to read on this device.',
  advice: 'Turn on Crop and drag a box around just the squares, or try a smaller copy of the image.',
}

/** Where the screen can't offer Crop, NO_GRIDLINES can't point to it. */
const NO_GRIDLINES_WITHOUT_CROP = 'Try an image of just the squares: crop it close to the grid, then import it again.'

export function hintFor(code: DetectionErrorCode, { canCrop = false }: { canCrop?: boolean } = {}): Hint {
  const hint = FAILURE_HINTS[code]
  return code === 'NO_GRIDLINES' && !canCrop ? { ...hint, advice: NO_GRIDLINES_WITHOUT_CROP } : hint
}
