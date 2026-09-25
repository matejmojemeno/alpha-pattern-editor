/**
 * Where an image sits when it's fitted, letterboxed, into a box, and how a point on the
 * screen maps back into the image's pixels: a port of source_view.py (`_draw_rect`,
 * `_widget_to_image` and the crop rubber-band's release).
 *
 * "Image pixels" are the pixels of the image as the browser decoded it (Preview's
 * imageWidth × imageHeight). Detection may have run on a shrunk copy, but the bridge
 * speaks in the image's own pixels both ways, so nothing here needs to know.
 */
import type { Crop } from '../detect/protocol.ts'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** The image's rectangle inside a `boxWidth` × `boxHeight` box: as large as fits, aspect
 *  kept, centred. Whole pixels, as source_view.py's `_draw_rect` does. */
export function fitRect(boxWidth: number, boxHeight: number, imageWidth: number, imageHeight: number): Rect {
  if (boxWidth <= 0 || boxHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight)
  const width = Math.floor(imageWidth * scale)
  const height = Math.floor(imageHeight * scale)
  return { x: Math.floor((boxWidth - width) / 2), y: Math.floor((boxHeight - height) / 2), width, height }
}

/** The image pixel under a point in the box, clamped to the image's edges (a point in
 *  the letterbox maps to the nearest edge). */
export function toImage(p: Point, fit: Rect, imageWidth: number, imageHeight: number): Point {
  if (fit.width <= 0 || fit.height <= 0) return { x: 0, y: 0 }
  const fx = Math.min(Math.max((p.x - fit.x) / fit.width, 0), 1)
  const fy = Math.min(Math.max((p.y - fit.y) / fit.height, 0), 1)
  return { x: Math.floor(fx * imageWidth), y: Math.floor(fy * imageHeight) }
}

/** Where an image pixel coordinate lands in the box (the inverse of toImage). */
export function toBox(p: Point, fit: Rect, imageWidth: number, imageHeight: number): Point {
  return { x: fit.x + (p.x / imageWidth) * fit.width, y: fit.y + (p.y / imageHeight) * fit.height }
}

/** A drag smaller than this, on screen or in the image, is a slip, not a crop
 *  (source_view.py). */
export const MIN_CROP = 8

/** The crop a rubber-band drag from `a` to `b` (box coordinates) asks for, in image
 *  pixels, or null if it's too small to mean one. */
export function cropFromDrag(a: Point, b: Point, fit: Rect, imageWidth: number, imageHeight: number): Crop | null {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  if (x1 - x0 < MIN_CROP || y1 - y0 < MIN_CROP) return null
  const tl = toImage({ x: x0, y: y0 }, fit, imageWidth, imageHeight)
  const br = toImage({ x: x1, y: y1 }, fit, imageWidth, imageHeight)
  if (br.x - tl.x < MIN_CROP || br.y - tl.y < MIN_CROP) return null
  return [tl.x, tl.y, br.x, br.y]
}
