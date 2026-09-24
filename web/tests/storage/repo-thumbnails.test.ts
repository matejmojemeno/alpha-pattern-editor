import 'fake-indexeddb/auto'

import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { DESKTOP_DIR, readArchives } from '../../scripts/alphaFixtures.ts'
import { emptyProgress, type Project } from '../../src/model/types.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { ProjectRepo } from '../../src/storage/repo.ts'

let seq = 0
const clock = () => 1000

function project(id: string): Project {
  return {
    stage: 'work',
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
    },
    progress: emptyProgress(),
  }
}

/** A PNG header claiming the given size; only the IHDR is read before downscaling. */
function fakePng(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  return b
}

describe('Library thumbnails', () => {
  it('stores a downscaled photo, never the full-size source', async () => {
    const calls: number[] = []
    const small = new Blob(['small'], { type: 'image/jpeg' })
    const repo = await ProjectRepo.open(`thumb-${++seq}`, clock, {
      downscale: async (_img, maxEdge) => (calls.push(maxEdge), small),
    })
    const saved = await repo.save(project('fox'), { sourcePng: fakePng(4000, 3000) })
    expect(calls).toEqual([480])
    const summary = (await repo.summary('fox'))!
    expect(summary.thumbnail_kind).toBe('photo')
    expect(await summary.thumbnail.text()).toBe('small')

    // Saving again without touching the image reuses the thumbnail.
    await repo.save({ ...saved, stage: 'design' })
    expect(calls).toEqual([480])
    repo.close()
  })

  it('falls back to the cells when the photo cannot be downscaled', async () => {
    const repo = await ProjectRepo.open(`thumb-${++seq}`, clock, {
      downscale: () => Promise.reject(new Error('no canvas')),
    })
    await repo.save(project('fox'), { sourcePng: fakePng(4000, 3000) })
    const summary = (await repo.summary('fox'))!
    expect(summary.thumbnail_kind).toBe('cells')
    expect(summary.thumbnail.type).toBe('image/png')
    expect(summary.thumbnail.size).toBeLessThan(200)
    repo.close()
  })

  it('calls onStored after successful saves and imports only', async () => {
    let stored = 0
    const repo = await ProjectRepo.open(`stored-${++seq}`, clock, { onStored: () => stored++ })
    await repo.list()
    expect(stored).toBe(0)
    await repo.save(project('fox'))
    await repo.importFile(readArchives(DESKTOP_DIR)['basic.alpha']!)
    await expect(repo.importFile(readArchives(DESKTOP_DIR)['newer-format.alpha']!)).rejects.toThrow()
    expect(stored).toBe(2)
    repo.close()
  })

  it('ignores a throwing onStored', async () => {
    const repo = await ProjectRepo.open(`stored-${++seq}`, clock, {
      onStored: () => {
        throw new Error('nope')
      },
    })
    await expect(repo.save(project('fox'))).resolves.toBeDefined()
    repo.close()
  })
})

describe('upgrading a v1 database', () => {
  it('rebuilds the summaries from the archives', async () => {
    const name = `v1-${++seq}`
    const basic = readArchives(DESKTOP_DIR)['basic.alpha']!
    const withSource = readArchives(DESKTOP_DIR)['with-source.alpha']!
    // The schema as PR #6 shipped it, with a v1-shaped summary.
    const v1 = await openDB(name, 1, {
      upgrade(d) {
        d.createObjectStore('projects')
        d.createObjectStore('summaries', { keyPath: 'id' }).createIndex('by-updated', 'updated_at')
      },
    })
    for (const bytes of [basic, withSource]) {
      const { project: p } = readAlpha(bytes)
      await v1.put('projects', new Blob([bytes as Uint8Array<ArrayBuffer>]), p.pattern.id)
      await v1.put('summaries', { id: p.pattern.id, name: p.pattern.name, thumbnail: null, updated_at: 0 })
    }
    v1.close()

    const repo = await ProjectRepo.open(name)
    const list = await repo.list()
    expect(list.map((s) => [s.name, s.cols, s.rows, s.thumbnail_kind]).sort()).toEqual([
      ['basic', 7, 5, 'cells'],
      ['with-source', 8, 6, 'photo'],
    ])
    expect(await repo.rebuildMissingSummaries()).toBe(0)
    repo.close()
  })

  it('leaves an unreadable archive in place without a summary', async () => {
    const name = `v1-${++seq}`
    const v1 = await openDB(name, 1, {
      upgrade(d) {
        d.createObjectStore('projects')
        d.createObjectStore('summaries', { keyPath: 'id' }).createIndex('by-updated', 'updated_at')
      },
    })
    await v1.put('projects', new Blob(['not a zip']), 'broken')
    v1.close()
    const repo = await ProjectRepo.open(name)
    expect(await repo.list()).toEqual([])
    expect((await repo.exportFile('broken').catch((e: Error) => e.name))).toBe('ProjectNotFoundError')
    repo.close()
  })
})
