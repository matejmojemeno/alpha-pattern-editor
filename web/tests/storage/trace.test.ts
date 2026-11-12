/**
 * The Design stage's image to trace: trace.json and trace.png/jpg in the `.alpha`
 * archive, kept by every save that doesn't change it, copied by Make again, and never a
 * reason for a project not to open.
 */
import 'fake-indexeddb/auto'

import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DESKTOP_DIR, readArchives } from '../../scripts/alphaFixtures.ts'
import { emptyProgress, type Project } from '../../src/model/types.ts'
import { TRACE_ENTRY, readAlpha, writeAlpha, type TraceImage } from '../../src/storage/alpha.ts'
import { ProjectRepo } from '../../src/storage/repo.ts'

function project(id: string): Project {
  return {
    stage: 'design',
    pattern: {
      id,
      name: id,
      created_at: 1,
      updated_at: 1,
      rows: 2,
      cols: 2,
      row_ids: [`${id}-0`, `${id}-1`],
      cells: Uint16Array.from([0, 0, 0, 0]),
      palette: [{ id: 'a', hex: '#ffffff', name: 'White', dmc: null, count: 4 }],
      start_direction: 'RTL',
      alternate_direction: true,
      bottom_up: true,
      craft: 'tapestry',
      filet_mesh: 'ch2-dc',
    },
    progress: emptyProgress(),
  }
}

const png = (tag: string) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...new TextEncoder().encode(tag)])
const trace = (tag: string, over: Partial<TraceImage> = {}): TraceImage => ({
  bytes: png(tag),
  type: 'image/png',
  x: -0.5,
  y: 1.25,
  width: 3.5,
  opacity: 0.45,
  shown: true,
  behind: false,
  ...over,
})

/** The archive's entries, with `edit` applied, zipped again. */
function edited(bytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(bytes)
  edit(files)
  return zipSync(files)
}

describe('the image to trace in the archive', () => {
  it('is written only when given, and read back exactly', () => {
    const t = trace('cat')
    const { bytes } = writeAlpha(project('fox'), { trace: t })
    const names = Object.keys(unzipSync(bytes))
    expect(names).toContain(TRACE_ENTRY)
    expect(names).toContain('trace.png')
    expect(readAlpha(bytes).trace).toEqual(t)

    const plain = Object.keys(unzipSync(writeAlpha(project('fox')).bytes))
    expect(plain).not.toContain(TRACE_ENTRY)
    expect(plain.some((n) => n.startsWith('trace'))).toBe(false)
    expect(readAlpha(writeAlpha(project('fox')).bytes).trace).toBeNull()
  })

  it('keeps a JPEG as trace.jpg', () => {
    const t = trace('photo', { type: 'image/jpeg', shown: false, behind: true })
    const { bytes } = writeAlpha(project('fox'), { trace: t })
    expect(Object.keys(unzipSync(bytes))).toContain('trace.jpg')
    expect(readAlpha(bytes).trace).toEqual(t)
  })

  it('leaves out one it cannot read, and still opens the project', () => {
    const { bytes } = writeAlpha(project('fox'), { trace: trace('cat') })
    const damaged = [
      edited(bytes, (f) => (f[TRACE_ENTRY] = strToU8('{not json'))),
      edited(bytes, (f) => delete f['trace.png']),
      edited(bytes, (f) => (f[TRACE_ENTRY] = strToU8('{"file":"trace.gif","x":0,"y":0,"width":2}'))),
      edited(bytes, (f) => (f[TRACE_ENTRY] = strToU8('{"file":"trace.png","x":0,"y":0,"width":0}'))),
      edited(bytes, (f) => (f[TRACE_ENTRY] = strToU8('{"file":"trace.png","x":"a","y":0,"width":2}'))),
      edited(bytes, (f) => (f[TRACE_ENTRY] = strToU8('null'))),
    ]
    for (const b of damaged) {
      const c = readAlpha(b)
      expect(c.trace).toBeNull()
      expect(c.project.pattern.id).toBe('fox')
    }
  })

  it('reads a missing opacity or switch as the defaults, and clamps the opacity', () => {
    const { bytes } = writeAlpha(project('fox'), { trace: trace('cat') })
    const bare = readAlpha(edited(bytes, (f) => (f[TRACE_ENTRY] = strToU8('{"file":"trace.png","x":1,"y":2,"width":3}')))).trace
    expect(bare).toMatchObject({ x: 1, y: 2, width: 3, opacity: 0.5, shown: true, behind: false })
    const loud = readAlpha(edited(bytes, (f) => (f[TRACE_ENTRY] = strToU8('{"file":"trace.png","x":1,"y":2,"width":3,"opacity":7}')))).trace
    expect(loud?.opacity).toBe(1)
  })

  it('is absent from every desktop file', () => {
    for (const [name, bytes] of Object.entries(readArchives(DESKTOP_DIR))) {
      if (name === 'newer-format.alpha') continue
      expect(readAlpha(bytes).trace, name).toBeNull()
    }
  })
})

let seq = 0
let repo: ProjectRepo

beforeEach(async () => {
  repo = await ProjectRepo.open(`trace-${++seq}`, () => 1000, { downscale: async () => new Blob(['t'], { type: 'image/jpeg' }) })
})

afterEach(() => repo.close())

describe('ProjectRepo and the image to trace', () => {
  it('keeps it through saves that leave it out, renames and an export', async () => {
    const saved = await repo.save(project('fox'), { trace: trace('cat') })
    await repo.save({ ...saved, stage: 'work' })
    await repo.rename('fox', 'Fox')
    expect(await repo.trace('fox')).toEqual(trace('cat'))

    const { blob } = await repo.exportFile('fox')
    await repo.delete('fox')
    await repo.importFile(blob)
    expect(await repo.trace('fox')).toEqual(trace('cat'))
  })

  it('is replaced, moved and removed by saves that give it', async () => {
    const saved = await repo.save(project('fox'), { trace: trace('cat') })
    await repo.save(saved, { trace: trace('dog', { x: 4, width: 9 }) })
    expect(await repo.trace('fox')).toEqual(trace('dog', { x: 4, width: 9 }))
    await repo.save(saved, { trace: null })
    expect(await repo.trace('fox')).toBeNull()
  })

  it('goes with a Make again copy, which has no photo of the finished piece', async () => {
    await repo.save(project('fox'), { trace: trace('cat'), madePhoto: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) })
    const copy = await repo.copy('fox', 'Fox (2)')
    expect(await repo.trace(copy.pattern.id)).toEqual(trace('cat'))
    expect(await repo.madePhoto(copy.pattern.id)).toBeNull()
  })
})
