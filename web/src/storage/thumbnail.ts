/**
 * Library thumbnails, made once at save/import time and kept in the summaries store, so
 * listing the Library never loads a full-size photo.
 *
 *   photo  the project's source.png, downscaled to at most THUMB_MAX_EDGE on its long
 *          edge. A source already that small is kept byte-for-byte.
 *   cells  the pattern's own cells, one pixel per cell (skipped cells transparent). The
 *          Library scales it up with `image-rendering: pixelated`. Used when there is no
 *          source image, or when the photo can't be decoded here.
 *
 * The cells PNG is encoded in plain TypeScript (fflate does the deflate), so it needs no
 * canvas and is identical everywhere. Only the photo path touches the DOM.
 */
import { zlibSync } from 'fflate'

import { SKIP_INDEX, type Pattern } from '../model/types.ts'

export const THUMB_MAX_EDGE = 480

export type ThumbnailKind = 'photo' | 'cells'

export interface Thumbnail {
  blob: Blob
  kind: ThumbnailKind
}

/** Shrink an encoded image so neither edge exceeds `maxEdge`; returns the new file. */
export type Downscaler = (image: Uint8Array, maxEdge: number) => Promise<Blob>

/** Width and height from a PNG's IHDR chunk, or null if `bytes` isn't a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Scale (w, h) down, keeping its aspect ratio, so the long edge is at most `maxEdge`. */
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

// --- PNG encoding ------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Encode 8-bit RGBA pixels (row-major, `width * height * 4` bytes) as a PNG. */
export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) throw new RangeError('rgba length does not match width × height')
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit, RGBA, deflate, adaptive filtering, no interlace
  // Filter type 0 (None) before each scanline.
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1)
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// --- the two kinds -------------------------------------------------------------------------

/** The pattern's cells as a PNG, one pixel per cell, at most THUMB_MAX_EDGE on the long
 *  edge (larger patterns are sampled nearest-neighbour). Skipped cells are transparent. */
export function cellsThumbnailPng(p: Pick<Pattern, 'cols' | 'rows' | 'cells' | 'palette'>): Uint8Array {
  const { width, height } = fitWithin(p.cols, p.rows, THUMB_MAX_EDGE)
  const colours = p.palette.map((e) => {
    const n = parseInt(e.hex.slice(1), 16)
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255] as const
  })
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const r = Math.floor((y * p.rows) / height)
    for (let x = 0; x < width; x++) {
      const c = Math.floor((x * p.cols) / width)
      const idx = p.cells[r * p.cols + c]!
      const rgbaOf = idx === SKIP_INDEX ? undefined : colours[idx]
      if (rgbaOf) rgba.set(rgbaOf, (y * width + x) * 4)
    }
  }
  return encodePngRgba(width, height, rgba)
}

const png = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })

/**
 * The thumbnail for a project: its photo when it has one we can use, else its cells.
 * Never stores a full-size photo: if a large source can't be downscaled (no canvas, or
 * an image the browser can't decode), the cells are used instead.
 */
export async function makeThumbnail(
  pattern: Pick<Pattern, 'cols' | 'rows' | 'cells' | 'palette'>,
  sourcePng: Uint8Array | null,
  downscale: Downscaler = canvasDownscale,
): Promise<Thumbnail> {
  if (sourcePng) {
    const size = pngSize(sourcePng)
    if (size && Math.max(size.width, size.height) <= THUMB_MAX_EDGE) return { blob: png(sourcePng), kind: 'photo' }
    try {
      return { blob: await downscale(sourcePng, THUMB_MAX_EDGE), kind: 'photo' }
    } catch {
      // Fall through to the cells.
    }
  }
  return { blob: png(cellsThumbnailPng(pattern)), kind: 'cells' }
}

/** The browser's downscaler: decode, draw smaller, re-encode as JPEG (photos compress far
 *  better that way than as PNG). Throws where there is no canvas, as in Node. */
export async function canvasDownscale(image: Uint8Array, maxEdge: number): Promise<Blob> {
  const bitmap = await createImageBitmap(new Blob([image as Uint8Array<ArrayBuffer>]))
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No 2D context')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, width, height)
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No 2D context')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85),
    )
  } finally {
    bitmap.close()
  }
}
