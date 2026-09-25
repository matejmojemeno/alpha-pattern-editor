// @vitest-environment jsdom
/**
 * The confirm screen's corrections (Phase 2, part 2), with the real DetectClient on a fake
 * worker: each control sends the request it should (resample for rows, cols and colour
 * detail; detect again for Crop and Re-detect), the preview stays up while an answer is
 * on its way, the watchdog's failure is recoverable, and the phone layout's tabs.
 */
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handOffImage } from '../../src/app/pendingImage.ts'
import type { Preview, Request } from '../../src/detect/protocol.ts'
import { detectingWorker, FakeWorker, makePreview } from '../detect/fakeWorker.ts'
import { detection } from './fakeDetection.ts'
import { renderApp, screen } from './helpers.tsx'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

/** A worker that detects as detectingWorker does, and resamples to what `resample`
 *  makes of the params (a 3×4 checkerboard by default). */
function confirmingWorker(resample: (params: Extract<Request, { type: 'update' }>['params']) => Preview | undefined = () => makePreview(1)) {
  const w = detectingWorker()
  const auto = w.auto!
  w.auto = (msg) => {
    if (msg.type === 'update') return resample(msg.params)
    if (msg.type === 'redetect') return makePreview(msg.session, 5, 6)
    return auto(msg)
  }
  return w
}

async function openImport(worker: FakeWorker = confirmingWorker()) {
  detection.reset(worker)
  handOffImage({ file: new File([PNG], 'dog.png', { type: 'image/png' }), name: 'dog' })
  const view = await renderApp('#/import')
  await screen.findByRole('button', { name: 'Save & start working' })
  await waitFor(() => expect((screen.getByLabelText('Rows') as HTMLInputElement).value).toBe('3'))
  return view
}

const updates = () => detection.worker.of('update').map((u) => u.params)
const slider = () => screen.getByRole('slider', { name: 'Colour detail' }) as HTMLInputElement
const patternLabel = () => screen.getByRole('img', { name: /^The detected pattern/ }).getAttribute('aria-label')

/** jsdom lays nothing out: give the source image's box a size, 10 screen px per image
 *  pixel for the 40×30 test image. */
function layOutSource() {
  const box = document.querySelector('.source') as HTMLElement
  box.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, width: 400, height: 300, right: 400, bottom: 300, toJSON: () => ({}) })
  return box
}

function drag(box: HTMLElement, from: [number, number], to: [number, number], pointerType = 'mouse') {
  const at = ([clientX, clientY]: [number, number]) => ({ pointerId: 1, pointerType, button: 0, clientX, clientY })
  fireEvent.pointerDown(box, at(from))
  fireEvent.pointerMove(box, at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]))
  fireEvent.pointerMove(box, at(to))
  fireEvent.pointerUp(box, at(to))
}

beforeEach(() => detection.reset())
afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as { __alphaDetectTest?: unknown }).__alphaDetectTest
})

describe('the fast path: rows, cols and colour detail only resample', () => {
  it('rows and cols, typed or stepped', async () => {
    await openImport()
    const rows = screen.getByLabelText('Rows') as HTMLInputElement
    await userEvent.click(screen.getByRole('button', { name: 'More rows' }))
    await waitFor(() => expect(updates()).toEqual([{ rows: 4 }]))
    expect(rows.value).toBe('4')
    await userEvent.click(screen.getByRole('button', { name: 'Fewer columns' }))
    await waitFor(() => expect(updates()).toEqual([{ rows: 4 }, { cols: 3 }]))
    expect((screen.getByLabelText('Cols') as HTMLInputElement).value).toBe('3')

    await userEvent.clear(rows)
    await userEvent.type(rows, '12')
    // '' isn't a size; '1' and '12' are.
    await waitFor(() => expect(updates().slice(2)).toEqual([{ rows: 1 }, { rows: 12 }]))
    fireEvent.keyDown(rows, { key: 'ArrowDown' })
    await waitFor(() => expect(updates().at(-1)).toEqual({ rows: 11 }))

    // Nothing but a size is sent, and leaving the box puts the preview's value back.
    const sent = updates().length
    await userEvent.clear(rows)
    await userEvent.type(rows, '0')
    rows.blur()
    await waitFor(() => expect(rows.value).toBe('3')) // the fake always resamples to 3×4
    expect(updates()).toHaveLength(sent)
    expect(detection.worker.of('redetect')).toHaveLength(0)
  })

  it('the colour-detail slider runs opposite to ΔE', async () => {
    await openImport()
    expect(slider().value).toBe('11') // ΔE 6
    fireEvent.change(slider(), { target: { value: '15' } })
    await waitFor(() => expect(updates()).toEqual([{ deltaE: 2 }])) // far right: most colours
    fireEvent.change(slider(), { target: { value: '2' } })
    await waitFor(() => expect(updates()).toEqual([{ deltaE: 2 }, { deltaE: 15 }]))
    expect(slider().getAttribute('aria-valuetext')).toBe('ΔE 15')
    expect(detection.worker.of('redetect')).toHaveLength(0)
  })

  it('a 40-tick drag costs two resamples, and the preview moves on the first', async () => {
    const worker = confirmingWorker()
    const auto = worker.auto!
    const held: Request[] = []
    worker.auto = (msg) => (msg.type === 'update' ? (held.push(msg), undefined) : auto(msg))
    await openImport(worker)
    act(() => {
      for (let tick = 0; tick < 40; tick++) fireEvent.change(slider(), { target: { value: String(2 + (tick % 14)) } })
    })
    expect(updates()).toEqual([{ deltaE: 15 }])
    await act(async () => worker.reply(held[0]!.id, makePreview(1, 7, 4, { deltaE: 15 })))
    await waitFor(() => expect(screen.getByText(/^4 cols × 7 rows/)).toBeTruthy()) // moved on the first tick
    await waitFor(() => expect(updates()).toHaveLength(2))
    expect(updates()[1]).toEqual({ deltaE: 17 - (2 + (39 % 14)) })
    await act(async () => worker.reply(held[1]!.id, makePreview(1, 8, 4)))
    await waitFor(() => expect(screen.getByText(/^4 cols × 8 rows/)).toBeTruthy())
    expect(updates()).toHaveLength(2)
  })

  it('keeps the last preview while an answer is on its way, dimmed only once it is slow', async () => {
    const worker = confirmingWorker()
    const auto = worker.auto!
    const held: Request[] = []
    worker.auto = (msg) => (msg.type === 'update' ? (held.push(msg), undefined) : auto(msg))
    await openImport(worker)
    const confirm = document.querySelector('.confirm')!
    await userEvent.click(screen.getByRole('button', { name: 'More rows' }))
    expect(confirm.hasAttribute('data-dim')).toBe(false) // not straight away
    await waitFor(() => expect(confirm.hasAttribute('data-dim')).toBe(true), { timeout: 1000 })
    expect(patternLabel()).toMatch(/4 columns by 3 rows/) // never blanked
    await act(async () => worker.reply(held[0]!.id, makePreview(1, 4, 4)))
    await waitFor(() => expect(confirm.hasAttribute('data-dim')).toBe(false))
    expect(patternLabel()).toMatch(/4 columns by 4 rows/)
  })

  it('recomputes the warnings with every preview', async () => {
    await openImport(
      confirmingWorker((p) =>
        makePreview(1, p.rows ?? 3, 4, {
          warnings: p.rows === 4 ? ['2/16 cells (12.5%) have low confidence — review before committing.'] : [],
        }),
      ),
    )
    expect(screen.queryByRole('list', { name: 'Warnings' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More rows' }))
    expect(await screen.findByText(/have low confidence/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Fewer rows' }))
    await waitFor(() => expect(screen.queryByText(/have low confidence/)).toBeNull())
  })
})

describe('what the screen shows', () => {
  it('flags unsure cells, and can stop', async () => {
    const worker = detectingWorker()
    const auto = worker.auto!
    worker.auto = (msg) =>
      msg.type === 'open' ? makePreview(1, 3, 4, { confidence: new Float32Array([1, 0.2, 1, 1, 1, 1, 0.59, 1, 1, 1, 1, 0.6]) }) : auto(msg)
    await openImport(worker)
    const flag = screen.getByRole('checkbox', { name: 'Flag unsure cells' }) as HTMLInputElement
    expect(flag.checked).toBe(true) // on by default
    expect(patternLabel()).toMatch(/2 unsure cells crossed out/)
    await userEvent.click(flag)
    expect(patternLabel()).not.toMatch(/crossed out/)
    expect(detection.worker.of('update')).toHaveLength(0) // drawing only
  })

  it('draws the detected gridlines and extent over the image', async () => {
    // Every box 400×300 (jsdom measures everything as 0), so the image has somewhere to go.
    const proto = Element.prototype
    const saved = [Object.getOwnPropertyDescriptor(proto, 'clientWidth')!, Object.getOwnPropertyDescriptor(proto, 'clientHeight')!]
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 400 })
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 300 })
    try {
      await openImport()
    } finally {
      Object.defineProperty(proto, 'clientWidth', saved[0]!)
      Object.defineProperty(proto, 'clientHeight', saved[1]!)
    }
    const overlay = screen.getByTestId('grid-overlay')
    expect(overlay.getAttribute('style')).toMatch(/left: 0px; top: 0px; width: 400px; height: 300px/)
    expect(overlay.getAttribute('viewBox')).toBe('0 0 40 30')
    const d = overlay.querySelector('path')!.getAttribute('d')!
    expect(d.match(/M/g)).toHaveLength(5 + 4) // 5 column lines, 4 row lines
    expect(overlay.querySelector('rect')!.getAttribute('width')).toBe('40')
  })

  it('lists each colour on its own colour, in black or white', async () => {
    await openImport()
    const [white, brown] = within(screen.getByRole('list', { name: 'Colours' })).getAllByRole('listitem')
    expect(white!.textContent).toBe('6 White stitches')
    expect(white!.style.color).toBe('rgb(0, 0, 0)')
    expect(brown!.style.color).toBe('rgb(255, 255, 255)')
  })

  it('says when a photo was shrunk for detection', async () => {
    const worker = detectingWorker()
    const auto = worker.auto!
    worker.auto = (msg) =>
      msg.type === 'open' ? makePreview(1, 3, 4, { imageWidth: 4000, imageHeight: 3000, detectedWidth: 2000, detectedHeight: 1500 }) : auto(msg)
    await openImport(worker)
    expect(screen.getByText(/^Reduced from 4000×3000 to 2000×1500 for detection\./)).toBeTruthy()
  })

  it('says nothing when it was not', async () => {
    await openImport()
    expect(screen.queryByText(/^Reduced from/)).toBeNull()
  })
})

describe('the slow path: Crop and Re-detect detect again', () => {
  it('crops with a rubber band, in image pixels, at the current colour detail', async () => {
    await openImport()
    fireEvent.change(slider(), { target: { value: '13' } }) // ΔE 4
    const crop = screen.getByRole('button', { name: 'Crop' })
    await userEvent.click(crop)
    expect(crop.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Drag a box around just the squares, then let go.')).toBeTruthy()
    drag(layOutSource(), [100, 75], [300, 225])
    await waitFor(() => expect(detection.worker.of('redetect')).toHaveLength(1))
    expect(detection.worker.of('redetect')[0]).toMatchObject({ crop: [10, 7, 30, 22], deltaE: 4 })
    // The new detection's size lands in the boxes; crop mode ends.
    await waitFor(() => expect((screen.getByLabelText('Rows') as HTMLInputElement).value).toBe('5'))
    expect((screen.getByLabelText('Cols') as HTMLInputElement).value).toBe('6')
    expect(crop.getAttribute('aria-pressed')).toBe('false')
  })

  it('crops with a finger too, and a slip is not a crop', async () => {
    await openImport()
    await userEvent.click(screen.getByRole('button', { name: 'Crop' }))
    const box = layOutSource()
    drag(box, [100, 100], [104, 180], 'touch')
    expect(detection.worker.of('redetect')).toHaveLength(0)
    drag(box, [0, 0], [400, 300], 'touch')
    await waitFor(() => expect(detection.worker.of('redetect')[0]).toMatchObject({ crop: [0, 0, 40, 30] }))
  })

  it('does not crop unless Crop is on', async () => {
    await openImport()
    drag(layOutSource(), [100, 75], [300, 225])
    expect(detection.worker.of('redetect')).toHaveLength(0)
  })

  it('Re-detect detects the whole image again', async () => {
    await openImport()
    await userEvent.click(screen.getByRole('button', { name: 'More rows' }))
    await userEvent.click(screen.getByRole('button', { name: 'Re-detect' }))
    await waitFor(() => expect(detection.worker.of('redetect')).toHaveLength(1))
    expect(detection.worker.of('redetect')[0]).not.toHaveProperty('crop')
    await waitFor(() => expect((screen.getByLabelText('Rows') as HTMLInputElement).value).toBe('5'))
  })

  it('after NO_GRIDLINES, the hint suggests Crop and a crop recovers', async () => {
    const worker = confirmingWorker()
    const auto = worker.auto!
    worker.auto = (msg) => (msg.type === 'open' ? { ok: false, code: 'NO_GRIDLINES', message: 'none', session: 1 } : auto(msg))
    detection.reset(worker)
    handOffImage({ file: new File([PNG], 'dog.png', { type: 'image/png' }), name: 'dog' })
    await renderApp('#/import')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Turn on Crop, drag a box around just the squares/)
    expect((screen.getByLabelText('Rows') as HTMLInputElement).disabled).toBe(true) // nothing to adjust
    await userEvent.click(within(alert).getByRole('button', { name: 'Crop' }))
    expect(screen.getByRole('button', { name: 'Crop', pressed: true })).toBeTruthy()
    drag(layOutSource(), [40, 30], [360, 270])
    await waitFor(() => expect(detection.worker.of('redetect')[0]).toMatchObject({ session: 1, crop: [4, 3, 36, 27] }))
    expect((await screen.findByRole('button', { name: 'Save & start working' })).hasAttribute('disabled')).toBe(false)
  })
})

describe('the watchdog', () => {
  function stuckWorker() {
    const worker = confirmingWorker()
    const auto = worker.auto!
    let opens = 0
    worker.auto = (msg) => (msg.type === 'open' && ++opens === 1 ? undefined : auto(msg)) // the first never answers
    return worker
  }

  async function timedOut() {
    ;(globalThis as { __alphaDetectTest?: unknown }).__alphaDetectTest = { budgetMs: 50 }
    detection.reset(stuckWorker())
    handOffImage({ file: new File([PNG], 'dog.png', { type: 'image/png' }), name: 'dog' })
    await renderApp('#/import')
    const alert = await screen.findByRole('alert', {}, { timeout: 2000 })
    expect(alert.textContent).toMatch(/taking too long to read/)
    expect(alert.textContent).toMatch(/Turn on Crop/)
    expect(detection.worker.terminated).toBe(true)
    return alert
  }

  it('stops a detection that runs too long, and Try again starts a fresh worker', async () => {
    const alert = await timedOut()
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Save & start working' })).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText('Rows') as HTMLInputElement).value).toBe('3'))
    expect(detection.worker.of('boot')).toHaveLength(2) // a new worker boots again
    expect(detection.worker.of('open')[1]).not.toHaveProperty('crop')
  })

  it('offers Crop, which starts over on just the crop', async () => {
    const alert = await timedOut()
    await userEvent.click(within(alert).getByRole('button', { name: 'Crop' }))
    drag(layOutSource(), [100, 75], [300, 225])
    await waitFor(() => expect(detection.worker.of('open')).toHaveLength(2))
    expect(detection.worker.of('open')[1]).toMatchObject({ crop: [10, 7, 30, 22] })
    expect(await screen.findByRole('button', { name: 'Save & start working' })).toBeTruthy()
  })
})

describe('on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, // narrower than 900 px
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
  })

  it('shows one pane at a time as tabs, with Save always there', async () => {
    await openImport()
    const tabs = within(screen.getByRole('tablist', { name: 'Show' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Image', 'Pattern', 'Colours'])
    expect(screen.getByRole('tab', { name: 'Pattern', selected: true })).toBeTruthy()
    expect(screen.getByRole('tabpanel', { name: 'Pattern' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Colours' })).toBeNull() // its tab is hidden

    await userEvent.click(screen.getByRole('tab', { name: 'Colours' }))
    expect(screen.getByRole('list', { name: 'Colours' })).toBeTruthy()

    // Turning on Crop shows the image to crop on; cropping shows the result.
    await userEvent.click(screen.getByRole('button', { name: 'Crop' }))
    expect(screen.getByRole('tab', { name: 'Image', selected: true })).toBeTruthy()
    drag(layOutSource(), [100, 75], [300, 225], 'touch')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Pattern', selected: true })).toBeTruthy())

    expect(screen.getByRole('button', { name: 'Save & start working' })).toBeTruthy()
  })
})
