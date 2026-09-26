/**
 * Rotating a quarter turn in real Chromium: a 12 × 5 pattern turned clockwise to 5 × 12
 * with every cell where it belongs (read off the canvas), back anticlockwise, undo and
 * redo, a reload; then with rows done in the Work stage, which asks first, starts
 * progress again, and Undo brings it back. The desktop opens the file it saves. No
 * Pyodide anywhere.
 */
import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { readAlpha } from '../src/storage/alpha.ts'
import { desktopLoad } from './desktop.ts'

const AXIS_LEFT = 34
const AXIS_TOP = 22

const WHITE = '#ffffff'
const BLACK = '#000000'
const RED = '#d93a3a'

const scroller = (page: Page) => page.getByTestId('design-scroller')
const stats = (page: Page) => page.locator('.design__stats')
const palette = (page: Page) => page.getByRole('list', { name: 'Palette' }).getByRole('button')
const clockwise = (page: Page) => page.getByRole('button', { name: 'Rotate ↻ 90°' })
const anticlockwise = (page: Page) => page.getByRole('button', { name: 'Rotate ↺ 90°' })

async function centre(page: Page, r: number, c: number) {
  const box = (await scroller(page).boundingBox())!
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  return { x: box.x + AXIS_LEFT + c * cell + cell / 2, y: box.y + AXIS_TOP + r * cell + cell / 2 }
}

/** The cells the canvas shows, row by row: '.' white, 'B' black, 'R' red. */
async function grid(page: Page, cols: number, rows: number): Promise<string[]> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  const hexes = await page.evaluate(
    ({ cell, rows, cols, left, top }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.design-canvas canvas')!
      const ctx = canvas.getContext('2d')!
      const dpr = canvas.width / canvas.clientWidth
      const out: string[][] = []
      for (let r = 0; r < rows; r++) {
        const row: string[] = []
        for (let c = 0; c < cols; c++) {
          const [R, G, B] = ctx.getImageData(Math.floor((left + c * cell + cell / 2) * dpr), Math.floor((top + r * cell + cell / 2) * dpr), 1, 1).data
          row.push('#' + [R, G, B].map((v) => v!.toString(16).padStart(2, '0')).join(''))
        }
        out.push(row)
      }
      return out
    },
    { cell, rows, cols, left: AXIS_LEFT, top: AXIS_TOP },
  )
  const letter: Record<string, string> = { [WHITE]: '.', [BLACK]: 'B', [RED]: 'R' }
  return hexes.map((row) => row.map((h) => letter[h] ?? '?').join(''))
}

/** A grid of letters turned a quarter, seen with row 0 at the top. */
function turned(g: string[], cw: boolean): string[] {
  const rows = g.length
  const cols = g[0]!.length
  return Array.from({ length: cols }, (_, i) =>
    Array.from({ length: rows }, (_, j) => (cw ? g[rows - 1 - j]![i] : g[j]![cols - 1 - i])).join(''),
  )
}

/** Before: black along the top left, red down the right, nothing symmetric. */
const START = ['BBB.........', 'B...........', '...........R', '...........R', '..........RR']
const CW = turned(START, true)

/** A 12 × 5 white pattern, painted as START. */
async function wide(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Design pattern/ }).click()
  const dialog = page.getByRole('dialog', { name: 'New pattern' })
  await dialog.getByLabel('Name').fill('Wide')
  await dialog.getByLabel('Columns').fill('12')
  await dialog.getByLabel('Rows').fill('5')
  await dialog.getByLabel('Colour').fill(WHITE)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Wide' })).toBeVisible()
  for (const hex of [BLACK, RED]) {
    await page.getByLabel('Colour to add').fill(hex)
    await page.getByRole('button', { name: 'Add colour' }).click()
  }
  await expect(palette(page)).toHaveCount(3)
  await page.keyboard.press('b')
  for (const [letter, hex] of [['B', BLACK], ['R', RED]] as const) {
    await palette(page).filter({ hasText: hex }).click()
    for (let r = 0; r < START.length; r++) {
      for (let c = 0; c < START[r]!.length; c++) {
        if (START[r]![c] !== letter) continue
        const p = await centre(page, r, c)
        await page.mouse.click(p.x, p.y)
      }
    }
  }
  expect(await grid(page, 12, 5)).toEqual(START)
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  return page.url().split('/').at(-1)!
}

test('a quarter turn each way, undo and redo, and a reload', async ({ page }) => {
  const pyodide: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && pyodide.push(r.url()))
  const id = await wide(page)
  await page.getByRole('button', { name: 'Pad to size', expanded: false }).click()
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('12')

  // Clockwise: the top row becomes the right-hand column. No progress: no question.
  await clockwise(page).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(stats(page)).toHaveText(/^5 cols × 12 rows\s+·\s+60 stitches/)
  await expect(page.locator('.design__message')).toHaveText('Rotated 90° clockwise: now 5 × 12.')
  await expect(page.getByRole('img', { name: 'Pattern, 5 by 12' })).toBeVisible()
  expect(CW[0]).toBe('...BB') // the top-left black, now top right
  expect(await grid(page, 5, 12)).toEqual(CW)
  // The pad-to-size fields follow the new shape.
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('5')
  await expect(page.getByLabel('Height', { exact: true })).toHaveValue('12')

  // Anticlockwise, back where it started.
  await anticlockwise(page).click()
  await expect(stats(page)).toHaveText(/^12 cols × 5 rows/)
  expect(await grid(page, 12, 5)).toEqual(START)
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('12')

  // Anticlockwise from the start is the other way round.
  await anticlockwise(page).click()
  expect(await grid(page, 5, 12)).toEqual(turned(START, false))

  // One undo step a click.
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  const redo = page.getByRole('button', { name: 'Redo', exact: true })
  await undo.click()
  expect(await grid(page, 12, 5)).toEqual(START)
  await undo.click()
  expect(await grid(page, 5, 12)).toEqual(CW)
  await undo.click()
  expect(await grid(page, 12, 5)).toEqual(START)
  await redo.click()
  expect(await grid(page, 5, 12)).toEqual(CW)

  // Saved, and still turned after a reload.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`#/design/${id}$`))
  await expect(stats(page)).toHaveText(/^5 cols × 12 rows/)
  expect(await grid(page, 5, 12)).toEqual(CW)

  expect(pyodide).toEqual([])
})

test('with rows done in Work: asks first, starts progress again, and Undo brings it back', async ({ page }, testInfo) => {
  const id = await wide(page)

  // --- two rows done in the Work stage ----------------------------------------------------------------
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(new RegExp(`#/work/${id}$`))
  await expect(page.locator('.work__row')).toHaveText(/^Row 1 of 5/)
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight')
  await expect(page.locator('.work__row')).toHaveText(/^Row 3 of 5/)
  const toDesign = async () => {
    await page.getByText('Options').click()
    await page.getByRole('button', { name: 'Edit pattern…' }).click()
    await expect(page).toHaveURL(new RegExp(`#/design/${id}$`))
  }
  await toDesign()

  // --- the question, and Cancel changing nothing -------------------------------------------------------
  await clockwise(page).click()
  const ask = page.getByRole('alertdialog', { name: 'Start progress again?' })
  await expect(ask).toContainText(
    'Rotating gives every row a new place, so your progress in the Work stage (2 rows done) starts again from the first row.',
  )
  await expect(ask).toContainText('Undo brings it all back.')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(stats(page)).toHaveText(/^12 cols × 5 rows/)
  expect(await grid(page, 12, 5)).toEqual(START)

  // --- confirmed, then undone: the progress is back --------------------------------------------------------
  await clockwise(page).click()
  await ask.getByRole('button', { name: 'Rotate' }).click()
  await expect(stats(page)).toHaveText(/^5 cols × 12 rows/)
  expect(await grid(page, 5, 12)).toEqual(CW)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(stats(page)).toHaveText(/^12 cols × 5 rows/)
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(new RegExp(`#/work/${id}$`))
  await expect(page.locator('.work__row')).toHaveText(/^Row 3 of 5/)

  // --- confirmed and kept: Work starts again, on a sound first row -------------------------------------------
  await toDesign()
  await clockwise(page).click()
  await page.getByRole('alertdialog', { name: 'Start progress again?' }).getByRole('button', { name: 'Rotate' }).click()
  await expect(stats(page)).toHaveText(/^5 cols × 12 rows/)
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(new RegExp(`#/work/${id}$`))
  await expect(page.locator('.work__row')).toHaveText(/^Row 1 of 12/)
  await expect(page.getByRole('button', { name: 'Row complete →' })).toBeEnabled()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.work__row')).toHaveText(/^Row 2 of 12/)
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // --- the desktop opens the .alpha it exports ------------------------------------------------------------------
  await page.goto('/#/library')
  const card = page.getByRole('listitem').filter({ hasText: 'Wide' })
  const [file] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Export “Wide”' }).click()])
  const alpha = testInfo.outputPath(file.suggestedFilename())
  await file.saveAs(alpha)
  const web = readAlpha(new Uint8Array(readFileSync(alpha))).project
  const desktop = desktopLoad(alpha)
  expect([desktop.cols, desktop.rows, desktop.stage]).toEqual([5, 12, 'work'])
  expect(desktop.cells).toEqual([...web.pattern.cells])
  const letters = ['.', 'B', 'R']
  expect(Array.from({ length: 12 }, (_, r) => desktop.cells.slice(r * 5, r * 5 + 5).map((v) => letters[v]).join(''))).toEqual(CW)
  expect(desktop.row_ids).toEqual(web.pattern.row_ids)
  expect(new Set(desktop.row_ids).size).toBe(12)
  expect(desktop.completed).toBe(1)
  expect(desktop.completed_row_ids.every((r) => desktop.row_ids.includes(r))).toBe(true)
  expect(desktop.row_ids).toContain(desktop.current_row_id)
  expect(desktop.palette.map(([hex, , count]) => [hex, count])).toEqual([
    [WHITE, 52],
    [BLACK, 4],
    [RED, 4],
  ])
})
