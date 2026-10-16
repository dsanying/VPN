import { defineConfig, devices } from '@playwright/test';
import { APP_ORIGIN, APP_PORT } from './tests/ui/app-origin';

const browsers = ['chromium'] as const;
const desktopPreset = { chromium: 'Desktop Chrome' } as const;

// Each engine runs against an isolated production fixture, never a user's development server.
export default defineConfig({
  projects: browsers.map((name) => ({ name, use: devices[desktopPreset[name]] })),
  testDir: './tests/ui',
  outputDir: './.playwright/results',
  workers: 2,
  fullyParallel: false,
  retries: 0,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  reporter: 'line',
  use: {
    baseURL: APP_ORIGIN,
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    url: APP_ORIGIN,
    command: `node node_modules/vite/bin/vite.js preview --outDir .playwright/app --host 127.0.0.1 --strictPort --port ${APP_PORT}`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
