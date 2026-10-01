/**
 * The Design stage's editing state, as pure functions: the tools' pointer logic, the
 * current colour, and undo (a port of the tool handling in design_window.py).
 *
 * The screen feeds pointer events in as cells and renders whatever comes out, so all of
 * this is testable without a canvas. Every function returns a new state and never
 * changes its argument.
 *
 * The rule that is easy to get wrong (design_window.py:326-333): **a drag-paint stroke is
 * one undo step, recorded the first time a cell actually changes.** A stroke over cells
 * that are already the colour records nothing. This applies to every tool here, not
 * only paint: an edit that changes nothing (a fill on its own colour, a row already that
 * colour) records no undo step. The desktop recorded those; see the PR notes.
 *
 * The Select tool (web only; the desktop has none) keeps a rectangle of cells. Moving,
 * turning or pasting one makes it *float*: the block of cells is kept whole, with the
 * pattern under it (`under`), and the pattern is always `under` with the block written
 * over it. So a block dragged past an edge comes back whole, while what is saved, shown
 * and counted is always the plain pattern. Each drag, turn or paste is one undo step;
 * undo puts the pattern back exactly and drops the selection.
 */
import {
  addBorder,
  addPaletteEntry,
  deletePaletteEntryNearest,
  fillColumn,
  fillRect,
  fillRow,
  floodFill,
  insertColumn,
  insertRow,
  majorBorderIndex,
  nearestEntryId,
  pasteBlock,
  recolorPaletteEntry,
  renamePaletteEntry,
  samePattern,
  setCells,
} from '../logic/edit.ts'
import type { Pattern } from '../model/types.ts'
import { emptyHistory, record, redo as redoHistory, undo as undoHistory, type History } from './history.ts'
import {
  backgroundMask,
  clipOf,
  clipRect,
  containsCell,
  mapClip,
  moveRect,
  objectAt,
  readBlock,
  rectCols,
  rectBetween,
  sameRect,
  seeThrough,
  turnBlock,
  turnMask,
  turnRect,
  type Block,
  type CellRect,
  type Clip,
  type Turn,
} from './selection.ts'

export type Tool = 'select' | 'object' | 'paint' | 'fill' | 'rect' | 'eyedropper' | 'row' | 'col' | 'addRow' | 'addCol'

/** The tools in toolbar order, with their single-key shortcuts (design_window.py). Adding
 *  a row or a column is Shift with the key that fills one. */
export const TOOLS: readonly { tool: Tool; label: string; key: string; shift?: boolean }[] = [
  { tool: 'select', label: 'Select', key: 'S' },
  { tool: 'object', label: 'Select object', key: 'W' },
  { tool: 'paint', label: 'Paint', key: 'B' },
  { tool: 'fill', label: 'Fill', key: 'F' },
  { tool: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'eyedropper', label: 'Pick colour', key: 'I' },
  { tool: 'row', label: 'Fill row', key: 'H' },
  { tool: 'col', label: 'Fill column', key: 'V' },
  { tool: 'addRow', label: 'Add row', key: 'H', shift: true },
  { tool: 'addCol', label: 'Add column', key: 'V', shift: true },
]

/** The tools that add a row or a column where the pointer is, rather than act on a cell. */
export const ADD_TOOLS: Readonly<Partial<Record<Tool, 'row' | 'col'>>> = { addRow: 'row', addCol: 'col' }

/** The tools that hold a selection: Select, and Select object (a click picks up the
 *  object under it). Everything else about the selection is the same for both. */
export const selects = (tool: Tool): boolean => tool === 'select' || tool === 'object'

export function toolForKey(key: string, shift = false): Tool | null {
  return TOOLS.find((t) => t.key === key.toUpperCase() && !!t.shift === shift)?.tool ?? null
}

export interface Cell {
  readonly r: number
  readonly c: number
}

export type Drag =
  /** A paint stroke. `recorded`: its undo step is taken (a cell has changed). `origin`:
   *  the pattern and history before it, for `abortDrag`. */
  | { readonly tool: 'paint'; readonly last: Cell; readonly recorded: boolean; readonly origin: Origin }
  /** A rectangle being dragged out, previewed until the pointer comes up. */
  | { readonly tool: 'rect'; readonly start: Cell; readonly end: Cell }
  /** A selection being dragged out. `had`: there was one before the press, so a click
   *  that doesn't move only drops it. */
  | { readonly tool: 'select'; readonly start: Cell; readonly end: Cell; readonly had: boolean }
  /** A selection being dragged to a new place, from where it was (`rect`) when the
   *  pointer went down at `from`. */
  | { readonly tool: 'move'; readonly from: Cell; readonly rect: CellRect; readonly recorded: boolean; readonly origin: Origin }

/** Where a stroke began: what `abortDrag` puts back. */
export interface Origin {
  readonly pattern: Pattern
  readonly history: History
}

/** Picked up to move, turned, or pasted: the block, and the pattern without it. */
export interface Floating {
  readonly block: Block
  readonly under: Pattern
  /** Remove background: the block's see-through cells (1), which show what is under
   *  them wherever it goes; null when it has none. Web only, like the selection. */
  readonly clear?: Uint8Array | null
}

/** The pattern with a floating block written over it at `rect`, its see-through cells
 *  left as `under` has them. */
function over(f: Floating, rect: CellRect): Pattern {
  return pasteBlock(f.under, rect.r0, rect.c0, seeThrough(f.block, f.clear ?? null, f.under, rect.r0, rect.c0))
}

export interface Selection {
  /** Half-open. On the chart, unless floating: a floating block may hang over an edge. */
  readonly rect: CellRect
  readonly floating: Floating | null
}

export interface EditorState {
  readonly pattern: Pattern
  readonly history: History
  readonly tool: Tool
  /** The palette index painted with. */
  readonly colour: number
  readonly drag: Drag | null
  /** The Select tool's rectangle; only ever set while that tool is chosen. */
  readonly selection: Selection | null
}

export function initialEditor(pattern: Pattern): EditorState {
  return { pattern, history: emptyHistory, tool: 'paint', colour: 0, drag: null, selection: null }
}

const clampColour = (colour: number, p: Pattern) => Math.max(0, Math.min(colour, p.palette.length - 1))

/** A selection after `next` replaced the pattern by some other edit: put down (what
 *  floated is already in the pattern), and kept only while the shape is the same. */
function settled(sel: Selection | null, next: Pattern, before: Pattern): Selection | null {
  if (!sel || next.rows !== before.rows || next.cols !== before.cols) return null
  const rect = clipRect(sel.rect, next.rows, next.cols)
  return rect ? { rect, floating: null } : null
}

/** Apply a discrete edit as one undo step, or as nothing if it changed nothing. Any
 *  selection is put down first. */
export function commit(s: EditorState, next: Pattern): EditorState {
  if (samePattern(s.pattern, next)) return s.selection?.floating ? { ...s, selection: settled(s.selection, next, s.pattern) } : s
  return {
    ...s,
    pattern: next,
    history: record(s.history, s.pattern),
    colour: clampColour(s.colour, next),
    selection: settled(s.selection, next, s.pattern),
  }
}

/** Choose a tool. Leaving Select puts its selection down and drops it. */
export function setTool(s: EditorState, tool: Tool): EditorState {
  if (tool === s.tool && !s.drag) return s
  return { ...s, tool, drag: null, selection: selects(tool) ? settled(s.selection, s.pattern, s.pattern) : null }
}

export function selectColour(s: EditorState, colour: number): EditorState {
  if (!(colour >= 0 && colour < s.pattern.palette.length)) return s
  return colour === s.colour ? s : { ...s, colour }
}

// --- pointer ------------------------------------------------------------------------------

/** The cells on a straight line from `a` to `b`, both included (Bresenham), so a fast
 *  drag that skips cells between two pointer events still paints a joined-up line. */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = []
  let { r, c } = a
  const dr = Math.abs(b.r - r)
  const dc = Math.abs(b.c - c)
  const sr = r < b.r ? 1 : -1
  const sc = c < b.c ? 1 : -1
  let err = dc - dr
  for (;;) {
    out.push({ r, c })
    if (r === b.r && c === b.c) return out
    const e2 = 2 * err
    if (e2 > -dr) {
      err -= dr
      c += sc
    }
    if (e2 < dc) {
      err += dc
      r += sr
    }
  }
}

/** Paint `cells` in the current colour as part of a stroke, taking the stroke's undo
 *  step the first time a cell actually changes. */
function paint(s: EditorState, cells: readonly Cell[], last: Cell, recorded: boolean, origin: Origin): EditorState {
  const p = s.pattern
  const changed = cells.filter(({ r, c }) => p.cells[r * p.cols + c] !== s.colour)
  if (changed.length === 0) return { ...s, drag: { tool: 'paint', last, recorded, origin } }
  return {
    ...s,
    pattern: setCells(
      p,
      changed.map(({ r, c }) => [r, c] as const),
      s.colour,
    ),
    history: recorded ? s.history : record(s.history, p),
    drag: { tool: 'paint', last, recorded: true, origin },
  }
}

/** A press on a cell: what each tool does (design_window.py `_on_pressed`). With Select,
 *  a press inside the selection picks it up to drag; anywhere else starts a new one. */
export function pointerDown(s: EditorState, cell: Cell): EditorState {
  const { pattern: p, colour } = s
  const { r, c } = cell
  switch (s.tool) {
    case 'select':
    case 'object': {
      const sel = s.selection
      if (sel && grabs(sel, cell)) {
        return {
          ...lift(s),
          drag: { tool: 'move', from: cell, rect: sel.rect, recorded: false, origin: { pattern: p, history: s.history } },
        }
      }
      if (s.tool === 'object') return pickObject(putDown(s), cell)
      // The old selection stays until the press ends: a pinch that began here keeps it.
      return { ...s, drag: { tool: 'select', start: cell, end: cell, had: sel !== null } }
    }
    case 'paint':
      return paint({ ...s, drag: null }, [cell], cell, false, { pattern: p, history: s.history })
    case 'fill':
      return commit({ ...s, drag: null }, floodFill(p, r, c, colour))
    case 'rect':
      return { ...s, drag: { tool: 'rect', start: cell, end: cell } }
    case 'eyedropper': {
      const picked = p.cells[r * p.cols + c]!
      return selectColour({ ...s, drag: null }, picked)
    }
    case 'row':
      return commit({ ...s, drag: null }, fillRow(p, r, colour))
    case 'col':
      return commit({ ...s, drag: null }, fillColumn(p, c, colour))
    case 'addRow':
    case 'addCol':
      // These act between cells, not on one: see `addLine`.
      return s
  }
}

/** The pointer moved to `cell` with the button held. */
export function pointerMove(s: EditorState, cell: Cell): EditorState {
  const d = s.drag
  if (!d) return s
  if (d.tool === 'paint') {
    if (d.last.r === cell.r && d.last.c === cell.c) return s
    return paint(s, lineCells(d.last, cell).slice(1), cell, d.recorded, d.origin)
  }
  if (d.tool === 'move') {
    const f = s.selection?.floating
    if (!f) return s
    const rect = moveRect(d.rect, cell.r - d.from.r, cell.c - d.from.c)
    if (sameRect(rect, s.selection!.rect)) return s
    const pattern = over(f, rect)
    const changed = !samePattern(pattern, s.pattern)
    return {
      ...s,
      pattern: changed ? pattern : s.pattern,
      history: changed && !d.recorded ? record(s.history, d.origin.pattern) : s.history,
      selection: { rect, floating: f },
      drag: changed && !d.recorded ? { ...d, recorded: true } : d,
    }
  }
  if (d.end.r === cell.r && d.end.c === cell.c) return s
  return { ...s, drag: { ...d, end: cell } }
}

/** The button came up, at `cell` if over the chart. A rectangle is filled then, as one
 *  undo step, to wherever it was last dragged. */
export function pointerUp(s: EditorState, cell?: Cell | null): EditorState {
  const d = s.drag
  if (!d) return s
  if (d.tool === 'paint' || d.tool === 'move') return { ...s, drag: null }
  const end = cell ?? d.end
  if (d.tool === 'select') {
    const still = end.r === d.start.r && end.c === d.start.c
    return { ...s, drag: null, selection: still && d.had ? null : { rect: rectBetween(d.start, end), floating: null } }
  }
  return commit({ ...s, drag: null }, fillRect(s.pattern, d.start.r, d.start.c, end.r, end.c, s.colour))
}

/** Escape (or a cancelled pointer): drop a rectangle unfilled. A stroke keeps what it
 *  painted, as on the desktop; undo takes it back in one step. */
export function cancelDrag(s: EditorState): EditorState {
  return s.drag ? { ...s, drag: null } : s
}

/** A second finger landed (the gesture is a pinch, not a stroke): take back everything
 *  the stroke painted, as if it never happened, with no undo step; drop a rectangle. */
export function abortDrag(s: EditorState): EditorState {
  const d = s.drag
  if (!d) return s
  if (d.tool === 'paint' && d.recorded) return { ...s, pattern: d.origin.pattern, history: d.origin.history, drag: null }
  if (d.tool === 'move' && s.selection) {
    return { ...s, pattern: d.origin.pattern, history: d.origin.history, drag: null, selection: { ...s.selection, rect: d.rect } }
  }
  return { ...s, drag: null }
}

/** Apply a structural edit (or any whole-pattern edit) as one undo step. Anything in
 *  progress on the canvas is dropped first. */
export function structural(s: EditorState, fn: (p: Pattern) => Pattern): EditorState {
  const next = fn(s.pattern)
  return samePattern(s.pattern, next) ? s : commit({ ...s, drag: null }, next)
}

/** Add a row (before image row `at`) or a column (before column `at`) in the current
 *  colour, as one undo step: what the Add row and Add column tools do. `at` may be the
 *  row or column count, to add one at the end. */
export function addLine(s: EditorState, kind: 'row' | 'col', at: number): EditorState {
  return structural(s, (p) => (kind === 'row' ? insertRow(p, at, s.colour) : insertColumn(p, at, s.colour)))
}

// --- undo ----------------------------------------------------------------------------------

export const canUndo = (s: EditorState) => s.history.past.length > 0
export const canRedo = (s: EditorState) => s.history.future.length > 0

export function undo(s: EditorState): EditorState {
  const u = undoHistory(s.history, s.pattern)
  if (!u) return s
  return { ...s, ...u, drag: null, selection: null, colour: clampColour(s.colour, u.pattern) }
}

export function redo(s: EditorState): EditorState {
  const u = redoHistory(s.history, s.pattern)
  if (!u) return s
  return { ...s, ...u, drag: null, selection: null, colour: clampColour(s.colour, u.pattern) }
}

// --- the selection ------------------------------------------------------------------------------

/** The colour a selection leaves behind when it is moved, cut or deleted: the pattern's
 *  background, taken as the colour most of its edge is (`major_border_index`, which a
 *  border defaults to too). */
export function backgroundIndex(p: Pattern): number {
  const i = majorBorderIndex(p)
  return i < p.palette.length ? i : 0
}

/** Pick the selection up, if it isn't already: its cells become a floating block, and
 *  the pattern under it has the background where they were. The pattern itself doesn't
 *  change until the block moves. */
export function lift(s: EditorState): EditorState {
  const sel = s.selection
  if (!sel || sel.floating) return s
  const { rect } = sel
  const block = readBlock(s.pattern, rect)
  const under = fillRect(s.pattern, rect.r0, rect.c0, rect.r1 - 1, rect.c1 - 1, backgroundIndex(s.pattern))
  return { ...s, selection: { rect, floating: { block, under } } }
}

/** Whether a press on `cell` takes hold of the selection: inside it, and not on one of
 *  its see-through cells (a press there goes to what shows through). */
function grabs(sel: Selection, cell: Cell): boolean {
  if (!containsCell(sel.rect, cell)) return false
  const clear = sel.floating?.clear
  return !clear || !clear[(cell.r - sel.rect.r0) * rectCols(sel.rect) + (cell.c - sel.rect.c0)]
}

/**
 * Select object: select the object at `cell` (`objectAt`: the cells that aren't the
 * background joined to it, and what they enclose), floating with the rest of its
 * rectangle see-through, and take hold of it so the same press can drag it. The pattern
 * doesn't change until it moves; under it, only the object's own cells become the
 * background, so a neighbour inside its rectangle stays. On the background it drops the
 * selection.
 */
function pickObject(s: EditorState, cell: Cell): EditorState {
  const p = s.pattern
  const bg = backgroundIndex(p)
  const o = objectAt(p, cell, bg)
  if (!o) return { ...s, drag: null, selection: null }
  const { rect, clear } = o
  const own: [number, number][] = []
  for (let r = rect.r0; r < rect.r1; r++) {
    for (let c = rect.c0; c < rect.c1; c++) if (!clear[(r - rect.r0) * rectCols(rect) + (c - rect.c0)]) own.push([r, c])
  }
  const floating: Floating = { block: readBlock(p, rect), under: setCells(p, own, bg), clear }
  return {
    ...s,
    selection: { rect, floating },
    drag: { tool: 'move', from: cell, rect, recorded: false, origin: { pattern: p, history: s.history } },
  }
}

/** A floating block put at `rect` (its size), as one undo step when that changes the
 *  pattern. */
function placeFloating(s: EditorState, rect: CellRect, f: Floating): EditorState {
  const pattern = over(f, rect)
  const selection = { rect, floating: f }
  if (samePattern(pattern, s.pattern)) return { ...s, selection }
  return { ...s, pattern, history: record(s.history, s.pattern), selection, colour: clampColour(s.colour, pattern) }
}

/** Move the selection's cells by (dr, dc), as one undo step: the arrow keys. */
export function nudge(s: EditorState, dr: number, dc: number): EditorState {
  const lifted = lift({ ...s, drag: null })
  const sel = lifted.selection
  if (!sel?.floating) return s
  return placeFloating(lifted, moveRect(sel.rect, dr, dc), sel.floating)
}

/** Mirror, flip or turn the selection's cells where they are, as one undo step. A
 *  quarter turn keeps its centre. */
export function turnSelection(s: EditorState, how: Turn): EditorState {
  const lifted = lift({ ...s, drag: null })
  const sel = lifted.selection
  if (!sel?.floating) return s
  const f = sel.floating
  const block = turnBlock(f.block, how)
  const clear = f.clear ? turnMask(f.clear, f.block.rows, f.block.cols, how) : null
  return placeFloating(lifted, turnRect(sel.rect, how), { ...f, block, clear })
}

/** Whether the selection's background has been removed (so its button puts it back). */
export const backgroundRemoved = (s: EditorState): boolean => !!s.selection?.floating?.clear

/**
 * Remove background: the selection's background cells (`backgroundMask`: the colour most
 * of its edge is, joined to the edge) become see-through, so wherever it is moved or
 * turned only the motif goes, over what is there. Pressed again, it puts them back. One
 * undo step when the chart changes: where it was lifted from, the cells under it are the
 * pattern's background, so it changes only if that is a different colour.
 */
export function toggleBackground(s: EditorState): EditorState {
  const lifted = lift({ ...s, drag: null })
  const sel = lifted.selection
  if (!sel?.floating) return s
  const f = sel.floating
  const clear = f.clear ? null : backgroundMask(f.block)
  return placeFloating(lifted, sel.rect, { ...f, clear })
}

/** Put the selection down where it is; it stays selected (its part on the chart). */
export function putDown(s: EditorState): EditorState {
  return s.selection?.floating ? { ...s, drag: null, selection: settled(s.selection, s.pattern, s.pattern) } : s
}

/** Put the selection down and drop it. */
export function deselect(s: EditorState): EditorState {
  return s.selection || s.drag ? { ...s, drag: null, selection: null } : s
}

/** Select the whole pattern, choosing the Select tool. */
export function selectAll(s: EditorState): EditorState {
  const p = s.pattern
  return { ...s, tool: selects(s.tool) ? s.tool : 'select', drag: null, selection: { rect: { r0: 0, c0: 0, r1: p.rows, c1: p.cols }, floating: null } }
}

/** The selection's cells as they are now, for the clipboard: a floating block whole,
 *  even the part hanging over an edge. */
export function copySelection(s: EditorState): Clip | null {
  const sel = s.selection
  if (!sel) return null
  if (sel.floating) return clipOf(sel.floating.under, sel.floating.block, sel.rect, sel.floating.clear ?? null)
  return clipOf(s.pattern, readBlock(s.pattern, sel.rect), sel.rect)
}

/** Empty the selection, as one undo step: its cells take the background colour. A
 *  floating block is taken away instead, leaving what was under it. What is left of it
 *  stays selected. */
export function deleteSelection(s: EditorState): EditorState {
  const sel = s.selection
  if (!sel) return s
  if (sel.floating) return commit({ ...s, drag: null }, sel.floating.under)
  const { rect } = sel
  return commit({ ...s, drag: null }, fillRect(s.pattern, rect.r0, rect.c0, rect.r1 - 1, rect.c1 - 1, backgroundIndex(s.pattern)))
}

/** Fill the selection with the colour painted with, as one undo step. */
export function fillSelection(s: EditorState): EditorState {
  const down = putDown(s)
  const rect = down.selection?.rect
  if (!rect) return down
  return commit(down, fillRect(down.pattern, rect.r0, rect.c0, rect.r1 - 1, rect.c1 - 1, s.colour))
}

/**
 * Paste a clip as a floating selection, as one undo step (any colour the pattern lacked
 * is added with it). It goes where the selection is, if there is one; otherwise where it
 * was copied from, moved in as far as it needs to be to lie on the chart. The Select
 * tool is chosen, so it can be dragged into place.
 */
export function paste(s: EditorState, clip: Clip): EditorState {
  const down = putDown(s)
  const p = down.pattern
  const { pattern: under, block } = mapClip(p, clip)
  const at = down.selection
    ? { r0: down.selection.rect.r0, c0: down.selection.rect.c0 }
    : {
        r0: Math.max(0, Math.min(clip.r0, p.rows - block.rows)),
        c0: Math.max(0, Math.min(clip.c0, p.cols - block.cols)),
      }
  const rect = { r0: at.r0, c0: at.c0, r1: at.r0 + block.rows, c1: at.c0 + block.cols }
  const floating: Floating = { block, under, clear: clip.clear ?? null }
  const pattern = over(floating, rect)
  const base: EditorState = { ...down, tool: selects(down.tool) ? down.tool : 'select', drag: null, selection: { rect, floating } }
  if (samePattern(pattern, p)) return base
  return { ...base, pattern, history: record(down.history, p), colour: clampColour(s.colour, pattern) }
}

/** The pattern cut down to the selection's part on the chart, or null with none. Row ids
 *  are kept (`add_border` with negative sides), so progress on the rows kept stays. */
export function croppedToSelection(s: EditorState): Pattern | null {
  const p = s.pattern
  const rect = s.selection && clipRect(s.selection.rect, p.rows, p.cols)
  if (!rect) return null
  return addBorder(p, { top: -rect.r0, left: -rect.c0, bottom: rect.r1 - p.rows, right: rect.c1 - p.cols })
}

// --- the colours panel ------------------------------------------------------------------------

/** Add a colour and select it, ready to paint with. */
export function addColour(s: EditorState, hex: string, name?: string): EditorState {
  const next = commit(s, addPaletteEntry(s.pattern, hex, name))
  return next === s ? s : { ...next, colour: next.pattern.palette.length - 1 }
}

export function recolour(s: EditorState, index: number, hex: string): EditorState {
  const e = s.pattern.palette[index]
  return e ? commit(s, recolorPaletteEntry(s.pattern, e.id, hex.toLowerCase())) : s
}

export function renameColour(s: EditorState, index: number, name: string): EditorState {
  const e = s.pattern.palette[index]
  return e ? commit(s, renamePaletteEntry(s.pattern, e.id, name)) : s
}

/** Recolour and rename a colour at once: one undo step, as its menu's Save is one act. */
export function editColour(s: EditorState, index: number, hex: string, name: string): EditorState {
  const e = s.pattern.palette[index]
  if (!e) return s
  let next = s.pattern
  if (hex.toLowerCase() !== e.hex) next = recolorPaletteEntry(next, e.id, hex.toLowerCase())
  if (name !== e.name) next = renamePaletteEntry(next, e.id, name)
  return commit(s, next)
}

/**
 * Delete a colour; its cells take the perceptually nearest remaining one
 * (`delete_palette_entry_nearest`). The last colour can't go: this returns the state
 * unchanged. The current colour follows its entry, or becomes the replacement when it is
 * the one deleted.
 */
export function deleteColour(s: EditorState, index: number): EditorState {
  const p = s.pattern
  const e = p.palette[index]
  if (!e || p.palette.length <= 1) return s
  const into = nearestEntryId(p, e.id)
  const next = commit(s, deletePaletteEntryNearest(p, e.id))
  const cur = p.palette[s.colour]!.id === e.id ? into : p.palette[s.colour]!.id
  return { ...next, colour: Math.max(0, next.pattern.palette.findIndex((x) => x.id === cur)) }
}
