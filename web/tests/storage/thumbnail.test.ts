import { unzlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { SKIP_INDEX } from '../../src/model/types.ts'
import {
  THUMB_MAX_EDGE,
  cellsThumbnailPng,
  encodePngRgba,
  fitWithin,
  makeThumbnail,
  pngSize,
} from '../../src/storage/thumbnail.ts'

/** Decode what encodePngRgba writes (one IDAT, filter 0 on every line) back to RGBA. */
function decode(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let at = 8
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  while (at < png.length) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const data = png.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0])
    }
    if (type === 'IDAT') idat.push(data)
    at += 12 + len
  }
  const raw = unzlibSync(Uint8Array.from(idat.flatMap((d) => [...d])))
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (1 + width * 4)]).toBe(0)
    rgba.set(raw.subarray(y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4)), y * width * 4)
  }
  return { width, height, rgba }
}

const palette = [
  { id: 'r', hex: '#ff0000', name: 'Red', dmc: null, count: 0 },
  { id: 'b', hex: '#0000ff', name: 'Blue', dmc: null, count: 0 },
]

describe('fitWithin', () => {
  it('shrinks the long edge to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 480)).toEqual({ width: 480, height: 360 })
    expect(fitWithin(3000, 4000, 480)).toEqual({ width: 360, height: 480 })
    expect(fitWithin(10_000, 10, 480)).toEqual({ width: 480, height: 1 })
  })

  it('never enlarges', () => {
    expect(fitWithin(24, 18, 480)).toEqual({ width: 24, height: 18 })
  })
})

describe('encodePngRgba', () => {
  it('round-trips pixels and reports its own size', () => {
    const rgba = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i * 37) & 0xff)
    const png = encodePngRgba(3, 2, rgba)
    expect(pngSize(png)).toEqual({ width: 3, height: 2 })
    expect(decode(png)).toEqual({ width: 3, height: 2, rgba })
  })

  it('rejects a buffer of the wrong length', () => {
    expect(() => encodePngRgba(2, 2, new Uint8Array(3))).toThrow(RangeError)
  })
})

describe('pngSize', () => {
  it('returns null for anything that is not a PNG', () => {
    expect(pngSize(new Uint8Array(40))).toBeNull()
    expect(pngSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
})

describe('cellsThumbnailPng', () => {
  it('draws one pixel per cell, row 0 at the top, skipped cells transparent', () => {
    const cells = Uint16Array.from([0, 1, SKIP_INDEX, 1, 0, 0])
    const { width, height, rgba } = decode(cellsThumbnailPng({ cols: 3, rows: 2, cells, palette }))
    expect([width, height]).toEqual([3, 2])
    const px = (x: number, y: number) => [...rgba.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4)]
    expect(px(0, 0)).toEqual([255, 0, 0, 255])
    expect(px(1, 0)).toEqual([0, 0, 255, 255])
    expect(px(2, 0)).toEqual([0, 0, 0, 0])
    expect(px(0, 1)).toEqual([0, 0, 255, 255])
  })

  it('samples patterns larger than the limit down to it', () => {
    const cols = 1000
    const rows = 10
    const cells = new Uint16Array(cols * rows).map((_, i) => ((i % cols) < cols / 2 ? 0 : 1))
    const png = cellsThumbnailPng({ cols, rows, cells, palette })
    expect(pngSize(png)).toEqual({ width: THUMB_MAX_EDGE, height: 5 })
    const { rgba } = decode(png)
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...rgba.subarray((THUMB_MAX_EDGE - 1) * 4, THUMB_MAX_EDGE * 4)]).toEqual([0, 0, 255, 255])
  })
})

describe('makeThumbnail', () => {
  const pattern = { cols: 2, rows: 1, cells: Uint16Array.from([0, 1]), palette }
  const never = () => Promise.reject(new Error('should not be called'))

  it('keeps a small source photo byte for byte', async () => {
    const src = encodePngRgba(24, 18, new Uint8Array(24 * 18 * 4))
    const t = await makeThumbnail(pattern, src, never)
    expect(t.kind).toBe('photo')
    expect(new Uint8Array(await t.blob.arrayBuffer())).toEqual(src)
  })

  it('downscales a large source photo', async () => {
    const src = encodePngRgba(481, 1, new Uint8Array(481 * 4))
    const out = new Blob(['jpeg'])
    const t = await makeThumbnail(pattern, src, async () => out)
    expect(t).toEqual({ blob: out, kind: 'photo' })
  })

  it('draws the cells when there is no source, or it cannot be shrunk', async () => {
    const big = encodePngRgba(481, 1, new Uint8Array(481 * 4))
    for (const t of [await makeThumbnail(pattern, null, never), await makeThumbnail(pattern, big, never)]) {
      expect(t.kind).toBe('cells')
      expect(pngSize(new Uint8Array(await t.blob.arrayBuffer()))).toEqual({ width: 2, height: 1 })
    }
  })
})
