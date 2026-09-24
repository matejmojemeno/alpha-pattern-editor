/**
 * `.alpha` project archives (§8): the TypeScript replacement for
 * alphareader/core/io.py's save_project / load_project, field for field.
 *
 * A project is a zip of:
 *   meta.json      {format_version, stage}, so unknown major versions can be rejected
 *   pattern.json   pattern metadata + palette (cells stored separately)
 *   progress.json  Work-stage progress
 *   cells.npy      uint16 (rows, cols) palette indices
 *   source.png     optional: the original imported image
 *
 * The desktop re-encodes source.png from pixels on every save. The browser has the PNG
 * bytes already, so they are passed through untouched.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate'

import {
  FORMAT_VERSION,
  type MetaJson,
  type PatternJson,
  type ProgressJson,
} from '../model/alphaJson.ts'
import type { Direction, PaletteEntry, Pattern, Progress, Project, Stage } from '../model/types.ts'
import { readNpyU16, writeNpyU16 } from './npy.ts'
import { pyJsonDumps, type PyJson } from './pyjson.ts'

export class AlphaFormatError extends Error {
  readonly code: 'NEWER_VERSION' | 'CORRUPT'
  constructor(code: AlphaFormatError['code'], message: string) {
    super(message)
    this.name = 'AlphaFormatError'
    this.code = code
  }
}

export interface AlphaContents {
  project: Project
  /** Raw source.png bytes, or null when the archive has none. */
  sourcePng: Uint8Array | null
}

/** Keys io.py writes as Python floats (time.time() stamps). */
const FLOAT_KEYS = new Set(['created_at', 'updated_at', 'started_at'])

/** Zip timestamps can't predate 1980-01-01 (seconds since the Unix epoch, with a day of
 *  slack for time zones). */
const DOS_EPOCH = 315_619_200

// --- write ---------------------------------------------------------------------------

function patternToJson(p: Pattern): PatternJson {
  return {
    id: p.id,
    name: p.name,
    created_at: p.created_at,
    updated_at: p.updated_at,
    cols: p.cols,
    rows: p.rows,
    row_ids: [...p.row_ids],
    // dataclasses.asdict order.
    palette: p.palette.map((e) => ({ id: e.id, hex: e.hex, name: e.name, dmc: e.dmc, count: e.count })),
    start_direction: p.start_direction,
    alternate_direction: p.alternate_direction,
    bottom_up: p.bottom_up,
  }
}

function progressToJson(pr: Progress): Required<ProgressJson> {
  return {
    // Python's sorted() on str compares code points; so does the default JS sort for
    // BMP strings, and ids are ASCII (uuid hex) in practice.
    completed_row_ids: [...pr.completed_row_ids].sort(),
    current_row_id: pr.current_row_id,
    current_run_index: pr.current_run_index,
    current_run_stitches: pr.current_run_stitches,
    started_at: pr.started_at,
  }
}

/**
 * Serialise `project` to `.alpha` bytes. Like io.save_project, saving stamps a fresh
 * `updated_at` on a *copy* and returns it; the argument is never modified. Callers
 * rebind: `({ project } = writeAlpha(project, ...))`.
 */
export function writeAlpha(
  project: Project,
  opts: { sourcePng?: Uint8Array | null; now?: number } = {},
): { bytes: Uint8Array; project: Project } {
  const now = opts.now ?? Date.now() / 1000
  const pattern: Pattern = { ...project.pattern, updated_at: now }
  const saved: Project = { ...project, pattern }
  const text = (v: PyJson) => new TextEncoder().encode(pyJsonDumps(v, FLOAT_KEYS))
  // Entry timestamps follow the save time, as the desktop's do, rather than the wall
  // clock, so the same project saved at the same `now` gives the same bytes.
  const mtime = new Date(Math.max(now, DOS_EPOCH) * 1000)

  const files: Zippable = {
    'meta.json': text({ format_version: FORMAT_VERSION, stage: saved.stage }),
    'pattern.json': text(patternToJson(pattern) as unknown as PyJson),
    'progress.json': text(progressToJson(saved.progress) as unknown as PyJson),
    'cells.npy': writeNpyU16({ rows: pattern.rows, cols: pattern.cols, data: pattern.cells }),
  }
  if (opts.sourcePng) files['source.png'] = [opts.sourcePng, { level: 0 }] // already compressed
  // ZIP_DEFLATED, as the desktop writes.
  return { bytes: zipSync(files, { level: 6, mtime }), project: saved }
}

// --- read ----------------------------------------------------------------------------

function corrupt(message: string): never {
  throw new AlphaFormatError('CORRUPT', message)
}

function json<T>(files: Record<string, Uint8Array>, name: string): T {
  const raw = files[name]
  if (raw === undefined) corrupt(`This file is not a project: ${name} is missing.`)
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as T
  } catch {
    corrupt(`This project is damaged: ${name} is not valid JSON.`)
  }
}

/** `d[key]` for a field io.py requires (a missing one is a KeyError there). */
function required<T, K extends keyof T>(d: T, key: K, where: string): NonNullable<T[K]> {
  const v = d[key]
  if (v === undefined || v === null) corrupt(`This project is damaged: ${where} has no "${String(key)}".`)
  return v as NonNullable<T[K]>
}

/** Python's `d.get(key, default)`: only a *missing* key falls back. An explicit null
 *  stays null, as it does in Python. */
function get<T, K extends keyof T, D>(d: T, key: K, fallback: D): Exclude<T[K], undefined> | D {
  return d[key] === undefined ? fallback : (d[key] as Exclude<T[K], undefined>)
}

function paletteEntryFromJson(e: Partial<PaletteEntry>, i: number): PaletteEntry {
  const where = `palette entry ${i}`
  // PaletteEntry(**e): id, hex and name are required; dmc and count have defaults.
  return {
    id: required(e, 'id', where),
    hex: required(e, 'hex', where),
    name: required(e, 'name', where),
    dmc: get(e, 'dmc', null),
    count: get(e, 'count', 0),
  }
}

/** Parse `.alpha` bytes, applying io.load_project's rules. Throws AlphaFormatError. */
export function readAlpha(bytes: Uint8Array): AlphaContents {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    corrupt('This file is not a project: it is not a zip archive.')
  }

  const meta = json<MetaJson>(files, 'meta.json')
  // int(meta.get("format_version", 0))
  const major = Math.trunc(Number(get(meta, 'format_version', 0)))
  if (Number.isNaN(major)) corrupt('This project is damaged: meta.json has a bad format_version.')
  if (major > FORMAT_VERSION) {
    throw new AlphaFormatError(
      'NEWER_VERSION',
      `This project was made by a newer version (format ${major}); ` +
        `this build understands up to ${FORMAT_VERSION}.`,
    )
  }

  const cellsNpy = files['cells.npy']
  if (cellsNpy === undefined) corrupt('This file is not a project: cells.npy is missing.')
  const cells = readNpyU16(cellsNpy)

  const pj = json<PatternJson>(files, 'pattern.json')
  const rows = required(pj, 'rows', 'pattern.json')
  const cols = required(pj, 'cols', 'pattern.json')
  // io.py does not check this; the Python would index past the array. A flat buffer
  // would silently read the wrong cells instead, so refuse it here.
  if (cells.rows !== rows || cells.cols !== cols) {
    corrupt(`This project is damaged: cells.npy is ${cells.rows}×${cells.cols} but the pattern is ${rows}×${cols}.`)
  }
  const pattern: Pattern = {
    id: required(pj, 'id', 'pattern.json'),
    name: required(pj, 'name', 'pattern.json'),
    created_at: required(pj, 'created_at', 'pattern.json'),
    updated_at: required(pj, 'updated_at', 'pattern.json'),
    cols,
    rows,
    row_ids: [...required(pj, 'row_ids', 'pattern.json')],
    cells: cells.data,
    palette: required(pj, 'palette', 'pattern.json').map(paletteEntryFromJson),
    // "LTR", not the dataclass's "RTL": files written before right-to-left became the
    // default must keep reading the way they were made. Deliberate; do not unify.
    start_direction: get(pj, 'start_direction', 'LTR' as Direction),
    alternate_direction: get(pj, 'alternate_direction', true),
    bottom_up: get(pj, 'bottom_up', true),
  }

  const prj = json<ProgressJson>(files, 'progress.json')
  const progress: Progress = {
    completed_row_ids: new Set(get(prj, 'completed_row_ids', [])),
    current_row_id: get(prj, 'current_row_id', null),
    current_run_index: get(prj, 'current_run_index', 0),
    // Older progress.json files predate this field.
    current_run_stitches: get(prj, 'current_run_stitches', 0),
    started_at: get(prj, 'started_at', null),
  }

  const stage: Stage = get(meta, 'stage', 'design' as Stage)
  return { project: { pattern, progress, stage }, sourcePng: files['source.png'] ?? null }
}

// --- helpers for the Library ---------------------------------------------------------

function slug(name: string): string {
  const s = (name || 'pattern')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'pattern'
}

/** The filename the desktop would save this pattern under (io.default_save_path). */
export function alphaFileName(p: Pick<Pattern, 'name' | 'id'>): string {
  return `${slug(p.name)}-${p.id.slice(0, 6)}.alpha`
}

/** Percentage of rows done, as io.list_saved_projects computes it for the Library.
 *  Counts completed ids as stored, like the desktop does, not only ones still in row_ids. */
export function progressPct(pattern: Pick<Pattern, 'rows'>, progress: Progress): number {
  return pattern.rows ? (100 * progress.completed_row_ids.size) / pattern.rows : 0
}
