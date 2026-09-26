/**
 * Touch, in real Chromium with touch emulation: real touch input through the DevTools
 * protocol, which the browser turns into touch and pointer events as a tablet's would.
 *
 * The Design stage: one finger paints; two fingers pinch-zoom without painting; and a
 * stroke the first finger started is taken back, with no undo step, when a second
 * finger lands. The Work chart: two fingers zoom it, the rows followed as before, and
 * reopening the Work stage starts at 1× again.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test'

import { computeLayout, followCurrent } from '../src/render/layout.ts'

const AXIS_LEFT = 34
const AXIS_TOP = 22

test.use({ hasTouch: true, viewport: { width: 1280, height: 860 } })

interface Point {
  x: number
  y: number
}

/** Touch points down, moved or lifted, as one input event. */
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: (Point & { id: number })[]) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })),
  })
}

const scroller = (page: Page) => page.getByTestId('design-scroller')
const palette = (page: Page) => page.getByRole('list', { name: 'Palette' }).getByRole('button')
const undo = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true })

async function centre(page: Page, r: number, c: number): Promise<Point> {
  const box = (await scroller(page).boundingBox())!
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  return { x: box.x + AXIS_LEFT + c * cell + cell / 2, y: box.y + AXIS_TOP + r * cell + cell / 2 }
}

/** Black cells, from the palette's count. */
async function black(page: Page): Promise<number> {
  const label = (await palette(page).filter({ hasText: 'Black' }).getAttribute('aria-label'))!
  return Number(/(\d+) cells?$/.exec(label)![1])
}

async function newDesign(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Design pattern/ }).click()
  const dialog = page.getByRole('dialog', { name: 'New pattern' })
  await dialog.getByLabel('Name').fill('Touchy')
  await dialog.getByLabel('Columns').fill('10')
  await dialog.getByLabel('Rows').fill('8')
  await dialog.getByLabel('Colour').fill('#ffffff')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Touchy' })).toBeVisible()
  await page.getByLabel('Colour to add').fill('#000000')
  await page.getByRole('button', { name: 'Add colour' }).click()
  await palette(page).last().click()
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Colour name').fill('Black')
  await page.getByLabel('Colour name').press('Enter')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  // Start from an empty history: adding and renaming the colour were two steps.
  await page.reload()
  await expect(undo(page)).toBeDisabled()
  await palette(page).filter({ hasText: 'Black' }).click()
  await expect(palette(page).filter({ hasText: 'Black' })).toHaveAttribute('aria-pressed', 'true')
}

/** Exactly `n` undo steps: taken back, then redone. */
async function expectSteps(page: Page, n: number, blackBefore: number) {
  const redo = page.getByRole('button', { name: 'Redo', exact: true })
  for (let i = 0; i < n; i++) await undo(page).click()
  await expect(undo(page)).toBeDisabled()
  expect(await black(page)).toBe(blackBefore)
  for (let i = 0; i < n; i++) await redo.click()
}

test('one finger paints; two fingers pinch without painting; a second finger takes the stroke back', async ({ page }) => {
  const pyodide: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && pyodide.push(r.url()))
  await newDesign(page)
  const cdp = await page.context().newCDPSession(page)

  // --- one finger paints a stroke: one undo step ---------------------------------------------------
  const a = await centre(page, 1, 1)
  const b = await centre(page, 1, 5)
  await touch(cdp, 'touchStart', [{ ...a, id: 1 }])
  for (let i = 1; i <= 4; i++) await touch(cdp, 'touchMove', [{ x: a.x + ((b.x - a.x) * i) / 4, y: a.y, id: 1 }])
  await touch(cdp, 'touchEnd', [])
  await expect.poll(() => black(page)).toBe(5)
  await expectSteps(page, 1, 0)
  expect(await black(page)).toBe(5)

  // --- two fingers pinch: the zoom changes, nothing is painted -------------------------------------------
  const cellBefore = Number(await scroller(page).getAttribute('data-cell'))
  const m = await centre(page, 5, 5)
  await touch(cdp, 'touchStart', [{ x: m.x - 20, y: m.y, id: 1 }])
  await touch(cdp, 'touchStart', [
    { x: m.x - 20, y: m.y, id: 1 },
    { x: m.x + 20, y: m.y, id: 2 },
  ])
  for (let i = 1; i <= 6; i++) {
    await touch(cdp, 'touchMove', [
      { x: m.x - 20 - i * 15, y: m.y, id: 1 },
      { x: m.x + 20 + i * 15, y: m.y, id: 2 },
    ])
  }
  await touch(cdp, 'touchEnd', [{ x: m.x + 110, y: m.y, id: 2 }])
  await touch(cdp, 'touchEnd', [])
  await expect.poll(async () => Number(await scroller(page).getAttribute('data-cell'))).toBeGreaterThan(cellBefore)
  expect(await black(page)).toBe(5)
  await expectSteps(page, 1, 0)

  // Back to where the cells were measured from.
  await page.getByRole('button', { name: 'Fit' }).click()
  await scroller(page).evaluate((el) => el.scrollTo(0, 0))

  // --- a stroke, then a second finger: the stroke is taken back, with no undo step ------------------------
  const c = await centre(page, 3, 0)
  const d = await centre(page, 3, 6)
  await touch(cdp, 'touchStart', [{ ...c, id: 1 }])
  for (let i = 1; i <= 3; i++) await touch(cdp, 'touchMove', [{ x: c.x + ((d.x - c.x) * i) / 3, y: c.y, id: 1 }])
  await expect.poll(() => black(page)).toBe(12) // it painted, as a stroke does
  await touch(cdp, 'touchStart', [
    { ...d, id: 1 },
    { x: d.x, y: d.y + 60, id: 2 },
  ])
  await expect.poll(() => black(page)).toBe(5)
  await touch(cdp, 'touchMove', [
    { x: d.x + 10, y: d.y, id: 1 },
    { x: d.x + 10, y: d.y + 90, id: 2 },
  ])
  await touch(cdp, 'touchEnd', [{ x: d.x + 10, y: d.y, id: 1 }])
  // The finger left behind doesn't start painting again.
  await touch(cdp, 'touchMove', [{ x: d.x - 60, y: d.y + 90, id: 2 }])
  await touch(cdp, 'touchEnd', [])
  expect(await black(page)).toBe(5)
  await expectSteps(page, 1, 0)

  // --- on touch, fill acts when the finger lifts, so a pinch can't fill first ------------------------------
  await page.keyboard.press('f')
  const e = await centre(page, 6, 6)
  await touch(cdp, 'touchStart', [{ ...e, id: 1 }])
  await touch(cdp, 'touchStart', [
    { ...e, id: 1 },
    { x: e.x + 40, y: e.y, id: 2 },
  ])
  await touch(cdp, 'touchEnd', [])
  expect(await black(page)).toBe(5)
  await touch(cdp, 'touchStart', [{ ...e, id: 1 }])
  await touch(cdp, 'touchEnd', [])
  await expect.poll(() => black(page)).toBe(80) // every white cell: they all join up
  await expectSteps(page, 2, 0)

  expect(pyodide).toEqual([])
})

test('two fingers zoom the Work chart, which still follows your place; reopening starts at 1×', async ({ page }) => {
  await newDesign(page)
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(/#\/work\//)
  const chart = page.getByTestId('chart-scroller')
  await expect(chart).toHaveAttribute('data-zoom', '1')
  const row = page.locator('.work__row')
  await expect(row).toHaveText(/^Row 1 of 8/)
  const cdp = await page.context().newCDPSession(page)
  const box = (await chart.boundingBox())!
  const m = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const cell = Number(await chart.getAttribute('data-cell'))

  await touch(cdp, 'touchStart', [{ x: m.x - 30, y: m.y, id: 1 }])
  await touch(cdp, 'touchStart', [
    { x: m.x - 30, y: m.y, id: 1 },
    { x: m.x + 30, y: m.y, id: 2 },
  ])
  for (let i = 1; i <= 8; i++) {
    await touch(cdp, 'touchMove', [
      { x: m.x - 30 - i * 12, y: m.y - i * 8, id: 1 },
      { x: m.x + 30 + i * 12, y: m.y + i * 8, id: 2 },
    ])
  }
  await touch(cdp, 'touchEnd', [])
  await expect.poll(async () => Number(await chart.getAttribute('data-zoom'))).toBeGreaterThan(1.5)
  expect(Number(await chart.getAttribute('data-cell'))).toBeGreaterThan(cell * 1.5)
  // The page itself never zoomed.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)

  // The next row: followed as ever, at the zoom the pinch left. Row 2 is image row 6
  // (worked bottom up); the chart settles where the layout puts it.
  await page.getByRole('button', { name: 'Row complete →' }).click()
  await expect(row).toHaveText(/^Row 2 of 8/)
  const view = await chart.evaluate((el) => ({
    width: el.clientWidth,
    height: el.clientHeight,
    zoom: Number(el.getAttribute('data-zoom')),
    dpr: Math.min(2, devicePixelRatio),
  }))
  const layout = computeLayout({ rows: 8, cols: 10, current: 6, emphasise: true, focus: false, ...view })
  expect(layout.maxScrollY).toBeGreaterThan(0)
  const want = followCurrent(layout, 0)
  await expect.poll(() => chart.evaluate((el) => el.scrollTop)).toBeCloseTo(want, 0)

  // Leave and come back: 1× again.
  await page.getByRole('link', { name: /Library/ }).click()
  await expect(page).toHaveURL(/#\/library$/)
  await expect(page.getByTestId('chart-scroller')).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(/#\/work\//)
  await expect(page.getByTestId('chart-scroller')).toHaveAttribute('data-zoom', '1')
})
