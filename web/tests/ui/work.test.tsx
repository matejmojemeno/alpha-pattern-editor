// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { exportAllRowsText } from '../../src/logic/readout.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { fixture, freshRepo, renderApp, screen } from './helpers.tsx'

describe('/work/:id placeholder', () => {
  it('shows the name, size, progress and the full readout', async () => {
    const repo = await freshRepo()
    const { project } = readAlpha(fixture('partial-row.alpha'))
    await repo.importFile(fixture('partial-row.alpha'))
    await renderApp(`#/work/${project.pattern.id}`, { repo })

    expect(await screen.findByRole('heading', { level: 1, name: project.pattern.name })).toBeTruthy()
    expect(screen.getByText(`${project.pattern.cols}×${project.pattern.rows}`)).toBeTruthy()
    expect(screen.getByText(`${project.progress.completed_row_ids.size} of ${project.pattern.rows} rows`)).toBeTruthy()
    expect(screen.getByLabelText('Rows').textContent).toBe(exportAllRowsText(project.pattern))
    expect(document.title).toBe(`${project.pattern.name} · Alpha Pattern Editor`)
  })

  it('says cleanly when there is no such project', async () => {
    await renderApp('#/work/does-not-exist')
    expect(await screen.findByRole('heading', { level: 1, name: 'Project not found' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to your library' }).getAttribute('href')).toBe('#/library')
  })

  it('shows a not-found page for unknown routes', async () => {
    await renderApp('#/nowhere')
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
  })
})
