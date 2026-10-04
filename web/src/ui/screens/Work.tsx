/**
 * /work/:id, the Work stage (§6.3): a port of alphareader/ui/work/work_window.py.
 *
 * Read-only and glanceable: follow a pattern row by row, often on a phone propped up
 * next to the yarn. Every progress change goes through logic/work.ts; nothing here edits
 * the pattern's cells (§13.7).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { AutoSaver, type SaveStatus } from '../../app/autosave.ts'
import { useSettings } from '../../app/context.ts'
import { downloadBlob } from '../../app/download.ts'
import { href, navigate, paths } from '../../app/router.ts'
import { trackSave } from '../../app/saving.ts'
import { keepScreenAwake } from '../../app/wakeLock.ts'
import { carriesByRun, carryPlan } from '../../logic/carry.ts'
import { encodeRow, formatRowText, rowDirection, workingNumber } from '../../logic/readout.ts'
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
import { reorder, repairProgress } from '../../logic/progress.ts'
import { countOf, craftOf, withCraft, type CraftId } from '../../craft/crafts.ts'
import type { Direction, Pattern, Project } from '../../model/types.ts'
import { exportChartPng } from '../../render/chartPng.ts'
import { placeThrough, type RowPlace } from '../../render/layout.ts'
import { progressPct } from '../../storage/alpha.ts'
import type { ProjectRepo } from '../../storage/repo.ts'
import { ConfirmDialog, HelpLink, ProgressBar, RenameForm } from '../components.tsx'
import { useDocumentTitle } from '../hooks.ts'
import { ProjectGate } from '../ProjectGate.tsx'
import { ChartView } from '../work/ChartView.tsx'
import { Chips } from '../work/Chips.tsx'
import { OptionsMenu } from '../work/OptionsMenu.tsx'
import { entryFor } from '../work/segments.ts'
import { SegmentDialog } from '../work/SegmentDialog.tsx'

export function Work({ id }: { id: string }) {
  return <ProjectGate id={id}>{(repo, { project }) => <WorkStage repo={repo} initial={project} />}</ProjectGate>
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
    // Made sound first: a structural edit (or a file from elsewhere) can leave progress
    // naming rows that are gone, or a place past the end of its row (logic/progress.ts).
    progress: ensureStarted(initial.pattern, repairProgress(initial.pattern, initial.progress)),
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
      // Leaving the Work stage: whatever opens next waits for this (app/saving.ts).
      void trackSave(saver.flush())
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
  const craft = craftOf(p)
  const done = isComplete(p, pr)
  const cur = done ? null : rowIndex(p, pr.current_row_id)
  const runs = useMemo(() => (cur === null ? [] : encodeRow(p, cur)), [p, cur])
  // Your place in the row, for the chart to follow across. Rebuilt on every progress
  // change (`pr` is new each time), even one that leaves it where it was, so the next
  // change after a scroll by hand always brings it back.
  const place = useMemo<RowPlace | null>(
    () =>
      cur === null
        ? null
        : {
            runs,
            runIndex: pr.current_run_index,
            stitches: pr.current_run_stitches,
            direction: rowDirection(p, cur),
          },
    [p, cur, runs, pr],
  )
  // Where to carry each colour, for the whole chart: only worked out when asked for.
  const carries = useMemo(
    () => (settings.showCarries && craftOf(p).carries ? carryPlan(p) : null),
    [p, settings.showCarries],
  )
  const runCarries = useMemo(
    () => (carries === null || cur === null ? null : carriesByRun(p.cols, runs, carries[cur]!, rowDirection(p, cur))),
    [p, cur, runs, carries],
  )
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

  // The craft and the reading-order options read the same rows another way. Progress is
  // carried as after an edit; if that sends the row partway through back to its start,
  // ask first (logic/progress.ts `reorder`).
  const [restart, setRestart] = useState<{ next: Pattern; row: number } | null>(null)
  const reread = (make: (q: Pattern) => Pattern) => {
    const x = latest.current
    const next = make(x.pattern)
    const { progress, restartsRow } = reorder(x.pattern, x.progress, next)
    if (restartsRow) {
      const r = rowIndex(x.pattern, x.progress.current_row_id)!
      setRestart({ next, row: workingNumber(x.pattern, r) })
      return
    }
    change((y) => ({ ...y, pattern: next, progress }))
  }
  const confirmRestart = () => {
    if (!restart) return
    const { next } = restart
    setRestart(null)
    change((y) => ({ ...y, pattern: next, progress: reorder(y.pattern, y.progress, next).progress }))
  }
  const setCraft = (id: CraftId) => reread((q) => withCraft(q, id))
  // One corner sets both which row is row 1 and which way it runs, so one question at most.
  const setCorner = (bottomUp: boolean, start: Direction) =>
    reread((q) => ({ ...q, bottom_up: bottomUp, start_direction: start }))
  const setSameWay = (same: boolean) => reread((q) => ({ ...q, alternate_direction: !same }))

  // Back to Design (§6.4), a deliberate action in the Options menu. The project is saved
  // as a Design-stage one first, as the desktop did, so it reopens there.
  const editPattern = () => {
    const saved = saver.flush().then(() => repo.save({ ...latest.current, stage: 'design' }))
    void trackSave(saved).catch(() => {})
    navigate(paths.design(latest.current.pattern.id))
  }

  // The chart as a picture, with the numbers and strands the chart shows now, but not
  // your progress (render/chartPng.ts).
  const exportChart = () => {
    options.current?.removeAttribute('open')
    exportChartPng(p, { numbers: settings.stitchNumbers, carries }).then(
      ({ blob, filename }) => downloadBlob(blob, filename),
      (error: unknown) => console.error(error),
    )
  }

  // A chip's tick: done marks it and every segment before it done; undone takes your place
  // back to its start, so it and every one after it are to do.
  const tick = (i: number, isDone: boolean) =>
    change((x) => ({
      ...x,
      progress: isDone ? markSegmentComplete(x.pattern, x.progress, i) : setRunStitches(x.pattern, x.progress, i, 0),
    }))

  // A tap on a stitch of the current row: done up to and including it. Anywhere else on
  // the chart does nothing, so a stray tap can at most move your place along this row.
  const tapStitch = (row: number, col: number) => {
    const x = latest.current
    const r = isComplete(x.pattern, x.progress) ? null : rowIndex(x.pattern, x.progress.current_row_id)
    if (r === null || row !== r) return
    const at = placeThrough(x.pattern.cols, encodeRow(x.pattern, r), rowDirection(x.pattern, r), col)
    if (at) change((y) => ({ ...y, progress: setRunStitches(y.pattern, y.progress, at.runIndex, at.stitches) }))
  }

  // The chips follow your place: whenever it moves, the list scrolls to put the segment
  // you're on at the top, with a little of the one before it showing, so the ones still
  // to do are in view; a new row starts at the top of the list. Only the list moves, and
  // only when it's longer than its space. A scroll by hand stays until the next change.
  const chipsBox = useRef<HTMLElement>(null)
  const chipsPlaced = useRef(false)
  useLayoutEffect(() => {
    const box = chipsBox.current
    if (!box) return
    const current = box.querySelector<HTMLElement>('.chip--current')
    let top = 0
    if (current && pr.current_run_index > 0) {
      const before = current.previousElementSibling as HTMLElement | null
      const peek = before ? Math.min(before.offsetHeight * 0.45, 24) : 0
      top = box.scrollTop + current.getBoundingClientRect().top - box.getBoundingClientRect().top - peek
    }
    top = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight))
    if (Math.abs(top - box.scrollTop) > 0.5) {
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
      if (chipsPlaced.current && !reduce && typeof box.scrollTo === 'function') box.scrollTo({ top, behavior: 'smooth' })
      else box.scrollTop = top
    }
    chipsPlaced.current = true
  }, [pr])

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
          <OptionsMenu
            pattern={p}
            craft={craft}
            settings={settings}
            setSettings={setSettings}
            onCraft={setCraft}
            onCorner={setCorner}
            onSameWay={setSameWay}
            onRename={() => {
              options.current?.removeAttribute('open')
              setRenaming(true)
            }}
            onEdit={editPattern}
            onExportPng={exportChart}
          />
        </details>
        <HelpLink topic="work" />
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
          {stitchesDone} / {countOf(craft, total)}
        </p>
        <ProgressBar pct={progressPct(p, pr)} />
      </section>

      <div className={settings.focusMode ? 'work__body work__body--focus' : 'work__body'}>
        <section ref={chipsBox} className="work__chips" aria-label="This row">
          <h2 className="work__label">This row</h2>
          {done ? (
            <p className="muted">Every row is done.</p>
          ) : (
            <Chips
              pattern={p}
              runs={runs}
              cursor={pr.current_run_index}
              stitches={pr.current_run_stitches}
              carries={runCarries}
              onChip={setSegment}
              onTick={tick}
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
          place={place}
          carries={carries}
          numbers={settings.stitchNumbers}
          onStitch={tapStitch}
          tappable={(row) => row === cur}
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
      <p className="work__hint muted">Space or → completes a row · ← goes back · click a stitch in this row to mark up to it</p>

      {openRun && segment !== null && (
        <SegmentDialog
          entry={entryFor(p, openRun.palette_index)}
          count={openRun.count}
          unit={craft.unit}
          units={craft.units}
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

      {restart && (
        <ConfirmDialog
          title={`Start row ${restart.row} again?`}
          confirmLabel="Change it"
          onCancel={() => setRestart(null)}
          onConfirm={confirmRestart}
        >
          <p>
            Row {restart.row} would read differently, so the part of it you've recorded goes back to the start of the row.
            Rows marked done stay done.
          </p>
        </ConfirmDialog>
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
