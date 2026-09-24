// @vitest-environment jsdom
import { fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { readAlpha } from '../../src/storage/alpha.ts'
import { alphaFile, fixture, renderApp, screen } from './helpers.tsx'

const basicId = () => readAlpha(fixture('basic.alpha')).project.pattern.id

describe('Landing screen', () => {
  it('offers the four entry points', async () => {
    await renderApp('#/')
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha Pattern Editor' })).toBeTruthy()

    const importTile = screen.getByRole('button', { name: /Import pattern/ })
    expect(importTile.textContent).toMatch(/\.alpha/)
    expect(importTile.textContent).toMatch(/photo of a chart arrives in a later version/)

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

  it('imports a .alpha file through the picker and opens it', async () => {
    const { repo } = await renderApp('#/')
    const input = screen.getByLabelText('Choose .alpha files to import')
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
    expect(screen.getByText('Drop .alpha files to import them')).toBeTruthy()
    fireEvent.drop(main, { dataTransfer })
    await waitFor(() => expect(window.location.hash).toBe(`#/work/${basicId()}`))
    expect(await repo.list()).toHaveLength(1)
  })

  it('explains that photos cannot be imported yet', async () => {
    const { repo } = await renderApp('#/')
    await userEvent.upload(screen.getByLabelText('Choose .alpha files to import'), new File(['x'], 'chart.jpg'), {
      applyAccept: false,
    })
    const status = screen.getByRole('status')
    await waitFor(() => expect(within(status).getByText(/is an image/).textContent).toMatch(/later version/))
    expect(await repo.list()).toEqual([])
    expect(window.location.hash).toBe('#/')
  })
})
