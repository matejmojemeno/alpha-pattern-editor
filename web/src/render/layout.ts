/**
 * Work-stage chart layout: where every row and column goes, as pure functions.
 *
 * The desktop sizes every row with one number (chart_view.py:69). The web chart instead
 * gives each row its own height (docs/web-port-plan.md, "Chart layout"):
 *
 *   rowHeight(r)  -> emphasised height if |r - current| <= radius, else the base height
 *   yOffsets      -> running sum of the row heights
 *   viewport      -> a scroll offset into yOffsets that follows the current row
 *
 * Focus mode and row emphasis are one idea, "the rows around the current one"
 * (`nearRows`). Emphasis draws them taller; focus mode draws only them
 * (chart_view.py:46-52).
 *
 * Across, a chart wider than its view follows your place in the row, the next stitch to
 * work (`followCurrentX`).
 *
 * Coordinates are CSS pixels. The grid sits inside the axis margins; `scrollX`/`scrollY`
 * are offsets of the grid within its viewport, and the axis numbers stay put.
 */
import type { Direction, Run } from '../model/types.ts'

/** Room for the row numbers on the left and the column numbers on top (chart_view.py). */
export const AXIS_LEFT = 34
export const AXIS_TOP = 22
/** Space kept clear on the right and bottom of the grid. */
export const PAD = 6
/** Rows either side of the current one that count as "around" it. */
export const NEAR_RADIUS = 2
/** How much taller an emphasised row is than the rest. */
export const EMPHASIS_SCALE = 1.6
/** The smallest a cell gets before the chart scrolls instead (chart_view.py:69). */
export const MIN_CELL = 3
/** Charts longer than this on one axis than the other scroll along it instead of fitting. */
export const SCROLL_ASPECT = 2

const snap = (v: number, dpr: number) => Math.floor(v * dpr + 1e-6) / dpr
const round = (v: number, dpr: number) => Math.round(v * dpr) / dpr

/** A half-open range of image rows, [start, end). */
export interface RowRange {
  readonly start: number
  readonly end: number
}

/** The rows within `radius` of `current`, clipped to the chart. Empty without a current row. */
export function nearRows(rows: number, current: number | null, radius: number = NEAR_RADIUS): RowRange {
  if (current === null || rows <= 0) return { start: 0, end: 0 }
  const c = Math.max(0, Math.min(rows - 1, current))
  return { start: Math.max(0, c - radius), end: Math.min(rows, c + radius + 1) }
}

export const isNear = (r: number, near: RowRange) => r >= near.start && r < near.end

/** The rows the chart draws: all of them, or in focus mode only those near the current
 *  one. With no current row (a finished pattern) focus mode has nothing to narrow to. */
export function visibleRows(rows: number, current: number | null, focus: boolean): RowRange {
  if (focus && current !== null) return nearRows(rows, current)
  return { start: 0, end: Math.max(0, rows) }
}

/** The height of image row `r`, given the base cell size. */
export function rowHeight(r: number, base: number, near: RowRange, emphasise: boolean, dpr = 1): number {
  return emphasise && isNear(r, near) ? round(base * EMPHASIS_SCALE, dpr) : base
}

/** Running sum of `heights`: offsets[i] is the top of row i, offsets[n] the total. */
export function yOffsets(heights: readonly number[]): number[] {
  const out = new Array<number>(heights.length + 1)
  out[0] = 0
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i]! + heights[i]!
  return out
}

/** Whether a chart of this shape scrolls along its long axis rather than fitting. */
export function shouldScroll(rows: number, cols: number): boolean {
  if (rows <= 0 || cols <= 0) return false
  return Math.max(rows, cols) / Math.min(rows, cols) > SCROLL_ASPECT
}

export interface LayoutInput {
  readonly rows: number
  readonly cols: number
  /** The image row being worked, or null when there is none (a finished pattern). */
  readonly current: number | null
  /** The whole chart area, margins included, in CSS pixels. */
  readonly width: number
  readonly height: number
  readonly emphasise: boolean
  readonly focus: boolean
  /** Device pixels per CSS pixel. Sizes snap to it so cells and lines land on whole
   *  device pixels and stay sharp. */
  readonly dpr?: number
}

export interface ChartLayout {
  readonly rows: number
  readonly cols: number
  readonly current: number | null
  /** 'fit' shows the whole chart; 'scroll' sizes cells to the short axis. */
  readonly mode: 'fit' | 'scroll'
  /** The drawn image rows, top to bottom. */
  readonly range: RowRange
  /** The rows drawn taller (empty when emphasis is off). */
  readonly near: RowRange
  /** Cell width, and the height of a row that isn't emphasised. */
  readonly cell: number
  /** Height of each drawn row: heights[i] belongs to image row range.start + i. */
  readonly heights: readonly number[]
  /** yOffsets(heights), relative to the top of the grid. */
  readonly offsets: readonly number[]
  readonly gridWidth: number
  readonly gridHeight: number
  /** The space the grid is shown in: the chart area minus the margins. */
  readonly viewWidth: number
  readonly viewHeight: number
  readonly maxScrollX: number
  readonly maxScrollY: number
}

export function computeLayout(input: LayoutInput): ChartLayout {
  const { rows, cols, current, emphasise, focus } = input
  const dpr = input.dpr && input.dpr > 0 ? input.dpr : 1
  const cur = current !== null && current >= 0 && current < rows ? current : null
  const viewWidth = Math.max(0, input.width - AXIS_LEFT - PAD)
  const viewHeight = Math.max(0, input.height - AXIS_TOP - PAD)
  const range = visibleRows(rows, cur, focus)
  const near = emphasise ? nearRows(rows, cur) : { start: 0, end: 0 }
  const n = range.end - range.start

  // How many base heights the drawn rows add up to.
  let emphasised = 0
  for (let r = Math.max(range.start, near.start); r < Math.min(range.end, near.end); r++) emphasised++
  const weight = n - emphasised + emphasised * EMPHASIS_SCALE

  // Focus mode shows a handful of rows, so it always fits, as on the desktop. Otherwise
  // a long chart is sized to its short axis and scrolls along the long one.
  const mode = !focus && shouldScroll(rows, cols) ? 'scroll' : 'fit'
  let base: number
  if (n === 0 || cols <= 0) base = MIN_CELL
  else if (mode === 'fit') base = Math.min(viewWidth / cols, viewHeight / weight)
  else if (rows > cols) base = viewWidth / cols
  else base = viewHeight / weight
  base = Math.max(MIN_CELL, snap(base, dpr))

  const heights: number[] = []
  for (let r = range.start; r < range.end; r++) heights.push(rowHeight(r, base, near, emphasise, dpr))
  const offsets = yOffsets(heights)
  const gridWidth = base * Math.max(0, cols)
  const gridHeight = offsets[offsets.length - 1]!

  return {
    rows,
    cols,
    current: cur,
    mode,
    range,
    near,
    cell: base,
    heights,
    offsets,
    gridWidth,
    gridHeight,
    viewWidth,
    viewHeight,
    maxScrollX: Math.max(0, gridWidth - viewWidth),
    maxScrollY: Math.max(0, gridHeight - viewHeight),
  }
}

/** Top and bottom of image row `r` in grid coordinates, or null if it isn't drawn. */
export function rowSpan(layout: ChartLayout, r: number): { top: number; bottom: number } | null {
  const i = r - layout.range.start
  if (i < 0 || r >= layout.range.end) return null
  return { top: layout.offsets[i]!, bottom: layout.offsets[i + 1]! }
}

export const clampScroll = (v: number, max: number) => Math.max(0, Math.min(max, v))

/**
 * The vertical scroll offset that keeps the current row in view: centred when the chart
 * scrolls (plan.md §6.3), clamped to the ends. Without a drawn current row, `scrollY` is
 * only clamped.
 */
export function followCurrent(layout: ChartLayout, scrollY: number): number {
  const span = layout.current === null ? null : rowSpan(layout, layout.current)
  if (span === null) return clampScroll(scrollY, layout.maxScrollY)
  const middle = (span.top + span.bottom) / 2
  return clampScroll(middle - layout.viewHeight / 2, layout.maxScrollY)
}

/** Where you are in the current row: its runs in working order (readout.ts `encodeRow`),
 *  the segment being worked, the stitches done in it, and the row's direction. */
export interface RowPlace {
  readonly runs: readonly Pick<Run, 'start_col' | 'count'>[]
  readonly runIndex: number
  readonly stitches: number
  readonly direction: Direction
}

/** The image column of the next stitch to work, or null when the row has none. Out-of-
 *  range indices clamp. `start_col` counts in working order, so on a right-to-left row
 *  it is mirrored, and the stitches move leftwards. */
export function placeColumn(cols: number, place: RowPlace): number | null {
  const { runs } = place
  if (cols <= 0 || runs.length === 0) return null
  const run = runs[Math.max(0, Math.min(runs.length - 1, place.runIndex))]!
  const done = Math.max(0, Math.min(run.count - 1, place.stitches))
  const position = Math.max(0, Math.min(cols - 1, run.start_col + done))
  return place.direction === 'RTL' ? cols - 1 - position : position
}

/** Space kept between your place and the side of the view: three cells, at least 24 px,
 *  and never more than a quarter of the view. */
export const followMargin = (layout: ChartLayout) => Math.min(layout.viewWidth / 4, Math.max(3 * layout.cell, 24))

/**
 * The horizontal scroll offset that keeps your place in the current row in view.
 *
 * - At the start of a row (first segment, no stitches): the side the row starts from,
 *   the left edge for a left-to-right row and the right edge for a right-to-left one.
 * - Otherwise `scrollX` is kept while your place is at least `followMargin` inside the
 *   view, so the chart doesn't move on every stitch. Once it isn't, the view jumps to put
 *   your place a margin in from the side it's working away from, showing as much of the
 *   rest of the row as fits. On a segment wider than the view, that's where its
 *   remaining part starts.
 *
 * A chart that fits across (`maxScrollX` 0) always gets 0. Without a current row or a
 * place, `scrollX` is only clamped.
 */
export function followCurrentX(layout: ChartLayout, place: RowPlace | null, scrollX: number): number {
  const max = layout.maxScrollX
  if (max <= 0) return 0
  const col = layout.current === null || place === null ? null : placeColumn(layout.cols, place)
  if (place === null || col === null) return clampScroll(scrollX, max)
  const ltr = place.direction === 'LTR'
  if (place.runIndex <= 0 && place.stitches <= 0) return ltr ? 0 : max

  const left = col * layout.cell
  const right = left + layout.cell
  const margin = followMargin(layout)
  const from = clampScroll(scrollX, max)
  // At the ends of the chart the scroll stops, so the margin there can't be kept.
  const clearLeft = from <= 0 || left >= from + margin - 1e-6
  const clearRight = from >= max || right <= from + layout.viewWidth - margin + 1e-6
  if (clearLeft && clearRight) return from
  return clampScroll(ltr ? left - margin : right + margin - layout.viewWidth, max)
}

/** Whether all of row `r` is inside the viewport at `scrollY`. */
export function rowInView(layout: ChartLayout, r: number, scrollY: number): boolean {
  const span = rowSpan(layout, r)
  if (span === null) return false
  return span.top >= scrollY - 1e-6 && span.bottom <= scrollY + layout.viewHeight + 1e-6
}

/** Indices into `heights` of the rows that overlap [scrollY, scrollY + viewHeight). */
export function rowsInViewport(layout: ChartLayout, scrollY: number): { from: number; to: number } {
  const { offsets } = layout
  const n = offsets.length - 1
  const top = scrollY
  const bottom = scrollY + layout.viewHeight
  // First row whose bottom is below `top`.
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1]! <= top) lo = mid + 1
    else hi = mid
  }
  let to = lo
  while (to < n && offsets[to]! < bottom) to++
  return { from: lo, to }
}

/** Which axis numbers to draw. Every one on charts of 15 or fewer, otherwise every 5th
 *  plus the first (chart_view.py). `number` is 1-based: the working number for rows,
 *  the column number for columns. */
export function showAxisNumber(number: number, count: number): boolean {
  return count <= 15 || number === 1 || number % 5 === 0
}
