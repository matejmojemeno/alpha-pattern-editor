import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AutoSaver, SAVE_DELAY_MS, type SaveStatus } from '../../src/app/autosave.ts'
import { keepScreenAwake } from '../../src/app/wakeLock.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function saver(save = vi.fn(async (_v: number) => {})) {
  const statuses: SaveStatus[] = []
  const s = new AutoSaver<number>(save, (st) => statuses.push(st))
  return { s, save, statuses }
}

describe('AutoSaver', () => {
  it('debounces a burst of changes into one save of the latest', async () => {
    const { s, save, statuses } = saver()
    s.schedule(1)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 50)
    s.schedule(2)
    s.schedule(3)
    expect(s.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(3)
    expect(statuses).toEqual(['pending', 'saving', 'saved'])
  })

  it('flushes at once, and a flush with nothing pending saves nothing', async () => {
    const { s, save } = saver()
    s.schedule(7)
    await s.flush()
    expect(save).toHaveBeenCalledWith(7)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2)
    await s.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(s.status).toBe('saved')
  })

  it('never overlaps saves, and saves a change made during one afterwards', async () => {
    let release!: () => void
    const order: string[] = []
    const save = vi.fn(async (v: number) => {
      order.push(`start ${v}`)
      if (v === 1) await new Promise<void>((r) => (release = r))
      order.push(`end ${v}`)
    })
    const { s } = saver(save)
    s.schedule(1)
    const first = s.flush()
    await vi.advanceTimersByTimeAsync(0)
    s.schedule(2)
    const second = s.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['start 1'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2'])
  })

  it('keeps a failed save pending and retries it', async () => {
    const save = vi.fn(async () => {}).mockRejectedValueOnce(new Error('quota'))
    const { s, statuses } = saver(save)
    s.schedule(5)
    await s.flush()
    expect(s.status).toBe('error')
    await s.flush()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(5)
    expect(s.status).toBe('saved')
    expect(statuses).toEqual(['pending', 'saving', 'error', 'saving', 'saved'])
  })
})

describe('keepScreenAwake', () => {
  function fakeDoc() {
    const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState }
    target.visibilityState = 'visible'
    return target as unknown as Document & { visibilityState: DocumentVisibilityState }
  }

  function fakeApi() {
    const sentinels: { released: boolean; release: () => Promise<void> }[] = []
    const api = {
      request: vi.fn(async () => {
        const s = {
          released: false,
          release: vi.fn(async () => {
            s.released = true
          }),
        }
        sentinels.push(s)
        return s
      }),
    }
    return { api, sentinels }
  }

  it('holds a lock, takes it again when the page is visible again, and releases it on stop', async () => {
    const doc = fakeDoc()
    const { api, sentinels } = fakeApi()
    const stop = keepScreenAwake(api, doc)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.request).toHaveBeenCalledTimes(1)

    // Hidden: the browser releases the lock itself.
    sentinels[0]!.released = true
    ;(doc as { visibilityState: string }).visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.request).toHaveBeenCalledTimes(1)

    ;(doc as { visibilityState: string }).visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.request).toHaveBeenCalledTimes(2)

    stop()
    expect(sentinels[1]!.release).toHaveBeenCalled()
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.request).toHaveBeenCalledTimes(2)
  })

  it('carries on silently without the API, or when it refuses', async () => {
    expect(() => keepScreenAwake(undefined, fakeDoc())()).not.toThrow()
    const api = { request: vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))) }
    const doc = fakeDoc()
    const stop = keepScreenAwake(api, doc)
    await vi.advanceTimersByTimeAsync(0)
    // A tap tries again.
    doc.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.request).toHaveBeenCalledTimes(2)
    stop()
  })
})
