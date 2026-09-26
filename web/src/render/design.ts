/**
 * The Design canvas (§6.2): geometry and drawing, a port of design_canvas.py onto the
 * Work chart's rendering approach (chart.ts).
 *
 * The cells are drawn once, a pixel per cell, into an offscreen image (`buildCellImage`)
 * whenever the pattern changes, and each frame copies the visible part of it onto a
 * viewport-sized canvas with smoothing off. Gridlines, axis numbers and the rectangle
 * preview are drawn over it. Every cell is one size here (the zoom); unlike the Work
 * chart there are no taller rows, and never any progress (§6.1).
 *
 * Coordinates are CSS pixels within the viewport. The grid starts at the axis margins,
 * offset by the scroll position; the numbers in the margins stay put.
 */
import { workingNumber } from '../logic/readout.ts'
import type { Pattern } from '../model/types.ts'
import { GRID_COLOR, type CellImage, type ChartColors } from './chart.ts'
import { AXIS_LEFT, AXIS_TOP, PAD } from './layout.ts'

export { AXIS_LEFT, AXIS_TOP, PAD }

/** Cell sizes the zoom steps through, in CSS pixels. */
export const ZOOMS = [2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 60] as const
export const MIN_ZOOM: number = ZOOMS[0]
export const MAX_ZOOM: number = ZOOMS[ZOOMS.length - 1]!
/** Fit never makes cells bigger than this (design_window.py `_fit_to_view`). */
export const MAX_FIT = 48
/** Below this, gridlines would hide the colours, so they aren't drawn. */
export const MIN_GRID_CELL = 4

export interface Cell {
  readonly r: number
  readonly c: number
}

/** The next zoom step in (`dir` > 0) or out from `cell`. */
export function zoomStep(cell: number, dir: number): number {
  if (dir > 0) return ZOOMS.find((z) => z > cell) ?? MAX_ZOOM
  return [...ZOOMS].reverse().find((z) => z < cell) ?? MIN_ZOOM
}

/** The largest whole cell size at which the whole pattern fits the viewport. */
export function fitCell(cols: number, rows: number, width: number, height: number): number {
  const w = width - AXIS_LEFT - PAD
  const h = height - AXIS_TOP - PAD
  if (cols < 1 || rows < 1 || w < 1 || h < 1) return 16
  return Math.max(MIN_ZOOM, Math.min(MAX_FIT, Math.floor(Math.min(w / cols, h / rows))))
}

/** The scrollable size of the whole chart, margins included. */
export function contentSize(cols: number, rows: number, cell: number): { width: number; height: number } {
  return { width: AXIS_LEFT + cols * cell + PAD, height: AXIS_TOP + rows * cell + PAD }
}

/**
 * The cell at a viewport point, or null over the margins or past the grid. With `clamp`,
 * the nearest cell instead: a drag that leaves the grid keeps to its edge.
 */
export function cellAt(
  x: number,
  y: number,
  v: { cell: number; rows: number; cols: number; scrollX: number; scrollY: number },
  clamp = false,
): Cell | null {
  const c = Math.floor((x - AXIS_LEFT + v.scrollX) / v.cell)
  const r = Math.floor((y - AXIS_TOP + v.scrollY) / v.cell)
  if (clamp) return { r: Math.max(0, Math.min(v.rows - 1, r)), c: Math.max(0, Math.min(v.cols - 1, c)) }
  if (x < AXIS_LEFT || y < AXIS_TOP) return null
  return r >= 0 && r < v.rows && c >= 0 && c < v.cols ? { r, c } : null
}

/**
 * The scroll position that keeps the grid point under (x, y) still when the cell size
 * changes from `from` to `to`: zooming about the pointer.
 */
export function zoomScroll(
  x: number,
  y: number,
  from: number,
  to: number,
  scrollX: number,
  scrollY: number,
): { left: number; top: number } {
  const gx = (x - AXIS_LEFT + scrollX) / from
  const gy = (y - AXIS_TOP + scrollY) / from
  return { left: Math.max(0, gx * to - (x - AXIS_LEFT)), top: Math.max(0, gy * to - (y - AXIS_TOP)) }
}

/** Whether an axis number is shown: always the first; then every one on small charts
 *  (as layout.ts `showAxisNumber`), every 5th on larger ones, and every 10th when zoomed
 *  out so far that five cells can't fit a number. */
export function showNumber(n: number, count: number, cell: number, fontSize: number): boolean {
  if (n === 1) return true
  const every = count <= 15 && cell >= fontSize * 1.5 ? 1 : cell * 5 >= fontSize * 2 ? 5 : 10
  return n % every === 0
}

export interface DesignDraw {
  image: CellImage
  pattern: Pattern
  cell: number
  scrollX: number
  scrollY: number
  /** The canvas size in CSS pixels. */
  width: number
  height: number
  dpr: number
  colors: ChartColors
  /** A rectangle being dragged out, and the colour it will fill with. */
  preview?: { a: Cell; b: Cell; hex: string } | null
}

const px = (v: number, dpr: number) => Math.round(v * dpr) / dpr

/** The rows and columns in view: [r0, r1) × [c0, c1). */
export function visibleCells(d: Pick<DesignDraw, 'pattern' | 'cell' | 'scrollX' | 'scrollY' | 'width' | 'height'>) {
  const { rows, cols } = d.pattern
  return {
    r0: Math.max(0, Math.floor(d.scrollY / d.cell)),
    r1: Math.min(rows, Math.ceil((d.scrollY + d.height - AXIS_TOP) / d.cell)),
    c0: Math.max(0, Math.floor(d.scrollX / d.cell)),
    c1: Math.min(cols, Math.ceil((d.scrollX + d.width - AXIS_LEFT) / d.cell)),
  }
}

export function drawDesign(ctx: CanvasRenderingContext2D, d: DesignDraw): void {
  const { pattern: p, cell, dpr, colors } = d
  const ox = AXIS_LEFT - px(d.scrollX, dpr)
  const oy = AXIS_TOP - px(d.scrollY, dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, d.width, d.height)
  if (p.rows < 1 || p.cols < 1) return
  const { r0, r1, c0, c1 } = visibleCells(d)
  if (r1 <= r0 || c1 <= c0) return

  // --- the grid -----------------------------------------------------------------------------
  ctx.save()
  ctx.beginPath()
  ctx.rect(AXIS_LEFT, AXIS_TOP, d.width - AXIS_LEFT, d.height - AXIS_TOP)
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(d.image, c0, r0, c1 - c0, r1 - r0, ox + c0 * cell, oy + r0 * cell, (c1 - c0) * cell, (r1 - r0) * cell)

  if (cell >= MIN_GRID_CELL) {
    // Thin filled rects on device-pixel boundaries, as on the Work chart.
    const lw = cell >= 6 ? 1 : 1 / dpr
    const gw = p.cols * cell
    const gh = p.rows * cell
    ctx.fillStyle = GRID_COLOR
    ctx.beginPath()
    for (let c = c0; c <= c1; c++) ctx.rect(px(Math.min(ox + c * cell, ox + gw - lw), dpr), oy + r0 * cell, lw, (r1 - r0) * cell)
    for (let r = r0; r <= r1; r++) ctx.rect(ox + c0 * cell, px(Math.min(oy + r * cell, oy + gh - lw), dpr), (c1 - c0) * cell, lw)
    ctx.fill()
  }

  if (d.preview) {
    const { a, b, hex } = d.preview
    const x0 = Math.min(a.c, b.c)
    const x1 = Math.max(a.c, b.c) + 1
    const y0 = Math.min(a.r, b.r)
    const y1 = Math.max(a.r, b.r) + 1
    const rect = [ox + x0 * cell, oy + y0 * cell, (x1 - x0) * cell, (y1 - y0) * cell] as const
    ctx.globalAlpha = 0.6
    ctx.fillStyle = hex
    ctx.fillRect(...rect)
    ctx.globalAlpha = 1
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = colors.accent
    ctx.strokeRect(rect[0] + 1, rect[1] + 1, rect[2] - 2, rect[3] - 2)
    ctx.setLineDash([])
  }
  ctx.restore()

  // --- axis numbers ------------------------------------------------------------------------------
  const fs = Math.floor(Math.max(8, Math.min(13, cell * 0.5)))
  ctx.font = `${fs}px ${colors.fontFamily}`
  ctx.fillStyle = colors.axis

  // Rows by the number they are worked in (1 = the first row worked), as on the Work chart.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, AXIS_TOP, AXIS_LEFT, d.height - AXIS_TOP)
  ctx.clip()
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let r = r0; r < r1; r++) {
    const n = workingNumber(p, r)
    if (showNumber(n, p.rows, cell, fs)) ctx.fillText(String(n), AXIS_LEFT - 4, oy + r * cell + cell / 2)
  }
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(AXIS_LEFT - cell, 0, d.width - AXIS_LEFT + cell, AXIS_TOP)
  ctx.clip()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  for (let c = c0; c < c1; c++) {
    if (showNumber(c + 1, p.cols, cell, fs)) ctx.fillText(String(c + 1), ox + c * cell + cell / 2, AXIS_TOP - 2)
  }
  ctx.restore()
}
