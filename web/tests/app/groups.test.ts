import { describe, expect, it } from 'vitest'

import { currentPiece, groupProgress, groupStatus, groupUpdated, piecesOf } from '../../src/app/groups.ts'
import type { ProjectGroup, ProjectSummary, WorkStatus } from '../../src/storage/db.ts'

const summary = (id: string, o: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id,
  name: id,
  rows: 10,
  cols: 10,
  progress_pct: 0,
  work_status: 'not-started',
  updated_at: 1,
  thumbnail: new Blob(),
  thumbnail_kind: 'cells',
  ...o,
})

const piece = (id: string, work_status: WorkStatus, updated_at = 1) => ({ id, summary: { work_status, updated_at } })

describe('groupProgress', () => {
  it('weights each piece by its stitches', () => {
    // A 60×100 back half done (3,000 of 6,000) and a 20×100 sleeve not started (0 of 2,000).
    expect(groupProgress([summary('b', { cols: 60, rows: 100, progress_pct: 50 }), summary('s', { cols: 20, rows: 100 })])).toBe(37.5)
    // Not the average of the two bars, which would be 25.
    expect(groupProgress([summary('a', { progress_pct: 100 })])).toBe(100)
    expect(groupProgress([])).toBe(0)
  })
})

describe('groupStatus', () => {
  it('finished when every piece is, not started when none is, else in progress', () => {
    const s = (...l: WorkStatus[]) => groupStatus(l.map((work_status) => ({ work_status })))
    expect(s('finished', 'finished')).toBe('finished')
    expect(s('not-started', 'not-started')).toBe('not-started')
    expect(s('finished', 'not-started')).toBe('in-progress') // one done, the next waiting
    expect(s('not-started', 'in-progress')).toBe('in-progress')
    expect(s()).toBe('not-started')
  })
})

describe('currentPiece', () => {
  it('is the started piece worked on last', () => {
    expect(currentPiece([piece('a', 'in-progress', 5), piece('b', 'in-progress', 9), piece('c', 'not-started', 20)])).toBe('b')
  })
  it('with none started, the first unfinished one in order', () => {
    expect(currentPiece([piece('a', 'finished', 50), piece('b', 'not-started'), piece('c', 'not-started')])).toBe('b')
  })
  it('with all finished, the first; with none, undefined', () => {
    expect(currentPiece([piece('a', 'finished'), piece('b', 'finished')])).toBe('a')
    expect(currentPiece([])).toBeUndefined()
  })
})

describe('piecesOf and groupUpdated', () => {
  it('keeps the stored pieces in the group’s order, and dates the group by its newest change', () => {
    const g: ProjectGroup = {
      id: 'g',
      name: 'G',
      pieces: [
        { id: 'b', label: 'Back' },
        { id: 'gone', label: 'Gone' },
        { id: 'a', label: 'Front' },
      ],
      created_at: 1,
      updated_at: 4,
    }
    const byId = new Map([summary('a', { updated_at: 7 }), summary('b', { updated_at: 2 })].map((s) => [s.id, s]))
    const pieces = piecesOf(g, byId)
    expect(pieces.map((p) => p.label)).toEqual(['Back', 'Front'])
    expect(groupUpdated(g, pieces)).toBe(7)
    expect(groupUpdated({ ...g, updated_at: 10 }, pieces)).toBe(10)
  })
})
