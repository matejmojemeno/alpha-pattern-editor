/**
 * Importing a pattern from an image: a port of the desktop's confirmation window
 * (alphareader/ui/importer/confirm_window.py), without its correction controls yet.
 * Rows and columns, colour detail, crop and "flag unsure cells" are Phase 2, part 2; the
 * worker protocol (detect/client.ts) already supports them.
 *
 * Loaded lazily (App.tsx), and the only screen that starts the detection worker. Leaving
 * it terminates the worker (App.tsx), which frees Pyodide's memory.
 */
import '../import.css'

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { downloadBytes } from 'virtual:detect-assets'

import { useRepo } from '../../app/context.ts'
import { loadDetection } from '../../app/detection.ts'
import { nameFromFile, PASTED_NAME, pendingImage, type PendingImage } from '../../app/pendingImage.ts'
import { navigate, paths } from '../../app/router.ts'
import type { DetectSession } from '../../detect/client.ts'
import { isDetectionError, type BootProgress, type BootStage, type DetectionErrorCode, type Preview } from '../../detect/protocol.ts'
import { decodeImage, ImageDecodeError, sourcePng } from '../../importer/decode.ts'
import { hintFor } from '../../importer/hints.ts'
import { formatStats } from '../../logic/readout.ts'
import { emptyProgress } from '../../model/types.ts'
import { buildCellImage } from '../../render/chart.ts'
import { DropOverlay, ImportButton, Notices, TopBar } from '../components.tsx'
import { cleanName, MAX_NAME_LENGTH } from '../names.ts'
import { useBlobImage, useDocumentTitle, useFileDrop, usePastedImage } from '../hooks.ts'
import { isChartImage, type Notice } from '../useAlphaImport.ts'

export type ImportState =
  | { phase: 'choose' }
  | { phase: 'decoding' }
  | { phase: 'booting'; progress: BootProgress | null }
  | { phase: 'detecting' }
  | { phase: 'result'; preview: Preview }
  | { phase: 'failed'; code: DetectionErrorCode }
  | { phase: 'error'; message: string }

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'

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

  const [image, setImage] = useState<PendingImage | null>(pendingImage)
  const [state, setState] = useState<ImportState>(image ? { phase: 'decoding' } : { phase: 'choose' })
  const [name, setName] = useState(image?.name ?? '')
  const [notices, setNotices] = useState<Notice[]>(image?.notices ?? [])
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const session = useRef<DetectSession | null>(null)

  const choose = useCallback((file: File, fileName = nameFromFile(file.name)) => {
    setImage({ file, name: fileName })
    setName(fileName)
    setNotices([])
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
  usePastedImage(useCallback((file: File) => choose(file, PASTED_NAME), [choose]))

  // Decode, boot Pyodide, detect. Runs again for a new image or a retry.
  useEffect(() => {
    if (!image) return // the state starts as 'choose', and an image is never taken away
    let live = true
    let opened: DetectSession | null = null
    let unsubscribe = () => {}
    const run = async () => {
      setState({ phase: 'decoding' })
      const pixels = await decodeImage(image.file)
      if (!live) return
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
      const { session: s, result } = await client.open(pixels)
      opened = s
      if (!live) {
        void s?.close()
        return
      }
      session.current = s
      if (result.ok) setState({ phase: 'result', preview: result })
      else if (isDetectionError(result.code)) setState({ phase: 'failed', code: result.code })
      else if (result.code !== 'STALE') setState({ phase: 'error', message: `Detection stopped unexpectedly. (${result.code}: ${result.message})` })
    }
    run().catch((e: unknown) => {
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
  }, [image, attempt])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const s = session.current
    if (!repo || !s || !image || saving) return
    setSaving(true)
    try {
      const committed = await s.commit(cleanName(name) ?? image.name)
      if (!committed.ok) throw new Error(committed.message)
      const png = await sourcePng(image.file)
      const saved = await repo.save({ pattern: committed.pattern, progress: emptyProgress(), stage: 'work' }, { sourcePng: png })
      navigate(paths.work(saved.pattern.id))
    } catch (err) {
      setSaving(false)
      setNotices([{ tone: 'error', text: `Couldn't save the pattern: ${err instanceof Error ? err.message : String(err)}` }])
    }
  }

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

  return (
    <main className="screen import" {...drop.handlers}>
      <TopBar title="Import pattern" />
      <Notices notices={notices} />

      {state.phase === 'choose' ? (
        <div className="empty import__choose">
          <p>Choose a photo or screenshot of an alpha chart.</p>
          {another('Choose image…', true)}
          <p className="muted">PNG, JPEG or WebP. You can also drop an image here, or paste one.</p>
        </div>
      ) : (
        <div className="import__layout">
          <figure className="import__pane import__source">
            <figcaption>Your image</figcaption>
            {image && <SourceImage file={image.file} />}
          </figure>
          <section className="import__pane import__outcome" aria-live="polite" aria-busy={busy(state)}>
            <Outcome state={state} onRetry={() => setAttempt((n) => n + 1)} another={another} />
            {state.phase === 'result' && (
              <SaveForm name={name} onName={setName} saving={saving || !repo} onSubmit={save} another={another} />
            )}
          </section>
        </div>
      )}

      <DropOverlay show={drop.over} text="Drop a chart image to import it" />
    </main>
  )
}

const busy = (s: ImportState) => s.phase === 'decoding' || s.phase === 'booting' || s.phase === 'detecting'

function SourceImage({ file }: { file: Blob }) {
  const img = useBlobImage(file)
  return <img ref={img} alt="The image being imported" className="import__image" />
}

/** What the right-hand pane says: progress, the result, or why there isn't one. */
export function Outcome({
  state,
  onRetry,
  another,
}: {
  state: ImportState
  onRetry: () => void
  another: (label: string, primary?: boolean) => ReactNode
}) {
  switch (state.phase) {
    case 'choose':
      return null
    case 'decoding':
      return <p className="muted">Reading the image…</p>
    case 'booting':
      return <BootStatus progress={state.progress} />
    case 'detecting':
      return (
        <div className="import__status">
          <p>Finding the grid…</p>
          <progress aria-label="Finding the grid" />
        </div>
      )
    case 'result':
      return <Result preview={state.preview} />
    case 'failed': {
      const hint = hintFor(state.code)
      return (
        <div className="import__failure" role="alert">
          <p className="import__failure-title">{hint.title}</p>
          {hint.advice && <p>{hint.advice}</p>}
          <p>{another('Try another image', true)}</p>
          {/* The code is for a bug report, not for the person holding the yarn. */}
          <p className="import__code muted">Detection failed ({state.code})</p>
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

export function Result({ preview }: { preview: Preview }) {
  return (
    <div className="import__result">
      <p className="import__caption">Detected pattern</p>
      <PatternImage preview={preview} />
      <p className="import__stats">{formatStats(preview.cols, preview.rows, preview.palette.length)}</p>
      {preview.warnings.length > 0 && (
        <ul className="import__warnings" aria-label="Warnings">
          {preview.warnings.map((w, i) => (
            <li key={i}>
              <span aria-hidden="true">⚠ </span>
              {w}
            </li>
          ))}
        </ul>
      )}
      <h2 className="import__heading">Colours</h2>
      <ul className="import__palette" aria-label="Colours">
        {preview.palette.map((e) => (
          <li key={e.id}>
            <span className="import__swatch" style={{ background: e.hex }} aria-hidden="true" />
            <span className="import__colour">{e.name}</span>
            <span className="muted">
              {e.count} stitch{e.count === 1 ? '' : 'es'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The detected cells, one canvas pixel per cell (render/chart's cell image), scaled up
 *  with CSS. */
function PatternImage({ preview }: { preview: Preview }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    const cells = buildCellImage(preview)
    if (!c || !ctx || !cells) return
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(cells, 0, 0)
  }, [preview])
  return (
    <canvas
      ref={canvas}
      className="import__pattern"
      width={preview.cols}
      height={preview.rows}
      style={{ '--aspect': preview.cols / preview.rows } as CSSProperties}
      role="img"
      aria-label={`The detected pattern: ${preview.cols} columns by ${preview.rows} rows`}
    />
  )
}

function SaveForm({
  name,
  onName,
  saving,
  onSubmit,
  another,
}: {
  name: string
  onName: (name: string) => void
  saving: boolean
  onSubmit: (e: FormEvent) => void
  another: (label: string, primary?: boolean) => ReactNode
}) {
  const id = useId()
  return (
    <form className="import__save" onSubmit={onSubmit}>
      <label htmlFor={`${id}-name`}>Name</label>
      <input
        id={`${id}-name`}
        value={name}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => onName(e.target.value)}
      />
      <div className="import__actions">
        <button type="submit" className="button button--primary" disabled={saving || cleanName(name) === null}>
          Save &amp; start working
        </button>
        {another('Choose another image')}
      </div>
    </form>
  )
}
