import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { DESKTOP_DIR, readArchives } from '../../scripts/alphaFixtures.ts'
import { NpyError, readNpyU16, writeNpyU16 } from '../../src/storage/npy.ts'

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

/** Build a .npy by hand with an arbitrary header, for cases numpy's writer won't give us. */
function npy(header: string, body: number[], { littleEndian = true, major = 1 } = {}): Uint8Array {
  const pre = major === 1 ? 10 : 12
  let h = header
  while ((pre + h.length + 1) % 64) h += ' '
  h += '\n'
  const out = new Uint8Array(pre + h.length + body.length * 2)
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, major, 0])
  const v = new DataView(out.buffer)
  if (major === 1) v.setUint16(8, h.length, true)
  else v.setUint32(8, h.length, true)
  for (let i = 0; i < h.length; i++) out[pre + i] = h.charCodeAt(i)
  body.forEach((x, i) => v.setUint16(pre + h.length + i * 2, x, littleEndian))
  return out
}

describe('writeNpyU16', () => {
  it('reproduces np.save byte for byte for every desktop cells.npy', () => {
    const archives = readArchives(DESKTOP_DIR)
    expect(Object.keys(archives).length).toBeGreaterThan(0)
    for (const [name, bytes] of Object.entries(archives)) {
      const numpyWrote = unzipSync(bytes)['cells.npy']!
      // Buffer.equals, not toEqual: a failing toEqual diffs every byte, which is very slow.
      expect(Buffer.from(writeNpyU16(readNpyU16(numpyWrote))).equals(Buffer.from(numpyWrote)), name).toBe(true)
    }
  })

  it('pads the header like numpy: growth digits, then to a 64-byte boundary', () => {
    const out = writeNpyU16({ rows: 5, cols: 7, data: new Uint16Array(35) })
    const hlen = new DataView(out.buffer).getUint16(8, true)
    expect(hlen).toBe(118) // what numpy 2.5 writes for shape (5, 7)
    expect((10 + hlen) % 64).toBe(0)
    const header = latin1(out.subarray(10, 10 + hlen))
    expect(header).toBe(
      "{'descr': '<u2', 'fortran_order': False, 'shape': (5, 7), }" + ' '.repeat(58) + '\n',
    )
  })

  it('handles empty and large shapes', () => {
    for (const [rows, cols] of [[0, 0], [0, 3], [123456, 2]] as const) {
      const data = Uint16Array.from({ length: rows * cols }, (_, i) => (i * 7919) & 0xffff)
      const out = writeNpyU16({ rows, cols, data })
      expect((10 + new DataView(out.buffer).getUint16(8, true)) % 64).toBe(0)
      const back = readNpyU16(out)
      expect([back.rows, back.cols]).toEqual([rows, cols])
      // Not toEqual: diffing 246,912 values on failure takes minutes.
      expect(Buffer.from(back.data.buffer).equals(Buffer.from(data.buffer))).toBe(true)
    }
  })

  it('stores 0xFFFF and little-endian values intact', () => {
    const data = Uint16Array.from([0, 1, 0x0102, 0xfffe, 0xffff, 42])
    const out = writeNpyU16({ rows: 2, cols: 3, data })
    expect(Array.from(out.subarray(out.length - 12, out.length - 8))).toEqual([0, 0, 1, 0])
    expect(Array.from(out.subarray(out.length - 4))).toEqual([0xff, 0xff, 42, 0])
    expect(readNpyU16(out).data).toEqual(data)
  })

  it('refuses data that does not match the shape', () => {
    expect(() => writeNpyU16({ rows: 2, cols: 2, data: new Uint16Array(3) })).toThrow(NpyError)
  })
})

describe('readNpyU16', () => {
  it('transposes Fortran-order arrays into row-major', () => {
    // np.array([[1, 2, 3], [4, 5, 6]], order='F') is stored column by column.
    const f = npy("{'descr': '<u2', 'fortran_order': True, 'shape': (2, 3), }", [1, 4, 2, 5, 3, 6])
    expect(readNpyU16(f)).toEqual({ rows: 2, cols: 3, data: Uint16Array.from([1, 2, 3, 4, 5, 6]) })
  })

  it('reads big-endian data and v2 headers', () => {
    const be = npy("{'descr': '>u2', 'fortran_order': False, 'shape': (1, 2), }", [0x0102, 0xffff], {
      littleEndian: false,
    })
    expect(readNpyU16(be).data).toEqual(Uint16Array.from([0x0102, 0xffff]))
    const v2 = npy("{'descr': '<u2', 'fortran_order': False, 'shape': (1, 1), }", [9], { major: 2 })
    expect(readNpyU16(v2).data).toEqual(Uint16Array.from([9]))
  })

  it('reads from an unaligned view into a larger buffer', () => {
    const inner = writeNpyU16({ rows: 1, cols: 3, data: Uint16Array.from([7, 8, 9]) })
    const outer = new Uint8Array(inner.length + 3)
    outer.set(inner, 1)
    expect(readNpyU16(outer.subarray(1, 1 + inner.length)).data).toEqual(Uint16Array.from([7, 8, 9]))
  })

  it.each([
    ['not npy at all', new TextEncoder().encode('PK\x03\x04 hello'), /not a \.npy/],
    ['another dtype', npy("{'descr': '<i8', 'fortran_order': False, 'shape': (1, 1), }", [0, 0, 0, 0]), /<i8/],
    ['a 1-D array', npy("{'descr': '<u2', 'fortran_order': False, 'shape': (3,), }", [1, 2, 3]), /2-D/],
    ['a 3-D array', npy("{'descr': '<u2', 'fortran_order': False, 'shape': (1, 1, 1), }", [1]), /2-D/],
    ['truncated data', npy("{'descr': '<u2', 'fortran_order': False, 'shape': (2, 2), }", [1, 2, 3]), /truncated/],
  ])('rejects %s', (_, bytes, message) => {
    expect(() => readNpyU16(bytes)).toThrow(message)
  })
})
