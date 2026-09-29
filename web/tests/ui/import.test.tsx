// @vitest-environment jsdom
/**
 * The import screen's states (loading, result, failure) and saving, with the real
 * DetectClient on a fake worker (fakeDetection.ts).
 */
import { act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handOffImage, timestampName } from '../../src/app/pendingImage.ts'
import { navigate } from '../../src/app/router.ts'
import { FAILURE_HINTS } from '../../src/importer/hints.ts'
import { createSettingsStore } from '../../src/settings/store.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { detectingWorker, FakeWorker, makePicturePreview, makePreview } from '../detect/fakeWorker.ts'
import { detection } from './fakeDetection.ts'
import { hashChanged, memoryStorage, renderApp, screen, sizeShown } from './helpers.tsx'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const photo = (name = 'dog.png') => new File([PNG], name, { type: 'image/png' })

beforeEach(() => detection.reset())

/** The import screen, lazily loaded, with `name` waiting to be imported. */
async function openImport(name: string | null = 'dog') {
  if (name !== null) handOffImage({ file: photo(`${name}.png`) })
  const view = await renderApp('#/import')
  await screen.findByRole('heading', { level: 1, name: 'Import pattern' })
  return view
}

const saveButton = () => screen.findByRole('button', { name: 'Save & edit pattern' })
const nameField = () => screen.getByRole('textbox', { name: 'Pattern name' }) as HTMLInputElement

describe('Import screen', () => {
  it('shows real download progress while Pyodide boots, then detects', async () => {
    const worker = new FakeWorker() // answers nothing until told to
    detection.reset(worker)
    await openImport()
    await waitFor(() => expect(worker.of('boot')).toHaveLength(1))
    expect(await screen.findByText('Getting the pattern reader ready…')).toBeTruthy()
    expect(screen.getByText(/The first import downloads about \d+ MB/)).toBeTruthy()

    act(() => worker.progress({ stage: 'runtime', loaded: 25, total: 100 }))
    expect(screen.getByText('Downloading Python (1 of 3) · 25%')).toBeTruthy()
    expect((screen.getByLabelText('Download progress') as HTMLProgressElement).value).toBe(25)
    act(() => worker.progress({ stage: 'numpy', loaded: 70, total: 100 }))
    expect(screen.getByText('Downloading numpy (2 of 3) · 70%')).toBeTruthy()
    act(() => worker.progress({ stage: 'core', loaded: 100, total: 100 }))
    expect(screen.getByText('Loading the pattern reader (3 of 3) · 100%')).toBeTruthy()

    await act(async () => worker.reply(worker.of('boot')[0]!.id, { ok: true }))
    expect(await screen.findByText('Reading your image…')).toBeTruthy()
    const open = worker.of('open')[0]!
    expect(open).toMatchObject({ width: 40, height: 30, maxPixels: 4_000_000 })
    await act(async () => worker.reply(open.id, makePreview(1, 3, 4, { warnings: ['5/12 cells have low confidence'] })))
    expect(await saveButton()).toBeTruthy()
  })

  it('shows the result: the image, the pattern, its size, colours and warnings', async () => {
    const worker = detectingWorker()
    worker.auto = ((auto) => (msg) =>
      msg.type === 'open' ? makePreview(1, 3, 4, { warnings: ['Check the dimensions.'] }) : auto(msg))(worker.auto!)
    detection.reset(worker)
    await openImport()
    await saveButton()
    expect(screen.getByRole('img', { name: 'The image being imported' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'The detected pattern: 4 columns by 3 rows' })).toBeTruthy()
    // The size under the pattern; the colour count heads the colour list, the total at
    // its foot, and strings aren't worth the room here.
    expect(sizeShown()).toBe('4 columns × 3 rows')
    expect(screen.getByRole('region', { name: 'Pattern' }).contains(document.querySelector('.confirm__stats'))).toBe(true)
    expect(document.querySelector('.palette__total')?.textContent).toBe('Total12 stitches')
    expect(screen.queryByText(/strings needed/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-detect' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset to detected grid' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(/Drag the handles/)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Colours' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getAllByRole('button', { pressed: false }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'White, #ffffff, 6 stitches',
      'Brown, #8b4513, 6 stitches',
    ])
    expect(within(screen.getByRole('list', { name: 'Warnings' })).getByText('Check the dimensions.')).toBeTruthy()
    expect(nameField()).toMatchObject({ value: '', placeholder: 'Untitled pattern' })
    expect(screen.getByText('Pattern name').tagName).toBe('LABEL')
  })

  it('saves with the source image and opens the Design stage (§7.3)', async () => {
    const { repo } = await openImport()
    await saveButton()
    await userEvent.type(nameField(), '  My   dog ')
    await userEvent.click(await saveButton())
    await waitFor(() => expect(window.location.hash).toBe('#/design/pattern-1'))

    expect(detection.worker.of('commit')[0]).toMatchObject({ name: 'My dog' })
    const { project, sourcePng } = await repo.open('pattern-1')
    expect(project.pattern.name).toBe('My dog')
    expect(project.stage).toBe('design')
    expect(project.progress.completed_row_ids.size).toBe(0)
    expect([...project.pattern.cells]).toEqual([...makePreview(1).cells])
    expect(sourcePng).toEqual(PNG) // a PNG keeps its own bytes
    const exported = readAlpha(new Uint8Array(await (await repo.exportFile('pattern-1')).blob.arrayBuffer()))
    expect(exported.project.pattern.palette.map((e) => e.name)).toEqual(['White', 'Brown'])
  })

  it('names a pattern saved without a name by the moment it was saved, in local time', async () => {
    const { repo } = await openImport()
    await userEvent.type(nameField(), '   ') // nothing but spaces is no name
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 8, 27, 12, 15, 30))
      await userEvent.click(await saveButton())
      await waitFor(() => expect(window.location.hash).toBe('#/design/pattern-1'))
    } finally {
      vi.useRealTimers()
    }
    expect(detection.worker.of('commit')[0]).toMatchObject({ name: '2026-09-27-121530' })
    expect((await repo.open('pattern-1')).project.pattern.name).toBe('2026-09-27-121530')
  })

  it('pads every part of the timestamp to its width', () => {
    expect(timestampName(new Date(2027, 0, 3, 9, 5, 7))).toBe('2027-01-03-090507')
  })

  it('lowers the colour count by merging the two most alike, and raises it by undoing that', async () => {
    // White twice, cream and black once: white and cream are the most alike.
    const three = () =>
      makePreview(1, 1, 4, {
        cells: new Uint16Array([0, 0, 1, 2]),
        palette: [
          { id: 'w', hex: '#ffffff', name: 'White', dmc: null, count: 2 },
          { id: 'c', hex: '#f0ece0', name: 'Cream', dmc: null, count: 1 },
          { id: 'k', hex: '#000000', name: 'Black', dmc: null, count: 1 },
        ],
      })
    const worker = detectingWorker()
    worker.auto = ((auto) => (msg) => {
      if (msg.type === 'open') return three()
      const reply = auto(msg)
      // The committed pattern is built from the same detection.
      if (msg.type === 'commit') {
        const { cells, palette } = three()
        const r = reply as { pattern: object }
        return { ...r, pattern: { ...r.pattern, rows: 1, cols: 4, row_ids: ['r0'], cells, palette } } as typeof reply
      }
      return reply
    })(worker.auto!)
    detection.reset(worker)
    const { repo } = await openImport()
    await saveButton()
    const count = within(screen.getByRole('group', { name: 'Number of colours' }))
    const fewer = count.getByRole('button', { name: 'Fewer colours' })
    const more = count.getByRole('button', { name: 'More colours' })
    const names = () => within(screen.getByRole('list', { name: 'Colours' })).getAllByRole('button', { pressed: false }).map((b) => b.getAttribute('aria-label'))
    expect(count.getByRole('status').textContent).toBe('3')
    expect(more.hasAttribute('disabled')).toBe(true) // nothing to undo yet

    // Cream goes into white, the one used more.
    await userEvent.click(fewer)
    expect(count.getByRole('status').textContent).toBe('2')
    expect(names()).toEqual(['White, #ffffff, 3 stitches', 'Black, #000000, 1 stitch'])
    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeTruthy()
    // A merge isn't listed as a removal: + is its undo.
    expect(screen.queryByRole('list', { name: 'Removed colours' })).toBeNull()

    // Down to one, and no further.
    await userEvent.click(fewer)
    expect(count.getByRole('status').textContent).toBe('1')
    expect(fewer.hasAttribute('disabled')).toBe(true)

    // Back up, one merge at a time, to exactly what was detected.
    await userEvent.click(more)
    expect(names()).toEqual(['White, #ffffff, 3 stitches', 'Black, #000000, 1 stitch'])
    await userEvent.click(more)
    expect(names()).toEqual(['White, #ffffff, 2 stitches', 'Cream, #f0ece0, 1 stitch', 'Black, #000000, 1 stitch'])
    expect(more.hasAttribute('disabled')).toBe(true)

    // What's saved is what's shown.
    await userEvent.click(fewer)
    await userEvent.click(await saveButton())
    await waitFor(() => expect(window.location.hash).toBe('#/design/pattern-1'))
    const { project } = await repo.open('pattern-1')
    expect(project.pattern.palette.map((e) => [e.hex, e.count])).toEqual([
      ['#ffffff', 3],
      ['#000000', 1],
    ])
  })

  it('shows where a colour is used while it is pointed at, focused, or picked', async () => {
    await openImport()
    await saveButton()
    const pattern = () => screen.getByRole('img', { name: /^The detected pattern/ }).getAttribute('aria-label')
    const brown = screen.getByRole('button', { name: /^Brown,/ })
    const row = brown.closest('li')!
    expect(pattern()).toBe('The detected pattern: 4 columns by 3 rows')

    await userEvent.hover(row)
    expect(pattern()).toBe('The detected pattern: 4 columns by 3 rows, showing where Brown is used')
    expect(row.hasAttribute('data-shown')).toBe(true)
    await userEvent.unhover(row)
    expect(pattern()).toBe('The detected pattern: 4 columns by 3 rows')

    // A click keeps it showing, after the pointer and the focus have gone.
    await userEvent.click(brown)
    expect(brown.getAttribute('aria-pressed')).toBe('true')
    await userEvent.unhover(row)
    act(() => brown.blur())
    expect(pattern()).toMatch(/showing where Brown is used$/)
    // Pointing at another shows that one while it lasts.
    const white = screen.getByRole('button', { name: /^White,/ })
    await userEvent.hover(white.closest('li')!)
    expect(pattern()).toMatch(/showing where White is used$/)
    await userEvent.unhover(white.closest('li')!)
    expect(pattern()).toMatch(/showing where Brown is used$/)
    await userEvent.click(brown)
    act(() => brown.blur())
    expect(brown.getAttribute('aria-pressed')).toBe('false')
    expect(pattern()).toBe('The detected pattern: 4 columns by 3 rows')
  })

  it('is for checking the grid: no removing colours, no yarn, no Visualize (those are the Design stage’s)', async () => {
    // Even with a yarn range chosen: shades are for buying, in "Yarn & size".
    const storage = memoryStorage()
    const settings = createSettingsStore(() => storage)
    settings.set({ colourLibrary: 'dmc' })
    handOffImage({ file: photo() })
    await renderApp('#/import', { settings })
    await saveButton()
    const list = screen.getByRole('list', { name: 'Colours' })
    // Each colour is one button, to show where it is used; nothing else in the list.
    expect(within(list).getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Removed colours' })).toBeNull()
    expect(screen.queryByText('Advanced: match to yarn')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Match colours to' })).toBeNull()
    expect(document.querySelector('.shade')).toBeNull()
    expect(screen.queryByText(/Nearest/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Yarn & size' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Visualize' })).toBeNull()
    // The bar at the top is the name and Save.
    const bar = document.querySelector('.savebar')!
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Save & edit pattern'])
  })

  it('starts a new image with every colour', async () => {
    await openImport()
    await saveButton()
    await userEvent.click(screen.getByRole('button', { name: 'Fewer colours' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 1 colour' })).toBeTruthy()
    await userEvent.upload(screen.getAllByLabelText('Choose an image')[0]!, photo('cat.png'))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'More colours' }).hasAttribute('disabled')).toBe(true)
  })

  it.each(Object.entries(FAILURE_HINTS))('explains a %s failure and offers another image', async (code, hint) => {
    detection.reset(detectingWorker({ failWith: code }))
    await openImport()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(hint.title)).toBeTruthy()
    expect(within(alert).getByText(`Detection failed (${code})`)).toBeTruthy()
    expect(within(alert).getByRole('button', { name: 'Try another image' })).toBeTruthy()
    if (code === 'NO_GRIDLINES') {
      // A box can be drawn on the image beside it, so the hint points there.
      expect(alert.textContent).toMatch(/Drag a box around just the squares on your image/)
    }
    expect((await saveButton()).hasAttribute('disabled')).toBe(true)
    // The image stays on screen.
    expect(screen.getByRole('img', { name: 'The image being imported' })).toBeTruthy()
  })

  it('tries another image after a failure', async () => {
    detection.reset(detectingWorker({ failWith: 'ROTATED' }))
    await openImport()
    await screen.findByText(FAILURE_HINTS.ROTATED.title)
    const ok = detectingWorker()
    detection.worker.auto = ok.auto
    await userEvent.upload(screen.getAllByLabelText('Choose an image')[0]!, photo('straight.png'))
    expect(await saveButton()).toBeTruthy()
    expect(nameField()).toMatchObject({ value: '', placeholder: 'Untitled pattern' })
    expect(detection.worker.of('open')).toHaveLength(2)
    // The first image's session was closed.
    expect(detection.worker.of('close').map((c) => c.session)).toEqual([1])
  })

  it('reports a failed download and retries it', async () => {
    const worker = detectingWorker()
    const auto = worker.auto!
    let boots = 0
    worker.auto = (msg) => (msg.type === 'boot' && ++boots === 1 ? { ok: false, code: 'BOOT_FAILED', message: 'offline' } : auto(msg))
    detection.reset(worker)
    await openImport()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/couldn't be loaded.*offline/)
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await saveButton()).toBeTruthy()
    expect(boots).toBe(2)
  })

  it('asks for an image when there is none (after a reload)', async () => {
    await openImport(null)
    expect(screen.getByText('Choose a photo or screenshot of an alpha chart, or any picture to turn into a pattern.')).toBeTruthy()
    expect(detection.worker.sent).toEqual([]) // nothing is loaded until there's an image
    await userEvent.upload(screen.getByLabelText('Choose an image'), photo('cat.webp'))
    expect(await saveButton()).toBeTruthy()
    expect(nameField()).toMatchObject({ value: '', placeholder: 'Untitled pattern' })
  })

  it('imports a pasted image, with the name left empty', async () => {
    await openImport(null)
    const file = photo('image.png')
    act(() => {
      const e = new Event('paste', { bubbles: true }) as Event & { clipboardData: unknown }
      e.clipboardData = { files: [file], types: ['Files'] }
      document.body.dispatchEvent(e)
    })
    expect(await saveButton()).toBeTruthy()
    expect(nameField()).toMatchObject({ value: '', placeholder: 'Untitled pattern' })
  })

  it('keeps the name typed when the image is replaced', async () => {
    await openImport()
    await saveButton()
    await userEvent.type(nameField(), 'Dachshund')
    await userEvent.upload(screen.getAllByLabelText('Choose an image')[0]!, photo('other.png'))
    await waitFor(() => expect(detection.worker.of('open')).toHaveLength(2))
    expect(nameField().value).toBe('Dachshund')
  })

  it('closes the session and releases the worker when leaving', async () => {
    await openImport()
    await saveButton()
    expect(detection.release).not.toHaveBeenCalled()
    navigate('/library')
    await hashChanged()
    expect(detection.release).toHaveBeenCalled()
    expect(detection.worker.of('close').map((c) => c.session)).toEqual([1])
  })
})

/** A worker that reads every image as `first` ('chart' or 'picture'), and answers mode
 *  switches and a picture's settings as bridge.py does. */
function readingWorker(first: 'chart' | 'picture' | 'pixels', { sure = true, canChart = first === 'chart' } = {}) {
  const w = detectingWorker()
  const auto = w.auto!
  const s = { mode: first, width: 8, colours: 6, detail: 0.5, extent: { x0: 0, y0: 0, x1: 400, y1: 300 } }
  const reading = { kind: first, sure, canChart, canPixels: first === 'pixels', failure: null }
  const answer = (session: number) =>
    s.mode === 'picture'
      ? { ...makePicturePreview(session, { ...s, canChart, kind: first }), reading }
      : makePreview(session, 3, 4, { reading, mode: s.mode })
  w.auto = (msg) => {
    switch (msg.type) {
      case 'open':
        auto(msg) // count the session
        return answer(msg.id)
      case 'mode':
        s.mode = msg.mode
        return answer(msg.session)
      case 'update':
        if (msg.params.width !== undefined) s.width = msg.params.width
        if (msg.params.colours !== undefined) s.colours = msg.params.colours
        if (msg.params.detail !== undefined) s.detail = msg.params.detail
        if (msg.params.extent !== undefined) s.extent = msg.params.extent
        return answer(msg.session)
      default:
        return auto(msg)
    }
  }
  return w
}

const kindLineText = () => document.querySelector('.confirm__kind')?.textContent ?? null

/** Open the import screen with every box 400×300 (jsdom measures everything as 0), so
 *  the image and its outline are drawn (as corrections.test.tsx does). */
async function openLaidOut() {
  const proto = Element.prototype
  const saved = [Object.getOwnPropertyDescriptor(proto, 'clientWidth')!, Object.getOwnPropertyDescriptor(proto, 'clientHeight')!]
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 400 })
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 300 })
  try {
    await openImport()
    await saveButton()
  } finally {
    Object.defineProperty(proto, 'clientWidth', saved[0]!)
    Object.defineProperty(proto, 'clientHeight', saved[1]!)
  }
}
const edgeHandles = () => screen.queryAllByRole('slider', { name: /edge of the grid/ })

describe('Import screen: charts and pictures', () => {
  it('says quietly that a chart was read as one, with the way to a picture', async () => {
    detection.reset(readingWorker('chart'))
    await openLaidOut()
    expect(kindLineText()).toMatch(/^Read from the squares of your chart\./)
    expect(document.querySelector('.confirm__kind')!.hasAttribute('data-prominent')).toBe(false)
    // Nothing else changes for a chart: its outline has its four edges to drag.
    expect(edgeHandles()).toHaveLength(4)
    expect(screen.queryByRole('group', { name: 'Picture settings' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset to detected grid' })).toBeTruthy()
  })

  it('sets the picture reading apart when the chart reading is in doubt', async () => {
    detection.reset(readingWorker('chart', { sure: false }))
    await openImport()
    await saveButton()
    expect(kindLineText()).toMatch(/Not sure this is a chart/)
    expect(document.querySelector('.confirm__kind')!.hasAttribute('data-prominent')).toBe(true)
  })

  it('turns a picture into a pattern, with its width, detail and colours to change', async () => {
    detection.reset(readingWorker('picture'))
    await openImport()
    await saveButton()
    expect(kindLineText()).toMatch(/looks like a picture, not a chart/)
    // No grid was found in it, so there's no chart reading to go back to.
    expect(within(document.querySelector('.confirm__kind') as HTMLElement).queryByRole('button')).toBeNull()
    const settings = screen.getByRole('group', { name: 'Picture settings' })
    expect(within(settings).getByText('8 stitches')).toBeTruthy()
    expect(within(settings).getByText('8 × 6 stitches')).toBeTruthy()
    expect(within(settings).getByText('Balanced')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use the whole picture' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('list', { name: 'Warnings' })).toBeNull()

    const width = within(settings).getByLabelText('Width') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(width, '12')
      width.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ width: 12 }))
    await waitFor(() => expect(sizeShown()).toBe('12 columns × 9 rows'))

    // 6 asked for, 2 shown (the rest unused): the count steps from what's shown, and 2 is
    // the fewest a picture is made in.
    expect(screen.getByRole('button', { name: 'Fewer colours' }).hasAttribute('disabled')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'More colours' }))
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ colours: 3 }))
  })

  it('saves a picture as converted, and opens it in Design', async () => {
    detection.reset(readingWorker('picture'))
    const { repo } = await openImport()
    await userEvent.click(await saveButton())
    await waitFor(() => expect(window.location.hash).toBe('#/design/pattern-1'))
    expect((await repo.open('pattern-1')).project.stage).toBe('design')
  })

  it('switches a chart to a picture and back', async () => {
    detection.reset(readingWorker('chart'))
    await openImport()
    await saveButton()
    await userEvent.click(screen.getByRole('button', { name: 'Turn it into a pattern instead' }))
    await screen.findByRole('group', { name: 'Picture settings' })
    expect(detection.worker.of('mode').map((m) => m.mode)).toEqual(['picture'])
    expect(kindLineText()).toMatch(/^Turned into a pattern from your picture\./)
    expect(screen.getByRole('button', { name: 'Use the whole picture' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Read it as a chart instead' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Picture settings' })).toBeNull())
    expect(detection.worker.of('mode').map((m) => m.mode)).toEqual(['picture', 'chart'])
    expect(sizeShown()).toBe('4 columns × 3 rows')
  })

  it('offers to turn a chart it can’t read into a pattern anyway', async () => {
    const worker = readingWorker('chart')
    const auto = worker.auto!
    worker.auto = (msg) =>
      msg.type === 'open'
        ? {
            ok: false,
            code: 'LOW_RESOLUTION',
            message: 'too fine',
            session: 1,
            reading: { kind: 'chart', sure: true, canChart: false, canPixels: false, failure: 'LOW_RESOLUTION' },
          }
        : auto(msg)
    detection.reset(worker)
    await openImport()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(FAILURE_HINTS.LOW_RESOLUTION.title)).toBeTruthy()
    await userEvent.click(within(alert).getByRole('button', { name: 'Turn it into a pattern anyway' }))
    await screen.findByRole('group', { name: 'Picture settings' })
    expect(detection.worker.of('mode')[0]).toMatchObject({ session: 1, mode: 'picture' })
    expect((await saveButton()).hasAttribute('disabled')).toBe(false)
  })

  it('reads pixel art block by block, with nothing to adjust, and switches to a picture and back', async () => {
    detection.reset(readingWorker('pixels'))
    await openLaidOut()
    expect(kindLineText()).toMatch(/^Read pixel by pixel: each block of your image is one stitch\./)
    // Exact: no outline to move (a chart's has four edges, above), no picture settings.
    expect(screen.getByTestId('grid-overlay')).toBeTruthy()
    expect(edgeHandles()).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Picture settings' })).toBeNull()
    expect(sizeShown()).toBe('4 columns × 3 rows')

    await userEvent.click(screen.getByRole('button', { name: 'Turn it into a pattern instead' }))
    await screen.findByRole('group', { name: 'Picture settings' })
    await userEvent.click(screen.getByRole('button', { name: 'Read it pixel by pixel instead' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Picture settings' })).toBeNull())
    expect(detection.worker.of('mode').map((m) => m.mode)).toEqual(['picture', 'pixels'])
  })

  it('sends the stitch shape from the swatch, once it is measured', async () => {
    const storage = memoryStorage()
    const settings = createSettingsStore(() => storage)
    settings.set({ swatchStitches: 16, swatchRows: 20, swatchWidthCm: 10, swatchHeightCm: 10 })
    detection.reset(readingWorker('picture'))
    handOffImage({ file: photo('cat.png') })
    await renderApp('#/import', { settings })
    await saveButton()
    expect(detection.worker.of('open')[0]!.cellAspect).toBeCloseTo(0.8)
    // …and the finished size, beside the stitches.
    expect(within(screen.getByRole('group', { name: 'Picture settings' })).getByText(/8 × 6 stitches, about 5 × 3 cm/)).toBeTruthy()
  })
})
