/**
 * The image to trace in real Chromium: added from the panel, drawn see-through over the
 * cells (checked on the canvas's own pixels), shown and hidden with T, made stronger,
 * moved and resized on the chart without painting anything, kept through a reload and
 * in the exported file (which the Python reference still opens), dropped onto the chart,
 * and removed. It never loads Pyodide.
 */
import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'

import { readAlpha } from '../src/storage/alpha.ts'
import { addColour } from './colours.ts'
import { desktopLoad } from './desktop.ts'
import { exportFromLibrary } from './importing.ts'

const AXIS_LEFT = 34
const AXIS_TOP = 22
const SIZE = 20

const scroller = (page: Page) => page.getByTestId('design-scroller')
const panel = (page: Page) => page.locator('.trace')

/** The centre of cell (r, c) on screen. */
async function centre(page: Page, r: number, c: number) {
  const box = (await scroller(page).boundingBox())!
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  return { x: box.x + AXIS_LEFT + c * cell + cell / 2, y: box.y + AXIS_TOP + r * cell + cell / 2 }
}

/** The colour the canvas shows at the centre of cell (r, c), as [r, g, b]. */
async function pixel(page: Page, r: number, c: number): Promise<[number, number, number]> {
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.design-canvas canvas')!
      const dpr = canvas.width / canvas.clientWidth
      const [R, G, B] = canvas.getContext('2d')!.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data
      return [R!, G!, B!] as [number, number, number]
    },
    { x: AXIS_LEFT + c * cell + cell / 2, y: AXIS_TOP + r * cell + cell / 2 },
  )
}

const WHITE: [number, number, number] = [255, 255, 255]
/** White under red (#ff0000) at `a`: what the canvas should show. */
const overWhite = (a: number): [number, number, number] => [255, Math.round(255 * (1 - a)), Math.round(255 * (1 - a))]
function near(got: [number, number, number], want: [number, number, number], tol = 6) {
  expect(Math.max(...got.map((v, i) => Math.abs(v - want[i]!))), `${got} vs ${want}`).toBeLessThanOrEqual(tol)
}

/** A 2:1 PNG, red on its left half and blue on its right, made in the page. */
async function twoToOne(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 200
    c.height = 100
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 100, 100)
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(100, 0, 100, 100)
    return c.toDataURL('image/png').split(',')[1]!
  })
  return Buffer.from(b64, 'base64')
}

async function newPattern(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Design from scratch' }).click()
  const dialog = page.getByRole('dialog', { name: 'New pattern' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Columns').fill(String(SIZE))
  await dialog.getByLabel('Rows').fill(String(SIZE))
  await dialog.getByLabel('Colour').fill('#ffffff')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/#\/design\/[0-9a-f]{32}$/)
}

test('an image to trace: added, shown, placed, kept, exported and removed', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  const pyodide: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && pyodide.push(r.url()))
  await newPattern(page, 'Traced')
  const png = await twoToOne(page)

  // --- added: fitted to the 20 × 20 pattern, so 20 wide, 10 tall, rows 5 to 14 ----------
  await expect(panel(page).getByRole('button', { name: 'Add an image to trace' })).toBeVisible()
  await panel(page).locator('input[type=file]').setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: png })
  await expect(page.locator('.design__message')).toHaveText('Added an image to trace, fitted to the pattern.')
  await expect(panel(page).locator('.trace__thumb')).toBeVisible()
  await expect(scroller(page)).toBeVisible()
  await expect.poll(async () => (await pixel(page, 8, 3))[1]).toBeLessThan(200)
  near(await pixel(page, 8, 3), overWhite(0.5)) // red, half see-through
  near(await pixel(page, 2, 3), WHITE) // above the image
  const blueish = await pixel(page, 8, 15)
  expect(blueish[2]).toBeGreaterThan(blueish[0] + 50)

  // Painting still paints. Behind (the default), a painted cell hides the image; on top,
  // the image tints it too.
  const show = (name: string) => panel(page).getByRole('radio', { name })
  await expect(show('Behind')).toBeChecked()
  await addColour(page, '#000000', 'Black')
  await page.keyboard.press('b')
  const at = await centre(page, 8, 3)
  await page.mouse.click(at.x, at.y)
  near(await pixel(page, 8, 3), [0, 0, 0])
  near(await pixel(page, 8, 4), overWhite(0.5)) // the background beside it still shows it
  await show('On top').check()
  near(await pixel(page, 8, 3), [128, 0, 0], 8) // black under half-see-through red

  // --- T hides and shows it; the slider makes it stronger -----------------------------------
  // (Not while a radio button has the focus: its keys are its own, as for every shortcut.)
  await page.locator('.design-canvas').focus()
  await page.keyboard.press('t')
  await expect(show('Off')).toBeChecked()
  near(await pixel(page, 8, 5), WHITE)
  await page.keyboard.press('t')
  await expect(show('On top')).toBeChecked()
  near(await pixel(page, 8, 5), overWhite(0.5))
  await panel(page).getByRole('slider').fill('80')
  await expect(panel(page).locator('output')).toHaveText('80%')
  near(await pixel(page, 8, 5), overWhite(0.8))

  // --- moved and resized on the chart, painting nothing ----------------------------------------
  const undo = page.getByRole('button', { name: 'Undo' })
  await panel(page).getByRole('button', { name: 'Move or resize' }).click()
  await expect(scroller(page)).toHaveAttribute('data-mode', 'trace')
  await expect(page.locator('.design__placing')).toContainText('Drag the image')
  const from = await centre(page, 10, 10)
  const to = await centre(page, 14, 10) // four rows down: rows 9 to 18
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  near(await pixel(page, 6, 5), WHITE)
  near(await pixel(page, 12, 5), overWhite(0.8))
  // The bottom-right handle, dragged up and left to half the size: 10 × 5 from (0, 9).
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  const box = (await scroller(page).boundingBox())!
  const corner = { x: box.x + AXIS_LEFT + SIZE * cell, y: box.y + AXIS_TOP + 19 * cell }
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x - 10 * cell, corner.y - 5 * cell, { steps: 5 })
  await page.mouse.up()
  near(await pixel(page, 11, 2), overWhite(0.8)) // red half, now columns 0 to 4
  const right = await pixel(page, 11, 7) // blue half, columns 5 to 9
  expect(right[2]).toBeGreaterThan(right[0] + 50)
  near(await pixel(page, 11, 14), WHITE) // past it
  near(await pixel(page, 16, 2), WHITE) // below it
  // Escape is done; placing it was never an edit: two undo steps (the cell painted and
  // the colour added) and no more.
  await page.keyboard.press('Escape')
  await expect(panel(page).getByRole('button', { name: 'Move or resize' })).toHaveAttribute('aria-pressed', 'false')
  await expect(scroller(page)).toHaveAttribute('data-mode', 'edit')
  await undo.click()
  await undo.click()
  await expect(undo).toBeDisabled()

  // --- kept through a reload, where it was and as strong ----------------------------------------
  await expect(page.locator('.work__saved')).toHaveText('Saved')
  await page.reload()
  await expect(panel(page).locator('.trace__thumb')).toBeVisible()
  await expect(panel(page).locator('output')).toHaveText('80%')
  await expect.poll(async () => (await pixel(page, 11, 2))[1]).toBeLessThan(100)
  near(await pixel(page, 11, 2), overWhite(0.8))
  near(await pixel(page, 11, 14), WHITE)

  // --- in the exported file, which the Python reference opens -----------------------------------
  const file = await exportFromLibrary(page, testInfo, 'Traced')
  const bytes = new Uint8Array(readFileSync(file))
  expect(Object.keys(unzipSync(bytes))).toEqual(expect.arrayContaining(['trace.json', 'trace.png']))
  const t = readAlpha(bytes).trace!
  expect(t).toMatchObject({ type: 'image/png', x: 0, opacity: 0.8, shown: true, behind: false })
  expect(t.width).toBeCloseTo(10, 0)
  expect(t.y).toBeCloseTo(9, 0)
  // desktop_import.py load opens it with io.load_project (and fails the test if it can't).
  const web = readAlpha(bytes).project
  const desktop = desktopLoad(file)
  expect([desktop.name, desktop.rows, desktop.cols]).toEqual(['Traced', SIZE, SIZE])
  expect(desktop.cells).toEqual([...web.pattern.cells])

  // --- dropped on the chart, it replaces the image; Remove takes it away -------------------------
  await page.goBack()
  await expect(panel(page).locator('.trace__thumb')).toBeVisible()
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bin], 'again.png', { type: 'image/png' }))
    const target = document.querySelector('.design__canvas')!
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, png.toString('base64'))
  await expect(page.locator('.design__message')).toHaveText('Replaced the image to trace, fitted to the pattern.')
  await expect.poll(async () => (await pixel(page, 6, 3))[1]).toBeLessThan(200) // fitted again: rows 5 to 14
  near(await pixel(page, 6, 3), overWhite(0.8)) // the strength is kept

  await panel(page).getByRole('button', { name: 'Remove the image' }).click()
  await expect(panel(page).getByRole('button', { name: 'Add an image to trace' })).toBeVisible()
  near(await pixel(page, 6, 3), WHITE)
  await expect(page.locator('.work__saved')).toHaveText('Saved')
  await page.reload()
  await expect(panel(page).getByRole('button', { name: 'Add an image to trace' })).toBeVisible()

  expect(pyodide).toEqual([])
})

test('on a tablet, the image is in its own drawer, which closes to place it', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await newPattern(page, 'Tablet trace')
  const png = await twoToOne(page)
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Image' }).click()
  const drawer = page.getByRole('complementary', { name: 'Image to trace' })
  await drawer.locator('input[type=file]').setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: png })
  await expect(drawer.locator('.trace__thumb')).toBeVisible()
  await drawer.getByRole('button', { name: 'Move or resize' }).click()
  await expect(drawer).toBeHidden()
  await expect(scroller(page)).toHaveAttribute('data-mode', 'trace')
  await page.locator('.design__placing').getByRole('button', { name: 'Done' }).click()
  await expect(scroller(page)).toHaveAttribute('data-mode', 'edit')
})
