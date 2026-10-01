'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createBuildContext, removeBuildContext } = require('./deployment-context');
const { assertStoragePaths, assertOutsideProject, inspectDbStorage, prepareDbStorage } = require('./storage-contract');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zavod-vps-prep-02-test-'));
const runtime = path.join(temp, 'runtime');
const logPath = path.join(temp, 'shim-log.jsonl');
const statePath = path.join(temp, 'shim-state.json');
const results = [];
const check = (name, condition) => { assert.ok(condition, name); results.push(name); };

function runSetup(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'setup', 'zavod-setup.js'), ...args], {
      cwd: root,
      env: {
        ...process.env,
        ZAVOD_SETUP_RUNTIME: runtime,
        ZAVOD_DOCKER_SHIM: path.join(root, 'setup', 'vps-prep-02-docker-shim.js'),
        VPS_PREP_02_SHIM_LOG: logPath,
        VPS_PREP_02_SHIM_STATE: statePath,
        ...extraEnv,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function commands() {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).join(' '));
}

function resetLog() { fs.writeFileSync(logPath, ''); }

async function serve() {
  const server = http.createServer((request, response) => {
    response.writeHead(request.url === '/ready' || request.url === '/' ? 200 : 404);
    response.end('synthetic');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

function createSyntheticBackup(backupsDir, uploadsDir) {
  const backup = path.join(backupsDir, 'synthetic-reviewed-backup');
  for (const dir of ['database', 'uploads', 'config']) fs.mkdirSync(path.join(backup, dir), { recursive: true });
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ mode: 'full', source: { uploadsRoot: uploadsDir, database: { name: 'zavod' } }, contents: { databaseDump: 'database/zavod.dump' }, syntheticTestOnly: true }));
  fs.writeFileSync(path.join(backup, 'database', 'zavod.dump'), 'synthetic-not-a-real-dump');
  const checksumFiles = ['manifest.json', 'database/zavod.dump'];
  const checksums = checksumFiles.map((item) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(backup, item))).digest('hex')}  ${item}`);
  fs.writeFileSync(path.join(backup, 'checksums.sha256'), `${checksums.join('\n')}\n`);
  return backup;
}

async function main() {
  let backend;
  let frontend;
  try {
    const staged = createBuildContext(root);
    try {
      const relative = staged.files.map((item) => item.replace(/\\/g, '/'));
      const missingCopySources = [];
      for (const dockerfile of ['backend/Dockerfile.production', 'frontend/Dockerfile.production']) {
        for (const line of fs.readFileSync(path.join(staged.path, dockerfile), 'utf8').split(/\r?\n/)) {
          if (!/^COPY\s+/i.test(line) || line.includes('--from=')) continue;
          const sourceItems = line.trim().split(/\s+/).slice(1, -1);
          for (const source of sourceItems) {
            if (!fs.existsSync(path.join(staged.path, source))) missingCopySources.push(`${dockerfile}:${source}`);
          }
        }
      }
      check('every production Dockerfile COPY source exists in staged context', missingCopySources.length === 0);
      check('staging includes Prisma migrations, foundation and bootstrap',
        relative.includes('backend/prisma/schema.prisma')
        && relative.includes('backend/prisma/system-foundation.cjs')
        && relative.includes('backend/src/cli/bootstrap-first-admin.ts')
        && relative.includes('backend/prisma/migrations/20260922190000_vps_prep_01_auth_recovery/migration.sql'));
      check('staging excludes seed, tests, host dependencies and private runtime',
        !relative.some((item) => /(?:seed\.js|\.env|node_modules|test-results|screenshots|\.spec\.|\.test\.|setup\/runtime|\.r5-runtime)/i.test(item)));
      const synthetic = path.join(temp, 'synthetic-source');
      fs.cpSync(staged.path, synthetic, { recursive: true });
      for (const item of ['backend/src/secret.env', 'backend/src/trace.log', 'frontend/src/sample.spec.ts', 'frontend/public/screenshots/personal.png', 'setup/runtime/production.env', 'data/uploads/private.png']) {
        const target = path.join(synthetic, item);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'synthetic canary');
      }
      const second = createBuildContext(synthetic);
      try {
        check('synthetic private canaries do not enter staged context',
          !second.files.some((item) => /secret\.env|trace\.log|sample\.spec\.ts|personal\.png|production\.env|private\.png/i.test(item)));
      } finally { removeBuildContext(second.path); }
    } finally { removeBuildContext(staged.path); }

    const dbDataDir = path.join(temp, 'persistent', 'postgres');
    const uploadsDir = path.join(temp, 'persistent', 'uploads');
    const backupsDir = path.join(temp, 'persistent', 'backups');
    const errorReportsExportPath = path.join(temp, 'persistent', 'errors');
    const logsDir = path.join(temp, 'persistent', 'logs');
    assertStoragePaths({ dbDataDir, uploadsDir, backupsDir, errorReportsExportPath, logsDir });
    check('PostgreSQL storage marker is created on a new dedicated path',
      prepareDbStorage(dbDataDir).state === 'CREATED' && inspectDbStorage(dbDataDir).state === 'OWNED');
    const storageSource = fs.readFileSync(path.join(root, 'setup', 'storage-contract.js'), 'utf8');
    check('PostgreSQL parent contract grants traversal without listing or broad write',
      storageSource.includes('0o711')
      && (process.platform === 'win32' || (fs.statSync(dbDataDir).mode & 0o777) === 0o711));
    const ambiguous = path.join(temp, 'preexisting-db');
    fs.mkdirSync(ambiguous);
    fs.writeFileSync(path.join(ambiguous, 'PG_VERSION'), '17');
    assert.throws(() => inspectDbStorage(ambiguous));
    check('ambiguous pre-existing PostgreSQL directory is refused', true);
    assert.throws(() => assertStoragePaths({ dbDataDir, uploadsDir: dbDataDir, backupsDir, errorReportsExportPath, logsDir }));
    check('overlapping persistent paths are refused', true);
    assert.throws(() => assertOutsideProject({ dbDataDir: root, uploadsDir, backupsDir, errorReportsExportPath, logsDir }, root));
    check('persistent storage cannot overlap the source workspace', true);

    const reserveBackend = await serve();
    const reserveFrontend = await serve();
    const retryBackendPort = reserveBackend.port;
    const retryFrontendPort = reserveFrontend.port;
    await new Promise((resolve) => reserveBackend.server.close(resolve));
    await new Promise((resolve) => reserveFrontend.server.close(resolve));
    const retryRuntime = path.join(temp, 'retry-runtime');
    const retryRoot = path.join(temp, 'retry-persistent');
    const retryArgs = ['prepare', '--server-address', '127.0.0.1', '--backend-port', String(retryBackendPort),
      '--frontend-port', String(retryFrontendPort), '--db-data-dir', path.join(retryRoot, 'db'),
      '--uploads-dir', path.join(retryRoot, 'uploads'), '--backups-dir', path.join(retryRoot, 'backups'),
      '--error-reports-dir', path.join(retryRoot, 'errors'), '--logs-dir', path.join(retryRoot, 'logs')];
    const failedBuild = await runSetup(retryArgs, { ZAVOD_SETUP_RUNTIME: retryRuntime, VPS_PREP_02_SHIM_FAIL: 'build backend frontend' });
    const configFile = path.join(retryRuntime, 'zavod.config.json');
    const envFile = path.join(retryRuntime, 'production.env');
    check('failed first build leaves an owned configuration for exact retry', failedBuild.code !== 0
      && fs.existsSync(configFile) && fs.existsSync(envFile));
    const originalConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const originalEnvHash = crypto.createHash('sha256').update(fs.readFileSync(envFile)).digest('hex');
    const resumedBuild = await runSetup(retryArgs, { ZAVOD_SETUP_RUNTIME: retryRuntime });
    check('exact prepare retry resumes without replacing configuration or secrets', resumedBuild.code === 0
      && resumedBuild.stdout.includes('FIRST_ADMIN_REQUIRED')
      && JSON.parse(fs.readFileSync(configFile, 'utf8')).instanceId === originalConfig.instanceId
      && crypto.createHash('sha256').update(fs.readFileSync(envFile)).digest('hex') === originalEnvHash);

    backend = await serve();
    frontend = await serve();
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'zavod.config.json'), JSON.stringify({
      serverAddress: '127.0.0.1', backendPort: backend.port, frontendPort: frontend.port,
      dbDataDir, uploadsDir, backupsDir, errorReportsExportPath, logsDir,
    }));
    fs.writeFileSync(path.join(runtime, 'production.env'), 'COMPOSE_PROJECT_NAME=zavod-synthetic\n');

    const invalidConfig = await runSetup(['prepare', '--server-address', '127.0.0.1', '--backend-port', 'bad', '--frontend-port', String(frontend.port),
      '--db-data-dir', dbDataDir, '--uploads-dir', uploadsDir, '--backups-dir', backupsDir,
      '--error-reports-dir', errorReportsExportPath, '--logs-dir', logsDir]);
    check('headless prepare rejects invalid configuration before Docker phases', invalidConfig.code !== 0 && invalidConfig.stderr.includes('порта'));

    resetLog();
    const pending = await runSetup(['start']);
    check('first start stops after migration and foundation with exact first-admin status',
      pending.code === 0 && pending.stdout.includes('FIRST_ADMIN_REQUIRED')
      && commands().some((item) => item.includes('prisma:migrate:deploy'))
      && commands().some((item) => item.includes('vps-prep:foundation'))
      && !commands().some((item) => item.includes('up -d --no-build backend frontend')));
    check('the exact DB service is waited healthy before migration',
      commands().some((item) => item.includes('up ') && item.includes('--wait') && item.endsWith(' db'))
      && commands().findIndex((item) => item.includes('--wait') && item.endsWith(' db'))
        < commands().findIndex((item) => item.includes('prisma:migrate:deploy')));

    resetLog();
    const dbNotReady = await runSetup(['start'], { VPS_PREP_02_SHIM_FAIL: '--wait' });
    check('DB wait failure prevents migration, foundation and app', dbNotReady.code !== 0
      && !commands().some((item) => item.includes('prisma:migrate:deploy') || item.includes('vps-prep:foundation')
        || item.includes('up -d --no-build backend frontend')));

    resetLog();
    const migrationFailure = await runSetup(['start'], { VPS_PREP_02_SHIM_FAIL: 'prisma:migrate:deploy' });
    check('migration failure prevents foundation and application start', migrationFailure.code !== 0
      && !commands().some((item) => item.includes('vps-prep:foundation'))
      && !commands().some((item) => item.includes('up -d --no-build backend frontend')));

    resetLog();
    const foundationFailure = await runSetup(['start'], { VPS_PREP_02_SHIM_FAIL: 'vps-prep:foundation' });
    check('foundation failure prevents application start', foundationFailure.code !== 0
      && !commands().some((item) => item.includes('vps-prep:runtime-status'))
      && !commands().some((item) => item.includes('up -d --no-build backend frontend')));

    fs.writeFileSync(statePath, JSON.stringify({ adminReady: false, schemaError: true }));
    resetLog();
    const badSchema = await runSetup(['start']);
    check('schema readiness failure prevents application start', badSchema.code !== 0
      && !commands().some((item) => item.includes('up -d --no-build backend frontend')));

    fs.writeFileSync(statePath, JSON.stringify({ adminReady: false }));
    const credentialPath = path.join(temp, 'synthetic-credential');
    fs.writeFileSync(credentialPath, crypto.randomBytes(24).toString('base64url'), { mode: 0o600 });
    resetLog();
    const bootstrapArgs = ['bootstrap', '--factory-name', 'Синтетический завод', '--factory-code', 'synthetic-factory',
      '--admin-phone', '+79990000001', '--admin-last-name', 'Синтетический', '--admin-first-name', 'Администратор',
      '--credential-file', credentialPath];
    const created = await runSetup(bootstrapArgs);
    check('explicit bootstrap runs in container through protected stdin then starts application', created.code === 0
      && created.stdout.includes('FIRST_ADMIN_BOOTSTRAP=CREATED')
      && commands().some((item) => item.includes('--credential-stdin'))
      && commands().some((item) => item.includes('up -d --no-build') && item.includes('backend frontend')));
    check('bootstrap selects the real first factory for ordinary registration',
      fs.readFileSync(path.join(runtime, 'production.env'), 'utf8').includes('REGISTRATION_FACTORY_CODE=synthetic-factory')
      && commands().some((item) => item.includes('--force-recreate backend frontend')));
    const secret = fs.readFileSync(credentialPath, 'utf8');
    check('credential is absent from command log and public output', !commands().join('\n').includes(secret)
      && !created.stdout.includes(secret) && !created.stderr.includes(secret));

    resetLog();
    const repeat = await runSetup(bootstrapArgs);
    check('lost-response repeat is diagnostic and does not issue new bootstrap', repeat.code === 0
      && repeat.stdout.includes('FIRST_ADMIN_BOOTSTRAP=ALREADY_COMPLETED'));
    resetLog();
    const restarted = await runSetup(['start']);
    check('repeat start serves readiness and never invokes bootstrap or dev seed', restarted.code === 0
      && restarted.stdout.includes('Backend readiness: 200')
      && !commands().some((item) => item.includes('bootstrap-first-admin') || item.includes('seed')));

    const missingBackup = await runSetup(['update']);
    check('update requires a reviewed backup path', missingBackup.code !== 0 && missingBackup.stderr.includes('--backup'));
    const backupPath = createSyntheticBackup(backupsDir, uploadsDir);
    resetLog();
    const updated = await runSetup(['update', '--backup', backupPath]);
    check('formal checksum package with a fake dump cannot authorize update', updated.code !== 0
      && !commands().some((item) => item.includes('build backend frontend') || item.includes('prisma:migrate:deploy')));

    const compose = fs.readFileSync(path.join(root, 'docker-compose.production.yml'), 'utf8');
    check('Compose keeps PostgreSQL 18 PGDATA under persistent parent mount and loopback HTTP',
      compose.includes('PGDATA: /var/lib/postgresql/18/docker')
      && compose.includes('${DB_DATA_DIR}:/var/lib/postgresql')
      && !compose.includes('${DB_DATA_DIR}:/var/lib/postgresql/data')
      && compose.includes('127.0.0.1:${BACKEND_PORT}:3000')
      && !/ports:\s*\n\s*- ["']?5432:/m.test(compose));

    process.stdout.write(JSON.stringify({ status: 'PASS', checks: results.length, results }, null, 2) + '\n');
  } finally {
    if (backend) await new Promise((resolve) => backend.server.close(resolve));
    if (frontend) await new Promise((resolve) => frontend.server.close(resolve));
    if (path.dirname(temp) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('zavod-vps-prep-02-test-')) {
      throw new Error('Refusing to remove an unexpected synthetic test directory.');
    }
    fs.rmSync(temp, { recursive: true, force: false });
  }
}

main().catch((error) => {
  process.stderr.write(`VPS_PREP_02_REGRESSION=FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
