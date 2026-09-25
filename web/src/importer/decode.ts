/**
 * Turning an image file into what detection reads, and into the `source.png` a project
 * keeps. The browser decodes; Python never sees an encoded image (docs/web-port-plan.md,
 * "Pillow isn't needed in the browser").
 *
 * Decoding matches the desktop's Pillow as closely as a canvas allows:
 * - colour profiles are ignored (`colorSpaceConversion: 'none'`), as Pillow ignores them;
 * - alpha is not premultiplied into the colours, and bridge.py drops it, as Pillow's
 *   convert("RGB") does. A canvas still loses the colour of fully transparent pixels;
 *   charts are opaque in practice (all the PNGs in test_images/ are).
 * - PNG decoding is exact, so a PNG gives the desktop's pixels bit for bit. JPEG decoders
 *   differ slightly between browsers and libjpeg.
 * - The EXIF orientation is applied, which Pillow doesn't do: a phone photo taken upright
 *   is detected upright.
 */
import type { RgbaImage } from '../detect/client.ts'

/** iOS Safari refuses canvases larger than this (4096 × 4096). */
export const MAX_CANVAS_PIXELS = 16_777_216

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

/** The size to decode at: the image's own, unless it's too big for a canvas. */
export function decodeSize(width: number, height: number, maxPixels = MAX_CANVAS_PIXELS): { width: number; height: number } {
  if (width * height <= maxPixels) return { width, height }
  const s = Math.sqrt(maxPixels / (width * height))
  return { width: Math.max(1, Math.floor(width * s)), height: Math.max(1, Math.floor(height * s)) }
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function canvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

async function bitmapOf(file: Blob): Promise<ImageBitmap> {
  const opts: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'from-image' }
  const bitmap = await createImageBitmap(file, opts)
  const size = decodeSize(bitmap.width, bitmap.height)
  if (size.width === bitmap.width && size.height === bitmap.height) return bitmap
  bitmap.close()
  return createImageBitmap(file, { ...opts, resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' })
}

function draw(bitmap: ImageBitmap): { c: HTMLCanvasElement | OffscreenCanvas; ctx: Canvas2D } {
  const c = canvas(bitmap.width, bitmap.height)
  const ctx = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' }) as Canvas2D | null
  if (!ctx) throw new Error("This browser can't draw the image.")
  ctx.drawImage(bitmap, 0, 0)
  return { c, ctx }
}

export class ImageDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageDecodeError'
  }
}

/** The image's pixels, RGBA, row-major. */
export async function decodeImage(file: Blob): Promise<RgbaImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await bitmapOf(file)
  } catch {
    throw new ImageDecodeError("This file couldn't be read as an image. It may be damaged, or in a format this browser can't open.")
  }
  try {
    const { ctx } = draw(bitmap)
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' })
    return { rgba: new Uint8Array(data.data.buffer), width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

/** The bytes to keep as the project's source.png: a PNG's own bytes, anything else
 *  re-encoded as PNG at its full decoded size. */
export async function sourcePng(file: Blob): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isPng(bytes)) return bytes
  const bitmap = await bitmapOf(file)
  try {
    const { c } = draw(bitmap)
    const blob =
      'convertToBlob' in c
        ? await c.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob>((resolve, reject) =>
            c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image as PNG."))), 'image/png'),
          )
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
