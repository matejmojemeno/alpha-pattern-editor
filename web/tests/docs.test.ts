/**
 * The docs can't silently point at something that isn't there (docs/README.md,
 * "Keeping the docs true"):
 *
 * - every relative link and image in the repo's Markdown docs points at a file that
 *   exists, and every `#anchor` at a heading (GitHub's slugs) or an explicit `id`;
 * - every `docs/….md` or spec path cited in the code (comments included) exists, with
 *   its `#anchor`.
 *
 * A failure names the file and line of each broken reference.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'dist', '__pycache__', 'test-results',
  'playwright-report', '.claude', 'saved',
])

/** Every file under `dir` (repo-relative), skipping build output and dependencies. */
function filesUnder(dir: string): string[] {
  const root = join(REPO, dir)
  if (!existsSync(root)) return []
  const out: string[] = []
  const visit = (abs: string) => {
    for (const name of readdirSync(abs)) {
      if (SKIP_DIRS.has(name)) continue
      const path = join(abs, name)
      if (statSync(path).isDirectory()) visit(path)
      else out.push(relative(REPO, path).split('\\').join('/'))
    }
  }
  visit(root)
  return out.sort()
}

const isReadme = (f: string) => f.endsWith('/README.md')

/** The Markdown files whose links are checked. */
export function markdownFiles(): string[] {
  const top = ['README.md', 'CLAUDE.md', 'CONTRIBUTING.md'].filter((f) =>
    existsSync(join(REPO, f)),
  )
  return [
    ...top,
    ...filesUnder('docs').filter((f) => f.endsWith('.md')),
    ...filesUnder('fixtures').filter(isReadme),
    ...(existsSync(join(REPO, 'web/README.md')) ? ['web/README.md'] : []),
    ...filesUnder('web/src').filter(isReadme),
    ...filesUnder('scripts').filter(isReadme),
  ]
}

/** Blank out fenced code blocks and inline code, keeping every offset and newline. */
function maskCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  return text
    .replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1\2[`~]*[ \t]*$|(?![\s\S]))/gm, blank)
    .replace(/(`+)[^`\n][\s\S]*?\1/g, (m) => (m.includes('\n\n') ? m : blank(m)))
}

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length

/** GitHub's heading slug (github-slugger): lower case, punctuation dropped, spaces to -. */
export function slug(heading: string): string {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images: their text
    .replace(/<[^>]+>/g, '') // HTML tags
    .replace(/[*`]/g, '') // emphasis and code markers
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

const anchorCache = new Map<string, Set<string>>()

/** The anchors a Markdown file offers: its headings' slugs and any explicit ids. */
export function anchorsOf(file: string): Set<string> {
  const cached = anchorCache.get(file)
  if (cached) return cached
  const text = readFileSync(join(REPO, file), 'utf8')
  const masked = maskCode(text)
  const anchors = new Set<string>()
  const seen = new Map<string, number>()
  for (const m of masked.matchAll(/^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/gm)) {
    // Headings are read from the original text, so inline code in them counts.
    const start = m.index
    const line = text.slice(start, start + m[0].length)
    const heading = line.replace(/^ {0,3}#{1,6}[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '')
    const base = slug(heading)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    anchors.add(n === 0 ? base : `${base}-${n}`)
  }
  for (const m of masked.matchAll(/<[a-z][^>]*?\s(?:id|name)="([^"]+)"/gi)) anchors.add(m[1]!)
  anchorCache.set(file, anchors)
  return anchors
}

/** Check `path#anchor` (repo-relative path) exists; returns the problem, if any. */
function checkTarget(path: string, anchor: string | undefined): string | null {
  const abs = join(REPO, path)
  if (!existsSync(abs)) return 'no such file'
  if (anchor === undefined || anchor === '') return null
  if (!path.endsWith('.md') || statSync(abs).isDirectory()) return null
  return anchorsOf(path).has(anchor) ? null : `no heading or id "${anchor}" in ${path}`
}

export interface Problem {
  file: string
  line: number
  target: string
  why: string
}

const format = (p: Problem) => `${p.file}:${p.line}: "${p.target}": ${p.why}`

/** Every relative link, image and HTML href/src in one Markdown file (repo-relative). */
export function linkProblems(file: string, text = readFileSync(join(REPO, file), 'utf8')): Problem[] {
  const masked = maskCode(text)
  const found: { target: string; index: number }[] = []
  for (const m of masked.matchAll(/!?\[(?:[^\]]|\n)*?\]\(\s*<?([^)\s>]*)>?(?:\s+["'(][^)]*)?\)/g)) {
    found.push({ target: m[1]!, index: m.index })
  }
  for (const m of masked.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) {
    found.push({ target: m[1]!, index: m.index })
  }
  for (const m of masked.matchAll(/<[a-z][^>]*?\s(?:href|src)="([^"]*)"/gi)) {
    found.push({ target: m[1]!, index: m.index })
  }
  const problems: Problem[] = []
  for (const { target, index } of found) {
    if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue
    const hash = target.indexOf('#')
    const rawPath = hash < 0 ? target : target.slice(0, hash)
    const anchor = hash < 0 ? undefined : decodeURIComponent(target.slice(hash + 1))
    const decoded = decodeURIComponent(rawPath)
    const path =
      decoded === ''
        ? file
        : decoded.startsWith('/')
          ? decoded.slice(1)
          : relative(REPO, resolve(REPO, dirname(file), decoded)).split('\\').join('/')
    if (path.startsWith('..')) {
      problems.push({ file, line: lineAt(text, index), target, why: 'points outside the repo' })
      continue
    }
    const why = checkTarget(path === '' ? '.' : path, anchor)
    if (why) problems.push({ file, line: lineAt(text, index), target, why })
  }
  return problems
}

/** Folders whose code may cite the docs, and the kinds of file read there. */
const CODE_DIRS = ['web/src', 'web/e2e', 'web/tests', 'web/scripts', 'alphareader', 'scripts']
const CODE_EXT = /\.(?:tsx?|mjs|js|py|css)$/
/** It names the docs' old paths on purpose, as history. Only its links are checked. */
const EXEMPT_CITED = new Set(['docs/documentation-plan.md'])
// A docs/….md path (not part of a longer path) or the spec's old root name, with an
// optional #anchor.
const CITED = /(?<![\w.\-/])((?:docs\/[\w.\-/]+?\.md)|plan\.md)(?:#([\w-]+))?/g

export function codeFiles(): string[] {
  return CODE_DIRS.flatMap((d) => filesUnder(d)).filter((f) => CODE_EXT.test(f))
}

/** Every docs path cited in one code file that doesn't exist, anchors included. */
export function citedProblems(file: string, text = readFileSync(join(REPO, file), 'utf8')): Problem[] {
  const problems: Problem[] = []
  for (const m of text.matchAll(CITED)) {
    const [target, path, anchor] = [m[0], m[1]!, m[2]]
    if (EXEMPT_CITED.has(path)) continue
    const why = checkTarget(path, anchor)
    if (why) problems.push({ file, line: lineAt(text, m.index), target, why })
  }
  return problems
}

describe('docs', () => {
  it('finds the docs and the code it checks', () => {
    const md = markdownFiles()
    expect(md).toContain('README.md')
    expect(md).toContain('docs/dev/rules.md')
    expect(md).toContain('web/src/yarn/data/README.md')
    const code = codeFiles()
    expect(code).toContain('web/src/render/layout.ts')
    expect(code).toContain('alphareader/core/bridge.py')
    expect(code).toContain('scripts/build_core_bundle.py')
  })

  it('every relative link and image in the docs points at a file and anchor that exist', () => {
    const problems = markdownFiles().flatMap((f) => linkProblems(f))
    expect(problems.map(format)).toEqual([])
  })

  it('every docs path cited in the code exists, with its anchor', () => {
    const problems = codeFiles().flatMap((f) => citedProblems(f))
    expect(problems.map(format)).toEqual([])
  })

  it('reads GitHub-style slugs and explicit ids', () => {
    expect(slug('Phase 2 — Import wizard and the Pyodide boundary (~2.5 weeks)')).toBe(
      'phase-2--import-wizard-and-the-pyodide-boundary-25-weeks',
    )
    expect(slug('`CLAUDE.md` and [the rules](rules.md)')).toBe('claudemd-and-the-rules')
    expect(anchorsOf('docs/dev/rules.md').has('nd-py')).toBe(true)
  })

  it('reports a broken link, a broken anchor and a broken cited path by file and line', () => {
    // Paths are spelled with `D`, so this file's own text cites nothing broken.
    const D = 'docs'
    const md = 'Fine: [spec](dev/spec.md).\n\nBroken: [x](dev/nope.md) and [y](dev/rules.md#nope).\n'
    expect(linkProblems(`${D}/example.md`, md).map(format)).toEqual([
      `${D}/example.md:3: "dev/nope.md": no such file`,
      `${D}/example.md:3: "dev/rules.md#nope": no heading or id "nope" in ${D}/dev/rules.md`,
    ])
    const code = `// ok\n// see ${D}/dev/nope.md and\n// ${D}/dev/rules.md#nope\n`
    expect(citedProblems('web/src/example.ts', code).map(format)).toEqual([
      `web/src/example.ts:2: "${D}/dev/nope.md": no such file`,
      `web/src/example.ts:3: "${D}/dev/rules.md#nope": no heading or id "nope" in ${D}/dev/rules.md`,
    ])
  })
})
