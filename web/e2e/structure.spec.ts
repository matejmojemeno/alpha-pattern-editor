/**
 * The structural panel in real Chromium, with Work-stage progress on the pattern: a
 * border previewed then applied, a done row deleted from the menu on its row number
 * (asking first), padding placed by dragging the pattern on the preview, Export PNG;
 * then the Work stage opens on a sound place, and the desktop opens the file it saved
 * and makes the same PNG. Then the tablet and phone layouts. No Pyodide anywhere.
 */
import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { readAlpha } from '../src/storage/alpha.ts'
import { desktopLoad, desktopPngMatches } from './desktop.ts'

const AXIS_LEFT = 34
const AXIS_TOP = 22

const scroller = (page: Page) => page.getByTestId('design-scroller')
const stats = (page: Page) => page.locator('.design__stats')
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true })

async function cellCentre(page: Page, r: number, c: number) {
  const box = (await scroller(page).boundingBox())!
  const cell = Number(await scroller(page).getAttribute('data-cell'))
  return { x: box.x + AXIS_LEFT + c * cell + cell / 2, y: box.y + AXIS_TOP + r * cell + cell / 2 }
}

/** A 12 × 10 white pattern with black rows at image rows 1, 4 and 8. */
async function banner(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Design pattern/ }).click()
  const dialog = page.getByRole('dialog', { name: 'New pattern' })
  await dialog.getByLabel('Name').fill('Banner')
  await dialog.getByLabel('Columns').fill('12')
  await dialog.getByLabel('Rows').fill('10')
  await dialog.getByLabel('Colour').fill('#ffffff')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Banner' })).toBeVisible()
  // On a tablet the colours are in a drawer.
  const drawer = page.getByRole('button', { name: 'Colours', exact: true })
  const compact = await drawer.isVisible()
  if (compact) await drawer.click()
  await page.getByLabel('Colour to add').fill('#000000')
  await page.getByRole('button', { name: 'Add colour' }).click()
  if (compact) await page.getByRole('button', { name: 'Close' }).click()
  await page.keyboard.press('h')
  for (const r of [1, 4, 8]) {
    const p = await cellCentre(page, r, 3)
    await page.mouse.click(p.x, p.y)
  }
  await page.keyboard.press('b')
  const p = await cellCentre(page, 6, 6)
  await page.mouse.click(p.x, p.y)
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
}

test('structural edits with rows done in Work, and the desktop opens the result', async ({ page }, testInfo) => {
  const pyodide: string[] = []
  page.on('request', (r) => /pyodide|alphareader-core/i.test(r.url()) && pyodide.push(r.url()))
  await banner(page)
  const id = page.url().split('/').at(-1)!

  // --- three rows done in the Work stage, then back to Design ----------------------------------------
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(new RegExp(`#/work/${id}$`))
  await expect(page.locator('.work__row')).toHaveText(/^Row 1 of 10/)
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(page.locator('.work__row')).toHaveText(/^Row 4 of 10/)
  await page.getByText('Options').click()
  await page.getByRole('button', { name: 'Edit pattern…' }).click()
  await expect(page).toHaveURL(new RegExp(`#/design/${id}$`))
  await expect(page.getByText(/You're 3 rows into this project/)).toBeVisible()

  // --- a border: previewed on the canvas, then applied ---------------------------------------------------
  await page.getByRole('button', { name: 'Border', expanded: false }).click()
  await field(page, 'Top').fill('2')
  await expect(page.getByRole('img', { name: 'Preview, 16 by 14' })).toBeVisible()
  await expect(scroller(page)).toHaveAttribute('data-mode', 'view')
  await expect(page.getByText('Result: 16 × 14')).toBeVisible()
  // Painting is off while previewing: a press on the chart changes nothing.
  const off = await cellCentre(page, 5, 5)
  await page.mouse.click(off.x, off.y)
  await expect(stats(page)).toHaveText(/^12 cols × 10 rows/)
  await page.getByRole('button', { name: 'Apply border' }).click()
  await expect(stats(page)).toHaveText(/^16 cols × 14 rows/)
  await expect(page.getByRole('img', { name: 'Pattern, 16 by 14' })).toBeVisible()

  // A removal that cuts into the art asks first; Cancel leaves it be.
  await page.getByRole('button', { name: 'Border', expanded: false }).click()
  await field(page, 'Top').fill('-4')
  await expect(page.getByRole('img', { name: 'Preview, 16 by 14' })).toBeVisible()
  await expect(page.getByText('Result: 8 × 6')).toBeVisible()
  await page.getByRole('button', { name: 'Apply border' }).click()
  const ask = page.getByRole('alertdialog', { name: 'Remove part of the pattern?' })
  await expect(ask).toContainText('aren’t all one colour')
  await expect(ask).toContainText('you’ve marked done')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(stats(page)).toHaveText(/^16 cols × 14 rows/)
  await page.getByRole('button', { name: 'Border', expanded: true }).click()

  // --- a done row deleted from the menu on its number ------------------------------------------------------
  // Working row 3 is the first row done before the border (image row 14 - 3 = 11).
  const box = (await scroller(page).boundingBox())!
  const row = await cellCentre(page, 11, 0)
  await page.mouse.click(box.x + AXIS_LEFT / 2, row.y)
  const menu = page.getByRole('menu', { name: 'Row 3' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Delete row 3' }).click()
  const del = page.getByRole('alertdialog', { name: 'Delete a row you’ve worked?' })
  await expect(del).toContainText('This removes 1 row you’ve marked done in the Work stage.')
  await del.getByRole('button', { name: 'Delete row' }).click()
  await expect(stats(page)).toHaveText(/^16 cols × 13 rows/)
  await expect(page.locator('.design__message')).toHaveText('Deleted row 3.')
  // The menu also inserts, and Escape closes it.
  const col = await cellCentre(page, 0, 4)
  await page.mouse.click(col.x, box.y + AXIS_TOP / 2)
  await expect(page.getByRole('menu', { name: 'Column 5' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // --- padding, placed by dragging the pattern on the preview ------------------------------------------------
  await page.getByRole('button', { name: 'Pad to size', expanded: false }).click()
  await field(page, 'Width').fill('20')
  await field(page, 'Height').fill('15')
  await expect(field(page, 'Left')).toHaveValue('2')
  await expect(field(page, 'Top')).toHaveValue('1')
  await expect(scroller(page)).toHaveAttribute('data-mode', 'move')
  const from = await cellCentre(page, 6, 8)
  const to = await cellCentre(page, 7, 10)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.move(to.x + 400, to.y + 400, { steps: 4 }) // past the edge: stops at it
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
  await expect(field(page, 'Left')).toHaveValue('4')
  await expect(field(page, 'Top')).toHaveValue('2')
  await expect(page.getByText('Adds 4 left, 0 right, 2 top, 0 bottom.')).toBeVisible()
  await page.getByRole('button', { name: 'Apply padding' }).click()
  await expect(stats(page)).toHaveText(/^20 cols × 15 rows/)

  // --- Export PNG ----------------------------------------------------------------------------------------------------
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()])
  expect(download.suggestedFilename()).toBe('Banner.png')
  const png = testInfo.outputPath('Banner.png')
  await download.saveAs(png)
  expect([...readFileSync(png).subarray(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG')

  // --- back to Work: a sound place --------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page).toHaveURL(new RegExp(`#/work/${id}$`))
  await expect(page.locator('.work__row')).toHaveText(/^Row \d+ of 15/)
  await expect(page.getByRole('button', { name: 'Row complete →' })).toBeEnabled()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // --- the desktop opens what was saved, and makes the same PNG ------------------------------------------------------
  await page.goto('/#/library')
  const card = page.getByRole('listitem').filter({ hasText: 'Banner' })
  const [file] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Export “Banner”' }).click()])
  const alpha = testInfo.outputPath(file.suggestedFilename())
  await file.saveAs(alpha)
  const web = readAlpha(new Uint8Array(readFileSync(alpha))).project
  const desktop = desktopLoad(alpha)
  expect([desktop.cols, desktop.rows, desktop.stage]).toEqual([20, 15, 'work'])
  expect(desktop.cells).toEqual([...web.pattern.cells])
  expect(desktop.row_ids).toEqual(web.pattern.row_ids)
  expect(desktop.completed).toBe(2)
  expect(desktop.completed_row_ids.every((r) => desktop.row_ids.includes(r))).toBe(true)
  expect(desktop.row_ids).toContain(desktop.current_row_id)
  expect(desktopPngMatches(alpha, png)).toMatchObject({ same: true, desktop: [15 * 16 + 1, 20 * 16 + 1, 3] })

  expect(pyodide).toEqual([])
})

test.describe('on a tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true })

  test('the tools are a toolbar, colours and structure are drawers, and the chart keeps the screen', async ({ page }) => {
    await banner(page)
    const toolbar = page.getByRole('toolbar', { name: 'Tools' })
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('button', { name: /^Fill row/ })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Palette' })).toHaveCount(0)
    const canvas = (await page.locator('.design__canvas').boundingBox())!
    expect(canvas.width).toBeGreaterThan(900)

    await page.getByRole('button', { name: 'Colours' }).click()
    await expect(page.getByRole('complementary', { name: 'Colours' }).getByRole('list', { name: 'Palette' })).toBeVisible()
    await page.getByRole('button', { name: 'Structure' }).click()
    const drawer = page.getByRole('complementary', { name: 'Structure' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Border', expanded: false }).click()
    await expect(page.getByRole('img', { name: 'Preview, 14 by 12' })).toBeVisible()
    // The preview goes with the panel.
    await page.getByRole('button', { name: 'Colours' }).click()
    await expect(page.getByRole('img', { name: 'Pattern, 12 by 10' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('complementary', { name: 'Colours' })).toHaveCount(0)

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
  })

  test('narrower than 700 px, it says it needs a larger screen, and offers the Work stage', async ({ page }) => {
    await banner(page)
    await page.setViewportSize({ width: 500, height: 800 })
    await expect(page.getByRole('heading', { name: 'The Design stage needs a larger screen' })).toBeVisible()
    await expect(page.getByRole('link', { name: '← Library' })).toBeVisible()
    // Wide again: the editor is as it was, undo and all.
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    await page.setViewportSize({ width: 500, height: 800 })
    await page.getByRole('button', { name: 'Start working →' }).click()
    await expect(page.locator('.work__row')).toHaveText(/^Row 1 of 10/)
  })
})
