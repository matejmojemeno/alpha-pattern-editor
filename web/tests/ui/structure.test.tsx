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
import { AXIS_LEFT, AXIS_TOP, PAD } from '../../src/render/design.ts'
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

/** The chart, given a size (jsdom lays nothing out, and a press past its content box is
 *  on a scrollbar), and its cell size. It sits at the page's top left. */
function chart() {
  const sc = screen.getByTestId('design-scroller')
  Object.defineProperty(sc, 'clientWidth', { configurable: true, get: () => 2000 })
  Object.defineProperty(sc, 'clientHeight', { configurable: true, get: () => 2000 })
  return { sc, cell: Number(sc.dataset.cell) }
}

type Pointer = { x: number; y: number; type?: string }
const ev = ({ x, y, type = 'mouse' }: Pointer) => ({ pointerId: 1, pointerType: type, button: 0, clientX: x, clientY: y })
/** The middle of row `r` (or column `c`), well inside the chart. */
const onRow = (r: number): Pointer => ({ x: AXIS_LEFT + 8, y: AXIS_TOP + r * chart().cell + chart().cell / 2 })
const onCol = (c: number): Pointer => ({ x: AXIS_LEFT + c * chart().cell + chart().cell / 2, y: AXIS_TOP + 8 })
function click(at: Pointer) {
  const { sc } = chart()
  fireEvent.pointerMove(sc, ev(at))
  fireEvent.pointerDown(sc, ev(at))
  fireEvent.pointerUp(sc, ev(at))
}
/** The rows (columns) the chart has room for: its scrollable size, preview included. */
const shownRows = () => (parseFloat((chart().sc.firstElementChild as HTMLElement).style.height) - AXIS_TOP - PAD) / chart().cell
const shownCols = () => (parseFloat((chart().sc.firstElementChild as HTMLElement).style.width) - AXIS_LEFT - PAD) / chart().cell

/** Press image row `r`'s number (or column `c`'s) for its menu, then an item on it. */
async function fromNumber(user: UserEvent, kind: 'row' | 'col', i: number, item: string) {
  const { sc } = chart()
  fireEvent.pointerDown(sc, ev(kind === 'row' ? { x: AXIS_LEFT / 2, y: onRow(i).y } : { x: onCol(i).x, y: AXIS_TOP / 2 }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

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
    setup: (u) => section(u, 'Border & size'),
    run: (u) => u.click(screen.getByRole('button', { name: 'Apply' })),
    size: [9, 7],
    done: 2,
  },
  {
    name: 'a border removed from every side (cuts into the art, and a done row)',
    setup: async (u) => {
      await section(u, 'Border & size')
      await fill(u, 'Top', '-1')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Apply' })),
    asks: ['Remove part of the pattern?', 'Remove cells'],
    size: [5, 3],
    done: 1,
  },
  {
    name: 'padding to a size, placed by hand',
    setup: async (u) => {
      await section(u, 'Border & size')
      await fill(u, 'Width', '10')
      await fill(u, 'Height', '8')
      await fill(u, 'Left', '0')
      await fill(u, 'Right', '3')
    },
    run: (u) => u.click(screen.getByRole('button', { name: 'Apply' })),
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
  // basic.alpha is worked bottom up: working row n is image row 5 - n.
  {
    name: 'deleting a done row',
    run: (u) => fromNumber(u, 'row', 4, 'Delete row 1'),
    asks: ['Delete a row you’ve worked?', 'Delete row'],
    size: [7, 4],
    done: 1,
    // Every row's working number moves down one, so every row reads the other way: the
    // place in the current row goes back to its start.
  },
  {
    name: 'deleting the row partway through',
    run: (u) => fromNumber(u, 'row', 2, 'Delete row 3'),
    asks: ['Delete a row you’ve worked?', 'Delete row'],
    size: [7, 4],
    done: 2,
  },
  {
    name: 'deleting a row not yet worked',
    run: (u) => fromNumber(u, 'row', 0, 'Delete row 5'),
    size: [7, 4],
    done: 2,
    partKept: true,
  },
  {
    name: 'adding a row between the first two, with Add row',
    setup: (u) => u.click(screen.getByRole('button', { name: /^Add row/ })),
    run: async () => click(onRow(4)),
    size: [7, 6],
    done: 2,
  },
  {
    name: 'inserting a row from the menu on its number',
    run: (u) => fromNumber(u, 'row', 4, 'Insert row above'),
    size: [7, 6],
    done: 2,
  },
  {
    name: 'adding and deleting columns',
    setup: async (u) => {
      await u.click(screen.getByRole('button', { name: /^Add column/ }))
      click(onCol(0))
      await fromNumber(u, 'col', 7, 'Delete column 8')
    },
    run: (u) => fromNumber(u, 'col', 0, 'Delete column 1'),
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

  it('turns the size set in Border & size with the pattern', async () => {
    const { repo, p } = await wide()
    await openDesign(repo, p.id, 'Wide')
    const user = userEvent.setup()
    const sides = () => [field('Top'), field('Right'), field('Bottom'), field('Left')]
    await section(user, 'Border & size')
    expect([field('Width'), field('Height')]).toEqual(['14', '7']) // 12 × 5, one on every side
    await user.click(screen.getByRole('button', { name: 'Rotate ↻ 90°' }))
    expect([field('Width'), field('Height')]).toEqual(['7', '14'])

    // A size typed, and the pattern placed by hand in it, turns too.
    await fill(user, 'Width', '9')
    await fill(user, 'Height', '20')
    expect(sides()).toEqual(['4', '2', '4', '2'])
    await fill(user, 'Left', '0')
    await fill(user, 'Right', '4')
    await user.click(screen.getByRole('button', { name: 'Rotate ↺ 90°' }))
    expect([field('Width'), field('Height')]).toEqual(['20', '9'])
    expect(sides()).toEqual(['0', '4', '4', '4'])
    // Undo turns it back.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect([field('Width'), field('Height')]).toEqual(['9', '20'])
    expect(sides()).toEqual(['4', '4', '4', '0'])
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
    await section(user, 'Border & size')
    await fill(user, 'Top', '-3')
    expect(screen.getByText('Border removal would leave an empty pattern.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    // Unlinked, one side at a time.
    await user.click(screen.getByLabelText('Same on every side'))
    await fill(user, 'Top', '2')
    expect([field('Width'), field('Height')]).toEqual(['1', '4']) // +2 on top, still -3 elsewhere
  })

  it('does not ask before removing a border that is all one colour', async () => {
    const repo = await freshRepo()
    const p = newPattern(6, 4, '#ffffff', { name: 'Plain' })
    await repo.save({ pattern: p, progress: emptyProgress(), stage: 'design' })
    await openDesign(repo, p.id, 'Plain')
    const user = userEvent.setup()
    await section(user, 'Border & size')
    await fill(user, 'Top', '-1')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stats()).toMatch(/^4 cols × 2 rows/)
    expect(message()).toBe('Border applied: now 4 × 2.')
  })

  it('sets a size: centred padding from no border, cropping when smaller, within 2000', async () => {
    const { repo, p } = await worked() // 7 × 5
    await openDesign(repo, p.id, p.name)
    const user = userEvent.setup()
    const apply = () => screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement
    const sides = () => [field('Top'), field('Right'), field('Bottom'), field('Left')]
    await section(user, 'Border & size')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect([field('Width'), field('Height')]).toEqual(['7', '5'])
    expect(apply().disabled).toBe(true)

    // Padding, centred as pad_to_size centres it (the odd column going right).
    await fill(user, 'Width', '12')
    await fill(user, 'Height', '9')
    expect(sides()).toEqual(['2', '3', '2', '2'])
    expect(screen.queryByRole('button', { name: 'Centre the pattern' })).toBeNull()
    await fill(user, 'Left', '0')
    expect(field('Width')).toBe('10')
    await user.click(screen.getByRole('button', { name: 'Centre the pattern' }))
    expect(sides()).toEqual(['2', '2', '2', '1'])

    await fill(user, 'Width', '2001')
    expect(screen.getByText('At most 2000 on a side.')).toBeTruthy()
    expect(apply().disabled).toBe(true)
    await user.clear(screen.getByLabelText('Width', { selector: 'input' }))
    expect(screen.getByText('Enter a width and a height.')).toBeTruthy()
    expect(apply().disabled).toBe(true)

    // Smaller than the pattern: cells come off the sides, and it asks first.
    await user.type(screen.getByLabelText('Width', { selector: 'input' }), '5')
    expect(sides()).toEqual(['2', '0', '2', '-2'])
    await user.click(apply())
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove part of the pattern?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove cells' }))
    expect(stats()).toMatch(/^5 cols × 9 rows/)
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

  it('won’t delete the last row or column', async () => {
    const repo = await freshRepo()
    const p = newPattern(1, 1, '#ffffff', { name: 'Dot' })
    await repo.save({ pattern: p, progress: emptyProgress(), stage: 'design' })
    await openDesign(repo, p.id, 'Dot')
    for (const [kind, name, why] of [
      ['row', 'Delete row 1', 'Cannot delete the last row.'],
      ['col', 'Delete column 1', 'Cannot delete the last column.'],
    ] as const) {
      const { sc } = chart()
      fireEvent.pointerDown(sc, ev(kind === 'row' ? { x: AXIS_LEFT / 2, y: onRow(0).y } : { x: onCol(0).x, y: AXIS_TOP / 2 }))
      const item = await screen.findByRole('menuitem', { name })
      expect((item as HTMLButtonElement).disabled).toBe(true)
      expect(item.title).toBe(why)
      fireEvent.keyDown(item, { key: 'Escape' })
    }
    expect(stats()).toMatch(/^1 cols × 1 rows/)
  })

  it('trims single-colour edges, or says there are none', async () => {
    const { repo, p } = await worked()
    await openDesign(repo, p.id, p.name)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Trim edges' }))
    expect(message()).toBe('No single-colour edges to trim.')
    await section(user, 'Border & size')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(stats()).toMatch(/^9 cols × 7 rows/)
    await user.click(screen.getByRole('button', { name: 'Trim edges' }))
    expect(stats()).toMatch(/^7 cols × 5 rows/)
  })
})

describe('Add row and Add column', () => {
  /** basic.alpha, 7 × 5 and worked bottom up, with no progress, painting in its 2nd colour. */
  async function basic() {
    const repo = await freshRepo()
    const { project } = readAlpha(fixture('basic.alpha'))
    const p = project.pattern
    await repo.save({ pattern: p, progress: emptyProgress(), stage: 'design' })
    await openDesign(repo, p.id, p.name)
    return { repo, p }
  }

  it('previews the row where the pointer is, and a click adds it there', async () => {
    const { repo, p } = await basic()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Add row/ }))
    expect(message()).toMatch(/^Point at the chart where the new row goes, and click to add it. To delete a row, press its number./)
    const { sc } = chart()

    // Pointing previews it (the chart has a row more), without changing the pattern.
    fireEvent.pointerMove(sc, ev(onRow(2)))
    expect(shownRows()).toBe(6)
    expect(stats()).toMatch(/^7 cols × 5 rows/)
    // Over the numbers, or off the chart, nothing is previewed.
    fireEvent.pointerMove(sc, ev({ x: AXIS_LEFT / 2, y: onRow(2).y }))
    expect(shownRows()).toBe(5)
    fireEvent.pointerMove(sc, ev(onRow(1)))
    fireEvent.pointerLeave(sc)
    expect(shownRows()).toBe(5)

    // Anywhere below the chart adds one at the end: bottom up, the new first row.
    click({ x: AXIS_LEFT + 500, y: AXIS_TOP + 900 })
    expect(stats()).toMatch(/^7 cols × 6 rows/)
    expect(message()).toBe('Added row 1: now 7 × 6.')
    // What was added is shown, not another one, until the pointer moves to another row.
    expect(shownRows()).toBe(6)
    fireEvent.pointerMove(sc, ev(onRow(1)))
    expect(shownRows()).toBe(7)

    // One undo step.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(stats()).toMatch(/^7 cols × 5 rows/)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true })
    const q = (await saved(repo, p.id)).pattern
    expect(q.rows).toBe(6)
    expect(q.row_ids.slice(0, 5)).toEqual(p.row_ids)
    expect(new Set(q.cells.subarray(5 * 7))).toEqual(new Set([0]))
  })

  it('adds a column with the current colour; a finger drags it into place and adds it on lifting', async () => {
    const { repo, p } = await basic()
    const user = userEvent.setup()
    // Shift+V is Add column; V alone still fills one.
    fireEvent.keyDown(document.body, { key: 'V', shiftKey: true })
    expect(screen.getByRole('button', { name: /^Add column/, pressed: true })).toBeTruthy()
    // Painting with the palette's second colour.
    await user.click(within(screen.getByRole('list', { name: 'Palette' })).getAllByRole('button').filter((b) => b.classList.contains('colour'))[1]!)
    const { sc } = chart()
    const t = (c: number) => ({ ...onCol(c), type: 'touch' })
    fireEvent.pointerDown(sc, ev(t(0)))
    expect(shownCols()).toBe(8)
    fireEvent.pointerMove(sc, ev(t(3)))
    expect(stats()).toMatch(/^7 cols × 5 rows/)
    fireEvent.pointerUp(sc, ev(t(3)))
    expect(stats()).toMatch(/^8 cols × 5 rows/)
    expect(message()).toBe('Added column 4: now 8 × 5.')
    const q = (await saved(repo, p.id)).pattern
    for (let r = 0; r < 5; r++) {
      const row = [...q.cells.subarray(r * 8, r * 8 + 8)]
      expect(row[3]).toBe(1)
      expect(row.filter((_, c) => c !== 3)).toEqual([...p.cells.subarray(r * 7, r * 7 + 7)])
    }
  })
})
