/**
 * The confirm screen's corrections in real Chromium, with real Pyodide in the real
 * worker. Each test makes corrections, saves, exports, and checks the saved pattern cell
 * for cell against the desktop code making the same corrections
 * (scripts/desktop_import.py via desktop.ts). Also: the grid's outline dragged over the
 * rows and columns a detection left out, the phone layout with every control
 * used, the watchdog, with detection made slow by a test hook, and running out of memory,
 * with the worker's memory filled by another.
 *
 * Needs the repo's Python (.venv, or $PYTHON) with numpy and Pillow for the reference.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import type { Crop } from '../src/detect/protocol.ts'
import { cropFromDrag, fitRect } from '../src/importer/letterbox.ts'
import { readAlpha } from '../src/storage/alpha.ts'
import { desktopDetect, ROOT, type Correction } from './desktop.ts'
import { DETECT_TIMEOUT, exportFromLibrary, importImage, saveAs } from './importing.ts'

const CATS = resolve(ROOT, 'test_images/cats.png') // 100 × 45, 3 colours; 1199 × 540 px

test.describe.configure({ timeout: 5 * 60_000 })

/** A PNG's size, from its header. */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

const stats = (page: Page) => page.locator('.confirm__stats')

/** Wait until nothing is detecting or resampling, and the preview shows cols × rows. */
async function showing(page: Page, cols: number, rows: number) {
  await expect(stats(page)).toHaveText(`${cols} × ${rows} stitches · ${cols * rows} total`, { timeout: DETECT_TIMEOUT })
  await expect(page.locator('.confirm__outcome')).toHaveAttribute('aria-busy', 'false')
}

/**
 * Drag a box across the source image from one point to another, given as fractions of
 * the image. Returns the crop that asks for, in image pixels, worked out independently
 * through the same letterbox mapping the desktop uses.
 */
async function crop(page: Page, file: string, [fx0, fy0, fx1, fy1]: [number, number, number, number]): Promise<Crop> {
  const source = page.locator('.source')
  await source.scrollIntoViewIfNeeded()
  const box = (await source.boundingBox())!
  const { width, height } = pngSize(file)
  const fit = fitRect(box.width, box.height, width, height)
  const at = (fx: number, fy: number) => ({ x: Math.round(box.x + fit.x + fx * fit.width), y: Math.round(box.y + fit.y + fy * fit.height) })
  const [a, b] = [at(fx0, fy0), at(fx1, fy1)]
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await page.mouse.up()
  const want = cropFromDrag({ x: a.x - box.x, y: a.y - box.y }, { x: b.x - box.x, y: b.y - box.y }, fit, width, height)
  expect(want).not.toBeNull()
  return want!
}

/** Save as `name`, export it, and check it's exactly what the desktop makes of `file`
 *  with `corrections`. */
async function expectDesktop(page: Page, testInfo: TestInfo, name: string, file: string, corrections: Correction[]) {
  const want = desktopDetect(file, corrections)
  expect(want.ok, `desktop: ${want.code}`).toBe(true)
  await showing(page, want.cols, want.rows)
  await saveAs(page, name)
  const saved = readAlpha(new Uint8Array(readFileSync(await exportFromLibrary(page, testInfo, name)))).project.pattern
  expect([saved.cols, saved.rows]).toEqual([want.cols, want.rows])
  expect([...saved.cells]).toEqual(want.cells)
  expect(saved.palette.map((e) => [e.hex, e.name, e.count])).toEqual(want.palette)
  return want
}

test('the colours are merged as the desktop merges them, with nothing to set', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  await expect(page.getByRole('heading', { level: 2, name: 'Colours, 3 colours' })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Colour detail' })).toHaveCount(0)
  await expectDesktop(page, testInfo, 'Cats', CATS, [])
})

test('a crop detects again, and matches the desktop', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  const c = await crop(page, CATS, [0.25, 0.18, 0.75, 0.83])
  const want = await expectDesktop(page, testInfo, 'Cats cropped', CATS, [`crop=${c.join(',')}`])
  expect([want.cols, want.rows]).not.toEqual([100, 45])
})

// A box drawn by hand round the whole image is no substitute: on cats.png, whose chart
// runs to the image's edges, one begun a single screen pixel in from the corner loses
// the outermost column and row (99 × 44).
test('"Reset to detected grid" undoes a crop, as the desktop\'s Re-detect does', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  const reset = page.getByRole('button', { name: 'Reset to detected grid' })
  await expect(page.getByRole('button', { name: 'Re-detect' })).toHaveCount(0)
  await expect(reset).toBeDisabled()
  const c = await crop(page, CATS, [0.25, 0.18, 0.75, 0.83])
  const cropped = desktopDetect(CATS, [`crop=${c.join(',')}`])
  await showing(page, cropped.cols, cropped.rows)
  await reset.click()
  const want = await expectDesktop(page, testInfo, 'Cats whole again', CATS, [`crop=${c.join(',')}`, 'redetect'])
  expect([want.cols, want.rows]).toEqual([100, 45])
})

/** Drag one of the outline's handles to a point given as fractions of the image (beyond
 *  0 or 1 is past its edge). */
async function dragHandle(page: Page, file: string, handle: string, [fx, fy]: [number, number]) {
  const source = page.locator('.source')
  const box = (await source.boundingBox())!
  const { width, height } = pngSize(file)
  const fit = fitRect(box.width, box.height, width, height)
  const from = (await page.getByTestId(handle).boundingBox())!
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const b = { x: box.x + fit.x + fx * fit.width, y: box.y + fit.y + fy * fit.height }
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await page.mouse.up()
}

/** The outline shown, in image pixels: what was resampled. */
async function extentShown(page: Page): Promise<string> {
  const rect = page.getByTestId('grid-overlay').locator('rect')
  const [x, y, w, h] = await Promise.all(['x', 'y', 'width', 'height'].map(async (a) => Number(await rect.getAttribute(a))))
  return [x, y, x! + w!, y! + h!].join(',')
}

test('dragging the outline takes in the rows and columns a detection left out, and matches the desktop', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  // Detect only the middle, as if detection had missed the chart's sides.
  const c = await crop(page, CATS, [0.25, 0.18, 0.75, 0.83])
  const cropped = desktopDetect(CATS, [`crop=${c.join(',')}`])
  await showing(page, cropped.cols, cropped.rows)
  expect(cropped.cols).toBeLessThan(100)
  // Drag two corners past the image's: every row and column left out comes back.
  await dragHandle(page, CATS, 'corner-top-left', [-0.02, -0.02])
  await dragHandle(page, CATS, 'corner-bottom-right', [1.02, 1.02])
  await showing(page, 100, 45)
  await expect(page.locator('.confirm__outcome')).toHaveAttribute('aria-busy', 'false')
  const want = await expectDesktop(page, testInfo, 'Cats outline', CATS, [`crop=${c.join(',')}`, `extent=${await extentShown(page)}`, 'rows=45', 'cols=100'])
  // And it's the chart detection finds in the whole image: the same cells, colour for colour.
  const whole = desktopDetect(CATS)
  const pairs = new Set(want.cells.map((k, i) => `${k}:${whole.cells[i]}`))
  expect(pairs.size).toBe(new Set(whole.cells).size)
})

test('a colour removed before the outline moves stays removed, and matches the desktop deleting it', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  const list = page.getByRole('list', { name: 'Colours' })
  // The list never scrolls or spills sideways, long shade names and all, at the narrowest
  // width that has it beside the pattern.
  await page.setViewportSize({ width: 1100, height: 800 })
  expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth && getComputedStyle(el).overflowX === 'visible')).toBe(true)

  // Pointing at a colour shows where it is used.
  const beige = list.getByRole('button', { name: /^Beige, #[0-9a-f]{6}, 1129 stitches/ })
  await beige.hover()
  await expect(page.getByRole('img', { name: /showing where Beige is used$/ })).toBeVisible()
  const hex = /#[0-9a-f]{6}/.exec((await beige.getAttribute('aria-label'))!)![0]

  await page.getByRole('button', { name: 'Remove “Beige”' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeVisible()
  await expect(list.getByRole('button', { name: /^Cream, #[0-9a-f]{6}, 2353 stitches/ })).toBeVisible()

  // The outline moves (a fresh palette, fresh ids), and the colour stays removed.
  await page.getByRole('slider', { name: 'Top edge of the grid' }).focus()
  await page.keyboard.press('ArrowDown')
  await showing(page, 100, 44)
  await expect(page.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore “Beige”' })).toBeVisible()
  const want = await expectDesktop(page, testInfo, 'Cats less beige', CATS, [`extent=${await extentShown(page)}`, 'rows=44', 'cols=100', `remove=${hex}`])
  expect(want.palette).toHaveLength(2)
})

test('the image and the pattern sit on stages of one size that line up, at every width', async ({ page }) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  const box = (selector: string) => page.locator(selector).first().boundingBox().then((b) => b!)
  const within = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5)
  const size = pngSize(CATS)
  for (const width of [1280, 900, 400]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('.stage')).toHaveCount(2)
    const [image, pattern] = [await box('.source.stage'), await box('.confirm__col--pattern .stage')]
    within(image.width, pattern.width)
    within(image.height, pattern.height)
    // The image's shape, within the height cap.
    within(image.height, Math.min(image.width * (size.height / size.width), Math.min(0.7 * 900, 720)))
    // The pattern fits inside its stage, centred.
    const canvas = await box('.pattern__canvas')
    within(canvas.x - pattern.x, pattern.x + pattern.width - (canvas.x + canvas.width))
    within(canvas.y - pattern.y, pattern.y + pattern.height - (canvas.y + canvas.height))
    // Each heading sits over the left edge of what's below it.
    within((await box('.confirm__col--image .confirm__caption')).x, image.x)
    within((await box('.confirm__col--pattern .confirm__caption')).x, pattern.x)
    if (width >= 900) {
      // Side by side: tops and bottoms level, headings on one baseline, and the size
      // under the pattern.
      within(image.y, pattern.y)
      const heads = await page.locator('.confirm__head').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
      expect(new Set(heads).size).toBe(1)
      within((await box('.confirm__stats')).x, pattern.x)
    }
  }
  // The counts end where the rows' dividers do.
  await page.setViewportSize({ width: 1280, height: 900 })
  const row = await box('.palette__entry')
  const count = await box('.palette__count')
  within(count.x + count.width, row.x + row.width)
  await expect(page.locator('.palette__total')).toHaveText('Total4500 stitches')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true })

  test('a colour tapped is shown on the pattern above, and its × is there to tap', async ({ page }) => {
    await importImage(page, CATS)
    await showing(page, 100, 45)
    await expect(page.getByRole('tablist')).toHaveCount(0)
    const cream = page.getByRole('button', { name: /^Cream,/ })
    await cream.tap()
    await expect(cream).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('img', { name: /showing where Cream is used$/ })).toBeAttached()
    await page.getByRole('button', { name: 'Show all colours' }).tap()
    await expect(page.getByRole('img', { name: /^The detected pattern: 100 columns by 45 rows$/ })).toBeAttached()

    const remove = page.getByRole('button', { name: 'Remove “Beige”' })
    await expect(remove).toHaveCSS('opacity', '1') // no hover to reveal it on a phone
    await remove.tap()
    await expect(page.getByRole('heading', { level: 2, name: 'Colours, 2 colours' })).toBeVisible()
  })

  test('every control is usable, saving stays in reach, and the result matches the desktop', async ({ page }, testInfo) => {
    await importImage(page, CATS)
    await showing(page, 100, 45)
    const noSideways = async () => {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
    }
    const saveInView = async () => {
      const b = (await page.getByRole('button', { name: 'Save & edit pattern' }).boundingBox())!
      expect(b.y + b.height).toBeLessThanOrEqual(860)
      expect(b.y).toBeGreaterThanOrEqual(0)
    }
    await noSideways()
    await saveInView()

    // Everything is on the one page, stacked.
    await expect(page.getByTestId('grid-overlay')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Colours' })).toBeAttached()

    // A box drawn on the image. (Not too near the image's edges, where the outline's
    // handles are.)
    const c = await crop(page, CATS, [0.2, 0.18, 0.8, 0.82])
    const cropped = desktopDetect(CATS, [`crop=${c.join(',')}`])
    await showing(page, cropped.cols, cropped.rows)

    // Scrolled to the bottom of the page, saving is still on screen.
    await page.mouse.wheel(0, 2000)
    await saveInView()
    await noSideways()
    await expectDesktop(page, testInfo, 'Cats on a phone', CATS, [`crop=${c.join(',')}`])
  })
})

test.describe('the watchdog', () => {
  test.beforeEach(async ({ page }) => {
    // The test hook in detect/client.ts: detection busy-waits 60 s in the worker, and
    // the budget is 3 s instead of 20.
    await page.addInitScript(() => {
      ;(globalThis as { __alphaDetectTest?: unknown }).__alphaDetectTest = { delayMs: 60_000, budgetMs: 3_000 }
    })
  })

  const hookOff = (page: Page) => page.evaluate(() => void ((globalThis as { __alphaDetectTest?: { delayMs?: number } }).__alphaDetectTest!.delayMs = 0))

  test('a detection that runs too long is stopped, and Try again recovers', async ({ page }) => {
    const { alert } = await importImage(page, CATS)
    await expect(alert).toContainText('This image is taking too long to read.')
    await expect(alert).toContainText('Detection stopped (TIMEOUT)')
    // The tab still works: the source image is there and the page responds.
    await expect(page.getByRole('img', { name: 'The image being imported' })).toBeVisible()
    await hookOff(page)
    await alert.getByRole('button', { name: 'Try again' }).click()
    await showing(page, 100, 45)
  })

  test('a box drawn on the image starts over on just that, and matches the desktop', async ({ page }, testInfo) => {
    const { alert } = await importImage(page, CATS)
    await expect(alert).toContainText('This image is taking too long to read.')
    await hookOff(page)
    const c = await crop(page, CATS, [0.25, 0.18, 0.75, 0.83])
    await expectDesktop(page, testInfo, 'Cats after a timeout', CATS, [`crop=${c.join(',')}`])
  })
})

test.describe('running out of memory', () => {
  test.beforeEach(async ({ page }) => {
    // The test hook in detect/client.ts: the worker fills Pyodide's memory before each
    // detection, so detection really runs out, as a big photo on a phone would.
    await page.addInitScript(() => {
      ;(globalThis as { __alphaDetectTest?: unknown }).__alphaDetectTest = { fillMemory: true }
    })
  })

  test('ends on a friendly screen, and a box drawn on the image recovers in a fresh worker', async ({ page }, testInfo) => {
    const { alert } = await importImage(page, CATS)
    await expect(alert).toContainText('This image is too big to read on this device.')
    await expect(alert).toContainText('Detection stopped (OUT_OF_MEMORY)')
    // The same image would run out the same way again, so that isn't offered.
    await expect(alert.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'The image being imported' })).toBeVisible()
    await page.evaluate(() => void ((globalThis as { __alphaDetectTest?: { fillMemory?: boolean } }).__alphaDetectTest!.fillMemory = false))
    const c = await crop(page, CATS, [0.25, 0.18, 0.75, 0.83])
    await expectDesktop(page, testInfo, 'Cats after running out of memory', CATS, [`crop=${c.join(',')}`])
  })
})
