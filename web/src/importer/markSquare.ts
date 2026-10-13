/**
 * The geometry of "Mark one square" (ui/import/MarkSquare.tsx): the whole image shown
 * zoomed in a view that pans and zooms, with a box the person moves and resizes onto one
 * square. Everything is in the image's own pixels (as letterbox.ts's), not rounded,
 * except a view, which maps them onto the screen.
 */
import type { Square } from '../detect/protocol.ts'
import type { Grid } from './outline.ts'

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Where the image is on the screen: screen = (x, y) + image point × scale. */
export interface View {
  scale: number
  x: number
  y: number
}

/** A box smaller than this, in image pixels, on either side isn't a square: the smallest
 *  square detection reads is 6 (bridge.mark_square searches from about 4). */
export const MIN_SQUARE = 3
/** The most a view zooms: an image pixel this many screen pixels wide. */
export const MAX_SCALE = 40
/** How big the box starts on the screen, in CSS pixels: big enough to grab inside and
 *  by its corners with a finger, and small enough to see the squares around it. */
export const START_BOX = 72

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** The whole image, as large as fits the stage, centred. */
export function fitView(stage: Size, image: Size): View {
  if (stage.width <= 0 || stage.height <= 0 || image.width <= 0 || image.height <= 0) return { scale: 1, x: 0, y: 0 }
  const scale = Math.min(stage.width / image.width, stage.height / image.height)
  return { scale, x: (stage.width - image.width * scale) / 2, y: (stage.height - image.height * scale) / 2 }
}

/** The least and most a view can zoom: from the whole image to MAX_SCALE (or the whole
 *  image, for one already shown that big). */
export function scaleRange(stage: Size, image: Size): [number, number] {
  const least = fitView(stage, image).scale
  return [least, Math.max(least, MAX_SCALE)]
}

/** A view kept on the image: the image always reaches the middle of the stage, so its
 *  edges come in at most that far. Any square can then be brought to the middle, and
 *  zooming about a point on the image never slides that point away (keeping a small image
 *  centred, or inside the stage, did, once it grew to an edge). The scale is kept in
 *  scaleRange. */
export function clampView(view: View, stage: Size, image: Size): View {
  const [least, most] = scaleRange(stage, image)
  const scale = clamp(view.scale, least, most)
  const axis = (at: number, room: number, length: number) => clamp(at, room / 2 - length * scale, room / 2)
  return { scale, x: axis(view.x, stage.width, image.width), y: axis(view.y, stage.height, image.height) }
}

/** The view zoomed by `ratio` about `at` (a point on the stage), which stays where it is
 *  unless the view's limits move it. */
export function zoomAbout(view: View, ratio: number, at: Point, stage: Size, image: Size): View {
  const [least, most] = scaleRange(stage, image)
  const scale = clamp(view.scale * ratio, least, most)
  const k = scale / view.scale
  return clampView({ scale, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k }, stage, image)
}

/** The view moved by (dx, dy) screen pixels. */
export function panBy(view: View, dx: number, dy: number, stage: Size, image: Size): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, stage, image)
}

/** The image point under a point on the stage. */
export function toImagePoint(p: Point, view: View): Point {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale }
}

/** Where an image point is on the stage. */
export function toStage(p: Point, view: View): Point {
  return { x: view.x + p.x * view.scale, y: view.y + p.y * view.scale }
}

/**
 * Where the box starts: on the middle square of the grid read, if there is one (on a
 * grid read at the wrong size that's two squares wide or half of one, and the person
 * fixes it), otherwise a twentieth of the image's shorter side, in its middle.
 */
export function startSquare(grid: Grid | null, image: Size): Square {
  if (grid && grid.cols > 0 && grid.rows > 0) {
    const e = grid.extent
    const w = (e.x1 - e.x0) / grid.cols
    const h = (e.y1 - e.y0) / grid.rows
    if (w >= MIN_SQUARE && h >= MIN_SQUARE) {
      const x = e.x0 + Math.floor(grid.cols / 2) * w
      const y = e.y0 + Math.floor(grid.rows / 2) * h
      return [x, y, x + w, y + h]
    }
  }
  const side = Math.min(Math.max(MIN_SQUARE, Math.min(image.width, image.height) / 20), image.width, image.height)
  const x = (image.width - side) / 2
  const y = (image.height - side) / 2
  return [x, y, x + side, y + side]
}

/** The view a square starts in: zoomed so it's START_BOX across on the stage (within the
 *  view's limits), and centred on it. */
export function startView(square: Square, stage: Size, image: Size): View {
  const [x0, y0, x1, y1] = square
  const side = Math.max(x1 - x0, y1 - y0, 1e-9)
  const [least, most] = scaleRange(stage, image)
  const scale = clamp(START_BOX / side, least, most)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return clampView({ scale, x: stage.width / 2 - cx * scale, y: stage.height / 2 - cy * scale }, stage, image)
}

/** The square moved by (dx, dy) image pixels, kept inside the image. */
export function moveSquare(square: Square, dx: number, dy: number, image: Size): Square {
  const [x0, y0, x1, y1] = square
  const ox = clamp(dx, -x0, image.width - x1)
  const oy = clamp(dy, -y0, image.height - y1)
  return [x0 + ox, y0 + oy, x1 + ox, y1 + oy]
}

/** The square with its centre moved to `at` (an image point), kept inside the image. */
export function centreSquareAt(square: Square, at: Point, image: Size): Square {
  const [x0, y0, x1, y1] = square
  return moveSquare(square, at.x - (x0 + x1) / 2, at.y - (y0 + y1) / 2, image)
}

/** The square with one corner dragged to `to` (an image point) and the opposite corner
 *  kept: inside the image, at least MIN_SQUARE on each side, never turned inside out. */
export function dragCorner(square: Square, corner: Corner, to: Point, image: Size): Square {
  let [x0, y0, x1, y1] = square
  const [v, h] = corner.split('-')
  if (h === 'left') x0 = clamp(to.x, 0, x1 - MIN_SQUARE)
  else x1 = clamp(to.x, x0 + MIN_SQUARE, image.width)
  if (v === 'top') y0 = clamp(to.y, 0, y1 - MIN_SQUARE)
  else y1 = clamp(to.y, y0 + MIN_SQUARE, image.height)
  return [x0, y0, x1, y1]
}

/** The square with its right and bottom edges moved by (dw, dh) image pixels: the
 *  keyboard's Shift+arrows. */
export function growSquare(square: Square, dw: number, dh: number, image: Size): Square {
  const [x0, y0, x1, y1] = square
  return [x0, y0, clamp(x1 + dw, x0 + MIN_SQUARE, image.width), clamp(y1 + dh, y0 + MIN_SQUARE, image.height)]
}
