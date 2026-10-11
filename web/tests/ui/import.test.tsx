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
import type { DetectionErrorCode } from '../../src/detect/protocol.ts'
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
  await screen.findByRole('heading', { level: 1, name: 'Import a chart' })
  return view
}

/** "Photo to pattern", lazily loaded, with `name` waiting to be made into a pattern. */
async function openPhoto(name: string | null = 'dog') {
  if (name !== null) handOffImage({ file: photo(`${name}.png`) })
  const view = await renderApp('#/photo')
  await screen.findByRole('heading', { level: 1, name: 'Photo to pattern' })
  return view
}

const saveButton = () => screen.findByRole('button', { name: 'Save & edit pattern' })
/** A picture's size field, by its name. */
const field = (within_: HTMLElement, name: string) => within(within_).getByRole('textbox', { name }) as HTMLInputElement
const nameField = () => screen.getByRole('textbox', { name: 'Pattern name' }) as HTMLInputElement

describe('Import screen', () => {
  it('shows real download progress while Pyodide boots, then detects', async () => {
    const worker = new FakeWorker() // answers nothing until told to
    detection.reset(worker)
    await openImport()
    await waitFor(() => expect(worker.of('boot')).toHaveLength(1))
    expect(await screen.findByText('Getting the pattern reader ready…')).toBeTruthy()
    expect(screen.getByText(/First time only: about \d+ MB/)).toBeTruthy()

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
    expect(document.querySelector('.import-note')?.textContent).toBe('Check it against your imageCheck the dimensions.')
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
    expect(screen.getByRole('heading', { level: 1, name: 'Import a chart' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose image…' })).toBeTruthy()
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

/** A worker that reads every image as bridge.py does for what's asked: as `first`
 *  ('chart' or 'pixels') for a chart, or failing with `failWith`; always as a picture
 *  when a picture is asked for, answering its settings. */
function readingWorker(first: 'chart' | 'pixels', { sure = true, photoLike = false, failWith = null as DetectionErrorCode | null } = {}) {
  const w = detectingWorker()
  const auto = w.auto!
  const s = {
    width: 8,
    height: null as number | null,
    keepShape: true,
    colours: 6,
    detail: 0.5,
    outlines: false,
    extent: { x0: 0, y0: 0, x1: 400, y1: 300 },
  }
  const pictures = new Set<number>()
  const answer = (session: number) =>
    pictures.has(session)
      ? makePicturePreview(session, s)
      : makePreview(session, 3, 4, { reading: { kind: first, sure, photoLike, failure: null }, mode: first })
  w.auto = (msg) => {
    switch (msg.type) {
      case 'open': {
        const opened = auto(msg) as { session: number } // count the session
        if (msg.intent === 'picture') {
          pictures.add(opened.session)
          return answer(opened.session)
        }
        if (failWith) {
          return {
            ok: false,
            code: failWith,
            message: 'no chart',
            session: opened.session,
            reading: { kind: 'chart', sure: true, photoLike: false, failure: failWith },
          }
        }
        return answer(opened.session)
      }
      case 'update':
        // In bridge.set_params's order, by convert.PictureState's rules (square stitches).
        if (msg.params.extent !== undefined) s.extent = msg.params.extent
        if (msg.params.keepShape !== undefined && msg.params.keepShape !== s.keepShape) {
          s.keepShape = msg.params.keepShape
          s.height = s.keepShape ? null : makePicturePreview(msg.session, s).rows
        }
        if (msg.params.width !== undefined) {
          s.width = msg.params.width
          if (s.keepShape) s.height = null
        }
        if (msg.params.height !== undefined) {
          s.height = msg.params.height
          if (s.keepShape) s.width = Math.round((s.height * 400) / 300)
        }
        if (msg.params.colours !== undefined) s.colours = msg.params.colours
        if (msg.params.detail !== undefined) s.detail = msg.params.detail
        if (msg.params.outlines !== undefined) s.outlines = msg.params.outlines
        return answer(msg.session)
      default:
        return auto(msg)
    }
  }
  return w
}

const noteText = () => document.querySelector('.import-note')?.textContent ?? null

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

describe('Import a chart', () => {
  it('reads a chart, and says nothing more when it read cleanly', async () => {
    detection.reset(readingWorker('chart'))
    await openLaidOut()
    expect(detection.worker.of('open')[0]).not.toHaveProperty('intent') // a chart, the default
    expect(noteText()).toBeNull()
    expect(screen.queryByRole('button', { name: /Photo to pattern/ })).toBeNull()
    expect(edgeHandles()).toHaveLength(4)
    expect(screen.queryByRole('group', { name: 'Picture settings' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset to detected grid' })).toBeTruthy()
  })

  it('warns of a chart read with doubts, and offers Photo to pattern with the same image and name', async () => {
    detection.reset(readingWorker('chart', { sure: false }))
    await openImport()
    await saveButton()
    expect(noteText()).toBe('Check it against your imageMany squares are hard to readOpen in Photo to pattern')
    expect(document.querySelector('.import-note')!.hasAttribute('data-warning')).toBe(true)
    await userEvent.type(nameField(), 'Bunny')
    await userEvent.click(screen.getByRole('button', { name: 'Open in Photo to pattern' }))
    await screen.findByRole('heading', { level: 1, name: 'Photo to pattern' })
    expect(window.location.hash).toBe('#/photo')
    await screen.findByRole('group', { name: 'Picture settings' })
    expect(detection.worker.of('open').map((o) => o.intent)).toEqual([undefined, 'picture'])
    expect(nameField().value).toBe('Bunny')
    // The chart's session was closed; the worker kept (it holds Pyodide).
    expect(detection.worker.of('close').map((c) => c.session)).toEqual([1])
    expect(detection.release).not.toHaveBeenCalled()
  })

  it('reads a grid that looked more like a photo’s, and offers Photo to pattern quietly', async () => {
    detection.reset(readingWorker('chart', { photoLike: true }))
    await openImport()
    await saveButton()
    expect(sizeShown()).toBe('4 columns × 3 rows')
    expect(noteText()).toBe('Looks like a photo, not a chartOpen in Photo to pattern')
    expect(document.querySelector('.import-note')!.hasAttribute('data-warning')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Open in Photo to pattern' }))
    await screen.findByRole('heading', { level: 1, name: 'Photo to pattern' })
  })

  it.each(['NO_GRIDLINES', 'LOW_RESOLUTION'] as const)(
    'never turns an image it can’t read (%s) into a pattern unasked, and offers Photo to pattern',
    async (code) => {
      detection.reset(readingWorker('chart', { failWith: code }))
      await openImport()
      const alert = await screen.findByRole('alert')
      expect(within(alert).getByText(FAILURE_HINTS[code].title)).toBeTruthy()
      expect(screen.queryByRole('group', { name: 'Picture settings' })).toBeNull()
      expect(within(alert).getByText(/Not a chart\? Photo to pattern makes a new pattern from any photo or drawing\./)).toBeTruthy()
      await userEvent.click(within(alert).getByRole('button', { name: 'Use Photo to pattern' }))
      await screen.findByRole('group', { name: 'Picture settings' })
      expect(detection.worker.of('open').at(-1)).toMatchObject({ intent: 'picture' })
      expect((await saveButton()).hasAttribute('disabled')).toBe(false)

      // Back returns to the chart screen, which reads the same image as a chart again.
      window.history.back()
      await screen.findByRole('heading', { level: 1, name: 'Import a chart' })
      await waitFor(() => expect(detection.worker.of('open')).toHaveLength(3))
      expect(detection.worker.of('open')[2]).not.toHaveProperty('intent')
    },
  )

  it('reads pixel art block by block, with nothing to adjust and nothing to switch to', async () => {
    detection.reset(readingWorker('pixels'))
    await openLaidOut()
    expect(noteText()).toBe('Read as pixel art: each block is one stitch')
    expect(within(document.querySelector('.import-note') as HTMLElement).queryByRole('button', { name: /Photo to pattern/ })).toBeNull()
    // Exact: no outline to move (a chart's has four edges, above), no picture settings.
    expect(screen.getByTestId('grid-overlay')).toBeTruthy()
    expect(edgeHandles()).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Picture settings' })).toBeNull()
    expect(sizeShown()).toBe('4 columns × 3 rows')
  })
})

describe('Photo to pattern', () => {
  it('asks for a photo or drawing when there is none', async () => {
    await openPhoto(null)
    expect(screen.getByRole('heading', { level: 1, name: 'Photo to pattern' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose image…' })).toBeTruthy()
    expect(detection.worker.sent).toEqual([])
  })

  it('turns any image into a pattern, with its width, detail and colours to change', async () => {
    detection.reset(readingWorker('chart'))
    await openPhoto()
    await saveButton()
    expect(detection.worker.of('open')[0]).toMatchObject({ intent: 'picture' })
    // The screen is named for what it does: no line saying what the image was read as.
    expect(noteText()).toBeNull()
    const settings = screen.getByRole('group', { name: 'Picture settings' })
    expect(field(settings, 'Width').value).toBe('8')
    expect(field(settings, 'Height').value).toBe('6')
    // The fields say the size: no line repeating it.
    expect(within(settings).queryByText(/8 × 6/)).toBeNull()
    expect(within(settings).getByText('Balanced')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use the whole picture' }).hasAttribute('disabled')).toBe(true)

    const width = within(settings).getByRole('slider', { name: 'Width slider' }) as HTMLInputElement
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

  it('sets the height too, keeping the proportions unless that is unticked', async () => {
    detection.reset(readingWorker('chart'))
    await openPhoto()
    await saveButton()
    const settings = screen.getByRole('group', { name: 'Picture settings' })
    const keep = within(settings).getByRole('checkbox', { name: 'Keep proportions' }) as HTMLInputElement
    expect(keep.checked).toBe(true)
    expect(field(settings, 'Height').value).toBe('6')
    const slide = (label: string, value: string) => {
      const input = within(settings).getByRole('slider', { name: `${label} slider` }) as HTMLInputElement
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }

    // Kept: the width follows the height.
    slide('Height', '9')
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ height: 9 }))
    await waitFor(() => expect(sizeShown()).toBe('12 columns × 9 rows'))
    expect(field(settings, 'Width').value).toBe('12')

    // Let go: each is as set.
    await userEvent.click(keep)
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ keepShape: false }))
    await waitFor(() => expect(keep.checked).toBe(false))
    slide('Height', '20')
    await waitFor(() => expect(sizeShown()).toBe('12 columns × 20 rows'))
    slide('Width', '30')
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ width: 30 }))
    await waitFor(() => expect(sizeShown()).toBe('30 columns × 20 rows'))

    // Kept again: the width stays, and the rows follow it.
    await userEvent.click(keep)
    await waitFor(() => expect(sizeShown()).toBe('30 columns × 23 rows'))
    expect(keep.checked).toBe(true)
  })

  it('keeps outlines when asked, off to start with', async () => {
    detection.reset(readingWorker('chart'))
    await openPhoto()
    await saveButton()
    const toggle = within(screen.getByRole('group', { name: 'Picture settings' })).getByRole('switch', { name: 'Keep outlines' })
    expect((toggle as HTMLInputElement).checked).toBe(false)
    expect(toggle.getAttribute('aria-describedby')).toBeTruthy()
    await userEvent.click(toggle)
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ outlines: true }))
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true))
    await userEvent.click(toggle)
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ outlines: false }))
  })

  it('saves a picture as converted, and opens it in Design', async () => {
    detection.reset(readingWorker('chart'))
    const { repo } = await openPhoto()
    await userEvent.click(await saveButton())
    await waitFor(() => expect(window.location.hash).toBe('#/design/pattern-1'))
    expect((await repo.open('pattern-1')).project.stage).toBe('design')
  })

  it('makes a dropped or chosen image a picture too', async () => {
    detection.reset(readingWorker('chart'))
    await openPhoto()
    await saveButton()
    await userEvent.upload(screen.getAllByLabelText('Choose an image')[0]!, photo('other.png'))
    await waitFor(() => expect(detection.worker.of('open')).toHaveLength(2))
    expect(detection.worker.of('open')[1]).toMatchObject({ intent: 'picture' })
  })

  it('sends the stitch shape from the swatch, once it is measured', async () => {
    const storage = memoryStorage()
    const settings = createSettingsStore(() => storage)
    settings.set({ swatchStitches: 16, swatchRows: 20, swatchWidthCm: 10, swatchHeightCm: 10 })
    detection.reset(readingWorker('chart'))
    handOffImage({ file: photo('cat.png') })
    await renderApp('#/photo', { settings })
    await saveButton()
    expect(detection.worker.of('open')[0]!.cellAspect).toBeCloseTo(0.8)
    // …and the finished size, under the sliders: 8 stitches of 0.625 cm, 6 rows of 0.5.
    const finished = screen.getByRole('group', { name: 'Finished size' })
    expect(field(finished, 'Finished width').value).toBe('5')
    expect(field(finished, 'Finished height').value).toBe('3')
    expect(within(finished).getByText('cm')).toBeTruthy()
  })

  it('takes a width or height typed, asked for on Enter or on leaving the field', async () => {
    detection.reset(readingWorker('chart'))
    await openPhoto()
    await saveButton()
    const settings = screen.getByRole('group', { name: 'Picture settings' })
    const width = field(settings, 'Width')
    const sent = () => detection.worker.of('update').length
    const before = sent()
    await userEvent.clear(width)
    await userEvent.type(width, '144')
    // Not 1, then 14, then 144 across: nothing asked for while typing.
    expect(sent()).toBe(before)
    expect(width.value).toBe('144')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ width: 144 }))
    await waitFor(() => expect(sizeShown()).toBe('144 columns × 108 rows'))
    expect(width.value).toBe('144')

    // Leaving the field asks too; the height, kept in shape, moves the width.
    const height = field(settings, 'Height')
    await userEvent.clear(height)
    await userEvent.type(height, '30')
    await userEvent.tab()
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ height: 30 }))
    await waitFor(() => expect(width.value).toBe('40'))

    // The arrow keys step by one, at once.
    await userEvent.click(width)
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ width: 41 }))
  })

  it('says what a size can be, and asks for the nearest, when one typed is outside it', async () => {
    detection.reset(readingWorker('chart'))
    await openPhoto()
    await saveButton()
    const settings = screen.getByRole('group', { name: 'Picture settings' })
    const width = field(settings, 'Width')
    await userEvent.clear(width)
    await userEvent.type(width, '5000')
    expect(width.getAttribute('aria-invalid')).toBe('true')
    // The fake picture is 400 pixels across: one stitch per pixel at most.
    expect(settings.querySelector('.picture-controls__bounds')?.textContent).toBe('4 to 400')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ width: 400 }))
    await waitFor(() => expect(width.value).toBe('400'))
    expect(settings.querySelector('.picture-controls__bounds')).toBeNull()

    // Not a number, or Escape: back to the value, nothing asked.
    const before = detection.worker.of('update').length
    await userEvent.clear(width)
    await userEvent.type(width, 'abc')
    expect(width.getAttribute('aria-invalid')).toBe('true')
    await userEvent.tab()
    expect(width.value).toBe('400')
    await userEvent.clear(width)
    await userEvent.type(width, '50{Escape}')
    expect(width.value).toBe('400')
    expect(detection.worker.of('update').length).toBe(before)
  })

  it('takes a finished size typed, in the units chosen, as the nearest stitches and rows', async () => {
    const storage = memoryStorage()
    const settings = createSettingsStore(() => storage)
    // 3 stitches and 3.25 rows an inch (The Crochet Crowd's 12 sc and 13 rows over 4").
    settings.set({ units: 'imperial', swatchStitches: 12, swatchRows: 13, swatchWidthCm: 4 * 2.54, swatchHeightCm: 4 * 2.54 })
    detection.reset(readingWorker('chart'))
    handOffImage({ file: photo('cat.png') })
    await renderApp('#/photo', { settings })
    await saveButton()
    const finished = screen.getByRole('group', { name: 'Finished size' })
    expect(within(finished).getByText('in')).toBeTruthy()
    const across = field(finished, 'Finished width')
    await userEvent.clear(across)
    await userEvent.type(across, '48{Enter}')
    // 48 inches at 3 an inch.
    await waitFor(() => expect(detection.worker.of('update').at(-1)!.params).toEqual({ width: 144 }))
    await waitFor(() => expect(field(screen.getByRole('group', { name: 'Picture settings' }), 'Width').value).toBe('144'))
    expect(across.value).toBe('48')
  })

  it('shows no finished size until the swatch is measured', async () => {
    detection.reset(readingWorker('chart'))
    await openPhoto()
    await saveButton()
    expect(screen.queryByRole('group', { name: 'Finished size' })).toBeNull()
  })
})
