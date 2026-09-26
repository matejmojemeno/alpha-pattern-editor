/**
 * The colour libraries in src/yarn/data/ (scripts/import_yarn_libraries.py) and their
 * loader: well-formed, credited, and DMC kept equal to the table detection uses.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DEFAULT_LIBRARY, isLibraryId, LIBRARY_IDS, LIBRARY_LABELS, loadLibrary, shadeLabel } from '../../src/yarn/libraries.ts'

describe('the libraries', () => {
  it.each(LIBRARY_IDS)('%s is well formed', async (id) => {
    const lib = await loadLibrary(id)
    expect(lib.id).toBe(id)
    expect(lib.shades.length).toBeGreaterThan(50)
    for (const s of lib.shades) {
      expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
      expect(s.name.trim()).toBe(s.name)
      expect(s.name).not.toBe('')
      expect(s.code === null || /^\S+$/.test(s.code)).toBe(true)
    }
    // No shade twice, and no two shades claiming the same colour.
    expect(new Set(lib.shades.map((s) => `${s.code} ${s.name}`)).size).toBe(lib.shades.length)
    expect(new Set(lib.shades.map((s) => s.hex)).size).toBe(lib.shades.length)
    expect(LIBRARY_LABELS[id]).toContain(id === 'dmc' ? 'DMC' : lib.yarn)
  })

  it('credits the yarn data as its licence asks, and gives each yarn its ball', async () => {
    for (const id of LIBRARY_IDS.filter((i) => i !== 'dmc')) {
      const lib = await loadLibrary(id)
      expect(lib.attribution).toMatch(/temperature-blanket\.com.*CC BY 4\.0/)
      expect(lib.weight).toBe('DK')
      expect(lib.ball).toEqual({ grams: 100, metres: expect.any(Number) })
    }
  })

  it('DMC is the table detection names colours from', async () => {
    const python = JSON.parse(
      readFileSync(new URL('../../../alphareader/core/detect/dmc.json', import.meta.url), 'utf-8'),
    ) as { code: string; name: string; rgb: [number, number, number] }[]
    const lib = await loadLibrary('dmc')
    expect(lib.shades).toEqual(
      python.map((e) => ({ code: e.code, name: e.name, hex: '#' + e.rgb.map((v) => v.toString(16).padStart(2, '0')).join('') })),
    )
    expect(lib.ball).toBeNull()
  })
})

describe('loadLibrary', () => {
  it('fetches each table once', () => {
    expect(loadLibrary('paintbox-simply-dk')).toBe(loadLibrary('paintbox-simply-dk'))
  })

  it('knows its ids', () => {
    expect(isLibraryId(DEFAULT_LIBRARY)).toBe(true)
    expect(isLibraryId('stylecraft-special-dk')).toBe(true)
    expect(isLibraryId('madeup')).toBe(false)
    expect(isLibraryId(3)).toBe(false)
  })
})

describe('shadeLabel', () => {
  it('puts the number before the name, once', () => {
    expect(shadeLabel({ code: '1001', name: 'White', hex: '#ffffff' })).toBe('1001 White')
    expect(shadeLabel({ code: 'White', name: 'White', hex: '#ffffff' })).toBe('White')
    expect(shadeLabel({ code: null, name: 'Elephant Grey', hex: '#c8c6c5' })).toBe('Elephant Grey')
  })
})
