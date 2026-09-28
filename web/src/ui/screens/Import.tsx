/**
 * Importing a pattern from an image: a port of the desktop's confirmation window
 * (alphareader/ui/importer/confirm_window.py), correction controls and all.
 *
 * The desktop's fast/slow split is kept (docs/web-port-plan.md, Phase 2):
 * - moving the grid's outline only resamples (`DetectSession.update`),
 *   which folds a burst of changes into one pending request and drops stale answers;
 * - a box drawn on the image (a crop) detects again (`DetectSession.redetect`), under
 *   the client's watchdog, and so does "Reset to detected grid", which detects the whole
 *   image again: the desktop's Re-detect, undoing a box and a moved outline alike.
 * While an answer is on its way the last good preview stays up, dimmed after ~200 ms.
 *
 * Layout (import.css): the name, "Yarn & size" and "Save & edit pattern" head the screen. Below, the
 * image and the pattern each sit on a stage of the same size, shaped like the image, so
 * the two line up whatever the pattern's own shape; the colours are a sidebar beside
 * them, dropping below them on a medium screen, and on a small one the stages stack. On a
 * wide screen the whole of it fits the window: the stages as big as the room left allows,
 * and the colour list scrolling on its own.
 *
 * Loaded lazily (App.tsx), and the only screen that starts the detection worker. Leaving
 * it terminates the worker (App.tsx), which frees Pyodide's memory.
 */
import '../import.css'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { downloadBytes } from 'virtual:detect-assets'

import { useRepo } from '../../app/context.ts'
import { loadDetection } from '../../app/detection.ts'
import { pendingImage, timestampName, type PendingImage } from '../../app/pendingImage.ts'
import { navigate, paths } from '../../app/router.ts'
import type { DetectSession } from '../../detect/client.ts'
import {
  isDetectionError,
  type BootProgress,
  type BootStage,
  type Crop,
  type DetectionErrorCode,
  type Outcome,
  type Params,
  type Preview,
} from '../../detect/protocol.ts'
import { shrinkNotice } from '../../importer/controls.ts'
import { decodeImage, ImageDecodeError, sourcePng } from '../../importer/decode.ts'
import { hintFor, OUT_OF_MEMORY_HINT, TIMEOUT_HINT } from '../../importer/hints.ts'
import type { Grid } from '../../importer/outline.ts'
import { applyRemovals, mergeCandidate, type Removal } from '../../importer/removals.ts'
import { emptyProgress } from '../../model/types.ts'
import { DropOverlay, ImportButton, Notices, TopBar } from '../components.tsx'
import { useDelayedFlag, useDocumentTitle, useFileDrop, useMediaQuery, usePastedImage } from '../hooks.ts'
import { Palette } from '../import/Palette.tsx'
import { PatternView } from '../import/PatternView.tsx'
import { SourceView } from '../import/SourceView.tsx'
import { Visualize } from '../import/Visualize.tsx'
import { YarnEstimate } from '../import/YarnEstimate.tsx'
import { cleanName, MAX_NAME_LENGTH } from '../names.ts'
import { isChartImage, type Notice } from '../useAlphaImport.ts'

export type ImportState =
  | { phase: 'choose' }
  | { phase: 'decoding' }
  | { phase: 'booting'; progress: BootProgress | null }
  | { phase: 'detecting' }
  | { phase: 'result'; preview: Preview }
  /** Detection found no chart; the session is open, so a box drawn on the image can retry. */
  | { phase: 'failed'; code: DetectionErrorCode }
  /** The worker was terminated: the watchdog stopped it, or its memory ran out. */
  | { phase: 'stopped'; code: 'TIMEOUT' | 'OUT_OF_MEMORY' }
  | { phase: 'error'; message: string }

/** One run of decode → boot → open. A retry after a timeout may detect just a crop. */
interface Run {
  attempt: number
  crop?: Crop
}

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'
/** From this width the colours sit beside the pattern (import.css); narrower, they're
 *  below it, so the pattern says which colour it is showing, with a way to stop. */
const SIDEBAR = '(min-width: 1100px)'
/** How long an update may take before the preview is dimmed. */
const DIM_AFTER_MS = 200

const STAGE_TEXT: Record<BootStage, string> = {
  runtime: 'Downloading Python',
  numpy: 'Downloading numpy',
  core: 'Loading the pattern reader',
}

const megabytes = (n: number) => Math.max(1, Math.round(n / 1_000_000))

export default function ImportScreen() {
  useDocumentTitle('Import pattern')
  const repoState = useRepo()
  const repo = repoState.status === 'ready' ? repoState.repo : null
  const sidebar = useMediaQuery(SIDEBAR, true)
  const ids = useId()

  const [image, setImage] = useState<PendingImage | null>(pendingImage)
  const [state, setState] = useState<ImportState>(image ? { phase: 'decoding' } : { phase: 'choose' })
  /** The name typed; left empty, the pattern is named when saved (`timestampName`). Kept
   *  when the image is replaced: it was typed for the pattern, not the file. */
  const [name, setName] = useState('')
  const [notices, setNotices] = useState<Notice[]>(image?.notices ?? [])
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState<Run>({ attempt: 0 })
  /** The image's decoded size: the coordinate space of the overlay and of crops. */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  /** The outline last asked for, drawn until the answers to it are in. */
  const [outline, setOutline] = useState<Grid | null>(null)

  /** The latest preview, kept through a re-detection and a failure. */
  const [shown, setShown] = useState<Preview | null>(null)
  const [updating, setUpdating] = useState(0)
  const [redetecting, setRedetecting] = useState(false)
  /** Whether the grid differs from what detecting the whole image found (a box drawn, or
   *  the outline moved): what "Reset to detected grid" undoes. */
  const [adjusted, setAdjusted] = useState(false)
  const dim = useDelayedFlag(updating > 0 || redetecting, DIM_AFTER_MS)

  /** Colours removed before saving, in order (importer/removals.ts). */
  const [removals, setRemovals] = useState<Removal[]>([])
  /** The colour pointed at, and the one kept showing, in the colour list: by hex. */
  const [pointed, setPointed] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  /** "Yarn & size" is open. */
  const [estimating, setEstimating] = useState(false)
  /** "Visualize" is open. */
  const [visualizing, setVisualizing] = useState(false)

  const session = useRef<DetectSession | null>(null)
  /** Updates asked for and not yet answered. */
  const pending = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const choose = useCallback((file: File) => {
    setImage({ file })
    setNotices([])
    setShown(null)
    setSize(null)
    setRun({ attempt: 0 })
    setAdjusted(false)
    setRemovals([])
    setPointed(null)
    setPinned(null)
  }, [])

  const onFiles = useCallback(
    (files: File[]) => {
      const file = files.find(isChartImage)
      if (file) choose(file)
      else if (files.length) setNotices([{ tone: 'error', text: 'Choose a PNG, JPEG or WebP image of a chart.' }])
    },
    [choose],
  )
  const drop = useFileDrop(onFiles)
  usePastedImage(choose)

  /** Show what a detection (open or redetect) found. */
  const detected = useCallback((result: Outcome<Preview>) => {
    if (result.ok) {
      setShown(result)
      setState({ phase: 'result', preview: result })
    } else if (isDetectionError(result.code)) {
      setShown(null)
      setState({ phase: 'failed', code: result.code })
    } else if (result.code === 'TIMEOUT' || result.code === 'OUT_OF_MEMORY') {
      session.current = null
      setShown(null)
      setState({ phase: 'stopped', code: result.code })
    } else if (result.code !== 'STALE') {
      setState({ phase: 'error', message: `Detection stopped unexpectedly. (${result.code}: ${result.message})` })
    }
  }, [])

  // Decode, boot Pyodide, detect. Runs again for a new image or a retry.
  useEffect(() => {
    if (!image) return // the state starts as 'choose', and an image is never taken away
    let live = true
    let opened: DetectSession | null = null
    let unsubscribe = () => {}
    const go = async () => {
      setState({ phase: 'decoding' })
      const pixels = await decodeImage(image.file)
      if (!live) return
      setSize({ width: pixels.width, height: pixels.height })
      const { detector } = await loadDetection()
      if (!live) return
      const client = detector()
      setState({ phase: 'booting', progress: client.progress })
      unsubscribe = client.onProgress((progress) => live && setState((s) => (s.phase === 'booting' ? { ...s, progress } : s)))
      const booted = await client.boot()
      unsubscribe()
      if (!live) return
      if (!booted.ok) {
        setState({ phase: 'error', message: `The pattern reader couldn't be loaded. Check your connection and try again. (${booted.message})` })
        return
      }
      setState({ phase: 'detecting' })
      const { session: s, result } = await client.open(pixels, run.crop ? { crop: run.crop } : {})
      opened = s
      if (!live) {
        void s?.close()
        return
      }
      session.current = s
      detected(result)
    }
    go().catch((e: unknown) => {
      if (!live) return
      setState({
        phase: 'error',
        message: e instanceof ImageDecodeError ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`,
      })
    })
    return () => {
      live = false
      unsubscribe()
      void opened?.close()
      session.current = null
    }
  }, [image, run, detected])

  // --- the fast path: resample ----------------------------------------------------------

  const update = (params: Params) => {
    const s = session.current
    if (!s || state.phase !== 'result') return
    setUpdating((n) => n + 1)
    pending.current += 1
    void s.update(params).then((r) => {
      if (!mounted.current) return
      setUpdating((n) => n - 1)
      // Once every answer is in, the preview shows what was asked for (or what was kept).
      if (--pending.current === 0) setOutline(null)
      if (session.current !== s) return // a new image or a retry since
      if (r.ok) {
        setShown(r)
        setState((st) => (st.phase === 'result' ? { phase: 'result', preview: r } : st))
      } else if (r.code === 'TIMEOUT' || r.code === 'OUT_OF_MEMORY' || r.code === 'WORKER_GONE') detected(r)
      else if (r.code !== 'STALE') setNotices([{ tone: 'error', text: `Couldn't update the preview: ${r.message}` }])
    })
  }

  /** The outline moved: resample the new extent into its rows and columns. */
  const onResize = (grid: Grid) => {
    setOutline(grid)
    setAdjusted(true)
    update({ extent: grid.extent, rows: grid.rows, cols: grid.cols })
  }

  // --- the slow path: detect again ------------------------------------------------------

  /** Detect again inside a box drawn on the image, or, with none, in the whole image. */
  const redetect = (crop?: Crop) => {
    setAdjusted(crop !== undefined)
    const s = session.current
    if (!s) {
      // Nothing to detect again in: the worker was stopped (the watchdog, or memory ran
      // out). Start over, with the box if there is one.
      setRun((r) => ({ attempt: r.attempt + 1, ...(crop ? { crop } : {}) }))
      return
    }
    setRedetecting(true)
    void s.redetect(crop).then((r) => {
      if (!mounted.current) return
      setRedetecting(false)
      if (session.current === s) detected(r)
    })
  }

  // --- saving ---------------------------------------------------------------------------

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const s = session.current
    if (!repo || !s || !image || saving || state.phase !== 'result' || redetecting) return
    setSaving(true)
    try {
      await s.idle() // a change still on its way is part of what's saved
      const committed = await s.commit(cleanName(name) ?? timestampName())
      if (!committed.ok) throw new Error(committed.message)
      // The colours removed here, as they were on the preview it was built from.
      const pattern = applyRemovals(committed.pattern, removals, tolerance(state.preview)).result
      const png = await sourcePng(image.file)
      // A fresh detection opens in the Design stage (§7.3), to be cleaned up before it is
      // worked. (The desktop opened Work; part 1 of Phase 3 did too.)
      const saved = await repo.save({ pattern, progress: emptyProgress(), stage: 'design' }, { sourcePng: png })
      navigate(paths.design(saved.pattern.id))
    } catch (err) {
      setSaving(false)
      setNotices([{ tone: 'error', text: `Couldn't save the pattern: ${err instanceof Error ? err.message : String(err)}` }])
    }
  }

  // The preview as shown: detection's answer with the colours removed here.
  const raw = shown ?? (state.phase === 'result' ? state.preview : null)
  const { result: display, applied } = useMemo(
    () => (raw ? applyRemovals(raw, removals, tolerance(raw)) : { result: null, applied: [] }),
    [raw, removals],
  )
  // The colours taken away by their own ×, each with Restore; merges are undone by the
  // colour count's + instead.
  const removed = removals.flatMap((removal, index) => (applied[index] && !removal.merged ? [{ removal, index }] : []))
  /** The merge the count's + undoes: the last one that took a colour away here. */
  const lastMerge = removals.findLastIndex((r, i) => r.merged && applied[i])
  const fewer = () => {
    const drop = display && mergeCandidate(display.palette)
    if (!drop) return
    setRemovals((r) => [...r, { hex: drop.hex, name: drop.name, merged: true }])
    setPointed(null)
    if (pinned === drop.hex) setPinned(null)
  }
  const more = () => setRemovals((r) => r.filter((_, i) => i !== lastMerge))
  const spotHex = pointed ?? pinned
  const spotIndex = display && spotHex !== null ? display.palette.findIndex((e) => e.hex === spotHex) : -1
  const spotlight = spotIndex >= 0 ? spotIndex : null

  const another = (label: string, className = 'button') => (
    <ImportButton className={className} onFiles={onFiles} accept={IMAGE_ACCEPT} multiple={false} label="Choose a chart image">
      {label}
    </ImportButton>
  )

  if (state.phase === 'choose' || !image) {
    return (
      <main className="screen import" {...drop.handlers}>
        <TopBar title="Import pattern" />
        <Notices notices={notices} />
        <div className="empty import__choose">
          <p>Choose a photo or screenshot of an alpha chart.</p>
          {another('Choose image…', 'button button--primary')}
          <p className="muted">PNG, JPEG or WebP. You can also drop an image here, or paste one.</p>
        </div>
        <DropOverlay show={drop.over} text="Drop a chart image to import it" />
      </main>
    )
  }

  const hasGrid = state.phase === 'result'
  const loading = state.phase === 'decoding' || state.phase === 'booting' || state.phase === 'detecting'
  const canDetect = !loading && !redetecting && state.phase !== 'error' && size !== null
  const preview = state.phase === 'result' ? display : null
  const grid = hasGrid && shown ? (outline ?? { extent: shown.extent, rows: shown.rows, cols: shown.cols }) : null
  // Both stages take the image's shape (import.css); the aspect as a number too, to size
  // them from the height left on a wide screen.
  const stageShape = (size ? { '--source-ratio': `${size.width} / ${size.height}`, '--source-aspect': size.width / size.height } : {}) as CSSProperties
  const heading = (id: string, label: string, count?: number) => (
    <h2 id={`${ids}-${id}`} className="confirm__caption" {...countLabel(label, count)}>
      {label}
    </h2>
  )
  const colours = display && hasGrid ? display.palette.length : undefined

  return (
    <main className="screen import" {...drop.handlers}>
      <TopBar title="Import pattern" />
      <SaveBar
        name={name}
        onName={setName}
        disabled={saving || !repo || !hasGrid || redetecting}
        onSubmit={save}
        onEstimate={hasGrid && display ? () => setEstimating(true) : null}
        onVisualize={hasGrid && display ? () => setVisualizing(true) : null}
      />
      <Notices notices={notices} />
      <div className="confirm" data-dim={dim || undefined} style={stageShape}>
        {preview && <Summary preview={preview} />}
        <div className="confirm__grid">
          <section className="confirm__col confirm__col--image" aria-labelledby={`${ids}-image`}>
            <div className="confirm__head">
              {heading('image', 'Your image')}
              {another('Replace image', 'button button--ghost')}
            </div>
            {size ? (
              <SourceView
                file={image.file}
                width={size.width}
                height={size.height}
                grid={grid}
                canCrop={canDetect}
                canResize={hasGrid && !redetecting}
                onCrop={(crop) => redetect(crop)}
                onResize={onResize}
              />
            ) : (
              <Stage>
                <p className="muted">Reading the image…</p>
              </Stage>
            )}
            <div className="confirm__below">
              <button type="button" className="button" disabled={!adjusted || !canDetect} onClick={() => redetect()}>
                Reset to detected grid
              </button>
              {!grid && canDetect && <p className="confirm__note confirm__hint">Drag a box around just the squares, then let go.</p>}
            </div>
          </section>

          <section className="confirm__col confirm__col--pattern" aria-labelledby={`${ids}-pattern`}>
            <div className="confirm__head">{heading('pattern', 'Pattern')}</div>
            <div className="confirm__outcome" aria-live="polite" aria-busy={loading || redetecting}>
              <Outcome
                state={state}
                shown={display}
                spotlight={spotlight}
                {...(pinned !== null && spotlight !== null && !sidebar ? { onShowAll: () => setPinned(null) } : {})}
                redetecting={redetecting}
                onRetry={() => {
                  setAdjusted(false)
                  setRun((r) => ({ attempt: r.attempt + 1 }))
                }}
                another={another}
              />
            </div>
          </section>

          <section className="confirm__col confirm__col--colours" aria-labelledby={`${ids}-colours`}>
            <div className="confirm__head">
              {heading('colours', 'Colours', colours)}
              {colours !== undefined && (
                <ColourCount n={colours} onFewer={fewer} onMore={more} canFewer={colours > 1 && !redetecting} canMore={lastMerge >= 0 && !redetecting} />
              )}
            </div>
            {display && hasGrid ? (
              <Palette
                palette={display.palette}
                shown={spotlight === null ? null : spotHex}
                pinned={pinned}
                onPoint={setPointed}
                onPin={setPinned}
                onRemove={(e) => {
                  setRemovals((r) => [...r, { hex: e.hex, name: e.name }])
                  setPointed(null)
                  if (pinned === e.hex) setPinned(null)
                }}
                removed={removed}
                onRestore={(index) => setRemovals((r) => r.filter((_, i) => i !== index))}
              />
            ) : (
              <p className="confirm__note">The colours appear once the grid is found.</p>
            )}
          </section>
        </div>
      </div>
      {estimating && hasGrid && display && (
        <YarnEstimate name={cleanName(name) ?? 'Untitled pattern'} pattern={display} onClose={() => setEstimating(false)} />
      )}
      {visualizing && hasGrid && display && <Visualize pattern={display} onClose={() => setVisualizing(false)} />}
      <DropOverlay show={drop.over} text="Drop a chart image to import it" />
    </main>
  )
}

/** How close a colour must be to one removed to be taken for it, in a new preview: half
 *  the merge threshold, so no two of its colours can both be (importer/removals.ts). */
const tolerance = (p: { deltaE: number }) => p.deltaE / 2

/** How many colours, beside the colour list's heading, with − and + to change it: − merges
 *  the two most alike (removals.mergeCandidate), + undoes the last merge. */
function ColourCount({
  n,
  onFewer,
  onMore,
  canFewer,
  canMore,
}: {
  n: number
  onFewer: () => void
  onMore: () => void
  canFewer: boolean
  canMore: boolean
}) {
  return (
    <div className="stepper" role="group" aria-label="Number of colours">
      <button
        type="button"
        className="stepper__button"
        aria-label="Fewer colours"
        title="Merge the two most alike colours into the one used more"
        disabled={!canFewer}
        onClick={onFewer}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output className="stepper__value" aria-live="polite">
        {n}
      </output>
      <button
        type="button"
        className="stepper__button"
        aria-label="More colours"
        title="Undo the last merge"
        disabled={!canMore}
        onClick={onMore}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}

const countLabel = (label: string, n: number | undefined) =>
  n === undefined ? {} : { 'aria-label': `${label}, ${n} ${n === 1 ? 'colour' : 'colours'}` }

/** A stage (import.css) holding words rather than a picture: at least a picture's size,
 *  so the two columns line up, and taller if the words need it. */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="stage stage--message">
      <div className="stage__body">{children}</div>
    </div>
  )
}

/** The grid's size, under the pattern: "76 columns × 24 rows". Updated with every preview,
 *  as the outline moves. */
function Size({ cols, rows }: { cols: number; rows: number }) {
  return (
    <p className="confirm__note confirm__stats">
      <strong>{cols}</strong> {cols === 1 ? 'column' : 'columns'} × <strong>{rows}</strong> {rows === 1 ? 'row' : 'rows'}
    </p>
  )
}

/** The warnings, and the shrink notice. Recomputed with every preview. */
function Summary({ preview }: { preview: Preview }) {
  const shrunk = shrinkNotice(preview)
  if (preview.warnings.length === 0 && !shrunk) return null
  return (
    <div className="confirm__summary">
      {preview.warnings.length > 0 && (
        <ul className="confirm__warnings" aria-label="Warnings">
          {preview.warnings.map((w, i) => (
            <li key={i}>
              <span aria-hidden="true">⚠ </span>
              {w}
            </li>
          ))}
        </ul>
      )}
      {shrunk && <p className="confirm__note">{shrunk}</p>}
    </div>
  )
}

/** The pattern column: progress, the pattern and its size, or why there isn't one. */
function Outcome({
  state,
  shown,
  redetecting,
  spotlight = null,
  onRetry,
  onShowAll,
  another,
}: {
  state: ImportState
  shown: Preview | null
  redetecting: boolean
  /** The palette index whose cells to show, the rest faded. */
  spotlight?: number | null
  onRetry: () => void
  /** Where the colours are below the pattern: stop showing the one picked there. */
  onShowAll?: () => void
  another: (label: string, className?: string) => ReactNode
}) {
  if (redetecting && !shown) return <Finding />
  switch (state.phase) {
    case 'choose':
      return null
    case 'decoding':
      return (
        <Stage>
          <p className="muted">Reading the image…</p>
        </Stage>
      )
    case 'booting':
      return <BootStatus progress={state.progress} />
    case 'detecting':
      return <Finding />
    case 'result': {
      const preview = shown ?? state.preview
      return (
        <>
          <div className="stage">
            <PatternView preview={preview} spotlight={spotlight} />
            {redetecting && <p className="stage__busy">Finding the grid…</p>}
          </div>
          <div className="confirm__below">
            <Size cols={preview.cols} rows={preview.rows} />
          </div>
          {onShowAll && spotlight !== null && (
            <p className="confirm__spotlight">
              Showing where {preview.palette[spotlight]?.name} is used.{' '}
              <button type="button" className="button button--small" onClick={onShowAll}>
                Show all colours
              </button>
            </p>
          )}
        </>
      )
    }
    case 'failed': {
      const hint = hintFor(state.code, { canCrop: true })
      return (
        <Stage>
          <div className="import__failure" role="alert">
            <p className="import__failure-title">{hint.title}</p>
            {hint.advice && <p>{hint.advice}</p>}
            {/* With no grid, a box drawn on the image beside it is the way on. */}
            <p className="import__actions">{another('Try another image', state.code === 'NO_GRIDLINES' ? 'button' : 'button button--primary')}</p>
            {/* The code is for a bug report, not for the person holding the yarn. */}
            <p className="confirm__note">Detection failed ({state.code})</p>
          </div>
        </Stage>
      )
    }
    case 'stopped': {
      const hint = state.code === 'TIMEOUT' ? TIMEOUT_HINT : OUT_OF_MEMORY_HINT
      return (
        <Stage>
          <div className="import__failure" role="alert">
            <p className="import__failure-title">{hint.title}</p>
            <p>{hint.advice}</p>
            <p className="import__actions">
              {/* The same image runs out of memory the same way again. */}
              {state.code === 'TIMEOUT' && (
                <button type="button" className="button" onClick={onRetry}>
                  Try again
                </button>
              )}
              {another('Try another image')}
            </p>
            <p className="confirm__note">Detection stopped ({state.code})</p>
          </div>
        </Stage>
      )
    }
    case 'error':
      return (
        <Stage>
          <div className="import__failure" role="alert">
            <p>{state.message}</p>
            <p className="import__actions">
              <button type="button" className="button button--primary" onClick={onRetry}>
                Try again
              </button>
              {another('Choose another image')}
            </p>
          </div>
        </Stage>
      )
  }
}

function Finding() {
  return (
    <Stage>
      <div className="import__status">
        <p>Finding the grid…</p>
        <progress aria-label="Finding the grid" />
      </div>
    </Stage>
  )
}

function BootStatus({ progress }: { progress: BootProgress | null }) {
  const pct = progress && progress.total > 0 ? Math.round((100 * progress.loaded) / progress.total) : 0
  const stage = progress?.stage ?? 'runtime'
  const step = (['runtime', 'numpy', 'core'] as const).indexOf(stage) + 1
  return (
    <Stage>
      <div className="import__status">
        <p>Getting the pattern reader ready…</p>
        <progress max={100} value={pct} aria-label="Download progress" />
        <p className="import__stage">
          {STAGE_TEXT[stage]} ({step} of 3) · {pct}%
        </p>
        <p className="confirm__note">
          The first import downloads about {megabytes(downloadBytes)} MB, so it can take a moment on a slow connection.
          Opening your saved patterns never needs it.
        </p>
      </div>
    </Stage>
  )
}

/** The pattern's name, "Yarn & size", "Visualize" and Save, at the screen's top. The name starts empty:
 *  left so, the pattern is named by the moment it's saved. */
function SaveBar({
  name,
  onName,
  disabled,
  onSubmit,
  onEstimate,
  onVisualize,
}: {
  name: string
  onName: (name: string) => void
  disabled: boolean
  onSubmit: (e: FormEvent) => void
  /** Open "Yarn & size"; null while there's no pattern to estimate. */
  onEstimate: (() => void) | null
  /** Open "Visualize"; null while there's no pattern to show. */
  onVisualize: (() => void) | null
}) {
  const id = useId()
  return (
    <form className="savebar" onSubmit={onSubmit}>
      <div className="savebar__field">
        <label htmlFor={id} className="savebar__label">
          Pattern name
        </label>
        <input
          id={id}
          className="savebar__name"
          value={name}
          placeholder="Untitled pattern"
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => onName(e.target.value)}
        />
      </div>
      <div className="savebar__actions">
        <button
          type="button"
          className="button"
          disabled={!onEstimate}
          title="How big it comes out, and how much yarn of each colour to buy"
          onClick={() => onEstimate?.()}
        >
          Yarn &amp; size
        </button>
        <button
          type="button"
          className="button"
          disabled={!onVisualize}
          title="See the pattern as crocheted fabric, in the stitch you choose"
          onClick={() => onVisualize?.()}
        >
          Visualize
        </button>
        <button type="submit" className="button button--primary" disabled={disabled}>
          Save &amp; edit pattern
        </button>
      </div>
    </form>
  )
}
