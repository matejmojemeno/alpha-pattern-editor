/**
 * The confirm screen's corrections in real Chromium, with real Pyodide in the real
 * worker. Each test makes corrections, saves, exports, and checks the saved pattern cell
 * for cell against the desktop code making the same corrections
 * (scripts/desktop_import.py via desktop.ts). Also: the phone layout with every control
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
  await expect(stats(page)).toHaveText(new RegExp(`^${cols} cols × ${rows} rows`), { timeout: DETECT_TIMEOUT })
  await expect(page.locator('.confirm__outcome')).toHaveAttribute('aria-busy', 'false')
}

/**
 * Turn on Crop and drag across the source image from one point to another, given as
 * fractions of the image. Returns the crop that asks for, in image pixels, worked out
 * independently through the same letterbox mapping the desktop uses.
 */
async function crop(page: Page, file: string, [fx0, fy0, fx1, fy1]: [number, number, number, number]): Promise<Crop> {
  const toggle = page.locator('.controls').getByRole('button', { name: 'Crop' })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
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

test('rows and cols changed by one each way match the desktop', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  await page.getByRole('button', { name: 'More rows' }).click()
  await page.getByRole('button', { name: 'Fewer columns' }).click()
  await expectDesktop(page, testInfo, 'Cats 46x99', CATS, ['rows=46', 'cols=99'])

  await importImage(page, CATS)
  await showing(page, 100, 45)
  await page.getByRole('button', { name: 'Fewer rows' }).click()
  await page.getByLabel('Cols').fill('101')
  await expectDesktop(page, testInfo, 'Cats 44x101', CATS, ['rows=44', 'cols=101'])
})

test('the colour-detail slider matches the desktop', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  await expect(stats(page)).toContainText('3 colours')
  // Right is more colours: slider 14 is ΔE 3, which splits the blue.
  await page.getByRole('slider', { name: 'Colour detail' }).fill('14')
  await expect(stats(page)).toContainText('5 colours')
  await expectDesktop(page, testInfo, 'Cats more colours', CATS, ['de=3'])
})

test('a crop detects again, at the current colour detail, and matches the desktop', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  await page.getByRole('slider', { name: 'Colour detail' }).fill('14') // ΔE 3, carried into the crop
  const c = await crop(page, CATS, [0.25, 0.18, 0.75, 0.83])
  await expect(page.locator('.controls').getByRole('button', { name: 'Crop' })).toHaveAttribute('aria-pressed', 'false') // crop mode ends
  const want = await expectDesktop(page, testInfo, 'Cats cropped', CATS, ['de=3', `crop=${c.join(',')}`])
  expect([want.cols, want.rows]).not.toEqual([100, 45])
})

test('Re-detect after a crop goes back to the whole image, as the desktop does', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  const c = await crop(page, CATS, [0.25, 0.18, 0.75, 0.83])
  const cropped = desktopDetect(CATS, [`crop=${c.join(',')}`])
  await showing(page, cropped.cols, cropped.rows)
  await page.getByRole('button', { name: 'More rows' }).click()
  await page.getByRole('button', { name: 'Re-detect' }).click()
  await expectDesktop(page, testInfo, 'Cats redetected', CATS, [`crop=${c.join(',')}`, `rows=${cropped.rows + 1}`, 'redetect'])
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true })

  test('every control is usable, saving stays in reach, and the result matches the desktop', async ({ page }, testInfo) => {
    await importImage(page, CATS)
    await showing(page, 100, 45)
    const noSideways = async () => {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
    }
    const saveInView = async () => {
      const b = (await page.getByRole('button', { name: 'Save & start working' }).boundingBox())!
      expect(b.y + b.height).toBeLessThanOrEqual(860)
      expect(b.y).toBeGreaterThanOrEqual(0)
    }
    await noSideways()
    await saveInView()

    // The panes are tabs.
    await expect(page.getByRole('tab', { name: 'Pattern', selected: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Colours' }).tap()
    await expect(page.getByRole('list', { name: 'Colours' })).toBeVisible()
    await page.getByRole('tab', { name: 'Image' }).tap()
    await expect(page.getByTestId('grid-overlay')).toBeVisible()

    // Crop (which shows the image), then the fast controls.
    const c = await crop(page, CATS, [0.2, 0.1, 0.8, 0.9])
    await expect(page.getByRole('tab', { name: 'Pattern', selected: true })).toBeVisible()
    const cropped = desktopDetect(CATS, [`crop=${c.join(',')}`])
    await showing(page, cropped.cols, cropped.rows)
    await page.getByRole('button', { name: 'More rows' }).tap()
    await page.getByLabel('Cols').fill(String(cropped.cols - 1))
    await page.getByRole('slider', { name: 'Colour detail' }).fill('14')
    const flag = page.getByRole('checkbox', { name: 'Flag unsure cells' })
    await flag.tap()
    await expect(flag).not.toBeChecked()
    await flag.tap()
    await expect(flag).toBeChecked()

    // Scrolled to the bottom of the pane, saving is still on screen.
    await page.mouse.wheel(0, 2000)
    await saveInView()
    await noSideways()
    await expectDesktop(page, testInfo, 'Cats on a phone', CATS, [`crop=${c.join(',')}`, `rows=${cropped.rows + 1}`, `cols=${cropped.cols - 1}`, 'de=3'])
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

  test('Crop from there starts over on just the crop, and matches the desktop', async ({ page }, testInfo) => {
    const { alert } = await importImage(page, CATS)
    await expect(alert).toContainText('This image is taking too long to read.')
    await hookOff(page)
    await alert.getByRole('button', { name: 'Crop' }).click()
    await expect(page.locator('.controls').getByRole('button', { name: 'Crop' })).toHaveAttribute('aria-pressed', 'true')
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

  test('ends on a friendly screen, and Crop recovers in a fresh worker', async ({ page }, testInfo) => {
    const { alert } = await importImage(page, CATS)
    await expect(alert).toContainText('This image is too big to read on this device.')
    await expect(alert).toContainText('Detection stopped (OUT_OF_MEMORY)')
    // The same image would run out the same way again, so that isn't offered.
    await expect(alert.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'The image being imported' })).toBeVisible()
    await page.evaluate(() => void ((globalThis as { __alphaDetectTest?: { fillMemory?: boolean } }).__alphaDetectTest!.fillMemory = false))
    await alert.getByRole('button', { name: 'Crop' }).click()
    const c = await crop(page, CATS, [0.25, 0.18, 0.75, 0.83])
    await expectDesktop(page, testInfo, 'Cats after running out of memory', CATS, [`crop=${c.join(',')}`])
  })
})
