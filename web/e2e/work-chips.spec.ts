/**
 * The current row's chips on a phone, and taps on the chart, in real Chromium:
 *
 * - the list of chips follows your place: each segment you finish brings the next to the
 *   top of the list, and a new row starts at the top again, even after a scroll by hand;
 * - each chip's tick marks it done in one tap;
 * - a tap on a stitch of the current row marks it and every stitch before it done, while
 *   a tap anywhere else, a drag, or a touch that stops the chart moving does nothing.
 */
import { writeFileSync } from 'node:fs'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { encodeRow } from '../src/logic/readout.ts'
import { emptyProgress, type Pattern, type Project } from '../src/model/types.ts'
import { AXIS_LEFT, AXIS_TOP } from '../src/render/layout.ts'
import { writeAlpha } from '../src/storage/alpha.ts'

test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true })

const ROWS = 6
const COLS = 24

/** 24 × 6, two colours in pairs, shifted a stitch each row: 12 or 13 segments a row,
 *  more chips than fit beside the chart. Row 1 (the bottom) reads left to right. */
function busyProject(): Project {
  const cells = new Uint16Array(ROWS * COLS)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells[r * COLS + c] = Math.floor((c + r) / 2) % 2
  const pattern: Pattern = {
    id: 'e2e-busy',
    name: 'Busy rows',
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    rows: ROWS,
    cols: COLS,
    row_ids: Array.from({ length: ROWS }, (_, i) => `row-${i}`),
    cells,
    palette: ['#f5f5f0', '#111111'].map((hex, i) => ({
      id: `c${i}`,
      hex,
      name: ['White', 'Black'][i]!,
      dmc: null,
      count: cells.filter((v) => v === i).length,
    })),
    start_direction: 'LTR',
    alternate_direction: true,
    bottom_up: true,
    craft: 'tapestry',
  }
  return { pattern, progress: emptyProgress(), stage: 'work' }
}

const project = busyProject()
const p = project.pattern
/** Image row of working row `n` (1-based): bottom-up. */
const imageRow = (n: number) => ROWS - n

const rowLabel = (page: Page) => page.locator('.work__row')
const stitchCount = (page: Page) => page.locator('.work__stitches')
const list = (page: Page) => page.getByRole('list', { name: 'Colours in this row' })
const chips = (page: Page) => list(page).getByRole('listitem')
const tick = (page: Page, i: number) => chips(page).nth(i).locator('.chip__tick')
const box = (page: Page) => page.getByRole('region', { name: 'This row' })
const scroller = (page: Page) => page.getByTestId('chart-scroller')

async function open(page: Page, file: string) {
  writeFileSync(file, writeAlpha(project).bytes)
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(file)
  await page.getByRole('listitem').filter({ hasText: p.name }).getByRole('link').click()
  await expect(rowLabel(page)).toHaveText(`Row 1 of ${ROWS} →`)
}

/** `el`'s scrollTop once it has stopped moving (ten still frames). */
function settled(el: Locator) {
  return el.evaluate(
    (e) =>
      new Promise<{ top: number; max: number }>((resolve) => {
        let last = -1
        let still = 0
        const frame = () => {
          still = e.scrollTop === last ? still + 1 : 0
          last = e.scrollTop
          if (still < 10) return void requestAnimationFrame(frame)
          resolve({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight })
        }
        requestAnimationFrame(frame)
      }),
  )
}

/** Where the current chip is in the list's view: its top and bottom, from the top of the view. */
async function currentInView(page: Page) {
  return box(page).evaluate((b) => {
    const c = b.querySelector('.chip--current')!.getBoundingClientRect()
    const v = b.getBoundingClientRect()
    return { top: c.top - v.top, bottom: c.bottom - v.top, height: b.clientHeight }
  })
}

test('the chips follow your place, and a new row starts at the top of the list', async ({ page }, testInfo) => {
  await open(page, testInfo.outputPath('busy.alpha'))
  const runs = encodeRow(p, imageRow(1))
  await expect(chips(page)).toHaveCount(runs.length)
  // More chips than fit: the list scrolls.
  let s = await settled(box(page))
  expect(s.max).toBeGreaterThan(100)
  expect(s.top).toBe(0)

  // Each tick brings the next segment to the top of the list, a little of the one before
  // it showing, until the list can't scroll further, where it's still in full view.
  const tops: number[] = []
  for (let i = 0; i < runs.length - 1; i++) {
    await tick(page, i).click()
    await expect(chips(page).nth(i + 1)).toHaveClass(/chip--current/)
    s = await settled(box(page))
    tops.push(s.top)
    const at = await currentInView(page)
    expect(at.top, `segment ${i + 1}`).toBeGreaterThanOrEqual(0)
    expect(at.bottom, `segment ${i + 1}`).toBeLessThanOrEqual(at.height + 0.5)
    if (s.top < s.max - 0.5) expect(at.top, `segment ${i + 1} at the top`).toBeLessThanOrEqual(30)
  }
  expect(tops[tops.length - 1]).toBe(s.max) // it got to the end of the list
  expect(tops.every((t, i) => i === 0 || t >= tops[i - 1]!)).toBe(true) // only ever down

  // The last tick finishes the row: row 2, and the list back at the top.
  await tick(page, runs.length - 1).click()
  await expect(rowLabel(page)).toHaveText(`Row 2 of ${ROWS} ←`)
  expect((await settled(box(page))).top).toBe(0)

  // Scrolled down by hand, then the row finished with Row complete: back to the top.
  await box(page).evaluate((b) => b.scrollTo({ top: b.scrollHeight }))
  expect((await settled(box(page))).top).toBeGreaterThan(100)
  await page.getByRole('button', { name: 'Row complete →' }).click()
  await expect(rowLabel(page)).toHaveText(`Row 3 of ${ROWS} →`)
  expect((await settled(box(page))).top).toBe(0)
  await expect(chips(page).first()).toBeInViewport()

  // A ticked chip unticks: your place goes back to its start.
  await tick(page, 0).click()
  await tick(page, 1).click()
  await expect(tick(page, 1)).toHaveAttribute('aria-pressed', 'true')
  await tick(page, 1).click()
  await expect(chips(page).nth(1)).toHaveClass(/chip--current/)
  await expect(tick(page, 1)).toHaveAttribute('aria-pressed', 'false')
})

test('Record progress: one joined count without arrows of its own, and two buttons across the width', async ({ page }, testInfo) => {
  // The Import screen's stylesheet loaded first, as after a real import: its colour
  // stepper must not restyle this one.
  await page.goto('/#/import')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await open(page, testInfo.outputPath('busy.alpha'))
  await chips(page).nth(0).locator('.chip__open').click()
  const dialog = page.getByRole('dialog', { name: 'Record progress' })
  const look = await dialog.evaluate((d) => {
    const css = (el: Element) => getComputedStyle(el)
    const count = d.querySelector('.segment__count')!
    const buttons = [...count.querySelectorAll('button')]
    const input = d.querySelector('input')!
    const of = count.querySelector('.segment__value span')!
    const [n, o] = [input, of].map((e) => e.getBoundingClientRect())
    const [cancel, save] = [...d.querySelectorAll('.dialog__buttons button')].map((b) => b.getBoundingClientRect())
    const body = d.querySelector('.segment__complete')!.getBoundingClientRect()
    return {
      countRadius: css(count).borderTopLeftRadius,
      buttonRadii: buttons.map((b) => css(b).borderTopLeftRadius),
      buttonBorders: buttons.map((b) => css(b).borderTopWidth),
      appearance: css(d.querySelector('input')!).appearance,
      widths: [cancel!.width, save!.width],
      span: [cancel!.left - body.left, body.right - save!.right],
      // "of N": the number's size, on its line, just after it.
      sizes: [css(input).fontSize, css(of).fontSize],
      gap: o!.left - n!.right,
      middles: [n!.top + n!.height / 2, o!.top + o!.height / 2],
    }
  })
  expect(look.sizes[0]).toBe(look.sizes[1])
  expect(look.gap).toBeGreaterThanOrEqual(0)
  expect(look.gap).toBeLessThan(12)
  expect(Math.abs(look.middles[0]! - look.middles[1]!)).toBeLessThan(2)
  // A click on "of N" goes to the number.
  await dialog.getByText(/^of \d+$/).click()
  await expect(dialog.getByLabel('Stitches done')).toBeFocused()
  expect(look.countRadius).not.toBe('999px')
  expect(look.buttonRadii).toEqual(['0px', '0px'])
  expect(look.buttonBorders).toEqual(['0px', '0px'])
  expect(look.appearance).toBe('textfield')
  expect(Math.abs(look.widths[0]! - look.widths[1]!)).toBeLessThan(1)
  expect(look.span.map((x) => Math.abs(x) < 1)).toEqual([true, true])
})

test('a tap on a stitch of the current row marks it and the stitches before it done', async ({ page }, testInfo) => {
  await open(page, testInfo.outputPath('busy.alpha'))
  // Every row the same height, so a stitch is found from the cell size alone.
  await page.getByText('Options', { exact: true }).click()
  await page.getByLabel('Enlarge the current row').uncheck()
  await page.keyboard.press('Escape')
  const total = ROWS * COLS
  await expect(stitchCount(page)).toHaveText(`0 / ${total} stitches`)

  /** The middle of a stitch on screen. */
  const stitch = async (row: number, col: number) => {
    const sc = scroller(page)
    const cell = Number(await sc.getAttribute('data-cell'))
    const { left, top, sx, sy } = await sc.evaluate((e) => {
      const r = e.getBoundingClientRect()
      return { left: r.left + e.clientLeft, top: r.top + e.clientTop, sx: e.scrollLeft, sy: e.scrollTop }
    })
    return { x: left + AXIS_LEFT + (col + 0.5) * cell - sx, y: top + AXIS_TOP + (row + 0.5) * cell - sy }
  }
  const tapAt = async (row: number, col: number) => {
    const { x, y } = await stitch(row, col)
    await page.touchscreen.tap(x, y)
  }
  const still = () => settled(scroller(page))

  // Row 1 runs left to right: column 5 is its sixth stitch.
  await still()
  await tapAt(imageRow(1), 5)
  await expect(stitchCount(page)).toHaveText(`6 / ${total} stitches`)
  // Partway through a segment of two: the chip says so.
  await expect(list(page).locator('.chip--current')).toContainText('1/2')

  // A tap on another row does nothing, nor does one on the axis numbers.
  await still()
  await tapAt(imageRow(2), 10)
  await tapAt(imageRow(4), 0)
  const axis = await stitch(imageRow(1), 0)
  await page.touchscreen.tap(axis.x - AXIS_LEFT / 2, axis.y)
  await page.waitForTimeout(400)
  await expect(stitchCount(page)).toHaveText(`6 / ${total} stitches`)
  await expect(rowLabel(page)).toHaveText(`Row 1 of ${ROWS} →`)

  // A tap further back in the row moves your place back to it.
  await tapAt(imageRow(1), 2)
  await expect(stitchCount(page)).toHaveText(`3 / ${total} stitches`)

  // A drag is not a tap.
  const from = await stitch(imageRow(1), 10)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 30, from.y, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await expect(stitchCount(page)).toHaveText(`3 / ${total} stitches`)

  // A touch while the chart is moving, or just after, stops it rather than choosing: the
  // same tap a moment later counts.
  await scroller(page).evaluate((e) => e.dispatchEvent(new Event('scroll')))
  await tapAt(imageRow(1), 10)
  await page.waitForTimeout(400)
  await expect(stitchCount(page)).toHaveText(`3 / ${total} stitches`)
  await tapAt(imageRow(1), 10)
  await expect(stitchCount(page)).toHaveText(`11 / ${total} stitches`)

  // The row's last stitch finishes it. Row 2 runs right to left: its first stitch is the
  // rightmost column.
  await still()
  await tapAt(imageRow(1), COLS - 1)
  await expect(rowLabel(page)).toHaveText(`Row 2 of ${ROWS} ←`)
  await expect(stitchCount(page)).toHaveText(`${COLS} / ${total} stitches`)
  await still()
  await tapAt(imageRow(2), COLS - 1)
  await expect(stitchCount(page)).toHaveText(`${COLS + 1} / ${total} stitches`)
  await still()
  await tapAt(imageRow(2), COLS - 4)
  await expect(stitchCount(page)).toHaveText(`${COLS + 4} / ${total} stitches`)
})
