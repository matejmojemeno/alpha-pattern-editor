// @vitest-environment jsdom
/**
 * Yarn in the UI. The Design stage has none: matching colours to a yarn range and the
 * estimate are the import screen's. There, "Yarn & size" opens a dialog that turns a
 * swatch into the finished size and the yarn for each colour of the pattern as it will be
 * saved, and the colour library, under "Advanced: match to yarn", gives its ball.
 *
 * The import screen's pattern is fakeWorker's makePreview(1, 3, 4): a 4 × 3 checkerboard,
 * White ×6 and Brown ×6. basic.alpha's colours: White ×10, Brown ×16, Red ×9.
 */
import { act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handOffImage } from '../../src/app/pendingImage.ts'
import { createSettingsStore } from '../../src/settings/store.ts'
import { readAlpha } from '../../src/storage/alpha.ts'
import { detection } from './fakeDetection.ts'
import { fixture, freshRepo, memoryStorage, renderApp, screen } from './helpers.tsx'

beforeEach(() => detection.reset())

describe('the Design stage', () => {
  it('has no yarn matching and no yarn estimate, even with a yarn range chosen', async () => {
    const repo = await freshRepo()
    const { project } = readAlpha(fixture('basic.alpha'))
    await repo.importFile(fixture('basic.alpha'))
    const storage = memoryStorage()
    const settings = createSettingsStore(() => storage)
    settings.set({ colourLibrary: 'stylecraft-special-dk' })
    await renderApp(`#/design/${project.pattern.id}`, { repo, settings })
    await screen.findByRole('heading', { level: 1, name: project.pattern.name }, { timeout: 3000 })
    // Give a library, were one loading, the time to arrive.
    await act(async () => {})

    const palette = within(screen.getByRole('list', { name: 'Palette' })).getAllByRole('button').filter((b) => b.classList.contains('colour'))
    expect(palette.map((b) => b.getAttribute('aria-label'))).toEqual([
      'White, #ffffff, 10 cells',
      'Brown, #6b3e26, 16 cells',
      'Red, #d93a3a, 9 cells',
    ])
    expect(document.querySelector('.shade')).toBeNull()
    expect(screen.queryByText('Advanced: match to yarn')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Match colours to' })).toBeNull()
    await userEvent.click(palette[2]!)
    expect(screen.queryByRole('button', { name: 'Use shade' })).toBeNull()
    expect(screen.queryByText(/Nearest/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Yarn estimate' })).toBeNull()
    expect(screen.queryByRole('table', { name: 'Yarn for each colour' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export yarn list' })).toBeNull()
  })
})

/** The import screen with a detected pattern, and its settings. */
async function openImport(preset: Parameters<ReturnType<typeof createSettingsStore>['set']>[0] = {}) {
  handOffImage({ file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'dog.png', { type: 'image/png' }) })
  const storage = memoryStorage()
  const settings = createSettingsStore(() => storage)
  settings.set(preset)
  const view = await renderApp('#/import', { settings })
  await screen.findByRole('button', { name: 'Save & edit pattern' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Yarn & size' }).hasAttribute('disabled')).toBe(false))
  return { ...view, stored: () => createSettingsStore(() => storage).get() }
}

const openDialog = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Yarn & size' }))
  return screen.getByRole('dialog', { name: 'Yarn & size' })
}
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const table = () => screen.getByRole('table', { name: 'Yarn for each colour' })
/** The table's header, then each body row and the total, cell by cell. */
const rows = () =>
  within(table())
    .getAllByRole('row')
    .map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent))
const type = async (name: string, text: string) => {
  await userEvent.clear(field(name))
  await userEvent.type(field(name), text)
}
const sizeLine = () => document.querySelector('.yarn__size')!.textContent

describe('Yarn & size, on the import screen', () => {
  it('sits beside Save, opens a dialog, and closes back to the button', async () => {
    await openImport()
    const button = screen.getByRole('button', { name: 'Yarn & size' })
    // Then "Visualize", then Save.
    expect(button.nextElementSibling?.textContent).toBe('Visualize')
    expect(button.nextElementSibling?.nextElementSibling?.textContent).toBe('Save & edit pattern')
    const dialog = await openDialog()
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Your swatch' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    await openDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('starts from a 10 × 10 swatch, unmeasured, and yarn per stitch', async () => {
    await openImport()
    await openDialog()
    expect([field('Stitches').value, field('Rows').value, field('Width').value, field('Height').value]).toEqual(['10', '10', '', ''])
    expect(field('Weight (optional)').value).toBe('')
    expect(field('Yarn per stitch').value).toBe('2.5')
    expect(field('Extra').value).toBe('10')
    expect([field('Ball length').value, field('Ball weight').value]).toEqual(['', ''])
    expect(sizeLine()).toBe('Enter your swatch’s width and height to see the finished size.')
    // 6 × 2.5 cm × 1.1 = 0.165 m, rounded up; no ball, so no balls.
    expect(rows()).toEqual([
      ['Colour', 'Stitches', 'Metres'],
      ['White', '6', '1'],
      ['Brown', '6', '1'],
      ['Total', '12', '1'],
    ])
    expect(screen.getByText('Enter a ball’s length or weight, from its label, to count balls.')).toBeTruthy()
  })

  it('gives the finished size from the swatch, in cm or inches', async () => {
    const { stored } = await openImport()
    await openDialog()
    // 1 cm a stitch and 0.8 cm a row: 4 columns × 3 rows is 4 × 2.4 cm.
    await type('Width', '10')
    await type('Height', '8')
    expect(sizeLine()).toBe('Finished size: 4 × 2.4 cm, before any border')
    await type('Stitches', '20')
    expect(sizeLine()).toBe('Finished size: 2 × 2.4 cm, before any border')
    await userEvent.click(screen.getByRole('radio', { name: 'Imperial (in, yd)' }))
    expect(field('Width').value).toBe('3.94')
    expect(sizeLine()).toBe('Finished size: 0.8 × 0.9 in, before any border')
    expect(stored()).toMatchObject({ swatchStitches: 20, swatchRows: 10, swatchWidthCm: 10, swatchHeightCm: 8, units: 'imperial' })
  })

  it('estimates by length, then by the swatch’s weight once it is weighed', async () => {
    const { stored } = await openImport()
    await openDialog()
    // A metre a stitch: 6 × 1 m × 1.1 = 6.6 m; a 5 m ball, 2 balls a colour.
    await type('Yarn per stitch', '100')
    await type('Ball length', '5')
    expect(rows().slice(1)).toEqual([
      ['White', '6', '7', '2'],
      ['Brown', '6', '7', '2'],
      ['Total', '12', '14', '4'],
    ])
    // A 10 × 10 swatch of 500 g: 5 g a stitch, 6 × 5 × 1.1 = 33 g. With a 20 g ball of
    // 5 m (4 g a metre) that is 8.25 m, and 2 balls by weight.
    await type('Weight (optional)', '500')
    expect(screen.queryByRole('textbox', { name: 'Yarn per stitch' })).toBeNull()
    expect(screen.getByText(/By your swatch’s weight\./)).toBeTruthy()
    // Grams alone: no metres or balls until the ball's weight is known.
    expect(rows().slice(0, 2)).toEqual([
      ['Colour', 'Stitches', 'Grams'],
      ['White', '6', '33'],
    ])
    await type('Ball weight', '20')
    expect(rows()).toEqual([
      ['Colour', 'Stitches', 'Metres', 'Grams', 'Balls'],
      ['White', '6', '9', '33', '2'],
      ['Brown', '6', '9', '33', '2'],
      ['Total', '12', '17', '66', '4'],
    ])
    expect(stored()).toMatchObject({ yarnPerStitchCm: 100, swatchGrams: 500, ballMetres: 5, ballGrams: 20 })
  })

  it('counts carried yarn, one stitch’s width a stitch, when asked and measured', async () => {
    await openImport({ swatchGrams: 500, ballMetres: 5, ballGrams: 20 })
    await openDialog()
    const carry = screen.getByRole('checkbox', { name: 'Count yarn carried inside the stitches (tapestry crochet)' })
    await userEvent.click(carry)
    expect(screen.getByText(/Enter your swatch’s width to count carried yarn/)).toBeTruthy()
    // 1 cm a stitch. The checkerboard, worked from the bottom row right to left, carries
    // each colour inside 5 stitches: 5 cm, 0.2 g. 33 g + 0.2 × 1.1 = 33.22 g.
    await type('Width', '10')
    expect(screen.queryByText(/to count carried yarn/)).toBeNull()
    expect(rows().slice(1).map((r) => r[3])).toEqual(['34', '34', '67'])
    expect(screen.getByText(/and 10 stitches of carried yarn/)).toBeTruthy()
    // By weight it needs the ball's grams per metre.
    await userEvent.clear(field('Ball weight'))
    await userEvent.tab()
    expect(screen.getByText('Enter the ball’s length and weight to count carried yarn by weight.')).toBeTruthy()
  })

  it('estimates the pattern as it will be saved: removed colours are gone', async () => {
    await openImport()
    await userEvent.click(screen.getByRole('button', { name: 'Remove “Brown”' }))
    await openDialog()
    expect(rows().slice(1).map((r) => r.slice(0, 2))).toEqual([
      ['White', '12'],
      ['Total', '12'],
    ])
  })

  it('takes the chosen yarn range’s ball, until one is typed', async () => {
    await openImport({ colourLibrary: 'stylecraft-special-dk' })
    await openDialog()
    await waitFor(() => expect(field('Ball length').value).toBe('295'))
    expect(field('Ball weight').value).toBe('100')
    expect(screen.getByText(/Ball: Stylecraft Special DK\./)).toBeTruthy()
    await type('Ball length', '10')
    expect(screen.queryByText(/Ball: Stylecraft Special DK\./)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Use Stylecraft Special DK’s ball' }))
    expect(field('Ball length').value).toBe('295')
  })

  it('keeps a half-typed number and ignores nonsense', async () => {
    const { stored } = await openImport()
    await openDialog()
    const perStitch = field('Yarn per stitch')
    await userEvent.clear(perStitch)
    await userEvent.type(perStitch, '3.')
    expect(perStitch.value).toBe('3.')
    expect(stored().yarnPerStitchCm).toBe(3)
    await userEvent.type(perStitch, 'x')
    expect(perStitch.getAttribute('aria-invalid')).toBe('true')
    expect(stored().yarnPerStitchCm).toBe(3)
    // Stitches and rows are whole numbers, and more than none.
    await type('Rows', '0')
    expect(field('Rows').getAttribute('aria-invalid')).toBe('true')
    expect(stored().swatchRows).toBe(10)
    await type('Rows', '12.5') // 12 is taken on the way
    expect(field('Rows').getAttribute('aria-invalid')).toBe('true')
    expect(stored().swatchRows).toBe(12)
    // An emptied measurement is unmeasured again.
    await type('Width', '12')
    await userEvent.clear(field('Width'))
    await userEvent.tab()
    expect(stored().swatchWidthCm).toBeNull()
  })

  it('exports the estimate as text, under the name typed', async () => {
    await openImport({ swatchWidthCm: 10, swatchHeightCm: 8 })
    await userEvent.type(screen.getByRole('textbox', { name: 'Pattern name' }), 'Dog')
    await openDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Export yarn list' }))
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob
    const text = await blob.text()
    expect(text.split('\n').slice(0, 4)).toEqual([
      'Dog: yarn estimate',
      '',
      'Pattern: 4 columns × 3 rows. Finished size: 4 × 2.4 cm.',
      'Swatch: 10 stitches × 10 rows, 10 × 8 cm.',
    ])
    expect(text).toContain('White (#ffffff): 6 stitches, 1 m\n')
  })
})
