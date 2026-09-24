import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { emptyProgress, type Project } from '../../src/model/types.ts'
import {
  alphaFileName,
  AlphaFormatError,
  progressPct,
  readAlpha,
  writeAlpha,
} from '../../src/storage/alpha.ts'
import { pyJsonDumps } from '../../src/storage/pyjson.ts'

function project(overrides: Partial<Project['pattern']> = {}): Project {
  return {
    stage: 'work',
    pattern: {
      id: '0123456789abcdef',
      name: 'Fox',
      created_at: 1_700_000_000.5,
      updated_at: 1_700_000_001,
      rows: 2,
      cols: 3,
      row_ids: ['r0', 'r1'],
      cells: Uint16Array.from([0, 1, 1, 0xffff, 0, 0]),
      palette: [
        { id: 'a', hex: '#ffffff', name: 'White', dmc: 'B5200', count: 3 },
        { id: 'b', hex: '#000000', name: 'Black', dmc: null, count: 2 },
      ],
      start_direction: 'RTL',
      alternate_direction: true,
      bottom_up: true,
      ...overrides,
    },
    progress: {
      completed_row_ids: new Set(['r1']),
      current_row_id: 'r0',
      current_run_index: 1,
      current_run_stitches: 1,
      started_at: 1_700_000_000,
    },
  }
}

/** Rewrite one JSON entry of an archive. */
function patch(bytes: Uint8Array, entry: string, edit: (d: Record<string, unknown>) => void): Uint8Array {
  const files = unzipSync(bytes)
  const d = JSON.parse(strFromU8(files[entry]!))
  edit(d)
  files[entry] = strToU8(JSON.stringify(d))
  return zipSync(files)
}

describe('writeAlpha / readAlpha', () => {
  it('round-trips a project', () => {
    const p = project()
    const { bytes, project: saved } = writeAlpha(p, { now: 1_800_000_000, sourcePng: Uint8Array.from([137, 80]) })
    const back = readAlpha(bytes)
    expect(back.project).toEqual(saved)
    expect(back.sourcePng).toEqual(Uint8Array.from([137, 80]))
  })

  it('stamps updated_at on a copy and never mutates its argument', () => {
    const p = project()
    const before = structuredClone(p)
    const { project: saved } = writeAlpha(p, { now: 1_800_000_000 })
    expect(p).toEqual(before)
    expect(saved).not.toBe(p)
    expect(saved.pattern.updated_at).toBe(1_800_000_000)
    expect(saved.pattern.cells).toBe(p.pattern.cells)
  })

  it('stamps the wall clock when no time is given', () => {
    const t0 = Date.now() / 1000
    const { project: saved } = writeAlpha(project())
    expect(saved.pattern.updated_at).toBeGreaterThanOrEqual(t0)
    expect(saved.pattern.updated_at).toBeLessThanOrEqual(Date.now() / 1000)
  })

  it('writes exactly the five entries, source.png only when given', () => {
    expect(Object.keys(unzipSync(writeAlpha(project()).bytes)).sort()).toEqual([
      'cells.npy',
      'meta.json',
      'pattern.json',
      'progress.json',
    ])
    const withSrc = writeAlpha(project(), { sourcePng: Uint8Array.from([1]) }).bytes
    expect(Object.keys(unzipSync(withSrc))).toContain('source.png')
  })

  it('writes meta.json and progress.json as the desktop does', () => {
    const files = unzipSync(writeAlpha(project(), { now: 1_800_000_000 }).bytes)
    expect(strFromU8(files['meta.json']!)).toBe('{"format_version": 1, "stage": "work"}')
    expect(strFromU8(files['progress.json']!)).toBe(
      '{"completed_row_ids": ["r1"], "current_row_id": "r0", "current_run_index": 1, ' +
        '"current_run_stitches": 1, "started_at": 1700000000.0}',
    )
  })

  it('applies io.py defaults to missing optional fields', () => {
    let bytes = writeAlpha(project()).bytes
    bytes = patch(bytes, 'meta.json', (d) => {
      delete d.format_version
      delete d.stage
    })
    bytes = patch(bytes, 'pattern.json', (d) => {
      delete d.start_direction
      delete d.alternate_direction
      delete d.bottom_up
      d.palette = [{ id: 'a', hex: '#fff', name: 'W' }]
    })
    bytes = patch(bytes, 'progress.json', (d) => {
      for (const k of Object.keys(d)) delete d[k]
    })
    const { project: p } = readAlpha(bytes)
    expect(p.stage).toBe('design')
    expect(p.pattern.start_direction).toBe('LTR')
    expect(p.pattern.alternate_direction).toBe(true)
    expect(p.pattern.bottom_up).toBe(true)
    expect(p.pattern.palette).toEqual([{ id: 'a', hex: '#fff', name: 'W', dmc: null, count: 0 }])
    expect(p.progress).toEqual(emptyProgress())
  })

  it('keeps an explicit null, as dict.get does', () => {
    const bytes = patch(writeAlpha(project()).bytes, 'progress.json', (d) => {
      d.current_row_id = null
      d.started_at = null
    })
    const { progress } = readAlpha(bytes).project
    expect(progress.current_row_id).toBeNull()
    expect(progress.started_at).toBeNull()
  })

  it.each([999, 2, '2'])('rejects format_version %j', (v) => {
    const bytes = patch(writeAlpha(project()).bytes, 'meta.json', (d) => {
      d.format_version = v
    })
    expect(() => readAlpha(bytes)).toThrow(/newer version \(format \d+\); this build understands up to 1/)
    expect(() => readAlpha(bytes)).toThrow(AlphaFormatError)
  })

  it.each([0, 1, 1.9])('accepts format_version %j, like int() does', (v) => {
    const bytes = patch(writeAlpha(project()).bytes, 'meta.json', (d) => {
      d.format_version = v
    })
    expect(readAlpha(bytes).project.pattern.name).toBe('Fox')
  })

  it.each(['meta.json', 'pattern.json', 'progress.json', 'cells.npy'])('rejects an archive without %s', (entry) => {
    const files = unzipSync(writeAlpha(project()).bytes)
    delete files[entry]
    expect(() => readAlpha(zipSync(files))).toThrow(new RegExp(entry.replace('.', '\\.')))
  })

  it('rejects a required pattern field that is missing', () => {
    const bytes = patch(writeAlpha(project()).bytes, 'pattern.json', (d) => {
      delete d.row_ids
    })
    expect(() => readAlpha(bytes)).toThrow(/row_ids/)
  })

  it('rejects cells.npy whose shape disagrees with pattern.json', () => {
    const bytes = patch(writeAlpha(project()).bytes, 'pattern.json', (d) => {
      d.cols = 2
    })
    expect(() => readAlpha(bytes)).toThrow(/2×3 but the pattern is 2×2/)
  })

  it('rejects something that is not a zip', () => {
    expect(() => readAlpha(strToU8('hello'))).toThrow(AlphaFormatError)
  })
})

describe('helpers', () => {
  it('alphaFileName matches io.default_save_path', () => {
    expect(alphaFileName({ name: 'My Fox #2!', id: 'abcdef123456' })).toBe('my-fox-2-abcdef.alpha')
    expect(alphaFileName({ name: '', id: 'abc' })).toBe('pattern-abc.alpha')
    expect(alphaFileName({ name: '???', id: '0123456789' })).toBe('pattern-012345.alpha')
  })

  it('progressPct matches io.list_saved_projects', () => {
    expect(progressPct({ rows: 4 }, { ...emptyProgress(), completed_row_ids: new Set(['a']) })).toBe(25)
    expect(progressPct({ rows: 0 }, emptyProgress())).toBe(0)
  })
})

describe('pyJsonDumps', () => {
  it('matches json.dumps defaults', () => {
    expect(pyJsonDumps({ a: [1, 2], b: { c: null, d: true, e: false } })).toBe(
      '{"a": [1, 2], "b": {"c": null, "d": true, "e": false}}',
    )
    expect(pyJsonDumps([])).toBe('[]')
    expect(pyJsonDumps({})).toBe('{}')
  })

  it('escapes like ensure_ascii', () => {
    expect(pyJsonDumps('Ž 🐴 "q" \\ \n\t\u0001\u007f~ ')).toBe(
      '"\\u017d \\ud83d\\udc34 \\"q\\" \\\\ \\n\\t\\u0001\\u007f~ "',
    )
  })

  it('writes float keys with a fractional part', () => {
    const keys = new Set(['t'])
    expect(pyJsonDumps({ t: 1700000000, n: 3 }, keys)).toBe('{"t": 1700000000.0, "n": 3}')
    expect(pyJsonDumps({ t: 1758700000.123456 }, keys)).toBe('{"t": 1758700000.123456}')
    expect(pyJsonDumps({ t: null }, keys)).toBe('{"t": null}')
  })
})
