/**
 * The Work stage on a phone, in real Chromium: the chart gets the room.
 *
 * 393 × 660 is the part of an iPhone 15's screen Safari leaves to the page with its
 * toolbars showing. The chart takes the height it can use at the full width, and the
 * current row's chips get the rest, at least enough for a chip and the next row's line.
 */
import { writeFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { emptyProgress, type Pattern, type Project } from '../src/model/types.ts'
import { writeAlpha } from '../src/storage/alpha.ts'

test.use({ viewport: { width: 393, height: 660 }, hasTouch: true, isMobile: true })

/** A `cols` × `rows` chart: a blob of white on blue, its bottom row all blue (one chip),
 *  or, with `busy`, stripes of two stitches (a chip every two stitches). */
function project(rows: number, cols: number, busy = false): Project {
  const cells = new Uint16Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inside = (c - cols / 2) ** 2 / (cols / 3) ** 2 + (r - rows / 2) ** 2 / (rows / 3) ** 2 < 1
      cells[r * cols + c] = busy ? Math.floor(c / 2) % 2 : inside ? 1 : 0
    }
  }
  const pattern: Pattern = {
    id: `e2e-phone-${rows}x${cols}${busy ? '-busy' : ''}`,
    name: `Phone ${cols}×${rows}${busy ? ' busy' : ''}`,
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

/** The chart, the chips and the buttons, once laid out. */
async function measure(page: Page) {
  // Settled: the chart has had a frame to read its size and lay out again.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  return page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)!.getBoundingClientRect()
    const sc = document.querySelector<HTMLElement>('[data-testid="chart-scroller"]')!
    const spacer = sc.firstElementChild!.getBoundingClientRect()
    const chart = box('.chart')
    const chips = box('.work__chips')
    const current = box('.chip--current')
    const next = document.querySelector('.work__next')?.getBoundingClientRect()
    return {
      cell: Number(sc.dataset.cell),
      inset: Number(sc.dataset.inset),
      view: sc.clientWidth,
      chart: { top: chart.top, bottom: chart.bottom, height: chart.height },
      // The chart's own drawing: margins, rows and all, at the top of the chart area.
      drawn: spacer.height,
      gridWidth: spacer.width,
      chips: { top: chips.top, bottom: chips.bottom },
      current: { top: current.top, bottom: current.bottom },
      next: next ? { top: next.top, bottom: next.bottom } : null,
      bar: box('.work__bar').top,
      label: box('.work__chips .work__label'),
    }
  })
}

test('a chart about as tall as wide gets the room the chips leave, and sits in the middle', async ({ page }, testInfo) => {
  // The owner's Snoopy: 38 × 45, row 1 one segment. Before, the chart had half the space
  // under the header and drew 4 px stitches; the other half was mostly empty.
  await open(page, testInfo.outputPath('phone.alpha'), project(45, 38))
  const m = await measure(page)
  expect(m.cell).toBeGreaterThanOrEqual(7)
  // Sized by its height: what's left under the drawing is less than a pixel more per row
  // (45 rows, the current one and two either side 1.6 times as tall) would need.
  expect(m.chart.height - m.drawn).toBeGreaterThanOrEqual(-0.5)
  expect(m.chart.height - m.drawn).toBeLessThan(40 + 5 * 1.6)
  // The chip and the next row's line are in full view, above the buttons.
  expect(m.next).not.toBeNull()
  expect(m.next!.bottom).toBeLessThanOrEqual(m.chips.bottom + 0.5)
  expect(m.chips.bottom).toBeLessThanOrEqual(m.bar)
  // "This row" is said to screen readers only.
  await expect(page.getByRole('region', { name: 'This row' })).toBeVisible()
  expect(m.label.height).toBeLessThanOrEqual(1)
  // Sized by its height, the grid is narrower than the view: it's in the middle of it.
  const grid = m.gridWidth - 34 - 6
  expect(m.inset).toBeGreaterThan(10)
  expect(Math.abs(m.inset - (m.view - 34 - 6 - grid) / 2)).toBeLessThanOrEqual(0.5)
})

test('a wide chart takes only the height it draws, and the chips get the rest', async ({ page }, testInfo) => {
  await open(page, testInfo.outputPath('wide.alpha'), project(20, 40))
  const m = await measure(page)
  // Sized by the width: as big as the width allows, across the whole width.
  expect(m.cell).toBe(Math.floor((m.view - 34 - 6) / 40))
  // No taller than it draws, but for the two taller rows above row 1 that aren't there
  // (the cells are sized as if they were, so they keep their size up the chart).
  expect(m.chart.height - m.drawn).toBeGreaterThanOrEqual(-0.5)
  expect(m.chart.height - m.drawn).toBeLessThanOrEqual(2 * Math.round(1.6 * m.cell) + 1)
  // The chips take the rest.
  expect(m.chips.top - m.chart.bottom).toBeLessThan(16)
  expect(m.bar - m.chips.bottom).toBeLessThan(16)
  expect(m.inset).toBe(0)
})

test('on a row of many segments the current chip stays in full view', async ({ page }, testInfo) => {
  await open(page, testInfo.outputPath('busy.alpha'), project(45, 38, true))
  for (let i = 0; i < 4; i++) {
    const m = await measure(page)
    expect(m.current.top).toBeGreaterThanOrEqual(m.chips.top - 0.5)
    expect(m.current.bottom).toBeLessThanOrEqual(m.chips.bottom + 0.5)
    await page.locator('.chip--current .chip__tick').click()
    await page.waitForTimeout(400)
  }
})
