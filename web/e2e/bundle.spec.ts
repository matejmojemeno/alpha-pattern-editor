/**
 * The built output (dist/, which the e2e web server builds first): the app's entry chunk
 * holds no Pyodide and stays within budget, and the worker is reachable only from the
 * lazily loaded detection client (docs/web-port-plan.md, Tier A / Tier B).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { expect, test } from '@playwright/test'

const DIST = resolve(import.meta.dirname, '../dist')
/** Tier A's budget (docs/web-port-plan.md, Verification). */
const MAIN_BUDGET_GZIP = 250 * 1024
const CLOUDFLARE_FILE_LIMIT = 25 * 1024 * 1024

const assets = () => readdirSync(join(DIST, 'assets'))
const read = (name: string) => readFileSync(join(DIST, 'assets', name), 'utf-8')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]))
}

test('the main entry chunk has no Pyodide and is within budget', () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf-8')
  const entry = /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(html)?.[1]
  expect(entry).toBeTruthy()
  const main = read(entry!)
  for (const needle of ['loadPyodide', 'pyodide.asm', 'pyodide.mjs', 'alphareader-core', 'new Worker', 'worker-']) {
    expect(main, needle).not.toContain(needle)
  }
  // Nothing the page loads up front (modulepreload) is the client or the worker either.
  expect(html).not.toMatch(/client-|worker-|Import-/)
  const gz = gzipSync(readFileSync(join(DIST, 'assets', entry!))).length
  console.log(`main entry chunk: ${(gz / 1024).toFixed(1)} KB gzipped`)
  expect(gz).toBeLessThan(MAIN_BUDGET_GZIP)
})

test('only the lazily loaded detection client refers to the worker', () => {
  const worker = assets().find((f) => /^worker-.*\.js$/.test(f))!
  expect(worker).toBeTruthy()
  const referrers = assets().filter((f) => f.endsWith('.js') && read(f).includes(worker))
  expect(referrers).toHaveLength(1)
  expect(referrers[0]).toMatch(/^client-/)
  // The worker loads the runtime from the self-hosted copy, never a CDN.
  expect(read(worker)).not.toMatch(/cdn\.jsdelivr|unpkg|cdnjs/)
})

test('what the first photo import downloads', () => {
  const pyodide = files(join(DIST, 'pyodide')).concat(files(join(DIST, 'py')))
  expect(pyodide.map((f) => f.slice(DIST.length + 1)).sort()).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^pyodide\/v314\.0\.7\/pyodide\.asm\.wasm$/),
      expect.stringMatching(/^pyodide\/v314\.0\.7\/numpy-.*\.whl$/),
      expect.stringMatching(/^py\/alphareader-core\.[0-9a-f]{12}\.zip$/),
    ]),
  )
  expect(pyodide.some((f) => /scipy|pillow/i.test(f))).toBe(false)
  let total = 0
  for (const f of pyodide) {
    const bytes = readFileSync(f)
    expect(bytes.length, f).toBeLessThan(CLOUDFLARE_FILE_LIMIT)
    // pyodide-lock.json is fetched; the other runtime files are all needed.
    total += gzipSync(bytes).length
  }
  const lazy = ['client-', 'worker-', 'Import-'].map((p) => assets().find((f) => f.startsWith(p) && f.endsWith('.js'))!)
  for (const f of lazy) total += gzipSync(readFileSync(join(DIST, 'assets', f))).length
  console.log(`first photo import downloads ${(total / 1e6).toFixed(2)} MB gzipped`)
  expect(total).toBeLessThan(10e6)
})
