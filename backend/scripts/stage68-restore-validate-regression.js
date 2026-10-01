const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const realBackup = 'C:\\Users\\79164\\Documents\\ZavodBackups\\zavod-backup-20260614-113426Z';
const ok = [];
const failures = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function run(args) {
  return spawnSync(process.execPath, ['scripts/stage68-restore-validate.js', ...args], {
    cwd: backendDir,
    encoding: 'utf8',
    env: process.env,
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function hasForbiddenLeak(text) {
  return /postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@|JWT_SECRET\s*=|passwordHash\s*[:=]|refreshToken\s*[:=]|accessToken\s*[:=]|storagePath\s*[:=]|tokenSecret/i.test(text || '');
}

function envValue(text, name) {
  const line = text.split(/\r?\n/).find((item) => new RegExp(`^\\s*${name}\\s*=`).test(item));
  if (!line) return null;
  return line
    .replace(new RegExp(`^\\s*${name}\\s*=\\s*`), '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1');
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(await fsp.readFile(file));
  return hash.digest('hex');
}

async function makeTinyBackup(mutator) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zavod-restore-validate-'));
  await fsp.mkdir(path.join(dir, 'database'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'uploads'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'database', 'zavod.dump'), 'tiny dump fixture');
  await fsp.writeFile(path.join(dir, 'uploads', 'file.txt'), 'tiny upload fixture');
  const manifest = {
    schemaVersion: 'zavod-backup-v1',
    backupMode: 'full',
    createdAt: '2026-06-14T00:00:00.000Z',
    projectName: 'Завод',
    database: { provider: 'postgresql', host: 'localhost', port: '5432', databaseName: 'mes_restore_test', schema: 'public' },
    pgDump: { available: true, version: 'pg_dump (PostgreSQL) 18.3' },
    uploads: { canonicalRoot: 'C:\\safe\\uploads' },
    fullBackupSensitiveWarning: 'Full backup is sensitive.',
    envFileIncluded: false,
  };
  if (mutator) await mutator({ dir, manifest });
  await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const entries = ['manifest.json', 'database/zavod.dump', 'uploads/file.txt'];
  const lines = [];
  for (const relative of entries) {
    const full = path.join(dir, relative);
    if (fs.existsSync(full)) lines.push(`${await sha256(full)}  ${relative.replace(/\\/g, '/')}`);
  }
  await fsp.writeFile(path.join(dir, 'checksums.sha256'), `${lines.join('\n')}\n`);
  return dir;
}

function snapshotBackup() {
  if (!fs.existsSync(realBackup)) return null;
  const manifest = path.join(realBackup, 'manifest.json');
  const checksums = path.join(realBackup, 'checksums.sha256');
  return {
    manifestMtime: fs.statSync(manifest).mtimeMs,
    checksumsMtime: fs.statSync(checksums).mtimeMs,
    topLevel: fs.readdirSync(realBackup).sort(),
  };
}

async function main() {
  const missingArg = run([]);
  record('missing backup argument fails safely', missingArg.status !== 0 && /--backup|Укажите папку backup/i.test(`${missingArg.stdout}\n${missingArg.stderr}`), `${missingArg.stdout}\n${missingArg.stderr}`);

  const before = snapshotBackup();
  const valid = run(['--backup', realBackup]);
  const after = snapshotBackup();
  const validData = parseJson(valid.stdout);
  record('validate existing backup passes', valid.status === 0 && validData?.ok === true && validData?.restoreExecuted === false && validData?.pgRestoreExecuted === false, valid.stdout || valid.stderr);
  record('existing backup is not changed by validate', JSON.stringify(before) === JSON.stringify(after), { before, after });

  const missingPath = run(['--backup', path.join(os.tmpdir(), 'zavod-missing-backup-path')]);
  record('missing backup path fails safely', missingPath.status !== 0 && /Backup folder не найден/i.test(`${missingPath.stdout}\n${missingPath.stderr}`), missingPath.stdout || missingPath.stderr);

  const noManifest = await makeTinyBackup(async ({ dir }) => {
    await fsp.writeFile(path.join(dir, 'manifest.json'), '');
  });
  await fsp.unlink(path.join(noManifest, 'manifest.json'));
  const noManifestRun = run(['--backup', noManifest]);
  record('missing manifest fails safely', noManifestRun.status !== 0 && /manifest\.json не найден/i.test(noManifestRun.stdout), noManifestRun.stdout);

  const invalidSchema = await makeTinyBackup(async ({ manifest }) => {
    manifest.schemaVersion = 'invalid-schema';
  });
  const invalidSchemaRun = run(['--backup', invalidSchema]);
  record('invalid schemaVersion fails safely', invalidSchemaRun.status !== 0 && /schemaVersion/i.test(invalidSchemaRun.stdout), invalidSchemaRun.stdout);

  const checksumMismatch = await makeTinyBackup();
  await fsp.appendFile(path.join(checksumMismatch, 'uploads', 'file.txt'), ' changed');
  const checksumRun = run(['--backup', checksumMismatch]);
  record('checksum mismatch fails safely', checksumRun.status !== 0 && /Checksum не совпал/i.test(checksumRun.stdout), checksumRun.stdout);

  const envText = fs.readFileSync(path.join(backendDir, '.env'), 'utf8');
  const currentDb = envValue(envText, 'DATABASE_URL');
  const currentUploads = envValue(envText, 'FILE_STORAGE_ROOT');

  const targetCurrentDb = run(['--backup', realBackup, '--target-database-url', currentDb]);
  record('target current DATABASE_URL is refused', targetCurrentDb.status !== 0 && /Restore поверх текущей БД запрещён/i.test(targetCurrentDb.stdout) && !hasForbiddenLeak(`${targetCurrentDb.stdout}\n${targetCurrentDb.stderr}`), targetCurrentDb.stdout || targetCurrentDb.stderr);

  const targetCurrentUploads = run(['--backup', realBackup, '--target-uploads-root', currentUploads]);
  record('target current FILE_STORAGE_ROOT is refused', targetCurrentUploads.status !== 0 && /Restore поверх текущих uploads запрещён/i.test(targetCurrentUploads.stdout) && !hasForbiddenLeak(`${targetCurrentUploads.stdout}\n${targetCurrentUploads.stderr}`), targetCurrentUploads.stdout || targetCurrentUploads.stderr);

  const safeTarget = run([
    '--backup', realBackup,
    '--target-database-url', 'postgresql://restore_user:restore_password@localhost:5432/mes_restore_stage68?schema=public',
    '--target-uploads-root', path.join(os.tmpdir(), 'zavod-restore-target-uploads-not-created'),
  ]);
  const safeText = `${safeTarget.stdout}\n${safeTarget.stderr}`;
  record('safe target validates without leaking credentials', safeTarget.status === 0 && !hasForbiddenLeak(safeText) && !safeText.includes('restore_password'), safeText);
  record('restore validate does not create target uploads', !fs.existsSync(path.join(os.tmpdir(), 'zavod-restore-target-uploads-not-created')), null);

  console.log(`\nStage68 restore validate regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
