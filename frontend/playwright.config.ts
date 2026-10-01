import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '..');
const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173';
const backendUrl = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
const browserChannel = process.env.E2E_BROWSER_CHANNEL || 'msedge';
const skipWebServer = process.env.STAGE31_SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: frontendUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
  },
  webServer: skipWebServer ? [] : [
    {
      command: 'npm.cmd run start --workspace backend',
      cwd: rootDir,
      url: `${backendUrl}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm.cmd run build:e2e --workspace frontend && npm.cmd run preview --workspace frontend -- --host 127.0.0.1 --port 5173',
      cwd: rootDir,
      url: frontendUrl,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'desktop-edge',
      use: {
        ...devices['Desktop Chrome'],
        channel: browserChannel,
      },
    },
    {
      name: 'mobile-360-edge',
      use: {
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        channel: browserChannel,
      },
    },
  ],
});
