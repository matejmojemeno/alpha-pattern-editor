/**
 * App-wide preferences, kept in localStorage.
 *
 * Only *how the app looks* and the yarn you buy live here. Anything that changes how a
 * pattern is read, such as start_direction, stays on the pattern and travels with its
 * `.alpha` file. The colour library and the yarn estimate's inputs are app-wide because
 * they describe the crocheter's yarn and hands, not the chart, and because a field on the
 * pattern would have to round-trip through the desktop app, which knows nothing of it.
 *
 * Storage can be missing or hostile: Safari private windows, blocked site data and
 * sandboxed iframes all make localStorage throw, sometimes just for touching the
 * property. Every access is guarded, and with nothing stored the defaults apply.
 */

import { DEFAULT_LIBRARY, isLibraryId, type LibraryId } from '../yarn/libraries.ts'

export type Units = 'metric' | 'imperial'

export interface Settings {
  /** Draw the current row, and the rows either side of it, taller in the chart. */
  readonly emphasiseRows: boolean
  /** The high-contrast theme, app-wide. */
  readonly highContrast: boolean
  /** Draw only the rows around the current one. */
  readonly focusMode: boolean
  /** The library each palette colour is matched to (yarn/libraries.ts). */
  readonly colourLibrary: LibraryId
  /** Yarn one stitch uses, in centimetres (yarn/usage.ts). */
  readonly yarnPerStitchCm: number
  /** One ball's length in metres, or null for the library's own ball. */
  readonly ballMetres: number | null
  /** Extra yarn on top of the estimate, in percent. */
  readonly marginPercent: number
  /** Show lengths in metres and centimetres, or yards and inches. */
  readonly units: Units
}

export const DEFAULT_SETTINGS: Settings = {
  emphasiseRows: true,
  highContrast: false,
  focusMode: false,
  colourLibrary: DEFAULT_LIBRARY,
  yarnPerStitchCm: 2.5,
  ballMetres: null,
  marginPercent: 10,
  units: 'metric',
}

const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Which stored values each field accepts; anything else falls back to the default. */
const VALID: { [K in keyof Settings]: (v: unknown) => boolean } = {
  emphasiseRows: (v) => typeof v === 'boolean',
  highContrast: (v) => typeof v === 'boolean',
  focusMode: (v) => typeof v === 'boolean',
  colourLibrary: isLibraryId,
  yarnPerStitchCm: positive,
  ballMetres: (v) => v === null || positive(v),
  marginPercent: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  units: (v) => v === 'metric' || v === 'imperial',
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
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = (data as Record<string, unknown>)[key]
    if (VALID[key](v)) out[key] = v
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
