/**
 * Undo and redo for the Design stage: whole-pattern snapshots, as on the desktop
 * (design_window.py, UNDO_CAP = 50).
 *
 * Snapshots rather than diffs, deliberately. Every edit is copy-on-write (logic/edit.ts),
 * so a snapshot is just the previous Pattern, kept: no inverse operations to get wrong,
 * and nothing to compute on undo. Measured (scripts/undo-bench.ts): a 200×200 pattern is
 * 78 KB of cells, so 50 snapshots hold 3.8 MB, and an edit's copy costs ~0.1 ms. Only very
 * large patterns make that expensive (999×999: 1.9 MB each, 95 MB for 50), so the stack
 * also stops at a byte budget, which keeps 16 steps of a 999×999 pattern and all 50 of
 * anything up to ~570×570. The most recent step is always kept.
 */
import type { Pattern } from '../model/types.ts'

export const UNDO_CAP = 50
export const UNDO_BUDGET_BYTES = 32 * 1024 * 1024

export interface History {
  /** Oldest first; the last one is what undo goes back to. */
  readonly past: readonly Pattern[]
  /** Most recently undone last. */
  readonly future: readonly Pattern[]
}

export const emptyHistory: History = { past: [], future: [] }

const bytes = (p: Pattern) => p.cells.byteLength

/** Remember `before` as one undo step (the state an edit is about to replace). A new
 *  edit forgets whatever was undone. */
export function record(h: History, before: Pattern, cap = UNDO_CAP, budget = UNDO_BUDGET_BYTES): History {
  const past = [...h.past, before]
  let total = past.reduce((s, p) => s + bytes(p), 0)
  let drop = 0
  while (past.length - drop > 1 && (past.length - drop > cap || total > budget)) total -= bytes(past[drop++]!)
  return { past: drop ? past.slice(drop) : past, future: [] }
}

/** The pattern to go back to and the history after it, or null with nothing to undo. */
export function undo(h: History, current: Pattern): { pattern: Pattern; history: History } | null {
  const pattern = h.past.at(-1)
  if (!pattern) return null
  return { pattern, history: { past: h.past.slice(0, -1), future: [...h.future, current] } }
}

export function redo(h: History, current: Pattern): { pattern: Pattern; history: History } | null {
  const pattern = h.future.at(-1)
  if (!pattern) return null
  return { pattern, history: { past: [...h.past, current], future: h.future.slice(0, -1) } }
}
