import { defineConfig } from '@playwright/test'

const testOrigin = `http://127.0.0.1:${process.env.RETIRE_E2E_PORT ?? '8765'}`

export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.RETIRE_E2E_PORT ? `test-results-${process.env.RETIRE_E2E_PORT}` : 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: testOrigin,
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    extraHTTPHeaders: { Origin: testOrigin, 'X-Retire-Local': '1' },
  },
  webServer: {
    command: '../.venv/bin/python e2e/server.py',
    url: `${testOrigin}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
})
