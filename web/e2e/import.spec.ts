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

import { expect, test } from '@playwright/test'

import { readAlpha } from '../src/storage/alpha.ts'
import { encodePngRgba } from '../src/storage/thumbnail.ts'
import { desktopDetect, desktopLoad, ROOT } from './desktop.ts'
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
  await expect(page.getByText(`${want.cols} cols × ${want.rows} rows`)).toBeVisible()
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
  await expect(page.getByLabel('Name')).toHaveValue('cats')

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

test('an image that is not a chart gets the friendly hint', async ({ page }, testInfo) => {
  // A smooth left-to-right gradient: nothing periodic to find (as in test_bridge.py).
  const [w, h] = [320, 240]
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round((255 * x) / (w - 1))
      rgba.set([v, v, v, 255], (y * w + x) * 4)
    }
  const file = testInfo.outputPath('gradient.png')
  writeFileSync(file, encodePngRgba(w, h, rgba))

  const { alert } = await importImage(page, file)
  await expect(alert).toContainText("I couldn't find the grid in this image.")
  await expect(alert).toContainText('Detection failed (NO_GRIDLINES)')
  await expect(alert.getByRole('button', { name: 'Try another image' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'The image being imported' })).toBeVisible()

  // Trying another image from there works, and a too-coarse chart gets its own hint.
  await page.getByLabel('Choose a chart image').first().setInputFiles(resolve(IMAGES, 'garment.png'))
  await expect(page.getByRole('alert')).toContainText('This image is too small to read reliably.', { timeout: DETECT_TIMEOUT })
  await expect(page.getByRole('alert')).toContainText('Detection failed (LOW_RESOLUTION)')
})

test('a pasted image is imported as “Pasted pattern”', async ({ page }) => {
  await page.goto('/')
  const bytes = readFileSync(resolve(IMAGES, 'dachshund.png')).toString('base64')
  await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
    const data = new DataTransfer()
    data.items.add(new File([blob], 'image.png', { type: 'image/png' }))
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
  }, bytes)
  await expect(page.getByRole('heading', { level: 1, name: 'Import pattern' })).toBeVisible()
  await expect(page.getByLabel('Name')).toHaveValue('Pasted pattern', { timeout: DETECT_TIMEOUT })
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
