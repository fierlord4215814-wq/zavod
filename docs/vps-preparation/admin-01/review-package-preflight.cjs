'use strict';
// Read-only review preparation over canonical sources/evidence. No runtime/DB/secret reads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const prefix = 'docs/vps-preparation/admin-01/';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, ''));
const final = json(prefix + 'final-integrity.json');
const before = json(prefix + 'before.json');
const generated = new Set(['review-pack-manifest.json', 'review-external-references.json', 'review-package-checks.json', 'review-pack-readback.json']);
const zipName = 'review-pack-admin01-20260926.zip';
assert(!fs.existsSync(path.join(__dirname, zipName)), 'Review ZIP already exists; do not overwrite');
function full(relative) {
  assert(!/^(?:[A-Za-z]:|\/)/.test(relative), 'Expected root-relative path');
  const resolved = path.resolve(root, relative);
  assert(resolved.startsWith(root + path.sep), 'Outside canonical root');
  return resolved;
}
function record(relative) {
  const p = full(relative), st = fs.lstatSync(p);
  assert(st.isFile() && !st.isSymbolicLink(), `Not a plain file: ${relative}`);
  const bytes = fs.readFileSync(p);
  return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
}
const selected = new Set(final.files.map((f) => f.path));
const screenNames = new Set([
  'admin-settings-before.png', 'users-setup-after.png', 'audit-before-c-retired.png',
  'clean-smoke-admin-390.png', 'ui-admin-factory-360-dark.png', 'ui-admin-users-360-dark.png',
  'ui-admin-settings-1440-dark.png', 'ui-admin-settings-360-dark.png',
  'ui-chat-edit-1440-dark.png', 'ui-chat-edit-360-dark.png',
  'ui-checklist-row-360-dark.png', 'ui-checklist-row-390-gray.png',
  'ui-orders-form-430-light.png', 'ui-tasks-form-430-light.png',
]);
function collect(dir) {
  for (const entry of fs.readdirSync(full(dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    assert(!entry.isSymbolicLink(), `No symlink: ${rel}`);
    if (entry.isDirectory()) { collect(rel); continue; }
    if (generated.has(entry.name) || entry.name.endsWith('.zip')) continue;
    if (entry.name.endsWith('.png') && !screenNames.has(entry.name)) continue;
    assert(/\.(?:json|md|txt|ts|tsx|js|cjs|ps1|diff|png|prisma)$/.test(entry.name), `Unexpected artifact: ${rel}`);
    selected.add(rel);
  }
}
collect(prefix.slice(0, -1));
for (const name of ['review-external-references.json', 'review-package-checks.json']) selected.add(prefix + name);
for (const rel of [
  'AGENTS.md', 'docs/v1-completion-goal.md',
  'docs/vps-preparation/local-01/plan.md', 'docs/vps-preparation/handoff.md',
  'docs/full-ui-interaction-sweep/visual-gap-register.md', 'docs/stage37-defrost-calendar-ux.md',
  'docs/vps-preparation/local-02/harness.cjs', 'docs/vps-preparation/local-02/own-db.cjs',
  'docs/vps-preparation/local-02/files.cjs', 'docs/vps-preparation/local-03/frontend-preview.cjs',
  'backend/src/modules/shift/shift.controller.ts', 'frontend/src/screens/ShiftLogScreen.tsx',
  'backend/scripts/vps-prep-01-regression.js', 'backend/scripts/master-domain-contracts.test.js',
]) selected.add(rel);
for (const name of [
  'master-r2-admin-chain', 'master-r2-position', 'master-r2-membership-future',
  'master-r2-task-chain', 'master-r2-orders', 'master-r2-checklist',
  'local01-chat-guest-policy', 'local02-chat-policy', 'master-r2-chat-chain', 'local03-chat-ui-state',
  'master-r2-wash-lifecycle', 'master-r2-defrost-line-replay',
  'master-r2-publication', 'master-r3-receivers', 'local03-people-presence',
]) selected.add(`backend/scripts/${name}.test.js`);
const migrations = fs.readdirSync(full('backend/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory());
assert.equal(migrations.length, 57);
for (const migration of before.migrations) {
  const relative = `backend/prisma/migrations/${migration.migration_name}/migration.sql`;
  assert.equal(record(relative).sha256, migration.checksum);
  selected.add(relative);
}
for (const f of final.files) assert.equal(record(f.path).sha256, f.after, `Final source changed: ${f.path}`);
for (const f of before.files) assert.equal(record(prefix + 'before/' + f.path).sha256, f.sha256);
assert.equal(final.files.filter((f) => f.changed).length, 20);
const computed = sha(Buffer.from(final.files.filter((f) => f.changed).map((f) => `${f.path}:${f.after}`).sort().join('\n')));
assert.equal(computed, final.identity);
const modelNames = ['Shift', 'Task', 'Wash', 'Defrost', 'Order', 'Checklist', 'Chat', 'Announcement'].map((n) => `${n}Settings`);
const schema = fs.readFileSync(full('backend/prisma/schema.prisma'), 'utf8');
const settingFields = modelNames.flatMap((model) => {
  const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
  assert(block, model);
  return [...block[1].matchAll(/^\s+(\w+)\s+(Boolean|Int|String|Float|DateTime|Json)\??\s/gm)]
    .map((m) => m[1]).filter((f) => !['id', 'factoryId', 'createdAt', 'updatedAt'].includes(f)).map((f) => `${model}.${f}`);
});
assert.equal(settingFields.length, 66);
const settingTable = fs.readFileSync(full(prefix + 'module-settings-matrix.md'), 'utf8');
for (const field of settingFields) assert(settingTable.includes(`| ${field.split('.')[1]} |`), `Missing setting row: ${field}`);
const adminTable = fs.readFileSync(full(prefix + 'admin-acceptance-matrix.md'), 'utf8');
const tableRows = adminTable.split('\n').filter((l) => l.startsWith('|')).slice(2);
assert.equal(tableRows.length, 15);

const external = new Map(), brokenAdminLinks = [];
const adjacent = new Set([prefix + zipName, prefix + 'review-pack-readback.json']);
for (const rel of selected) {
  if (!rel.endsWith('.md') || generated.has(path.basename(rel))) continue;
  const text = fs.readFileSync(full(rel), 'utf8');
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let link = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|codex:|#)/i.test(link)) continue;
    link = decodeURIComponent(link.split('#')[0]);
    if (!link) continue;
    const resolved = path.resolve(path.dirname(full(rel)), link);
    if (!resolved.startsWith(root + path.sep)) continue; // historical absolute external paths are not traversed
    const target = path.relative(root, resolved).replace(/\\/g, '/');
    if (selected.has(target) || target === prefix + 'review-pack-manifest.json') continue;
    const exists = fs.existsSync(resolved);
    const kind = adjacent.has(target) ? 'ADJACENT_ARCHIVE_OR_POST_PACK_READBACK' : target.startsWith(prefix) ? 'RETAINED_ADMIN01_EXTRA_SCREENSHOT' : 'RETAINED_EXTERNAL_NOT_NEW_ADMIN01_PROOF';
    if (target.startsWith(prefix) && !exists && !adjacent.has(target)) brokenAdminLinks.push({ from: rel, target });
    let item = external.get(target);
    if (!item) {
      item = { path: target, classification: kind, existsAtPackageTime: exists, referencedFrom: [] };
      // Hash only scoped plaintext references / existing evidence, never follow secret/runtime links.
      if (exists && !/(?:^|\/)(?:secrets|uploads|node_modules)(?:\/|$)|(?:^|\/)\.env|\.(?:dump|vhdx|vhd|iso)$/i.test(target)) {
        const st = fs.lstatSync(resolved);
        if (st.isFile() && !st.isSymbolicLink()) Object.assign(item, record(target));
      }
      external.set(target, item);
    }
    if (!item.referencedFrom.includes(rel)) item.referencedFrom.push(rel);
  }
}
assert.deepEqual(brokenAdminLinks, []);
fs.writeFileSync(path.join(__dirname, 'review-external-references.json'), JSON.stringify({
  kind: 'EXPLICIT_RETAINED_EXTERNAL_REFERENCE_INDEX',
  note: 'Historical links from plan/handoff/gap register are retained references, not new proof. Missing historical paths are not accepted evidence. Current ADMIN01 primary receipts are included. ZIP/readback are adjacent generated outputs.',
  entries: [...external.values()].sort((a, b) => a.path.localeCompare(b.path)),
}, null, 2));

const secretProblems = [];
function scanObject(value, location) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:password|passwordHash|passwordRecoveryHash|recoveryCredential|temporaryCredential|recoverySecret|accessToken|refreshToken|setupToken|jwtSecret|JWT_SECRET|DATABASE_URL)$/i.test(key) && typeof item === 'string' && item.length && item !== '[REDACTED]') {
      secretProblems.push({ location: `${location}.${key}`, kind: 'credential-shaped-json-value' });
    }
    scanObject(item, `${location}.${key}`);
  }
}
let scannedArtifacts = 0;
for (const rel of selected) {
  assert(!/(?:^|\/)(?:secrets|uploads|node_modules|pgdata)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:dump|backup|vhdx|vhd|iso|har|zip)$/i.test(rel), `Forbidden package path: ${rel}`);
  if (rel.endsWith('review-package-checks.json')) continue;
  if (rel.startsWith(prefix) && /\.(?:json|txt|md)$/.test(rel)) {
    const text = fs.readFileSync(full(rel), 'utf8').replace(/^\uFEFF/, '');
    scannedArtifacts++;
    if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/.test(text)) secretProblems.push({ location: rel, kind: 'jwt' });
    if (/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(text)) secretProblems.push({ location: rel, kind: 'bcrypt' });
    if (/postgres(?:ql)?:\/\/[^\s\/'":]+:[^@\s\/'"]+@/.test(text)) secretProblems.push({ location: rel, kind: 'credentialed-db-url' });
    if (rel.endsWith('.json')) scanObject(JSON.parse(text), rel);
  }
}
assert.deepEqual(secretProblems, [], 'Sensitive artifact pattern found; do not package or print values');
const checks = {
  status: 'PASS_REVIEW_PREFLIGHT', atUtc: new Date().toISOString(),
  finalSourceIdentity: final.identity, changedSourceAndTests: 20,
  baselineSnapshotsVerified: before.files.length, migrationsUnchanged: 57,
  moduleSettingRows: 66, adminFunctionRows: 15,
  currentAdminBrokenLinks: brokenAdminLinks, scannedArtifacts, secretPatternFindings: secretProblems,
  screenshotCount: screenNames.size,
  externalReferences: external.size,
  externalMissingHistoricalLinks: [...external.values()].filter((e) => !e.existsAtPackageTime && e.classification === 'RETAINED_EXTERNAL_NOT_NEW_ADMIN01_PROOF').map((e) => e.path),
  limitations: 'Pattern and structured artifact scan, selected screenshot inspection. No scan of working secrets; no runtime mutation; dependencies and full checkout are deliberately external. Not an independent product acceptance.',
};
fs.writeFileSync(path.join(__dirname, 'review-package-checks.json'), JSON.stringify(checks, null, 2));
const entries = [...selected].sort().map(record);
fs.writeFileSync(path.join(__dirname, 'review-pack-manifest.json'), JSON.stringify({
  kind: 'ADMIN01_WINDOWS_FUNCTIONAL_REVIEW_NOT_BACKUP',
  finalSourceIdentity: final.identity, count: entries.length, entries,
  externalReferenceIndex: prefix + 'review-external-references.json',
  excludes: ['runtime credentials', 'working .env', 'dumps', 'uploads', 'node_modules/dist', 'VM images', 'full previous review ZIPs'],
  adjacentReadback: prefix + 'review-pack-readback.json',
}, null, 2));
console.log(JSON.stringify({ status: checks.status, manifestEntries: entries.length, screenshotCount: screenNames.size, secretPatternFindings: secretProblems.length, currentAdminBrokenLinks: brokenAdminLinks.length, externalReferences: external.size, missingHistoricalLinks: checks.externalMissingHistoricalLinks.length }));
