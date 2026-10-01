const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const rootDir = path.resolve(__dirname, '..', '..');
const schemaVersion = 'zavod-backup-v1';

function usage() {
  return [
    'Stage68 backup validate CLI',
    '',
    'Usage:',
    '  node scripts/stage68-backup-validate.js --backup C:\\Users\\79164\\Documents\\ZavodBackups\\zavod-backup-YYYYMMDD-HHMMSSZ',
  ].join('\n');
}

function parseArgs(argv) {
  const result = { backup: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--backup') result.backup = argv[++index] ?? null;
    else if (arg.startsWith('--backup=')) result.backup = arg.slice('--backup='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}\n\n${usage()}`);
    }
  }
  if (!result.backup) throw new Error(`Укажите папку backup через --backup.\n\n${usage()}`);
  return { backup: path.resolve(result.backup) };
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasObviousSecret(value) {
  const text = JSON.stringify(value ?? {});
  return /DATABASE_URL\s*=|postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@|JWT_SECRET\s*=|passwordHash\s*[:=]|refreshToken\s*[:=]|accessToken\s*[:=]|storagePath\s*[:=]/i.test(text);
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
    const match = line.match(/^([a-f0-9]{64})\s+\s*(.+)$/i) || line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!match) {
      errors.push(`Некорректная строка checksum: ${line.slice(0, 80)}`);
      continue;
    }
    const expected = match[1].toLowerCase();
    const relative = match[2].trim();
    const fullPath = path.resolve(backupDir, relative);
    if (!fullPath.startsWith(path.resolve(backupDir))) {
      errors.push(`Checksum указывает за пределы backup: ${relative}`);
      continue;
    }
    if (!fs.existsSync(fullPath)) {
      errors.push(`Файл из checksums не найден: ${relative}`);
      continue;
    }
    const actual = await sha256(fullPath);
    checked += 1;
    if (actual !== expected) errors.push(`Checksum не совпал: ${relative}`);
  }
  return { ok: errors.length === 0, checked, errors };
}

async function main() {
  const { backup } = parseArgs(process.argv.slice(2));
  const errors = [];
  const warnings = [];
  if (isInside(rootDir, backup)) errors.push('Backup path находится внутри проекта. Operational backup должен храниться вне repository root.');
  const manifestPath = path.join(backup, 'manifest.json');
  if (!fs.existsSync(manifestPath)) errors.push('manifest.json не найден.');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      errors.push('manifest.json не удалось прочитать как JSON.');
    }
  }
  if (manifest) {
    if (manifest.schemaVersion !== schemaVersion) errors.push(`Неподдерживаемая schemaVersion: ${manifest.schemaVersion ?? 'не указана'}.`);
    if (hasObviousSecret(manifest)) errors.push('manifest содержит явные secret/runtime поля.');
    if (manifest.backupMode === 'full') {
      if (!fs.existsSync(path.join(backup, 'database', 'zavod.dump'))) errors.push('database/zavod.dump не найден для full backup.');
      if (!fs.existsSync(path.join(backup, 'uploads'))) errors.push('uploads folder не найден для full backup.');
    } else {
      warnings.push('manifest не помечен как full backup; проверка dump/uploads выполнена как advisory.');
    }
  }
  const checksums = await verifyChecksums(backup);
  if (!checksums.ok) errors.push(...checksums.errors);
  console.log(JSON.stringify({
    ok: errors.length === 0,
    backup,
    manifest: manifest ? {
      schemaVersion: manifest.schemaVersion,
      backupMode: manifest.backupMode,
      createdAt: manifest.createdAt,
      projectName: manifest.projectName,
    } : null,
    checksums: { ok: checksums.ok, checked: checksums.checked },
    warnings,
    errors,
  }, null, 2));
  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
