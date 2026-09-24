/**
 * Row readout: run-length encoding with direction resolution (§10, §4.4).
 * Port of alphareader/core/readout.py, which is the spec.
 *
 * Work turns at the end of each row (row 1 L→R, row 2 R→L, ...), so a readout that
 * always read left-to-right would be mirrored on every even row. Direction is modelled
 * explicitly and the row is reversed before encoding when it resolves to RTL.
 */
import { SKIP_INDEX, type Direction, type Pattern, type Run } from '../model/types.ts'

/** 0-based position of image row `r` in working order. Bottom-up means the last image
 *  row is worked first (§4.4). */
export function workingPosition(p: Pattern, r: number): number {
  return p.bottom_up ? p.rows - 1 - r : r
}

/** 1-based row number as the maker counts it (1 = first row worked). */
export function workingNumber(p: Pattern, r: number): number {
  return workingPosition(p, r) + 1
}

/** Working direction of row `r`, honouring start_direction and alternation (§4.4).
 *  Alternation is keyed to the working position, not the image row. */
export function rowDirection(p: Pattern, r: number): Direction {
  if (!p.alternate_direction) return p.start_direction
  // Python's % is floored; this matches it for negative positions too.
  if (pyMod(workingPosition(p, r), 2) === 0) return p.start_direction
  return p.start_direction === 'LTR' ? 'RTL' : 'LTR'
}

/** Run-length encode row `r` in working order (reversed for RTL rows). */
export function encodeRow(p: Pattern, r: number): Run[] {
  let row: Uint16Array = p.cells.subarray(r * p.cols, (r + 1) * p.cols)
  if (rowDirection(p, r) === 'RTL') row = row.slice().reverse()
  const runs: Run[] = []
  let start = 0
  for (let i = 1; i <= row.length; i++) {
    if (i === row.length || row[i] !== row[start]) {
      runs.push({ palette_index: row[start]!, count: i - start, start_col: start })
      start = i
    }
  }
  return runs
}

function label(p: Pattern, paletteIndex: number): string {
  if (paletteIndex === SKIP_INDEX) return 'skip'
  if (paletteIndex >= 0 && paletteIndex < p.palette.length) return p.palette[paletteIndex]!.name
  return `#${paletteIndex}`
}

function initial(name: string): string {
  // Python's name[0] is the first code point, not the first UTF-16 unit.
  const first = name.codePointAt(0)
  return first === undefined ? '?' : String.fromCodePoint(first).toUpperCase()
}

/** The one-line size summary shown on the import and design screens.
 *
 *  'strings' is the number of vertical strands an alpha pattern needs — one more than
 *  the stitch count across. */
export function formatStats(cols: number, rows: number, paletteLen: number): string {
  return (
    `${cols} cols × ${rows} rows   ·   ${rows * cols} stitches   ·   ` +
    `${paletteLen} colours   ·   ${cols + 1} strings needed`
  )
}

/** e.g. '1 Brown, 3 White, 5 Brown, 1 White'. */
export function formatRowText(p: Pattern, r: number): string {
  return encodeRow(p, r)
    .map((run) => `${run.count} ${label(p, run.palette_index)}`)
    .join(', ')
}

/** e.g. '1B 3W 5B 1W'. */
export function formatRowCompact(p: Pattern, r: number): string {
  return encodeRow(p, r)
    .map((run) => `${run.count}${initial(label(p, run.palette_index))}`)
    .join(' ')
}

/** Full printable readout in working order, one line per row with its number and
 *  direction arrow. */
export function exportAllRowsText(p: Pattern): string {
  const lines: string[] = []
  for (let k = 0; k < p.rows; k++) {
    const r = p.bottom_up ? p.rows - 1 - k : k
    const arrow = rowDirection(p, r) === 'LTR' ? '→' : '←'
    lines.push(`Row ${workingNumber(p, r)} ${arrow}  ${formatRowText(p, r)}`)
  }
  return lines.join('\n')
}

function pyMod(a: number, n: number): number {
  return ((a % n) + n) % n
}
