/**
 * Pattern edits (§9): a port of alphareader/core/edit.py, which is the spec. Replays
 * fixtures/edit_golden.json (tests/edit.golden.test.ts).
 *
 * Every function is pure and copy-on-write: it returns a new Pattern and never changes
 * its argument, which is what lets undo keep whole patterns (design/history.ts).
 *
 * Structural edits keep row ids stable (§4.5): an existing row keeps its id wherever it
 * moves, and only a row that didn't exist before gets a fresh one. The Work stage's
 * progress is a set of row ids, so that is what keeps it valid across a trip to Design.
 *
 * Unlike the Python, edits leave `updated_at` alone: saving stamps it (repo.save), and a
 * pure function shouldn't read the clock.
 */
import { SKIP_INDEX, type PaletteEntry, type Pattern } from '../model/types.ts'
import { deltaE, hexToLab } from './lab.ts'

export { SKIP_INDEX }

/** What edit.py raises as ValueError: an edit that can't be made, with a message fit to
 *  show the user. */
export class EditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditError'
  }
}

/** What edit.py raises as KeyError: no palette entry has this id. */
export class UnknownEntryError extends Error {
  readonly entryId: string
  constructor(entryId: string) {
    super(`No colour with id ${entryId}.`)
    this.name = 'UnknownEntryError'
    this.entryId = entryId
  }
}

/** A fresh id in the form Python's uuid4().hex gives: 32 lowercase hex digits. */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '')
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

const freshIds = (n: number) => Array.from({ length: n }, newId)

// --- the shared copy ----------------------------------------------------------------------

/** Palette counts for `cells`, as `_recount`: SKIP_INDEX and indices past the palette
 *  count towards nothing. */
export function countCells(cells: Uint16Array, paletteLength: number): number[] {
  const counts = new Array<number>(paletteLength).fill(0)
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i]!
    if (v < paletteLength) counts[v]!++
  }
  return counts
}

interface Changes {
  cells?: Uint16Array
  cols?: number
  palette?: readonly PaletteEntry[]
  row_ids?: readonly string[]
}

/** `_clone`: a new Pattern with fresh palette entry objects and recomputed counts. */
function clone(p: Pattern, changes: Changes = {}): Pattern {
  const cells = changes.cells ?? p.cells.slice()
  const cols = changes.cols ?? p.cols
  const row_ids = [...(changes.row_ids ?? p.row_ids)]
  const rows = row_ids.length
  if (cells.length !== rows * cols) throw new Error(`cells hold ${cells.length} values, not ${rows}×${cols}`)
  const source = changes.palette ?? p.palette
  const counts = countCells(cells, source.length)
  return {
    ...p,
    cols,
    rows,
    row_ids,
    cells,
    palette: source.map((e, i) => ({ id: e.id, hex: e.hex, name: e.name, dmc: e.dmc, count: counts[i]! })),
  }
}

function checkCell(p: Pattern, r: number, c: number): void {
  if (!(Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < p.rows && c >= 0 && c < p.cols)) {
    throw new RangeError(`Cell (${r}, ${c}) is outside the ${p.cols}×${p.rows} pattern.`)
  }
}

// --- cell painting --------------------------------------------------------------------------

export function setCell(p: Pattern, r: number, c: number, paletteIndex: number): Pattern {
  checkCell(p, r, c)
  const cells = p.cells.slice()
  cells[r * p.cols + c] = paletteIndex
  return clone(p, { cells })
}

/** `setCell` over several cells at once, with one copy: what a drag that crosses cells
 *  between two pointer events paints. Not in edit.py; the same as repeated set_cell. */
export function setCells(p: Pattern, at: readonly (readonly [r: number, c: number])[], paletteIndex: number): Pattern {
  const cells = p.cells.slice()
  for (const [r, c] of at) {
    checkCell(p, r, c)
    cells[r * p.cols + c] = paletteIndex
  }
  return clone(p, { cells })
}

/** 4-connected flood fill bounded by the grid. */
export function floodFill(p: Pattern, r: number, c: number, paletteIndex: number): Pattern {
  checkCell(p, r, c)
  const { rows, cols } = p
  const cells = p.cells.slice()
  const target = cells[r * cols + c]!
  if (target === paletteIndex) return clone(p, { cells })
  const stack = [r * cols + c]
  while (stack.length) {
    const i = stack.pop()!
    if (cells[i] !== target) continue
    cells[i] = paletteIndex
    const y = Math.floor(i / cols)
    const x = i - y * cols
    if (y + 1 < rows) stack.push(i + cols)
    if (y > 0) stack.push(i - cols)
    if (x + 1 < cols) stack.push(i + 1)
    if (x > 0) stack.push(i - 1)
  }
  return clone(p, { cells })
}

/** Fill the rectangle between two corner cells, inclusive, given either way round. */
export function fillRect(p: Pattern, r0: number, c0: number, r1: number, c1: number, paletteIndex: number): Pattern {
  checkCell(p, r0, c0)
  checkCell(p, r1, c1)
  const [y0, y1] = r0 <= r1 ? [r0, r1] : [r1, r0]
  const [x0, x1] = c0 <= c1 ? [c0, c1] : [c1, c0]
  const cells = p.cells.slice()
  for (let y = y0; y <= y1; y++) cells.fill(paletteIndex, y * p.cols + x0, y * p.cols + x1 + 1)
  return clone(p, { cells })
}

export function fillRow(p: Pattern, r: number, paletteIndex: number): Pattern {
  checkCell(p, r, 0)
  return fillRect(p, r, 0, r, p.cols - 1, paletteIndex)
}

export function fillColumn(p: Pattern, c: number, paletteIndex: number): Pattern {
  checkCell(p, 0, c)
  return fillRect(p, 0, c, p.rows - 1, c, paletteIndex)
}

// --- structural: borders / insert / delete / trim ---------------------------------------------

/** A grid being reshaped, row-major. `rows` is explicit: a grid can pass through zero
 *  columns (and back) with its rows intact, as a numpy (6, 0) array does. */
interface Grid {
  cells: Uint16Array
  rows: number
  cols: number
}

const gridOf = (p: Pattern): Grid => ({ cells: p.cells, rows: p.rows, cols: p.cols })

/** Rows [from, to). */
function sliceRows(g: Grid, from: number, to: number): Grid {
  return { cells: g.cells.slice(from * g.cols, to * g.cols), rows: to - from, cols: g.cols }
}

/** Columns [from, to). */
function sliceCols(g: Grid, from: number, to: number): Grid {
  const cols = to - from
  const cells = new Uint16Array(g.rows * cols)
  for (let y = 0; y < g.rows; y++) cells.set(g.cells.subarray(y * g.cols + from, y * g.cols + to), y * cols)
  return { cells, rows: g.rows, cols }
}

/** `n` rows of `value` added above (`atTop`) or below. */
function padRows(g: Grid, n: number, value: number, atTop: boolean): Grid {
  const cells = new Uint16Array(g.cells.length + n * g.cols).fill(value)
  cells.set(g.cells, atTop ? n * g.cols : 0)
  return { cells, rows: g.rows + n, cols: g.cols }
}

/** `n` columns of `value` added on the left (`atLeft`) or right. */
function padCols(g: Grid, n: number, value: number, atLeft: boolean): Grid {
  const cols = g.cols + n
  const cells = new Uint16Array(g.rows * cols).fill(value)
  for (let y = 0; y < g.rows; y++) cells.set(g.cells.subarray(y * g.cols, (y + 1) * g.cols), y * cols + (atLeft ? n : 0))
  return { cells, rows: g.rows, cols }
}

export interface Border {
  top?: number
  right?: number
  bottom?: number
  left?: number
  paletteIndex?: number
}

/**
 * Widen (positive) or shrink (negative) each edge. New rows get fresh row ids; existing
 * ids are untouched so progress survives (§9). Removal past an edge stops at nothing
 * left; a pattern left with no rows or no columns is refused.
 */
export function addBorder(p: Pattern, { top = 0, right = 0, bottom = 0, left = 0, paletteIndex = 0 }: Border = {}): Pattern {
  let g = gridOf(p)
  let rowIds = [...p.row_ids]
  if (top > 0) {
    g = padRows(g, top, paletteIndex, true)
    rowIds = [...freshIds(top), ...rowIds]
  } else if (top < 0) {
    const cut = Math.min(-top, g.rows)
    g = sliceRows(g, cut, g.rows)
    rowIds = rowIds.slice(cut)
  }
  if (bottom > 0) {
    g = padRows(g, bottom, paletteIndex, false)
    rowIds = [...rowIds, ...freshIds(bottom)]
  } else if (bottom < 0) {
    const cut = Math.min(-bottom, g.rows)
    g = sliceRows(g, 0, g.rows - cut)
    rowIds = rowIds.slice(0, rowIds.length - cut)
  }
  if (left > 0) g = padCols(g, left, paletteIndex, true)
  else if (left < 0) g = sliceCols(g, Math.min(-left, g.cols), g.cols)
  if (right > 0) g = padCols(g, right, paletteIndex, false)
  else if (right < 0) g = sliceCols(g, 0, g.cols - Math.min(-right, g.cols))
  if (g.rows < 1 || g.cols < 1) throw new EditError('Border removal would leave an empty pattern.')
  return clone(p, { cells: g.cells === p.cells ? p.cells.slice() : g.cells, cols: g.cols, row_ids: rowIds })
}

/** A new row at `at` (0..rows), in one colour, with a fresh id. */
export function insertRow(p: Pattern, at: number, paletteIndex = 0): Pattern {
  if (!(Number.isInteger(at) && at >= 0 && at <= p.rows)) throw new RangeError(`No row position ${at}.`)
  const cells = new Uint16Array(p.cells.length + p.cols).fill(paletteIndex)
  cells.set(p.cells.subarray(0, at * p.cols), 0)
  cells.set(p.cells.subarray(at * p.cols), (at + 1) * p.cols)
  const rowIds = [...p.row_ids]
  rowIds.splice(at, 0, newId())
  return clone(p, { cells, row_ids: rowIds })
}

export function deleteRow(p: Pattern, at: number): Pattern {
  if (p.rows <= 1) throw new EditError('Cannot delete the last row.')
  checkCell(p, at, 0)
  const cells = new Uint16Array(p.cells.length - p.cols)
  cells.set(p.cells.subarray(0, at * p.cols), 0)
  cells.set(p.cells.subarray((at + 1) * p.cols), at * p.cols)
  return clone(p, { cells, row_ids: p.row_ids.filter((_, i) => i !== at) })
}

/** A new column at `at` (0..cols), in one colour. */
export function insertColumn(p: Pattern, at: number, paletteIndex = 0): Pattern {
  if (!(Number.isInteger(at) && at >= 0 && at <= p.cols)) throw new RangeError(`No column position ${at}.`)
  const g = gridOf(p)
  const l = sliceCols(g, 0, at)
  const r = sliceCols(g, at, p.cols)
  const cols = p.cols + 1
  const cells = new Uint16Array(p.rows * cols).fill(paletteIndex)
  for (let y = 0; y < p.rows; y++) {
    cells.set(l.cells.subarray(y * l.cols, (y + 1) * l.cols), y * cols)
    cells.set(r.cells.subarray(y * r.cols, (y + 1) * r.cols), y * cols + at + 1)
  }
  return clone(p, { cells, cols })
}

export function deleteColumn(p: Pattern, at: number): Pattern {
  if (p.cols <= 1) throw new EditError('Cannot delete the last column.')
  checkCell(p, 0, at)
  const cols = p.cols - 1
  const cells = new Uint16Array(p.rows * cols)
  for (let y = 0; y < p.rows; y++) {
    const row = p.cells.subarray(y * p.cols, (y + 1) * p.cols)
    cells.set(row.subarray(0, at), y * cols)
    cells.set(row.subarray(at + 1), y * cols + at)
  }
  return clone(p, { cells, cols })
}

export interface Edges {
  top?: boolean
  right?: boolean
  bottom?: boolean
  left?: boolean
}

/**
 * Remove single-colour rows and columns from the chosen edges, never down to nothing.
 * Only ever on request (§4.1): white margins may be intentional.
 */
export function trimUniformEdges(p: Pattern, { top = false, right = false, bottom = false, left = false }: Edges = {}): Pattern {
  let g = gridOf(p)
  let rowIds = [...p.row_ids]
  const at = (y: number, x: number) => g.cells[y * g.cols + x]!
  const rowUniform = (y: number) => {
    for (let x = 1; x < g.cols; x++) if (at(y, x) !== at(y, 0)) return false
    return true
  }
  // Columns compare with the top cell of the column, as `cells[:, 0] == cells[0, 0]`.
  const colUniform = (x: number) => {
    for (let y = 1; y < g.rows; y++) if (at(y, x) !== at(0, x)) return false
    return true
  }
  if (top) {
    while (g.rows > 1 && rowUniform(0)) {
      g = sliceRows(g, 1, g.rows)
      rowIds = rowIds.slice(1)
    }
  }
  if (bottom) {
    while (g.rows > 1 && rowUniform(g.rows - 1)) {
      g = sliceRows(g, 0, g.rows - 1)
      rowIds = rowIds.slice(0, -1)
    }
  }
  if (left) while (g.cols > 1 && colUniform(0)) g = sliceCols(g, 1, g.cols)
  if (right) while (g.cols > 1 && colUniform(g.cols - 1)) g = sliceCols(g, 0, g.cols - 1)
  return clone(p, { cells: g.cells === p.cells ? p.cells.slice() : g.cells, cols: g.cols, row_ids: rowIds })
}

// --- structural: mirror / rotate --------------------------------------------------------------

/** Left to right. Rows stay where they are. */
export function mirrorH(p: Pattern): Pattern {
  const cells = p.cells.slice()
  for (let y = 0; y < p.rows; y++) cells.subarray(y * p.cols, (y + 1) * p.cols).reverse()
  return clone(p, { cells })
}

/** Top to bottom. Each row keeps its id as it moves. */
export function mirrorV(p: Pattern): Pattern {
  const cells = new Uint16Array(p.cells.length)
  for (let y = 0; y < p.rows; y++) cells.set(p.cells.subarray(y * p.cols, (y + 1) * p.cols), (p.rows - 1 - y) * p.cols)
  return clone(p, { cells, row_ids: [...p.row_ids].reverse() })
}

export function rotate180(p: Pattern): Pattern {
  return clone(p, { cells: p.cells.slice().reverse(), row_ids: [...p.row_ids].reverse() })
}

/** A quarter turn: R rows × C cols become C rows × R cols, as seen with row 0 at the top
 *  (how both charts draw). Clockwise, the top row becomes the right-hand column read top
 *  to bottom: new[i][j] = old[R-1-j][i]. Anticlockwise, the top row becomes the left-hand
 *  column read bottom to top: new[i][j] = old[j][C-1-i]. The old rows no longer exist as
 *  rows, so every row gets a fresh id, as in `scale`: Work-stage progress starts again. */
export function rotate90(p: Pattern, clockwise = true): Pattern {
  const R = p.rows
  const C = p.cols
  const cells = new Uint16Array(R * C)
  // The new pattern has C rows of R cells.
  for (let i = 0; i < C; i++) {
    for (let j = 0; j < R; j++) {
      cells[i * R + j] = clockwise ? p.cells[(R - 1 - j) * C + i]! : p.cells[j * C + (C - 1 - i)]!
    }
  }
  return clone(p, { cells, cols: R, row_ids: freshIds(C) })
}

// --- palette ------------------------------------------------------------------------------------

function indexOf(p: Pattern, entryId: string): number {
  const i = p.palette.findIndex((e) => e.id === entryId)
  if (i < 0) throw new UnknownEntryError(entryId)
  return i
}

/** Change one entry's colour. An unknown id changes nothing. */
export function recolorPaletteEntry(p: Pattern, entryId: string, newHex: string): Pattern {
  return clone(p, { palette: p.palette.map((e) => (e.id === entryId ? { ...e, hex: newHex } : e)) })
}

/** Rename one entry. An unknown id changes nothing. */
export function renamePaletteEntry(p: Pattern, entryId: string, newName: string): Pattern {
  return clone(p, { palette: p.palette.map((e) => (e.id === entryId ? { ...e, name: newName } : e)) })
}

/** A new entry at the end of the palette, with a fresh id and no cells yet. */
export function addPaletteEntry(p: Pattern, hex: string, name = 'New colour'): Pattern {
  return clone(p, { palette: [...p.palette, { id: newId(), hex, name, dmc: null, count: 0 }] })
}

/** Repaint `remove` cells as `replace`, then shift the palette indices above `remove`
 *  down one, as the entry goes. Only indices that name an entry (below `paletteLength`)
 *  move: SKIP_INDEX, and any other index past the palette, is left exactly as it was. */
function removeIndex(cells: Uint16Array, remove: number, replace: number, paletteLength: number): Uint16Array {
  const out = cells.slice()
  for (let i = 0; i < out.length; i++) {
    let v = out[i]!
    if (v === remove) v = replace
    out[i] = v > remove && v < paletteLength ? v - 1 : v
  }
  return out
}

/** Fold `from` into `into`: its cells take `into`'s colour and the entry goes. */
export function mergePaletteEntries(p: Pattern, fromId: string, intoId: string): Pattern {
  const fi = indexOf(p, fromId)
  const ti = indexOf(p, intoId)
  if (fi === ti) return clone(p)
  return clone(p, { cells: removeIndex(p.cells, fi, ti, p.palette.length), palette: p.palette.filter((_, i) => i !== fi) })
}

/** Remove an entry, repainting its cells with `replacement`. */
export function deletePaletteEntry(p: Pattern, entryId: string, replacementId: string): Pattern {
  const di = indexOf(p, entryId)
  const ri = indexOf(p, replacementId)
  if (di === ri) throw new EditError('Replacement colour must differ from the deleted one.')
  return clone(p, { cells: removeIndex(p.cells, di, ri, p.palette.length), palette: p.palette.filter((_, i) => i !== di) })
}

/** The id of the entry perceptually nearest (CIELAB ΔE) to `entryId`; the first of
 *  equally near ones; itself when it is the only entry. */
export function nearestEntryId(p: Pattern, entryId: string): string {
  const di = indexOf(p, entryId)
  const labs = p.palette.map((e) => hexToLab(e.hex))
  let best = di
  let bestD = Infinity
  labs.forEach((lab, i) => {
    if (i === di) return
    const d = deltaE(lab, labs[di]!)
    if (d < bestD) {
      best = i
      bestD = d
    }
  })
  // np.argmin over all-infinite distances gives the first index.
  return p.palette[bestD === Infinity ? 0 : best]!.id
}

/** Remove an entry, repainting its cells with the nearest remaining colour. */
export function deletePaletteEntryNearest(p: Pattern, entryId: string): Pattern {
  if (p.palette.length <= 1) throw new EditError('Cannot remove the only colour.')
  return deletePaletteEntry(p, entryId, nearestEntryId(p, entryId))
}

// --- scaling & sizing -----------------------------------------------------------------------------

/** Integer upscale: every cell becomes a factor × factor block. Every row is new, so
 *  every row gets a fresh id (there is no old place in the pattern to keep). */
export function scale(p: Pattern, factor: number): Pattern {
  const f = Math.trunc(factor)
  if (!(f >= 1)) throw new EditError('Scale factor must be a positive integer.')
  if (f === 1) return clone(p)
  const cols = p.cols * f
  const rows = p.rows * f
  const cells = new Uint16Array(rows * cols)
  for (let y = 0; y < rows; y++) {
    const src = Math.floor(y / f) * p.cols
    for (let x = 0; x < cols; x++) cells[y * cols + x] = p.cells[src + Math.floor(x / f)]!
  }
  return clone(p, { cells, cols, row_ids: freshIds(rows) })
}

/** The most common palette index around the outermost ring of cells (the lowest of
 *  equally common ones): the colour a frame is drawn in. */
export function majorBorderIndex(p: Pattern): number {
  const counts = new Map<number, number>()
  const see = (v: number) => counts.set(v, (counts.get(v) ?? 0) + 1)
  const at = (y: number, x: number) => p.cells[y * p.cols + x]!
  if (p.rows < 2 || p.cols < 2) p.cells.forEach(see)
  else {
    for (let x = 0; x < p.cols; x++) see(at(0, x))
    for (let x = 0; x < p.cols; x++) see(at(p.rows - 1, x))
    for (let y = 1; y < p.rows - 1; y++) see(at(y, 0))
    for (let y = 1; y < p.rows - 1; y++) see(at(y, p.cols - 1))
  }
  let best = -1
  let bestN = -1
  for (const [v, n] of counts) if (n > bestN || (n === bestN && v < best)) [best, bestN] = [v, n]
  return best
}

export interface PadOptions {
  /** The border colour; defaults to the pattern's major border colour. */
  paletteIndex?: number
  /** How many of the added columns go on the left (the rest go right). Default: half. */
  offsetLeft?: number
  /** How many of the added rows go on top (the rest go below). Default: half. */
  offsetTop?: number
}

/**
 * Grow the pattern to targetCols × targetRows by adding a border. Padding only, never
 * cropping, so the artwork is untouched; existing rows keep their ids. The pattern is
 * centred unless offsets place it (each 0 ≤ offset ≤ added).
 */
export function padToSize(p: Pattern, targetCols: number, targetRows: number, opts: PadOptions = {}): Pattern {
  if (targetCols < p.cols || targetRows < p.rows) {
    throw new EditError('Target size must be at least the current size (this only pads).')
  }
  const paletteIndex = opts.paletteIndex ?? majorBorderIndex(p)
  const dc = targetCols - p.cols
  const dr = targetRows - p.rows
  const left = opts.offsetLeft ?? Math.floor(dc / 2)
  const top = opts.offsetTop ?? Math.floor(dr / 2)
  if (!(left >= 0 && left <= dc)) throw new EditError(`Left offset must be between 0 and ${dc}.`)
  if (!(top >= 0 && top <= dr)) throw new EditError(`Top offset must be between 0 and ${dr}.`)
  return addBorder(p, { top, bottom: dr - top, left, right: dc - left, paletteIndex })
}

// --- a new pattern ----------------------------------------------------------------------------------

/** The largest a new pattern can be on either side, as on the import screen. */
export const MAX_SIDE = 999

/**
 * A blank pattern to design from (docs/web-port-plan.md, "Landing screen"): every cell
 * in one colour, a one-entry palette and fresh row ids. `now` is seconds since the
 * epoch, like Python's time.time().
 */
export function newPattern(
  cols: number,
  rows: number,
  hex: string,
  { name = 'New pattern', colourName = 'Background', now = Date.now() / 1000 } = {},
): Pattern {
  for (const [side, n] of [['columns', cols], ['rows', rows]] as const) {
    if (!(Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) throw new EditError(`The number of ${side} must be 1 to ${MAX_SIDE}.`)
  }
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new EditError(`Not a colour: ${hex}`)
  return {
    id: newId(),
    name,
    created_at: now,
    updated_at: now,
    cols,
    rows,
    row_ids: freshIds(rows),
    cells: new Uint16Array(cols * rows),
    palette: [{ id: newId(), hex: hex.toLowerCase(), name: colourName, dmc: null, count: cols * rows }],
    start_direction: 'RTL',
    alternate_direction: true,
    bottom_up: true,
  }
}

/** Whether two patterns would read and save the same. Edits that change nothing return a
 *  new object all the same, so undo uses this to tell. */
export function samePattern(a: Pattern, b: Pattern): boolean {
  if (a === b) return true
  if (a.cols !== b.cols || a.rows !== b.rows || a.name !== b.name) return false
  if (a.start_direction !== b.start_direction || a.alternate_direction !== b.alternate_direction) return false
  if (a.bottom_up !== b.bottom_up) return false
  if (a.row_ids.length !== b.row_ids.length || a.row_ids.some((id, i) => id !== b.row_ids[i])) return false
  if (a.palette.length !== b.palette.length) return false
  for (let i = 0; i < a.palette.length; i++) {
    const x = a.palette[i]!
    const y = b.palette[i]!
    if (x.id !== y.id || x.hex !== y.hex || x.name !== y.name || x.dmc !== y.dmc) return false
  }
  if (a.cells === b.cells) return true
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false
  return true
}
