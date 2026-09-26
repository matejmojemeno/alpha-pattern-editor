// @vitest-environment jsdom
/**
 * The colour library and the yarn estimate in the Design stage: choosing a library,
 * each colour's nearest shade, "Use shade", and the estimate's inputs, units and export.
 * basic.alpha's colours: White #ffffff ×10, Brown #6b3e26 ×16, Red #d93a3a ×9.
 */
import { waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createSettingsStore } from '../../src/settings/store.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { fixture, freshRepo, memoryStorage, renderApp, screen } from './helpers.tsx'

async function openDesign() {
  const repo = await freshRepo()
  const { project } = readAlpha(fixture('basic.alpha'))
  await repo.importFile(fixture('basic.alpha'))
  const storage = memoryStorage()
  const settings = createSettingsStore(() => storage)
  const view = await renderApp(`#/design/${project.pattern.id}`, { repo, settings })
  await screen.findByRole('heading', { level: 1, name: project.pattern.name }, { timeout: 3000 })
  return { ...view, storage, project }
}

const palette = () => within(screen.getByRole('list', { name: 'Palette' })).getAllByRole('button')
const shades = () => palette().map((b) => b.querySelector('.shade__label')?.textContent ?? null)
const table = () => screen.getByRole('table', { name: 'Yarn for each colour' })
/** Each body row's cells after the colour's name, and the total's. */
const rows = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((r) => [r.querySelector('th')!.textContent, ...[...r.querySelectorAll('td')].map((td) => td.textContent)])

describe('colour library', () => {
  it('matches each colour to DMC by default, and to the library chosen, remembered app-wide', async () => {
    const { storage } = await openDesign()
    await waitFor(() => expect(shades()).toEqual(['White', '801 Dark Coffee Brown', '350 Medium Coral']))
    const picker = screen.getByRole('combobox', { name: 'Match colours to' }) as HTMLSelectElement
    expect(picker.value).toBe('dmc')
    expect(screen.queryByText(/temperature-blanket\.com/)).toBeNull()

    await userEvent.selectOptions(picker, 'stylecraft-special-dk')
    await waitFor(() => expect(shades()).toEqual(['1807 Hint of Silver', '1054 Walnut', '1723 Tomato']))
    expect(screen.getByRole('link', { name: 'temperature-blanket.com' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toBeTruthy()
    expect(createSettingsStore(() => storage).get().colourLibrary).toBe('stylecraft-special-dk')

    await userEvent.selectOptions(picker, 'paintbox-simply-dk')
    await waitFor(() => expect(shades()).toEqual(['Paper White', 'Coffee Bean', 'Rose Red']))
  })

  it('"Use shade" recolours the selected colour to its nearest shade, as one undo step', async () => {
    await openDesign()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Match colours to' }), 'stylecraft-special-dk')
    await user.click(palette()[2]!)
    const group = screen.getByRole('group', { name: 'Selected colour' })
    await waitFor(() => expect(group.textContent).toContain('Nearest: Nearest shade: 1723 Tomato'))
    await user.click(within(group).getByRole('button', { name: 'Use shade' }))
    expect(palette()[2]!.getAttribute('aria-label')).toBe('Red, #c82d23, 9 cells')
    // Already that shade: nothing to do.
    expect((within(group).getByRole('button', { name: 'Use shade' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(palette()[2]!.getAttribute('aria-label')).toBe('Red, #d93a3a, 9 cells')
  })
})

describe('yarn estimate', () => {
  it('estimates each colour from the inputs, in metres or yards, and remembers them', async () => {
    const { storage } = await openDesign()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Match colours to' }), 'stylecraft-special-dk')
    const perStitch = screen.getByRole('textbox', { name: 'Yarn per stitch' }) as HTMLInputElement
    const ball = screen.getByRole('textbox', { name: 'One ball' }) as HTMLInputElement
    const extra = screen.getByRole('textbox', { name: 'Extra' }) as HTMLInputElement
    expect(perStitch.value).toBe('2.5')
    expect(extra.value).toBe('10')
    // The library's own ball, from its data.
    await waitFor(() => expect(ball.value).toBe('295'))
    expect(screen.getByText('Ball: Stylecraft Special DK, 295 m per 100 g.')).toBeTruthy()
    expect(screen.getByText(/An estimate, rounded up: one stitch per cell/)).toBeTruthy()

    // A metre a stitch makes the numbers easy: White 10 × 1.1 = 11 m, Brown 17.6, Red 9.9.
    await user.clear(perStitch)
    await user.type(perStitch, '100')
    expect(rows()).toEqual([
      ['White', '10', '11', '1'],
      ['Brown', '16', '18', '1'],
      ['Red', '9', '10', '1'],
      ['Total', '35', '39', '3'],
    ])

    // A 10 m ball: 11 → 2 balls, 17.6 → 2, 9.9 → 1.
    await user.clear(ball)
    await user.type(ball, '10')
    expect(rows().map((r) => r[3])).toEqual(['2', '2', '1', '5'])
    expect(screen.getByText(/Your ball length\./)).toBeTruthy()

    // No margin.
    await user.clear(extra)
    await user.type(extra, '0')
    expect(rows().map((r) => r[2])).toEqual(['10', '16', '9', '35'])

    // Yards: the fields convert too.
    await user.click(screen.getByRole('radio', { name: 'Yards' }))
    expect(perStitch.value).toBe('39.37')
    expect(ball.value).toBe('10.9')
    expect(within(table()).getByRole('columnheader', { name: 'Yards' })).toBeTruthy()
    expect(rows().map((r) => r[2])).toEqual(['11', '18', '10', '39']) // 10 m = 10.94 yd, rounded up

    expect(createSettingsStore(() => storage).get()).toMatchObject({
      colourLibrary: 'stylecraft-special-dk',
      yarnPerStitchCm: 100,
      ballMetres: 10,
      marginPercent: 0,
      units: 'imperial',
    })

    // Back to the library's ball.
    await user.click(screen.getByRole('button', { name: /Use Stylecraft Special DK’s/ }))
    expect(ball.value).toBe('322.6')
  })

  it('keeps a half-typed number, ignores nonsense, and an emptied ball goes back to the library', async () => {
    const { storage } = await openDesign()
    const user = userEvent.setup()
    const perStitch = screen.getByRole('textbox', { name: 'Yarn per stitch' }) as HTMLInputElement
    await user.clear(perStitch)
    await user.type(perStitch, '3.')
    expect(perStitch.value).toBe('3.')
    expect(createSettingsStore(() => storage).get().yarnPerStitchCm).toBe(3)
    await user.type(perStitch, 'x')
    expect(perStitch.getAttribute('aria-invalid')).toBe('true')
    expect(createSettingsStore(() => storage).get().yarnPerStitchCm).toBe(3)
    await user.tab()
    expect(perStitch.value).toBe('3')

    // DMC has no ball: no balls are counted until one is entered.
    const ball = screen.getByRole('textbox', { name: 'One ball' }) as HTMLInputElement
    expect(ball.value).toBe('')
    expect(screen.getByText('Enter the length of one ball to count balls.')).toBeTruthy()
    expect(within(table()).queryByRole('columnheader', { name: 'Balls' })).toBeNull()
    await user.type(ball, '50')
    expect(within(table()).getByRole('columnheader', { name: 'Balls' })).toBeTruthy()
    await user.clear(ball)
    await user.tab()
    expect(createSettingsStore(() => storage).get().ballMetres).toBeNull()
    expect(ball.value).toBe('')
  })

  it('exports the estimate as text', async () => {
    const { project } = await openDesign()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Match colours to' }), 'stylecraft-special-dk')
    await waitFor(() => expect(shades()[0]).toBe('1807 Hint of Silver'))
    await user.click(screen.getByRole('button', { name: 'Export yarn list' }))
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob
    const text = await blob.text()
    expect(text.split('\n').slice(0, 3)).toEqual([
      `${project.pattern.name}: yarn estimate`,
      '',
      'Yarn per stitch: 2.5 cm. Ball: 295 m (Stylecraft Special DK, 295 m per 100 g). Extra: 10%.',
    ])
    expect(text).toContain('White (#ffffff), nearest Stylecraft Special DK 1807 Hint of Silver: 10 stitches, 1 m, 1 ball\n')
    expect(text).toContain('Total: 35 stitches, 1 m, 3 balls\n')
  })
})
