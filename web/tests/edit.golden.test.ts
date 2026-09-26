/**
 * Replays fixtures/edit_golden.json (written by scripts/gen_fixtures.py from edit.py)
 * against logic/edit.ts. Schema and porting notes: fixtures/README.md.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as edit from '../src/logic/edit.ts'
import type { Direction, Pattern } from '../src/model/types.ts'

interface PatternRecord {
  id: string
  name: string
  created_at: number
  rows: number
  cols: number
  row_ids: string[]
  cells: number[][]
  palette: { id: string; hex: string; name: string; dmc: string | null; count: number }[]
  start_direction: Direction
  alternate_direction: boolean
  bottom_up: boolean
}

interface Case {
  pattern: string
  fn: string
  args: (number | string)[]
  kwargs: Record<string, number | boolean>
  result?: PatternRecord
  value?: number | string
  raises?: 'ValueError' | 'KeyError'
  message?: string
}

interface Golden {
  format: number
  new_id: string
  skip_index: number
  patterns: Record<string, PatternRecord>
  cases: Case[]
}

const golden = JSON.parse(
  readFileSync(new URL('../../fixtures/edit_golden.json', import.meta.url), 'utf-8'),
) as Golden

function toPattern(r: PatternRecord): Pattern {
  return {
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    updated_at: 0,
    cols: r.cols,
    rows: r.rows,
    row_ids: r.row_ids,
    cells: Uint16Array.from(r.cells.flat()),
    palette: r.palette.map((e) => ({ ...e })),
    start_direction: r.start_direction,
    alternate_direction: r.alternate_direction,
    bottom_up: r.bottom_up,
  }
}

function toRecord(p: Pattern): PatternRecord {
  const cells: number[][] = []
  for (let r = 0; r < p.rows; r++) cells.push([...p.cells.subarray(r * p.cols, (r + 1) * p.cols)])
  return {
    id: p.id,
    name: p.name,
    created_at: p.created_at,
    rows: p.rows,
    cols: p.cols,
    row_ids: [...p.row_ids],
    cells,
    palette: p.palette.map(({ id, hex, name, dmc, count }) => ({ id, hex, name, dmc, count })),
    start_direction: p.start_direction,
    alternate_direction: p.alternate_direction,
    bottom_up: p.bottom_up,
  }
}

/** Call the TS port the way the fixture called the Python: fn(pattern, *args, **kwargs). */
function call(p: Pattern, c: Case): unknown {
  // Arguments are typed by the function they go to; the fixture is the authority.
  const a = c.args as unknown as [never, never, never, never, never]
  const k = c.kwargs
  const num = (name: string) => k[name] as number | undefined
  switch (c.fn) {
    case 'set_cell':
      return edit.setCell(p, a[0], a[1], a[2])
    case 'flood_fill':
      return edit.floodFill(p, a[0], a[1], a[2])
    case 'fill_rect':
      return edit.fillRect(p, a[0], a[1], a[2], a[3], a[4])
    case 'fill_row':
      return edit.fillRow(p, a[0], a[1])
    case 'fill_column':
      return edit.fillColumn(p, a[0], a[1])
    case 'add_border':
      return edit.addBorder(p, {
        top: num('top'),
        right: num('right'),
        bottom: num('bottom'),
        left: num('left'),
        paletteIndex: num('palette_index'),
      })
    case 'insert_row':
      return edit.insertRow(p, a[0], a[1])
    case 'delete_row':
      return edit.deleteRow(p, a[0])
    case 'insert_column':
      return edit.insertColumn(p, a[0], a[1])
    case 'delete_column':
      return edit.deleteColumn(p, a[0])
    case 'trim_uniform_edges':
      return edit.trimUniformEdges(p, k as edit.Edges)
    case 'mirror_h':
      return edit.mirrorH(p)
    case 'mirror_v':
      return edit.mirrorV(p)
    case 'rotate_180':
      return edit.rotate180(p)
    case 'rotate_90':
      return edit.rotate90(p, k.clockwise as boolean | undefined)
    case 'recolor_palette_entry':
      return edit.recolorPaletteEntry(p, a[0], a[1])
    case 'rename_palette_entry':
      return edit.renamePaletteEntry(p, a[0], a[1])
    case 'add_palette_entry':
      return edit.addPaletteEntry(p, a[0], a[1])
    case 'merge_palette_entries':
      return edit.mergePaletteEntries(p, a[0], a[1])
    case 'delete_palette_entry':
      return edit.deletePaletteEntry(p, a[0], a[1])
    case 'nearest_entry_id':
      return edit.nearestEntryId(p, a[0])
    case 'delete_palette_entry_nearest':
      return edit.deletePaletteEntryNearest(p, a[0])
    case 'scale':
      return edit.scale(p, a[0])
    case 'major_border_index':
      return edit.majorBorderIndex(p)
    case 'pad_to_size':
      return edit.padToSize(p, a[0], a[1], {
        paletteIndex: a[2],
        offsetLeft: num('offset_left'),
        offsetTop: num('offset_top'),
      })
    default:
      throw new Error(`no port of edit.${c.fn}`)
  }
}

/** Replace ids the edit made up with the fixture's marker, after checking each is fresh
 *  (not in the input) and unique (not repeated anywhere). */
function structural(ids: string[], before: ReadonlySet<string>): string[] {
  const made = ids.filter((id) => !before.has(id))
  expect(new Set(made).size, 'made-up ids are unique').toBe(made.length)
  for (const id of made) expect(id).toMatch(/^[0-9a-f]{32}$/)
  return ids.map((id) => (before.has(id) ? id : golden.new_id))
}

describe('edit.ts replays fixtures/edit_golden.json', () => {
  it('has the expected format', () => {
    expect(golden.format).toBe(1)
    expect(golden.skip_index).toBe(edit.SKIP_INDEX)
  })

  it.each(golden.cases.map((c, i) => [`${i}: ${c.fn}(${c.pattern}, ${JSON.stringify(c.args)}, ${JSON.stringify(c.kwargs)})`, c] as const))(
    '%s',
    (_, c) => {
      const input = toPattern(golden.patterns[c.pattern]!)
      const snapshot = toRecord(input)
      const run = () => call(input, c)

      if (c.raises === 'ValueError') {
        expect(run).toThrow(new edit.EditError(c.message!))
      } else if (c.raises === 'KeyError') {
        expect(run).toThrow(edit.UnknownEntryError)
      } else if (c.value !== undefined) {
        expect(run()).toEqual(c.value)
      } else {
        const out = run() as Pattern
        expect(out).not.toBe(input)
        expect(out.cells).not.toBe(input.cells)
        expect(out.cells.length).toBe(out.rows * out.cols)
        const got = toRecord(out)
        const rowIds = new Set(input.row_ids)
        const palIds = new Set(input.palette.map((e) => e.id))
        // Row and palette ids are unique across the whole result, old and new alike.
        expect(new Set(got.row_ids).size).toBe(got.row_ids.length)
        got.row_ids = structural(got.row_ids, rowIds)
        const pal = structural(
          got.palette.map((e) => e.id),
          palIds,
        )
        got.palette.forEach((e, i) => (e.id = pal[i]!))
        expect(got).toEqual(c.result)
      }
      // Pure: the input is exactly as it was.
      expect(toRecord(input)).toEqual(snapshot)
    },
  )

  it('covers every function the Python has', () => {
    const fns = new Set(golden.cases.map((c) => c.fn))
    expect(fns.size).toBe(25)
  })
})
