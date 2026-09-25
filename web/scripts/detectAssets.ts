/**
 * The files the detection worker downloads, self-hosted (docs/web-port-plan.md, Phase 2):
 *
 * - the Pyodide runtime, copied from the pinned `pyodide` npm package;
 * - numpy's wheel, which the npm package doesn't include. It is fetched once from
 *   Pyodide's own release on jsDelivr, checked against the sha256 in the package's
 *   pyodide-lock.json, and cached in web/.cache/ (gitignored);
 * - `alphareader-core.<hash>.zip`, from scripts/build_core_bundle.py.
 *
 * `npm run dev` serves them and `npm run build` writes them into dist/, under
 * `pyodide/v<version>/` and `py/`. At runtime nothing comes from a third-party CDN, so the
 * version the parity harness verified is the version users get.
 *
 * The worker learns the paths and sizes from the virtual module `virtual:detect-assets`.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import type { Plugin, ViteDevServer } from 'vite'

/** The version scripts/parity/ verified to be bit-identical with the desktop. */
export const PYODIDE_VERSION = '314.0.7'
/** Cloudflare Pages refuses any single file larger than this. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024
/** Packages loaded into Pyodide. SciPy and Pillow are deliberately absent. */
export const PACKAGES = ['numpy'] as const

const WEB = resolve(import.meta.dirname, '..')
const ROOT = resolve(WEB, '..')
const PYODIDE_NPM = join(WEB, 'node_modules', 'pyodide')
const CACHE = join(WEB, '.cache')
const CORE_OUT = join(CACHE, 'core')
const WHEELS = join(CACHE, 'wheels')
const RUNTIME_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
const VIRTUAL_ID = 'virtual:detect-assets'
const RESOLVED_ID = '\0' + VIRTUAL_ID

export const PYODIDE_DIR = `pyodide/v${PYODIDE_VERSION}/`
export const CORE_DIR = 'py/'

export type Stage = 'runtime' | 'numpy' | 'core'

export interface Asset {
  /** Where it is served, relative to the site's base URL. */
  path: string
  /** The file on disk. */
  source: string
  stage: Stage
  bytes: number
  gzipBytes: number
}

interface LockPackage {
  file_name: string
  sha256: string
  depends: string[]
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T
}

/** The npm package, web/package.json and the parity harness must all pin one version. */
function checkVersions(): void {
  const installed = readJson<{ version: string }>(join(PYODIDE_NPM, 'package.json')).version
  const web = readJson<{ devDependencies?: Record<string, string>; dependencies?: Record<string, string> }>(
    join(WEB, 'package.json'),
  )
  const parity = readJson<{ dependencies: Record<string, string> }>(join(ROOT, 'scripts/parity/package.json'))
  const pins = {
    'node_modules/pyodide': installed,
    'web/package.json': web.devDependencies?.pyodide ?? web.dependencies?.pyodide,
    'scripts/parity/package.json': parity.dependencies.pyodide,
  }
  for (const [where, v] of Object.entries(pins)) {
    if (v !== PYODIDE_VERSION) {
      throw new Error(`Pyodide must be exactly ${PYODIDE_VERSION} (what scripts/parity verified); ${where} has ${v}.`)
    }
  }
}

/** A package's wheel and those of everything it depends on, from the lock file. */
function wheelsFor(names: readonly string[]): LockPackage[] {
  const lock = readJson<{ packages: Record<string, LockPackage> }>(join(PYODIDE_NPM, 'pyodide-lock.json'))
  const out = new Map<string, LockPackage>()
  const visit = (name: string) => {
    const pkg = lock.packages[name]
    if (!pkg) throw new Error(`pyodide-lock.json has no package ${name}`)
    if (out.has(name)) return
    out.set(name, pkg)
    pkg.depends.forEach(visit)
  }
  names.forEach(visit)
  return [...out.values()]
}

/** A wheel on disk with the right hash: from Pyodide's own node cache, ours, or fetched. */
async function ensureWheel(pkg: LockPackage): Promise<string> {
  for (const file of [join(PYODIDE_NPM, pkg.file_name), join(WHEELS, pkg.file_name)]) {
    if (existsSync(file) && sha256(readFileSync(file)) === pkg.sha256) return file
  }
  const url = CDN + pkg.file_name
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't download ${url}: HTTP ${res.status}`)
  const data = new Uint8Array(await res.arrayBuffer())
  if (sha256(data) !== pkg.sha256) throw new Error(`${url} doesn't match the sha256 in pyodide-lock.json`)
  mkdirSync(WHEELS, { recursive: true })
  const file = join(WHEELS, pkg.file_name)
  writeFileSync(file, data)
  return file
}

function python(): string {
  if (process.env.PYTHON) return process.env.PYTHON
  const venv = join(ROOT, '.venv', 'bin', 'python')
  return existsSync(venv) ? venv : 'python3'
}

/** Run scripts/build_core_bundle.py; returns the zip's path. */
export function buildCoreBundle(): string {
  const out = execFileSync(python(), [join(ROOT, 'scripts/build_core_bundle.py'), '--out', CORE_OUT], {
    encoding: 'utf-8',
  })
  return join(CORE_OUT, (JSON.parse(out) as { file: string }).file)
}

const gzipCache = new Map<string, { mtime: number; size: number }>()

function asset(path: string, source: string, stage: Stage): Asset {
  const st = statSync(source)
  if (st.size > MAX_FILE_BYTES) {
    throw new Error(`${relative(ROOT, source)} is ${st.size} bytes, over Cloudflare Pages' 25 MiB per-file limit.`)
  }
  let gz = gzipCache.get(source)
  if (!gz || gz.mtime !== st.mtimeMs) {
    gz = { mtime: st.mtimeMs, size: gzipSync(readFileSync(source), { level: 9 }).length }
    gzipCache.set(source, gz)
  }
  return { path, source, stage, bytes: st.size, gzipBytes: gz.size }
}

/** Everything the worker downloads, ready on disk. */
export async function prepareAssets(): Promise<Asset[]> {
  checkVersions()
  const out = RUNTIME_FILES.map((f) => asset(PYODIDE_DIR + f, join(PYODIDE_NPM, f), 'runtime'))
  for (const pkg of wheelsFor(PACKAGES)) {
    out.push(asset(PYODIDE_DIR + pkg.file_name, await ensureWheel(pkg), 'numpy'))
  }
  out.push(coreAsset())
  return out
}

function coreAsset(): Asset {
  const zip = buildCoreBundle()
  return asset(CORE_DIR + zip.slice(CORE_OUT.length + 1), zip, 'core')
}

/** The source of `virtual:detect-assets`. */
export function assetsModule(assets: readonly Asset[]): string {
  const core = assets.find((a) => a.stage === 'core')
  const stageBytes: Record<Stage, number> = { runtime: 0, numpy: 0, core: 0 }
  for (const a of assets) stageBytes[a.stage] += a.bytes
  return [
    `export const pyodideVersion = ${JSON.stringify(PYODIDE_VERSION)}`,
    `export const pyodideDir = ${JSON.stringify(PYODIDE_DIR)}`,
    `export const coreBundle = ${JSON.stringify(core?.path ?? `${CORE_DIR}alphareader-core.test.zip`)}`,
    `export const packages = ${JSON.stringify(PACKAGES)}`,
    `export const stageBytes = ${JSON.stringify(stageBytes)}`,
    `export const downloadBytes = ${assets.reduce((n, a) => n + a.gzipBytes, 0)}`,
  ].join('\n')
}

const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.whl': 'application/zip',
}

// Shared by the plugin's instances: the app's build and the worker's each get one.
let assets: Asset[] = []
let ready: Promise<void> | undefined

/** `emit`: write the files into the build. Only the app's instance does; the worker's
 *  instance just answers `virtual:detect-assets`. */
export function detectAssets({ emit = true }: { emit?: boolean } = {}): Plugin {
  // Vitest runs the plugins too; component tests only need the module to exist.
  const testing = !!process.env.VITEST
  let base = '/'

  const prepare = () =>
    (ready ??= testing
      ? Promise.resolve()
      : prepareAssets().then((a) => {
          assets = a
        }))

  return {
    name: 'detect-assets',
    configResolved(config) {
      base = config.base
    },
    buildStart() {
      return prepare()
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined
      await prepare()
      return assetsModule(assets)
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]!)
        const hit = path.startsWith(base) && assets.find((a) => a.path === path.slice(base.length))
        if (!hit) return next()
        res.setHeader('Content-Type', CONTENT_TYPES[hit.source.slice(hit.source.lastIndexOf('.'))] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(hit.source))
      })
      // Editing the Python rebuilds the bundle; the next import screen gets the new one.
      const core = join(ROOT, 'alphareader', 'core')
      server.watcher.add(core)
      const rebuild = (file: string) => {
        if (testing || !file.startsWith(core) || file.includes('__pycache__')) return
        try {
          assets = [...assets.filter((a) => a.stage !== 'core'), coreAsset()]
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
          if (mod) server.moduleGraph.invalidateModule(mod)
        } catch (e) {
          server.config.logger.error(`[detect-assets] ${String(e)}`)
        }
      }
      server.watcher.on('change', rebuild)
      server.watcher.on('add', rebuild)
      server.watcher.on('unlink', rebuild)
    },
    async generateBundle() {
      if (!emit) return
      await prepare()
      for (const a of assets) {
        this.emitFile({ type: 'asset', fileName: a.path, source: readFileSync(a.source) })
      }
    },
  }
}
