/**
 * Stitch numbers too small to show, in real Chromium: a row is numbered whole or not at
 * all, and when your row has none, a note over the chart's corner zooms in just far
 * enough for them, or can be hidden.
 */
import { writeFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { emptyProgress, type Pattern, type Project } from '../src/model/types.ts'
import { writeAlpha } from '../src/storage/alpha.ts'

/** A `cols` × `rows` chart of a white blob on blue: the first row worked is all blue. */
function project(rows: number, cols: number): Project {
  const cells = new Uint16Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[r * cols + c] = (c - cols / 2) ** 2 / (cols / 3) ** 2 + (r - rows / 2) ** 2 / (rows / 3) ** 2 < 1 ? 1 : 0
    }
  }
  const pattern: Pattern = {
    id: `e2e-numbers-${rows}x${cols}`,
    name: `Numbers ${cols}×${rows}`,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    rows,
    cols,
    row_ids: Array.from({ length: rows }, (_, i) => `row-${i}`),
    cells,
    palette: ['#a9bde3', '#ffffff'].map((hex, i) => ({
      id: `c${i}`,
      hex,
      name: ['Blue', 'White'][i]!,
      dmc: null,
      count: cells.filter((v) => v === i).length,
    })),
    start_direction: 'RTL',
    alternate_direction: true,
    bottom_up: true,
    craft: 'tapestry',
  }
  return { pattern, progress: emptyProgress(), stage: 'work' }
}

async function open(page: Page, file: string, p: Project) {
  writeFileSync(file, writeAlpha(p).bytes)
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(file)
  await page.getByRole('listitem').filter({ hasText: p.pattern.name }).getByRole('link', { name: /^Open / }).click()
  await expect(page.locator('.work__row')).toHaveText(/^Row 1 of/)
}

const zoomIn = (page: Page) => page.getByRole('button', { name: 'Zoom in for stitch numbers' })
const zoom = async (page: Page) => Number(await page.getByTestId('chart-scroller').getAttribute('data-zoom'))

test.use({ viewport: { width: 1280, height: 800 } })

test('a chart too small for your row’s numbers says so, and zooms in just enough for them', async ({ page }, testInfo) => {
  // 150 stitches across: small cells, and the first row one run of 150 blue.
  await open(page, testInfo.outputPath('wide.alpha'), project(30, 150))
  await expect(zoomIn(page)).toBeVisible()
  await page.locator('.chart').screenshot({ path: testInfo.outputPath('note.png') })
  expect(await zoom(page)).toBe(1)

  await zoomIn(page).click()
  // Zoomed in, and far enough: the note is gone, as it shows only while the numbers can't.
  await expect(zoomIn(page)).toBeHidden()
  const z = await zoom(page)
  expect(z).toBeGreaterThan(1)
  expect(z).toBeLessThan(8)
  await page.locator('.chart').screenshot({ path: testInfo.outputPath('zoomed.png') })

  // Back to the whole chart: the note again. Its × hides it for the rest of this visit.
  await page.getByRole('button', { name: /× · Fit$/ }).click()
  await expect(zoomIn(page)).toBeVisible()
  await page.getByRole('button', { name: 'Hide this note' }).click()
  await expect(zoomIn(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Hide this note' })).toBeHidden()
})

test('no note when your row is numbered, or the numbers are switched off', async ({ page }, testInfo) => {
  await open(page, testInfo.outputPath('small.alpha'), project(12, 20))
  await expect(page.locator('.chart canvas')).toBeVisible()
  await expect(zoomIn(page)).toBeHidden()

  await open(page, testInfo.outputPath('wide.alpha'), project(30, 150))
  await expect(zoomIn(page)).toBeVisible()
  await page.getByText('Options').click()
  await page.getByLabel('Number the stitches').uncheck()
  await expect(zoomIn(page)).toBeHidden()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the note fits inside the chart', async ({ page }, testInfo) => {
    await open(page, testInfo.outputPath('wide.alpha'), project(30, 80))
    await expect(zoomIn(page)).toBeVisible()
    const chart = (await page.locator('.chart').boundingBox())!
    const note = (await page.locator('.chart__hint').boundingBox())!
    expect(note.x).toBeGreaterThanOrEqual(chart.x)
    expect(note.x + note.width).toBeLessThanOrEqual(chart.x + chart.width)
    await page.locator('.chart').screenshot({ path: testInfo.outputPath('phone.png') })
  })
})
