// @vitest-environment jsdom
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { pendingImage } from '../../src/app/pendingImage.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { detection } from './fakeDetection.ts'
import { alphaFile, fixture, renderApp, screen } from './helpers.tsx'

const basicId = () => readAlpha(fixture('basic.alpha')).project.pattern.id

const pickerLabel = 'Choose a pattern file or chart image to import'
const image = (name: string, type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type })

beforeEach(() => detection.reset())

describe('Landing screen', () => {
  it('offers the four entry points', async () => {
    await renderApp('#/')
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha Pattern Editor' })).toBeTruthy()

    const importTile = screen.getByRole('button', { name: /Import pattern/ })
    expect(importTile.textContent).toMatch(/\.alpha/)
    expect(importTile.textContent).toMatch(/photo or screenshot of a chart/)
    const accept = (screen.getByLabelText(pickerLabel) as HTMLInputElement).accept
    for (const t of ['.alpha', '.png', '.jpg', '.webp', 'image/jpeg']) expect(accept).toContain(t)

    const design = screen.getByRole('button', { name: /Design pattern/ })
    expect(design.getAttribute('aria-disabled')).toBe('true')
    expect(design.textContent).toMatch(/Coming later/)

    expect(screen.getByRole('link', { name: /Library/ }).getAttribute('href')).toBe('#/library')
    expect(screen.getByRole('link', { name: /Settings/ }).getAttribute('href')).toBe('#/settings')
  })

  it('does nothing when the disabled Design tile is pressed', async () => {
    await renderApp('#/')
    await userEvent.click(screen.getByRole('button', { name: /Design pattern/ }))
    expect(window.location.hash).toBe('#/')
  })

  it('counts the projects in the Library', async () => {
    const { repo } = await renderApp('#/')
    expect(screen.getByRole('link', { name: /Library/ }).textContent).toMatch(/No projects yet/)
    await repo.importFile(fixture('basic.alpha'))
    // Re-render from scratch, as returning to the screen would.
    await renderApp('#/', { repo })
    expect(screen.getAllByRole('link', { name: /Library/ }).at(-1)!.textContent).toMatch(/1 project saved/)
  })

  it('updates the count when projects change while it is showing', async () => {
    const { repo } = await renderApp('#/')
    const tile = () => screen.getByRole('link', { name: /Library/ }).textContent
    expect(tile()).toMatch(/No projects yet/)
    await act(async () => {
      await repo.importFile(fixture('basic.alpha'))
      await repo.importFile(fixture('unicode.alpha'))
    })
    await waitFor(() => expect(tile()).toMatch(/2 projects saved/))
    await act(async () => {
      await repo.delete(basicId())
    })
    await waitFor(() => expect(tile()).toMatch(/1 project saved/))
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
    expect(screen.getByText('Drop a chart image or .alpha files to import them')).toBeTruthy()
    fireEvent.drop(main, { dataTransfer })
    await waitFor(() => expect(window.location.hash).toBe(`#/work/${basicId()}`))
    expect(await repo.list()).toHaveLength(1)
  })

  it('sends a chart image to the import screen, named after the file', async () => {
    const { repo } = await renderApp('#/')
    await userEvent.upload(screen.getByLabelText(pickerLabel), image('My Dog.chart.jpg', 'image/jpeg'))
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Import pattern' })).toBeTruthy()
    expect(pendingImage()?.name).toBe('My Dog.chart')
    expect(await repo.list()).toEqual([])
  })

  it('recognises images by type or by extension', async () => {
    await renderApp('#/')
    await userEvent.upload(screen.getByLabelText(pickerLabel), image('photo', 'image/webp'), { applyAccept: false })
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    expect(pendingImage()?.name).toBe('photo')
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
    expect(pendingImage()?.name).toBe('one')
    const notes = pendingImage()!.notices!.map((n) => n.text).join(' ')
    expect(notes).toMatch(/Imported “basic”/)
    expect(notes).toMatch(/One image at a time: opened “one\.png”/)
    expect(await screen.findByText(/One image at a time/)).toBeTruthy()
  })

  it('starts loading detection when the pointer or focus reaches Import pattern', async () => {
    await renderApp('#/')
    expect(detection.preload).not.toHaveBeenCalled()
    const tile = screen.getByRole('button', { name: /Import pattern/ })
    fireEvent.pointerEnter(tile)
    expect(detection.preload).toHaveBeenCalledTimes(1)
    act(() => tile.focus())
    expect(detection.preload).toHaveBeenCalledTimes(2)
  })

  it('opens a pasted image as “Pasted pattern”', async () => {
    await renderApp('#/')
    const file = image('image.png')
    fireEvent.paste(document.body, { clipboardData: { files: [file], types: ['Files'] } })
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    expect(pendingImage()).toMatchObject({ file, name: 'Pasted pattern' })
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
