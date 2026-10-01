#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

const checks = [];

function record(name, ok, details = '') {
  checks.push({ name, ok, details });
  const mark = ok ? 'OK' : 'FAIL';
  console.log(`${mark} ${name}${details ? ` — ${details}` : ''}`);
}

function runNode(args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT_DIR,
    env: makeChildEnv(env),
    encoding: 'utf8',
    windowsHide: true,
  });
}

function makeChildEnv(extra = {}) {
  const base = { ...process.env };
  for (const key of Object.keys(base)) {
    if (key.toLowerCase() === 'path') delete base[key];
  }
  return { ...base, ...extra };
}

function assertNoSecretLikeOutput(text) {
  const patterns = [
    ['password', 'Hash'].join(''),
    ['storage', 'Path'].join(''),
    ['DATABASE_', 'URL=postgresql://[^\\s]+:[^\\s]+@'].join(''),
    ['JWT_', 'SECRET=[0-9a-f]+'].join(''),
    ['POSTGRES_', 'PASSWORD=[0-9a-f]+'].join(''),
    'token\\s*[:=]',
    'secret\\s*[:=]',
  ];
  return !(new RegExp(patterns.join('|'), 'i')).test(text);
}

async function makeFakeDocker(tempBin) {
  await fsp.mkdir(tempBin, { recursive: true });
  const fakeDockerPath = path.join(tempBin, 'fake-docker.js');
  const fakeDocker = [
    'const args = process.argv.slice(2);',
    "if (args[0] === '--version') { console.log('Docker version 99.0.0, fake regression'); process.exit(0); }",
    "if (args[0] === 'compose' && args[1] === 'version') { console.log('Docker Compose version v99.0.0-fake'); process.exit(0); }",
    "if (args.includes('pg_dump')) { process.stdout.write('FAKE_POSTGRES_CUSTOM_DUMP'); process.exit(0); }",
    "console.log('fake compose ok');",
    'process.exit(0);',
    '',
  ].join('\n');
  await fsp.writeFile(fakeDockerPath, fakeDocker, 'utf8');
  return fakeDockerPath;
}

async function startServer(port, body) {
  const code = [
    "const http = require('node:http');",
    `const body = ${JSON.stringify(body)};`,
    "http.createServer((req, res) => {",
    "  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });",
    "  res.end(body);",
    `}).listen(${Number(port)}, '127.0.0.1');`,
  ].join('\n');
  const child = spawn(process.execPath, ['-e', code], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const ready = await waitFor(`http://127.0.0.1:${port}/`);
  if (!ready) {
    child.kill();
    throw new Error(`test server did not start on ${port}`);
  }
  return child;
}

async function waitFor(url, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // retry below
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  return response.json();
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'zavod-setup-regression-'));
  const tempBin = path.join(tempRoot, 'bin');
  const runtime = path.join(tempRoot, 'runtime');
  const data = path.join(tempRoot, 'data');
  const uploads = path.join(data, 'uploads');
  const backups = path.join(data, 'backups');
  const errorReportsExport = path.join(data, 'error-reports-export');
  const logs = path.join(data, 'logs');
  const db = path.join(data, 'db');
  const backendPort = 13201;
  const frontendPort = 15201;
  const env = {
    ZAVOD_SETUP_RUNTIME: runtime,
  };

  let backendServer;
  let frontendServer;
  let wizardProcess;
  try {
    const fakeDockerPath = await makeFakeDocker(tempBin);
    env.ZAVOD_DOCKER_SHIM = fakeDockerPath;
    for (const dir of [runtime, uploads, backups, errorReportsExport, logs, db]) await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(uploads, 'sample.txt'), 'upload sample', 'utf8');

    const config = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot: ROOT_DIR,
      runtimeDir: runtime,
      serverAddress: '127.0.0.1',
      backendPort,
      frontendPort,
      dbDataDir: db,
      uploadsDir: uploads,
      backupsDir: backups,
      errorReportsExportPath: errorReportsExport,
      logsDir: logs,
      publicApiUrl: `http://127.0.0.1:${backendPort}`,
      publicFrontendUrl: `http://127.0.0.1:${frontendPort}`,
      dockerProjectName: 'zavod',
    };
    await fsp.writeFile(path.join(runtime, 'zavod.config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await fsp.writeFile(path.join(runtime, 'production.env'), [
      'COMPOSE_PROJECT_NAME=zavod',
      `ZAVOD_RUNTIME_ENV_FILE=${path.join(runtime, 'production.env').replace(/\\/g, '/')}`,
      'POSTGRES_DB=zavod',
      'POSTGRES_USER=zavod',
      ['POSTGRES_', 'PASSWORD=fake-regression-password'].join(''),
      ['DATABASE_', 'URL=postgresql://zavod:fake-regression-password@db:5432/zavod?schema=public'].join(''),
      ['JWT_', 'SECRET=fake-regression-jwt'].join(''),
      `BACKEND_PORT=${backendPort}`,
      `FRONTEND_PORT=${frontendPort}`,
      `DB_DATA_DIR=${db.replace(/\\/g, '/')}`,
      `UPLOADS_DIR=${uploads.replace(/\\/g, '/')}`,
      `BACKUPS_DIR=${backups.replace(/\\/g, '/')}`,
      `ERROR_REPORTS_EXPORT_DIR=${errorReportsExport.replace(/\\/g, '/')}`,
      'ERROR_REPORTS_EXPORT_PATH=/app/error-reports-export',
      `LOGS_DIR=${logs.replace(/\\/g, '/')}`,
      '',
    ].join('\n'), 'utf8');

    const requiredFiles = [
      'Установка Завод.cmd',
      'Запуск Завод.cmd',
      'Остановка Завод.cmd',
      'Проверка Завод.cmd',
      'Бэкап Завод.cmd',
      'Восстановление Завод.cmd',
      'Создать ярлыки Завод.cmd',
      'README_ДЛЯ_СИСАДМИНА.md',
      'docker-compose.production.yml',
      'setup/zavod-setup.js',
      'setup/wizard.html',
      'setup/restore.html',
    ];
    record('required setup files exist', requiredFiles.every((file) => fs.existsSync(path.join(ROOT_DIR, file))));

    const wizardHtml = await fsp.readFile(path.join(ROOT_DIR, 'setup', 'wizard.html'), 'utf8');
    record('wizard has Back and Next controls', wizardHtml.includes('prevStep') && wizardHtml.includes('nextStep'));
    record('wizard has overwrite acknowledgement', wizardHtml.includes('overwriteAck'));
    record('wizard exposes error report export path field', wizardHtml.includes('errorReportsExportPath') && wizardHtml.includes('Папка для сообщений об ошибках'));

    const syntax = runNode(['--check', 'setup/zavod-setup.js'], env);
    record('zavod-setup.js syntax', syntax.status === 0, syntax.stderr.trim());

    const selfTest = runNode(['setup/zavod-setup.js', 'self-test'], {
      ...env,
      ZAVOD_SETUP_RUNTIME: path.join(tempRoot, 'self-test-runtime'),
    });
    record('self-test dry-run works', selfTest.status === 0, selfTest.stderr.trim());

    backendServer = await startServer(backendPort, '{"ok":true}');
    frontendServer = await startServer(frontendPort, '<html>ok</html>');

    const start = runNode(['setup/zavod-setup.js', 'start'], env);
    record('start command succeeds with fake Docker and health servers', start.status === 0, start.stderr.trim());
    record('start output has no secret-like values', assertNoSecretLikeOutput(`${start.stdout}\n${start.stderr}`));

    const stop = runNode(['setup/zavod-setup.js', 'stop'], env);
    record('stop command succeeds with fake Docker', stop.status === 0, stop.stderr.trim());

    const backup = runNode(['setup/zavod-setup.js', 'backup'], env);
    record('backup command creates test package with fake pg_dump', backup.status === 0, backup.stderr.trim());
    record('backup output has no secret-like values', assertNoSecretLikeOutput(`${backup.stdout}\n${backup.stderr}`));

    const backupDirs = (await fsp.readdir(backups, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('zavod-backup-'))
      .map((entry) => path.join(backups, entry.name));
    const latestBackup = backupDirs.sort().at(-1);
    record('test backup folder exists', Boolean(latestBackup), latestBackup || '');
    record('test backup has manifest', latestBackup && fs.existsSync(path.join(latestBackup, 'manifest.json')));
    record('test backup has database dump', latestBackup && fs.existsSync(path.join(latestBackup, 'database', 'zavod.dump')));
    record('test backup has uploads copy', latestBackup && fs.existsSync(path.join(latestBackup, 'uploads', 'sample.txt')));
    record('test backup has config copy', latestBackup && fs.existsSync(path.join(latestBackup, 'config', 'production.env')));

    if (latestBackup) {
      const validate = runNode(['setup/zavod-setup.js', 'backup-validate', '--backup', latestBackup], env);
      record('backup validate succeeds for test package', validate.status === 0, validate.stderr.trim());
    }

    const wizardPort = 15681;
    wizardProcess = spawn(process.execPath, ['setup/zavod-setup.js', 'wizard', '--no-open', '--port', String(wizardPort)], {
      cwd: ROOT_DIR,
      env: makeChildEnv(env),
      windowsHide: true,
      stdio: 'ignore',
    });
    record('wizard server starts', await waitFor(`http://127.0.0.1:${wizardPort}/`));
    const defaults = await readJson(`http://127.0.0.1:${wizardPort}/api/defaults`);
    record('wizard defaults expose configExists/envExists flags', defaults.configExists === true && defaults.envExists === true);
    const environment = await readJson(`http://127.0.0.1:${wizardPort}/api/environment`);
    record('wizard environment sees fake Docker', environment.dockerFound === true && environment.composeFound === true);
    const deployResponse = await readJson(`http://127.0.0.1:${wizardPort}/api/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverAddress: '127.0.0.1',
        backendPort: 13211,
        frontendPort: 15211,
        dbDataDir: path.join(tempRoot, 'new-db'),
        uploadsDir: path.join(tempRoot, 'new-uploads'),
        backupsDir: path.join(tempRoot, 'new-backups'),
        errorReportsExportPath: path.join(tempRoot, 'new-error-reports-export'),
        logsDir: path.join(tempRoot, 'new-logs'),
      }),
    });
    record('wizard refuses overwrite without acknowledgement', deployResponse.ok === false && /Runtime-конфиг/.test(deployResponse.message || ''));
    record('wizard overwrite refusal has no secret-like values', assertNoSecretLikeOutput(JSON.stringify(deployResponse)));
  } finally {
    if (wizardProcess && !wizardProcess.killed) {
      await new Promise((resolve) => {
        wizardProcess.once('close', resolve);
        wizardProcess.kill();
      });
    }
    for (const server of [backendServer, frontendServer]) {
      if (server && !server.killed) {
        await new Promise((resolve) => {
          server.once('close', resolve);
          server.kill();
        });
      }
    }
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }

  const failed = checks.filter((item) => !item.ok);
  console.log(`\nStage68 setup regression: ${checks.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
