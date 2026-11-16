import { defineConfig } from '@playwright/test'
const port = process.env.RETIRE_E2E_PORT ?? '8786'
export default defineConfig({
  testDir: './e2e', testMatch: 'shared-household.spec.ts', workers: 1, fullyParallel: false,
  outputDir: `test-results-${port}`, timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: '../.venv/bin/python e2e/share-server.py', env: { RETIRE_E2E_PORT: port }, url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: false },
})
