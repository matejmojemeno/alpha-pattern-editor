// @vitest-environment jsdom
/**
 * Adding, seeing, replacing and removing the photo of what was made: from a finished
 * card in the Library, and from the Work stage once every row is done.
 */
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareMadePhoto } from '../../src/app/madePhoto.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import type { ProjectRepo } from '../../src/storage/repo.ts'
import { fixture, freshRepo, renderApp, screen } from './helpers.tsx'

// jsdom can't decode or draw an image: e2e/made-photo.spec.ts does it in a real browser.
// Here the "prepared" photo is the file's own bytes, or a refusal for a file named bad.
vi.mock('../../src/app/madePhoto.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/madePhoto.ts')>()
  return {
    ...actual,
    prepareMadePhoto: vi.fn(async (file: File) => {
      if (file.name.startsWith('bad')) throw new actual.MadePhotoError("That file couldn't be opened as a photo. Try a JPEG or PNG.")
      return new Uint8Array(await file.arrayBuffer())
    }),
  }
})

beforeEach(() => vi.clearAllMocks())

const id = readAlpha(fixture('with-source.alpha')).project.pattern.id
const photoFile = (text: string, name = 'blanket.jpg') => new File([text], name, { type: 'image/jpeg' })
const photoText = async (repo: ProjectRepo) => {
  const b = await repo.madePhoto(id)
  return b && new TextDecoder().decode(b)
}

async function finishedProject() {
  const repo = await freshRepo()
  await repo.importFile(fixture('with-source.alpha'))
  const { project } = await repo.open(id)
  await repo.save({ ...project, progress: { ...project.progress, completed_row_ids: new Set(project.pattern.row_ids) } })
  return repo
}

async function chooseFromMenu(item: string, user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: 'More for “with-source”' }))
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: item }))
}
/** Choose `file` in the photo picker inside `where` (the first one on the page by default). */
function pick(file: File, where: HTMLElement = document.body) {
  const input = within(where).getAllByLabelText('Choose a photo of what you made')[0] as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe('Library: the photo of what you made', () => {
  it('is offered on finished cards only', async () => {
    const repo = await freshRepo()
    await repo.importFile(fixture('with-source.alpha'))
    await repo.importFile(fixture('basic.alpha'))
    await renderApp('#/library', { repo })
    const user = userEvent.setup()
    for (const name of ['with-source', 'basic']) {
      await user.click(screen.getByRole('button', { name: `More for “${name}”` }))
      expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: /photo/i })).toBeNull()
      await user.keyboard('{Escape}')
    }
  })

  it('adds one from ⋯, which becomes the thumbnail, then shows, replaces and removes it', async () => {
    const repo = await finishedProject()
    await renderApp('#/library', { repo })
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    await chooseFromMenu('Add photo…', user)
    // The menu item opens the picker straight away.
    expect(click).toHaveBeenCalled()
    click.mockRestore()
    pick(photoFile('blanket'))
    await screen.findByText('Added a photo of “with-source”.')
    expect(await photoText(repo)).toBe('blanket')
    expect(prepareMadePhoto).toHaveBeenCalledTimes(1)
    // jsdom can't downscale it, so the thumbnail itself is checked in e2e.
    expect((await repo.summary(id))!.made_photo).toBe(true)

    // Now ⋯ has Photo, which shows it with Replace and Remove.
    await chooseFromMenu('Photo', user)
    const dialog = await screen.findByRole('dialog', { name: 'with-source' })
    await waitFor(() => expect(within(dialog).getByRole('img', { name: 'What you made from “with-source”' })).toBeTruthy())
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }))

    pick(photoFile('better'), dialog)
    await waitFor(async () => expect(await photoText(repo)).toBe('better'))

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(within(dialog).getByText('Remove this photo from the pattern?')).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep it' }))
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    expect(await photoText(repo)).toBe('better')

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await repo.madePhoto(id)).toBeNull()
    // Back to offering Add photo…
    await user.click(screen.getByRole('button', { name: 'More for “with-source”' }))
    await waitFor(() => expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Add photo…' })).toBeTruthy())
  })

  it('says why a file could not be used, and stores nothing', async () => {
    const repo = await finishedProject()
    await renderApp('#/library', { repo })
    await chooseFromMenu('Add photo…')
    pick(photoFile('x', 'bad.heic'))
    await screen.findByText("That file couldn't be opened as a photo. Try a JPEG or PNG.")
    expect(await repo.madePhoto(id)).toBeNull()
  })
})

describe('Work: the photo of what you made', () => {
  it('is offered once every row is done, and shown after', async () => {
    const repo = await finishedProject()
    await renderApp(`#/work/${id}`, { repo })
    expect(screen.getByText('Every row is done.')).toBeTruthy()
    const add = await screen.findByRole('button', { name: 'Add a photo of what you made…' })
    expect(add).toBeTruthy()
    pick(photoFile('blanket'))
    await screen.findByRole('img', { name: 'What you made from “with-source”' })
    expect(await photoText(repo)).toBe('blanket')
    expect((await repo.summary(id))!.made_photo).toBe(true)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Remove the photo?' })
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await screen.findByRole('button', { name: 'Add a photo of what you made…' })
    expect(await repo.madePhoto(id)).toBeNull()
  })

  it('is not offered while rows are left', async () => {
    const repo = await freshRepo()
    await repo.importFile(fixture('with-source.alpha'))
    await renderApp(`#/work/${id}`, { repo })
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull()
  })
})
