import { defineConfig, devices } from '@playwright/test';

// Tests run against the production build, served by request interception in
// tests/e2e/fixtures.ts. SwarmOS validation sandboxes forbid listening on a port.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  forbidOnly: Boolean(process.env['CI']),
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'https://supernovae.github.io/signal-lost/',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--no-sandbox', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
