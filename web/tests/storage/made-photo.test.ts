/**
 * The photo of the finished piece: made.jpg in the `.alpha` archive, kept by every save
 * that doesn't change it, left out of a Make again copy, and the Library's thumbnail.
 */
import 'fake-indexeddb/auto'

import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DESKTOP_DIR, readArchives } from '../../scripts/alphaFixtures.ts'
import { emptyProgress, type Project } from '../../src/model/types.ts'
import { MADE_PHOTO_ENTRY, readAlpha, writeAlpha } from '../../src/storage/alpha.ts'
import { ProjectRepo } from '../../src/storage/repo.ts'

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
      craft: 'tapestry',
      filet_mesh: 'ch2-dc',
    },
    progress: emptyProgress(),
  }
}

const finished = (p: Project): Project => ({ ...p, progress: { ...p.progress, completed_row_ids: new Set(p.pattern.row_ids) } })
const jpeg = (tag: string) => Uint8Array.from([0xff, 0xd8, ...new TextEncoder().encode(tag), 0xff, 0xd9])
/** A PNG header claiming 4000×3000, so its thumbnail goes through the downscaler. */
function bigPng(): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, 4000)
  new DataView(b.buffer).setUint32(20, 3000)
  return b
}

describe('made.jpg in the archive', () => {
  it('is written only when given, and read back byte for byte', () => {
    const photo = jpeg('fox')
    const { bytes } = writeAlpha(project('fox'), { madePhoto: photo })
    expect(Object.keys(unzipSync(bytes))).toContain(MADE_PHOTO_ENTRY)
    expect(readAlpha(bytes).madePhoto).toEqual(photo)
    expect(Object.keys(unzipSync(writeAlpha(project('fox')).bytes))).not.toContain(MADE_PHOTO_ENTRY)
    expect(readAlpha(writeAlpha(project('fox')).bytes).madePhoto).toBeNull()
  })

  it('is absent from every desktop file', () => {
    for (const [name, bytes] of Object.entries(readArchives(DESKTOP_DIR))) {
      if (name === 'newer-format.alpha') continue
      expect(readAlpha(bytes).madePhoto, name).toBeNull()
    }
  })
})

let seq = 0
let repo: ProjectRepo
let downscaled: string[]

beforeEach(async () => {
  downscaled = []
  // The fake downscaler says which image it was given, so the thumbnail shows its source.
  repo = await ProjectRepo.open(`made-${++seq}`, () => 1000, {
    downscale: async (img) => {
      const tag = img[0] === 0xff ? `made:${new TextDecoder().decode(img.subarray(2, -2))}` : 'source'
      downscaled.push(tag)
      return new Blob([tag], { type: 'image/jpeg' })
    },
  })
})

afterEach(() => repo.close())

describe('ProjectRepo and the photo of what was made', () => {
  it('stores it, makes it the thumbnail, and says so in the summary', async () => {
    await repo.save(finished(project('fox')), { sourcePng: bigPng() })
    expect((await repo.summary('fox'))!.made_photo).toBe(false)

    await repo.setMadePhoto('fox', jpeg('blanket'))
    const s = (await repo.summary('fox'))!
    expect(s.made_photo).toBe(true)
    expect(s.thumbnail_kind).toBe('made')
    expect(await s.thumbnail.text()).toBe('made:blanket')
    expect(await repo.madePhoto('fox')).toEqual(jpeg('blanket'))
    // Everything else stays as it was stored.
    const { project: p, sourcePng } = await repo.open('fox')
    expect(p.progress.completed_row_ids.size).toBe(2)
    expect(sourcePng).toEqual(bigPng())
  })

  it('is kept by saves, renames and imports of the export, without decoding it again', async () => {
    const saved = await repo.save(finished(project('fox')))
    await repo.setMadePhoto('fox', jpeg('blanket'))
    const calls = downscaled.length
    await repo.save({ ...saved, stage: 'design' })
    await repo.rename('fox', 'Fox blanket')
    expect(await repo.madePhoto('fox')).toEqual(jpeg('blanket'))
    expect(downscaled.length).toBe(calls)
    expect(await (await repo.summary('fox'))!.thumbnail.text()).toBe('made:blanket')

    const { blob } = await repo.exportFile('fox')
    await repo.delete('fox')
    await repo.importFile(blob)
    expect(await repo.madePhoto('fox')).toEqual(jpeg('blanket'))
    expect((await repo.summary('fox'))!.made_photo).toBe(true)
  })

  it('is replaced, and removed back to the thumbnail it had before', async () => {
    await repo.save(finished(project('fox')), { sourcePng: bigPng() })
    await repo.setMadePhoto('fox', jpeg('one'))
    await repo.setMadePhoto('fox', jpeg('two'))
    expect(await repo.madePhoto('fox')).toEqual(jpeg('two'))
    expect(await (await repo.summary('fox'))!.thumbnail.text()).toBe('made:two')

    await repo.setMadePhoto('fox', null)
    const s = (await repo.summary('fox'))!
    expect(await repo.madePhoto('fox')).toBeNull()
    expect(s.made_photo).toBe(false)
    expect(s.thumbnail_kind).toBe('photo')
    expect(await s.thumbnail.text()).toBe('source')
    expect(Object.keys(unzipSync(new Uint8Array(await (await repo.exportFile('fox')).blob.arrayBuffer())))).not.toContain(
      MADE_PHOTO_ENTRY,
    )
  })

  it('without a source image, removing it goes back to the cells', async () => {
    await repo.save(finished(project('fox')))
    await repo.setMadePhoto('fox', jpeg('one'))
    await repo.setMadePhoto('fox', null)
    expect((await repo.summary('fox'))!.thumbnail_kind).toBe('cells')
  })

  it('falls back to the cells when the photo cannot be downscaled, still knowing it has one', async () => {
    const failing = await ProjectRepo.open(`made-${++seq}`, () => 1000, {
      downscale: async () => {
        throw new Error('no canvas')
      },
    })
    await failing.save(finished(project('fox')))
    await failing.setMadePhoto('fox', jpeg('one'))
    const s = (await failing.summary('fox'))!
    expect(s.thumbnail_kind).toBe('cells')
    expect(s.made_photo).toBe(true)
    failing.close()
  })

  it('is not carried into a Make again copy, and stays on the original', async () => {
    await repo.save(finished(project('fox')), { sourcePng: bigPng() })
    await repo.setMadePhoto('fox', jpeg('blanket'))
    const copy = await repo.copy('fox', 'fox (2)')
    expect(await repo.madePhoto(copy.pattern.id)).toBeNull()
    expect((await repo.summary(copy.pattern.id))!.made_photo).toBe(false)
    expect((await repo.open(copy.pattern.id)).sourcePng).toEqual(bigPng())
    expect(await repo.madePhoto('fox')).toEqual(jpeg('blanket'))
  })

  it('survives a save that started at the same moment (the Work stage autosaving)', async () => {
    const saved = await repo.save(project('fox'))
    const done = finished(saved)
    // Without the writes queued one after another, the save reads the archive before
    // the photo is stored, and writes it back without one.
    await Promise.all([repo.setMadePhoto('fox', jpeg('blanket')), repo.save(done)])
    expect(await repo.madePhoto('fox')).toEqual(jpeg('blanket'))
    expect((await repo.open('fox')).project.progress.completed_row_ids.size).toBe(2)
  })

  it('a failed write does not stop the next one', async () => {
    await expect(repo.setMadePhoto('nobody', jpeg('x'))).rejects.toThrow()
    await repo.save(project('nobody'))
    await repo.setMadePhoto('nobody', jpeg('x'))
    expect(await repo.madePhoto('nobody')).toEqual(jpeg('x'))
  })
})
