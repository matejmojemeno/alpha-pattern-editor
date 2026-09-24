/** App-wide services, provided by <App> and overridable in tests. */
import { createContext, useContext, useSyncExternalStore } from 'react'

import { createSettingsStore, type Settings, type SettingsStore } from '../settings/store.ts'
import { ProjectRepo } from '../storage/repo.ts'
import { ensurePersisted } from './persist.ts'

// --- settings ---------------------------------------------------------------------------

export const appSettings: SettingsStore = createSettingsStore()

export const SettingsContext = createContext<SettingsStore>(appSettings)

export function useSettings(): [Settings, SettingsStore['set']] {
  const store = useContext(SettingsContext)
  return [useSyncExternalStore(store.subscribe, store.get, store.get), store.set]
}

// --- the project repository ------------------------------------------------------------

export type RepoState =
  | { status: 'loading' }
  | { status: 'ready'; repo: ProjectRepo }
  | { status: 'error'; error: unknown }

export const RepoContext = createContext<RepoState>({ status: 'loading' })

export function useRepo(): RepoState {
  return useContext(RepoContext)
}

let appRepoPromise: Promise<ProjectRepo> | undefined

/** The app's one repository, opened on first use. Every successful save or import asks
 *  the browser to keep this site's data (see persist.ts). */
export function openAppRepo(): Promise<ProjectRepo> {
  appRepoPromise ??= ProjectRepo.open(undefined, undefined, { onStored: () => void ensurePersisted() })
  return appRepoPromise
}
