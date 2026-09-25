/**
 * On a desktop with classic scrollbars, the Work chart that scrolls leaves none of itself
 * under the scrollbar: scrolled to the end, the last column and the last row show whole.
 *
 * The last column is red and the last row blue; everything else is white. What's on
 * screen inside the scroller's content box (the screenshot, scrollbar excluded) must hold
 * a full cell of each.
 */
import { writeFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { emptyProgress, type Pattern, type Project } from '../src/model/types.ts'
import { AXIS_LEFT, PAD } from '../src/render/layout.ts'
import { writeAlpha } from '../src/storage/alpha.ts'

// Playwright hides scrollbars in headless Chromium, and a Mac may overlay them; a styled
// scrollbar takes room in the layout everywhere, as a classic one on Windows or Linux does.
test.use({ viewport: { width: 900, height: 700 }, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = '::-webkit-scrollbar { width: 15px; height: 15px; background: #ccc } ::-webkit-scrollbar-thumb { background: #888 }'
      document.head.append(style)
    })
  })
})

function edgesProject(name: string, cols: number, rows: number): Project {
  const cells = new Uint16Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells[r * cols + c] = c === cols - 1 ? 1 : r === rows - 1 ? 2 : 0
  }
  const colours = ['#ffffff', '#ff0000', '#0000ff']
  const pattern: Pattern = {
    id: `e2e-${cols}x${rows}`,
    name,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    rows,
    cols,
    row_ids: Array.from({ length: rows }, (_, i) => `row-${i}`),
    cells,
    palette: colours.map((hex, i) => ({
      id: `c${i}`,
      hex,
      name: ['White', 'Red', 'Blue'][i]!,
      dmc: null,
      count: cells.filter((v) => v === i).length,
    })),
    start_direction: 'LTR',
    alternate_direction: true,
    // Top-down, so the current row (drawn taller) is the first, far from the last.
    bottom_up: false,
  }
  return { pattern, progress: emptyProgress(), stage: 'work' }
}

const scroller = (page: Page) => page.getByTestId('chart-scroller')

async function open(page: Page, project: Project, file: string) {
  writeFileSync(file, writeAlpha(project).bytes)
  await page.goto('/#/library')
  await page.getByLabel('Choose a pattern file or chart image to import').setInputFiles(file)
  await page.getByRole('listitem').filter({ hasText: project.pattern.name }).getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1, name: project.pattern.name })).toBeVisible()
}

/** Scroll to the far end along the axis the chart scrolls on, and only that one, as
 *  someone reading it would; wait for the chart to settle, and measure. */
async function scrollToEnd(page: Page, axis: 'vertical' | 'horizontal') {
  return scroller(page).evaluate(
    (el: HTMLElement, axis) =>
      new Promise<{
        clientWidth: number
        clientHeight: number
        offsetWidth: number
        offsetHeight: number
        scrollWidth: number
        scrollHeight: number
      }>((resolve) => {
        el.scrollTo(axis === 'vertical' ? { top: el.scrollHeight, behavior: 'instant' } : { left: el.scrollWidth, behavior: 'instant' })
        let frames = 0
        const tick = () => {
          if (++frames < 10) return void requestAnimationFrame(tick)
          const { clientWidth, clientHeight, offsetWidth, offsetHeight, scrollWidth, scrollHeight } = el
          resolve({ clientWidth, clientHeight, offsetWidth, offsetHeight, scrollWidth, scrollHeight })
        }
        requestAnimationFrame(tick)
      }),
    axis,
  )
}

/**
 * The longest run of red pixels along any row of the screenshot, and of blue pixels along
 * any column, in CSS pixels: how much of the last column and last row is on screen.
 */
async function visibleEdges(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const png = (await page.screenshot({ clip: box, scale: 'css' })).toString('base64')
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const { width, height } = bitmap
    const ctx = new OffscreenCanvas(width, height).getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const d = ctx.getImageData(0, 0, width, height).data
    const is = (x: number, y: number, want: 'red' | 'blue') => {
      const i = (y * width + x) * 4
      const [r, g, bl] = [d[i]!, d[i + 1]!, d[i + 2]!]
      return want === 'red' ? r > 200 && g < 80 && bl < 80 : bl > 200 && r < 80 && g < 80
    }
    let red = 0
    for (let y = 0; y < height; y++) {
      let run = 0
      for (let x = 0; x < width; x++) red = Math.max(red, (run = is(x, y, 'red') ? run + 1 : 0))
    }
    let blue = 0
    for (let x = 0; x < width; x++) {
      let run = 0
      for (let y = 0; y < height; y++) blue = Math.max(blue, (run = is(x, y, 'blue') ? run + 1 : 0))
    }
    return { red, blue }
  }, png)
}

// Cells are floored to whole pixels, and the slack that leaves can hide a scrollbar's
// 15 px by luck. These sizes leave little: measured with the scrollbar in, they overflow.
for (const [label, cols, rows, axis] of [
  ['tall', 31, 98, 'vertical'],
  ['wide', 98, 22, 'horizontal'],
] as const) {
  test(`a ${label} chart scrolled to the end shows its last column and row whole, clear of the ${axis} scrollbar`, async ({ page }, testInfo) => {
    const project = edgesProject(`Edges ${label}`, cols, rows)
    await open(page, project, testInfo.outputPath(`${label}.alpha`))
    const m = await scrollToEnd(page, axis)
    // Classic scrollbars take room here, so the test means something.
    const bar = axis === 'vertical' ? m.offsetWidth - m.clientWidth : m.offsetHeight - m.clientHeight
    expect(bar, 'scrollbar thickness').toBeGreaterThan(0)
    // The short axis fits the content box, so there's nothing to scroll the other way.
    if (axis === 'vertical') expect(m.scrollWidth, 'scroll width').toBeLessThanOrEqual(m.clientWidth)
    else expect(m.scrollHeight, 'scroll height').toBeLessThanOrEqual(m.clientHeight)

    const cell = (m.scrollWidth - AXIS_LEFT - PAD) / cols
    const box = (await scroller(page).boundingBox())!
    const edges = await visibleEdges(page, { x: box.x, y: box.y, width: m.clientWidth, height: m.clientHeight })
    // Gridlines and the chart's outline are drawn over a cell's edges; allow for them.
    expect(edges.red, `last column on screen (cell ${cell.toFixed(1)} px)`).toBeGreaterThanOrEqual(cell - 4)
    expect(edges.blue, `last row on screen (cell ${cell.toFixed(1)} px)`).toBeGreaterThanOrEqual(cell - 4)
  })
}
