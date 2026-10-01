const path = require('node:path');
const fs = require('node:fs');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

process.env.STAGE_E2E_SPEC = 'e2e/stage62-safe-data-hygiene.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '480000';
require('./stage31-playwright-e2e');
