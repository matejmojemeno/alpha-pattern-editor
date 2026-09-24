/**
 * /work/:id, for now: the project's name, size, progress and full readout, so a real
 * project can be opened in the browser and its rows checked. The Work stage replaces it.
 */
import { useEffect, useState } from 'react'

import { useRepo } from '../../app/context.ts'
import { href, paths } from '../../app/router.ts'
import { exportAllRowsText } from '../../logic/readout.ts'
import { completedCount } from '../../logic/work.ts'
import type { Project } from '../../model/types.ts'
import { progressPct } from '../../storage/alpha.ts'
import { ProjectNotFoundError } from '../../storage/repo.ts'
import { ProgressBar, TopBar } from '../components.tsx'
import { useDocumentTitle } from '../hooks.ts'
import { StorageUnavailable } from './Landing.tsx'

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; project: Project }

export function WorkPlaceholder({ id }: { id: string }) {
  const state = useRepo()
  const repo = state.status === 'ready' ? state.repo : null
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  useDocumentTitle(load.status === 'ready' ? load.project.pattern.name : 'Project')

  useEffect(() => {
    if (!repo) return
    // No reset to 'loading' here: a different id is a different route key, so this
    // component is remounted rather than reused.
    let live = true
    repo.open(id).then(
      ({ project }) => live && setLoad({ status: 'ready', project }),
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
      <main className="screen">
        <TopBar title="Project" />
        <StorageUnavailable />
      </main>
    )
  }
  if (load.status === 'missing') {
    return (
      <main className="screen">
        <TopBar title="Project not found" />
        <p>There's no project at this link in this browser's library. It may have been deleted, or saved in another browser.</p>
        <p>
          <a href={href(paths.library)}>Go to your library</a>
        </p>
      </main>
    )
  }
  if (load.status === 'error') {
    return (
      <main className="screen">
        <TopBar title="Couldn't open this project" />
        <p className="notice notice--error">{load.message}</p>
        <p>
          <a href={href(paths.library)}>Go to your library</a>
        </p>
      </main>
    )
  }
  if (load.status === 'loading') {
    return (
      <main className="screen">
        <TopBar title="Project" />
        <p className="muted">Loading…</p>
      </main>
    )
  }

  const { pattern, progress } = load.project
  const done = completedCount(pattern, progress)
  return (
    <main className="screen work-placeholder">
      <TopBar title={pattern.name}>
        <a className="button" href={href(paths.library)}>
          Library
        </a>
      </TopBar>
      <dl className="facts">
        <div>
          <dt>Size</dt>
          <dd>
            {pattern.cols}×{pattern.rows}
          </dd>
        </div>
        <div>
          <dt>Colours</dt>
          <dd>{pattern.palette.length}</dd>
        </div>
        <div>
          <dt>Progress</dt>
          <dd>
            {done} of {pattern.rows} rows
          </dd>
        </div>
      </dl>
      <ProgressBar pct={progressPct(pattern, progress)} />
      <p className="muted">The Work stage is being built next. Until then, here is the whole pattern as text.</p>
      <h2>Rows</h2>
      <pre className="readout" tabIndex={0} aria-label="Rows">
        {exportAllRowsText(pattern)}
      </pre>
    </main>
  )
}
