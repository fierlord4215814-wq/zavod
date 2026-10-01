process.env.STAGE_E2E_SPEC = 'e2e/v1-pilot-data-role-audit.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '480000';
require('./stage31-playwright-e2e');
