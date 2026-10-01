const path = require('node:path');

process.chdir(path.resolve(__dirname, '..'));
process.env.STAGE_E2E_SPEC = 'e2e/notification-authority-source-navigation.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '360000';
require('./stage31-playwright-e2e');
