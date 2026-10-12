// @vitest-environment jsdom
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { APP_VERSION } from '../../src/app/build.ts'
import { FEEDBACK_EMAIL } from '../../src/app/feedback.ts'
import { pendingImage } from '../../src/app/pendingImage.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { detection } from './fakeDetection.ts'
import { alphaFile, fixture, renderApp, screen } from './helpers.tsx'

const basicId = () => readAlpha(fixture('basic.alpha')).project.pattern.id

const pickerLabel = 'Choose a pattern file or chart image to import'
const image = (name: string, type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type })

beforeEach(() => detection.reset())

describe('Landing screen', () => {
  it('offers a drop zone to import, and the other ways in beside it', async () => {
    await renderApp('#/')
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha Pattern Editor' })).toBeTruthy()

    const importTile = screen.getByRole('button', { name: /Import a chart/ })
    expect(importTile.className).toContain('drop-zone')
    // One line under the title, and nothing else: what it takes, and how.
    expect(importTile.textContent).toMatch(/Drop, paste or click to choose an image or \.alpha file/)
    expect(importTile.querySelectorAll('.drop-zone__how--pointer').length).toBe(1)
    const accept = (screen.getByLabelText(pickerLabel) as HTMLInputElement).accept
    for (const t of ['.alpha', '.png', '.jpg', '.webp', 'image/jpeg']) expect(accept).toContain(t)

    expect(screen.getByRole('button', { name: 'Design from scratch' })).toBeTruthy()

    expect(screen.getByRole('link', { name: /Library/ }).getAttribute('href')).toBe('#/library')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('#/settings')

    // No backend: feedback is an email (no GitHub account needed), with a subject, and a
    // body that has the version and asks for the browser and device. Not a new tab.
    const feedback = screen.getByRole('link', { name: 'Feedback' })
    const mail = new URL(feedback.getAttribute('href')!)
    expect(mail.protocol).toBe('mailto:')
    expect(mail.pathname).toBe(FEEDBACK_EMAIL)
    expect(mail.searchParams.get('subject')).toBe('Alpha Pattern Editor feedback')
    expect(mail.searchParams.get('body')).toContain(`Version: ${APP_VERSION}`)
    expect(mail.searchParams.get('body')).toMatch(/Browser and device/)
    expect(feedback.getAttribute('target')).toBeNull()

    // Help opens the guide's first page, in a new tab so the app stays where it is.
    const help = screen.getByRole('link', { name: /^Help ?\(opens in a new tab\)$/ })
    expect(help.getAttribute('href')).toBe(
      'https://github.com/matejmojemeno/alpha-pattern-editor/blob/main/docs/guide/index.md',
    )
    expect(help.getAttribute('target')).toBe('_blank')
    expect(help.getAttribute('rel')).toContain('noopener')

    // A photo is made into a pattern by asking for it, on its own tile.
    const photo = screen.getByRole('link', { name: 'Photo to pattern' })
    expect(photo.getAttribute('href')).toBe('#/photo')

    // Each tile is its name alone (and a count or a new-tab arrow), and the header the
    // app's name alone: no descriptions.
    expect(document.querySelector('.tile__text')).toBeNull()
    expect(document.querySelector('.landing__header p')).toBeNull()

    // Stacked beside the drop zone, the two ways to make a new pattern together.
    const tiles = within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)
    expect(tiles.map((t) => /^(Photo to pattern|Library|Design from scratch|Settings|Help|Feedback)/.exec(t ?? '')?.[1])).toEqual([
      'Photo to pattern',
      'Design from scratch',
      'Library',
      'Settings',
      'Help',
      'Feedback',
    ])
  })

  it('highlights the drop zone while a file is dragged over the page', async () => {
    await renderApp('#/')
    const zone = screen.getByRole('button', { name: /Import a chart/ })
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    expect(zone.className).not.toContain('drop-zone--over')
    fireEvent.dragEnter(screen.getByRole('main'), { dataTransfer })
    expect(zone.className).toContain('drop-zone--over')
    fireEvent.dragLeave(screen.getByRole('main'), { dataTransfer })
    expect(zone.className).not.toContain('drop-zone--over')
  })

  it('designs a new pattern: size and colour, saved, then opened in the Design stage', async () => {
    const { repo } = await renderApp('#/')
    const user = userEvent.setup()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Design from scratch' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Design from scratch' }))
    const dialog = screen.getByRole('dialog', { name: 'New pattern' })
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'))

    // A size out of range can't be created.
    const cols = within(dialog).getByLabelText('Columns')
    await user.clear(cols)
    await user.type(cols, '1000')
    const create = within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(dialog.textContent).toMatch(/1 to 999/)

    await user.clear(cols)
    await user.type(cols, '12')
    const rows = within(dialog).getByLabelText('Rows')
    await user.clear(rows)
    await user.type(rows, '7')
    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Bookmark')
    fireEvent.input(within(dialog).getByLabelText('Colour'), { target: { value: '#336699' } })
    expect(dialog.textContent).not.toMatch(/strings|1 to 999/)
    await user.click(create)

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/design\/[0-9a-f]{32}$/))
    const id = window.location.hash.split('/').at(-1)!
    const { project } = await repo.open(id)
    expect(project.stage).toBe('design')
    expect(project.pattern).toMatchObject({ name: 'Bookmark', cols: 12, rows: 7 })
    expect(project.pattern.palette).toEqual([expect.objectContaining({ hex: '#336699', count: 84 })])
    expect(new Set(project.pattern.row_ids).size).toBe(7)
  })

  it('cancels the new-pattern dialog without creating anything', async () => {
    const { repo } = await renderApp('#/')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Design from scratch' }) as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(screen.getByRole('button', { name: 'Design from scratch' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.hash).toBe('#/')
    expect(await repo.list()).toEqual([])
  })

  it('counts the projects in the Library', async () => {
    const { repo } = await renderApp('#/')
    expect(screen.getByRole('link', { name: /Library/ }).textContent).not.toMatch(/[0-9]/)
    await repo.importFile(fixture('basic.alpha'))
    // Re-render from scratch, as returning to the screen would.
    await renderApp('#/', { repo })
    expect(screen.getAllByRole('link', { name: /Library/ }).at(-1)!.textContent).toMatch(/, 1 project$/)
  })

  it('updates the count when projects change while it is showing', async () => {
    const { repo } = await renderApp('#/')
    const tile = () => screen.getByRole('link', { name: /Library/ }).textContent
    expect(tile()).not.toMatch(/[0-9]/)
    await act(async () => {
      await repo.importFile(fixture('basic.alpha'))
      await repo.importFile(fixture('unicode.alpha'))
    })
    await waitFor(() => expect(tile()).toMatch(/, 2 projects$/))
    await act(async () => {
      await repo.delete(basicId())
    })
    await waitFor(() => expect(tile()).toMatch(/, 1 project$/))
  })

  it('imports a .alpha file through the picker and opens it', async () => {
    const { repo } = await renderApp('#/')
    const input = screen.getByLabelText('Choose a pattern file or chart image to import')
    await userEvent.upload(input, alphaFile('basic.alpha'))
    await waitFor(() => expect(window.location.hash).toBe(`#/work/${basicId()}`))
    expect((await repo.list()).map((s) => s.name)).toEqual(['basic'])
    expect(await screen.findByRole('heading', { level: 1, name: 'basic' })).toBeTruthy()
  })

  it('imports a dropped .alpha file', async () => {
    const { repo } = await renderApp('#/')
    const main = screen.getByRole('main')
    const dataTransfer = { types: ['Files'], files: [alphaFile('basic.alpha')], dropEffect: 'none' }
    fireEvent.dragEnter(main, { dataTransfer })
    expect(screen.getByText('Drop an image or .alpha files to import them')).toBeTruthy()
    fireEvent.drop(main, { dataTransfer })
    await waitFor(() => expect(window.location.hash).toBe(`#/work/${basicId()}`))
    expect(await repo.list()).toHaveLength(1)
  })

  it('sends a chart image to the import screen', async () => {
    const { repo } = await renderApp('#/')
    await userEvent.upload(screen.getByLabelText(pickerLabel), image('My Dog.chart.jpg', 'image/jpeg'))
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Import a chart' })).toBeTruthy()
    expect((pendingImage()!.file as File).name).toBe('My Dog.chart.jpg')
    expect(await repo.list()).toEqual([])
  })

  it('recognises images by type or by extension', async () => {
    await renderApp('#/')
    await userEvent.upload(screen.getByLabelText(pickerLabel), image('photo', 'image/webp'), { applyAccept: false })
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    expect((pendingImage()!.file as File).name).toBe('photo')
  })

  it("refuses images it can't read, and anything else that isn't a .alpha file", async () => {
    const { repo } = await renderApp('#/')
    await userEvent.upload(
      screen.getByLabelText(pickerLabel),
      [image('anim.gif', 'image/gif'), new File(['x'], 'notes.txt', { type: 'text/plain' })],
      { applyAccept: false },
    )
    const status = screen.getByRole('status')
    await waitFor(() => expect(within(status).getByText(/anim\.gif/).textContent).toMatch(/PNG, JPEG or WebP/))
    expect(within(status).getByText(/notes\.txt/).textContent).toMatch(/isn't a \.alpha file or a chart image/)
    expect(await repo.list()).toEqual([])
    expect(window.location.hash).toBe('#/')
  })

  it('imports .alpha files and opens the first image when given both', async () => {
    const { repo } = await renderApp('#/')
    await userEvent.upload(
      screen.getByLabelText(pickerLabel),
      [alphaFile('basic.alpha'), image('one.png'), image('two.png')],
      { applyAccept: false },
    )
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    expect((await repo.list()).map((s) => s.name)).toEqual(['basic'])
    expect((pendingImage()!.file as File).name).toBe('one.png')
    const notes = pendingImage()!.notices!.map((n) => n.text).join(' ')
    expect(notes).toMatch(/Imported “basic”/)
    expect(notes).toMatch(/One image at a time: opened “one\.png”/)
    expect(await screen.findByText(/One image at a time/)).toBeTruthy()
  })

  it('starts loading detection when the pointer or focus reaches either import', async () => {
    await renderApp('#/')
    expect(detection.preload).not.toHaveBeenCalled()
    const tile = screen.getByRole('button', { name: /Import a chart/ })
    fireEvent.pointerEnter(tile)
    expect(detection.preload).toHaveBeenCalledTimes(1)
    act(() => tile.focus())
    expect(detection.preload).toHaveBeenCalledTimes(2)
    const photo = screen.getByRole('link', { name: /Photo to pattern/ })
    fireEvent.pointerEnter(photo)
    act(() => photo.focus())
    expect(detection.preload).toHaveBeenCalledTimes(4)
  })

  it('opens a pasted image', async () => {
    await renderApp('#/')
    const file = image('image.png')
    fireEvent.paste(document.body, { clipboardData: { files: [file], types: ['Files'] } })
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    expect(pendingImage()).toEqual({ file })
  })

  it('leaves pastes without an image, and pastes into text fields, alone', async () => {
    await renderApp('#/')
    fireEvent.paste(document.body, { clipboardData: { files: [], types: ['text/plain'] } })
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.paste(input, { clipboardData: { files: [image('x.png')], types: ['Files'] } })
    input.remove()
    await act(async () => {})
    expect(window.location.hash).toBe('#/')
  })

  it('releases detection on every screen but the import screen', async () => {
    await renderApp('#/library')
    expect(detection.release).toHaveBeenCalled()
  })
})
