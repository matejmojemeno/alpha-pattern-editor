/**
 * Importing from an image in real Chromium, with real Pyodide in the real worker,
 * checked against what the desktop code makes of the same file
 * (scripts/desktop_import.py): detect_pattern → ConfirmState.from_detection → preview →
 * pattern_from_preview.
 *
 * Needs the repo's Python (.venv, or $PYTHON) with numpy and Pillow for the reference
 * (desktop.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type TestInfo } from '@playwright/test'

import { readAlpha } from '../src/storage/alpha.ts'
import { encodePngRgba } from '../src/storage/thumbnail.ts'
import { desktopDetect, desktopLoad, desktopPicture, ROOT, type DesktopPattern } from './desktop.ts'
import { DETECT_TIMEOUT, exportFromLibrary, importImage, saveAs } from './importing.ts'

const IMAGES = resolve(ROOT, 'test_images')

const summary = (d: { rows: number; cols: number; palette: unknown[] }) => `${d.cols}×${d.rows}, ${d.palette.length} colours`

test.describe.configure({ timeout: 5 * 60_000 })

test('PNG: the saved pattern is exactly what the desktop makes of the same file', async ({ page }, testInfo) => {
  const file = resolve(IMAGES, 'dachshund.png')
  const want = desktopDetect(file)
  expect(want.ok).toBe(true)

  const { save } = await importImage(page, file)
  await expect(save).toBeVisible()
  await expect(page.locator(".confirm__stats")).toHaveText(`${want.cols} columns × ${want.rows} rows`)
  await saveAs(page, 'Dachshund')

  const saved = readAlpha(new Uint8Array(readFileSync(await exportFromLibrary(page, testInfo, 'Dachshund')))).project.pattern
  expect([saved.cols, saved.rows]).toEqual([want.cols, want.rows])
  expect([...saved.cells]).toEqual(want.cells)
  expect(saved.palette.map((e) => [e.hex, e.name, e.count])).toEqual(want.palette)
})

test('JPEG: browser and desktop decoders may differ, so report rather than fail', async ({ page }, testInfo) => {
  const jpegs = ['bug.jpg', 'failed/bunny.jpg', 'failed/face.jpg', 'failed/lisa.jpg', 'failed/shizuku.jpg']
  const report: string[] = []
  for (const [i, jpeg] of jpegs.entries()) {
    const file = resolve(IMAGES, jpeg)
    const want = desktopDetect(file)
    const { save, alert } = await importImage(page, file)
    let line: string
    if (await alert.isVisible()) {
      const code = /Detection failed \((\w+)\)/.exec((await alert.textContent()) ?? '')?.[1]
      line = want.ok ? `web failed (${code}), desktop found ${summary(want)}` : `both failed (web ${code}, desktop ${want.code})`
    } else {
      await expect(save).toBeVisible()
      const name = `JPEG ${i}`
      await saveAs(page, name)
      const got = readAlpha(new Uint8Array(readFileSync(await exportFromLibrary(page, testInfo, name)))).project.pattern
      if (!want.ok) line = `web found ${got.cols}×${got.rows}, desktop failed (${want.code})`
      else if (got.rows !== want.rows || got.cols !== want.cols) line = `size differs: web ${got.cols}×${got.rows}, desktop ${want.cols}×${want.rows}`
      else {
        const differ = [...got.cells].filter((c, k) => c !== want.cells[k]).length
        const palette = JSON.stringify(got.palette.map((e) => [e.hex, e.name, e.count])) === JSON.stringify(want.palette)
        line =
          differ === 0 && palette
            ? `identical (${summary(want)})`
            : `same size ${want.cols}×${want.rows}; ${differ} of ${want.cells.length} cells differ; palette ${palette ? 'identical' : `web ${got.palette.length} vs desktop ${want.palette.length} colours`}`
      }
    }
    report.push(`${jpeg}: ${line}`)
    console.log(`JPEG parity — ${jpeg}: ${line}`)
  }
  testInfo.annotations.push({ type: 'JPEG parity', description: report.join('\n') })
})

test('the whole flow: import, save, Design, Row 1, reload, export, and the desktop reads it', async ({ page }, testInfo) => {
  const file = resolve(IMAGES, 'cats.png')
  const want = desktopDetect(file)
  const { save } = await importImage(page, file)
  await expect(save).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Pattern name' })).toHaveAttribute('placeholder', 'Untitled pattern')

  // Detection never happens outside the import screen.
  const requests: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && requests.push(r.url()))

  await saveAs(page, 'Cats')
  // A fresh detection opens in the Design stage, to be cleaned up first (§7.3).
  await expect(page).toHaveURL(/#\/design\//)
  await expect(page.locator('.design__stats')).toHaveText(new RegExp(`^${want.cols} cols × ${want.rows} rows`))
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(/#\/work\//)
  await expect(page.locator('.work__row')).toHaveText(/^Row 1 of 45/)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.work__row')).toHaveText(/^Row 2 of 45/)
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Cats' })).toBeVisible()
  await expect(page.locator('.work__row')).toHaveText(/^Row 2 of 45/)

  const exported = await exportFromLibrary(page, testInfo, 'Cats')
  expect(requests).toEqual([])

  // The desktop's own loader opens it: the pattern, the progress, and the full-size source.
  const got = desktopLoad(exported)
  expect(got).toMatchObject({ name: 'Cats', stage: 'work', completed: 1, rows: want.rows, cols: want.cols })
  expect(got.cells).toEqual(want.cells)
  const { width, height } = await page.evaluate(
    async (src) => {
      const bitmap = await createImageBitmap(await (await fetch(src)).blob())
      return { width: bitmap.width, height: bitmap.height }
    },
    `data:image/png;base64,${readFileSync(file).toString('base64')}`,
  )
  expect(got.source).toEqual([height, width, 3])
  // A PNG is kept byte for byte.
  expect(readAlpha(new Uint8Array(readFileSync(exported))).sourcePng).toEqual(new Uint8Array(readFileSync(file)))
})

test('a JPEG is kept as a full-size PNG the desktop can read', async ({ page }, testInfo) => {
  const file = resolve(IMAGES, 'bug.jpg')
  const { save } = await importImage(page, file)
  await expect(save).toBeVisible()
  await saveAs(page, 'Bug')
  const got = desktopLoad(await exportFromLibrary(page, testInfo, 'Bug'))
  expect(got.source).toEqual([716, 430, 3])
})

/** An opaque picture with no grid in it: smooth colour gradients and a small dark disc
 *  (a 'pupil'), as in test_convert.py. Written as a PNG, so the browser and Pillow decode
 *  the same pixels. */
function pictureFile(testInfo: TestInfo, name = 'picture.png', [w, h] = [320, 240]): string {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const disc = (x - 200) ** 2 + (y - 100) ** 2 < 81
      const px = disc ? [20, 20, 30] : [120 + (100 * x) / w, 90 + (120 * y) / h, 160 - (60 * x) / w].map(Math.round)
      rgba.set([...px, 255], (y * w + x) * 4)
    }
  const file = testInfo.outputPath(name)
  writeFileSync(file, encodePngRgba(w, h, rgba))
  return file
}

/** A saved pattern's size, cells and colours, to compare with `desktopPicture`'s. */
const cellsOf = (p: { cols: number; rows: number; cells: ArrayLike<number>; palette: readonly { hex: string; count: number }[] }) => ({
  size: [p.cols, p.rows],
  cells: Array.from(p.cells),
  palette: p.palette.map((e) => [e.hex, e.count]),
})
const desktopCells = (d: DesktopPattern) => ({
  size: [d.cols, d.rows],
  cells: d.cells,
  palette: d.palette.map(([hex, , count]) => [hex, count]),
})

test('an image that is not a chart is turned into a pattern, exactly as the Python makes it', async ({ page }, testInfo) => {
  const file = pictureFile(testInfo)
  const want = desktopPicture(file)
  expect(want.kind).toBe('picture')

  const { save } = await importImage(page, file)
  await expect(save).toBeEnabled()
  await expect(page.locator('.confirm__kind')).toContainText('This looks like a picture, not a chart, so it was turned into a pattern.')
  const settings = page.getByRole('group', { name: 'Picture settings' })
  await expect(settings).toContainText('60 stitches')
  await expect(page.locator('.confirm__stats')).toHaveText(`${want.cols} columns × ${want.rows} rows`)
  await saveAs(page, 'Gradient')

  const saved = readAlpha(new Uint8Array(readFileSync(await exportFromLibrary(page, testInfo, 'Gradient')))).project.pattern
  expect(cellsOf(saved)).toEqual(desktopCells(want))
})

test("a picture's width, colours and detail give what the Python gives", async ({ page }, testInfo) => {
  const file = pictureFile(testInfo)
  const want = desktopPicture(file, ['width=40', 'colours=5', 'detail=0.2'])

  await importImage(page, file)
  const settings = page.getByRole('group', { name: 'Picture settings' })
  await settings.getByLabel('Width').fill('40')
  await expect(page.locator('.confirm__stats')).toHaveText('40 columns × 30 rows', { timeout: DETECT_TIMEOUT })
  await page.getByRole('button', { name: 'Fewer colours' }).click()
  await expect(page.getByRole('heading', { level: 2, name: /^Colours, 5 colours$/ })).toBeVisible({ timeout: DETECT_TIMEOUT })
  await settings.getByLabel('Detail').fill('0.2')
  await expect(settings).toContainText('Smoothest')
  await saveAs(page, 'Settings')

  const saved = readAlpha(new Uint8Array(readFileSync(await exportFromLibrary(page, testInfo, 'Settings')))).project.pattern
  expect(cellsOf(saved)).toEqual(desktopCells(want))
})

test('a chart can be turned into a pattern and back, and is saved as read', async ({ page }, testInfo) => {
  const file = resolve(IMAGES, 'dachshund.png')
  const want = desktopDetect(file)
  const { save } = await importImage(page, file)
  await expect(save).toBeEnabled()
  const kind = page.locator('.confirm__kind')
  await expect(kind).toContainText('Read from the squares of your chart.')
  await kind.getByRole('button', { name: 'Turn it into a pattern instead' }).click()
  await expect(page.getByRole('group', { name: 'Picture settings' })).toBeVisible({ timeout: DETECT_TIMEOUT })
  await expect(page.getByRole('button', { name: 'Use the whole picture' })).toBeVisible()
  await kind.getByRole('button', { name: 'Read it as a chart instead' }).click()
  await expect(page.getByRole('group', { name: 'Picture settings' })).toBeHidden({ timeout: DETECT_TIMEOUT })
  await expect(page.locator('.confirm__stats')).toHaveText(`${want.cols} columns × ${want.rows} rows`)
  await saveAs(page, 'Back')
  const saved = readAlpha(new Uint8Array(readFileSync(await exportFromLibrary(page, testInfo, 'Back')))).project.pattern
  expect([...saved.cells]).toEqual(want.cells)
})

test("a chart too fine to read keeps its hint, and can be turned into a pattern anyway", async ({ page }, testInfo) => {
  const file = resolve(IMAGES, 'garment.png')
  const { alert } = await importImage(page, file)
  await expect(alert).toContainText('This image is too small to read reliably.')
  await expect(alert).toContainText('Detection failed (LOW_RESOLUTION)')
  await expect(page.getByRole('img', { name: 'The image being imported' })).toBeVisible()
  await alert.getByRole('button', { name: 'Turn it into a pattern anyway' }).click()
  await expect(page.getByRole('group', { name: 'Picture settings' })).toBeVisible({ timeout: DETECT_TIMEOUT })
  await saveAs(page, 'Garment')
  const want = desktopPicture(file)
  const saved = readAlpha(new Uint8Array(readFileSync(await exportFromLibrary(page, testInfo, 'Garment')))).project.pattern
  expect(cellsOf(saved)).toEqual(desktopCells(want))

  // Trying another image from there works.
  await page.goto('/')
  const next = await importImage(page, pictureFile(testInfo, 'next.png'))
  await expect(next.save).toBeEnabled()
})

test('a transparent picture is on white, as the Python flattens it', async ({ page }, testInfo) => {
  const file = resolve(IMAGES, 'pictures', 'smiley.png')
  const want = desktopPicture(file)
  const { save } = await importImage(page, file)
  await expect(save).toBeEnabled()
  await saveAs(page, 'Smiley')
  const saved = readAlpha(new Uint8Array(readFileSync(await exportFromLibrary(page, testInfo, 'Smiley')))).project.pattern
  expect([saved.cols, saved.rows]).toEqual([want.cols, want.rows])
  const differ = [...saved.cells].filter((c, i) => saved.palette[c]!.hex !== want.palette[want.cells[i]!]![0]).length
  testInfo.annotations.push({ type: 'smiley stitches that differ', description: String(differ) })
  // The background is a white colour of its own (not pure #ffffff: the anti-aliased edge
  // is averaged into it), as the Python makes it, stitch for stitch.
  expect(saved.palette.map((e) => [e.hex, e.name])).toEqual(want.palette.map(([hex, name]) => [hex, name]))
  expect(saved.palette.map((e) => e.name)).toContain('White')
  expect(differ).toBe(0)
})

test('a pasted image saved without a name is named by the moment it was saved', async ({ page }) => {
  await page.goto('/')
  const bytes = readFileSync(resolve(IMAGES, 'dachshund.png')).toString('base64')
  await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
    const data = new DataTransfer()
    data.items.add(new File([blob], 'image.png', { type: 'image/png' }))
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
  }, bytes)
  await expect(page.getByRole('heading', { level: 1, name: 'Import pattern' })).toBeVisible()
  const name = page.getByRole('textbox', { name: 'Pattern name' })
  await expect(name).toHaveValue('')
  await expect(name).toHaveAttribute('placeholder', 'Untitled pattern')
  const save = page.getByRole('button', { name: 'Save & edit pattern' })
  await expect(save).toBeEnabled({ timeout: DETECT_TIMEOUT })
  await save.click()
  await expect(page.getByRole('heading', { level: 1, name: /^\d{4}-\d\d-\d\d-\d{6}$/ })).toBeVisible()
})

test('hovering Import pattern starts the download; the landing screen alone makes no Pyodide requests', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && requests.push(new URL(r.url()).pathname))
  await page.goto('/')
  await page.getByRole('heading', { level: 1, name: 'Alpha Pattern Editor' }).focus()
  await page.waitForTimeout(500)
  expect(requests).toEqual([])
  await page.getByRole('button', { name: /Import pattern/ }).hover()
  await expect.poll(() => requests.some((u) => u.endsWith('pyodide.asm.wasm')), { timeout: 30_000 }).toBe(true)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true })

  test('the result fits the width, and saving is within reach', async ({ page }) => {
    await importImage(page, resolve(IMAGES, 'monkeys.png'))
    const save = page.getByRole('button', { name: 'Save & edit pattern' })
    await expect(save).toBeVisible()
    await save.scrollIntoViewIfNeeded()
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
    await save.click()
    // Design needs a larger screen than a phone's: it says so, and offers the Work stage.
    await expect(page.getByRole('heading', { name: 'The Design stage needs a larger screen' })).toBeVisible()
    await page.getByRole('button', { name: 'Start working →' }).click()
    await expect(page.locator('.work__row')).toHaveText(/^Row 1 of/)
  })
})
