const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const marker = `PFFV3-PLAST1-${Date.now()}`;
const results = [];
const createdAssignmentIds = [];
const createdPlanIds = [];
const createdWillBeIds = [];
const createdSessionIds = [];
let createdSkillId = null;
let zeroSkillId = null;
let fixtureUserId = null;
let factoryId = null;
let originalEmployeeState = null;
let agedAssignment = null;

function record(name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail: passed ? undefined : detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
}

async function request(method, pathname, { userId = 'test-admin', selectedFactoryId = factoryId, body } = {}) {
  const response = await fetch(`${API_URL}${pathname}`, {
    method,
    headers: {
      'x-user-id': userId,
      ...(selectedFactoryId ? { 'x-factory-id': selectedFactoryId } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text };
}

function runNodeScript(scriptName, args = []) {
  return spawnSync(process.execPath, [path.join(__dirname, scriptName), ...args], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, API_URL },
    timeout: 120_000,
  });
}

function hasForbiddenDisclosure(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|refreshToken|accessToken|secret/i.test(JSON.stringify(value));
}

async function ageAssignment(id) {
  const assignment = await db.assignment.findUnique({ where: { id }, select: { startedAt: true } });
  if (!assignment) return;
  await db.assignment.update({
    where: { id },
    data: { startedAt: new Date(Date.now() - 10 * 60_000) },
  });
}

async function releaseCurrent() {
  if (!fixtureUserId || !factoryId) return;
  await request('POST', '/assignments/release', {
    userId: 'test-master',
    body: { targetUserId: fixtureUserId },
  }).catch(() => undefined);
}

async function cleanup() {
  await releaseCurrent();

  for (const id of createdPlanIds) {
    await db.plannedLineAssignment.updateMany({
      where: { id, factoryId, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: 'test-admin' },
    });
  }
  for (const id of createdWillBeIds) {
    await db.shiftWillBe.updateMany({
      where: { id, factoryId, status: 'WILL_BE' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), comment: `${marker}: cleanup` },
    });
  }

  if (createdAssignmentIds.length) {
    await db.userSkillCredit.deleteMany({ where: { assignmentId: { in: createdAssignmentIds } } });
  }
  if (createdSkillId) await db.userSkill.deleteMany({ where: { id: createdSkillId } });
  if (zeroSkillId) await db.userSkill.deleteMany({ where: { id: zeroSkillId } });
  if (createdPlanIds.length) await db.plannedLineAssignment.deleteMany({ where: { id: { in: createdPlanIds } } });
  if (createdWillBeIds.length) await db.shiftWillBe.deleteMany({ where: { id: { in: createdWillBeIds } } });
  if (createdAssignmentIds.length) await db.assignment.deleteMany({ where: { id: { in: createdAssignmentIds } } });
  if (createdSessionIds.length) await db.shiftSession.deleteMany({ where: { id: { in: createdSessionIds } } });

  if (fixtureUserId && originalEmployeeState) {
    await db.user.updateMany({
      where: { id: fixtureUserId },
      data: { employeeState: originalEmployeeState },
    });
  }
  if (agedAssignment) {
    await db.assignment.updateMany({
      where: { id: agedAssignment.id },
      data: { startedAt: agedAssignment.startedAt },
    });
  }
}

async function main() {
  const health = await fetch(`${API_URL}/health`).then((response) => response.json()).catch(() => null);
  record('свежий backend отвечает на /health', health?.status === 'ok', health);

  const login = await request('POST', '/auth/dev-login', {
    selectedFactoryId: null,
    body: { userId: 'test-admin' },
  });
  const factory = login.data?.availableFactories?.find((item) => item.code === 'factory-4');
  factoryId = factory?.id ?? null;
  record('Завод 4 найден через штатный auth-контекст', login.status === 201 && Boolean(factoryId), login.data);
  if (!factoryId) throw new Error('Завод 4 не найден');

  const configVerification = runNodeScript('physical-field-fixes-v3-factory4-config.js', ['--verify']);
  record(
    '13 линий, позиции, диапазоны, шаблоны и Повременщики соответствуют утверждённой структуре',
    configVerification.status === 0 && /configured-and-verified/.test(configVerification.stdout),
    { status: configVerification.status, stdout: configVerification.stdout, stderr: configVerification.stderr },
  );

  const cleanupVerification = runNodeScript('physical-field-fixes-v3-factory4-cleanup.js');
  let cleanupReport = null;
  try {
    cleanupReport = JSON.parse(cleanupVerification.stdout);
  } catch {
    cleanupReport = null;
  }
  record(
    'подтверждённые fixture-линии Завода 4 отсутствуют, неоднозначная история сохранена отключённой',
    cleanupVerification.status === 0
      && cleanupReport?.remainingFixtureLines === 0
      && cleanupReport?.activeLineCount === 13
      && cleanupReport?.usersChanged === 0
      && cleanupReport?.uploadsChanged === 0
      && cleanupReport?.auditChanged === 0,
    { status: cleanupVerification.status, report: cleanupReport, stderr: cleanupVerification.stderr },
  );

  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, '../prisma/migrations/20260724120000_physical_field_fixes_v3_skill_credits/migration.sql'),
    'utf8',
  );
  record(
    'миграция опыта additive и не содержит destructive SQL',
    /CREATE TABLE "UserSkillCredit"/.test(migrationSql)
      && !/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(migrationSql),
    migrationSql,
  );

  const line = await db.line.findFirst({
    where: { factoryId, name: 'Пицца Цезарь', deletedAt: null },
    include: {
      positions: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      staffingTemplates: {
        where: { name: 'Утверждённый состав', isActive: true, deletedAt: null },
        include: { items: true },
        take: 1,
      },
    },
  });
  const template = line?.staffingTemplates[0] ?? null;
  const extraPosition = line?.positions.find((position) => position.isExtraSlot) ?? null;
  const normalPositions = (line?.positions ?? []).filter((position) => !position.isExtraSlot);
  record('контрольная линия имеет один утверждённый шаблон и дополнительный слот', Boolean(line && template && extraPosition), {
    line: line?.name,
    templates: line?.staffingTemplates.length,
    extraPosition: extraPosition?.name,
  });
  if (!line || !template || !extraPosition) throw new Error('Контрольная структура линии неполна');

  const candidateAccess = await db.userFactoryAccess.findFirst({
    where: {
      factoryId,
      userId: 'stage21-worker-1778572736714',
      role: 'WORKER',
      isActive: true,
      isGuest: false,
      user: { blockedAt: null, deletedAt: null, assignments: { none: { factoryId, endedAt: null } } },
    },
    include: { user: true },
  });
  fixtureUserId = candidateAccess?.userId ?? null;
  originalEmployeeState = candidateAccess?.user.employeeState ?? null;
  record('используется изолированный diagnostic WORKER без активного назначения', Boolean(fixtureUserId), candidateAccess?.userId);
  if (!fixtureUserId) throw new Error('Безопасный diagnostic WORKER не найден');

  const previous = await db.assignment.findFirst({
    where: { factoryId, userId: fixtureUserId, endedAt: { not: null } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true },
  });
  if (previous && Date.now() - previous.startedAt.getTime() < 10 * 60_000) {
    agedAssignment = previous;
    await ageAssignment(previous.id);
  }

  let position = null;
  for (const item of normalPositions) {
    const existing = await db.userSkill.count({ where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: item.id } });
    const credits = await db.userSkillCredit.count({ where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: item.id } });
    if (existing === 0 && credits === 0) {
      position = item;
      break;
    }
  }
  record('для проверки выбран навык без прежней истории у diagnostic WORKER', Boolean(position), position?.name);
  if (!position) throw new Error('Свободная позиция для изолированной проверки не найдена');

  const zeroCreate = await request('POST', `/people/${fixtureUserId}/skills`, {
    body: { lineId: line.id, positionId: position.id, experienceCount: 0 },
  });
  record('ручное создание нулевого навыка запрещено', zeroCreate.status === 409 && /фактическ|опыт/i.test(zeroCreate.text), zeroCreate);

  const zeroSkill = await db.userSkill.create({
    data: {
      factoryId,
      userId: fixtureUserId,
      lineId: line.id,
      positionId: position.id,
      skillFamilyKey: position.skillFamilyKey,
      experienceCount: 0,
      isActive: true,
    },
  });
  zeroSkillId = zeroSkill.id;
  const zeroProfile = await request('GET', `/people/${fixtureUserId}`);
  record(
    'профиль не показывает активный навык с нулевым фактическим опытом',
    zeroProfile.status === 200 && !zeroProfile.data?.skills?.some((skill) => skill.id === zeroSkill.id),
    zeroProfile.data?.skills,
  );
  await db.userSkill.delete({ where: { id: zeroSkill.id } });
  zeroSkillId = null;

  const future = await request('GET', '/shift/future', { userId: 'test-master' });
  const shiftDate = future.data?.shiftDate;
  const shiftType = future.data?.shiftType;
  record('следующая смена получена из server/factory-local механизма', future.status === 200 && shiftDate && shiftType, future.data);

  const skillBeforePlanning = await db.userSkill.count({
    where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: position.id, isActive: true },
  });
  const willBe = await request('POST', '/shift/will-be', {
    userId: fixtureUserId,
    body: { targetShiftDate: shiftDate, shiftType, comment: `${marker}: Я буду` },
  });
  if (willBe.data?.id) createdWillBeIds.push(willBe.data.id);
  record('отметка «Я буду» сохраняется штатно', willBe.status === 201 && Boolean(willBe.data?.id), willBe);
  record(
    'отметка «Я буду» не создаёт профессиональный навык',
    await db.userSkill.count({ where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: position.id, isActive: true } }) === skillBeforePlanning,
  );

  const planned = await request('POST', `/lines/${line.id}/planning-board/assign`, {
    userId: 'test-master',
    body: {
      shiftDate,
      shiftType,
      staffingTemplateId: template.id,
      targetUserId: fixtureUserId,
      positionId: position.id,
      slotIndex: 1,
      comment: `${marker}: план`,
    },
  });
  const planRow = await db.plannedLineAssignment.findFirst({
    where: {
      factoryId,
      lineId: line.id,
      userId: fixtureUserId,
      positionId: position.id,
      shiftType,
      releasedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (planRow) createdPlanIds.push(planRow.id);
  record('плановая расстановка сохраняется отдельно от фактической работы', [200, 201].includes(planned.status) && Boolean(planRow), {
    status: planned.status,
    planId: planRow?.id,
  });
  record(
    'плановая расстановка не создаёт навык и фактический credit',
    await db.userSkill.count({ where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: position.id, isActive: true } }) === skillBeforePlanning
      && await db.userSkillCredit.count({ where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: position.id } }) === 0,
  );
  if (planRow) {
    const releasePlan = await request('POST', `/lines/${line.id}/planning-board/release/${planRow.id}`, {
      userId: 'test-master',
    });
    record('тестовый план освобождён штатно', [200, 201].includes(releasePlan.status), releasePlan);
  }

  const emptyExtra = await request('POST', '/assignments/line', {
    userId: 'test-master',
    body: {
      targetUserId: fixtureUserId,
      lineId: line.id,
      positionId: extraPosition.id,
      staffingTemplateId: template.id,
      slotIndex: 1,
      operationId: `${marker}-extra-empty`,
      comment: '   ',
    },
  });
  record(
    'backend отклоняет дополнительное назначение без свободного комментария',
    emptyExtra.status === 409 && /комментар/i.test(emptyExtra.text),
    emptyExtra,
  );

  const assignOne = await request('POST', '/assignments/line', {
    userId: 'test-master',
    body: {
      targetUserId: fixtureUserId,
      lineId: line.id,
      positionId: position.id,
      staffingTemplateId: template.id,
      slotIndex: 1,
      operationId: `${marker}-fact-1`,
    },
  });
  if (assignOne.data?.id) createdAssignmentIds.push(assignOne.data.id);
  record('фактическое назначение на конкретную позицию создано', assignOne.status === 201 && Boolean(assignOne.data?.id), assignOne);
  const releaseOne = await request('POST', '/assignments/release', {
    userId: 'test-master',
    body: { targetUserId: fixtureUserId },
  });
  record('первое фактическое назначение завершено', releaseOne.status === 201, releaseOne);

  let skill = await db.userSkill.findFirst({
    where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: position.id, isActive: true },
  });
  createdSkillId = skill?.id ?? null;
  let credits = await db.userSkillCredit.findMany({
    where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: position.id },
  });
  record(
    'первая фактическая работа автоматически создаёт навык +1 и credit смены',
    skill?.experienceCount === 1 && credits.length === 1 && credits[0].assignmentId === assignOne.data?.id,
    { skill, credits },
  );

  await ageAssignment(assignOne.data.id);
  const assignTwo = await request('POST', '/assignments/line', {
    userId: 'test-master',
    body: {
      targetUserId: fixtureUserId,
      lineId: line.id,
      positionId: position.id,
      staffingTemplateId: template.id,
      slotIndex: 1,
      operationId: `${marker}-fact-2`,
    },
  });
  if (assignTwo.data?.id) createdAssignmentIds.push(assignTwo.data.id);
  record('повторное фактическое назначение в той же смене возможно после move interval', assignTwo.status === 201, assignTwo);
  const releaseTwo = await request('POST', '/assignments/release', {
    userId: 'test-master',
    body: { targetUserId: fixtureUserId },
  });
  record('повторное назначение завершено', releaseTwo.status === 201, releaseTwo);

  skill = await db.userSkill.findFirst({
    where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: position.id, isActive: true },
  });
  credits = await db.userSkillCredit.findMany({
    where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: position.id },
  });
  record(
    'повторное перемещение в одной смене не накручивает опыт',
    skill?.experienceCount === 1 && credits.length === 1,
    { skill, credits },
  );

  await ageAssignment(assignTwo.data.id);
  const extraAssign = await request('POST', '/assignments/line', {
    userId: 'test-master',
    body: {
      targetUserId: fixtureUserId,
      lineId: line.id,
      positionId: extraPosition.id,
      staffingTemplateId: template.id,
      slotIndex: 1,
      operationId: `${marker}-extra`,
      comment: `${marker}: дополнительный сотрудник по решению мастера`,
    },
  });
  if (extraAssign.data?.id) createdAssignmentIds.push(extraAssign.data.id);
  record('дополнительное назначение с комментарием сохраняет автора и текст', extraAssign.status === 201 && /дополнительный/.test(extraAssign.data?.comment ?? ''), extraAssign);
  const extraRelease = await request('POST', '/assignments/release', {
    userId: 'test-master',
    body: { targetUserId: fixtureUserId },
  });
  record('дополнительное назначение завершено', extraRelease.status === 201, extraRelease);
  const extraSkill = await db.userSkill.findFirst({
    where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: extraPosition.id, isActive: true },
  });
  const extraCredits = await db.userSkillCredit.findMany({
    where: { factoryId, userId: fixtureUserId, lineId: line.id, positionId: extraPosition.id },
  });
  record(
    '«Дополнительно» учитывается как общий опыт линии, но не создаёт профессиональный навык',
    !extraSkill && extraCredits.length === 1 && extraCredits[0].assignmentId === extraAssign.data?.id,
    { extraSkill, extraCredits },
  );

  const skillAudit = await db.auditLog.findFirst({
    where: {
      factoryId,
      userId: 'test-master',
      action: 'SKILL_EXPERIENCE_CREDITED',
      details: { path: ['assignmentId'], equals: assignOne.data?.id },
    },
  });
  const lineAudit = await db.auditLog.findFirst({
    where: {
      factoryId,
      userId: 'test-master',
      action: 'LINE_EXPERIENCE_CREDITED',
      details: { path: ['assignmentId'], equals: extraAssign.data?.id },
    },
  });
  record('автоматический профессиональный и общий опыт отражены в аудите', Boolean(skillAudit && lineAudit), {
    skillAudit: skillAudit?.action,
    lineAudit: lineAudit?.action,
  });

  const workerMaster = await request('GET', '/people/pilot-master-1', { userId: 'pilot-worker-1' });
  const workerPeer = await request('GET', '/people/worker-3', { userId: 'pilot-worker-1' });
  const contractorMaster = await request('GET', '/people/pilot-master-1', { userId: 'pilot-contractor-1' });
  const contractorPeer = await request('GET', '/people/worker-3', { userId: 'pilot-contractor-1' });
  const guestMaster = await request('GET', '/people/pilot-master-1', { userId: 'pilot-pack-guest' });
  record(
    'WORKER видит телефон мастера, но прямой запрос профиля коллеги запрещён',
    workerMaster.status === 200 && workerMaster.data?.phone === '+79000004720' && workerPeer.status === 403,
    { workerMaster, workerPeer },
  );
  record(
    'CONTRACTOR видит телефон мастера, но не телефон обычного работника',
    contractorMaster.status === 200 && contractorMaster.data?.phone === '+79000004720' && contractorPeer.status === 403,
    { contractorMaster, contractorPeer },
  );
  record('Guest не получает чужой профиль или номер', guestMaster.status === 403 && !/\+7900/.test(guestMaster.text), guestMaster);

  const workerList = await request('GET', '/people', { userId: 'pilot-worker-1' });
  record(
    'список WORKER содержит себя и разрешённые руководящие контакты, но не коллег',
    workerList.status === 200
      && workerList.data?.people?.some((person) => person.userId === 'pilot-worker-1')
      && workerList.data?.people?.some((person) => person.userId === 'pilot-master-1' && person.phone === '+79000004720')
      && !workerList.data?.people?.some((person) => person.userId === 'worker-3'),
    workerList.data,
  );
  record(
    'технические test/checklist/source/target пользователи не попадают в обычный people read-model',
    workerList.status === 200
      && !workerList.data?.people?.some((person) => (
        /^test-/i.test(person.userId)
        || /^checklist-(?:periodic|workflow|department)/i.test(person.userId)
        || /^pilot-pack-.+-(?:source|target)$/i.test(person.userId)
      )),
    workerList.data?.people,
  );

  const adminWorker = await request('GET', '/people/worker-3', { userId: 'test-admin' });
  record('ADMIN сохраняет полный телефонный сценарий в factory scope', adminWorker.status === 200 && adminWorker.data?.phone === '+79000000103', adminWorker);

  const otherFactory = login.data?.availableFactories?.find((item) => item.id !== factoryId);
  const crossFactory = otherFactory
    ? await request('GET', '/people/pilot-master-1', { userId: 'test-admin', selectedFactoryId: otherFactory.id })
    : { status: 404, data: null, text: '' };
  record(
    'профиль и телефон Завода 4 не раскрываются из другого factory context',
    [200, 403, 404].includes(crossFactory.status) && !crossFactory.data?.phone,
    crossFactory,
  );

  const publicSamples = [workerMaster.data, workerList.data, adminWorker.data, zeroProfile.data];
  record('публичные people payload не раскрывают storagePath/passwordHash/token/secret', !publicSamples.some(hasForbiddenDisclosure), publicSamples);

  const peopleSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/screens/PeopleScreen.tsx'), 'utf8');
  record(
    'в профиле навыка оставлена одна компактная команда «Изменить»',
    /modal === 'edit-skill'/.test(peopleSource)
      && />\s*Изменить\s*</.test(peopleSource)
      && !/Стаж \+1|Стаж -1|Рекомендовать|Отключить навык/.test(peopleSource),
  );
}

main()
  .catch((error) => {
    record('регрессионный runner завершился без необработанной ошибки', false, error instanceof Error ? error.stack : String(error));
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      record('тестовые данные восстановлены', false, error instanceof Error ? error.stack : String(error));
    }
    await db.$disconnect();
    const failed = results.filter((item) => !item.passed);
    console.log(JSON.stringify({
      suite: 'PHYSICAL_FIELD_FIXES_V3_PLAST1',
      passed: results.length - failed.length,
      failed: failed.length,
      failures: failed,
      fixtureDataRestored: failed.every((item) => item.name !== 'тестовые данные восстановлены'),
    }, null, 2));
    process.exitCode = failed.length ? 1 : 0;
  });
