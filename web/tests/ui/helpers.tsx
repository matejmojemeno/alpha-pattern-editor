/**
 * Shared set-up for the component tests (jsdom). Each test gets a fresh IndexedDB
 * database through fake-indexeddb, a real ProjectRepo on it, and an in-memory settings
 * store, then renders the whole <App> at a given route.
 */
import 'fake-indexeddb/auto'

import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import App from '../../src/App.tsx'
import { clearPendingImage } from '../../src/app/pendingImage.ts'
import { createSettingsStore, type SettingsStore } from '../../src/settings/store.ts'
import { ProjectRepo } from '../../src/storage/repo.ts'

// No Worker or Pyodide in jsdom: detection is the real client on a fake worker, and image
// decoding (createImageBitmap) is faked too. Tests reach both through fakeDetection.ts.
vi.mock('../../src/app/detection.ts', async () => (await import('./fakeDetection.ts')).fakeDetectionModule)
vi.mock('../../src/importer/decode.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/importer/decode.ts')>()),
  decodeImage: vi.fn(async () => ({ rgba: new Uint8Array(40 * 30 * 4), width: 40, height: 30 })),
  sourcePng: vi.fn(async (file: Blob) => new Uint8Array(await file.arrayBuffer())),
}))

// fake-indexeddb stores values with Node's structuredClone, which turns jsdom's Blob into
// an empty object. Browsers clone Blobs natively, so use Node's Blob and File here.
globalThis.Blob = NodeBlob as unknown as typeof Blob
globalThis.File = NodeFile as unknown as typeof File

let seq = 0

export function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

// scripts/alphaFixtures.ts resolves paths with fileURLToPath(new URL(...)), which jsdom's
// URL class breaks; vitest runs from web/, so resolve from there.
export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(process.cwd(), '../fixtures/alpha/desktop', name)))
}

export function alphaFile(name: string, as = name): File {
  return new File([fixture(name) as Uint8Array<ArrayBuffer>], as, { type: 'application/octet-stream' })
}

let opened: ProjectRepo[] = []

export async function freshRepo(): Promise<ProjectRepo> {
  const repo = await ProjectRepo.open(`ui-test-${Date.now()}-${++seq}`, () => 1_800_000_000)
  opened.push(repo)
  return repo
}

export async function renderApp(hash: string, opts: { repo?: ProjectRepo; settings?: SettingsStore } = {}) {
  const repo = opts.repo ?? (await freshRepo())
  const storage = memoryStorage()
  const settings = opts.settings ?? createSettingsStore(() => storage)
  window.location.hash = hash
  const view = render(<App repo={Promise.resolve(repo)} settings={settings} />)
  // Let the repo promise resolve and the first list/open settle.
  await act(async () => {})
  return { ...view, repo, settings, storage }
}

/** Wait for navigation triggered by a hash change to render. */
export async function hashChanged() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

export { screen } from '@testing-library/react'

beforeEach(() => {
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => `blob:test/${++seq}`)
  URL.revokeObjectURL = vi.fn()
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  // jsdom has no canvas; without this it logs "not implemented" for every chart.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']
})

afterEach(() => {
  cleanup()
  opened.forEach((r) => r.close())
  opened = []
  delete document.documentElement.dataset.contrast
  window.location.hash = ''
  clearPendingImage()
})
