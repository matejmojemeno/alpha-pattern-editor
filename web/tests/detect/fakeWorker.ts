/**
 * A stand-in for the detection worker: records what the client sends and answers when
 * told to, or at once through `auto`.
 */
import type { WorkerLike } from '../../src/detect/client.ts'
import type { BootProgress, Outcome, Preview, Request, WorkerMessage } from '../../src/detect/protocol.ts'
import type { PaletteEntry } from '../../src/model/types.ts'

type Answer = Outcome<object>

export class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<WorkerMessage>) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  sent: { msg: Request; transfer: Transferable[] }[] = []
  terminated = false
  /** Answer each request immediately (on a microtask) with this, if set. */
  auto: ((msg: Request) => Answer | undefined) | null = null

  postMessage(msg: Request, transfer: Transferable[]): void {
    this.sent.push({ msg, transfer })
    const answer = this.auto?.(msg)
    if (answer) queueMicrotask(() => this.reply(msg.id, answer))
  }

  terminate(): void {
    this.terminated = true
  }

  reply(id: number, result: Answer): void {
    this.onmessage?.({ data: { id, type: 'response', result } } as MessageEvent<WorkerMessage>)
  }

  progress(p: Omit<BootProgress, 'type'>): void {
    this.onmessage?.({ data: { type: 'progress', ...p } } as MessageEvent<WorkerMessage>)
  }

  /** The requests of one type, in order. */
  of<T extends Request['type']>(type: T): Extract<Request, { type: T }>[] {
    return this.sent.map((s) => s.msg).filter((m): m is Extract<Request, { type: T }> => m.type === type)
  }

  fail(): void {
    this.onerror?.(new Event('error'))
  }
}

const PALETTE: PaletteEntry[] = [
  { id: 'p0', hex: '#ffffff', name: 'White', dmc: 'White', count: 0 },
  { id: 'p1', hex: '#8b4513', name: 'Brown', dmc: '300', count: 0 },
]

/** A preview as bridge.preview returns it: a two-colour checkerboard. */
export function makePreview(session: number, rows = 3, cols = 4, over: Partial<Preview> = {}): Preview {
  const cells = new Uint16Array(rows * cols).map((_, i) => (Math.floor(i / cols) + (i % cols)) % 2)
  const palette = PALETTE.map((e, k) => ({ ...e, count: cells.filter((c) => c === k).length }))
  return {
    ok: true,
    session,
    rows,
    cols,
    cells,
    confidence: new Float32Array(rows * cols).fill(1),
    palette,
    warnings: [],
    lowConfidenceFraction: 0,
    extent: { x0: 0, y0: 0, x1: cols * 10, y1: rows * 10 },
    rowLines: new Float64Array(rows + 1).map((_, i) => i * 10),
    colLines: new Float64Array(cols + 1).map((_, i) => i * 10),
    deltaE: 6,
    imageWidth: cols * 10,
    imageHeight: rows * 10,
    detectedWidth: cols * 10,
    detectedHeight: rows * 10,
    ...over,
  }
}

/** A worker that boots at once and detects every image as `makePreview`, or fails
 *  with `failWith`. */
export function detectingWorker({ failWith }: { failWith?: string } = {}): FakeWorker {
  const w = new FakeWorker()
  let sessions = 0
  w.auto = (msg) => {
    switch (msg.type) {
      case 'boot':
      case 'close':
        return { ok: true }
      case 'open': {
        const session = ++sessions
        return failWith ? { ok: false, code: failWith, message: `failed: ${failWith}`, session } : makePreview(session)
      }
      case 'commit':
        return {
          ok: true,
          pattern: {
            id: 'pattern-1',
            name: msg.name,
            created_at: 1_800_000_000,
            updated_at: 1_800_000_000,
            rows: 3,
            cols: 4,
            row_ids: ['r0', 'r1', 'r2'],
            cells: makePreview(msg.session).cells,
            palette: makePreview(msg.session).palette,
            start_direction: 'RTL',
            alternate_direction: true,
            bottom_up: true,
          },
        }
      default:
        return undefined
    }
  }
  return w
}
