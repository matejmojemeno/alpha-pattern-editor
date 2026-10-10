// @vitest-environment jsdom
import { fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { carriesByRun, carryPlan, carryReach } from '../../src/logic/carry.ts'
import * as work from '../../src/logic/work.ts'
import { encodeRow, formatRowText, rowDirection, workingNumber } from '../../src/logic/readout.ts'
import { exportChartPng } from '../../src/render/chartPng.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { carryNote } from '../../src/ui/work/segments.ts'
import { fixture, freshRepo, renderApp, screen } from './helpers.tsx'

// Spy on the progress operations while keeping their real behaviour, so tests can check
// which one the screen called.
vi.mock('../../src/logic/work.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/logic/work.ts')>()
  return {
    ...actual,
    setRunStitches: vi.fn(actual.setRunStitches),
    markSegmentComplete: vi.fn(actual.markSegmentComplete),
    completeCurrentRow: vi.fn(actual.completeCurrentRow),
    goPreviousRow: vi.fn(actual.goPreviousRow),
  }
})

// Export PNG draws on a canvas, which jsdom hasn't got: e2e/work-png.spec.ts checks the
// picture itself; here, what the screen asks for.
vi.mock('../../src/render/chartPng.ts', () => ({
  exportChartPng: vi.fn(async (p: { name: string }) => ({ blob: new Blob(['png']), filename: `${p.name}.png` })),
}))

beforeEach(() => vi.clearAllMocks())

async function openWork(name: string) {
  const repo = await freshRepo()
  const { project } = readAlpha(fixture(name))
  await repo.importFile(fixture(name))
  const view = await renderApp(`#/work/${project.pattern.id}`, { repo })
  await screen.findByRole('heading', { level: 1, name: project.pattern.name })
  return { ...view, project }
}

const rowLabel = () => document.querySelector('.work__row')!.textContent
/** The chips, one list item each, holding the chip's two buttons. */
const chips = () => within(screen.getByRole('list', { name: 'Colours in this row' })).getAllByRole('listitem')
/** Chip i's own button, which opens Record progress. */
const openChip = (i: number) => chips()[i]!.querySelector<HTMLButtonElement>('.chip__open')!
/** Chip i's tick. */
const tickOf = (i: number) => within(chips()[i]!).getByRole('button', { name: / done$/ })

describe('Work stage', () => {
  it('shows the row, direction, stitches and progress', async () => {
    const { project } = await openWork('basic.alpha')
    const p = project.pattern
    // basic: bottom-up, row 1 starts from the right.
    expect(rowLabel()).toBe(`Row 1 of ${p.rows} ←`)
    expect(screen.getByText(`0 / ${p.rows * p.cols} stitches`)).toBeTruthy()
    expect(screen.getByText('0% done')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Library/ }).getAttribute('href')).toBe('#/library')
    expect(
      screen.getByRole('link', { name: 'Help with following a pattern (opens in a new tab)' }).getAttribute('href'),
    ).toMatch(/\/docs\/guide\/work\.md$/)
    expect(document.title).toBe(`${p.name} · Alpha Pattern Editor`)
    // Next: the second row worked.
    const next = p.rows - 2
    expect(screen.getByText(`Next: Row 2: ${formatRowText(p, next)}`)).toBeTruthy()
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

describe('chips', () => {
  it('show done, current and pending segments in working order', async () => {
    // partial-row: current run 2, with 2 stitches of it done.
    const { project } = await openWork('partial-row.alpha')
    const p = project.pattern
    const r = work.rowIndex(p, project.progress.current_row_id)!
    const runs = encodeRow(p, r)
    const c = chips()
    expect(c).toHaveLength(runs.length)

    const name = (i: number) => p.palette[runs[i]!.palette_index]!.name
    expect(c[0]!.className).toContain('chip--done')
    expect(c[0]!.textContent).toBe(`${runs[0]!.count} ${name(0)}`)
    expect(tickOf(0).getAttribute('aria-pressed')).toBe('true')
    expect(tickOf(0).getAttribute('aria-label')).toBe(`${runs[0]!.count} ${name(0)} done`)
    expect(c[1]!.className).toContain('chip--done')
    expect(c[2]!.className).toContain('chip--current')
    expect(c[2]!.getAttribute('aria-current')).toBe('step')
    expect(c[2]!.textContent).toBe(`${runs[2]!.count} ${name(2)}2/${runs[2]!.count}`)
    expect(tickOf(2).getAttribute('aria-pressed')).toBe('false')
    for (const [i, chip] of c.slice(3).entries()) {
      expect(chip.className).toContain('chip--pending')
      expect(chip.textContent).toBe(`${runs[i + 3]!.count} ${name(i + 3)}`)
      expect(tickOf(i + 3).getAttribute('aria-pressed')).toBe('false')
    }
    expect(c[2]!.querySelector('.swatch')!.getAttribute('style')).toContain('background')
  })

  it('mark the segment at the cursor current even before it is started', async () => {
    await openWork('basic.alpha')
    const c = chips()
    expect(c[0]!.className).toContain('chip--current')
    expect(c[0]!.querySelector('.chip__mark')).toBeNull()
    expect(c.slice(1).every((b) => b.className.includes('chip--pending'))).toBe(true)
  })
})

describe('segment dialog', () => {
  it('records partial stitches with setRunStitches', async () => {
    const { project } = await openWork('basic.alpha')
    const user = userEvent.setup()
    const r = work.rowIndex(project.pattern, work.ensureStarted(project.pattern, project.progress).current_row_id)!
    const runs = encodeRow(project.pattern, r)
    const target = runs.findIndex((run) => run.count >= 2)

    await user.click(openChip(target))
    const dialog = screen.getByRole('dialog', { name: 'Record progress' })
    // The heading names the colour and the count once each: no number in the swatch.
    const head = dialog.querySelector('.segment__head')!
    expect(head.textContent).toBe(`${project.pattern.palette[runs[target]!.palette_index]!.name}${runs[target]!.count} stitches`)
    expect(head.querySelector('.swatch')!.textContent).toBe('')
    const input = within(dialog).getByLabelText('Stitches done')
    await user.clear(input)
    await user.type(input, '1')
    await user.click(within(dialog).getByRole('button', { name: 'Save progress' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(work.setRunStitches).toHaveBeenCalledTimes(1)
    expect(vi.mocked(work.setRunStitches).mock.calls[0]!.slice(2)).toEqual([target, 1])
    expect(work.markSegmentComplete).not.toHaveBeenCalled()
    expect(chips()[target]!.textContent).toContain(`1/${runs[target]!.count}`)
  })

  it('steps the count with − and +, within 0..count', async () => {
    await openWork('basic.alpha')
    const user = userEvent.setup()
    await user.click(openChip(0))
    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText<HTMLInputElement>('Stitches done')
    const count = Number(input.max)
    expect(input.value).toBe('0')
    // "of N" is inside the joined control, and describes the number.
    const of = dialog.querySelector('.segment__count .segment__value span')!
    expect(of.textContent).toBe(`of ${count}`)
    expect(input.getAttribute('aria-describedby')).toBe(of.id)
    expect(within(dialog).getByRole('button', { name: 'One fewer' })).toHaveProperty('disabled', true)
    await user.click(within(dialog).getByRole('button', { name: 'One more' }))
    expect(input.value).toBe(String(Math.min(1, count)))
  })

  it('marks a segment complete with markSegmentComplete', async () => {
    await openWork('basic.alpha')
    const user = userEvent.setup()
    await user.click(openChip(0))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark segment complete' }))
    expect(work.markSegmentComplete).toHaveBeenCalledTimes(1)
    expect(vi.mocked(work.markSegmentComplete).mock.calls[0]![2]).toBe(0)
    expect(work.setRunStitches).not.toHaveBeenCalled()
    expect(chips()[0]!.className).toContain('chip--done')
    expect(chips()[1]!.className).toContain('chip--current')
  })

  it('changes nothing when cancelled, and gives focus back to the chip', async () => {
    await openWork('basic.alpha')
    const user = userEvent.setup()
    await user.click(openChip(1))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(openChip(1))
    expect(work.setRunStitches).not.toHaveBeenCalled()
    expect(work.markSegmentComplete).not.toHaveBeenCalled()
  })

  it('opens on Mark segment complete, so Return marks it', async () => {
    await openWork('basic.alpha')
    const user = userEvent.setup()
    await user.click(openChip(1))
    const dialog = screen.getByRole('dialog', { name: 'Record progress' })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Mark segment complete' }))
    // The one primary button; Save progress is an ordinary one.
    expect([...dialog.querySelectorAll('.button--primary')].map((b) => b.textContent!.trim())).toEqual(['Mark segment complete'])
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(vi.mocked(work.markSegmentComplete).mock.calls.map((c) => c[2])).toEqual([1])
    expect(chips()[2]!.className).toContain('chip--current')
  })
})

describe('chip ticks', () => {
  it('tick a segment done in one tap, with every one before it, and untick back to its start', async () => {
    const { project } = await openWork('large.alpha')
    const user = userEvent.setup()
    const p = project.pattern
    const runs = encodeRow(p, work.rowIndex(p, work.ensureStarted(p, project.progress).current_row_id)!)
    expect(runs.length).toBeGreaterThan(4)
    const states = () => chips().map((c) => c.className.replace('chip chip--', ''))

    await user.click(tickOf(2))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(vi.mocked(work.markSegmentComplete).mock.calls.map((c) => c[2])).toEqual([2])
    expect(states().slice(0, 4)).toEqual(['done', 'done', 'done', 'current'])
    expect([0, 1, 2, 3].map((i) => tickOf(i).getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true', 'false'])

    // Unticking a done one: it and every one after it are to do again.
    await user.click(tickOf(1))
    expect(vi.mocked(work.setRunStitches).mock.calls.map((c) => c.slice(2))).toEqual([[1, 0]])
    expect(states().slice(0, 3)).toEqual(['done', 'current', 'pending'])

    // The current one ticks like any other, and the last one finishes the row.
    await user.click(tickOf(1))
    expect(states().slice(0, 3)).toEqual(['done', 'done', 'current'])
    await user.click(tickOf(runs.length - 1))
    expect(rowLabel()).toMatch(/^Row 2 /)
    expect(states()[0]).toBe('current')
  })
})

describe('keyboard', () => {
  it('completes the row with →, ↓, Space and Return, and goes back with ← and ↑', async () => {
    const { project } = await openWork('large.alpha')
    const rows = project.pattern.rows
    const user = userEvent.setup()
    document.body.focus()

    await user.keyboard('{ArrowRight}')
    expect(rowLabel()).toMatch(new RegExp(`^Row 2 of ${rows}`))
    await user.keyboard('{ArrowDown}')
    await user.keyboard(' ')
    await user.keyboard('{Enter}')
    expect(rowLabel()).toMatch(new RegExp(`^Row 5 of ${rows}`))
    expect(work.completeCurrentRow).toHaveBeenCalledTimes(4)

    await user.keyboard('{ArrowLeft}')
    await user.keyboard('{ArrowUp}')
    expect(rowLabel()).toMatch(new RegExp(`^Row 3 of ${rows}`))
    expect(work.goPreviousRow).toHaveBeenCalledTimes(2)
  })

  it('ignores keys while the segment dialog is open, or in a text field', async () => {
    await openWork('large.alpha')
    const user = userEvent.setup()
    await user.click(openChip(0))
    const dialog = screen.getByRole('dialog')
    await user.keyboard('{ArrowRight}{ArrowLeft}')
    // Keys pressed with focus outside the dialog's controls, too.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(dialog, { key: ' ' })
    expect(work.completeCurrentRow).not.toHaveBeenCalled()
    expect(work.goPreviousRow).not.toHaveBeenCalled()
    expect(rowLabel()).toMatch(/^Row 1 /)

    await user.keyboard('{Escape}')
    const option = screen.getByLabelText('Focus mode')
    fireEvent.keyDown(option, { key: 'ArrowRight' })
    expect(work.completeCurrentRow).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(work.completeCurrentRow).toHaveBeenCalledTimes(1)
  })

  it('ignores auto-repeat and modified keys', async () => {
    await openWork('large.alpha')
    fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true })
    fireEvent.keyDown(document.body, { key: 'ArrowRight', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true })
    expect(work.completeCurrentRow).not.toHaveBeenCalled()
    expect(work.goPreviousRow).not.toHaveBeenCalled()
  })

  it('lets Space on a focused button press only that button', async () => {
    await openWork('large.alpha')
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Row complete →' }).focus()
    await user.keyboard(' ')
    expect(work.completeCurrentRow).toHaveBeenCalledTimes(1)
    expect(rowLabel()).toMatch(/^Row 2 /)
  })
})

describe('buttons', () => {
  it('complete and reopen rows, and finish the pattern', async () => {
    const { project } = await openWork('basic.alpha')
    const user = userEvent.setup()
    const complete = screen.getByRole('button', { name: 'Row complete →' })
    const previous = screen.getByRole('button', { name: '← Previous row' })
    expect(previous).toHaveProperty('disabled', true)
    await user.click(complete)
    expect(previous).toHaveProperty('disabled', false)
    await user.click(previous)
    expect(rowLabel()).toMatch(/^Row 1 /)

    for (let i = 0; i < project.pattern.rows; i++) await user.click(complete)
    expect(rowLabel()).toBe('Finished! 🎉')
    expect(complete).toHaveProperty('disabled', true)
    expect(screen.getByText(`${project.pattern.rows * project.pattern.cols} / ${project.pattern.rows * project.pattern.cols} stitches`)).toBeTruthy()
    expect(screen.getByText('100% done')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Colours in this row' })).toBeNull()
  })
})

describe('options', () => {
  it('starting in the other corner of the same row flips how rows read, asking first when the row partway through starts again', async () => {
    const { project } = await openWork('partial-row.alpha')
    const p = project.pattern
    expect(p.start_direction).toBe('LTR')
    const before = rowLabel()
    const cursorChip = chips().findIndex((c) => c.className.includes('chip--current'))
    expect(cursorChip).toBeGreaterThan(0)
    const side = p.bottom_up ? 'Bottom' : 'Top'
    const left = screen.getByRole<HTMLInputElement>('radio', { name: `${side} left` })
    const box = screen.getByRole<HTMLInputElement>('radio', { name: `${side} right` })
    expect(left.checked).toBe(true)
    expect(box.checked).toBe(false)
    const r = work.rowIndex(p, project.progress.current_row_id)!

    // The row partway through would read the other way: asked first, and Cancel keeps it.
    await userEvent.click(box)
    const dialog = screen.getByRole('alertdialog', { name: `Start row ${workingNumber(p, r)} again?` })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(box.checked).toBe(false)
    expect(rowLabel()).toBe(before)
    expect(chips().findIndex((c) => c.className.includes('chip--current'))).toBe(cursorChip)

    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Change it' }))
    expect(box.checked).toBe(true)
    // The same row, now read from the other side, from its start...
    expect(rowLabel()).toBe(before!.replace('→', '←'))
    const flipped = encodeRow({ ...p, start_direction: 'RTL' }, r)
    const names = chips().map((c) => c.querySelector('.chip__text')!.textContent)
    expect(names).toEqual(flipped.map((run) => `${run.count} ${p.palette[run.palette_index]!.name}`))
    expect(chips().findIndex((c) => c.className.includes('chip--current'))).toBe(0)
    expect(screen.getByText(`Next: Row ${workingNumber(p, r) + 1}: ${formatRowText({ ...p, start_direction: 'RTL' }, r + 1)}`)).toBeTruthy()

    // ...and at the start of a row, nothing to ask: back it goes at once.
    await userEvent.click(left)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(left.checked).toBe(true)
    expect(box.checked).toBe(false)
  })

  it('one corner sets both which row is row 1 and which way it runs, with one question at most', async () => {
    const { project } = await openWork('partial-row.alpha')
    const p = project.pattern
    const r = work.rowIndex(p, project.progress.current_row_id)!
    const across = `${p.bottom_up ? 'Top' : 'Bottom'} right`
    await userEvent.click(screen.getByRole('radio', { name: across }))
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Change it' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: across }).checked).toBe(true)
    const next = { ...p, bottom_up: !p.bottom_up, start_direction: 'RTL' as const }
    expect(rowLabel()).toMatch(new RegExp(`^Row ${workingNumber(next, r)} `))
  })

  it('says the reading order in words, and keeps up as it changes', async () => {
    await openWork('basic.alpha')
    const summary = () => document.querySelector('.options__summary')!.textContent
    // Tapestry crochet: bottom right, turning.
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Bottom right' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Back and forth' }).checked).toBe(true)
    expect(summary()).toBe('Row 1 is the bottom row of the chart, worked right to left; row 2 comes back left to right.')
    await userEvent.click(screen.getByRole('radio', { name: 'In the round' }))
    expect(summary()).toBe('Round 1 is the bottom row of the chart, worked right to left, and so is every round after it.')
    await userEvent.click(screen.getByRole('radio', { name: 'Top left' }))
    expect(summary()).toBe('Round 1 is the top row of the chart, worked left to right, and so is every round after it.')
    // A bead loom's rows aren't rounds.
    await userEvent.selectOptions(screen.getByLabelText('Craft'), 'bead-loom')
    expect(screen.queryByRole('radio', { name: 'In the round' })).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'All the same way' }).checked).toBe(true)
    expect(summary()).toBe('Row 1 is the top row of the chart, worked left to right, and so is every row after it.')
  })

  it('a craft sets the reading order, the words and whether carrying is offered', async () => {
    const settle = () => new Promise((r) => setTimeout(r, 400))
    const { repo, project } = await openWork('basic.alpha')
    const p = project.pattern
    const craft = screen.getByLabelText<HTMLSelectElement>('Craft')
    expect(craft.value).toBe('tapestry')
    expect(screen.getByLabelText('Show where to carry yarn')).toBeTruthy()
    // Crochet and knitting call rows that don't turn working in the round; flat by default.
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Back and forth' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'In the round' }).checked).toBe(false)
    expect(document.querySelector('.work__stitches')!.textContent).toBe(`0 / ${p.rows * p.cols} stitches`)

    // Bracelets are knotted from the top, the first row left to right.
    await userEvent.selectOptions(craft, 'bracelet')
    expect(document.querySelector('.work__stitches')!.textContent).toBe(`0 / ${p.rows * p.cols} knots`)
    expect(screen.queryByLabelText('Show where to carry yarn')).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Top left' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Back and forth' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'All the same way' }).checked).toBe(false)
    const top = { ...p, bottom_up: false, start_direction: 'LTR' as const }
    expect(rowLabel()).toBe('Row 1 of 5 →')
    const names = chips().map((c) => c.querySelector('.chip__text')!.textContent)
    expect(names).toEqual(encodeRow(top, 0).map((run) => `${run.count} ${p.palette[run.palette_index]!.name}`))
    await userEvent.click(openChip(0))
    expect(screen.getByLabelText('Knots done')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Saved with the pattern.
    await settle()
    const saved = (await repo.open(p.id)).project.pattern
    expect([saved.craft, saved.bottom_up, saved.start_direction, saved.alternate_direction]).toEqual(['bracelet', false, 'LTR', true])

    // A bead loom: every row the same way, beads.
    await userEvent.selectOptions(craft, 'bead-loom')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'All the same way' }).checked).toBe(true)
    expect(document.querySelector('.work__stitches')!.textContent).toBe(`0 / ${p.rows * p.cols} beads`)
  })

  it('numbers the stitches unless turned off in Options, app-wide', async () => {
    const { settings } = await openWork('basic.alpha')
    const box = screen.getByLabelText<HTMLInputElement>('Number the stitches')
    expect(box.checked).toBe(true)
    await userEvent.click(box)
    expect(settings.get().stitchNumbers).toBe(false)
    await userEvent.click(box)
    expect(settings.get().stitchNumbers).toBe(true)
  })

  it('hides the colours in this row when turned off in Options, leaving the chart, app-wide', async () => {
    const { settings } = await openWork('basic.alpha')
    expect(screen.getByRole('region', { name: 'This row' })).toBeTruthy()
    expect(screen.getByText(/^Next: Row 2/)).toBeTruthy()
    const box = screen.getByLabelText<HTMLInputElement>('Show the colours in this row')
    expect(box.checked).toBe(true)
    await userEvent.click(box)
    expect(settings.get().showRowColours).toBe(false)
    expect(screen.queryByRole('region', { name: 'This row' })).toBeNull()
    expect(document.querySelector('.chip')).toBeNull()
    expect(screen.queryByText(/^Next:/)).toBeNull()
    expect(document.querySelector('.work__body')!.classList.contains('work__body--chart')).toBe(true)
    expect(document.querySelector('.work__body .chart')).toBeTruthy()
    // The row is still worked from the bar.
    await userEvent.click(screen.getByRole('button', { name: /Row complete/ }))
    expect(document.querySelector('.work__row')!.textContent).toMatch(/^Row 2 /)
    // And back.
    await userEvent.click(box)
    expect(settings.get().showRowColours).toBe(true)
    expect(screen.getByRole('region', { name: 'This row' })).toBeTruthy()
    expect(screen.getByText(/^Next: Row 3/)).toBeTruthy()
  })

  it('says once, on the chip it begins in, to carry a colour on to the end of the row or from its start', async () => {
    const { project } = await openWork('basic.alpha')
    const p = project.pattern
    const plan = carryPlan(p)
    await userEvent.click(screen.getByLabelText('Show where to carry yarn'))
    const seq = work.workSequence(p)
    // The first row with a carry that reaches an end of the row.
    const k = seq.findIndex((r) => plan[r]!.some((c) => carryReach(p.cols, c, rowDirection(p, r))))
    expect(k).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < k; i++) await userEvent.click(screen.getByRole('button', { name: /Row complete/ }))
    const r = seq[k]!
    const notes = [...document.querySelectorAll('.chip__carry')].map((n) => n.textContent)
    for (const c of plan[r]!) {
      const reach = carryReach(p.cols, c, rowDirection(p, r))
      if (!reach) continue
      const name = p.palette[c.palette_index]!.name
      const said = reach === 'end' ? `carry ${name} on to the end of the row` : `carry ${name} from the start of the row`
      expect(notes.filter((n) => n === said)).toHaveLength(1)
    }
  })

  it('says "round" in place of "row" when worked in rounds', async () => {
    const { project } = await openWork('basic.alpha')
    await userEvent.click(screen.getByRole('radio', { name: 'In the round' }))
    await userEvent.click(screen.getByLabelText('Show where to carry yarn'))
    const p = { ...project.pattern, alternate_direction: false }
    const plan = carryPlan(p)
    const seq = work.workSequence(p)
    const k = seq.findIndex((r) => plan[r]!.some((c) => carryReach(p.cols, c, rowDirection(p, r))))
    expect(k).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < k; i++) await userEvent.click(screen.getByRole('button', { name: /Row complete/ }))
    const notes = [...document.querySelectorAll('.chip__carry')].map((n) => n.textContent!)
    expect(notes.some((n) => / (on to the end|from the start) of the round$/.test(n))).toBe(true)
    expect(notes.filter((n) => / of the row$/.test(n))).toEqual([])
  })

  it('shows where to carry yarn only when asked, on the chips of the row being worked', async () => {
    const { project, settings } = await openWork('basic.alpha')
    const p = project.pattern
    const plan = carryPlan(p)
    expect(document.querySelector('.chip__carry')).toBeNull()
    await userEvent.click(screen.getByLabelText('Show where to carry yarn'))
    expect(settings.get().showCarries).toBe(true)
    // Work on to the first row with something to carry.
    const seq = work.workSequence(p)
    const k = seq.findIndex((r) => plan[r]!.length > 0)
    expect(k).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < k; i++) await userEvent.click(screen.getByRole('button', { name: /Row complete/ }))
    const r = seq[k]!
    expect(rowLabel()).toMatch(new RegExp(`^Row ${workingNumber(p, r)} `))
    const byRun = carriesByRun(p.cols, encodeRow(p, r), plan[r]!, rowDirection(p, r))
    const notes = chips().map((c) => [...c.querySelectorAll('.chip__carry')].map((n) => n.textContent))
    expect(notes).toEqual(
      byRun.map((cs) =>
        cs.map((c) => carryNote(p.palette[c.palette_index]!.name, c)),
      ),
    )
    // Read out too.
    const i = byRun.findIndex((cs) => cs.length > 0)
    expect(openChip(i).getAttribute('aria-label')).toContain(`, ${notes[i]![0]}`)
    // And gone again when switched off.
    await userEvent.click(screen.getByLabelText('Show where to carry yarn'))
    expect(document.querySelector('.chip__carry')).toBeNull()
  })

  it('focus mode hides the next-row preview', async () => {
    const { settings } = await openWork('basic.alpha')
    expect(screen.getByText(/^Next: Row 2/)).toBeTruthy()
    await userEvent.click(screen.getByLabelText('Focus mode'))
    expect(settings.get().focusMode).toBe(true)
    expect(screen.queryByText(/^Next:/)).toBeNull()
  })

  it('exports the chart as a PNG with the numbers and strands switched on, and no text export', async () => {
    const { project } = await openWork('basic.alpha')
    const p = project.pattern
    const clicks: HTMLAnchorElement[] = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this)
    })
    expect(screen.queryByRole('button', { name: /text/i })).toBeNull()
    // As it starts: numbers on, carrying off.
    await userEvent.click(screen.getByRole('button', { name: 'Export PNG' }))
    expect(vi.mocked(exportChartPng)).toHaveBeenLastCalledWith(expect.objectContaining({ id: p.id }), { numbers: true, carries: null })
    await waitFor(() => expect(clicks.map((a) => a.download)).toEqual(['basic.png']))
    // The other way round, partway through the pattern: the progress isn't asked for.
    await userEvent.click(screen.getByRole('button', { name: /Row complete/ }))
    await userEvent.click(screen.getByLabelText('Number the stitches'))
    await userEvent.click(screen.getByLabelText('Show where to carry yarn'))
    await userEvent.click(screen.getByRole('button', { name: 'Export PNG' }))
    expect(vi.mocked(exportChartPng)).toHaveBeenLastCalledWith(expect.objectContaining({ id: p.id }), { numbers: false, carries: carryPlan(p) })
    spy.mockRestore()
  })
})

describe('saving', () => {
  const settle = () => new Promise((r) => setTimeout(r, 400))

  it('saves every progress change on its own, as a Work-stage project', async () => {
    const { repo, project } = await openWork('basic.alpha')
    const user = userEvent.setup()
    expect(screen.getByText('Saved')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Row complete →' }))
    expect(screen.getByText('Saving…')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy(), { timeout: 2000 })

    const { project: saved } = await repo.open(project.pattern.id)
    expect(saved.stage).toBe('work')
    expect(saved.progress.completed_row_ids.size).toBe(1)
    expect(saved.progress.current_row_id).toBe(work.completeCurrentRow(project.pattern, project.progress).current_row_id)
    expect((await repo.summary(project.pattern.id))!.progress_pct).toBe(20)
  })

  it('saves at once when the page is hidden', async () => {
    const { repo, project } = await openWork('basic.alpha')
    const save = vi.spyOn(repo, 'save')
    await userEvent.click(screen.getByRole('button', { name: 'Row complete →' }))
    expect(save).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    delete (document as { visibilityState?: unknown }).visibilityState
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(async () => expect((await repo.open(project.pattern.id)).project.progress.completed_row_ids.size).toBe(1))
  })

  it('saves at once on pagehide and on Cmd/Ctrl+S', async () => {
    const { repo } = await openWork('basic.alpha')
    const save = vi.spyOn(repo, 'save')
    await userEvent.click(screen.getByRole('button', { name: 'Row complete →' }))
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: 'Row complete →' }))
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    // Ctrl+S is not "complete the row".
    expect(work.completeCurrentRow).toHaveBeenCalledTimes(2)
  })

  it('saves pending progress when leaving for the Library', async () => {
    const { repo, project } = await openWork('basic.alpha')
    const save = vi.spyOn(repo, 'save')
    await userEvent.click(screen.getByRole('button', { name: 'Row complete →' }))
    await userEvent.click(screen.getByRole('link', { name: /Library/ }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(async () => expect((await repo.summary(project.pattern.id))!.progress_pct).toBe(20))
  })

  it('keeps the stored source image', async () => {
    const { repo, project } = await openWork('with-source.alpha')
    const before = (await repo.open(project.pattern.id)).sourcePng
    expect(before).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Row complete →' }))
    await settle()
    const after = await repo.open(project.pattern.id)
    expect(after.project.progress.completed_row_ids.size).toBe(project.progress.completed_row_ids.size + 1)
    expect(after.sourcePng).toEqual(before)
  })

  it('saves the corner it starts in with the pattern, the row partway through started again', async () => {
    const { repo, project } = await openWork('partial-row.alpha')
    await userEvent.click(screen.getByRole('radio', { name: `${project.pattern.bottom_up ? 'Bottom' : 'Top'} right` }))
    await userEvent.click(screen.getByRole('button', { name: 'Change it' }))
    await settle()
    const saved = (await repo.open(project.pattern.id)).project
    expect(saved.pattern.start_direction).toBe('RTL')
    expect(saved.progress.current_row_id).toBe(project.progress.current_row_id)
    expect(saved.progress.current_run_index).toBe(0)
    expect(saved.progress.current_run_stitches).toBe(0)
    expect([...saved.progress.completed_row_ids].sort()).toEqual([...project.progress.completed_row_ids].sort())
  })

  it('renames the project, and the rename field keeps the keys to itself', async () => {
    const { repo, project } = await openWork('basic.alpha')
    const user = userEvent.setup()
    await user.click(screen.getByText('Options'))
    await user.click(screen.getByRole('button', { name: 'Rename “basic”' }))
    const input = screen.getByLabelText('Project name')
    await user.clear(input)
    // Typing a space or an arrow in the field completes no rows.
    await user.type(input, 'Scarf row{ArrowLeft}{ArrowRight}s')
    expect(work.completeCurrentRow).not.toHaveBeenCalled()
    expect(work.goPreviousRow).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('heading', { level: 1, name: 'Scarf rows' })).toBeTruthy()
    expect(document.title).toBe('Scarf rows · Alpha Pattern Editor')
    expect(document.activeElement).toBe(screen.getByText('Options'))
    await settle()
    const saved = await repo.open(project.pattern.id)
    expect(saved.project.pattern.name).toBe('Scarf rows')
    expect(saved.project.pattern.cells).toEqual(project.pattern.cells)
  })

  it('does not save just for opening a project', async () => {
    const { repo, project } = await openWork('basic.alpha')
    await settle()
    expect((await repo.open(project.pattern.id)).project.stage).toBe('design')
  })
})
