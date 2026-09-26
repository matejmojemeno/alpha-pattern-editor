// @vitest-environment jsdom
/**
 * The structural panel, and progress through it: rows marked done in the Work stage,
 * each structural edit made in the Design stage (asking first when it would lose
 * progress), then the Work stage again, which opens on a sound place.
 */
import { fireEvent, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { addPaletteEntry, newPattern, setCell } from '../../src/logic/edit.ts'
import { encodeRow } from '../../src/logic/readout.ts'
import { completeCurrentRow, ensureStarted, rowIndex, setRunStitches } from '../../src/logic/work.ts'
import { emptyProgress, type Pattern, type Progress } from '../../src/model/types.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import type { ProjectRepo } from '../../src/storage/repo.ts'
import { fixture, freshRepo, renderApp, screen } from './helpers.tsx'

const settle = () => new Promise((r) => setTimeout(r, 450))
const stats = () => document.querySelector('.design__stats')!.textContent!
const message = () => document.querySelector('.design__message')!.textContent!

/** basic.alpha (7 × 5, worked bottom up) with the two bottom rows done and one stitch
 *  into the third, saved in the Work stage. */
async function worked() {
  const repo = await freshRepo()
  const { project } = readAlpha(fixture('basic.alpha'))
  const p = project.pattern
  let pr = ensureStarted(p, emptyProgress(), () => 1)
  pr = completeCurrentRow(p, completeCurrentRow(p, pr, () => 1), () => 1)
  const long = encodeRow(p, rowIndex(p, pr.current_row_id)!).findIndex((r) => r.count > 1)
  pr = setRunStitches(p, pr, long, 1, () => 1)
  await repo.save({ pattern: p, progress: pr, stage: 'work' })
  return { repo, p, pr }
}

async function openDesign(repo: ProjectRepo, id: string, name: string) {
  const view = await renderApp(`#/design/${id}`, { repo })
  await screen.findByRole('heading', { level: 1, name }, { timeout: 3000 })
  return view
}

const section = (user: UserEvent, name: string) => user.click(screen.getByRole('button', { name, expanded: false }))

async function fill(user: UserEvent, label: string, value: string) {
  const input = screen.getByLabelText(label, { selector: 'input' })
  await user.clear(input)
  await user.type(input, value)
}

interface Op {
  name: string
  /** Everything up to the button that makes the edit. */
  setup?: (user: UserEvent) => Promise<void>
  /** That button. */
  run: (user: UserEvent) => Promise<void>
  /** The confirmation it asks for, if it loses anything: title and button. */
  asks?: [title: string, confirm: string]
  size: [cols: number, rows: number]
  /** Rows still marked done afterwards. */
  done: number
  /** Whether the place in the current row is kept (rather than back at its start). */
  partKept?: boolean
}

const OPS: Op[] = [
  {
    name: 'a border added on every side',
    setup: (u) => section(u, 'Border'),
    run: (u) => u.click(screen.getByRole('button', { name: 'Apply border' })),
    size: [9, 7],
    done: 2,
  },
  {
    name: 'a border removed from every side (cuts into the art, and a done row)',
    setup: async (u) => {
      await section(u, 'Border')
      await fill(u, 'Top', '-1')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Apply border' })),
    asks: ['Remove part of the pattern?', 'Remove cells'],
    size: [5, 3],
    done: 1,
  },
  {
    name: 'padding to a size, placed by hand',
    setup: async (u) => {
      await section(u, 'Pad to size')
      await fill(u, 'Width', '10')
      await fill(u, 'Height', '8')
      await fill(u, 'Left', '0')
      await fill(u, 'Top', '1')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Apply padding' })),
    size: [10, 8],
    done: 2,
  },
  {
    name: 'scaling ×2 (every row new)',
    setup: (u) => section(u, 'Scale'),
    run: (u) => u.click(screen.getByRole('button', { name: 'Scale ×2' })),
    asks: ['Start progress again?', 'Scale'],
    size: [14, 10],
    done: 0,
  },
  { name: 'mirroring', run: (u) => u.click(screen.getByRole('button', { name: 'Mirror ⇄' })), size: [7, 5], done: 2 },
  { name: 'flipping', run: (u) => u.click(screen.getByRole('button', { name: 'Flip ⇅' })), size: [7, 5], done: 2 },
  {
    name: 'rotating a quarter turn clockwise (every row new)',
    run: (u) => u.click(screen.getByRole('button', { name: 'Rotate ↻ 90°' })),
    asks: ['Start progress again?', 'Rotate'],
    size: [5, 7],
    done: 0,
  },
  {
    name: 'rotating a quarter turn anticlockwise (every row new)',
    run: (u) => u.click(screen.getByRole('button', { name: 'Rotate ↺ 90°' })),
    asks: ['Start progress again?', 'Rotate'],
    size: [5, 7],
    done: 0,
  },
  {
    name: 'deleting a done row',
    setup: async (u) => {
      await section(u, 'Rows and columns')
      await fill(u, 'Row', '1')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Delete row' })),
    asks: ['Delete a row you’ve worked?', 'Delete row'],
    size: [7, 4],
    done: 1,
    // Every row's working number moves down one, so every row reads the other way: the
    // place in the current row goes back to its start.
  },
  {
    name: 'deleting the row partway through',
    setup: async (u) => {
      await section(u, 'Rows and columns')
      await fill(u, 'Row', '3')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Delete row' })),
    asks: ['Delete a row you’ve worked?', 'Delete row'],
    size: [7, 4],
    done: 2,
  },
  {
    name: 'deleting a row not yet worked',
    setup: async (u) => {
      await section(u, 'Rows and columns')
      await fill(u, 'Row', '5')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Delete row' })),
    size: [7, 4],
    done: 2,
    partKept: true,
  },
  {
    name: 'inserting a row below the first',
    setup: async (u) => {
      await section(u, 'Rows and columns')
      await fill(u, 'Row', '1')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Insert below' })),
    size: [7, 6],
    done: 2,
  },
  {
    name: 'inserting and deleting columns',
    setup: async (u) => {
      await section(u, 'Rows and columns')
      await u.click(screen.getByRole('button', { name: 'Insert left' }))
      await fill(u, 'Column', '8')
      await u.click(screen.getByRole('button', { name: 'Delete column' }))
      await fill(u, 'Column', '1')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Delete column' })),
    size: [6, 5],
    done: 2,
  },
]

describe('structural edits with Work-stage progress on the pattern', () => {
  it.each(OPS)('$name', async (op) => {
    const { repo, p, pr } = await worked()
    await openDesign(repo, p.id, p.name)
    const user = userEvent.setup()
    await op.setup?.(user)
    const before = stats()
    await op.run(user)

    if (op.asks) {
      const dialog = await screen.findByRole('alertdialog', { name: op.asks[0] })
      // Cancel first: nothing changes.
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(stats()).toBe(before)
      await op.run(user)
      const again = await screen.findByRole('alertdialog', { name: op.asks[0] })
      expect(again.textContent).toMatch(/Undo brings it all back/)
      await user.click(within(again).getByRole('button', { name: op.asks[1] }))
    } else {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    }
    expect(stats()).toMatch(new RegExp(`^${op.size[0]} cols × ${op.size[1]} rows`))
    // One undo step, whatever it was.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(stats()).toBe(before)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(stats()).toMatch(new RegExp(`^${op.size[0]} cols × ${op.size[1]} rows`))

    // Back to Work: it opens, on a sound place.
    await user.click(screen.getByRole('button', { name: 'Start working →' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/work/${p.id}`))
    await screen.findByText('Options', {}, { timeout: 3000 })
    expect(document.querySelector('.work__row')!.textContent).toMatch(new RegExp(`^Row \\d+ of ${op.size[1]}`))
    await settle()
    const saved = (await repo.open(p.id)).project
    const q: Pattern = saved.pattern
    const got: Progress = saved.progress
    expect([q.cols, q.rows]).toEqual(op.size)
    expect([...got.completed_row_ids].every((id) => q.row_ids.includes(id))).toBe(true)
    expect(got.completed_row_ids.size).toBe(op.done)
    expect(rowIndex(q, got.current_row_id)).not.toBeNull()
    if (op.partKept) {
      expect(got.current_row_id).toBe(pr.current_row_id)
      expect([got.current_run_index, got.current_run_stitches]).toEqual([pr.current_run_index, pr.current_run_stitches])
    }
    if (op.done === 0) expect(document.querySelector('.work__row')!.textContent).toMatch(/^Row 1 of/)
  })
})

/** 12 × 5, white, with a black cell at the top left and a red one at the bottom left:
 *  every quarter turn puts them somewhere else. */
async function wide() {
  const repo = await freshRepo()
  let p = newPattern(12, 5, '#ffffff', { name: 'Wide' })
  p = addPaletteEntry(p, '#000000', 'Black')
  p = addPaletteEntry(p, '#d93a3a', 'Red')
  p = setCell(setCell(p, 0, 0, 1), 4, 0, 2)
  await repo.save({ pattern: p, progress: emptyProgress(), stage: 'design' })
  return { repo, p }
}

const saved = async (repo: ProjectRepo, id: string) => {
  await settle()
  return (await repo.open(id)).project
}
const at = (q: Pattern, r: number, c: number) => q.cells[r * q.cols + c]
const field = (label: string) => (screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement).value

describe('rotating a quarter turn', () => {
  it('turns either way with no question when there is no progress, one undo step each', async () => {
    const { repo, p } = await wide()
    await openDesign(repo, p.id, 'Wide')
    const user = userEvent.setup()
    const before = stats()

    await user.click(screen.getByRole('button', { name: 'Rotate ↻ 90°' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stats()).toMatch(/^5 cols × 12 rows/)
    expect(message()).toBe('Rotated 90° clockwise: now 5 × 12.')
    let q = (await saved(repo, p.id)).pattern
    // Clockwise: the top-left cell goes to the top right, the bottom-left to the top left.
    expect([at(q, 0, 4), at(q, 0, 0)]).toEqual([1, 2])
    expect(q.row_ids.some((id) => p.row_ids.includes(id))).toBe(false)

    // Undo: exactly the pattern it was, row ids and all.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(stats()).toBe(before)
    q = (await saved(repo, p.id)).pattern
    expect(q.row_ids).toEqual(p.row_ids)
    expect([...q.cells]).toEqual([...p.cells])

    await user.click(screen.getByRole('button', { name: 'Rotate ↺ 90°' }))
    expect(stats()).toMatch(/^5 cols × 12 rows/)
    expect(message()).toBe('Rotated 90° anticlockwise: now 5 × 12.')
    q = (await saved(repo, p.id)).pattern
    // Anticlockwise: the top-left cell goes to the bottom left, the bottom-left to the bottom right.
    expect([at(q, 11, 0), at(q, 11, 4)]).toEqual([1, 2])

    // Back with the other button (a new step), then two undos to the start.
    await user.click(screen.getByRole('button', { name: 'Rotate ↻ 90°' }))
    expect(stats()).toBe(before)
    q = (await saved(repo, p.id)).pattern
    expect([...q.cells]).toEqual([...p.cells])
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(stats()).toMatch(/^5 cols × 12 rows/)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(stats()).toBe(before)
    expect((await saved(repo, p.id)).pattern.row_ids).toEqual(p.row_ids)
  })

  it('turns the pad-to-size fields and the border’s result with the pattern', async () => {
    const { repo, p } = await wide()
    await openDesign(repo, p.id, 'Wide')
    const user = userEvent.setup()
    await section(user, 'Pad to size')
    expect([field('Width'), field('Height')]).toEqual(['12', '5'])
    await user.click(screen.getByRole('button', { name: 'Rotate ↻ 90°' }))
    expect([field('Width'), field('Height')]).toEqual(['5', '12'])
    expect(screen.getByText('Set a size larger than the pattern.')).toBeTruthy()

    // A target typed and placed by hand turns too, and is centred again.
    await fill(user, 'Width', '9')
    await fill(user, 'Height', '20')
    fireEvent.change(screen.getByLabelText('Left', { selector: 'input' }), { target: { value: '0' } })
    expect(screen.getByText(/Adds 0 left, 4 right, 4 top, 4 bottom/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Rotate ↺ 90°' }))
    expect([field('Width'), field('Height')]).toEqual(['20', '9'])
    expect(screen.getByText(/Adds 4 left, 4 right, 2 top, 2 bottom/)).toBeTruthy()
    // Undo turns it back.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect([field('Width'), field('Height')]).toEqual(['9', '20'])
    expect(screen.queryByText(/Target must be at least/)).toBeNull()

    await section(user, 'Border')
    expect(screen.getByText(/^Result: 7 × 14$/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Rotate ↻ 90°' }))
    expect(screen.getByText(/^Result: 14 × 7$/)).toBeTruthy()
  })

  it('asks first when rows are marked done, saying what goes; Undo brings the progress back', async () => {
    const { repo, p, pr } = await worked()
    await openDesign(repo, p.id, p.name)
    const user = userEvent.setup()
    const before = stats()
    await user.click(screen.getByRole('button', { name: 'Rotate ↻ 90°' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Start progress again?' })
    expect(dialog.textContent).toContain(
      'Rotating gives every row a new place, so your progress in the Work stage (2 rows done and part of another) starts again from the first row.',
    )
    expect(dialog.textContent).toContain('Undo brings it all back.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(stats()).toBe(before)
    let got = await saved(repo, p.id)
    expect(got.pattern.row_ids).toEqual(p.row_ids)
    expect(got.progress.completed_row_ids).toEqual(pr.completed_row_ids)

    await user.click(screen.getByRole('button', { name: 'Rotate ↺ 90°' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Rotate' }))
    expect(stats()).toMatch(/^5 cols × 7 rows/)
    got = await saved(repo, p.id)
    expect(got.progress.completed_row_ids.size).toBe(0)

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(stats()).toBe(before)
    got = await saved(repo, p.id)
    expect(got.pattern.row_ids).toEqual(p.row_ids)
    expect(got.progress.completed_row_ids).toEqual(pr.completed_row_ids)
    expect(got.progress.current_row_id).toBe(pr.current_row_id)
    expect([got.progress.current_run_index, got.progress.current_run_stitches]).toEqual([pr.current_run_index, pr.current_run_stitches])
  })
})

describe('the structural panel', () => {
  it('refuses a border removal that would leave nothing, with the Python’s message', async () => {
    const { repo, p } = await worked()
    await openDesign(repo, p.id, p.name)
    const user = userEvent.setup()
    await section(user, 'Border')
    await fill(user, 'Top', '-3')
    expect(screen.getByText('Border removal would leave an empty pattern.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply border' }) as HTMLButtonElement).disabled).toBe(true)
    // Unlinked, one side at a time.
    await user.click(screen.getByLabelText('Same on every side'))
    await fill(user, 'Top', '2')
    expect(screen.getByText(/^Result: 1 × 4$/)).toBeTruthy() // +2 on top, still -3 elsewhere
  })

  it('does not ask before removing a border that is all one colour', async () => {
    const repo = await freshRepo()
    const p = newPattern(6, 4, '#ffffff', { name: 'Plain' })
    await repo.save({ pattern: p, progress: emptyProgress(), stage: 'design' })
    await openDesign(repo, p.id, 'Plain')
    const user = userEvent.setup()
    await section(user, 'Border')
    await fill(user, 'Top', '-1')
    await user.click(screen.getByRole('button', { name: 'Apply border' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stats()).toMatch(/^4 cols × 2 rows/)
    expect(message()).toBe('Border applied: now 4 × 2.')
  })

  it('pads only to a size at least the current one, centred by default', async () => {
    const { repo, p } = await worked()
    await openDesign(repo, p.id, p.name)
    const user = userEvent.setup()
    await section(user, 'Pad to size')
    await fill(user, 'Width', '6')
    expect(screen.getByText(/Target must be at least the current size/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply padding' }) as HTMLButtonElement).disabled).toBe(true)
    await fill(user, 'Width', '12')
    await fill(user, 'Height', '9')
    expect((screen.getByLabelText('Left', { selector: 'input' }) as HTMLInputElement).value).toBe('2')
    expect((screen.getByLabelText('Top', { selector: 'input' }) as HTMLInputElement).value).toBe('2')
    expect(screen.getByText(/Adds 2 left, 3 right, 2 top, 2 bottom/)).toBeTruthy()
    await fill(user, 'Left', '9') // past the 5 added: clamped
    expect((screen.getByLabelText('Left', { selector: 'input' }) as HTMLInputElement).value).toBe('5')
    await user.click(screen.getByRole('button', { name: 'Centre' }))
    expect((screen.getByLabelText('Left', { selector: 'input' }) as HTMLInputElement).value).toBe('2')
  })

  it('shows the size a scale gives, and warns past 999', async () => {
    const repo = await freshRepo()
    const p = newPattern(100, 10, '#ffffff', { name: 'Wide' })
    await repo.save({ pattern: p, progress: emptyProgress(), stage: 'design' })
    await openDesign(repo, p.id, 'Wide')
    const user = userEvent.setup()
    await section(user, 'Scale')
    expect(screen.getByText('Result: 200 × 20')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Factor'), '10')
    expect(screen.getByText('Result: 1000 × 100')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/more than 999 on a side/)
    // No progress: no question.
    await user.click(screen.getByRole('button', { name: 'Scale ×10' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stats()).toMatch(/^1000 cols × 100 rows/)
  })

  it('refuses to delete the last row or column, with the Python’s message', async () => {
    const repo = await freshRepo()
    const p = newPattern(1, 1, '#ffffff', { name: 'Dot' })
    await repo.save({ pattern: p, progress: emptyProgress(), stage: 'design' })
    await openDesign(repo, p.id, 'Dot')
    const user = userEvent.setup()
    await section(user, 'Rows and columns')
    await user.click(screen.getByRole('button', { name: 'Delete row' }))
    expect(message()).toBe('Cannot delete the last row.')
    await user.click(screen.getByRole('button', { name: 'Delete column' }))
    expect(message()).toBe('Cannot delete the last column.')
  })

  it('trims single-colour edges, or says there are none', async () => {
    const { repo, p } = await worked()
    await openDesign(repo, p.id, p.name)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Trim edges' }))
    expect(message()).toBe('No single-colour edges to trim.')
    await section(user, 'Border')
    await user.click(screen.getByRole('button', { name: 'Apply border' }))
    expect(stats()).toMatch(/^9 cols × 7 rows/)
    await user.click(screen.getByRole('button', { name: 'Trim edges' }))
    expect(stats()).toMatch(/^7 cols × 5 rows/)
  })
})
