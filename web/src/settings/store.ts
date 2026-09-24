/**
 * App-wide display preferences, kept in localStorage.
 *
 * Only *how the app looks* lives here. Anything that changes how a pattern is read, such
 * as start_direction, stays on the pattern and travels with its `.alpha` file.
 *
 * Storage can be missing or hostile: Safari private windows, blocked site data and
 * sandboxed iframes all make localStorage throw, sometimes just for touching the
 * property. Every access is guarded, and with nothing stored the defaults apply.
 */

export interface Settings {
  /** Draw the current row, and the rows either side of it, taller in the chart. */
  readonly emphasiseRows: boolean
  /** The high-contrast theme, app-wide. */
  readonly highContrast: boolean
  /** Draw only the rows around the current one. */
  readonly focusMode: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  emphasiseRows: true,
  highContrast: false,
  focusMode: false,
}

export const SETTINGS_KEY = 'alpha-pattern-editor:settings'

type GetStorage = () => Storage | null | undefined

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Read stored settings, keeping only well-typed known fields over the defaults. */
export function parseSettings(raw: string | null): Settings {
  if (raw === null) return DEFAULT_SETTINGS
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return DEFAULT_SETTINGS
  }
  if (typeof data !== 'object' || data === null) return DEFAULT_SETTINGS
  const out: Record<string, boolean> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const v = (data as Record<string, unknown>)[key]
    if (typeof v === 'boolean') out[key] = v
  }
  return out as unknown as Settings
}

export interface SettingsStore {
  get(): Settings
  set(patch: Partial<Settings>): void
  subscribe(listener: () => void): () => void
}

export function createSettingsStore(getStorage: GetStorage = defaultStorage): SettingsStore {
  const read = (): Settings => {
    try {
      return parseSettings(getStorage()?.getItem(SETTINGS_KEY) ?? null)
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  let current = read()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  // Another tab changed the settings.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SETTINGS_KEY && e.key !== null) return
    current = read()
    emit()
  }

  return {
    get: () => current,
    set(patch) {
      current = { ...current, ...patch }
      try {
        getStorage()?.setItem(SETTINGS_KEY, JSON.stringify(current))
      } catch {
        // Quota or blocked storage: keep the change for this session only.
      }
      emit()
    },
    subscribe(listener) {
      if (listeners.size === 0) globalThis.addEventListener?.('storage', onStorage)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) globalThis.removeEventListener?.('storage', onStorage)
      }
    },
  }
}
