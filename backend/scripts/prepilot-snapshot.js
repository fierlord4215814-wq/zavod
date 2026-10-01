const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');
const envPath = path.join(backendDir, '.env');
const defaultOutputRoot = path.join(rootDir, 'backups', 'pre-pilot');
const schemaVersion = 'zavod-prepilot-snapshot-v1';

function usage() {
  return [
    'Снимок перед пилотом Завод',
    '',
    'Dry-run без записи:',
    '  node backend/scripts/prepilot-snapshot.js --dry-run',
    '',
    'Создать снимок:',
    '  node backend/scripts/prepilot-snapshot.js --create',
    '',
    'Проверить конкретный снимок:',
    '  node backend/scripts/prepilot-snapshot.js --validate "backups/pre-pilot/2026-06-29_12-00-00"',
    '',
    'Проверить последний снимок:',
    '  node backend/scripts/prepilot-snapshot.js --validate-latest',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    create: false,
    dryRun: true,
    json: false,
    output: defaultOutputRoot,
    pgDump: null,
    validate: null,
    validateLatest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--create') {
      args.create = true;
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.create = false;
      args.dryRun = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--output') {
      args.output = argv[++index] || null;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg === '--pg-dump') {
      args.pgDump = argv[++index] || null;
    } else if (arg.startsWith('--pg-dump=')) {
      args.pgDump = arg.slice('--pg-dump='.length);
    } else if (arg === '--validate') {
      args.validate = argv[++index] || null;
      args.dryRun = false;
    } else if (arg.startsWith('--validate=')) {
      args.validate = arg.slice('--validate='.length);
      args.dryRun = false;
    } else if (arg === '--validate-latest') {
      args.validateLatest = true;
      args.dryRun = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}\n\n${usage()}`);
    }
  }

  if (!args.output) throw new Error(`Не указана папка назначения.\n\n${usage()}`);
  if (args.create && (args.validate || args.validateLatest)) {
    throw new Error('Нельзя одновременно создавать и проверять снимок.');
  }
  return args;
}

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function readRuntimeEnv() {
  const env = parseEnvFile(envPath);
  if (!env.DATABASE_URL) throw new Error('В backend/.env не найден DATABASE_URL.');
  process.env.DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
  return env;
}

function safeDatabaseInfo(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL должен указывать на PostgreSQL.');
  }
  return {
    provider: 'postgresql',
    host: parsed.hostname,
    port: parsed.port || '5432',
    databaseName: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    schema: parsed.searchParams.get('schema') || 'public',
    username: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
  };
}

function publicDatabaseInfo(info) {
  return {
    provider: info.provider,
    host: info.host,
    port: info.port,
    databaseName: info.databaseName,
    schema: info.schema,
  };
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    '-',
    pad(date.getMinutes()),
    '-',
    pad(date.getSeconds()),
  ].join('');
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveOutputRoot(output) {
  const resolved = path.resolve(rootDir, output);
  if (!isInside(rootDir, resolved)) {
    throw new Error('Pre-pilot snapshot должен сохраняться внутри проекта в backups/pre-pilot.');
  }
  return resolved;
}

function locatePgDump(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);
  candidates.push(
    'pg_dump',
    'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
  );

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', shell: false });
    if (result.status === 0) {
      return {
        available: true,
        command: candidate,
        version: String(result.stdout || result.stderr || '').trim(),
      };
    }
  }

  return {
    available: false,
    command: explicitPath || 'pg_dump',
    version: null,
    warning: 'pg_dump не найден. Снимок БД создать нельзя, пока не установлен PostgreSQL client tools.',
  };
}

async function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];

  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) result.push(fullPath);
    }
  }

  await walk(dir);
  return result;
}

async function directoryStats(dir) {
  const files = await listFilesRecursive(dir);
  let totalSizeBytes = 0;
  for (const file of files) totalSizeBytes += (await fsp.stat(file)).size;
  return { fileCount: files.length, totalSizeBytes, files };
}

async function copyRecursive(sourceDir, targetDir) {
  const sourceFiles = await listFilesRecursive(sourceDir);
  let copiedFiles = 0;
  let copiedBytes = 0;

  for (const sourceFile of sourceFiles) {
    const relative = path.relative(sourceDir, sourceFile);
    const targetFile = path.join(targetDir, relative);
    await fsp.mkdir(path.dirname(targetFile), { recursive: true });
    await fsp.copyFile(sourceFile, targetFile);
    const size = (await fsp.stat(sourceFile)).size;
    copiedFiles += 1;
    copiedBytes += size;
  }

  return { copiedFiles, copiedBytes };
}

async function copyIfExists(sourceFile, targetFile) {
  if (!fs.existsSync(sourceFile)) return false;
  await fsp.mkdir(path.dirname(targetFile), { recursive: true });
  await fsp.copyFile(sourceFile, targetFile);
  return true;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function writeChecksums(snapshotDir) {
  const files = (await listFilesRecursive(snapshotDir))
    .filter((file) => path.basename(file) !== 'checksums.sha256')
    .sort((a, b) => a.localeCompare(b));
  const lines = [];
  for (const file of files) {
    const relative = path.relative(snapshotDir, file).replace(/\\/g, '/');
    lines.push(`${await sha256File(file)}  ${relative}`);
  }
  await fsp.writeFile(path.join(snapshotDir, 'checksums.sha256'), `${lines.join('\n')}\n`, 'utf8');
  return { fileCount: lines.length };
}

async function verifyChecksums(snapshotDir) {
  const checksumPath = path.join(snapshotDir, 'checksums.sha256');
  if (!fs.existsSync(checksumPath)) throw new Error('checksums.sha256 не найден.');
  const lines = fs.readFileSync(checksumPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const errors = [];

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s\s(.+)$/);
    if (!match) {
      errors.push(`Некорректная строка checksum: ${line}`);
      continue;
    }
    const expected = match[1];
    const relative = match[2];
    const filePath = path.join(snapshotDir, relative);
    if (!fs.existsSync(filePath)) {
      errors.push(`Файл из checksums отсутствует: ${relative}`);
      continue;
    }
    const actual = await sha256File(filePath);
    if (actual !== expected) errors.push(`Checksum не совпал: ${relative}`);
  }

  return { checkedFiles: lines.length, errors };
}

function manifestHasSensitiveValues(manifest) {
  const text = JSON.stringify(manifest);
  const markers = [
    'DATABASE_' + 'URL=',
    'password' + 'Hash',
    'JWT_',
    'ACCESS_' + 'TOKEN',
    'REFRESH_' + 'TOKEN',
  ];
  return markers.some((marker) => text.toLowerCase().includes(marker.toLowerCase())) || /Bearer\s+/i.test(text);
}

function readPackageVersion(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { name: pkg.name || null, version: pkg.version || null };
  } catch {
    return null;
  }
}

function readGitHead() {
  const headPath = path.join(rootDir, '.git', 'HEAD');
  if (!fs.existsSync(headPath)) return null;
  const head = fs.readFileSync(headPath, 'utf8').trim();
  if (!head.startsWith('ref:')) return head || null;
  const ref = head.slice('ref:'.length).trim();
  const refPath = path.join(rootDir, '.git', ref);
  if (!fs.existsSync(refPath)) return { ref };
  return { ref, commit: fs.readFileSync(refPath, 'utf8').trim() };
}

function dumpDatabase(pgDump, dbInfo, outputFile) {
  if (!pgDump.available) throw new Error(pgDump.warning);
  const args = [
    '--host',
    dbInfo.host,
    '--port',
    dbInfo.port,
    '--username',
    dbInfo.username,
    '--dbname',
    dbInfo.databaseName,
    '--schema',
    dbInfo.schema,
    '--format=custom',
    '--no-owner',
    '--file',
    outputFile,
  ];
  const env = { ...process.env, PGPASSWORD: dbInfo.password };
  const result = spawnSync(pgDump.command, args, { encoding: 'utf8', shell: false, env });
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || '').trim();
    throw new Error(`pg_dump завершился с ошибкой. ${message}`);
  }
}

function printHuman(result) {
  if (result.mode === 'validate') {
    console.log(`Проверка снимка: ${result.snapshotDir}`);
    console.log(`Статус: ${result.ok ? 'успешно' : 'ошибка'}`);
    console.log(`Проверено файлов: ${result.checksums.checkedFiles}`);
    if (result.errors.length) {
      console.log('Ошибки:');
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  console.log(result.mode === 'create' ? 'Снимок перед пилотом создан.' : 'Dry-run снимка перед пилотом.');
  console.log(`Папка назначения: ${result.outputRoot}`);
  if (result.snapshotDir) console.log(`Снимок: ${result.snapshotDir}`);
  console.log(`БД: ${result.database.host}:${result.database.port}/${result.database.databaseName}`);
  console.log(`pg_dump: ${result.pgDump.available ? result.pgDump.version : 'не найден'}`);
  console.log(`Uploads: ${result.uploads.fileCount} файлов, ${result.uploads.totalSizeBytes} байт`);
  console.log(`Config: backend/.env ${result.config.backendEnv ? 'будет включён' : 'не найден'}`);
  if (result.mode === 'create') {
    console.log(`Дамп БД: ${result.databaseDumpSizeBytes} байт`);
    console.log(`Скопировано uploads: ${result.uploadsCopied.copiedFiles} файлов`);
    console.log(`Проверка: ${result.validation.ok ? 'успешно' : 'ошибка'}`);
  }
  if (result.warnings.length) {
    console.log('Предупреждения:');
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }
}

async function dryRun(args) {
  const env = readRuntimeEnv();
  const dbInfo = safeDatabaseInfo(env.DATABASE_URL);
  const uploadsRoot = path.resolve(env.FILE_STORAGE_ROOT || path.join(rootDir, 'uploads'));
  const uploads = await directoryStats(uploadsRoot);
  const pgDump = locatePgDump(args.pgDump);
  const outputRoot = resolveOutputRoot(args.output);
  const warnings = [
    'Snapshot содержит дамп БД и копию backend/.env. Это секретный локальный артефакт, его нельзя отправлять в чат или коммитить.',
  ];
  if (!pgDump.available) warnings.push(pgDump.warning);

  return {
    mode: 'dry-run',
    ok: pgDump.available,
    outputRoot,
    snapshotDir: null,
    database: publicDatabaseInfo(dbInfo),
    pgDump,
    uploads: {
      root: 'configured FILE_STORAGE_ROOT or project uploads',
      fileCount: uploads.fileCount,
      totalSizeBytes: uploads.totalSizeBytes,
    },
    config: {
      backendEnv: fs.existsSync(envPath),
      rootPackage: fs.existsSync(path.join(rootDir, 'package.json')),
      backendPackage: fs.existsSync(path.join(backendDir, 'package.json')),
      frontendPackage: fs.existsSync(path.join(frontendDir, 'package.json')),
      prismaSchema: fs.existsSync(path.join(backendDir, 'prisma', 'schema.prisma')),
    },
    exclusions: ['node_modules', 'dist/build cache', 'browser cache', 'logs', 'runtime temp files'],
    warnings,
  };
}

async function createSnapshot(args) {
  const plan = await dryRun(args);
  if (!plan.pgDump.available) throw new Error(plan.pgDump.warning);

  const env = readRuntimeEnv();
  const dbInfo = safeDatabaseInfo(env.DATABASE_URL);
  const uploadsRoot = path.resolve(env.FILE_STORAGE_ROOT || path.join(rootDir, 'uploads'));
  const outputRoot = resolveOutputRoot(args.output);
  const snapshotDir = path.join(outputRoot, formatTimestamp());
  if (fs.existsSync(snapshotDir)) throw new Error(`Папка снимка уже существует: ${snapshotDir}`);

  await fsp.mkdir(path.join(snapshotDir, 'database'), { recursive: true });
  await fsp.mkdir(path.join(snapshotDir, 'uploads'), { recursive: true });
  await fsp.mkdir(path.join(snapshotDir, 'config'), { recursive: true });

  const dumpFile = path.join(snapshotDir, 'database', 'zavod-prepilot.dump');
  dumpDatabase(plan.pgDump, dbInfo, dumpFile);
  const uploadsCopied = await copyRecursive(uploadsRoot, path.join(snapshotDir, 'uploads'));
  const configFiles = [];
  if (await copyIfExists(envPath, path.join(snapshotDir, 'config', 'backend.env'))) {
    configFiles.push('config/backend.env');
  }
  const metadataCandidates = [
    ['package.json', path.join(rootDir, 'package.json')],
    ['backend-package.json', path.join(backendDir, 'package.json')],
    ['frontend-package.json', path.join(frontendDir, 'package.json')],
    ['prisma-schema.prisma', path.join(backendDir, 'prisma', 'schema.prisma')],
  ];
  for (const [targetName, source] of metadataCandidates) {
    if (await copyIfExists(source, path.join(snapshotDir, 'config', targetName))) {
      configFiles.push(`config/${targetName}`);
    }
  }

  const dumpSize = (await fsp.stat(dumpFile)).size;
  const manifest = {
    schemaVersion,
    project: 'Завод',
    mode: 'pre-pilot-create',
    createdAt: new Date().toISOString(),
    git: readGitHead(),
    packages: {
      root: readPackageVersion(path.join(rootDir, 'package.json')),
      backend: readPackageVersion(path.join(backendDir, 'package.json')),
      frontend: readPackageVersion(path.join(frontendDir, 'package.json')),
    },
    database: {
      ...publicDatabaseInfo(dbInfo),
      dump: 'database/zavod-prepilot.dump',
      dumpSizeBytes: dumpSize,
      pgDumpVersion: plan.pgDump.version,
    },
    uploads: {
      source: 'configured FILE_STORAGE_ROOT or project uploads',
      copiedFiles: uploadsCopied.copiedFiles,
      copiedBytes: uploadsCopied.copiedBytes,
      target: 'uploads/',
    },
    config: {
      includedFiles: configFiles,
      containsSensitiveLocalConfig: true,
    },
    excluded: plan.exclusions,
    validation: {
      restoreExecuted: false,
      note: 'Этот снимок предназначен для безопасной проверки и будущего восстановления только после отдельного явного решения.',
    },
    warnings: plan.warnings,
  };
  if (manifestHasSensitiveValues(manifest)) {
    throw new Error('Manifest содержит секретные значения. Снимок остановлен до записи checksums.');
  }

  await fsp.writeFile(path.join(snapshotDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeChecksums(snapshotDir);
  const validation = await validateSnapshot(snapshotDir);

  return {
    ...plan,
    mode: 'create',
    ok: validation.ok,
    snapshotDir,
    databaseDumpSizeBytes: dumpSize,
    uploadsCopied,
    configFiles,
    validation,
  };
}

async function findLatestSnapshot(outputRoot) {
  const resolved = resolveOutputRoot(outputRoot);
  if (!fs.existsSync(resolved)) throw new Error(`Папка со снимками не найдена: ${resolved}`);
  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(resolved, entry.name))
    .sort((a, b) => b.localeCompare(a));
  if (!dirs.length) throw new Error(`В папке нет снимков: ${resolved}`);
  return dirs[0];
}

async function validateSnapshot(snapshotDir) {
  const resolved = path.resolve(rootDir, snapshotDir);
  const errors = [];
  const manifestPath = path.join(resolved, 'manifest.json');
  const dumpPath = path.join(resolved, 'database', 'zavod-prepilot.dump');
  const uploadsDir = path.join(resolved, 'uploads');
  const configDir = path.join(resolved, 'config');

  if (!fs.existsSync(manifestPath)) errors.push('manifest.json не найден.');
  if (!fs.existsSync(dumpPath)) errors.push('database/zavod-prepilot.dump не найден.');
  if (!fs.existsSync(uploadsDir)) errors.push('uploads/ не найден.');
  if (!fs.existsSync(configDir)) errors.push('config/ не найден.');

  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.schemaVersion !== schemaVersion) errors.push('schemaVersion снимка не соответствует pre-pilot формату.');
      if (manifestHasSensitiveValues(manifest)) errors.push('manifest.json содержит запрещённые секретные значения.');
      if (manifest.validation?.restoreExecuted !== false) errors.push('manifest должен фиксировать, что restore не выполнялся.');
    } catch (error) {
      errors.push(`manifest.json не читается: ${error.message}`);
    }
  }

  let checksums = { checkedFiles: 0, errors: ['checksums не проверялись'] };
  try {
    checksums = await verifyChecksums(resolved);
    errors.push(...checksums.errors);
  } catch (error) {
    errors.push(error.message);
  }

  const uploadsStats = fs.existsSync(uploadsDir) ? await directoryStats(uploadsDir) : { fileCount: 0, totalSizeBytes: 0 };
  const dumpSize = fs.existsSync(dumpPath) ? (await fsp.stat(dumpPath)).size : 0;

  if (dumpSize <= 0) errors.push('Дамп БД пустой.');

  return {
    mode: 'validate',
    ok: errors.length === 0,
    snapshotDir: resolved,
    manifest,
    databaseDumpSizeBytes: dumpSize,
    uploads: {
      fileCount: uploadsStats.fileCount,
      totalSizeBytes: uploadsStats.totalSizeBytes,
    },
    checksums: {
      checkedFiles: checksums.checkedFiles,
    },
    errors,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.validateLatest) {
    result = await validateSnapshot(await findLatestSnapshot(args.output));
  } else if (args.validate) {
    result = await validateSnapshot(args.validate);
  } else if (args.create) {
    result = await createSnapshot(args);
  } else {
    result = await dryRun(args);
  }

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
});
