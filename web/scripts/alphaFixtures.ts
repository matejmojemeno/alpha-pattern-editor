/**
 * The `.alpha` compatibility fixtures, shared by the generator script and the tests.
 *
 *   fixtures/alpha/desktop/   written by the desktop (scripts/gen_alpha_fixtures.py)
 *   fixtures/alpha/from-ts/   written by this storage layer (web/scripts/gen-alpha-fixtures.ts)
 *
 * Each directory has an expected.json recording, per archive, what should be read back
 * from it. alphareader/tests/test_alpha_compat.py loads every from-ts archive with
 * io.load_project and compares it with that record.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { SKIP_INDEX, type Project } from '../src/model/types.ts'
import { readAlpha, writeAlpha, type AlphaContents } from '../src/storage/alpha.ts'

export const DESKTOP_DIR = fileURLToPath(new URL('../../fixtures/alpha/desktop/', import.meta.url))
export const FROM_TS_DIR = fileURLToPath(new URL('../../fixtures/alpha/from-ts/', import.meta.url))

/** One archive's entry in expected.json. Same shape on both sides. */
export type ExpectedRecord =
  | { rejected: string; pristine?: boolean; roundtrip_of?: string }
  | {
      pristine?: boolean
      roundtrip_of?: string
      stage: string
      pattern: {
        id: string
        name: string
        created_at: number
        updated_at: number
        rows: number
        cols: number
        row_ids: string[]
        cells: number[][]
        palette: { id: string; hex: string; name: string; dmc: string | null; count: number }[]
        start_direction: string
        alternate_direction: boolean
        bottom_up: boolean
      }
      progress: {
        completed_row_ids: string[]
        current_row_id: string | null
        current_run_index: number
        current_run_stitches: number
        started_at: number | null
      }
      source_png_sha256: string | null
    }

export interface ExpectedFile {
  files: Record<string, ExpectedRecord>
}

export function readExpected(dir: string): ExpectedFile {
  return JSON.parse(readFileSync(dir + 'expected.json', 'utf-8')) as ExpectedFile
}

export function readArchives(dir: string): Record<string, Uint8Array<ArrayBuffer>> {
  const out: Record<string, Uint8Array<ArrayBuffer>> = {}
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith('.alpha')) out[name] = new Uint8Array(readFileSync(dir + name))
  }
  return out
}

/** A loaded project in the expected.json shape. */
export function record({ project, sourcePng }: AlphaContents) {
  const { pattern: p, progress: pr, stage } = project
  return {
    stage,
    pattern: {
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      updated_at: p.updated_at,
      rows: p.rows,
      cols: p.cols,
      row_ids: [...p.row_ids],
      cells: Array.from({ length: p.rows }, (_, r) => Array.from(p.cells.subarray(r * p.cols, (r + 1) * p.cols))),
      palette: p.palette.map((e) => ({ ...e })),
      start_direction: p.start_direction,
      alternate_direction: p.alternate_direction,
      bottom_up: p.bottom_up,
    },
    progress: {
      completed_row_ids: [...pr.completed_row_ids].sort(),
      current_row_id: pr.current_row_id,
      current_run_index: pr.current_run_index,
      current_run_stitches: pr.current_run_stitches,
      started_at: pr.started_at,
    },
    source_png_sha256: sourcePng ? createHash('sha256').update(sourcePng).digest('hex') : null,
  }
}

function ids(tag: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => createHash('md5').update(`${tag}/${i}`).digest('hex'))
}

/** Projects built from scratch in TypeScript: the cases a round-trip can't reach. */
function builtProjects(): Record<string, Project> {
  // Integral timestamps: Python must still read them back as floats (1700000000.0).
  const t = 1_700_000_000
  const edgeIds = ids('ts-edge', 4)
  return {
    'built-edge.alpha': {
      stage: 'work',
      pattern: {
        id: createHash('md5').update('ts-edge').digest('hex'),
        name: 'Ünïcödé 🧶 \u007f del, "quotes", back\\slash\nnewline',
        created_at: t,
        updated_at: t,
        rows: 4,
        cols: 3,
        row_ids: edgeIds,
        cells: Uint16Array.from([0, 1, 2, SKIP_INDEX, SKIP_INDEX, 0, 2, 2, 1, 0, 0, 65534]),
        palette: [
          { id: 'a', hex: '#000000', name: 'Černá', dmc: '310', count: 4 },
          { id: 'b', hex: '#ff0000', name: '', dmc: null, count: 2 },
          { id: 'c', hex: '#00ff00', name: '緑', dmc: null, count: 3 },
        ],
        start_direction: 'RTL',
        alternate_direction: true,
        bottom_up: false,
      },
      progress: {
        completed_row_ids: new Set([edgeIds[2]!, edgeIds[0]!]),
        current_row_id: edgeIds[1]!,
        current_run_index: 1,
        current_run_stitches: 1,
        started_at: t,
      },
    },
    'built-empty.alpha': {
      stage: 'design',
      pattern: {
        id: 'empty',
        name: '',
        created_at: 0,
        updated_at: 0,
        rows: 0,
        cols: 0,
        row_ids: [],
        cells: new Uint16Array(0),
        palette: [],
        start_direction: 'LTR',
        alternate_direction: false,
        bottom_up: true,
      },
      progress: {
        completed_row_ids: new Set(),
        current_row_id: null,
        current_run_index: 0,
        current_run_stitches: 0,
        started_at: null,
      },
    },
  }
}

/** Everything in fixtures/alpha/from-ts/, generated from the current storage code. */
export function buildFromTs(): { archives: Record<string, Uint8Array>; expected: string } {
  const archives: Record<string, Uint8Array> = {}
  const files: Record<string, ExpectedRecord> = {}

  // Every desktop file the desktop can open, loaded and saved again through TS. Saving
  // at the original updated_at keeps the result comparable field for field.
  const desktop = readExpected(DESKTOP_DIR).files
  for (const [name, bytes] of Object.entries(readArchives(DESKTOP_DIR))) {
    if ('rejected' in desktop[name]!) continue
    const loaded = readAlpha(bytes)
    const { bytes: out, project } = writeAlpha(loaded.project, {
      sourcePng: loaded.sourcePng,
      now: loaded.project.pattern.updated_at,
    })
    const rt = `roundtrip-${name}`
    archives[rt] = out
    files[rt] = { roundtrip_of: name, ...record({ project, sourcePng: loaded.sourcePng }) }
  }

  for (const [name, project] of Object.entries(builtProjects())) {
    const { bytes, project: saved } = writeAlpha(project, { now: project.pattern.updated_at })
    archives[name] = bytes
    files[name] = record({ project: saved, sourcePng: null })
  }

  // A TS-written archive claiming a format from the future: both sides must refuse it.
  const { bytes: base } = writeAlpha(builtProjects()['built-edge.alpha']!, { now: 1_700_000_000 })
  const entries = unzipSync(base)
  entries['meta.json'] = strToU8(
    strFromU8(entries['meta.json']!).replace('"format_version": 1', '"format_version": 999'),
  )
  archives['newer-format.alpha'] = zipSync(entries, { mtime: new Date(1_700_000_000_000) })
  files['newer-format.alpha'] = {
    rejected: 'This project was made by a newer version (format 999); this build understands up to 1.',
  }

  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)))
  return { archives, expected: JSON.stringify({ files: sorted }, null, 1) + '\n' }
}
