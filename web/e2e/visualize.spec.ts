/**
 * "Visualize" on the import screen, in real Chromium on a pattern imported with real
 * Pyodide (dachshund.png, 40 × 24): the button sits between "Yarn & size" and Save, and
 * opens the pattern as fabric in the stitch chosen. The fabric's shape follows the
 * stitch's proportions (single crochet 0.8 as tall as wide, double 2), its colours are the
 * pattern's, and the choice survives closing and reopening.
 */
import { resolve } from 'node:path'

import { expect, test, type Locator } from '@playwright/test'

import { ROOT } from './desktop.ts'
import { importImage } from './importing.ts'

test.describe.configure({ timeout: 5 * 60_000 })

const IMAGE = resolve(ROOT, 'test_images/dachshund.png')

/** The painted part of the canvas: its bounding box in canvas pixels, whether it touches
 *  the canvas's edge, and the colours seen, as #rrggbb, with how many pixels each. */
const painted = (canvas: Locator) =>
  canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!
    const { data, width, height } = ctx.getImageData(0, 0, el.width, el.height)
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    const counts = new Map<string, number>()
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const k = (y * width + x) * 4
        if (data[k + 3]! < 255) continue
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
        const hex = '#' + [data[k]!, data[k + 1]!, data[k + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('')
        counts.set(hex, (counts.get(hex) ?? 0) + 1)
      }
    // Whether it reaches an edge of the canvas, so may be cut off there.
    const edge = x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1
    return { width: x1 - x0 + 1, height: y1 - y0 + 1, edge, colours: [...counts] }
  })

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const near = (a: string, b: string, tol: number) => rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]!) <= tol)

test('see the pattern crocheted, in single and double crochet', async ({ page }) => {
  await importImage(page, IMAGE)
  await expect(page.locator('.confirm__stats')).toContainText('40 columns × 24 rows')
  // Each colour's button names its hex.
  const labels = await page
    .getByRole('list', { name: 'Colours' })
    .locator('.palette__show')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  const palette = labels.map((l) => /#[0-9a-f]{6}/i.exec(l)![0].toLowerCase())
  expect(palette).toHaveLength(4)

  // Between "Yarn & size" and Save, on one line.
  const [yarn, open, save] = await Promise.all(
    ['Yarn & size', 'Visualize', 'Save & edit pattern'].map((name) => page.getByRole('button', { name }).boundingBox()),
  )
  expect(Math.abs(open!.y - save!.y)).toBeLessThan(1)
  expect(yarn!.x).toBeLessThan(open!.x)
  expect(open!.x).toBeLessThan(save!.x)

  await page.getByRole('button', { name: 'Visualize' }).click()
  const dialog = page.getByRole('dialog', { name: 'Visualize' })
  await expect(dialog).toBeVisible()
  const stitch = dialog.getByRole('combobox', { name: 'Stitch' })
  await expect(stitch).toHaveValue('sc')
  await expect(dialog).toContainText('Stitches are 80% as tall as they are wide')
  const canvas = dialog.getByRole('img', { name: 'The pattern, crocheted' })

  // Single crochet: 40 stitches wide, 24 rows of 0.8: the fabric is 40 : 19.2.
  await expect.poll(async () => (await painted(canvas)).width).toBeGreaterThan(100)
  const size = await canvas.evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }))
  const sc = await painted(canvas)
  // Fitted, it sits inside the view, clear of every edge: its shape is all its own.
  expect(sc.edge).toBe(false)
  expect(sc.width / sc.height).toBeGreaterThan((40 / 19.2) * 0.93)
  expect(sc.width / sc.height).toBeLessThan((40 / 19.2) * 1.07)
  // In the pattern's colours: every one of them is drawn, shaded (each has pixels near it).
  for (const hex of palette) expect(sc.colours.some(([c]) => near(c, hex, 40)), hex).toBe(true)

  // Double crochet: rows twice as tall as a stitch is wide: 40 : 48.
  await stitch.selectOption('dc')
  await expect(dialog).toContainText('Stitches are 2 times as tall as they are wide')
  await expect.poll(async () => { const p = await painted(canvas); return p.width / p.height }).toBeLessThan(1)
  const dc = await painted(canvas)
  expect(dc.edge).toBe(false)
  expect(dc.width / dc.height).toBeGreaterThan((40 / 48) * 0.93)
  expect(dc.width / dc.height).toBeLessThan((40 / 48) * 1.07)

  // C2C is always turned, and nothing is carried in it.
  await stitch.selectOption('c2c')
  await expect(dialog.getByRole('radio', { name: 'Right side always facing' })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: 'Show carried yarn' })).toBeDisabled()
  await expect(dialog).toContainText('Stitches are about square')

  // Without a measured swatch, its proportions can't be chosen.
  await expect(dialog.getByRole('radio', { name: 'My swatch' })).toBeDisabled()

  // Zoom in: the fabric outgrows the view, filling it.
  const before = await painted(canvas)
  expect(before.width).toBeLessThan(size.width)
  for (let i = 0; i < 3; i++) await dialog.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(async () => { const p = await painted(canvas); return [p.width, p.height] }).toEqual([size.width, size.height])
  await dialog.getByRole('button', { name: 'Fit' }).click()
  await expect.poll(async () => (await painted(canvas)).width).toBe(before.width)

  // Closed and opened again, it remembers the stitch.
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Visualize' }).click()
  await expect(page.getByRole('dialog', { name: 'Visualize' }).getByRole('combobox', { name: 'Stitch' })).toHaveValue('c2c')
})

test('the swatch from "Yarn & size" sets the proportions', async ({ page }) => {
  await importImage(page, IMAGE)
  await page.getByRole('button', { name: 'Yarn & size' }).click()
  const yarn = page.getByRole('dialog', { name: 'Yarn & size' })
  // 10 stitches in 10 cm, 10 rows in 15 cm: 1.5 times as tall as wide.
  await yarn.getByRole('textbox', { name: 'Width' }).fill('10')
  await yarn.getByRole('textbox', { name: 'Height' }).fill('15')
  await yarn.getByRole('textbox', { name: 'Height' }).blur()
  await yarn.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Visualize' }).click()
  const dialog = page.getByRole('dialog', { name: 'Visualize' })
  await dialog.getByRole('radio', { name: 'My swatch' }).check()
  await expect(dialog).toContainText('Stitches are 1.5 times as tall as they are wide')
  await expect(dialog).toContainText('From your swatch: 10 stitches × 10 rows.')
  const canvas = dialog.getByRole('img', { name: 'The pattern, crocheted' })
  // 40 : 36.
  await expect.poll(async () => { const p = await painted(canvas); return p.width / p.height }).toBeGreaterThan((40 / 36) * 0.93)
  const p = await painted(canvas)
  expect(p.edge).toBe(false)
  expect(p.width / p.height).toBeLessThan((40 / 36) * 1.07)
})
