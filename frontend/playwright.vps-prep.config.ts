import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '..');

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
  },
  webServer: [{
    command: 'npm.cmd run build:e2e --workspace frontend && npm.cmd run preview --workspace frontend -- --host 127.0.0.1 --port 5173',
    cwd: rootDir,
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 60_000,
  }],
  projects: [
    { name: 'desktop-edge', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_BROWSER_CHANNEL || 'msedge' } },
    {
      name: 'mobile-360-edge',
      use: {
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        channel: process.env.E2E_BROWSER_CHANNEL || 'msedge',
      },
    },
  ],
});
