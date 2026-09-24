/**
 * Automatic saving for the Work stage, which runs on phones: the tab can be killed at any
 * moment, and there is no Save button to forget.
 *
 * `schedule` debounces: a burst of changes becomes one save of the latest state, ~300 ms
 * after the last of them. `flush` saves any pending change now, and is what the page
 * calls when it is hidden or unloaded. Saves never overlap: a change made while one is
 * in flight is saved after it. A failed save stays pending, so the next change or flush
 * retries it.
 */
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

export const SAVE_DELAY_MS = 300

export class AutoSaver<T> {
  private pending: T | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> = Promise.resolve()
  private saving = false
  private failed = false
  private current: SaveStatus = 'saved'
  private readonly save: (value: T) => Promise<unknown>
  private readonly onStatus: (status: SaveStatus) => void
  private readonly delay: number

  constructor(
    save: (value: T) => Promise<unknown>,
    onStatus: (status: SaveStatus) => void = () => {},
    delay: number = SAVE_DELAY_MS,
  ) {
    this.save = save
    this.onStatus = onStatus
    this.delay = delay
  }

  get status(): SaveStatus {
    return this.current
  }

  /** Save `value` after the debounce, replacing anything not yet saved. */
  schedule(value: T): void {
    this.pending = value
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, this.delay)
    this.update()
  }

  /** Save any pending change now; resolves once everything scheduled so far is saved
   *  (or has failed). */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return this.run()
  }

  private run(): Promise<void> {
    this.inFlight = this.inFlight.then(async () => {
      const value = this.pending
      if (value === null) return
      this.pending = null
      this.saving = true
      this.update()
      try {
        await this.save(value)
        this.failed = false
      } catch {
        this.failed = true
        // Keep it for the next attempt, unless something newer has replaced it.
        this.pending ??= value
      } finally {
        this.saving = false
        this.update()
      }
    })
    return this.inFlight
  }

  private update(): void {
    const next: SaveStatus = this.saving
      ? 'saving'
      : this.failed
        ? 'error'
        : this.pending !== null
          ? 'pending'
          : 'saved'
    if (next === this.current) return
    this.current = next
    this.onStatus(next)
  }
}
