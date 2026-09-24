/**
 * Format compatibility with the desktop app, both directions.
 *
 * Desktop → web: every archive in fixtures/alpha/desktop/ (written by io.save_project)
 * must read exactly as io.load_project reads it (recorded in its expected.json).
 *
 * Web → desktop: fixtures/alpha/from-ts/ is opened by the desktop in
 * alphareader/tests/test_alpha_compat.py. This suite makes sure those committed files
 * are still what the current storage code writes.
 */
import { readFileSync } from 'node:fs'

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  buildFromTs,
  DESKTOP_DIR,
  FROM_TS_DIR,
  readArchives,
  readExpected,
  record,
} from '../../scripts/alphaFixtures.ts'
import { AlphaFormatError, readAlpha, writeAlpha } from '../../src/storage/alpha.ts'

type LoadedRecord = ReturnType<typeof record>

/** toEqual on a whole record, but with the cells checked first and cheaply: on failure,
 *  Vitest's diff of a 120×150 nested array takes minutes, so report the first bad cell. */
function expectRecord(actual: LoadedRecord, want: unknown, name: string) {
  const w = want as LoadedRecord
  const a = actual.pattern.cells.flat()
  const b = w.pattern.cells.flat()
  const bad = a.findIndex((v, i) => v !== b[i])
  expect(
    a.length === b.length && bad < 0,
    `${name}: cells differ (lengths ${a.length}/${b.length}, first at flat index ${bad}: ${a[bad]} vs ${b[bad]})`,
  ).toBe(true)
  const strip = (r: LoadedRecord) => ({ ...r, pattern: { ...r.pattern, cells: [] } })
  expect(strip(actual), name).toEqual(strip(w))
}

describe('desktop-written archives', () => {
  const archives = readArchives(DESKTOP_DIR)
  const expected = readExpected(DESKTOP_DIR).files

  it('cover the cases the desktop can produce', () => {
    expect(Object.keys(archives).sort()).toEqual(Object.keys(expected).sort())
    const loaded = Object.values(expected).filter((r) => !('rejected' in r))
    const has = (f: (r: Extract<(typeof loaded)[number], { stage: string }>) => boolean) =>
      loaded.some((r) => 'stage' in r && f(r))
    expect(has((r) => r.source_png_sha256 !== null)).toBe(true)
    expect(has((r) => r.source_png_sha256 === null)).toBe(true)
    expect(has((r) => r.progress.current_run_stitches > 0)).toBe(true)
    expect(has((r) => r.pattern.cells.flat().includes(0xffff))).toBe(true)
    expect(Object.values(expected).some((r) => 'rejected' in r)).toBe(true)
  })

  for (const [name, bytes] of Object.entries(archives)) {
    const want = expected[name]!
    it(`${name} reads as the desktop reads it`, () => {
      if ('rejected' in want) {
        expect(() => readAlpha(bytes)).toThrow(want.rejected)
        try {
          readAlpha(bytes)
        } catch (e) {
          expect(e).toBeInstanceOf(AlphaFormatError)
          expect((e as AlphaFormatError).code).toBe('NEWER_VERSION')
        }
        return
      }
      const { pristine, roundtrip_of, ...rest } = want
      void pristine, void roundtrip_of
      expectRecord(record(readAlpha(bytes)), rest, name)
    })
  }

  it('old progress.json without current_run_stitches reads as 0', () => {
    const raw = unzipSync(archives['old-progress.alpha']!)
    expect(new TextDecoder().decode(raw['progress.json'])).not.toContain('current_run_stitches')
    expect(readAlpha(archives['old-progress.alpha']!).project.progress.current_run_stitches).toBe(0)
  })

  it('a pattern.json without start_direction reads as LTR, not the RTL default', () => {
    const raw = new TextDecoder().decode(unzipSync(archives['legacy-pattern.alpha']!)['pattern.json'])
    expect(raw).not.toContain('start_direction')
    const { project } = readAlpha(archives['legacy-pattern.alpha']!)
    expect(project.pattern.start_direction).toBe('LTR')
    expect(project.pattern.alternate_direction).toBe(true)
    expect(project.pattern.bottom_up).toBe(true)
    expect(project.stage).toBe('design')
    expect(project.pattern.palette[0]).toMatchObject({ dmc: null, count: 0 })
  })

  // Only pristine files are exactly what save_project writes; the others were edited to
  // look like older builds.
  const pristine = Object.keys(archives).filter((n) => expected[n]!.pristine)
  it.each(pristine)('%s saved again by TS gives byte-identical entries', (name) => {
    const desktop = unzipSync(archives[name]!)
    const loaded = readAlpha(archives[name]!)
    const { bytes } = writeAlpha(loaded.project, {
      sourcePng: loaded.sourcePng,
      now: loaded.project.pattern.updated_at,
    })
    const ours = unzipSync(bytes)
    expect(Object.keys(ours).sort()).toEqual(Object.keys(desktop).sort())
    for (const entry of Object.keys(desktop)) {
      const [a, b] = [ours[entry]!, desktop[entry]!]
      if (entry.endsWith('.json')) {
        expect(new TextDecoder().decode(a), entry).toBe(new TextDecoder().decode(b))
      } else {
        expect(Buffer.from(a).equals(Buffer.from(b)), entry).toBe(true)
      }
    }
  })
})

describe('TS-written archives (fixtures/alpha/from-ts)', () => {
  const committed = readArchives(FROM_TS_DIR)
  const built = buildFromTs()

  it('are up to date with the storage code (run `npm run gen:alpha` if not)', () => {
    // Compared as text: a toEqual diff of the large grid on failure takes minutes.
    const committedExpected = readFileSync(FROM_TS_DIR + 'expected.json', 'utf-8')
    expect(committedExpected === built.expected, 'from-ts/expected.json is stale').toBe(true)
    expect(Object.keys(committed).sort()).toEqual(Object.keys(built.archives).sort())
    for (const [name, bytes] of Object.entries(built.archives)) {
      // Compare entries, not zip bytes: zip timestamps are written in local time.
      const [a, b] = [unzipSync(bytes), unzipSync(committed[name]!)]
      expect(Object.keys(a).sort(), name).toEqual(Object.keys(b).sort())
      for (const entry of Object.keys(a)) {
        expect(Buffer.from(a[entry]!).equals(Buffer.from(b[entry]!)), `${name}/${entry}`).toBe(true)
      }
    }
  })

  it('read back through TS as recorded, and the 999 archive is refused', () => {
    const expected = readExpected(FROM_TS_DIR).files
    for (const [name, bytes] of Object.entries(committed)) {
      const want = expected[name]!
      if ('rejected' in want) {
        expect(() => readAlpha(bytes), name).toThrow(want.rejected)
        continue
      }
      const { roundtrip_of, pristine, ...rest } = want
      void roundtrip_of, void pristine
      expectRecord(record(readAlpha(bytes)), rest, name)
    }
  })
})
