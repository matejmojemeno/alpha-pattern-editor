/**
 * Keep the screen on while the Work stage is showing, so a phone doesn't sleep mid-row.
 *
 * The browser drops a screen wake lock whenever the page is hidden, so it is asked for
 * again each time the page becomes visible, and on the next tap or key press in case the
 * browser wanted a user gesture first. Where the Screen Wake Lock API is missing or
 * refuses (no user activation yet, low battery, an iframe without permission), the app
 * carries on without it.
 */
type Sentinel = { release(): Promise<void>; released?: boolean }
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> }

/** Hold a screen wake lock until the returned function is called. */
export function keepScreenAwake(
  api: WakeLockApi | undefined = (globalThis.navigator as { wakeLock?: WakeLockApi } | undefined)?.wakeLock,
  doc: Document = document,
): () => void {
  if (!api) return () => {}
  let sentinel: Sentinel | null = null
  let stopped = false
  let requesting = false

  const acquire = async () => {
    if (stopped || requesting || doc.visibilityState !== 'visible') return
    if (sentinel && !sentinel.released) return
    requesting = true
    try {
      const s = await api.request('screen')
      if (stopped) void s.release().catch(() => {})
      else sentinel = s
    } catch {
      // Not allowed right now; the next visibility change or tap tries again.
    } finally {
      requesting = false
    }
  }

  const onVisibility = () => void acquire()
  doc.addEventListener('visibilitychange', onVisibility)
  doc.addEventListener('pointerdown', onVisibility, true)
  doc.addEventListener('keydown', onVisibility, true)
  void acquire()

  return () => {
    stopped = true
    doc.removeEventListener('visibilitychange', onVisibility)
    doc.removeEventListener('pointerdown', onVisibility, true)
    doc.removeEventListener('keydown', onVisibility, true)
    const s = sentinel
    sentinel = null
    if (s && !s.released) void s.release().catch(() => {})
  }
}
