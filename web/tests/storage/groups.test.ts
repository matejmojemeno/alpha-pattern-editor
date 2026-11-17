import 'fake-indexeddb/auto'

import { strFromU8, unzipSync } from 'fflate'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { emptyProgress, type Project } from '../../src/model/types.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import * as db from '../../src/storage/db.ts'
import { GroupFileError, readGroupFile, writeGroupFile } from '../../src/storage/groupFile.ts'
import { GroupNotFoundError, ProjectRepo } from '../../src/storage/repo.ts'

const blobBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

function project(id: string, name = id, rows = 2, cols = 2): Project {
  return {
    stage: 'work',
    pattern: {
      id,
      name,
      created_at: 1,
      updated_at: 1,
      rows,
      cols,
      row_ids: Array.from({ length: rows }, (_, i) => `${id}-${i}`),
      cells: new Uint16Array(rows * cols),
      palette: [{ id: 'a', hex: '#ffffff', name: 'White', dmc: null, count: rows * cols }],
      start_direction: 'RTL',
      alternate_direction: true,
      bottom_up: true,
      craft: 'tapestry',
      filet_mesh: 'ch2-dc',
    },
    progress: emptyProgress(),
  }
}

let seq = 0
let now = 1000
let repo: ProjectRepo

beforeEach(async () => {
  now = 1000
  repo = await ProjectRepo.open(`groups-${++seq}`, () => now)
})

afterEach(() => repo.close())

const ids = (g: { pieces: { id: string }[] } | undefined) => g?.pieces.map((p) => p.id)

describe('projects with pieces', () => {
  it('makes a project labelled with the patterns’ names, and finds it by a piece', async () => {
    await repo.save(project('f', 'Front'))
    await repo.save(project('b', 'Back'))
    now = 2000
    const g = await repo.createGroup('Sweater', ['f', 'b'])
    expect(g).toMatchObject({ name: 'Sweater', pieces: [{ id: 'f', label: 'Front' }, { id: 'b', label: 'Back' }], created_at: 2000 })
    expect((await repo.groupOf('b'))?.id).toBe(g.id)
    expect(await repo.groupOf('nope')).toBeUndefined()
    expect(await repo.groups()).toHaveLength(1)
  })

  it('leaves out patterns that aren’t stored, and repeats', async () => {
    await repo.save(project('f'))
    const g = await repo.createGroup('S', ['f', 'ghost', 'f'])
    expect(ids(g)).toEqual(['f'])
  })

  it('a pattern is a piece of one project at most: adding it moves it, and an emptied project goes', async () => {
    for (const id of ['a', 'b', 'c']) await repo.save(project(id))
    const one = await repo.createGroup('One', ['a', 'b'])
    const two = await repo.createGroup('Two', ['c'])
    await repo.addPieces(two.id, ['a'])
    expect(ids(await repo.group(one.id))).toEqual(['b'])
    expect(ids(await repo.group(two.id))).toEqual(['c', 'a'])
    // A new project taking the last piece of another removes that one.
    await repo.createGroup('Three', ['b'])
    expect(await repo.group(one.id)).toBeUndefined()
  })

  it('adding a piece that is already there keeps its place', async () => {
    for (const id of ['a', 'b']) await repo.save(project(id))
    const g = await repo.createGroup('G', ['a', 'b'])
    expect(ids(await repo.addPieces(g.id, ['a']))).toEqual(['a', 'b'])
  })

  it('moves, relabels and renames, stamping updated_at', async () => {
    for (const id of ['a', 'b', 'c']) await repo.save(project(id))
    const g = await repo.createGroup('G', ['a', 'b', 'c'])
    now = 3000
    expect(ids(await repo.movePiece(g.id, 'c', 0))).toEqual(['c', 'a', 'b'])
    expect(ids(await repo.movePiece(g.id, 'c', 99))).toEqual(['a', 'b', 'c'])
    expect(ids(await repo.movePiece(g.id, 'a', 1))).toEqual(['b', 'a', 'c'])
    const relabelled = await repo.relabelPiece(g.id, 'a', 'Sleeve')
    expect(relabelled?.pieces.find((p) => p.id === 'a')?.label).toBe('Sleeve')
    expect((await repo.open('a')).project.pattern.name).toBe('a') // the pattern keeps its name
    const renamed = await repo.renameGroup(g.id, 'Jumper')
    expect(renamed).toMatchObject({ name: 'Jumper', updated_at: 3000 })
  })

  it('two quick edits at once both land', async () => {
    for (const id of ['a', 'b', 'c']) await repo.save(project(id))
    const g = await repo.createGroup('G', ['a', 'b', 'c'])
    await Promise.all([repo.relabelPiece(g.id, 'a', 'A!'), repo.renameGroup(g.id, 'New'), repo.removePiece(g.id, 'c')])
    const after = await repo.group(g.id)
    expect(after?.name).toBe('New')
    expect(after?.pieces).toEqual([
      { id: 'a', label: 'A!' },
      { id: 'b', label: 'b' },
    ])
  })

  it('removing the last piece removes the project; ungrouping keeps every pattern', async () => {
    for (const id of ['a', 'b']) await repo.save(project(id))
    const g = await repo.createGroup('G', ['a'])
    await repo.removePiece(g.id, 'a')
    expect(await repo.group(g.id)).toBeUndefined()
    const h = await repo.createGroup('H', ['a', 'b'])
    await repo.ungroup(h.id)
    expect(await repo.groups()).toEqual([])
    expect((await repo.list()).map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  it('an edit to a project that is gone throws, and changes nothing', async () => {
    await expect(repo.renameGroup('gone', 'x')).rejects.toBeInstanceOf(GroupNotFoundError)
    expect(await repo.groups()).toEqual([])
  })

  it('deleting a pattern takes it out of its project, and the last one removes the project', async () => {
    for (const id of ['a', 'b']) await repo.save(project(id))
    const g = await repo.createGroup('G', ['a', 'b'])
    await repo.delete('a')
    expect(ids(await repo.group(g.id))).toEqual(['b'])
    await repo.delete('b')
    expect(await repo.groups()).toEqual([])
  })

  it('tells subscribers about every change to a project', async () => {
    await repo.save(project('a'))
    let told = 0
    repo.subscribe(() => told++)
    const g = await repo.createGroup('G', ['a'])
    await repo.renameGroup(g.id, 'H')
    await repo.ungroup(g.id)
    expect(told).toBe(3)
  })

  it('exports one zip of project.json and every piece’s .alpha exactly as stored, and imports it back', async () => {
    await repo.save(project('f', 'Front', 3, 4))
    await repo.save(project('b', 'Back'))
    const g = await repo.createGroup('Sweater', ['f', 'b'])
    await repo.relabelPiece(g.id, 'b', 'The back')
    const { blob, filename } = await repo.exportGroup(g.id)
    expect(filename).toBe(`sweater-${g.id.slice(0, 6)}.zip`)
    const bytes = await blobBytes(blob)
    const files = unzipSync(bytes)
    const manifest = JSON.parse(strFromU8(files['project.json']!))
    expect(manifest).toMatchObject({ format: 'alpha-pattern-editor/project', version: 1, id: g.id, name: 'Sweater' })
    expect(manifest.pieces.map((p: { label: string }) => p.label)).toEqual(['Front', 'The back'])
    // Each piece is the stored archive, byte for byte, and opens on its own.
    for (const [p, id] of [
      [manifest.pieces[0], 'f'],
      [manifest.pieces[1], 'b'],
    ] as const) {
      const stored = await blobBytes((await repo.exportFile(id)).blob)
      expect(files[p.file]).toEqual(stored)
      expect(readAlpha(files[p.file]!).project.pattern.id).toBe(id)
    }

    // Into an empty Library: the patterns, then the project around them.
    const other = await ProjectRepo.open(`groups-${++seq}`, () => now)
    try {
      const read = readGroupFile(bytes)
      const pieces = []
      for (const p of read.pieces) {
        const { project: pr } = await other.importFile(p.bytes)
        pieces.push({ id: pr.pattern.id, label: p.label })
      }
      const back = await other.importGroup({ id: read.id, name: read.name, pieces })
      expect(back).toMatchObject({ id: g.id, name: 'Sweater', pieces: [{ id: 'f', label: 'Front' }, { id: 'b', label: 'The back' }] })
    } finally {
      other.close()
    }
  })

  it('importing a project with the same id replaces it, keeping when it was made', async () => {
    for (const id of ['a', 'b']) await repo.save(project(id))
    now = 1500
    const g = await repo.createGroup('G', ['a', 'b'])
    now = 5000
    const back = await repo.importGroup({ id: g.id, name: 'G again', pieces: [{ id: 'b', label: 'B' }] })
    expect(back).toMatchObject({ name: 'G again', created_at: 1500, updated_at: 5000, pieces: [{ id: 'b', label: 'B' }] })
    expect(await repo.groups()).toHaveLength(1)
  })
})

describe('the database upgrade to version 3', () => {
  it('keeps every archive and summary a version 2 database had, and adds the groups store', async () => {
    const name = `upgrade-${++seq}`
    // A version 2 database, as the app before projects with pieces made it.
    const v2 = await openDB(name, 2, {
      upgrade(d) {
        d.createObjectStore('projects')
        d.createObjectStore('summaries', { keyPath: 'id' }).createIndex('by-updated', 'updated_at')
      },
    })
    const older = await ProjectRepo.open(`src-${++seq}`, () => now)
    await older.save(project('kept', 'Kept'))
    const archive = (await older.exportFile('kept')).blob
    const summary = (await older.summary('kept'))!
    older.close()
    await v2.put('projects', archive, 'kept')
    await v2.put('summaries', summary)
    v2.close()

    const upgraded = await ProjectRepo.open(name, () => now)
    try {
      expect((await upgraded.list()).map((s) => s.name)).toEqual(['Kept'])
      expect((await upgraded.open('kept')).project.pattern.name).toBe('Kept')
      expect(await upgraded.groups()).toEqual([])
      await upgraded.createGroup('New', ['kept'])
      expect(await upgraded.groups()).toHaveLength(1)
    } finally {
      upgraded.close()
    }
    const raw = await db.openAlphaDb(name)
    expect([...raw.objectStoreNames].sort()).toEqual(['groups', 'projects', 'summaries'])
    raw.close()
  })
})

describe('groupFile', () => {
  const piece = (file: string) => ({ label: file, file, bytes: Uint8Array.from([1, 2, 3]) })

  it('reads what it writes, renaming a clashing file', () => {
    const bytes = writeGroupFile({ id: 'g1', name: 'G', pieces: [piece('a.alpha'), piece('a.alpha')] }, new Date(0))
    const read = readGroupFile(bytes)
    expect(read.pieces.map((p) => p.file)).toEqual(['a.alpha', 'a-2.alpha'])
    expect(read.pieces[1]!.bytes).toEqual(Uint8Array.from([1, 2, 3]))
  })

  it('refuses what isn’t a project, a newer version, and a missing piece', () => {
    const code = (f: () => unknown) => {
      try {
        f()
      } catch (e) {
        return e instanceof GroupFileError ? e.code : 'other'
      }
      return 'none'
    }
    expect(code(() => readGroupFile(Uint8Array.from([1, 2, 3])))).toBe('NOT_A_PROJECT')
    const ok = writeGroupFile({ id: 'g', name: 'G', pieces: [piece('a.alpha')] })
    const files = unzipSync(ok)
    const withManifest = (m: unknown, keep = true) => {
      const out: Record<string, Uint8Array> = { 'project.json': new TextEncoder().encode(JSON.stringify(m)) }
      if (keep) out['a.alpha'] = files['a.alpha']!
      return out
    }
    const zip = async () => (await import('fflate')).zipSync
    return zip().then((zipSync) => {
      const base = { format: 'alpha-pattern-editor/project', version: 1, id: 'g', name: 'G', pieces: [{ file: 'a.alpha', label: 'A' }] }
      expect(code(() => readGroupFile(zipSync({ 'other.txt': Uint8Array.from([1]) })))).toBe('NOT_A_PROJECT')
      expect(code(() => readGroupFile(zipSync(withManifest({ ...base, format: 'x' }))))).toBe('NOT_A_PROJECT')
      expect(code(() => readGroupFile(zipSync(withManifest({ ...base, version: 2 }))))).toBe('NEWER_VERSION')
      expect(code(() => readGroupFile(zipSync(withManifest(base, false))))).toBe('CORRUPT')
      expect(code(() => readGroupFile(zipSync(withManifest(base))))).toBe('none')
    })
  })
})
