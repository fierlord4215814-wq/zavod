const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const logs = path.join(__dirname, process.env.LOCAL03_CHECKS === '1' ? '../local-03/logs' : 'logs');
fs.mkdirSync(logs, { recursive: true });
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 12e6 });
  fs.writeFileSync(path.join(logs, `${name}.txt`), `${result.stdout || ''}${result.stderr || ''}`);
  console.log(`${name}: exit=${result.status}`);
  if (result.status) console.log(result.stdout, result.stderr);
  assert.equal(result.status, 0, name);
}
async function main() {
  run('backend-build', ['node_modules/typescript/bin/tsc', '-p', 'backend/tsconfig.build.json']);
  run('frontend-typecheck', ['node_modules/typescript/bin/tsc', '--project', 'frontend/tsconfig.json', '--noEmit']);
  run('chat-policy-isolated', ['--test', 'backend/scripts/local01-chat-guest-policy.test.js', 'backend/scripts/local02-chat-policy.test.js', 'backend/scripts/master-r2-chat-chain.test.js']);
  run('checklist-isolated', ['--test', 'backend/scripts/master-r2-checklist.test.js']);
  run('foundation-auth-isolated', ['backend/scripts/vps-prep-01-regression.js']);
  if (process.env.LOCAL03_CHECKS === '1') {
    run('chat-ui-state-isolated', ['--test', 'backend/scripts/local03-chat-ui-state.test.js']);
    run('people-presence-isolated', ['--test', 'backend/scripts/local03-people-presence.test.js']);
    run('quality-realtime-isolated', ['--test', 'backend/scripts/local03-quality-realtime.test.js', 'backend/scripts/master-r2-quality-replay.test.js', 'backend/scripts/master-r3-quantity.test.js']);
    // Only quality consumers changed here; unrelated J20 still has pre-LOCAL02 eligibility fixtures.
    run('quality-consumers-isolated', ['--test', '--test-name-pattern=J15|J17|J16', 'backend/scripts/master-domain-contracts.test.js']);
  }
  const { build } = await import('../../../node_modules/vite/dist/node/index.js');
  // Existing Vite config/build, with an empty env directory: never read working .env.
  const emptyEnv = path.join(__dirname, 'empty-build-env'); fs.mkdirSync(emptyEnv, { recursive: true });
  await build({ root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.ts'), envDir: emptyEnv });
  fs.writeFileSync(path.join(logs, 'frontend-build.txt'), 'Canonical Vite build PASS; empty envDir; no working .env read.\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
