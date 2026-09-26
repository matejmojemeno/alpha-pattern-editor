/**
 * The confirm screen's settings, as the desktop's controls bound them
 * (confirm_window.py).
 */

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

/** "Reduced from 4000×3000 to 2000×1500 …", or null if detection saw the whole image. */
export function shrinkNotice(p: { imageWidth: number; imageHeight: number; detectedWidth: number; detectedHeight: number }): string | null {
  if (p.detectedWidth === p.imageWidth && p.detectedHeight === p.imageHeight) return null
  return (
    `Reduced from ${p.imageWidth}×${p.imageHeight} to ${p.detectedWidth}×${p.detectedHeight} for detection. ` +
    'Check the size, and fix it in Design if needed.'
  )
}

/** The largest whole cell size, in device pixels, at which a cols × rows pattern (and its
 *  closing gridline) fits a box of CSS pixels. 0 until the box has a size. */
export function cellSize(cols: number, rows: number, boxWidth: number, boxHeight: number, dpr: number): number {
  if (cols <= 0 || rows <= 0 || boxWidth <= 0 || boxHeight <= 0) return 0
  return Math.max(1, Math.floor(Math.min((boxWidth * dpr - 1) / cols, (boxHeight * dpr - 1) / rows)))
}
