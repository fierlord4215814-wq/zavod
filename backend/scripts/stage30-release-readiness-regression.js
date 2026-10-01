const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const API = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';
const state = { ok: [], failures: [] };

const ok = (name, detail) => state.ok.push({ name, ...(detail ? { detail } : {}) });
const fail = (name, detail) => state.failures.push({ name, ...(detail ? { detail } : {}) });

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

async function request(pathname) {
  const response = await fetch(`${API}${pathname}`);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

function hasSecretLeak(value) {
  const text = JSON.stringify(value);
  return /passwordHash|tokenHash|storagePath|DATABASE_URL=|JWT_SECRET=|postgresql:\/\/(?!USER:PASSWORD)|Bearer\s+[A-Za-z0-9]/i.test(text);
}

function scanFiles(files, pattern) {
  const hits = [];
  for (const file of files) {
    if (!exists(file)) continue;
    const source = read(file);
    const match = source.match(pattern);
    if (match) hits.push({ file, matches: [...new Set(match)].slice(0, 8) });
  }
  return hits;
}

function walk(dir, predicate, result = []) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return result;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) walk(relative, predicate, result);
    else if (predicate(relative)) result.push(relative);
  }
  return result;
}

async function main() {
  const health = await request('/health');
  if (health.status === 200) ok('/health returns 200'); else fail('/health returns 200', health);
  if (!hasSecretLeak(health.data)) ok('/health hides secrets'); else fail('/health hides secrets', health.data);

  const version = await request('/version');
  if (version.status === 200) ok('/version returns 200'); else fail('/version returns 200', version);
  if (!hasSecretLeak(version.data)) ok('/version hides secrets'); else fail('/version hides secrets', version.data);

  const envExample = exists('.env.example') ? read('.env.example') : exists('backend/.env.example') ? read('backend/.env.example') : '';
  if (/DATABASE_URL=.*USER:PASSWORD/.test(envExample)) ok('.env.example has DATABASE_URL placeholder');
  else fail('.env.example has DATABASE_URL placeholder');
  if (/JWT_SECRET=.*replace-with-local-dev-secret/.test(envExample)) ok('.env.example has JWT_SECRET placeholder');
  else fail('.env.example has JWT_SECRET placeholder');
  if (!/postgresql:\/\/[^U][^:]+:[^P][^@]+@/.test(envExample)) ok('.env.example has no real database secret');
  else fail('.env.example has no real database secret');

  const gitignore = exists('.gitignore') ? read('.gitignore') : '';
  for (const item of ['.env', 'uploads/', 'backend/uploads/', 'dist/', 'node_modules/', '*.log']) {
    if (gitignore.includes(item)) ok(`.gitignore covers ${item}`);
    else fail(`.gitignore covers ${item}`);
  }

  const requiredDocs = [
    'docs/storage-policy.md',
    'docs/backup-restore.md',
    'docs/retention-policy.md',
    'docs/test-fixtures.md',
    'docs/browser-device-e2e-checklist.md',
    'docs/release-readiness.md',
    'docs/local-runbook.md',
    'docs/admin-install-checklist.md',
    'docs/run-full-regression-gate.md',
    'docs/stage28-menu-role-visibility-audit.md',
    'docs/stage29-admin-config-coverage.md',
    'docs/stage30-release-readiness.md',
  ];
  for (const doc of requiredDocs) {
    if (exists(doc)) ok(`${doc} exists`);
    else fail(`${doc} exists`);
  }

  const backendPackage = JSON.parse(read('backend/package.json'));
  const requiredScripts = [
    'stage6:regression',
    'stage7:admin-regression',
    'stage8:attachments-regression',
    'stage9:shift-regression',
    'stage10:tasks-regression',
    'stage11:wash-regression',
    'stage115:auth-regression',
    'stage12:orders-regression',
    'stage13:checklists-regression',
    'stage131:checklists-hardening-regression',
    'stage14:shift-log-regression',
    'stage15:defrost-regression',
    'stage16:quality-stock-returns-regression',
    'stage17:notifications-regression',
    'stage171:notification-hooks-regression',
    'stage18:ops-audit-regression',
    'stage19:pwa-offline-regression',
    'stage191:browser-pwa-sanity',
    'stage20:production-hardening-regression',
    'stage21:role-shift-simulation',
    'stage23:chats-regression',
    'stage231:tail-hardening-regression',
    'stage24:announcements-regression',
    'stage25:people-profile-skills-regression',
    'stage26:line-skills-okk-table-regression',
    'stage27:store-returns-work-areas-regression',
    'stage28:menu-role-visibility-regression',
    'stage29:admin-config-coverage-regression',
    'stage30:release-readiness-regression',
  ];
  for (const script of requiredScripts) {
    if (backendPackage.scripts?.[script]) ok(`${script} package script exists`);
    else fail(`${script} package script exists`);
  }
  if (exists('backend/scripts/stage30-full-regression-gate.js')) ok('stage30 full gate wrapper exists');
  else fail('stage30 full gate wrapper exists');

  const frontendFiles = walk('frontend/src', (file) => file.endsWith('.ts') || file.endsWith('.tsx'));
  const docsFiles = walk('docs', (file) => file.endsWith('.md'));
  const mojibakeHits = scanFiles([...frontendFiles, ...docsFiles], /�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ/g);
  if (!mojibakeHits.length) ok('frontend/docs mojibake scan clean');
  else fail('frontend/docs mojibake scan clean', mojibakeHits.slice(0, 10));

  const promptHits = scanFiles(frontendFiles, /window\.(prompt|alert|confirm)|\balert\(/g);
  if (!promptHits.length) ok('prompt/alert/confirm scan clean');
  else fail('prompt/alert/confirm scan clean', promptHits);

  const secretHits = scanFiles([...frontendFiles, ...docsFiles, 'backend/src/modules/health/health.controller.ts'], /postgresql:\/\/(?!USER:PASSWORD)|JWT_SECRET=(?!"?replace-with-local-dev-secret)|Bearer\s+[A-Za-z0-9._-]{20,}/g);
  if (!secretHits.length) ok('docs/src secret scan clean');
  else fail('docs/src secret scan clean', secretHits.slice(0, 10));

  if (state.failures.length) {
    console.error('Stage 30 release readiness regression failed');
    console.error(JSON.stringify(state.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Stage 30 release readiness regression passed');
  }
  console.log(JSON.stringify({ ok: state.ok.length, failures: state.failures.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
