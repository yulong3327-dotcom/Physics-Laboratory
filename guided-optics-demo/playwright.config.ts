import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:5174/', browserName: 'chromium', channel: 'msedge' },
  reporter: 'list',
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5174/', reuseExistingServer: true },
})
