/**
 * Yarn libraries and "Yarn & size" in real Chromium, on a pattern imported from a photo
 * with real Pyodide (dachshund.png: 40 × 24, 605 white, 331 dark topaz, 22 medium topaz
 * and 2 black stitches, as the desktop detects them). No library is matched, or fetched,
 * until one is chosen under "Advanced: match to yarn"; choosing Stylecraft Special DK
 * shows each colour's nearest shade on the import screen and gives "Yarn & size" its
 * ball; the dialog's swatch gives the finished size and the estimate; the Design stage
 * shows no yarn at all, and Design and Work make no Pyodide request.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { carriedStitches } from '../src/logic/carry.ts'
import { PATTERN_DEFAULTS, type Pattern } from '../src/model/types.ts'
import { shadeLabel, type Library } from '../src/yarn/libraries.ts'
import { matcher, nearestShade } from '../src/yarn/match.ts'
import { desktopDetect, ROOT } from './desktop.ts'
import { importImage, saveAs } from './importing.ts'

test.describe.configure({ timeout: 5 * 60_000 })

const IMAGE = resolve(ROOT, 'test_images/dachshund.png')
const library = (id: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../src/yarn/data/${id}.json`), 'utf-8')) as Library

/** The estimate's rows, header first, then each colour and the total. */
const estimate = (page: Page) =>
  page
    .getByRole('table', { name: 'Yarn for each colour' })
    .locator('tr')
    .evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent)))

test('match to a yarn range on import, estimate yarn and size there, and see no yarn in Design', async ({ page }) => {
  const want = desktopDetect(IMAGE)
  expect([want.cols, want.rows]).toEqual([40, 24])
  expect(want.palette.map(([, , n]) => n)).toEqual([605, 331, 22, 2])
  const stylecraft = matcher(library('stylecraft-special-dk'))
  const shades = want.palette.map(([hex]) => shadeLabel(nearestShade(stylecraft, hex).shade))
  const names = want.palette.map(([, name]) => name)

  const data: string[] = []
  page.on('request', (r) => {
    const m = /\/assets\/(dmc|stylecraft-special-dk|paintbox-simply-dk|scheepjes-colour-crafter)-[\w-]+\.js$/.exec(r.url())
    if (m) data.push(m[1]!)
  })

  // The import screen: everyday names and no library, until Stylecraft is chosen.
  await importImage(page, IMAGE)
  const list = page.getByRole('list', { name: 'Colours' })
  await expect(list.getByRole('listitem')).toHaveCount(4)
  const colours = list.locator('.shade__label')
  await expect(colours).toHaveCount(0)
  const picker = page.getByRole('combobox', { name: 'Match colours to' })
  await expect(picker).toBeHidden()
  await page.getByText('Advanced: match to yarn').click()
  await expect(picker).toHaveValue('')
  await picker.selectOption('stylecraft-special-dk')
  await expect(colours).toHaveText(shades)
  await expect(page.getByRole('link', { name: 'temperature-blanket.com' })).toBeVisible()
  expect(data).toEqual(['stylecraft-special-dk'])

  // "Yarn & size", beside Save, with the defaults: 2.5 cm a stitch, 10% extra, and
  // Stylecraft's ball, 295 m in 100 g.
  const save = page.getByRole('button', { name: 'Save & edit pattern' })
  const open = page.getByRole('button', { name: 'Yarn & size' })
  const [a, b] = await Promise.all([open.boundingBox(), save.boundingBox()])
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(1) // side by side
  expect(a!.x).toBeLessThan(b!.x)
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Yarn & size' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Ball length' })).toHaveValue('295')
  await expect(dialog.getByRole('textbox', { name: 'Ball weight' })).toHaveValue('100')
  // White: 605 × 2.5 cm × 1.1 = 16.64 m, 5.64 g.
  expect(await estimate(page)).toEqual([
    ['Colour', 'Stitches', 'Metres', 'Grams', 'Balls'],
    [names[0], '605', '17', '6', '1'],
    [names[1], '331', '10', '4', '1'],
    [names[2], '22', '1', '1', '1'],
    [names[3], '2', '1', '1', '1'],
    ['Total', '960', '27', '9', '4'],
  ])

  // 50 cm a stitch: 605 × 0.55 = 332.75 m, two balls of 295 m.
  await dialog.getByRole('textbox', { name: 'Yarn per stitch' }).fill('50')
  await expect.poll(() => estimate(page)).toEqual([
    ['Colour', 'Stitches', 'Metres', 'Grams', 'Balls'],
    [names[0], '605', '333', '113', '2'],
    [names[1], '331', '183', '62', '1'],
    [names[2], '22', '13', '5', '1'],
    [names[3], '2', '2', '1', '1'],
    ['Total', '960', '528', '179', '5'],
  ])

  // The swatch: 10 stitches in 10 cm and 10 rows in 8 cm, so 40 × 24 is 40 × 19.2 cm.
  await dialog.getByRole('textbox', { name: 'Width' }).fill('10')
  await dialog.getByRole('textbox', { name: 'Height' }).fill('8')
  await expect(dialog.getByText('Finished size:')).toHaveText('Finished size: 40 × 19.2 cm, before any border')

  // Carried yarn, as the Work stage would show it on the desktop's detection.
  const pattern = { ...PATTERN_DEFAULTS, id: '', name: '', created_at: 0, updated_at: 0, row_ids: [], rows: 24, cols: 40 }
  const carried = carriedStitches({
    ...pattern,
    cells: Uint16Array.from(want.cells),
    palette: want.palette.map(([hex, name, count], i) => ({ id: String(i), hex, name, dmc: null, count })),
  } as Pattern)
  const total = carried.reduce((n, c) => n + c, 0)
  expect(total).toBeGreaterThan(0)
  await dialog.getByRole('checkbox', { name: /Count yarn carried inside the stitches/ }).check()
  await expect(dialog.getByText(`and ${total.toLocaleString('en-GB')} stitches of carried yarn`, { exact: false })).toBeVisible()
  // White gains one 1 cm stitch width per stitch it's carried inside, and the margin.
  const white = Math.ceil(605 * 0.55 + carried[0]! * 0.01 * 1.1 - 1e-9)
  await expect.poll(async () => (await estimate(page))[1]![2]).toBe(String(white))

  // On a phone, the dialog fits the width and scrolls inside itself.
  await page.setViewportSize({ width: 400, height: 700 })
  const fits = await dialog.evaluate((el) => ({ over: el.scrollWidth - el.clientWidth, right: el.getBoundingClientRect().right }))
  expect(fits.over).toBeLessThanOrEqual(0)
  expect(fits.right).toBeLessThanOrEqual(400)
  await page.setViewportSize({ width: 1280, height: 720 })

  // Export yarn list.
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export yarn list' }).click()])
  expect(download.suggestedFilename()).toBe('Untitled pattern yarn.txt')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()

  // From here on, nothing may reach Pyodide.
  const pyodide: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && pyodide.push(r.url()))
  await saveAs(page, 'Dachshund')
  await expect(page).toHaveURL(/#\/design\//)

  // The Design stage: the colours, and no yarn.
  const palette = page.getByRole('list', { name: 'Palette' })
  await expect(palette.getByRole('button')).toHaveCount(4)
  await expect(page.locator('.shade')).toHaveCount(0)
  await expect(page.getByText('Advanced: match to yarn')).toHaveCount(0)
  await expect(page.getByRole('table', { name: 'Yarn for each colour' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export yarn list' })).toHaveCount(0)

  // And the Work stage, which shows no library at all.
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(/#\/work\//)
  await expect(page.locator('.work__row')).toHaveText(/^Row 1 of 24/)
  expect(pyodide).toEqual([])
})

test('the Library and Settings load no colour library', async ({ page }) => {
  const data: string[] = []
  page.on('request', (r) => /\/assets\/(dmc|stylecraft|paintbox|scheepjes)-/.test(r.url()) && data.push(r.url()))
  await page.goto('/#/library')
  await expect(page.getByRole('heading', { level: 1, name: 'Your projects' })).toBeVisible()
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  expect(data).toEqual([])
})
