/**
 * Filet stitches in real Chromium: the mesh picked in Options changes what the chips and
 * the foundation chain say, and is still there after a reload.
 */
import { writeFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { newPattern } from '../src/logic/edit.ts'
import { emptyProgress, type Project } from '../src/model/types.ts'
import { writeAlpha } from '../src/storage/alpha.ts'

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true })

/** 6 × 2, black blocks on white spaces: each row 2 spaces, 4 blocks. */
function filetProject(): Project {
  const base = newPattern(6, 2, '#ffffff', { now: 1_700_000_000 })
  const cells = Uint16Array.from([0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1])
  const palette = [
    { ...base.palette[0]!, name: 'White', count: 4 },
    { id: 'black', hex: '#000000', name: 'Black', dmc: null, count: 8 },
  ]
  return { pattern: { ...base, name: 'Filet', cells, palette, craft: 'filet' }, progress: emptyProgress(), stage: 'work' }
}

test('the stitches picked in Options are said, and kept after a reload', async ({ page }, info) => {
  const file = info.outputPath('filet.alpha')
  writeFileSync(file, writeAlpha(filetProject()).bytes)
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(file)
  await page.getByRole('listitem').filter({ hasText: 'Filet' }).getByRole('link', { name: /^Open / }).click()

  const chips = page.getByRole('list', { name: 'Colours in this row' }).locator('.chip__stitches')
  const reminder = page.locator('.work__filet')
  // Row 1 runs right to left: the 4 blocks come first.
  await expect(chips).toHaveText(['12 dc', '(ch 2, dc) × 2'])
  await expect(reminder).toContainText('Foundation chain: 3 × 6 + 1 = 19')

  await page.getByText('Options', { exact: true }).click()
  await page.getByRole('radio', { name: 'ch 1, dc' }).click()
  await expect(chips).toHaveText(['8 dc', '(ch 1, dc) × 2'])
  await expect(reminder).toContainText('Foundation chain: 2 × 6 + 1 = 13')

  await page.getByRole('radio', { name: 'ch 2, tr' }).click()
  await expect(chips).toHaveText(['12 tr', '(ch 2, tr) × 2'])
  await expect(reminder).toContainText('1 tr at the edge')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  await page.reload()
  await expect(chips).toHaveText(['12 tr', '(ch 2, tr) × 2'])
  await page.getByText('Options', { exact: true }).click()
  await expect(page.getByRole('radio', { name: 'ch 2, tr' })).toBeChecked()
})
