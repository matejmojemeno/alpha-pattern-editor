import { describe, expect, it } from 'vitest'

import { changesOrder, countOf, craftOf, CRAFTS, DEFAULT_CRAFT, isCraftId, withCraft } from '../../src/craft/crafts.ts'
import { newPattern } from '../../src/logic/edit.ts'
import { PATTERN_DEFAULTS } from '../../src/model/types.ts'

const base = newPattern(3, 2, '#ffffff', { now: 1 })

describe('crafts', () => {
  it('has unique ids, and tapestry crochet is the default a new pattern has', () => {
    expect(new Set(CRAFTS.map((c) => c.id)).size).toBe(CRAFTS.length)
    expect(DEFAULT_CRAFT).toBe(PATTERN_DEFAULTS.craft)
    expect(base.craft).toBe(DEFAULT_CRAFT)
  })

  it("tapestry crochet's order is the order a new pattern already has", () => {
    expect(changesOrder(base, 'tapestry')).toBe(false)
    expect(withCraft(base, 'tapestry')).toEqual(base)
  })

  it('reads an id it does not know as tapestry crochet, without changing it', () => {
    const p = { ...base, craft: 'from-a-newer-build' }
    expect(isCraftId(p.craft)).toBe(false)
    expect(craftOf(p).id).toBe('tapestry')
    expect(p.craft).toBe('from-a-newer-build')
  })

  it('sets the reading order its source gives', () => {
    const knit = withCraft(base, 'stranded-knit')
    expect([knit.bottom_up, knit.start_direction, knit.alternate_direction]).toEqual([true, 'RTL', true])
    const bracelet = withCraft(base, 'bracelet')
    expect([bracelet.bottom_up, bracelet.start_direction, bracelet.alternate_direction]).toEqual([false, 'LTR', true])
    expect(bracelet.craft).toBe('bracelet')
    expect(changesOrder(base, 'bracelet')).toBe(true)
  })

  it('leaves what its source does not settle as the pattern has it', () => {
    for (const p of [base, { ...base, bottom_up: false, start_direction: 'LTR' as const }]) {
      const loom = withCraft(p, 'bead-loom')
      expect(loom.alternate_direction).toBe(false)
      expect([loom.bottom_up, loom.start_direction]).toEqual([p.bottom_up, p.start_direction])
    }
  })

  it('shows carrying for tapestry crochet only', () => {
    expect(CRAFTS.filter((c) => c.carries).map((c) => c.id)).toEqual(['tapestry'])
  })

  it('counts in its own unit', () => {
    expect(countOf(craftOf(base), 1)).toBe('1 stitch')
    expect(countOf(craftOf({ craft: 'bracelet' }), 3)).toBe('3 knots')
    expect(countOf(craftOf({ craft: 'bead-loom' }), 0)).toBe('0 beads')
  })
})
