// @vitest-environment jsdom
import { act, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { newPattern } from '../../src/logic/edit.ts'
import { emptyProgress } from '../../src/model/types.ts'
import type { ProjectRepo } from '../../src/storage/repo.ts'
import { FromPatternPanel } from '../../src/ui/design/FromPatternPanel.tsx'
import { freshRepo, screen } from './helpers.tsx'

async function save(repo: ProjectRepo, name: string) {
  return (await repo.save({ pattern: newPattern(3, 2, '#ffffff', { name }), progress: emptyProgress(), stage: 'design' })).pattern.id
}

async function panel(repo: ProjectRepo, currentId: string) {
  render(<FromPatternPanel repo={repo} currentId={currentId} target={{ rows: 2, cols: 3 }} onUse={vi.fn()} onClose={vi.fn()} />)
  await act(async () => {})
}

const names = (list: HTMLElement) => [...list.querySelectorAll('.from-pattern__item-name')].map((n) => n.textContent)

describe('From another pattern: a project’s pieces first', () => {
  it('lists the other pieces, by their labels and in the project’s order, then the other patterns', async () => {
    const repo = await freshRepo()
    await save(repo, "Cat")
    const front = await save(repo, 'Sweater front')
    const back = await save(repo, 'Sweater back')
    const sleeve = await save(repo, 'Sleeve pattern')
    const g = await repo.createGroup('Sweater', [front, sleeve, back])
    await repo.relabelPiece(g.id, front, 'Front')
    await panel(repo, back)
    const pieces = await screen.findByRole('list', { name: 'Pieces of “Sweater”' })
    expect(names(pieces)).toEqual(['Front', 'Sleeve pattern'])
    expect(names(screen.getByRole('list', { name: 'Patterns in your Library' }))).toEqual(['Cat'])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Pieces of “Sweater”', 'Other patterns'])
    // The pieces come before the other patterns.
    const lists = screen.getAllByRole('list')
    expect(lists.indexOf(pieces)).toBeLessThan(lists.indexOf(screen.getByRole('list', { name: 'Patterns in your Library' })))

    // Choosing a piece opens it to pick from.
    await userEvent.click(within(pieces).getByRole('button', { name: /Front/ }))
    await screen.findByText('Sweater front')
  })

  it('a pattern in no project lists the Library as before', async () => {
    const repo = await freshRepo()
    const a = await save(repo, 'A')
    await save(repo, 'B')
    await panel(repo, a)
    await waitFor(() => expect(names(screen.getByRole('list', { name: 'Patterns in your Library' }))).toEqual(['B']))
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
  })

  it('a new piece added elsewhere shows up', async () => {
    const repo = await freshRepo()
    const a = await save(repo, 'A')
    const g = await repo.createGroup('Pair', [a])
    await panel(repo, a)
    await screen.findByText('No other patterns in your Library yet.')
    await act(async () => {
      await repo.addNewPiece(g.id, newPattern(2, 2, '#000000', { name: 'B' }), 'Right')
    })
    await waitFor(() => expect(names(screen.getByRole('list', { name: 'Pieces of “Pair”' }))).toEqual(['Right']))
  })
})
