/**
 * The user guide's screenshots and tour, made from the real app: `npm run docs:media`
 * (playwright.docs.config.ts; never part of `npm run test:e2e`). Every image goes to
 * docs/guide/media/, and nothing there is edited by hand.
 *
 * One test per image, named after the file it writes. Each is a `toHaveScreenshot` whose
 * reference is the committed image, compared exactly, and the config's
 * `updateSnapshots: 'changed'` rewrites an image only when its pixels differ: an
 * unchanged screen leaves git clean. A button the guide shows that was renamed or removed
 * fails the test that looks for it.
 *
 * The same every run: the demo pattern (fixtures/demo/, taken by path, so replacing it
 * is a file swap and a re-run), a fixed clock (a pasted chart is named after the moment
 * it's saved), light colours, UTC and en-GB, 1280 × 800 at device scale 2 on a desktop,
 * an iPhone 13's screen with touch for the Work stage, and animations and the caret
 * turned off for each shot.
 *
 * The tour (tour.gif and tour.mp4) is re-recorded only with DOCS_TOUR=1, since it is
 * encoded afresh each time and would otherwise change on every run. It needs ffmpeg.
 * DOCS_DEMO_CHART=1 rewrites fixtures/demo/demo-chart.png from demo.alpha with the
 * Design stage's Export PNG (see fixtures/demo/README.md).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { devices, expect, test, type Locator, type Page } from '@playwright/test'

import { readAlpha } from '../src/storage/alpha.ts'
import { ROOT } from './desktop.ts'
import { DETECT_TIMEOUT, importImage, saveAs } from './importing.ts'

/** The demo pattern, and the chart image the import shots and the tour import. */
const DEMO_ALPHA = resolve(ROOT, 'fixtures/demo/demo.alpha')
const DEMO_CHART = resolve(ROOT, 'fixtures/demo/demo-chart.png')
const MEDIA = resolve(ROOT, 'docs/guide/media')

const demo = readAlpha(new Uint8Array(readFileSync(DEMO_ALPHA))).project.pattern
const PICKER = 'Choose a pattern file or chart image to import'
/** Every shot is taken at this moment (Tuesday 1 September 2026, 10:00 UTC). */
const NOW = new Date('2026-09-01T10:00:00Z')

test.use({ timezoneId: 'UTC', locale: 'en-GB', colorScheme: 'light' })
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW)
})

/** An iPhone 13's screen, with touch, in the config's Chromium (Playwright's device
 *  entry would ask for WebKit), at the same device scale as the desktop shots. */
const { defaultBrowserType: _webkit, ...iPhone } = devices['iPhone 13']
const PHONE = { ...iPhone, deviceScaleFactor: 2 }

/** Exact comparison, at the device's scale (2×), with animations and the caret off. */
const EXACT = { scale: 'device', animations: 'disabled', caret: 'hide', threshold: 0, maxDiffPixels: 0 } as const

/** The whole window. */
const shoot = (page: Page, file: string) => expect(page).toHaveScreenshot(file, EXACT)

/** The smallest rectangle around `parts`, with `pad` CSS pixels to spare. */
async function shootAround(page: Page, file: string, parts: Locator[], pad = 16, scale: 'device' | 'css' = 'device') {
  const boxes = await Promise.all(parts.map(async (l) => (await l.boundingBox())!))
  const vp = page.viewportSize()!
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const right = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
  const bottom = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
  await expect(page).toHaveScreenshot(file, { ...EXACT, scale, clip: { x, y, width: right - x, height: bottom - y } })
}

/** Everything drawn: two frames after the last change, so canvases have painted. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

/** Nothing focused, so no focus ring is in the shot. */
async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(1, 1) // and nothing hovered
}

/** Import demo.alpha from the landing screen: one project opens in the Work stage. */
async function openDemo(page: Page) {
  await page.goto('/')
  await page.getByLabel(PICKER).setInputFiles(DEMO_ALPHA)
  await expect(page).toHaveURL(/#\/work\//)
  await expect(page.getByRole('heading', { level: 1, name: demo.name })).toBeVisible()
}

/** The demo pattern in the Design stage. */
async function designDemo(page: Page) {
  await openDemo(page)
  await page.goto(`/#/design/${demo.id}`)
  await expect(page.getByRole('heading', { level: 1, name: demo.name })).toBeVisible()
  await expect(page.locator('.work__saved')).toHaveText('Saved')
  await settle(page)
}

const rowLabel = (page: Page) => page.locator('.work__row')

/** Complete the first `n` rows with "Row complete →", and wait for the save. */
async function completeRows(page: Page, n: number) {
  for (let i = 1; i <= n; i++) {
    await page.getByRole('button', { name: 'Row complete →' }).click()
    await expect(rowLabel(page)).toContainText(`Row ${i + 1} of ${demo.rows}`)
  }
  await expect(page.locator('.work__saved')).toHaveText('Saved')
}

// --- the landing screen, Library and Settings ------------------------------------------------

test('landing.png', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('No projects yet.')).toBeVisible()
  await shoot(page, 'landing.png')
})

test('library.png', async ({ page }) => {
  await openDemo(page)
  await completeRows(page, 6)
  await page.goto('/#/library')
  await expect(page.getByRole('listitem').filter({ hasText: demo.name })).toBeVisible()
  await settle(page)
  await shoot(page, 'library.png')
})

test('settings.png', async ({ page }) => {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await shoot(page, 'settings.png')
})

// --- importing a chart (real Pyodide) -----------------------------------------------------

test('import-detected-grid.png', async ({ page }) => {
  const { save } = await importImage(page, DEMO_CHART)
  await expect(save).toBeEnabled()
  await expect(page.locator('.confirm__stats')).toContainText(`${demo.cols} columns × ${demo.rows} rows`)
  await settle(page)
  await shoot(page, 'import-detected-grid.png')
})

test('import-colours.png', async ({ page }) => {
  await importImage(page, DEMO_CHART)
  const list = page.getByRole('list', { name: 'Colours' })
  await expect(list.getByRole('listitem')).toHaveCount(demo.palette.length)
  await shootAround(page, 'import-colours.png', [page.locator('.confirm__col--colours')], 8)
})

// --- the Design stage --------------------------------------------------------------------

test('design.png', async ({ page }) => {
  await designDemo(page)
  await shoot(page, 'design.png')
})

test('design-border-and-size.png', async ({ page }) => {
  await designDemo(page)
  await page.getByRole('button', { name: 'Border & size', expanded: false }).click()
  // A second border, two stitches all round, previewed on the chart.
  await page.getByRole('checkbox', { name: 'Same on every side' }).check()
  await page.getByRole('spinbutton', { name: 'Top' }).fill('2')
  await expect(page.getByRole('img', { name: `Preview, ${demo.cols + 4} by ${demo.rows + 4}` })).toBeVisible()
  // The whole section in view beside the preview, and no field focused.
  await page.getByRole('button', { name: 'Apply' }).scrollIntoViewIfNeeded()
  await blur(page)
  await settle(page)
  await shoot(page, 'design-border-and-size.png')
})

test('design-colour-menu.png', async ({ page }) => {
  await designDemo(page)
  const colour = page.getByRole('list', { name: 'Palette' }).locator('button.colour').nth(1)
  const name = (await colour.locator('.colour__name').textContent())!
  await colour.click()
  const menu = page.getByRole('dialog', { name: `Edit “${name}”` })
  await expect(menu).toBeVisible()
  await settle(page)
  await shootAround(page, 'design-colour-menu.png', [menu, page.locator('#colours-heading'), page.getByRole('list', { name: 'Palette' })])
})

test('design-yarn-and-size.png', async ({ page }) => {
  await designDemo(page)
  await page.getByRole('button', { name: 'Yarn & size' }).click()
  const dialog = page.getByRole('dialog', { name: 'Yarn & size' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('table', { name: 'Yarn for each colour' })).toBeVisible()
  // A swatch measured, so the finished size shows: 10 stitches by 10 rows, 10 × 9 cm.
  await dialog.getByRole('textbox', { name: 'Width' }).fill('10')
  await dialog.getByRole('textbox', { name: 'Height' }).fill('9')
  await blur(page)
  await shoot(page, 'design-yarn-and-size.png')
})

test('design-visualize.png', async ({ page }) => {
  await designDemo(page)
  await page.getByRole('button', { name: 'Visualize' }).click()
  const dialog = page.getByRole('dialog', { name: 'Visualize' })
  await expect(dialog.getByRole('img', { name: 'The pattern, crocheted' })).toBeVisible()
  await blur(page)
  await settle(page)
  // Only the dialog, at 1×: the fabric's fine texture makes a PNG of several MB at 2×.
  await shootAround(page, 'design-visualize.png', [dialog], 0, 'css')
})

// --- the Work stage ------------------------------------------------------------------------

test('work.png', async ({ page }) => {
  await openDemo(page)
  await completeRows(page, 6)
  await settle(page)
  await shoot(page, 'work.png')
})

test('work-carry-yarn.png', async ({ page }) => {
  await openDemo(page)
  await completeRows(page, 6)
  await page.locator('.work__options summary').click()
  await page.getByRole('checkbox', { name: 'Show where to carry yarn' }).check()
  await page.locator('.work__options summary').click()
  await expect(page.locator('.work__options')).not.toHaveAttribute('open')
  await blur(page)
  await settle(page)
  await shoot(page, 'work-carry-yarn.png')
})

test.describe('on a phone', () => {
  test.use(PHONE)

  test('work-phone.png', async ({ page }) => {
    await openDemo(page)
    await completeRows(page, 6)
    await settle(page)
    await shoot(page, 'work-phone.png')
  })

  test('work-partial-row.png', async ({ page }) => {
    await openDemo(page)
    await completeRows(page, 6)
    const chips = page.getByRole('list', { name: 'Colours in this row' }).getByRole('button')
    await chips.nth(1).click()
    const dialog = page.getByRole('dialog', { name: 'Record progress' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'One more' }).click()
    await settle(page)
    await shoot(page, 'work-partial-row.png')
  })
})

// --- the tour: DOCS_TOUR=1 --------------------------------------------------------------------

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'
const ffmpegMissing = () => spawnSync(FFMPEG, ['-version']).error !== undefined

function ffmpeg(args: string[]) {
  const run = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf-8' })
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed:\n${run.stderr}`)
}

/** Drop `file` on the landing screen, as a file dragged from the desktop would be. */
async function dropFile(page: Page, file: string, type: string) {
  const b64 = readFileSync(file).toString('base64')
  const name = file.split('/').at(-1)!
  const handle = await page.evaluateHandle(
    async ({ b64, name, type }) => {
      const blob = await (await fetch(`data:${type};base64,${b64}`)).blob()
      const data = new DataTransfer()
      data.items.add(new File([blob], name, { type }))
      return data
    },
    { b64, name, type },
  )
  const zone = page.locator('main.landing')
  await zone.dispatchEvent('dragenter', { dataTransfer: handle })
  await zone.dispatchEvent('dragover', { dataTransfer: handle })
  await page.waitForTimeout(900) // pacing: the drop overlay, for the viewer
  await zone.dispatchEvent('drop', { dataTransfer: handle })
}

test('tour.gif and tour.mp4', async ({ browser }, testInfo) => {
  test.skip(!process.env.DOCS_TOUR, 'The tour is re-recorded only with DOCS_TOUR=1.')
  if (ffmpegMissing()) {
    throw new Error(`The tour needs ffmpeg, and "${FFMPEG}" isn't there. Install it (macOS: brew install ffmpeg), or set FFMPEG to its path.`)
  }
  test.setTimeout(10 * 60_000)
  const size = { width: 1280, height: 720 }
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL!,
    viewport: size,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    timezoneId: 'UTC',
    locale: 'en-GB',
    recordVideo: { dir: testInfo.outputPath('video'), size },
  })
  const page = await context.newPage()
  const opened = Date.now()
  await page.clock.setFixedTime(NOW)
  const pause = (ms: number) => page.waitForTimeout(ms) // pacing only, never for correctness

  // Warm-up, cut from the recording: Pyodide's first download and compile, so the tour
  // shows detection at the speed a returning visitor sees.
  await importImage(page, DEMO_CHART)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha Pattern Editor' })).toBeVisible()
  await page.mouse.move(640, 700)
  await settle(page)
  const start = (Date.now() - opened) / 1000

  // 1. The landing screen; the chart is dropped on it.
  await pause(1200)
  await page.mouse.move(420, 420, { steps: 12 }) // over "Import a chart": Pyodide starts loading
  await pause(600)
  await dropFile(page, DEMO_CHART, 'image/png')

  // 2. The grid is found; the pattern is named and saved.
  await expect(page.locator('.confirm__stats')).toContainText(`${demo.cols} columns × ${demo.rows} rows`, { timeout: DETECT_TIMEOUT })
  await pause(2500)
  const nameBox = page.getByRole('textbox', { name: 'Pattern name' })
  await nameBox.fill('')
  await nameBox.pressSequentially(demo.name, { delay: 70 })
  await pause(600)
  await saveAs(page, demo.name)

  // 3. One edit in Design: two spots painted on the cap, in the third colour (the
  //    toadstool's white).
  await expect(page.locator('.work__saved')).toHaveText('Saved')
  await pause(1500)
  await page.getByRole('list', { name: 'Palette' }).locator('button.colour').nth(2).click()
  await page.keyboard.press('Escape') // the colour's menu: only choosing it here
  await page.getByRole('group', { name: 'Tool' }).getByRole('button', { name: /^Paint\s*[A-Z]$/ }).click()
  await pause(500)
  const scroller = page.getByTestId('design-scroller')
  const box = (await scroller.boundingBox())!
  const cell = Number(await scroller.getAttribute('data-cell'))
  const at = (r: number, c: number) => ({ x: box.x + 34 + c * cell + cell / 2, y: box.y + 22 + r * cell + cell / 2 })
  for (const [r0, c0] of [[9, 17], [14, 5]] as const) {
    const cells = [[r0, c0], [r0, c0 + 1], [r0 + 1, c0 + 1], [r0 + 1, c0]] as const
    const first = at(cells[0][0], cells[0][1])
    await page.mouse.move(first.x, first.y, { steps: 10 })
    await page.mouse.down()
    for (const [r, c] of cells.slice(1)) {
      const p = at(r, c)
      await page.mouse.move(p.x, p.y, { steps: 4 })
    }
    await page.mouse.up()
    await pause(500)
  }
  await expect(page.locator('.work__saved')).toHaveText('Saved')
  await pause(1200)

  // 4. To Work, and three rows done.
  await page.getByRole('button', { name: 'Start working →' }).click()
  await expect(rowLabel(page)).toContainText(`Row 1 of ${demo.rows}`)
  await pause(1800)
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Row complete →' }).hover()
    await pause(400)
    await page.getByRole('button', { name: 'Row complete →' }).click()
    await expect(rowLabel(page)).toContainText(`Row ${i + 1} of ${demo.rows}`)
    await pause(1100)
  }
  await pause(1200)
  const end = (Date.now() - opened) / 1000

  const video = page.video()!
  await context.close()
  const raw = await video.path()

  mkdirSync(MEDIA, { recursive: true })
  const cut = ['-ss', start.toFixed(2), '-to', end.toFixed(2), '-i', raw]
  const palette = testInfo.outputPath('palette.png')
  const scaled = 'fps=12,scale=960:-1:flags=lanczos'
  ffmpeg([...cut, '-vf', `${scaled},palettegen=max_colors=128:stats_mode=diff`, palette])
  ffmpeg([...cut, '-i', palette, '-lavfi', `${scaled}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, resolve(MEDIA, 'tour.gif')])
  ffmpeg([...cut, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', '-an', resolve(MEDIA, 'tour.mp4')])

  const mb = (f: string) => statSync(resolve(MEDIA, f)).size / 1024 / 1024
  testInfo.annotations.push({ type: 'tour', description: `${(end - start).toFixed(1)} s; tour.gif ${mb('tour.gif').toFixed(2)} MB, tour.mp4 ${mb('tour.mp4').toFixed(2)} MB` })
  expect(mb('tour.gif'), 'tour.gif should stay under 3 MB: shorten the tour, or lower fps or width').toBeLessThan(3)
})

// --- the demo chart image: DOCS_DEMO_CHART=1 ------------------------------------------------------

test('fixtures/demo/demo-chart.png', async ({ page }, testInfo) => {
  test.skip(!process.env.DOCS_DEMO_CHART, 'demo-chart.png is rewritten only with DOCS_DEMO_CHART=1.')
  await designDemo(page)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()])
  await download.saveAs(DEMO_CHART)
  expect(existsSync(DEMO_CHART)).toBe(true)
  testInfo.annotations.push({ type: 'wrote', description: DEMO_CHART })
})
