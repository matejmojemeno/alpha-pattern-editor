/**
 * The Work stage, the Library and opening or saving `.alpha` files must never load
 * Pyodide (docs/web-port-plan.md, "Central decision"). These tests walk the source's
 * import graph:
 *
 * - src/logic and src/storage import nothing that reaches Pyodide or src/detect/.
 * - The app shell (everything main.tsx loads up front) reaches src/detect/ only through a
 *   dynamic import(), which the bundler turns into a separate chunk fetched on demand.
 *   Static imports are followed; `import type` is erased at build time and isn't.
 * - Only detect/client.ts starts the worker, and only detect/worker.ts loads Pyodide.
 *
 * e2e/bundle.spec.ts checks the same thing in the built output.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
/** Third-party packages Tier A may use. Neither pulls in anything further. */
const ALLOWED_PACKAGES = new Set(['fflate', 'idb'])

// `import x from 'y'`, `import { a, type B } from 'y'`, `export { a } from 'y'` (not
// `import type` / `export type`, which the build erases), and `import 'y'`.
const STATIC_FROM = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm
const SIDE_EFFECT = /^\s*import\s+['"]([^'"]+)['"]/gm
const DYNAMIC = /\bimport\s*\(\s*(?:\/\*.*?\*\/\s*)?['"]([^'"]+)['"]\s*\)/g

export function importsOf(text: string): { static: string[]; dynamic: string[] } {
  return {
    static: [...text.matchAll(STATIC_FROM), ...text.matchAll(SIDE_EFFECT)].map((m) => m[1]!),
    dynamic: [...text.matchAll(DYNAMIC)].map((m) => m[1]!),
  }
}

const rel = (file: string) => relative(SRC, file).split('\\').join('/')
const inDetect = (file: string) => rel(file).startsWith('detect/')

interface Walk {
  files: Set<string>
  /** Targets of dynamic imports made by the walked files: [importer, target]. */
  dynamic: [string, string][]
  problems: string[]
}

/** Follow static imports from `roots`. */
function walk(roots: string[], packages: Set<string>): Walk {
  const files = new Set<string>()
  const dynamic: [string, string][] = []
  const problems: string[] = []
  const queue = [...roots]
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)
    if (file.endsWith('.css')) continue
    const found = importsOf(readFileSync(file, 'utf-8'))
    for (const spec of found.dynamic) {
      if (spec.startsWith('.')) dynamic.push([file, resolve(dirname(file), spec)])
    }
    for (const spec of found.static) {
      const where = `${rel(file)} imports '${spec}'`
      if (/pyodide/i.test(spec)) problems.push(where)
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec)
        if (inDetect(target)) problems.push(`${where} (statically reaches src/detect/)`)
        queue.push(target)
      } else if (!packages.has(spec)) {
        problems.push(`${where} (not an allowed package)`)
      }
    }
  }
  return { files, dynamic, problems }
}

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

describe('importsOf', () => {
  it('tells static imports from type-only and dynamic ones', () => {
    const text = [
      "import { a, type B } from './a.ts'",
      "import type { C } from './c.ts'",
      "export type { D } from './d.ts'",
      "export { e } from './e.ts'",
      "import './f.css'",
      'import {',
      '  g,',
      "} from './g.ts'",
      "const m = await import('./lazy.ts')",
      "const n = import(/* @vite-ignore */ './ignored.ts')",
      "type T = typeof import('./typeof.ts')",
    ].join('\n')
    const found = importsOf(text)
    expect(found.static.sort()).toEqual(['./a.ts', './e.ts', './f.css', './g.ts'])
    expect(found.dynamic).toEqual(['./lazy.ts', './ignored.ts', './typeof.ts'])
  })
})

it('src/logic and src/storage never reach Pyodide', () => {
  const roots = ['logic', 'storage'].flatMap((dir) =>
    readdirSync(join(SRC, dir))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(SRC, dir, f)),
  )
  expect(roots.length).toBeGreaterThan(0)
  const w = walk(roots, ALLOWED_PACKAGES)
  expect(w.problems).toEqual([])
  expect(w.dynamic).toEqual([])
  expect(w.files.size).toBeGreaterThanOrEqual(8)
})

it('the app shell reaches detection only through a dynamic import', () => {
  // Everything main.tsx loads up front: the landing screen, the Library, settings, /work.
  const w = walk([join(SRC, 'main.tsx')], new Set([...ALLOWED_PACKAGES, 'react', 'react-dom/client']))
  expect(w.problems).toEqual([])
  expect([...w.files].some((f) => f.endsWith('Library.tsx'))).toBe(true)
  expect([...w.files].some((f) => f.endsWith('Work.tsx'))).toBe(true)
  expect([...w.files].filter(inDetect)).toEqual([])

  const lazy = [...new Set(w.dynamic.map(([from, to]) => `${rel(from)} → ${rel(to)}`))]
  // The import screen is split off, and the detection client is reached only from
  // app/detection.ts, by import().
  expect(lazy).toContain('App.tsx → ui/screens/Import.tsx')
  expect(lazy.filter((l) => l.includes('→ detect/'))).toEqual(['app/detection.ts → detect/client.ts'])
  expect([...w.files].some((f) => f.endsWith('Import.tsx'))).toBe(false)
})

it('only detect/client.ts starts the worker, and only detect/worker.ts loads Pyodide', () => {
  const files = sourceFiles()
  const containing = (re: RegExp) => files.filter((f) => re.test(readFileSync(f, 'utf-8'))).map(rel)
  expect(containing(/new Worker\(/)).toEqual(['detect/client.ts'])
  expect(containing(/\bloadPyodide\b/)).toEqual(['detect/worker.ts'])
  expect(containing(/virtual:detect-assets/).sort()).toEqual(['detect/assets.d.ts', 'detect/worker.ts', 'ui/screens/Import.tsx'])
  // No file imports the pyodide package's code; the worker imports only its types and
  // loads the runtime from the self-hosted copy.
  for (const f of files) {
    const text = readFileSync(f, 'utf-8')
    expect(importsOf(text).static.filter((s) => /pyodide/i.test(s)), rel(f)).toEqual([])
  }
})
