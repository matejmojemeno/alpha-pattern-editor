/** The colour picker's hex and HSV conversions. */
import { describe, expect, it } from 'vitest'

import { hexToHsv, hsvToHex, parseHex } from '../../src/ui/design/hsv.ts'

describe('hsv', () => {
  it('knows the primaries, black, white and grey', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 1, v: 1 })
    expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 1, v: 1 })
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 })
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 1 })
    expect(hsvToHex({ h: 300, s: 0, v: 0.5 })).toBe('#808080')
    expect(hsvToHex({ h: 60, s: 1, v: 1 })).toBe('#ffff00')
  })

  it('round-trips every colour of a coarse cube exactly', () => {
    const steps = [0, 1, 17, 64, 127, 128, 200, 254, 255]
    for (const r of steps)
      for (const g of steps)
        for (const b of steps) {
          const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
          expect(hsvToHex(hexToHsv(hex))).toBe(hex)
        }
  })

  it('reads what is typed into the hex field', () => {
    expect(parseHex('#33AA77')).toBe('#33aa77')
    expect(parseHex(' 3a7 ')).toBe('#33aa77')
    expect(parseHex('33aa7')).toBeNull()
    expect(parseHex('#ggg')).toBeNull()
    expect(parseHex('')).toBeNull()
  })
})
