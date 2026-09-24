import { describe, expect, it } from 'vitest'

import { contrastOn, hexToRgb, luma } from '../../src/theme/contrast.ts'

describe('contrastOn', () => {
  it('puts black on light swatches and white on dark ones', () => {
    expect(contrastOn('#ffffff')).toBe('#000000')
    expect(contrastOn('#000000')).toBe('#ffffff')
    expect(contrastOn('#f0a800')).toBe('#000000') // the accent
    expect(contrastOn('#0a7d33')).toBe('#ffffff') // high-contrast primary
    expect(contrastOn('#ff0000')).toBe('#ffffff') // luma 54: pure red is dark
    expect(contrastOn('#00ff00')).toBe('#000000') // luma 182
  })

  it('uses the desktop threshold: luma strictly above 140', () => {
    // luma(#8c8c8c) = 140 exactly (weights sum to 1); the desktop's `> 140` gives white.
    expect(luma('#8c8c8c')).toBeCloseTo(140)
    expect(contrastOn('#8c8c8c')).toBe('#ffffff')
    expect(contrastOn('#8d8d8d')).toBe('#000000')
  })

  it('weighs green far more than blue (Rec. 709 luma, as the desktop does)', () => {
    expect(contrastOn('#00c400')).toBe('#000000') // luma 140.2
    expect(contrastOn('#0000ff')).toBe('#ffffff') // luma 18.4
  })

  it('accepts #rgb and any case', () => {
    expect(hexToRgb('#FfF')).toEqual([255, 255, 255])
    expect(contrastOn('#FFF')).toBe('#000000')
    expect(hexToRgb('#0a7D33')).toEqual([10, 125, 51])
  })

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', 'fff', '#ffff', '#gggggg', 'red']) expect(() => contrastOn(bad)).toThrow(TypeError)
  })
})
