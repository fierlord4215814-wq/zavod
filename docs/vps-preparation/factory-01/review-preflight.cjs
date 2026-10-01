// Review artifacts only. Own test secrets are compared in memory, never exported.
const h = require('./own-runtime.cjs'), { fs, path, assert, root, sha } = h;
const prefix = 'docs/vps-preparation/factory-01/', source = require('./final-source-checks.json');
const zipName = 'review-pack-factory01-20260927.zip';
const excludedContactScreens = new Set(['persisted-ui-native-admin-skills.png', 'persisted-ui-restore-admin-skills.png', 'skills-profile-390.png']);
const generated = new Set(['review-pack-manifest.json', 'review-pack-readback.json', 'review-external-references.json', 'review-package-checks.json']);
assert(!fs.existsSync(path.join(__dirname, zipName)), 'No review ZIP overwrite');
const selected = new Set([...source.changedProductFiles, ...source.tests.map(x => x.path)]);
function full(rel) { const f = path.resolve(root, rel); assert(f.startsWith(root + path.sep)); return f; }
function record(rel) { const f = full(rel), st = fs.lstatSync(f); assert(st.isFile() && !st.isSymbolicLink()); const b = fs.readFileSync(f); return { path: rel, bytes: b.length, sha256: sha(b) }; }
function collect(dir) {
  for (const e of fs.readdirSync(full(dir), { withFileTypes: true })) {
    assert(!e.isSymbolicLink()); const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { collect(rel); continue; }
    if (generated.has(e.name) || e.name.endsWith('.zip') || excludedContactScreens.has(e.name)) continue;
    assert(/\.(?:cjs|js|ts|tsx|ps1|json|txt|md|patch|diff|png|xlsx)$/.test(e.name), `Unexpected review type: ${rel}`);
    selected.add(rel);
  }
}
collect(prefix.slice(0, -1));
for (const rel of [
  'docs/vps-preparation/handoff.md', 'docs/vps-preparation/local-01/plan.md',
  'docs/vps-preparation/local-02/harness.cjs', 'docs/vps-preparation/local-02/files.cjs',
  'docs/vps-preparation/admin-01/harness.cjs', 'docs/vps-preparation/local-03/frontend-preview.cjs',
  'AGENTS.md', 'docs/v1-completion-goal.md',
]) selected.add(rel);
// Enumerate direct local-module prerequisites without reading any runtime directories.
const helperDependencies = new Set();
for (const rel of [...selected]) {
  if (!/\.(?:cjs|js|ps1)$/.test(rel)) continue;
  const text = fs.readFileSync(full(rel), 'utf8');
  for (const m of text.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
    const resolved = path.resolve(path.dirname(full(rel)), m[1]);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) continue;
    const target = path.relative(root, resolved).replaceAll('\\', '/');
    if (!selected.has(target)) helperDependencies.add(target);
  }
}
const external = new Map(), broken = [], adjacent = new Set([prefix + zipName, ...[...generated].map(n => prefix + n)]);
function externalReference(target, from, classification) {
  if (selected.has(target) || adjacent.has(target)) return;
  const f = full(target), exists = fs.existsSync(f); let item = external.get(target);
  if (!item) {
    item = { path: target, classification, existsAtPackageTime: exists, referencedFrom: [] };
    if (exists && !/(?:^|\/)(?:secrets|uploads|pgdata|node_modules)(?:\/|$)|(?:^|\/)\.env|\.(?:dump|vhdx|iso)$/i.test(target)) {
      if (fs.lstatSync(f).isFile()) Object.assign(item, record(target));
    }
    external.set(target, item);
  }
  if (!item.referencedFrom.includes(from)) item.referencedFrom.push(from);
}
for (const rel of selected) {
  if (!rel.endsWith('.md')) continue;
  const text = fs.readFileSync(full(rel), 'utf8');
  for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let link = m[1].trim().replace(/^<|>$/g, ''); if (/^(?:https?:|mailto:|codex:|#)/i.test(link)) continue;
    link = decodeURIComponent(link.split('#')[0]); if (!link) continue;
    const resolved = path.resolve(path.dirname(full(rel)), link);
    if (!resolved.startsWith(root + path.sep)) continue;
    const target = path.relative(root, resolved).replaceAll('\\', '/');
    if (selected.has(target) || adjacent.has(target)) continue;
    if (target.startsWith(prefix) && !fs.existsSync(resolved)) broken.push({ from: rel, target });
    externalReference(target, rel, 'RETAINED_EXTERNAL_NOT_NEW_T1_PROOF');
  }
}
for (const target of helperDependencies) externalReference(target, 'test harness imports', 'RETAINED_HELPER_DEPENDENCY_CANONICAL_CHECKOUT_REQUIRED');
for (const name of excludedContactScreens) externalReference(prefix + name, 'visual review', 'RETAINED_SYNTHETIC_CONTACT_SCREENSHOT_EXCLUDED_FROM_ZIP');
assert.deepEqual(broken, [], 'Broken current FACTORY01 evidence links');
const secretDir = path.join(h.runtime, 'secrets');
const knownSecrets = fs.readdirSync(secretDir).filter(n => n.endsWith('.txt')).map(n => fs.readFileSync(path.join(secretDir, n), 'utf8').trim()).filter(s => s.length >= 12);
const problems = [], phoneMatches = [], credentialIndex = JSON.parse(fs.readFileSync(path.join(h.runtime, 'credential-index.json')));
function scanObject(x, location) {
  if (!x || typeof x !== 'object') return;
  for (const [key, value] of Object.entries(x)) {
    if (/^(?:password|passwordHash|recoveryCredential|accessToken|refreshToken|jwtSecret|JWT_SECRET|DATABASE_URL|storagePath)$/i.test(key) && typeof value === 'string' && value && value !== '[REDACTED]') problems.push({ path: location, kind: 'credential-or-internal-storage-field', key });
    scanObject(value, location + '.' + key);
  }
}
for (const rel of selected) {
  assert(!/(?:^|\/)(?:secrets|uploads|pgdata|node_modules)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:dump|backup|vhdx|iso|har|zip)$/i.test(rel), `Forbidden review path:${rel}`);
  const bytes = fs.readFileSync(full(rel));
  if (knownSecrets.some(s => bytes.includes(Buffer.from(s)))) problems.push({ path: rel, kind: 'known-own-secret' });
  if (!/\.(?:json|txt|md)$/.test(rel) || !rel.startsWith(prefix)) continue;
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/.test(text)) problems.push({ path: rel, kind: 'JWT' });
  if (/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(text)) problems.push({ path: rel, kind: 'password-hash' });
  if (/postgres(?:ql)?:\/\/[^\s\/'":]+:[^@\s\/'"]+@/.test(text)) problems.push({ path: rel, kind: 'credentialed-db-url' });
  if (credentialIndex.some(u => u.phone && text.includes(u.phone))) phoneMatches.push(rel);
  if (rel.endsWith('.json')) scanObject(JSON.parse(text), rel);
}
if (problems.length || phoneMatches.length) { console.log(JSON.stringify({ status: 'STOP_PREFLIGHT_REDACTION_REVIEW_REQUIRED', problems, syntheticLoginMentions: phoneMatches })); process.exitCode = 1; return; }
for (const f of source.files) assert.equal(record(f.path).sha256, f.after);
const externals = { kind: 'EXPLICIT_RETAINED_EXTERNAL_INDEX', note: 'Historical links are not new FACTORY01 proof. No old ZIPs/runtime copied. Helpers require canonical checkout; review is evidence, not an installer.', entries: [...external.values()].sort((a, b) => a.path.localeCompare(b.path)) };
h.receipt('review-external-references', externals);
const checks = { status: 'PASS_SCOPED_REVIEW_PREFLIGHT', atUtc: new Date().toISOString(), finalSourceIdentity: source.identity,
  selectedFilesBeforeManifest: selected.size, knownOwnSecretScan: 'PASS_NO_VALUES_EXPORTED', secretPatternFindings: problems, syntheticLoginMentions: phoneMatches,
  currentBrokenLinks: broken, screenshots: [...selected].filter(x => x.endsWith('.png')).length, excludedContactScreens: [...excludedContactScreens],
  externalReferences: external.size, missingHistoricalExternal: [...external.values()].filter(x => !x.existsAtPackageTime).map(x => x.path),
  boundary: 'No working secrets/data read. Exact own test secret comparisons and structural patterns; screenshot samples visually inspected. Not a new product audit.' };
h.receipt('review-package-checks', checks);
selected.add(prefix + 'review-external-references.json'); selected.add(prefix + 'review-package-checks.json');
const entries = [...selected].sort().map(record);
h.receipt('review-pack-manifest', { kind: 'FACTORY01_REVIEW_NOT_RUNTIME_BACKUP', finalSourceIdentity: source.identity, count: entries.length, entries,
  excluded: ['credentials/logins/index', 'dumps', 'uploads', '.env', 'runtime secrets', 'node_modules/dist', 'prior full ZIPs', 'VM images'],
  adjacentReadback: prefix + 'review-pack-readback.json' });
console.log(JSON.stringify({ status: checks.status, entries: entries.length, screenshots: checks.screenshots, externalReferences: external.size }));
