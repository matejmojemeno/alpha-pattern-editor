/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import { detectAssets } from './scripts/detectAssets.ts'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** The commit being built (src/app/build.ts): Cloudflare's build sets
 *  WORKERS_CI_COMMIT_SHA; anywhere else, ask git. '' if neither knows. */
function commit(): string {
  const sha = process.env.WORKERS_CI_COMMIT_SHA ?? gitHead()
  return sha.slice(0, 7)
}

function gitHead(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** The picture a shared link shows (index.html's og:image): the Design stage, from the
 *  guide's generated screenshots (`npm run docs:media`), copied rather than kept twice.
 *  Not under /assets, so it isn't cached for good and can change with the screenshot. */
function socialImage(): Plugin {
  return {
    name: 'social-image',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'social.png',
        source: readFileSync(new URL('../docs/guide/media/design.png', import.meta.url)),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), detectAssets(), socialImage()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit()),
  },
  worker: {
    // Pyodide runs in a module worker (src/detect/worker.ts).
    format: 'es',
    plugins: () => [detectAssets({ emit: false })],
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
