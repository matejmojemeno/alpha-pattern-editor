/** Which stage a project opens in (§6.4). */
import { completedCount } from '../logic/work.ts'
import type { Pattern, Progress, Project, Stage } from '../model/types.ts'

/** Whether any work has been recorded: a finished row, or part of the current one.
 *  Rows since deleted in Design don't count. */
export function hasProgress(p: Pattern, pr: Progress): boolean {
  return completedCount(p, pr) > 0 || pr.current_run_index > 0 || pr.current_run_stitches > 0
}

/** The Work stage if there is progress, otherwise the stage it was last in. */
export function openingStage(project: Project): Stage {
  return hasProgress(project.pattern, project.progress) ? 'work' : project.stage
}

/** The Design stage's warning on arriving with progress (§6.4), or null without any. */
export function progressWarning(p: Pattern, pr: Progress): string | null {
  if (!hasProgress(p, pr)) return null
  const n = completedCount(p, pr)
  return `You're ${n} row${n === 1 ? '' : 's'} into this project. Structural edits may shift your place.`
}
