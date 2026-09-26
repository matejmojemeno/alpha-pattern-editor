// @vitest-environment jsdom
/**
 * The Design stage screen in jsdom: colours, undo, keyboard, saving, and moving to and
 * from the Work stage with progress kept. Painting on the canvas needs real layout, so
 * it is tested in e2e/design.spec.ts (and the tools' logic in tests/design/).
 */
import { fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { completeCurrentRow, ensureStarted } from '../../src/logic/work.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { fixture, freshRepo, renderApp, screen } from './helpers.tsx'

async function openDesign(name: string) {
  const repo = await freshRepo()
  const { project } = readAlpha(fixture(name))
  await repo.importFile(fixture(name))
  const view = await renderApp(`#/design/${project.pattern.id}`, { repo })
  await screen.findByRole('heading', { level: 1, name: project.pattern.name }, { timeout: 3000 })
  return { ...view, project }
}

const palette = () => within(screen.getByRole('list', { name: 'Palette' })).getAllByRole('button')
const swatches = () => palette().map((b) => b.getAttribute('aria-label'))
const settle = () => new Promise((r) => setTimeout(r, 450))

describe('Design stage', () => {
  it('lists the colours with name, hex and count, and the size underneath', async () => {
    const { project } = await openDesign('basic.alpha')
    const p = project.pattern
    expect(swatches()).toEqual(p.palette.map((e) => `${e.name}, ${e.hex}, ${e.count} cell${e.count === 1 ? '' : 's'}`))
    expect(palette()[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.design__stats')!.textContent).toMatch(
      new RegExp(`${p.cols} cols × ${p.rows} rows\\s+·\\s+${p.cols * p.rows} stitches\\s+·\\s+${p.palette.length} colours\\s+·\\s+${p.cols + 1} strings needed`),
    )
    // No progress anywhere (§6.1), and no warning without any.
    expect(screen.queryByText(/% done/)).toBeNull()
    expect(screen.queryByText(/rows? into this project/)).toBeNull()
  })

  it('adds, recolours, renames and deletes colours, each one undo step, and saves them', async () => {
    const { repo, project } = await openDesign('basic.alpha')
    const user = userEvent.setup()
    const n = project.pattern.palette.length

    fireEvent.change(screen.getByLabelText('Colour to add'), { target: { value: '#00ff00' } })
    await user.click(screen.getByRole('button', { name: 'Add colour' }))
    expect(palette()).toHaveLength(n + 1)
    expect(palette()[n]!.getAttribute('aria-pressed')).toBe('true')
    expect(swatches()[n]).toBe('New colour, #00ff00, 0 cells')

    fireEvent.change(screen.getByLabelText('Recolour “New colour”'), { target: { value: '#11aa11' } })
    expect(swatches()[n]).toBe('New colour, #11aa11, 0 cells')

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const name = screen.getByLabelText('Colour name')
    await user.clear(name)
    await user.type(name, 'Leaf{Enter}')
    expect(swatches()[n]).toBe('Leaf, #11aa11, 0 cells')

    // Delete an existing colour: its cells go to the nearest one, counts follow.
    await user.click(palette()[0]!)
    const first = project.pattern.palette[0]!
    await user.click(screen.getByRole('button', { name: `Delete “${first.name}”` }))
    expect(palette()).toHaveLength(n)
    expect(document.querySelector('.design__message')!.textContent).toMatch(new RegExp(`Deleted “${first.name}”; its ${first.count} cells are now`))
    const total = palette().reduce((s, b) => s + Number(/(\d+) cells?$/.exec(b.getAttribute('aria-label')!)![1]), 0)
    expect(total).toBe(project.pattern.rows * project.pattern.cols)

    await settle()
    const saved = (await repo.open(project.pattern.id)).project
    expect(saved.stage).toBe('design')
    expect(saved.pattern.palette.map((e) => e.name)).toEqual([...project.pattern.palette.slice(1).map((e) => e.name), 'Leaf'])

    // Four steps back with Cmd/Ctrl+Z, and one forward with Shift.
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(swatches()).toHaveLength(n)
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(swatches()).toHaveLength(n + 1)
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    expect(swatches()[n]).toBe('New colour, #11aa11, 0 cells')
    await user.click(screen.getByRole('button', { name: 'Redo' }))
    expect(swatches()[n]).toBe('Leaf, #11aa11, 0 cells')
  })

  it('refuses to delete the last colour', async () => {
    // Delete down to one colour.
    const { project } = await openDesign('basic.alpha')
    const user = userEvent.setup()
    for (let i = project.pattern.palette.length; i > 1; i--) {
      await user.click(palette()[0]!)
      await user.click(screen.getByRole('button', { name: /^Delete “/ }))
    }
    expect(palette()).toHaveLength(1)
    const del = screen.getByRole('button', { name: /^Delete “/ }) as HTMLButtonElement
    expect(del.disabled).toBe(true)
    expect(swatches()[0]).toMatch(new RegExp(`, ${project.pattern.rows * project.pattern.cols} cells$`))
  })

  it('switches tools by shortcut, and not while typing in a field', async () => {
    await openDesign('basic.alpha')
    const pressed = () => screen.getAllByRole('button', { pressed: true }).find((b) => b.classList.contains('tool'))!.textContent
    expect(pressed()).toMatch(/^Paint/)
    for (const [key, label] of [['f', 'Fill'], ['R', 'Rectangle'], ['i', 'Pick colour'], ['h', 'Fill row'], ['v', 'Fill column'], ['b', 'Paint']]) {
      fireEvent.keyDown(document.body, { key })
      expect(pressed()).toMatch(new RegExp(`^${label}`))
    }
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await userEvent.type(screen.getByLabelText('Colour name'), 'f')
    expect(pressed()).toMatch(/^Paint/)
  })

  it('keeps Work-stage progress through colour edits, and warns on the way in', async () => {
    const repo = await freshRepo()
    const { project } = readAlpha(fixture('basic.alpha'))
    await repo.importFile(fixture('basic.alpha'))
    // Two rows done in Work.
    let pr = ensureStarted(project.pattern, project.progress)
    pr = completeCurrentRow(project.pattern, completeCurrentRow(project.pattern, pr))
    await repo.save({ ...project, progress: pr, stage: 'work' })
    const done = [...pr.completed_row_ids].sort()

    // From Work, Options → Edit pattern…
    await renderApp(`#/work/${project.pattern.id}`, { repo })
    await screen.findByText('Options')
    await userEvent.click(screen.getByText('Options'))
    await userEvent.click(screen.getByRole('button', { name: 'Edit pattern…' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/design/${project.pattern.id}`))
    await screen.findByRole('heading', { level: 1, name: project.pattern.name }, { timeout: 3000 })
    expect(screen.getByText("You're 2 rows into this project. Structural edits may shift your place.")).toBeTruthy()
    expect((await repo.open(project.pattern.id)).project.stage).toBe('design')

    // A colour edit that changes cells: delete one.
    const user = userEvent.setup()
    await user.click(palette()[1]!)
    await user.click(screen.getByRole('button', { name: /^Delete “/ }))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/rows into this project/)).toBeNull()

    // Start working → the Work stage, the same rows done.
    await user.click(screen.getByRole('button', { name: 'Start working →' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/work/${project.pattern.id}`))
    await screen.findByText('Options', {}, { timeout: 3000 })
    expect(document.querySelector('.work__row')!.textContent).toMatch(/^Row 3 of/)
    const saved = (await repo.open(project.pattern.id)).project
    expect(saved.stage).toBe('work')
    expect([...saved.progress.completed_row_ids].sort()).toEqual(done)
    expect(saved.pattern.palette).toHaveLength(project.pattern.palette.length - 1)
    expect(saved.pattern.row_ids).toEqual(project.pattern.row_ids)
  })

  it('says cleanly when there is no such project', async () => {
    await renderApp('#/design/does-not-exist')
    expect(await screen.findByRole('heading', { level: 1, name: 'Project not found' }, { timeout: 3000 })).toBeTruthy()
  })
})
