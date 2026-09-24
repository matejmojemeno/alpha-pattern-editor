/**
 * Work-stage progress operations (§4.5, §6.3). Pure functions returning a new Progress.
 * Port of alphareader/core/work.py, which is the spec.
 *
 * Progress is keyed by stable row_id (survives structural edits), plus a
 * (current_row_id, current_run_index) cursor. Rows are worked in index order (row 1
 * first). Runs before the cursor in the current row are done; the cursor sits on the
 * active run.
 *
 * No operation mutates its input. Every one that can stamp `started_at` takes an
 * optional trailing `clock`, so tests (and the fixtures) can pin the time.
 */
import type { Pattern, Progress } from '../model/types.ts'
import { encodeRow } from './readout.ts'

/** Seconds since the epoch, the same unit as Python's time.time(). */
export type Clock = () => number

export const systemClock: Clock = () => Date.now() / 1000

/** Internal mutable working copy; operations build one and hand it back as Progress. */
interface Draft {
  completed_row_ids: Set<string>
  current_row_id: string | null
  current_run_index: number
  current_run_stitches: number
  started_at: number | null
}

function copy(pr: Progress): Draft {
  return {
    completed_row_ids: new Set(pr.completed_row_ids),
    current_row_id: pr.current_row_id,
    current_run_index: pr.current_run_index,
    current_run_stitches: pr.current_run_stitches,
    started_at: pr.started_at,
  }
}

export function rowIndex(p: Pattern, rowId: string | null): number | null {
  if (rowId === null) return null
  const i = p.row_ids.indexOf(rowId)
  return i < 0 ? null : i
}

export function numRuns(p: Pattern, r: number): number {
  return encodeRow(p, r).length
}

/** Image row indices in the order they are worked (bottom row first if bottom_up). */
export function workSequence(p: Pattern): number[] {
  const seq: number[] = []
  for (let k = 0; k < p.rows; k++) seq.push(p.bottom_up ? p.rows - 1 - k : k)
  return seq
}

function rowIdsInWorkOrder(p: Pattern): string[] {
  return workSequence(p).map((i) => p.row_ids[i]!)
}

export function firstIncompleteRow(p: Pattern, pr: Progress): string | null {
  for (const rid of rowIdsInWorkOrder(p)) {
    if (!pr.completed_row_ids.has(rid)) return rid
  }
  return null
}

/** Place the cursor on the first unfinished row and stamp started_at (§6.4). */
export function ensureStarted(p: Pattern, pr: Progress, clock: Clock = systemClock): Progress {
  return started(p, pr, clock)
}

function started(p: Pattern, pr: Progress, clock: Clock): Draft {
  const d = copy(pr)
  if (d.started_at === null) d.started_at = clock()
  if (d.current_row_id === null || !p.row_ids.includes(d.current_row_id)) {
    // `||`, not `??`: Python's `or` also skips an empty-string row id.
    d.current_row_id =
      firstIncompleteRow(p, d) || (p.row_ids.length ? p.row_ids[p.row_ids.length - 1]! : null)
    d.current_run_index = 0
    d.current_run_stitches = 0
  }
  return d
}

/** Tap a chip to make it the active run. */
export function setRunIndex(
  p: Pattern,
  pr: Progress,
  index: number,
  clock: Clock = systemClock,
): Progress {
  const d = started(p, pr, clock)
  const r = rowIndex(p, d.current_row_id)
  if (r === null) return d
  d.current_run_index = Math.max(0, Math.min(index, numRuns(p, r) - 1))
  d.current_run_stitches = 0
  return d
}

/** Mark colour segment `runIndex` in the current row done — and, implicitly, every
 *  segment before it. If it's the last segment, the whole row completes. */
export function markSegmentComplete(
  p: Pattern,
  pr: Progress,
  runIndex: number,
  clock: Clock = systemClock,
): Progress {
  const d = started(p, pr, clock)
  const r = rowIndex(p, d.current_row_id)
  if (r === null) return d
  const nruns = numRuns(p, r)
  runIndex = Math.max(0, Math.min(runIndex, nruns - 1))
  if (runIndex + 1 >= nruns) return completeCurrentRow(p, d, clock)
  d.current_run_index = runIndex + 1
  d.current_run_stitches = 0
  return d
}

/** Record that `stitches` of colour segment `runIndex` are done (segments before it are
 *  marked complete). Reaching the segment's full count completes it. */
export function setRunStitches(
  p: Pattern,
  pr: Progress,
  runIndex: number,
  stitches: number,
  clock: Clock = systemClock,
): Progress {
  const d = started(p, pr, clock)
  const r = rowIndex(p, d.current_row_id)
  if (r === null) return d
  const runs = encodeRow(p, r)
  runIndex = Math.max(0, Math.min(runIndex, runs.length - 1))
  const run = runs[runIndex]
  // Python raises IndexError here for a zero-width row; there is nothing to record.
  if (run === undefined) return d
  const count = run.count
  stitches = Math.max(0, Math.min(stitches, count))
  if (stitches >= count) return markSegmentComplete(p, d, runIndex, clock)
  d.current_run_index = runIndex
  d.current_run_stitches = stitches
  return d
}

/** The row_id `step` positions away in working order (+1 = next, -1 = previous). */
function workNeighbour(p: Pattern, rowId: string, step: number): string | null {
  const seq = rowIdsInWorkOrder(p)
  const at = seq.indexOf(rowId)
  if (at < 0) return null
  const i = at + step
  return i >= 0 && i < seq.length ? seq[i]! : null
}

/** Mark the whole current row done and move to the next row in working order. This is
 *  what the big 'Row complete' button does — a row at a time, not a run at a time. */
export function completeCurrentRow(p: Pattern, pr: Progress, clock: Clock = systemClock): Progress {
  const d = started(p, pr, clock)
  if (d.current_row_id === null) return d
  d.completed_row_ids.add(d.current_row_id)
  const nxt = firstIncompleteRow(p, d) || workNeighbour(p, d.current_row_id, +1)
  if (nxt !== null) d.current_row_id = nxt
  d.current_run_index = 0
  d.current_run_stitches = 0
  return d
}

/** Step back a whole row in working order, reopening it for re-working. */
export function goPreviousRow(p: Pattern, pr: Progress, clock: Clock = systemClock): Progress {
  const d = started(p, pr, clock)
  if (d.current_row_id === null) return d
  const prev = workNeighbour(p, d.current_row_id, -1)
  if (prev === null) return d
  d.completed_row_ids.delete(prev)
  d.completed_row_ids.delete(d.current_row_id)
  d.current_row_id = prev
  d.current_run_index = 0
  d.current_run_stitches = 0
  return d
}

/** Move the cursor to the next run; past the last run, complete the row (§10). */
export function advance(p: Pattern, pr: Progress, clock: Clock = systemClock): Progress {
  const d = started(p, pr, clock)
  const r = rowIndex(p, d.current_row_id)
  if (r === null) return d
  if (d.current_run_index + 1 < numRuns(p, r)) {
    d.current_run_index += 1
    d.current_run_stitches = 0
    return d
  }
  return completeCurrentRow(p, d, clock)
}

/** Step the cursor back one run; from the first run, reopen the previous work row. */
export function retreat(p: Pattern, pr: Progress, clock: Clock = systemClock): Progress {
  const d = started(p, pr, clock)
  const r = rowIndex(p, d.current_row_id)
  if (r === null) return d
  d.current_run_stitches = 0
  if (d.current_run_index > 0) {
    d.current_run_index -= 1
    return d
  }
  const prev = workNeighbour(p, d.current_row_id!, -1)
  if (prev === null) return d
  d.completed_row_ids.delete(prev)
  d.completed_row_ids.delete(d.current_row_id!)
  d.current_row_id = prev
  d.current_run_index = Math.max(0, numRuns(p, rowIndex(p, prev)!) - 1)
  return d
}

/** Stitches left: all cells in unfinished rows, minus stitches already done in the
 *  current row (completed segments plus any partial progress in the active one). */
export function remainingStitches(p: Pattern, pr: Progress): number {
  let total = 0
  for (const rid of p.row_ids) {
    if (pr.completed_row_ids.has(rid)) continue
    total += p.cols
  }
  const r = rowIndex(p, pr.current_row_id)
  if (r !== null && !pr.completed_row_ids.has(pr.current_row_id!)) {
    const runs = encodeRow(p, r)
    // runs[:current_run_index]. Array.slice treats a negative end the way Python
    // slicing does, which matters for a hand-edited or corrupt progress.json.
    const done =
      runs.slice(0, pr.current_run_index).reduce((s, run) => s + run.count, 0) +
      pr.current_run_stitches
    total -= done
  }
  return Math.max(0, total)
}

export function completedCount(p: Pattern, pr: Progress): number {
  return p.row_ids.filter((rid) => pr.completed_row_ids.has(rid)).length
}

export function isComplete(p: Pattern, pr: Progress): boolean {
  return p.row_ids.every((rid) => pr.completed_row_ids.has(rid)) && p.rows > 0
}
