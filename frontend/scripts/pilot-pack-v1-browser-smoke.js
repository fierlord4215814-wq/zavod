process.env.STAGE_E2E_SPEC = 'e2e/pilot-pack-v1-browser-smoke.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '360000';
require('./stage31-playwright-e2e');
