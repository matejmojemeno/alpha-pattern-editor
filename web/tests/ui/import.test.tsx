// @vitest-environment jsdom
/**
 * The import screen's states (loading, result, failure) and saving, with the real
 * DetectClient on a fake worker (fakeDetection.ts).
 */
import { act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { handOffImage } from '../../src/app/pendingImage.ts'
import { navigate } from '../../src/app/router.ts'
import { FAILURE_HINTS } from '../../src/importer/hints.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { detectingWorker, FakeWorker, makePreview } from '../detect/fakeWorker.ts'
import { detection } from './fakeDetection.ts'
import { hashChanged, renderApp, screen } from './helpers.tsx'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const photo = (name = 'dog.png') => new File([PNG], name, { type: 'image/png' })

beforeEach(() => detection.reset())

/** The import screen, lazily loaded, with `name` waiting to be imported. */
async function openImport(name: string | null = 'dog') {
  if (name !== null) handOffImage({ file: photo(`${name}.png`), name })
  const view = await renderApp('#/import')
  await screen.findByRole('heading', { level: 1, name: 'Import pattern' })
  return view
}

const saveButton = () => screen.findByRole('button', { name: 'Save & edit pattern' })

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
    expect(screen.getByText('4 cols × 3 rows · 12 stitches · 2 colours · 5 strings needed')).toBeTruthy()
    const colours = within(screen.getByRole('list', { name: 'Colours' })).getAllByRole('listitem')
    // With each colour's nearest DMC shade, once that library has loaded.
    await waitFor(() =>
      expect(colours.map((c) => c.textContent)).toEqual([
        '6 White stitchesNearest shade: White',
        '6 Brown stitchesNearest shade: 975 Dark Golden Brown',
      ]),
    )
    expect(screen.getByRole('combobox', { name: 'Match colours to' })).toHaveProperty('value', 'dmc')
    expect(within(screen.getByRole('list', { name: 'Warnings' })).getByText('Check the dimensions.')).toBeTruthy()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('dog')
  })

  it('saves with the source image and opens the Design stage (§7.3)', async () => {
    const { repo } = await openImport()
    const name = screen.getByLabelText('Name') as HTMLInputElement
    await saveButton()
    await userEvent.clear(name)
    expect((await saveButton()).hasAttribute('disabled')).toBe(true) // no empty names
    await userEvent.type(name, '  My   dog ')
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

  it.each(Object.entries(FAILURE_HINTS))('explains a %s failure and offers another image', async (code, hint) => {
    detection.reset(detectingWorker({ failWith: code }))
    await openImport()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(hint.title)).toBeTruthy()
    expect(within(alert).getByText(`Detection failed (${code})`)).toBeTruthy()
    expect(within(alert).getByRole('button', { name: 'Try another image' })).toBeTruthy()
    if (code === 'NO_GRIDLINES') {
      // Crop is here now, so the hint points to it, with a button to start.
      expect(alert.textContent).toMatch(/Turn on Crop/)
      expect(within(alert).getByRole('button', { name: 'Crop' })).toBeTruthy()
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
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('straight')
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
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('cat')
  })

  it('names a pasted image “Pasted pattern”', async () => {
    await openImport(null)
    const file = photo('image.png')
    act(() => {
      const e = new Event('paste', { bubbles: true }) as Event & { clipboardData: unknown }
      e.clipboardData = { files: [file], types: ['Files'] }
      document.body.dispatchEvent(e)
    })
    expect(await saveButton()).toBeTruthy()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Pasted pattern')
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
