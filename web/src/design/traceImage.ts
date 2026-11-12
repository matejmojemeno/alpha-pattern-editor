/**
 * An image chosen to trace, made ready to keep in its project (trace.png or trace.jpg
 * in the `.alpha` archive, storage/alpha.ts), and decoded again for drawing.
 *
 * Always re-encoded, as the photo of the finished piece is (app/madePhoto.ts,
 * docs/dev/rules.md#made-photo): only the pixels are kept, so the file's EXIF data
 * (where a photo was taken) never travels in an exported `.alpha` file. The EXIF
 * orientation is applied first, so an upright photo stays upright.
 *
 * PNG first, since a drawing or pixel art is what's most often traced and JPEG would
 * blur its edges; a photo, which PNG keeps at several megabytes, goes to JPEG instead
 * once the PNG passes PNG_LIMIT.
 */
import type { TraceType } from '../storage/alpha.ts'
import { fitWithin } from '../storage/thumbnail.ts'

/** The long edge a kept image is shrunk to, in pixels: as for the photo of the
 *  finished piece. Plenty to trace a pattern of a few hundred stitches across. */
export const TRACE_MAX_EDGE = 2048

/** A PNG bigger than this is kept as a JPEG instead. */
export const PNG_LIMIT = 1_000_000

const JPEG_QUALITY = 0.88

export class TraceImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TraceImageError'
  }
}

/** Whether a dropped or chosen file looks like an image. */
export const isImageFile = (f: { type: string; name: string }) =>
  f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|heic)$/i.test(f.name)

/** The first image among dropped files. */
export const droppedImage = (e: { dataTransfer: DataTransfer }): File | null => [...e.dataTransfer.files].find(isImageFile) ?? null

/** Whether something being dragged over may be a file (its name isn't known until dropped). */
export const draggingFiles = (e: { dataTransfer: DataTransfer }) => [...e.dataTransfer.types].includes('Files')

/** Decode `file`, shrink it to TRACE_MAX_EDGE, and encode it to keep. */
export async function prepareTraceImage(file: Blob): Promise<{ bytes: Uint8Array; type: TraceType; iw: number; ih: number }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new TraceImageError("That file couldn't be opened as an image. Try a PNG or a JPEG.")
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, TRACE_MAX_EDGE)
    let blob = await encode(bitmap, width, height, 'image/png')
    let type: TraceType = 'image/png'
    if (blob.size > PNG_LIMIT) {
      blob = await encode(bitmap, width, height, 'image/jpeg')
      type = 'image/jpeg'
    }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type, iw: width, ih: height }
  } finally {
    bitmap.close()
  }
}

/** The kept bytes, decoded for drawing on the chart. */
export async function decodeTraceImage(bytes: Uint8Array, type: TraceType): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
  } catch {
    throw new TraceImageError("The image to trace couldn't be shown. Add it again.")
  }
}

async function encode(bitmap: ImageBitmap, width: number, height: number, type: TraceType): Promise<Blob> {
  const draw = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
    // JPEG has no transparency: a see-through PNG would otherwise turn black.
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
  }
  const quality = type === 'image/jpeg' ? JPEG_QUALITY : undefined
  const failed = new TraceImageError("This browser can't prepare the image.")
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw failed
    draw(ctx)
    return canvas.convertToBlob({ type, quality })
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw failed
  draw(ctx)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(failed)), type, quality))
}

/** Why an image couldn't be added, in words for the person who tried. */
export const traceErrorText = (e: unknown): string =>
  e instanceof TraceImageError ? e.message : `Couldn't add the image: ${String(e)}`
