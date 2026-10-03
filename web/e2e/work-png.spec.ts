/**
 * The Work stage's Export PNG in real Chromium: the picture is the chart with the stitch
 * numbers and carried strands when they're on, and nothing about progress. No outline on
 * the current row, no wash over finished ones, no taller rows, and focus mode and the
 * app's theme make no difference to it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { CHART_PNG_CELL } from '../src/render/chartPng.ts'
import { AXIS_LEFT, AXIS_TOP, PAD } from '../src/render/layout.ts'
import { readAlpha } from '../src/storage/alpha.ts'

const BASIC = resolve(import.meta.dirname, '../../fixtures/alpha/desktop/basic.alpha')
const basic = readAlpha(new Uint8Array(readFileSync(BASIC))).project.pattern
/** The current row's outline (tokens.css --accent). */
const ACCENT = [240, 168, 0]

async function openWork(page: Page) {
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(BASIC)
  await page.getByRole('listitem').filter({ hasText: basic.name }).getByRole('link').click()
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page.getByRole('heading', { level: 1, name: basic.name })).toBeVisible()
}

const options = (page: Page) => page.locator('.work__options summary')

/** Set a Chart switch in Options, leaving the menu closed. */
async function setSwitch(page: Page, name: string, on: boolean) {
  await options(page).click()
  await page.getByRole('switch', { name }).setChecked(on)
  await options(page).click()
}

/** Options → Export PNG: the file's name and bytes. */
async function exportPng(page: Page): Promise<{ name: string; bytes: Buffer }> {
  await options(page).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()])
  return { name: download.suggestedFilename(), bytes: readFileSync((await download.path())!) }
}

interface Look {
  width: number
  height: number
  /** Cells whose inside is all their own colour, and cells with anything else in. */
  plain: number
  marked: number
  /** Pixels in the outline's colour. */
  accent: number
}

/** Decode the PNG in the page and look at it cell by cell. */
async function look(page: Page, bytes: Buffer): Promise<Look> {
  const rgb = basic.palette.map((e) => [1, 3, 5].map((i) => parseInt(e.hex.slice(i, i + 2), 16)))
  return page.evaluate(
    async ({ b64, rgb, cells, rows, cols, cell, left, top, accent }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, img.width, img.height).data
      const at = (x: number, y: number) => [d[(y * img.width + x) * 4]!, d[(y * img.width + x) * 4 + 1]!, d[(y * img.width + x) * 4 + 2]!]
      const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
      let plain = 0
      let marked = 0
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const want = rgb[cells[r * cols + c]!]!
          let ok = true
          // Inside the gridlines: 1 px on each cell's top and left, and the closing line on
          // the last pixel of the last row and column, so leave out every edge.
          for (let y = top + r * cell + 1; y < top + (r + 1) * cell - 1 && ok; y++)
            for (let x = left + c * cell + 1; x < left + (c + 1) * cell - 1 && ok; x++) ok = same(at(x, y), want)
          if (ok) plain++
          else marked++
        }
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] === accent[0] && d[i + 1] === accent[1] && d[i + 2] === accent[2]) n++
      return { width: img.width, height: img.height, plain, marked, accent: n }
    },
    {
      b64: bytes.toString('base64'),
      rgb,
      cells: [...basic.cells],
      rows: basic.rows,
      cols: basic.cols,
      cell: CHART_PNG_CELL,
      left: AXIS_LEFT,
      top: AXIS_TOP,
      accent: ACCENT,
    },
  )
}

test('Export PNG draws the chart with numbers and carried yarn when on, and never progress', async ({ page }) => {
  expect(basic.palette.map((e) => e.hex.toLowerCase())).not.toContain('#f0a800')
  const cells = basic.rows * basic.cols
  await openWork(page)

  // Numbers off and carrying off: the plain chart, every stitch its own colour.
  await setSwitch(page, 'Number the stitches', false)
  const plain = await exportPng(page)
  expect(plain.name).toBe(`${basic.name}.png`)
  expect(await look(page, plain.bytes)).toEqual({
    width: AXIS_LEFT + PAD + basic.cols * CHART_PNG_CELL,
    height: AXIS_TOP + PAD + basic.rows * CHART_PNG_CELL,
    plain: cells,
    marked: 0,
    accent: 0,
  })

  // Rows done, a row partway, focus mode and taller rows: still the very same picture.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.work__row')).toContainText('Row 3 of 5')
  await page.locator('.chip__open').first().click()
  await page.getByRole('dialog', { name: 'Record progress' }).getByRole('button', { name: 'Mark segment complete' }).click()
  await setSwitch(page, 'Focus mode', true)
  await setSwitch(page, 'Enlarge the current row', true)
  expect((await exportPng(page)).bytes.equals(plain.bytes)).toBe(true)

  // ...and in the dark theme.
  await page.emulateMedia({ colorScheme: 'dark' })
  expect((await exportPng(page)).bytes.equals(plain.bytes)).toBe(true)
  await page.emulateMedia({ colorScheme: 'light' })

  // Stitch numbers: on every stitch, small as this chart is.
  await setSwitch(page, 'Number the stitches', true)
  const numbered = await exportPng(page)
  expect(await look(page, numbered.bytes)).toMatchObject({ plain: 0, marked: cells, accent: 0 })

  // Carried yarn: strands over some stitches.
  await setSwitch(page, 'Number the stitches', false)
  await setSwitch(page, 'Show where to carry yarn', true)
  const carried = await look(page, (await exportPng(page)).bytes)
  expect(carried.marked).toBeGreaterThan(0)
  expect(carried.plain).toBeGreaterThan(0)
  expect(carried.accent).toBe(0)
})
