/**
 * On a phone, a chart wider than the screen scrolls across to keep your place in the row
 * in view: through every segment, with partial stitches, on rows worked either way.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { encodeRow } from '../src/logic/readout.ts'
import { emptyProgress, type Pattern, type Project } from '../src/model/types.ts'
import { AXIS_LEFT, PAD } from '../src/render/layout.ts'
import { writeAlpha } from '../src/storage/alpha.ts'

test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true })

const BASIC = resolve(import.meta.dirname, '../../fixtures/alpha/desktop/basic.alpha')
const ROWS = 20
const COLS = 98

/** 98 × 20, bands of 7 stitches in three colours, shifted a stitch each row: 14 or 15
 *  segments a row, and far wider than a phone. Row 1 (the bottom) reads left to right. */
function wideProject(): Project {
  const cells = new Uint16Array(ROWS * COLS)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells[r * COLS + c] = Math.floor((c + r) / 7) % 3
  const colours = ['#8b5a2b', '#f5f5f0', '#c0392b']
  const pattern: Pattern = {
    id: 'e2e-wide',
    name: 'Wide scarf',
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    rows: ROWS,
    cols: COLS,
    row_ids: Array.from({ length: ROWS }, (_, i) => `row-${i}`),
    cells,
    palette: colours.map((hex, i) => ({
      id: `c${i}`,
      hex,
      name: ['Brown', 'White', 'Red'][i]!,
      dmc: null,
      count: cells.filter((v) => v === i).length,
    })),
    start_direction: 'LTR',
    alternate_direction: true,
    bottom_up: true,
  }
  return { pattern, progress: emptyProgress(), stage: 'work' }
}

const project = wideProject()
const p = project.pattern
/** Image row of working row `n` (1-based): bottom-up. */
const imageRow = (n: number) => ROWS - n

const rowLabel = (page: Page) => page.locator('.work__row')
const chips = (page: Page) => page.getByRole('list', { name: 'Colours in this row' }).getByRole('button')
const scroller = (page: Page) => page.getByTestId('chart-scroller')

/** The chart's horizontal scroll once it has stopped moving (ten still frames). */
async function settledScroll(page: Page) {
  return scroller(page).evaluate(
    (el) =>
      new Promise<{ left: number; max: number; width: number; scrollWidth: number }>((resolve) => {
        let last = -1
        let still = 0
        const tick = () => {
          still = el.scrollLeft === last ? still + 1 : 0
          last = el.scrollLeft
          if (still < 10) return void requestAnimationFrame(tick)
          const { scrollLeft: left, scrollWidth, clientWidth: width } = el
          resolve({ left, max: scrollWidth - width, width, scrollWidth })
        }
        requestAnimationFrame(tick)
      }),
  )
}

/** Checks the next stitch to work, in row `n`, is on screen, and returns the scroll. */
async function expectPlaceInView(page: Page, n: number, runIndex: number, stitches: number) {
  // Worked out here rather than with layout.ts's placeColumn, which is what's under test:
  // runs count in working order, which runs right to left on even rows.
  const r = imageRow(n)
  const position = encodeRow(p, r)[runIndex]!.start_col + stitches
  const col = n % 2 === 1 ? position : COLS - 1 - position
  const s = await settledScroll(page)
  // The scroller holds the grid plus its margins; what's left of its width shows the grid.
  const cell = (s.scrollWidth - AXIS_LEFT - PAD) / COLS
  const view = s.width - AXIS_LEFT - PAD
  const x = col * cell
  expect(x, `row ${n}, segment ${runIndex} + ${stitches}: col ${col}`).toBeGreaterThanOrEqual(s.left - 0.5)
  expect(x + cell,`row ${n}, segment ${runIndex} + ${stitches}: col ${col}`).toBeLessThanOrEqual(s.left + view + 0.5)
  return s
}

async function completeSegment(page: Page, i: number) {
  await chips(page).nth(i).click()
  const dialog = page.getByRole('dialog', { name: 'Record progress' })
  await dialog.getByRole('button', { name: 'Mark segment complete' }).click()
  await expect(dialog).toBeHidden()
}

test('the chart follows your place across a wide chart', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('wide-scarf.alpha')
  writeFileSync(file, writeAlpha(project).bytes)
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(file)
  await page.getByRole('listitem').filter({ hasText: p.name }).getByRole('link').click()
  await expect(rowLabel(page)).toHaveText(`Row 1 of ${ROWS} →`)

  // Genuinely wide: the chart scrolls across by more than a screen.
  let s = await settledScroll(page)
  expect(s.max).toBeGreaterThan(s.width)

  // 1. Row 1, left to right: it starts at the left edge, and every segment stays in view
  //    as it's completed, the chart moving across to follow.
  expect(s.left).toBe(0)
  const runs1 = encodeRow(p, imageRow(1))
  const lefts = [s.left]
  for (let i = 0; i < runs1.length - 1; i++) {
    await completeSegment(page, i)
    s = await expectPlaceInView(page, 1, i + 1, 0)
    lefts.push(s.left)
  }
  expect(Math.max(...lefts)).toBe(s.max) // it got to the far side
  // It moved a view at a time, not on every segment.
  expect(new Set(lefts).size).toBeLessThan(runs1.length / 2)

  // 2. Completing the last segment starts row 2, right to left: at the right edge.
  await completeSegment(page, runs1.length - 1)
  await expect(rowLabel(page)).toHaveText(`Row 2 of ${ROWS} ←`)
  s = await expectPlaceInView(page, 2, 0, 0)
  expect(s.left).toBe(s.max)

  // 3. Partial stitches: 5 of 7 into a segment half way along, then the next.
  const runs2 = encodeRow(p, imageRow(2))
  const mid = Math.floor(runs2.length / 2)
  await chips(page).nth(mid).click()
  const dialog = page.getByRole('dialog', { name: 'Record progress' })
  await dialog.getByLabel('Stitches done').fill('5')
  await dialog.getByRole('button', { name: 'Save progress' }).click()
  await expect(dialog).toBeHidden()
  s = await expectPlaceInView(page, 2, mid, 5)
  expect(s.left).toBeLessThan(s.max)
  await completeSegment(page, mid)
  await expectPlaceInView(page, 2, mid + 1, 0)

  // 4. A scroll by hand is left alone, and the next progress change brings your place back.
  await scroller(page).evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await completeSegment(page, mid + 1)
  await expectPlaceInView(page, 2, mid + 2, 0)

  // 5. Keyboard: → starts row 3 at the left edge; ← goes back to row 2, at the right edge.
  await page.keyboard.press('ArrowRight')
  await expect(rowLabel(page)).toHaveText(`Row 3 of ${ROWS} →`)
  s = await expectPlaceInView(page, 3, 0, 0)
  expect(s.left).toBe(0)
  await page.keyboard.press('ArrowLeft')
  await expect(rowLabel(page)).toHaveText(`Row 2 of ${ROWS} ←`)
  s = await expectPlaceInView(page, 2, 0, 0)
  expect(s.left).toBe(s.max)

  // 6. Row complete, from the button: row 3 again, from the left.
  await page.getByRole('button', { name: 'Row complete →' }).tap()
  await expect(rowLabel(page)).toHaveText(`Row 3 of ${ROWS} →`)
  s = await expectPlaceInView(page, 3, 0, 0)
  expect(s.left).toBe(0)
})

test('a chart that fits across never scrolls sideways', async ({ page }) => {
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(BASIC)
  // Saved by the desktop in the Design stage, with no progress: the card opens Design.
  await page.getByRole('listitem').first().getByRole('link').click()
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(rowLabel(page)).toHaveText('Row 1 of 5 ←')
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) {
    await page.keyboard.press(key)
    const s = await settledScroll(page)
    expect(s.max).toBe(0)
    expect(s.left).toBe(0)
  }
})
