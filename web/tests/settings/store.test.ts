import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS, SETTINGS_KEY, createSettingsStore, parseSettings } from '../../src/settings/store.ts'

/** A minimal in-memory Storage. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

const throwing = (): Storage => {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

describe('parseSettings', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      emphasiseRows: true,
      highContrast: false,
      focusMode: false,
      colourLibrary: 'dmc',
      yarnPerStitchCm: 2.5,
      ballMetres: null,
      marginPercent: 10,
      units: 'metric',
    })
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps the colour library and yarn inputs only when they make sense', () => {
    expect(
      parseSettings(
        '{"colourLibrary":"stylecraft-special-dk","yarnPerStitchCm":3,"ballMetres":276,"marginPercent":0,"units":"imperial"}',
      ),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      colourLibrary: 'stylecraft-special-dk',
      yarnPerStitchCm: 3,
      ballMetres: 276,
      marginPercent: 0,
      units: 'imperial',
    })
    expect(
      parseSettings('{"colourLibrary":"acme","yarnPerStitchCm":0,"ballMetres":-1,"marginPercent":-5,"units":"cubits"}'),
    ).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{"yarnPerStitchCm":"2","ballMetres":null,"marginPercent":null}')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps well-typed known fields and ignores the rest', () => {
    expect(parseSettings('{"highContrast":true,"focusMode":"yes","other":1}')).toEqual({
      ...DEFAULT_SETTINGS,
      highContrast: true,
    })
  })

  it('falls back to the defaults on junk', () => {
    for (const raw of ['', 'not json', 'null', '42', '[true]']) expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('createSettingsStore', () => {
  it('reads, writes and notifies', () => {
    const storage = memoryStorage({ [SETTINGS_KEY]: '{"focusMode":true}' })
    const store = createSettingsStore(() => storage)
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, focusMode: true })

    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.set({ highContrast: true })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)).toEqual({
      ...DEFAULT_SETTINGS,
      emphasiseRows: true,
      highContrast: true,
      focusMode: true,
    })
    unsubscribe()
    store.set({ highContrast: false })
    expect(listener).toHaveBeenCalledTimes(1)

    // A fresh store (a reload) sees what was written.
    expect(createSettingsStore(() => storage).get().highContrast).toBe(false)
    expect(createSettingsStore(() => storage).get().focusMode).toBe(true)
  })

  it('returns a stable object between changes (for useSyncExternalStore)', () => {
    const store = createSettingsStore(() => memoryStorage())
    expect(store.get()).toBe(store.get())
  })

  it('works with no storage at all', () => {
    for (const get of [() => null, () => undefined, throwing]) {
      const store = createSettingsStore(get)
      expect(store.get()).toEqual(DEFAULT_SETTINGS)
      store.set({ highContrast: true })
      expect(store.get().highContrast).toBe(true) // kept for the session
    }
  })

  it('survives getItem and setItem throwing', () => {
    const storage = memoryStorage()
    storage.getItem = () => {
      throw new Error('blocked')
    }
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    const store = createSettingsStore(() => storage)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(() => store.set({ focusMode: true })).not.toThrow()
    expect(store.get().focusMode).toBe(true)
  })
})
