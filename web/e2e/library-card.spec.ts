/**
 * A Library card's name and its Design, Export and Delete buttons stay inside the card at every
 * window width, down to a phone's, and on one row at the default text size. (With bigger
 * text the row wraps rather than spilling past the edges.)
 */
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const BASIC = resolve(import.meta.dirname, '../../fixtures/alpha/desktop/basic.alpha')

test('the card buttons never stick out of the card', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(BASIC)
  const card = page.getByRole('listitem')
  await expect(card).toHaveCount(1)

  for (let width = 320; width <= 1400; width += 10) {
    await page.setViewportSize({ width, height: 900 })
    const { out, rows } = await card.evaluate((li) => {
      const box = li.getBoundingClientRect()
      const buttons = [...li.querySelectorAll('button, .card__actions a')].map((b) => b.getBoundingClientRect())
      const actions = [...li.querySelectorAll('.card__actions > *')].map((b) => b.getBoundingClientRect())
      return {
        out: buttons
          .filter((r) => r.left < box.left || r.right > box.right)
          .map((r) => `${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(box.left)}–${Math.round(box.right)}`),
        rows: new Set(actions.map((r) => Math.round(r.top))).size,
      }
    })
    expect(out, `window ${width}px wide`).toEqual([])
    // At the default text size all three still fit on one row.
    expect(rows, `window ${width}px wide`).toBe(1)
  }
})
