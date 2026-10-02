/**
 * The Work stage's Export PNG: the chart as the Work stage draws it (`drawChart`), with
 * the stitch numbers and the strands to carry when they're switched on, the row numbers
 * in working order and the column numbers, but nothing about progress. A picture is
 * kept, printed or shared long after the place it would show has moved on, so no row is
 * outlined, washed as done or drawn taller, and focus mode doesn't narrow it.
 *
 * It is always drawn in the light page colours, whatever the app's theme, so the same
 * pattern gives the same picture. Design's Export PNG (render/png.ts) is the plain chart,
 * pixel for pixel the desktop's; this one is web only.
 */
import type { Carry } from '../logic/carry.ts'
import type { Pattern } from '../model/types.ts'
import { buildCellImage, drawChart, type ChartColors } from './chart.ts'
import { AXIS_LEFT, AXIS_TOP, PAD, computeLayout, type ChartLayout } from './layout.ts'

/** A cell's side, in pixels: room for a two-digit stitch number at a readable size. */
export const CHART_PNG_CELL = 24
/** The smallest cell a big chart is shrunk to so it stays within `CHART_PNG_MAX_AREA`. */
export const CHART_PNG_MIN_CELL = 8
/** The most pixels the image may have: Safari won't make a canvas bigger than this. */
export const CHART_PNG_MAX_AREA = 16_000_000

/** The light theme's colours (theme/tokens.css): white page, near-black text, and the
 *  axis grey `color-mix(in srgb, --text, --bg 42%)` works out to. */
export const CHART_PNG_COLORS: ChartColors = {
  background: '#ffffff',
  text: '#1d1d1f',
  axis: '#7c7c7d',
  accent: '#f0a800',
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
}

/** The cell size for a chart `rows` × `cols`: `CHART_PNG_CELL`, or smaller for a chart
 *  that would otherwise pass `CHART_PNG_MAX_AREA`, but never below the minimum. */
export function chartPngCell(rows: number, cols: number): number {
  const fits = (cell: number) => (AXIS_LEFT + PAD + cols * cell) * (AXIS_TOP + PAD + rows * cell) <= CHART_PNG_MAX_AREA
  let cell = CHART_PNG_CELL
  while (cell > CHART_PNG_MIN_CELL && !fits(cell)) cell--
  return cell
}

/** The whole chart, every row the same height, nothing current: the layout the picture
 *  is drawn on, and the image's size. */
export function chartPngLayout(rows: number, cols: number, cell = chartPngCell(rows, cols)): { layout: ChartLayout; width: number; height: number } {
  const width = AXIS_LEFT + PAD + cols * cell
  const height = AXIS_TOP + PAD + rows * cell
  const layout = computeLayout({ rows, cols, current: null, width, height, emphasise: false, focus: false })
  return { layout, width, height }
}

export interface ChartPngOptions {
  /** Number each stitch within its run of one colour. */
  numbers: boolean
  /** The strands to carry, per image row (logic/carry.ts), or none. */
  carries: readonly (readonly Carry[])[] | null
}

/** The picture, as a PNG file named after the pattern. Needs a browser canvas. */
export async function exportChartPng(p: Pattern, options: ChartPngOptions): Promise<{ blob: Blob; filename: string }> {
  const { layout, width, height } = chartPngLayout(p.rows, p.cols)
  const image = buildCellImage(p)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!image || !ctx) throw new Error('This browser cannot draw the chart as a picture.')
  drawChart(ctx, {
    layout,
    image,
    pattern: p,
    completed: new Set(),
    place: null,
    carries: options.carries,
    numbers: options.numbers,
    scrollX: 0,
    scrollY: 0,
    width,
    height,
    dpr: 1,
    colors: CHART_PNG_COLORS,
  })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('This browser cannot save the chart as a picture.')
  return { blob, filename: `${p.name}.png` }
}
