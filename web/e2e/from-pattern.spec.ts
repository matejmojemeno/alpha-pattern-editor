/**
 * "From another pattern" in real Chromium: a shape picked in one Library pattern and
 * brought into another (centred, floating, its colours added, one undo step, and kept on
 * the clipboard), a rectangle and the whole pattern picked, and a chart imported from the
 * panel coming back to the pattern being designed, open in the panel.
 */
import { resolve } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { addColour, palette } from './colours.ts'
import { ROOT } from './desktop.ts'
import { DETECT_TIMEOUT } from './importing.ts'

const AXIS_LEFT = 34
const AXIS_TOP = 22
const COLS = 8
const ROWS = 6

const WHITE = '#ffffff'
const BLACK = '#000000'
const RED = '#d93a3a'

const main = (page: Page) => page.locator('.design__canvas').getByTestId('design-scroller')
const source = (page: Page) => page.locator('.from-pattern__chart').getByTestId('design-scroller')
const panel = (page: Page) => page.getByRole('complementary', { name: 'From another pattern' })
const message = (page: Page) => page.locator('.design__message')

async function centre(scroller: Locator, r: number, c: number) {
  const box = (await scroller.boundingBox())!
  const cell = Number(await scroller.getAttribute('data-cell'))
  return { x: box.x + AXIS_LEFT + c * cell + cell / 2, y: box.y + AXIS_TOP + r * cell + cell / 2 }
}

async function dragThrough(page: Page, scroller: Locator, cells: [number, number][]) {
  const first = await centre(scroller, ...cells[0]!)
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const [r, c] of cells.slice(1)) {
    const p = await centre(scroller, r, c)
    await page.mouse.move(p.x, p.y, { steps: 3 })
  }
  await page.mouse.up()
}

/** The main chart's cells as drawn, row by row: '.' white, 'B' black, 'R' red. */
async function grid(page: Page): Promise<string[]> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const cell = Number(await main(page).getAttribute('data-cell'))
  const rows = await page.evaluate(
    ({ cell, rows, cols, left, top }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.design__canvas .design-canvas canvas')!
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
    { cell, rows: ROWS, cols: COLS, left: AXIS_LEFT, top: AXIS_TOP },
  )
  const letter: Record<string, string> = { [WHITE]: '.', [BLACK]: 'B', [RED]: 'R' }
  return rows.map((row) => row.map((hex) => letter[hex] ?? '?').join(''))
}

/** A blank white 8 × 6 pattern, from the landing page or (`inApp`) from the Library. */
async function newPattern(page: Page, name: string, inApp = false) {
  if (inApp) await page.getByRole('link', { name: /Library/ }).click()
  else await page.goto('/')
  await page.getByRole('button', { name: 'Design from scratch' }).click()
  const dialog = page.getByRole('dialog', { name: 'New pattern' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Columns').fill(String(COLS))
  await dialog.getByLabel('Rows').fill(String(ROWS))
  await dialog.getByLabel('Colour').fill(WHITE)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

const saved = (page: Page) => expect(page.locator('.work__saved')).toHaveText('Saved')

test('a shape from another pattern: centred, floating, its colours added, one undo step', async ({ page }) => {
  // --- the cat: a black ring with a red eye in it, and a lone black dot in the corner -------
  await newPattern(page, 'Cat')
  await addColour(page, BLACK, 'Black')
  await addColour(page, RED, 'Red')
  await palette(page).filter({ hasText: /#000000/ }).click()
  await dragThrough(page, main(page), [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]])
  await dragThrough(page, main(page), [[5, 7]])
  await palette(page).filter({ hasText: /#d93a3a/ }).click()
  await dragThrough(page, main(page), [[1, 1]])
  expect(await grid(page)).toEqual(['BBB.....', 'BRB.....', 'BBB.....', '........', '........', '.......B'])
  await saved(page)

  // --- the sweater front: white only. The panel offers the cat, not itself -------------------
  await newPattern(page, 'Front', true)
  await page.getByRole('button', { name: 'From another pattern' }).click()
  await expect(panel(page)).toBeVisible()
  const list = panel(page).getByRole('list', { name: 'Patterns in your Library' })
  await expect(list.getByRole('button', { name: /Cat/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /Front/ })).toHaveCount(0)
  await list.getByRole('button', { name: /Cat/ }).click()
  await expect(panel(page).getByRole('img', { name: 'Cat, 8 by 6' })).toBeVisible()
  const use = panel(page).getByRole('button', { name: 'Use in pattern' })
  await expect(use).toBeDisabled()

  // The background picks nothing; a click on the ring picks it and the eye inside it.
  await dragThrough(page, source(page), [[4, 4]])
  await expect(panel(page).getByRole('status')).toHaveText('That’s the background. Click a shape to pick it.')
  await dragThrough(page, source(page), [[0, 1]])
  await expect(panel(page).getByRole('status')).toHaveText('Picked a shape, 3 × 3.')
  await use.click()

  // Centred: (6 - 3) / 2 → row 1, (8 - 3) / 2 → column 2. Black and red are added.
  await expect(message(page)).toHaveText('Brought in 3 × 3 cells from “Cat”, adding 2 colours. Drag them into place, then click outside.')
  const centred = ['........', '..BBB...', '..BRB...', '..BBB...', '........', '........']
  expect(await grid(page)).toEqual(centred)
  await expect(page.getByRole('group', { name: 'Tool' }).getByRole('button', { name: /^Select\s*S$/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.design__stats')).toContainText('3 colours')

  // Floating: it drags, whole.
  await dragThrough(page, main(page), [[2, 3], [3, 5]])
  expect(await grid(page)).toEqual(['........', '........', '....BBB.', '....BRB.', '....BBB.', '........'])

  // It's on the clipboard too: Paste brings another, where the selection is.
  await page.keyboard.press('Escape')
  await dragThrough(page, main(page), [[0, 0]])
  await page.keyboard.press('ControlOrMeta+v')
  expect(await grid(page)).toEqual(['BBB.....', 'BRB.....', 'BBB.BBB.', '....BRB.', '....BBB.', '........'])

  // Undo: the paste, then the drag and the bringing in, back to white, the colours gone.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  expect(await grid(page)).toEqual(['........', '........', '........', '........', '........', '........'])
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await expect(page.locator('.design__stats')).toContainText(/ 1 colour$/)

  // --- a rectangle, and all of it ------------------------------------------------------------
  await panel(page).getByRole('button', { name: 'Rectangle' }).click()
  await dragThrough(page, source(page), [[0, 0], [1, 1]])
  await expect(panel(page).getByRole('status')).toHaveText('Picked 2 × 2 cells.')
  await use.click()
  expect(await grid(page)).toEqual(['........', '........', '...BB...', '...BR...', '........', '........'])
  await panel(page).getByRole('button', { name: 'All', exact: true }).click()
  await expect(panel(page).getByRole('status')).toHaveText('Picked all of it, 8 × 6.')
  await use.click()
  expect(await grid(page)).toEqual(['BBB.....', 'BRB.....', 'BBB.....', '........', '........', '.......B'])

  // The cat itself was never changed.
  await page.keyboard.press('Escape')
  await saved(page)
  await page.getByRole('link', { name: /Library/ }).click()
  await page.getByRole('link', { name: 'Open “Cat”' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Cat' })).toBeVisible()
  expect(await grid(page)).toEqual(['BBB.....', 'BRB.....', 'BBB.....', '........', '........', '.......B'])

  // --- the panel remembers the cat in this tab, but not in the cat itself ----------------------
  await page.getByRole('button', { name: 'From another pattern' }).click()
  await expect(panel(page).getByRole('list', { name: 'Patterns in your Library' }).getByRole('button', { name: /Front/ })).toBeVisible()
  await page.getByRole('link', { name: /Library/ }).click()
  await page.getByRole('link', { name: 'Open “Front”' }).click()
  await page.getByRole('button', { name: 'From another pattern' }).click()
  await expect(panel(page).getByRole('img', { name: 'Cat, 8 by 6' })).toBeVisible()
  await panel(page).getByRole('button', { name: 'Close' }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Palette' })).toBeVisible()
})

test('a chart imported from the panel comes back to the pattern, open in the panel', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  await newPattern(page, 'Back panel')
  await page.getByRole('button', { name: 'From another pattern' }).click()
  await panel(page).getByRole('link', { name: 'Import a chart' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Import a chart' })).toBeVisible()
  // The top bar leads back to the pattern, not home.
  await expect(page.getByRole('link', { name: 'Design', exact: true })).toBeVisible()

  await page.getByLabel('Choose an image').setInputFiles(resolve(ROOT, 'test_images', 'dachshund.png'))
  await expect(page.locator('.confirm__stats')).toBeVisible({ timeout: DETECT_TIMEOUT })
  await page.getByRole('textbox', { name: 'Pattern name' }).fill('Dachshund')
  await page.getByRole('button', { name: 'Save & edit pattern' }).click()

  // Back in the pattern being designed, with the dachshund open in the panel.
  await expect(page.getByRole('heading', { level: 1, name: 'Back panel' })).toBeVisible()
  await expect(panel(page).getByRole('img', { name: /^Dachshund, \d+ by \d+$/ })).toBeVisible()
  // The address is the plain one again, so a reload doesn't open the panel.
  await expect(page).toHaveURL(/#\/design\/[^?]+$/)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Back panel' })).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
})
