/** Progress after structural edits: every edit the Design stage makes, from a project
 *  with rows done in the Work stage. */
import { describe, expect, it } from 'vitest'

import * as edit from '../../src/logic/edit.ts'
import { encodeRow } from '../../src/logic/readout.ts'
import { carryProgress, losesProgress, progressLoss, repairProgress } from '../../src/logic/progress.ts'
import { completeCurrentRow, ensureStarted, isComplete, remainingStitches, rowIndex, setRunStitches } from '../../src/logic/work.ts'
import { emptyProgress, type Pattern, type Progress } from '../../src/model/types.ts'

/** 4 cols × 6 rows, two colours, worked bottom row first: each row three white and a
 *  black at one end. */
function pattern(): Pattern {
  let p = edit.newPattern(4, 6, '#ffffff', { now: 1 })
  p = edit.addPaletteEntry(p, '#000000', 'Black')
  // Every row different, so each has its own segments.
  for (let r = 0; r < p.rows; r++) p = edit.setCell(p, r, r % 2 ? 0 : 3, 1)
  return p
}

/** Rows done: the bottom three, then two stitches into the fourth's two-white segment. */
function worked(p: Pattern): Progress {
  let pr = ensureStarted(p, emptyProgress(), () => 1)
  for (let i = 0; i < 3; i++) pr = completeCurrentRow(p, pr, () => 1)
  const long = encodeRow(p, rowIndex(p, pr.current_row_id)!).findIndex((run) => run.count > 2)
  return setRunStitches(p, pr, long, 2, () => 1)
}

const ids = (p: Pattern, rows: number[]) => rows.map((r) => p.row_ids[r]!)

describe('carryProgress', () => {
  const p = pattern()
  const pr = worked(p)
  // Rows 5, 4, 3 (image rows, bottom up) are done; row 2 is current, 2 stitches in.
  it('starts from a sound place', () => {
    expect([...pr.completed_row_ids].sort()).toEqual(ids(p, [3, 4, 5]).sort())
    expect(rowIndex(p, pr.current_row_id)).toBe(2)
    expect(pr.current_run_stitches).toBe(2)
  })

  it('keeps everything through cell edits away from the current row, borders and padding', () => {
    for (const q of [
      edit.setCell(p, 0, 0, 1),
      edit.addBorder(p, { top: 2, left: 0, bottom: 2, paletteIndex: 0 }),
      edit.padToSize(p, 4, 9),
      edit.insertRow(p, 0),
      edit.trimUniformEdges(p, { top: true }),
    ]) {
      expect(carryProgress(p, pr, q)).toBe(pr)
    }
  })

  it('goes back to the start of the current row when its segments move', () => {
    for (const q of [
      edit.insertColumn(p, 0, 1),
      edit.deleteColumn(p, 3),
      edit.mirrorH(p),
      edit.addBorder(p, { left: 1 }),
      edit.setCell(p, 2, 1, 1),
      // One row added below: every row's working number moves by one, so rows that
      // alternate now read the other way, and the segments are the other way round.
      edit.addBorder(p, { bottom: 1 }),
    ]) {
      const got = carryProgress(p, pr, q)
      expect(got.completed_row_ids).toEqual(pr.completed_row_ids)
      expect(got.current_row_id).toBe(pr.current_row_id)
      expect([got.current_run_index, got.current_run_stitches]).toEqual([0, 0])
    }
  })

  it('drops completed rows that are deleted, and moves on from a deleted current row', () => {
    const q = edit.deleteRow(p, 4)
    const got = carryProgress(p, pr, q)
    expect([...got.completed_row_ids].sort()).toEqual(ids(p, [3, 5]).sort())
    expect(got.current_row_id).toBe(pr.current_row_id)

    const gone = carryProgress(p, pr, edit.deleteRow(p, 2))
    // The first row not done, in working order: the row above the deleted one.
    expect(gone.current_row_id).toBe(p.row_ids[1])
    expect([gone.current_run_index, gone.current_run_stitches]).toEqual([0, 0])
  })

  it('loses everything to scale, which gives every row a new id, and places the cursor on its first row', () => {
    const q = edit.scale(p, 2)
    const got = carryProgress(p, pr, q)
    expect(got.completed_row_ids.size).toBe(0)
    expect(got.current_row_id).toBe(q.row_ids.at(-1))
    expect(remainingStitches(q, got)).toBe(q.rows * q.cols)
  })

  it('loses everything to a quarter turn, which gives every row a new id, and undo brings it back', () => {
    for (const clockwise of [true, false]) {
      const q = edit.rotate90(p, clockwise)
      const got = carryProgress(p, pr, q)
      expect(got.completed_row_ids.size).toBe(0)
      // Worked bottom up: the cursor goes to the first row in working order.
      expect(got.current_row_id).toBe(q.row_ids.at(-1))
      expect([got.current_run_index, got.current_run_stitches]).toEqual([0, 0])
      expect(remainingStitches(q, got)).toBe(q.rows * q.cols)
      expect(carryProgress(p, pr, p)).toBe(pr)
    }
  })

  it('keeps a flipped pattern’s ids, so the same rows stay done wherever they went', () => {
    const q = edit.mirrorV(p)
    const got = carryProgress(p, pr, q)
    expect(got.completed_row_ids).toEqual(pr.completed_row_ids)
    expect(got.current_row_id).toBe(pr.current_row_id)
  })

  it('brings everything back when the edit is undone (it always starts from the original)', () => {
    const q = edit.scale(p, 3)
    expect(carryProgress(p, pr, q).completed_row_ids.size).toBe(0)
    expect(carryProgress(p, pr, p)).toBe(pr)
  })

  it('handles a finished pattern and one never started', () => {
    let done = pr
    while (!isComplete(p, done)) done = completeCurrentRow(p, done, () => 1)
    const q = edit.deleteRow(p, 0)
    const got = carryProgress(p, done, q)
    expect(isComplete(q, got)).toBe(true)
    expect(carryProgress(p, emptyProgress(), edit.scale(p, 2))).toEqual(emptyProgress())
  })
})

describe('repairProgress', () => {
  const p = pattern()
  it('makes progress written for other rows sound, without throwing', () => {
    const stale: Progress = {
      completed_row_ids: new Set(['gone1', p.row_ids[5]!, 'gone2']),
      current_row_id: 'gone3',
      current_run_index: 7,
      current_run_stitches: 99,
      started_at: 5,
    }
    const got = repairProgress(p, stale)
    expect([...got.completed_row_ids]).toEqual([p.row_ids[5]])
    expect(got.current_row_id).toBe(p.row_ids[4])
    expect([got.current_run_index, got.current_run_stitches]).toEqual([0, 0])
    expect(got.started_at).toBe(5)
  })

  it('puts a cursor past the row, or stitches past the segment, back at the row’s start', () => {
    const base = ensureStarted(p, emptyProgress(), () => 1)
    expect(repairProgress(p, { ...base, current_run_index: 9 }).current_run_index).toBe(0)
    expect(repairProgress(p, { ...base, current_run_index: -1 }).current_run_index).toBe(0)
    expect(repairProgress(p, { ...base, current_run_stitches: 50 }).current_run_stitches).toBe(0)
    expect(repairProgress(p, base)).toBe(base)
  })

  it('leaves a project never started alone', () => {
    const pr = emptyProgress()
    expect(repairProgress(p, pr)).toBe(pr)
  })
})

describe('progressLoss', () => {
  const p = pattern()
  const pr = worked(p)
  it('counts the done rows an edit removes, and the row partway through', () => {
    expect(progressLoss(p, pr, edit.deleteRow(p, 4))).toEqual({ doneRows: 1, partRow: false })
    expect(progressLoss(p, pr, edit.deleteRow(p, 2))).toEqual({ doneRows: 0, partRow: true })
    expect(progressLoss(p, pr, edit.scale(p, 2))).toEqual({ doneRows: 3, partRow: true })
    expect(progressLoss(p, pr, edit.rotate90(p))).toEqual({ doneRows: 3, partRow: true })
    expect(progressLoss(p, pr, edit.rotate90(p, false))).toEqual({ doneRows: 3, partRow: true })
    expect(progressLoss(p, pr, edit.addBorder(p, { bottom: -2 }))).toEqual({ doneRows: 2, partRow: false })
    expect(losesProgress(progressLoss(p, pr, edit.deleteRow(p, 0)))).toBe(false)
    expect(losesProgress(progressLoss(p, pr, edit.mirrorV(p)))).toBe(false)
  })

  it('does not count a current row with nothing recorded yet', () => {
    const fresh = ensureStarted(p, emptyProgress(), () => 1)
    expect(losesProgress(progressLoss(p, fresh, edit.scale(p, 2)))).toBe(false)
  })
})
