/**
 * Progress kept sound across structural edits (§4.5). Not in work.py: the desktop only
 * re-seats a missing current row (`ensure_started`). These go further, and never throw.
 *
 * Progress is a set of row ids and a cursor, so it survives most edits untouched. What
 * can go wrong:
 *
 * - **Rows gone** (delete, trim, a border removed, scale, which gives every row a new
 *   id): completed ids that no longer name a row are dropped, so they don't count
 *   towards the percentage done.
 * - **The current row gone:** the cursor moves to the first row not yet done in working
 *   order, at its start, as `ensureStarted` places it.
 * - **The current row changed** (columns inserted, deleted, mirrored, or its cells
 *   repainted): its segments have moved, so the cursor goes back to the start of that
 *   row (§4.5: "any column-structural edit must reset run_index to 0").
 * - **A cursor past the row** (a file edited elsewhere): back to the start of the row.
 *
 * `carryProgress` is what the Design stage saves. It always starts from the progress and
 * pattern the Design stage opened with, so undoing an edit brings its progress back.
 */
import type { Pattern, Progress } from '../model/types.ts'
import { encodeRow } from './readout.ts'
import { firstIncompleteRow, rowIndex } from './work.ts'

/** The progress `pr` made sound for `p`. Returns `pr` itself when nothing needed fixing. */
export function repairProgress(p: Pattern, pr: Progress): Progress {
  const ids = new Set(p.row_ids)
  let completed = pr.completed_row_ids
  if ([...completed].some((id) => !ids.has(id))) completed = new Set([...completed].filter((id) => ids.has(id)))

  let { current_row_id: current, current_run_index: run, current_run_stitches: stitches } = pr
  if (current !== null && !ids.has(current)) {
    // `||`, as ensureStarted: an empty-string id counts as none.
    current = firstIncompleteRow(p, { ...pr, completed_row_ids: completed }) || (p.row_ids.at(-1) ?? null)
    run = 0
    stitches = 0
  }
  const r = rowIndex(p, current)
  if (r !== null) {
    const runs = encodeRow(p, r)
    const at = runs[run]
    if (!Number.isInteger(run) || run < 0 || !at || !(stitches >= 0 && stitches < at.count)) {
      run = 0
      stitches = 0
    }
  }
  if (
    completed === pr.completed_row_ids &&
    current === pr.current_row_id &&
    run === pr.current_run_index &&
    stitches === pr.current_run_stitches
  ) {
    return pr
  }
  return { ...pr, completed_row_ids: completed, current_row_id: current, current_run_index: run, current_run_stitches: stitches }
}

const sameRuns = (a: Pattern, ra: number, b: Pattern, rb: number) => {
  const x = encodeRow(a, ra)
  const y = encodeRow(b, rb)
  return x.length === y.length && x.every((run, i) => run.palette_index === y[i]!.palette_index && run.count === y[i]!.count)
}

/**
 * The progress `pr`, made for pattern `before`, carried onto `after` (an edited copy of
 * it). The cursor stays where it was only if the current row still reads the same, in
 * working order; otherwise it goes back to the start of the row (or of the first row not
 * done, if the row is gone).
 */
export function carryProgress(before: Pattern, pr: Progress, after: Pattern): Progress {
  if (before === after) return repairProgress(after, pr)
  const was = rowIndex(before, pr.current_row_id)
  const now = rowIndex(after, pr.current_row_id)
  let moved = pr
  if (was !== null && now !== null && (pr.current_run_index > 0 || pr.current_run_stitches > 0) && !sameRuns(before, was, after, now)) {
    moved = { ...pr, current_run_index: 0, current_run_stitches: 0 }
  }
  return repairProgress(after, moved)
}

/** What an edit from `p` to `next` would lose of the progress `pr` (made for `p`). */
export interface ProgressLoss {
  /** Rows marked done that the edit removes. */
  readonly doneRows: number
  /** Whether the row partway through (some of it recorded) is removed. */
  readonly partRow: boolean
}

export function progressLoss(p: Pattern, pr: Progress, next: Pattern): ProgressLoss {
  const kept = new Set(next.row_ids)
  let doneRows = 0
  for (const id of p.row_ids) if (pr.completed_row_ids.has(id) && !kept.has(id)) doneRows++
  const cur = pr.current_row_id
  const partRow =
    cur !== null &&
    rowIndex(p, cur) !== null &&
    !kept.has(cur) &&
    !pr.completed_row_ids.has(cur) &&
    (pr.current_run_index > 0 || pr.current_run_stitches > 0)
  return { doneRows, partRow }
}

export const losesProgress = (l: ProgressLoss) => l.doneRows > 0 || l.partRow
