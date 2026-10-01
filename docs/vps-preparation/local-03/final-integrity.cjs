const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'pre-product.json'), 'utf8'));
const byPath = new Map(baseline.files.map((entry) => [entry.path, entry]));
const product = [
  'backend/src/modules/attachments/attachments.service.ts',
  'backend/src/modules/people/people.service.ts',
  'backend/src/modules/returns/returns.service.ts',
  'backend/src/modules/stock/stock.service.ts',
  'backend/src/ws/events.ts',
  'frontend/src/navigation/permissions.ts',
  'frontend/src/screens/ChatsScreen.tsx',
  'frontend/src/screens/PeopleScreen.tsx',
  'frontend/src/screens/ReturnsScreen.tsx',
  'frontend/src/screens/StockScreen.tsx',
  'frontend/src/ws/client.ts',
];
const tests = [
  'backend/scripts/local03-chat-ui-state.test.js',
  'backend/scripts/local03-people-presence.test.js',
  'backend/scripts/local03-quality-realtime.test.js',
];
const builds = [
  'backend/dist/main.js',
  'backend/dist/modules/attachments/attachments.service.js',
  'backend/dist/modules/people/people.service.js',
  'backend/dist/modules/returns/returns.service.js',
  'backend/dist/modules/stock/stock.service.js',
  'backend/dist/ws/events.js',
  'frontend/dist/index.html',
  ...fs.readdirSync(path.join(root, 'frontend/dist/assets'))
    .filter((name) => /^index-.*\.(js|css)$/.test(name))
    .map((name) => `frontend/dist/assets/${name}`),
];
function record(relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  return {
    path: relative,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    ...(byPath.has(relative) ? { beforeSha256: byPath.get(relative).sha256 } : {}),
  };
}
function check(command, args) {
  const result = spawnSync(command, args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result.status;
}

const productHashes = product.map(record);
const testHashes = tests.map(record);
const buildHashes = builds.map(record);
const changedAgainstBaseline = baseline.files
  .filter((entry) => fs.existsSync(path.join(root, entry.path)))
  .map((entry) => record(entry.path))
  .filter((entry) => entry.sha256 !== entry.beforeSha256)
  .map((entry) => entry.path);
const expectedChanged = [
  ...product,
  'backend/dist/modules/attachments/attachments.service.js',
  'backend/dist/modules/people/people.service.js',
  'backend/dist/modules/returns/returns.service.js',
  'backend/dist/modules/stock/stock.service.js',
  'backend/dist/ws/events.js',
  'frontend/dist/index.html',
].sort();
assert.deepEqual(changedAgainstBaseline.sort(), expectedChanged);
assert(productHashes.every((entry) => entry.sha256 !== entry.beforeSha256));
const sourceText = product.filter((name) => name.startsWith('frontend/'))
  .map((name) => fs.readFileSync(path.join(root, name), 'utf8'))
  .join('\n');
const uiScan = {
  browserPromptAlertConfirm: (sourceText.match(/\b(?:window\.)?(?:prompt|alert|confirm)\s*\(/g) || []).length,
  replacementCharacters: (sourceText.match(/\uFFFD/g) || []).length,
  forbiddenFieldNames: (sourceText.match(/\b(?:storagePath|passwordHash|refreshToken)\b/g) || []).length,
};
assert.deepEqual(uiScan, { browserPromptAlertConfirm: 0, replacementCharacters: 0, forbiddenFieldNames: 0 });
const syntax = Object.fromEntries([...tests, 'backend/prisma/seed.js'].map((name) => [name, check(process.execPath, ['--check', name])]));
const diffWhitespace = check('git', ['diff', '--check', '--', ...product.filter((name) => !name.includes('ChatsScreen') && !name.includes('PeopleScreen') && !name.includes('navigation/permissions'))]);
const result = {
  status: 'PASS_SOURCE_BUILD_HASHES_TARGETED_SCAN',
  baselineHead: baseline.head,
  baselineFiles: baseline.files.length,
  changedBaselineFiles: changedAgainstBaseline.length,
  changedAgainstBaseline,
  product: productHashes,
  tests: testHashes,
  builds: buildHashes,
  uiScan,
  syntax,
  diffWhitespace,
};
fs.writeFileSync(path.join(__dirname, 'final-integrity.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(result.status);
