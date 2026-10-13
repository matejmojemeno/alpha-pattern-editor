/**
 * Importing a pattern from an image: a port of the desktop's confirmation window
 * (alphareader/ui/importer/confirm_window.py), correction controls and all.
 *
 * The desktop's fast/slow split is kept (docs/dev/history/web-port.md#phase-2):
 * - moving the grid's outline only resamples (`DetectSession.update`),
 *   which folds a burst of changes into one pending request and drops stale answers;
 * - a box drawn on the image (a crop) detects again (`DetectSession.redetect`), under
 *   the client's watchdog, and so does "Reset to detected grid", which detects the whole
 *   image again: the desktop's Re-detect, undoing a box and a moved outline alike;
 * - "Mark one square" (a chart's) detects again told the size of one square, marked
 *   corner to corner on the image (`DetectSession.markSquare`), for a grid read at the
 *   wrong size or not found at all. If no grid of about that size is there, the grid
 *   shown stays, with a note saying so; "Reset to detected grid" undoes a mark.
 * While an answer is on its way the last good preview stays up, dimmed after ~200 ms.
 *
 * It is for getting the grid right and nothing else: the colour list shows what was found
 * and its count merges colours detection split, but removing a colour, "Yarn & size" and
 * "Visualize" are the Design stage's, where the pattern is saved and edited.
 *
 * Two screens in one (§5a), for what the person said they have:
 * - **"Import a chart"** (`intent` "chart", #/import) reads a chart's squares, trying its
 *   hardest: any grid detection finds is read, and nothing is turned into a picture
 *   unasked. Pixel art without gridlines is read block by block, exactly: nothing to
 *   adjust but its colours (merged as a chart's), and no outline or box. A chart read
 *   with doubts, or not at all, offers "Photo to pattern" with the same image.
 * - **"Photo to pattern"** (`intent` "picture", #/photo) turns any image into a pattern,
 *   detecting nothing. The outline and a box drawn on the image crop what's used (the
 *   width in stitches stays), the colour count asks for one colour fewer or more, and
 *   Width and Detail (and "Keep outlines", for drawings) sit above the colour list, so
 *   the stages' own chrome is unchanged.
 *
 * Layout (import.css): the name and "Save & edit pattern" head the screen. Below, the
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

import { useRepo, useSettings } from '../../app/context.ts'
import { loadDetection } from '../../app/detection.ts'
import { handOffImage, pendingImage, timestampName, type PendingImage } from '../../app/pendingImage.ts'
import { navigate, paths } from '../../app/router.ts'
import type { DetectSession } from '../../detect/client.ts'
import {
  isDetectionError,
  type BootProgress,
  type BootStage,
  type Crop,
  type DetectionErrorCode,
  type Extent,
  type Intent,
  type Outcome,
  type Params,
  type PictureSettings,
  type Preview,
  type Reading,
  type Square,
} from '../../detect/protocol.ts'
import { decodeImage, ImageDecodeError, sourcePng } from '../../importer/decode.ts'
import { hintFor, OUT_OF_MEMORY_HINT, TIMEOUT_HINT } from '../../importer/hints.ts'
import type { Grid } from '../../importer/outline.ts'
import {
  check,
  clampHeight,
  clampWidth,
  colourSteps,
  croppedRows,
  detailText,
  lengthText,
  MIN_WIDTH,
  PHOTO_TO_PATTERN,
  stitchesFor,
  stitchLength,
  swatchAspect,
} from '../../importer/picture.ts'
import type { Units } from '../../settings/store.ts'
import type { Swatch } from '../../yarn/usage.ts'
import { applyRemovals, mergeCandidate, type Removal } from '../../importer/removals.ts'
import { emptyProgress } from '../../model/types.ts'
import { DropOverlay, ImportButton, Notices, TopBar } from '../components.tsx'
import { useDelayedFlag, useDocumentTitle, useFileDrop, useMediaQuery, usePastedImage } from '../hooks.ts'
import { Palette } from '../import/Palette.tsx'
import { PatternView } from '../import/PatternView.tsx'
import { SizeField } from '../import/SizeField.tsx'
import { SourceView } from '../import/SourceView.tsx'
import { CloseIcon, InfoIcon, PhotoIcon, WarningIcon } from '../icons.tsx'
import { cleanName, MAX_NAME_LENGTH } from '../names.ts'
import { isChartImage, type Notice } from '../useAlphaImport.ts'

export type ImportState =
  | { phase: 'choose' }
  | { phase: 'decoding' }
  | { phase: 'booting'; progress: BootProgress | null }
  | { phase: 'detecting' }
  | { phase: 'result'; preview: Preview }
  /** A chart detection can't read (no grid, too fine, tilted); the session is open, so a
   *  box drawn on the image can retry, or the image can go to "Photo to pattern". */
  | { phase: 'failed'; code: DetectionErrorCode; reading?: Reading }
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

/** Each screen's title, and what its drop overlay says. The empty state is the title and
 *  the button alone. */
const SCREEN: Record<Intent, { title: string; drop: string }> = {
  chart: {
    title: 'Import a chart',
    drop: 'Drop a chart to import it',
  },
  picture: {
    title: PHOTO_TO_PATTERN,
    drop: 'Drop an image to make a pattern from it',
  },
}

export default function ImportScreen({ intent = 'chart' }: { intent?: Intent }) {
  const screen = SCREEN[intent]
  useDocumentTitle(screen.title)
  const repoState = useRepo()
  const repo = repoState.status === 'ready' ? repoState.repo : null
  const [settings] = useSettings()
  const swatch: Swatch = {
    stitches: settings.swatchStitches,
    rows: settings.swatchRows,
    widthCm: settings.swatchWidthCm,
    heightCm: settings.swatchHeightCm,
    grams: settings.swatchGrams,
  }
  /** A stitch's height over its width, for a picture; read when an image is opened (a
   *  ref, so a change to the swatch doesn't read the image again). */
  const cellAspect = swatchAspect(swatch)
  const aspect = useRef(cellAspect)
  useEffect(() => {
    aspect.current = cellAspect
  }, [cellAspect])
  const sidebar = useMediaQuery(SIDEBAR, true)
  const ids = useId()

  const [image, setImage] = useState<PendingImage | null>(pendingImage)
  const [state, setState] = useState<ImportState>(image ? { phase: 'decoding' } : { phase: 'choose' })
  /** The name typed; left empty, the pattern is named when saved (`timestampName`). Kept
   *  when the image is replaced: it was typed for the pattern, not the file. */
  const [name, setName] = useState(image?.name ?? '')
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
   *  the outline moved): what "Reset to detected grid" undoes. For a picture: whether
   *  only part of it is used, what "Use the whole picture" undoes. */
  const [adjusted, setAdjusted] = useState(false)
  const dim = useDelayedFlag(updating > 0 || redetecting, DIM_AFTER_MS)
  /** "Mark one square" is on: a drag on the image marks a square. */
  const [marking, setMarking] = useState(false)
  /** Why the last square marked found no grid, until the next mark or detection. */
  const [markNote, setMarkNote] = useState<string | null>(null)

  /** The colour count's merges, in order (importer/removals.ts): replayed on every preview,
   *  so they survive moving the outline. */
  const [removals, setRemovals] = useState<Removal[]>([])
  /** The colour pointed at, and the one kept showing, in the colour list: by hex. */
  const [pointed, setPointed] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  /** The note above the stages put away with its ×, by what it said: it comes back if it
   *  comes to say something else, or for another image. */
  const [hiddenCheck, setHiddenCheck] = useState<string | null>(null)

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
    setHiddenCheck(null)
    setShown(null)
    setSize(null)
    setRun({ attempt: 0 })
    setAdjusted(false)
    setRemovals([])
    setPointed(null)
    setPinned(null)
    setMarking(false)
    setMarkNote(null)
    // Setters never change; listed because the React Compiler infers them here.
  }, [setPointed, setPinned])

  const onFiles = useCallback(
    (files: File[]) => {
      const file = files.find(isChartImage)
      if (file) choose(file)
      else if (files.length) setNotices([{ tone: 'error', text: 'Choose a PNG, JPEG or WebP image.' }])
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
      setState({ phase: 'failed', code: result.code, ...(result.reading ? { reading: result.reading } : {}) })
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
      const { session: s, result } = await client.open(pixels, {
        ...(run.crop ? { crop: run.crop } : {}),
        ...(aspect.current ? { cellAspect: aspect.current } : {}),
        intent,
      })
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
  }, [image, run, detected, intent])

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

  /** A picture's settings, while one is shown. */
  const picture: PictureSettings | null = (state.phase === 'result' && (shown ?? state.preview).picture) || null

  /** Use `extent` of a picture, keeping its width in stitches; the rows follow, or stay
   *  as set without Keep proportions (drawn at once as the Python will count them, so
   *  the outline doesn't jump). */
  const cropPicture = (extent: Extent, p: PictureSettings) => {
    const w = extent.x1 - extent.x0
    const h = extent.y1 - extent.y0
    const cols = Math.min(p.width, Math.max(1, Math.floor(w)))
    setOutline({ extent, cols, rows: croppedRows(cols, w, h, p) })
    setAdjusted(extent.x0 > 0 || extent.y0 > 0 || (size !== null && (extent.x1 < size.width || extent.y1 < size.height)))
    update({ extent, width: p.width })
  }

  /** The outline moved: resample the new extent into its rows and columns. For a picture,
   *  it crops what's used, and the width in stitches stays. */
  const onResize = (grid: Grid) => {
    if (picture) {
      cropPicture(grid.extent, picture)
      return
    }
    setOutline(grid)
    setAdjusted(true)
    update({ extent: grid.extent, rows: grid.rows, cols: grid.cols })
  }

  /** Take the image, and the name typed, to "Photo to pattern". Back returns here, and
   *  reads the image as a chart again. */
  const toPhoto = () => {
    if (!image) return
    handOffImage({ file: image.file, ...(name ? { name } : {}) })
    navigate(paths.photo)
  }

  // --- the slow path: detect again ------------------------------------------------------

  /** Detect again inside a box drawn on the image, or, with none, in the whole image. A
   *  picture isn't detected again: the box crops it, and "Use the whole picture" undoes
   *  the crop. */
  const redetect = (crop?: Crop) => {
    if (picture && size) {
      const [x0, y0, x1, y1] = crop ?? [0, 0, size.width, size.height]
      cropPicture({ x0, y0, x1, y1 }, picture)
      return
    }
    setAdjusted(crop !== undefined)
    setMarkNote(null)
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

  /** Find the grid again from one square marked on the image. A grid of about that size
   *  that isn't there leaves the grid shown as it was, and says so. */
  const markSquare = (square: Square) => {
    setMarking(false)
    const s = session.current
    if (!s) return
    setMarkNote(null)
    setRedetecting(true)
    void s.markSquare(square).then((r) => {
      if (!mounted.current) return
      setRedetecting(false)
      if (session.current !== s) return
      if (r.ok) {
        setOutline(null)
        setAdjusted(true)
        detected(r)
      } else if (isDetectionError(r.code)) setMarkNote(MARK_FAILED[r.code])
      else detected(r)
    })
  }

  // Escape puts "Mark one square" away.
  useEffect(() => {
    if (!marking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMarking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [marking])

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
      // The colours merged here, as they were on the preview it was built from. A
      // picture's count asks the converter for its colours, so there's nothing to replay.
      const pattern = picture ? committed.pattern : applyRemovals(committed.pattern, removals, tolerance(state.preview)).result
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

  // The preview as shown: detection's answer with the colours merged here (a chart's).
  const raw = shown ?? (state.phase === 'result' ? state.preview : null)
  const { result: display, applied } = useMemo(
    () =>
      !raw ? { result: null, applied: [] } : raw.picture ? { result: raw, applied: [] } : applyRemovals(raw, removals, tolerance(raw)),
    [raw, removals],
  )
  /** The merge the count's + undoes: the last one that took a colour away here. */
  const lastMerge = removals.findLastIndex((r, i) => r.merged && applied[i])
  /** A picture's − and +: the converter asked for one colour fewer or more. */
  const steps = picture && display ? colourSteps(picture, display.palette.length) : null
  const fewer = () => {
    if (steps) {
      setPointed(null)
      setPinned(null)
      if (steps.fewer !== null) update({ colours: steps.fewer })
      return
    }
    const drop = display && mergeCandidate(display.palette)
    if (!drop) return
    setRemovals((r) => [...r, { hex: drop.hex, name: drop.name, merged: true }])
    setPointed(null)
    if (pinned === drop.hex) setPinned(null)
  }
  const more = () => {
    if (steps) {
      setPointed(null)
      setPinned(null)
      if (steps.more !== null) update({ colours: steps.more })
      return
    }
    setRemovals((r) => r.filter((_, i) => i !== lastMerge))
  }
  const spotHex = pointed ?? pinned
  const spotIndex = display && spotHex !== null ? display.palette.findIndex((e) => e.hex === spotHex) : -1
  const spotlight = spotIndex >= 0 ? spotIndex : null

  const another = (label: string, className = 'button') => (
    <ImportButton className={className} onFiles={onFiles} accept={IMAGE_ACCEPT} multiple={false} label="Choose an image">
      {label}
    </ImportButton>
  )

  if (state.phase === 'choose' || !image) {
    return (
      <main className="screen import" {...drop.handlers}>
        <TopBar title={screen.title} help={intent === 'picture' ? 'photo' : 'import'} />
        <Notices notices={notices} />
        <div className="empty import__choose">
          {another('Choose image…', 'button button--primary')}
          <p className="muted">Or drop or paste one here.</p>
        </div>
        <DropOverlay show={drop.over} text={screen.drop} />
      </main>
    )
  }

  const hasGrid = state.phase === 'result'
  const loading = state.phase === 'decoding' || state.phase === 'booting' || state.phase === 'detecting'
  const busy = redetecting
  /** Pixel art read block by block: exact, so there's no outline to move or box to draw. */
  const pixels = state.phase === 'result' && (shown ?? state.preview).mode === 'pixels'
  const canDetect = !loading && !busy && state.phase !== 'error' && size !== null
  /** A chart's squares can be marked once it's been read, or failed to be: the session is
   *  open either way. */
  const canMark = intent === 'chart' && canDetect && (state.phase === 'result' || state.phase === 'failed')
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
      <TopBar title={screen.title} help={intent === 'picture' ? 'photo' : 'import'} />
      <SaveBar
        name={name}
        onName={setName}
        disabled={saving || !repo || !hasGrid || busy}
        onSubmit={save}
      />
      <Notices notices={notices} />
      <div className="confirm" data-dim={dim || undefined} style={stageShape}>
        {preview && (
          <Check preview={preview} disabled={busy || loading} onPhoto={toPhoto} hidden={hiddenCheck} onHide={setHiddenCheck} />
        )}
        <div className="confirm__grid" data-two-below={intent === 'chart' || undefined}>
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
                canCrop={canDetect && !pixels}
                canResize={hasGrid && !busy && !pixels}
                marking={marking && canMark}
                onCrop={(crop) => redetect(crop)}
                onResize={onResize}
                onMark={markSquare}
                caption={marking && canMark ? 'Drag from one corner of a square to the opposite corner.' : markNote}
              />
            ) : (
              <Stage>
                <p className="muted">Reading the image…</p>
              </Stage>
            )}
            <div className="confirm__below">
              <button type="button" className="button" disabled={!adjusted || !canDetect} onClick={() => redetect()}>
                {picture ? 'Use the whole picture' : 'Reset to detected grid'}
              </button>
              {intent === 'chart' && (
                <button
                  type="button"
                  className="button confirm__mark"
                  aria-pressed={marking && canMark}
                  disabled={!canMark}
                  onClick={() => {
                    setMarking((m) => !m)
                    setMarkNote(null)
                  }}
                >
                  Mark one square
                </button>
              )}
              {!grid && canDetect && !marking && !markNote && (
                <p className="confirm__note confirm__hint">Drag a box around just the squares, then let go.</p>
              )}
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
                redetecting={busy}
                onRetry={() => {
                  setAdjusted(false)
                  setRun((r) => ({ attempt: r.attempt + 1 }))
                }}
                onPhoto={toPhoto}
                another={another}
              />
            </div>
          </section>

          <section className="confirm__col confirm__col--colours" aria-labelledby={`${ids}-colours`}>
            <div className="confirm__head">
              {heading('colours', 'Colours', colours)}
              {colours !== undefined && (
                <ColourCount
                  n={colours}
                  onFewer={fewer}
                  onMore={more}
                  canFewer={(steps ? steps.fewer !== null : colours > 1) && !busy}
                  canMore={(steps ? steps.more !== null : lastMerge >= 0) && !busy}
                  picture={steps !== null}
                />
              )}
            </div>
            {picture && display && hasGrid && (
              <PictureControls
                picture={picture}
                stitch={stitchLength(swatch, settings.units)}
                units={settings.units}
                disabled={busy}
                // With proportions kept, the last of width and height set is the one that
                // counts: it drops the other from any change still waiting to be sent.
                onWidth={(width, keep) => {
                  setOutline(null)
                  update({ width: clampWidth(width, picture), ...(keep ? { height: undefined } : {}) })
                }}
                onHeight={(height, keep) => {
                  setOutline(null)
                  update({ height: clampHeight(height, picture), ...(keep ? { width: undefined } : {}) })
                }}
                onKeepShape={(keepShape) => update({ keepShape, ...(keepShape ? { height: undefined } : {}) })}
                onDetail={(detail) => update({ detail })}
                onOutlines={(outlines) => update({ outlines })}
              />
            )}
            {display && hasGrid ? (
              <Palette palette={display.palette} shown={spotlight === null ? null : spotHex} pinned={pinned} onPoint={setPointed} onPin={setPinned} />
            ) : (
              <p className="confirm__note">The colours appear once the grid is found.</p>
            )}
          </section>
        </div>
      </div>
      <DropOverlay show={drop.over} text={screen.drop} />
    </main>
  )
}

/** What a square marked that found no grid says, by detection's refusal. */
const MARK_FAILED: Record<DetectionErrorCode, string> = {
  NO_GRIDLINES: 'No grid of squares that size there. Mark one square again, corner to corner, on its lines.',
  LOW_RESOLUTION: 'Squares that small are too small to read: each needs about 6 pixels.',
  ROTATED: 'The chart looks tilted. Straighten the image and import it again.',
  TOO_SMALL: 'This image is too small to contain a chart.',
}

/** How close a colour must be to one removed to be taken for it, in a new preview: half
 *  the merge threshold, so no two of its colours can both be (importer/removals.ts). */
const tolerance = (p: { deltaE: number }) => p.deltaE / 2

/** How many colours, beside the colour list's heading, with − and + to change it. For a
 *  chart − merges the two most alike (removals.mergeCandidate) and + undoes the last
 *  merge; for a picture they make it again with one colour fewer or more. */
function ColourCount({
  n,
  onFewer,
  onMore,
  canFewer,
  canMore,
  picture = false,
}: {
  n: number
  onFewer: () => void
  onMore: () => void
  canFewer: boolean
  canMore: boolean
  picture?: boolean
}) {
  return (
    <div className="stepper" role="group" aria-label="Number of colours">
      <button
        type="button"
        className="stepper__button"
        aria-label="Fewer colours"
        title={picture ? 'Make the pattern with one colour fewer' : 'Merge the two most alike colours into the one used more'}
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
        title={picture ? 'Make the pattern with one colour more' : 'Undo the last merge'}
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

/** One short, boxed note above the stages, only when there's something to say
 *  (importer/picture.ts's `check`): its title, the reasons in a few words each, the way
 *  to "Photo to pattern" should the image be a photo after all, and × to put it away.
 *  Recomputed with every preview, as moving the outline changes the reasons. */
function Check({
  preview,
  disabled,
  onPhoto,
  hidden,
  onHide,
}: {
  preview: Preview
  disabled: boolean
  onPhoto: () => void
  /** What the note said when it was put away. */
  hidden: string | null
  onHide: (said: string) => void
}) {
  const note = check(preview.mode, preview.reading, preview.warnings)
  if (!note) return null
  const said = [note.title, ...note.reasons].join('\n')
  if (said === hidden) return null
  const Icon = note.warning ? WarningIcon : InfoIcon
  return (
    <div className="import-note" data-warning={note.warning || undefined} role="status">
      <Icon />
      <p className="import-note__text">
        <strong>{note.title}</strong>
        {note.reasons.map((r) => (
          <span key={r} className="import-note__reason">
            {r}
          </span>
        ))}
      </p>
      {note.offerPhoto && (
        <button type="button" className="button button--small import-note__photo" disabled={disabled} onClick={onPhoto}>
          <PhotoIcon />
          Open in {PHOTO_TO_PATTERN}
        </button>
      )}
      <button type="button" className="import-note__hide" aria-label="Hide this note" title="Hide" onClick={() => onHide(said)}>
        <CloseIcon />
      </button>
    </div>
  )
}

/** A picture's width and height in stitches, whether they keep its shape, its finished
 *  size once the swatch gives it, and how much detail it keeps, above the colour list.
 *  Each size can be typed or slid; a change is sent at once, and the client folds a drag
 *  into a few resamples. */
function PictureControls({
  picture,
  stitch,
  units,
  disabled,
  onWidth,
  onHeight,
  onKeepShape,
  onDetail,
  onOutlines,
}: {
  picture: PictureSettings
  /** One stitch's width and one row's height in `units`, when the swatch is measured. */
  stitch: { across: number; up: number } | null
  units: Units
  disabled: boolean
  /** A width or height asked for, and whether Keep proportions is on as shown. */
  onWidth: (width: number, keepShape: boolean) => void
  onHeight: (height: number, keepShape: boolean) => void
  onKeepShape: (on: boolean) => void
  onDetail: (detail: number) => void
  onOutlines: (on: boolean) => void
}) {
  const id = useId()
  // A control shows the value asked for until the answer to it arrives, then the answer:
  // answers to earlier values of a drag don't pull it back.
  const [askedWidth, setAskedWidth] = useState<number | null>(null)
  const [askedHeight, setAskedHeight] = useState<number | null>(null)
  const [askedDetail, setAskedDetail] = useState<number | null>(null)
  const [askedKeep, setAskedKeep] = useState<boolean | null>(null)
  if (askedWidth !== null && picture.width === clampWidth(askedWidth, picture)) setAskedWidth(null)
  if (askedHeight !== null && picture.height === clampHeight(askedHeight, picture)) setAskedHeight(null)
  if (askedKeep !== null && picture.keepShape === askedKeep) setAskedKeep(null)
  if (askedDetail !== null && Math.abs(picture.detail - askedDetail) < 1e-9) setAskedDetail(null)
  const [askedOutlines, setAskedOutlines] = useState<boolean | null>(null)
  if (askedOutlines !== null && picture.outlines === askedOutlines) setAskedOutlines(null)
  const outlines = askedOutlines ?? picture.outlines
  const keep = askedKeep ?? picture.keepShape
  const width = askedWidth ?? picture.width
  const height = askedHeight ?? picture.height
  const detail = askedDetail ?? picture.detail
  const min = Math.min(MIN_WIDTH, picture.maxWidth)
  const askWidth = (w: number) => {
    // With the shape kept, the height follows the width: its answer, not what was asked
    // of it before.
    if (keep) setAskedHeight(null)
    setAskedWidth(w)
    onWidth(w, keep)
  }
  const askHeight = (h: number) => {
    if (keep) setAskedWidth(null)
    setAskedHeight(h)
    onHeight(h, keep)
  }
  return (
    <div className="picture-controls" role="group" aria-label="Picture settings">
      <div className="picture-controls__row">
        <label htmlFor={`${id}-width`} className="picture-controls__label">
          Width
        </label>
        <SizeField
          id={`${id}-width`}
          value={width}
          unit="stitches"
          min={min}
          max={picture.maxWidth}
          disabled={disabled}
          onCommit={askWidth}
        />
      </div>
      <input
        type="range"
        className="picture-controls__slider"
        aria-label="Width slider"
        min={min}
        max={picture.maxWidth}
        step={1}
        value={width}
        disabled={disabled}
        aria-valuetext={`${width} stitches across`}
        onChange={(e) => askWidth(Number(e.target.value))}
      />
      <div className="picture-controls__row">
        <label htmlFor={`${id}-height`} className="picture-controls__label">
          Height
        </label>
        <SizeField
          id={`${id}-height`}
          value={height}
          unit="rows"
          min={picture.minHeight}
          max={picture.maxHeight}
          disabled={disabled}
          onCommit={askHeight}
        />
      </div>
      <input
        type="range"
        className="picture-controls__slider"
        aria-label="Height slider"
        min={picture.minHeight}
        max={picture.maxHeight}
        step={1}
        value={height}
        disabled={disabled}
        aria-valuetext={`${height} rows`}
        onChange={(e) => askHeight(Number(e.target.value))}
      />
      <label className="picture-controls__check">
        <input
          type="checkbox"
          checked={keep}
          disabled={disabled}
          onChange={(e) => {
            setAskedKeep(e.target.checked)
            if (e.target.checked) setAskedHeight(null)
            onKeepShape(e.target.checked)
          }}
        />
        <span className="picture-controls__label">Keep proportions</span>
      </label>
      {/* The finished size, once the swatch gives it, typed in the units chosen in "Yarn &
          size": the nearest stitches and rows to it are asked for, and the fields then
          show the size those give. */}
      {stitch && (
        <div className="picture-controls__row" role="group" aria-labelledby={`${id}-finished`}>
          <span id={`${id}-finished`} className="picture-controls__label">
            Finished size
          </span>
          <span className="picture-controls__finished">
            <SizeField
              label="Finished width"
              value={width * stitch.across}
              shown={lengthText(width * stitch.across)}
              unit="×"
              min={min * stitch.across}
              max={picture.maxWidth * stitch.across}
              whole={false}
              step={stitch.across}
              disabled={disabled}
              onCommit={(n) => askWidth(clampWidth(stitchesFor(n, stitch.across), picture))}
            />
            <SizeField
              label="Finished height"
              value={height * stitch.up}
              shown={lengthText(height * stitch.up)}
              unit={units === 'metric' ? 'cm' : 'in'}
              min={picture.minHeight * stitch.up}
              max={picture.maxHeight * stitch.up}
              whole={false}
              step={stitch.up}
              disabled={disabled}
              onCommit={(n) => askHeight(clampHeight(stitchesFor(n, stitch.up), picture))}
            />
          </span>
        </div>
      )}
      <div className="picture-controls__row">
        <label htmlFor={`${id}-detail`} className="picture-controls__label">
          Detail
        </label>
        <output className="picture-controls__value" htmlFor={`${id}-detail`}>
          {detailText(detail)}
        </output>
      </div>
      <input
        id={`${id}-detail`}
        type="range"
        className="picture-controls__slider"
        min={0}
        max={1}
        step={0.05}
        value={detail}
        disabled={disabled}
        aria-valuetext={detailText(detail)}
        onChange={(e) => {
          const d = Number(e.target.value)
          setAskedDetail(d)
          onDetail(d)
        }}
      />
      <p className="picture-controls__note picture-controls__ends" aria-hidden="true">
        <span>Fewer colour changes</span>
        <span>More detail</span>
      </p>
      {/* Off unless asked for: whether a picture has drawn outlines can't be told
          reliably, so the pattern shows at once whether it helps (core/outlines.py). */}
      <label className="picture-controls__switch">
        <input
          type="checkbox"
          role="switch"
          checked={outlines}
          disabled={disabled}
          aria-describedby={`${id}-outlines`}
          onChange={(e) => {
            setAskedOutlines(e.target.checked)
            onOutlines(e.target.checked)
          }}
        />
        <span className="picture-controls__label">Keep outlines</span>
      </label>
      <p id={`${id}-outlines`} className="picture-controls__note">
        For drawings with dark lines.
      </p>
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
  onPhoto,
  onShowAll,
  another,
}: {
  state: ImportState
  shown: Preview | null
  /** Detecting again: the pattern stays up, dimmed. */
  redetecting: boolean
  /** The palette index whose cells to show, the rest faded. */
  spotlight?: number | null
  onRetry: () => void
  /** Take an image that can't be read as a chart to "Photo to pattern". */
  onPhoto: () => void
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
            <p className="import__actions">
              {another('Try another image', state.code === 'NO_GRIDLINES' ? 'button' : 'button button--primary')}
            </p>
            {/* Never converted unasked: a blurred chart would make a plausible, wrong
                pattern. The person who has a photo says so. */}
            <p className="import__photo">
              Not a chart? {PHOTO_TO_PATTERN} makes a new pattern from any photo or drawing.{' '}
              <button type="button" className="button button--small" disabled={redetecting} onClick={onPhoto}>
                Use {PHOTO_TO_PATTERN}
              </button>
            </p>
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
        <p>Reading your image…</p>
        <progress aria-label="Reading your image" />
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
        <p className="confirm__note">First time only: about {megabytes(downloadBytes)} MB.</p>
      </div>
    </Stage>
  )
}

/** The pattern's name and Save, at the screen's top. The name starts empty: left so, the
 *  pattern is named by the moment it's saved. */
function SaveBar({
  name,
  onName,
  disabled,
  onSubmit,
}: {
  name: string
  onName: (name: string) => void
  disabled: boolean
  onSubmit: (e: FormEvent) => void
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
        <button type="submit" className="button button--primary" disabled={disabled}>
          Save &amp; edit pattern
        </button>
      </div>
    </form>
  )
}
