/**
 * The app shell's only way to reach detection: a dynamic import of detect/client.ts, so
 * the Pyodide worker is never part of the landing screen, the Library or the Work stage
 * (docs/web-port-plan.md, "Central decision"). tests/boundary.test.ts checks that no
 * static import reaches src/detect/.
 */
type ClientModule = typeof import('../detect/client.ts')

let loading: Promise<ClientModule> | null = null

export function loadDetection(): Promise<ClientModule> {
  loading ??= import('../detect/client.ts')
  return loading
}

/** Start downloading Pyodide before it's needed: the pointer or focus is on "Import
 *  pattern". Harmless to call repeatedly. */
export function preloadDetection(): void {
  void loadDetection().then(
    (m) => m.preload(),
    () => {}, // offline, say: the import screen will report it when it's opened
  )
}

/** Terminate the worker, if one was ever started, to free Pyodide's memory. */
export function releaseDetection(): void {
  void loading?.then(
    (m) => m.release(),
    () => {},
  )
}
