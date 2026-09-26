/**
 * /design/:id, the Design stage (§6.2): a port of alphareader/ui/design/design_window.py.
 *
 * Dense and tool-oriented, for a desk and a mouse: tools on the left, the chart in the
 * middle, colours on the right, and the size underneath. No progress is shown anywhere
 * (§6.1), but it is kept: cell and colour edits never change row ids, so the rows done in
 * the Work stage are still done when it's opened again.
 *
 * Every edit goes through design/editor.ts, which also keeps undo. Saving is automatic,
 * as in the Work stage (app/autosave.ts), and stamps the project as in the Design stage.
 *
 * Loaded lazily (App.tsx): nothing here is needed to follow a pattern on a phone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import '../design.css'

import { AutoSaver, type SaveStatus } from '../../app/autosave.ts'
import { useSettings } from '../../app/context.ts'
import { href, navigate, paths } from '../../app/router.ts'
import { trackSave } from '../../app/saving.ts'
import { progressWarning } from '../../app/stages.ts'
import {
  TOOLS,
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
  toolForKey,
  undo,
  type EditorState,
  type Tool,
} from '../../design/editor.ts'
import { formatStats } from '../../logic/readout.ts'
import type { Project } from '../../model/types.ts'
import { fitCell, zoomStep } from '../../render/design.ts'
import type { ProjectRepo } from '../../storage/repo.ts'
import { CellsIcon } from '../components.tsx'
import { ColoursPanel } from '../design/ColoursPanel.tsx'
import { DesignCanvas } from '../design/DesignCanvas.tsx'
import { useDocumentTitle } from '../hooks.ts'
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
  return target.closest('input, textarea, select, [role="dialog"], [role="alertdialog"]') !== null
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

function DesignStage({ repo, initial }: { repo: ProjectRepo; initial: Project }) {
  const [settings] = useSettings()
  const [editor, setEditor] = useState<EditorState>(() => initialEditor(initial.pattern))
  const latest = useRef(editor)
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState(() => progressWarning(initial.pattern, initial.progress))
  const p = editor.pattern
  useDocumentTitle(`${p.name} (design)`)

  // --- saving: automatic, as a Design-stage project, progress carried through untouched ----
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [saver] = useState(() => new AutoSaver<Project>((x) => repo.save({ ...x, stage: 'design' }), setStatus))
  const projectOf = useCallback(
    (s: EditorState): Project => ({ pattern: s.pattern, progress: initial.progress, stage: 'design' }),
    [initial.progress],
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

  // --- zoom: px per cell. Until zoomed (and after Fit) it follows the view's size. ----------
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [zoomed, setZoomed] = useState<number | null>(null)
  const fit = useMemo(
    () => (viewport ? fitCell(p.cols, p.rows, viewport.width, viewport.height) : null),
    [viewport, p.cols, p.rows],
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
  const preview = d?.tool === 'rect' ? { a: d.start, b: d.end, hex: p.palette[editor.colour]?.hex ?? '#000000' } : null
  const current = p.palette[editor.colour]

  return (
    <main className="screen design">
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
        <aside className="design__tools" aria-label="Tools">
          <h2 className="design__heading">Tools</h2>
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

          <h2 className="design__heading">Zoom</h2>
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
          </div>
          <p className="zoom__label muted" title={`${MOD} + scroll over the chart to zoom`}>
            {cell ?? '–'} px per cell
          </p>

          {current && (
            <div className="design__current">
              <span className="colour__swatch" style={{ background: current.hex }} aria-hidden="true" />
              <span>
                Painting with <strong>{current.name || 'Unnamed'}</strong>
              </span>
            </div>
          )}
        </aside>

        <section className="design__canvas" aria-label="Pattern">
          <DesignCanvas
              pattern={p}
              cell={cell ?? 16}
              tool={editor.tool}
              preview={preview}
              onDown={(c) => update((s) => pointerDown(s, c))}
              onMove={(c) => update((s) => pointerMove(s, c))}
              onUp={(c) => update((s) => pointerUp(s, c))}
              onCancel={() => update(cancelDrag)}
              onZoom={zoom}
              onViewport={setViewport}
              themeKey={settings.highContrast ? 'high' : 'normal'}
              label={`Pattern, ${p.cols} by ${p.rows}`}
            />
        </section>

        <aside className="design__side">
          <ColoursPanel
            palette={p.palette}
            current={editor.colour}
            onSelect={(i) => update((s) => selectColour(s, i))}
            onAdd={(hex) => update((s) => addColour(s, hex))}
            onRecolour={(i, hex) => update((s) => recolour(s, i, hex))}
            onRename={(i, name) => update((s) => renameColour(s, i, name))}
            onDelete={onDelete}
          />
        </aside>
      </div>

      <footer className="design__bar">
        <span className="design__stats">{formatStats(p.cols, p.rows, p.palette.length)}</span>
        <span className="design__message" role="status" aria-live="polite">
          {message}
        </span>
      </footer>
    </main>
  )
}
