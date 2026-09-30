/**
 * /design/:id, the Design stage (§6.2): a port of alphareader/ui/design/design_window.py.
 *
 * Dense and tool-oriented, for a desk and a mouse: tools on the left, the chart in the
 * middle, colours and the structural panel on the right, and the size underneath. No
 * progress is shown anywhere (§6.1), but it is kept, and carried through every edit
 * (logic/progress.ts): an edit that would lose rows marked done asks first.
 *
 * Every edit goes through design/editor.ts, which also keeps undo; each structural
 * edit is one undo step. The Select tool's selection lives there too; Copy and Cut keep
 * cells in this tab (`clipboard`), so they can be pasted into another pattern. Saving is automatic, as in the Work stage (app/autosave.ts),
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
  ADD_TOOLS,
  TOOLS,
  abortDrag,
  addColour,
  addLine,
  backgroundIndex,
  backgroundRemoved,
  canRedo,
  canUndo,
  cancelDrag,
  copySelection,
  croppedToSelection,
  deleteColour,
  deleteSelection,
  deselect,
  fillSelection,
  initialEditor,
  nudge,
  paste,
  pointerDown,
  pointerMove,
  pointerUp,
  editColour,
  putDown,
  redo,
  selectAll,
  selectColour,
  setTool,
  structural,
  toggleBackground,
  toolForKey,
  turnSelection,
  undo,
  type EditorState,
  type Tool,
} from '../../design/editor.ts'
import {
  MAX_BORDERED,
  borderPreview,
  removedCount,
  removesArtwork,
  shiftSides,
  sizeWith,
  tryBorder,
  type Preview,
  type Sides,
} from '../../design/structure.ts'
import { rectBetween, rectCols, rectRows, type CellRect, type Clip, type Turn } from '../../design/selection.ts'
import { endSize, formSides, initialForm, parseWhole, turnSides, withSides, type StructureForm } from '../../design/structureForm.ts'
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
  rotate90,
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
import { ConfirmDialog } from '../components.tsx'
import { ColoursPanel } from '../design/ColoursPanel.tsx'
import { DesignCanvas } from '../design/DesignCanvas.tsx'
import { ToolIcon, TurnIcon } from '../design/icons.tsx'
import { StructurePanel, type TransformAction } from '../design/StructurePanel.tsx'
import { Visualize } from '../design/Visualize.tsx'
import { YarnEstimate } from '../design/YarnEstimate.tsx'
import { useDocumentTitle, useMediaQuery } from '../hooks.ts'
import { ProjectGate } from '../ProjectGate.tsx'

export default function Design({ id }: { id: string }) {
  return <ProjectGate id={id}>{(repo, { project }) => <DesignStage repo={repo} initial={project} />}</ProjectGate>
}

/**
 * What Copy and Cut keep, for as long as this tab is open, whichever pattern is being
 * designed: kept here rather than on the system clipboard, which can't hold a pattern's
 * cells and colours (and asks for permission to be read). Pasting into another pattern
 * brings the colours with it (design/selection.ts `mapClip`).
 */
let clipboard: Clip | null = null

/** The Select tool's turns: what the whole-pattern ones do (the Structure panel), to the selection. */
const SELECTION_TURNS: readonly { turn: Turn; label: string; name: string; title: string }[] = [
  { turn: 'mirror', label: 'Mirror', name: 'Mirror left to right', title: 'Mirror it left to right' },
  { turn: 'flip', label: 'Flip', name: 'Flip top to bottom', title: 'Flip it top to bottom' },
  { turn: 'cw', label: 'Rotate', name: 'Rotate clockwise', title: 'Turn it a quarter clockwise' },
  { turn: 'ccw', label: 'Rotate', name: 'Rotate anticlockwise', title: 'Turn it a quarter anticlockwise' },
]

/** Keys that belong to whatever has focus, not to the Design stage. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"]') !== null
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const sizeOf = (p: Pattern) => `${p.cols} × ${p.rows}`
const cellsIn = (r: CellRect) => `${rectCols(r)} × ${rectRows(r)}`

/** What an edit about to lose progress says about it. `restart` names an edit that
 *  gives every row a new id (scale, rotate), so all progress starts again. */
function lossText(loss: ProgressLoss, restart?: 'Scaling' | 'Rotating'): string {
  const done = plural(loss.doneRows, 'row')
  if (restart) {
    const what = loss.doneRows ? `${done} done${loss.partRow ? ' and part of another' : ''}` : 'part of a row done'
    return `${restart} gives every row a new place, so your progress in the Work stage (${what}) starts again from the first row.`
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

/** Where the Add row or Add column tool is pointing: the new one goes before row (column)
 *  `at` of the pattern, or at the end. `added` is the pattern a click there made: while
 *  it is still the pattern, the row or column added is highlighted instead of previewing
 *  another. */
interface AddHover {
  kind: 'row' | 'col'
  at: number
  added: Pattern | null
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
  const [form, setForm] = useState<StructureForm>(initialForm)
  const borderIndex = useMemo(() => {
    const i = majorBorderIndex(p)
    return i < p.palette.length ? i : 0
  }, [p])
  const pick = (i: number | null) => (i !== null && i < p.palette.length ? i : borderIndex)
  const sides = formSides(form.border)
  const borderColour = pick(form.border.colour)
  const typed = form.border.size
  const sizeUnset = typed !== null && (parseWhole(typed.width) === null || parseWhole(typed.height) === null)
  const borderResult = useMemo(() => {
    if (form.open !== 'border') return null
    if (sizeUnset) return { error: 'Enter a width and a height.' }
    if (Object.values(sides).every((v) => v === 0)) return null
    const { width, height } = sizeWith(p, sides)
    if (width > MAX_BORDERED || height > MAX_BORDERED) return { error: `At most ${MAX_BORDERED} on a side.` }
    const r = tryBorder(p, sides, borderColour)
    return r instanceof EditError ? { error: r.message } : { cols: r.cols, rows: r.rows }
    // `sides` is rebuilt every render; its fields are what matter.
  }, [form.open, sizeUnset, p, sides.top, sides.right, sides.bottom, sides.left, borderColour]) // eslint-disable-line react-hooks/exhaustive-deps

  // A size being typed is kept over the sides it began from, for this pattern: when the
  // pattern changes shape, the fields show the size the sides give again. A quarter turn
  // (or undoing one) swaps width and height, and the sides turn with it.
  const [sizeSeen, setSizeSeen] = useState({ cols: p.cols, rows: p.rows })
  if (sizeSeen.cols !== p.cols || sizeSeen.rows !== p.rows) {
    const turned = sizeSeen.cols === p.rows && sizeSeen.rows === p.cols
    setSizeSeen({ cols: p.cols, rows: p.rows })
    setForm(turned ? turnSides : endSize)
  }

  // Dragging the pattern on the preview: the sides from when it was picked up, shifted.
  const dragFrom = useRef<Sides | null>(null)
  const onShift = (delta: { dr: number; dc: number } | null) => {
    if (!delta) {
      dragFrom.current = null
      return
    }
    dragFrom.current ??= sides
    const to = shiftSides(dragFrom.current, delta.dr, delta.dc)
    setForm((f) => {
      const now = formSides(f.border)
      return now.top === to.top && now.left === to.left && now.bottom === to.bottom && now.right === to.right ? f : withSides(f, to)
    })
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
    opts: { title?: string; confirmLabel?: string; artwork?: string; restart?: 'Scaling' | 'Rotating'; after?: () => void } = {},
  ) => {
    if (samePattern(p, next)) return
    const loss = progressLoss(p, carried, next)
    const reasons = [opts.artwork, losesProgress(loss) ? lossText(loss, opts.restart) : ''].filter(Boolean)
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

  const onScale = () =>
    guarded(() => {
      const next = scale(p, form.scale)
      attempt(next, `Scaled ×${form.scale}: now ${sizeOf(next)}.`, { restart: 'Scaling', title: 'Start progress again?', confirmLabel: 'Scale' })
    })

  const transforms: TransformAction[] = [
    { label: 'Mirror', name: 'Mirror left to right', turn: 'mirror', title: 'Mirror left to right', run: () => attempt(mirrorH(p), 'Mirrored left to right.') },
    { label: 'Flip', name: 'Flip top to bottom', turn: 'flip', title: 'Flip top to bottom', run: () => attempt(mirrorV(p), 'Flipped top to bottom.') },
    {
      label: 'Rotate 90°',
      name: 'Rotate 90° clockwise',
      turn: 'cw',
      title: 'Rotate a quarter turn clockwise: rows become columns',
      run: () => {
        const next = rotate90(p, true)
        attempt(next, `Rotated 90° clockwise: now ${sizeOf(next)}.`, { restart: 'Rotating', title: 'Start progress again?', confirmLabel: 'Rotate' })
      },
    },
    {
      label: 'Rotate 90°',
      name: 'Rotate 90° anticlockwise',
      turn: 'ccw',
      title: 'Rotate a quarter turn anticlockwise: rows become columns',
      run: () => {
        const next = rotate90(p, false)
        attempt(next, `Rotated 90° anticlockwise: now ${sizeOf(next)}.`, { restart: 'Rotating', title: 'Start progress again?', confirmLabel: 'Rotate' })
      },
    },
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
  const onAxis = (kind: 'row' | 'col', index: number, at: { x: number; y: number }) => setAxisMenu({ pattern: p, kind, index, ...at })

  // --- Add row and Add column: previewed where the pointer is, added with a click ----------------
  const [addHover, setAddHover] = useState<AddHover | null>(null)
  const onInsertHover = (at: number | null) => {
    const kind = ADD_TOOLS[latest.current.tool]
    setAddHover((h) => (at === null || !kind ? null : h?.kind === kind && h.at === at ? h : { kind, at, added: null }))
  }
  const onInsert = (at: number) => {
    const kind = ADD_TOOLS[latest.current.tool]
    if (!kind) return
    update((s) => addLine(s, kind, at))
    const next = latest.current.pattern
    setAddHover({ kind, at, added: next })
    setMessage(kind === 'row' ? `Added row ${workingNumber(next, at)}: now ${sizeOf(next)}.` : `Added column ${at + 1}: now ${sizeOf(next)}.`)
  }
  const chooseTool = useCallback(
    (tool: Tool) => {
      update((s) => setTool(s, tool))
      const kind = ADD_TOOLS[tool]
      if (kind) {
        const one = kind === 'row' ? 'row' : 'column'
        setMessage(`Point at the chart where the new ${one} goes, and click to add it. To delete a ${one}, press its number.`)
      } else if (tool === 'select') {
        setMessage('Drag over the chart to select cells, then drag inside the selection to move them.')
      }
    },
    [update],
  )

  // --- the Select tool: the selection's buttons, which its shortcuts share -----------------------
  const [clip, setClip] = useState(clipboard)
  const onSelectUp = (c: { r: number; c: number } | null) => {
    const d = latest.current.drag
    update((s) => pointerUp(s, c))
    const sel = latest.current.selection
    if (d?.tool === 'select' && sel) setMessage(`Selected ${cellsIn(sel.rect)} cells. Drag inside them to move them.`)
    else if (d?.tool === 'select') setMessage('')
  }
  const onCopy = () => {
    const c = copySelection(latest.current)
    if (!c) return null
    clipboard = c
    setClip(c)
    setMessage(`Copied ${c.block.cols} × ${c.block.rows} cells.`)
    return c
  }
  const onCut = () => {
    const c = onCopy()
    if (!c) return
    const bg = latest.current.pattern.palette[backgroundIndex(latest.current.pattern)]
    update(deleteSelection)
    setMessage(`Cut ${c.block.cols} × ${c.block.rows} cells, leaving “${bg?.name || 'the background'}”.`)
  }
  const onPaste = () => {
    const c = clipboard
    if (!c) return
    const before = latest.current.pattern.palette.length
    update((s) => paste(s, c))
    const added = latest.current.pattern.palette.length - before
    setMessage(
      `Pasted ${c.block.cols} × ${c.block.rows} cells${added ? `, adding ${plural(added, 'colour')}` : ''}. Drag them into place, then click outside them.`,
    )
  }
  const onEmpty = () => {
    const bg = latest.current.pattern.palette[backgroundIndex(latest.current.pattern)]
    const floating = !!latest.current.selection?.floating
    update(deleteSelection)
    setMessage(floating ? 'Took the selection away.' : `Emptied the selection to “${bg?.name || 'the background'}”.`)
  }
  const onTurn = (how: Turn) => update((s) => turnSelection(s, how))
  const onBackground = () => {
    update(toggleBackground)
    const clear = latest.current.selection?.floating?.clear
    const n = clear ? clear.reduce((a, v) => a + v, 0) : 0
    setMessage(clear ? `Removed the background: ${plural(n, 'cell')} now show what is under them. Drag it into place.` : 'Put the background back.')
  }
  const onCrop = () =>
    guarded(() => {
      const next = croppedToSelection(latest.current)
      if (next) attempt(next, `Cropped to the selection: now ${sizeOf(next)}.`, { title: 'Crop away rows you’ve worked?', confirmLabel: 'Crop' })
    })
  const onSelectAll = () => {
    update(selectAll)
    setMessage(`Selected the whole pattern, ${sizeOf(latest.current.pattern)}.`)
  }
  // On a tablet the selection's buttons lie over the bottom of the chart: it scrolls that
  // much further, so nothing stays hidden under them.
  const [barHeight, setBarHeight] = useState(0)
  const bar = useRef<ResizeObserver | null>(null)
  const measureBar = useCallback((el: HTMLDivElement | null) => {
    bar.current?.disconnect()
    bar.current = null
    if (!el) return setBarHeight(0)
    const measure = () => setBarHeight(el.offsetHeight)
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      bar.current = new ResizeObserver(measure)
      bar.current.observe(el)
    }
  }, [])
  /** The selection's keys, for the keyboard handler attached once. */
  const selectionKeys = useRef({ onCopy, onCut, onPaste, onEmpty, onSelectAll })
  useEffect(() => {
    selectionKeys.current = { onCopy, onCut, onPaste, onEmpty, onSelectAll }
  })

  // --- zoom: px per cell. Until zoomed (and after Fit) it follows the view's size. ----------
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [zoomed, setZoomed] = useState<number | null>(null)

  // --- the screen: desktop, tablet (a toolbar and drawers), or too small ------------------------
  const compact = useMediaQuery('(max-width: 1099.98px)')
  const tooSmall = useMediaQuery('(max-width: 699.98px)')
  const [drawer, setDrawer] = useState<'colours' | 'structure' | null>(null)
  /** "Yarn & size" or "Visualize" is open, for the pattern as it is now. */
  const [dialog, setDialog] = useState<'yarn' | 'visualize' | null>(null)
  const hidden = useRef(tooSmall)
  useEffect(() => {
    hidden.current = tooSmall
  }, [tooSmall])

  // A border is previewed while its section is open and in view (on a tablet, while the
  // structure drawer is), unless its size is unset or past the limit.
  const previewing = form.open !== null && (!compact || drawer === 'structure') ? form.open : null
  const tooBig = Math.max(sizeWith(p, sides).width, sizeWith(p, sides).height) > MAX_BORDERED
  const preview: Preview | null = useMemo(() => {
    if (previewing !== 'border' || sizeUnset || tooBig) return null
    return borderPreview(p, sides, borderColour)
  }, [previewing, sizeUnset, tooBig, p, sides.top, sides.right, sides.bottom, sides.left, borderColour]) // eslint-disable-line react-hooks/exhaustive-deps
  // The row or column the Add tool would add, shown in place, in the colour it will be.
  // It doesn't change the fit: the zoom would jump under the pointer as it moved.
  const addKind = ADD_TOOLS[editor.tool]
  const adding =
    !preview && addKind && addHover?.kind === addKind && addHover.at <= (addKind === 'row' ? p.rows : p.cols) ? addHover : null
  const justAdded = adding?.added === p
  const addPreview = useMemo(
    () =>
      adding && !justAdded
        ? adding.kind === 'row'
          ? insertRow(p, adding.at, editor.colour)
          : insertColumn(p, adding.at, editor.colour)
        : null,
    [adding?.kind, adding?.at, justAdded, p, editor.colour], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const fitted = preview?.pattern ?? p
  // A colour being chosen in its menu, shown on the chart before it is saved.
  const [colourPreview, setColourPreview] = useState<{ id: string; hex: string } | null>(null)
  const shownBase = preview?.pattern ?? addPreview ?? p
  const shownPattern = useMemo(
    () =>
      colourPreview && shownBase.palette.some((e) => e.id === colourPreview.id)
        ? { ...shownBase, palette: shownBase.palette.map((e) => (e.id === colourPreview.id ? { ...e, hex: colourPreview.hex } : e)) }
        : shownBase,
    [shownBase, colourPreview],
  )
  const fit = useMemo(
    () => (viewport ? fitCell(fitted.cols, fitted.rows, viewport.width, viewport.height) : null),
    [viewport, fitted.cols, fitted.rows],
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
      const keys = selectionKeys.current
      const selected = latest.current.selection !== null
      if (mod && !e.altKey) {
        if (key === 'z') {
          e.preventDefault()
          update(e.shiftKey ? redo : undo)
        } else if (key === 'y') {
          e.preventDefault()
          update(redo)
        } else if ((key === 'c' || key === 'x') && selected && !e.shiftKey) {
          e.preventDefault()
          if (key === 'c') keys.onCopy()
          else keys.onCut()
        } else if (key === 'v' && clipboard && !e.shiftKey) {
          e.preventDefault()
          keys.onPaste()
        } else if (key === 'a' && !e.shiftKey) {
          e.preventDefault()
          keys.onSelectAll()
        }
        return
      }
      if (e.altKey) return
      if (e.key === 'Escape') {
        update(latest.current.drag ? cancelDrag : deselect)
        return
      }
      if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        keys.onEmpty()
        return
      }
      if (selected && e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        update(putDown)
        return
      }
      const arrow = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
      if (arrow) {
        if (!selected || latest.current.drag) return
        e.preventDefault()
        update((s) => nudge(s, arrow[0]!, arrow[1]!))
        return
      }
      if (e.key === '+' || e.key === '=') zoom(1)
      else if (e.key === '-' || e.key === '_') zoom(-1)
      else {
        const tool = toolForKey(e.key, e.shiftKey)
        if (!tool) return
        chooseTool(tool)
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saver, update, zoom, chooseTool])

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
  // As shown: a colour being chosen in its menu shows in "Painting with" too.
  const current = shownPattern.palette[editor.colour] ?? p.palette[editor.colour]
  const line = (kind: 'row' | 'col', i: number, q: Pattern) =>
    kind === 'row' ? { r0: i, r1: i + 1, c0: 0, c1: q.cols } : { r0: 0, r1: q.rows, c0: i, c1: i + 1 }
  const overlay: Overlay | null = preview
    ? { removed: preview.removed, outline: preview.outline }
    : axisMenu
      ? { highlight: line(axisMenu.kind, axisMenu.index, p) }
      : adding
        ? justAdded
          ? { highlight: line(adding.kind, adding.at, p) }
          : { outline: line(adding.kind, adding.at, shownPattern) }
        : null
  const mode = preview ? (preview.outline ? 'move' : 'view') : 'edit'
  // The selection being dragged out, or the one there is.
  const selection = d?.tool === 'select' ? rectBetween(d.start, d.end) : (editor.selection?.rect ?? null)
  const withSelection: Overlay | null = overlay ?? (selection && editor.tool === 'select' ? { selection } : null)

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
          aria-keyshortcuts={t.shift ? `Shift+${t.key}` : t.key}
          title={`${t.label} (${t.shift ? '⇧' : ''}${t.key})`}
          onClick={() => chooseTool(t.tool)}
        >
          <ToolIcon tool={t.tool} />
          <span className="tool__label">{t.label}</span>
          <kbd className="tool__key">
            {t.shift ? '⇧' : ''}
            {t.key}
          </kbd>
        </button>
      ))}
    </div>
  )
  const sel = editor.selection
  const bg = p.palette[backgroundIndex(p)]
  const selectionTools = editor.tool === 'select' && (
    <div className="selection-tools" role="group" aria-label="Selection">
      <button type="button" className="button button--small" disabled={!sel} title={`Copy (${MOD}C)`} onClick={onCopy}>
        Copy
      </button>
      <button type="button" className="button button--small" disabled={!sel} title={`Cut (${MOD}X)`} onClick={onCut}>
        Cut
      </button>
      <button
        type="button"
        className="button button--small"
        disabled={!clip}
        title={clip ? `Paste ${clip.block.cols} × ${clip.block.rows} cells (${MOD}V)` : 'Copy or cut cells first'}
        onClick={onPaste}
      >
        Paste
      </button>
      <button
        type="button"
        className="button button--small"
        disabled={!sel}
        title={`Empty it to “${bg?.name || 'the background'}”, the colour most of the edge is (Delete)`}
        onClick={onEmpty}
      >
        Delete
      </button>
      {SELECTION_TURNS.map((t) => (
        <button
          key={t.turn}
          type="button"
          className="button button--small"
          disabled={!sel}
          aria-label={t.name}
          title={t.title}
          onClick={() => onTurn(t.turn)}
        >
          <TurnIcon turn={t.turn} />
          {t.label}
        </button>
      ))}
      <button
        type="button"
        className="button button--small selection-tools__wide"
        disabled={!sel}
        aria-pressed={backgroundRemoved(editor)}
        title={
          backgroundRemoved(editor)
            ? 'Put its background cells back'
            : 'Make its background see-through, so only the motif moves: the colour most of its edge is, where it touches the edge'
        }
        onClick={onBackground}
      >
        {backgroundRemoved(editor) ? 'Put background back' : 'Remove background'}
      </button>
      <button
        type="button"
        className="button button--small selection-tools__wide"
        disabled={!sel}
        title="Fill it with the colour you’re painting with"
        onClick={() => update(fillSelection)}
      >
        Fill with “{current?.name || 'Unnamed'}”
      </button>
      <button
        type="button"
        className="button button--small selection-tools__wide"
        disabled={!sel}
        title="Keep only the selected cells"
        onClick={onCrop}
      >
        Crop to selection
      </button>
      <button type="button" className="button button--small" title={`Select the whole pattern (${MOD}A)`} onClick={onSelectAll}>
        Select all
      </button>
      <button type="button" className="button button--small" disabled={!sel} title="Put it down and stop selecting it (Esc)" onClick={() => update(deselect)}>
        Deselect
      </button>
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
      onAdd={(hex, name) => update((s) => addColour(s, hex, name))}
      onEdit={(i, hex, name) => update((s) => editColour(s, i, hex, name))}
      onDelete={onDelete}
      onPreview={setColourPreview}
    />
  )
  const structure = (
    <StructurePanel
      pattern={p}
      form={form}
      onForm={setForm}
      borderIndex={borderIndex}
      borderResult={borderResult}
      onBorder={onBorder}
      onScale={onScale}
      transforms={transforms}
    />
  )

  // A phone: the Design stage is desktop-first and doesn't fit
  // (docs/dev/history/web-port.md#phase-3). This screen keeps its state (the pattern,
  // undo) meanwhile, so turning a device round and back loses nothing.
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
          className="button button--small"
          title="How big it comes out, and how much yarn of each colour to buy"
          onClick={() => setDialog('yarn')}
        >
          Yarn &amp; size
        </button>
        <button
          type="button"
          className="button button--small"
          title="See the pattern as crocheted fabric, in the stitch you choose"
          onClick={() => setDialog('visualize')}
        >
          Visualize
        </button>
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
            {selectionTools && (
              <>
                <h2 className="design__heading">Selection</h2>
                {selectionTools}
              </>
            )}
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
            overlay={withSelection}
            selection={editor.tool === 'select' ? (sel?.rect ?? null) : null}
            roomBelow={compact && editor.tool === 'select' ? barHeight : 0}
            onDown={(c) => update((s) => pointerDown(s, c))}
            onMove={(c) => update((s) => pointerMove(s, c))}
            onUp={onSelectUp}
            onCancel={() => update(cancelDrag)}
            onAbort={() => update(abortDrag)}
            onShift={onShift}
            onAxis={onAxis}
            base={addPreview ? { rows: p.rows, cols: p.cols } : undefined}
            onInsertHover={onInsertHover}
            onInsert={onInsert}
            onZoom={zoom}
            onZoomTo={setZoomed}
            onViewport={setViewport}
            themeKey={settings.highContrast ? 'high' : 'normal'}
            label={
              preview
                ? `Preview, ${shownPattern.cols} by ${shownPattern.rows}`
                : `Pattern, ${p.cols} by ${p.rows}${sel && editor.tool === 'select' ? `, ${rectCols(sel.rect)} by ${rectRows(sel.rect)} selected` : ''}`
            }
          />
          {compact && selectionTools && (
            <div ref={measureBar} className="design__selection-bar">
              {selectionTools}
            </div>
          )}
          {preview && (
            <p className="design__previewing" role="status">
              Previewing: drag the pattern to move it.
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

      {dialog === 'yarn' && <YarnEstimate name={p.name} pattern={p} onClose={() => setDialog(null)} />}
      {dialog === 'visualize' && <Visualize pattern={p} onClose={() => setDialog(null)} />}

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
 * number, rather than through a selection: most tools act on a press, the numbers are
 * already there to aim at, and it works the same with a finger. Escape, or a press
 * outside, closes it.
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
