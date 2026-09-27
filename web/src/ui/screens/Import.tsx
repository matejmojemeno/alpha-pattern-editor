/**
 * Importing a pattern from an image: a port of the desktop's confirmation window
 * (alphareader/ui/importer/confirm_window.py), correction controls and all.
 *
 * The desktop's fast/slow split is kept (docs/web-port-plan.md, Phase 2):
 * - moving the grid's outline only resamples (`DetectSession.update`),
 *   which folds a burst of changes into one pending request and drops stale answers;
 * - a box drawn on the image (a crop) detects again (`DetectSession.redetect`), under
 *   the client's watchdog, and so does "Use the whole image", which undoes one.
 * While an answer is on its way the last good preview stays up, dimmed after ~200 ms.
 * The desktop's Re-detect is that button, shown only once there's a box to undo: before
 * then it could only find what was already found.
 *
 * The name and "Save & edit pattern" head the screen. Under 900 px the image, the
 * pattern and the colours are tabs, with the grid's size above them; wider, they're the
 * desktop's three panes side by side, the size beside the pattern's heading.
 *
 * Loaded lazily (App.tsx), and the only screen that starts the detection worker. Leaving
 * it terminates the worker (App.tsx), which frees Pyodide's memory.
 */
import '../import.css'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { downloadBytes } from 'virtual:detect-assets'

import { useRepo } from '../../app/context.ts'
import { loadDetection } from '../../app/detection.ts'
import { nameFromFile, pastedName, pendingImage, type PendingImage } from '../../app/pendingImage.ts'
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
import { applyRemovals, type Removal } from '../../importer/removals.ts'
import { emptyProgress } from '../../model/types.ts'
import { DropOverlay, ImportButton, Notices, TopBar } from '../components.tsx'
import { useDelayedFlag, useDocumentTitle, useFileDrop, useMediaQuery, usePastedImage } from '../hooks.ts'
import { Palette } from '../import/Palette.tsx'
import { PatternView } from '../import/PatternView.tsx'
import { SourceView } from '../import/SourceView.tsx'
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
  /** Detection ran past its budget and the worker was terminated: no session. */
  /** The worker was terminated: the watchdog stopped it, or its memory ran out. */
  | { phase: 'stopped'; code: 'TIMEOUT' | 'OUT_OF_MEMORY' }
  | { phase: 'error'; message: string }

type Tab = 'image' | 'pattern' | 'colours'

/** One run of decode → boot → open. A retry after a timeout may detect just a crop. */
interface Run {
  attempt: number
  crop?: Crop
}

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'
/** Narrower than this, the panes become tabs (docs/web-port-plan.md, Phase 2 "UI"). */
const WIDE = '(min-width: 900px)'
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
  const wide = useMediaQuery(WIDE, true)
  const tabsId = useId()

  const [image, setImage] = useState<PendingImage | null>(pendingImage)
  const [state, setState] = useState<ImportState>(image ? { phase: 'decoding' } : { phase: 'choose' })
  /** The name typed; left empty, the pattern takes the image's (`PendingImage.name`). */
  const [name, setName] = useState('')
  const [notices, setNotices] = useState<Notice[]>(image?.notices ?? [])
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState<Run>({ attempt: 0 })
  /** The image's decoded size: the coordinate space of the overlay and of crops. */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  /** The outline last asked for, drawn until the answers to it are in. */
  const [outline, setOutline] = useState<Grid | null>(null)
  const [tab, setTab] = useState<Tab>('pattern')

  /** The latest preview, kept through a re-detection and a failure. */
  const [shown, setShown] = useState<Preview | null>(null)
  const [updating, setUpdating] = useState(0)
  const [redetecting, setRedetecting] = useState(false)
  /** Whether the last detection was of a box drawn on the image, which "Use the whole
   *  image" undoes. */
  const [cropped, setCropped] = useState(false)
  const dim = useDelayedFlag(updating > 0 || redetecting, DIM_AFTER_MS)

  /** Colours removed before saving, in order (importer/removals.ts). */
  const [removals, setRemovals] = useState<Removal[]>([])
  /** The colour pointed at, and the one kept showing, in the colour list: by hex. */
  const [pointed, setPointed] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)

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

  const choose = useCallback((file: File, fileName = nameFromFile(file.name)) => {
    setImage({ file, name: fileName })
    setName('')
    setNotices([])
    setShown(null)
    setSize(null)
    setRun({ attempt: 0 })
    setCropped(false)
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
  usePastedImage(useCallback((file: File) => choose(file, pastedName()), [choose]))

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
    update({ extent: grid.extent, rows: grid.rows, cols: grid.cols })
  }

  // --- the slow path: detect again ------------------------------------------------------

  /** Detect again inside a box drawn on the image, or, with none, in the whole image. */
  const redetect = (crop?: Crop) => {
    setCropped(crop !== undefined)
    const s = session.current
    if (!s) {
      // Nothing to detect again in: the worker was stopped (the watchdog, or memory ran
      // out). Start over, with the box if there is one.
      setRun((r) => ({ attempt: r.attempt + 1, ...(crop ? { crop } : {}) }))
      return
    }
    if (!wide) setTab('pattern')
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
      const committed = await s.commit(cleanName(name) ?? image.name)
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
  const removed = removals.flatMap((removal, index) => (applied[index] ? [{ removal, index }] : []))
  const spotHex = pointed ?? pinned
  const spotIndex = display && spotHex !== null ? display.palette.findIndex((e) => e.hex === spotHex) : -1
  const spotlight = spotIndex >= 0 ? spotIndex : null

  const another = (label: string, primary = false) => (
    <ImportButton
      className={primary ? 'button button--primary' : 'button'}
      onFiles={onFiles}
      accept={IMAGE_ACCEPT}
      multiple={false}
      label="Choose a chart image"
    >
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
          {another('Choose image…', true)}
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

  const panes: { tab: Tab; label: string; count?: number | undefined; body: ReactNode }[] = [
    {
      tab: 'image',
      label: 'Your image',
      body: size ? (
        <>
          {!grid && canDetect && <p className="confirm__hint">Drag a box around just the squares, then let go.</p>}
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
          {(cropped || !wide) && (
            <p className="import__actions">
              {/* Undoes a box exactly: one drawn by hand round the whole image can miss
                  a chart's outermost row by a pixel. */}
              {cropped && (
                <button type="button" className="button button--small" disabled={!canDetect} onClick={() => redetect()}>
                  Use the whole image
                </button>
              )}
              {/* The save bar has no room for it on a phone. */}
              {!wide && another('Choose another image')}
            </p>
          )}
        </>
      ) : (
        <p className="muted">Reading the image…</p>
      ),
    },
    {
      tab: 'pattern',
      label: 'Pattern',
      body: (
        <div className="confirm__outcome" aria-live="polite" aria-busy={loading || redetecting}>
          <Outcome
            state={state}
            shown={display}
            spotlight={spotlight}
            {...(pinned !== null && spotlight !== null && !wide ? { onShowAll: () => setPinned(null) } : {})}
            redetecting={redetecting}
            onRetry={() => {
              setCropped(false)
              setRun((r) => ({ attempt: r.attempt + 1 }))
            }}
            {...(wide ? {} : { onShowImage: () => setTab('image') })}
            another={another}
          />
        </div>
      ),
    },
    {
      tab: 'colours',
      label: 'Colours',
      count: display && hasGrid ? display.palette.length : undefined,
      body:
        display && hasGrid ? (
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
          <p className="muted">The colours appear once the grid is found.</p>
        ),
    },
  ]

  // The grid's size, beside the pattern's heading, or above the tabs on a phone, where it
  // stays in view on the image tab too.
  const sized = preview && <Size cols={preview.cols} rows={preview.rows} />

  return (
    <main className="screen import" {...drop.handlers}>
      <TopBar title="Import pattern" />
      <SaveBar
        name={name}
        placeholder={image.name}
        onName={setName}
        disabled={saving || !repo || !hasGrid || redetecting}
        onSubmit={save}
        another={another}
      />
      <Notices notices={notices} />
      <div className="confirm" data-dim={dim || undefined}>
        {!wide && sized}
        {preview && <Summary preview={preview} />}
        {!wide && (
          <div className="confirm__tabs" role="tablist" aria-label="Show">
            {panes.map((p) => (
              <button
                key={p.tab}
                type="button"
                role="tab"
                id={`${tabsId}-${p.tab}-tab`}
                aria-controls={`${tabsId}-${p.tab}`}
                aria-selected={tab === p.tab}
                className="confirm__tab"
                {...countLabel(p.label, p.count)}
                onClick={() => setTab(p.tab)}
              >
                {p.tab === 'image' ? 'Image' : p.label}
                {p.count !== undefined && <Count n={p.count} />}
              </button>
            ))}
          </div>
        )}
        <div className="confirm__panes">
          {panes.map((p) => (
            <section
              key={p.tab}
              id={`${tabsId}-${p.tab}`}
              className={`confirm__pane confirm__pane--${p.tab}`}
              {...(wide
                ? { 'aria-label': p.label }
                : { role: 'tabpanel', 'aria-labelledby': `${tabsId}-${p.tab}-tab`, hidden: tab !== p.tab })}
            >
              {wide && (
                <div className="confirm__head">
                  <h2 className="confirm__caption" {...countLabel(p.label, p.count)}>
                    {p.label}
                    {p.count !== undefined && <Count n={p.count} />}
                  </h2>
                  {p.tab === 'pattern' && sized}
                </div>
              )}
              {p.body}
            </section>
          ))}
        </div>
      </div>
      <DropOverlay show={drop.over} text="Drop a chart image to import it" />
    </main>
  )
}

/** How close a colour must be to one removed to be taken for it, in a new preview: half
 *  the merge threshold, so no two of its colours can both be (importer/removals.ts). */
const tolerance = (p: { deltaE: number }) => p.deltaE / 2

/** How many colours, beside the colour list's heading or tab; read out through
 *  `countLabel` on that. */
function Count({ n }: { n: number }) {
  return (
    <span className="confirm__count" aria-hidden="true">
      {n}
    </span>
  )
}

const countLabel = (label: string, n: number | undefined) =>
  n === undefined ? {} : { 'aria-label': `${label}, ${n} ${n === 1 ? 'colour' : 'colours'}` }

/** The grid's size, the one number to check against the chart, so set large. Updated
 *  with every preview, as the outline moves. */
function Size({ cols, rows }: { cols: number; rows: number }) {
  return (
    <p className="confirm__stats">
      <strong>{cols}</strong> cols × <strong>{rows}</strong> rows
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
      {shrunk && <p className="confirm__notice muted">{shrunk}</p>}
    </div>
  )
}

/** The pattern pane: progress, the pattern, or why there isn't one. */
export function Outcome({
  state,
  shown,
  redetecting,
  spotlight = null,
  onRetry,
  onShowImage,
  onShowAll,
  another,
}: {
  state: ImportState
  shown: Preview | null
  redetecting: boolean
  /** The palette index whose cells to show, the rest faded. */
  spotlight?: number | null
  onRetry: () => void
  /** On a phone, where the image is another tab: go to it, to draw a box there. */
  onShowImage?: () => void
  /** On a phone, where the colours are another tab: stop showing the one picked there. */
  onShowAll?: () => void
  another: (label: string, primary?: boolean) => ReactNode
}) {
  if (redetecting && !shown) return <Finding />
  switch (state.phase) {
    case 'choose':
      return null
    case 'decoding':
      return <p className="muted">Reading the image…</p>
    case 'booting':
      return <BootStatus progress={state.progress} />
    case 'detecting':
      return <Finding />
    case 'result':
      return (
        <>
          <PatternView preview={shown ?? state.preview} spotlight={spotlight} />
          {onShowAll && spotlight !== null && shown && (
            <p className="confirm__spotlight">
              Showing where {shown.palette[spotlight]?.name} is used.{' '}
              <button type="button" className="button button--small" onClick={onShowAll}>
                Show all colours
              </button>
            </p>
          )}
          {redetecting && <p className="confirm__busy">Finding the grid…</p>}
        </>
      )
    case 'failed': {
      const hint = hintFor(state.code, { canCrop: true })
      return (
        <div className="import__failure" role="alert">
          <p className="import__failure-title">{hint.title}</p>
          {hint.advice && <p>{hint.advice}</p>}
          <p className="import__actions">
            {state.code === 'NO_GRIDLINES' && onShowImage && (
              <button type="button" className="button button--primary" onClick={onShowImage}>
                Draw a box
              </button>
            )}
            {another('Try another image', state.code !== 'NO_GRIDLINES')}
          </p>
          {/* The code is for a bug report, not for the person holding the yarn. */}
          <p className="import__code muted">Detection failed ({state.code})</p>
        </div>
      )
    }
    case 'stopped': {
      const hint = state.code === 'TIMEOUT' ? TIMEOUT_HINT : OUT_OF_MEMORY_HINT
      return (
        <div className="import__failure" role="alert">
          <p className="import__failure-title">{hint.title}</p>
          <p>{hint.advice}</p>
          <p className="import__actions">
            {onShowImage && (
              <button type="button" className="button button--primary" onClick={onShowImage}>
                Draw a box
              </button>
            )}
            {/* The same image runs out of memory the same way again. */}
            {state.code === 'TIMEOUT' && (
              <button type="button" className="button" onClick={onRetry}>
                Try again
              </button>
            )}
            {another('Try another image')}
          </p>
          <p className="import__code muted">Detection stopped ({state.code})</p>
        </div>
      )
    }
    case 'error':
      return (
        <div className="import__failure" role="alert">
          <p>{state.message}</p>
          <p className="import__actions">
            <button type="button" className="button button--primary" onClick={onRetry}>
              Try again
            </button>
            {another('Choose another image')}
          </p>
        </div>
      )
  }
}

function Finding() {
  return (
    <div className="import__status">
      <p>Finding the grid…</p>
      <progress aria-label="Finding the grid" />
    </div>
  )
}

export function BootStatus({ progress }: { progress: BootProgress | null }) {
  const pct = progress && progress.total > 0 ? Math.round((100 * progress.loaded) / progress.total) : 0
  const stage = progress?.stage ?? 'runtime'
  const step = (['runtime', 'numpy', 'core'] as const).indexOf(stage) + 1
  return (
    <div className="import__status">
      <p>Getting the pattern reader ready…</p>
      <progress max={100} value={pct} aria-label="Download progress" />
      <p className="import__stage">
        {STAGE_TEXT[stage]} ({step} of 3) · {pct}%
      </p>
      <p className="muted">
        The first import downloads about {megabytes(downloadBytes)} MB, so it can take a moment on a slow connection.
        Opening your saved patterns never needs it.
      </p>
    </div>
  )
}

/** The pattern's name and the screen's actions, at its top. The name field starts empty,
 *  with the name it will get otherwise shown greyed in it: click and type to change it. */
function SaveBar({
  name,
  placeholder,
  onName,
  disabled,
  onSubmit,
  another,
}: {
  name: string
  placeholder: string
  onName: (name: string) => void
  disabled: boolean
  onSubmit: (e: FormEvent) => void
  another: (label: string, primary?: boolean) => ReactNode
}) {
  return (
    <form className="savebar" onSubmit={onSubmit}>
      <input
        aria-label="Pattern name"
        className="savebar__name"
        value={name}
        placeholder={placeholder}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => onName(e.target.value)}
      />
      <span className="savebar__another">{another('Choose another image')}</span>
      <button type="submit" className="button button--primary savebar__save" disabled={disabled}>
        Save &amp; edit pattern
      </button>
    </form>
  )
}
