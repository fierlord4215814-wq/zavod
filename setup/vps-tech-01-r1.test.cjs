'use strict';

// No app/DB/Docker imports or live command fallback: every external command is
// supplied by each case. All files stay under one synthetic temporary root.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { collectBuildFiles } = require('./deployment-context');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zavod-vps-tech01-r1-'));
const dump = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(256, 7)]);
test('release identity hashes portable slash-normalized paths and current bytes', () => {
  const sourceRoot = path.resolve(__dirname, '..');
  const hash = crypto.createHash('sha256');
  for (const relative of collectBuildFiles(sourceRoot)) {
    hash.update(relative.replace(/\\/g, '/'));
    hash.update(fs.readFileSync(path.join(sourceRoot, relative)));
  }
  const setup = require('./zavod-setup');
  assert.equal(setup.candidateReleaseId(), `1.0.0+${hash.digest('hex').slice(0, 16)}`);
});
let sequence = 0;
function fixture(options = {}) {
  const root = path.join(temp, String(++sequence));
  const runtime = path.join(root, 'runtime');
  const paths = Object.fromEntries(['dbDataDir', 'uploadsDir', 'backupsDir', 'errorReportsExportPath', 'logsDir']
    .map((key) => [key, path.join(root, key)]));
  for (const value of [runtime, ...Object.values(paths)]) fs.mkdirSync(value, { recursive: true });
  process.env.ZAVOD_SETUP_RUNTIME = runtime;
  delete require.cache[require.resolve('./zavod-setup')];
  const setup = require('./zavod-setup');
  const config = setup.normalizeConfig({ serverAddress: '127.0.0.1', backendPort: 31000 + sequence, frontendPort: 35170 + sequence,
    ...paths, instanceId: crypto.randomUUID(), buildReleaseId: '1.0.0+synthetic',
    dockerProjectName: `synthetic-${sequence}`, restoreTargetPending: Boolean(options.restoreTargetPending) });
  fs.writeFileSync(path.join(runtime, 'zavod.config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(runtime, 'production.env'), setup.makeEnv(config, {
    postgresPassword: crypto.randomBytes(24).toString('hex'), jwtSecret: crypto.randomBytes(48).toString('hex'),
  }));
  if (options.uploadsFile) fs.writeFileSync(path.join(paths.uploadsDir, 'photo-fake.txt'), 'synthetic file A');
  const active = new Set(options.stopped ? ['db'] : ['db', 'backend', 'frontend']);
  const log = [];
  const runner = {
    compose(args) {
      log.push(`compose ${args.join(' ')}`);
      if (args[0] === 'ps') return { stdout: ['db', 'backend', 'frontend'].map((service) => JSON.stringify({
        Service: service, Name: `${config.dockerProjectName}-${service}-1`, State: active.has(service) ? 'running' : 'exited',
      })).join('\n') };
      if (args[0] === 'stop') {
        if (options.stopFails) throw new Error('synthetic stop failed');
        args.slice(1).forEach((service) => active.delete(service));
      }
      if (args[0] === 'up') args.filter((item) => ['backend', 'frontend'].includes(item)).forEach((service) => active.add(service));
      return { stdout: '' };
    },
    command(args) {
      log.push(`command ${args.join(' ')}`);
      if (options.dumpFails) return { status: 2, stdout: null, stderr: 'synthetic failure' };
      return { status: 0, stdout: options.shortDump ? Buffer.from('PGDMP') : dump };
    },
  };
  return { root, runtime, paths, setup, config, runner, active, log };
}

test('A1 public origin is explicit, HTTPS/same-origin and CORS is emitted; private loopback remains explicit', () => {
  const f = fixture({ stopped: true });
  assert.equal(f.config.corsAllowedOrigins, `http://127.0.0.1:${f.config.frontendPort}`);
  assert.match(fs.readFileSync(path.join(f.runtime, 'production.env'), 'utf8'), /CORS_ALLOWED_ORIGINS=http:\/\/127\.0\.0\.1:/);
  const publicConfig = f.setup.normalizeConfig({ ...f.config, serverAddress: 'factory.example',
    publicFrontendUrl: 'https://factory.example', publicApiUrl: 'https://factory.example/api' });
  assert.equal(publicConfig.corsAllowedOrigins, 'https://factory.example');
  assert.match(f.setup.makeEnv(publicConfig, { postgresPassword: 'fake', jwtSecret: 'fake' }), /PUBLIC_API_URL=https:\/\/factory\.example\/api/);
  for (const invalid of [
    { serverAddress: 'factory.example', publicFrontendUrl: '', publicApiUrl: '' },
    { serverAddress: 'factory.example', publicFrontendUrl: 'http://factory.example', publicApiUrl: 'http://factory.example/api' },
    { serverAddress: 'factory.example', publicFrontendUrl: 'https://factory.example', publicApiUrl: 'https://other.example/api' },
  ]) assert.throws(() => f.setup.normalizeConfig({ ...f.config, ...invalid }));
});

test('A1 actual backend CORS function fails closed in production and retains dev-only permissive contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'src', 'main.ts'), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'configuredCorsOrigin');
  assert.ok(fn);
  const javascript = ts.transpileModule(`${fn.getText(ast)}\nmodule.exports = configuredCorsOrigin;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const load = (env) => { const context = { module: { exports: null }, process: { env } }; vm.runInNewContext(javascript, context); return context.module.exports; };
  assert.throws(() => load({ NODE_ENV: 'production' })(), /CORS_ALLOWED_ORIGINS/);
  const cors = load({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://factory.example' })();
  let allowed;
  cors('https://factory.example', (_error, value) => { allowed = value; });
  assert.equal(allowed, true);
  cors('https://foreign.example', (_error, value) => { allowed = value; });
  assert.equal(allowed, false);
  assert.equal(load({ NODE_ENV: 'development' })(), true);
});

test('A2 backup stops and confirms owned writers before dump, validates then publishes, restoring original state', async () => {
  const f = fixture({ uploadsFile: true });
  const result = await f.setup.createBackup(f.runner);
  assert.ok(fs.existsSync(path.join(result.backupDir, 'checksums.sha256')));
  assert.equal((await f.setup.validateBackup(result.backupDir)).ok, true);
  assert.ok(f.log.findIndex((item) => item.startsWith('compose stop')) < f.log.findIndex((item) => item.includes('pg_dump')));
  assert.ok(f.log.findIndex((item) => item.includes('pg_dump')) < f.log.findIndex((item) => item.startsWith('compose up')));
  assert.deepEqual([...f.active].sort(), ['backend', 'db', 'frontend']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.backupDir, 'manifest.json'))).source.instanceId, f.config.instanceId);
});

test('A2 failure paths never publish a valid partial; stopped app stays stopped', async () => {
  const stopped = fixture({ stopped: true });
  await stopped.setup.createBackup(stopped.runner);
  assert.equal(stopped.log.some((item) => item.startsWith('compose up')), false);
  const stopFailure = fixture({ stopFails: true });
  await assert.rejects(stopFailure.setup.createBackup(stopFailure.runner), /stop failed/);
  assert.equal(stopFailure.log.some((item) => item.includes('pg_dump')), false);
  const dumpFailure = fixture({ dumpFails: true });
  await assert.rejects(dumpFailure.setup.createBackup(dumpFailure.runner), /дамп/);
  assert.equal(fs.readdirSync(dumpFailure.paths.backupsDir).length, 0);
  assert.deepEqual([...dumpFailure.active].sort(), ['backend', 'db', 'frontend']);
  const copyFailure = fixture();
  fs.rmSync(copyFailure.paths.uploadsDir, { recursive: true });
  fs.writeFileSync(copyFailure.paths.uploadsDir, 'not a directory');
  await assert.rejects(copyFailure.setup.createBackup(copyFailure.runner));
  assert.equal(fs.readdirSync(copyFailure.paths.backupsDir).length, 0);
  assert.deepEqual([...copyFailure.active].sort(), ['backend', 'db', 'frontend']);
});

test('effective JSON/env mismatch refuses backup before stopping writers or dumping DB', async () => {
  const f = fixture();
  const envPath = path.join(f.runtime, 'production.env');
  const original = fs.readFileSync(envPath, 'utf8');
  for (const [from, to] of [
    [`UPLOADS_DIR=${f.paths.uploadsDir.replace(/\\/g, '/')}`, `UPLOADS_DIR=${path.join(f.root, 'foreign-uploads').replace(/\\/g, '/')}`],
    ['@db:5432/zavod', '@foreign:5432/zavod'],
  ]) {
    fs.writeFileSync(envPath, original.replace(from, to));
    await assert.rejects(f.setup.createBackup(f.runner), /Несогласованный|DATABASE_URL/);
    assert.equal(f.log.length, 0);
  }
});

test('ordinary start is denied while update is pending; only internal update start is allowed', () => {
  const f = fixture({ stopped: true });
  const pending = { ...f.config, updatePending: { fromReleaseId: 'old', toReleaseId: 'new' } };
  assert.throws(() => f.setup.assertStartAllowed(pending), /обычный start запрещён/);
  assert.doesNotThrow(() => f.setup.assertStartAllowed(pending, { internalUpdateStart: true }));
  assert.throws(() => f.setup.assertStartAllowed({ ...pending, restoreTargetPending: true }, { internalUpdateStart: true }), /не восстановлена/);
});

test('A3 legacy restore refuses before commands; same identity and nonempty target refuse before mutation', async () => {
  const source = fixture({ stopped: true, uploadsFile: true });
  const sourceBackup = await source.setup.createBackup(source.runner);
  await assert.rejects(source.setup.restoreIndependentBackup(sourceBackup.backupDir, 'wrong', {
    compose() { throw new Error('must not run'); }, command() { throw new Error('must not run'); },
    validateDump() { throw new Error('must not run'); }, restoreDump() { throw new Error('must not run'); },
  }));
  const target = fixture({ stopped: true, restoreTargetPending: true });
  const copied = path.join(target.paths.backupsDir, 'source-copy');
  fs.cpSync(sourceBackup.backupDir, copied, { recursive: true });
  let called = 0;
  const runner = { compose() { called++; throw new Error('unexpected command'); }, command() { called++; throw new Error('unexpected command'); },
    validateDump() { called++; throw new Error('unexpected command'); }, restoreDump() { called++; throw new Error('unexpected command'); } };
  const same = { ...target.config, instanceId: source.config.instanceId };
  fs.writeFileSync(path.join(target.runtime, 'zavod.config.json'), JSON.stringify(same));
  await assert.rejects(target.setup.restoreIndependentBackup(copied, 'ВОССТАНОВИТЬ_В_НОВУЮ_ЦЕЛЬ', runner));
  assert.equal(called, 0);
  fs.writeFileSync(path.join(target.runtime, 'zavod.config.json'), JSON.stringify(target.config));
  const targetEnvPath = path.join(target.runtime, 'production.env');
  const targetEnv = fs.readFileSync(targetEnvPath, 'utf8');
  const sourceDsnLine = fs.readFileSync(path.join(source.runtime, 'production.env'), 'utf8').split('\n').find((line) => line.startsWith('DATABASE_URL='));
  fs.writeFileSync(targetEnvPath, targetEnv.replace(/^DATABASE_URL=.*$/m, sourceDsnLine));
  await assert.rejects(target.setup.restoreIndependentBackup(copied, 'ВОССТАНОВИТЬ_В_НОВУЮ_ЦЕЛЬ', runner), /DATABASE_URL/);
  assert.equal(called, 0);
  fs.writeFileSync(targetEnvPath, targetEnv);
  fs.writeFileSync(path.join(target.paths.uploadsDir, 'existing.txt'), 'not empty');
  await assert.rejects(target.setup.restoreIndependentBackup(copied, 'ВОССТАНОВИТЬ_В_НОВУЮ_ЦЕЛЬ', runner));
  assert.equal(called, 0);
  fs.rmSync(path.join(target.paths.uploadsDir, 'existing.txt'));
  fs.writeFileSync(path.join(target.runtime, 'zavod.config.json'), JSON.stringify({ ...target.config, uploadsDir: source.config.uploadsDir }));
  await assert.rejects(target.setup.restoreIndependentBackup(copied, 'ВОССТАНОВИТЬ_В_НОВУЮ_ЦЕЛЬ', runner));
  assert.equal(called, 0);
  fs.writeFileSync(path.join(target.runtime, 'zavod.config.json'), JSON.stringify(target.config));
  fs.writeFileSync(path.join(copied, 'uploads', 'photo-fake.txt'), 'corrupted payload');
  await assert.rejects(target.setup.restoreIndependentBackup(copied, 'ВОССТАНОВИТЬ_В_НОВУЮ_ЦЕЛЬ', runner));
  assert.equal(called, 0);
});

test('A3 independent restore uses only target command identity and retains target routing/secrets in a fake runner', async () => {
  const source = fixture({ stopped: true, uploadsFile: true });
  const sourceBackup = await source.setup.createBackup(source.runner);
  const target = fixture({ stopped: true, restoreTargetPending: true });
  fs.rmSync(target.paths.dbDataDir, { recursive: true });
  require('./storage-contract').prepareDbStorage(target.paths.dbDataDir);
  const copied = path.join(target.paths.backupsDir, 'source-copy');
  fs.cpSync(sourceBackup.backupDir, copied, { recursive: true });
  const targetEnvBefore = fs.readFileSync(path.join(target.runtime, 'production.env'), 'utf8');
  const commands = [];
  const runner = {
    compose(args) {
      commands.push(args.join(' '));
      return { stdout: ['db', 'backend', 'frontend'].map((service) => JSON.stringify({
        Service: service, Name: `${target.config.dockerProjectName}-${service}-1`, State: service === 'db' ? 'running' : 'exited',
      })).join('\n') };
    },
    command(args) { commands.push(args.join(' ')); return { status: 0, stdout: '0\n' }; },
    async validateDump() { commands.push('fake validate dump'); },
    async restoreDump(_path, user, db) { commands.push(`fake restore ${user} ${db}`); },
  };
  const outcome = await target.setup.restoreIndependentBackup(copied, 'ВОССТАНОВИТЬ_В_НОВУЮ_ЦЕЛЬ', runner);
  assert.equal(outcome.appStarted, false);
  assert.ok(commands.every((command) => !command.includes(source.config.dockerProjectName)));
  assert.ok(commands.some((command) => command.includes(`-p ${target.config.dockerProjectName}`)));
  assert.ok(commands.every((command) => !/dropdb|createdb|\bstart\b|\bup\b/.test(command)));
  assert.equal(fs.readFileSync(path.join(target.paths.uploadsDir, 'photo-fake.txt'), 'utf8'), 'synthetic file A');
  assert.equal(fs.readFileSync(path.join(target.runtime, 'production.env'), 'utf8'), targetEnvBefore);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target.runtime, 'zavod.config.json'))).restoreTargetPending, false);
});

test('A4 update retains exact old image IDs and release identity across fake build failure and success', async () => {
  let f = fixture({ stopped: true });
  let backup = await f.setup.createBackup(f.runner);
  const oldRelease = f.config.buildReleaseId;
  const candidate = f.setup.candidateReleaseId();
  assert.notEqual(candidate, oldRelease);
  const imageIds = { backend: `sha256:${'a'.repeat(64)}`, frontend: `sha256:${'b'.repeat(64)}` };
  const calls = [];
  let failBuild = true;
  let firstAdmin = false;
  const runner = {
    compose(args) {
      calls.push(`compose ${args.join(' ')}`);
      if (args[0] === 'ps') return { stdout: ['backend', 'frontend'].map((service) => JSON.stringify({
        Service: service, Name: `${f.config.dockerProjectName}-${service}-1`, State: 'running', ID: `container-${service}`,
      })).join('\n') };
      return { stdout: '' };
    },
    command(args) {
      calls.push(`command ${args.join(' ')}`);
      if (args[0] === 'inspect') return { status: 0, stdout: imageIds[args.at(-1).replace('container-', '')] };
      if (args[0] === 'image' && args[1] === 'inspect') return {
        status: 0, stdout: imageIds[args.at(-1).includes('backend') ? 'backend' : 'frontend'],
      };
      return { status: 0, stdout: '' };
    },
    async validateDump() { calls.push('fake dump list'); },
    build() { calls.push('fake build'); if (failBuild) throw new Error('synthetic build failed'); return { releaseId: candidate }; },
    async start(options) { calls.push('fake start'); assert.equal(options.internalUpdateStart, true); return {
      runtimeStatus: firstAdmin ? 'FIRST_ADMIN_REQUIRED' : 'READY', firstAdminRequired: firstAdmin,
      backend: firstAdmin ? undefined : { ok: true }, frontend: firstAdmin ? undefined : { ok: true },
    }; },
  };
  await assert.rejects(f.setup.updateServices(backup.backupDir, runner), /synthetic build failed/);
  const pending = JSON.parse(fs.readFileSync(path.join(f.runtime, 'zavod.config.json')));
  assert.equal(pending.buildReleaseId, oldRelease);
  assert.equal(pending.updatePending.toReleaseId, candidate);
  assert.equal(pending.updatePending.retainedImages.backend.imageId, imageIds.backend);
  assert.equal(pending.updatePending.retainedImages.frontend.imageId, imageIds.frontend);
  assert.ok(calls.findIndex((item) => item.includes('image tag')) < calls.findIndex((item) => item === 'fake build'));
  await assert.rejects(f.setup.updateServices(backup.backupDir, runner), /не завершено/);
  f = fixture({ stopped: true });
  backup = await f.setup.createBackup(f.runner);
  failBuild = false;
  firstAdmin = true;
  await assert.rejects(f.setup.updateServices(backup.backupDir, runner), /не достиг рабочего READY/);
  const notReady = JSON.parse(fs.readFileSync(path.join(f.runtime, 'zavod.config.json')));
  assert.equal(notReady.buildReleaseId, oldRelease);
  assert.ok(notReady.updatePending.retainedImages.backend.imageId);
  f = fixture({ stopped: true });
  backup = await f.setup.createBackup(f.runner);
  firstAdmin = false;
  await f.setup.updateServices(backup.backupDir, runner);
  const completed = JSON.parse(fs.readFileSync(path.join(f.runtime, 'zavod.config.json')));
  assert.equal(completed.buildReleaseId, candidate);
  assert.equal(completed.previousRelease.releaseId, oldRelease);
  assert.equal(completed.updatePending, null);
});

test('A4 wrong release refuses before commands; fake start failure retains previous image tags', async () => {
  const wrong = fixture({ stopped: true });
  const wrongBackup = await wrong.setup.createBackup(wrong.runner);
  fs.writeFileSync(path.join(wrong.runtime, 'zavod.config.json'), JSON.stringify({ ...wrong.config, buildReleaseId: 'another-release' }));
  let calls = 0;
  const forbidden = { compose() { calls++; throw new Error('must not run'); }, command() { calls++; throw new Error('must not run'); },
    validateDump() { calls++; throw new Error('must not run'); }, build() { calls++; throw new Error('must not run'); },
    start() { calls++; throw new Error('must not run'); } };
  await assert.rejects(wrong.setup.updateServices(wrongBackup.backupDir, forbidden));
  assert.equal(calls, 0);

  const f = fixture({ stopped: true });
  const backup = await f.setup.createBackup(f.runner);
  const ids = { backend: `sha256:${'c'.repeat(64)}`, frontend: `sha256:${'d'.repeat(64)}` };
  const runner = {
    compose(args) { return args[0] === 'ps' ? { stdout: ['backend', 'frontend'].map((service) => JSON.stringify({
      Service: service, Name: `${f.config.dockerProjectName}-${service}-1`, State: 'running', ID: `container-${service}`,
    })).join('\n') } : { stdout: '' }; },
    command(args) {
      if (args[0] === 'inspect') return { status: 0, stdout: ids[args.at(-1).replace('container-', '')] };
      if (args[0] === 'image' && args[1] === 'inspect') return { status: 0, stdout: ids[args.at(-1).includes('backend') ? 'backend' : 'frontend'] };
      return { status: 0, stdout: '' };
    },
    async validateDump() {}, build() { return { releaseId: f.setup.candidateReleaseId() }; },
    async start() { throw new Error('synthetic readiness failure'); },
  };
  await assert.rejects(f.setup.updateServices(backup.backupDir, runner), /readiness failure/);
  const saved = JSON.parse(fs.readFileSync(path.join(f.runtime, 'zavod.config.json')));
  assert.equal(saved.buildReleaseId, f.config.buildReleaseId);
  assert.equal(saved.updatePending.retainedImages.backend.imageId, ids.backend);
  assert.equal(saved.updatePending.retainedImages.frontend.imageId, ids.frontend);
});

process.on('exit', () => {
  if (path.dirname(temp) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('zavod-vps-tech01-r1-')) return;
  fs.rmSync(temp, { recursive: true, force: false });
});
