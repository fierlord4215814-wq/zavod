const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

require('ts-node/register/transpile-only');
require('reflect-metadata');

const { FileStorageService, resolveFileStorageRoot } = require('../src/modules/attachments/file-storage.service.ts');

const ok = [];
const failures = [];

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

function hasSecret(value) {
  return /DATABASE_URL\s*=|postgres(?:ql)?:\/\/[^<\s"`]+:[^<\s"`]+@|passwordHash\s*[:=]|JWT_SECRET\s*=|refreshToken\s*[:=]|accessToken\s*[:=]|authToken\s*[:=]/i.test(JSON.stringify(value ?? {}));
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'zavod-stage68-uploads-'));
  const explicitRoot = path.join(tempRoot, 'explicit-root');
  const fallbackCwd = path.join(tempRoot, 'fallback-cwd');
  const source = path.join(tempRoot, 'source');
  const target = path.join(tempRoot, 'target');
  await fsp.mkdir(explicitRoot, { recursive: true });
  await fsp.mkdir(path.join(source, 'task'), { recursive: true });
  await fsp.mkdir(path.join(target, 'task'), { recursive: true });
  await fsp.writeFile(path.join(source, 'task', 'copy.txt'), 'copy me');
  await fsp.writeFile(path.join(source, 'task', 'same.txt'), 'same');
  await fsp.writeFile(path.join(target, 'task', 'same.txt'), 'same');
  await fsp.writeFile(path.join(source, 'task', 'conflict.txt'), 'source');
  await fsp.writeFile(path.join(target, 'task', 'conflict.txt'), 'target');

  try {
    record(
      'FILE_STORAGE_ROOT wins over cwd',
      resolveFileStorageRoot(explicitRoot, fallbackCwd) === path.resolve(explicitRoot),
      { explicitRoot, resolved: resolveFileStorageRoot(explicitRoot, fallbackCwd) },
    );
    record(
      'fallback stays cwd uploads for dev compatibility',
      resolveFileStorageRoot('', fallbackCwd) === path.resolve(fallbackCwd, 'uploads'),
      { fallbackCwd, resolved: resolveFileStorageRoot('', fallbackCwd) },
    );

    const oldRoot = process.env.FILE_STORAGE_ROOT;
    process.env.FILE_STORAGE_ROOT = explicitRoot;
    const service = new FileStorageService();
    const saved = await service.saveUploadedFile({
      buffer: Buffer.from('stage68 temp file'),
      originalName: 'photo.png',
      mimeType: 'image/png',
      kind: 'PHOTO',
      entityType: 'TASK',
    });
    record('storagePath remains relative', saved.storagePath === saved.storagePath.replace(/\\/g, '/') && !path.isAbsolute(saved.storagePath), saved);
    let traversalDenied = false;
    try {
      await service.readStorageFile('../outside.txt');
    } catch {
      traversalDenied = true;
    }
    record('path traversal is denied', traversalDenied);
    if (oldRoot === undefined) delete process.env.FILE_STORAGE_ROOT;
    else process.env.FILE_STORAGE_ROOT = oldRoot;

    const dryRun = spawnSync(process.execPath, [
      path.join('scripts', 'stage68-uploads-root-copy-plan.js'),
      '--source', source,
      '--target', target,
      '--skip-db',
    ], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });
    const report = JSON.parse(dryRun.stdout || '{}');
    record('copy-plan dry-run exits successfully', dryRun.status === 0 && report.ok === true && report.mode === 'dry-run', dryRun.stderr || report);
    record('copy-plan dry-run does not copy missing file', !fs.existsSync(path.join(target, 'task', 'copy.txt')), report.summary);
    record('copy-plan reports copyable missing files', report.summary?.copyableMissingInTarget === 1, report.summary);
    record('copy-plan reports already existing same checksum', report.summary?.alreadyExistsSameChecksum === 1, report.summary);
    record('copy-plan reports conflict without overwrite', report.summary?.conflictsDifferentChecksum === 1 && (await fsp.readFile(path.join(target, 'task', 'conflict.txt'), 'utf8')) === 'target', report.summary);
    record('copy-plan report has no secrets', !hasSecret(report), report);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }

  console.log(`\nStage68 uploads root regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
