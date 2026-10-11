/**
 * The project grid: a port of alphareader/ui/library/library_window.py.
 *
 * Dropped from the desktop: the file watcher and Refresh (the grid re-lists itself after
 * every change to the repository), and single-window bookkeeping (a route replaces it).
 * Added: Export per card, since an exported `.alpha` file is the only backup.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { useRepo } from '../../app/context.ts'
import { preloadDetection } from '../../app/detection.ts'
import { downloadBlob } from '../../app/download.ts'
import { href, navigate, paths } from '../../app/router.ts'
import type { ProjectSummary, WorkStatus } from '../../storage/repo.ts'
import {
  ConfirmDialog,
  DropOverlay,
  ImportButton,
  Notices,
  ProgressBar,
  RenameForm,
  ReplaceDialog,
  Thumb,
  TopBar,
} from '../components.tsx'
import { MoreIcon, RenameIcon } from '../icons.tsx'
import { againName } from '../names.ts'
import { useDocumentTitle, useFileDrop, usePastedImage, useProjects } from '../hooks.ts'
import { DESIGN_FROM_SCRATCH, NewPatternDialog } from '../NewPattern.tsx'
import { openImageImport, useAlphaImport, type Notice } from '../useAlphaImport.ts'
import { StorageUnavailable } from './Landing.tsx'

const openPasted = (file: File) => openImageImport({ file })

/** The Library's sections, in this order; an empty one isn't shown. What you're making
 *  comes first, then what's waiting to be started, then what's done. */
const SECTIONS: { status: WorkStatus; title: string }[] = [
  { status: 'in-progress', title: 'In progress' },
  { status: 'not-started', title: 'Not started' },
  { status: 'finished', title: 'Finished' },
]

export function Library() {
  useDocumentTitle('Library')
  const state = useRepo()
  const repo = state.status === 'ready' ? state.repo : null
  const projects = useProjects(repo)
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)
  const [actionNotice, setActionNotice] = useState<Notice | null>(null)
  const heading = useRef<HTMLDivElement>(null)

  // The grid re-lists itself after every change (useProjects), including ones made on
  // another screen, such as an import that finishes after this one opened.
  const { importFiles, notices, setNotices, busy, question } = useAlphaImport(repo)
  const drop = useFileDrop((files) => {
    setActionNotice(null)
    void importFiles(files)
  })
  usePastedImage(openPasted)
  const [creating, setCreating] = useState(false)

  const onRename = async (s: ProjectSummary, name: string) => {
    if (!repo) return
    try {
      await repo.rename(s.id, name)
      setNotices([])
      setActionNotice({ tone: 'ok', text: `Renamed “${s.name}” to “${name}”.` })
    } catch (e) {
      setActionNotice({ tone: 'error', text: `Couldn't rename “${s.name}”: ${String(e)}` })
    }
  }

  const onExport = async (s: ProjectSummary) => {
    if (!repo) return
    try {
      const { blob, filename } = await repo.exportFile(s.id)
      downloadBlob(blob, filename)
    } catch (e) {
      setActionNotice({ tone: 'error', text: `Couldn't export “${s.name}”: ${String(e)}` })
    }
  }

  // A copy with no progress, opened in Work; the finished one stays as the record of it.
  const onMakeAgain = async (s: ProjectSummary) => {
    if (!repo) return
    try {
      const copy = await repo.copy(s.id, againName(s.name, (projects ?? []).map((p) => p.name)))
      navigate(paths.work(copy.pattern.id))
    } catch (e) {
      setActionNotice({ tone: 'error', text: `Couldn't make “${s.name}” again: ${String(e)}` })
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
    // The card that had focus is gone; put focus somewhere predictable.
    heading.current?.querySelector('h1')?.focus()
  }

  return (
    <main className="screen library" {...drop.handlers}>
      <div ref={heading}>
        <TopBar title="Your projects" help="library">
          <ImportButton
            onFiles={(f) => {
              setActionNotice(null)
              void importFiles(f)
            }}
            onPreload={preloadDetection}
            disabled={!repo || busy}
          >
            Import…
          </ImportButton>
          <button type="button" className="button" onClick={() => setCreating(true)} disabled={!repo}>
            {DESIGN_FROM_SCRATCH}…
          </button>
        </TopBar>
      </div>

      {state.status === 'error' && <StorageUnavailable />}
      <Notices notices={actionNotice ? [actionNotice] : notices} />

      {projects === null ? (
        state.status !== 'error' && <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          <p>No projects yet.</p>
        </div>
      ) : (
        SECTIONS.map(({ status, title }) => {
          const here = projects.filter((s) => s.work_status === status)
          if (!here.length) return null
          const id = `library-${status}`
          return (
            <section key={status} className="library__section" aria-labelledby={id}>
              <h2 id={id} className="library__heading">
                {title} <span className="library__count">{here.length}</span>
              </h2>
              <ul className="cards" aria-label={title}>
                {here.map((s) => (
                  <ProjectCard
                    key={s.id}
                    summary={s}
                    onExport={() => void onExport(s)}
                    onDelete={() => setDeleting(s)}
                    onRename={(name) => onRename(s, name)}
                    onMakeAgain={() => void onMakeAgain(s)}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}

      <p className="storage-note">
        Projects are saved in this browser only, and browsers can clear them. <strong>Export</strong> anything you'd hate
        to lose, from <strong>⋯</strong> on its card.
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
            “{deleting.name}” will be gone from this browser. This can't be undone.
            {deleting.progress_pct > 0 && ' Export it first to keep your progress.'}
          </p>
        </ConfirmDialog>
      )}
      {question && <ReplaceDialog question={question} />}
      {creating && repo && <NewPatternDialog repo={repo} onCancel={() => setCreating(false)} />}
    </main>
  )
}

/** One thing on a card's ⋯ menu: a place to go, or something to do. */
type MenuItem = { label: string; danger?: boolean } & ({ href: string } | { onSelect: () => void })

/**
 * What a card offers, by section. One button for what you'd most often do next, and the
 * rest on ⋯, so every card has the same row: Design for a pattern not started (it's
 * usually still being made), Continue for one in progress, and Make again for a finished
 * one (a copy with no progress, so the finished one stays). The way to the other stage,
 * Export and Delete are on the menu.
 */
function cardActions(
  s: ProjectSummary,
  on: { onExport: () => void; onDelete: () => void; onMakeAgain: () => void },
): { primary: MenuItem; menu: MenuItem[] } {
  const design = href(paths.design(s.id))
  const work = href(paths.work(s.id))
  const rest: MenuItem[] = [
    { label: 'Export', onSelect: on.onExport },
    { label: 'Delete', onSelect: on.onDelete, danger: true },
  ]
  switch (s.work_status) {
    case 'not-started':
      return { primary: { label: 'Design', href: design }, menu: [{ label: 'Start working', href: work }, ...rest] }
    case 'in-progress':
      return { primary: { label: 'Continue', href: work }, menu: [{ label: 'Edit in Design', href: design }, ...rest] }
    case 'finished':
      return {
        primary: { label: 'Make again', onSelect: on.onMakeAgain },
        menu: [{ label: 'Edit in Design', href: design }, ...rest],
      }
  }
}

function ProjectCard({
  summary: s,
  onExport,
  onDelete,
  onRename,
  onMakeAgain,
}: {
  summary: ProjectSummary
  onExport: () => void
  onDelete: () => void
  onRename: (name: string) => Promise<void>
  onMakeAgain: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const nameButton = useRef<HTMLButtonElement>(null)
  const wasRenaming = useRef(false)
  // Back from the rename field, focus returns to the name.
  useEffect(() => {
    if (wasRenaming.current && !renaming) nameButton.current?.focus()
    wasRenaming.current = renaming
  }, [renaming])
  const stopRenaming = () => setRenaming(false)
  // A link already opens on Enter; Space is added so the card behaves like the desktop
  // card, which opened on Return, Enter or Space.
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === ' ') {
      e.preventDefault()
      navigate(paths.open(s.id))
    }
  }
  const { primary, menu } = cardActions(s, { onExport, onDelete, onMakeAgain })
  const primaryLabel = `${primary.label} “${s.name}”`
  return (
    <li className="card">
      {/* #/open picks the stage: Work if there's progress, else the one it was last in.
          The link covers the whole card (::after); the name and the buttons sit above it. */}
      <a className="card__open" href={href(paths.open(s.id))} onKeyDown={onKeyDown} aria-label={`Open “${s.name}”`}>
        <Thumb blob={s.thumbnail} kind={s.thumbnail_kind} />
      </a>
      <div className="card__body">
        {renaming ? (
          <RenameForm
            className="rename card__rename"
            name={s.name}
            onCancel={stopRenaming}
            onRename={(name) => void onRename(name).then(stopRenaming)}
          />
        ) : (
          <button
            ref={nameButton}
            type="button"
            className="card__name"
            onClick={() => setRenaming(true)}
            aria-label={`Rename “${s.name}”`}
            title="Rename"
          >
            {s.name}
            <RenameIcon className="icon card__name-icon" />
          </button>
        )}
        <span className="card__meta">
          {s.cols}×{s.rows}
        </span>
        {/* Not started is always 0%: the section heading says it already. */}
        {s.work_status !== 'not-started' && <ProgressBar pct={s.progress_pct} />}
      </div>
      <div className="card__actions">
        {'href' in primary ? (
          <a className="button button--small card__primary" href={primary.href} aria-label={primaryLabel}>
            {primary.label}
          </a>
        ) : (
          <button
            type="button"
            className="button button--small card__primary"
            onClick={primary.onSelect}
            aria-label={primaryLabel}
          >
            {primary.label}
          </button>
        )}
        <CardMenu name={s.name} items={menu} />
      </div>
    </li>
  )
}

/**
 * The ⋯ menu on a card: a menu button (Enter, Space or a click opens it, with focus on
 * the first item), arrow keys between items, Escape back to the button, and a click
 * outside or Tab closes it. Choosing an item puts focus back on ⋯ first, so a dialog the
 * item opens (Delete's) returns focus there.
 */
function CardMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const entries = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

  useEffect(() => {
    if (!open) return
    entries()[0]?.focus()
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const all = entries()
      const at = all.indexOf(document.activeElement as HTMLElement)
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
      all[next]?.focus()
    }
  }
  const choose = (item: MenuItem) => {
    button.current?.focus()
    setOpen(false)
    if ('onSelect' in item) item.onSelect()
  }

  return (
    <div className="card-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="button button--small card-menu__button"
        aria-label={`More for “${name}”`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div id={id} role="menu" className="card-menu__list" aria-label={`More for “${name}”`}>
          {items.map((item) =>
            'href' in item ? (
              <a
                key={item.label}
                role="menuitem"
                tabIndex={-1}
                className="card-menu__item"
                href={item.href}
                onClick={() => choose(item)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                role="menuitem"
                tabIndex={-1}
                type="button"
                className={`card-menu__item${item.danger ? ' card-menu__item--danger' : ''}`}
                onClick={() => choose(item)}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
