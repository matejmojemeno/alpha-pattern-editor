import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensurePersisted, resetPersistRequest } from '../../src/app/persist.ts'
import { parseHash, paths } from '../../src/app/router.ts'

describe('parseHash', () => {
  it('maps every route', () => {
    expect(parseHash('')).toEqual({ name: 'landing' })
    expect(parseHash('#')).toEqual({ name: 'landing' })
    expect(parseHash('#/')).toEqual({ name: 'landing' })
    expect(parseHash('#/library')).toEqual({ name: 'library' })
    expect(parseHash('#/library/')).toEqual({ name: 'library' })
    expect(parseHash('#/settings')).toEqual({ name: 'settings' })
    expect(parseHash('#/work/abc123')).toEqual({ name: 'work', id: 'abc123' })
  })

  it('round-trips ids through paths.work', () => {
    for (const id of ['f17aaabc20bfe045075927934fed52d2', 'a b/c?d#e', 'ünï']) {
      expect(parseHash(`#${paths.work(id)}`)).toEqual({ name: 'work', id })
    }
  })

  it('treats anything else as not found', () => {
    for (const h of ['#/work', '#/work/', '#/work/a/b', '#/nope', '#/work/%E0%A4%A']) {
      expect(parseHash(h)).toEqual({ name: 'notFound' })
    }
  })
})

describe('ensurePersisted', () => {
  afterEach(() => resetPersistRequest())

  it('asks once, and not at all when already persisted', async () => {
    const persist = vi.fn(async () => true)
    const storage = { persist, persisted: async () => false } as unknown as StorageManager
    expect(await ensurePersisted(storage)).toBe(true)
    expect(await ensurePersisted(storage)).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)

    resetPersistRequest()
    const persist2 = vi.fn(async () => true)
    expect(await ensurePersisted({ persist: persist2, persisted: async () => true } as unknown as StorageManager)).toBe(true)
    expect(persist2).not.toHaveBeenCalled()
  })

  it('copes with no API and with a throwing one', async () => {
    expect(await ensurePersisted(undefined)).toBe(false)
    resetPersistRequest()
    const throwing = {
      persisted: () => Promise.reject(new Error('nope')),
      persist: () => Promise.reject(new Error('nope')),
    } as unknown as StorageManager
    expect(await ensurePersisted(throwing)).toBe(false)
  })
})
