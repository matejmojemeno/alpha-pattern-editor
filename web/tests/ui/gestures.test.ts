/** The shared two-finger bookkeeping. */
import { describe, expect, it } from 'vitest'

import { TwoFingers, scrollAbout } from '../../src/ui/gestures.ts'

describe('TwoFingers', () => {
  it('is no pinch with one finger', () => {
    const g = new TwoFingers()
    expect(g.down(1, { x: 0, y: 0 })).toBe(false)
    expect(g.move(1, { x: 5, y: 5 })).toBeNull()
    expect(g.pinching).toBe(false)
    expect(g.up(1)).toBe(true)
  })

  it('becomes a pinch when a second finger lands, and reports scale and pan per step', () => {
    const g = new TwoFingers()
    g.down(1, { x: 0, y: 0 })
    expect(g.down(2, { x: 100, y: 0 })).toBe(true)
    expect(g.pinching).toBe(true)
    // Spread to twice as far apart, about the same midpoint.
    g.move(1, { x: -50, y: 0 })
    const s = g.move(2, { x: 150, y: 0 })!
    expect(s.mid).toEqual({ x: 50, y: 0 })
    expect(s.dx).toBe(25) // back from 25, where moving finger 1 alone left it
    // Scale is relative to the previous step: 150 → 200.
    expect(s.scale).toBeCloseTo(200 / 150)
    // Both move down together: a pan with no scale.
    g.move(1, { x: -50, y: 20 })
    const pan = g.move(2, { x: 150, y: 20 })!
    expect(pan.scale).toBeCloseTo(1, 1)
    expect(pan.dy).toBeCloseTo(10)
  })

  it('stays a pinch until every finger lifts, so the finger left behind does nothing', () => {
    const g = new TwoFingers()
    g.down(1, { x: 0, y: 0 })
    g.down(2, { x: 10, y: 0 })
    expect(g.up(2)).toBe(false)
    expect(g.pinching).toBe(true)
    expect(g.move(1, { x: 30, y: 0 })).toBeNull()
    // Landing again resumes the same pinch; it isn't a new one.
    expect(g.down(3, { x: 50, y: 0 })).toBe(false)
    expect(g.move(3, { x: 80, y: 0 })).not.toBeNull()
    expect(g.up(1)).toBe(false)
    expect(g.up(3)).toBe(true)
    expect(g.pinching).toBe(false)
    expect(g.count).toBe(0)
  })

  it('ignores fingers it never saw', () => {
    const g = new TwoFingers()
    expect(g.move(9, { x: 1, y: 1 })).toBeNull()
    expect(g.up(9)).toBe(false)
  })
})

describe('scrollAbout', () => {
  it('keeps the point under the fingers still', () => {
    // Content point under x=100 at scroll 50 is 150; at 2× it is 300, so scroll 200.
    expect(scrollAbout(50, 100, 2)).toBe(200)
    expect(scrollAbout(0, 100, 0.5)).toBe(0)
  })
})
