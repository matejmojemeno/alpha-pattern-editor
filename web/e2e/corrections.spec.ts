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
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import type { Crop } from '../src/detect/protocol.ts'
import { cropFromDrag, fitRect } from '../src/importer/letterbox.ts'
import { readAlpha } from '../src/storage/alpha.ts'
import { encodePngRgba } from '../src/storage/thumbnail.ts'
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
  await expect(stats(page)).toHaveText(`${cols} columns × ${rows} rows`, { timeout: DETECT_TIMEOUT })
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

test('a colour pointed at is shown on the pattern; the list is for checking, with no ×', async ({ page }) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  const list = page.getByRole('list', { name: 'Colours' })
  // The list never scrolls or spills sideways at the narrowest width that has it beside
  // the pattern.
  await page.setViewportSize({ width: 1100, height: 800 })
  expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth && getComputedStyle(el).overflowX === 'visible')).toBe(true)

  // Pointing at a colour shows where it is used.
  const beige = list.getByRole('button', { name: /^Beige, #[0-9a-f]{6}, 1129 stitches/ })
  await beige.hover()
  await expect(page.getByRole('img', { name: /showing where Beige is used$/ })).toBeVisible()
  // Removing a colour is the Design stage's Delete; here, each colour is one button.
  await expect(page.getByRole('button', { name: /^Remove “/ })).toHaveCount(0)
  await expect(list.getByRole('button')).toHaveCount(3)
})

test('fewer colours merges the two most alike into the one used more, undoes, and matches the desktop', async ({ page }, testInfo) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  const count = page.getByRole('group', { name: 'Number of colours' })
  const list = page.getByRole('list', { name: 'Colours' })
  const entries = async () =>
    (await list.locator('.palette__show').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!))).map((l) => {
      const [, name, hex, n] = /^(.+), (#[0-9a-f]{6}), (\d+) stitch/.exec(l)!
      return { name: name!, hex: hex!, count: Number(n) }
    })
  const before = await entries()
  await expect(count.getByRole('status')).toHaveText('3')

  await count.getByRole('button', { name: 'Fewer colours' }).click()
  await expect(count.getByRole('status')).toHaveText('2')
  const after = await entries()
  const gone = before.find((e) => !after.some((a) => a.hex === e.hex))!
  // The one that went was the less used of the closest pair, and its stitches all went
  // to the other of the pair; the third colour is untouched.
  const kept = after.find((a) => a.count !== before.find((b) => b.hex === a.hex)!.count)!
  expect(kept.count).toBe(before.find((b) => b.hex === kept.hex)!.count + gone.count)
  expect(gone.count).toBeLessThanOrEqual(before.find((b) => b.hex === kept.hex)!.count)

  // + gives back exactly what was detected; − again, and it's saved as the desktop
  // makes it with that colour removed.
  await count.getByRole('button', { name: 'More colours' }).click()
  await expect(count.getByRole('status')).toHaveText('3')
  expect(await entries()).toEqual(before)
  await count.getByRole('button', { name: 'Fewer colours' }).click()
  await expect(count.getByRole('status')).toHaveText('2')
  const want = await expectDesktop(page, testInfo, 'Cats merged', CATS, [`remove=${gone.hex}`])
  expect(want.palette).toHaveLength(2)
})

test('the image and the pattern sit on stages of one size that line up, at every width', async ({ page }) => {
  await importImage(page, CATS)
  await showing(page, 100, 45)
  const box = (selector: string) => page.locator(selector).first().boundingBox().then((b) => b!)
  const within = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5)
  const size = pngSize(CATS)
  for (const [width, height] of [
    [1280, 900],
    [1920, 1000],
    [900, 900],
    [400, 900],
  ] as const) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('.stage')).toHaveCount(2)
    const [image, pattern] = [await box('.source.stage'), await box('.confirm__col--pattern .stage')]
    within(image.width, pattern.width)
    within(image.height, pattern.height)
    if (width >= 1100) {
      // Fitted to the window: the image's own shape, and nothing below the window.
      within(image.height, image.width * (size.height / size.width))
      expect(await page.evaluate(() => document.querySelector('.screen')!.scrollHeight)).toBeLessThanOrEqual(height)
    } else {
      // The image's shape, within the height cap.
      within(image.height, Math.min(image.width * (size.height / size.width), Math.min(0.7 * height, 720)))
    }
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

/** A made-up chart, `cols` × `rows` cells of 16 px on dark 1 px lines, each cell one of
 *  24 colours far enough apart to be told apart (12 hues, dark and light), by a fixed
 *  pseudo-random sequence. */
function manyColours(file: string, cols: number, rows: number) {
  const cell = 16
  const [w, h] = [cols * cell + 1, rows * cell + 1]
  const hsl = (hue: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => {
      const k = (n + hue / 30) % 12
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
    }
    return [f(0), f(8), f(4)]
  }
  const colours = [0, 30, 55, 90, 140, 175, 200, 225, 260, 290, 320, 345].flatMap((hue) => [hsl(hue, 0.8, 0.35), hsl(hue, 0.7, 0.7)])
  let seed = 7
  const next = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31)
  const cells = Array.from({ length: rows * cols }, () => colours[Math.floor(next() * colours.length)]!)
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const line = x % cell === 0 || y % cell === 0
      rgba.set([...(line ? [60, 60, 60] : cells[Math.floor(y / cell) * cols + Math.floor(x / cell)]!), 255], (y * w + x) * 4)
    }
  writeFileSync(file, encodePngRgba(w, h, rgba))
}

test('on a laptop, a tall chart with many colours fits the window, and only the colours scroll', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('many-colours.png')
  manyColours(file, 24, 30)
  await page.setViewportSize({ width: 1440, height: 800 })
  await importImage(page, file)
  await showing(page, 24, 30)
  const list = page.locator('.palette-pane')
  const scroll = (selector: string) =>
    page.locator(selector).evaluate((e) => ({ height: e.scrollHeight, shown: e.clientHeight, top: e.getBoundingClientRect().top }))

  // The page doesn't scroll; the stages and "Reset to detected grid" under them are in view.
  const screen = await scroll('.screen')
  expect(screen.height).toBeLessThanOrEqual(800)
  const reset = (await page.getByRole('button', { name: 'Reset to detected grid' }).boundingBox())!
  expect(reset.y + reset.height).toBeLessThanOrEqual(800)
  // The colour list does, under its heading, which stays put.
  expect(await page.locator('.palette__entry').count()).toBeGreaterThan(15)
  const pane = await scroll('.palette-pane')
  expect(pane.height).toBeGreaterThan(pane.shown)
  const heading = (await page.locator('.confirm__col--colours .confirm__head').boundingBox())!
  await list.hover()
  await page.mouse.wheel(0, 2000)
  await expect(page.locator('.palette__total')).toBeInViewport()
  expect((await page.locator('.confirm__col--colours .confirm__head').boundingBox())!.y).toBe(heading.y)
  expect(await page.evaluate(() => document.querySelector('.screen')!.scrollTop)).toBe(0)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true })

  test('a colour tapped is shown on the pattern above, until "Show all colours"', async ({ page }) => {
    await importImage(page, CATS)
    await showing(page, 100, 45)
    await expect(page.getByRole('tablist')).toHaveCount(0)
    const cream = page.getByRole('button', { name: /^Cream,/ })
    await cream.tap()
    await expect(cream).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('img', { name: /showing where Cream is used$/ })).toBeAttached()
    await page.getByRole('button', { name: 'Show all colours' }).tap()
    await expect(page.getByRole('img', { name: /^The detected pattern: 100 columns by 45 rows$/ })).toBeAttached()
    await expect(cream).toHaveAttribute('aria-pressed', 'false')
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
