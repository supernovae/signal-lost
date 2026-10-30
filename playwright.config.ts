import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  forbidOnly: Boolean(process.env['CI']),
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}/signal-lost/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/signal-lost/`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
