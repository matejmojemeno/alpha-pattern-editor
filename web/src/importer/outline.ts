/**
 * Moving the detected grid's outline on the import screen: when detection leaves out rows
 * or columns at a side, dragging that side of the outline takes them in.
 *
 * An edge moves in whole cells at the pitch detection found, so the rows and columns it
 * takes in continue the same lattice, and the count goes up or down by one per cell. The
 * rest is the fast path: the new extent, rows and cols are resampled
 * (bridge.set_params), never detected again. From a detection of only part of a chart,
 * this recovers the whole chart, cell for cell, on the test images (cats, dachshund,
 * monkeys and bug: 0 cells differ, bar one colour merged differently on bug.jpg).
 *
 * Everything is in image pixels, as the bridge's extents are.
 */
import type { Extent } from '../detect/protocol.ts'

/** The outline and how many cells it's divided into. */
export interface Grid {
  extent: Extent
  rows: number
  cols: number
}

export type Edge = 'top' | 'right' | 'bottom' | 'left'
export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
export type Handle = Edge | Corner

export const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left']
export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/** How far past the image's last pixel an edge may land, as a fraction of a cell, and
 *  still count: the image may end mid-gridline. The extent is clamped to the image. */
const OVERHANG = 0.3

/** The edges a handle moves. */
export const edgesOf = (h: Handle): Edge[] => (h.includes('-') ? (h.split('-') as Edge[]) : [h as Edge])

const pitch = (g: Grid) => ({ x: (g.extent.x1 - g.extent.x0) / g.cols, y: (g.extent.y1 - g.extent.y0) / g.rows })

/** The size of the image the extent lives in. */
export interface Bounds {
  width: number
  height: number
}

/**
 * The grid with `edge` moved to whole cells nearest `to` (a coordinate across that edge:
 * x for left and right, y for top and bottom). The opposite edge stays put. At least one
 * cell is kept, and the edge never goes further off the image than OVERHANG allows.
 */
export function moveEdge(g: Grid, edge: Edge, to: number, bounds: Bounds): Grid {
  const horizontal = edge === 'left' || edge === 'right'
  const p = horizontal ? pitch(g).x : pitch(g).y
  if (!(p > 0)) return g
  const e = g.extent
  const limit = (horizontal ? bounds.width : bounds.height) - 1
  // The fixed edge, and which way the moving one grows from it.
  const [fixed, sign] =
    edge === 'left' ? [e.x1, -1] : edge === 'right' ? [e.x0, 1] : edge === 'top' ? [e.y1, -1] : [e.y0, 1]
  const room = sign > 0 ? limit - fixed : fixed
  const most = Math.max(1, Math.floor(room / p + OVERHANG))
  const n = Math.min(most, Math.max(1, Math.round((sign * (to - fixed)) / p)))
  const moved = Math.min(limit, Math.max(0, fixed + sign * n * p))
  const extent =
    edge === 'left'
      ? { ...e, x0: moved }
      : edge === 'right'
        ? { ...e, x1: moved }
        : edge === 'top'
          ? { ...e, y0: moved }
          : { ...e, y1: moved }
  return horizontal ? { ...g, extent, cols: n } : { ...g, extent, rows: n }
}

/** The grid with a handle dragged to `to`: an edge moves across itself, a corner moves
 *  both its edges. */
export function moveHandle(g: Grid, handle: Handle, to: { x: number; y: number }, bounds: Bounds): Grid {
  return edgesOf(handle).reduce(
    (grid, edge) => moveEdge(grid, edge, edge === 'left' || edge === 'right' ? to.x : to.y, bounds),
    g,
  )
}

/** Where an edge is now. */
export function edgeAt(g: Grid, edge: Edge): number {
  const e = g.extent
  return edge === 'left' ? e.x0 : edge === 'right' ? e.x1 : edge === 'top' ? e.y0 : e.y1
}

/** The grid with `edge` moved one cell outward (+1, taking in a row or column) or inward
 *  (−1, leaving one out): the arrow keys. */
export function stepEdge(g: Grid, edge: Edge, by: 1 | -1, bounds: Bounds): Grid {
  const p = edge === 'left' || edge === 'right' ? pitch(g).x : pitch(g).y
  const outward = edge === 'left' || edge === 'top' ? -1 : 1
  return moveEdge(g, edge, edgeAt(g, edge) + outward * by * p, bounds)
}

/** The most cells `edge` could take in, with the opposite edge where it is. */
export function mostCells(g: Grid, edge: Edge, bounds: Bounds): number {
  const far = edge === 'left' || edge === 'top' ? -1e9 : 1e9
  const moved = moveEdge(g, edge, far, bounds)
  return edge === 'left' || edge === 'right' ? moved.cols : moved.rows
}

export const sameGrid = (a: Grid, b: Grid) =>
  a.rows === b.rows &&
  a.cols === b.cols &&
  a.extent.x0 === b.extent.x0 &&
  a.extent.y0 === b.extent.y0 &&
  a.extent.x1 === b.extent.x1 &&
  a.extent.y1 === b.extent.y1

/** The gridlines of a grid: evenly spaced across its extent, as confirm.resample
 *  divides it. */
export function gridLines(g: Grid): { rowLines: number[]; colLines: number[] } {
  const e = g.extent
  const spread = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n)
  return { rowLines: spread(e.y0, e.y1, g.rows), colLines: spread(e.x0, e.x1, g.cols) }
}
