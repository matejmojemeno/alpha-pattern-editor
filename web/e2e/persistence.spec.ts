/**
 * Projects survive a real page reload in a real browser (IndexedDB), and an exported
 * file re-imports as the same project.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const FIXTURE = resolve(import.meta.dirname, '../../fixtures/alpha/desktop/basic.alpha')

// fixtures/alpha/desktop/expected.json records what the desktop wrote into basic.alpha.
const expected = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../fixtures/alpha/desktop/expected.json'), 'utf-8'),
) as { files: Record<string, { pattern: { id: string; name: string; cols: number; rows: number } }> }
const basic = expected.files['basic.alpha']!.pattern

test('import, reload, open, export, delete, re-import', async ({ page }, testInfo) => {
  // 1. Import the desktop-written fixture from the Library.
  await page.goto('/')
  await page.getByRole('link', { name: /Library/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Your projects' })).toBeVisible()
  await expect(page.getByText('No saved projects yet.')).toBeVisible()
  await page.getByLabel('Choose .alpha files to import').setInputFiles(FIXTURE)

  // 2. It is in the Library.
  const card = page.getByRole('listitem').filter({ hasText: basic.name })
  await expect(card).toBeVisible()
  await expect(card.getByText(`${basic.cols}×${basic.rows}`)).toBeVisible()
  await expect(page.getByRole('status')).toContainText(`Imported “${basic.name}”`)

  // 3. Still there after a real reload, straight onto the #/library deep link.
  await page.reload()
  expect(new URL(page.url()).hash).toBe('#/library')
  await expect(card).toBeVisible()
  // The thumbnail loaded from IndexedDB actually decodes.
  await expect
    .poll(() => card.locator('.thumb img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(basic.cols)

  // 4. Open it and see its readout.
  await card.getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`#/work/${basic.id}$`))
  await expect(page.getByRole('heading', { level: 1, name: basic.name })).toBeVisible()
  const readout = page.getByLabel('Rows')
  await expect(readout).toContainText(/^Row 1 [←→] /)
  const readoutBefore = await readout.textContent()
  expect(readoutBefore!.split('\n')).toHaveLength(basic.rows)

  // The deep link to the project survives a reload too.
  await page.reload()
  await expect(page.getByLabel('Rows')).toHaveText(readoutBefore!)

  // 5. Export it...
  await page.getByRole('link', { name: 'Library' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: `Export “${basic.name}”` }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`${basic.name}-${basic.id.slice(0, 6)}.alpha`)
  const exported = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(exported)
  // Export is a straight copy of the imported bytes.
  expect(readFileSync(exported).equals(readFileSync(FIXTURE))).toBe(true)

  // ...delete it...
  await card.getByRole('button', { name: `Delete “${basic.name}”` }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No saved projects yet.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('No saved projects yet.')).toBeVisible()

  // ...re-import the export, and check it matches.
  await page.getByLabel('Choose .alpha files to import').setInputFiles(exported)
  await expect(card).toBeVisible()
  await card.getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1, name: basic.name })).toBeVisible()
  await expect(page.getByLabel('Rows')).toHaveText(readoutBefore!)
})
