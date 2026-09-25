/**
 * The messages between the app and the detection worker (worker.ts), and the shapes of
 * what alphareader/core/bridge.py returns. Only plain data and typed arrays cross; the
 * typed arrays are transferred, not copied.
 */
import type { PaletteEntry, Pattern } from '../model/types.ts'

/** Boot happens in three stages, in this order. */
export type BootStage = 'runtime' | 'numpy' | 'core'

/** DetectionError's codes (core/model.py), then the bridge's and the worker's own. */
export type DetectionErrorCode = 'NO_GRIDLINES' | 'LOW_RESOLUTION' | 'ROTATED' | 'TOO_SMALL'
export type FailureCode =
  | DetectionErrorCode
  /** bridge.py: an id the worker doesn't know, or was closed. */
  | 'NO_SESSION'
  /** bridge.py: the last detection failed, so there's nothing to preview or save. */
  | 'NO_DETECTION'
  /** bridge.py: the pixels don't match the stated size. */
  | 'BAD_IMAGE'
  /** Pyodide failed to load. */
  | 'BOOT_FAILED'
  /** Python raised something unexpected. A bug. */
  | 'INTERNAL'
  /** The worker died or was terminated with this request outstanding. */
  | 'WORKER_GONE'
  /** A newer request was sent before this one was answered (client.ts). */
  | 'STALE'

export interface Failure {
  ok: false
  code: FailureCode
  message: string
  /** Set when an open's detection failed: the session is still open for a retry. */
  session?: number
}

export const DETECTION_ERROR_CODES: readonly DetectionErrorCode[] = [
  'NO_GRIDLINES',
  'LOW_RESOLUTION',
  'ROTATED',
  'TOO_SMALL',
]

export const isDetectionError = (code: FailureCode): code is DetectionErrorCode =>
  (DETECTION_ERROR_CODES as readonly string[]).includes(code)

/** A rectangle in source-image pixels. */
export interface Extent {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** bridge.preview: the detected (or adjusted) pattern, before it is saved. */
export interface Preview {
  ok: true
  session: number
  rows: number
  cols: number
  /** Palette indices, row-major, rows * cols. */
  cells: Uint16Array
  /** 0..1 per cell, row-major. Below 0.6 is "unsure". */
  confidence: Float32Array
  palette: PaletteEntry[]
  warnings: string[]
  lowConfidenceFraction: number
  /** The grid's bounding box, in the image's own pixels. */
  extent: Extent
  rowLines: Float64Array
  colLines: Float64Array
  deltaE: number
  imageWidth: number
  imageHeight: number
  /** How much the image was shrunk before detection (1 = not at all). */
  scale: number
}

export type Outcome<T> = T | Failure

/** Settings a preview can be adjusted by (bridge.set_params). */
export interface Params {
  rows?: number
  cols?: number
  deltaE?: number
  extent?: Extent
}

// --- messages -------------------------------------------------------------------------------

export type Request =
  | { id: number; type: 'boot' }
  | { id: number; type: 'open'; rgba: Uint8Array; width: number; height: number; deltaE?: number; maxEdge?: number }
  | { id: number; type: 'redetect'; session: number; crop?: [number, number, number, number] }
  /** bridge.set_params then bridge.preview, in one round trip. */
  | { id: number; type: 'update'; session: number; params: Params }
  | { id: number; type: 'preview'; session: number }
  | { id: number; type: 'commit'; session: number; name: string }
  | { id: number; type: 'close'; session: number }
  /** Diagnostics: the size of Pyodide's memory, which only ever grows. */
  | { id: number; type: 'stats' }

export type RequestType = Request['type']

export interface Stats {
  ok: true
  /** Bytes of WebAssembly memory: the peak Pyodide has needed so far. */
  wasmMemoryBytes: number
}

/** What each request answers with, when it succeeds. */
export interface Answers {
  boot: { ok: true }
  open: Preview
  redetect: Preview
  update: Preview
  preview: Preview
  commit: { ok: true; pattern: Pattern }
  close: { ok: true }
  stats: Stats
}

export type Response = { id: number; type: 'response'; result: Outcome<Answers[RequestType]> }

export interface BootProgress {
  type: 'progress'
  stage: BootStage
  /** Bytes downloaded so far, across all stages, and the expected total. */
  loaded: number
  total: number
}

export type WorkerMessage = Response | BootProgress
