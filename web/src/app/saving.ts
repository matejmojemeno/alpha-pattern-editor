/**
 * Saves still on their way, app-wide, so that a screen opening a project reads what the
 * screen before it saved.
 *
 * Leaving the Design stage for the Work stage (or back) unmounts one screen and mounts the
 * other in the same tick. The one leaving flushes its autosave then, and the one arriving
 * reads the project from the repository: without this, the read could beat the write and
 * open the pattern as it was before the last few edits.
 */
const pending = new Set<Promise<unknown>>()

/** Track a save until it settles (either way). Returns it. */
export function trackSave<T>(save: Promise<T>): Promise<T> {
  const settled: Promise<unknown> = save.then(
    () => pending.delete(settled),
    () => pending.delete(settled),
  )
  pending.add(settled)
  return save
}

/** Resolves once every save tracked so far has settled. */
export async function savesSettled(): Promise<void> {
  while (pending.size) await Promise.all([...pending])
}
