/**
 * The Design stage in real Chromium: a blank pattern designed with every tool (by mouse
 * and by shortcut), undo and redo, colours added, recoloured and deleted, all saved
 * without a Save button and still there after a reload; then Work and back with the
 * progress kept; and the file it writes opens in the desktop app. It never loads Pyodide.
 */
import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { readAlpha } from '../src/storage/alpha.ts'
import { desktopLoad } from './desktop.ts'

const AXIS_LEFT = 34
const AXIS_TOP = 22
const COLS = 12
const ROWS = 10

const WHITE = '#ffffff'
const BLACK = '#000000'
const RED = '#d93a3a'

const scroller = (page: Page) => page.getByTestId('design-scroller')
const palette = (page: Page) => page.getByRole('list', { name: 'Palette' }).getByRole('button')
/** A tool button; its name is the label and the shortcut key ("Fill row H"). */
const tool = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Tool' }).getByRole('button', { name: new RegExp(`^${name}\\s*[A-Z]$`) })

/** The centre of cell (r, c) on screen. */
async function centre(page: Page, r: number, c: number) {
  const box = (await scroller(page).boundingBox())!
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  return { x: box.x + AXIS_LEFT + c * cell + cell / 2, y: box.y + AXIS_TOP + r * cell + cell / 2 }
}

/** The colour the canvas shows at the centre of each cell, as '#rrggbb', row by row. */
async function shown(page: Page): Promise<string[][]> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  return page.evaluate(
    ({ cell, rows, cols, left, top }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.design-canvas canvas')!
      const ctx = canvas.getContext('2d')!
      const dpr = canvas.width / canvas.clientWidth
      const out: string[][] = []
      for (let r = 0; r < rows; r++) {
        const row: string[] = []
        for (let c = 0; c < cols; c++) {
          const x = Math.floor((left + c * cell + cell / 2) * dpr)
          const y = Math.floor((top + r * cell + cell / 2) * dpr)
          const [R, G, B] = ctx.getImageData(x, y, 1, 1).data
          row.push('#' + [R, G, B].map((v) => v!.toString(16).padStart(2, '0')).join(''))
        }
        out.push(row)
      }
      return out
    },
    { cell, rows: ROWS, cols: COLS, left: AXIS_LEFT, top: AXIS_TOP },
  )
}

/** The cells as letters, for readable expectations: W white, B black, R red. */
async function grid(page: Page): Promise<string[]> {
  const letter: Record<string, string> = { [WHITE]: '.', [BLACK]: 'B', [RED]: 'R' }
  return (await shown(page)).map((row) => row.map((hex) => letter[hex] ?? '?').join(''))
}

const blank = Array.from({ length: ROWS }, () => '.'.repeat(COLS))

async function press(page: Page, r: number, c: number) {
  const p = await centre(page, r, c)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
}

async function dragThrough(page: Page, cells: [number, number][]) {
  await press(page, ...cells[0]!)
  for (const [r, c] of cells.slice(1)) {
    const p = await centre(page, r, c)
    await page.mouse.move(p.x, p.y, { steps: 3 })
  }
  await page.mouse.up()
}

const click = (page: Page, r: number, c: number) => dragThrough(page, [[r, c]])

/** Wait for the automatic save to land. */
async function saved(page: Page) {
  await expect(page.locator('.work__saved')).toHaveText('Saved')
}

async function select(page: Page, name: RegExp) {
  await palette(page).filter({ hasText: name }).click()
  await expect(palette(page).filter({ hasText: name })).toHaveAttribute('aria-pressed', 'true')
}

test('design a pattern with every tool, undo, colours, reload, and Work and back', async ({ page }, testInfo) => {
  const pyodide: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && pyodide.push(r.url()))

  // --- a blank pattern ---------------------------------------------------------------------
  await page.goto('/')
  await page.getByRole('button', { name: /Design pattern/ }).click()
  const dialog = page.getByRole('dialog', { name: 'New pattern' })
  await dialog.getByLabel('Name').fill('Sampler')
  await dialog.getByLabel('Columns').fill(String(COLS))
  await dialog.getByLabel('Rows').fill(String(ROWS))
  await dialog.getByLabel('Colour').fill(WHITE)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/#\/design\/[0-9a-f]{32}$/)
  const id = page.url().split('/').at(-1)!
  await expect(page.getByRole('heading', { level: 1, name: 'Sampler' })).toBeVisible()
  await expect(page.locator('.design__stats')).toHaveText(/12 cols × 10 rows\s+·\s+120 stitches\s+·\s+1 colours\s+·\s+13 strings needed/)
  expect(await grid(page)).toEqual(blank)
  await expect(page.locator('.zoom__label')).toHaveText(/^\d+ px per cell$/)

  // --- colours: add black and red -------------------------------------------------------------
  await page.getByLabel('Colour to add').fill(BLACK)
  await page.getByRole('button', { name: 'Add colour' }).click()
  await page.getByLabel('Colour to add').fill(RED)
  await page.getByRole('button', { name: 'Add colour' }).click()
  await expect(palette(page)).toHaveCount(3)
  await expect(palette(page).nth(2)).toHaveAttribute('aria-pressed', 'true')

  // --- every tool can be chosen by shortcut and by mouse -------------------------------------------
  for (const [key, name] of [['F', 'Fill'], ['R', 'Rectangle'], ['I', 'Pick colour'], ['H', 'Fill row'], ['V', 'Fill column'], ['B', 'Paint']] as const) {
    await page.keyboard.press(key.toLowerCase())
    await expect(tool(page, name)).toHaveAttribute('aria-pressed', 'true')
  }
  for (const name of ['Fill', 'Rectangle', 'Pick colour', 'Fill row', 'Fill column', 'Paint']) {
    await tool(page, name).click()
    await expect(tool(page, name)).toHaveAttribute('aria-pressed', 'true')
  }

  // --- paint (chosen by mouse, above): a stroke is one undo step ----------------------------------------
  await select(page, /#000000/)
  await dragThrough(page, [[1, 1], [1, 4], [3, 4]])
  const stroke = ['............', '.BBBB.......', '....B.......', '....B.......', ...blank.slice(4)]
  expect(await grid(page)).toEqual(stroke)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await grid(page)).toEqual(blank)
  // Just the stroke: the colours added before it are still there.
  await expect(palette(page)).toHaveCount(3)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  expect(await grid(page)).toEqual(stroke)
  // A click that changes nothing records nothing: one undo still empties the grid.
  await click(page, 1, 1)
  await page.getByRole('button', { name: 'Undo' }).click()
  expect(await grid(page)).toEqual(blank)
  await page.getByRole('button', { name: 'Redo' }).click()
  expect(await grid(page)).toEqual(stroke)

  // --- rectangle (by shortcut), previewed while dragged ----------------------------------------------------
  await page.keyboard.press('r')
  await select(page, /#d93a3a/)
  await press(page, 6, 2)
  const end = await centre(page, 8, 6)
  await page.mouse.move(end.x, end.y, { steps: 4 })
  // The preview shows (the colour, washed over the cells) but nothing is filled yet.
  const during = await shown(page)
  expect(during[7]![4]).not.toBe(WHITE)
  expect(during[7]![4]).not.toBe(RED)
  await page.mouse.up()
  const rect = [...stroke.slice(0, 6), '..RRRRR.....', '..RRRRR.....', '..RRRRR.....', blank[9]!]
  expect(await grid(page)).toEqual(rect)
  // Escape drops a rectangle mid-drag.
  await press(page, 0, 8)
  const far = await centre(page, 2, 11)
  await page.mouse.move(far.x, far.y, { steps: 3 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await grid(page)).toEqual(rect)

  // --- fill (by mouse): 4-connected, inside the black corner -------------------------------------------------
  await tool(page, 'Fill').click()
  await click(page, 2, 5)
  expect((await grid(page)).slice(0, 4)).toEqual(['RRRRRRRRRRRR', 'RBBBBRRRRRRR', 'RRRRBRRRRRRR', 'RRRRBRRRRRRR'])
  await page.keyboard.press('ControlOrMeta+z')
  expect(await grid(page)).toEqual(rect)

  // --- eyedropper (by shortcut) picks black -----------------------------------------------------------------------
  await page.keyboard.press('i')
  await click(page, 1, 2)
  await expect(palette(page).filter({ hasText: '#000000' })).toHaveAttribute('aria-pressed', 'true')

  // --- fill row (by mouse) and fill column (by shortcut) -------------------------------------------------------------
  await tool(page, 'Fill row').click()
  await click(page, 9, 0)
  await page.keyboard.press('v')
  await click(page, 0, 11)
  const final = [
    '...........B',
    '.BBBB......B',
    '....B......B',
    '....B......B',
    '...........B',
    '...........B',
    '..RRRRR....B',
    '..RRRRR....B',
    '..RRRRR....B',
    'BBBBBBBBBBBB',
  ]
  expect(await grid(page)).toEqual(final)
  const counts = { black: 6 + 12 + 9, red: 15 }

  // --- colours: recolour and delete ------------------------------------------------------------------------------------
  // Recolour red to a darker red, then delete it: its cells go to the nearest (black).
  await select(page, /#d93a3a/)
  await page.getByLabel('Recolour “New colour”').fill('#b02020')
  await expect(palette(page).nth(2)).toHaveAccessibleName(`New colour, #b02020, ${counts.red} cells`)
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Colour name').fill('Brick')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Delete “Brick”' }).click()
  await expect(palette(page)).toHaveCount(2)
  await expect(page.locator('.design__message')).toHaveText(`Deleted “Brick”; its ${counts.red} cells are now “New colour”.`)
  await expect(palette(page).nth(1)).toHaveAccessibleName(`New colour, #000000, ${counts.black + counts.red} cells`)
  // Undo brings it back with its cells.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(palette(page)).toHaveCount(3)
  expect((await shown(page))[7]![4]).toBe('#b02020')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(palette(page)).toHaveCount(2)
  const afterDelete = final.map((row) => row.replaceAll('R', 'B'))
  expect(await grid(page)).toEqual(afterDelete)

  // --- saved without a Save button: a real reload shows the same pattern ------------------------------------------------------
  await saved(page)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Sampler' })).toBeVisible()
  expect(await grid(page)).toEqual(afterDelete)
  await expect(palette(page)).toHaveCount(2)
  await expect(page.locator('.design__stats')).toHaveText(/2 colours/)

  // --- Work and back, with progress kept --------------------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(new RegExp(`#/work/${id}$`))
  const row = page.locator('.work__row')
  await expect(row).toHaveText(/^Row 1 of 10/)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(row).toHaveText(/^Row 3 of 10/)
  await expect(page.locator('.work__saved')).toHaveText('Saved')

  await page.getByText('Options').click()
  await page.getByRole('button', { name: 'Edit pattern…' }).click()
  await expect(page).toHaveURL(new RegExp(`#/design/${id}$`))
  await expect(page.getByRole('status').filter({ hasText: "You're 2 rows into this project. Structural edits may shift your place." })).toBeVisible()
  // Paint over the rows already done (the bottom two), then go back.
  await tool(page, 'Fill row').click()
  await select(page, /#ffffff/)
  await click(page, 9, 3)
  expect((await grid(page))[9]).toBe('............')
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(new RegExp(`#/work/${id}$`))
  await expect(row).toHaveText(/^Row 3 of 10/)
  await expect(page.locator('.work__stitches')).toHaveText('24 / 120 stitches')

  // From the Library, a project with progress opens in Work.
  await page.getByRole('link', { name: 'Library' }).click()
  await page.getByRole('listitem').filter({ hasText: 'Sampler' }).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`#/work/${id}$`))
  await expect(row).toHaveText(/^Row 3 of 10/)

  // --- the file it writes opens in the desktop app ------------------------------------------------------------------------------------
  await page.getByRole('link', { name: 'Library' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export “Sampler”' }).click(),
  ])
  const file = testInfo.outputPath('sampler.alpha')
  await download.saveAs(file)
  const web = readAlpha(new Uint8Array(readFileSync(file))).project
  // desktop_import.py load opens it with io.load_project, as the desktop app does (and
  // fails the test if it can't).
  const desktop = desktopLoad(file)
  expect([desktop.name, desktop.rows, desktop.cols, desktop.stage]).toEqual(['Sampler', ROWS, COLS, 'work'])
  expect(desktop.cells).toEqual([...web.pattern.cells])
  expect(desktop.palette).toEqual(web.pattern.palette.map((e) => [e.hex, e.name, e.count]))
  expect(desktop.completed).toBe(2)

  // The Design and Work stages never loaded Pyodide.
  expect(pyodide).toEqual([])
})

test('a new pattern that is large still fits, zooms and scrolls', async ({ page }) => {
  await page.goto('/#/library')
  await page.getByRole('button', { name: 'Design pattern…' }).click()
  const dialog = page.getByRole('dialog', { name: 'New pattern' })
  await dialog.getByLabel('Columns').fill('200')
  await dialog.getByLabel('Rows').fill('200')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/#\/design\//)
  // Fitted: the whole 200×200 grid in view, at a few px per cell.
  const label = page.locator('.zoom__label')
  await expect(label).toHaveText(/^[2-4] px per cell$/)
  const fitted = await label.textContent()
  const box0 = (await scroller(page).boundingBox())!
  const px = Number(fitted!.split(' ')[0])
  expect(AXIS_LEFT + 200 * px).toBeLessThanOrEqual(box0.width)
  expect(AXIS_TOP + 200 * px).toBeLessThanOrEqual(box0.height)
  // Zoom to 4, then step: 4 → 5 (+ key) → 6 (Ctrl+wheel) → 5 (− key).
  while ((await label.textContent()) !== '4 px per cell') await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.keyboard.press('+')
  await expect(label).toHaveText('5 px per cell')
  // Ctrl/⌘ + wheel over the chart zooms; a bare wheel scrolls.
  const box = (await scroller(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect(label).toHaveText('6 px per cell')
  await page.mouse.wheel(0, 300)
  await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('-')
  await expect(label).toHaveText('5 px per cell')
  await page.getByRole('button', { name: 'Fit' }).click()
  await expect(label).toHaveText(fitted!)
})

test('editing a desktop-written file keeps its photo, and the desktop still opens it', async ({ page }, testInfo) => {
  const FILE = new URL('../../fixtures/alpha/desktop/with-source.alpha', import.meta.url).pathname
  const before = readAlpha(new Uint8Array(readFileSync(FILE)))
  const p = before.project.pattern
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(FILE)
  await expect(page.getByRole('listitem').filter({ hasText: p.name })).toBeVisible()
  await page.goto(`/#/design/${p.id}`)
  await expect(page.getByRole('heading', { level: 1, name: p.name })).toBeVisible()
  // Recolour the first colour and fill the top row with the last.
  await page.getByLabel(`Recolour “${p.palette[0]!.name}”`).fill('#123456')
  await select(page, new RegExp(p.palette.at(-1)!.hex))
  await tool(page, 'Fill row').click()
  const box = (await scroller(page).boundingBox())!
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  await page.mouse.click(box.x + AXIS_LEFT + cell / 2, box.y + AXIS_TOP + cell / 2)
  await saved(page)

  await page.getByRole('link', { name: 'Library' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `Export “${p.name}”` }).click(),
  ])
  const file = testInfo.outputPath('edited.alpha')
  await download.saveAs(file)
  const after = readAlpha(new Uint8Array(readFileSync(file)))
  expect(after.sourcePng).toEqual(before.sourcePng)
  expect(after.project.pattern.row_ids).toEqual(p.row_ids)
  expect([...after.project.progress.completed_row_ids].sort()).toEqual([...before.project.progress.completed_row_ids].sort())
  expect(new Set(after.project.pattern.cells.subarray(0, p.cols))).toEqual(new Set([p.palette.length - 1]))

  const desktop = desktopLoad(file)
  expect(desktop.cells).toEqual([...after.project.pattern.cells])
  expect(desktop.palette[0]![0]).toBe('#123456')
  expect(desktop.source).not.toBeNull()
  expect(desktop.completed).toBe(before.project.progress.completed_row_ids.size)
})
