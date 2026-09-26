/**
 * The TypeScript nearest-shade match against the Python's, over the same tables:
 * fixtures/yarn_nearest.json (scripts/gen_yarn_fixture.py) records palette.srgb_to_lab
 * and np.argmin(np.linalg.norm(...)) for 1,000 random colours, a grey ramp and every
 * shade's own hex.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { hexToLab } from '../../src/logic/lab.ts'
import { LIBRARY_IDS, loadLibrary, type LibraryId } from '../../src/yarn/libraries.ts'
import { matcher, nearestShade } from '../../src/yarn/match.ts'

interface Fixture {
  shades: Record<LibraryId, number>
  colours: string[]
  lab: [number, number, number][]
  nearest: Record<LibraryId, number[]>
}

const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/yarn_nearest.json', import.meta.url), 'utf-8')) as Fixture

describe('Lab conversion', () => {
  it('matches palette.srgb_to_lab for every fixture colour', () => {
    let worst = 0
    fixture.colours.forEach((hex, i) => {
      const lab = hexToLab(hex)
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(lab[k]! - fixture.lab[i]![k]!))
    })
    // Equal to the last bits: numpy's matmul and pow round a little differently from JS.
    expect(worst).toBeLessThan(1e-12)
  })
})

describe('nearestShade', () => {
  it.each(LIBRARY_IDS)('%s: the same shade as the Python for every fixture colour', async (id) => {
    const lib = await loadLibrary(id)
    expect(lib.shades).toHaveLength(fixture.shades[id])
    const m = matcher(lib)
    const got = fixture.colours.map((hex) => nearestShade(m, hex).index)
    expect(got).toEqual(fixture.nearest[id])
  })

  it('finds a shade at distance 0 from its own hex', async () => {
    const m = matcher(await loadLibrary('stylecraft-special-dk'))
    const white = nearestShade(m, '#E2E2E3')
    expect(white).toMatchObject({ shade: { code: '1001', name: 'White' }, index: 0, deltaE: 0 })
  })

  it('takes the first of equally near shades, as np.argmin does', () => {
    const m = matcher({
      id: 'dmc',
      brand: 'Test',
      yarn: 'Test',
      weight: null,
      ball: null,
      attribution: null,
      shades: [
        { code: 'a', name: 'A', hex: '#101010' },
        { code: 'b', name: 'B', hex: '#101010' },
      ],
    })
    expect(nearestShade(m, '#000000').index).toBe(0)
  })

  it('refuses an empty library', () => {
    const m = matcher({ id: 'dmc', brand: '', yarn: '', weight: null, ball: null, attribution: null, shades: [] })
    expect(() => nearestShade(m, '#000000')).toThrow(RangeError)
  })
})
