const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const outputDir = 'C:\\Users\\79164\\Documents\\ZavodBackups';
const ok = [];
const failures = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function backupDirs() {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('zavod-backup-'))
    .map((entry) => entry.name)
    .sort();
}

function run(args) {
  return spawnSync(process.execPath, ['scripts/stage68-backup-create.js', ...args], {
    cwd: backendDir,
    encoding: 'utf8',
    env: process.env,
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function hasForbiddenLeak(text) {
  return /DATABASE_URL\s*=|postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@|JWT_SECRET\s*=|passwordHash\s*[:=]|refreshToken\s*[:=]|accessToken\s*[:=]|storagePath\s*[:=]/i.test(text || '');
}

async function main() {
  const missingOutput = run([]);
  record('output directory is required', missingOutput.status !== 0 && /--output|папк/i.test(missingOutput.stderr || missingOutput.stdout), missingOutput.stderr || missingOutput.stdout);

  const before = backupDirs();
  const dryRun = run(['--output', outputDir]);
  const after = backupDirs();
  const data = parseJson(dryRun.stdout);
  const combinedText = `${dryRun.stdout}\n${dryRun.stderr}`;

  record('dry-run exits successfully', dryRun.status === 0 && data?.ok === true, dryRun.stderr || dryRun.stdout.slice(0, 1000));
  record('default mode is dry-run and does not create full backup', data?.created === false && data?.mode === 'dry-run' && data?.manifest?.backupMode === 'dry-run', data?.mode);
  record('dry-run does not create backup folder', JSON.stringify(before) === JSON.stringify(after), { before, after });
  record('dry-run does not create DB dump path', !combinedText.includes('database/zavod.dump') && !combinedText.includes('database\\\\zavod.dump'), null);
  record('dry-run does not copy uploads into output', !after.some((name) => !before.includes(name)), { before, after });
  record('dry-run reports safe DB identity without credentials', Boolean(data?.manifest?.database?.host) && Boolean(data?.manifest?.database?.databaseName) && !combinedText.includes('@localhost'), data?.manifest?.database);
  record('manifest preview has sensitive artifact warning', /sensitive operational artifact/i.test(data?.manifest?.fullBackupSensitiveWarning ?? ''), data?.manifest?.fullBackupSensitiveWarning);
  record('manifest/log has no obvious credentials or forbidden fields', !hasForbiddenLeak(combinedText), combinedText.match(/DATABASE_URL|passwordHash|storagePath|JWT_SECRET|accessToken|refreshToken/i)?.[0]);
  record('create requires explicit flag', data?.mode === 'dry-run' && data?.created === false, data?.message);
  record('pg_dump availability is reported', typeof data?.manifest?.pgDump?.available === 'boolean', data?.manifest?.pgDump);

  console.log(`\nStage68 backup dry-run regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
