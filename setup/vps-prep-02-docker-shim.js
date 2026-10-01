'use strict';

const fs = require('node:fs');

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('Synthetic Docker CLI (test only)\n');
  process.exit(0);
}
if (args.includes('version') && args.includes('compose')) {
  process.stdout.write('Synthetic Compose (test only)\n');
  process.exit(0);
}

const logPath = process.env.VPS_PREP_02_SHIM_LOG;
const statePath = process.env.VPS_PREP_02_SHIM_STATE;
if (!logPath || !statePath) process.exit(90);
fs.appendFileSync(logPath, `${JSON.stringify(args)}\n`);
const command = args.join(' ');
const failure = process.env.VPS_PREP_02_SHIM_FAIL;
if (failure && command.includes(failure)) {
  process.stderr.write(`SYNTHETIC_FAILURE:${failure}\n`);
  process.exit(7);
}

let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { adminReady: false };
if (command.includes('vps-prep:runtime-status')) {
  if (state.schemaError) {
    process.stdout.write('RUNTIME_READINESS=MIGRATIONS_INCOMPLETE\n');
    process.exit(2);
  }
  process.stdout.write(`RUNTIME_READINESS=${state.adminReady ? 'READY' : 'FIRST_ADMIN_REQUIRED'}\n`);
  process.exit(state.adminReady ? 0 : 3);
}
if (command.includes('bootstrap-first-admin.js')) {
  const credential = fs.readFileSync(0, 'utf8').trim();
  if (!args.includes('--credential-stdin') || credential.length < 12 || args.includes(credential)) process.exit(8);
  const repeated = state.adminReady;
  state = { ...state, adminReady: true };
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write(`FIRST_ADMIN_BOOTSTRAP=${repeated ? 'ALREADY_COMPLETED' : 'CREATED'}\nCHANGED=${repeated ? 'NO' : 'YES'}\n`);
  process.exit(repeated ? 3 : 0);
}
process.stdout.write('SYNTHETIC_OK\n');
