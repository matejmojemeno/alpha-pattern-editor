/** Designing from blank: a new pattern saved as a Design-stage project, then opened. */
import { newPattern } from '../logic/edit.ts'
import { emptyProgress } from '../model/types.ts'
import type { ProjectRepo } from '../storage/repo.ts'
import { navigate, paths } from './router.ts'

export interface NewPatternSpec {
  name: string
  cols: number
  rows: number
  hex: string
}

/** Save a blank pattern and open it in the Design stage. Returns its id. */
export async function createPattern(repo: ProjectRepo, spec: NewPatternSpec): Promise<string> {
  const pattern = newPattern(spec.cols, spec.rows, spec.hex, { name: spec.name })
  const saved = await repo.save({ pattern, progress: emptyProgress(), stage: 'design' }, { sourcePng: null })
  navigate(paths.design(saved.pattern.id))
  return saved.pattern.id
}
