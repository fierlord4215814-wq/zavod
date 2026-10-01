process.env.STAGE_E2E_SPEC = 'e2e/stage37-defrost-calendar.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '240000';
require('./stage31-playwright-e2e');
