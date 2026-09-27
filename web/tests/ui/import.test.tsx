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
import { readAlpha } from '../../src/storage/alpha.ts'
import { detectingWorker, FakeWorker, makePreview } from '../detect/fakeWorker.ts'
import { detection } from './fakeDetection.ts'
import { hashChanged, renderApp, screen, sizeShown } from './helpers.tsx'

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
    expect(await screen.findByText('Finding the grid…')).toBeTruthy()
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
    expect(sizeShown()).toBe('4 × 3 stitches · 12 total')
    expect(screen.getByRole('region', { name: 'Pattern' }).contains(document.querySelector('.confirm__stats'))).toBe(true)
    expect(document.querySelector('.palette__total')?.textContent).toBe('Total12 stitches')
    expect(screen.queryByText(/strings needed/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-detect' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset to detected grid' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Drag the handles to choose which part becomes the pattern.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Colours' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    // No yarn shades until a range is chosen under "Advanced: match to yarn".
    expect(within(list).getAllByRole('button', { pressed: false }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'White, #ffffff, 6 stitches',
      'Brown, #8b4513, 6 stitches',
    ])
    expect(list.querySelector('.shade')).toBeNull()
    const advanced = screen.getByText('Advanced: match to yarn').closest('details')!
    expect(advanced.open).toBe(false)
    expect(screen.getByRole('combobox', { name: 'Match colours to' })).toHaveProperty('value', '')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Match colours to' }), 'dmc')
    await waitFor(() =>
      expect(within(list).getAllByRole('button', { pressed: false }).map((b) => b.getAttribute('aria-label'))).toEqual([
        'White, #ffffff, 6 stitches, nearest DMC stranded cotton White',
        'Brown, #8b4513, 6 stitches, nearest DMC stranded cotton 975 Dark Golden Brown',
      ]),
    )
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

  it('removes a colour into the nearest one, restores it, and saves what is shown', async () => {
    const { repo } = await openImport()
    await saveButton()
    await userEvent.click(screen.getByRole('button', { name: 'Remove “Brown”' }))

    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 1 colour' })).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Colours' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByRole('button', { name: /^White, #ffffff, 12 stitches/ })).toBeTruthy()
    // The last colour can't go.
    expect(screen.getByRole('button', { name: 'Remove “White”' }).hasAttribute('disabled')).toBe(true)
    // Focus lands on Restore, so a slip is one key away from undone.
    const restore = screen.getByRole('button', { name: 'Restore “Brown”' })
    expect(document.activeElement).toBe(restore)

    await userEvent.click(restore)
    expect(screen.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Removed colours' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Remove “Brown”' }))
    await userEvent.click(await saveButton())
    await waitFor(() => expect(window.location.hash).toBe('#/design/pattern-1'))
    const { project } = await repo.open('pattern-1')
    expect(project.pattern.palette.map((e) => [e.name, e.count])).toEqual([['White', 12]])
    expect(new Set(project.pattern.cells)).toEqual(new Set([0]))
    expect(project.pattern.row_ids).toEqual(['r0', 'r1', 'r2'])
  })

  it('starts a new image with every colour', async () => {
    await openImport()
    await saveButton()
    await userEvent.click(screen.getByRole('button', { name: 'Remove “Brown”' }))
    await userEvent.upload(screen.getAllByLabelText('Choose a chart image')[0]!, photo('cat.png'))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull()
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
    await userEvent.upload(screen.getAllByLabelText('Choose a chart image')[0]!, photo('straight.png'))
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
    expect(screen.getByText('Choose a photo or screenshot of an alpha chart.')).toBeTruthy()
    expect(detection.worker.sent).toEqual([]) // nothing is loaded until there's an image
    await userEvent.upload(screen.getByLabelText('Choose a chart image'), photo('cat.webp'))
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
    await userEvent.upload(screen.getAllByLabelText('Choose a chart image')[0]!, photo('other.png'))
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
