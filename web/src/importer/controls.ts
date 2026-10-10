/**
 * The confirm screen's settings, as the desktop's controls bound them
 * (confirm_window.py).
 */

/** The largest whole cell size, in device pixels, at which a cols × rows pattern (and its
 *  closing gridline) fits a box of CSS pixels. 0 until the box has a size. */
export function cellSize(cols: number, rows: number, boxWidth: number, boxHeight: number, dpr: number): number {
  if (cols <= 0 || rows <= 0 || boxWidth <= 0 || boxHeight <= 0) return 0
  return Math.max(1, Math.floor(Math.min((boxWidth * dpr - 1) / cols, (boxHeight * dpr - 1) / rows)))
}

