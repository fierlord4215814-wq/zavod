const { spawnSync } = require('node:child_process');
const path = require('node:path');

const frontend = path.resolve(__dirname, '..');
const cli = require.resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [
  cli,
  'test',
  'e2e/pilot-fix-plast6.spec.ts',
  '--project=desktop-edge',
  '--project=mobile-360-edge',
  '--workers=1',
], {
  cwd: frontend,
  stdio: 'inherit',
  env: {
    ...process.env,
    STAGE31_SKIP_WEBSERVER: '1',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://127.0.0.1:5173',
    VITE_API_URL: process.env.VITE_API_URL || 'http://127.0.0.1:3000',
  },
});

if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
