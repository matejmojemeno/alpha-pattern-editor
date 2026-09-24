/**
 * Replays fixtures/logic_golden.json (written by scripts/gen_fixtures.py from the
 * Python) against the TypeScript ports. Schema and porting notes: fixtures/README.md.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as readout from '../src/logic/readout.ts'
import * as work from '../src/logic/work.ts'
import { SKIP_INDEX, type Direction, type Pattern, type Progress } from '../src/model/types.ts'

interface ProgressRecord {
  completed_row_ids: string[]
  current_row_id: string | null
  current_run_index: number
  current_run_stitches: number
  started_at: number | null
}

interface Golden {
  format: number
  clock: number
  skip_index: number
  cases: {
    pattern: {
      id: string
      name: string
      rows: number
      cols: number
      row_ids: string[]
      cells: number[][]
      palette: { id: string; hex: string; name: string; dmc: string | null; count: number }[]
      start_direction: Direction
      alternate_direction: boolean
      bottom_up: boolean
    }
    readout: {
      rows: {
        row: number
        working_position: number
        working_number: number
        row_direction: Direction
        runs: { palette_index: number; count: number; start_col: number }[]
        text: string
        compact: string
      }[]
      export_all_rows_text: string
      format_stats: string
    }
    work: {
      work_sequence: number[]
      num_runs: number[]
      scenarios: {
        name: string
        initial: ProgressRecord
        steps: {
          op: string
          args: number[]
          progress: ProgressRecord
          remaining_stitches: number
          completed_count: number
          is_complete: boolean
          first_incomplete_row: string | null
        }[]
      }[]
    }
  }[]
}

const golden: Golden = JSON.parse(
  readFileSync(new URL('../../fixtures/logic_golden.json', import.meta.url), 'utf-8'),
)
const clock = () => golden.clock

function toPattern(rec: Golden['cases'][number]['pattern']): Pattern {
  return {
    id: rec.id,
    name: rec.name,
    created_at: 0,
    updated_at: 0,
    rows: rec.rows,
    cols: rec.cols,
    row_ids: rec.row_ids,
    cells: Uint16Array.from(rec.cells.flat()),
    palette: rec.palette,
    start_direction: rec.start_direction,
    alternate_direction: rec.alternate_direction,
    bottom_up: rec.bottom_up,
  }
}

function toProgress(rec: ProgressRecord): Progress {
  return { ...rec, completed_row_ids: new Set(rec.completed_row_ids) }
}

/** completed_row_ids is a set in Python; compare it as one. */
function asRecord(pr: Progress) {
  return { ...pr, completed_row_ids: [...pr.completed_row_ids].sort() }
}

type Op = (p: Pattern, pr: Progress, args: number[]) => Progress
const OPS: Record<string, Op> = {
  ensure_started: (p, pr) => work.ensureStarted(p, pr, clock),
  advance: (p, pr) => work.advance(p, pr, clock),
  retreat: (p, pr) => work.retreat(p, pr, clock),
  complete_current_row: (p, pr) => work.completeCurrentRow(p, pr, clock),
  go_previous_row: (p, pr) => work.goPreviousRow(p, pr, clock),
  set_run_index: (p, pr, [i]) => work.setRunIndex(p, pr, i!, clock),
  mark_segment_complete: (p, pr, [i]) => work.markSegmentComplete(p, pr, i!, clock),
  set_run_stitches: (p, pr, [i, s]) => work.setRunStitches(p, pr, i!, s!, clock),
}

it('fixture header is the version this suite understands', () => {
  expect(golden.format).toBe(1)
  expect(golden.skip_index).toBe(SKIP_INDEX)
  expect(golden.cases.length).toBeGreaterThan(0)
})

for (const c of golden.cases) {
  const p = toPattern(c.pattern)

  describe(p.id, () => {
    describe('readout', () => {
      for (const row of c.readout.rows) {
        it(`row ${row.row}`, () => {
          const r = row.row
          expect(readout.workingPosition(p, r)).toBe(row.working_position)
          expect(readout.workingNumber(p, r)).toBe(row.working_number)
          expect(readout.rowDirection(p, r)).toBe(row.row_direction)
          expect(readout.encodeRow(p, r)).toEqual(row.runs)
          expect(readout.formatRowText(p, r)).toBe(row.text)
          expect(readout.formatRowCompact(p, r)).toBe(row.compact)
        })
      }

      it('export_all_rows_text and format_stats', () => {
        expect(readout.exportAllRowsText(p)).toBe(c.readout.export_all_rows_text)
        expect(readout.formatStats(p.cols, p.rows, p.palette.length)).toBe(c.readout.format_stats)
      })
    })

    describe('work', () => {
      it('work_sequence and num_runs', () => {
        expect(work.workSequence(p)).toEqual(c.work.work_sequence)
        expect(Array.from({ length: p.rows }, (_, r) => work.numRuns(p, r))).toEqual(c.work.num_runs)
      })

      for (const sc of c.work.scenarios) {
        it(`scenario ${sc.name}`, () => {
          let pr = toProgress(sc.initial)
          sc.steps.forEach((step, i) => {
            const where = `step ${i}: ${step.op}(${step.args.join(', ')})`
            const op = OPS[step.op]
            expect(op, `unknown op in ${where}`).toBeDefined()

            const before = asRecord(pr)
            const next = op!(p, pr, step.args)
            expect(asRecord(pr), `${where} mutated its input`).toEqual(before)
            expect(next, `${where} returned its input`).not.toBe(pr)
            pr = next

            expect(asRecord(pr), `${where} progress`).toEqual(step.progress)
            expect(work.remainingStitches(p, pr), `${where} remaining_stitches`).toBe(
              step.remaining_stitches,
            )
            expect(work.completedCount(p, pr), `${where} completed_count`).toBe(step.completed_count)
            expect(work.isComplete(p, pr), `${where} is_complete`).toBe(step.is_complete)
            expect(work.firstIncompleteRow(p, pr), `${where} first_incomplete_row`).toBe(
              step.first_incomplete_row,
            )
          })
        })
      }
    })
  })
}
