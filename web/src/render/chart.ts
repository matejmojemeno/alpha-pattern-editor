/**
 * Work-stage chart drawing (Canvas 2D): a port of chart_view.py's paintEvent onto the
 * per-row layout in layout.ts.
 *
 * The cells are drawn once, one pixel per cell, into an offscreen image whenever the
 * pattern changes (`buildCellImage`). Each frame then scales bands of that image onto
 * the visible canvas with smoothing off, and draws the few things that depend on
 * progress and scroll position over it: gridlines, the done-wash and strike line, the
 * current-row outline and the axis numbers. Nothing fills cells one at a time per frame,
 * which is what keeps an 88×194 chart scrolling smoothly on a phone.
 *
 * The visible canvas is the size of the chart area, not of the chart: a scrolled chart
 * is drawn from an offset, so a long pattern never needs a canvas taller than the screen.
 */
import { workingNumber } from '../logic/readout.ts'
import type { Pattern } from '../model/types.ts'
import { hexToRgb } from '../theme/contrast.ts'
import { AXIS_LEFT, AXIS_TOP, rowsInViewport, showAxisNumber, type ChartLayout } from './layout.ts'

// Drawn over the pattern's own colours, so fixed rather than themed (theme.py:71-99).
/** Gridlines: near-black, to read against yarn rather than the page. */
export const GRID_COLOR = '#000000'
/** Completed rows: QColor(128, 128, 128, 150), neutral so it fades pale and dark yarns alike. */
export const DONE_WASH = 'rgba(128, 128, 128, 0.588)'
export const DONE_STRIKE = 'rgb(60, 60, 60)'
/** A cell whose palette index has no entry (chart_view.py: QColor(200, 200, 200)). */
export const MISSING_RGB: readonly [number, number, number] = [200, 200, 200]

/** The colours that do follow the page (read from theme/tokens.css). */
export interface ChartColors {
  background: string
  text: string
  axis: string
  accent: string
  fontFamily: string
}

/** RGBA pixels for the cells, one per cell, row-major: the offscreen image's contents. */
export function cellPixels(pattern: Pick<Pattern, 'rows' | 'cols' | 'cells' | 'palette'>): Uint8ClampedArray {
  const rgb = pattern.palette.map((e) => {
    try {
      return hexToRgb(e.hex)
    } catch {
      return MISSING_RGB
    }
  })
  const n = pattern.rows * pattern.cols
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const c = rgb[pattern.cells[i]!] ?? MISSING_RGB
    out[i * 4] = c[0]
    out[i * 4 + 1] = c[1]
    out[i * 4 + 2] = c[2]
    out[i * 4 + 3] = 255
  }
  return out
}

export type CellImage = HTMLCanvasElement | OffscreenCanvas

/** The offscreen image of the cells, or null where there is no canvas (tests). */
export function buildCellImage(pattern: Pick<Pattern, 'rows' | 'cols' | 'cells' | 'palette'>): CellImage | null {
  if (pattern.rows <= 0 || pattern.cols <= 0) return null
  let canvas: CellImage
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(pattern.cols, pattern.rows)
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = pattern.cols
    canvas.height = pattern.rows
  } else return null
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return null
  const data = new ImageData(pattern.cols, pattern.rows)
  data.data.set(cellPixels(pattern))
  ctx.putImageData(data, 0, 0)
  return canvas
}

export interface DrawInput {
  layout: ChartLayout
  image: CellImage
  pattern: Pattern
  /** Image rows that are complete. */
  completed: ReadonlySet<number>
  scrollX: number
  scrollY: number
  /** The canvas size in CSS pixels. */
  width: number
  height: number
  dpr: number
  colors: ChartColors
}

/** Consecutive rows of equal height, so each band is a single drawImage. */
export function bands(heights: readonly number[], from: number, to: number): { start: number; count: number }[] {
  const out: { start: number; count: number }[] = []
  for (let i = from; i < to; i++) {
    const last = out[out.length - 1]
    if (last && heights[last.start] === heights[i]) last.count++
    else out.push({ start: i, count: 1 })
  }
  return out
}

/** Snap a CSS length to whole device pixels. */
const px = (v: number, dpr: number) => Math.round(v * dpr) / dpr

export function drawChart(ctx: CanvasRenderingContext2D, d: DrawInput): void {
  const { layout: l, dpr, colors } = d
  const sx = px(d.scrollX, dpr)
  const sy = px(d.scrollY, dpr)
  const ox = AXIS_LEFT - sx
  const oy = AXIS_TOP - sy
  const first = l.range.start

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, d.width, d.height)
  if (l.heights.length === 0 || l.cols <= 0) return

  const { from, to } = rowsInViewport(l, sy)
  const gw = l.gridWidth
  const areaW = d.width - AXIS_LEFT
  const areaH = d.height - AXIS_TOP

  // --- the grid: cells, lines, done rows, current row ----------------------------------
  ctx.save()
  ctx.beginPath()
  // A little past the grid's top-left, for a current-row outline drawn outside the row.
  ctx.rect(AXIS_LEFT - 3, AXIS_TOP - 3, areaW + 3, areaH + 3)
  ctx.clip()

  ctx.imageSmoothingEnabled = false
  for (const b of bands(l.heights, from, to)) {
    const h = l.heights[b.start]!
    ctx.drawImage(d.image, 0, first + b.start, l.cols, b.count, ox, oy + l.offsets[b.start]!, gw, h * b.count)
  }

  // Gridlines as thin filled rects on device-pixel boundaries: crisp at any scale. Below
  // ~6 px a full CSS pixel would swallow the colours, so drop to one device pixel.
  const lw = l.cell >= 6 ? 1 : 1 / dpr
  const top = oy + l.offsets[from]!
  const bottom = oy + l.offsets[to]!
  const c0 = Math.max(0, Math.floor(sx / l.cell))
  const c1 = Math.min(l.cols, Math.ceil((sx + areaW) / l.cell))
  ctx.fillStyle = GRID_COLOR
  ctx.beginPath()
  for (let c = c0; c <= c1; c++) ctx.rect(Math.min(ox + c * l.cell, ox + gw - lw), top, lw, bottom - top)
  for (let i = from; i <= to; i++) ctx.rect(ox, Math.min(oy + l.offsets[i]!, oy + l.gridHeight - lw), gw, lw)
  ctx.fill()

  for (let i = from; i < to; i++) {
    if (!d.completed.has(first + i)) continue
    const y = oy + l.offsets[i]!
    const h = l.heights[i]!
    ctx.fillStyle = DONE_WASH
    ctx.fillRect(ox, y, gw, h)
    // 2 px as on the desktop, but thinner on short rows, where 2 px would black them out.
    const sw = h >= 8 ? 2 : 1 / dpr
    ctx.fillStyle = DONE_STRIKE
    ctx.fillRect(ox, px(y + h / 2 - sw / 2, dpr), gw, sw)
  }

  const cur = l.current === null ? -1 : l.current - first
  if (cur >= from && cur < to) {
    // 3 px, inside the row as on the desktop when there's room; around it on short rows,
    // where an inside outline would cover the very colours it points at.
    const h = l.heights[cur]!
    const inset = h >= 16 ? 1.5 : -1.5
    ctx.strokeStyle = colors.accent
    ctx.lineWidth = 3
    ctx.strokeRect(ox + inset, oy + l.offsets[cur]! + inset, gw - 2 * inset, h - 2 * inset)
  }
  ctx.restore()

  // --- axis numbers ----------------------------------------------------------------------
  const fs = Math.floor(Math.max(8, Math.min(13, l.cell * 0.5)))
  ctx.font = `${fs}px ${colors.fontFamily}`

  // Row numbers, in working order, in the left margin. The current row's is always shown,
  // in the text colour, and a neighbour's that would overlap it is dropped.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, AXIS_TOP, AXIS_LEFT, areaH)
  ctx.clip()
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const mid = (i: number) => oy + l.offsets[i]! + l.heights[i]! / 2
  const curMid = cur >= from && cur < to ? mid(cur) : null
  ctx.fillStyle = colors.axis
  for (let i = from; i < to; i++) {
    if (i === cur) continue
    const num = workingNumber(d.pattern, first + i)
    if (!showAxisNumber(num, l.rows)) continue
    if (curMid !== null && Math.abs(mid(i) - curMid) < fs) continue
    ctx.fillText(String(num), AXIS_LEFT - 4, mid(i))
  }
  if (curMid !== null) {
    ctx.fillStyle = colors.text
    ctx.font = `600 ${fs}px ${colors.fontFamily}`
    ctx.fillText(String(workingNumber(d.pattern, first + cur)), AXIS_LEFT - 4, curMid)
    ctx.font = `${fs}px ${colors.fontFamily}`
  }
  ctx.restore()

  // Column numbers along the top, centred over their column.
  ctx.save()
  ctx.beginPath()
  ctx.rect(AXIS_LEFT - l.cell, 0, areaW + l.cell, AXIS_TOP)
  ctx.clip()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = colors.axis
  for (let c = c0; c < c1; c++) {
    if (!showAxisNumber(c + 1, l.cols)) continue
    ctx.fillText(String(c + 1), ox + c * l.cell + l.cell / 2, AXIS_TOP - 2)
  }
  ctx.restore()
}
