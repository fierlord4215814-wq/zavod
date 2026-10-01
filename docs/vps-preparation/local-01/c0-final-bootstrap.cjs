const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const runtime = process.env.LOCAL01_RUNTIME_DIR;
if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
const secretDir = join(runtime, 'secrets');
const recoveryFile = join(secretDir, 'final-c0-recovery.txt');
const personalFile = join(secretDir, 'final-c0-personal.txt');
if (existsSync(recoveryFile) || existsSync(personalFile)) {
  throw new Error('Final C0 credentials already exist; inspect target before retry');
}
const password = readFileSync(join(secretDir, 'db-password.txt'), 'utf8').trim();
const url = `postgresql://local01_owner:${encodeURIComponent(password)}@127.0.0.1:15436/zavod_local01_final_c0?schema=public`;
const recovery = `L01!${randomBytes(30).toString('base64url')}`;
const personal = `L01!${randomBytes(30).toString('base64url')}`;
writeFileSync(recoveryFile, recovery, { flag: 'wx', mode: 0o600 });
writeFileSync(personalFile, personal, { flag: 'wx', mode: 0o600 });
const result = spawnSync(process.execPath, [
  join(process.cwd(), 'backend', 'dist', 'cli', 'bootstrap-first-admin.js'),
  '--factory-name', 'Чистый завод LOCAL-01 final C0',
  '--factory-code', 'local01-final-c0',
  '--admin-phone', '+79990001101',
  '--admin-last-name', 'Администратор',
  '--admin-first-name', 'Учебный',
  '--credential-stdin',
], { input: recovery, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'production' } });
if (result.status !== 0) {
  throw new Error(`Final C0 bootstrap failed, target and protected credentials retained: ${result.stderr.replace(url, '[DATABASE_URL]')}`);
}
assert.match(result.stdout, /FIRST_ADMIN_BOOTSTRAP=CREATED/);
console.log(result.stdout.trim());
console.log('FINAL_C0_PROTECTED_CREDENTIALS=CREATED_IN_OWN_RUNTIME');
