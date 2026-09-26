/**
 * Export PNG (design_window.py `_export_png`): the pattern as a clean chart image, pixel
 * for pixel what the desktop's io.export_pattern_png draws, encoded here in TypeScript
 * (no canvas, no Pyodide; the thumbnails' PNG writer) so it is the same in every
 * browser and testable in Node.
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
import type { Pattern } from '../model/types.ts'
import { encodePngRgba } from '../storage/thumbnail.ts'
import { hexToRgb } from '../theme/contrast.ts'

export const EXPORT_CELL = 16
export const GRID_RGB = [170, 170, 170] as const
export const BACKGROUND_RGB = [200, 200, 200] as const

export interface RgbaImage {
  readonly width: number
  readonly height: number
  /** 4 bytes a pixel, row by row, all opaque. */
  readonly rgba: Uint8Array
}

/** The chart image's pixels, as export_pattern_png draws them. */
export function exportPixels(p: Pick<Pattern, 'rows' | 'cols' | 'cells' | 'palette'>, cell = EXPORT_CELL): RgbaImage {
  const width = p.cols * cell + 1
  const height = p.rows * cell + 1
  const colours = p.palette.map((e) => {
    try {
      return hexToRgb(e.hex)
    } catch {
      return BACKGROUND_RGB
    }
  })
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const r = Math.min(p.rows - 1, Math.floor(y / cell))
    const gridRow = y % cell === 0
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      let c: readonly number[]
      if (gridRow || x % cell === 0) c = GRID_RGB
      else c = colours[p.cells[r * p.cols + Math.floor(x / cell)]!] ?? BACKGROUND_RGB
      rgba[at] = c[0]!
      rgba[at + 1] = c[1]!
      rgba[at + 2] = c[2]!
      rgba[at + 3] = 255
    }
  }
  return { width, height, rgba }
}

/** The file Export PNG saves: "<pattern name>.png", as the desktop's save dialog offers. */
export function exportPng(p: Pattern): { blob: Blob; filename: string } {
  const { width, height, rgba } = exportPixels(p)
  const bytes = encodePngRgba(width, height, rgba)
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), filename: `${p.name}.png` }
}
