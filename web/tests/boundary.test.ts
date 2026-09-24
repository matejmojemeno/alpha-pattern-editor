/**
 * The Work stage, the Library and opening or saving `.alpha` files must never load
 * Pyodide (docs/web-port-plan.md, "Central decision"). This walks the import graph from
 * everything in src/logic/ and src/storage/ and fails on any path to Pyodide or to the
 * detection worker, direct or indirect.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const ROOTS = ['logic', 'storage']
/** Third-party packages Tier A may use. Neither pulls in anything further. */
const ALLOWED_PACKAGES = new Set(['fflate', 'idb'])

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf-8')
  return [...text.matchAll(IMPORT)].map((m) => (m[1] ?? m[2] ?? m[3])!)
}

it('src/logic and src/storage never reach Pyodide', () => {
  const seen = new Set<string>()
  const problems: string[] = []
  const queue = ROOTS.flatMap((dir) =>
    readdirSync(join(SRC, dir))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(SRC, dir, f)),
  )
  expect(queue.length).toBeGreaterThan(0)

  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of importsOf(file)) {
      const where = `${relative(SRC, file)} imports '${spec}'`
      if (/pyodide/i.test(spec)) problems.push(where)
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec)
        if (relative(SRC, target).startsWith('detect')) problems.push(where)
        queue.push(target)
      } else if (!ALLOWED_PACKAGES.has(spec)) {
        problems.push(`${where} (not an allowed package)`)
      }
    }
  }
  expect(problems).toEqual([])
  expect(seen.size).toBeGreaterThanOrEqual(8)
})

it('the app shell (landing, Library, settings, /work) never reaches Pyodide', () => {
  // Everything main.tsx loads eagerly. When Phase 2 adds the importer, it must be a lazy
  // import() behind the Import screen, and this list of packages must not grow Pyodide.
  const allowed = new Set([...ALLOWED_PACKAGES, 'react', 'react-dom/client'])
  const seen = new Set<string>()
  const problems: string[] = []
  const queue = [join(SRC, 'main.tsx')]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (file.endsWith('.css')) continue
    for (const spec of importsOf(file)) {
      const where = `${relative(SRC, file)} imports '${spec}'`
      if (/pyodide/i.test(spec)) problems.push(where)
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec)
        if (relative(SRC, target).startsWith('detect')) problems.push(where)
        queue.push(target)
      } else if (!allowed.has(spec)) {
        problems.push(`${where} (not an allowed package)`)
      }
    }
  }
  expect(problems).toEqual([])
  expect([...seen].some((f) => f.endsWith('Library.tsx'))).toBe(true)
})
