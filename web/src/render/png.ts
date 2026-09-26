/**
 * Export PNG (design_window.py `_export_png`): the pattern as a clean chart image, pixel
 * for pixel what the desktop's io.export_pattern_png draws, encoded here in TypeScript
 * (no canvas, no Pyodide) so it is the same in every browser and testable in Node.
 *
 * export_pattern_png draws every cell as a PIL rectangle from (c·16, r·16) to
 * ((c+1)·16, (r+1)·16), both ends included, filled with the cell's colour and outlined
 * in (170, 170, 170), over a (200, 200, 200) background, on an image cols·16 + 1 by
 * rows·16 + 1. Each rectangle's outline overlaps its neighbours', so what comes out is a
 * 1 px grey line on every multiple of 16 and each cell's colour inside, 15 × 15.
 *
 * One difference: the desktop can't export a pattern with SKIP_INDEX cells, or any
 * index past the palette (it raises IndexError). Here those cells show the background
 * grey, as an empty cell.
 */
import { zlibSync } from 'fflate'

import type { Pattern } from '../model/types.ts'
import { hexToRgb } from '../theme/contrast.ts'

export const EXPORT_CELL = 16
export const GRID_RGB = [170, 170, 170] as const
export const BACKGROUND_RGB = [200, 200, 200] as const

export interface RgbImage {
  readonly width: number
  readonly height: number
  /** 3 bytes a pixel, row by row. */
  readonly rgb: Uint8Array
}

/** The chart image's pixels, as export_pattern_png draws them. */
export function exportPixels(p: Pick<Pattern, 'rows' | 'cols' | 'cells' | 'palette'>, cell = EXPORT_CELL): RgbImage {
  const width = p.cols * cell + 1
  const height = p.rows * cell + 1
  const colours = p.palette.map((e) => {
    try {
      return hexToRgb(e.hex)
    } catch {
      return BACKGROUND_RGB
    }
  })
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const r = Math.min(p.rows - 1, Math.floor(y / cell))
    const gridRow = y % cell === 0
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3
      let c: readonly number[]
      if (gridRow || x % cell === 0) c = GRID_RGB
      else c = colours[p.cells[r * p.cols + Math.floor(x / cell)]!] ?? BACKGROUND_RGB
      rgb[at] = c[0]!
      rgb[at + 1] = c[1]!
      rgb[at + 2] = c[2]!
    }
  }
  return { width, height, rgb }
}

// --- PNG ------------------------------------------------------------------------------------

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
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** An 8-bit RGB PNG of `img`, every scanline unfiltered. */
export function encodePng(img: RgbImage): Uint8Array {
  const { width, height, rgb } = img
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const stride = width * 3
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** The file Export PNG saves: "<pattern name>.png", as the desktop's save dialog offers. */
export function exportPng(p: Pattern): { blob: Blob; filename: string } {
  const bytes = encodePng(exportPixels(p))
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), filename: `${p.name}.png` }
}
