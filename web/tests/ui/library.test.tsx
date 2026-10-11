// @vitest-environment jsdom
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { pendingImage } from '../../src/app/pendingImage.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { detection } from './fakeDetection.ts'
import { alphaFile, fixture, freshRepo, renderApp, screen } from './helpers.tsx'

const idOf = (name: string) => readAlpha(fixture(name)).project.pattern.id

async function withProjects(...names: string[]) {
  const repo = await freshRepo()
  for (const n of names) await repo.importFile(fixture(n))
  return renderApp('#/library', { repo })
}

// Every card, in every section, in the order they're shown.
const cards = () => [...document.querySelectorAll<HTMLElement>('ul.cards > li')]
const section = (name: string) => screen.queryByRole('region', { name: new RegExp(`^${name}`) })
/** Open a card's ⋯ menu and return it. */
async function menuOf(name: string, user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: `More for “${name}”` }))
  return screen.getByRole('menu', { name: `More for “${name}”` })
}
const itemNames = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => i.textContent)
const sectionNames = () => screen.queryAllByRole('region').map((r) => r.querySelector('h2')!.textContent)
const card = (name: string) => cards().find((c) => c.querySelector('.card__name')?.textContent === name)!

describe('Library', () => {
  it('shows an empty state and the storage note', async () => {
    await renderApp('#/library')
    expect(screen.getByRole('heading', { level: 1, name: 'Your projects' })).toBeTruthy()
    expect(screen.getByText('No projects yet.')).toBeTruthy()
    expect(screen.getByText(/saved in this browser only/).textContent).toMatch(/Export/)
  })

  it('shows a card per project: thumbnail, name, size and progress', async () => {
    await withProjects('basic.alpha', 'with-source.alpha')
    expect(cards()).toHaveLength(2)
    const withSource = within(card('with-source'))
    expect(withSource.getByText('8×6')).toBeTruthy()
    expect(withSource.getByText('33% done')).toBeTruthy()
    const basic = within(card('basic'))
    expect(basic.getByText('7×5')).toBeTruthy()
    // Not started: no bar, which could only say 0%.
    expect(basic.queryByText(/% done/)).toBeNull()
    expect(document.querySelectorAll('.thumb--photo img')).toHaveLength(1)
    expect(document.querySelectorAll('.thumb--cells img')).toHaveLength(1)
    expect(document.querySelector('.thumb img')!.getAttribute('src')).toMatch(/^blob:/)
  })

  it('reaches every card with Tab and opens one with Enter or Space', async () => {
    await withProjects('basic.alpha', 'with-source.alpha')
    const links = cards().map((c) => c.querySelector('a')!)
    expect(links.every((a) => a.tabIndex === 0)).toBe(true)

    // Tab order: the header, then each card's link, name, main button and ⋯.
    const user = userEvent.setup()
    const order: Element[] = []
    for (let i = 0; i < 10; i++) {
      await user.tab()
      order.push(document.activeElement!)
    }
    expect(order).toContain(links[0])
    expect(order).toContain(links[1])
    expect(order.indexOf(links[1]!)).toBeGreaterThan(order.indexOf(links[0]!))

    // with-source has progress, so it opens in the Work stage (§6.4).
    card('with-source').querySelector('a')!.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(window.location.hash).toBe(`#/work/${idOf('with-source.alpha')}`))
  })

  it('opens a card with Enter, in the stage it was last in when there is no progress', async () => {
    await withProjects('basic.alpha')
    const link = cards()[0]!.querySelector('a')!
    expect(link.getAttribute('href')).toBe(`#/open/${idOf('basic.alpha')}`)
    link.focus()
    await userEvent.keyboard('{Enter}')
    // basic.alpha was saved by the desktop in the Design stage, with no progress.
    await waitFor(() => expect(window.location.hash).toBe(`#/design/${idOf('basic.alpha')}`))
  })

  it('offers designing a new pattern', async () => {
    await withProjects('basic.alpha')
    await userEvent.click(screen.getByRole('button', { name: 'Design from scratch…' }))
    expect(screen.getByRole('dialog', { name: 'New pattern' })).toBeTruthy()
  })

  it('deletes only after confirmation', async () => {
    const { repo } = await withProjects('basic.alpha')
    const user = userEvent.setup()
    const more = screen.getByRole('button', { name: 'More for “basic”' })

    await user.click(within(await menuOf('basic', user)).getByRole('menuitem', { name: 'Delete' }))
    expect(screen.queryByRole('menu')).toBeNull()
    let dialog = screen.getByRole('alertdialog', { name: 'Delete project?' })
    expect(dialog.textContent).toMatch(/can't be undone/)
    // Focus starts on the safe answer; Escape cancels.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(more)
    expect(await repo.list()).toHaveLength(1)

    await user.click(within(await menuOf('basic', user)).getByRole('menuitem', { name: 'Delete' }))
    dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('No projects yet.')).toBeTruthy())
    expect(await repo.list()).toEqual([])
    expect(screen.getByRole('status').textContent).toMatch(/Deleted “basic”/)
  })

  it('exports the stored .alpha file', async () => {
    await withProjects('basic.alpha')
    const clicks: HTMLAnchorElement[] = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this)
    })
    await userEvent.click(within(await menuOf('basic')).getByRole('menuitem', { name: 'Export' }))
    await waitFor(() => expect(clicks).toHaveLength(1))
    expect(clicks[0]!.download).toBe(`basic-${idOf('basic.alpha').slice(0, 6)}.alpha`)
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(fixture('basic.alpha'))
    spy.mockRestore()
  })

  it('imports through its own picker and stays on the Library', async () => {
    await renderApp('#/library')
    await userEvent.upload(screen.getByLabelText('Choose a pattern file or chart image to import'), alphaFile('basic.alpha'))
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(screen.getByRole('status').textContent).toMatch(/Imported “basic”/)
    expect(window.location.hash).toBe('#/library')
  })

  it('sends a chart image to the import screen, and preloads detection on hover', async () => {
    await renderApp('#/library')
    const button = screen.getByRole('button', { name: 'Import…' })
    fireEvent.pointerEnter(button)
    expect(detection.preload).toHaveBeenCalled()
    const photo = new File([new Uint8Array([1])], 'rose.jpeg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('Choose a pattern file or chart image to import'), photo)
    await waitFor(() => expect(window.location.hash).toBe('#/import'))
    expect(pendingImage()).toEqual({ file: photo, notices: [] })
  })

  it('imports dropped files', async () => {
    await renderApp('#/library')
    const dataTransfer = {
      types: ['Files'],
      files: [alphaFile('basic.alpha'), alphaFile('unicode.alpha')],
    }
    fireEvent.dragEnter(screen.getByRole('main'), { dataTransfer })
    fireEvent.drop(screen.getByRole('main'), { dataTransfer })
    await waitFor(() => expect(cards()).toHaveLength(2))
  })

  it('says so when an imported project is already there, and asks before replacing it', async () => {
    const { repo } = await withProjects('basic.alpha')
    const user = userEvent.setup()
    const input = screen.getByLabelText('Choose a pattern file or chart image to import')

    await user.upload(input, alphaFile('basic.alpha', 'copy of basic.alpha'))
    let dialog = await screen.findByRole('alertdialog', { name: 'Already in your library' })
    expect(dialog.textContent).toMatch(/“basic” is already in your library, 0% done/)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/already in your library\. Kept/))

    await user.upload(input, alphaFile('basic.alpha'))
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/was already in your library\. Replaced/))
    expect(await repo.list()).toHaveLength(1)
  })

  it('re-lists when projects change after it opened', async () => {
    // Seen in review: an import started on the landing page finished after the Library
    // had opened, and the Library showed only the first project until a reload.
    const { repo } = await withProjects('basic.alpha')
    expect(cards()).toHaveLength(1)
    await act(async () => {
      await repo.importFile(fixture('with-source.alpha'))
      await repo.importFile(fixture('unicode.alpha'))
    })
    await waitFor(() => expect(cards()).toHaveLength(3))

    // A save made elsewhere (the Work stage flushing as you leave it) shows too.
    const { project } = await repo.open(idOf('basic.alpha'))
    await act(async () => {
      await repo.save({ ...project, progress: { ...project.progress, completed_row_ids: new Set([project.pattern.row_ids[0]!]) } })
    })
    await waitFor(() => expect(within(card('basic')).getByText('20% done')).toBeTruthy())
    expect(section('In progress')!.contains(card('basic'))).toBe(true)

    await act(async () => {
      await repo.delete(idOf('unicode.alpha'))
    })
    await waitFor(() => expect(cards()).toHaveLength(2))
  })

  it('lists projects under In progress, Not started and Finished, leaving out empty ones', async () => {
    const { repo } = await withProjects('basic.alpha', 'with-source.alpha', 'unicode.alpha')
    expect(sectionNames()).toEqual(['In progress 1', 'Not started 2'])
    expect(section('In progress')!.contains(card('with-source'))).toBe(true)
    expect(section('Not started')!.contains(card('basic'))).toBe(true)

    // Part of a row worked, no row finished: in progress, at 0%.
    const basic = (await repo.open(idOf('basic.alpha'))).project
    await act(async () => {
      await repo.save({ ...basic, progress: { ...basic.progress, current_row_id: basic.pattern.row_ids[0]!, current_run_index: 1 } })
    })
    await waitFor(() => expect(section('In progress')!.contains(card('basic'))).toBe(true))
    expect(within(card('basic')).getByText('0% done')).toBeTruthy()

    // Every row done: finished, and listed last.
    const withSource = (await repo.open(idOf('with-source.alpha'))).project
    await act(async () => {
      await repo.save({
        ...withSource,
        progress: { ...withSource.progress, completed_row_ids: new Set(withSource.pattern.row_ids) },
      })
    })
    await waitFor(() => expect(sectionNames()).toEqual(['In progress 1', 'Not started 1', 'Finished 1']))
    expect(section('Finished')!.contains(card('with-source'))).toBe(true)
    expect(within(card('with-source')).getByText('100% done')).toBeTruthy()
  })

  it('gives every card one main button and ⋯, by section', async () => {
    const { repo } = await withProjects('basic.alpha', 'with-source.alpha', 'unicode.alpha')
    const basicId = idOf('basic.alpha')
    const sourceId = idOf('with-source.alpha')
    // Not started: Design, and Start working on the menu.
    const design = within(card('basic')).getByRole('link', { name: 'Design “basic”' })
    expect(design.getAttribute('href')).toBe(`#/design/${basicId}`)
    expect(itemNames(await menuOf('basic'))).toEqual(['Start working', 'Export', 'Delete'])
    expect(screen.getByRole('menuitem', { name: 'Start working' }).getAttribute('href')).toBe(`#/work/${basicId}`)
    await userEvent.keyboard('{Escape}')

    // In progress: Continue, and Edit in Design on the menu.
    const go = within(card('with-source')).getByRole('link', { name: 'Continue “with-source”' })
    expect(go.getAttribute('href')).toBe(`#/work/${sourceId}`)
    expect(itemNames(await menuOf('with-source'))).toEqual(['Edit in Design', 'Export', 'Delete'])
    expect(screen.getByRole('menuitem', { name: 'Edit in Design' }).getAttribute('href')).toBe(`#/design/${sourceId}`)
    await userEvent.keyboard('{Escape}')

    // Finished: Make again.
    const { project } = await repo.open(sourceId)
    await act(async () => {
      await repo.save({ ...project, progress: { ...project.progress, completed_row_ids: new Set(project.pattern.row_ids) } })
    })
    await waitFor(() => expect(within(card('with-source')).getByRole('button', { name: 'Make again “with-source”' })).toBeTruthy())
    expect(itemNames(await menuOf('with-source'))).toEqual(['Edit in Design', 'Export', 'Delete'])

    // Every card: exactly one main button and ⋯ in its row.
    for (const c of cards()) expect(c.querySelector('.card__actions')!.children).toHaveLength(2)
  })

  it('opens the ⋯ menu with focus on its first item, moves with the arrows and closes with Escape or outside', async () => {
    await withProjects('basic.alpha')
    const user = userEvent.setup()
    const more = screen.getByRole('button', { name: 'More for “basic”' })
    more.focus()
    await user.keyboard('{Enter}')
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(document.activeElement).toBe(items[2]) // wraps round
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)
    expect(window.location.hash).toBe('#/library')

    await user.click(more)
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.click(screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('makes a finished project again as a copy with no progress, opened in Work', async () => {
    const { repo } = await withProjects('with-source.alpha')
    const id = idOf('with-source.alpha')
    const { project, sourcePng } = await repo.open(id)
    const done = new Set(project.pattern.row_ids)
    await act(async () => {
      await repo.save({ ...project, progress: { ...project.progress, completed_row_ids: done } })
    })
    const again = await screen.findByRole('button', { name: 'Make again “with-source”' })
    await userEvent.click(again)
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/work\//))
    const copyId = window.location.hash.slice('#/work/'.length)
    expect(copyId).not.toBe(id)

    const copy = await repo.open(copyId)
    expect(copy.project.pattern.name).toBe('with-source (2)')
    expect(copy.project.pattern.cells).toEqual(project.pattern.cells)
    expect(copy.project.pattern.palette).toEqual(project.pattern.palette)
    expect(copy.project.progress.completed_row_ids.size).toBe(0)
    expect(copy.sourcePng).toEqual(sourcePng)
    // The finished one is as it was.
    const original = await repo.open(id)
    expect(original.project.progress.completed_row_ids).toEqual(done)
  })

  it('renames a project from its card', async () => {
    const { repo } = await withProjects('with-source.alpha')
    const user = userEvent.setup()
    const before = await repo.open(idOf('with-source.alpha'))
    // The name is the button: pressing it renames rather than opening the project.
    const renameButton = screen.getByRole('button', { name: 'Rename “with-source”' })
    expect(renameButton.textContent).toBe('with-source')
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    await user.click(renameButton)
    expect(window.location.hash).toBe('#/library')
    const input = screen.getByLabelText<HTMLInputElement>('Project name')
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('with-source')

    // Escape leaves it alone.
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Project name')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Rename “with-source”' }))
    await user.clear(screen.getByLabelText('Project name'))
    // An empty name can't be saved.
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    await user.type(screen.getByLabelText('Project name'), '  Blanket   for Ema {Enter}')
    await waitFor(() => expect(card('Blanket for Ema')).toBeTruthy())
    expect(screen.getByRole('status').textContent).toMatch(/Renamed “with-source” to “Blanket for Ema”/)

    const after = await repo.open(idOf('with-source.alpha'))
    expect(after.project.pattern.name).toBe('Blanket for Ema')
    // Only the name changed: progress, stage and the source image are as they were.
    expect(after.project.stage).toBe(before.project.stage)
    expect(after.project.progress).toEqual(before.project.progress)
    expect(after.sourcePng).toEqual(before.sourcePng)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename “Blanket for Ema”' }))
  })

  it('refuses a file from a newer version without storing anything', async () => {
    const { repo } = await renderApp('#/library')
    await userEvent.upload(screen.getByLabelText('Choose a pattern file or chart image to import'), alphaFile('newer-format.alpha'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/newer version/))
    expect(await repo.list()).toEqual([])
  })
})
