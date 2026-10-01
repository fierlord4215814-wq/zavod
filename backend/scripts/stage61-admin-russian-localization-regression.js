const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const ok = [];
const failures = [];

const forbiddenVisibleText = /\b(View|Read|Manage|Create|Update|Delete|Can|Settings|Overview|Save|Cancel|Access denied|No data|Factory|Users|Department|factory settings|defects|config|preview|runtime|source|target|audit read|skillCode|foundation|permission presets|schemaVersion|runtimeCopied|sourceFactory|localKey|AuditLog)\b|[a-z]+[A-Z][A-Za-z]+/;
const secretText = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|token|secret/i;

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail !== undefined ? { detail } : {}) });
}

async function request(method, pathname, options = {}) {
  const headers = { Connection: 'close' };
  if (options.userId !== null) headers['x-user-id'] = options.userId ?? 'test-admin';
  if (options.factoryId) headers['x-factory-id'] = options.factoryId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function isReachable() {
  try {
    const response = await fetch(`${API}/health`, { headers: { Connection: 'close' }, signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBackend() {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(cmd, ['run', 'start:dev:win', '--workspace', 'backend'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'ignore',
    shell: true,
  });
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function visibleString(value) {
  return JSON.stringify(value ?? {});
}

function hasForbiddenVisibleText(value) {
  return forbiddenVisibleText.test(visibleString(value));
}

function hasSecret(value) {
  return secretText.test(visibleString(value));
}

function loadFrontendSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function extractPermissionLabels(source) {
  const match = source.match(/const permissionLabels: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!match) return new Set();
  return new Set([...match[1].matchAll(/'([^']+)':\s*'[^']+'/g)].map((item) => item[1]));
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }

  try {
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');

    const permissions = await request('GET', '/admin/permissions', { userId: 'test-admin', factoryId: factory.id });
    const pilotUi = loadFrontendSource('frontend/src/utils/pilot-ui.ts');
    const mappedPermissions = extractPermissionLabels(pilotUi);
    const unmapped = (permissions.data ?? []).map((item) => item.code).filter((code) => !mappedPermissions.has(code));
    record('all backend permission codes have Russian UI labels', permissions.status === 200 && unmapped.length === 0, { unmapped });
    record('permissions API has no secrets', permissions.status === 200 && !hasSecret(permissions.data), null);

    const context = await request('GET', `/admin/factories/${factory.id}/context`, { userId: 'test-admin', factoryId: factory.id });
    record('factory context loads for localization scan', context.status === 200 && context.data?.factory?.id === factory.id, context.data?.counts);
    const settingSummary = context.data?.moduleSettings?.flatMap((item) => item.summary ?? []) ?? [];
    record('module settings summary is Russian, not camelCase', settingSummary.length > 0 && !hasForbiddenVisibleText(settingSummary), settingSummary.slice(0, 8));
    const auditSummary = context.data?.recentAudit?.flatMap((item) => item.detailsSummary ?? []) ?? [];
    record('admin audit summary hides technical query names', !hasForbiddenVisibleText(auditSummary), auditSummary.slice(0, 8));
    record('factory context has no secrets', context.status === 200 && !hasSecret(context.data), null);

    const health = await request('GET', `/admin/factories/${factory.id}/config-health`, { userId: 'test-admin', factoryId: factory.id });
    const healthVisibleText = [
      ...(health.data?.positive ?? []),
      ...((health.data?.warnings ?? []).flatMap((item) => [item.title, item.detail, item.section, item.actionLabel])),
    ];
    record('config health visible fields are Russian', health.status === 200 && !hasForbiddenVisibleText(healthVisibleText), health.data?.warnings?.slice?.(0, 3));
    record('config health has no secrets', health.status === 200 && !hasSecret(health.data), null);

    const setupOptions = await request('GET', '/admin/factories/setup/options', { userId: 'test-admin', factoryId: factory.id });
    const setupVisibleText = (setupOptions.data?.categories ?? []).flatMap((item) => [item.label, item.description]);
    record('factory setup categories are Russian', setupOptions.status === 200 && !hasForbiddenVisibleText(setupVisibleText), setupVisibleText);

    const exported = await request('GET', `/admin/factories/${factory.id}/config-export`, { userId: 'test-admin', factoryId: factory.id });
    record('config export still works and hides secrets', exported.status === 200 && exported.data?.schemaVersion === 'factory-config-v1' && !hasSecret(exported.data), exported.data?.counts);

    const marker = Date.now().toString(36);
    const preview = await request('POST', '/admin/factories/config-import/preview', {
      userId: 'test-admin',
      factoryId: factory.id,
      body: { config: exported.data, target: { name: `Stage61 preview ${marker}`, code: `stage61-preview-${marker}` } },
    });
    record('config import preview warnings are Russian', preview.status === 201 && !hasForbiddenVisibleText([preview.data?.warnings, preview.data?.errors]), {
      warnings: preview.data?.warnings,
      errors: preview.data?.errors,
    });

    const recovery = await request('GET', `/admin/recovery?factoryId=${encodeURIComponent(factory.id)}`, { userId: 'test-admin', factoryId: factory.id });
    const recoveryVisibleText = (recovery.data?.items ?? []).flatMap((item) => [item.typeLabel, item.title, item.factoryName, item.departmentName, item.parentName, item.reason, item.deactivatedByName]);
    record('recovery center labels are Russian and no secrets', recovery.status === 200 && !hasForbiddenVisibleText(recoveryVisibleText) && !hasSecret(recovery.data), {
      total: recovery.data?.total,
    });

    const sourceHasMojibakePlaceholders = /reasonPlaceholder:\s*'\?{3,}/.test(loadFrontendSource('frontend/src/screens/AdminConfigScreen.tsx'));
    record('admin source has no mojibake reason placeholders', !sourceHasMojibakePlaceholders, null);
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(`\nStage61 admin Russian localization regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
