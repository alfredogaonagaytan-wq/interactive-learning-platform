import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (service worker included).
 * Only Chromium is installed in CI/dev containers; "mobile" projects emulate
 * phone viewports and touch on Chromium. Real iOS Safari / Android / Chromebook
 * testing is still required before classroom use.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // A simulated microphone (Chromium's fake device) so recording is exercised for real.
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-phone', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-viewport', use: { ...devices['iPhone 14'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
  ],
});
