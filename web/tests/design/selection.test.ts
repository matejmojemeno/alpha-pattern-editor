/** The Select tool: selecting, moving, turning, the clipboard, and undo, without a canvas. */
import { describe, expect, it } from 'vitest'

import {
  abortDrag,
  backgroundIndex,
  copySelection,
  croppedToSelection,
  deleteColour,
  deleteSelection,
  deselect,
  fillSelection,
  initialEditor,
  nudge,
  paste,
  pointerDown,
  pointerMove,
  pointerUp,
  redo,
  selectAll,
  selectColour,
  setTool,
  structural,
  toolForKey,
  toggleBackground,
  turnSelection,
  undo,
  backgroundRemoved,
  type EditorState,
} from '../../src/design/editor.ts'
import { backgroundMask, clipRect, mapClip, rectBetween, turnBlock, turnRect, type Block } from '../../src/design/selection.ts'
import { addPaletteEntry, mirrorH, newPattern, SKIP_INDEX } from '../../src/logic/edit.ts'
import type { Pattern } from '../../src/model/types.ts'

/** Rows of palette indices, as the chart shows them. */
const grid = (p: Pattern) =>
  Array.from({ length: p.rows }, (_, r) => [...p.cells.subarray(r * p.cols, (r + 1) * p.cols)])

/** A 5×4 pattern: white (0) background, black (1) and red (2), with a motif at the top
 *  left. Black is being painted with. */
function start(): EditorState {
  let p = newPattern(5, 4, '#ffffff')
  p = addPaletteEntry(p, '#000000', 'Black')
  p = addPaletteEntry(p, '#d93a3a', 'Red')
  const cells = Uint16Array.from([1, 2, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  p = { ...p, cells, palette: p.palette.map((e, i) => ({ ...e, count: [15, 2, 2][i]! })) }
  return selectColour(setTool(initialEditor(p), 'select'), 1)
}

/** Drag the Select tool from one cell to another. */
const drag = (s: EditorState, a: [number, number], b: [number, number]) =>
  pointerUp(pointerMove(pointerDown(s, { r: a[0], c: a[1] }), { r: b[0], c: b[1] }), { r: b[0], c: b[1] })

const MOTIF = [
  [1, 2, 0, 0, 0],
  [2, 1, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
]

describe('selecting', () => {
  it('S chooses Select', () => {
    expect(toolForKey('s')).toBe('select')
  })

  it('a drag selects the cells between its corners, either way round, and changes nothing', () => {
    const s = drag(start(), [1, 1], [0, 0])
    expect(s.selection).toEqual({ rect: { r0: 0, c0: 0, r1: 2, c1: 2 }, floating: null })
    expect(s.history.past).toHaveLength(0)
    expect(grid(s.pattern)).toEqual(MOTIF)
  })

  it('a click selects one cell; a click outside a selection drops it', () => {
    const one = drag(start(), [3, 4], [3, 4])
    expect(one.selection?.rect).toEqual({ r0: 3, c0: 4, r1: 4, c1: 5 })
    expect(drag(one, [0, 0], [0, 0]).selection).toBeNull()
  })

  it('a pinch that began outside the selection keeps it', () => {
    const s = drag(start(), [0, 0], [1, 1])
    const pinched = abortDrag(pointerMove(pointerDown(s, { r: 3, c: 3 }), { r: 3, c: 4 }))
    expect(pinched.selection).toEqual(s.selection)
  })

  it('choosing another tool drops the selection; Select all picks the Select tool', () => {
    const s = drag(start(), [0, 0], [1, 1])
    expect(setTool(s, 'paint').selection).toBeNull()
    const all = selectAll(setTool(s, 'paint'))
    expect(all.tool).toBe('select')
    expect(all.selection?.rect).toEqual({ r0: 0, c0: 0, r1: 4, c1: 5 })
  })
})

describe('moving a selection', () => {
  it('a drag inside it moves its cells, leaving the background, as one undo step', () => {
    let s = drag(start(), [0, 0], [1, 1])
    s = pointerDown(s, { r: 0, c: 0 })
    s = pointerMove(s, { r: 1, c: 1 })
    s = pointerMove(s, { r: 2, c: 3 })
    s = pointerUp(s, { r: 2, c: 3 })
    expect(grid(s.pattern)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 1, 2],
      [0, 0, 0, 2, 1],
    ])
    expect(s.selection?.rect).toEqual({ r0: 2, c0: 3, r1: 4, c1: 5 })
    expect(s.pattern.palette.map((e) => e.count)).toEqual([16, 2, 2])
    expect(s.history.past).toHaveLength(1)
    const back = undo(s)
    expect(grid(back.pattern)).toEqual(MOTIF)
    expect(back.selection).toBeNull()
    expect(grid(redo(back).pattern)).toEqual(grid(s.pattern))
  })

  it('a block dragged past an edge comes back whole', () => {
    let s = drag(start(), [0, 0], [1, 1])
    s = pointerDown(s, { r: 1, c: 1 })
    s = pointerMove(s, { r: 1, c: 4 }) // the block's right column hangs off the edge
    expect(grid(s.pattern)[0]).toEqual([0, 0, 0, 1, 2])
    s = pointerMove(s, { r: 0, c: 4 }) // and its top row off the top
    s = pointerUp(s, { r: 0, c: 4 })
    expect(s.selection?.rect).toEqual({ r0: -1, c0: 3, r1: 1, c1: 5 })
    expect(grid(s.pattern)[0]).toEqual([0, 0, 0, 2, 1])
    s = pointerDown(s, { r: 0, c: 4 })
    s = pointerUp(pointerMove(s, { r: 1, c: 1 }), { r: 1, c: 1 })
    expect(grid(s.pattern)).toEqual(MOTIF)
    // Two drags, two undo steps: the first undo goes back to where the first left it.
    expect(s.history.past).toHaveLength(2)
  })

  it('what hangs over an edge is dropped when the selection is put down', () => {
    let s = drag(start(), [0, 0], [1, 1])
    s = nudge(s, 0, -1)
    expect(grid(s.pattern).slice(0, 2)).toEqual([
      [2, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
    ])
    s = setTool(s, 'select') // unchanged: still floating
    s = setTool(s, 'paint')
    expect(s.selection).toBeNull()
    s = selectAll(s)
    s = nudge(s, 0, 1)
    expect(grid(s.pattern)[0]).toEqual([0, 2, 0, 0, 0])
  })

  it('a drag that comes back where it began is still one step, as a stroke is', () => {
    let s = drag(start(), [0, 0], [1, 1])
    s = pointerDown(s, { r: 0, c: 0 })
    s = pointerMove(s, { r: 0, c: 1 })
    s = pointerMove(s, { r: 0, c: 0 })
    s = pointerUp(s, { r: 0, c: 0 })
    expect(grid(s.pattern)).toEqual(MOTIF)
    expect(s.history.past).toHaveLength(1)
  })

  it('a second finger takes the move back with no undo step', () => {
    let s = drag(start(), [0, 0], [1, 1])
    s = pointerDown(s, { r: 0, c: 0 })
    s = pointerMove(s, { r: 2, c: 2 })
    s = abortDrag(s)
    expect(grid(s.pattern)).toEqual(MOTIF)
    expect(s.history.past).toHaveLength(0)
    expect(s.selection?.rect).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 })
  })

  it('arrow keys: one undo step each', () => {
    let s = drag(start(), [0, 0], [1, 1])
    s = nudge(nudge(s, 1, 0), 0, 1)
    expect(grid(s.pattern)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 1, 2, 0, 0],
      [0, 2, 1, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    expect(s.history.past).toHaveLength(2)
    expect(nudge(deselect(s), 1, 0)).toEqual(deselect(s))
  })
})

describe('turning a selection', () => {
  it('mirror and flip in place', () => {
    const s = drag(start(), [0, 0], [1, 2])
    expect(grid(turnSelection(s, 'mirror').pattern).slice(0, 2)).toEqual([
      [0, 2, 1, 0, 0],
      [0, 1, 2, 0, 0],
    ])
    expect(grid(turnSelection(s, 'flip').pattern).slice(0, 2)).toEqual([
      [2, 1, 0, 0, 0],
      [1, 2, 0, 0, 0],
    ])
  })

  it('a quarter turn keeps the centre, and four of them come back', () => {
    let s = drag(start(), [0, 0], [0, 2]) // 1 × 3: [1, 2, 0]
    s = turnSelection(s, 'cw')
    expect(s.selection?.rect).toEqual({ r0: -1, c0: 1, r1: 2, c1: 2 })
    expect(grid(s.pattern).map((r) => r[1])).toEqual([2, 0, 0, 0]) // over the black at (1, 1), which it keeps
    expect(grid(s.pattern)[0]![0]).toBe(0) // where it was: the background
    for (let i = 0; i < 3; i++) s = turnSelection(s, 'cw')
    expect(grid(s.pattern)).toEqual(MOTIF)
    expect(s.history.past).toHaveLength(4)
  })

  it('a block with an odd difference between its sides stays put over four turns, or a turn and back', () => {
    const at = { r0: 0, c0: 0, r1: 3, c1: 2 } // 3 rows × 2 columns
    let s = drag(start(), [0, 0], [2, 1])
    for (let i = 0; i < 4; i++) s = turnSelection(s, 'cw')
    expect(s.selection?.rect).toEqual(at)
    expect(grid(s.pattern)).toEqual(MOTIF)
    s = turnSelection(turnSelection(drag(start(), [0, 0], [2, 1]), 'ccw'), 'cw')
    expect(s.selection?.rect).toEqual(at)
    expect(grid(s.pattern)).toEqual(MOTIF)
  })

  it('turnRect: four turns either way, and a turn and its reverse, come back for every size', () => {
    for (let h = 1; h <= 7; h++) {
      for (let w = 1; w <= 7; w++) {
        const r = { r0: 3, c0: 4, r1: 3 + h, c1: 4 + w }
        for (const how of ['cw', 'ccw'] as const) {
          let t = r
          for (let i = 0; i < 4; i++) t = turnRect(t, how)
          expect(t).toEqual(r)
        }
        expect(turnRect(turnRect(r, 'cw'), 'ccw')).toEqual(r)
        expect(turnRect(turnRect(r, 'ccw'), 'cw')).toEqual(r)
        // Its centre moves by at most half a cell each way.
        const t = turnRect(r, 'cw')
        expect(Math.abs(t.r0 + t.r1 - (r.r0 + r.r1))).toBeLessThanOrEqual(1)
        expect(Math.abs(t.c0 + t.c1 - (r.c0 + r.c1))).toBeLessThanOrEqual(1)
      }
    }
  })

  it('blocks turn as rotate_90 and mirror_h turn a pattern', () => {
    const b: Block = { rows: 2, cols: 3, cells: Uint16Array.from([1, 2, 3, 4, 5, 6]) }
    expect([...turnBlock(b, 'cw').cells]).toEqual([4, 1, 5, 2, 6, 3])
    expect([...turnBlock(b, 'ccw').cells]).toEqual([3, 6, 2, 5, 1, 4])
    expect([...turnBlock(b, 'mirror').cells]).toEqual([3, 2, 1, 6, 5, 4])
    expect([...turnBlock(b, 'flip').cells]).toEqual([4, 5, 6, 1, 2, 3])
    expect(turnRect({ r0: 0, c0: 0, r1: 2, c1: 4 }, 'cw')).toEqual({ r0: -1, c0: 1, r1: 3, c1: 3 })
  })
})

describe('delete, fill and crop', () => {
  it('Delete leaves the background colour; Fill uses the colour painted with', () => {
    const s = drag(start(), [0, 0], [1, 1])
    expect(backgroundIndex(s.pattern)).toBe(0)
    const d = deleteSelection(s)
    expect(grid(d.pattern).every((r) => r.every((v) => v === 0))).toBe(true)
    expect(d.selection?.rect).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 })
    expect(d.history.past).toHaveLength(1)
    const f = fillSelection(selectColour(s, 2))
    expect(grid(f.pattern).slice(0, 2)).toEqual([
      [2, 2, 0, 0, 0],
      [2, 2, 0, 0, 0],
    ])
  })

  it('Delete on a moved selection takes the block away, leaving what was under it', () => {
    let s = drag(start(), [0, 0], [1, 1])
    s = nudge(s, 2, 2)
    s = deleteSelection(s)
    expect(grid(s.pattern).every((r) => r.every((v) => v === 0))).toBe(true)
    expect(s.selection?.floating).toBeNull()
  })

  it('crop keeps the selection and the row ids of the rows kept', () => {
    const s = drag(start(), [1, 1], [2, 3])
    const q = croppedToSelection(s)!
    expect(grid(q)).toEqual([
      [1, 0, 0],
      [0, 0, 0],
    ])
    expect(q.row_ids).toEqual(s.pattern.row_ids.slice(1, 3))
    expect(croppedToSelection(deselect(s))).toBeNull()
  })

  it('a structural edit or a deleted colour drops or settles the selection', () => {
    let s = drag(start(), [0, 0], [1, 1])
    s = nudge(s, 1, 1)
    const turned = structural(s, (p) => ({ ...mirrorH(p) }))
    expect(turned.selection?.floating).toBeNull() // same shape: kept, put down
    s = deleteColour(s, 2) // red goes: the block's indices would be stale
    expect(s.selection?.floating ?? null).toBeNull()
  })
})

describe('remove background', () => {
  /** A 6×5 white (0) chart: a black (1) ring with a white middle at the top left, and a
   *  red (2) patch at the top right. */
  function ring(): EditorState {
    let p = newPattern(6, 5, '#ffffff')
    p = addPaletteEntry(p, '#000000', 'Black')
    p = addPaletteEntry(p, '#d93a3a', 'Red')
    const rows = [
      [0, 1, 0, 2, 2, 2],
      [1, 0, 1, 2, 2, 2],
      [0, 1, 0, 2, 2, 2],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ]
    return setTool(initialEditor({ ...p, cells: Uint16Array.from(rows.flat()) }), 'select')
  }

  it('finds the background joined to the edge, and keeps the same colour inside the motif', () => {
    const b: Block = { rows: 3, cols: 3, cells: Uint16Array.from([0, 1, 0, 1, 0, 1, 0, 1, 0]) }
    expect([...backgroundMask(b)!]).toEqual([1, 0, 1, 0, 0, 0, 1, 0, 1])
  })

  it('moves only the motif, over what is there, and turns with it', () => {
    let s = toggleBackground(drag(ring(), [0, 0], [2, 2]))
    expect(backgroundRemoved(s)).toBe(true)
    expect(s.history.past).toHaveLength(0) // in place, nothing shows yet
    s = nudge(s, 0, 3)
    expect(grid(s.pattern).slice(0, 3)).toEqual([
      [0, 0, 0, 2, 1, 2],
      [0, 0, 0, 1, 0, 1],
      [0, 0, 0, 2, 1, 2],
    ])
    s = turnSelection(s, 'cw')
    expect(grid(s.pattern)[0]).toEqual([0, 0, 0, 2, 1, 2])
    expect(backgroundRemoved(s)).toBe(true)
    // Put back: the white corners come back over the red.
    s = toggleBackground(s)
    expect(backgroundRemoved(s)).toBe(false)
    expect(grid(s.pattern)[0]).toEqual([0, 0, 0, 0, 1, 0])
    expect(grid(undo(s).pattern)[0]).toEqual([0, 0, 0, 2, 1, 2])
  })

  it('copy and paste keep it see-through', () => {
    let s = toggleBackground(drag(ring(), [0, 0], [2, 2]))
    const clip = copySelection(s)!
    expect(clip.clear).toBeTruthy()
    s = paste(deselect(s), { ...clip, r0: 0, c0: 3 })
    expect(grid(s.pattern)[0]).toEqual([0, 1, 0, 2, 1, 2])
  })
})

describe('the clipboard', () => {
  it('copy then paste puts a floating copy where the selection is, one undo step', () => {
    let s = drag(start(), [0, 0], [1, 1])
    const clip = copySelection(s)!
    s = drag(deselect(s), [2, 3], [2, 3])
    s = paste(s, clip)
    expect(grid(s.pattern)).toEqual([
      [1, 2, 0, 0, 0],
      [2, 1, 0, 0, 0],
      [0, 0, 0, 1, 2],
      [0, 0, 0, 2, 1],
    ])
    expect(s.selection?.floating).not.toBeNull()
    expect(s.history.past).toHaveLength(1)
    expect(grid(undo(s).pattern)).toEqual(MOTIF)
  })

  it('with no selection it goes where it was copied from, moved onto the chart', () => {
    const s = drag(start(), [2, 3], [3, 4])
    const clip = copySelection(s)!
    const small = { ...initialEditor(newPattern(3, 3, '#ffffff')) }
    const pasted = paste(small, clip)
    expect(pasted.selection?.rect).toEqual({ r0: 1, c0: 1, r1: 3, c1: 3 })
    expect(pasted.tool).toBe('select')
  })

  it('cut is copy then delete', () => {
    const s = drag(start(), [0, 0], [1, 1])
    const clip = copySelection(s)!
    const cut = deleteSelection(s)
    expect(grid(paste(cut, clip).pattern)).toEqual(MOTIF)
  })

  it('pasting into another pattern finds its colours by hex, and adds the ones it lacks', () => {
    const s = drag(start(), [0, 0], [1, 1])
    const clip = copySelection(s)!
    // Another pattern: black at index 0, no red.
    const other = initialEditor(addPaletteEntry(newPattern(4, 4, '#000000', { colourName: 'Black' }), '#ffffff', 'White'))
    const pasted = paste(other, clip)
    const p = pasted.pattern
    expect(p.palette.map((e) => [e.hex, e.name])).toEqual([
      ['#000000', 'Black'],
      ['#ffffff', 'White'],
      ['#d93a3a', 'Red'],
    ])
    expect(grid(p).slice(0, 2).map((r) => r.slice(0, 2))).toEqual([
      [0, 2],
      [2, 0],
    ])
    expect(pasted.history.past).toHaveLength(1) // colour and cells: one step
  })

  it('a copied skip cell stays one', () => {
    const p = newPattern(2, 1, '#ffffff')
    const clip = { block: { rows: 1, cols: 2, cells: Uint16Array.from([SKIP_INDEX, 0]) }, colours: [{ id: 'x', hex: '#ffffff', name: 'W' }], r0: 0, c0: 0 }
    expect([...mapClip(p, clip).block.cells]).toEqual([SKIP_INDEX, 0])
  })
})

describe('rectangles', () => {
  it('clip to the chart', () => {
    expect(clipRect({ r0: -1, c0: 3, r1: 1, c1: 7 }, 4, 5)).toEqual({ r0: 0, c0: 3, r1: 1, c1: 5 })
    expect(clipRect({ r0: 4, c0: 0, r1: 6, c1: 1 }, 4, 5)).toBeNull()
    expect(rectBetween({ r: 2, c: 0 }, { r: 0, c: 3 })).toEqual({ r0: 0, c0: 0, r1: 3, c1: 4 })
  })
})
