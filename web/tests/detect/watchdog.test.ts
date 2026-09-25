/**
 * Phase 2, part 2 in the client: a slider drag folded into two resamples, the colour
 * detail travelling with a redetect, and the watchdog that terminates a worker stuck in
 * detection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DETECT_BUDGET_MS, DetectClient } from '../../src/detect/client.ts'
import type { Outcome, Preview } from '../../src/detect/protocol.ts'
import { FakeWorker, makePreview } from './fakeWorker.ts'

const flush = () => new Promise((r) => setTimeout(r, 0))
const image = (w = 4, h = 3) => ({ rgba: new Uint8Array(w * h * 4), width: w, height: h })

async function opened() {
  const worker = new FakeWorker()
  const client = new DetectClient(() => worker)
  const pending = client.open(image())
  worker.reply(worker.of('open')[0]!.id, makePreview(7))
  const { session } = await pending
  return { worker, client, session: session! }
}

describe('coalescing a slider drag', () => {
  it('40 ticks cost two resamples, and the preview moves on the first', async () => {
    const { session, worker } = await opened()
    const answers: Promise<Outcome<Preview>>[] = []
    for (let tick = 0; tick < 40; tick++) answers.push(session.update({ deltaE: 15 - (tick % 14) }))
    let updates = worker.of('update')
    expect(updates).toHaveLength(1) // the first tick went at once
    worker.reply(updates[0]!.id, makePreview(7, 3, 4, { deltaE: 15 }))
    expect(await answers[0]!).toMatchObject({ ok: true, deltaE: 15 })
    expect(session.latest?.deltaE).toBe(15)
    await flush()
    updates = worker.of('update')
    expect(updates).toHaveLength(2)
    expect(updates[1]!.params).toEqual({ deltaE: 15 - (39 % 14) }) // only the last tick's value
    worker.reply(updates[1]!.id, makePreview(7, 3, 4, { deltaE: 4 }))
    const rest = await Promise.all(answers.slice(1))
    expect(new Set(rest).size).toBe(1) // every later tick got the one folded answer
    expect(worker.of('update')).toHaveLength(2)
  })

  it('a redetect carries the colour detail, so a folded change is not lost', async () => {
    const { session, worker } = await opened()
    void session.update({ rows: 5 })
    void session.update({ deltaE: 9 }) // waiting, then dropped by the redetect
    void session.redetect([1, 2, 30, 40], { deltaE: 9 })
    expect(worker.of('redetect')[0]).toMatchObject({ crop: [1, 2, 30, 40], deltaE: 9 })
    void session.redetect()
    expect(worker.of('redetect')[1]).not.toHaveProperty('crop')
    expect(worker.of('redetect')[1]).not.toHaveProperty('deltaE')
  })
})

describe('the watchdog', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as { __alphaDetectTest?: unknown }).__alphaDetectTest
  })

  function slowClient(budgetMs = 1000) {
    const worker = new FakeWorker()
    const client = new DetectClient(() => worker, { budgetMs })
    return { worker, client }
  }

  it('terminates the worker when detection runs past the budget, and says so as data', async () => {
    vi.useFakeTimers()
    const { worker, client } = slowClient()
    const opening = client.open(image(), { crop: [0, 0, 2, 2] })
    const other = client.request({ type: 'stats' }) // outstanding too: the worker is gone
    expect(worker.of('open')[0]).toMatchObject({ crop: [0, 0, 2, 2] })
    await vi.advanceTimersByTimeAsync(999)
    expect(worker.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(worker.terminated).toBe(true)
    expect(client.disposed).toBe(true)
    const { session, result } = await opening
    expect(session).toBeNull()
    expect(result).toMatchObject({ ok: false, code: 'TIMEOUT', message: expect.stringMatching(/longer than 1 s/) })
    expect(await other).toMatchObject({ ok: false, code: 'TIMEOUT' })
  })

  it('stands down once detection answers', async () => {
    vi.useFakeTimers()
    const { worker, client } = slowClient()
    const opening = client.open(image())
    await vi.advanceTimersByTimeAsync(900)
    worker.reply(worker.of('open')[0]!.id, makePreview(3))
    await opening
    await vi.advanceTimersByTimeAsync(5000)
    expect(worker.terminated).toBe(false)
  })

  it('watches a redetect, but never a resample', async () => {
    vi.useFakeTimers()
    const { worker, client } = slowClient()
    const opening = client.open(image())
    worker.reply(worker.of('open')[0]!.id, makePreview(3))
    const { session } = await opening
    void session!.update({ rows: 4 }) // never answered
    await vi.advanceTimersByTimeAsync(5000)
    expect(worker.terminated).toBe(false)
    const redetecting = session!.redetect()
    await vi.advanceTimersByTimeAsync(1000)
    expect(worker.terminated).toBe(true)
    expect(await redetecting).toMatchObject({ code: 'TIMEOUT' })
  })

  it('takes its budget, a detection delay and filling memory from the test hook', () => {
    ;(globalThis as { __alphaDetectTest?: unknown }).__alphaDetectTest = { delayMs: 5000, budgetMs: 250, fillMemory: true }
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const client = new DetectClient(() => worker)
    void client.open(image())
    void client.request({ type: 'boot' })
    expect(worker.of('open')[0]).toMatchObject({ delayMs: 5000, fillMemory: true })
    expect(worker.of('boot')[0]).not.toHaveProperty('delayMs')
    expect(worker.of('boot')[0]).not.toHaveProperty('fillMemory')
    vi.advanceTimersByTime(250)
    expect(worker.terminated).toBe(true)
  })

  it('defaults to 20 s', async () => {
    expect(DETECT_BUDGET_MS).toBe(20_000)
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const client = new DetectClient(() => worker)
    void client.open(image())
    await vi.advanceTimersByTimeAsync(DETECT_BUDGET_MS - 1)
    expect(worker.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(worker.terminated).toBe(true)
  })
})

describe('running out of memory', () => {
  it('terminates the worker, to give its memory back, and says so as data', async () => {
    const worker = new FakeWorker()
    const client = new DetectClient(() => worker)
    const opening = client.open(image())
    const other = client.request({ type: 'stats' })
    worker.reply(worker.of('open')[0]!.id, { ok: false, code: 'OUT_OF_MEMORY', message: 'Ran out of memory: 1.7 GiB', session: 1 })
    expect(await opening).toMatchObject({ result: { code: 'OUT_OF_MEMORY', message: expect.stringMatching(/1.7 GiB/) } })
    expect(worker.terminated).toBe(true)
    expect(client.disposed).toBe(true)
    expect(await other).toMatchObject({ ok: false, code: 'OUT_OF_MEMORY' })
  })

  it('terminates a worker whose Pyodide suffered a fatal error, so a retry starts afresh', async () => {
    const worker = new FakeWorker()
    const client = new DetectClient(() => worker)
    const opening = client.open(image())
    worker.reply(worker.of('open')[0]!.id, { ok: false, code: 'INTERNAL', message: 'unreachable', fatal: true })
    expect(await opening).toMatchObject({ result: { code: 'INTERNAL' } })
    expect(worker.terminated).toBe(true)
    expect(client.disposed).toBe(true)
  })
})

describe('idle', () => {
  it('waits for the change in flight and the one folded behind it', async () => {
    const { session, worker } = await opened()
    await session.idle() // nothing outstanding
    void session.update({ rows: 5 })
    void session.update({ rows: 6 })
    let idle = false
    void session.idle().then(() => (idle = true))
    worker.reply(worker.of('update')[0]!.id, makePreview(7, 5, 4))
    await flush()
    expect(idle).toBe(false) // the folded change has only now been sent
    worker.reply(worker.of('update')[1]!.id, makePreview(7, 6, 4))
    await flush()
    expect(idle).toBe(true)
    expect(session.latest?.rows).toBe(6)
  })
})
