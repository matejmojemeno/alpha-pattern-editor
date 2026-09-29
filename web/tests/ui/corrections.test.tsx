// @vitest-environment jsdom
/**
 * The confirm screen's corrections (Phase 2, part 2), with the real DetectClient on a fake
 * worker: each control sends the request it should (resample for moving the grid's
 * outline; detect again for a box drawn on the image), the preview stays up
 * while an answer is on its way, the watchdog's failure is recoverable, and the phone
 * layout's tabs.
 */
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handOffImage } from '../../src/app/pendingImage.ts'
import type { Preview, Request } from '../../src/detect/protocol.ts'
import { detectingWorker, FakeWorker, makePreview } from '../detect/fakeWorker.ts'
import { detection } from './fakeDetection.ts'
import { renderApp, screen, sizeShown } from './helpers.tsx'

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
  handOffImage({ file: new File([PNG], 'dog.png', { type: 'image/png' }) })
  const view = await renderApp('#/import')
  await screen.findByRole('button', { name: 'Save & edit pattern' })
  await waitFor(() => expect(sizeShown()).toBe('4 columns × 3 rows'))
  return view
}

const updates = () => detection.worker.of('update').map((u) => u.params)
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

describe('what the screen shows', () => {
  it('has no rows and cols boxes, and flags no unsure cells', async () => {
    const worker = detectingWorker()
    const auto = worker.auto!
    worker.auto = (msg) =>
      msg.type === 'open' ? makePreview(1, 3, 4, { confidence: new Float32Array([1, 0.2, 1, 1, 1, 1, 0.59, 1, 1, 1, 1, 0.6]) }) : auto(msg)
    await openImport(worker)
    expect(screen.queryByLabelText('Rows')).toBeNull()
    expect(screen.queryByLabelText('Cols')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Flag unsure cells' })).toBeNull()
    expect(patternLabel()).toBe('The detected pattern: 4 columns by 3 rows')
  })

  it('has no colour setting, and never asks for one', async () => {
    await openImport()
    expect(screen.queryByRole('slider', { name: 'Colour detail' })).toBeNull()
    expect(detection.worker.of('open')[0]).not.toHaveProperty('deltaE') // the bridge's default
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
    const d = overlay.querySelector('.source__lines')!.getAttribute('d')!
    expect(d.match(/M/g)).toHaveLength(5 + 4) // 5 column lines, 4 row lines
    expect(overlay.querySelector('rect')!.getAttribute('width')).toBe('40')
  })

  it('lists each colour with its swatch, name and count', async () => {
    await openImport()
    const [white, brown] = within(screen.getByRole('list', { name: 'Colours' })).getAllByRole('listitem')
    expect(white!.querySelector('.palette__name')!.textContent).toBe('White')
    expect(white!.querySelector('.palette__count')!.textContent).toBe('6')
    expect((white!.querySelector('.palette__swatch') as HTMLElement).style.background).toBe('rgb(255, 255, 255)')
    expect((brown!.querySelector('.palette__swatch') as HTMLElement).style.background).toBe('rgb(139, 69, 19)')
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

describe('the slow path: a box drawn on the image detects again', () => {
  it('has no Crop button: a box drawn on the image crops, in image pixels', async () => {
    await openImport()
    expect(screen.queryByRole('button', { name: 'Crop' })).toBeNull()
    expect(screen.queryByText('Drag a box around just the squares, then let go.')).toBeNull() // only without a grid
    drag(layOutSource(), [100, 75], [300, 225])
    await waitFor(() => expect(detection.worker.of('redetect')).toHaveLength(1))
    expect(detection.worker.of('redetect')[0]).toMatchObject({ crop: [10, 7, 30, 22] })
    expect(detection.worker.of('redetect')[0]).not.toHaveProperty('deltaE')
    await waitFor(() => expect(sizeShown()).toBe('6 columns × 5 rows'))
  })

  it('crops with a finger too, and a slip is not a crop', async () => {
    await openImport()
    const box = layOutSource()
    drag(box, [100, 100], [104, 180], 'touch')
    expect(detection.worker.of('redetect')).toHaveLength(0)
    drag(box, [0, 0], [400, 300], 'touch')
    await waitFor(() => expect(detection.worker.of('redetect')[0]).toMatchObject({ crop: [0, 0, 40, 30] }))
  })

  it('does not crop while the grid is being found', async () => {
    const worker = confirmingWorker()
    const auto = worker.auto!
    worker.auto = (msg) => (msg.type === 'redetect' ? undefined : auto(msg)) // never answers
    await openImport(worker)
    const box = layOutSource()
    drag(box, [100, 75], [300, 225])
    await waitFor(() => expect(detection.worker.of('redetect')).toHaveLength(1))
    drag(box, [50, 50], [350, 250])
    expect(detection.worker.of('redetect')).toHaveLength(1)
  })

  it('has no Re-detect; "Reset to detected grid" undoes a box, and only then is enabled', async () => {
    await openImport()
    const reset = () => screen.getByRole('button', { name: 'Reset to detected grid' })
    expect(screen.queryByRole('button', { name: 'Re-detect' })).toBeNull()
    expect(reset().hasAttribute('disabled')).toBe(true)
    drag(layOutSource(), [100, 75], [300, 225])
    await waitFor(() => expect(sizeShown()).toBe('6 columns × 5 rows'))
    await userEvent.click(reset())
    await waitFor(() => expect(detection.worker.of('redetect')).toHaveLength(2))
    expect(detection.worker.of('redetect')[1]).not.toHaveProperty('crop')
    await waitFor(() => expect(reset().hasAttribute('disabled')).toBe(true))
  })

  it('after NO_GRIDLINES, the hint says to draw a box on the image, and one recovers', async () => {
    const worker = confirmingWorker()
    const auto = worker.auto!
    worker.auto = (msg) => (msg.type === 'open' ? { ok: false, code: 'NO_GRIDLINES', message: 'none', session: 1 } : auto(msg))
    detection.reset(worker)
    handOffImage({ file: new File([PNG], 'dog.png', { type: 'image/png' }) })
    await renderApp('#/import')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Drag a box around just the squares on your image/)
    expect(within(alert).queryByRole('button', { name: 'Draw a box' })).toBeNull() // the image is right beside it
    expect(screen.getByText('Drag a box around just the squares, then let go.')).toBeTruthy()
    drag(layOutSource(), [40, 30], [360, 270])
    await waitFor(() => expect(detection.worker.of('redetect')[0]).toMatchObject({ session: 1, crop: [4, 3, 36, 27] }))
    expect((await screen.findByRole('button', { name: 'Save & edit pattern' })).hasAttribute('disabled')).toBe(false)
  })
})

describe('moving the outline', () => {
  // A 2 × 2 grid of 10 × 5 px cells found at (10, 10)–(30, 20), in the 40 × 30 image, with
  // room on every side; every box laid out 400 × 300 (10 screen px per image pixel), so
  // the handles have somewhere to go. The worker resamples to whatever is asked for.
  const found = () => makePreview(1, 2, 2, { extent: { x0: 10, y0: 10, x1: 30, y1: 20 }, imageWidth: 40, imageHeight: 30 })
  const echo = (p: Extract<Request, { type: 'update' }>['params']) =>
    makePreview(1, p.rows ?? 2, p.cols ?? 2, { extent: p.extent ?? found().extent, imageWidth: 40, imageHeight: 30 })
  const saved = ['clientWidth', 'clientHeight'].map((k) => Object.getOwnPropertyDescriptor(Element.prototype, k)!)
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 400 })
    Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 300 })
  })
  afterEach(() => {
    Object.defineProperty(Element.prototype, 'clientWidth', saved[0]!)
    Object.defineProperty(Element.prototype, 'clientHeight', saved[1]!)
  })

  async function openFound(resample: (p: Extract<Request, { type: 'update' }>['params']) => Preview | undefined = echo) {
    const worker = confirmingWorker(resample)
    const auto = worker.auto!
    worker.auto = (msg) => (msg.type === 'open' ? found() : auto(msg))
    detection.reset(worker)
    handOffImage({ file: new File([PNG], 'dog.png', { type: 'image/png' }) })
    await renderApp('#/import')
    await waitFor(() => expect(sizeShown()).toBe('2 columns × 2 rows'))
    return { worker, box: layOutSource() }
  }
  const rect = () => screen.getByTestId('grid-overlay').querySelector('rect')!
  const extentShown = () => ['x', 'y', 'width', 'height'].map((a) => Number(rect().getAttribute(a)))

  it('takes in the columns a side left out, in whole cells, and only resamples', async () => {
    const { box } = await openFound()
    const left = screen.getByTestId('edge-left')
    const at = (clientX: number, clientY: number) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY })
    fireEvent.pointerDown(left, at(100, 150))
    fireEvent.pointerMove(box, at(4, 150)) // x = 0.4: one cell further out
    // The outline follows at once, the size is shown while dragging, and the new extent is
    // resampled into its rows and columns.
    expect(extentShown()).toEqual([0, 10, 30, 10])
    expect(box.querySelector('.source__size')!.textContent).toBe('3 × 2')
    fireEvent.pointerUp(box, at(4, 150))
    await waitFor(() => expect(updates()).toEqual([{ extent: { x0: 0, y0: 10, x1: 30, y1: 20 }, rows: 2, cols: 3 }]))
    await waitFor(() => expect(sizeShown()).toBe('3 columns × 2 rows'))
    expect(box.querySelector('.source__size')).toBeNull()
    expect(detection.worker.of('redetect')).toHaveLength(0)
    // Grabbing an edge is not drawing a box.
    expect(box.querySelector('.source__band')).toBeNull()
  })

  it('dims what is outside the outline, as it moves', async () => {
    await openFound()
    const outside = () => screen.getByTestId('outside-grid')
    // The whole image, less the outline: what won't be in the pattern.
    expect(outside().getAttribute('fill-rule')).toBe('evenodd')
    expect(outside().getAttribute('d')).toBe('M0 0H40V30H0Z M10 10V20H30V10Z')
    screen.getByRole('slider', { name: 'Left edge of the grid' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(outside().getAttribute('d')).toBe('M0 0H40V30H0Z M0 10V20H30V10Z')
  })

  it('"Reset to detected grid" puts a moved outline back by finding the grid in the whole image', async () => {
    await openFound()
    const reset = () => screen.getByRole('button', { name: 'Reset to detected grid' })
    expect(reset().hasAttribute('disabled')).toBe(true)
    screen.getByRole('slider', { name: 'Left edge of the grid' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(sizeShown()).toBe('3 columns × 2 rows'))
    await userEvent.click(reset())
    await waitFor(() => expect(detection.worker.of('redetect')).toHaveLength(1))
    expect(detection.worker.of('redetect')[0]).not.toHaveProperty('crop')
    await waitFor(() => expect(reset().hasAttribute('disabled')).toBe(true))
  })

  it('moves two sides from a corner, and leaves rows out when dragged inward', async () => {
    const { box } = await openFound()
    const at = (clientX: number, clientY: number) => ({ pointerId: 1, pointerType: 'touch', button: 0, clientX, clientY })
    fireEvent.pointerDown(screen.getByTestId('corner-bottom-right'), at(300, 200))
    fireEvent.pointerMove(box, at(390, 151)) // x = 39: a column out; y = 15.1: a row in
    fireEvent.pointerUp(box, at(390, 151))
    await waitFor(() => expect(updates().at(-1)).toEqual({ extent: { x0: 10, y0: 10, x1: 39, y1: 15 }, rows: 1, cols: 3 }))
  })

  it('sends each whole-cell change once, however many moves it takes', async () => {
    const { box } = await openFound()
    const at = (clientY: number) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 200, clientY })
    fireEvent.pointerDown(screen.getByTestId('edge-top'), at(100))
    for (const y of [99, 96, 90, 80, 76, 74, 70]) fireEvent.pointerMove(box, at(y)) // 5 px cells: 9.9 … 7
    fireEvent.pointerUp(box, at(70))
    await waitFor(() => expect(sizeShown()).toBe('2 columns × 3 rows'))
    // Only y0 = 5 (at 7.5 and below) differs from where it started.
    expect(updates()).toEqual([{ extent: { x0: 10, y0: 5, x1: 30, y1: 20 }, rows: 3, cols: 2 }])
  })

  it('moves a focused edge a cell per arrow key', async () => {
    await openFound()
    const top = screen.getByRole('slider', { name: 'Top edge of the grid' })
    expect(top.getAttribute('aria-valuetext')).toBe('2 rows')
    expect(top.getAttribute('aria-valuemax')).toBe('4') // up to y = 0
    top.focus()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(updates()).toEqual([{ extent: { x0: 10, y0: 5, x1: 30, y1: 20 }, rows: 3, cols: 2 }]))
    await waitFor(() => expect(screen.getByRole('slider', { name: 'Top edge of the grid' }).getAttribute('aria-valuetext')).toBe('3 rows'))
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(updates().at(-1)).toEqual({ extent: { x0: 10, y0: 10, x1: 30, y1: 20 }, rows: 2, cols: 2 }))
    screen.getByRole('slider', { name: 'Right edge of the grid' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(updates().at(-1)).toEqual({ extent: { x0: 10, y0: 10, x1: 20, y1: 20 }, rows: 2, cols: 1 }))
  })

  it('keeps the last preview while an answer is on its way, dimmed only once it is slow', async () => {
    const { worker } = await openFound(() => undefined) // answered below
    const confirm = document.querySelector('.confirm')!
    screen.getByRole('slider', { name: 'Top edge of the grid' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(confirm.hasAttribute('data-dim')).toBe(false) // not straight away
    await waitFor(() => expect(confirm.hasAttribute('data-dim')).toBe(true), { timeout: 1000 })
    expect(patternLabel()).toMatch(/2 columns by 2 rows/) // never blanked
    const asked = worker.of('update')[0]!
    await act(async () => worker.reply(asked.id, echo(asked.params)))
    await waitFor(() => expect(confirm.hasAttribute('data-dim')).toBe(false))
    expect(patternLabel()).toMatch(/2 columns by 3 rows/)
  })

  it('recomputes the warnings with every preview', async () => {
    const missing = "2 cell(s) don't closely match any detected colour — a colour may be missing; check them before committing."
    await openFound((p) => ({ ...echo(p), warnings: p.rows === 3 ? [missing] : [] }))
    expect(screen.queryByRole('list', { name: 'Warnings' })).toBeNull()
    screen.getByRole('slider', { name: 'Top edge of the grid' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(await screen.findByText(/don't closely match/)).toBeTruthy()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(screen.queryByText(/don't closely match/)).toBeNull())
  })

  it('keeps a merge through a resample, which gives the palette new ids', async () => {
    // Each resample's palette has fresh ids, and Brown a shade off, as a real one can.
    let n = 0
    await openFound((p) => {
      const preview = echo(p)
      n++
      return { ...preview, palette: preview.palette.map((e, i) => ({ ...e, id: `r${n}-${i}`, hex: i === 1 ? '#8a4412' : e.hex })) }
    })
    await userEvent.click(screen.getByRole('button', { name: 'Fewer colours' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 1 colour' })).toBeTruthy()
    screen.getByRole('slider', { name: 'Top edge of the grid' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(patternLabel()).toMatch(/2 columns by 3 rows/))
    expect(n).toBe(1)
    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 1 colour' })).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Colours' })).getAllByRole('listitem')).toHaveLength(1)
    // Undone, it is the resample's own Brown.
    await userEvent.click(screen.getByRole('button', { name: 'More colours' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Brown, #8a4412/ })).toBeTruthy()
  })

  it('puts the outline back if the resample fails', async () => {
    await openFound(() => ({ ok: false, code: 'INTERNAL', message: 'boom' }) as never)
    screen.getByRole('slider', { name: 'Left edge of the grid' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(await screen.findByText(/Couldn't update the preview: boom/)).toBeTruthy()
    await waitFor(() => expect(extentShown()).toEqual([10, 10, 20, 10]))
  })

  it('has no handles while the grid is being found again', async () => {
    const worker = confirmingWorker(echo)
    const auto = worker.auto!
    worker.auto = (msg) => (msg.type === 'open' ? found() : msg.type === 'redetect' ? undefined : auto(msg))
    detection.reset(worker)
    handOffImage({ file: new File([PNG], 'dog.png', { type: 'image/png' }) })
    await renderApp('#/import')
    await waitFor(() => expect(screen.getByTestId('edge-top')).toBeTruthy())
    drag(layOutSource(), [5, 5], [395, 295])
    await waitFor(() => expect(detection.worker.of('redetect')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByTestId('edge-top')).toBeNull())
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
    handOffImage({ file: new File([PNG], 'dog.png', { type: 'image/png' }) })
    await renderApp('#/import')
    const alert = await screen.findByRole('alert', {}, { timeout: 2000 })
    expect(alert.textContent).toMatch(/taking too long to read/)
    expect(alert.textContent).toMatch(/Drag a box around just the squares on your image/)
    expect(detection.worker.terminated).toBe(true)
    return alert
  }

  it('stops a detection that runs too long, and Try again starts a fresh worker', async () => {
    const alert = await timedOut()
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Save & edit pattern' })).toBeTruthy()
    await waitFor(() => expect(sizeShown()).toBe('4 columns × 3 rows'))
    expect(detection.worker.of('boot')).toHaveLength(2) // a new worker boots again
    expect(detection.worker.of('open')[1]).not.toHaveProperty('crop')
  })

  it('a box drawn on the image starts over on just that', async () => {
    await timedOut()
    drag(layOutSource(), [100, 75], [300, 225])
    await waitFor(() => expect(detection.worker.of('open')).toHaveLength(2))
    expect(detection.worker.of('open')[1]).toMatchObject({ crop: [10, 7, 30, 22] })
    expect(await screen.findByRole('button', { name: 'Save & edit pattern' })).toBeTruthy()
  })
})

describe('with the colours below the pattern (narrower than 1100 px)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
  })

  it('shows the image, the pattern and the colours together, with no tabs', async () => {
    await openImport()
    expect(screen.queryByRole('tablist')).toBeNull()
    for (const name of ['Your image', 'Pattern', 'Colours, 2 colours']) expect(screen.getByRole('region', { name })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Colours' })).toBeTruthy()
    drag(layOutSource(), [100, 75], [300, 225], 'touch')
    await waitFor(() => expect(sizeShown()).toBe('6 columns × 5 rows'))
  })

  it('says which colour the pattern is showing, with a way back to all of them', async () => {
    await openImport()
    await userEvent.click(screen.getByRole('button', { name: /^Brown,/ }))
    expect(screen.getByText(/Showing where Brown is used/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show all colours' }))
    expect(screen.queryByText(/Showing where Brown is used/)).toBeNull()
  })
})
