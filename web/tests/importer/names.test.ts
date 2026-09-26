/**
 * The TypeScript colour names against the Python's: fixtures/colour_names.json
 * (scripts/gen_names_fixture.py) records core/detect/names.py's nearest anchor and
 * CIEDE2000 distance for 2,000 random colours and a grey ramp, and its names for 600
 * palettes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import table from '../../src/importer/colour-names.json'
import { ciede2000, nearestAnchor, simpleNames } from '../../src/importer/names.ts'
import { hexToLab } from '../../src/logic/lab.ts'

interface Fixture {
  colours: string[]
  nearest: [number, number][]
  palettes: { hexes: string[]; names: string[] }[]
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf-8')
const fixture = JSON.parse(read('../../../fixtures/colour_names.json')) as Fixture

describe('the name table', () => {
  it('is the same as detection’s', () => {
    expect(table).toEqual(JSON.parse(read('../../../alphareader/core/detect/colour_names.json')))
  })
})

describe('ciede2000', () => {
  it('matches Sharma, Wu and Dalal’s test data', () => {
    expect(ciede2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4)
    expect(ciede2000([50, 2.49, -0.001], [50, -2.49, 0.0009])).toBeCloseTo(7.1792, 4)
    expect(ciede2000([22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619])).toBeCloseTo(2.0373, 4)
    expect(ciede2000([2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514])).toBeCloseTo(0.9082, 4)
  })
})

describe('nearestAnchor', () => {
  it('picks the same anchor as the Python, at the same distance, for every fixture colour', () => {
    let worst = 0
    const wrong: string[] = []
    fixture.colours.forEach((hex, i) => {
      const [index, d] = fixture.nearest[i]!
      const got = nearestAnchor(hexToLab(hex))
      if (got.index !== index) wrong.push(hex)
      worst = Math.max(worst, Math.abs(got.deltaE - d))
    })
    expect(wrong).toEqual([])
    expect(worst).toBeLessThan(1e-9)
  })
})

describe('simpleNames', () => {
  it('names every fixture palette as the Python does', () => {
    const wrong = fixture.palettes.filter((p) => JSON.stringify(simpleNames(p.hexes)) !== JSON.stringify(p.names))
    expect(wrong).toEqual([])
    expect(fixture.palettes).toHaveLength(600)
  })

  it('keeps a name plain when it is used once, and tells shades apart', () => {
    expect(simpleNames(['#c6e3ee', '#ffffff'])).toEqual(['Blue', 'White'])
    expect(simpleNames(['#8ab8e8', '#1a2a80'])).toEqual(['Light blue', 'Dark blue'])
  })
})
