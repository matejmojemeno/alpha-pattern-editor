import { describe, expect, it } from 'vitest'

import { againName, cleanName, MAX_NAME_LENGTH } from '../../src/ui/names.ts'

describe('againName', () => {
  it('numbers a copy from 2, skipping names already taken', () => {
    expect(againName('Toadstool', ['Toadstool'])).toBe('Toadstool (2)')
    expect(againName('Toadstool', ['Toadstool', 'Toadstool (2)'])).toBe('Toadstool (3)')
  })

  it('counts on from a copy rather than adding a second number', () => {
    expect(againName('Toadstool (2)', ['Toadstool', 'Toadstool (2)'])).toBe('Toadstool (3)')
  })

  it('stays within the longest name allowed', () => {
    const long = 'x'.repeat(MAX_NAME_LENGTH)
    const next = againName(long, [long])
    expect(next).toHaveLength(MAX_NAME_LENGTH)
    expect(next.endsWith(' (2)')).toBe(true)
    expect(cleanName(next)).toBe(next)
  })
})
