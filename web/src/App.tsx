import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { RepoContext, SettingsContext, appSettings, openAppRepo, useSettings, type RepoState } from './app/context.ts'
import { releaseDetection } from './app/detection.ts'
import { clearPendingImage } from './app/pendingImage.ts'
import { useRoute, type Route } from './app/router.ts'
import type { SettingsStore } from './settings/store.ts'
import type { ProjectRepo } from './storage/repo.ts'
import { TopBar } from './ui/components.tsx'
import { useDocumentTitle } from './ui/hooks.ts'
import { Landing } from './ui/screens/Landing.tsx'
import { Library } from './ui/screens/Library.tsx'
import { Settings } from './ui/screens/Settings.tsx'
import { Work } from './ui/screens/Work.tsx'

// The import screen is the only one that talks to the detection worker, so it is loaded
// only when opened: nothing it imports is part of the app's first download.
const ImportImage = lazy(() => import('./ui/screens/Import.tsx'))
// The Design stage is desktop-first and never needed to follow a pattern, so a phone
// opening the Work stage doesn't download it either.
const Design = lazy(() => import('./ui/screens/Design.tsx'))

/** `repo` and `settings` default to the real ones; tests pass their own. */
export default function App({
  repo,
  settings = appSettings,
}: {
  repo?: Promise<ProjectRepo>
  settings?: SettingsStore
}) {
  return (
    <SettingsContext value={settings}>
      <RepoProvider repo={repo}>
        <Theme />
        <Screens />
      </RepoProvider>
    </SettingsContext>
  )
}

function RepoProvider({ repo, children }: { repo?: Promise<ProjectRepo>; children: ReactNode }) {
  const [state, setState] = useState<RepoState>({ status: 'loading' })
  useEffect(() => {
    let live = true
    ;(repo ?? openAppRepo()).then(
      (r) => live && setState({ status: 'ready', repo: r }),
      (error: unknown) => live && setState({ status: 'error', error }),
    )
    return () => {
      live = false
    }
  }, [repo])
  return <RepoContext value={state}>{children}</RepoContext>
}

/** High contrast is a [data-contrast] attribute on <html>; tokens.css does the rest. */
function Theme() {
  const [{ highContrast }] = useSettings()
  useLayoutEffect(() => {
    const root = document.documentElement
    if (highContrast) root.dataset.contrast = 'high'
    else delete root.dataset.contrast
  }, [highContrast])
  return null
}

function Screens() {
  const route = useRoute()
  const key = 'id' in route ? `${route.name}/${route.id}` : route.name
  const first = useRef(true)

  // Pyodide holds hundreds of megabytes once it has detected a photo, and WebAssembly
  // memory never shrinks. Anywhere but the import screen, terminate it. The landing screen
  // may start it again ahead of need, when the pointer reaches "Import pattern".
  useEffect(() => {
    if (route.name === 'import') return
    releaseDetection()
    clearPendingImage()
  }, [route.name])

  // On navigation (not first load), start at the top and move focus to the new screen's
  // heading, so keyboard and screen-reader users land at its start.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo?.(0, 0)
    document.querySelector<HTMLElement>('main h1')?.focus()
  }, [key])

  return <Screen key={key} route={route} />
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'landing':
      return <Landing />
    case 'library':
      return <Library />
    case 'settings':
      return <Settings />
    case 'import':
      return (
        <Suspense fallback={<LoadingScreen />}>
          <ImportImage />
        </Suspense>
      )
    case 'work':
      return <Work id={route.id} />
    case 'design':
      return (
        <Suspense fallback={<LoadingScreen />}>
          <Design id={route.id} />
        </Suspense>
      )
    case 'notFound':
      return <NotFound />
  }
}

function LoadingScreen() {
  return (
    <main className="screen">
      <p className="muted">Loading…</p>
    </main>
  )
}

function NotFound() {
  useDocumentTitle('Not found')
  return (
    <main className="screen">
      <TopBar title="Page not found" />
      <p>There's nothing at this address.</p>
    </main>
  )
}
