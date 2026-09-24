/**
 * Hand-written `.npy` reader/writer for the one array a `.alpha` file holds: cells.npy,
 * a 2-D uint16 array of palette indices.
 *
 * Format: https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html
 *   magic "\x93NUMPY", major, minor, header length (uint16 LE in v1, uint32 LE in v2/v3),
 *   then an ASCII Python-dict header padded with spaces and ending in '\n'.
 *
 * The writer reproduces numpy's own output byte for byte, header padding included, so a
 * file saved here is indistinguishable from one `np.save` wrote. The reader accepts what
 * `np.save` can produce for a uint16 matrix, including Fortran order and big-endian data,
 * because io.py's `np.load` would too.
 */

export interface U16Matrix {
  rows: number
  cols: number
  /** Row-major (C order), length rows * cols. */
  data: Uint16Array
}

export class NpyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NpyError'
  }
}

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59] // "\x93NUMPY"
const MAGIC_LEN = MAGIC.length + 2 // magic + version bytes
const ARRAY_ALIGN = 64
/** numpy reserves room for the growth axis (axis 0 in C order) to reach this many
 *  digits, so the header can be rewritten in place when the array is appended to. */
const GROWTH_AXIS_MAX_DIGITS = 21

/** Serialise a C-order uint16 matrix exactly as `np.save` does. */
export function writeNpyU16(m: U16Matrix): Uint8Array {
  const { rows, cols, data } = m
  if (data.length !== rows * cols) {
    throw new NpyError(`cells has ${data.length} values, expected ${rows}×${cols}`)
  }
  // numpy: dict keys sorted, each "'key': repr(value), ", then "}".
  let header = `{'descr': '<u2', 'fortran_order': False, 'shape': (${rows}, ${cols}), }`
  header += ' '.repeat(GROWTH_AXIS_MAX_DIGITS - String(rows).length)
  // numpy's _wrap_header: padlen is never 0, so an aligned header gains a full 64 bytes.
  const hlen = header.length + 1 // + trailing '\n'
  const padlen = ARRAY_ALIGN - ((MAGIC_LEN + 2 + hlen) % ARRAY_ALIGN)
  header += ' '.repeat(padlen) + '\n'

  const headerStart = MAGIC_LEN + 2
  const out = new Uint8Array(headerStart + header.length + data.length * 2)
  out.set(MAGIC, 0)
  out[6] = 1 // major
  out[7] = 0 // minor
  const view = new DataView(out.buffer)
  view.setUint16(8, header.length, true)
  for (let i = 0; i < header.length; i++) out[headerStart + i] = header.charCodeAt(i)
  const body = headerStart + header.length
  for (let i = 0; i < data.length; i++) view.setUint16(body + i * 2, data[i]!, true)
  return out
}

/** Parse a `.npy` file holding a 2-D uint16 array into a row-major matrix. */
export function readNpyU16(bytes: Uint8Array): U16Matrix {
  if (bytes.length < MAGIC_LEN + 2 || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new NpyError('cells.npy is not a .npy file')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const major = bytes[6]!
  let headerLen: number
  let headerStart: number
  if (major === 1) {
    headerLen = view.getUint16(8, true)
    headerStart = 10
  } else if (major === 2 || major === 3) {
    headerLen = view.getUint32(8, true)
    headerStart = 12
  } else {
    throw new NpyError(`cells.npy uses unsupported .npy version ${major}.${bytes[7]}`)
  }
  const body = headerStart + headerLen
  if (body > bytes.length) throw new NpyError('cells.npy header is truncated')
  const header = new TextDecoder(major === 3 ? 'utf-8' : 'latin1').decode(
    bytes.subarray(headerStart, body),
  )

  const descr = /'descr':\s*'([^']*)'/.exec(header)?.[1]
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1]
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1]
  if (descr === undefined || fortran === undefined || shape === undefined) {
    throw new NpyError(`cells.npy has an unreadable header: ${header.trim()}`)
  }
  if (descr !== '<u2' && descr !== '>u2') {
    throw new NpyError(`cells.npy holds ${descr}, expected uint16 ('<u2')`)
  }
  const dims = shape
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number)
  if (dims.length !== 2 || !dims.every((d) => Number.isInteger(d) && d >= 0)) {
    throw new NpyError(`cells.npy has shape (${shape}), expected a 2-D array`)
  }
  const [rows, cols] = dims as [number, number]
  const n = rows * cols
  if (bytes.length < body + n * 2) throw new NpyError('cells.npy data is truncated')

  const little = descr === '<u2'
  const data = new Uint16Array(n)
  if (fortran === 'False') {
    for (let i = 0; i < n; i++) data[i] = view.getUint16(body + i * 2, little)
  } else {
    // Column-major on disk: element (r, c) is at c * rows + r.
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        data[r * cols + c] = view.getUint16(body + (c * rows + r) * 2, little)
      }
    }
  }
  return { rows, cols, data }
}
