/**
 * The project grid: a port of alphareader/ui/library/library_window.py.
 *
 * Dropped from the desktop: the file watcher and Refresh (the grid reloads itself after
 * every change made here), and single-window bookkeeping (a route replaces it).
 * Added: Export per card, since an exported `.alpha` file is the only backup.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { useRepo } from '../../app/context.ts'
import { downloadBlob } from '../../app/download.ts'
import { href, navigate, paths } from '../../app/router.ts'
import type { ProjectSummary } from '../../storage/repo.ts'
import { ConfirmDialog, DropOverlay, ImportButton, Notices, ProgressBar, ReplaceDialog, Thumb, TopBar } from '../components.tsx'
import { useDocumentTitle, useFileDrop } from '../hooks.ts'
import { useAlphaImport, type Notice } from '../useAlphaImport.ts'
import { StorageUnavailable } from './Landing.tsx'

export function Library() {
  useDocumentTitle('Library')
  const state = useRepo()
  const repo = state.status === 'ready' ? state.repo : null
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)
  const [actionNotice, setActionNotice] = useState<Notice | null>(null)
  const heading = useRef<HTMLDivElement>(null)

  const reload = useCallback(async () => {
    if (repo) setProjects(await repo.list())
  }, [repo])

  useEffect(() => {
    let live = true
    repo?.list().then((l) => live && setProjects(l))
    return () => {
      live = false
    }
  }, [repo])

  const { importFiles, notices, setNotices, busy, question } = useAlphaImport(repo, reload)
  const drop = useFileDrop((files) => {
    setActionNotice(null)
    void importFiles(files)
  })

  const onExport = async (s: ProjectSummary) => {
    if (!repo) return
    try {
      const { blob, filename } = await repo.exportFile(s.id)
      downloadBlob(blob, filename)
    } catch (e) {
      setActionNotice({ tone: 'error', text: `Couldn't export “${s.name}”: ${String(e)}` })
    }
  }

  const confirmDelete = async () => {
    const s = deleting
    setDeleting(null)
    if (!repo || !s) return
    try {
      await repo.delete(s.id)
      setNotices([])
      setActionNotice({ tone: 'ok', text: `Deleted “${s.name}”.` })
    } catch (e) {
      setActionNotice({ tone: 'error', text: `Couldn't delete “${s.name}”: ${String(e)}` })
    }
    await reload()
    // The card that had focus is gone; put focus somewhere predictable.
    heading.current?.querySelector('h1')?.focus()
  }

  return (
    <main className="screen library" {...drop.handlers}>
      <div ref={heading}>
        <TopBar title="Your projects">
          <ImportButton
            onFiles={(f) => {
              setActionNotice(null)
              void importFiles(f)
            }}
            disabled={!repo || busy}
          >
            Import .alpha file…
          </ImportButton>
        </TopBar>
      </div>

      {state.status === 'error' && <StorageUnavailable />}
      <Notices notices={actionNotice ? [actionNotice] : notices} />

      {projects === null ? (
        state.status !== 'error' && <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          <p>No saved projects yet.</p>
          <p className="muted">
            Import a <code>.alpha</code> file with the button above, or drop one here.
          </p>
        </div>
      ) : (
        <ul className="cards" aria-label="Projects">
          {projects.map((s) => (
            <ProjectCard key={s.id} summary={s} onExport={() => void onExport(s)} onDelete={() => setDeleting(s)} />
          ))}
        </ul>
      )}

      <p className="storage-note">
        Projects are saved in this browser only. Browsers can clear saved data, for example after a long time
        without a visit, so use <strong>Export</strong> to keep a copy of anything you'd hate to lose, or to move it
        to another device.
      </p>

      <DropOverlay show={drop.over} />
      {deleting && (
        <ConfirmDialog
          title="Delete project?"
          confirmLabel="Delete"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        >
          <p>
            Delete “{deleting.name}” from your library? This removes it from this browser and can't be undone.
            {deleting.progress_pct > 0 && ' Export it first if you want to keep your progress.'}
          </p>
        </ConfirmDialog>
      )}
      {question && <ReplaceDialog question={question} />}
    </main>
  )
}

function ProjectCard({
  summary: s,
  onExport,
  onDelete,
}: {
  summary: ProjectSummary
  onExport: () => void
  onDelete: () => void
}) {
  // A link already opens on Enter; Space is added so the card behaves like the desktop
  // card, which opened on Return, Enter or Space.
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === ' ') {
      e.preventDefault()
      navigate(paths.work(s.id))
    }
  }
  return (
    <li className="card">
      <a className="card__open" href={href(paths.work(s.id))} onKeyDown={onKeyDown}>
        <Thumb blob={s.thumbnail} kind={s.thumbnail_kind} />
        <span className="card__name">{s.name}</span>
        <span className="card__meta">
          {s.cols}×{s.rows}
        </span>
        <ProgressBar pct={s.progress_pct} />
      </a>
      <div className="card__actions">
        <button type="button" className="button button--small" onClick={onExport} aria-label={`Export “${s.name}”`}>
          Export
        </button>
        <button
          type="button"
          className="button button--small button--danger-quiet"
          onClick={onDelete}
          aria-label={`Delete “${s.name}”`}
        >
          Delete
        </button>
      </div>
    </li>
  )
}
