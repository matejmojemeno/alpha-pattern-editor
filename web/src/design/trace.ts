/**
 * The image to trace: where it lies over the Design chart, and moving and resizing it.
 *
 * Everything is in cells from the grid's top-left corner (fractions allowed), so the
 * image stays over the same cells at any zoom and any scroll. Its height always
 * follows the image's own shape: resizing never stretches it.
 *
 * The image itself, and how it's kept in the project, is storage/alpha.ts `TraceImage`;
 * turning a chosen file into one is design/traceImage.ts.
 */

/** Where the image lies, in cells. Its height is `width × ih / iw`. */
export interface Placement {
  readonly x: number
  readonly y: number
  readonly width: number
}

/** The image's own size in pixels, for its shape. */
export interface ImageSize {
  readonly iw: number
  readonly ih: number
}

/** How strongly a newly added image shows over the cells. */
export const DEFAULT_OPACITY = 0.5
/** Whether a newly added image is shown behind the cells painted. */
export const DEFAULT_BEHIND = true

/** How the image is shown: not at all, behind the cells painted (through the ones still
 *  the background colour), or over every cell. */
export type TraceShow = 'off' | 'behind' | 'over'
/** The faintest and strongest the slider goes: fainter can't be traced; at full
 *  strength the cells under it can't be seen, so painting would be blind. */
export const MIN_OPACITY = 0.1
export const MAX_OPACITY = 0.9
/** The smallest an image can be resized to, in cells across or down. */
export const MIN_TRACE_CELLS = 1

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

export const heightOf = (p: Placement, s: ImageSize): number => (p.width * s.ih) / s.iw

/** The whole image over the whole pattern, as large as fits, centred: nothing of
 *  either is hidden. */
export function fitTrace(cols: number, rows: number, s: ImageSize): Placement {
  const c = Math.max(1, cols)
  const r = Math.max(1, rows)
  const width = Math.min(c, (r * s.iw) / s.ih)
  const height = (width * s.ih) / s.iw
  return { x: (c - width) / 2, y: (r - height) / 2, width }
}

/** Moved by (dx, dy) cells. */
export const moveTrace = (p: Placement, dx: number, dy: number): Placement => ({ ...p, x: p.x + dx, y: p.y + dy })

/** The four corners, in cells. */
export function corners(p: Placement, s: ImageSize): Record<Corner, { x: number; y: number }> {
  const h = heightOf(p, s)
  return {
    nw: { x: p.x, y: p.y },
    ne: { x: p.x + p.width, y: p.y },
    sw: { x: p.x, y: p.y + h },
    se: { x: p.x + p.width, y: p.y + h },
  }
}

const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }

/**
 * Resized by dragging `corner` to the point (px, py), in cells, the opposite corner
 * staying put and the shape kept. The size is whichever of the two directions the
 * pointer has gone further in, so the corner follows the pointer along the image's
 * diagonal, and never less than MIN_TRACE_CELLS on its shorter side. A pointer dragged
 * past the opposite corner stops it there rather than turning the image inside out.
 */
export function resizeTrace(p: Placement, s: ImageSize, corner: Corner, px: number, py: number): Placement {
  const anchor = corners(p, s)[OPPOSITE[corner]]
  const west = corner === 'nw' || corner === 'sw'
  const north = corner === 'nw' || corner === 'ne'
  const dx = Math.max(0, west ? anchor.x - px : px - anchor.x)
  const dy = Math.max(0, north ? anchor.y - py : py - anchor.y)
  const least = MIN_TRACE_CELLS * Math.max(1, s.iw / s.ih)
  const width = Math.max(least, dx, (dy * s.iw) / s.ih)
  const height = (width * s.ih) / s.iw
  return { x: west ? anchor.x - width : anchor.x, y: north ? anchor.y - height : anchor.y, width }
}

/**
 * The corner handle at a point, if any. `x` and `y` are in cells, `reach` is how far
 * from a corner still counts, in cells (the handle's size on screen over the zoom).
 * The nearest corner wins where two are close, on a tiny image.
 */
export function handleAt(p: Placement, s: ImageSize, x: number, y: number, reach: number): Corner | null {
  let best: Corner | null = null
  let bestD = Infinity
  for (const [k, c] of Object.entries(corners(p, s)) as [Corner, { x: number; y: number }][]) {
    const d = Math.max(Math.abs(c.x - x), Math.abs(c.y - y))
    if (d <= reach && d < bestD) {
      best = k
      bestD = d
    }
  }
  return best
}

/** The cursor for resizing from a corner. */
export const CORNER_CURSOR: Record<Corner, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }

export const clampOpacity = (v: number): number => Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, v))
