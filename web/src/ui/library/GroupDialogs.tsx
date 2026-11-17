/**
 * The Library's dialogs for projects with pieces: putting a pattern in a project, adding
 * patterns to the open project, and the yarn for a whole project.
 */
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'

import type { Pattern } from '../../model/types.ts'
import type { ProjectGroup, ProjectRepo, ProjectSummary } from '../../storage/repo.ts'
import { Modal } from '../components.tsx'
import { cleanName, MAX_NAME_LENGTH } from '../names.ts'

// The yarn dialog is the Design stage's, so it comes with the Design chunk, which App
// already loads lazily. Importing YarnEstimate.tsx on its own made Rollup split a shared
// chunk off the entry for index.html to preload (rules.md#no-nested-lazy-chunks).
const YarnEstimate = lazy(() => import('../screens/Design.tsx').then((m) => ({ default: m.YarnEstimate })))
// The links between a project's pieces (ProjectLinks.tsx), loaded the same way.
const NewPieceLazy = lazy(() => import('../screens/Design.tsx').then((m) => ({ default: m.NewPieceDialog })))
const SameColoursLazy = lazy(() => import('../screens/Design.tsx').then((m) => ({ default: m.SameColoursDialog })))

/** "New piece…" in a project's view: a blank pattern at a size from your swatch. */
export function NewPiece(props: { repo: ProjectRepo; group: ProjectGroup; onCancel: () => void }) {
  return (
    <Suspense fallback={<Loading title="New piece" onClose={props.onCancel} />}>
      <NewPieceLazy {...props} />
    </Suspense>
  )
}

/** "Use the same colours in every piece…" in a project's view. */
export function SameColours(props: {
  repo: ProjectRepo
  group: ProjectGroup
  onCancel: () => void
  onDone: (colours: number, pieces: number) => void
}) {
  return (
    <Suspense fallback={<Loading title="Same colours in every piece" onClose={props.onCancel} />}>
      <SameColoursLazy {...props} />
    </Suspense>
  )
}

function Loading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      buttons={
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <p className="muted">Loading…</p>
    </Modal>
  )
}

const NEW = '' // the radio value for a new project

/**
 * "Add to a project…" on a pattern's card: into a project you already have, or a new one
 * named here. A pattern is a piece of one project at most, and this one isn't in any.
 */
export function AddToGroupDialog({
  repo,
  pattern,
  groups,
  onCancel,
  onDone,
}: {
  repo: ProjectRepo
  pattern: ProjectSummary
  groups: readonly ProjectGroup[]
  onCancel: () => void
  onDone: (group: ProjectGroup, isNew: boolean) => void
}) {
  const id = useId()
  // The project changed last first, and chosen: adding the next piece of what you've just
  // grouped is the usual case.
  const sorted = [...groups].sort((a, b) => b.updated_at - a.updated_at)
  const [choice, setChoice] = useState<string>(sorted[0]?.id ?? NEW)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const first = useRef<HTMLInputElement>(null)
  const clean = cleanName(name)
  const valid = choice !== NEW || clean !== null

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      if (choice === NEW) onDone(await repo.createGroup(clean!, [pattern.id]), true)
      else {
        const g = await repo.addPieces(choice, [pattern.id])
        if (g) onDone(g, false)
      }
    } catch (e) {
      setError(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Add “${pattern.name}” to a project`}
      onClose={onCancel}
      initialFocus={choice === NEW ? nameField : first}
      className="group-dialog"
      buttons={
        <>
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" form={`${id}-form`} className="button button--primary" disabled={!valid || busy}>
            Add
          </button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        className="group-dialog__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {sorted.length > 0 && (
          <fieldset className="group-dialog__choices">
            <legend className="visually-hidden">Project</legend>
            {sorted.map((g, i) => (
              <label key={g.id} className="group-dialog__choice">
                <input
                  ref={i === 0 ? first : undefined}
                  type="radio"
                  name={`${id}-group`}
                  checked={choice === g.id}
                  onChange={() => setChoice(g.id)}
                />
                <span className="group-dialog__label">{g.name}</span>
              </label>
            ))}
            <label className="group-dialog__choice">
              <input type="radio" name={`${id}-group`} checked={choice === NEW} onChange={() => setChoice(NEW)} />
              New project
            </label>
          </fieldset>
        )}
        {choice === NEW && (
          <div className="group-dialog__name">
            <label htmlFor={`${id}-name`}>{sorted.length ? 'Name' : 'New project’s name'}</label>
            <input
              ref={nameField}
              id={`${id}-name`}
              value={name}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="off"
              placeholder="Sweater"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
      </form>
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

/**
 * "Add patterns…" in a project's view: ticks against the patterns that are in no project,
 * added at the end in the Library's order. (One in another project would be taken out of
 * it, which a tick here shouldn't do unseen, so those aren't offered.)
 */
export function AddPiecesDialog({
  repo,
  group,
  loose,
  onCancel,
  onDone,
}: {
  repo: ProjectRepo
  group: ProjectGroup
  loose: readonly ProjectSummary[]
  onCancel: () => void
  onDone: (added: number) => void
}) {
  const id = useId()
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!ticked.size || busy) return
    setBusy(true)
    try {
      await repo.addPieces(
        group.id,
        loose.filter((s) => ticked.has(s.id)).map((s) => s.id),
      )
      onDone(ticked.size)
    } catch (e) {
      setError(`Couldn't add them: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Add patterns to “${group.name}”`}
      onClose={onCancel}
      className="group-dialog"
      buttons={
        <>
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          {loose.length > 0 && (
            <button type="submit" form={`${id}-form`} className="button button--primary" disabled={!ticked.size || busy}>
              Add
            </button>
          )}
        </>
      }
    >
      {loose.length === 0 ? (
        <p>Every pattern in your Library is already in a project.</p>
      ) : (
        <form
          id={`${id}-form`}
          className="group-dialog__form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <fieldset className="group-dialog__choices">
            <legend className="visually-hidden">Patterns</legend>
            {loose.map((s) => (
              <label key={s.id} className="group-dialog__choice">
                <input
                  type="checkbox"
                  checked={ticked.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(ticked)
                    if (e.target.checked) next.add(s.id)
                    else next.delete(s.id)
                    setTicked(next)
                  }}
                />
                <span className="group-dialog__label">{s.name}</span>
                <span className="group-dialog__size">
                  {s.cols}×{s.rows}
                </span>
              </label>
            ))}
          </fieldset>
        </form>
      )}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

/** "Yarn & size" for a whole project: every piece's colours, added up by colour. */
export function GroupYarn({ repo, group, onClose }: { repo: ProjectRepo; group: ProjectGroup; onClose: () => void }) {
  const [pieces, setPieces] = useState<{ label: string; pattern: Pattern }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    Promise.all(group.pieces.map(async (p) => ({ label: p.label, pattern: (await repo.open(p.id)).project.pattern })))
      .then((l) => live && setPieces(l))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [repo, group])

  const waiting = (body: string) => (
    <Modal
      title="Yarn & size"
      onClose={onClose}
      buttons={
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className={error ? 'notice notice--error' : 'muted'}>{body}</p>
    </Modal>
  )
  if (error) return waiting(`Couldn't open the pieces: ${error}`)
  if (!pieces) return waiting('Loading…')
  return (
    <Suspense fallback={waiting('Loading…')}>
      <YarnEstimate name={group.name} pieces={pieces} onClose={onClose} />
    </Suspense>
  )
}
