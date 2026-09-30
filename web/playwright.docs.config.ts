import { defineConfig, devices } from '@playwright/test'

// The user guide's screenshots and tour (e2e/docs-media.spec.ts), kept out of
// `npm run test:e2e`: it is slow, and it writes committed files. Run it with
// `npm run docs:media` (and `DOCS_TOUR=1` for the recording; see web/README.md).
//
// Each screenshot is a `toHaveScreenshot` whose "snapshot" is the image in
// docs/guide/media/, and `updateSnapshots: 'changed'` rewrites only the images whose
// pixels differ (exactly: no threshold, e2e/docs-media.spec.ts), so an unchanged screen
// leaves git clean. Its own port (4187, or $DOCS_PORT), and never a server already
// running, so it can't pick up a stale build or collide with `npm run test:e2e` on 4174.
const PORT = Number(process.env.DOCS_PORT ?? 4187)

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'docs-media.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  reporter: 'list',
  // One path per image, named by the test: docs/guide/media/<name>.png.
  snapshotPathTemplate: '../docs/guide/media/{arg}{ext}',
  updateSnapshots: 'changed',
  // Importing a photo boots Pyodide in each test's page.
  timeout: 5 * 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light' },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
