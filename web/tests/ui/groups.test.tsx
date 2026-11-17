// @vitest-environment jsdom
import { waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { newId, newPattern } from '../../src/logic/edit.ts'
import { emptyProgress } from '../../src/model/types.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { alphaFile, fixture, freshRepo, hashChanged, renderApp, screen } from './helpers.tsx'

const idOf = (name: string) => readAlpha(fixture(name)).project.pattern.id
const BASIC = idOf('basic.alpha') // 7×5, not started
const SOURCE = idOf('with-source.alpha') // 8×6, 33% done

async function library(...names: string[]) {
  const repo = await freshRepo()
  for (const n of names) await repo.importFile(fixture(n))
  return repo
}

const cards = () => [...document.querySelectorAll<HTMLElement>('.cards > li')]
const card = (name: string) => cards().find((c) => c.querySelector('.card__name')?.textContent === name)!
async function menuOf(name: string, user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: `More for “${name}”` }))
  return screen.getByRole('menu', { name: `More for “${name}”` })
}
const itemNames = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => i.textContent)

describe('Library: projects with pieces', () => {
  it('puts a pattern in a new project from its card, which then shows one project card', async () => {
    const repo = await library('basic.alpha', 'with-source.alpha')
    await renderApp('#/library', { repo })
    const user = userEvent.setup()
    await user.click(within(await menuOf('basic', user)).getByRole('menuitem', { name: 'Add to a project…' }))
    const dialog = screen.getByRole('dialog', { name: 'Add “basic” to a project' })
    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement
    expect(add.disabled).toBe(true) // a new project needs a name
    await user.type(within(dialog).getByLabelText('New project’s name'), 'Sweater')
    await user.click(add)
    await screen.findByText('Made the project “Sweater” with “basic” in it.')
    // basic is now inside Sweater's card, not a card of its own.
    await waitFor(() => expect(card('Sweater')).toBeTruthy())
    expect(card('basic')).toBeUndefined()
    expect(within(card('Sweater')).getByText('1 piece: basic')).toBeTruthy()

    // The next one can go into the same project.
    await user.click(within(await menuOf('with-source', user)).getByRole('menuitem', { name: 'Add to a project…' }))
    const again = screen.getByRole('dialog', { name: 'Add “with-source” to a project' })
    await user.click(within(again).getByRole('radio', { name: 'Sweater' }))
    await user.click(within(again).getByRole('button', { name: 'Add' }))
    await screen.findByText('Added “with-source” to “Sweater”.')
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(within(card('Sweater')).getByText('2 pieces: basic, with-source')).toBeTruthy()
  })

  it('a project card: in progress by its pieces, a stitch-weighted bar, Continue on the current piece', async () => {
    const repo = await library('basic.alpha', 'with-source.alpha')
    const g = await repo.createGroup('Sweater', [BASIC, SOURCE])
    await renderApp('#/library', { repo })
    const c = card('Sweater')
    expect(c.closest('section')!.querySelector('h2')!.textContent).toMatch(/^In progress/)
    // with-source: 2 of 6 rows × 8 = 16 of 48 stitches; basic: 0 of 35. 16 / 83 = 19%.
    expect(within(c).getByText('19% done')).toBeTruthy()
    expect(within(c).getByRole('link', { name: 'Continue “Sweater”' }).getAttribute('href')).toBe(`#/work/${SOURCE}`)
    expect(within(c).getByRole('link', { name: 'Pieces of “Sweater”' }).getAttribute('href')).toBe(`#/project/${g.id}`)
    expect(itemNames(await menuOf('Sweater'))).toEqual(['Open project', 'Export', 'Ungroup…'])
    expect(c.querySelectorAll('.group-thumbs .thumb')).toHaveLength(2)
  })

  it('a project not started has Open, and no bar', async () => {
    const repo = await library('basic.alpha')
    await repo.createGroup('Hat', [BASIC])
    await renderApp('#/library', { repo })
    const c = card('Hat')
    expect(c.closest('section')!.querySelector('h2')!.textContent).toMatch(/^Not started/)
    expect(within(c).getByRole('link', { name: 'Open “Hat”' })).toBeTruthy()
    expect(within(c).queryByText(/% done/)).toBeNull()
  })

  it('ungrouping asks first, then keeps every pattern', async () => {
    const repo = await library('basic.alpha', 'with-source.alpha')
    await repo.createGroup('Sweater', [BASIC, SOURCE])
    await renderApp('#/library', { repo })
    const user = userEvent.setup()
    await user.click(within(await menuOf('Sweater', user)).getByRole('menuitem', { name: 'Ungroup…' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Ungroup “Sweater”?' })
    expect(dialog.textContent).toMatch(/2 pieces stay in your Library/)
    await user.click(within(dialog).getByRole('button', { name: 'Ungroup' }))
    await waitFor(() => expect(cards()).toHaveLength(2))
    expect(await repo.groups()).toEqual([])
    expect((await repo.list()).length).toBe(2)
  })

  it('the project view lists its pieces by label, moves, relabels and removes them', async () => {
    const repo = await library('basic.alpha', 'with-source.alpha')
    const g = await repo.createGroup('Sweater', [BASIC, SOURCE])
    await renderApp(`#/project/${g.id}`, { repo })
    expect(await screen.findByRole('heading', { level: 1, name: 'Sweater' })).toBeTruthy()
    expect(screen.getByText('2 pieces')).toBeTruthy()
    expect(document.querySelector('.group__summary')!.textContent).toBe('2 pieces19% done')
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe(`#/work/${SOURCE}`)
    const names = () => cards().map((c) => c.querySelector('.card__name')!.textContent)
    expect(names()).toEqual(['basic', 'with-source'])
    const user = userEvent.setup()

    // Order.
    expect(itemNames(await menuOf('basic', user))).toEqual(['Start working', 'Move later', 'Remove from project', 'Export', 'Delete'])
    await user.click(screen.getByRole('menuitem', { name: 'Move later' }))
    await waitFor(() => expect(names()).toEqual(['with-source', 'basic']))

    // A piece's name in the project is its label; the pattern keeps its own.
    await user.click(screen.getByRole('button', { name: 'Rename “basic”' }))
    const field = screen.getByRole('textbox')
    await user.clear(field)
    await user.type(field, 'Sleeve{Enter}')
    await waitFor(() => expect(names()).toEqual(['with-source', 'Sleeve']))
    expect(within(card('Sleeve')).getByText('7×5 · basic')).toBeTruthy()
    expect((await repo.summary(BASIC))!.name).toBe('basic')

    // Out of the project, into the Library on its own.
    await user.click(within(await menuOf('Sleeve', user)).getByRole('menuitem', { name: 'Remove from project' }))
    await waitFor(() => expect(names()).toEqual(['with-source']))
    expect(await repo.groupOf(BASIC)).toBeUndefined()
  })

  it('adds patterns that are in no project, and ungrouping from the view goes back to the Library', async () => {
    const repo = await library('basic.alpha', 'with-source.alpha', 'craft.alpha')
    const g = await repo.createGroup('Sweater', [BASIC])
    await repo.createGroup('Other', [SOURCE])
    await renderApp(`#/project/${g.id}`, { repo })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add patterns…' }))
    const dialog = screen.getByRole('dialog', { name: 'Add patterns to “Sweater”' })
    // with-source is in Other, so it isn't offered.
    const offered = within(dialog).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)
    expect(offered).toHaveLength(1)
    expect(offered[0]).not.toMatch(/with-source|basic/)
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    await screen.findByText('Added a pattern to “Sweater”.')
    await waitFor(() => expect(cards()).toHaveLength(2))

    await user.click(within(await menuOf('Sweater', user)).getByRole('menuitem', { name: 'Ungroup…' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Ungroup' }))
    await hashChanged()
    await waitFor(() => expect(window.location.hash).toBe('#/library'))
  })

  it('a project that is gone says so', async () => {
    await renderApp('#/project/nope', { repo: await library('basic.alpha') })
    expect(await screen.findByText('This project isn’t in your Library any more.'.replace('’', "'"))).toBeTruthy()
  })

  it('exports the project and imports it back as a project, piece labels and all', async () => {
    const repo = await library('basic.alpha', 'with-source.alpha')
    const g = await repo.createGroup('Sweater', [SOURCE, BASIC])
    await repo.relabelPiece(g.id, BASIC, 'Sleeve')
    const { blob, filename } = await repo.exportGroup(g.id)
    const bytes = new Uint8Array(await blob.arrayBuffer())

    const empty = await freshRepo()
    await renderApp('#/library', { repo: empty })
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*=".zip"]')!
    await userEvent.upload(input, new File([bytes], filename))
    await screen.findByText('Imported the project “Sweater”, 2 pieces.')
    const back = (await empty.groups())[0]!
    expect(back).toMatchObject({ id: g.id, name: 'Sweater', pieces: [{ id: SOURCE, label: 'with-source' }, { id: BASIC, label: 'Sleeve' }] })
  })

  it('refuses a zip that isn’t a project, importing nothing', async () => {
    const repo = await freshRepo()
    await renderApp('#/library', { repo })
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*=".zip"]')!
    await userEvent.upload(input, alphaFile('basic.alpha', 'photos.zip'))
    await screen.findByText(/“photos\.zip” isn't a project from Alpha Pattern Editor/)
    expect(await repo.list()).toEqual([])
  })
})

describe('Work: a piece of a project', () => {
  it('has a piece switcher and a way back to the project', async () => {
    const repo = await library('basic.alpha', 'with-source.alpha')
    const g = await repo.createGroup('Sweater', [SOURCE, BASIC])
    await repo.relabelPiece(g.id, BASIC, 'Sleeve')
    await renderApp(`#/work/${SOURCE}`, { repo })
    const picker = (await screen.findByRole('combobox', { name: 'Piece of “Sweater”' })) as HTMLSelectElement
    expect([...picker.options].map((o) => o.textContent)).toEqual(['with-source', 'Sleeve (0%)'])
    expect(picker.value).toBe(SOURCE)
    expect(screen.getByRole('link', { name: /Sweater/ }).getAttribute('href')).toBe(`#/project/${g.id}`)
    await userEvent.selectOptions(picker, BASIC)
    await waitFor(() => expect(window.location.hash).toBe(`#/work/${BASIC}`))
  })

  it('a pattern on its own has neither', async () => {
    const repo = await library('basic.alpha')
    await renderApp(`#/work/${BASIC}`, { repo })
    await screen.findByRole('heading', { level: 1, name: 'basic' })
    expect(screen.queryByRole('combobox', { name: /Piece of/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Library/ }).getAttribute('href')).toBe('#/library')
  })
})

describe('Project view: the links between pieces', () => {
  /** A saved pattern of one row: each colour `count` stitches. */
  async function saveRow(repo: Awaited<ReturnType<typeof freshRepo>>, name: string, colours: [string, string, number][]) {
    const total = colours.reduce((n, c) => n + c[2], 0)
    const base = newPattern(total, 1, colours[0]![0], { name })
    const cells = new Uint16Array(total)
    let at = 0
    colours.forEach((c, i) => {
      cells.fill(i, at, at + c[2])
      at += c[2]
    })
    const pattern = { ...base, cells, palette: colours.map(([hex, n, count]) => ({ id: newId(), hex, name: n, dmc: null, count })) }
    return (await repo.save({ pattern, progress: emptyProgress(), stage: 'design' })).pattern
  }

  it('New piece…: a blank at a size from the swatch, with the project’s colours, opened in Design', async () => {
    const repo = await freshRepo()
    const front = await saveRow(repo, 'Front', [
      ['#ffffff', 'White', 6],
      ['#cc0000', 'Red', 2],
    ])
    const g = await repo.createGroup('Sweater', [front.id])
    await renderApp(`#/project/${g.id}`, { repo })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New piece…' }))
    const dialog = await screen.findByRole('dialog', { name: 'New piece for “Sweater”' })
    const create = within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement
    expect(within(dialog).getByText('Measure your swatch to work out the stitches.')).toBeTruthy()
    expect(create.disabled).toBe(true)
    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Back')
    await user.type(within(dialog).getByLabelText('Swatch width'), '10')
    await user.type(within(dialog).getByLabelText('Swatch height'), '8')
    await user.type(within(dialog).getByLabelText('Width'), '52')
    await user.type(within(dialog).getByLabelText('Height'), '56')
    // 10 stitches in 10 cm, 10 rows in 8 cm: 52 × 70.
    expect(dialog.querySelector('.new-piece__result')!.textContent).toBe('52 × 70 stitches')
    // White has the most stitches, so it's the background unless another is chosen.
    expect((within(dialog).getByRole('radio', { name: 'White' }) as HTMLInputElement).checked).toBe(true)
    expect(within(dialog).getByText('It starts with the project’s 2 colours, ready to paint with.')).toBeTruthy()
    await user.click(create)
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/design\//))
    const id = window.location.hash.slice('#/design/'.length)
    expect((await repo.group(g.id))!.pieces).toEqual([
      { id: front.id, label: 'Front' },
      { id, label: 'Back' },
    ])
    const { project } = await repo.open(id)
    expect(project.pattern).toMatchObject({ name: 'Back', cols: 52, rows: 70 })
    expect(project.pattern.palette.map((e) => [e.hex, e.name, e.count])).toEqual([
      ['#ffffff', 'White', 52 * 70],
      ['#cc0000', 'Red', 0],
    ])
  })

  it('New piece… in stitches', async () => {
    const repo = await freshRepo()
    const front = await saveRow(repo, 'Front', [['#ffffff', 'White', 4]])
    const g = await repo.createGroup('Hat', [front.id])
    await renderApp(`#/project/${g.id}`, { repo })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New piece…' }))
    const dialog = await screen.findByRole('dialog', { name: 'New piece for “Hat”' })
    await user.click(within(dialog).getByRole('radio', { name: 'In stitches' }))
    await user.clear(within(dialog).getByLabelText('Columns'))
    await user.type(within(dialog).getByLabelText('Columns'), '12')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/design\//))
    const { project } = await repo.open(window.location.hash.slice('#/design/'.length))
    expect(project.pattern).toMatchObject({ name: 'Piece 2', cols: 12, rows: 40 })
  })

  it('Use the same colours in every piece…: shows what changes, then changes the ticked ones', async () => {
    const repo = await freshRepo()
    const front = await saveRow(repo, 'Front', [
      ['#ffffff', 'White', 10],
      ['#c0392b', 'Red', 6],
    ])
    const back = await saveRow(repo, 'Back', [
      ['#fefefe', 'Snow', 4],
      ['#c43d30', 'Tomato', 3],
    ])
    const g = await repo.createGroup('Sweater', [front.id, back.id])
    await renderApp(`#/project/${g.id}`, { repo })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'More for “Sweater”' }))
    await user.click(screen.getByRole('menuitem', { name: 'Use the same colours in every piece…' }))
    const changes = await screen.findAllByRole('checkbox')
    const dialog = screen.getByRole('dialog', { name: 'Same colours in every piece' })
    expect(changes.map((c) => (c as HTMLInputElement).checked)).toEqual([true, true])
    expect(changes.map((c) => c.closest('label')!.textContent)).toEqual(['Snow becomesSnow →White4 st', 'Tomato becomesTomato →Red3 st'])
    // Keep Snow as it is.
    await user.click(changes[0]!)
    await user.click(within(dialog).getByRole('button', { name: 'Use the same colours' }))
    await screen.findByText('Changed a colour in one piece, so every piece uses the same colours.')
    const after = (await repo.open(back.id)).project.pattern
    expect(after.palette.map((e) => [e.hex, e.name])).toEqual([
      ['#fefefe', 'Snow'],
      ['#c0392b', 'Red'],
    ])
    expect(after.cells).toEqual(back.cells)
    expect((await repo.open(front.id)).project.pattern.palette).toEqual(front.palette)
  })

  it('says so when the pieces already agree, and a project of one piece has no such item', async () => {
    const repo = await freshRepo()
    const a = await saveRow(repo, 'A', [['#ffffff', 'White', 2]])
    const b = await saveRow(repo, 'B', [['#ffffff', 'White', 3]])
    const g = await repo.createGroup('Pair', [a.id])
    await renderApp(`#/project/${g.id}`, { repo })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'More for “Pair”' }))
    expect(screen.queryByRole('menuitem', { name: /same colours/ })).toBeNull()
    await user.keyboard('{Escape}')
    await repo.addPieces(g.id, [b.id])
    await screen.findByText('2 pieces')
    await user.click(screen.getByRole('button', { name: 'More for “Pair”' }))
    await user.click(screen.getByRole('menuitem', { name: 'Use the same colours in every piece…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Same colours in every piece' })
    await within(dialog).findByText(/Every piece already uses the same colours/)
    expect(within(dialog).queryByRole('button', { name: 'Use the same colours' })).toBeNull()
  })
})
