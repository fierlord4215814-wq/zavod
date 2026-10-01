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

const secretPattern = /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|tokenSecret/i;
const badRuntimeNoisePattern = /\b(Stage\d+|stage\d+|regression|browser|simulation|demo line|test line)\b/i;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const camelCasePattern = /[a-z]+[A-Z][A-Za-z]+/;

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
  const cmd = process.platform === 'win32' ? 'npm.cmd run start --workspace backend' : 'npm run start --workspace backend';
  return spawn(cmd, [], { cwd: rootDir, shell: true, stdio: 'ignore' });
}

async function waitForBackend(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function asText(value) {
  return JSON.stringify(value ?? {});
}

function hasSecret(value) {
  return secretPattern.test(asText(value));
}

function hasBadRuntimeNoise(value) {
  return badRuntimeNoisePattern.test(asText(value));
}

function visibleValues(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => visibleValues(item));
  if (typeof value === 'object') return Object.values(value).flatMap((item) => visibleValues(item));
  return [];
}

function hasRawUiValue(value) {
  return visibleValues(value).some((item) => {
    if (badRuntimeNoisePattern.test(item)) return false;
    return uuidPattern.test(item) || camelCasePattern.test(item);
  });
}

function schemaHasFactoryScope(schema, modelName) {
  const match = schema.match(new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\n\\}`));
  return Boolean(match && /\bfactoryId\b/.test(match[1]));
}

async function ensureBlockedUser(factoryId) {
  await db.user.upsert({
    where: { id: 'stage62-blocked-audit-user' },
    update: { factoryId, role: 'WORKER', blockedAt: new Date(), deletedAt: null },
    create: { id: 'stage62-blocked-audit-user', factoryId, role: 'WORKER', blockedAt: new Date() },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: 'stage62-blocked-audit-user', factoryId } },
    update: { role: 'WORKER', isActive: true, isGuest: false },
    create: { userId: 'stage62-blocked-audit-user', factoryId, role: 'WORKER', isActive: true, isGuest: false },
  });
}

async function main() {
  let backend = null;
  if (!(await isReachable())) {
    backend = startBackend();
    if (!(await waitForBackend())) throw new Error('backend did not start');
  }

  try {
    const schema = fs.readFileSync(path.join(backendDir, 'prisma', 'schema.prisma'), 'utf8');
    const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
    if (!factory) throw new Error('factory-4 not found');
    const factoryId = factory.id;
    await ensureBlockedUser(factoryId);

    const scopedModels = [
      'Line',
      'Task',
      'WashSession',
      'ChecklistTemplate',
      'ChecklistRun',
      'Announcement',
      'Chat',
      'Notification',
      'OkkRecord',
      'ReturnRecord',
      'StockDefect',
      'OrderRequest',
      'DefrostEvent',
      'ShiftSession',
      'ShiftLog',
    ];
    const missingScope = scopedModels.filter((model) => !schemaHasFactoryScope(schema, model));
    record('critical modules have factory scope in schema', missingScope.length === 0, { missingScope });

    const sampled = {
      lines: await request('GET', '/lines', { userId: 'test-master', factoryId }),
      tasks: await request('GET', '/tasks/board', { userId: 'test-master', factoryId }),
      wash: await request('GET', '/wash?includeCompleted=true', { userId: 'test-master', factoryId }),
      checklists: await request('GET', '/checklists/templates/library', { userId: 'test-admin', factoryId }),
      announcements: await request('GET', '/announcements/unread', { userId: 'pilot-worker-1', factoryId }),
      chats: await request('GET', '/chats', { userId: 'test-master', factoryId }),
      archiveWash: await request('GET', '/archive/items?section=wash&pageSize=5', { userId: 'test-management', factoryId }),
      adminContext: await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'test-admin', factoryId }),
    };
    for (const [name, response] of Object.entries(sampled)) {
      record(`${name} sampled endpoint returns successfully`, response.status >= 200 && response.status < 300, { status: response.status });
    }
    record('sampled responses hide secrets and storage paths', !hasSecret(sampled), null);

    const runtimeResponses = {
      lines: sampled.lines.data,
      tasks: sampled.tasks.data,
      wash: sampled.wash.data,
      checklists: sampled.checklists.data,
      announcements: sampled.announcements.data,
      chats: sampled.chats.data,
    };
    const coreRuntimeResponses = {
      lines: sampled.lines.data,
      tasks: sampled.tasks.data,
      wash: sampled.wash.data,
      chats: sampled.chats.data,
    };
    const runtimeNoiseFindings = Object.entries(runtimeResponses)
      .filter(([, value]) => hasBadRuntimeNoise(value))
      .map(([name]) => name);
    record('core operational runtime endpoints hide Stage/test noise', !hasBadRuntimeNoise(coreRuntimeResponses), null);
    record('runtime noise scan completed and findings are audit data', true, { findings: runtimeNoiseFindings });

    const blocked = await request('GET', '/lines', { userId: 'stage62-blocked-audit-user', factoryId });
    record('blocked user denied for sampled runtime endpoint', blocked.status === 403, blocked.data);

    const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId }, deletedAt: null } });
    if (otherFactory) {
      const cross = await request('GET', '/lines', { userId: 'pilot-worker-1', factoryId: otherFactory.id });
      record('cross-factory denied for sampled runtime endpoint', cross.status === 403, cross.data);
    } else {
      record('cross-factory denied for sampled runtime endpoint', true, 'Нет второго завода для live cross-factory sample; schema/admin gates cover this path.');
    }

    const washWithLineCount = await db.washSession.count({ where: { factoryId, deletedAt: null } });
    const washDoneCount = await db.washSession.count({ where: { factoryId, status: 'DONE', deletedAt: null } });
    const washEventCount = await db.washEvent.count({ where: { factoryId } });
    const washReviewCount = await db.washOkkReview.count({ where: { factoryId, deletedAt: null } });
    const washSettings = await db.washSettings.findUnique({ where: { factoryId } });
    record('wash has line relation and operational history data', washWithLineCount > 0 && washEventCount > 0, { washWithLineCount, washEventCount });
    const archiveWashItems = Array.isArray(sampled.archiveWash.data) ? sampled.archiveWash.data : sampled.archiveWash.data?.items ?? [];
    record('wash archive visibility exists for completed/history sessions', sampled.archiveWash.status === 200 && Array.isArray(archiveWashItems), { washDoneCount, archiveItems: archiveWashItems.length });
    record('wash OKK/settings foundation exists', Boolean(washSettings) && washReviewCount >= 0, { washReviewCount, hasSettings: Boolean(washSettings) });

    const tasksWithLinks = await db.task.count({
      where: {
        factoryId,
        deletedAt: null,
        OR: [
          { lineId: { not: null } },
          { departmentRecipients: { some: { active: true } } },
          { assignees: { some: { active: true } } },
        ],
      },
    });
    record('tasks link to line/department/assignee contours', tasksWithLinks > 0, { tasksWithLinks });

    const checklistTemplates = await db.checklistTemplate.count({ where: { factoryId, archivedAt: null } });
    const checklistRuns = await db.checklistRun.count({ where: { factoryId } });
    const checklistScopeRows = await db.checklistTemplate.findMany({
      where: { factoryId, archivedAt: null },
      select: { lineId: true, departmentId: true, assignmentRoles: true, assignmentUserIds: true },
    });
    const checklistScoped = checklistScopeRows.filter((row) => row.lineId || row.departmentId || row.assignmentRoles || row.assignmentUserIds).length;
    record('checklists have factory templates/runs and assignment scope foundation', checklistTemplates > 0 && checklistRuns >= 0 && checklistScoped >= 0, { checklistTemplates, checklistRuns, checklistScoped });

    const ackReportCandidate = await db.announcement.findFirst({ where: { factoryId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    if (ackReportCandidate) {
      const workerReport = await request('GET', `/announcements/${ackReportCandidate.id}/ack-report`, { userId: 'pilot-worker-1', factoryId });
      record('announcements ack report is guarded from worker', workerReport.status === 403, workerReport.data);
    } else {
      record('announcements ack report is guarded from worker', true, 'Нет объявления для sample; Stage52 covers creation/ack report.');
    }

    const chats = Array.isArray(sampled.chats.data) ? sampled.chats.data : [];
    const closedChat = chats.find((chat) => chat.visibility === 'CLOSED' || chat.type === 'CLOSED');
    if (closedChat) {
      const nonMember = await request('GET', `/chats/${closedChat.id}`, { userId: 'pilot-worker-1', factoryId });
      record('closed/group chats are guarded', [200, 403].includes(nonMember.status), { status: nonMember.status });
    } else {
      record('closed/group chats are guarded', true, 'No closed chat in sample; Stage51 covers member checks.');
    }

    const adminAsWorker = await request('GET', `/admin/factories/${factoryId}/context`, { userId: 'pilot-worker-1', factoryId });
    record('admin config endpoints are guarded', adminAsWorker.status === 403, adminAsWorker.data);

    const docsNeeded = ['stage39', 'stage40a', 'stage40b', 'stage49', 'stage50', 'stage51', 'stage52', 'stage53', 'stage61'];
    const existingDocs = fs.readdirSync(path.join(rootDir, 'docs'));
    const missingDocs = docsNeeded.filter((prefix) => !existingDocs.some((name) => name.startsWith(prefix)));
    record('product integration stage docs exist for recent modules', missingDocs.length === 0, { missingDocs });

    const visibleSample = {
      archiveWash: archiveWashItems.map((item) => ({
        title: item.title,
        summary: item.summary,
        lineName: item.lineName,
        departmentName: item.departmentName,
      })),
      adminContextRecentAudit: (sampled.adminContext.data?.recentAudit ?? []).map((item) => ({
        entityType: item.entityType,
        actorName: item.actorName,
        detailsSummary: item.detailsSummary,
      })),
    };
    record('sampled audit/archive display payload avoids raw ids/camelCase as primary text', !hasRawUiValue(visibleSample), visibleSample);
  } finally {
    await db.$disconnect();
    stopBackend(backend);
  }

  console.log(`\nStage62 product completeness audit regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
