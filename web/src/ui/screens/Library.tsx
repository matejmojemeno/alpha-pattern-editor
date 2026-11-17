/**
 * The project grid: a port of alphareader/ui/library/library_window.py.
 *
 * Dropped from the desktop: the file watcher and Refresh (the grid re-lists itself after
 * every change to the repository), and single-window bookkeeping (a route replaces it).
 * Added: Export per card, since an exported `.alpha` file is the only backup.
 *
 * Projects with pieces (a sweater's Front, Back and Sleeves) are one card here, and at
 * #/project/<id> their pieces are cards of their own (`group`), each still an ordinary
 * pattern with every action it has on its own.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { MADE_PHOTO_ACCEPT, madePhotoErrorText, prepareMadePhoto } from '../../app/madePhoto.ts'

import { useRepo } from '../../app/context.ts'
import { preloadDetection } from '../../app/detection.ts'
import { downloadBlob } from '../../app/download.ts'
import { currentPiece, groupProgress, groupStatus, groupUpdated, piecesOf, piecesText } from '../../app/groups.ts'
import { href, navigate, paths } from '../../app/router.ts'
import type { ProjectGroup, ProjectSummary, WorkStatus } from '../../storage/repo.ts'
import { CardMenu, type MenuItem } from '../CardMenu.tsx'
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
import { RenameIcon } from '../icons.tsx'
import { AddPiecesDialog, AddToGroupDialog, GroupYarn } from '../library/GroupDialogs.tsx'
import { againName } from '../names.ts'
import { useDocumentTitle, useFileDrop, useGroups, usePastedImage, useProjects } from '../hooks.ts'
import { MadePhotoDialog } from '../MadePhoto.tsx'
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

type Piece = ProjectGroup['pieces'][number] & { summary: ProjectSummary }

/** One card in the Library: a pattern on its own, or a project with pieces. */
type Entry =
  | { kind: 'pattern'; summary: ProjectSummary; status: WorkStatus; updated: number }
  | { kind: 'group'; group: ProjectGroup; pieces: Piece[]; status: WorkStatus; pct: number; updated: number }

export function Library({ group: groupId }: { group?: string } = {}) {
  const state = useRepo()
  const repo = state.status === 'ready' ? state.repo : null
  const projects = useProjects(repo)
  const groups = useGroups(repo)
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)
  const [actionNotice, setActionNotice] = useState<Notice | null>(null)
  const heading = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => new Map((projects ?? []).map((s) => [s.id, s])), [projects])
  // Undefined while loading, null once it's known there's no such project.
  const open = groupId === undefined || groups === null || projects === null ? undefined : (groups.find((g) => g.id === groupId) ?? null)
  useDocumentTitle(groupId === undefined ? 'Library' : (open?.name ?? 'Project'))

  // The grid re-lists itself after every change (useProjects), including ones made on
  // another screen, such as an import that finishes after this one opened.
  const { importFiles, notices, setNotices, busy, question } = useAlphaImport(repo)
  // Importing is the Library's, not a project's: a project's view takes no drops.
  const drop = useFileDrop((files) => {
    if (groupId !== undefined) return
    setActionNotice(null)
    void importFiles(files)
  })
  usePastedImage(openPasted)
  const [creating, setCreating] = useState(false)
  // A photo of what was made: the card it's for, while the picker is open, and the card
  // whose photo is shown.
  const photoInput = useRef<HTMLInputElement>(null)
  const photoFor = useRef<ProjectSummary | null>(null)
  const [showingPhoto, setShowingPhoto] = useState<ProjectSummary | null>(null)
  // Projects with pieces: the pattern being put in one, the project being ungrouped, and
  // the dialogs of a project's own view.
  const [grouping, setGrouping] = useState<ProjectSummary | null>(null)
  const [ungrouping, setUngrouping] = useState<ProjectGroup | null>(null)
  const [addingPieces, setAddingPieces] = useState(false)
  const [yarnFor, setYarnFor] = useState<ProjectGroup | null>(null)
  const [renamingGroup, setRenamingGroup] = useState(false)

  const ok = (text: string) => {
    setNotices([])
    setActionNotice({ tone: 'ok', text })
  }
  const failed = (text: string, e: unknown) => setActionNotice({ tone: 'error', text: `${text}: ${e instanceof Error ? e.message : String(e)}` })

  const choosePhoto = (s: ProjectSummary) => {
    photoFor.current = s
    photoInput.current?.click()
  }
  const onPhoto = async (file: File | undefined) => {
    const s = photoFor.current
    photoFor.current = null
    if (!repo || !s || !file) return
    try {
      await repo.setMadePhoto(s.id, await prepareMadePhoto(file))
      ok(`Added a photo of “${s.name}”.`)
    } catch (e) {
      setActionNotice({ tone: 'error', text: madePhotoErrorText(e) })
    }
  }

  const onRename = async (s: ProjectSummary, name: string) => {
    if (!repo) return
    try {
      await repo.rename(s.id, name)
      ok(`Renamed “${s.name}” to “${name}”.`)
    } catch (e) {
      failed(`Couldn't rename “${s.name}”`, e)
    }
  }

  const onExport = async (s: ProjectSummary) => {
    if (!repo) return
    try {
      const { blob, filename } = await repo.exportFile(s.id)
      downloadBlob(blob, filename)
    } catch (e) {
      failed(`Couldn't export “${s.name}”`, e)
    }
  }

  // A copy with no progress, opened in Work; the finished one stays as the record of it.
  const onMakeAgain = async (s: ProjectSummary) => {
    if (!repo) return
    try {
      const copy = await repo.copy(s.id, againName(s.name, (projects ?? []).map((p) => p.name)))
      navigate(paths.work(copy.pattern.id))
    } catch (e) {
      failed(`Couldn't make “${s.name}” again`, e)
    }
  }

  const confirmDelete = async () => {
    const s = deleting
    setDeleting(null)
    if (!repo || !s) return
    try {
      await repo.delete(s.id)
      ok(`Deleted “${s.name}”.`)
    } catch (e) {
      failed(`Couldn't delete “${s.name}”`, e)
    }
    // The card that had focus is gone; put focus somewhere predictable.
    heading.current?.querySelector('h1')?.focus()
  }

  // --- projects with pieces ---

  const onExportGroup = async (g: ProjectGroup) => {
    if (!repo) return
    try {
      const { blob, filename } = await repo.exportGroup(g.id)
      downloadBlob(blob, filename)
    } catch (e) {
      failed(`Couldn't export “${g.name}”`, e)
    }
  }
  const onRenameGroup = async (g: ProjectGroup, name: string) => {
    if (!repo) return
    try {
      await repo.renameGroup(g.id, name)
      ok(`Renamed “${g.name}” to “${name}”.`)
    } catch (e) {
      failed(`Couldn't rename “${g.name}”`, e)
    }
  }
  const confirmUngroup = async () => {
    const g = ungrouping
    setUngrouping(null)
    if (!repo || !g) return
    try {
      await repo.ungroup(g.id)
      ok(`Ungrouped “${g.name}”. Its pieces are in your Library on their own.`)
      if (groupId !== undefined) navigate(paths.library)
    } catch (e) {
      failed(`Couldn't ungroup “${g.name}”`, e)
    }
    heading.current?.querySelector('h1')?.focus()
  }
  /** A change to the open project's pieces, with its message. */
  const pieceChange = async (change: () => Promise<unknown>, done: string, error: string) => {
    try {
      await change()
      ok(done)
    } catch (e) {
      failed(error, e)
    }
  }

  const libraryNote = (
    <p className="storage-note">
      Projects are saved in this browser only, and browsers can clear them. <strong>Export</strong> anything you'd hate
      to lose, from <strong>⋯</strong> on its card.
    </p>
  )

  const dialogs = (
    <>
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
      {ungrouping && (
        <ConfirmDialog
          title={`Ungroup “${ungrouping.name}”?`}
          confirmLabel="Ungroup"
          onConfirm={() => void confirmUngroup()}
          onCancel={() => setUngrouping(null)}
        >
          <p>Its {piecesText(ungrouping.pieces.length)} stay in your Library as patterns on their own, with their progress.</p>
        </ConfirmDialog>
      )}
      {question && <ReplaceDialog question={question} />}
      {creating && repo && <NewPatternDialog repo={repo} onCancel={() => setCreating(false)} />}
      {showingPhoto && repo && (
        <MadePhotoDialog repo={repo} id={showingPhoto.id} name={showingPhoto.name} onClose={() => setShowingPhoto(null)} />
      )}
      {grouping && repo && groups && (
        <AddToGroupDialog
          repo={repo}
          pattern={grouping}
          groups={groups}
          onCancel={() => setGrouping(null)}
          onDone={(g, isNew) => {
            setGrouping(null)
            ok(isNew ? `Made the project “${g.name}” with “${grouping.name}” in it.` : `Added “${grouping.name}” to “${g.name}”.`)
          }}
        />
      )}
      {addingPieces && repo && open && groups && projects && (
        <AddPiecesDialog
          repo={repo}
          group={open}
          loose={projects.filter((s) => !groups.some((g) => g.pieces.some((p) => p.id === s.id)))}
          onCancel={() => setAddingPieces(false)}
          onDone={(n) => {
            setAddingPieces(false)
            ok(`Added ${n === 1 ? 'a pattern' : `${n} patterns`} to “${open.name}”.`)
          }}
        />
      )}
      {yarnFor && repo && <GroupYarn repo={repo} group={yarnFor} onClose={() => setYarnFor(null)} />}
      <input
        ref={photoInput}
        type="file"
        accept={MADE_PHOTO_ACCEPT}
        hidden
        aria-label="Choose a photo of what you made"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // so choosing the same file again still fires
          void onPhoto(file)
        }}
      />
    </>
  )

  /** A pattern's card, on its own in the Library or as a piece of the open project. */
  const patternCard = (s: ProjectSummary, piece?: { group: ProjectGroup; label: string; index: number }) => {
    const extra: MenuItem[] = piece
      ? [
          ...(piece.index > 0
            ? [
                {
                  label: 'Move earlier',
                  onSelect: () =>
                    void pieceChange(() => repo!.movePiece(piece.group.id, s.id, piece.index - 1), `Moved “${piece.label}” earlier.`, `Couldn't move “${piece.label}”`),
                },
              ]
            : []),
          ...(piece.index < piece.group.pieces.length - 1
            ? [
                {
                  label: 'Move later',
                  onSelect: () =>
                    void pieceChange(() => repo!.movePiece(piece.group.id, s.id, piece.index + 1), `Moved “${piece.label}” later.`, `Couldn't move “${piece.label}”`),
                },
              ]
            : []),
          {
            label: 'Remove from project',
            onSelect: () =>
              void pieceChange(
                () => repo!.removePiece(piece.group.id, s.id),
                `Took “${piece.label}” out of “${piece.group.name}”. It's in your Library on its own.`,
                `Couldn't take “${piece.label}” out`,
              ),
          },
        ]
      : [{ label: 'Add to a project…', onSelect: () => setGrouping(s) }]
    const name = piece?.label || s.name
    return (
      <ProjectCard
        key={s.id}
        summary={s}
        name={name}
        meta={piece && name !== s.name ? `${s.cols}×${s.rows} · ${s.name}` : undefined}
        extraMenu={extra}
        onExport={() => void onExport(s)}
        onDelete={() => setDeleting(s)}
        onRename={(label) =>
          piece
            ? pieceChange(() => repo!.relabelPiece(piece.group.id, s.id, label), `Renamed “${name}” to “${label}”.`, `Couldn't rename “${name}”`)
            : onRename(s, label)
        }
        onMakeAgain={() => void onMakeAgain(s)}
        onAddPhoto={() => choosePhoto(s)}
        onShowPhoto={() => setShowingPhoto(s)}
      />
    )
  }

  // --- a project's own view ---

  if (groupId !== undefined) {
    const back = { path: paths.library, label: 'Library' }
    if (open === undefined) {
      return (
        <main className="screen library">
          <TopBar title="Project" back={back} help="projects" />
          {state.status === 'error' ? <StorageUnavailable /> : <p className="muted">Loading…</p>}
        </main>
      )
    }
    if (open === null) {
      return (
        <main className="screen library">
          <TopBar title="Project" back={back} help="projects" />
          <Notices notices={actionNotice ? [actionNotice] : []} />
          <p>This project isn't in your Library any more.</p>
        </main>
      )
    }
    const pieces = piecesOf(open, byId)
    const pct = groupProgress(pieces.map((p) => p.summary))
    const status = groupStatus(pieces.map((p) => p.summary))
    const current = currentPiece(pieces)
    const menu: MenuItem[] = [
      { label: 'Rename', onSelect: () => setRenamingGroup(true) },
      { label: 'Export', onSelect: () => void onExportGroup(open) },
      { label: 'Ungroup…', onSelect: () => setUngrouping(open), danger: true },
    ]
    return (
      <main className="screen library">
        <div ref={heading}>
          <TopBar title={open.name} back={back} help="projects">
            {status === 'in-progress' && current && (
              <a className="button button--primary" href={href(paths.work(current))}>
                Continue
              </a>
            )}
            <button type="button" className="button" onClick={() => setAddingPieces(true)}>
              Add patterns…
            </button>
            <button type="button" className="button" onClick={() => setYarnFor(open)}>
              Yarn &amp; size
            </button>
            <CardMenu name={open.name} items={menu} />
          </TopBar>
        </div>
        <Notices notices={actionNotice ? [actionNotice] : notices} />
        {renamingGroup && (
          <RenameForm
            className="rename group__rename"
            name={open.name}
            onCancel={() => setRenamingGroup(false)}
            onRename={(name) => {
              setRenamingGroup(false)
              void onRenameGroup(open, name)
            }}
          />
        )}
        <div className="group__summary">
          <span className="group__count">{piecesText(pieces.length)}</span>
          {status !== 'not-started' && <ProgressBar pct={pct} />}
        </div>
        <ol className="cards group__pieces" aria-label="Pieces">
          {pieces.map((p, index) => patternCard(p.summary, { group: { ...open, pieces }, label: p.label, index }))}
        </ol>
        {libraryNote}
        {dialogs}
      </main>
    )
  }

  // --- the Library ---

  const entries: Entry[] | null =
    projects === null || groups === null
      ? null
      : (() => {
          const grouped = new Set(groups.flatMap((g) => g.pieces.map((p) => p.id)))
          const list: Entry[] = projects
            .filter((s) => !grouped.has(s.id))
            .map((s) => ({ kind: 'pattern', summary: s, status: s.work_status, updated: s.updated_at }))
          for (const g of groups) {
            const pieces = piecesOf(g, byId)
            if (!pieces.length) continue
            const summaries = pieces.map((p) => p.summary)
            list.push({
              kind: 'group',
              group: g,
              pieces,
              status: groupStatus(summaries),
              pct: groupProgress(summaries),
              updated: groupUpdated(g, pieces),
            })
          }
          return list.sort((a, b) => b.updated - a.updated)
        })()

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

      {entries === null ? (
        state.status !== 'error' && <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="empty">
          <p>No projects yet.</p>
        </div>
      ) : (
        SECTIONS.map(({ status, title }) => {
          const here = entries.filter((e) => e.status === status)
          if (!here.length) return null
          const id = `library-${status}`
          return (
            <section key={status} className="library__section" aria-labelledby={id}>
              <h2 id={id} className="library__heading">
                {title} <span className="library__count">{here.length}</span>
              </h2>
              <ul className="cards" aria-label={title}>
                {here.map((e) =>
                  e.kind === 'pattern' ? (
                    patternCard(e.summary)
                  ) : (
                    <GroupCard
                      key={e.group.id}
                      entry={e}
                      onRename={(name) => onRenameGroup(e.group, name)}
                      onExport={() => void onExportGroup(e.group)}
                      onUngroup={() => setUngrouping(e.group)}
                    />
                  ),
                )}
              </ul>
            </section>
          )
        })
      )}

      {libraryNote}

      <DropOverlay show={drop.over} />
      {dialogs}
    </main>
  )
}

/**
 * What a card offers, by section. One button for what you'd most often do next, and the
 * rest on ⋯, so every card has the same row: Design for a pattern not started (it's
 * usually still being made), Continue for one in progress, and Make again for a finished
 * one (a copy with no progress, so the finished one stays). The way to the other stage,
 * Export and Delete are on the menu.
 *
 * A finished one also offers Add photo…, for a photo of what was made, which then
 * becomes its thumbnail. A card with a photo has Photo instead (to see, replace or
 * remove it), in any section: going back to working a pattern keeps its photo.
 */
function cardActions(
  s: ProjectSummary,
  on: { onExport: () => void; onDelete: () => void; onMakeAgain: () => void; onAddPhoto: () => void; onShowPhoto: () => void },
  extra: MenuItem[],
): { primary: MenuItem; menu: MenuItem[] } {
  const design = href(paths.design(s.id))
  const work = href(paths.work(s.id))
  const photo: MenuItem[] =
    s.made_photo
      ? [{ label: 'Photo', onSelect: on.onShowPhoto }]
      : s.work_status === 'finished'
        ? [{ label: 'Add photo…', onSelect: on.onAddPhoto }]
        : []
  const rest: MenuItem[] = [
    ...photo,
    ...extra,
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

/** The name, which renames when pressed (a pencil shows it can be), or the rename field. */
function CardName({ name, onRename }: { name: string; onRename: (name: string) => Promise<void> }) {
  const [renaming, setRenaming] = useState(false)
  const nameButton = useRef<HTMLButtonElement>(null)
  const wasRenaming = useRef(false)
  // Back from the rename field, focus returns to the name.
  useEffect(() => {
    if (wasRenaming.current && !renaming) nameButton.current?.focus()
    wasRenaming.current = renaming
  }, [renaming])
  const stopRenaming = () => setRenaming(false)
  return renaming ? (
    <RenameForm
      className="rename card__rename"
      name={name}
      onCancel={stopRenaming}
      onRename={(next) => void onRename(next).then(stopRenaming)}
    />
  ) : (
    <button
      ref={nameButton}
      type="button"
      className="card__name"
      onClick={() => setRenaming(true)}
      aria-label={`Rename “${name}”`}
      title="Rename"
    >
      {name}
      <RenameIcon className="icon card__name-icon" />
    </button>
  )
}

function PrimaryAction({ item, name }: { item: MenuItem; name: string }) {
  const label = `${item.label} “${name}”`
  return 'href' in item ? (
    <a className="button button--small card__primary" href={item.href} aria-label={label}>
      {item.label}
    </a>
  ) : (
    <button type="button" className="button button--small card__primary" onClick={item.onSelect} aria-label={label}>
      {item.label}
    </button>
  )
}

/** A link already opens on Enter; Space is added so the card behaves like the desktop
 *  card, which opened on Return, Enter or Space. */
const spaceOpens = (path: string) => (e: KeyboardEvent<HTMLAnchorElement>) => {
  if (e.key === ' ') {
    e.preventDefault()
    navigate(path)
  }
}

function ProjectCard({
  summary: s,
  name = s.name,
  meta,
  extraMenu = [],
  onExport,
  onDelete,
  onRename,
  onMakeAgain,
  onAddPhoto,
  onShowPhoto,
}: {
  summary: ProjectSummary
  /** What the card is called: a piece's label in a project, else the pattern's name. */
  name?: string
  /** In place of the size, e.g. a piece's size and its pattern's own name. */
  meta?: string
  extraMenu?: MenuItem[]
  onExport: () => void
  onDelete: () => void
  onRename: (name: string) => Promise<void>
  onMakeAgain: () => void
  onAddPhoto: () => void
  onShowPhoto: () => void
}) {
  const { primary, menu } = cardActions(s, { onExport, onDelete, onMakeAgain, onAddPhoto, onShowPhoto }, extraMenu)
  return (
    <li className="card">
      {/* #/open picks the stage: Work if there's progress, else the one it was last in.
          The link covers the whole card (::after); the name and the buttons sit above it. */}
      <a className="card__open" href={href(paths.open(s.id))} onKeyDown={spaceOpens(paths.open(s.id))} aria-label={`Open “${name}”`}>
        <Thumb blob={s.thumbnail} kind={s.thumbnail_kind} />
      </a>
      <div className="card__body">
        <CardName name={name} onRename={onRename} />
        <span className="card__meta">{meta ?? `${s.cols}×${s.rows}`}</span>
        {/* Not started is always 0%: the section heading says it already. */}
        {s.work_status !== 'not-started' && <ProgressBar pct={s.progress_pct} />}
      </div>
      <div className="card__actions">
        <PrimaryAction item={primary} name={name} />
        <CardMenu name={name} items={menu} />
      </div>
    </li>
  )
}

/**
 * A project with pieces, as one card: up to four of its pieces' pictures, its name, how
 * many pieces, and its progress weighted by stitches. Continue opens the piece you're on
 * (app/groups.ts `currentPiece`); otherwise the button opens the project, to see its
 * pieces. The card itself always opens the project.
 */
function GroupCard({
  entry: e,
  onRename,
  onExport,
  onUngroup,
}: {
  entry: Extract<Entry, { kind: 'group' }>
  onRename: (name: string) => Promise<void>
  onExport: () => void
  onUngroup: () => void
}) {
  const g = e.group
  const openPath = paths.project(g.id)
  const current = currentPiece(e.pieces)
  const primary: MenuItem =
    e.status === 'in-progress' && current ? { label: 'Continue', href: href(paths.work(current)) } : { label: 'Open', href: href(openPath) }
  const menu: MenuItem[] = [
    ...(primary.label === 'Open' ? [] : [{ label: 'Open project', href: href(openPath) }]),
    { label: 'Export', onSelect: onExport },
    { label: 'Ungroup…', onSelect: onUngroup, danger: true },
  ]
  const shown = e.pieces.slice(0, 4)
  return (
    <li className="card card--group">
      <a className="card__open" href={href(openPath)} onKeyDown={spaceOpens(openPath)} aria-label={`Pieces of “${g.name}”`}>
        <span className={`group-thumbs group-thumbs--${shown.length}`} aria-hidden="true">
          {shown.map((p) => (
            <Thumb key={p.id} blob={p.summary.thumbnail} kind={p.summary.thumbnail_kind} />
          ))}
        </span>
      </a>
      <div className="card__body">
        <CardName name={g.name} onRename={onRename} />
        <span className="card__meta">
          {piecesText(e.pieces.length)}: {e.pieces.map((p) => p.label || p.summary.name).join(', ')}
        </span>
        {e.status !== 'not-started' && <ProgressBar pct={e.pct} />}
      </div>
      <div className="card__actions">
        <PrimaryAction item={primary} name={g.name} />
        <CardMenu name={g.name} items={menu} />
      </div>
    </li>
  )
}
