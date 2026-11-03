/**
 * A photo of the finished piece, made ready to keep in its project (made.jpg in the
 * `.alpha` archive, storage/alpha.ts).
 *
 * The photo is always re-encoded, however small it already is:
 * - a phone photo is 3–12 MB; at MADE_PHOTO_MAX_EDGE on its long edge it's a few
 *   hundred KB, plenty to show it full-screen, and the archive is the only backup;
 * - re-encoding keeps only the pixels, so the EXIF data goes, including where the photo
 *   was taken, which an exported `.alpha` file would otherwise carry to anyone it's
 *   shared with (docs/dev/rules.md#made-photo);
 * - the EXIF orientation is applied first, so a photo taken upright stays upright.
 *
 * Unlike importing a chart (importer/decode.ts), colour profiles are converted as usual:
 * this photo is only ever looked at.
 */
import { fitWithin } from '../storage/thumbnail.ts'

/** The long edge a kept photo is shrunk to, in pixels. */
export const MADE_PHOTO_MAX_EDGE = 2048

/** JPEG quality, as for Library thumbnails (storage/thumbnail.ts). */
const QUALITY = 0.85

/** What the file pickers ask for. Any image the browser can decode works. */
export const MADE_PHOTO_ACCEPT = 'image/*'

export class MadePhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MadePhotoError'
  }
}

/** Decode `file`, shrink it to MADE_PHOTO_MAX_EDGE, and encode it as a JPEG. */
export async function prepareMadePhoto(file: Blob): Promise<Uint8Array> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new MadePhotoError("That file couldn't be opened as a photo. Try a JPEG or PNG.")
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MADE_PHOTO_MAX_EDGE)
    const blob = await encodeJpeg(bitmap, width, height)
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

async function encodeJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const draw = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
    // JPEG has no transparency: a see-through PNG would otherwise turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new MadePhotoError("This browser can't resize the photo.")
    draw(ctx)
    return canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new MadePhotoError("This browser can't resize the photo.")
  draw(ctx)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new MadePhotoError("This browser can't resize the photo."))), 'image/jpeg', QUALITY),
  )
}

/** Why a photo couldn't be added or removed, in words for the person who tried. */
export function madePhotoErrorText(e: unknown): string {
  return e instanceof MadePhotoError ? e.message : `Couldn't save the photo: ${String(e)}`
}

/** made.jpg bytes as a Blob an <img> can show. */
export const madePhotoBlob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })
