/**
 * Projects with pieces in a real browser: the groups store survives a reload, Work
 * switches between pieces keeping each one's progress, and a project's exported .zip
 * imports into an empty Library as the same project, each piece byte for byte.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { unzipSync, strFromU8 } from 'fflate'
import { expect, test } from '@playwright/test'

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
