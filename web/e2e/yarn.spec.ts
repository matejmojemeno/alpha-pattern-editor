/**
 * Yarn colour libraries and the yarn estimate in real Chromium, on a pattern imported
 * from a photo with real Pyodide (dachshund.png: 605 white, 331 dark topaz, 22 medium
 * topaz and 2 black stitches, as the desktop detects them). Choosing Stylecraft Special
 * DK shows each colour's nearest shade on the import screen and in the Design stage;
 * changing the estimate's inputs changes its numbers; a reload keeps the choices. The
 * libraries load only when shown, and Design and Work make no Pyodide request.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { shadeLabel, type Library } from '../src/yarn/libraries.ts'
import { matcher, nearestShade } from '../src/yarn/match.ts'
import { desktopDetect, ROOT } from './desktop.ts'
import { importImage, saveAs } from './importing.ts'

test.describe.configure({ timeout: 5 * 60_000 })

const IMAGE = resolve(ROOT, 'test_images/dachshund.png')
const library = (id: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../src/yarn/data/${id}.json`), 'utf-8')) as Library

/** Each body row of the estimate, and the total: [name, stitches, length, balls]. */
const estimate = (page: Page) =>
  page
    .getByRole('table', { name: 'Yarn for each colour' })
    .locator('tbody tr, tfoot tr')
    .evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent)))

test('pick a yarn library, see its shades on an imported pattern, change the estimate, reload', async ({ page }) => {
  const want = desktopDetect(IMAGE)
  expect(want.palette.map(([, , n]) => n)).toEqual([605, 331, 22, 2])
  const stylecraft = matcher(library('stylecraft-special-dk'))
  const shades = want.palette.map(([hex]) => shadeLabel(nearestShade(stylecraft, hex).shade))

  const data: string[] = []
  page.on('request', (r) => {
    const m = /\/assets\/(dmc|stylecraft-special-dk|paintbox-simply-dk|scheepjes-colour-crafter)-[\w-]+\.js$/.exec(r.url())
    if (m) data.push(m[1]!)
  })

  // The import screen: DMC by default, then Stylecraft.
  await importImage(page, IMAGE)
  const colours = page.getByRole('list', { name: 'Colours' }).locator('.shade__label')
  await expect(colours).toHaveCount(4)
  expect(data).toEqual(['dmc'])
  await page.getByRole('combobox', { name: 'Match colours to' }).selectOption('stylecraft-special-dk')
  await expect(colours).toHaveText(shades)
  await expect(page.getByRole('link', { name: 'temperature-blanket.com' })).toBeVisible()
  expect(data).toEqual(['dmc', 'stylecraft-special-dk'])

  // From here on, nothing may reach Pyodide.
  const pyodide: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && pyodide.push(r.url()))
  await saveAs(page, 'Dachshund')
  await expect(page).toHaveURL(/#\/design\//)

  // The Design stage: the same shades, and the choice.
  const palette = page.getByRole('list', { name: 'Palette' })
  await expect(palette.locator('.shade__label')).toHaveText(shades)
  await expect(page.getByRole('combobox', { name: 'Match colours to' })).toHaveValue('stylecraft-special-dk')

  // The estimate, with the defaults: 2.5 cm a stitch, 10% extra, Stylecraft's 295 m ball.
  await expect(page.getByRole('textbox', { name: 'One ball' })).toHaveValue('295')
  const names = want.palette.map(([, name]) => name)
  expect(await estimate(page)).toEqual([
    [names[0], '605', '17', '1'],
    [names[1], '331', '10', '1'],
    [names[2], '22', '1', '1'],
    [names[3], '2', '1', '1'],
    ['Total', '960', '27', '4'],
  ])

  // 50 cm a stitch: 605 × 0.55 = 332.75 m, two balls of 295 m.
  const perStitch = page.getByRole('textbox', { name: 'Yarn per stitch' })
  await perStitch.fill('50')
  await expect.poll(() => estimate(page)).toEqual([
    [names[0], '605', '333', '2'],
    [names[1], '331', '183', '1'],
    [names[2], '22', '13', '1'],
    [names[3], '2', '2', '1'],
    ['Total', '960', '528', '5'],
  ])
  await page.getByRole('radio', { name: 'Yards' }).check()
  await expect(perStitch).toHaveValue('19.69')
  await expect.poll(async () => (await estimate(page)).map((r) => r[2])).toEqual(['364', '200', '14', '2', '578'])
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // A reload keeps the library, the inputs and the units.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Dachshund' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Match colours to' })).toHaveValue('stylecraft-special-dk')
  await expect(palette.locator('.shade__label')).toHaveText(shades)
  await expect(page.getByRole('radio', { name: 'Yards' })).toBeChecked()
  await expect(perStitch).toHaveValue('19.69')
  await expect.poll(async () => (await estimate(page)).map((r) => r[2])).toEqual(['364', '200', '14', '2', '578'])

  // Export yarn list.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export yarn list' }).click()])
  expect(download.suggestedFilename()).toBe('Dachshund yarn.txt')

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
