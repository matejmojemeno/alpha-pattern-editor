/**
 * How long detection takes, and how much memory Pyodide needs, for phone-photo-sized
 * images (docs/web-port-plan.md, Risks #2). Not part of the suite; run it on purpose:
 *
 *   BENCH=1 npx playwright test e2e/large-photo.bench.spec.ts
 *
 * Each image from test_images/ is upscaled in the page (canvas, high-quality smoothing)
 * and detected by the real worker twice, in fresh workers: at full size and shrunk as the
 * import screen does (DEFAULT_MAX_EDGE). WebAssembly memory only grows, so its size after
 * detection is the peak Pyodide needed.
 *
 * DevTools' CPU throttling (Emulation.setCPUThrottlingRate) doesn't slow dedicated
 * workers, so this can't stand in for a phone; measure on one.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const IMAGES = resolve(import.meta.dirname, '../../test_images')
const DIST = resolve(import.meta.dirname, '../dist/assets')

const CASES: [file: string, width: number, height: number][] = [
  ['dachshund.png', 4000, 3000],
  ['dachshund.png', 4000, 2400],
  ['monkeys.png', 4000, 3820],
  ['cats.png', 4000, 1801],
  // Doesn't detect at its own size (LOW_RESOLUTION); upscaled, no fitter comes back
  // clean, so all three run: the slow path.
  ['garment.png', 2974, 4000],
]

interface Run {
  bootMs: number
  detectMs: number
  result: string
  scale: number
  wasmAfterBootMB: number
  wasmPeakMB: number
}

test.skip(!process.env.BENCH, 'benchmark: run with BENCH=1')

test('detection time and memory for phone-sized photos', async ({ page }) => {
  test.setTimeout(30 * 60_000)
  const client = readdirSync(DIST).find((f) => /^client-.*\.js$/.test(f))
  expect(client).toBeTruthy()
  await page.route('**/bench/*', (route) =>
    route.fulfill({ body: readFileSync(resolve(IMAGES, route.request().url().split('/bench/')[1]!)), contentType: 'image/png' }),
  )
  await page.goto('/')

  const rows: string[] = []
  for (const [file, width, height] of CASES) {
    for (const maxEdge of [0, 1600]) {
      const run: Run = await page.evaluate(
        async ({ clientUrl, src, width, height, maxEdge }) => {
          const m = await import(/* @vite-ignore */ clientUrl)
          const bitmap = await createImageBitmap(await (await fetch(src)).blob())
          const canvas = new OffscreenCanvas(width, height)
          const ctx = canvas.getContext('2d')!
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(bitmap, 0, 0, width, height)
          const data = ctx.getImageData(0, 0, width, height)
          const mb = (n: number) => Math.round(n / 1048576)

          m.release()
          const c = m.detector()
          let t = performance.now()
          await c.boot()
          const bootMs = performance.now() - t
          const afterBoot = await c.request({ type: 'stats' })
          t = performance.now()
          const { result } = await c.open({ rgba: new Uint8Array(data.data.buffer), width, height }, { maxEdge })
          const detectMs = performance.now() - t
          const peak = await c.request({ type: 'stats' })
          m.release()
          return {
            bootMs,
            detectMs,
            result: result.ok ? `${result.cols}×${result.rows}` : result.code,
            scale: result.ok ? result.scale : 0,
            wasmAfterBootMB: mb(afterBoot.wasmMemoryBytes),
            wasmPeakMB: mb(peak.wasmMemoryBytes),
          }
        },
        { clientUrl: `/assets/${client}`, src: `/bench/${file}`, width, height, maxEdge },
      )
      const line = [
        `${file} ${width}×${height}`,
        maxEdge ? `shrunk ÷${run.scale}` : 'full size',
        `${(run.detectMs / 1000).toFixed(2)} s`,
        run.result,
        `wasm ${run.wasmAfterBootMB} → ${run.wasmPeakMB} MB`,
        `(boot ${(run.bootMs / 1000).toFixed(1)} s)`,
      ].join(' | ')
      console.log(line)
      rows.push(line)
    }
  }
  test.info().annotations.push({ type: 'results', description: rows.join('\n') })
})
