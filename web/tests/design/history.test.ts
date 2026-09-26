import { describe, expect, it } from 'vitest'

import { emptyHistory, record, redo, undo, UNDO_CAP } from '../../src/design/history.ts'
import { newPattern, setCell } from '../../src/logic/edit.ts'
import type { Pattern } from '../../src/model/types.ts'

const base = newPattern(4, 4, '#ffffff')
/** Distinct patterns p0, p1, ... */
const versions = (n: number, from: Pattern = base): Pattern[] => {
  const out = [from]
  for (let i = 1; i < n; i++) out.push(setCell(out[i - 1]!, i % 4, (i >> 2) % 4, i))
  return out
}

describe('history', () => {
  it('undoes and redoes in order, and a new edit forgets the undone', () => {
    const [p0, p1, p2] = versions(3)
    let h = record(emptyHistory, p0!) // p0 -> p1
    h = record(h, p1!) // p1 -> p2
    const u1 = undo(h, p2!)!
    expect(u1.pattern).toBe(p1)
    const u2 = undo(u1.history, u1.pattern)!
    expect(u2.pattern).toBe(p0)
    expect(undo(u2.history, u2.pattern)).toBeNull()
    const r1 = redo(u2.history, u2.pattern)!
    expect(r1.pattern).toBe(p1)
    // An edit after undo: the redo of p2 is gone.
    const h2 = record(r1.history, r1.pattern)
    expect(h2.future).toEqual([])
    expect(redo(h2, p0!)).toBeNull()
  })

  it(`keeps at most ${UNDO_CAP} steps, dropping the oldest`, () => {
    const vs = versions(UNDO_CAP + 6)
    let h = emptyHistory
    for (const p of vs.slice(0, -1)) h = record(h, p)
    expect(h.past).toHaveLength(UNDO_CAP)
    expect(h.past[0]).toBe(vs[5])
  })

  it('stops at a byte budget, but always keeps the latest step', () => {
    const vs = versions(10)
    const each = base.cells.byteLength
    let h = emptyHistory
    for (const p of vs) h = record(h, p, UNDO_CAP, each * 3)
    expect(h.past).toEqual(vs.slice(-3))
    const big = record(emptyHistory, vs[0]!, UNDO_CAP, 1)
    expect(big.past).toHaveLength(1)
  })
})
