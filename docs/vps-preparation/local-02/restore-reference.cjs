const { ownRuntime, ownPrisma, verifyOwnDb } = require('./own-db.cjs');
const { sha } = require('./files.cjs');
const fs = require('node:fs'); const path = require('node:path'); const { spawnSync } = require('node:child_process'); const assert = require('node:assert/strict');
const runtime = ownRuntime(); const targetName = 'zavod_local02_restore'; const backup = path.join(runtime, 'local02-reference-restore');
const proof = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-ui.json')));
const secret = fs.readFileSync(path.join(runtime, 'secrets/db-password.txt'), 'utf8').trim();
const env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: '15436', PGUSER: 'local01_owner', PGPASSWORD: secret };
function run(name, args) {
  const r = spawnSync(`C:/Program Files/PostgreSQL/18/bin/${name}.exe`, args, { env, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `${name}: ${(r.stderr || '').replaceAll(secret, '[REDACTED]')}`);
}
async function snapshot(db) {
  return {
    template: await db.checklistTemplate.findUnique({ where: { id: proof.templateId }, select: { id: true, archivedAt: true, rows: { select: { id: true, referenceAttachmentId: true }, orderBy: { id: 'asc' } } } }),
    runs: await db.checklistRun.findMany({ where: { id: { in: proof.runs.map(r => r.id) } }, select: { id: true, status: true, closedAt: true, rows: { select: { id: true, referenceAttachmentId: true, templateRowId: true, status: true }, orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
  };
}
async function main() {
  const source = ownPrisma(); let target;
  try {
    await verifyOwnDb(source); assert.equal(fs.existsSync(backup), false); fs.mkdirSync(backup);
    assert.equal((await source.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datname=$1', targetName)).length, 0);
    const before = await snapshot(source);
    run('pg_dump', ['-Fc', '-f', path.join(backup, 'own-c1.dump'), 'zavod_local01_c0']);
    fs.cpSync(path.join(runtime, 'uploads'), path.join(backup, 'uploads'), { recursive: true });
    await source.$executeRawUnsafe(`CREATE DATABASE "${targetName}" OWNER local01_owner`);
    run('pg_restore', ['--exit-on-error', '--no-owner', '-d', targetName, path.join(backup, 'own-c1.dump')]);
    target = ownPrisma(targetName); await verifyOwnDb(target, targetName);
    assert.deepEqual(await snapshot(target), before);
    const files = [];
    for (const [id, expected] of proof.runs.flatMap(r => [[r.referenceId, r.referenceHash], [r.resultId, r.resultHash]])) {
      const attachment = await target.attachment.findUnique({ where: { id }, select: { storagePath: true, deletedAt: true } }); assert.equal(attachment.deletedAt, null);
      const fileHash = sha(fs.readFileSync(path.join(backup, 'uploads', attachment.storagePath))); assert.equal(fileHash, expected); files.push({ id, sha256: fileHash });
    }
    const migrations = await target.$queryRawUnsafe('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name'); assert.equal(migrations.length, 57);
    const result = { result: 'PASS_WINDOWS_NATIVE_SQL_FILES', target: targetName, dumpSha256: sha(fs.readFileSync(path.join(backup, 'own-c1.dump'))), snapshotSha256: sha(Buffer.from(JSON.stringify(before))), snapshot: before, files, migrations: migrations.length, workingDataChanged: false, deploymentProof: false };
    fs.writeFileSync(path.join(__dirname, 'reference-restore.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await target?.$disconnect(); await source.$disconnect(); }
}
main().catch(e => { console.error(e.message.replaceAll(secret, '[REDACTED]')); process.exitCode = 1; });
