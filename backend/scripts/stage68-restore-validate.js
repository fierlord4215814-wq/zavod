const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.resolve(__dirname, '..');
const schemaVersion = 'zavod-backup-v1';

function usage() {
  return [
    'Stage68 restore validate CLI',
    '',
    'Validation only. This script does not run pg_restore, does not create a DB and does not copy uploads.',
    '',
    'Usage:',
    '  node scripts/stage68-restore-validate.js --backup "C:\\Users\\79164\\Documents\\ZavodBackups\\zavod-backup-YYYYMMDD-HHMMSSZ"',
    '  node scripts/stage68-restore-validate.js --backup "..." --target-database-url "postgresql://..." --target-uploads-root "C:\\ZavodRestore\\uploads"',
  ].join('\n');
}

function parseArgs(argv) {
  const result = { backup: null, targetDatabaseUrl: null, targetUploadsRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--backup') result.backup = argv[++index] ?? null;
    else if (arg.startsWith('--backup=')) result.backup = arg.slice('--backup='.length);
    else if (arg === '--target-database-url') result.targetDatabaseUrl = argv[++index] ?? null;
    else if (arg.startsWith('--target-database-url=')) result.targetDatabaseUrl = arg.slice('--target-database-url='.length);
    else if (arg === '--target-uploads-root') result.targetUploadsRoot = argv[++index] ?? null;
    else if (arg.startsWith('--target-uploads-root=')) result.targetUploadsRoot = arg.slice('--target-uploads-root='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}\n\n${usage()}`);
    }
  }
  if (!result.backup) throw new Error(`Укажите папку backup через --backup.\n\n${usage()}`);
  return {
    backup: path.resolve(result.backup),
    targetDatabaseUrl: result.targetDatabaseUrl,
    targetUploadsRoot: result.targetUploadsRoot ? path.resolve(result.targetUploadsRoot) : null,
  };
}

function readEnvFile() {
  const envPath = path.join(backendRoot, '.env');
  const values = {};
  if (!fs.existsSync(envPath)) return values;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    value = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    values[match[1]] = value;
  }
  return values;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasObviousSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  return /DATABASE_URL\s*=|postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@|JWT_SECRET\s*=|passwordHash\s*[:=]|refreshToken\s*[:=]|accessToken\s*[:=]|storagePath\s*[:=]/i.test(text);
}

function parseDatabaseUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return {
      protocol: url.protocol,
      host: url.hostname || null,
      port: url.port || defaultPort(url.protocol),
      databaseName: url.pathname.replace(/^\/+/, '') || null,
      schema: url.searchParams.get('schema') || null,
    };
  } catch {
    return null;
  }
}

function defaultPort(protocol) {
  return protocol === 'postgresql:' || protocol === 'postgres:' ? '5432' : '';
}

function sameDatabase(left, right) {
  if (!left || !right) return false;
  return (left.protocol || '').toLowerCase() === (right.protocol || '').toLowerCase()
    && (left.host || '').toLowerCase() === (right.host || '').toLowerCase()
    && String(left.port || '') === String(right.port || '')
    && (left.databaseName || '') === (right.databaseName || '')
    && (left.schema || '') === (right.schema || '');
}

function safeDatabaseSummary(parsed) {
  if (!parsed) return null;
  return {
    provider: parsed.protocol?.replace(':', '') || null,
    host: parsed.host,
    port: parsed.port,
    databaseName: parsed.databaseName,
    schema: parsed.schema,
  };
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(await fsp.readFile(file));
  return hash.digest('hex');
}

async function verifyChecksums(backupDir) {
  const checksumPath = path.join(backupDir, 'checksums.sha256');
  if (!fs.existsSync(checksumPath)) return { ok: false, checked: 0, errors: ['checksums.sha256 не найден'] };
  const lines = fs.readFileSync(checksumPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const errors = [];
  let checked = 0;
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+\s*(.+)$/i);
    if (!match) {
      errors.push(`Некорректная строка checksum: ${line.slice(0, 80)}`);
      continue;
    }
    const expected = match[1].toLowerCase();
    const relative = match[2].trim();
    const fullPath = path.resolve(backupDir, relative);
    if (!isInside(backupDir, fullPath)) {
      errors.push(`Checksum указывает за пределы backup: ${relative}`);
      continue;
    }
    if (!fs.existsSync(fullPath)) {
      errors.push(`Файл из checksums не найден: ${relative}`);
      continue;
    }
    checked += 1;
    const actual = await sha256(fullPath);
    if (actual !== expected) errors.push(`Checksum не совпал: ${relative}`);
  }
  return { ok: errors.length === 0, checked, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];
  const warnings = [];
  const env = readEnvFile();

  if (!fs.existsSync(args.backup)) errors.push('Backup folder не найден.');
  if (isInside(projectRoot, args.backup)) errors.push('Backup folder находится внутри project root. Restore validation принимает только external backup.');

  const manifestPath = path.join(args.backup, 'manifest.json');
  let manifest = null;
  if (!fs.existsSync(manifestPath)) {
    errors.push('manifest.json не найден.');
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      errors.push('manifest.json не удалось прочитать как JSON.');
    }
  }

  if (manifest) {
    if (manifest.schemaVersion !== schemaVersion) errors.push(`Неподдерживаемая schemaVersion: ${manifest.schemaVersion ?? 'не указана'}.`);
    if (manifest.backupMode !== 'full') errors.push(`Restore validation ожидает full backup, получено: ${manifest.backupMode ?? 'не указано'}.`);
    if (hasObviousSecret(manifest)) errors.push('manifest содержит явные secret/runtime поля.');
  }

  const dumpPath = path.join(args.backup, 'database', 'zavod.dump');
  const uploadsPath = path.join(args.backup, 'uploads');
  if (!fs.existsSync(dumpPath)) errors.push('database/zavod.dump не найден.');
  if (!fs.existsSync(uploadsPath)) errors.push('uploads folder не найден.');

  const checksums = fs.existsSync(args.backup)
    ? await verifyChecksums(args.backup)
    : { ok: false, checked: 0, errors: ['Backup folder не найден.'] };
  if (!checksums.ok) errors.push(...checksums.errors);

  const currentDatabase = parseDatabaseUrl(process.env.DATABASE_URL || env.DATABASE_URL);
  const targetDatabase = args.targetDatabaseUrl ? parseDatabaseUrl(args.targetDatabaseUrl) : null;
  if (args.targetDatabaseUrl && !targetDatabase) errors.push('Target DATABASE_URL не удалось разобрать.');
  if (targetDatabase && sameDatabase(currentDatabase, targetDatabase)) {
    errors.push('Target DATABASE_URL совпадает с текущей рабочей БД. Restore поверх текущей БД запрещён.');
  }

  const currentUploadsRoot = path.resolve(process.env.FILE_STORAGE_ROOT || env.FILE_STORAGE_ROOT || path.join(process.cwd(), 'uploads'));
  if (args.targetUploadsRoot && path.resolve(args.targetUploadsRoot).toLowerCase() === currentUploadsRoot.toLowerCase()) {
    errors.push('Target uploads root совпадает с текущим FILE_STORAGE_ROOT. Restore поверх текущих uploads запрещён.');
  }

  if (!args.targetDatabaseUrl) warnings.push('Target DATABASE_URL не указан: выполнена validation only без target DB.');
  if (!args.targetUploadsRoot) warnings.push('Target uploads root не указан: выполнена validation only без target uploads.');

  const report = {
    ok: errors.length === 0,
    mode: 'restore-validation-only',
    restoreExecuted: false,
    pgRestoreExecuted: false,
    backup: args.backup,
    manifest: manifest ? {
      schemaVersion: manifest.schemaVersion,
      backupMode: manifest.backupMode,
      createdAt: manifest.createdAt,
      projectName: manifest.projectName,
    } : null,
    files: {
      hasDump: fs.existsSync(dumpPath),
      hasUploads: fs.existsSync(uploadsPath),
    },
    checksums: {
      ok: checksums.ok,
      checked: checksums.checked,
    },
    currentDatabase: safeDatabaseSummary(currentDatabase),
    targetDatabase: safeDatabaseSummary(targetDatabase),
    currentUploadsRoot,
    targetUploadsRoot: args.targetUploadsRoot,
    warnings,
    errors,
    nextSafeStep: 'Restore execution is a separate future block: restore only to a new DB/uploads root after explicit user approval.',
  };

  const text = JSON.stringify(report);
  if (hasObviousSecret(text)) {
    console.error(JSON.stringify({ ok: false, error: 'Restore validation report contains forbidden secret-looking fields.' }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
