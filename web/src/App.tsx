import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { RepoContext, SettingsContext, appSettings, openAppRepo, useSettings, type RepoState } from './app/context.ts'
import { useRoute, type Route } from './app/router.ts'
import type { SettingsStore } from './settings/store.ts'
import type { ProjectRepo } from './storage/repo.ts'
import { TopBar } from './ui/components.tsx'
import { useDocumentTitle } from './ui/hooks.ts'
import { Landing } from './ui/screens/Landing.tsx'
import { Library } from './ui/screens/Library.tsx'
import { Settings } from './ui/screens/Settings.tsx'
import { Work } from './ui/screens/Work.tsx'

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
  const key = route.name === 'work' ? `work/${route.id}` : route.name
  const first = useRef(true)

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
    case 'work':
      return <Work id={route.id} />
    case 'notFound':
      return <NotFound />
  }
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
