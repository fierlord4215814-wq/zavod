const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
const runtimeReportDir = path.join(rootDir, '.codex-runtime', 'pilot-health-report');
const docsReportDir = path.join(rootDir, 'docs', 'pilot-health-report');
const apiBase = process.env.ZAVOD_API_URL || process.env.API_URL || 'http://127.0.0.1:3000';

const severityRank = { OK: 0, INFO: 1, WARNING: 2, P2: 3, P1: 4, P0: 5 };
const blockerSeverities = new Set(['P0', 'P1', 'P2']);
const forbiddenKeyRe = /passwordHash|storagePath|databaseUrl|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|authToken|tokenHash|secret/i;
const forbiddenValueRe = /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@|DATABASE_URL\s*=|JWT_SECRET\s*=|SESSION_SECRET\s*=|passwordHash\s*[:=]|storagePath\s*[:=]|Bearer\s+[A-Za-z0-9._~-]+/i;
const fixtureMarkerRe = /(stage\s*\d+|stage\d+|regression|fixture|simulation|browser\s+regression|\be2e\b|autotest|auto-test|demo|prepilot|pilot-smoke|diagnostic|smoke urgent task|quality cross factory)/i;
const isoDateRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

const pilotUsers = [
  { label: 'Гость', id: 'pilot-pack-guest', phone: '+79000009000', role: 'OTHER', isGuest: true },
  { label: 'Работник', id: 'pilot-worker-1', phone: '+79000004701', role: 'WORKER', isGuest: false },
  { label: 'Подрядчик', id: 'pilot-contractor-1', phone: '+79000004711', role: 'CONTRACTOR', isGuest: false },
  { label: 'Мастер', id: 'pilot-master-1', phone: '+79000004720', role: 'MASTER', isGuest: false },
  { label: 'Старший мастер', id: 'pilot-pack-senior-master', phone: '+79000009004', role: 'MASTER', isGuest: false },
  { label: 'КИПиА', id: 'pilot-tech-kipia-1', phone: '+79000004750', role: 'TECH_KIPIA', isGuest: false },
  { label: 'Начальник КИПиА', id: 'pilot-pack-kipia-lead', phone: '+79000009005', role: 'TECH_KIPIA', isGuest: false },
  { label: 'ОКК', id: 'pilot-okk-1', phone: '+79000004730', role: 'OKK', isGuest: false },
  { label: 'Склад', id: 'pilot-store-1', phone: '+79000004740', role: 'STORE', isGuest: false },
  { label: 'Руководство', id: 'pilot-pack-management', phone: '+79000009008', role: 'MANAGEMENT', isGuest: false },
  { label: 'ADMIN', id: 'pilot-pack-admin', phone: '+79000009009', role: 'ADMIN', isGuest: false },
];

const manualChecks = [
  'Реальный телефон: открыть приложение, войти и пройти основной маршрут.',
  'PWA install/offline: установить на телефон и проверить поведение без сети.',
  'Камера: сделать и приложить фото в реальном браузере телефона.',
  'Микрофон/voice notes: проверить запись голосового сообщения, если сценарий нужен в пилоте.',
  'Физический push/vibration: проверить на HTTPS/VAPID и реальном устройстве.',
  'Один живой маршрут мастера на смене: назначение людей, линия, простой, заявка, закрытие.',
];

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

function shortId(id) {
  if (!id || typeof id !== 'string') return null;
  return id.length <= 12 ? id : `${id.slice(0, 8)}...`;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function redact(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => {
    if (forbiddenKeyRe.test(key)) return '[redacted]';
    if (typeof inner === 'string' && forbiddenValueRe.test(inner)) return '[redacted]';
    return inner;
  }));
}

function hasForbidden(value) {
  const hits = [];
  function walk(node, trail) {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (forbiddenValueRe.test(node)) hits.push(`${trail}: sensitive value`);
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, inner] of Object.entries(node)) {
      if (forbiddenKeyRe.test(key)) hits.push(`${trail}.${key}: forbidden key`);
      walk(inner, trail ? `${trail}.${key}` : key);
    }
  }
  walk(value, '$');
  return hits;
}

function hasFixtureMarker(value) {
  if (typeof value !== 'string') return false;
  if (uuidRe.test(value) || isoDateRe.test(value)) return false;
  return fixtureMarkerRe.test(value);
}

function scanForMarkers(value, hits = [], trail = '$') {
  if (typeof value === 'string') {
    if (hasFixtureMarker(value)) hits.push({ path: trail, value: value.slice(0, 80) });
    return hits;
  }
  if (Array.isArray(value)) {
    value.slice(0, 80).forEach((item, index) => scanForMarkers(item, hits, `${trail}[${index}]`));
    return hits;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) scanForMarkers(inner, hits, `${trail}.${key}`);
  }
  return hits;
}

function commandName(name) {
  return process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name;
}

function runCommand(name, args, options = {}) {
  const result = spawnSync(commandName(name), args, {
    cwd: options.cwd ?? backendDir,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 60_000,
    shell: false,
  });
  const stdout = String(result.stdout ?? '').split(/\r?\n/).filter(Boolean).slice(-6).join('\n');
  const stderr = String(result.stderr ?? '').split(/\r?\n/).filter(Boolean).slice(-6).join('\n');
  return {
    status: result.status,
    signal: result.signal,
    stdout: redact(stdout),
    stderr: redact(stderr),
    error: result.error ? result.error.message : null,
  };
}

async function request(pathname, { userId, factoryId } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  const response = await fetch(`${apiBase}${pathname}`, { headers, signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, data };
}

async function safeCount(db, model, args = {}) {
  try {
    return await db[model].count(args);
  } catch (error) {
    return { error: error.message };
  }
}

function section(report, code, title) {
  const item = { code, title, checks: [] };
  report.sections.push(item);
  return item;
}

function addCheck(sec, code, title, severity, message, evidence = {}, suggestedAction = null, affectedIds = []) {
  sec.checks.push({
    code,
    title,
    severity,
    message,
    evidence: redact(evidence),
    affectedIds: affectedIds.map(shortId).filter(Boolean).slice(0, 12),
    suggestedAction,
  });
}

function classifyCount(count, okMessage, warningMessage, blockerMessage = null, severity = 'WARNING') {
  if (count === 0) return { severity: 'OK', message: okMessage };
  if (blockerMessage) return { severity, message: blockerMessage };
  return { severity, message: warningMessage };
}

async function addSystemChecks(report, db, options) {
  const sec = section(report, 'system', 'Система');
  try {
    await db.$queryRawUnsafe('SELECT 1');
    addCheck(sec, 'system.database', 'База данных доступна', 'OK', 'База данных отвечает на read-only запрос.');
  } catch (error) {
    addCheck(sec, 'system.database', 'База данных доступна', 'P0', 'База данных недоступна, идти в пилот нельзя.', { error: error.message }, 'Проверить DATABASE_URL и запущенный PostgreSQL.');
    return;
  }

  try {
    const health = await request('/health');
    const severity = health.status === 200 ? 'OK' : 'WARNING';
    addCheck(sec, 'system.backend-health', 'Backend health', severity, health.status === 200 ? 'Backend /health отвечает.' : 'Backend /health не вернул 200. Если self-check запущен без backend, запустите backend перед пилотом.', { status: health.status });
    const leaks = hasForbidden(health.data);
    addCheck(sec, 'system.health-clean', 'Health без чувствительных данных', leaks.length ? 'P1' : 'OK', leaks.length ? 'Health payload содержит чувствительные технические поля.' : 'Health payload не содержит чувствительных данных.', { leaks: leaks.slice(0, 8) });
  } catch (error) {
    addCheck(sec, 'system.backend-health', 'Backend health', 'WARNING', 'Backend /health сейчас недоступен. Это не меняет данные, но перед ручным пилотом backend надо поднять.', { error: error.message }, 'Запустить backend и повторить self-check.');
  }

  const requiredEnv = ['DATABASE_URL'];
  const envEvidence = {
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    authSigningConfigured: Boolean(process.env.JWT_SECRET || process.env.SESSION_SECRET),
  };
  const missing = requiredEnv.filter((key) => !process.env[key]);
  addCheck(sec, 'system.required-env', 'Обязательные env-переменные', missing.length ? 'P1' : 'OK', missing.length ? 'Не найдены обязательные env-переменные. Значения не выводятся.' : 'Обязательные env-переменные присутствуют. Значения не выводятся.', envEvidence, missing.length ? 'Проверить подключение к БД в backend/.env без вывода значения.' : null);
  addCheck(sec, 'system.auth-signing-env', 'Секрет подписи авторизации', envEvidence.authSigningConfigured ? 'OK' : 'WARNING', envEvidence.authSigningConfigured ? 'Секрет подписи авторизации задан. Значение не выводится.' : 'Секрет подписи авторизации не задан, backend использует dev fallback. Для закрытого локального pilot это warning, для production-like доступа нужно задать отдельный секрет.', envEvidence, envEvidence.authSigningConfigured ? null : 'Задать секрет подписи авторизации отдельным безопасным решением, без вывода значения.');
  addCheck(sec, 'system.file-storage-root', 'Canonical uploads root', process.env.FILE_STORAGE_ROOT ? 'OK' : 'WARNING', process.env.FILE_STORAGE_ROOT ? 'FILE_STORAGE_ROOT задан. Значение не выводится.' : 'FILE_STORAGE_ROOT не задан, backend может зависеть от cwd.', { present: Boolean(process.env.FILE_STORAGE_ROOT) }, process.env.FILE_STORAGE_ROOT ? null : 'Задать FILE_STORAGE_ROOT перед production-like pilot.');

  if (options.includePrismaChecks !== false) {
    const validate = runCommand(process.execPath, ['./node_modules/prisma/build/index.js', 'validate', '--schema', 'prisma/schema.prisma'], { timeoutMs: 90_000 });
    addCheck(sec, 'system.prisma-validate', 'Prisma validate', validate.status === 0 ? 'OK' : 'P1', validate.status === 0 ? 'Prisma schema валидна.' : 'Prisma validate упал.', { status: validate.status, stderr: validate.stderr }, validate.status === 0 ? null : 'Починить Prisma schema до пилота.');
    const migrate = runCommand(process.execPath, ['./node_modules/prisma/build/index.js', 'migrate', 'status', '--schema', 'prisma/schema.prisma'], { timeoutMs: 90_000 });
    addCheck(sec, 'system.prisma-migrate-status', 'Prisma migrate status', migrate.status === 0 ? 'OK' : 'P1', migrate.status === 0 ? 'Миграции в актуальном состоянии.' : 'Prisma migrate status сообщил проблему.', { status: migrate.status, stderr: migrate.stderr }, migrate.status === 0 ? null : 'Проверить статус миграций без reset/drop.');
    const seedCheck = runCommand(process.execPath, ['--check', 'prisma/seed.js'], { timeoutMs: 60_000 });
    addCheck(sec, 'system.seed-syntax', 'Seed syntax', seedCheck.status === 0 ? 'OK' : 'P2', seedCheck.status === 0 ? 'backend/prisma/seed.js синтаксически корректен.' : 'Seed script имеет синтаксическую ошибку.', { status: seedCheck.status, stderr: seedCheck.stderr }, seedCheck.status === 0 ? null : 'Исправить синтаксис seed без запуска reset.');
  }
}

async function addPilotPackChecks(report, db) {
  const sec = section(report, 'pilot-pack', 'Pilot-pack Завод 4');
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true, name: true, code: true, isActive: true, deletedAt: true, deactivatedAt: true } });
  if (!factory || !factory.isActive || factory.deletedAt || factory.deactivatedAt) {
    addCheck(sec, 'pilot.factory-4', 'Завод 4 активен', 'P1', 'Завод 4 не найден или не активен.', { found: Boolean(factory), active: factory?.isActive ?? false }, 'Запустить штатный idempotent pilot-pack:v1.');
    return null;
  }
  addCheck(sec, 'pilot.factory-4', 'Завод 4 активен', 'OK', 'Завод 4 найден и активен.', { name: factory.name, code: factory.code });

  const phones = pilotUsers.map((user) => user.phone);
  const users = await db.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true, phone: true, role: true, blockedAt: true, deletedAt: true, factoryAccess: { where: { factoryId: factory.id }, select: { role: true, isGuest: true, isActive: true, departmentId: true, jobTitleId: true } } },
  });
  const duplicates = phones
    .map((phone) => ({ phone, count: users.filter((user) => user.phone === phone).length }))
    .filter((item) => item.count > 1);
  addCheck(sec, 'pilot.phone-duplicates', 'Телефоны без дублей', duplicates.length ? 'P1' : 'OK', duplicates.length ? 'Есть дубли pilot-pack телефонов.' : 'Дублей pilot-pack телефонов не найдено.', { duplicates });

  const invalid = [];
  for (const expected of pilotUsers) {
    const user = users.find((item) => item.phone === expected.phone);
    const access = user?.factoryAccess?.[0];
    const ok = user && !user.blockedAt && !user.deletedAt && access?.isActive && access.role === expected.role && access.isGuest === expected.isGuest;
    if (!ok) invalid.push({ label: expected.label, phone: expected.phone, role: access?.role ?? user?.role ?? null, isGuest: access?.isGuest ?? null, activeAccess: Boolean(access?.isActive), blocked: Boolean(user?.blockedAt), deleted: Boolean(user?.deletedAt) });
  }
  addCheck(sec, 'pilot.users-active', 'Пользователи pilot-pack активны', invalid.length ? 'P1' : 'OK', invalid.length ? 'Часть pilot-pack пользователей отсутствует или имеет неверный доступ.' : 'Все pilot-pack пользователи найдены, активны и имеют ожидаемый доступ к Заводу 4.', { expected: pilotUsers.length, invalid }, invalid.length ? 'Запустить штатный idempotent pilot-pack:v1, не создавать дублей вручную.' : null);
  const guest = users.find((item) => item.phone === '+79000009000');
  const guestAccess = guest?.factoryAccess?.[0];
  addCheck(sec, 'pilot.guest-limited', 'Гость ограничен', guest && guestAccess?.isGuest && guestAccess.role === 'OTHER' ? 'OK' : 'P1', guest && guestAccess?.isGuest && guestAccess.role === 'OTHER' ? 'Гость имеет гостевой доступ и роль OTHER.' : 'Гостевой пользователь не выглядит ограниченным.', { phone: '+79000009000', role: guestAccess?.role ?? null, isGuest: guestAccess?.isGuest ?? null });
  return factory;
}

async function addShiftPeopleChecks(report, db, factory) {
  const sec = section(report, 'shift-people', 'Смены и люди');
  if (!factory) {
    addCheck(sec, 'shift.factory-context', 'Контекст завода', 'P1', 'Смены не проверены: Завод 4 не найден.');
    return;
  }
  const [activeShifts, recentEndedShifts, activeAssignments, duplicateAssignments, blockedAssigned, visibleUsers] = await Promise.all([
    db.shiftSession.count({ where: { factoryId: factory.id, status: 'ACTIVE' } }),
    db.shiftSession.count({ where: { factoryId: factory.id, status: { in: ['ENDED', 'AUTO_CLOSED'] }, endedAt: { gte: daysAgo(7) } } }),
    db.assignment.count({ where: { factoryId: factory.id, endedAt: null } }),
    db.assignment.groupBy({ by: ['userId'], where: { factoryId: factory.id, endedAt: null }, _count: { _all: true }, having: { userId: { _count: { gt: 1 } } } }),
    db.assignment.count({ where: { factoryId: factory.id, endedAt: null, user: { OR: [{ blockedAt: { not: null } }, { deletedAt: { not: null } }] } } }),
    db.userFactoryAccess.count({ where: { factoryId: factory.id, isActive: true, user: { blockedAt: null, deletedAt: null } } }),
  ]);
  addCheck(sec, 'shift.active-context', 'Текущая смена', activeShifts > 1 ? 'WARNING' : 'INFO', activeShifts > 1 ? 'Найдено больше одной активной смены. Проверьте вручную перед пилотом.' : 'Состояние активной смены посчитано.', { activeShifts, recentEndedShifts });
  addCheck(sec, 'people.active-assignments', 'Активные назначения', duplicateAssignments.length ? 'WARNING' : 'OK', duplicateAssignments.length ? 'Есть пользователи с несколькими активными назначениями. Это может быть допустимо только для разных типов, проверьте вручную.' : 'Явных дублей активных назначений по пользователю не найдено.', { activeAssignments, duplicateUsers: duplicateAssignments.length, visibleUsers }, 'Если дубли не ожидаются, снять лишнее назначение штатно.', duplicateAssignments.map((item) => item.userId));
  addCheck(sec, 'people.blocked-assigned', 'Заблокированные в активных назначениях', blockedAssigned ? 'P2' : 'OK', blockedAssigned ? 'Заблокированные/удалённые пользователи есть в активных назначениях.' : 'Заблокированные/удалённые пользователи не числятся в активных назначениях.', { blockedAssigned }, blockedAssigned ? 'Проверить назначения через смену, без физического удаления истории.' : null);
}

async function addLineDowntimeChecks(report, db, factory) {
  const sec = section(report, 'lines-downtime', 'Линии и простои');
  if (!factory) return addCheck(sec, 'lines.factory-context', 'Контекст завода', 'P1', 'Линии не проверены: Завод 4 не найден.');
  const [activeLines, stoppedLines, impossibleIntervals, workLinesWithRecentStop, oldOpenLatest] = await Promise.all([
    db.line.count({ where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null, status: 'WORK' } }),
    db.line.count({ where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null, status: { in: ['PAUSE', 'STOP'] } } }),
    db.lineEvent.findMany({ where: { factoryId: factory.id, correctedStartAt: { not: null }, correctedEndAt: { not: null } }, select: { id: true, correctedStartAt: true, correctedEndAt: true } }),
    db.line.findMany({ where: { factoryId: factory.id, deletedAt: null, deactivatedAt: null, status: 'WORK', events: { some: { status: { in: ['PAUSE', 'STOP'] }, createdAt: { gte: hoursAgo(12) } } } }, select: { id: true, name: true, status: true } }),
    db.lineEvent.findMany({
      where: { factoryId: factory.id, status: { in: ['PAUSE', 'STOP'] }, createdAt: { lt: daysAgo(1) } },
      select: { id: true, lineId: true, status: true, createdAt: true, line: { select: { id: true, name: true, status: true, deletedAt: true, deactivatedAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
  ]);
  const negativeIntervals = impossibleIntervals.filter((item) => new Date(item.correctedEndAt).getTime() < new Date(item.correctedStartAt).getTime());
  addCheck(sec, 'lines.counts', 'Счётчики линий', 'INFO', 'Счётчики активных и остановленных линий посчитаны.', { activeLines, stoppedLines });
  addCheck(sec, 'lines.negative-durations', 'Нет отрицательных длительностей', negativeIntervals.length ? 'P1' : 'OK', negativeIntervals.length ? 'Есть corrected interval с отрицательной длительностью.' : 'Отрицательные corrected intervals не найдены.', { count: negativeIntervals.length }, negativeIntervals.length ? 'Проверить корректировку простоя вручную.' : null, negativeIntervals.map((item) => item.id));
  const suspiciousWork = workLinesWithRecentStop.length;
  addCheck(sec, 'lines.work-recent-stop', 'WORK не выглядит как открытый простой', suspiciousWork ? 'WARNING' : 'OK', suspiciousWork ? 'У работающих линий есть свежие STOP/PAUSE события. Это может быть нормальной историей, но стоит проверить активный статус.' : 'Не найдено явных конфликтов WORK со свежими STOP/PAUSE событиями.', { suspiciousWork }, suspiciousWork ? 'Проверить карточки линий перед пилотом.' : null, workLinesWithRecentStop.map((item) => item.id));
  const oldOpen = oldOpenLatest.filter((event) => event.line && !event.line.deletedAt && !event.line.deactivatedAt && event.line.status !== 'WORK');
  addCheck(sec, 'lines.old-open-downtime', 'Старые открытые простои', oldOpen.length ? 'WARNING' : 'OK', oldOpen.length ? 'Найдены старые остановленные/простаивающие линии дольше 24 часов. Это предупреждение, cleanup не выполняется.' : 'Старых открытых простоев дольше 24 часов не найдено.', { count: oldOpen.length }, oldOpen.length ? 'Проверить перед пилотом: возможно, линию надо штатно вернуть в работу или закрыть простой.' : null, oldOpen.map((item) => item.id));
}

async function addTaskChecks(report, db, factory) {
  const sec = section(report, 'tasks', 'Заявки');
  if (!factory) return addCheck(sec, 'tasks.factory-context', 'Контекст завода', 'P1', 'Заявки не проверены: Завод 4 не найден.');
  const [activeTasks, oldOpen, overdueLong, doneWithoutStarted, downtimeTaskLeaks, markedTasks] = await Promise.all([
    db.task.count({ where: { factoryId: factory.id, deletedAt: null, archivedAt: null, status: { in: ['NEW', 'IN_PROGRESS'] } } }),
    db.task.findMany({ where: { factoryId: factory.id, deletedAt: null, archivedAt: null, status: { in: ['NEW', 'IN_PROGRESS'] }, createdAt: { lt: daysAgo(3) } }, select: { id: true, status: true, type: true, createdAt: true }, take: 30 }),
    db.task.count({ where: { factoryId: factory.id, deletedAt: null, archivedAt: null, type: 'LONG', status: { in: ['NEW', 'IN_PROGRESS'] }, deadlineAt: { lt: new Date() } } }),
    db.task.count({ where: { factoryId: factory.id, deletedAt: null, status: 'DONE', OR: [{ startedAt: null }, { takenById: null }] } }),
    db.task.count({ where: { factoryId: factory.id, lineStatusEventId: { not: null }, lineId: null } }),
    db.task.findMany({ where: { factoryId: factory.id, deletedAt: null, archivedAt: null }, select: { id: true, description: true, priority: true, operationId: true }, take: 500 }),
  ]);
  const markerHits = markedTasks.filter((item) => [item.id, item.description, item.priority, item.operationId].some(hasFixtureMarker));
  addCheck(sec, 'tasks.active-counts', 'Активные заявки', 'INFO', 'Активные заявки посчитаны.', { activeTasks, overdueLong });
  addCheck(sec, 'tasks.old-open', 'Старые открытые заявки', oldOpen.length ? 'WARNING' : 'OK', oldOpen.length ? 'Есть открытые заявки старше 3 дней. Это ручная проверка, не cleanup.' : 'Старых открытых заявок старше 3 дней не найдено.', { count: oldOpen.length }, oldOpen.length ? 'Проверить доску заявок и закрыть штатно, если задача уже не актуальна.' : null, oldOpen.map((item) => item.id));
  addCheck(sec, 'tasks.long-overdue', 'Просроченные LONG', overdueLong ? 'WARNING' : 'OK', overdueLong ? 'Есть просроченные LONG заявки.' : 'Просроченных LONG заявок не найдено.', { overdueLong }, overdueLong ? 'Проверить ответственных и сроки.' : null);
  addCheck(sec, 'tasks.done-shape', 'DONE не ломает метрики', doneWithoutStarted ? 'WARNING' : 'OK', doneWithoutStarted ? 'Есть DONE без startedAt/takenById. Это может искажать реакцию/решение.' : 'DONE заявки имеют ожидаемую форму для метрик.', { doneWithoutStarted }, doneWithoutStarted ? 'Проверить историю этих заявок вручную.' : null);
  addCheck(sec, 'tasks.downtime-link', 'Связь заявка-простой корректна', downtimeTaskLeaks ? 'P2' : 'OK', downtimeTaskLeaks ? 'Есть заявки с lineStatusEventId без lineId.' : 'Заявки из простоя имеют lineId + lineStatusEventId.', { downtimeTaskLeaks }, downtimeTaskLeaks ? 'Исправить связь read-model/данных без удаления истории.' : null);
  addCheck(sec, 'tasks.runtime-markers', 'Нет stage/test задач в runtime', markerHits.length ? 'WARNING' : 'OK', markerHits.length ? 'В активных заявках найдены диагностические маркеры. Проверьте, не видны ли они в обычном runtime.' : 'Явных stage/test marker задач в активном runtime не найдено.', { markerHits: markerHits.length }, markerHits.length ? 'Если это реальные ручные записи, оставить; если fixture, скрыть штатной логикой.' : null, markerHits.map((item) => item.id));
}

async function addChecklistChecks(report, db, factory) {
  const sec = section(report, 'checklists', 'Чек-листы');
  if (!factory) return addCheck(sec, 'checklists.factory-context', 'Контекст завода', 'P1', 'Чек-листы не проверены: Завод 4 не найден.');
  const [activeRuns, staleRuns, oldPeriodic, activeTemplates, markedTemplates] = await Promise.all([
    db.checklistRun.count({ where: { factoryId: factory.id, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    db.checklistRun.findMany({ where: { factoryId: factory.id, status: { in: ['ACTIVE', 'PAUSED'] }, startedAt: { lt: daysAgo(2) } }, select: { id: true, startedAt: true, status: true, templateId: true }, take: 30 }),
    db.checklistRun.count({ where: { factoryId: factory.id, status: { in: ['ACTIVE', 'PAUSED'] }, nextCheckAt: { lt: hoursAgo(12) } } }),
    db.checklistTemplate.count({ where: { factoryId: factory.id, isActive: true, archivedAt: null } }),
    db.checklistTemplate.findMany({ where: { factoryId: factory.id, isActive: true, archivedAt: null }, select: { id: true, name: true, description: true }, take: 300 }),
  ]);
  const markerHits = markedTemplates.filter((item) => [item.id, item.name, item.description].some(hasFixtureMarker));
  addCheck(sec, 'checklists.templates', 'Активные шаблоны', 'INFO', 'Активные шаблоны чек-листов посчитаны.', { activeTemplates });
  addCheck(sec, 'checklists.stale-runs', 'Нет зависших запусков', staleRuns.length ? 'WARNING' : 'OK', staleRuns.length ? 'Есть активные/paused чек-листы старше 2 дней. Это предупреждение, автозакрытие не выполняется.' : 'Зависших активных чек-листов старше 2 дней не найдено.', { activeRuns, staleRuns: staleRuns.length, oldPeriodic }, staleRuns.length ? 'Проверить раздел чек-листов и закрыть штатно при необходимости.' : null, staleRuns.map((item) => item.id));
  addCheck(sec, 'checklists.runtime-markers', 'Нет stage/test чек-листов в active library', markerHits.length ? 'WARNING' : 'OK', markerHits.length ? 'В активных шаблонах найдены диагностические маркеры.' : 'Диагностические маркеры в активных шаблонах не найдены.', { markerHits: markerHits.length }, markerHits.length ? 'Проверить видимость шаблонов в runtime.' : null, markerHits.map((item) => item.id));
}

async function addStockOrderChecks(report, db, factory) {
  const sec = section(report, 'stock-orders', 'Остатки и заказы');
  if (!factory) return addCheck(sec, 'stock.factory-context', 'Контекст завода', 'P1', 'Остатки не проверены: Завод 4 не найден.');
  const [activeItems, negativeItems, lowItems, openOrders, duplicateOpenOrders] = await Promise.all([
    db.minimumStockItem.count({ where: { factoryId: factory.id, isActive: true, archivedAt: null } }),
    db.minimumStockItem.findMany({ where: { factoryId: factory.id, isActive: true, archivedAt: null, OR: [{ currentQuantity: { lt: 0 } }, { minThreshold: { lt: 0 } }] }, select: { id: true, name: true, currentQuantity: true, minThreshold: true }, take: 30 }),
    db.minimumStockItem.count({ where: { factoryId: factory.id, isActive: true, archivedAt: null, currentQuantity: { lt: 1 } } }),
    db.orderRequest.count({ where: { factoryId: factory.id, status: { in: ['ACTIVE', 'ORDERED'] } } }),
    db.orderRequest.groupBy({ by: ['sourceItemId'], where: { factoryId: factory.id, status: { in: ['ACTIVE', 'ORDERED'] }, sourceItemId: { not: null } }, _count: { _all: true }, having: { sourceItemId: { _count: { gt: 1 } } } }),
  ]);
  addCheck(sec, 'stock.counts', 'Остатки и открытые заказы', 'INFO', 'Остатки и открытые заказы посчитаны.', { activeItems, lowItems, openOrders });
  addCheck(sec, 'stock.non-negative', 'Количество не отрицательное', negativeItems.length ? 'P2' : 'OK', negativeItems.length ? 'Есть отрицательные остатки или минимумы.' : 'Отрицательные остатки/минимумы не найдены.', { count: negativeItems.length }, negativeItems.length ? 'Проверить позиции через раздел Остатки/Заказы.' : null, negativeItems.map((item) => item.id));
  addCheck(sec, 'orders.no-duplicate-open', 'Открытые заказы без дублей по остатку', duplicateOpenOrders.length ? 'WARNING' : 'OK', duplicateOpenOrders.length ? 'Есть несколько открытых заказов на одну позицию остатка.' : 'Дубли открытых заказов по одной позиции не найдены.', { duplicateItems: duplicateOpenOrders.length }, duplicateOpenOrders.length ? 'Проверить вручную, не закрывая автоматически.' : null, duplicateOpenOrders.map((item) => item.sourceItemId));
}

async function addQualityChecks(report, db, factory) {
  const sec = section(report, 'quality', 'ОКК, некондиция и возвраты');
  if (!factory) return addCheck(sec, 'quality.factory-context', 'Контекст завода', 'P1', 'Качество не проверено: Завод 4 не найден.');
  const [activeOkk, activeStock, invalidStock, invalidStockUnit, activeReturns] = await Promise.all([
    db.okkRecord.count({ where: { factoryId: factory.id, deletedAt: null, archivedAt: null, status: { not: 'ARCHIVED' } } }),
    db.stockDefect.count({ where: { factoryId: factory.id, deletedAt: null, status: { not: 'ARCHIVED' } } }),
    db.stockDefect.findMany({ where: { factoryId: factory.id, deletedAt: null, quantity: { lte: 0 } }, select: { id: true, quantity: true, unit: true }, take: 30 }),
    db.stockDefect.findMany({ where: { factoryId: factory.id, deletedAt: null, unit: { not: null, notIn: ['штуки', 'гофры', 'шт', 'гофр'] } }, select: { id: true, quantity: true, unit: true }, take: 30 }),
    db.returnRecord.count({ where: { factoryId: factory.id, deletedAt: null, archivedAt: null, status: { not: 'ARCHIVED' } } }),
  ]);
  addCheck(sec, 'quality.counts', 'Активные записи качества', 'INFO', 'Записи ОКК, некондиции и возвратов посчитаны.', { activeOkk, activeStock, activeReturns });
  addCheck(sec, 'stock-defects.quantity-positive', 'Некондиция с положительным количеством', invalidStock.length ? 'P2' : 'OK', invalidStock.length ? 'Есть некондиция с количеством меньше или равно нулю.' : 'Некондиция с неположительным количеством не найдена.', { invalidStock: invalidStock.length }, invalidStock.length ? 'Проверить записи склада штатно.' : null, invalidStock.map((item) => item.id));
  addCheck(sec, 'stock-defects.unit-known', 'Единицы некондиции понятны', invalidStockUnit.length ? 'WARNING' : 'OK', invalidStockUnit.length ? 'Есть записи некондиции с нестандартной единицей. Старые записи допустимы, но стоит посмотреть перед пилотом.' : 'Единицы некондиции выглядят ожидаемо.', { invalidStockUnit: invalidStockUnit.length }, invalidStockUnit.length ? 'Проверить старые записи, без автоправки.' : null, invalidStockUnit.map((item) => item.id));
}

async function addWashChecks(report, db, factory) {
  const sec = section(report, 'wash', 'Мойка');
  if (!factory) return addCheck(sec, 'wash.factory-context', 'Контекст завода', 'P1', 'Мойка не проверена: Завод 4 не найден.');
  const [activeWash, staleWash, openIssues, openMiniTasks] = await Promise.all([
    db.washSession.count({ where: { factoryId: factory.id, deletedAt: null, status: { in: ['IN_PROGRESS', 'REVIEW'] } } }),
    db.washSession.findMany({ where: { factoryId: factory.id, deletedAt: null, status: { in: ['IN_PROGRESS', 'REVIEW'] }, createdAt: { lt: daysAgo(1) } }, select: { id: true, lineId: true, status: true, createdAt: true }, take: 30 }),
    db.washIssue.count({ where: { factoryId: factory.id, isResolved: false } }),
    db.washControlItem.count({ where: { factoryId: factory.id, deletedAt: null, status: { notIn: ['DONE', 'CLOSED'] } } }),
  ]);
  addCheck(sec, 'wash.active-counts', 'Активная мойка и контроль', 'INFO', 'Активные мойки, замечания и мини-задания посчитаны.', { activeWash, openIssues, openMiniTasks });
  addCheck(sec, 'wash.stale', 'Нет зависшей мойки старше суток', staleWash.length ? 'WARNING' : 'OK', staleWash.length ? 'Есть активная мойка старше 24 часов. Это ручная проверка.' : 'Зависшей активной мойки старше 24 часов не найдено.', { staleWash: staleWash.length }, staleWash.length ? 'Проверить мойку и закрыть штатно при необходимости.' : null, staleWash.map((item) => item.id));
}

async function addDefrostChecks(report, db, factory) {
  const sec = section(report, 'defrost', 'Оттайка и обдувы');
  if (!factory) return addCheck(sec, 'defrost.factory-context', 'Контекст завода', 'P1', 'Оттайка не проверена: Завод 4 не найден.');
  const [activeDefrost, staleDefrost, blowEvents] = await Promise.all([
    db.defrostEvent.count({ where: { factoryId: factory.id, status: 'ACTIVE', eventType: 'DEFROST' } }),
    db.defrostEvent.findMany({ where: { factoryId: factory.id, status: 'ACTIVE', eventType: 'DEFROST', startAt: { lt: daysAgo(1) } }, select: { id: true, lineId: true, startAt: true }, take: 30 }),
    db.defrostEvent.findMany({ where: { factoryId: factory.id, eventType: 'SHOCK_CHAMBER_BLOWN' }, select: { id: true, lineId: true, startAt: true }, orderBy: { startAt: 'desc' }, take: 400 }),
  ]);
  const blowByLine = new Map();
  for (const event of blowEvents) blowByLine.set(event.lineId, (blowByLine.get(event.lineId) ?? 0) + 1);
  const warningLines = [...blowByLine.entries()].filter(([, count]) => count >= 4);
  addCheck(sec, 'defrost.active-counts', 'Активные оттайки', 'INFO', 'Активные оттайки и обдувы посчитаны.', { activeDefrost, blowEvents: blowEvents.length });
  addCheck(sec, 'defrost.stale', 'Нет зависшей оттайки старше суток', staleDefrost.length ? 'WARNING' : 'OK', staleDefrost.length ? 'Есть активная оттайка старше 24 часов.' : 'Зависшей оттайки старше 24 часов не найдено.', { staleDefrost: staleDefrost.length }, staleDefrost.length ? 'Проверить холодильную службу вручную.' : null, staleDefrost.map((item) => item.id));
  addCheck(sec, 'defrost.blow-warning', 'Обдувы не считаются оттайкой', warningLines.length ? 'WARNING' : 'OK', warningLines.length ? 'Есть линии с 4+ обдувами в истории sample. Это warning, не blocker.' : 'Нет линий с 4+ обдувами в sample.', { warningLines: warningLines.length }, warningLines.length ? 'Проверить, нужна ли плановая оттайка.' : null, warningLines.map(([lineId]) => lineId));
}

async function addAnnouncementLogNotificationChecks(report, db, factory) {
  const sec = section(report, 'announcements-log-notifications', 'Объявления, пересменка и уведомления');
  if (!factory) return addCheck(sec, 'announce.factory-context', 'Контекст завода', 'P1', 'Объявления не проверены: Завод 4 не найден.');
  const [unreadAnnouncements, duplicateReads, expiredVisible, badShiftLogs, crossFactoryNotifications] = await Promise.all([
    db.announcement.count({ where: { factoryId: factory.id, archivedAt: null, deletedAt: null, visibleUntil: { gt: new Date() } } }),
    db.announcementRead.groupBy({ by: ['announcementId', 'userId'], _count: { _all: true }, having: { announcementId: { _count: { gt: 1 } } } }).catch(() => []),
    db.announcement.count({ where: { factoryId: factory.id, archivedAt: null, deletedAt: null, visibleUntil: { lt: new Date() } } }),
    db.shiftLog.findMany({ where: { factoryId: factory.id, isDeleted: false, status: 'ACTIVE', OR: [{ logDate: null }, { shiftLabel: null }] }, select: { id: true, logDate: true, shiftLabel: true }, take: 30 }),
    db.notification.count({ where: { factoryId: { not: factory.id }, userId: { in: pilotUsers.map((user) => user.id) } } }),
  ]);
  addCheck(sec, 'announcements.active-counts', 'Активные объявления', 'INFO', 'Активные объявления посчитаны.', { unreadAnnouncements });
  addCheck(sec, 'announcements.read-duplicates', 'Ознакомления без дублей', duplicateReads.length ? 'P2' : 'OK', duplicateReads.length ? 'Есть дубли AnnouncementRead.' : 'Дубли AnnouncementRead не найдены.', { duplicateReads: duplicateReads.length }, duplicateReads.length ? 'Проверить уникальность acknowledgement без удаления истории.' : null, duplicateReads.map((item) => item.announcementId));
  addCheck(sec, 'announcements.expired-hidden', 'Истёкшие объявления не active runtime', expiredVisible ? 'WARNING' : 'OK', expiredVisible ? 'Есть истёкшие неархивные объявления. Проверьте, скрывает ли runtime их правильно.' : 'Истёкшие активные объявления не найдены.', { expiredVisible }, expiredVisible ? 'Проверить список объявлений; архивировать штатно при необходимости.' : null);
  addCheck(sec, 'shift-log.shape', 'Пересменка имеет дату и смену', badShiftLogs.length ? 'WARNING' : 'OK', badShiftLogs.length ? 'Есть активные записи пересменки без даты или смены.' : 'Активные записи пересменки имеют дату/смену.', { badShiftLogs: badShiftLogs.length }, badShiftLogs.length ? 'Проверить старые записи журнала.' : null, badShiftLogs.map((item) => item.id));
  addCheck(sec, 'notifications.cross-factory', 'Уведомления без очевидного cross-factory', crossFactoryNotifications ? 'WARNING' : 'OK', crossFactoryNotifications ? 'Есть уведомления pilot users с другим factoryId. Это может быть историей, проверьте вручную.' : 'Не найдено уведомлений pilot users с чужим factoryId.', { crossFactoryNotifications });
}

async function addArchiveStatisticsAuditChecks(report, db, factory) {
  const sec = section(report, 'archive-statistics-audit', 'Архив, статистика и аудит');
  if (!factory) return addCheck(sec, 'archive.factory-context', 'Контекст завода', 'P1', 'Архив/статистика не проверены: Завод 4 не найден.');
  const [auditCount, accessDeniedCount, technicalAudit, tasksWithDowntimeLink, tasksWithBrokenDowntimeLink] = await Promise.all([
    db.auditLog.count({ where: { factoryId: factory.id, createdAt: { gte: daysAgo(14) } } }),
    db.auditLog.count({ where: { action: 'ACCESS_DENIED', createdAt: { gte: daysAgo(14) } } }),
    db.auditLog.findMany({ where: { factoryId: factory.id, createdAt: { gte: daysAgo(14) } }, select: { id: true, action: true, entityType: true, details: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.task.count({ where: { factoryId: factory.id, lineId: { not: null }, lineStatusEventId: { not: null } } }),
    db.task.count({ where: { factoryId: factory.id, lineStatusEventId: { not: null }, lineId: null } }),
  ]);
  const technicalHits = technicalAudit.filter((item) => {
    const text = JSON.stringify(item.details ?? {});
    return /\/api\/|GET|POST|PATCH|DELETE|[0-9a-f]{8}-[0-9a-f]{4}/i.test(text) && !/ru|рус|пользователь|заяв|линия|отдел/i.test(text);
  });
  addCheck(sec, 'audit.counts', 'Аудит действий есть', auditCount ? 'OK' : 'WARNING', auditCount ? 'Аудит за 14 дней найден.' : 'За 14 дней нет audit записей по Заводу 4.', { auditCount, accessDeniedCount }, auditCount ? null : 'Проверить audit hooks в live smoke.');
  addCheck(sec, 'audit.human-summary', 'Audit без технического текста как основного', technicalHits.length ? 'WARNING' : 'OK', technicalHits.length ? 'В sample audit details есть технические маркеры. Это warning для UI summary, не правка хранения.' : 'В sample audit не найдено явного технического текста как основного summary.', { technicalHits: technicalHits.length }, technicalHits.length ? 'Проверить экран Статистика/Аудит визуально.' : null, technicalHits.map((item) => item.id));
  addCheck(sec, 'statistics.downtime-task-link', 'Заявки из простоя считаются только по связи', tasksWithBrokenDowntimeLink ? 'P2' : 'OK', tasksWithBrokenDowntimeLink ? 'Есть заявки с lineStatusEventId без lineId, статистика простоев может искажаться.' : 'Связь простой → заявка выглядит корректно.', { tasksWithDowntimeLink, tasksWithBrokenDowntimeLink });
}

async function addSecurityChecks(report, db, factory) {
  const sec = section(report, 'security-privacy', 'Security/privacy');
  const reportLeaks = hasForbidden(report);
  addCheck(sec, 'security.report-clean', 'Отчёт без чувствительных данных', reportLeaks.length ? 'P0' : 'OK', reportLeaks.length ? 'В текущем отчёте найдено чувствительное техническое поле или значение.' : 'В отчёте не найдено технических путей, хэшей паролей, токенов или секретных значений.', { leaks: reportLeaks.slice(0, 8) });

  if (!factory) {
    addCheck(sec, 'security.permission-shape', 'Permission shape', 'WARNING', 'Security prerequisites не проверены: нет контекста Завода 4.');
    return;
  }
  const [accesses, rolePermissions, overrides] = await Promise.all([
    db.userFactoryAccess.findMany({
      where: { factoryId: factory.id, userId: { in: ['pilot-pack-guest', 'pilot-worker-1', 'pilot-pack-management', 'pilot-pack-admin'] } },
      select: { userId: true, role: true, isGuest: true, isActive: true },
    }),
    db.rolePermission.findMany({ where: { permissionCode: { in: ['admin.overview.read', 'ops.audit.read', 'ops.statistics.read'] } }, select: { role: true, permissionCode: true } }),
    db.userPermissionOverride.findMany({ where: { factoryId: factory.id, userId: { in: ['pilot-pack-guest', 'pilot-worker-1', 'pilot-pack-management', 'pilot-pack-admin'] } }, select: { userId: true, permissionCode: true, effect: true } }),
  ]);
  const roleHas = (role, permission) => role === 'ADMIN' || rolePermissions.some((item) => item.role === role && item.permissionCode === permission);
  const userHas = (userId, permission) => {
    const access = accesses.find((item) => item.userId === userId);
    if (!access?.isActive) return false;
    let allowed = roleHas(access.role, permission);
    for (const override of overrides.filter((item) => item.userId === userId && item.permissionCode === permission)) {
      if (override.effect === 'ALLOW') allowed = true;
      if (override.effect === 'DENY') allowed = false;
    }
    return allowed;
  };
  const results = [
    { code: 'guest-admin-denied', ok: !userHas('pilot-pack-guest', 'admin.overview.read') && !userHas('pilot-pack-guest', 'ops.statistics.read') },
    { code: 'worker-admin-denied', ok: !userHas('pilot-worker-1', 'admin.overview.read') && !userHas('pilot-worker-1', 'ops.audit.read') },
    { code: 'management-ops-allowed', ok: userHas('pilot-pack-management', 'ops.statistics.read') },
    { code: 'admin-diagnostics-allowed', ok: userHas('pilot-pack-admin', 'ops.statistics.read') },
  ];
  const failed = results.filter((item) => !item.ok);
  addCheck(sec, 'security.permission-shape', 'Права pilot diagnostics', failed.length ? 'P1' : 'OK', failed.length ? 'Роли pilot-pack имеют неожиданный набор прав для диагностики/аудита.' : 'Guest/Worker не имеют admin/statistics/audit прав, Management/Admin имеют diagnostic доступ.', { results }, failed.length ? 'Проверить RolePermission/UserPermissionOverride; direct API deny дополнительно покрывает regression.' : null);
}

async function addRuntimeEndpointChecks(report, factory) {
  const sec = section(report, 'runtime-payloads', 'Runtime списки');
  if (!factory) return addCheck(sec, 'runtime.factory-context', 'Контекст завода', 'P1', 'Runtime endpoints не проверены: Завод 4 не найден.');
  const endpoints = [
    '/directory/lines',
    '/lines',
    '/tasks',
    '/checklists/templates/library',
    '/wash',
    '/okk',
    '/stock',
    '/returns',
    '/orders/items',
    '/orders/requests',
    '/defrost',
    '/shift-log',
    '/announcements/current',
    '/archive/downtime/summary',
  ];
  try {
    const results = [];
    for (const endpoint of endpoints) {
      const response = await request(endpoint, { userId: 'pilot-pack-admin', factoryId: factory.id });
      const markers = scanForMarkers(response.data).slice(0, 6);
      const leaks = hasForbidden(response.data).slice(0, 6);
      results.push({ endpoint, status: response.status, markers: markers.length, leaks: leaks.length });
    }
    const failed = results.filter((item) => item.status < 200 || item.status >= 300 || item.leaks);
    const marked = results.filter((item) => item.markers);
    addCheck(sec, 'runtime.endpoints-healthy', 'Runtime endpoints отвечают и не раскрывают секреты', failed.length ? 'P1' : 'OK', failed.length ? 'Часть runtime endpoints не отвечает или раскрывает технические чувствительные поля.' : 'Runtime endpoints sample отвечает без технических путей, хэшей паролей и секретных значений.', { results }, failed.length ? 'Проверить backend guards/payload serialization.' : null);
    addCheck(sec, 'runtime.no-stage-noise', 'Runtime без stage/test шума', marked.length ? 'WARNING' : 'OK', marked.length ? 'В sample runtime endpoints есть stage/test markers. Это warning до ручной проверки.' : 'В sample runtime endpoints stage/test markers не найдены.', { marked }, marked.length ? 'Проверить, является ли это fixture или реальными ручными данными.' : null);
  } catch (error) {
    addCheck(sec, 'runtime.endpoints-healthy', 'Runtime endpoints', 'WARNING', 'Runtime endpoints не проверены: backend недоступен.', { error: error.message }, 'Поднять backend и повторить self-check.');
  }
}

function finalizeReport(report) {
  const summary = { OK: 0, INFO: 0, WARNING: 0, P2: 0, P1: 0, P0: 0 };
  let maxSeverity = 'OK';
  for (const sec of report.sections) {
    for (const check of sec.checks) {
      summary[check.severity] = (summary[check.severity] ?? 0) + 1;
      if (severityRank[check.severity] > severityRank[maxSeverity]) maxSeverity = check.severity;
    }
  }
  report.summary = {
    ...summary,
    maxSeverity,
    blockerCount: summary.P0 + summary.P1 + summary.P2,
    warningCount: summary.WARNING,
  };
  report.status = report.summary.blockerCount ? 'BLOCKED' : report.summary.warningCount ? 'WARNINGS' : 'READY';
  report.exitCode = report.summary.blockerCount ? 1 : 0;
  return report;
}

function markdown(report) {
  const lines = [
    '# Проверка готовности пилота v1.0',
    '',
    `Сформировано: ${report.generatedAt}`,
    `Статус: ${report.status}`,
    `Максимальная серьёзность: ${report.summary.maxSeverity}`,
    '',
    `Итог: OK ${report.summary.OK}, INFO ${report.summary.INFO}, WARNING ${report.summary.WARNING}, P2 ${report.summary.P2}, P1 ${report.summary.P1}, P0 ${report.summary.P0}.`,
    '',
  ];
  for (const sec of report.sections) {
    lines.push(`## ${sec.title}`, '');
    for (const check of sec.checks) {
      lines.push(`### ${check.severity} — ${check.title}`);
      lines.push(check.message);
      if (check.suggestedAction) lines.push(`Рекомендация: ${check.suggestedAction}`);
      if (check.affectedIds?.length) lines.push(`Затронутые записи: ${check.affectedIds.join(', ')}`);
      const evidenceText = JSON.stringify(check.evidence ?? {});
      if (evidenceText && evidenceText !== '{}') lines.push(`Evidence: \`${evidenceText.slice(0, 900)}\``);
      lines.push('');
    }
  }
  lines.push('## Проверяется только руками', '');
  for (const item of report.manualChecks) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Безопасность отчёта', '');
  lines.push('Отчёт не должен содержать значения секретов, токены, хэши паролей, внутренние пути файлов или реквизиты подключения. Backup/restore/reset/drop/truncate/delete этим self-check не выполняются.');
  lines.push('');
  return lines.join('\n');
}

function writeReports(report, options = {}) {
  const runtimeDir = options.runtimeDir ?? runtimeReportDir;
  const docsDir = options.docsDir ?? docsReportDir;
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  const jsonPath = path.join(runtimeDir, 'latest.json');
  const mdPath = path.join(docsDir, 'latest.md');
  const json = JSON.stringify(redact(report), null, 2);
  const md = markdown(redact(report));
  if (hasForbidden(json).length || hasForbidden(md).length) throw new Error('Pilot health report contains forbidden sensitive fields.');
  fs.writeFileSync(jsonPath, `${json}\n`, 'utf8');
  fs.writeFileSync(mdPath, md, 'utf8');
  return { jsonPath, mdPath };
}

async function runPilotHealthReport(options = {}) {
  loadEnv();
  const db = options.db ?? new PrismaClient();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'UNKNOWN',
    summary: {},
    sections: [],
    manualChecks,
    notes: [
      'Self-check read-only: не выполняет cleanup, archive, restore, reset, drop, truncate или физическое удаление.',
      'WARNING означает ручную проверку перед пилотом; P0/P1/P2 блокируют автоматический зелёный статус.',
    ],
  };

  try {
    await addSystemChecks(report, db, options);
    const factory = await addPilotPackChecks(report, db);
    await addShiftPeopleChecks(report, db, factory);
    await addLineDowntimeChecks(report, db, factory);
    await addTaskChecks(report, db, factory);
    await addChecklistChecks(report, db, factory);
    await addStockOrderChecks(report, db, factory);
    await addQualityChecks(report, db, factory);
    await addWashChecks(report, db, factory);
    await addDefrostChecks(report, db, factory);
    await addAnnouncementLogNotificationChecks(report, db, factory);
    await addArchiveStatisticsAuditChecks(report, db, factory);
    await addRuntimeEndpointChecks(report, factory);
    await addSecurityChecks(report, db, factory);
    finalizeReport(report);
    if (options.writeFiles !== false) report.files = writeReports(report, options);
    return report;
  } finally {
    if (!options.db) await db.$disconnect();
  }
}

async function main() {
  const noPrismaChecks = process.argv.includes('--skip-prisma-checks');
  const report = await runPilotHealthReport({ includePrismaChecks: !noPrismaChecks });
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    files: report.files,
    manualChecks: report.manualChecks.length,
  }, null, 2));
  process.exitCode = report.exitCode;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(redact({ error: error.message, stack: error.stack }));
    process.exitCode = 1;
  });
}

module.exports = {
  runPilotHealthReport,
  writeReports,
  hasForbidden,
  hasFixtureMarker,
  blockerSeverities,
};
