/**
 * The app's side of the detection worker (worker.ts). Everything here answers with data:
 * a failure, including a detection failure, a worker that died, or a stale answer,
 * resolves as `{ ok: false, code, message }` and never rejects.
 *
 * - Each request carries an increasing id.
 * - Stale answers are dropped. An `open` answered after a newer `open` was sent is
 *   stale, and its session is closed. Within a session, a preview answered after a newer
 *   one was requested is stale, so the screen never steps back to an older result.
 * - `update` sends the first change at once. While it is in flight, further changes are
 *   folded into one pending request, so a slider drag costs two or three resamples and
 *   the preview still moves on the first tick (docs/web-port-plan.md, "Cancellation").
 * - Pixels are transferred to the worker, not copied.
 * - Detection (`open`, `redetect`) runs under a watchdog. A photo no fitter reads cleanly
 *   can keep Python busy for a long time, and Pyodide can't be interrupted without
 *   SharedArrayBuffer, so past the budget the worker is simply terminated: everything
 *   outstanding answers TIMEOUT, and the next `detector()` starts a fresh worker.
 *
 * Only reached through a dynamic import (app/detection.ts), so no screen but the import
 * screen ever loads it.
 */
import type {
  Answers,
  BootProgress,
  Crop,
  Failure,
  Outcome,
  Params,
  Preview,
  Request,
  RequestType,
  WorkerMessage,
} from './protocol.ts'

/** What DetectClient needs from a Worker; tests pass a fake. */
export interface WorkerLike {
  postMessage(message: Request, transfer: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkerMessage>) => void) | null
  onerror: ((e: Event) => void) | null
  terminate(): void
}

/** A request without its id: the client assigns ids. */
type Body = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never
type BodyOf<T extends RequestType> = Extract<Body, { type: T }>

export interface RgbaImage {
  rgba: Uint8Array
  width: number
  height: number
}

/**
 * Images with more pixels than this are shrunk by a whole-number factor before detection
 * (bridge.shrink_factor), just enough to fit. Detection's memory grows with the pixel
 * count, and a 4000 × 3000 phone photo needs over 500 MB of WebAssembly memory at full
 * size. Shrinking by the smallest whole factor keeps as much resolution as memory allows;
 * see scripts/downscale_study.py for why it's a pixel budget and a whole factor. The saved
 * source image stays full size.
 */
export const DEFAULT_MAX_PIXELS = 4_000_000

/** How long one detection may take before the worker is terminated. Real charts take
 *  0.1–6 s in Chromium on a laptop; a phone is a few times slower. */
export const DETECT_BUDGET_MS = 20_000

export interface OpenOptions {
  deltaE?: number
  /** Shrink an image with more pixels than this before detecting it; 0 never shrinks. */
  maxPixels?: number
  /** Detect only this part of the image (image pixels), as a crop does. */
  crop?: Crop
}

/**
 * Test hooks (e2e/corrections.spec.ts sets them with an init script; the app never does):
 * make every detection take `delayMs` longer, and change the watchdog's budget.
 */
export interface DetectTestHooks {
  delayMs?: number
  budgetMs?: number
}

function testHooks(): DetectTestHooks {
  return (globalThis as { __alphaDetectTest?: DetectTestHooks }).__alphaDetectTest ?? {}
}

const failure = (code: Failure['code'], message: string, session?: number): Failure =>
  session === undefined ? { ok: false, code, message } : { ok: false, code, message, session }

export class DetectClient {
  private worker: WorkerLike | null = null
  private dead = false
  private nextId = 1
  private readonly waiting = new Map<number, (r: Outcome<Answers[RequestType]>) => void>()
  private readonly progressListeners = new Set<(p: BootProgress) => void>()
  private booted: Promise<Outcome<{ ok: true }>> | null = null
  private newestOpen = 0
  /** The latest boot progress, for a screen that starts listening late. */
  progress: BootProgress | null = null

  private readonly createWorker: () => WorkerLike
  private readonly budgetMs: number

  /** `budgetMs`: how long a detection may run before the worker is terminated. */
  constructor(createWorker: () => WorkerLike, { budgetMs }: { budgetMs?: number } = {}) {
    this.createWorker = createWorker
    this.budgetMs = budgetMs ?? testHooks().budgetMs ?? DETECT_BUDGET_MS
  }

  private ensureWorker(): WorkerLike | null {
    if (this.dead) return null
    if (!this.worker) {
      const w = this.createWorker()
      w.onmessage = (e) => this.receive(e.data)
      w.onerror = (e) => {
        const message = e instanceof ErrorEvent && e.message ? e.message : 'The detection worker stopped.'
        this.dispose(message)
      }
      this.worker = w
    }
    return this.worker
  }

  private receive(msg: WorkerMessage): void {
    if (msg.type === 'progress') {
      this.progress = msg
      for (const l of [...this.progressListeners]) l(msg)
      return
    }
    const resolve = this.waiting.get(msg.id)
    if (!resolve) return // already settled (the client was disposed)
    this.waiting.delete(msg.id)
    resolve(msg.result)
  }

  /** Send one request. Returns its id and its answer. A `watched` request (a detection)
   *  must be answered within the budget, or the worker is terminated. */
  send<B extends Body>(
    body: B,
    transfer: Transferable[] = [],
    { watched = false }: { watched?: boolean } = {},
  ): { id: number; answer: Promise<Outcome<Answers[B['type']]>> } {
    const id = this.nextId++
    const worker = this.ensureWorker()
    if (!worker) return { id, answer: Promise.resolve(failure('WORKER_GONE', 'The detection worker has been closed.')) }
    let answer = new Promise<Outcome<Answers[B['type']]>>((resolve) => {
      this.waiting.set(id, resolve as (r: Outcome<Answers[RequestType]>) => void)
    })
    let message = { ...body, id } as Request
    if (watched) {
      const { delayMs } = testHooks()
      if (delayMs) message = { ...message, delayMs } as Request
      const seconds = Math.round(this.budgetMs / 1000)
      const timer = setTimeout(() => this.dispose(`Detection took longer than ${seconds} s and was stopped.`, 'TIMEOUT'), this.budgetMs)
      answer = answer.finally(() => clearTimeout(timer))
    }
    worker.postMessage(message, transfer)
    return { id, answer }
  }

  request<B extends Body>(body: B, transfer: Transferable[] = []): Promise<Outcome<Answers[B['type']]>> {
    return this.send(body, transfer).answer
  }

  /** Be told how the download is going. Returns the unsubscribe function. */
  onProgress(listener: (p: BootProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => void this.progressListeners.delete(listener)
  }

  /** Start Pyodide if it isn't already. Safe to call any number of times. */
  boot(): Promise<Outcome<{ ok: true }>> {
    if (!this.booted) {
      const p = this.request({ type: 'boot' })
      this.booted = p
      // A failed boot can be retried by calling boot() again.
      void p.then((r) => {
        if (!r.ok && this.booted === p) this.booted = null
      })
    }
    return this.booted
  }

  /**
   * Detect an image. The pixels are transferred: `image.rgba` is unusable afterwards.
   * The session is returned even when detection fails, so it can be retried with a crop;
   * it is null only when there's no session at all (bad input, a dead worker, or a newer
   * `open` superseded this one).
   */
  async open(image: RgbaImage, opts: OpenOptions = {}): Promise<{ session: DetectSession | null; result: Outcome<Preview> }> {
    const { deltaE, maxPixels = DEFAULT_MAX_PIXELS, crop } = opts
    const { id, answer } = this.send<BodyOf<'open'>>(
      {
        type: 'open',
        rgba: image.rgba,
        width: image.width,
        height: image.height,
        ...(deltaE === undefined ? {} : { deltaE }),
        ...(maxPixels > 0 ? { maxPixels } : {}),
        ...(crop ? { crop } : {}),
      },
      [image.rgba.buffer],
      { watched: true },
    )
    this.newestOpen = id
    const result = await answer
    const sid = result.session
    if (id !== this.newestOpen) {
      if (sid !== undefined) void this.request({ type: 'close', session: sid })
      return { session: null, result: failure('STALE', 'A newer image was opened.') }
    }
    return { session: sid === undefined ? null : new DetectSession(this, sid, result.ok ? result : null), result }
  }

  /** Terminate the worker, freeing Pyodide's memory. Outstanding requests are answered
   *  with `code` (TIMEOUT when the watchdog did it); the client can't be used again. */
  dispose(message = 'The detection worker has been closed.', code: 'WORKER_GONE' | 'TIMEOUT' = 'WORKER_GONE'): void {
    this.dead = true
    this.worker?.terminate()
    this.worker = null
    const waiting = [...this.waiting.values()]
    this.waiting.clear()
    for (const resolve of waiting) resolve(failure(code, message))
    this.progressListeners.clear()
  }

  get disposed(): boolean {
    return this.dead
  }
}

interface PendingUpdate {
  params: Params
  promise: Promise<Outcome<Preview>>
  resolve: (r: Outcome<Preview>) => void
}

/** One image being confirmed: a ConfirmState in the worker (bridge.py). */
export class DetectSession {
  /** The newest preview this session has shown, if any. */
  latest: Preview | null
  private newestView = 0
  private updating = false
  private pending: PendingUpdate | null = null
  private closed = false

  private readonly client: DetectClient
  readonly id: number

  constructor(client: DetectClient, id: number, first: Preview | null) {
    this.client = client
    this.id = id
    this.latest = first
  }

  /** Send a request whose answer replaces the preview; drop it if a newer one was sent. */
  private async view(body: BodyOf<'update' | 'preview' | 'redetect'>): Promise<Outcome<Preview>> {
    const { id, answer } = this.client.send(body, [], { watched: body.type === 'redetect' })
    this.newestView = id
    const result = await answer
    if (id !== this.newestView) return failure('STALE', 'A newer preview was requested.')
    if (result.ok) this.latest = result
    return result
  }

  /** Change settings and resample. Changes made while one is in flight are folded into
   *  the next; every caller gets the preview their change ended up in. */
  update(params: Params): Promise<Outcome<Preview>> {
    if (this.pending) {
      Object.assign(this.pending.params, params)
      return this.pending.promise
    }
    if (!this.updating) return this.sendUpdate(params)
    let resolve!: (r: Outcome<Preview>) => void
    const promise = new Promise<Outcome<Preview>>((r) => (resolve = r))
    this.pending = { params: { ...params }, promise, resolve }
    return promise
  }

  private sendUpdate(params: Params): Promise<Outcome<Preview>> {
    this.updating = true
    const p = this.view({ type: 'update', session: this.id, params })
    void p.then(() => {
      this.updating = false
      const next = this.pending
      if (!next) return
      this.pending = null
      void this.sendUpdate(next.params).then(next.resolve)
    })
    return p
  }

  preview(): Promise<Outcome<Preview>> {
    return this.view({ type: 'preview', session: this.id })
  }

  /** Full detection again, on the whole image or a crop (image pixels), at `deltaE` if
   *  given. Any pending update is dropped: detection resets the grid it would have
   *  changed, and the colour detail travels with this request instead. */
  redetect(crop?: Crop, { deltaE }: { deltaE?: number } = {}): Promise<Outcome<Preview>> {
    const dropped = this.pending
    this.pending = null
    dropped?.resolve(failure('STALE', 'Superseded by a new detection.'))
    return this.view({
      type: 'redetect',
      session: this.id,
      ...(crop ? { crop } : {}),
      ...(deltaE === undefined ? {} : { deltaE }),
    })
  }

  commit(name: string): Promise<Outcome<Answers['commit']>> {
    return this.client.request({ type: 'commit', session: this.id, name })
  }

  /** Free the session's image in the worker. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (!this.client.disposed) await this.client.request({ type: 'close', session: this.id })
  }
}

// --- the app's one detector -------------------------------------------------------------------

let shared: DetectClient | null = null

export function detector(): DetectClient {
  if (!shared || shared.disposed) {
    shared = new DetectClient(
      () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'detect' }) as WorkerLike,
    )
  }
  return shared
}

/** Start downloading Pyodide ahead of need (the pointer is on "Import pattern"). */
export function preload(): void {
  void detector().boot()
}

/** Terminate the worker, if there is one. */
export function release(): void {
  shared?.dispose()
  shared = null
}
