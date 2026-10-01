const h = require('./own-runtime.cjs'), { fs, path, sha, assert, root, receipt } = h;
const { spawnSync } = require('node:child_process'), before = require('./before.json');
const expected = ['frontend/src/screens/AdminConfigScreen.tsx', 'frontend/src/screens/ChecklistsScreen.tsx'];
const baselineFiles = [...before.files];
// Checklist was discovered by the addendum after the initial 41-owner inventory.
// Its pre-fix snapshot was retained before either checklist edit.
assert(!baselineFiles.some(x => x.path === expected[1]));
baselineFiles.push({ path: expected[1], sha256: sha(fs.readFileSync(path.join(__dirname, 'before', expected[1]))) });
const current = baselineFiles.map(x => ({ path: x.path, before: x.sha256, after: sha(fs.readFileSync(path.join(root, x.path))) }));
assert.deepEqual(current.filter(x => x.before !== x.after).map(x => x.path).sort(), [...expected].sort());
assert.equal(sha(fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'))), before.schema);
for (const m of before.migrations) assert.equal(sha(fs.readFileSync(path.join(root, 'backend/prisma/migrations', m.name, 'migration.sql'))), m.sha256);
const artifacts = before.artifacts.map(x => { const b = fs.readFileSync(path.join(__dirname, '..', x.path)); assert.equal(b.length, x.bytes); assert.equal(sha(b), x.sha256); return { ...x, unchanged: true }; });
const deltas = [];
for (const file of expected) {
  const previous = path.join(__dirname, 'before', file);
  const diff = spawnSync('git', ['diff', '--no-index', '--', previous, path.join(root, file)], { encoding: 'utf8', windowsHide: true });
  assert.equal(diff.status, 1); deltas.push(diff.stdout);
}
const patch = deltas.join('\n'), added = patch.split(/\r?\n/).filter(x => x.startsWith('+') && !x.startsWith('+++')).join('\n');
const checks = {
  browserDialogsIntroduced: /\b(?:window\.)?(?:prompt|alert|confirm)\s*\(/.test(added),
  secretOrStorageOutputIntroduced: /(?:passwordHash|storagePath|JWT_SECRET|DATABASE_URL|console\.log)/.test(added),
  replacementUnicodeIntroduced: added.includes('\uFFFD'),
  testAuthBypassIntroduced: /ALLOW_TEST_AUTH_HEADERS|x-test-user|DEV_MODE/.test(added),
  visibleEnglishPlaceholderIntroduced: /(?:placeholder|aria-label)\s*=\s*["'][A-Za-z]/.test(added),
};
assert(Object.values(checks).every(x => !x));
fs.writeFileSync(path.join(__dirname, 'product-diff.patch'), patch);
const build = require('./build-2026-09-26T21-02-25-065Z.json');
for (const a of build.assets) assert.equal(sha(fs.readFileSync(path.join(root, 'frontend/dist/assets', a.name))), a.sha256);
const tests = ['frontend/scripts/factory01-admin-profile.test.cjs', 'frontend/scripts/factory01-checklist-info.test.cjs', 'frontend/scripts/factory01-checklist-upload.test.cjs'].map(file => ({ path: file, sha256: sha(fs.readFileSync(path.join(root, file))) }));
const ev = { status: 'PASS_SCOPED_SOURCE_IDENTITY_SCANS_PRIOR_ARTIFACTS_57', atUtc: new Date().toISOString(), baseline: before.priorIdentity,
  productFixes: 3, changedProductFiles: expected, files: current, tests, migrations: before.migrations, artifacts,
  scans: checks, scanBoundary: 'added lines in two exact FACTORY01 source deltas, not a new whole-repository audit',
  frontendAssets: build.assets, identity: sha(Buffer.from(current.map(x => `${x.path}:${x.after}`).sort().join('\n'))) };
receipt('final-source-checks', ev); console.log(JSON.stringify({ status: ev.status, identity: ev.identity, changedProductFiles: expected, scans: checks }));
