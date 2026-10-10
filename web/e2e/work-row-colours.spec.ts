/**
 * "Show the colours in this row" off, in real Chromium: the "This row" list goes and the
 * chart takes its room, beside it on a computer and under it on a phone.
 */
import { writeFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { emptyProgress, type Pattern, type Project } from '../src/model/types.ts'
import { writeAlpha } from '../src/storage/alpha.ts'

/** A `cols` × `rows` chart of a white blob on blue. */
function project(rows: number, cols: number): Project {
  const cells = new Uint16Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[r * cols + c] = (c - cols / 2) ** 2 / (cols / 3) ** 2 + (r - rows / 2) ** 2 / (rows / 3) ** 2 < 1 ? 1 : 0
    }
  }
  const pattern: Pattern = {
    id: `e2e-row-colours-${rows}x${cols}`,
    name: `Row colours ${cols}×${rows}`,
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
  await page.getByRole('listitem').filter({ hasText: p.pattern.name }).getByRole('link').click()
  await expect(page.locator('.work__row')).toHaveText(/^Row 1 of/)
}

async function toggle(page: Page) {
  await page.getByText('Options', { exact: true }).click()
  await page.getByRole('switch', { name: 'Show the colours in this row' }).click()
  await page.getByText('Options', { exact: true }).click()
}

async function measure(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  return page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)!.getBoundingClientRect()
    const sc = document.querySelector<HTMLElement>('[data-testid="chart-scroller"]')!
    const chart = box('.chart')
    const body = box('.work__body')
    return {
      cell: Number(sc.dataset.cell),
      chart: { left: chart.left, right: chart.right, top: chart.top, bottom: chart.bottom },
      body: { left: body.left, right: body.right, top: body.top, bottom: body.bottom },
      chips: document.querySelector('.work__chips') !== null,
    }
  })
}

test.describe('on a computer', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('a wide chart takes the list’s width, and gets bigger stitches', async ({ page }, testInfo) => {
    await open(page, testInfo.outputPath('wide.alpha'), project(30, 150))
    const before = await measure(page)
    expect(before.chips).toBe(true)
    await toggle(page)
    const after = await measure(page)
    expect(after.chips).toBe(false)
    await expect(page.getByRole('region', { name: 'This row' })).toHaveCount(0)
    // The chart fills the body, side to side.
    expect(Math.abs(after.chart.left - after.body.left)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(after.chart.right - after.body.right)).toBeLessThanOrEqual(0.5)
    // 150 stitches across, sized by the width: 20rem more of it makes them bigger.
    expect(after.cell).toBeGreaterThan(before.cell)
    testInfo.annotations.push({ type: 'cell', description: `${before.cell} → ${after.cell} px` })
    // Kept for every pattern, and back on again.
    await page.reload()
    await expect(page.locator('.work__row')).toHaveText(/^Row 1 of/)
    expect((await measure(page)).chips).toBe(false)
    await toggle(page)
    await expect(page.getByRole('region', { name: 'This row' })).toBeVisible()
    expect((await measure(page)).cell).toBe(before.cell)
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 393, height: 660 }, hasTouch: true, isMobile: true })

  test('the chart takes the height the list had, and is at the top', async ({ page }, testInfo) => {
    await open(page, testInfo.outputPath('phone.alpha'), project(45, 38))
    const before = await measure(page)
    await toggle(page)
    const after = await measure(page)
    expect(after.chips).toBe(false)
    expect(Math.abs(after.chart.top - after.body.top)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(after.chart.bottom - after.body.bottom)).toBeLessThanOrEqual(0.5)
    // Sized by its height there, so more height is bigger stitches.
    expect(after.cell).toBeGreaterThan(before.cell)
    testInfo.annotations.push({ type: 'cell', description: `${before.cell} → ${after.cell} px` })
  })
})
