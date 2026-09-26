/** The Design tools' pointer logic and undo, without a canvas. */
import { describe, expect, it } from 'vitest'

import {
  abortDrag,
  addColour,
  cancelDrag,
  canRedo,
  canUndo,
  commit,
  deleteColour,
  initialEditor,
  lineCells,
  pointerDown,
  pointerMove,
  pointerUp,
  recolour,
  redo,
  renameColour,
  selectColour,
  setTool,
  structural,
  toolForKey,
  undo,
  type Cell,
  type EditorState,
  type Tool,
} from '../../src/design/editor.ts'
import { addBorder, addPaletteEntry, mirrorH, newPattern, recolorPaletteEntry } from '../../src/logic/edit.ts'
import type { Pattern } from '../../src/model/types.ts'

/** A 6×4 white pattern with black (1) and red (2) added, black selected. */
function start(tool: Tool = 'paint'): EditorState {
  let p = newPattern(6, 4, '#ffffff')
  p = addPaletteEntry(p, '#000000', 'Black')
  p = addPaletteEntry(p, '#d93a3a', 'Red')
  return selectColour(setTool(initialEditor(p), tool), 1)
}

const grid = (p: Pattern) => {
  const out: string[] = []
  for (let r = 0; r < p.rows; r++) out.push([...p.cells.subarray(r * p.cols, (r + 1) * p.cols)].join(''))
  return out
}

const at = (r: number, c: number): Cell => ({ r, c })

/** Press at the first cell, drag through the rest, release at the last. */
function drag(s: EditorState, cells: Cell[]): EditorState {
  s = pointerDown(s, cells[0]!)
  for (const c of cells.slice(1)) s = pointerMove(s, c)
  return pointerUp(s, cells.at(-1))
}

describe('paint', () => {
  it('a whole drag is one undo step', () => {
    let s = drag(start(), [at(0, 0), at(0, 1), at(1, 1), at(2, 1)])
    expect(grid(s.pattern)).toEqual(['110000', '010000', '010000', '000000'])
    expect(s.history.past).toHaveLength(1)
    s = undo(s)
    expect(grid(s.pattern)).toEqual(['000000', '000000', '000000', '000000'])
    expect(canUndo(s)).toBe(false)
    s = redo(s)
    expect(grid(s.pattern)).toEqual(['110000', '010000', '010000', '000000'])
  })

  it('records the step the first time a cell changes, not on the press', () => {
    let s = start()
    s = pointerDown(s, at(0, 0))
    s = undo(pointerUp(s, at(0, 0)))
    // Now paint over a cell that already is the colour, then onto one that isn't.
    s = pointerDown(drag(s, [at(0, 0)]), at(0, 0))
    expect(s.history.past).toHaveLength(1) // the previous stroke only
    s = pointerMove(s, at(0, 1))
    expect(s.history.past).toHaveLength(2)
    s = pointerMove(s, at(0, 2))
    expect(s.history.past).toHaveLength(2)
    // The step holds the pattern from before this stroke.
    expect(grid(s.history.past[1]!)).toEqual(['100000', '000000', '000000', '000000'])
  })

  it('a click or stroke that changes nothing records nothing', () => {
    let s = drag(start(), [at(0, 0)])
    const before = s
    s = drag(s, [at(0, 0)])
    expect(s.history).toBe(before.history)
    s = drag(selectColour(s, 0), [at(3, 3), at(3, 4), at(2, 4)])
    expect(s.history).toBe(before.history)
  })

  it('joins cells a fast drag skipped', () => {
    const s = drag(start(), [at(0, 0), at(3, 5)])
    expect(grid(s.pattern)).toEqual(['100000', '011000', '000110', '000001'])
    expect(s.history.past).toHaveLength(1)
    // Each cell of a line touches the one before it, so no gaps.
    const line = lineCells(at(3, 0), at(0, 4))
    expect(line.at(0)).toEqual(at(3, 0))
    expect(line.at(-1)).toEqual(at(0, 4))
    for (let i = 1; i < line.length; i++) {
      expect(Math.max(Math.abs(line[i]!.r - line[i - 1]!.r), Math.abs(line[i]!.c - line[i - 1]!.c))).toBe(1)
    }
  })

  it('a redo is lost to a new stroke', () => {
    let s = undo(drag(start(), [at(0, 0)]))
    expect(canRedo(s)).toBe(true)
    s = drag(s, [at(1, 1)])
    expect(canRedo(s)).toBe(false)
  })
})

describe('the other tools', () => {
  it('fill is 4-connected and one step; on its own colour, nothing', () => {
    let s = start()
    s = drag(s, [at(0, 2), at(1, 2), at(2, 2), at(3, 2)])
    s = drag(setTool(selectColour(s, 2), 'fill'), [at(0, 0)])
    expect(grid(s.pattern)).toEqual(['221000', '221000', '221000', '221000'])
    expect(s.history.past).toHaveLength(2)
    expect(drag(s, [at(3, 0)]).history).toBe(s.history)
  })

  it('rectangle previews while dragging and fills on release, either way round', () => {
    let s = pointerDown(start('rect'), at(3, 4))
    s = pointerMove(s, at(2, 3))
    s = pointerMove(s, at(1, 1))
    expect(s.drag).toEqual({ tool: 'rect', start: at(3, 4), end: at(1, 1) })
    expect(s.history.past).toHaveLength(0) // nothing filled yet
    s = pointerUp(s, at(1, 1))
    expect(grid(s.pattern)).toEqual(['000000', '011110', '011110', '011110'])
    expect(s.history.past).toHaveLength(1)
    expect(s.drag).toBeNull()
  })

  it('a rectangle released off the chart fills to where it was last; Escape drops it', () => {
    let s = pointerMove(pointerDown(start('rect'), at(0, 0)), at(1, 1))
    expect(grid(pointerUp(s, null).pattern)[1]).toBe('110000')
    s = cancelDrag(s)
    expect(s.drag).toBeNull()
    expect(pointerUp(s, at(3, 3))).toBe(s)
    expect(canUndo(s)).toBe(false)
  })

  it('eyedropper picks the colour under it, and ignores a cell with no colour', () => {
    let s = drag(selectColour(start(), 2), [at(2, 2)])
    s = pointerDown(setTool(selectColour(s, 0), 'eyedropper'), at(2, 2))
    expect(s.colour).toBe(2)
    expect(s.tool).toBe('eyedropper')
    expect(canUndo(s)).toBe(true) // only the paint
    expect(s.history.past).toHaveLength(1)
  })

  it('fill row and fill column', () => {
    let s = drag(start('row'), [at(1, 3)])
    expect(grid(s.pattern)).toEqual(['000000', '111111', '000000', '000000'])
    s = drag(setTool(selectColour(s, 2), 'col'), [at(0, 4)])
    expect(grid(s.pattern)).toEqual(['000020', '111121', '000020', '000020'])
    expect(s.history.past).toHaveLength(2)
    expect(drag(s, [at(3, 4)]).history).toBe(s.history)
  })

  it('shortcuts name the tools', () => {
    expect(['B', 'F', 'R', 'I', 'H', 'V', 'b', 'x'].map(toolForKey)).toEqual([
      'paint', 'fill', 'rect', 'eyedropper', 'row', 'col', 'paint', null,
    ])
  })
})

describe('colours', () => {
  it('add selects the new colour; recolour and rename are one step each', () => {
    let s = addColour(start(), '#00ff00', 'Green')
    expect(s.colour).toBe(3)
    expect(s.pattern.palette[3]).toMatchObject({ hex: '#00ff00', name: 'Green', count: 0 })
    s = recolour(s, 3, '#00AA00')
    s = renameColour(s, 3, 'Leaf')
    expect(s.pattern.palette[3]).toMatchObject({ hex: '#00aa00', name: 'Leaf' })
    expect(s.history.past).toHaveLength(3) // add, recolour, rename
    expect(recolour(s, 3, '#00aa00')).toBe(s) // the same colour: nothing
    s = undo(undo(s))
    expect(s.pattern.palette[3]).toMatchObject({ hex: '#00ff00', name: 'Green' })
  })

  it("delete repaints with the nearest colour, and the current colour follows", () => {
    let s = start()
    s = commit(s, recolorPaletteEntry(s.pattern, s.pattern.palette[2]!.id, '#222222')) // near black
    s = drag(selectColour(s, 2), [at(0, 0), at(0, 1)])
    s = selectColour(s, 2)
    s = deleteColour(s, 2)
    expect(s.pattern.palette.map((e) => e.name)).toEqual(['Background', 'Black'])
    expect(grid(s.pattern)[0]).toBe('110000')
    expect(s.colour).toBe(1) // the deleted one's replacement
    // Deleting one before the current colour keeps the current colour selected.
    s = deleteColour(s, 0)
    expect(s.pattern.palette.map((e) => e.name)).toEqual(['Black'])
    expect(s.colour).toBe(0)
    // The last colour can't go.
    expect(deleteColour(s, 0)).toBe(s)
    s = undo(s)
    expect(s.pattern.palette).toHaveLength(2)
  })

  it('undo keeps the current colour within the palette', () => {
    let s = addColour(start(), '#00ff00')
    expect(s.colour).toBe(3)
    s = undo(s)
    expect(s.colour).toBe(2)
  })
})

describe('a stroke that turns out to be a pinch', () => {
  it('abortDrag takes back everything the stroke painted, with no undo step', () => {
    let s = start()
    s = pointerUp(pointerDown(s, { r: 3, c: 0 }), null) // an earlier stroke: one undo step
    const before = s
    s = pointerDown(s, { r: 0, c: 0 })
    s = pointerMove(s, { r: 0, c: 4 })
    expect(s.history.past.length).toBe(2)
    s = abortDrag(s)
    expect(s.pattern).toBe(before.pattern)
    expect(s.history).toBe(before.history)
    expect(s.drag).toBeNull()
    // Redo, too, is as it was.
    s = undo(s)
    const redoable = s
    s = abortDrag(pointerMove(pointerDown(s, { r: 1, c: 1 }), { r: 1, c: 3 }))
    expect(s.pattern).toBe(redoable.pattern)
    expect(canRedo(s)).toBe(true)
  })

  it('drops a rectangle, and leaves a state with no drag alone', () => {
    const s = start('rect')
    const d = pointerMove(pointerDown(s, { r: 0, c: 0 }), { r: 2, c: 2 })
    expect(abortDrag(d)).toMatchObject({ pattern: s.pattern, drag: null })
    expect(abortDrag(s)).toBe(s)
  })
})

describe('structural', () => {
  it('is one undo step, and nothing when the edit changes nothing', () => {
    const s = start()
    const t = structural(s, (p) => addBorder(p, { top: 1, left: 2, paletteIndex: 1 }))
    expect([t.pattern.cols, t.pattern.rows]).toEqual([8, 5])
    expect(undo(t).pattern).toBe(s.pattern)
    expect(structural(s, mirrorH)).toBe(s) // all white: the same pattern
  })
})
