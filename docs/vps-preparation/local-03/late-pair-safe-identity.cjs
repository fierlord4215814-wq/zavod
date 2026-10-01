const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ownRuntime } = require('../local-02/own-db.cjs');

const runtime = ownRuntime();
const pair = path.join(runtime, 'local03-late-pair');
const receipt = path.join(__dirname, 'late-pair-safe-identity.json');
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'late-pair.json'), 'utf8'));
const integrity = JSON.parse(fs.readFileSync(path.join(__dirname, 'final-integrity.json'), 'utf8'));
assert.equal(snapshot.status, 'PASS_PAIRED_DUMP_UPLOADS_SQL_FILES_RESTORE');
assert.equal(integrity.status, 'PASS_SOURCE_BUILD_HASHES_TARGETED_SCAN');
assert.equal(fs.existsSync(path.join(pair, 'own-c1.dump')), true);
assert.equal(fs.existsSync(path.join(pair, 'uploads')), true);
const secretDir = path.join(pair, 'secrets');
assert.equal(fs.existsSync(secretDir), false, 'Do not replace an existing pair secret copy');
fs.mkdirSync(secretDir);
const safeConfigFiles = ['db-password.txt', 'jwt-secret.txt'];
for (const name of safeConfigFiles) {
  const source = path.join(runtime, 'secrets', name);
  const target = path.join(secretDir, name);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(source), `${name} copy mismatch`);
}
const build = integrity.builds.filter((entry) => entry.path === 'backend/dist/main.js' || /^frontend\/dist\/assets\/index-.*\.(js|css)$/.test(entry.path));
assert.equal(build.some((entry) => entry.path === 'backend/dist/main.js'), true);
const release = {
  releaseVersion: 'LOCAL03-20260924-C1',
  baselineHead: integrity.baselineHead,
  sourceDatabase: snapshot.source,
  restoredDatabase: snapshot.target,
  loopbackPgPort: 15436,
  uploadsDirectory: 'uploads',
  migrationCount: snapshot.migrations.length,
  build: build.map(({ path: relative, bytes, sha256 }) => ({ path: relative, bytes, sha256 })),
  safeConfigFiles,
  secretBytesVerified: true,
};
assert.equal(release.migrationCount, 57);
fs.writeFileSync(path.join(pair, 'release-identity.json'), `${JSON.stringify(release, null, 2)}\n`, { flag: 'wx' });
const manifest = {
  status: 'PASS_PAIRED_SAFE_CONFIG_RELEASE_IDENTITY',
  addendumAfterRestore: true,
  sameCanonicalBuild: true,
  secretValuesOrHashesInReceipt: false,
  ...release,
};
fs.writeFileSync(receipt, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(manifest.status);
