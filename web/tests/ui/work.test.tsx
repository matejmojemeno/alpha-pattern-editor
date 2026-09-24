// @vitest-environment jsdom
import { fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as work from '../../src/logic/work.ts'
import { encodeRow, formatRowText, workingNumber } from '../../src/logic/readout.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
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
const chips = () => within(screen.getByRole('list', { name: 'Colours in this row' })).getAllByRole('button')

describe('Work stage', () => {
  it('shows the row, direction, stitches and progress', async () => {
    const { project } = await openWork('basic.alpha')
    const p = project.pattern
    // basic: bottom-up, row 1 starts from the right.
    expect(rowLabel()).toBe(`Row 1 of ${p.rows} ←`)
    expect(screen.getByText(`0 / ${p.rows * p.cols} stitches`)).toBeTruthy()
    expect(screen.getByText('0% done')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Library/ }).getAttribute('href')).toBe('#/library')
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
    expect(c[0]!.textContent).toBe(`${runs[0]!.count} ${name(0)}✓`)
    expect(c[1]!.className).toContain('chip--done')
    expect(c[2]!.className).toContain('chip--current')
    expect(c[2]!.getAttribute('aria-current')).toBe('step')
    expect(c[2]!.textContent).toBe(`${runs[2]!.count} ${name(2)}· 2/${runs[2]!.count}`)
    for (const chip of c.slice(3)) {
      expect(chip.className).toContain('chip--pending')
      expect(chip.textContent).not.toMatch(/✓|·/)
    }
    expect(c[2]!.querySelector('.swatch')!.getAttribute('style')).toContain('background')
  })

  it('mark the segment at the cursor current even before it is started', async () => {
    await openWork('basic.alpha')
    const c = chips()
    expect(c[0]!.className).toContain('chip--current')
    expect(c[0]!.textContent).not.toContain('·')
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

    await user.click(chips()[target]!)
    const dialog = screen.getByRole('dialog', { name: 'Record progress' })
    expect(dialog.textContent).toContain(`${runs[target]!.count} ${project.pattern.palette[runs[target]!.palette_index]!.name}`)
    const input = within(dialog).getByLabelText('Stitches done')
    expect(document.activeElement).toBe(input)
    await user.clear(input)
    await user.type(input, '1')
    await user.click(within(dialog).getByRole('button', { name: 'Save progress' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(work.setRunStitches).toHaveBeenCalledTimes(1)
    expect(vi.mocked(work.setRunStitches).mock.calls[0]!.slice(2)).toEqual([target, 1])
    expect(work.markSegmentComplete).not.toHaveBeenCalled()
    expect(chips()[target]!.textContent).toContain(`· 1/${runs[target]!.count}`)
  })

  it('steps the count with − and +, within 0..count', async () => {
    await openWork('basic.alpha')
    const user = userEvent.setup()
    await user.click(chips()[0]!)
    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText<HTMLInputElement>('Stitches done')
    const count = Number(input.max)
    expect(input.value).toBe('0')
    expect(within(dialog).getByRole('button', { name: 'One fewer' })).toHaveProperty('disabled', true)
    await user.click(within(dialog).getByRole('button', { name: 'One more' }))
    expect(input.value).toBe(String(Math.min(1, count)))
  })

  it('marks a segment complete with markSegmentComplete', async () => {
    await openWork('basic.alpha')
    const user = userEvent.setup()
    await user.click(chips()[0]!)
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
    const chip = chips()[1]!
    await user.click(chip)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(chips()[1])
    expect(work.setRunStitches).not.toHaveBeenCalled()
    expect(work.markSegmentComplete).not.toHaveBeenCalled()
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
    await user.click(chips()[0]!)
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
  it('"Start rows from the right" flips how rows read, and keeps progress', async () => {
    const { project } = await openWork('partial-row.alpha')
    const p = project.pattern
    expect(p.start_direction).toBe('LTR')
    const before = rowLabel()
    const cursorChip = chips().findIndex((c) => c.className.includes('chip--current'))
    const box = screen.getByLabelText<HTMLInputElement>('Start rows from the right')
    expect(box.checked).toBe(false)

    await userEvent.click(box)
    expect(box.checked).toBe(true)
    // The same row, now read from the other side...
    const r = work.rowIndex(p, project.progress.current_row_id)!
    expect(rowLabel()).toBe(before!.replace('→', '←'))
    const flipped = encodeRow({ ...p, start_direction: 'RTL' }, r)
    const names = chips().map((c) => c.querySelector('.chip__text')!.textContent)
    expect(names).toEqual(flipped.map((run) => `${run.count} ${p.palette[run.palette_index]!.name}`))
    // ...with the stored cursor where it was.
    expect(chips().findIndex((c) => c.className.includes('chip--current'))).toBe(cursorChip)
    expect(screen.getByText(`Next: Row ${workingNumber(p, r) + 1}: ${formatRowText({ ...p, start_direction: 'RTL' }, r + 1)}`)).toBeTruthy()
  })

  it('focus mode hides the next-row preview', async () => {
    const { settings } = await openWork('basic.alpha')
    expect(screen.getByText(/^Next: Row 2/)).toBeTruthy()
    await userEvent.click(screen.getByLabelText('Focus mode'))
    expect(settings.get().focusMode).toBe(true)
    expect(screen.queryByText(/^Next:/)).toBeNull()
  })

  it('exports the readout as text', async () => {
    const { project } = await openWork('basic.alpha')
    const clicks: HTMLAnchorElement[] = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this)
    })
    await userEvent.click(screen.getByRole('button', { name: 'Export readout' }))
    expect(clicks).toHaveLength(1)
    expect(clicks[0]!.download).toBe('basic.txt')
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob
    const { exportAllRowsText } = await import('../../src/logic/readout.ts')
    await waitFor(async () => expect(await blob.text()).toBe(exportAllRowsText(project.pattern)))
    spy.mockRestore()
  })
})
