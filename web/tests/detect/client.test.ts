/**
 * The detection client's protocol, against a fake worker: request ids, transfers, stale
 * answers dropped, updates folded while one is in flight, and every failure as data.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_MAX_EDGE, DetectClient, DetectSession } from '../../src/detect/client.ts'
import type { Outcome, Preview } from '../../src/detect/protocol.ts'
import { FakeWorker, makePreview } from './fakeWorker.ts'

const flush = () => new Promise((r) => setTimeout(r, 0))

function setup() {
  const worker = new FakeWorker()
  let created = 0
  const client = new DetectClient(() => {
    created++
    return worker
  })
  return { worker, client, created: () => created }
}

const image = (w = 4, h = 3) => ({ rgba: new Uint8Array(w * h * 4), width: w, height: h })

/** Open a session whose first preview is already in. */
async function opened() {
  const s = setup()
  const pending = s.client.open(image())
  const req = s.worker.of('open')[0]!
  s.worker.reply(req.id, makePreview(7))
  const { session } = await pending
  return { ...s, session: session! }
}

describe('DetectClient', () => {
  it('starts no worker until asked for something', () => {
    const { created } = setup()
    expect(created()).toBe(0)
  })

  it('gives every request a new, increasing id', async () => {
    const { client, worker } = setup()
    void client.request({ type: 'boot' })
    void client.request({ type: 'stats' })
    void client.request({ type: 'close', session: 3 })
    const ids = worker.sent.map((s) => s.msg.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(3)
  })

  it('matches answers to requests by id, in whatever order they come', async () => {
    const { client, worker } = setup()
    const a = client.request({ type: 'close', session: 1 })
    const b = client.request({ type: 'stats' })
    const [ra, rb] = worker.sent.map((s) => s.msg.id)
    worker.reply(rb!, { ok: true, wasmMemoryBytes: 42 })
    worker.reply(ra!, { ok: false, code: 'NO_SESSION', message: 'gone' })
    expect(await b).toEqual({ ok: true, wasmMemoryBytes: 42 })
    expect(await a).toEqual({ ok: false, code: 'NO_SESSION', message: 'gone' })
  })

  it('transfers the pixels rather than copying them, and shrinks large images by default', async () => {
    const { client, worker } = setup()
    const img = image()
    void client.open(img)
    const { msg, transfer } = worker.sent[0]!
    expect(msg).toMatchObject({ type: 'open', width: 4, height: 3, maxEdge: DEFAULT_MAX_EDGE })
    expect(transfer).toEqual([img.rgba.buffer])
    void client.open(image(), { maxEdge: 0, deltaE: 9 })
    expect(worker.sent[1]!.msg).not.toHaveProperty('maxEdge')
    expect(worker.sent[1]!.msg).toMatchObject({ deltaE: 9 })
  })

  it('boots once, reports progress, and can retry a failed boot', async () => {
    const { client, worker } = setup()
    const seen: number[] = []
    client.onProgress((p) => seen.push(p.loaded))
    const first = client.boot()
    expect(client.boot()).toBe(first)
    worker.progress({ stage: 'runtime', loaded: 10, total: 100 })
    worker.progress({ stage: 'numpy', loaded: 60, total: 100 })
    expect(seen).toEqual([10, 60])
    expect(client.progress).toMatchObject({ stage: 'numpy', loaded: 60 })
    worker.reply(worker.of('boot')[0]!.id, { ok: false, code: 'BOOT_FAILED', message: 'offline' })
    expect(await first).toMatchObject({ ok: false, code: 'BOOT_FAILED' })
    await flush()
    const second = client.boot()
    expect(second).not.toBe(first)
    worker.reply(worker.of('boot')[1]!.id, { ok: true })
    expect(await second).toEqual({ ok: true })
    expect(client.boot()).toBe(second)
  })

  it('returns detection failures as data, with the session kept for a retry', async () => {
    const { client, worker } = setup()
    const pending = client.open(image())
    worker.reply(worker.of('open')[0]!.id, { ok: false, code: 'NO_GRIDLINES', message: 'no grid', session: 4 })
    const { session, result } = await pending
    expect(result).toEqual({ ok: false, code: 'NO_GRIDLINES', message: 'no grid', session: 4 })
    expect(session).toBeInstanceOf(DetectSession)
    expect(session!.id).toBe(4)
    expect(session!.latest).toBeNull()
  })

  it('drops the answer to an open that a newer open superseded, and closes its session', async () => {
    const { client, worker } = setup()
    const older = client.open(image())
    const newer = client.open(image())
    const [o1, o2] = worker.of('open')
    worker.reply(o2!.id, makePreview(2))
    worker.reply(o1!.id, makePreview(1))
    expect((await older).result).toMatchObject({ ok: false, code: 'STALE' })
    expect((await older).session).toBeNull()
    expect((await newer).result).toMatchObject({ ok: true, session: 2 })
    expect(worker.of('close').map((c) => c.session)).toEqual([1])
  })

  it('answers everything outstanding with WORKER_GONE when disposed, and terminates the worker', async () => {
    const { client, worker } = setup()
    const a = client.request({ type: 'boot' })
    const b = client.open(image())
    client.dispose()
    expect(worker.terminated).toBe(true)
    expect(await a).toMatchObject({ ok: false, code: 'WORKER_GONE' })
    expect((await b).result).toMatchObject({ ok: false, code: 'WORKER_GONE' })
    // And afterwards, without starting a new worker.
    expect(await client.request({ type: 'stats' })).toMatchObject({ ok: false, code: 'WORKER_GONE' })
    expect(worker.sent).toHaveLength(2)
    expect(client.disposed).toBe(true)
  })

  it('turns a worker crash into data', async () => {
    const { client, worker } = setup()
    const a = client.request({ type: 'boot' })
    worker.fail()
    expect(await a).toMatchObject({ ok: false, code: 'WORKER_GONE' })
  })

  it('ignores answers it is no longer waiting for', async () => {
    const { client, worker } = setup()
    const a = client.request({ type: 'stats' })
    const id = worker.sent[0]!.msg.id
    worker.reply(id, { ok: true, wasmMemoryBytes: 1 })
    worker.reply(id, { ok: true, wasmMemoryBytes: 2 })
    expect(await a).toEqual({ ok: true, wasmMemoryBytes: 1 })
  })
})

describe('DetectSession', () => {
  it('keeps the first preview', async () => {
    const { session } = await opened()
    expect(session.id).toBe(7)
    expect(session.latest?.rows).toBe(3)
  })

  it('sends a change at once, and folds changes made meanwhile into one request', async () => {
    const { session, worker } = await opened()
    const first = session.update({ rows: 5 })
    const second = session.update({ cols: 6 })
    const third = session.update({ rows: 8, deltaE: 4 })
    let updates = worker.of('update')
    expect(updates.map((u) => u.params)).toEqual([{ rows: 5 }])
    expect(second).toBe(third)

    worker.reply(updates[0]!.id, makePreview(7, 5, 4))
    expect((await first) as Preview).toMatchObject({ rows: 5 })
    expect(session.latest?.rows).toBe(5) // the preview moved on the first change
    await flush()
    updates = worker.of('update')
    expect(updates.map((u) => u.params)).toEqual([{ rows: 5 }, { cols: 6, rows: 8, deltaE: 4 }])

    worker.reply(updates[1]!.id, makePreview(7, 8, 6))
    const [r2, r3] = await Promise.all([second, third])
    expect(r2).toBe(r3)
    expect(r2 as Preview).toMatchObject({ rows: 8, cols: 6 })
    expect(session.latest?.cols).toBe(6)
  })

  it('drops a preview answered after a newer one was requested', async () => {
    const { session, worker } = await opened()
    const update = session.update({ rows: 5 })
    const redetect = session.redetect([0, 0, 30, 20])
    const [u] = worker.of('update')
    const [r] = worker.of('redetect')
    expect(r).toMatchObject({ session: 7, crop: [0, 0, 30, 20] })
    worker.reply(r!.id, makePreview(7, 3, 3))
    worker.reply(u!.id, makePreview(7, 5, 4))
    expect(await update).toMatchObject({ ok: false, code: 'STALE' })
    expect(await redetect).toMatchObject({ ok: true, cols: 3 })
    expect(session.latest?.cols).toBe(3) // the stale answer didn't overwrite it
  })

  it('a redetect drops any change still waiting to be sent', async () => {
    const { session, worker } = await opened()
    void session.update({ rows: 5 })
    const waiting = session.update({ rows: 6 })
    void session.redetect()
    expect(await waiting).toMatchObject({ ok: false, code: 'STALE' })
    worker.reply(worker.of('update')[0]!.id, makePreview(7))
    await flush()
    expect(worker.of('update')).toHaveLength(1)
  })

  it('returns update errors as data', async () => {
    const { session, worker } = await opened()
    const r = session.update({ rows: 2 })
    worker.reply(worker.of('update')[0]!.id, { ok: false, code: 'NO_DETECTION', message: 'nothing' })
    const out: Outcome<Preview> = await r
    expect(out).toEqual({ ok: false, code: 'NO_DETECTION', message: 'nothing' })
    expect(session.latest?.rows).toBe(3)
  })

  it('previews, commits and closes by session id, closing only once', async () => {
    const { session, worker, client } = await opened()
    void session.preview()
    void session.commit('Dog')
    void session.close()
    void session.close()
    expect(worker.sent.slice(1).map((s) => s.msg)).toMatchObject([
      { type: 'preview', session: 7 },
      { type: 'commit', session: 7, name: 'Dog' },
      { type: 'close', session: 7 },
    ])
    client.dispose()
    await session.close()
  })
})
