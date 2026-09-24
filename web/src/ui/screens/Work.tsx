/**
 * /work/:id, the Work stage (§6.3): a port of alphareader/ui/work/work_window.py.
 *
 * Read-only and glanceable: follow a pattern row by row, often on a phone propped up
 * next to the yarn. Every progress change goes through logic/work.ts; nothing here edits
 * the pattern's cells (§13.7).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { AutoSaver, type SaveStatus } from '../../app/autosave.ts'
import { useRepo, useSettings } from '../../app/context.ts'
import { downloadBlob } from '../../app/download.ts'
import { href, paths } from '../../app/router.ts'
import { keepScreenAwake } from '../../app/wakeLock.ts'
import { encodeRow, exportAllRowsText, formatRowText, rowDirection, workingNumber } from '../../logic/readout.ts'
import {
  completeCurrentRow,
  ensureStarted,
  goPreviousRow,
  isComplete,
  markSegmentComplete,
  remainingStitches,
  rowIndex,
  setRunStitches,
  workSequence,
} from '../../logic/work.ts'
import type { Project } from '../../model/types.ts'
import { progressPct } from '../../storage/alpha.ts'
import { ProjectNotFoundError, type ProjectRepo } from '../../storage/repo.ts'
import { ProgressBar, RenameForm, TopBar } from '../components.tsx'
import { useDocumentTitle } from '../hooks.ts'
import { ChartView } from '../work/ChartView.tsx'
import { Chips } from '../work/Chips.tsx'
import { entryFor } from '../work/segments.ts'
import { SegmentDialog } from '../work/SegmentDialog.tsx'
import { StorageUnavailable } from './Landing.tsx'

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; project: Project }

export function Work({ id }: { id: string }) {
  const state = useRepo()
  const repo = state.status === 'ready' ? state.repo : null
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    if (!repo) return
    // A different id is a different route key, so this component is remounted rather
    // than reused, and never needs to go back to 'loading'.
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

  if (state.status === 'error') return <Message title="Project"><StorageUnavailable /></Message>
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
  return <WorkStage repo={repo} initial={load.project} />
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

/** Keys that belong to whatever has focus, not to the Work stage. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('input, textarea, select, [role="dialog"], [role="alertdialog"]')) return true
  return false
}

/** Elements that Space and Enter already activate. */
const activates = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest('button, a[href], summary, [role="button"]') !== null

function WorkStage({ repo, initial }: { repo: ProjectRepo; initial: Project }) {
  const [settings, setSettings] = useSettings()
  const [project, setProject] = useState<Project>(() => ({
    ...initial,
    progress: ensureStarted(initial.pattern, initial.progress),
  }))
  const latest = useRef(project)
  const [segment, setSegment] = useState<number | null>(null)
  const [renaming, setRenaming] = useState(false)
  const optionsButton = useRef<HTMLElement>(null)
  const wasRenaming = useRef(false)
  useEffect(() => {
    // Back from the rename field, focus returns to the (closed) Options menu.
    if (wasRenaming.current && !renaming) optionsButton.current?.focus()
    wasRenaming.current = renaming
  }, [renaming])
  useDocumentTitle(project.pattern.name)

  // Saved automatically, ~300 ms after the last change, and at once when the page is
  // hidden or left. Saving from here puts the project in the Work stage, as on the
  // desktop; the stored source image is kept (repo.save's default).
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [saver] = useState(() => new AutoSaver<Project>((x) => repo.save({ ...x, stage: 'work' }), setStatus))

  const change = useCallback(
    (next: (p: Project) => Project) => {
      const updated = next(latest.current)
      latest.current = updated
      setProject(updated)
      saver.schedule(updated)
    },
    [saver],
  )

  useEffect(() => {
    const flush = () => void saver.flush()
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush() // leaving the Work stage
    }
  }, [saver])

  useEffect(() => keepScreenAwake(), [])

  // The Options menu closes on a tap outside it, or on Escape.
  const options = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: Event) => {
      const menu = options.current
      if (!menu?.open) return
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.contains(e.target as Node)) {
        menu.open = false
        if (e instanceof KeyboardEvent) optionsButton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  const { pattern: p, progress: pr } = project
  const done = isComplete(p, pr)
  const cur = done ? null : rowIndex(p, pr.current_row_id)
  const runs = useMemo(() => (cur === null ? [] : encodeRow(p, cur)), [p, cur])
  const completed = useMemo(() => {
    const s = new Set<number>()
    p.row_ids.forEach((rid, i) => pr.completed_row_ids.has(rid) && s.add(i))
    return s
  }, [p, pr.completed_row_ids])
  const seq = useMemo(() => workSequence(p), [p])
  const position = cur === null ? -1 : seq.indexOf(cur)
  const nextRow = position >= 0 && position + 1 < seq.length ? seq[position + 1]! : null
  const total = p.rows * p.cols
  const stitchesDone = total - remainingStitches(p, pr)

  const completeRow = useCallback(
    () => change((x) => ({ ...x, progress: completeCurrentRow(x.pattern, x.progress) })),
    [change],
  )
  const previousRow = useCallback(
    () => change((x) => ({ ...x, progress: goPreviousRow(x.pattern, x.progress) })),
    [change],
  )

  // → ↓ Space Return complete the row; ← ↑ go back. Never while a dialog or a text field
  // has the keys, and never on auto-repeat: holding a key must not race through rows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+S saves now. It's never needed, but it's what hands expect to work.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saver.flush()
        return
      }
      if (e.defaultPrevented || segment !== null || ownsKeys(e.target)) return
      if (document.querySelector('[aria-modal="true"]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      let action: (() => void) | null = null
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') action = completeRow
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') action = previousRow
      else if ((e.key === ' ' || e.key === 'Enter') && !activates(e.target)) action = completeRow
      if (!action) return
      e.preventDefault()
      if (!e.repeat) action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [segment, completeRow, previousRow, saver])

  const setStartRight = (right: boolean) =>
    change((x) => ({ ...x, pattern: { ...x.pattern, start_direction: right ? 'RTL' : 'LTR' } }))

  const exportReadout = () =>
    downloadBlob(new Blob([exportAllRowsText(p)], { type: 'text/plain;charset=utf-8' }), `${p.name}.txt`)

  const openRun = segment === null ? undefined : runs[segment]
  const arrow = cur !== null && rowDirection(p, cur) === 'LTR' ? '→' : '←'

  return (
    <main className="screen work">
      <header className="work__top">
        <a className="topbar__home" href={href(paths.library)}>
          <span aria-hidden="true">←</span> Library
        </a>
        {renaming ? (
          <RenameForm
            className="rename work__rename"
            name={p.name}
            onCancel={() => setRenaming(false)}
            onRename={(name) => {
              setRenaming(false)
              change((x) => ({ ...x, pattern: { ...x.pattern, name } }))
            }}
          />
        ) : (
          <>
            <h1 tabIndex={-1} className="work__name">
              {p.name}
            </h1>
          </>
        )}
        <SaveIndicator status={status} onRetry={() => void saver.flush()} />
        <details ref={options} className="work__options">
          <summary ref={optionsButton} className="button button--small">
            Options
          </summary>
          <div className="work__menu">
            <button
              type="button"
              className="button button--small"
              aria-label={`Rename “${p.name}”`}
              onClick={(e) => {
                e.currentTarget.closest('details')?.removeAttribute('open')
                setRenaming(true)
              }}
            >
              Rename…
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={p.start_direction === 'RTL'}
                onChange={(e) => setStartRight(e.target.checked)}
              />
              Start rows from the right
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.focusMode} onChange={(e) => setSettings({ focusMode: e.target.checked })} />
              Focus mode
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.emphasiseRows}
                onChange={(e) => setSettings({ emphasiseRows: e.target.checked })}
              />
              Taller rows around the current one
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.highContrast}
                onChange={(e) => setSettings({ highContrast: e.target.checked })}
              />
              High contrast
            </label>
            <button type="button" className="button button--small" onClick={exportReadout}>
              Export readout
            </button>
          </div>
        </details>
      </header>

      <section className="work__status" aria-label="Progress">
        <p className="work__row" aria-live="polite">
          {done ? (
            'Finished! 🎉'
          ) : cur === null ? (
            'No rows'
          ) : (
            <>
              Row {workingNumber(p, cur)} of {p.rows}{' '}
              <span className="work__arrow" aria-label={arrow === '→' ? 'left to right' : 'right to left'}>
                {arrow}
              </span>
            </>
          )}
        </p>
        <p className="work__stitches">
          {stitchesDone} / {total} stitches
        </p>
        <ProgressBar pct={progressPct(p, pr)} />
      </section>

      <div className={settings.focusMode ? 'work__body work__body--focus' : 'work__body'}>
        <section className="work__chips" aria-label="This row">
          <h2 className="work__label">This row</h2>
          {done ? (
            <p className="muted">Every row is done.</p>
          ) : (
            <Chips
              pattern={p}
              runs={runs}
              cursor={pr.current_run_index}
              stitches={pr.current_run_stitches}
              onChip={setSegment}
            />
          )}
          {!settings.focusMode && !done && cur !== null && (
            <p className="work__next muted">
              {nextRow === null
                ? 'Next: this is the last row.'
                : `Next: Row ${workingNumber(p, nextRow)}: ${formatRowText(p, nextRow)}`}
            </p>
          )}
        </section>
        <ChartView
          pattern={p}
          completed={completed}
          current={cur}
          emphasise={settings.emphasiseRows}
          focus={settings.focusMode}
          themeKey={settings.highContrast ? 'high' : 'normal'}
          label={`Chart, ${p.cols} by ${p.rows}${cur === null ? '' : `, row ${workingNumber(p, cur)} outlined`}`}
        />
      </div>

      <div className="work__bar">
        <button type="button" className="button work__prev" onClick={previousRow} disabled={position === 0}>
          ← Previous row
        </button>
        <button type="button" className="button button--primary work__complete" onClick={completeRow} disabled={done}>
          Row complete →
        </button>
      </div>
      <p className="work__hint muted">Space or → completes a row · ← goes back · tap a colour to record part of a row</p>

      {openRun && segment !== null && (
        <SegmentDialog
          entry={entryFor(p, openRun.palette_index)}
          count={openRun.count}
          done={segment === pr.current_run_index ? pr.current_run_stitches : 0}
          onCancel={() => setSegment(null)}
          onComplete={() => {
            const i = segment
            setSegment(null)
            change((x) => ({ ...x, progress: markSegmentComplete(x.pattern, x.progress, i) }))
          }}
          onSave={(n) => {
            const i = segment
            setSegment(null)
            change((x) => ({ ...x, progress: setRunStitches(x.pattern, x.progress, i, n) }))
          }}
        />
      )}
    </main>
  )
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === 'error') {
    return (
      <span className="work__saved work__saved--error" role="alert">
        Not saved.{' '}
        <button type="button" className="linklike" onClick={onRetry}>
          Try again
        </button>
      </span>
    )
  }
  return (
    <span className="work__saved" data-status={status}>
      {status === 'saved' ? 'Saved' : 'Saving…'}
    </span>
  )
}
