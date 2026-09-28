/** The Design stage's colours, for the specs that set a pattern up. */
import { expect, type Page } from '@playwright/test'

/** The colours in the palette list (each row's button, not its ×). */
export const palette = (page: Page) => page.getByRole('list', { name: 'Palette' }).locator('button.colour')

/** Add a colour through "+ Add colour" and its menu, optionally naming it. */
export async function addColour(page: Page, hex: string, name?: string) {
  await page.getByRole('button', { name: '+ Add colour' }).click()
  const menu = page.getByRole('dialog', { name: 'New colour' })
  await menu.getByLabel('Hex').fill(hex)
  if (name !== undefined) await menu.getByLabel('Name').fill(name)
  await menu.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(menu).toHaveCount(0)
}
