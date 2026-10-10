/**
 * Nothing sticks out of its box, on any screen or main dialog, at window widths from a
 * 320 px phone to a 1600 px monitor, at the default text size and with text 125% bigger
 * (as a browser's own text-size setting makes it). A long pattern name stresses the
 * headers and the Library card.
 *
 * "Sticks out" is an element wider than its parent where the parent neither clips nor
 * scrolls. An element that reaches out only by its own negative margin (← Home, which
 * lines its arrow up with the text below while keeping a finger-sized target) is meant to.
 */
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { importImage, importPhoto } from './importing.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const BASIC = resolve(ROOT, 'fixtures/alpha/desktop/basic.alpha')
const WIDTHS = [320, 360, 390, 414, 480, 530, 600, 700, 768, 820, 900, 1024, 1100, 1280, 1440, 1600]
const LONG = 'My grandmother’s hippopotamus blanket with pink glasses, second try'

test.describe.configure({ timeout: 5 * 60_000 })

/** Every leak on this screen at every width and both text sizes, as "where: what". */
async function leaks(page: Page, state: string): Promise<string[]> {
  const found: string[] = []
  for (const size of ['', '125%']) {
    await page.evaluate((s) => (document.documentElement.style.fontSize = s), size)
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 700 ? 760 : 900 })
      // Canvases and stages are sized from ResizeObserver callbacks: let them settle.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
      await page.waitForTimeout(100)
      const here = await page.evaluate(() => {
        const out: string[] = []
        const name = (el: Element) => {
          const cls = [...el.classList].slice(0, 2).join('.')
          const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
          return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (text ? ` “${text}”` : '')
        }
        const doc = document.documentElement
        if (doc.scrollWidth > doc.clientWidth + 1) out.push(`the page scrolls sideways`)
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          if (r.width === 0 || r.height === 0 || cs.position === 'absolute' || cs.position === 'fixed') continue
          const p = el.parentElement
          if (!p || p === document.body) continue
          const ps = getComputedStyle(p)
          if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') continue
          const pr = p.getBoundingClientRect()
          // Less what the element's own negative margin reaches out by.
          const left = pr.left + parseFloat(ps.borderLeftWidth) - r.left + Math.min(0, parseFloat(cs.marginLeft))
          const right = r.right - pr.right + parseFloat(ps.borderRightWidth) + Math.min(0, parseFloat(cs.marginRight))
          const over = Math.max(left, right)
          if (over > 1) out.push(`${name(el)} sticks out of ${name(p).split(' “')[0]} by ${Math.round(over)}px`)
        }
        return out
      })
      for (const h of here) found.push(`${state}, ${width}px${size ? ', text ' + size : ''}: ${h}`)
    }
  }
  await page.evaluate(() => (document.documentElement.style.fontSize = ''))
  await page.setViewportSize({ width: 1280, height: 900 })
  return found
}

test('the app screens and their dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const found: string[] = []
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  found.push(...(await leaks(page, 'Home')))

  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  found.push(...(await leaks(page, 'Settings')))

  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(BASIC)
  const card = page.getByRole('listitem')
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: /^Rename/ }).click()
  await card.getByRole('textbox').fill(LONG)
  found.push(...(await leaks(page, 'Library, renaming')))
  await card.getByRole('textbox').press('Enter')
  await expect(card).toContainText(LONG)
  found.push(...(await leaks(page, 'Library')))
  await card.getByRole('button', { name: /^More for/ }).click()
  found.push(...(await leaks(page, 'Library, ⋯ menu')))
  await card.getByRole('menuitem', { name: 'Delete' }).click()
  found.push(...(await leaks(page, 'Delete project?')))
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Design from scratch…' }).click()
  found.push(...(await leaks(page, 'New pattern')))
  await page.getByRole('button', { name: 'Cancel' }).click()

  await card.getByRole('link', { name: /^Open / }).click()
  await expect(page.locator('main.screen.design')).toBeVisible()
  found.push(...(await leaks(page, 'Design')))
  await page.getByRole('button', { name: 'Yarn & size' }).click()
  found.push(...(await leaks(page, 'Yarn & size')))
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Visualize' }).click()
  found.push(...(await leaks(page, 'Visualize')))
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(page.locator('main.screen.work')).toBeVisible()
  found.push(...(await leaks(page, 'Work')))
  await page.getByText('Options', { exact: true }).click()
  found.push(...(await leaks(page, 'Work Options')))
  await page.keyboard.press('Escape')
  await page.locator('.chip__open').first().click()
  await expect(page.getByRole('dialog', { name: 'Record progress' })).toBeVisible()
  found.push(...(await leaks(page, 'Record progress')))

  expect(found).toEqual([])
})

test('Import a chart and Photo to pattern', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const found: string[] = []
  await importImage(page, resolve(ROOT, 'test_images/dachshund.png'))
  await page.getByRole('textbox', { name: 'Pattern name' }).fill(LONG)
  found.push(...(await leaks(page, 'Import a chart')))
  await importPhoto(page, resolve(ROOT, 'test_images/pictures/butterfly.jpg'))
  found.push(...(await leaks(page, 'Photo to pattern')))
  expect(found).toEqual([])
})
