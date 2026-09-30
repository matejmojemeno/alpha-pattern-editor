import { defineConfig, devices } from '@playwright/test'

// End-to-end tests in real Chromium, against the production build (`vite preview`).
// First time: `npx playwright install chromium`. Then: `npm run test:e2e`.
export default defineConfig({
  testDir: 'e2e',
  // The docs' screenshots have their own config and command (playwright.docs.config.ts,
  // `npm run docs:media`): they rewrite committed images, so they never run here.
  testIgnore: 'docs-media.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
