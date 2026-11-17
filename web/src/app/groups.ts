/**
 * A project with pieces, as the Library and the Work stage show it: worked out from its
 * pieces' Library summaries, so nothing here opens an archive.
 */
import type { ProjectGroup, ProjectSummary, WorkStatus } from '../storage/db.ts'

/** A group's pieces that are stored, in its order, each with its summary. */
export function piecesOf(group: ProjectGroup, byId: ReadonlyMap<string, ProjectSummary>) {
  return group.pieces.flatMap((p) => {
    const summary = byId.get(p.id)
    return summary ? [{ ...p, summary }] : []
  })
}

/**
 * How far through the whole project you are, 0..100, weighted by stitches: a sleeve of
 * 2,000 stitches counts for less than a back of 6,000. Each piece's own figure is its
 * rows done (the card's bar), and every row of a piece has its columns of stitches, so a
 * piece contributes rows done × columns.
 */
export function groupProgress(pieces: readonly Pick<ProjectSummary, 'rows' | 'cols' | 'progress_pct'>[]): number {
  let total = 0
  let done = 0
  for (const s of pieces) {
    const n = s.rows * s.cols
    total += n
    done += (n * s.progress_pct) / 100
  }
  return total ? (100 * done) / total : 0
}

/** The Library section a project is listed in: finished when every piece is, not started
 *  when none is started, and otherwise in progress. */
export function groupStatus(pieces: readonly Pick<ProjectSummary, 'work_status'>[]): WorkStatus {
  if (pieces.length && pieces.every((s) => s.work_status === 'finished')) return 'finished'
  if (pieces.every((s) => s.work_status === 'not-started')) return 'not-started'
  return 'in-progress'
}

/**
 * The piece Continue opens: the unfinished piece you worked on last, or, with none
 * started, the first unfinished one in the project's order. With every piece finished,
 * the first. Undefined only for a group with no stored pieces.
 */
export function currentPiece(
  pieces: readonly { id: string; summary: Pick<ProjectSummary, 'work_status' | 'updated_at'> }[],
): string | undefined {
  const started = pieces.filter((p) => p.summary.work_status === 'in-progress')
  if (started.length) return started.reduce((a, b) => (b.summary.updated_at > a.summary.updated_at ? b : a)).id
  return (pieces.find((p) => p.summary.work_status !== 'finished') ?? pieces[0])?.id
}

/** When a project last changed, itself or any of its pieces: its place in the Library's
 *  newest-first order. */
export function groupUpdated(group: ProjectGroup, pieces: readonly { summary: Pick<ProjectSummary, 'updated_at'> }[]): number {
  return Math.max(group.updated_at, ...pieces.map((p) => p.summary.updated_at))
}

/** "3 pieces". */
export const piecesText = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`
