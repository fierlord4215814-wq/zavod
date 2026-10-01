const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');
const canonicalUploadsRoot = path.join(rootDir, 'uploads');
const backendUploadsRoot = path.join(backendDir, 'uploads');
const schemaVersion = 'zavod-backup-v1';
const projectName = 'Завод';

function usage() {
  return [
    'Stage68 backup CLI',
    '',
    'Dry-run по умолчанию:',
    '  node scripts/stage68-backup-create.js --output C:\\Users\\79164\\Documents\\ZavodBackups',
    '',
    'Настоящий backup только с явным флагом:',
    '  node scripts/stage68-backup-create.js --output C:\\Users\\79164\\Documents\\ZavodBackups --create',
    '',
    'Если pg_dump не в PATH:',
    '  node scripts/stage68-backup-create.js --output C:\\Users\\79164\\Documents\\ZavodBackups --pg-dump "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe"',
  ].join('\n');
}

function parseArgs(argv) {
  const result = { create: false, output: null, pgDump: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--create') result.create = true;
    else if (arg === '--output') result.output = argv[++index] ?? null;
    else if (arg.startsWith('--output=')) result.output = arg.slice('--output='.length);
    else if (arg === '--pg-dump') result.pgDump = argv[++index] ?? null;
    else if (arg.startsWith('--pg-dump=')) result.pgDump = arg.slice('--pg-dump='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}\n\n${usage()}`);
    }
  }
  return result;
}

function parseEnv(content) {
  const env = {};
  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function loadDatabaseUrl() {
  if (!fs.existsSync(envPath)) throw new Error('backend/.env не найден. Заполните DATABASE_URL перед backup dry-run.');
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL не найден в backend/.env.');
  process.env.DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
  return env.DATABASE_URL;
}

function safeDbInfo(databaseUrl) {
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

function checkTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port), timeout: timeoutMs });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function checkOutputPath(output) {
  if (!output) throw new Error(`Укажите папку для backup artifacts через --output.\n\n${usage()}`);
  const resolved = path.resolve(output);
  if (isInside(rootDir, resolved)) {
    throw new Error('Папка backup должна быть вне проекта, чтобы backup artifacts не попали в рабочий репозиторий.');
  }
  return resolved;
}

function checkPgDump(explicitPath) {
  const candidates = explicitPath ? [explicitPath] : ['pg_dump'];
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
    message: 'pg_dump недоступен. Добавьте PostgreSQL bin в PATH или укажите путь через --pg-dump.',
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

async function uploadsStats() {
  const files = await listFilesRecursive(canonicalUploadsRoot);
  let totalSizeBytes = 0;
  for (const file of files) totalSizeBytes += (await fsp.stat(file)).size;
  const alternateWarnings = [];
  const backendFiles = await listFilesRecursive(backendUploadsRoot);
  if (backendFiles.length > 0) {
    alternateWarnings.push(`Найдены файлы в backend/uploads (${backendFiles.length}). Canonical root для Stage68: ${canonicalUploadsRoot}.`);
  }
  return { files, fileCount: files.length, totalSizeBytes, alternateWarnings };
}

async function attachmentStorageStats(prisma, uploadFiles) {
  const attachments = await prisma.attachment.findMany({
    where: { deletedAt: null },
    select: { id: true, storagePath: true },
  });
  const existingRelative = new Set(
    uploadFiles.map((file) => path.relative(canonicalUploadsRoot, file).replace(/\\/g, '/')),
  );
  let found = 0;
  let missing = 0;
  const expected = new Set();
  for (const attachment of attachments) {
    const relative = String(attachment.storagePath ?? '').replace(/\\/g, '/');
    expected.add(relative);
    const absolute = path.resolve(canonicalUploadsRoot, relative);
    if (!absolute.startsWith(path.resolve(canonicalUploadsRoot))) missing += 1;
    else if (fs.existsSync(absolute)) found += 1;
    else missing += 1;
  }
  let orphanFiles = 0;
  for (const relative of existingRelative) {
    if (!expected.has(relative)) orphanFiles += 1;
  }
  return {
    expectedFromDatabase: attachments.length,
    foundOnDisk: found,
    missingOnDisk: missing,
    orphanFiles,
  };
}

async function tableCounts(prisma) {
  const models = {
    factories: prisma.factory,
    users: prisma.user,
    userFactoryAccess: prisma.userFactoryAccess,
    departments: prisma.department,
    lines: prisma.line,
    linePositions: prisma.linePosition,
    staffingTemplates: prisma.lineStaffingTemplate,
    workAreas: prisma.workArea,
    shiftSessions: prisma.shiftSession,
    assignments: prisma.assignment,
    tasks: prisma.task,
    lineEvents: prisma.lineEvent,
    washSessions: prisma.washSession,
    okkRecords: prisma.okkRecord,
    returnRecords: prisma.returnRecord,
    stockDefects: prisma.stockDefect,
    minimumStockItems: prisma.minimumStockItem,
    orderRequests: prisma.orderRequest,
    checklistTemplates: prisma.checklistTemplate,
    checklistRuns: prisma.checklistRun,
    chats: prisma.chat,
    chatMessages: prisma.chatMessage,
    announcements: prisma.announcement,
    shiftLogs: prisma.shiftLog,
    attachments: prisma.attachment,
    auditLogs: prisma.auditLog,
  };
  const entries = {};
  for (const [key, model] of Object.entries(models)) {
    entries[key] = await model.count();
  }
  return entries;
}

async function migrationSnapshot(prisma) {
  const migrationDirs = fs.existsSync(path.join(backendDir, 'prisma', 'migrations'))
    ? fs.readdirSync(path.join(backendDir, 'prisma', 'migrations'), { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort()
    : [];
  try {
    const applied = await prisma.$queryRawUnsafe('SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name ASC');
    const appliedNames = new Set(applied.map((item) => item.migration_name));
    return {
      migrationsInRepo: migrationDirs.length,
      appliedMigrations: applied.length,
      pendingInDatabase: migrationDirs.filter((name) => !appliedNames.has(name)),
    };
  } catch (error) {
    return {
      migrationsInRepo: migrationDirs.length,
      appliedMigrations: null,
      pendingInDatabase: [],
      warning: 'Не удалось прочитать _prisma_migrations read-only запросом.',
    };
  }
}

function packageMetadata() {
  function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }
  const rootPackage = readJson(path.join(rootDir, 'package.json'));
  const backendPackage = readJson(path.join(backendDir, 'package.json'));
  const frontendPackage = readJson(path.join(rootDir, 'frontend', 'package.json'));
  return {
    rootPackage: rootPackage.name || 'mes-system',
    backendVersion: backendPackage.version || null,
    frontendVersion: frontendPackage.version || null,
  };
}

function gitMetadata() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
  if (result.status !== 0) return { commit: null, warning: 'git недоступен в текущем PATH.' };
  return { commit: result.stdout.trim() || null };
}

async function buildManifest({ mode, outputDir, dbInfo, pgDump, prisma, warnings }) {
  const upload = await uploadsStats();
  warnings.push(...upload.alternateWarnings);
  const attachmentFiles = await attachmentStorageStats(prisma, upload.files);
  if (attachmentFiles.missingOnDisk > 0) warnings.push(`В БД есть вложения без файла на диске: ${attachmentFiles.missingOnDisk}.`);
  if (attachmentFiles.orphanFiles > 0) warnings.push(`В uploads есть файлы без активной записи Attachment: ${attachmentFiles.orphanFiles}.`);
  const migrations = await migrationSnapshot(prisma);
  if (migrations.warning) warnings.push(migrations.warning);
  const git = gitMetadata();
  if (git.warning) warnings.push(git.warning);

  return {
    schemaVersion,
    createdAt: new Date().toISOString(),
    projectName,
    package: packageMetadata(),
    appVersion: process.env.APP_VERSION || 'dev',
    gitCommit: git.commit,
    backupMode: mode,
    outputDirectory: outputDir,
    database: {
      provider: dbInfo.provider,
      host: dbInfo.host,
      port: dbInfo.port,
      databaseName: dbInfo.databaseName,
      schema: dbInfo.schema,
    },
    pgDump: {
      available: pgDump.available,
      version: pgDump.version || null,
      message: pgDump.available ? null : pgDump.message,
    },
    migrations,
    uploads: {
      canonicalRoot: canonicalUploadsRoot,
      fileCount: upload.fileCount,
      totalSizeBytes: upload.totalSizeBytes,
      attachmentFiles,
    },
    tableCounts: await tableCounts(prisma),
    checksums: {
      algorithm: 'sha256',
      file: mode === 'full' ? 'checksums.sha256' : null,
      entries: 0,
    },
    envFileIncluded: false,
    fullBackupSensitiveWarning: 'Full backup is a sensitive operational artifact: DB dump may contain password hashes, personal data, messages, audit records and attachments.',
    onlineBackupWarning: mode === 'full'
      ? 'If backend/writes were not stopped before this command, this backup is online best-effort.'
      : 'Dry-run can be executed while backend is running. Full pilot/production backup is recommended with backend/writes stopped.',
    warnings,
  };
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
}

async function copyRecursive(source, target) {
  if (!fs.existsSync(source)) return;
  await fsp.mkdir(target, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyRecursive(from, to);
    else if (entry.isFile()) await fsp.copyFile(from, to);
  }
}

function runPgDump(pgDump, dbInfo, dumpPath) {
  const args = ['-h', dbInfo.host, '-p', dbInfo.port, '-U', dbInfo.username, '-d', dbInfo.databaseName, '-F', 'c', '-f', dumpPath];
  const result = spawnSync(pgDump.command, args, {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: dbInfo.password },
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`pg_dump завершился с ошибкой: ${String(result.stderr || result.stdout || '').trim()}`);
  }
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(await fsp.readFile(file));
  return hash.digest('hex');
}

async function writeChecksums(backupDir) {
  const files = (await listFilesRecursive(backupDir))
    .filter((file) => path.basename(file) !== 'checksums.sha256')
    .sort();
  const lines = [];
  for (const file of files) {
    const relative = path.relative(backupDir, file).replace(/\\/g, '/');
    lines.push(`${await sha256(file)}  ${relative}`);
  }
  await fsp.writeFile(path.join(backupDir, 'checksums.sha256'), `${lines.join('\n')}\n`, 'utf8');
  return lines.length;
}

async function createFullBackup(outputRoot, manifest, pgDump, dbInfo) {
  if (!pgDump.available) throw new Error(pgDump.message);
  const backupDir = path.join(outputRoot, `zavod-backup-${safeTimestamp()}`);
  if (fs.existsSync(backupDir)) throw new Error(`Backup folder already exists: ${backupDir}`);
  await fsp.mkdir(path.join(backupDir, 'database'), { recursive: true });
  runPgDump(pgDump, dbInfo, path.join(backupDir, 'database', 'zavod.dump'));
  await copyRecursive(canonicalUploadsRoot, path.join(backupDir, 'uploads'));
  manifest.backupMode = 'full';
  manifest.outputDirectory = outputRoot;
  manifest.backupDirectory = backupDir;
  await fsp.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  const checksumEntries = await writeChecksums(backupDir);
  manifest.checksums.entries = checksumEntries;
  await fsp.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await writeChecksums(backupDir);
  return backupDir;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = checkOutputPath(args.output);
  const databaseUrl = loadDatabaseUrl();
  const dbInfo = safeDbInfo(databaseUrl);
  const warnings = [];
  const tcpOk = await checkTcp(dbInfo.host, dbInfo.port);
  if (!tcpOk) throw new Error(`PostgreSQL недоступен по TCP: ${dbInfo.host}:${dbInfo.port}.`);
  const pgDump = checkPgDump(args.pgDump);
  if (!pgDump.available) warnings.push(pgDump.message);
  if (args.create && !pgDump.available) throw new Error(pgDump.message);

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const manifest = await buildManifest({
      mode: args.create ? 'full' : 'dry-run',
      outputDir,
      dbInfo,
      pgDump,
      prisma: prisma.db ?? prisma,
      warnings,
    });
    if (!args.create) {
      console.log(JSON.stringify({
        ok: true,
        created: false,
        mode: 'dry-run',
        message: 'Dry-run завершён. DB dump и uploads не создавались и не копировались.',
        manifest,
      }, null, 2));
      return;
    }
    await fsp.mkdir(outputDir, { recursive: true });
    const backupDir = await createFullBackup(outputDir, manifest, pgDump, dbInfo);
    console.log(JSON.stringify({ ok: true, created: true, mode: 'full', backupDir, manifest }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
