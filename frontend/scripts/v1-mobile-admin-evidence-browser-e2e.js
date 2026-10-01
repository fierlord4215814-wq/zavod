process.env.STAGE_E2E_SPEC = 'e2e/v1-mobile-admin-evidence.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '300000';
require('./stage31-playwright-e2e');
