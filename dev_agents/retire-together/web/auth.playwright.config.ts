import { defineConfig } from '@playwright/test'

const port = process.env.RETIRE_E2E_PORT ?? '8779'
export default defineConfig({
  testDir: './e2e', testMatch: 'web-auth.spec.ts', workers: 1,
  outputDir: `test-results-${port}`, timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'chrome' },
  webServer: {
    command: '../.venv/bin/python e2e/auth-server.py',
    env: { RETIRE_E2E_PORT: port },
    url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: false,
  },
})
