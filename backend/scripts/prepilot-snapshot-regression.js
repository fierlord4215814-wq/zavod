const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(rootDir, 'backend', 'scripts', 'prepilot-snapshot.js');
const regressionOutput = path.join(rootDir, '.tmp', 'prepilot-snapshot-regression');

function run(args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args, '--json'], {
    cwd: rootDir,
    encoding: 'utf8',
    shell: false,
  });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.status !== 0) {
    throw new Error(`Команда завершилась с ошибкой ${result.status}: ${args.join(' ')}\n${stderr || stdout}`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`JSON-ответ не читается: ${error.message}\n${stdout}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoSensitiveManifestValues(manifest) {
  const text = JSON.stringify(manifest);
  const markers = [
    'DATABASE_' + 'URL=',
    'password' + 'Hash',
    'JWT_',
    'ACCESS_' + 'TOKEN',
    'REFRESH_' + 'TOKEN',
  ];
  assert(!markers.some((marker) => text.toLowerCase().includes(marker.toLowerCase())) && !/Bearer\s+/i.test(text), 'manifest содержит секретные значения');
  assert(!/"password"\s*:/i.test(text), 'manifest содержит поле password');
  assert(!/"username"\s*:/i.test(text), 'manifest содержит поле username');
}

function main() {
  fs.mkdirSync(regressionOutput, { recursive: true });

  const dryRun = run(['--dry-run', '--output', regressionOutput]);
  assert(dryRun.mode === 'dry-run', 'dry-run вернул неверный режим');
  assert(dryRun.outputRoot === regressionOutput, 'dry-run использует неожиданную папку назначения');
  assert(dryRun.database && dryRun.database.databaseName, 'dry-run не вернул безопасную информацию о БД');
  assert(!dryRun.database.password && !dryRun.database.username, 'dry-run раскрыл credentials БД');
  assert(dryRun.uploads.fileCount >= 0, 'dry-run не посчитал uploads');

  const created = run(['--create', '--output', regressionOutput]);
  assert(created.mode === 'create', 'create вернул неверный режим');
  assert(created.ok === true, 'созданный snapshot не прошёл встроенную проверку');
  assert(created.snapshotDir && fs.existsSync(created.snapshotDir), 'папка snapshot не создана');
  assert(fs.existsSync(path.join(created.snapshotDir, 'manifest.json')), 'manifest.json не создан');
  assert(fs.existsSync(path.join(created.snapshotDir, 'database', 'zavod-prepilot.dump')), 'дамп БД не создан');
  assert(fs.existsSync(path.join(created.snapshotDir, 'config', 'backend.env')), 'backend.env не включён в snapshot');
  assert(created.validation && created.validation.ok === true, 'встроенный validate не успешен');

  const manifest = JSON.parse(fs.readFileSync(path.join(created.snapshotDir, 'manifest.json'), 'utf8'));
  assert(manifest.schemaVersion === 'zavod-prepilot-snapshot-v1', 'schemaVersion некорректный');
  assert(manifest.validation && manifest.validation.restoreExecuted === false, 'manifest должен подтверждать, что restore не выполнялся');
  assertNoSensitiveManifestValues(manifest);

  const validated = run(['--validate', created.snapshotDir]);
  assert(validated.mode === 'validate', 'validate вернул неверный режим');
  assert(validated.ok === true, 'validate созданного snapshot не прошёл');
  assert(validated.checksums.checkedFiles > 0, 'validate не проверил checksums');

  const latest = run(['--validate-latest', '--output', regressionOutput]);
  assert(latest.ok === true, 'validate-latest не прошёл');
  assert(latest.snapshotDir === created.snapshotDir, 'validate-latest выбрал не последний созданный snapshot');

  console.log('Pre-pilot snapshot regression passed');
  console.log(`Snapshot fixture: ${created.snapshotDir}`);
}

try {
  main();
} catch (error) {
  console.error(`Pre-pilot snapshot regression failed: ${error.message}`);
  process.exitCode = 1;
}
