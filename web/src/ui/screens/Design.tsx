/**
 * /design/:id, the Design stage (§6.2): a port of alphareader/ui/design/design_window.py.
 *
 * Dense and tool-oriented, for a desk and a mouse: tools on the left, the chart in the
 * middle, colours and the structural panel on the right, and the size underneath. No
 * progress is shown anywhere (§6.1), but it is kept, and carried through every edit
 * (logic/progress.ts): an edit that would lose rows marked done asks first.
 *
 * Every edit goes through design/editor.ts, which also keeps undo; each structural
 * edit is one undo step. Saving is automatic, as in the Work stage (app/autosave.ts),
 * and stamps the project as in the Design stage.
 *
 * Loaded lazily (App.tsx): nothing here is needed to follow a pattern on a phone.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import '../design.css'

import { AutoSaver, type SaveStatus } from '../../app/autosave.ts'
import { useSettings } from '../../app/context.ts'
import { downloadBlob } from '../../app/download.ts'
import { href, navigate, paths } from '../../app/router.ts'
import { trackSave } from '../../app/saving.ts'
import { progressWarning } from '../../app/stages.ts'
import {
  TOOLS,
  abortDrag,
  addColour,
  canRedo,
  canUndo,
  cancelDrag,
  deleteColour,
  initialEditor,
  pointerDown,
  pointerMove,
  pointerUp,
  recolour,
  redo,
  renameColour,
  selectColour,
  setTool,
  structural,
  toolForKey,
  undo,
  type EditorState,
  type Tool,
} from '../../design/editor.ts'
import {
  borderPreview,
  dragOffsets,
  padOffsets,
  padPreview,
  removedCount,
  removesArtwork,
  tryBorder,
  type Preview,
} from '../../design/structure.ts'
import { formSides, initialForm, keepPadValid, parseWhole, type StructureForm } from '../../design/structureForm.ts'
import {
  EditError,
  addBorder,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  majorBorderIndex,
  mirrorH,
  mirrorV,
  padToSize,
  rotate180,
  samePattern,
  scale,
  trimUniformEdges,
} from '../../logic/edit.ts'
import { carryProgress, losesProgress, progressLoss, type ProgressLoss } from '../../logic/progress.ts'
import { formatStats, workingNumber } from '../../logic/readout.ts'
import type { Pattern, Project } from '../../model/types.ts'
import { fitCell, zoomStep, type Overlay } from '../../render/design.ts'
import { exportPng } from '../../render/png.ts'
import type { ProjectRepo } from '../../storage/repo.ts'
import { CellsIcon, ConfirmDialog } from '../components.tsx'
import { ColoursPanel } from '../design/ColoursPanel.tsx'
import { DesignCanvas } from '../design/DesignCanvas.tsx'
import { StructurePanel, type TransformAction } from '../design/StructurePanel.tsx'
import { useDocumentTitle, useMediaQuery } from '../hooks.ts'
import { ProjectGate } from '../ProjectGate.tsx'

export default function Design({ id }: { id: string }) {
  return <ProjectGate id={id}>{(repo, { project }) => <DesignStage repo={repo} initial={project} />}</ProjectGate>
}

/** Each tool's icon: the same 3×3 cell metaphor as the desktop's (icons.py). */
const ICONS: Record<Tool, ReadonlyArray<readonly [number, number]>> = {
  paint: [[1, 1]],
  fill: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]],
  rect: [[0, 0], [0, 1], [1, 0], [1, 1]],
  eyedropper: [[0, 2], [1, 1], [2, 0]],
  row: [[1, 0], [1, 1], [1, 2]],
  col: [[0, 1], [1, 1], [2, 1]],
}

/** Keys that belong to whatever has focus, not to the Design stage. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"]') !== null
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/** The desktop's spin boxes stop at 2000 (design_window.py). */
const MAX_PAD = 2000

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const sizeOf = (p: Pattern) => `${p.cols} × ${p.rows}`

/** What an edit about to lose progress says about it. */
function lossText(loss: ProgressLoss, scaling: boolean): string {
  const done = plural(loss.doneRows, 'row')
  if (scaling) {
    const what = loss.doneRows ? `${done} done${loss.partRow ? ' and part of another' : ''}` : 'part of a row done'
    return `Scaling gives every row a new place, so your progress in the Work stage (${what}) starts again from the first row.`
  }
  const what = [loss.doneRows ? `${done} you’ve marked done` : '', loss.partRow ? 'the row you’re partway through' : '']
    .filter(Boolean)
    .join(' and ')
  return `This removes ${what} in the Work stage. That progress goes with ${loss.doneRows + (loss.partRow ? 1 : 0) === 1 ? 'it' : 'them'}.`
}

interface Pending {
  title: string
  body: ReactNode
  confirmLabel: string
  next: Pattern
  done: string
  after?: () => void
}

interface AxisMenu {
  /** The pattern it was opened on: once that changes (an edit, an undo), it closes. */
  pattern: Pattern
  kind: 'row' | 'col'
  index: number
  x: number
  y: number
}

function DesignStage({ repo, initial }: { repo: ProjectRepo; initial: Project }) {
  const [settings] = useSettings()
  const [editor, setEditor] = useState<EditorState>(() => initialEditor(initial.pattern))
  const latest = useRef(editor)
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState(() => progressWarning(initial.pattern, initial.progress))
  const p = editor.pattern
  useDocumentTitle(`${p.name} (design)`)

  // --- saving: automatic, as a Design-stage project ---------------------------------------------
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [saver] = useState(() => new AutoSaver<Project>((x) => repo.save({ ...x, stage: 'design' }), setStatus))
  // Progress is carried from the pattern this screen opened with, every time: rows that
  // are gone stop counting and a moved cursor goes back to the start of its row, and
  // undoing the edit brings all of it back (logic/progress.ts).
  const projectOf = useCallback(
    (s: EditorState): Project => ({
      pattern: s.pattern,
      progress: carryProgress(initial.pattern, initial.progress, s.pattern),
      stage: 'design',
    }),
    [initial.pattern, initial.progress],
  )

  /** Apply a change to the editor; save if it changed the pattern. */
  const update = useCallback(
    (fn: (s: EditorState) => EditorState) => {
      const before = latest.current
      const next = fn(before)
      if (next === before) return
      latest.current = next
      setEditor(next)
      if (next.pattern !== before.pattern) saver.schedule(projectOf(next))
    },
    [saver, projectOf],
  )

  useEffect(() => {
    const flush = () => void saver.flush()
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      void trackSave(saver.flush()) // leaving: the next screen waits for this
    }
  }, [saver])

  // "Start working →" (§6.4): saved as a Work-stage project, then the Work stage opens.
  const startWorking = () => {
    const saved = saver.flush().then(() => repo.save({ ...projectOf(latest.current), stage: 'work' }))
    void trackSave(saved).catch(() => {})
    navigate(paths.work(p.id))
  }

  // --- the structural panel's form, and the preview it drives ------------------------------------
  const [form, setForm] = useState<StructureForm>(() => initialForm(initial.pattern))
  const borderIndex = useMemo(() => {
    const i = majorBorderIndex(p)
    return i < p.palette.length ? i : 0
  }, [p])
  const pick = (i: number | null) => (i !== null && i < p.palette.length ? i : borderIndex)
  const sides = formSides(form.border)
  const borderColour = pick(form.border.colour)
  const borderResult = useMemo(() => {
    if (form.open !== 'border' || Object.values(sides).every((v) => v === 0)) return null
    const r = tryBorder(p, sides, borderColour)
    return r instanceof EditError ? { error: r.message } : { cols: r.cols, rows: r.rows }
    // `sides` is rebuilt every render; its fields are what matter.
  }, [form.open, p, sides.top, sides.right, sides.bottom, sides.left, borderColour]) // eslint-disable-line react-hooks/exhaustive-deps

  const padW = parseWhole(form.pad.width)
  const padH = parseWhole(form.pad.height)
  const padError =
    padW === null || padH === null
      ? 'Enter a width and a height.'
      : padW < p.cols || padH < p.rows
        ? 'Target must be at least the current size: this adds a border, it doesn’t crop.'
        : padW > MAX_PAD || padH > MAX_PAD
          ? `At most ${MAX_PAD} on a side.`
          : null
  const pad = padOffsets(p, padError ? p.cols : padW!, padError ? p.rows : padH!, form.pad.left, form.pad.top)
  const padColour = pick(form.pad.colour)

  // Keep the pad target valid (at least the size) whenever the size changes, without
  // clobbering a larger one typed, as the desktop's _after_edit does.
  const [sizeSeen, setSizeSeen] = useState({ cols: p.cols, rows: p.rows })
  if (sizeSeen.cols !== p.cols || sizeSeen.rows !== p.rows) {
    setSizeSeen({ cols: p.cols, rows: p.rows })
    setForm((f) => keepPadValid(f, p))
  }


  // Dragging the pattern on the padding preview: offsets from where it was picked up.
  const dragFrom = useRef<{ left: number; top: number } | null>(null)
  const onShift = (delta: { dr: number; dc: number } | null) => {
    if (!delta) {
      dragFrom.current = null
      return
    }
    dragFrom.current ??= { left: pad.left, top: pad.top }
    const to = dragOffsets(dragFrom.current, delta.dr, delta.dc, { cols: pad.addedCols, rows: pad.addedRows })
    setForm((f) => (f.pad.left === to.left && f.pad.top === to.top ? f : { ...f, pad: { ...f.pad, left: to.left, top: to.top } }))
  }

  // --- structural edits: one undo step each, asking first when something would be lost -----------
  const [pending, setPending] = useState<Pending | null>(null)
  const carried = useMemo(() => carryProgress(initial.pattern, initial.progress, p), [initial, p])

  /** Make `next` the pattern, as one undo step. `after` runs once it is. */
  const apply = (next: Pattern, done: string, after?: () => void) => {
    update((s) => structural(s, () => next))
    setMessage(done)
    after?.()
  }

  /** Make `next` the pattern, first asking if it removes artwork or progress. */
  const attempt = (
    next: Pattern,
    done: string,
    opts: { title?: string; confirmLabel?: string; artwork?: string; scaling?: boolean; after?: () => void } = {},
  ) => {
    if (samePattern(p, next)) return
    const loss = progressLoss(p, carried, next)
    const reasons = [opts.artwork, losesProgress(loss) ? lossText(loss, !!opts.scaling) : ''].filter(Boolean)
    if (reasons.length === 0) {
      apply(next, done, opts.after)
      return
    }
    setPending({
      title: opts.title ?? 'Lose progress?',
      confirmLabel: opts.confirmLabel ?? 'Continue',
      next,
      done,
      after: opts.after,
      body: (
        <>
          {reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
          <p className="muted">Undo brings it all back.</p>
        </>
      ),
    })
  }

  /** Run an edit that may refuse (EditError: the Python's ValueError), and say why. */
  const guarded = (fn: () => void) => {
    try {
      fn()
    } catch (e) {
      if (!(e instanceof EditError)) throw e
      setMessage(e.message)
    }
  }

  const closeSection = () => setForm((f) => ({ ...f, open: null }))

  const onBorder = () =>
    guarded(() => {
      const next = addBorder(p, { ...sides, paletteIndex: borderColour })
      const artwork = removesArtwork(p, sides)
        ? `The ${plural(removedCount(p, sides), 'cell')} this removes aren’t all one colour, so it cuts into the pattern.`
        : undefined
      attempt(next, `Border applied: now ${sizeOf(next)}.`, {
        artwork,
        after: closeSection,
        title: artwork ? 'Remove part of the pattern?' : undefined,
        confirmLabel: artwork ? 'Remove cells' : undefined,
      })
    })

  const onPad = () =>
    guarded(() => {
      if (padError) return
      const next = padToSize(p, padW!, padH!, { offsetLeft: pad.left, offsetTop: pad.top, paletteIndex: padColour })
      attempt(next, `Padded to ${sizeOf(next)}.`, { after: closeSection })
    })

  const onScale = () =>
    guarded(() => {
      const next = scale(p, form.scale)
      attempt(next, `Scaled ×${form.scale}: now ${sizeOf(next)}.`, { scaling: true, title: 'Start progress again?', confirmLabel: 'Scale' })
    })

  const transforms: TransformAction[] = [
    { label: 'Mirror ⇄', title: 'Mirror left to right', run: () => attempt(mirrorH(p), 'Mirrored left to right.') },
    { label: 'Flip ⇅', title: 'Flip top to bottom', run: () => attempt(mirrorV(p), 'Flipped top to bottom.') },
    { label: 'Rotate 180°', title: 'Rotate half a turn', run: () => attempt(rotate180(p), 'Rotated 180°.') },
    {
      label: 'Trim edges',
      title: 'Remove single-colour rows and columns from all four edges',
      run: () => {
        const next = trimUniformEdges(p, { top: true, right: true, bottom: true, left: true })
        if (samePattern(p, next)) setMessage('No single-colour edges to trim.')
        else attempt(next, `Trimmed single-colour edges: now ${sizeOf(next)}.`)
      },
    },
  ]

  const onRow = (action: 'above' | 'below' | 'delete', r: number) =>
    guarded(() => {
      const n = workingNumber(p, r)
      if (action === 'delete') attempt(deleteRow(p, r), `Deleted row ${n}.`, { title: 'Delete a row you’ve worked?', confirmLabel: 'Delete row' })
      else apply(insertRow(p, action === 'above' ? r : r + 1, editor.colour), `Inserted a row ${action} row ${n}.`)
    })

  const onCol = (action: 'left' | 'right' | 'delete', c: number) =>
    guarded(() => {
      if (action === 'delete') attempt(deleteColumn(p, c), `Deleted column ${c + 1}.`)
      else apply(insertColumn(p, action === 'left' ? c : c + 1, editor.colour), `Inserted a column ${action} of column ${c + 1}.`)
    })

  // --- a row or column picked from its number on the chart ------------------------------------------
  const [openMenu, setAxisMenu] = useState<AxisMenu | null>(null)
  const axisMenu = openMenu?.pattern === p ? openMenu : null
  const onAxis = (kind: 'row' | 'col', index: number, at: { x: number; y: number }) => {
    setAxisMenu({ pattern: p, kind, index, ...at })
    setForm((f) => (kind === 'row' ? { ...f, row: String(workingNumber(p, index)) } : { ...f, col: String(index + 1) }))
  }

  // --- zoom: px per cell. Until zoomed (and after Fit) it follows the view's size. ----------
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [zoomed, setZoomed] = useState<number | null>(null)

  // --- the screen: desktop, tablet (a toolbar and drawers), or too small ------------------------
  const compact = useMediaQuery('(max-width: 1099.98px)')
  const tooSmall = useMediaQuery('(max-width: 699.98px)')
  const [drawer, setDrawer] = useState<'colours' | 'structure' | null>(null)
  const hidden = useRef(tooSmall)
  useEffect(() => {
    hidden.current = tooSmall
  }, [tooSmall])

  // A border or a padding is previewed while its section is open and in view (on a
  // tablet, while the structure drawer is).
  const previewing = form.open !== null && (!compact || drawer === 'structure') ? form.open : null
  const preview: Preview | null = useMemo(() => {
    if (previewing === 'border') return borderPreview(p, sides, borderColour)
    if (previewing === 'pad' && !padError) return padPreview(p, padW!, padH!, pad.left, pad.top, padColour)
    return null
  }, [previewing, p, sides.top, sides.right, sides.bottom, sides.left, borderColour, padError, padW, padH, pad.left, pad.top, padColour]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownPattern = preview?.pattern ?? p
  const fit = useMemo(
    () => (viewport ? fitCell(shownPattern.cols, shownPattern.rows, viewport.width, viewport.height) : null),
    [viewport, shownPattern.cols, shownPattern.rows],
  )
  const cell = zoomed ?? fit
  const shown = useRef(cell)
  useEffect(() => {
    shown.current = cell
  }, [cell])
  const zoom = useCallback((dir: number) => setZoomed(() => zoomStep(shown.current ?? 16, dir)), [])

  // --- keyboard -------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hidden.current) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === 's') {
        e.preventDefault()
        void saver.flush()
        return
      }
      if (e.defaultPrevented || ownsKeys(e.target) || document.querySelector('[aria-modal="true"]')) return
      if (mod && !e.altKey) {
        if (key === 'z') {
          e.preventDefault()
          update(e.shiftKey ? redo : undo)
        } else if (key === 'y') {
          e.preventDefault()
          update(redo)
        }
        return
      }
      if (e.altKey) return
      if (e.key === 'Escape') {
        update(cancelDrag)
        return
      }
      if (e.key === '+' || e.key === '=') zoom(1)
      else if (e.key === '-' || e.key === '_') zoom(-1)
      else {
        const tool = toolForKey(e.key)
        if (!tool) return
        update((s) => setTool(s, tool))
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saver, update, zoom])

  // --- colours -----------------------------------------------------------------------------------
  const onDelete = (i: number) => {
    const before = latest.current.pattern
    const gone = before.palette[i]
    update((s) => deleteColour(s, i))
    const after = latest.current.pattern
    if (!gone || after === before) return
    const into = after.palette[latest.current.colour]
    setMessage(
      gone.count
        ? `Deleted “${gone.name}”; its ${gone.count} cell${gone.count === 1 ? '' : 's'} are now “${into?.name}”.`
        : `Deleted “${gone.name}”.`,
    )
  }

  const d = editor.drag
  const rectPreview = d?.tool === 'rect' ? { a: d.start, b: d.end, hex: p.palette[editor.colour]?.hex ?? '#000000' } : null
  const current = p.palette[editor.colour]
  const overlay: Overlay | null = preview
    ? { removed: preview.removed, outline: preview.outline }
    : axisMenu
      ? {
          highlight:
            axisMenu.kind === 'row'
              ? { r0: axisMenu.index, r1: axisMenu.index + 1, c0: 0, c1: p.cols }
              : { r0: 0, r1: p.rows, c0: axisMenu.index, c1: axisMenu.index + 1 },
        }
      : null
  const mode = preview ? (previewing === 'pad' ? 'move' : 'view') : 'edit'

  // The same controls, laid out for the screen: side columns on a desktop; on a tablet a
  // toolbar over the chart, and the colours and the structural panel in drawers.
  const tools = (
    <div className="tools" role="group" aria-label="Tool">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          className="tool"
          aria-pressed={editor.tool === t.tool}
          aria-keyshortcuts={t.key}
          title={`${t.label} (${t.key})`}
          onClick={() => update((s) => setTool(s, t.tool))}
        >
          <CellsIcon filled={ICONS[t.tool]} />
          <span className="tool__label">{t.label}</span>
          <kbd className="tool__key">{t.key}</kbd>
        </button>
      ))}
    </div>
  )
  const zoomControls = (
    <div className="zoom">
      <button type="button" className="button button--small" aria-label="Zoom out" onClick={() => zoom(-1)}>
        −
      </button>
      <button type="button" className="button button--small" aria-label="Zoom in" onClick={() => zoom(1)}>
        +
      </button>
      <button type="button" className="button button--small" onClick={() => setZoomed(null)}>
        Fit
      </button>
      <span className="zoom__label muted" title={`${MOD} + scroll, or pinch, over the chart to zoom`}>
        {cell ?? '–'} px per cell
      </span>
    </div>
  )
  const colours = (
    <ColoursPanel
      palette={p.palette}
      current={editor.colour}
      onSelect={(i) => update((s) => selectColour(s, i))}
      onAdd={(hex) => update((s) => addColour(s, hex))}
      onRecolour={(i, hex) => update((s) => recolour(s, i, hex))}
      onRename={(i, name) => update((s) => renameColour(s, i, name))}
      onDelete={onDelete}
    />
  )
  const structure = (
    <StructurePanel
      pattern={p}
      form={form}
      onForm={setForm}
      borderIndex={borderIndex}
      borderResult={borderResult}
      pad={pad}
      padError={form.open === 'pad' ? padError : null}
      onBorder={onBorder}
      onPad={onPad}
      onScale={onScale}
      transforms={transforms}
      onRow={onRow}
      onCol={onCol}
    />
  )

  // A phone: the Design stage is desktop-first and doesn't fit (docs/web-port-plan.md,
  // Phase 3). This screen keeps its state (the pattern, undo) meanwhile, so turning a
  // device round and back loses nothing.
  if (tooSmall) {
    return (
      <main className="screen design design--small">
        <h1 className="design__name">{p.name}</h1>
        <section className="design__too-small" aria-labelledby="design-too-small">
          <h2 id="design-too-small">The Design stage needs a larger screen</h2>
          <p>
            Editing a pattern needs a tablet or a computer. On this screen you can work from it, row by row, or go back to your
            library.
          </p>
          <div className="design__too-small-actions">
            <button type="button" className="button button--primary" onClick={startWorking}>
              Start working →
            </button>
            <a className="button" href={href(paths.library)}>
              ← Library
            </a>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className={compact ? 'screen design design--compact' : 'screen design'}>
      <header className="design__top">
        <a className="topbar__home" href={href(paths.library)}>
          <span aria-hidden="true">←</span> Library
        </a>
        <h1 tabIndex={-1} className="design__name">
          {p.name}
        </h1>
        <span className="work__saved" data-status={status} role={status === 'error' ? 'alert' : undefined}>
          {status === 'error' ? 'Not saved' : status === 'saved' ? 'Saved' : 'Saving…'}
        </span>
        <div className="design__history">
          <button
            type="button"
            className="button button--small"
            onClick={() => update(undo)}
            disabled={!canUndo(editor)}
            title={`Undo (${MOD}Z)`}
          >
            Undo
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={() => update(redo)}
            disabled={!canRedo(editor)}
            title={`Redo (${MOD}⇧Z)`}
          >
            Redo
          </button>
        </div>
        <button
          type="button"
          className="button button--small design__export"
          title="Save the chart as an image, as the desktop's Export PNG does"
          onClick={() => {
            const { blob, filename } = exportPng(latest.current.pattern)
            downloadBlob(blob, filename)
            setMessage(`Exported “${filename}”.`)
          }}
        >
          Export PNG
        </button>
        <button type="button" className="button button--primary design__work" onClick={startWorking}>
          Start working →
        </button>
      </header>

      {warning && (
        <p className="notice notice--info design__warning" role="status">
          {warning}{' '}
          <button type="button" className="linklike" onClick={() => setWarning(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="design__body">
        {compact ? (
          <div className="design__toolbar" role="toolbar" aria-label="Tools">
            {tools}
            <span className="design__toolbar-gap" />
            {zoomControls}
            <span className="design__toolbar-gap" />
            {(['colours', 'structure'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className="button button--small"
                aria-expanded={drawer === d}
                aria-controls={`design-drawer-${d}`}
                onClick={() => setDrawer((x) => (x === d ? null : d))}
              >
                {d === 'colours' ? (
                  <>
                    <span className="colour__swatch design__toolbar-swatch" style={{ background: current?.hex }} aria-hidden="true" />
                    Colours
                  </>
                ) : (
                  'Structure'
                )}
              </button>
            ))}
          </div>
        ) : (
          <aside className="design__tools" aria-label="Tools">
            <h2 className="design__heading">Tools</h2>
            {tools}
            <h2 className="design__heading">Zoom</h2>
            {zoomControls}
            {current && (
              <div className="design__current">
                <span className="colour__swatch" style={{ background: current.hex }} aria-hidden="true" />
                <span>
                  Painting with <strong>{current.name || 'Unnamed'}</strong>
                </span>
              </div>
            )}
          </aside>
        )}

        <section className="design__canvas" aria-label="Pattern">
          <DesignCanvas
            pattern={shownPattern}
            cell={cell ?? 16}
            tool={editor.tool}
            mode={mode}
            preview={rectPreview}
            overlay={overlay}
            onDown={(c) => update((s) => pointerDown(s, c))}
            onMove={(c) => update((s) => pointerMove(s, c))}
            onUp={(c) => update((s) => pointerUp(s, c))}
            onCancel={() => update(cancelDrag)}
            onAbort={() => update(abortDrag)}
            onShift={onShift}
            onAxis={onAxis}
            onZoom={zoom}
            onZoomTo={setZoomed}
            onViewport={setViewport}
            themeKey={settings.highContrast ? 'high' : 'normal'}
            label={preview ? `Preview, ${shownPattern.cols} by ${shownPattern.rows}` : `Pattern, ${p.cols} by ${p.rows}`}
          />
          {preview && (
            <p className="design__previewing" role="status">
              {previewing === 'pad' ? 'Previewing the padding: drag the pattern to place it.' : 'Previewing the border.'}
            </p>
          )}
        </section>

        {compact ? (
          drawer && (
            <aside id={`design-drawer-${drawer}`} className="design__drawer" aria-label={drawer === 'colours' ? 'Colours' : 'Structure'}>
              <button type="button" className="button button--small design__drawer-close" onClick={() => setDrawer(null)}>
                Close
              </button>
              {drawer === 'colours' ? colours : structure}
            </aside>
          )
        ) : (
          <aside className="design__side">
            {colours}
            {structure}
          </aside>
        )}
      </div>

      <footer className="design__bar">
        <span className="design__stats">{formatStats(p.cols, p.rows, p.palette.length)}</span>
        <span className="design__message" role="status" aria-live="polite">
          {message}
        </span>
      </footer>

      {axisMenu && (
        <AxisMenuPopup
          menu={axisMenu}
          pattern={p}
          onClose={() => setAxisMenu(null)}
          onRow={(a) => {
            setAxisMenu(null)
            onRow(a, axisMenu.index)
          }}
          onCol={(a) => {
            setAxisMenu(null)
            onCol(a, axisMenu.index)
          }}
        />
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          confirmLabel={pending.confirmLabel}
          danger
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { next, done, after } = pending
            setPending(null)
            apply(next, done, after)
          }}
        >
          {pending.body}
        </ConfirmDialog>
      )}
    </main>
  )
}

/**
 * Insert or delete the row or column whose number was pressed. A small menu at the
 * number, rather than a selected cell: the Design stage has no selection (every tool
 * acts on a press), the numbers are already there to aim at, and it works the same with
 * a finger. Escape, or a press outside, closes it.
 */
function AxisMenuPopup({
  menu,
  pattern: p,
  onClose,
  onRow,
  onCol,
}: {
  menu: AxisMenu
  pattern: Pattern
  onClose: () => void
  onRow: (action: 'above' | 'below' | 'delete') => void
  onCol: (action: 'left' | 'right' | 'delete') => void
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector('button')?.focus()
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    // Deferred, so the press that opened the menu doesn't close it.
    const t = setTimeout(() => document.addEventListener('pointerdown', outside), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', outside)
    }
  }, [onClose])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    } else if (e.key === 'Tab') {
      onClose()
    }
  }

  const row = menu.kind === 'row'
  const n = row ? workingNumber(p, menu.index) : menu.index + 1
  const last = row ? p.rows <= 1 : p.cols <= 1
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 220))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 160))
  const label = row ? `Row ${n}` : `Column ${n}`
  return (
    <div ref={box} className="axis-menu" role="menu" aria-label={label} style={{ left, top }} onKeyDown={onKeyDown}>
      <p className="axis-menu__title">{label}</p>
      {row ? (
        <>
          <button type="button" role="menuitem" onClick={() => onRow('above')}>
            Insert row above
          </button>
          <button type="button" role="menuitem" onClick={() => onRow('below')}>
            Insert row below
          </button>
          <button type="button" role="menuitem" className="axis-menu__danger" disabled={last} title={last ? 'Cannot delete the last row.' : undefined} onClick={() => onRow('delete')}>
            Delete row {n}
          </button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => onCol('left')}>
            Insert column left
          </button>
          <button type="button" role="menuitem" onClick={() => onCol('right')}>
            Insert column right
          </button>
          <button type="button" role="menuitem" className="axis-menu__danger" disabled={last} title={last ? 'Cannot delete the last column.' : undefined} onClick={() => onCol('delete')}>
            Delete column {n}
          </button>
        </>
      )}
    </div>
  )
}
