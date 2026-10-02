/** Steps the import tests share: importing an image, saving it, exporting it. */
import { expect, type Page, type TestInfo } from '@playwright/test'

const PICKER = 'Choose a pattern file or chart image to import'
/** Booting Pyodide the first time, then detecting: generous, for slow machines. */
export const DETECT_TIMEOUT = 180_000

/** Choose an image from the landing screen's "Import a chart" and wait for its verdict. */
export async function importImage(page: Page, file: string) {
  await page.goto('/')
  await page.getByLabel(PICKER).setInputFiles(file)
  await expect(page.getByRole('heading', { level: 1, name: 'Import a chart' })).toBeVisible()
  return verdict(page)
}

/** Open "Photo to pattern" from the landing screen's tile, choose an image, and wait for
 *  its pattern. */
export async function importPhoto(page: Page, file: string) {
  await page.goto('/')
  await page.getByRole('link', { name: /Photo to pattern/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Photo to pattern' })).toBeVisible()
  await page.getByLabel('Choose an image').setInputFiles(file)
  return verdict(page)
}

async function verdict(page: Page) {
  const save = page.getByRole('button', { name: 'Save & edit pattern' })
  const alert = page.getByRole('alert')
  // The save bar is there from the start, disabled until a grid is found: wait for the
  // result's summary, or for the reason there isn't one.
  await expect(page.locator('.confirm__stats').or(alert)).toBeVisible({ timeout: DETECT_TIMEOUT })
  return { save, alert }
}

/** Save the detected pattern under `name`; lands on the Design stage (§7.3). */
export async function saveAs(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'Pattern name' }).fill(name)
  await page.getByRole('button', { name: 'Save & edit pattern' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** Export `name` from the Library; returns the file's path. */
export async function exportFromLibrary(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  await page.goto('/#/library')
  const card = page.getByRole('listitem').filter({ hasText: name })
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: `Export “${name}”` }).click()])
  const path = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(path)
  return path
}
