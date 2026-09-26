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
  // Nothing the page loads up front (modulepreload) is the client or the worker either,
  // nor the Design stage, which a phone following a pattern never needs.
  expect(html).not.toMatch(/client-|worker-|Import-|Design-/)
  expect(assets().some((f) => /^Design-.*\.js$/.test(f))).toBe(true)
  // Nor any colour library (src/yarn/data/): each is its own chunk, fetched when shown.
  expect(html).not.toMatch(/dmc-|stylecraft-|paintbox-|scheepjes-/)
  for (const [lib, shade] of [
    ['dmc', 'Dark Coffee Brown'],
    ['stylecraft-special-dk', 'Hint of Silver'],
    ['paintbox-simply-dk', 'Elephant Grey'],
    ['scheepjes-colour-crafter', 'Ommen'],
  ] as const) {
    expect(main, shade).not.toContain(shade)
    const chunk = assets().find((f) => f.startsWith(`${lib}-`) && f.endsWith('.js'))
    expect(chunk, lib).toBeTruthy()
    expect(read(chunk!)).toContain(shade)
  }
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

/** Cloudflare Workers static assets on the free plan (web/README.md, "Deploying"). */
const CLOUDFLARE_MAX_FILES = 20_000

test('the site fits Cloudflare, and everything cached for good has a versioned name', () => {
  // public/_headers caches these three folders immutably. That is only safe while every
  // file in them changes its name when its content changes; otherwise a deploy would
  // never reach a returning visitor.
  const headers = readFileSync(join(DIST, '_headers'), 'utf-8')
  for (const dir of ['/assets/*', '/pyodide/*', '/py/*']) {
    expect(headers, dir).toMatch(new RegExp(`^${dir.replace(/[/*]/g, '\\$&')}\\n\\s+Cache-Control: [^\\n]*immutable`, 'm'))
  }
  expect(headers).not.toMatch(/^\/index\.html|^\/\*\n\s+Cache-Control/m)

  const all = files(DIST).map((f) => f.slice(DIST.length + 1))
  expect(all.length).toBeLessThan(CLOUDFLARE_MAX_FILES)
  for (const f of files(DIST)) expect(statSync(f).size, f).toBeLessThan(CLOUDFLARE_FILE_LIMIT)

  const versioned: Record<string, RegExp> = {
    assets: /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/, // Vite's content hash
    pyodide: /^pyodide\/v\d+\.\d+\.\d+\/[^/]+$/, // the pinned Pyodide version
    py: /^py\/alphareader-core\.[0-9a-f]{12}\.zip$/, // build_core_bundle.py's content hash
  }
  for (const f of all) {
    const top = f.split('/')[0]!
    if (top in versioned) expect(f, `${f} is cached for good but its name isn't versioned`).toMatch(versioned[top]!)
  }
})
