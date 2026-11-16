/** "From another pattern": picking in one pattern and bringing it into another. */
import { describe, expect, it } from 'vitest'

import { deselect, initialEditor, paste, putDown, setTool, toggleBackground, undo } from '../../src/design/editor.ts'
import { clipFor, pickAll, pickShape } from '../../src/design/source.ts'
import { addPaletteEntry, newPattern } from '../../src/logic/edit.ts'
import type { Pattern } from '../../src/model/types.ts'

const grid = (p: Pattern) => Array.from({ length: p.rows }, (_, r) => [...p.cells.subarray(r * p.cols, (r + 1) * p.cols)])

/** A 6×5 cat-ish source: white (0) background, black (1) body with a red (2) eye inside
 *  it, and a lone black dot at the far corner that isn't joined to it. */
function source(): Pattern {
  let p = newPattern(6, 5, '#ffffff', { name: 'Cat' })
  p = addPaletteEntry(p, '#000000', 'Black')
  p = addPaletteEntry(p, '#d93a3a', 'Red')
  // prettier-ignore
  const cells = Uint16Array.from([
    0, 0, 0, 0, 0, 0,
    0, 1, 1, 1, 0, 0,
    0, 1, 2, 1, 0, 0,
    0, 1, 1, 1, 0, 0,
    0, 0, 0, 0, 0, 1,
  ])
  return { ...p, cells }
}

/** An 8×6 target in its own colours: light blue (0) background, and black under another
 *  id, so black is found by its hex. Red it doesn't have. */
function target(): Pattern {
  let p = newPattern(8, 6, '#a0c8f0', { name: 'Sweater front' })
  p = addPaletteEntry(p, '#000000', 'Ink')
  return p
}

describe('picking in the other pattern', () => {
  it('a shape is its joined cells and what they enclose; the rest of its box is see-through', () => {
    const picked = pickShape(source(), { r: 1, c: 1 })!
    expect(picked.rect).toEqual({ r0: 1, c0: 1, r1: 4, c1: 4 })
    // The eye is inside the body, so it is part of the shape: nothing is see-through.
    expect([...picked.clear!]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('the background, or off the chart, picks nothing', () => {
    expect(pickShape(source(), { r: 0, c: 0 })).toBeNull()
    expect(pickShape(source(), { r: 9, c: 0 })).toBeNull()
    expect(pickShape(source(), { r: 0, c: -1 })).toBeNull()
  })

  it('the whole pattern is all of it, nothing see-through', () => {
    expect(pickAll(source())).toEqual({ rect: { r0: 0, c0: 0, r1: 5, c1: 6 }, clear: null })
  })
})

describe('bringing it in', () => {
  it('lands centred and floating, its colours found by hex or added, as one undo step', () => {
    const src = source()
    const clip = clipFor(src, pickShape(src, { r: 2, c: 2 })!, target())
    const s0 = setTool(initialEditor(target()), 'paint')
    const s = paste(s0, clip)
    // 3×3 into 8×6: rows (6-3)/2 → 1, columns (8-3)/2 → 2.
    expect(s.selection?.rect).toEqual({ r0: 1, c0: 2, r1: 4, c1: 5 })
    expect(s.selection?.floating).not.toBeNull()
    expect(s.tool).toBe('select')
    // Black is the target's "Ink" (same hex); red is added under its own name.
    expect(s.pattern.palette.map((e) => [e.hex, e.name])).toEqual([
      ['#a0c8f0', 'Background'],
      ['#000000', 'Ink'],
      ['#d93a3a', 'Red'],
    ])
    expect(grid(s.pattern)).toEqual([
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 0, 0, 0],
      [0, 0, 1, 2, 1, 0, 0, 0],
      [0, 0, 1, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ])
    // The source is untouched: it is only read.
    expect(grid(src)[2]).toEqual([0, 1, 2, 1, 0, 0])
    const back = undo(putDown(s))
    expect(back.pattern).toBe(s0.pattern)
  })

  it('a shape keeps its see-through cells: what was under them stays', () => {
    // An L of black whose box has a background corner the L doesn't enclose.
    let src = newPattern(3, 3, '#ffffff')
    src = addPaletteEntry(src, '#000000', 'Black')
    src = { ...src, cells: Uint16Array.from([1, 0, 0, 1, 0, 0, 1, 1, 0]) }
    const picked = pickShape(src, { r: 0, c: 0 })!
    expect(picked.rect).toEqual({ r0: 0, c0: 0, r1: 3, c1: 2 })
    expect([...picked.clear!]).toEqual([0, 1, 0, 1, 0, 0])
    // A target filled with green: the see-through cells keep the green.
    let t = newPattern(4, 3, '#00ff00')
    t = addPaletteEntry(t, '#000000', 'Black')
    const s = deselect(paste(initialEditor(t), clipFor(src, picked, t)))
    expect(grid(s.pattern)).toEqual([
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 1, 0],
    ])
  })

  it('a shape adds only the colours that show, not its old background behind the see-through cells', () => {
    // The L again, on a yellow background the target doesn't have.
    let src = newPattern(3, 3, '#ffee00', { colourName: 'Yellow' })
    src = addPaletteEntry(src, '#000000', 'Black')
    src = { ...src, cells: Uint16Array.from([1, 0, 0, 1, 0, 0, 1, 1, 0]) }
    const t = newPattern(4, 3, '#00ff00', { colourName: 'Green' })
    const s = paste(initialEditor(t), clipFor(src, pickShape(src, { r: 0, c: 0 })!, t))
    expect(s.pattern.palette.map((e) => e.name)).toEqual(['Green', 'Black'])
    expect(grid(deselect(s).pattern)).toEqual([
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 1, 0],
    ])
    // Put back, the background cells are the target's background, not a stray index.
    const back = toggleBackground(s)
    expect(back.selection?.floating?.clear).toBeNull()
    expect(grid(back.pattern)).toEqual([
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 1, 0],
    ])
    // A colour the target has is still found for them: its yellow (1). Black is added (2).
    let w = newPattern(4, 3, '#00ff00', { colourName: 'Green' })
    w = addPaletteEntry(w, '#ffee00', 'Also yellow')
    const s2 = toggleBackground(paste(initialEditor(w), clipFor(src, pickShape(src, { r: 0, c: 0 })!, w)))
    expect(s2.pattern.palette.map((e) => e.name)).toEqual(['Green', 'Also yellow', 'Black'])
    expect(grid(s2.pattern)[0]).toEqual([0, 2, 1, 0])
  })

  it('bigger than the pattern, it lands at the top left and hangs over, kept whole until put down', () => {
    const src = source()
    const small = newPattern(3, 2, '#ffffff')
    const s = paste(initialEditor(small), clipFor(src, pickAll(src), small))
    expect(s.selection?.rect).toEqual({ r0: 0, c0: 0, r1: 5, c1: 6 })
    expect(s.selection?.floating?.block.rows).toBe(5)
  })
})
