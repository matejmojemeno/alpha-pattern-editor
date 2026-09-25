/**
 * The confirm screen's settings, as the desktop's controls bound them
 * (confirm_window.py).
 */

/** The rows and cols spinboxes' range. */
export const MIN_DIM = 1
export const MAX_DIM = 999

/** ΔE, the colour-detail slider's range, and where it starts for a new image. */
export const MIN_DELTA_E = 2
export const MAX_DELTA_E = 15
export const DEFAULT_DELTA_E = 6

/**
 * The slider runs opposite to ΔE: right means more colours, which is a lower ΔE (the
 * desktop's `setInvertedAppearance(True)`). The same function maps both ways.
 */
export function sliderFromDeltaE(deltaE: number): number {
  return MIN_DELTA_E + MAX_DELTA_E - deltaE
}
export const deltaEFromSlider = sliderFromDeltaE

/** A dimension typed into a rows or cols box, or null while it isn't a usable one. */
export function parseDim(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null
  const n = Number(text)
  return n >= MIN_DIM && n <= MAX_DIM ? n : null
}

export const clampDim = (n: number) => Math.min(MAX_DIM, Math.max(MIN_DIM, Math.round(n)))

/** Cells below this confidence are "unsure": crossed out, and counted by the
 *  low-confidence warning (confirm.py, canvas.py). */
export const UNSURE_BELOW = 0.6

/** The indices (row-major) of the unsure cells. */
export function unsureCells(confidence: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 0; i < confidence.length; i++) if (confidence[i]! < UNSURE_BELOW) out.push(i)
  return out
}

/** "Reduced from 4000×3000 to 2000×1500 …", or null if detection saw the whole image. */
export function shrinkNotice(p: { imageWidth: number; imageHeight: number; detectedWidth: number; detectedHeight: number }): string | null {
  if (p.detectedWidth === p.imageWidth && p.detectedHeight === p.imageHeight) return null
  return (
    `Reduced from ${p.imageWidth}×${p.imageHeight} to ${p.detectedWidth}×${p.detectedHeight} for detection. ` +
    'Check the size, and correct it with Rows and Cols if needed.'
  )
}

/** The largest whole cell size, in device pixels, at which a cols × rows pattern (and its
 *  closing gridline) fits a box of CSS pixels. 0 until the box has a size. */
export function cellSize(cols: number, rows: number, boxWidth: number, boxHeight: number, dpr: number): number {
  if (cols <= 0 || rows <= 0 || boxWidth <= 0 || boxHeight <= 0) return 0
  return Math.max(1, Math.floor(Math.min((boxWidth * dpr - 1) / cols, (boxHeight * dpr - 1) / rows)))
}
