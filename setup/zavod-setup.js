#!/usr/bin/env node
/* eslint-disable no-console */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { canonicalBuildFiles, collectBuildFiles, createBuildContext, removeBuildContext } = require('./deployment-context');
const { assertNoOverlap, assertStoragePaths, assertOutsideProject, inspectDbStorage, prepareDbStorage } = require('./storage-contract');

const ROOT_DIR = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.production.yml');
const DEFAULT_RUNTIME_DIR = path.join(os.homedir(), 'Zavod', 'runtime');
const RUNTIME_DIR = path.resolve(process.env.ZAVOD_SETUP_RUNTIME || DEFAULT_RUNTIME_DIR);
const CONFIG_PATH = path.join(RUNTIME_DIR, 'zavod.config.json');
const ENV_PATH = path.join(RUNTIME_DIR, 'production.env');
const PROJECT_NAME = 'zavod';
const REQUIRED_DOCKER_MESSAGE = 'Docker Desktop и Docker Compose не найдены. Установите Docker Desktop, затем повторите проверку.';
const PRISMA_SCHEMA_PATH = path.join(ROOT_DIR, 'backend', 'prisma', 'schema.prisma');
const PRISMA_MIGRATIONS_DIR = path.join(ROOT_DIR, 'backend', 'prisma', 'migrations');

const HELP = `
Завод: технический мастер установки и обслуживания

Команды:
  wizard          открыть локальный мастер установки
  prepare         headless clean prepare с явными путями и портами
                  --restore-target: подготовить только новую пустую БД без миграций и приложения
  start           запустить контейнеры
  update          обновить образы после проверки backup: --backup <папка>
  bootstrap       создать первого ADMIN: реквизиты + --credential-file <mode 600>
  stop            остановить контейнеры
  check           проверить Docker, конфиг, сервисы, здоровье backend/frontend
  backup          создать полный backup DB + uploads + config
  restore-wizard  открыть локальный мастер восстановления
  restore-independent  восстановить проверенный backup только в подготовленную пустую независимую цель
  self-test       проверить генерацию конфига в тестовой папке без Docker deploy

Переменные:
  ZAVOD_SETUP_RUNTIME  папка runtime-конфига мастера
`;

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      rest.push(item);
    }
  }
  return { args, rest };
}

function toPosixVolume(value) {
  return path.resolve(value).replace(/\\/g, '/');
}

function defaultPaths() {
  const base = path.join(os.homedir(), 'Zavod');
  return {
    projectRoot: ROOT_DIR,
    runtimeDir: RUNTIME_DIR,
    serverAddress: getPrimaryLanAddress() || '127.0.0.1',
    backendPort: 3000,
    frontendPort: 5173,
    dbDataDir: path.join(base, 'data', 'postgres'),
    uploadsDir: path.join(base, 'uploads'),
    backupsDir: path.join(base, 'backups'),
    errorReportsExportPath: path.join(base, 'error-reports-export'),
    logsDir: path.join(base, 'logs'),
    dockerExePath: '',
  };
}

function getPrimaryLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '';
}

function normalizeConfig(input) {
  const defaults = defaultPaths();
  const backendPort = Number(input.backendPort === undefined || input.backendPort === '' ? defaults.backendPort : input.backendPort);
  const frontendPort = Number(input.frontendPort === undefined || input.frontendPort === '' ? defaults.frontendPort : input.frontendPort);
  const serverAddress = String(input.serverAddress || defaults.serverAddress).trim() || defaults.serverAddress;
  const dockerProjectName = input.dockerProjectName ?? PROJECT_NAME;
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535
    || !Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535
    || backendPort === frontendPort) throw new Error('Укажите два разных порта от 1 до 65535.');
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(serverAddress) || serverAddress.includes('..')) {
    throw new Error('Адрес сервера должен быть IP-адресом или именем без пробелов и управляющих символов.');
  }
  if (typeof dockerProjectName !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(dockerProjectName)) {
    throw new Error('Недопустимое имя Compose-экземпляра.');
  }
  if (input.instanceId != null && (typeof input.instanceId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.instanceId))) {
    throw new Error('Недопустимый идентификатор установки.');
  }
  const privateLoopback = serverAddress === '127.0.0.1' || serverAddress === 'localhost';
  const suppliedFrontend = String(input.publicFrontendUrl ?? '').trim();
  const suppliedApi = String(input.publicApiUrl ?? '').trim();
  const expectedPrivateFrontend = `http://${serverAddress}:${frontendPort}`;
  const expectedPrivateApi = `http://${serverAddress}:${backendPort}`;
  const privateHttp = privateLoopback && (!suppliedFrontend && !suppliedApi
    || suppliedFrontend === expectedPrivateFrontend && suppliedApi === expectedPrivateApi);
  if (Boolean(suppliedFrontend) !== Boolean(suppliedApi)) {
    throw new Error('Для публичной установки укажите оба внешних адреса: frontend и API.');
  }
  if (!privateLoopback && !suppliedFrontend) {
    throw new Error('Для публичной установки требуются явные доверенные HTTPS-адреса frontend и API.');
  }
  const publicFrontendUrl = suppliedFrontend || expectedPrivateFrontend;
  const publicApiUrl = suppliedApi || expectedPrivateApi;
  let frontendOrigin;
  try {
    const frontend = new URL(publicFrontendUrl);
    const api = new URL(publicApiUrl);
    if (frontend.username || frontend.password || frontend.search || frontend.hash || frontend.pathname !== '/'
      || api.username || api.password || api.search || api.hash
      || (!privateHttp && (frontend.protocol !== 'https:' || api.protocol !== 'https:'
        || frontend.origin !== api.origin || api.pathname !== '/api'))
      || (privateHttp && (frontend.protocol !== 'http:' || api.protocol !== 'http:'))) {
      throw new Error('Недопустимые внешние адреса.');
    }
    frontendOrigin = frontend.origin;
  } catch {
    throw new Error('Публичные адреса должны задавать один доверенный HTTPS origin и API-путь /api; частный HTTP допустим только на loopback.');
  }
  for (const value of [input.dbDataDir, input.uploadsDir, input.backupsDir, input.errorReportsExportPath, input.logsDir, input.dockerExePath]) {
    if (value && /[\r\n\0]/.test(String(value))) throw new Error('Путь содержит недопустимые управляющие символы.');
  }
  return {
    schemaVersion: 1,
    instanceId: typeof input.instanceId === 'string' ? input.instanceId : null,
    firstBuildPending: input.firstBuildPending === true,
    buildReleaseId: typeof input.buildReleaseId === 'string' ? input.buildReleaseId : null,
    previousRelease: input.previousRelease && typeof input.previousRelease === 'object' ? input.previousRelease : null,
    updatePending: input.updatePending && typeof input.updatePending === 'object' ? input.updatePending : null,
    restoreTargetPending: input.restoreTargetPending === true,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
    projectRoot: ROOT_DIR,
    runtimeDir: RUNTIME_DIR,
    serverAddress,
    backendPort,
    frontendPort,
    dbDataDir: path.resolve(input.dbDataDir || defaults.dbDataDir),
    uploadsDir: path.resolve(input.uploadsDir || defaults.uploadsDir),
    backupsDir: path.resolve(input.backupsDir || defaults.backupsDir),
    errorReportsExportPath: path.resolve(input.errorReportsExportPath || defaults.errorReportsExportPath),
    logsDir: path.resolve(input.logsDir || defaults.logsDir),
    dockerExePath: input.dockerExePath ? path.resolve(input.dockerExePath) : '',
    publicApiUrl,
    publicFrontendUrl,
    corsAllowedOrigins: frontendOrigin,
    dockerProjectName,
  };
}

async function readConfig() {
  const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
  return normalizeConfig(JSON.parse(stripBom(raw)));
}

function stripBom(value) {
  return String(value ?? '').replace(/^\uFEFF/, '');
}

function generateSecrets() {
  return {
    postgresPassword: crypto.randomBytes(24).toString('hex'),
    jwtSecret: crypto.randomBytes(48).toString('hex'),
  };
}

function makeEnv(config, secrets) {
  const dbName = 'zavod';
  const dbUser = 'zavod';
  const dbPassword = secrets.postgresPassword;
  const databaseUrl = ['postgresql://', dbUser, ':', dbPassword, '@db:5432/', dbName, '?schema=public'].join('');
  return [
    '# Generated by Zavod setup wizard. Do not commit this file.',
    `COMPOSE_PROJECT_NAME=${config.dockerProjectName}`,
    `ZAVOD_RUNTIME_ENV_FILE=${toPosixVolume(ENV_PATH)}`,
    `ZAVOD_SERVER_ADDRESS=${config.serverAddress}`,
    `BACKEND_PORT=${config.backendPort}`,
    `FRONTEND_PORT=${config.frontendPort}`,
    `PUBLIC_API_URL=${config.publicApiUrl}`,
    `CORS_ALLOWED_ORIGINS=${config.corsAllowedOrigins}`,
    ...(config.dockerExePath ? [`ZAVOD_DOCKER_EXE=${config.dockerExePath}`] : []),
    `POSTGRES_DB=${dbName}`,
    `POSTGRES_USER=${dbUser}`,
    `POSTGRES_PASSWORD=${dbPassword}`,
    `DATABASE_URL=${databaseUrl}`,
    `JWT_SECRET=${secrets.jwtSecret}`,
    'NODE_ENV=production',
    'PORT=3000',
    'FILE_STORAGE_ROOT=/app/uploads',
    'ERROR_REPORTS_EXPORT_PATH=/app/error-reports-export',
    `DB_DATA_DIR=${toPosixVolume(config.dbDataDir)}`,
    `UPLOADS_DIR=${toPosixVolume(config.uploadsDir)}`,
    `BACKUPS_DIR=${toPosixVolume(config.backupsDir)}`,
    `ERROR_REPORTS_EXPORT_DIR=${toPosixVolume(config.errorReportsExportPath)}`,
    `LOGS_DIR=${toPosixVolume(config.logsDir)}`,
    '',
  ].join('\n');
}

function parseEnvFile(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}

async function readEnv() {
  return parseEnvFile(await fsp.readFile(ENV_PATH, 'utf8'));
}

function canonicalHostPath(value) {
  const resolved = path.resolve(String(value || ''));
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const canonical = fs.existsSync(existing)
    ? path.join(fs.realpathSync(existing), path.relative(existing, resolved)) : resolved;
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function assertEffectiveRuntime(config, env) {
  const expected = {
    COMPOSE_PROJECT_NAME: config.dockerProjectName,
    ZAVOD_SERVER_ADDRESS: config.serverAddress,
    BACKEND_PORT: String(config.backendPort),
    FRONTEND_PORT: String(config.frontendPort),
    PUBLIC_API_URL: config.publicApiUrl,
    CORS_ALLOWED_ORIGINS: config.corsAllowedOrigins,
    POSTGRES_DB: 'zavod',
    POSTGRES_USER: 'zavod',
    FILE_STORAGE_ROOT: '/app/uploads',
    ERROR_REPORTS_EXPORT_PATH: '/app/error-reports-export',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value) throw new Error(`Несогласованная конфигурация ${key}; операция остановлена до изменения сервисов.`);
  }
  const paths = {
    ZAVOD_RUNTIME_ENV_FILE: path.join(config.runtimeDir, 'production.env'),
    DB_DATA_DIR: config.dbDataDir,
    UPLOADS_DIR: config.uploadsDir,
    BACKUPS_DIR: config.backupsDir,
    ERROR_REPORTS_EXPORT_DIR: config.errorReportsExportPath,
    LOGS_DIR: config.logsDir,
  };
  for (const [key, value] of Object.entries(paths)) {
    if (!env[key] || canonicalHostPath(env[key]) !== canonicalHostPath(value)) {
      throw new Error(`Несогласованный эффективный путь ${key}; операция остановлена до изменения сервисов.`);
    }
  }
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { throw new Error('Некорректный DATABASE_URL; операция остановлена.'); }
  if (database.protocol !== 'postgresql:' || database.hostname !== 'db' || database.port !== '5432'
    || database.pathname !== '/zavod' || database.username !== env.POSTGRES_USER
    || database.password !== env.POSTGRES_PASSWORD || database.search !== '?schema=public') {
    throw new Error('DATABASE_URL не соответствует изолированной Compose-БД; операция остановлена.');
  }
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
}

async function writeFileWithBackup(filePath, content) {
  await ensureDir(path.dirname(filePath));
  let backupPath = null;
  if (fs.existsSync(filePath)) {
    backupPath = `${filePath}.bak-${timestamp()}`;
    await fsp.copyFile(filePath, backupPath);
    if (process.platform !== 'win32') await fsp.chmod(backupPath, 0o600);
  }
  await fsp.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') await fsp.chmod(filePath, 0o600);
  return backupPath;
}

async function pathWritable(dir) {
  try {
    let candidate = path.resolve(dir);
    while (!fs.existsSync(candidate)) {
      const parent = path.dirname(candidate);
      if (parent === candidate) return false;
      candidate = parent;
    }
    const stat = await fsp.lstat(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    await fsp.access(candidate, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

function commandResult(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    code: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error?.message || '',
  };
}

function dockerCliCandidates(explicitPath = '') {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);
  if (process.env.ZAVOD_DOCKER_EXE) candidates.push(process.env.ZAVOD_DOCKER_EXE);
  const configured = configuredDockerExePath();
  if (configured) candidates.push(configured);
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
      'C:\\Program Files\\Docker\\Docker\\resources\\docker.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
    );
  }
  candidates.push('docker');
  return candidates.filter(Boolean);
}

function configuredDockerExePath() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return '';
    const config = JSON.parse(stripBom(fs.readFileSync(CONFIG_PATH, 'utf8')));
    return typeof config.dockerExePath === 'string' ? config.dockerExePath.trim() : '';
  } catch {
    return '';
  }
}

function resolveDockerCommand(explicitPath = '') {
  const shim = process.env.ZAVOD_DOCKER_SHIM;
  if (shim) return { command: process.execPath, prefixArgs: [shim], source: 'ZAVOD_DOCKER_SHIM' };
  for (const candidate of dockerCliCandidates(explicitPath)) {
    if (candidate !== 'docker' && !fs.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ['--version'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status === 0) return { command: candidate, prefixArgs: [], source: candidate };
  }
  return { command: 'docker', prefixArgs: [], source: 'PATH' };
}

function dockerInvocation(args) {
  const resolved = resolveDockerCommand();
  return { command: resolved.command, args: [...resolved.prefixArgs, ...args], source: resolved.source };
}

function dockerCommandResult(args = [], options = {}) {
  const invocation = dockerInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: ROOT_DIR,
    encoding: options.encoding === null ? null : 'utf8',
    windowsHide: true,
    stdio: options.stdio || 'pipe',
    maxBuffer: options.maxBuffer,
    input: options.input,
    env: options.env || process.env,
  });
  return result;
}

function spawnDocker(args = [], options = {}) {
  const invocation = dockerInvocation(args);
  return spawn(invocation.command, invocation.args, {
    cwd: ROOT_DIR,
    windowsHide: true,
    ...options,
  });
}

function dockerInfo(explicitPath = '') {
  const previous = process.env.ZAVOD_DOCKER_EXE;
  if (explicitPath) process.env.ZAVOD_DOCKER_EXE = explicitPath;
  const invocation = resolveDockerCommand(explicitPath);
  const docker = dockerCommandResult(['--version']);
  const compose = dockerCommandResult(['compose', 'version']);
  if (explicitPath) {
    if (previous === undefined) delete process.env.ZAVOD_DOCKER_EXE;
    else process.env.ZAVOD_DOCKER_EXE = previous;
  }
  const dockerStdout = String(docker.stdout || '').trim();
  const dockerStderr = String(docker.stderr || '').trim();
  const composeStdout = String(compose.stdout || '').trim();
  const composeStderr = String(compose.stderr || '').trim();
  return {
    dockerFound: docker.status === 0,
    dockerVersion: dockerStdout || dockerStderr || docker.error?.message || '',
    dockerCommand: invocation.source,
    composeFound: compose.status === 0,
    composeVersion: composeStdout || composeStderr || compose.error?.message || '',
  };
}

function composeBaseArgs() {
  const raw = JSON.parse(stripBom(fs.readFileSync(CONFIG_PATH, 'utf8')));
  const name = normalizeConfig(raw).dockerProjectName;
  return ['compose', '--env-file', ENV_PATH, '-f', COMPOSE_FILE, '-p', name];
}

function runDockerCompose(args, options = {}) {
  const result = dockerCommandResult([...composeBaseArgs(), ...args], {
    stdio: options.inherit ? 'inherit' : 'pipe',
    input: options.input,
    env: options.env,
  });
  if (result.status !== 0) {
    let message = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n').trim();
    if (options.secret) message = message.split(options.secret).join('[credential hidden]');
    message = message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL hidden]');
    throw new Error(message || `docker compose завершился с кодом ${result.status}`);
  }
  return {
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function releaseIdForStaged(staged) {
  const hash = crypto.createHash('sha256');
  for (const relative of canonicalBuildFiles(staged.files)) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(staged.path, relative)));
  }
  return `1.0.0+${hash.digest('hex').slice(0, 16)}`;
}

function candidateReleaseId() {
  const staged = createBuildContext(ROOT_DIR);
  try { return releaseIdForStaged(staged); }
  finally { removeBuildContext(staged.path); }
}

function schemaFingerprint(buildFiles = collectBuildFiles(ROOT_DIR), sourceRoot = ROOT_DIR) {
  const files = canonicalBuildFiles(buildFiles).filter((item) => item === 'backend/prisma/schema.prisma'
    || /^backend\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(item));
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(sourceRoot, relative)));
  }
  return hash.digest('hex');
}

function buildProductionImages() {
  const staged = createBuildContext(ROOT_DIR);
  try {
    const releaseId = releaseIdForStaged(staged);
    runDockerCompose(['build', 'backend', 'frontend'], {
      env: { ...process.env, ZAVOD_BUILD_CONTEXT: staged.path, ZAVOD_RELEASE_ID: releaseId },
    });
    return { files: staged.files.length, releaseId };
  } finally {
    removeBuildContext(staged.path);
  }
}

function runBackendCommand(script) {
  return runDockerCompose(['run', '--rm', '--no-deps', '-T', 'backend', 'npm', 'run', script, '--workspace', 'backend']);
}

function runtimeStatus() {
  const result = dockerCommandResult([...composeBaseArgs(), 'run', '--rm', '--no-deps', '-T', 'backend',
    'npm', 'run', 'vps-prep:runtime-status', '--workspace', 'backend']);
  if (result.status === 0) return 'READY';
  if (result.status === 3 && String(result.stdout).includes('RUNTIME_READINESS=FIRST_ADMIN_REQUIRED')) return 'FIRST_ADMIN_REQUIRED';
  throw new Error('Схема или системная подготовка не готовы. Backend и frontend не запущены. Проверьте безопасный вывод runtime-status.');
}

async function httpOk(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, status: 0, error: error.message });
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(parsed, { method: 'GET', timeout: timeoutMs }, (response) => {
      response.resume();
      response.on('end', () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 400, status: response.statusCode || 0 }));
    });
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', (error) => resolve({ ok: false, status: 0, error: error.message }));
    request.end();
  });
}

async function waitForOk(url, timeoutMs = 90000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await httpOk(url, 5000);
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(`Сервис не ответил вовремя: ${url}. Последний статус: ${last?.status || last?.error || 'нет ответа'}`);
}

async function validateConfig(input, options = {}) {
  const config = normalizeConfig(input);
  assertStoragePaths(config);
  assertOutsideProject(config, ROOT_DIR);
  const docker = dockerInfo();
  const checks = [];
  const add = (name, ok, details = '') => checks.push({ name, ok, details });

  add('Docker', docker.dockerFound, docker.dockerVersion || REQUIRED_DOCKER_MESSAGE);
  add('Docker Compose', docker.composeFound, docker.composeVersion || REQUIRED_DOCKER_MESSAGE);
  if (config.dockerExePath) add('Путь к docker.exe', fs.existsSync(config.dockerExePath), config.dockerExePath);
  add('Файл docker-compose.production.yml', fs.existsSync(COMPOSE_FILE), COMPOSE_FILE);
  add('Prisma schema', fs.existsSync(PRISMA_SCHEMA_PATH), PRISMA_SCHEMA_PATH);
  add('Prisma migrations', hasMigrationFiles(), PRISMA_MIGRATIONS_DIR);

  for (const [name, dir] of [
    ['Папка данных БД', config.dbDataDir],
    ['Папка uploads', config.uploadsDir],
    ['Папка backup', config.backupsDir],
    ['Папка сообщений об ошибках', config.errorReportsExportPath],
    ['Папка logs', config.logsDir],
    ['Папка runtime-конфига', RUNTIME_DIR],
  ]) {
    add(name, await pathWritable(dir), dir);
  }
  try {
    const dbStorage = inspectDbStorage(config.dbDataDir);
    add('Контракт PostgreSQL 18', dbStorage.state === 'NEW' || dbStorage.state === 'OWNED', dbStorage.state);
  } catch (error) {
    add('Контракт PostgreSQL 18', false, error.message);
  }

  add(`Порт backend ${config.backendPort}`, await isPortFree(config.backendPort), 'Порт должен быть свободен перед первым запуском');
  add(`Порт frontend ${config.frontendPort}`, await isPortFree(config.frontendPort), 'Порт должен быть свободен перед первым запуском');

  const ok = checks.every((item) => item.ok || (options.allowMissingDocker && (item.name === 'Docker' || item.name === 'Docker Compose')));
  return { ok, config, checks, docker };
}

async function deploy(input, options = {}) {
  const runtimeRelative = path.relative(ROOT_DIR, RUNTIME_DIR);
  if (!runtimeRelative || (!runtimeRelative.startsWith('..') && !path.isAbsolute(runtimeRelative))) {
    throw new Error('Runtime-конфигурация новой установки должна находиться вне исходников проекта.');
  }
  const validation = await validateConfig(input, { allowMissingDocker: options.dryRun });
  if (!validation.ok) {
    return {
      ok: false,
      dryRun: Boolean(options.dryRun),
      checks: validation.checks,
      message: 'Проверка не пройдена. Исправьте отмеченные пункты и повторите.',
    };
  }

  const config = validation.config;
  const written = [];
  const existingConfig = fs.existsSync(CONFIG_PATH);
  const existingEnv = fs.existsSync(ENV_PATH);

  if (!options.dryRun && (existingConfig || existingEnv)) {
    if (existingConfig && existingEnv) {
      const saved = await readConfig();
        const fields = ['serverAddress', 'backendPort', 'frontendPort', 'publicApiUrl', 'publicFrontendUrl', 'dbDataDir', 'uploadsDir', 'backupsDir', 'errorReportsExportPath', 'logsDir', 'dockerExePath'];
      if (saved.firstBuildPending && saved.instanceId && saved.restoreTargetPending === Boolean(options.restoreTarget)
        && fields.every((field) => saved[field] === config[field])) {
        const build = buildProductionImages();
        await writeFileWithBackup(CONFIG_PATH, `${JSON.stringify({ ...saved, firstBuildPending: false, buildReleaseId: build.releaseId }, null, 2)}\n`);
        const launched = options.restoreTarget
          ? (runDockerCompose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'db']), { restoreTargetReady: true })
          : await startServices();
        return {
          ok: true, dryRun: false, config: await readConfig(), written: [], existingConfig: true, existingEnv: true,
          resumedFirstBuild: true, build, ...launched,
          message: launched.firstAdminRequired
            ? 'Схема и системная основа готовы. Первый ADMIN ещё не создан: выполните явный bootstrap с защищённым credential, затем start.'
            : launched.restoreTargetReady ? 'Независимая пустая цель подготовлена; приложение не запускалось.'
              : 'Завод подготовлен и запущен на loopback-интерфейсе.',
        };
      }
    }
    return {
      ok: false, dryRun: false, checks: validation.checks, existingConfig, existingEnv,
      message: 'Runtime-конфиг уже существует или не совпадает с незавершённой первой сборкой. Секреты не заменены; используйте start или исследуйте состояние установки.',
    };
  }

  for (const dir of [RUNTIME_DIR, config.uploadsDir, config.backupsDir, config.errorReportsExportPath, config.logsDir]) {
    if (!options.dryRun) await fsp.mkdir(dir, { recursive: true, mode: dir === RUNTIME_DIR || dir === config.backupsDir ? 0o700 : 0o750 });
  }
  if (!options.dryRun && process.platform !== 'win32') {
    if (fs.lstatSync(RUNTIME_DIR).isSymbolicLink()) throw new Error('Runtime-каталог не может быть ссылкой.');
    await fsp.chmod(RUNTIME_DIR, 0o700);
  }

  if (!options.dryRun) {
    config.instanceId = crypto.randomUUID();
    config.dockerProjectName = `zavod-local-${config.instanceId.replace(/-/g, '').slice(0, 12)}`;
    config.firstBuildPending = true;
    config.restoreTargetPending = Boolean(options.restoreTarget);
    config.buildReleaseId = null;
    prepareDbStorage(config.dbDataDir);
    const secrets = generateSecrets();
    const configBackup = await writeFileWithBackup(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    const envBackup = await writeFileWithBackup(ENV_PATH, makeEnv(config, secrets));
    written.push({ file: CONFIG_PATH, backup: configBackup });
    written.push({ file: ENV_PATH, backup: envBackup });
  }

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      config,
      checks: validation.checks,
      existingConfig,
      existingEnv,
      message: 'Dry-run пройден: конфиг может быть создан, Docker deploy не запускался.',
    };
  }

  const build = buildProductionImages();
  config.firstBuildPending = false;
  config.buildReleaseId = build.releaseId;
  await writeFileWithBackup(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  const launched = options.restoreTarget
    ? (runDockerCompose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'db']), { restoreTargetReady: true })
    : await startServices();

  return {
    ok: true,
    dryRun: false,
    config,
    written,
    existingConfig,
    existingEnv,
    build,
    ...launched,
    message: launched.firstAdminRequired
      ? 'Схема и системная основа готовы. Первый ADMIN ещё не создан: выполните явный bootstrap с защищённым credential, затем start.'
      : launched.restoreTargetReady ? 'Независимая пустая цель подготовлена; приложение не запускалось.'
        : 'Завод подготовлен и запущен на loopback-интерфейсе.',
  };
}

function hasMigrationFiles() {
  try {
    if (!fs.existsSync(PRISMA_MIGRATIONS_DIR)) return false;
    return fs.readdirSync(PRISMA_MIGRATIONS_DIR, { withFileTypes: true }).some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

function assertStartAllowed(config, options = {}) {
  if (config.restoreTargetPending) throw new Error('Независимая цель ещё не восстановлена; запуск приложения запрещён.');
  if (config.updatePending && !options.internalUpdateStart) throw new Error('Update ещё не завершён; обычный start запрещён до разбора pending release.');
}

async function startServices(options = {}) {
  const config = await readConfig();
  assertStartAllowed(config, options);
  if (!fs.existsSync(ENV_PATH)) throw new Error('Файл production.env не найден. Сначала выполните установку.');
  assertEffectiveRuntime(config, await readEnv());
  assertStoragePaths(config);
  assertOutsideProject(config, ROOT_DIR);
  if (inspectDbStorage(config.dbDataDir).state !== 'OWNED') throw new Error('Каталог PostgreSQL не подготовлен этой установкой.');
  prepareDbStorage(config.dbDataDir);
  runDockerCompose(['stop', 'backend', 'frontend']);
  runDockerCompose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'db']);
  runBackendCommand('prisma:migrate:deploy');
  runBackendCommand('vps-prep:foundation');
  const status = runtimeStatus();
  if (status === 'FIRST_ADMIN_REQUIRED') return { firstAdminRequired: true, runtimeStatus: status };
  if (options.holdApp) return { firstAdminRequired: false, runtimeStatus: status, appHeld: true };
  runDockerCompose(['up', '-d', '--no-build', ...(options.forceRecreateApp ? ['--force-recreate'] : []), 'backend', 'frontend']);
  return {
    firstAdminRequired: false,
    runtimeStatus: status,
    backend: await waitForOk(`http://127.0.0.1:${config.backendPort}/ready`),
    frontend: await waitForOk(`http://127.0.0.1:${config.frontendPort}/`),
  };
}

function retainCurrentImages(config, runner) {
  const raw = runner.compose(['ps', '--all', '--format', 'json']).stdout.trim();
  let entries;
  try { entries = raw.startsWith('[') ? JSON.parse(raw) : raw.split(/\r?\n/).map((line) => JSON.parse(line)); }
  catch { throw new Error('Не удалось определить running images прежнего release.'); }
  const result = {};
  for (const service of ['backend', 'frontend']) {
    const matches = entries.filter((item) => item.Service === service && item.State === 'running'
      && [`${config.dockerProjectName}-${service}-1`, `${config.dockerProjectName}_${service}_1`].includes(item.Name));
    if (matches.length !== 1 || !matches[0].ID) throw new Error('Running image прежнего release неоднозначен.');
    const image = runner.command(['inspect', '--format', '{{.Image}}', matches[0].ID]);
    const imageId = String(image.stdout || '').trim();
    if (image.status !== 0 || !/^sha256:[0-9a-f]{64}$/.test(imageId)) throw new Error('Не удалось зафиксировать image ID прежнего release.');
    const tag = `${config.dockerProjectName}-${service}:rollback-${config.buildReleaseId.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
    const tagged = runner.command(['image', 'tag', imageId, tag]);
    if (tagged.status !== 0) throw new Error('Не удалось сохранить immutable tag прежнего image.');
    const readback = runner.command(['image', 'inspect', '--format', '{{.Id}}', tag]);
    if (readback.status !== 0 || String(readback.stdout || '').trim() !== imageId) throw new Error('Readback прежнего image tag не совпал.');
    result[service] = { imageId, tag };
  }
  return result;
}

async function updateServices(backupDir, injectedRunner) {
  const runner = injectedRunner || { compose: runDockerCompose, command: dockerCommandResult,
    validateDump: assertPgDumpReadable, build: buildProductionImages, start: startServices };
  if (['compose', 'command', 'validateDump', 'build', 'start'].some((key) => typeof runner[key] !== 'function')) {
    throw new Error('Тестовый runner должен явно подменить все внешние команды.');
  }
  if (!backupDir) throw new Error('Перед update укажите --backup <папка проверенного backup>.');
  const config = await readConfig();
  if (config.updatePending) throw new Error('Предыдущее update не завершено; нужен контрольный разбор retained images перед новой попыткой.');
  assertEffectiveRuntime(config, await readEnv());
  assertBackupInsideBackupsDir(config, backupDir);
  const backup = await validateBackup(backupDir);
  if (!backup.ok) throw new Error('Backup не прошёл проверку. Update остановлен.');
  const manifest = JSON.parse(await fsp.readFile(path.join(path.resolve(backupDir), 'manifest.json'), 'utf8'));
  if (!config.instanceId || manifest.source?.instanceId !== config.instanceId
    || manifest.mode !== 'full'
    || manifest.contents?.databaseDump !== 'database/zavod.dump'
    || manifest.source?.uploadsRoot !== config.uploadsDir
    || manifest.source?.database?.name !== 'zavod'
    || manifest.source?.buildReleaseId !== config.buildReleaseId
    || manifest.source?.schemaFingerprint !== schemaFingerprint()) {
    throw new Error('Для update требуется полный проверенный backup БД, uploads и конфигурации.');
  }
  await runner.validateDump(path.join(path.resolve(backupDir), 'database', 'zavod.dump'));
  const candidate = candidateReleaseId();
  if (candidate === config.buildReleaseId) throw new Error('Исходники совпадают с текущим release: same-image restart не является update.');
  const retained = retainCurrentImages(config, runner);
  await writeFileWithBackup(CONFIG_PATH, `${JSON.stringify({ ...config, updatePending: {
    fromReleaseId: config.buildReleaseId, toReleaseId: candidate, schemaFingerprint: manifest.source.schemaFingerprint,
    retainedImages: retained, startedAt: nowIso(),
  } }, null, 2)}\n`);
  runner.compose(['stop', 'backend', 'frontend']);
  const build = runner.build();
  if (build.releaseId !== candidate) throw new Error('Release identity изменилась во время update; прежние образы сохранены.');
  const started = await runner.start({ internalUpdateStart: true });
  if (started?.firstAdminRequired || started?.runtimeStatus !== 'READY' || !started?.backend?.ok || !started?.frontend?.ok) {
    throw new Error('Новый release не достиг рабочего READY; updatePending и прежние образы сохранены.');
  }
  await writeFileWithBackup(CONFIG_PATH, `${JSON.stringify({ ...config, buildReleaseId: build.releaseId,
    previousRelease: { releaseId: config.buildReleaseId, schemaFingerprint: manifest.source.schemaFingerprint, retainedImages: retained },
    updatePending: null }, null, 2)}\n`);
  return { ...started, build };
}

async function bootstrapAdmin(args) {
  const required = ['factory-name', 'factory-code', 'admin-phone', 'admin-last-name', 'admin-first-name', 'credential-file'];
  for (const key of required) {
    if (typeof args[key] !== 'string' || !args[key].trim()) throw new Error(`Для bootstrap требуется --${key} <значение>.`);
  }
  const credentialPath = path.resolve(args['credential-file']);
  const credentialStat = await fsp.lstat(credentialPath);
  if (!credentialStat.isFile() || credentialStat.isSymbolicLink()) throw new Error('Credential должен находиться в обычном защищённом файле.');
  if (process.platform !== 'win32' && (credentialStat.mode & 0o077) !== 0) throw new Error('Credential file должен иметь mode 600.');
  const factoryCode = args['factory-code'].trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(factoryCode)) throw new Error('Код завода должен содержать 2–50 строчных латинских букв, цифр или дефисов.');
  const existingEnv = await readEnv();
  if (existingEnv.REGISTRATION_FACTORY_CODE && existingEnv.REGISTRATION_FACTORY_CODE !== factoryCode) {
    throw new Error('Для этой установки уже выбран другой код завода для регистрации. Bootstrap остановлен.');
  }
  const credential = (await fsp.readFile(credentialPath, 'utf8')).replace(/\r?\n$/u, '');
  await startServices({ holdApp: true });
  const cliArgs = [
    '--factory-name', args['factory-name'],
    '--factory-code', factoryCode,
    '--admin-phone', args['admin-phone'],
    '--admin-last-name', args['admin-last-name'],
    '--admin-first-name', args['admin-first-name'],
    ...(typeof args['admin-middle-name'] === 'string' ? ['--admin-middle-name', args['admin-middle-name']] : []),
    '--credential-stdin',
  ];
  const result = dockerCommandResult([...composeBaseArgs(), 'run', '--rm', '--no-deps', '-T', 'backend',
    'node', 'backend/dist/cli/bootstrap-first-admin.js', ...cliArgs], { input: `${credential}\n` });
  const output = String(result.stdout || '').split(credential).join('[credential hidden]');
  if (result.status !== 0 && !(result.status === 3 && output.includes('FIRST_ADMIN_BOOTSTRAP=ALREADY_COMPLETED'))) {
    const error = String(result.stderr || result.error?.message || 'bootstrap завершился ошибкой')
      .split(credential).join('[credential hidden]')
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL hidden]');
    throw new Error(error);
  }
  let envChanged = false;
  if (!existingEnv.REGISTRATION_FACTORY_CODE) {
    const current = await fsp.readFile(ENV_PATH, 'utf8');
    await writeFileWithBackup(ENV_PATH, `${current.trimEnd()}\nREGISTRATION_FACTORY_CODE=${factoryCode}\n`);
    envChanged = true;
  }
  const started = await startServices({ forceRecreateApp: envChanged });
  return { diagnostic: result.status === 3 ? 'ALREADY_COMPLETED' : 'CREATED', output: output.trim(), started };
}

async function stopServices() {
  await readConfig();
  runDockerCompose(['stop']);
}

async function checkSystem() {
  const report = [];
  const docker = dockerInfo();
  report.push({ name: 'Docker', ok: docker.dockerFound, details: docker.dockerVersion || REQUIRED_DOCKER_MESSAGE });
  report.push({ name: 'Docker Compose', ok: docker.composeFound, details: docker.composeVersion || REQUIRED_DOCKER_MESSAGE });
  report.push({ name: 'Runtime config', ok: fs.existsSync(CONFIG_PATH), details: CONFIG_PATH });
  report.push({ name: 'Runtime env', ok: fs.existsSync(ENV_PATH), details: ENV_PATH });
  report.push({ name: 'Prisma schema', ok: fs.existsSync(PRISMA_SCHEMA_PATH), details: PRISMA_SCHEMA_PATH });
  report.push({ name: 'Prisma migrations', ok: hasMigrationFiles(), details: PRISMA_MIGRATIONS_DIR });

  let config = null;
  if (fs.existsSync(CONFIG_PATH)) {
    config = await readConfig();
    if (config.dockerExePath) {
      report.push({ name: 'Путь к docker.exe', ok: fs.existsSync(config.dockerExePath), details: config.dockerExePath });
    }
    for (const [name, dir] of [
      ['Папка данных БД', config.dbDataDir],
      ['Папка uploads', config.uploadsDir],
      ['Папка backup', config.backupsDir],
      ['Папка сообщений об ошибках', config.errorReportsExportPath],
      ['Папка logs', config.logsDir],
    ]) {
      report.push({ name, ok: await pathWritable(dir), details: dir });
    }
    report.push({ name: 'Backend /health', ...(await httpOk(`http://127.0.0.1:${config.backendPort}/health`)), details: `http://127.0.0.1:${config.backendPort}/health` });
    report.push({ name: 'Backend /ready', ...(await httpOk(`http://127.0.0.1:${config.backendPort}/ready`)), details: `http://127.0.0.1:${config.backendPort}/ready` });
    report.push({ name: 'Frontend', ...(await httpOk(`http://127.0.0.1:${config.frontendPort}/`)), details: `http://127.0.0.1:${config.frontendPort}/` });
  }

  if (docker.dockerFound && docker.composeFound && fs.existsSync(ENV_PATH)) {
    try {
      runDockerCompose(['exec', '-T', 'db', 'pg_isready', '-U', 'zavod', '-d', 'zavod']);
      report.push({ name: 'PostgreSQL container', ok: true, details: 'pg_isready ok' });
    } catch (error) {
      report.push({ name: 'PostgreSQL container', ok: false, details: error.message });
    }
    try {
      runDockerCompose(['run', '--rm', 'backend', 'npm', 'run', 'prisma:migrate:status', '--workspace', 'backend']);
      report.push({ name: 'Prisma migrate status', ok: true, details: 'migrations are reachable' });
    } catch (error) {
      report.push({ name: 'Prisma migrate status', ok: false, details: 'Проверьте миграции и доступность БД' });
    }
  }

  return report;
}

function safeBackupName() {
  return `zavod-backup-${timestamp()}`;
}

async function listFilesRecursive(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      files.push(full);
    } else {
      throw new Error('Backup содержит ссылку или неподдерживаемый объект. Операция остановлена.');
    }
  }
  return files;
}

async function copyDir(source, target) {
  if (!fs.existsSync(source)) return 0;
  await ensureDir(target);
  let count = 0;
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      count += await copyDir(from, to);
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(to));
      await fsp.copyFile(from, to);
      count += 1;
    } else {
      throw new Error('Uploads содержит ссылку или неподдерживаемый объект. Backup остановлен.');
    }
  }
  return count;
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function writeChecksums(root) {
  const files = await listFilesRecursive(root);
  const lines = [];
  for (const file of files.sort()) {
    if (path.basename(file) === 'checksums.sha256') continue;
    const rel = path.relative(root, file).replace(/\\/g, '/');
    lines.push(`${await sha256(file)}  ${rel}`);
  }
  await fsp.writeFile(path.join(root, 'checksums.sha256'), `${lines.join('\n')}\n`, 'utf8');
  return lines.length;
}

function parseComposeContainers(raw, projectName) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Не удалось подтвердить состояние контейнеров этой установки.');
  let entries;
  try {
    entries = text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/).map((line) => JSON.parse(line));
  } catch {
    throw new Error('Ответ Compose о контейнерах не распознан. Backup не начат.');
  }
  if (!Array.isArray(entries) || !entries.length) throw new Error('Контейнеры установки не подтверждены.');
  const running = new Set();
  for (const entry of entries) {
    const service = entry.Service;
    const state = String(entry.State || '').toLowerCase();
    const name = String(entry.Name || '');
    if (!['db', 'backend', 'frontend'].includes(service)
      || ![`${projectName}-${service}-1`, `${projectName}_${service}_1`].includes(name)
      || !['running', 'exited', 'created'].includes(state)) {
      throw new Error('Состояние или identity контейнеров неоднозначны; backup остановлен.');
    }
    if (state === 'running') running.add(service);
  }
  if (!running.has('db')) throw new Error('БД этой установки не запущена; backup остановлен.');
  return running;
}

function backupCommandRunner(injected) {
  if (!injected) return { compose: runDockerCompose, command: dockerCommandResult };
  if (typeof injected.compose !== 'function' || typeof injected.command !== 'function') {
    throw new Error('Тестовый runner должен явно подменить все внешние команды.');
  }
  return injected;
}

async function createBackup(injectedRunner) {
  const runner = backupCommandRunner(injectedRunner);
  const config = await readConfig();
  const env = await readEnv();
  assertStoragePaths(config);
  assertOutsideProject(config, ROOT_DIR);
  assertEffectiveRuntime(config, env);
  if (!config.instanceId || !config.buildReleaseId || env.COMPOSE_PROJECT_NAME !== config.dockerProjectName) {
    throw new Error('Identity установки или release не подтверждены; backup остановлен.');
  }
  const snapshot = () => parseComposeContainers(runner.compose(['ps', '--all', '--format', 'json']).stdout, config.dockerProjectName);
  const initiallyRunning = snapshot();
  const appServices = ['backend', 'frontend'].filter((service) => initiallyRunning.has(service));
  const backupDir = path.join(config.backupsDir, safeBackupName());
  const partialDir = `${backupDir}.partial-${crypto.randomBytes(6).toString('hex')}`;
  if (fs.existsSync(backupDir) || fs.existsSync(partialDir)) throw new Error('Имя backup уже занято.');
  let stopAttempted = false;
  let published = false;
  let result;
  let failure;
  try {
    if (appServices.length) {
      stopAttempted = true;
      runner.compose(['stop', ...appServices]);
    }
    const afterStop = snapshot();
    if (afterStop.has('backend') || afterStop.has('frontend')) {
      throw new Error('Не все источники записи остановлены; backup запрещён.');
    }
    const databaseDir = path.join(partialDir, 'database');
    const uploadsBackupDir = path.join(partialDir, 'uploads');
    const configDir = path.join(partialDir, 'config');
    await ensureDir(databaseDir);
    await ensureDir(uploadsBackupDir);
    await ensureDir(configDir);
    const dumpPath = path.join(databaseDir, 'zavod.dump');
    const dump = runner.command([
    ...composeBaseArgs(),
    'exec',
    '-T',
    'db',
    'pg_dump',
    '-U',
    env.POSTGRES_USER || 'zavod',
    '-d',
    env.POSTGRES_DB || 'zavod',
    '-Fc',
    ], {
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024,
    });
    if (dump.status !== 0 || !Buffer.isBuffer(dump.stdout)) {
      throw new Error('Не удалось создать бинарный дамп БД.');
    }
    await fsp.writeFile(dumpPath, dump.stdout);

    const uploadsCount = await copyDir(config.uploadsDir, uploadsBackupDir);
    await fsp.copyFile(CONFIG_PATH, path.join(configDir, 'zavod.config.json'));
    await fsp.copyFile(ENV_PATH, path.join(configDir, 'production.env'));

    const manifest = {
    schemaVersion: 1,
    mode: 'full',
    createdAt: nowIso(),
    projectName: 'Завод',
    source: {
      instanceId: config.instanceId,
      buildReleaseId: config.buildReleaseId,
      schemaFingerprint: schemaFingerprint(),
      dockerProjectName: config.dockerProjectName,
      runtimeDir: config.runtimeDir,
      dbDataDir: config.dbDataDir,
      backupsDir: config.backupsDir,
      logsDir: config.logsDir,
      serverAddress: config.serverAddress,
      backendPort: config.backendPort,
      frontendPort: config.frontendPort,
      database: {
        host: 'docker-compose service db',
        name: env.POSTGRES_DB || 'zavod',
        user: env.POSTGRES_USER || 'zavod',
      },
      uploadsRoot: config.uploadsDir,
      errorReportsExportRoot: config.errorReportsExportPath,
    },
    contents: {
      databaseDump: 'database/zavod.dump',
      uploads: 'uploads/',
      config: 'config/',
      uploadsFileCount: uploadsCount,
    },
      consistency: { method: 'compose-app-quiesce', appStoppedAndVerified: true },
      warning: 'Backup contains a database dump and production configuration. Keep it as a secret operational artifact.',
    };
    await fsp.writeFile(path.join(partialDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const checksumCount = await writeChecksums(partialDir);
    const validation = await validateBackup(partialDir);
    if (!validation.ok) throw new Error('Созданная пара БД/uploads/config не прошла полную проверку.');
    await fsp.rename(partialDir, backupDir);
    published = true;
    result = { backupDir, uploadsCount, checksumCount, dumpPath: path.join(backupDir, 'database', 'zavod.dump') };
  } catch (error) {
    failure = error;
  } finally {
    if (!published && fs.existsSync(partialDir)) {
      try { await fsp.rm(partialDir, { recursive: true, force: false }); }
      catch (cleanupError) { failure = new Error(`${failure?.message || 'Backup не завершён'}; не удалён собственный partial: ${cleanupError.message}`); }
    }
    if (stopAttempted && appServices.length) {
      try {
        runner.compose(['up', '-d', '--no-build', '--no-deps', ...appServices]);
        const resumed = snapshot();
        if (appServices.some((service) => !resumed.has(service))) throw new Error('Исходное состояние приложений не восстановлено.');
      } catch (resumeError) {
        failure = new Error(`${failure?.message || 'Backup завершён, но'}; не удалось вернуть исходные сервисы: ${resumeError.message}`);
      }
    }
  }
  if (failure) throw failure;
  return result;
}

async function validateBackup(backupDir) {
  const root = path.resolve(backupDir);
  const manifestPath = path.join(root, 'manifest.json');
  const checksumsPath = path.join(root, 'checksums.sha256');
  const dumpPath = path.join(root, 'database', 'zavod.dump');
  const uploadsDir = path.join(root, 'uploads');
  const configDir = path.join(root, 'config');
  const checks = [];
  const add = (name, ok, details = '') => checks.push({ name, ok, details });
  const requiredFiles = [manifestPath, checksumsPath, dumpPath,
    path.join(configDir, 'zavod.config.json'), path.join(configDir, 'production.env')];
  for (const file of requiredFiles) {
    const present = fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
    add(path.relative(root, file).replace(/\\/g, '/'), present);
  }
  add('uploads/', fs.existsSync(uploadsDir) && fs.lstatSync(uploadsDir).isDirectory() && !fs.lstatSync(uploadsDir).isSymbolicLink());
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')); } catch { /* reported below */ }
  }
  add('full manifest', manifest?.mode === 'full'
    && manifest?.contents?.databaseDump === 'database/zavod.dump'
    && manifest?.contents?.uploads === 'uploads/'
    && manifest?.contents?.config === 'config/'
    && Number.isInteger(manifest?.contents?.uploadsFileCount));
  add('verified write boundary', manifest?.consistency?.method === 'compose-app-quiesce'
    && manifest?.consistency?.appStoppedAndVerified === true);
  if (fs.existsSync(dumpPath) && fs.lstatSync(dumpPath).isFile()) {
    const handle = await fsp.open(dumpPath, 'r');
    try {
      const magic = Buffer.alloc(5);
      await handle.read(magic, 0, 5, 0);
      add('PostgreSQL custom dump header', fs.statSync(dumpPath).size > 128 && magic.toString('ascii') === 'PGDMP');
    } finally { await handle.close(); }
  }
  if (fs.existsSync(checksumsPath)) {
    const lines = (await fsp.readFile(checksumsPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    const expected = new Map();
    let malformed = 0;
    for (const line of lines) {
      const match = line.match(/^([a-f0-9]{64})  ([^\\]+)$/);
      const relative = match?.[2];
      if (!relative || relative.startsWith('/') || relative.includes('..') || expected.has(relative)) { malformed += 1; continue; }
      expected.set(relative, match[1]);
    }
    const actual = (await listFilesRecursive(root)).map((file) => path.relative(root, file).replace(/\\/g, '/'))
      .filter((file) => file !== 'checksums.sha256');
    let mismatch = malformed + (expected.size === actual.length ? 0 : 1);
    for (const relative of actual) {
      if (!expected.has(relative) || await sha256(path.join(root, relative)) !== expected.get(relative)) mismatch += 1;
    }
    add('complete checksums', mismatch === 0, mismatch ? `${mismatch} mismatch` : `${actual.length} files`);
    const uploadsCount = actual.filter((file) => file.startsWith('uploads/')).length;
    add('uploads count', uploadsCount === manifest?.contents?.uploadsFileCount);
  }
  return { ok: checks.every((item) => item.ok), checks };
}

async function assertPgDumpReadable(dumpPath) {
  await new Promise((resolve, reject) => {
    const child = spawnDocker([...composeBaseArgs(), 'exec', '-T', 'db', 'pg_restore', '--list'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    const input = fs.createReadStream(dumpPath);
    let listing = '';
    let failed = false;
    const fail = () => { failed = true; child.kill(); };
    const timer = setTimeout(fail, 90_000);
    input.on('error', fail);
    child.stdin.on('error', () => {});
    input.pipe(child.stdin);
    child.stdout.on('data', (chunk) => {
      listing += chunk.toString('utf8');
      if (listing.length > 2_000_000) fail();
    });
    child.stderr.on('data', () => {});
    child.on('error', () => { failed = true; });
    child.on('close', (code) => {
      clearTimeout(timer);
      input.destroy();
      if (failed || code !== 0 || !['Factory', 'User', '_prisma_migrations']
        .every((table) => listing.includes(`TABLE public ${table} `))) {
        reject(new Error('PostgreSQL dump не прошёл проверку pg_restore --list. Update остановлен.'));
      } else resolve();
    });
  });
}

function assertBackupInsideBackupsDir(config, backupDir) {
  const root = fs.realpathSync(config.backupsDir);
  const target = fs.realpathSync(backupDir);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new Error('Backup должен находиться внутри настроенной папки backups.');
  }
}

async function restoreBackup() {
  throw new Error('In-place restore отключён: он может заменить данные действующей установки. Используйте отдельную подготовленную цель и restore-independent.');
}

function assertIndependentIdentity(config, manifest, sourceConfig, sourceEnv, targetEnv) {
  assertEffectiveRuntime(sourceConfig, sourceEnv);
  assertEffectiveRuntime(config, targetEnv);
  const source = manifest?.source;
  if (manifest?.mode !== 'full' || !source?.instanceId || !source?.dockerProjectName || !source?.buildReleaseId
    || source.instanceId !== sourceConfig.instanceId || source.dockerProjectName !== sourceConfig.dockerProjectName
    || source.runtimeDir !== sourceConfig.runtimeDir || source.dbDataDir !== sourceConfig.dbDataDir
    || source.uploadsRoot !== sourceConfig.uploadsDir || source.backupsDir !== sourceConfig.backupsDir
    || source.buildReleaseId !== sourceConfig.buildReleaseId
    || sourceEnv.COMPOSE_PROJECT_NAME !== source.dockerProjectName
    || sourceEnv.POSTGRES_DB !== source.database?.name) {
    throw new Error('Identity источника backup не совпадает с защищённым manifest/config/env.');
  }
  if (!config.restoreTargetPending || !config.instanceId || !config.buildReleaseId
    || config.instanceId === source.instanceId || config.dockerProjectName === source.dockerProjectName
    || config.buildReleaseId !== source.buildReleaseId || targetEnv.COMPOSE_PROJECT_NAME !== config.dockerProjectName
    || targetEnv.POSTGRES_DB !== source.database.name
    || config.backendPort === source.backendPort || config.frontendPort === source.frontendPort
    || config.publicFrontendUrl === sourceConfig.publicFrontendUrl || config.publicApiUrl === sourceConfig.publicApiUrl) {
    throw new Error('Цель не является новой независимой установкой совместимого release.');
  }
  assertNoOverlap([
    ...[['source runtime', source.runtimeDir], ['source DB', source.dbDataDir], ['source uploads', source.uploadsRoot],
      ['source backups', source.backupsDir], ['source errors', source.errorReportsExportRoot], ['source logs', source.logsDir]],
    ...[['target runtime', config.runtimeDir], ['target DB', config.dbDataDir], ['target uploads', config.uploadsDir],
      ['target backups', config.backupsDir], ['target errors', config.errorReportsExportPath], ['target logs', config.logsDir]],
  ]);
  const allPaths = [source.runtimeDir, source.dbDataDir, source.uploadsRoot, source.backupsDir,
    source.errorReportsExportRoot, source.logsDir, config.runtimeDir, config.dbDataDir,
    config.uploadsDir, config.backupsDir, config.errorReportsExportPath, config.logsDir];
  assertNoOverlap(allPaths.map((value, index) => [
    `canonical path ${index}`, fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value),
  ]));
}

async function streamRestoreDump(dumpPath, user, database) {
  const child = spawnDocker([...composeBaseArgs(), 'exec', '-T', 'db', 'pg_restore', '--no-owner', '--no-privileges',
    '-U', user, '-d', database], { stdio: ['pipe', 'pipe', 'pipe'] });
  const input = fs.createReadStream(dumpPath);
  return new Promise((resolve, reject) => {
    let failed = false;
    input.on('error', (error) => { failed = true; child.kill(); reject(error); });
    child.on('error', (error) => { failed = true; reject(error); });
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    input.pipe(child.stdin);
    child.on('close', (code) => {
      if (failed) return;
      if (code !== 0) reject(new Error(`pg_restore завершился с кодом ${code}; цель остаётся заблокированной.`));
      else resolve();
    });
  });
}

async function restoreIndependentBackup(backupDir, confirmation, injectedRunner) {
  if (confirmation !== 'ВОССТАНОВИТЬ_В_НОВУЮ_ЦЕЛЬ') throw new Error('Требуется явное подтверждение независимого восстановления.');
  const runner = injectedRunner || { compose: runDockerCompose, command: dockerCommandResult,
    validateDump: assertPgDumpReadable, restoreDump: streamRestoreDump };
  if (['compose', 'command', 'validateDump', 'restoreDump'].some((key) => typeof runner[key] !== 'function')) {
    throw new Error('Тестовый runner должен явно подменить все внешние команды.');
  }
  const config = await readConfig();
  const env = await readEnv();
  assertStoragePaths(config);
  assertOutsideProject(config, ROOT_DIR);
  assertBackupInsideBackupsDir(config, backupDir);
  const validation = await validateBackup(backupDir);
  if (!validation.ok) throw new Error('Backup не прошёл полную проверку до изменения цели.');
  const root = path.resolve(backupDir);
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const sourceConfig = JSON.parse(await fsp.readFile(path.join(root, 'config', 'zavod.config.json'), 'utf8'));
  const sourceEnv = parseEnvFile(await fsp.readFile(path.join(root, 'config', 'production.env'), 'utf8'));
  assertIndependentIdentity(config, manifest, sourceConfig, sourceEnv, env);
  const registrationCode = sourceEnv.REGISTRATION_FACTORY_CODE;
  if (registrationCode && (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(registrationCode)
    || (env.REGISTRATION_FACTORY_CODE && env.REGISTRATION_FACTORY_CODE !== registrationCode))) {
    throw new Error('Защищённая регистрационная настройка источника несовместима с целью.');
  }
  if (inspectDbStorage(config.dbDataDir).state !== 'OWNED') throw new Error('Хранилище БД цели не подготовлено.');
  for (const target of [config.uploadsDir, config.backupsDir, config.logsDir, config.errorReportsExportPath, config.runtimeDir]) {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(target) !== path.resolve(target)) {
      throw new Error('Небезопасный каталог или ссылка в пути цели восстановления.');
    }
  }
  if (fs.readdirSync(config.uploadsDir).length) throw new Error('Каталог uploads цели не пуст.');
  const running = parseComposeContainers(runner.compose(['ps', '--all', '--format', 'json']).stdout, config.dockerProjectName);
  if (running.has('backend') || running.has('frontend')) throw new Error('Приложение цели должно оставаться остановленным.');
  const empty = runner.command([...composeBaseArgs(), 'exec', '-T', 'db', 'psql', '-U', env.POSTGRES_USER,
    '-d', env.POSTGRES_DB, '-At', '-c', "SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','m','v','S')"]);
  if (empty.status !== 0 || String(empty.stdout || '').trim() !== '0') throw new Error('Целевая БД не доказана пустой.');
  const dumpPath = path.join(root, 'database', 'zavod.dump');
  await runner.validateDump(dumpPath);
  await runner.restoreDump(dumpPath, env.POSTGRES_USER, env.POSTGRES_DB);
  await copyDir(path.join(root, 'uploads'), config.uploadsDir);
  for (const sourceFile of await listFilesRecursive(path.join(root, 'uploads'))) {
    const relative = path.relative(path.join(root, 'uploads'), sourceFile);
    if (await sha256(sourceFile) !== await sha256(path.join(config.uploadsDir, relative))) {
      throw new Error('После восстановления не совпали bytes вложений; цель остаётся заблокированной.');
    }
  }
  if (registrationCode) {
    if (!env.REGISTRATION_FACTORY_CODE) {
      const current = await fsp.readFile(ENV_PATH, 'utf8');
      await writeFileWithBackup(ENV_PATH, `${current.trimEnd()}\nREGISTRATION_FACTORY_CODE=${registrationCode}\n`);
    }
  }
  await writeFileWithBackup(CONFIG_PATH, `${JSON.stringify({ ...config, restoreTargetPending: false }, null, 2)}\n`);
  return { ok: true, targetInstanceId: config.instanceId, sourceInstanceId: manifest.source.instanceId,
    targetReleaseId: config.buildReleaseId, appStarted: false };
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(file, res) {
  const body = await fsp.readFile(path.join(__dirname, file), 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

async function listBackups() {
  let config;
  try {
    config = await readConfig();
  } catch {
    return [];
  }
  if (!fs.existsSync(config.backupsDir)) return [];
  const entries = await fsp.readdir(config.backupsDir, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(config.backupsDir, entry.name);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
    const stat = await fsp.stat(dir);
    backups.push({ name: entry.name, path: dir, updatedAt: stat.mtime.toISOString() });
  }
  return backups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function startWeb(mode, options = {}) {
  const preferredPort = Number(options.port || (mode === 'restore' ? 5602 : 5601));
  const port = await findFreePort(preferredPort);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/') {
        await serveStatic(mode === 'restore' ? 'restore.html' : 'wizard.html', res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/defaults') {
        jsonResponse(res, 200, { defaults: defaultPaths(), runtimeDir: RUNTIME_DIR, configExists: fs.existsSync(CONFIG_PATH), envExists: fs.existsSync(ENV_PATH) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/environment') {
        jsonResponse(res, 200, dockerInfo());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/environment') {
        const body = await readJsonBody(req);
        jsonResponse(res, 200, dockerInfo(body.dockerExePath));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/validate') {
        jsonResponse(res, 200, await validateConfig(await readJsonBody(req)));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/deploy') {
        jsonResponse(res, 200, await deploy(await readJsonBody(req), { dryRun: false }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/backups') {
        jsonResponse(res, 200, { backups: await listBackups() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/backup-validate') {
        const body = await readJsonBody(req);
        jsonResponse(res, 200, await validateBackup(body.backupPath));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/restore') {
        const body = await readJsonBody(req);
        jsonResponse(res, 200, await restoreBackup(body.backupPath, body.confirmation));
        return;
      }
      jsonResponse(res, 404, { message: 'Не найдено' });
    } catch (error) {
      jsonResponse(res, 500, { ok: false, message: error.message });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Открываю мастер: ${url}`);
  if (!options.noOpen) openBrowser(url);
}

async function findFreePort(preferred) {
  for (let port = preferred; port < preferred + 100; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error('Не удалось найти свободный порт для мастера.');
}

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function printChecks(checks) {
  for (const item of checks) {
    const mark = item.ok ? '[OK]' : '[ОШИБКА]';
    console.log(`${mark} ${item.name}${item.details ? ` — ${item.details}` : ''}`);
  }
}

async function selfTest() {
  const runtime = RUNTIME_DIR;
  const testBase = path.join(runtime, 'self-test-data');
  const input = normalizeConfig({
    serverAddress: '127.0.0.1',
    backendPort: 13000,
    frontendPort: 15173,
    dbDataDir: path.join(testBase, 'db'),
    uploadsDir: path.join(testBase, 'uploads'),
    backupsDir: path.join(testBase, 'backups'),
    errorReportsExportPath: path.join(testBase, 'error-reports-export'),
    logsDir: path.join(testBase, 'logs'),
  });
  const result = await deploy(input, { dryRun: true });
  printChecks(result.checks);
  if (!result.ok) throw new Error('Self-test не прошёл.');
  console.log('Self-test пройден: dry-run установки работает, Docker deploy не запускался.');
}

async function main() {
  const { args, rest } = parseArgs(process.argv.slice(2));
  const command = rest[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }
  if (command === 'wizard') {
    await startWeb('wizard', { noOpen: Boolean(args['no-open']), port: args.port });
    return;
  }
  if (command === 'prepare') {
    const fields = ['server-address', 'backend-port', 'frontend-port', 'db-data-dir', 'uploads-dir', 'backups-dir', 'error-reports-dir', 'logs-dir'];
    for (const field of fields) {
      if (typeof args[field] !== 'string' || !args[field].trim()) throw new Error(`Для prepare требуется --${field} <значение>.`);
    }
    const result = await deploy({
      serverAddress: args['server-address'],
      publicFrontendUrl: args['public-frontend-url'],
      publicApiUrl: args['public-api-url'],
      backendPort: Number(args['backend-port']),
      frontendPort: Number(args['frontend-port']),
      dbDataDir: args['db-data-dir'],
      uploadsDir: args['uploads-dir'],
      backupsDir: args['backups-dir'],
      errorReportsExportPath: args['error-reports-dir'],
      logsDir: args['logs-dir'],
    }, { restoreTarget: args['restore-target'] === true });
    if (!result.ok) {
      printChecks(result.checks);
      throw new Error(result.message);
    }
    console.log(result.message);
    console.log(`BUILD_RELEASE_ID=${result.build.releaseId}`);
    if (result.restoreTargetReady) console.log('RESTORE_TARGET_READY: только пустая БД; приложение не запускалось.');
    if (result.firstAdminRequired) console.log('FIRST_ADMIN_REQUIRED');
    return;
  }
  if (command === 'restore-wizard') {
    await startWeb('restore', { noOpen: Boolean(args['no-open']), port: args.port });
    return;
  }
  if (command === 'start') {
    const result = await startServices();
    if (result.firstAdminRequired) {
      console.log('FIRST_ADMIN_REQUIRED: схема и foundation готовы; выполните явный bootstrap. Приложение не запущено.');
      return;
    }
    console.log(`Backend readiness: ${result.backend.status}`);
    console.log(`Frontend: ${result.frontend.status}`);
    return;
  }
  if (command === 'update') {
    const result = await updateServices(args.backup);
    console.log(result.firstAdminRequired
      ? 'FIRST_ADMIN_REQUIRED: приложение не запущено.'
      : `UPDATE_READY: backend=${result.backend.status}, frontend=${result.frontend.status}`);
    return;
  }
  if (command === 'bootstrap') {
    const result = await bootstrapAdmin(args);
    console.log(result.output);
    console.log(result.started.firstAdminRequired ? 'FIRST_ADMIN_REQUIRED' : 'RUNTIME_READINESS=READY');
    return;
  }
  if (command === 'stop') {
    await stopServices();
    console.log('Контейнеры остановлены.');
    return;
  }
  if (command === 'check') {
    const checks = await checkSystem();
    printChecks(checks);
    if (checks.every((item) => item.ok)) {
      console.log('Итог: Готово.');
    } else {
      console.log('Итог: есть проблемы. Исправьте пункты с ошибками и повторите проверку.');
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'backup') {
    const result = await createBackup();
    console.log(`Backup создан: ${result.backupDir}`);
    console.log(`Uploads files: ${result.uploadsCount}`);
    console.log(`Checksums: ${result.checksumCount}`);
    return;
  }
  if (command === 'backup-validate') {
    const backupPath = args.backup || rest[1];
    if (!backupPath) throw new Error('Укажите --backup <папка backup>.');
    const result = await validateBackup(backupPath);
    printChecks(result.checks);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'restore') {
    const backupPath = args.backup || rest[1];
    const confirmation = args.confirm || '';
    if (!backupPath) throw new Error('Укажите --backup <папка backup>.');
    const result = await restoreBackup(backupPath, confirmation);
    console.log(`Восстановление завершено. Старая uploads-папка сохранена: ${result.uploadsBeforeRestore}`);
    return;
  }
  if (command === 'restore-independent') {
    const backupPath = args.backup || rest[1];
    if (!backupPath) throw new Error('Укажите --backup <папка backup в каталоге новой цели>.');
    const result = await restoreIndependentBackup(backupPath, args.confirm || '');
    console.log(`INDEPENDENT_RESTORE_READY: target=${result.targetInstanceId}, release=${result.targetReleaseId}; приложение не запускалось.`);
    return;
  }
  if (command === 'self-test') {
    await selfTest();
    return;
  }
  throw new Error(`Неизвестная команда: ${command}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Ошибка: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  normalizeConfig, makeEnv, parseComposeContainers, createBackup, validateBackup,
  assertIndependentIdentity, assertEffectiveRuntime, assertStartAllowed, restoreIndependentBackup,
  updateServices, candidateReleaseId, releaseIdForStaged, schemaFingerprint,
};
