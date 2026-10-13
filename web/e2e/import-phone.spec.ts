/**
 * The import screen on a phone, in Chromium and in WebKit (Safari's engine, which every
 * iPhone browser uses): a tall image, a phone screenshot of a chart, is the usual thing
 * to import there.
 *
 * The stages take the image's shape, capped in height. WebKit once measured the pattern's
 * box at the uncapped height, so the pattern was drawn taller than its stage and its
 * bottom rows were cut off (import.css, .pattern).
 */
import { writeFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { encodePngRgba } from '../src/storage/thumbnail.ts'
import { importImage } from './importing.ts'

test.describe.configure({ timeout: 5 * 60_000 })

// An iPhone 15's page with Safari's toolbars showing (work-phone.spec.ts).
test.use({ viewport: { width: 393, height: 660 }, hasTouch: true, isMobile: true })

test('a tall image: the whole pattern is on its stage, as is the whole image', async ({ page }, testInfo) => {
  // Pixel art 40 blocks wide and 90 tall, an oval of white on green, read block by block.
  const cols = 40
  const rows = 90
  const k = 8
  const rgba = new Uint8Array(cols * k * rows * k * 4)
  for (let y = 0; y < rows * k; y++) {
    for (let x = 0; x < cols * k; x++) {
      const c = Math.floor(x / k)
      const r = Math.floor(y / k)
      const inside = (c - cols / 2) ** 2 / (cols / 3) ** 2 + (r - rows / 2) ** 2 / (rows / 3) ** 2 < 1
      rgba.set(inside ? [255, 255, 255, 255] : [20, 100, 70, 255], (y * cols * k + x) * 4)
    }
  }
  const file = testInfo.outputPath('tall.png')
  writeFileSync(file, encodePngRgba(cols * k, rows * k, rgba))

  await importImage(page, file)
  await expect(page.locator('.confirm__stats')).toHaveText(`${cols} columns × ${rows} rows`)

  const box = async (selector: string) => {
    const b = await page.locator(selector).boundingBox()
    if (!b) throw new Error(`${selector} isn't laid out`)
    return b
  }
  const inside = (inner: { x: number; y: number; width: number; height: number }, outer: typeof inner) => {
    expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5)
    expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5)
    expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5)
    expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5)
  }

  const stage = await box('.confirm__col--pattern .stage')
  // Capped: the image's shape at the column's width would be taller than this.
  expect(stage.height).toBeLessThan((stage.width * rows) / cols - 1)
  const canvas = await box('.pattern__canvas')
  inside(canvas, stage)
  // As big as fits: cells are whole device pixels, and one more for each row wouldn't.
  const dpr = await page.evaluate(() => devicePixelRatio)
  expect(canvas.height + rows / dpr).toBeGreaterThan(stage.height)

  inside(await box('.source__image'), await box('.confirm__col--image .stage'))
})
