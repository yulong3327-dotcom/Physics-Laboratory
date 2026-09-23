import { defineConfig, devices } from '@playwright/test'

const localURL = 'http://127.0.0.1:5174'
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || localURL,
    trace: 'retain-on-failure', channel: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: localURL, reuseExistingServer: false, timeout: 30000,
  },
})
