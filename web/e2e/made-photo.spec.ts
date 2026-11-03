/**
 * A photo of what was made, in a real browser (Chromium, and WebKit as on an iPhone):
 * added in Work once every row is done, kept upright, shrunk and stripped of its EXIF
 * data, shown as the Library card's thumbnail after a reload, exported in the `.alpha`
 * file, and removed again from the Library.
 *
 * fixtures/photos/made-exif.jpg (scripts/gen_made_photo_fixture.py) is 3000 × 2000 as
 * stored, red on the left and blue on the right, with EXIF "rotate 90° clockwise", a
 * camera model and a GPS position.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Locator } from '@playwright/test'
import { unzipSync } from 'fflate'

import { exportFromLibrary, fromCardMenu } from './importing.ts'

const PROJECT = resolve(import.meta.dirname, '../../fixtures/alpha/desktop/with-source.alpha')
const PHOTO = resolve(import.meta.dirname, '../../fixtures/photos/made-exif.jpg')

/** The image's natural size, and the colour of a pixel near its top and its bottom. */
function look(img: Locator) {
  return img.evaluate(async (el: HTMLImageElement) => {
    await el.decode()
    const c = document.createElement('canvas')
    c.width = el.naturalWidth
    c.height = el.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(el, 0, 0)
    const at = (y: number) => [...ctx.getImageData(Math.floor(c.width / 2), y, 1, 1).data.slice(0, 3)]
    return { width: el.naturalWidth, height: el.naturalHeight, top: at(10), bottom: at(c.height - 10) }
  })
}
const reddish = ([r, g, b]: number[]) => r! > 180 && g! < 90 && b! < 90
const bluish = ([r, g, b]: number[]) => b! > 180 && r! < 90 && g! < 110

test('a photo of what you made: added in Work, kept upright and small, shown in the Library, exported, removed', async ({
  page,
}, testInfo) => {
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(PROJECT)
  await page.getByRole('link', { name: 'Open “with-source”' }).click()

  // Finish every row.
  const complete = page.getByRole('button', { name: 'Row complete →' })
  while (await complete.isEnabled()) await complete.click()
  await expect(page.getByText('Every row is done.')).toBeVisible()

  await page.getByLabel('Choose a photo of what you made').setInputFiles(PHOTO)
  const shown = page.getByRole('img', { name: 'What you made from “with-source”' })
  await expect(shown).toBeVisible()
  // Upright (red at the top), and shrunk to 2048 on its long edge.
  const kept = await look(shown)
  expect([kept.width, kept.height]).toEqual([1365, 2048])
  expect(reddish(kept.top), `top ${kept.top}`).toBe(true)
  expect(bluish(kept.bottom), `bottom ${kept.bottom}`).toBe(true)
  // It fits the panel beside the chart.
  const box = (await shown.boundingBox())!
  expect(box.height).toBeLessThanOrEqual(14 * 16 + 1)

  // The Library card shows it, after a reload too.
  await page.goto('/#/library')
  await page.reload()
  const thumb = page.locator('.thumb--made img')
  await expect(thumb).toHaveCount(1)
  const t = await look(thumb)
  expect(Math.max(t.width, t.height)).toBe(480)
  expect(reddish(t.top) && bluish(t.bottom), `thumbnail ${t.top} / ${t.bottom}`).toBe(true)

  // The exported file carries it as made.jpg, without the photo's EXIF data.
  const file = await exportFromLibrary(page, testInfo, 'with-source')
  const made = unzipSync(new Uint8Array(readFileSync(file)))['made.jpg']!
  expect(made.length).toBeGreaterThan(0)
  expect(made.length).toBeLessThan(readFileSync(PHOTO).length * 4)
  const text = new TextDecoder('latin1').decode(made)
  expect(text).not.toContain('Exif')
  expect(text).not.toContain('Test Camera Model')

  // Seen and removed from the card's ⋯.
  await fromCardMenu(page, 'with-source', 'Photo')
  const dialog = page.getByRole('dialog', { name: 'with-source' })
  await expect(dialog.getByRole('img', { name: 'What you made from “with-source”' })).toBeVisible()
  const big = (await dialog.boundingBox())!
  const viewport = page.viewportSize()!
  expect(big.y + big.height).toBeLessThanOrEqual(viewport.height)
  await dialog.getByRole('button', { name: 'Remove' }).click()
  await dialog.getByRole('button', { name: 'Remove' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.thumb--made')).toHaveCount(0)
  await expect(page.locator('.thumb--photo')).toHaveCount(1)
})
