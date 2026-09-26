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
 */
import {
  addPaletteEntry,
  deletePaletteEntryNearest,
  fillColumn,
  fillRect,
  fillRow,
  floodFill,
  nearestEntryId,
  recolorPaletteEntry,
  renamePaletteEntry,
  samePattern,
  setCells,
} from '../logic/edit.ts'
import type { Pattern } from '../model/types.ts'
import { emptyHistory, record, redo as redoHistory, undo as undoHistory, type History } from './history.ts'

export type Tool = 'paint' | 'fill' | 'rect' | 'eyedropper' | 'row' | 'col'

/** The tools in toolbar order, with their single-key shortcuts (design_window.py). */
export const TOOLS: readonly { tool: Tool; label: string; key: string }[] = [
  { tool: 'paint', label: 'Paint', key: 'B' },
  { tool: 'fill', label: 'Fill', key: 'F' },
  { tool: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'eyedropper', label: 'Pick colour', key: 'I' },
  { tool: 'row', label: 'Fill row', key: 'H' },
  { tool: 'col', label: 'Fill column', key: 'V' },
]

export function toolForKey(key: string): Tool | null {
  return TOOLS.find((t) => t.key === key.toUpperCase())?.tool ?? null
}

export interface Cell {
  readonly r: number
  readonly c: number
}

export type Drag =
  /** A paint stroke. `recorded`: its undo step is taken (a cell has changed). */
  | { readonly tool: 'paint'; readonly last: Cell; readonly recorded: boolean }
  /** A rectangle being dragged out, previewed until the pointer comes up. */
  | { readonly tool: 'rect'; readonly start: Cell; readonly end: Cell }

export interface EditorState {
  readonly pattern: Pattern
  readonly history: History
  readonly tool: Tool
  /** The palette index painted with. */
  readonly colour: number
  readonly drag: Drag | null
}

export function initialEditor(pattern: Pattern): EditorState {
  return { pattern, history: emptyHistory, tool: 'paint', colour: 0, drag: null }
}

const clampColour = (colour: number, p: Pattern) => Math.max(0, Math.min(colour, p.palette.length - 1))

/** Apply a discrete edit as one undo step, or as nothing if it changed nothing. */
export function commit(s: EditorState, next: Pattern): EditorState {
  if (samePattern(s.pattern, next)) return s
  return { ...s, pattern: next, history: record(s.history, s.pattern), colour: clampColour(s.colour, next) }
}

export function setTool(s: EditorState, tool: Tool): EditorState {
  return tool === s.tool && !s.drag ? s : { ...s, tool, drag: null }
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
function paint(s: EditorState, cells: readonly Cell[], last: Cell, recorded: boolean): EditorState {
  const p = s.pattern
  const changed = cells.filter(({ r, c }) => p.cells[r * p.cols + c] !== s.colour)
  if (changed.length === 0) return { ...s, drag: { tool: 'paint', last, recorded } }
  return {
    ...s,
    pattern: setCells(
      p,
      changed.map(({ r, c }) => [r, c] as const),
      s.colour,
    ),
    history: recorded ? s.history : record(s.history, p),
    drag: { tool: 'paint', last, recorded: true },
  }
}

/** A press on a cell: what each tool does (design_window.py `_on_pressed`). */
export function pointerDown(s: EditorState, cell: Cell): EditorState {
  const { pattern: p, colour } = s
  const { r, c } = cell
  switch (s.tool) {
    case 'paint':
      return paint({ ...s, drag: null }, [cell], cell, false)
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
  }
}

/** The pointer moved to `cell` with the button held. */
export function pointerMove(s: EditorState, cell: Cell): EditorState {
  const d = s.drag
  if (!d) return s
  if (d.tool === 'paint') {
    if (d.last.r === cell.r && d.last.c === cell.c) return s
    return paint(s, lineCells(d.last, cell).slice(1), cell, d.recorded)
  }
  if (d.end.r === cell.r && d.end.c === cell.c) return s
  return { ...s, drag: { ...d, end: cell } }
}

/** The button came up, at `cell` if over the chart. A rectangle is filled then, as one
 *  undo step, to wherever it was last dragged. */
export function pointerUp(s: EditorState, cell?: Cell | null): EditorState {
  const d = s.drag
  if (!d) return s
  if (d.tool === 'paint') return { ...s, drag: null }
  const end = cell ?? d.end
  return commit({ ...s, drag: null }, fillRect(s.pattern, d.start.r, d.start.c, end.r, end.c, s.colour))
}

/** Escape (or a cancelled pointer): drop a rectangle unfilled. A stroke keeps what it
 *  painted, as on the desktop; undo takes it back in one step. */
export function cancelDrag(s: EditorState): EditorState {
  return s.drag ? { ...s, drag: null } : s
}

// --- undo ----------------------------------------------------------------------------------

export const canUndo = (s: EditorState) => s.history.past.length > 0
export const canRedo = (s: EditorState) => s.history.future.length > 0

export function undo(s: EditorState): EditorState {
  const u = undoHistory(s.history, s.pattern)
  if (!u) return s
  return { ...s, ...u, drag: null, colour: clampColour(s.colour, u.pattern) }
}

export function redo(s: EditorState): EditorState {
  const u = redoHistory(s.history, s.pattern)
  if (!u) return s
  return { ...s, ...u, drag: null, colour: clampColour(s.colour, u.pattern) }
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
