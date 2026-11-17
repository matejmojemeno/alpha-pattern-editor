/**
 * Projects with pieces in a real browser: the groups store survives a reload, Work
 * switches between pieces keeping each one's progress, and a project's exported .zip
 * imports into an empty Library as the same project, each piece byte for byte.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { unzipSync, strFromU8 } from 'fflate'
import { expect, test } from '@playwright/test'

import { palette } from './colours.ts'
import { fromCardMenu } from './importing.ts'

const DESKTOP = resolve(import.meta.dirname, '../../fixtures/alpha/desktop')
const BASIC = resolve(DESKTOP, 'basic.alpha')
const WITH_SOURCE = resolve(DESKTOP, 'with-source.alpha')

test('make a project, work its pieces, reload, export, and import it into an empty Library', async ({ page, browser }, testInfo) => {
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles([BASIC, WITH_SOURCE])
  const cards = page.locator('.cards > li')
  await expect(cards).toHaveCount(2)

  // basic into a new project, then with-source into the same one.
  await fromCardMenu(page, 'basic', 'Add to a project…')
  await page.getByLabel('New project’s name').fill('Sweater')
  await page.getByRole('button', { name: 'Add' }).click()
  await fromCardMenu(page, 'with-source', 'Add to a project…')
  await page.getByRole('radio', { name: 'Sweater' }).check()
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(cards).toHaveCount(1)
  const project = cards.first()
  await expect(project).toContainText('2 pieces: basic, with-source')
  await expect(project).toContainText('19% done')

  // Still one project after a real reload: the groups store is in IndexedDB.
  await page.reload()
  await expect(project).toContainText('2 pieces: basic, with-source')

  // Continue opens with-source, the piece with progress; switch to basic and record a row.
  await project.getByRole('link', { name: 'Continue “Sweater”' }).click()
  const picker = page.getByRole('combobox', { name: 'Piece of “Sweater”' })
  await expect(page.getByRole('heading', { level: 1, name: 'with-source' })).toBeVisible()
  await picker.selectOption({ label: 'basic (0%)' })
  await expect(page.getByRole('heading', { level: 1, name: 'basic' })).toBeVisible()
  await page.getByRole('button', { name: 'Row complete →' }).click()
  await expect(page.locator('.work__saved')).toHaveText('Saved')
  // Back to with-source: its own place is kept, and basic's row shows in the switcher.
  await picker.selectOption({ label: 'with-source (33%)' })
  await expect(page.getByRole('heading', { level: 1, name: 'with-source' })).toBeVisible()
  await expect(picker.locator('option', { hasText: 'basic' })).toHaveText('basic (20%)')
  await expect(page.locator('.work__row')).toHaveText(/^Row 3 of 6/)

  // Back to the project: (16 + 7) of 83 stitches is 27.7%, shown as 28%.
  await page.getByRole('link', { name: /Sweater/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sweater' })).toBeVisible()
  await expect(page.locator('.group__summary')).toHaveText('2 pieces28% done')

  // Export: a zip of project.json and the two .alpha files as stored.
  await page.locator('.topbar__actions').getByRole('button', { name: 'More for “Sweater”' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export' }).click()])
  expect(download.suggestedFilename()).toMatch(/^sweater-[0-9a-f]{6}\.zip$/)
  const path = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(path)
  const files = unzipSync(new Uint8Array(readFileSync(path)))
  const manifest = JSON.parse(strFromU8(files['project.json']!)) as { name: string; pieces: { file: string; label: string }[] }
  expect(manifest.name).toBe('Sweater')
  expect(manifest.pieces.map((p) => p.label)).toEqual(['basic', 'with-source'])
  // with-source wasn't changed, so its piece is the imported file, byte for byte.
  expect(files[manifest.pieces[1]!.file]).toEqual(new Uint8Array(readFileSync(WITH_SOURCE)))

  // Into a fresh browser profile, with its own empty storage.
  const other = await browser.newContext()
  try {
    const fresh = await other.newPage()
    await fresh.goto('/#/library')
    await expect(fresh.getByText('No projects yet.')).toBeVisible()
    await fresh.getByLabel('Choose a pattern file or chart image to import').setInputFiles(path)
    await expect(fresh.getByRole('status')).toContainText('Imported the project “Sweater”, 2 pieces.')
    const card = fresh.locator('.cards > li')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('28% done')
  } finally {
    await other.close()
  }
})

test('the links between pieces: a new piece from the swatch, the pieces first in Design, the same colours', async ({ page }) => {
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles([BASIC, WITH_SOURCE])
  const cards = page.locator('.cards > li')
  await expect(cards).toHaveCount(2)
  await fromCardMenu(page, 'basic', 'Add to a project…')
  await page.getByLabel('New project’s name').fill('Sweater')
  await page.getByRole('button', { name: 'Add' }).click()
  await fromCardMenu(page, 'with-source', 'Add to a project…')
  await page.getByRole('radio', { name: 'Sweater' }).check()
  await page.getByRole('button', { name: 'Add' }).click()
  await cards.first().getByRole('link', { name: 'Pieces of “Sweater”' }).click()
  const projectUrl = page.url()

  // New piece…: 10 stitches and 10 rows in 10 × 8 cm, so 12 × 6 cm is 12 × 8 stitches.
  await page.getByRole('button', { name: 'New piece…' }).click()
  const dialog = page.getByRole('dialog', { name: 'New piece for “Sweater”' })
  await dialog.getByLabel('Name').fill('Back')
  await dialog.getByLabel('Swatch width').fill('10')
  await dialog.getByLabel('Swatch height').fill('8')
  await dialog.getByLabel('Width', { exact: true }).fill('12')
  await dialog.getByLabel('Height', { exact: true }).fill('6')
  await expect(dialog.locator('.new-piece__result')).toHaveText('12 × 8 stitches')
  await expect(dialog.getByText('It starts with the project’s 4 colours, ready to paint with.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create' }).click()

  // It opens in Design, blank, with the project's colours (white has the most stitches).
  await expect(page).toHaveURL(/#\/design\//)
  await expect(page.locator('.design__name, h1').first()).toContainText('Back')
  await expect(palette(page)).toHaveCount(4)
  await expect(palette(page).nth(0)).toHaveAccessibleName('White, #ffffff, 96 cells')
  await expect(palette(page).nth(1)).toHaveAccessibleName('Red, #d93a3a, 0 cells')

  // From another pattern lists the project's other pieces first.
  await page.getByRole('button', { name: 'From another pattern' }).click()
  const pieces = page.getByRole('list', { name: 'Pieces of “Sweater”' })
  await expect(pieces.locator('.from-pattern__item-name')).toHaveText(['basic', 'with-source'])
  await expect(page.getByRole('list', { name: 'Patterns in your Library' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  // A red that's nearly the project's red, as a second photo would give.
  await palette(page).nth(1).click()
  const menu = page.getByRole('dialog', { name: 'Edit “Red”' })
  await menu.getByLabel('Hex').fill('#dd3f3f')
  await menu.getByLabel('Name').fill('Tomato')
  await menu.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.work__saved')).toHaveText('Saved')

  // Back in the project: three pieces, and Same colours puts Back's red back.
  await page.goto(projectUrl)
  await expect(page.locator('.group__summary')).toContainText('3 pieces')
  await page.locator('.topbar__actions').getByRole('button', { name: 'More for “Sweater”' }).click()
  await page.getByRole('menuitem', { name: 'Use the same colours in every piece…' }).click()
  const same = page.getByRole('dialog', { name: 'Same colours in every piece' })
  await expect(same.getByRole('checkbox')).toHaveCount(1)
  await expect(same.locator('.same-colours__piece legend')).toHaveText(['Back'])
  await expect(same.locator('.same-colours__change')).toContainText('Tomato →')
  await expect(same.locator('.same-colours__change .group-dialog__label')).toHaveText('Red')
  await same.getByRole('button', { name: 'Use the same colours' }).click()
  await expect(page.getByRole('status')).toContainText('Changed a colour in one piece')

  // Back's red is the project's red again, after a reload.
  await page.reload()
  await page.getByRole('link', { name: 'Open “Back”' }).click()
  await expect(palette(page).nth(1)).toHaveAccessibleName('Red, #d93a3a, 0 cells')
})
