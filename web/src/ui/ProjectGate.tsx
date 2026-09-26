/**
 * Opening one stored project for a screen (the Work stage, the Design stage, #/open):
 * loading, not found and failure all look the same everywhere.
 *
 * It waits for any save still on its way first (app/saving.ts), so moving between stages
 * never opens the project as it was before the last edits.
 */
import { useEffect, useState, type ReactNode } from 'react'

import { useRepo } from '../app/context.ts'
import { href, paths } from '../app/router.ts'
import { savesSettled } from '../app/saving.ts'
import type { AlphaContents } from '../storage/alpha.ts'
import { ProjectNotFoundError, type ProjectRepo } from '../storage/repo.ts'
import { TopBar } from './components.tsx'
import { useDocumentTitle } from './hooks.ts'
import { StorageUnavailable } from './screens/Landing.tsx'

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; contents: AlphaContents }

export function ProjectGate({
  id,
  children,
}: {
  id: string
  children: (repo: ProjectRepo, contents: AlphaContents) => ReactNode
}) {
  const state = useRepo()
  const repo = state.status === 'ready' ? state.repo : null
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    if (!repo) return
    // A different id is a different route key, so this component is remounted rather
    // than reused, and never needs to go back to 'loading'.
    let live = true
    savesSettled()
      .then(() => repo.open(id))
      .then(
        (contents) => live && setLoad({ status: 'ready', contents }),
        (e: unknown) =>
          live &&
          setLoad(e instanceof ProjectNotFoundError ? { status: 'missing' } : { status: 'error', message: String(e) }),
      )
    return () => {
      live = false
    }
  }, [repo, id])

  if (state.status === 'error') {
    return (
      <Message title="Project">
        <StorageUnavailable />
      </Message>
    )
  }
  if (load.status === 'missing') {
    return (
      <Message title="Project not found">
        <p>There's no project at this link in this browser's library. It may have been deleted, or saved in another browser.</p>
        <p>
          <a href={href(paths.library)}>Go to your library</a>
        </p>
      </Message>
    )
  }
  if (load.status === 'error') {
    return (
      <Message title="Couldn't open this project">
        <p className="notice notice--error">{load.message}</p>
        <p>
          <a href={href(paths.library)}>Go to your library</a>
        </p>
      </Message>
    )
  }
  if (load.status === 'loading' || !repo) {
    return (
      <Message title="Project">
        <p className="muted">Loading…</p>
      </Message>
    )
  }
  return children(repo, load.contents)
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  useDocumentTitle(title)
  return (
    <main className="screen">
      <TopBar title={title} />
      {children}
    </main>
  )
}
