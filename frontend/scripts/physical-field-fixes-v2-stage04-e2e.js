process.env.STAGE_E2E_SPEC = 'e2e/physical-field-fixes-v2-stage04.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '420000';
require('./stage31-playwright-e2e');
