/**
 * On a wide monitor the Library, Design and Work screens fill the window's whole width,
 * as the import screen does: none is capped and centred with empty margins beside it.
 */
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

const BASIC = resolve(import.meta.dirname, '../../fixtures/alpha/desktop/basic.alpha')
const WIDTH = 2400

test.use({ viewport: { width: WIDTH, height: 1000 } })

async function screenWidth(page: Page) {
  return page.locator('main.screen').evaluate((el) => el.getBoundingClientRect().width)
}

test('Library, Design and Work use the whole width', async ({ page }) => {
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(BASIC)
  await expect(page.getByRole('listitem')).toHaveCount(1)
  expect(await screenWidth(page)).toBe(WIDTH)

  await page.getByRole('listitem').getByRole('link').click()
  await expect(page.locator('main.screen.design')).toBeVisible()
  expect(await screenWidth(page)).toBe(WIDTH)

  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page.locator('main.screen.work')).toBeVisible()
  expect(await screenWidth(page)).toBe(WIDTH)
})
