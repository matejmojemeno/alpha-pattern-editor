/**
 * The Design stage's Select tool in real Chromium: a motif selected by dragging, copied
 * and pasted with the keyboard, dragged into place (past an edge and back, whole), cut,
 * mirrored and turned from the Selection buttons, undone step by step, saved through a
 * reload, and pasted into a second pattern that lacks one of its colours.
 */
import { expect, test, type Page } from '@playwright/test'

import { addColour, palette } from './colours.ts'

const AXIS_LEFT = 34
const AXIS_TOP = 22
const COLS = 8
const ROWS = 6

const WHITE = '#ffffff'
const BLACK = '#000000'
const RED = '#d93a3a'

const scroller = (page: Page) => page.getByTestId('design-scroller')
const selectionButton = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Selection' }).getByRole('button', { name, exact: true })

async function centre(page: Page, r: number, c: number) {
  const box = (await scroller(page).boundingBox())!
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  return { x: box.x + AXIS_LEFT + c * cell + cell / 2, y: box.y + AXIS_TOP + r * cell + cell / 2 }
}

/** The cells as the canvas shows them, row by row: '.' white, 'B' black, 'R' red. */
async function grid(page: Page): Promise<string[]> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  const rows = await page.evaluate(
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
    { cell, rows: ROWS, cols: COLS, left: AXIS_LEFT, top: AXIS_TOP },
  )
  const letter: Record<string, string> = { [WHITE]: '.', [BLACK]: 'B', [RED]: 'R' }
  return rows.map((row) => row.map((hex) => letter[hex] ?? '?').join(''))
}

async function dragThrough(page: Page, cells: [number, number][]) {
  const first = await centre(page, ...cells[0]!)
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const [r, c] of cells.slice(1)) {
    const p = await centre(page, r, c)
    await page.mouse.move(p.x, p.y, { steps: 3 })
  }
  await page.mouse.up()
}

/** A blank pattern, from the landing page, or (`inApp`) from the Library without
 *  loading the page again, as a person would. */
async function newPattern(page: Page, name: string, inApp = false) {
  if (inApp) await page.getByRole('link', { name: /Library/ }).click()
  else await page.goto('/')
  await page.getByRole('button', { name: /Design pattern/ }).click()
  const dialog = page.getByRole('dialog', { name: 'New pattern' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Columns').fill(String(COLS))
  await dialog.getByLabel('Rows').fill(String(ROWS))
  await dialog.getByLabel('Colour').fill(WHITE)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

const saved = (page: Page) => expect(page.locator('.work__saved')).toHaveText('Saved')

test('select, copy, paste, move, cut, turn, undo, reload, and paste into another pattern', async ({ page }) => {
  await newPattern(page, 'Motifs')
  await addColour(page, BLACK, 'Black')
  await addColour(page, RED, 'Red')

  // A motif to work with: black across the top of a 2 × 3, red under it.
  await palette(page).filter({ hasText: /#000000/ }).click()
  await dragThrough(page, [[0, 0], [0, 2]])
  await palette(page).filter({ hasText: /#d93a3a/ }).click()
  await dragThrough(page, [[1, 0], [1, 1]])
  const motif = ['BBB.....', 'RR......', '........', '........', '........', '........']
  expect(await grid(page)).toEqual(motif)

  // --- Select (S), drag out a selection: nothing changes, the buttons wake up ------------------
  await page.keyboard.press('s')
  await expect(page.getByRole('group', { name: 'Tool' }).getByRole('button', { name: /^Select\s*S$/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(selectionButton(page, 'Copy')).toBeDisabled()
  await dragThrough(page, [[1, 2], [0, 0]])
  await expect(page.locator('.design__message')).toHaveText(/Selected 3 × 2 cells/)
  await expect(page.getByRole('img', { name: /3 by 2 selected/ })).toBeVisible()
  await expect(selectionButton(page, 'Copy')).toBeEnabled()
  expect(await grid(page)).toEqual(motif)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled() // the painting
  const undoSteps = async () => {
    let n = 0
    while (await page.getByRole('button', { name: 'Undo' }).isEnabled()) {
      await page.getByRole('button', { name: 'Undo' }).click()
      n++
    }
    return n
  }

  // --- copy (keyboard), click elsewhere for a one-cell selection, paste there -------------------
  await page.keyboard.press('ControlOrMeta+c')
  await expect(page.locator('.design__message')).toHaveText('Copied 3 × 2 cells.')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('img', { name: /selected/ })).toHaveCount(0)
  await dragThrough(page, [[3, 4]])
  await page.keyboard.press('ControlOrMeta+v')
  const pasted = ['BBB.....', 'RR......', '........', '....BBB.', '....RR..', '........']
  expect(await grid(page)).toEqual(pasted)

  // --- drag the pasted block: past the right edge, and back, whole ------------------------------
  await dragThrough(page, [[3, 4], [3, 6], [3, 7]])
  expect(await grid(page)).toEqual(['BBB.....', 'RR......', '........', '.......B', '.......R', '........'])
  await dragThrough(page, [[3, 7], [3, 5], [4, 4]])
  const moved = ['BBB.....', 'RR......', '........', '........', '....BBB.', '....RR..']
  expect(await grid(page)).toEqual(moved)

  // --- arrow keys nudge it, one step each; Mirror and Rotate from the buttons -------------------
  await page.keyboard.press('ArrowLeft')
  expect(await grid(page)).toEqual(['BBB.....', 'RR......', '........', '........', '...BBB..', '...RR...'])
  await selectionButton(page, 'Mirror left to right').click()
  expect(await grid(page)).toEqual(['BBB.....', 'RR......', '........', '........', '...BBB..', '....RR..'])
  await selectionButton(page, 'Rotate clockwise').click()
  // 3 wide × 2 high turned clockwise about its centre: 2 wide × 3 high, one row higher.
  expect(await grid(page)).toEqual(['BBB.....', 'RR......', '........', '....B...', '...RB...', '...RB...'])

  // --- undo walks back one step at a time: rotate, mirror, nudge, the two drags, the paste ------
  for (const expected of [
    ['BBB.....', 'RR......', '........', '........', '...BBB..', '....RR..'],
    ['BBB.....', 'RR......', '........', '........', '...BBB..', '...RR...'],
    moved,
    ['BBB.....', 'RR......', '........', '.......B', '.......R', '........'],
    pasted,
    motif,
  ]) {
    await page.keyboard.press('ControlOrMeta+z')
    expect(await grid(page)).toEqual(expected)
  }
  for (let i = 0; i < 6; i++) await page.keyboard.press('ControlOrMeta+Shift+z')
  expect(await grid(page)).toEqual(['BBB.....', 'RR......', '........', '....B...', '...RB...', '...RB...'])

  // --- cut (button): the background is left, and Paste brings it back ---------------------------
  await page.keyboard.press('Escape')
  await dragThrough(page, [[0, 0], [1, 2]])
  await selectionButton(page, 'Cut').click()
  await expect(page.locator('.design__message')).toHaveText('Cut 3 × 2 cells, leaving “Background”.')
  const cut = ['........', '........', '........', '....B...', '...RB...', '...RB...']
  expect(await grid(page)).toEqual(cut)
  // Choosing another tool drops the selection.
  await page.keyboard.press('b')
  await expect(page.getByRole('group', { name: 'Selection' })).toHaveCount(0)

  // --- saved: a reload shows the same ---------------------------------------------------------------
  await saved(page)
  await page.reload()
  expect(await grid(page)).toEqual(cut)

  // --- the clipboard lasts the tab, into another pattern without red --------------------------------
  // (A reload empties it, so copy again first. Leaving through "← Library" doesn't.)
  await page.keyboard.press('s')
  await dragThrough(page, [[3, 3], [5, 4]])
  await page.keyboard.press('ControlOrMeta+c')
  await newPattern(page, 'Plain', true)
  await addColour(page, BLACK, 'Ink')
  await expect(palette(page)).toHaveCount(2)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator('.design__message')).toHaveText(/Pasted 2 × 3 cells, adding 1 colour/)
  await expect(palette(page)).toHaveCount(3)
  // Black is found by its hex (named "Ink" here); red is added under its own name.
  await expect(palette(page).nth(1)).toHaveAccessibleName('Ink, #000000, 3 cells')
  await expect(palette(page).nth(2)).toHaveAccessibleName('Red, #d93a3a, 2 cells')
  expect(await grid(page)).toEqual(['........', '........', '........', '....B...', '...RB...', '...RB...'])
  // The paste is one undo step, colour and cells together (the Ink added before it stays).
  expect(await undoSteps()).toBe(2)
})
