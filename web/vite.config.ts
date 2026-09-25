/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { detectAssets } from './scripts/detectAssets.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), detectAssets()],
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
