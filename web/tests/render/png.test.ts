/**
 * Export PNG against the desktop: fixtures/png/ holds what io.export_pattern_png made of
 * fixture projects (scripts/gen_png_golden.py); the browser's export must match it
 * pixel for pixel.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { unzlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { newPattern, setCell } from '../../src/logic/edit.ts'
import { SKIP_INDEX } from '../../src/model/types.ts'
import { BACKGROUND_RGB, GRID_RGB, exportPixels, exportPng } from '../../src/render/png.ts'
import { readAlpha } from '../../src/storage/alpha.ts'

const root = resolve(process.cwd(), '..', 'fixtures')

interface RgbImage {
  width: number
  height: number
  rgb: Uint8Array
}

/** RGBA to RGB. */
const rgbOf = (rgba: Uint8Array) => {
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let i = 0; i < rgba.length / 4; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3)
  return rgb
}

/** A minimal PNG decoder for 8-bit RGB (and RGBA, alpha dropped), every filter type. */
function decodePng(bytes: Uint8Array): RgbImage {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let at = 8
  let width = 0
  let height = 0
  let channels = 3
  const idat: Uint8Array[] = []
  while (at < bytes.length) {
    const len = v.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = v.getUint32(at + 8)
      height = v.getUint32(at + 12)
      expect(data[8]).toBe(8)
      expect([2, 6]).toContain(data[9])
      channels = data[9] === 6 ? 4 : 3
      expect(data[12]).toBe(0) // not interlaced
    } else if (type === 'IDAT') idat.push(data)
    at += 12 + len
  }
  const z = new Uint8Array(idat.reduce((n, d) => n + d.length, 0))
  let o = 0
  for (const d of idat) {
    z.set(d, o)
    o += d.length
  }
  const raw = unzlibSync(z)
  const stride = width * channels
  const px = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? px[y * stride + i - channels]! : 0
      const b = y > 0 ? px[(y - 1) * stride + i]! : 0
      const c = y > 0 && i >= channels ? px[(y - 1) * stride + i - channels]! : 0
      let pred = 0
      if (f === 1) pred = a
      else if (f === 2) pred = b
      else if (f === 3) pred = (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[y * stride + i] = (line[i]! + pred) & 0xff
    }
  }
  if (channels === 3) return { width, height, rgb: px }
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) rgb.set(px.subarray(i * 4, i * 4 + 3), i * 3)
  return { width, height, rgb }
}

describe('Export PNG', () => {
  it.each(['basic', 'partial-row', 'unicode', 'with-source'])('matches the desktop’s export of %s.alpha, pixel for pixel', async (name) => {
    const { project } = readAlpha(new Uint8Array(readFileSync(resolve(root, 'alpha/desktop', `${name}.alpha`))))
    const desktop = decodePng(new Uint8Array(readFileSync(resolve(root, 'png', `${name}.png`))))
    const img = exportPixels(project.pattern)
    const ours = { ...img, rgb: rgbOf(img.rgba) }
    expect([...img.rgba.filter((_, i) => i % 4 === 3)].every((a) => a === 255)).toBe(true)
    expect([ours.width, ours.height]).toEqual([desktop.width, desktop.height])
    expect([ours.width, ours.height]).toEqual([project.pattern.cols * 16 + 1, project.pattern.rows * 16 + 1])
    // Not toEqual on the whole array: a mismatch should say where.
    let first = -1
    for (let i = 0; i < ours.rgb.length && first < 0; i++) if (ours.rgb[i] !== desktop.rgb[i]) first = i
    expect(first === -1 ? null : { x: (first / 3) % ours.width | 0, y: (first / 3 / ours.width) | 0 }).toBeNull()
    // And the file saved decodes to the same pixels.
    const back = decodePng(new Uint8Array(await exportPng(project.pattern).blob.arrayBuffer()))
    expect(back.width).toBe(ours.width)
    expect(Buffer.from(back.rgb).equals(Buffer.from(ours.rgb))).toBe(true)
  })

  it('draws skip cells, and indices past the palette, as empty grey cells (the desktop can’t export them)', () => {
    let p = newPattern(2, 1, '#ff0000')
    p = setCell(p, 0, 1, SKIP_INDEX)
    const img = exportPixels(p)
    const pixel = (x: number, y: number) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)]
    expect(pixel(8, 8)).toEqual([255, 0, 0])
    expect(pixel(24, 8)).toEqual([...BACKGROUND_RGB])
    expect(pixel(16, 8)).toEqual([...GRID_RGB])
    expect(pixel(32, 16)).toEqual([...GRID_RGB])
  })

  it('is named after the pattern', async () => {
    const p = { ...newPattern(3, 2, '#000000'), name: 'Fox scarf' }
    const { blob, filename } = exportPng(p)
    expect(filename).toBe('Fox scarf.png')
    expect(blob.type).toBe('image/png')
    const img = decodePng(new Uint8Array(await blob.arrayBuffer()))
    expect([img.width, img.height]).toEqual([49, 33])
  })
})
