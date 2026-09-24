/**
 * The Work stage in real Chromium: progress made by keyboard and by tapping chips is
 * saved without a Save button, survives a real reload, and travels in an exported file.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { readAlpha } from '../src/storage/alpha.ts'

const FIXTURES = resolve(import.meta.dirname, '../../fixtures/alpha/desktop')
const BASIC = resolve(FIXTURES, 'basic.alpha')
const LARGE = resolve(FIXTURES, 'large.alpha')
const basic = readAlpha(new Uint8Array(readFileSync(BASIC))).project.pattern

const rowLabel = (page: Page) => page.locator('.work__row')
const chips = (page: Page) => page.getByRole('list', { name: 'Colours in this row' }).getByRole('button')

/** Import `file` from the Library and open it. */
async function importAndOpen(page: Page, file: string, name: string) {
  await page.goto('/#/library')
  await page.getByLabel('Choose .alpha files to import').setInputFiles(file)
  const card = page.getByRole('listitem').filter({ hasText: name })
  await card.getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** The progress on screen: the row, and each chip's state and text. */
async function progressOnScreen(page: Page) {
  return {
    row: await rowLabel(page).textContent(),
    chips: await chips(page).evaluateAll((els) => els.map((e) => `${e.className.replace('chip ', '')}: ${e.textContent}`)),
  }
}

test('work through rows, reload, export and re-import', async ({ page }, testInfo) => {
  const pyodide: string[] = []
  page.on('request', (r) => /pyodide/i.test(r.url()) && pyodide.push(r.url()))

  // 1. Import basic.alpha and open it.
  await importAndOpen(page, BASIC, basic.name)
  await expect(rowLabel(page)).toHaveText('Row 1 of 5 ←')

  // 2. Complete three rows: two by keyboard...
  await page.keyboard.press('ArrowRight')
  await expect(rowLabel(page)).toHaveText('Row 2 of 5 →')
  await page.keyboard.press('Space')
  await expect(rowLabel(page)).toHaveText('Row 3 of 5 ←')

  // ...and one by tapping each chip and marking its segment complete.
  await expect(chips(page)).toHaveCount(4)
  for (let i = 0; i < 4; i++) {
    await chips(page).nth(i).click()
    const dialog = page.getByRole('dialog', { name: 'Record progress' })
    await dialog.getByRole('button', { name: 'Mark segment complete' }).click()
    await expect(dialog).toBeHidden()
    if (i < 3) await expect(chips(page).nth(i)).toHaveClass(/chip--done/)
  }
  await expect(rowLabel(page)).toHaveText('Row 4 of 5 →')

  // 3. Partial stitches: 1 of the "2 White" segment (the third) in row 4.
  await chips(page).nth(2).click()
  const dialog = page.getByRole('dialog', { name: 'Record progress' })
  await expect(dialog).toContainText('2 White')
  await dialog.getByLabel('Stitches done').fill('1')
  await dialog.getByRole('button', { name: 'Save progress' }).click()
  await expect(chips(page).nth(2)).toHaveText('2 White· 1/2')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  const before = await progressOnScreen(page)
  expect(before.chips).toEqual([
    'chip--done: 1 Brown✓',
    'chip--done: 1 Red✓',
    'chip--current: 2 White· 1/2',
    'chip--pending: 1 Brown',
    'chip--pending: 1 White',
    'chip--pending: 1 Brown',
  ])
  await expect(page.getByText('24 / 35 stitches')).toBeVisible()

  // 4. A real reload: exactly the same progress.
  await page.reload()
  await expect(rowLabel(page)).toHaveText('Row 4 of 5 →')
  expect(await progressOnScreen(page)).toEqual(before)

  // 5. Export from the Library. The file holds the same progress...
  await page.getByRole('link', { name: /Library/ }).click()
  const card = page.getByRole('listitem').filter({ hasText: basic.name })
  await expect(card.getByText('60% done')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: `Export “${basic.name}”` }).click(),
  ])
  const exported = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(exported)
  const file = readAlpha(new Uint8Array(readFileSync(exported))).project
  expect(file.stage).toBe('work')
  expect([...file.progress.completed_row_ids].sort()).toEqual([basic.row_ids[4], basic.row_ids[3], basic.row_ids[2]].sort())
  expect(file.progress.current_row_id).toBe(basic.row_ids[1])
  expect(file.progress.current_run_index).toBe(2)
  expect(file.progress.current_run_stitches).toBe(1)

  // ...and deleting and re-importing it brings the progress back.
  await card.getByRole('button', { name: `Delete “${basic.name}”` }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No saved projects yet.')).toBeVisible()
  await page.getByLabel('Choose .alpha files to import').setInputFiles(exported)
  await card.getByRole('link').click()
  await expect(rowLabel(page)).toHaveText('Row 4 of 5 →')
  expect(await progressOnScreen(page)).toEqual(before)

  // The Work stage never loads Pyodide.
  expect(pyodide).toEqual([])
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true })

  for (const [file, name] of [
    [BASIC, 'basic'],
    [LARGE, 'large'],
  ] as const) {
    test(`Row complete is on screen without scrolling (${name})`, async ({ page }) => {
      await importAndOpen(page, file, name)
      const button = page.getByRole('button', { name: 'Row complete →' })
      await expect(button).toBeVisible()
      const box = (await button.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(860)
      // The page itself doesn't scroll: the chart and chips scroll inside it.
      const { scrollHeight, innerHeight, scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(scrollHeight).toBeLessThanOrEqual(innerHeight)
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
      // One column: the chart above the chips.
      const chart = (await page.getByRole('img', { name: /^Chart/ }).boundingBox())!
      const list = (await page.getByRole('list', { name: 'Colours in this row' }).boundingBox())!
      expect(chart.y + chart.height).toBeLessThanOrEqual(list.y)
      await button.tap()
      await expect(rowLabel(page)).toHaveText(/^Row 2 of/)
    })
  }
})
