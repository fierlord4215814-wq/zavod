// Evidence packaging only. Does not connect to a database or launch the application.
// Own synthetic credentials are compared in memory; no values are exported.
const o = require('./own.cjs');
const { fs, path, assert, root, sha } = o;
const prefix = 'docs/vps-preparation/task-notify-01/';
const zipName = 'review-pack-task-notify01-20260927.zip';
const source = require('./source-checks.json');
const generated = new Set(['review-pack-manifest.json', 'review-pack-readback.json', 'review-external-references.json', 'review-package-checks.json']);
const includedScreens = new Set(['navigation-before.png', 'final-tech_kipia-exact-source.png', 'final-master-exact-source.png']);
const excludedScreens = [];
const selected = new Set(source.files.map(f => f.path).concat(source.newTests.map(f => f.path)));
function full(relative) {
  const f = path.resolve(root, relative);
  assert(f.startsWith(root + path.sep), 'Outside canonical workspace');
  // Refuse links/reparse targets at any path component, not only at the leaf.
  let current = root;
  for (const part of path.relative(root, f).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'Linked review target');
  }
  return f;
}
function record(relative) {
  const f = full(relative); assert(fs.lstatSync(f).isFile(), 'Not a review file');
  const bytes = fs.readFileSync(f);
  return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
}
assert(!fs.existsSync(full(prefix + zipName)), 'Refusing ZIP overwrite');
assert(!fs.existsSync(full(prefix + 'review-pack-readback.json')), 'Refusing readback overwrite');
function collect(relative) {
  for (const e of fs.readdirSync(full(relative), { withFileTypes: true })) {
    assert(!e.isSymbolicLink()); const next = relative + '/' + e.name;
    if (e.isDirectory()) { collect(next); continue; }
    if (generated.has(e.name) || e.name.endsWith('.zip')) continue;
    if (e.name.endsWith('.png') && !includedScreens.has(e.name)) { excludedScreens.push(next); continue; }
    assert(/\.(?:cjs|js|ts|tsx|prisma|ps1|json|ndjson|txt|md|patch|png)$/.test(e.name), 'Unexpected review extension: ' + next);
    selected.add(next);
  }
}
collect(prefix.slice(0, -1));
for (const relative of [
  'AGENTS.md', 'docs/v1-completion-goal.md',
  'docs/vps-preparation/handoff.md', 'docs/full-ui-interaction-sweep/visual-gap-register.md',
  'docs/vps-preparation/local-01/plan.md',
  'docs/vps-preparation/factory-01/report.md', 'docs/vps-preparation/factory-01/plan.md',
  'docs/vps-preparation/factory-01/five-gate-delta-matrix.md', 'docs/vps-preparation/factory-01/manual-review.md',
  'docs/vps-preparation/factory-01/stand.ps1', 'docs/vps-preparation/factory-01/own-runtime.cjs',
  'docs/vps-preparation/factory-01/pair.cjs', 'docs/vps-preparation/factory-01/harness.cjs',
  'docs/vps-preparation/factory-01/users.json', 'docs/vps-preparation/factory-01/structure.json',
  'docs/vps-preparation/local-02/harness.cjs', 'docs/vps-preparation/local-02/files.cjs',
  'docs/vps-preparation/admin-01/harness.cjs', 'docs/vps-preparation/local-03/frontend-preview.cjs',
  'backend/scripts/master-r2-task-chain.test.js', 'backend/scripts/master-r2-replay.test.js',
  'backend/scripts/master-task-replay-boundary.test.js', 'backend/scripts/master-stateful-chain.test.js',
  'backend/scripts/master-offline-contract.test.js', 'backend/scripts/vps-prep-01-regression.js',
  'frontend/scripts/master-ws-contract.test.cjs',
  'backend/src/modules/orders/orders.service.ts', 'backend/src/modules/wash/wash.service.ts',
  'backend/src/modules/defrost/defrost.service.ts', 'backend/src/modules/announcements/announcements.service.ts',
  'backend/src/modules/returns/returns.service.ts', 'backend/src/modules/stock/stock.service.ts',
  'frontend/src/notifications/browser-notifications.ts',
  'package.json', 'backend/package.json', 'frontend/package.json',
]) selected.add(relative);
// Fresh process identities for this task, without copying prior entire evidence packs.
for (const file of fs.readdirSync(full('docs/vps-preparation/factory-01'))) {
  if (/^runtime-20260926-23\d{4}-\d{3}\.json$/.test(file)) selected.add('docs/vps-preparation/factory-01/' + file);
}
// Include static local test prerequisites. Runtime secrets, binaries and node_modules never enter selection.
const externalHelpers = [];
const queue = [...selected], visited = new Set();
while (queue.length) {
  const relative = queue.shift(); if (visited.has(relative)) continue; visited.add(relative);
  if (!/\.(?:cjs|js)$/.test(relative)) continue;
  const text = fs.readFileSync(full(relative), 'utf8');
  for (const m of text.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
    const base = path.resolve(path.dirname(full(relative)), m[1]);
    if (!base.startsWith(root + path.sep)) continue;
    const resolved = [base, base + '.js', base + '.cjs', base + '.json'].find(f => fs.existsSync(f) && fs.lstatSync(f).isFile());
    if (!resolved) { externalHelpers.push({ from: relative, import: m[1], reason: 'BUILD_OR_RUNTIME_PREREQUISITE' }); continue; }
    const target = path.relative(root, resolved).replaceAll('\\', '/');
    if (/(?:^|\/)(?:node_modules|dist|secrets|uploads|pgdata)(?:\/|$)/.test(target)) {
      externalHelpers.push({ from: relative, import: m[1], reason: 'NOT_PACKAGED_DEPENDENCY_OR_BUILD' }); continue;
    }
    if (!selected.has(target)) { selected.add(target); queue.push(target); }
  }
}
for (const f of source.files) assert.equal(record(f.path).sha256, f.after, 'Source changed after checks');
for (const f of source.newTests) assert.equal(record(f.path).sha256, f.sha256, 'New test changed after checks');
assert.deepEqual(record(source.retainedFactory01Zip.path), source.retainedFactory01Zip, 'Previous ZIP changed');
const before = require('./before.json');
for (const migration of before.migrations) {
  assert.equal(record('backend/prisma/migrations/' + migration.name + '/migration.sql').sha256, migration.sha256);
}
assert.equal(before.migrations.length, 57);
const checks = require('./final-checks.json');
assert(checks.runs.every(r => r.exit === 0));
assert.equal(checks.runs.find(r => r.name === 'backend-task-notification-replay').pass, 97);
assert.equal(checks.runs.find(r => r.name === 'frontend-source-navigation-ws').pass, 10);
const foundation = JSON.parse(fs.readFileSync(full(prefix + checks.runs.find(r => r.name === 'foundation-auth').log), 'utf8'));
assert.equal(foundation.checks, 41); assert(foundation.results.every(r => r.ok));
assert.equal(require('./final-state.json').status, 'PASS_T1_ACTIVE_90_TABLES_68_FILES_UNCHANGED_COPY_STOPPED');
for (const name of ['sql-faults-final-ui', 'retry', 'recipients', 'security', 'lost-second-ui', 'restart-final', 'ui-normal', 'ui-before-publication', 'ui-ws', 'ui-push']) {
  assert(require('./' + name + '.json').status.startsWith('PASS'), name + ' incomplete');
}
const adjacent = new Set([prefix + zipName, ...[...generated].map(n => prefix + n)]);
const externals = new Map(), broken = [];
for (const relative of selected) {
  if (!relative.endsWith('.md')) continue;
  const text = fs.readFileSync(full(relative), 'utf8');
  for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let link = m[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|codex:|#)/i.test(link)) continue;
    link = decodeURIComponent(link.split('#')[0]); if (!link) continue;
    const absolute = path.resolve(path.dirname(full(relative)), link);
    if (!absolute.startsWith(root + path.sep)) continue;
    const target = path.relative(root, absolute).replaceAll('\\', '/');
    if (selected.has(target) || adjacent.has(target)) continue;
    const exists = fs.existsSync(absolute);
    if (target.startsWith(prefix) && !exists) broken.push({ from: relative, target });
    if (!externals.has(target)) {
      const item = { path: target, existsAtPackageTime: exists, classification: 'RETAINED_EXTERNAL_NOT_NEW_TASK_NOTIFY_PROOF' };
      if (exists && fs.lstatSync(absolute).isFile() && !/(?:secrets|uploads|pgdata|node_modules)|\.env|\.(?:dump|vhdx|iso)$/i.test(target)) Object.assign(item, record(target));
      externals.set(target, item);
    }
  }
}
assert.deepEqual(broken, [], 'Broken current proof link');
const secretDir = path.join(o.runtime, 'secrets');
const knownSecrets = fs.readdirSync(secretDir).filter(n => n.endsWith('.txt')).map(n => fs.readFileSync(path.join(secretDir, n), 'utf8').trim()).filter(s => s.length >= 12);
const credentialIndex = JSON.parse(fs.readFileSync(path.join(o.runtime, 'credential-index.json'), 'utf8'));
const issues = [];
function scanObject(value, location) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:password|passwordHash|recoveryCredential|accessToken|refreshToken|jwtSecret|JWT_SECRET|DATABASE_URL|storagePath)$/i.test(key) && typeof item === 'string' && item && item !== '[REDACTED]') issues.push({ path: location, kind: 'SENSITIVE_FIELD', key });
    scanObject(item, location + '.' + key);
  }
}
for (const relative of selected) {
  assert(!/(?:^|\/)(?:secrets|uploads|pgdata|node_modules|dist)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|credential-index|\.(?:dump|backup|vhdx|iso|har|zip)$/i.test(relative), 'Forbidden review path');
  const bytes = fs.readFileSync(full(relative));
  if (knownSecrets.some(secret => bytes.includes(Buffer.from(secret)))) issues.push({ path: relative, kind: 'OWN_SECRET_VALUE' });
  if (!/\.(?:json|ndjson|txt|md)$/.test(relative)) continue;
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/.test(text)) issues.push({ path: relative, kind: 'JWT_VALUE' });
  if (/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(text)) issues.push({ path: relative, kind: 'PASSWORD_HASH_VALUE' });
  if (/postgres(?:ql)?:\/\/[^\s\/'":]+:[^@\s\/'"]+@/.test(text)) issues.push({ path: relative, kind: 'DATABASE_CREDENTIAL_VALUE' });
  if (credentialIndex.some(u => u.phone && text.includes(u.phone))) issues.push({ path: relative, kind: 'SYNTHETIC_LOGIN_VALUE' });
  if (relative.endsWith('.json')) scanObject(JSON.parse(text), relative);
  if (relative.endsWith('.ndjson')) for (const line of text.split(/\r?\n/).filter(Boolean)) scanObject(JSON.parse(line), relative);
}
if (issues.length) { console.log(JSON.stringify({ status: 'STOP_REVIEW_REDACTION_REQUIRED', issues })); process.exitCode = 1; return; }
o.receipt('review-external-references', { kind: 'RETAINED_HISTORY_NOT_NEW_PROOF', entries: [...externals.values()], externalHelpers,
  excludedScreens: excludedScreens.map(path => ({ path, reason: 'EARLY_TRANSITION_FRAME_NOT_SOLE_LAYOUT_PROOF' })),
  note: 'Review is self-contained evidence/current source, not a runnable installer. Canonical dependencies/builds and own protected test runtime are required to repeat live tests. Historical ZIPs/data are not copied.' });
o.receipt('review-package-checks', { status: 'PASS_SCOPED_REVIEW_PREFLIGHT', atUtc: new Date().toISOString(), finalSourceIdentity: source.sourceIdentity,
  backendTests: 97, frontendTests: 10, foundationAuthChecks: 41, migrations: '57_UNCHANGED', previousZipUnchanged: true,
  selectedFilesBeforeManifest: selected.size, secretAndSyntheticLoginFindings: issues, brokenCurrentLinks: broken,
  screenshotCount: includedScreens.size, excludedTransitionScreens: excludedScreens.length,
  secretScan: 'OWN_SYNTHETIC_VALUES_COMPARED_IN_MEMORY_NO_EXPORT_NO_WORKING_SECRETS', sourceHashesRevalidated: true });
selected.add(prefix + 'review-external-references.json'); selected.add(prefix + 'review-package-checks.json');
const entries = [...selected].sort().map(record);
o.receipt('review-pack-manifest', { kind: 'TASK_NOTIFY01_REVIEW_NOT_RUNTIME_BACKUP', finalSourceIdentity: source.sourceIdentity,
  count: entries.length, entries, excluded: ['secrets', 'DB dumps', 'uploads', 'credential index', '.env', 'node_modules/dist', 'prior full ZIPs', 'VM/system images'],
  adjacentReadback: prefix + 'review-pack-readback.json' });
console.log(JSON.stringify({ status: 'PASS_SCOPED_REVIEW_PREFLIGHT', entries: entries.length, screenshots: includedScreens.size, externalHistoricalReferences: externals.size }));
