import 'fake-indexeddb/auto'

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DESKTOP_DIR, readArchives } from '../../scripts/alphaFixtures.ts'
import { emptyProgress, type Project } from '../../src/model/types.ts'
import { AlphaFormatError, readAlpha } from '../../src/storage/alpha.ts'
import * as db from '../../src/storage/db.ts'
import { ProjectNotFoundError, ProjectRepo } from '../../src/storage/repo.ts'

const blobBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

function project(id: string, name = id): Project {
  return {
    stage: 'work',
    pattern: {
      id,
      name,
      created_at: 1,
      updated_at: 1,
      rows: 2,
      cols: 2,
      row_ids: [`${id}-0`, `${id}-1`],
      cells: Uint16Array.from([0, 1, 1, 0]),
      palette: [{ id: 'a', hex: '#ffffff', name: 'White', dmc: null, count: 4 }],
      start_direction: 'RTL',
      alternate_direction: true,
      bottom_up: true,
    },
    progress: emptyProgress(),
  }
}

let seq = 0
let now = 1000
let repo: ProjectRepo

beforeEach(async () => {
  now = 1000
  repo = await ProjectRepo.open(`test-${++seq}`, () => now)
})

afterEach(() => repo.close())

describe('db', () => {
  it('creates both stores and lists summaries newest first', async () => {
    const d = await db.openAlphaDb(`raw-${++seq}`)
    expect([...d.objectStoreNames].sort()).toEqual(['projects', 'summaries'])
    const s = (id: string, updated_at: number): db.ProjectSummary => ({
      id,
      name: id,
      rows: 1,
      cols: 1,
      progress_pct: 0,
      updated_at,
      thumbnail: new Blob(),
      thumbnail_kind: 'cells',
    })
    await db.putProject(d, new Blob(['a']), s('old', 1))
    await db.putProject(d, new Blob(['c']), s('new', 3))
    await db.putProject(d, new Blob(['b']), s('mid', 2))
    expect((await db.listSummaries(d)).map((x) => x.id)).toEqual(['new', 'mid', 'old'])
    await db.deleteProject(d, 'mid')
    expect(await db.getArchive(d, 'mid')).toBeUndefined()
    expect(await db.getSummary(d, 'mid')).toBeUndefined()
    d.close()
  })
})

describe('ProjectRepo', () => {
  it('saves, stamps updated_at, and opens the project again', async () => {
    const p = project('fox')
    now = 1234.5
    const saved = await repo.save(p)
    expect(saved.pattern.updated_at).toBe(1234.5)
    expect(p.pattern.updated_at).toBe(1) // argument untouched
    const opened = await repo.open('fox')
    expect(opened.project).toEqual(saved)
    expect(opened.sourcePng).toBeNull()
  })

  it('lists summaries without opening archives, most recent first', async () => {
    now = 10
    await repo.save(project('a', 'Alpha'))
    now = 30
    const b = await repo.save(project('b', 'Beta'))
    now = 20
    await repo.save(project('c', 'Gamma'))
    expect((await repo.list()).map((s) => s.id)).toEqual(['b', 'c', 'a'])

    // Re-saving updates the summary in place and moves it to the top.
    now = 5
    await repo.save({ ...b, progress: { ...b.progress, completed_row_ids: new Set(['b-0']) } })
    now = 40
    await repo.save(project('a', 'Alpha'))
    const list = await repo.list()
    expect(list.map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(list.find((s) => s.id === 'b')).toMatchObject({
      name: 'Beta',
      rows: 2,
      cols: 2,
      progress_pct: 50,
      updated_at: 5,
      thumbnail_kind: 'cells', // no source image: the pattern's own cells
    })
  })

  it('keeps the stored source.png when a save does not pass one', async () => {
    const png = Uint8Array.from([137, 80, 78, 71])
    const saved = await repo.save(project('fox'), { sourcePng: png })
    expect((await repo.list())[0]!.thumbnail).not.toBeNull()
    await repo.save({ ...saved, stage: 'design' })
    expect((await repo.open('fox')).sourcePng).toEqual(png)
    await repo.save(saved, { sourcePng: null })
    expect((await repo.open('fox')).sourcePng).toBeNull()
    expect((await repo.list())[0]!.thumbnail_kind).toBe('cells')
  })

  it('imports a desktop .alpha file as-is and exports the same bytes', async () => {
    const bytes = readArchives(DESKTOP_DIR)['with-source.alpha']!
    const { project: p, replaced, sourcePng } = await repo.importFile(new Blob([bytes]))
    expect(replaced).toBe(false)
    expect(sourcePng).not.toBeNull()

    const [summary] = await repo.list()
    expect(summary).toMatchObject({ id: p.pattern.id, name: 'with-source', rows: 6, cols: 8 })
    expect(summary!.progress_pct).toBeCloseTo((100 * 2) / 6)
    expect(summary!.updated_at).toBe(p.pattern.updated_at) // importing isn't an edit
    // A source already under THUMB_MAX_EDGE is its own thumbnail, byte for byte.
    expect(summary!.thumbnail_kind).toBe('photo')
    expect(await blobBytes(summary!.thumbnail)).toEqual(sourcePng)

    const { blob, filename } = await repo.exportFile(p.pattern.id)
    expect(await blobBytes(blob)).toEqual(bytes)
    expect(filename).toBe(`with-source-${p.pattern.id.slice(0, 6)}.alpha`)

    expect((await repo.importFile(bytes)).replaced).toBe(true)
    expect(await repo.list()).toHaveLength(1)
  })

  it('refuses a newer-format file and stores nothing', async () => {
    const bytes = readArchives(DESKTOP_DIR)['newer-format.alpha']!
    await expect(repo.importFile(bytes)).rejects.toThrow(AlphaFormatError)
    expect(await repo.list()).toEqual([])
  })

  it('refuses a damaged file and stores nothing', async () => {
    const files = unzipSync(readArchives(DESKTOP_DIR)['basic.alpha']!)
    files['pattern.json'] = strToU8(strFromU8(files['pattern.json']!).slice(0, -5))
    await expect(repo.importFile(zipSync(files))).rejects.toThrow(/pattern\.json is not valid JSON/)
    expect(await repo.list()).toEqual([])
  })

  it('exported files open through the .alpha reader', async () => {
    await repo.save(project('fox'))
    const { blob } = await repo.exportFile('fox')
    expect(readAlpha(await blobBytes(blob)).project.pattern.id).toBe('fox')
  })

  it('deletes a project from both stores', async () => {
    await repo.save(project('fox'))
    await repo.delete('fox')
    expect(await repo.list()).toEqual([])
    await expect(repo.open('fox')).rejects.toThrow(ProjectNotFoundError)
    await expect(repo.exportFile('fox')).rejects.toThrow(ProjectNotFoundError)
  })
})

describe('change events', () => {
  it('announce every save, import and delete, after it is stored', async () => {
    // Each announcement starts a listing at once, as the Library does. The listings are
    // recorded synchronously and each awaited on its own, so their callbacks landing late
    // or out of order can't matter.
    const listings: Promise<string[]>[] = []
    const off = repo.subscribe(() => listings.push(repo.list().then((l) => l.map((s) => s.id))))
    await repo.save(project('a'))
    expect(listings).toHaveLength(1)
    expect(await listings[0]).toEqual(['a'])
    await repo.importFile(readArchives(DESKTOP_DIR)['basic.alpha']!)
    expect(listings).toHaveLength(2)
    expect(await listings[1]).toHaveLength(2)
    await repo.delete('a')
    expect(listings).toHaveLength(3)
    expect(await listings[2]).not.toContain('a')

    off()
    await repo.save(project('b'))
    expect(listings).toHaveLength(3)
  })

  it('keep going when a listener throws', async () => {
    let called = 0
    repo.subscribe(() => {
      throw new Error('boom')
    })
    repo.subscribe(() => void called++)
    await expect(repo.save(project('a'))).resolves.toBeTruthy()
    expect(called).toBe(1)
  })

  it('are not sent for a failed import', async () => {
    let called = 0
    repo.subscribe(() => void called++)
    await expect(repo.importFile(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    expect(called).toBe(0)
  })
})

describe('rename', () => {
  it('saves the new name and keeps the rest', async () => {
    const saved = await repo.save({ ...project('a', 'Old'), stage: 'design' })
    now = 2000
    const renamed = await repo.rename('a', 'New')
    expect(renamed.pattern.name).toBe('New')
    expect(renamed.stage).toBe('design')
    expect(renamed.pattern.updated_at).toBe(2000)
    const { project: reopened } = await repo.open('a')
    expect(reopened.pattern.name).toBe('New')
    expect(reopened.pattern.row_ids).toEqual(saved.pattern.row_ids)
    expect((await repo.summary('a'))!.name).toBe('New')
    await expect(repo.rename('nope', 'x')).rejects.toThrow(ProjectNotFoundError)
  })
})
