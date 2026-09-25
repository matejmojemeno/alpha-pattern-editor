/**
 * The detection worker: Pyodide, numpy and alphareader/core/bridge.py, off the main
 * thread (docs/web-port-plan.md, Phase 2). A module worker, started by client.ts only
 * when an image is imported, and terminated when the import screen closes.
 *
 * Requests are handled one at a time, in order. Every answer is plain data: the bridge's
 * results are converted with `create_pyproxies: false`, which throws rather than let a
 * PyProxy through, and the typed arrays in them are transferred back.
 *
 * Boot reports progress in three stages (runtime, numpy, core) as bytes arrive. The
 * runtime's own fetches are counted through a wrapper around `fetch`; files it pulls in
 * with `import()` are counted when their stage completes. The expected sizes come from
 * the build (scripts/detectAssets.ts).
 */
import type { PyodideAPI } from 'pyodide'
import { coreBundle, packages, pyodideDir, stageBytes } from 'virtual:detect-assets'

import type { Answers, BootStage, Failure, Outcome, Request, WorkerMessage } from './protocol.ts'

interface WorkerScope {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<Request>) => void) | null
  fetch: typeof fetch
  location: Location
}
const scope = globalThis as unknown as WorkerScope

/** A Python callable, as far as this file uses one. */
interface PyFn {
  (...args: unknown[]): PyResult
  callKwargs(...args: unknown[]): PyResult
}
interface PyResult {
  toJs(opts: { dict_converter: typeof Object.fromEntries; create_pyproxies: false }): unknown
  destroy(): void
}
type Bridge = Record<
  'open_session' | 'redetect' | 'set_params' | 'preview' | 'commit' | 'close_session',
  PyFn
>

const siteUrl = (path: string) => new URL(import.meta.env.BASE_URL + path, scope.location.origin).href

// --- boot -----------------------------------------------------------------------------------

const STAGES: readonly BootStage[] = ['runtime', 'numpy', 'core']
const total = STAGES.reduce((n, s) => n + stageBytes[s], 0)
let stage: BootStage = 'runtime'
let loaded = 0

function progress() {
  scope.postMessage({ type: 'progress', stage, loaded: Math.min(loaded, total), total })
}

function enterStage(next: BootStage) {
  // Whatever the previous stage fetched without `fetch` (module imports) is done now.
  const before = STAGES.slice(0, STAGES.indexOf(next)).reduce((n, s) => n + stageBytes[s], 0)
  loaded = Math.max(loaded, before)
  stage = next
  progress()
}

/** Count bytes as the runtime downloads them. The body is passed through untouched,
 *  headers included, so WebAssembly.instantiateStreaming still sees application/wasm. */
function countDownloads() {
  const realFetch = scope.fetch.bind(scope)
  scope.fetch = async (input, init) => {
    const res = await realFetch(input, init)
    if (!res.body) return res
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        loaded += chunk.byteLength
        progress()
        ctl.enqueue(chunk)
      },
    })
    return new Response(res.body.pipeThrough(counter), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
}

let booting: Promise<{ py: PyodideAPI; bridge: Bridge }> | undefined

function boot() {
  booting ??= (async () => {
    countDownloads()
    const indexURL = siteUrl(pyodideDir)
    enterStage('runtime')
    // Loaded from the self-hosted copy, never bundled: the glue must match the .wasm
    // beside it, and keeping it out of the build keeps Pyodide out of every app chunk.
    const { loadPyodide } = (await import(/* @vite-ignore */ indexURL + 'pyodide.mjs')) as typeof import('pyodide')
    const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} })

    enterStage('numpy')
    await py.loadPackage([...packages], { messageCallback: () => {}, errorCallback: () => {} })

    enterStage('core')
    const res = await scope.fetch(siteUrl(coreBundle))
    if (!res.ok) throw new Error(`Couldn't download ${coreBundle}: HTTP ${res.status}`)
    py.unpackArchive(await res.arrayBuffer(), 'zip', { extractDir: '/home/pyodide/core' })
    py.runPython("import sys; sys.path.insert(0, '/home/pyodide/core')")
    const bridge = py.pyimport('alphareader.core.bridge') as unknown as Bridge
    loaded = total
    progress()
    return { py, bridge }
  })()
  return booting
}

// --- requests -------------------------------------------------------------------------------

const fail = (code: Failure['code'], message: string): Failure => ({ ok: false, code, message })

/** Convert a bridge result to plain JavaScript and free the Python object. */
function plain(result: PyResult): Record<string, unknown> {
  try {
    const js = result.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false })
    return normalise(js) as Record<string, unknown>
  } finally {
    result.destroy()
  }
}

/** Python's None arrives as undefined; the model uses null (PaletteEntry.dmc). */
function normalise(v: unknown): unknown {
  if (v === undefined) return null
  if (Array.isArray(v)) return v.map(normalise)
  if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalise(x)]))
  }
  return v
}

/** The buffers of every typed array in a result, to transfer rather than copy. */
function buffersOf(v: unknown, out: Transferable[] = []): Transferable[] {
  if (ArrayBuffer.isView(v)) {
    if (!out.includes(v.buffer)) out.push(v.buffer as ArrayBuffer)
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) buffersOf(x, out)
  }
  return out
}

async function handle(req: Request): Promise<Outcome<Answers[Request['type']]>> {
  let env: Awaited<ReturnType<typeof boot>>
  try {
    env = await boot()
  } catch (e) {
    booting = undefined // let a later request try again
    return fail('BOOT_FAILED', e instanceof Error ? e.message : String(e))
  }
  const { py, bridge: b } = env
  // Python copies of JavaScript arguments, freed once the call returns.
  const toPy = (v: unknown) => {
    const p = py.toPy(v) as { destroy(): void }
    made.push(p)
    return p
  }
  const made: { destroy(): void }[] = []
  try {
    return call()
  } finally {
    made.forEach((p) => p.destroy())
  }

  function call(): Outcome<Answers[Request['type']]> {
    switch (req.type) {
      case 'boot':
        return { ok: true }
      // Only the arguments that are set: JavaScript's null arrives in Python as JsNull,
      // not None, so an absent value must be left out rather than passed as null.
      case 'open':
        stall(req.delayMs)
        return plain(
          b.open_session.callKwargs(req.rgba, req.width, req.height, {
            delta_e: req.deltaE ?? 6.0,
            ...(req.maxPixels ? { max_pixels: req.maxPixels } : {}),
            ...(req.crop ? { crop: toPy(req.crop) } : {}),
          }),
        ) as never
      case 'redetect':
        stall(req.delayMs)
        return plain(
          b.redetect.callKwargs(req.session, {
            ...(req.crop ? { crop: toPy(req.crop) } : {}),
            ...(req.deltaE === undefined ? {} : { delta_e: req.deltaE }),
          }),
        ) as never
      case 'update': {
        const { rows, cols, deltaE, extent } = req.params
        const kwargs: Record<string, unknown> = {}
        if (rows !== undefined) kwargs.rows = rows
        if (cols !== undefined) kwargs.cols = cols
        if (deltaE !== undefined) kwargs.delta_e = deltaE
        if (extent !== undefined) kwargs.extent = toPy(extent)
        const set = plain(b.set_params.callKwargs(req.session, kwargs))
        if (set.ok !== true) return set as unknown as Failure
        return plain(b.preview(req.session)) as never
      }
      case 'preview':
        return plain(b.preview(req.session)) as never
      case 'commit':
        return plain(b.commit(req.session, req.name)) as never
      case 'close':
        return plain(b.close_session(req.session)) as never
      case 'stats': {
        const heap = (py as unknown as { _module?: { HEAP8?: Uint8Array } })._module?.HEAP8
        return { ok: true, wasmMemoryBytes: heap?.byteLength ?? 0 }
      }
    }
  }
}

/** The test hook behind `delayMs` (client.ts, DetectTestHooks): hold the thread without
 *  yielding, as a long-running detection does, so only terminating the worker ends it. */
function stall(ms: number | undefined) {
  if (!ms) return
  const until = performance.now() + ms
  while (performance.now() < until) {
    // busy
  }
}

let queue: Promise<void> = Promise.resolve()

scope.onmessage = (e) => {
  const req = e.data
  queue = queue.then(async () => {
    let result: Outcome<Answers[Request['type']]>
    try {
      result = await handle(req)
    } catch (err) {
      // A Python exception the bridge didn't turn into data: a bug, but still an answer.
      result = fail('INTERNAL', err instanceof Error ? err.message : String(err))
    }
    scope.postMessage({ id: req.id, type: 'response', result }, buffersOf(result))
  })
}
