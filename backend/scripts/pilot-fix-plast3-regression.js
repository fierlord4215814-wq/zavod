const {
  AssignmentKind,
  ContractorActualStatus,
  EmployeeState,
  PrismaClient,
  ShiftSessionStatus,
  ShiftType,
  UserRole,
} = require('@prisma/client');
const {
  addFactoryShifts,
  factoryShiftTarget,
  factoryShiftWindow,
} = require('../dist/common/shift-time');

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const passed = [];
const failed = [];

function check(condition, name, detail) {
  (condition ? passed : failed).push({ name, ...(detail === undefined ? {} : { detail }) });
}

function hasForbidden(value) {
  return /storagePath|passwordHash|DATABASE_URL|JWT_SECRET|Bearer\s+|accessToken|refreshToken|tokenHash|secret/i.test(JSON.stringify(value ?? null));
}

async function request(method, pathname, { userId, factoryId, body } = {}) {
  const headers = { Connection: 'close' };
  if (userId) headers['x-user-id'] = userId;
  if (factoryId) headers['x-factory-id'] = factoryId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  check(response.status === expected, name, response.status === expected ? undefined : { expected, actual: response.status, data: response.data });
  check(!hasForbidden(response.data), `${name}: ответ не раскрывает технические секреты`);
  return response;
}

async function ensureAccess({ userId, factoryId, role, companyId = null }) {
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId, role, employeeState: EmployeeState.OFF_SHIFT, blockedAt: null, deletedAt: null },
    create: { id: userId, factoryId, role, employeeState: EmployeeState.OFF_SHIFT },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId } },
    update: { role, companyId, isGuest: false, isActive: true, deactivatedAt: null, deactivationReason: null },
    create: { userId, factoryId, role, companyId, isGuest: false, isActive: true },
  });
}

async function main() {
  const runId = Date.now().toString(36);
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const otherFactory = await db.factory.findFirst({ where: { id: { not: factory.id }, isActive: true, deletedAt: null } });
  const factoryId = factory.id;
  const ids = {
    master: `zv3tmp-master-${runId}`,
    workerA: `zv3tmp-worker-a-${runId}`,
    workerB: `zv3tmp-worker-b-${runId}`,
    workerC: `zv3tmp-worker-c-${runId}`,
    tech: `zv3tmp-tech-${runId}`,
    store: `zv3tmp-store-${runId}`,
    leadA: `zv3tmp-lead-a-${runId}`,
    leadB: `zv3tmp-lead-b-${runId}`,
    contractorA: `zv3tmp-contractor-a-${runId}`,
    contractorA2: `zv3tmp-contractor-a2-${runId}`,
    contractorB: `zv3tmp-contractor-b-${runId}`,
  };
  const testUserIds = Object.values(ids);
  let companyA;
  let companyB;
  let timeArea;
  let workArea;
  let createdFutureAssignmentId = null;

  try {
    const boundaryCases = [
      ['07:59:59', '2026-07-18T04:59:59.000Z', ShiftType.NIGHT, '2026-07-17'],
      ['08:00:00', '2026-07-18T05:00:00.000Z', ShiftType.DAY, '2026-07-18'],
      ['19:59:59', '2026-07-18T16:59:59.000Z', ShiftType.DAY, '2026-07-18'],
      ['20:00:00', '2026-07-18T17:00:00.000Z', ShiftType.NIGHT, '2026-07-18'],
      ['00:00:00', '2026-07-18T21:00:00.000Z', ShiftType.NIGHT, '2026-07-18'],
      ['07:59:59 next', '2026-07-19T04:59:59.000Z', ShiftType.NIGHT, '2026-07-18'],
      ['08:00:00 next', '2026-07-19T05:00:00.000Z', ShiftType.DAY, '2026-07-19'],
    ];
    for (const [label, instant, shiftType, shiftDate] of boundaryCases) {
      const target = factoryShiftTarget(new Date(instant));
      check(target.shiftType === shiftType && target.shiftDate === shiftDate, `Граница смены ${label}`, target);
    }
    const nightWindow = factoryShiftWindow({ shiftDate: '2026-07-18', shiftType: ShiftType.NIGHT });
    check(nightWindow.from.toISOString() === '2026-07-18T17:00:00.000Z' && nightWindow.to.toISOString() === '2026-07-19T05:00:00.000Z', 'Ночное окно не сдвигается через полночь');
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    const timezoneIndependent = factoryShiftTarget(new Date('2026-07-19T00:00:00.000Z'));
    process.env.TZ = previousTz;
    check(timezoneIndependent.shiftType === ShiftType.NIGHT && timezoneIndependent.shiftDate === '2026-07-18', 'Browser/Node timezone не меняет factory shiftDate');

    companyA = await db.externalCompany.create({
      data: { factoryId, name: `Временная фирма А ${runId}`, normalizedName: `временная фирма а ${runId}` },
    });
    companyB = await db.externalCompany.create({
      data: { factoryId, name: `Временная фирма Б ${runId}`, normalizedName: `временная фирма б ${runId}` },
    });
    await Promise.all([
      ensureAccess({ userId: ids.master, factoryId, role: UserRole.MASTER }),
      ensureAccess({ userId: ids.workerA, factoryId, role: UserRole.WORKER }),
      ensureAccess({ userId: ids.workerB, factoryId, role: UserRole.WORKER }),
      ensureAccess({ userId: ids.workerC, factoryId, role: UserRole.WORKER }),
      ensureAccess({ userId: ids.tech, factoryId, role: UserRole.TECH_KIPIA }),
      ensureAccess({ userId: ids.store, factoryId, role: UserRole.STORE }),
      ensureAccess({ userId: ids.leadA, factoryId, role: UserRole.CONTRACTOR_LEAD, companyId: companyA.id }),
      ensureAccess({ userId: ids.leadB, factoryId, role: UserRole.CONTRACTOR_LEAD, companyId: companyB.id }),
      ensureAccess({ userId: ids.contractorA, factoryId, role: UserRole.CONTRACTOR, companyId: companyA.id }),
      ensureAccess({ userId: ids.contractorA2, factoryId, role: UserRole.CONTRACTOR, companyId: companyA.id }),
      ensureAccess({ userId: ids.contractorB, factoryId, role: UserRole.CONTRACTOR, companyId: companyB.id }),
    ]);
    timeArea = await db.workArea.create({
      data: {
        factoryId,
        name: `Временные позиции ${runId}`,
        description: 'Проверка canonical TIME',
        assignmentKind: AssignmentKind.TIME,
        positions: { create: [{ title: 'Комплектовщик', minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1 }] },
      },
      include: { positions: true },
    });
    workArea = await db.workArea.create({
      data: {
        factoryId,
        name: `Временная рабочая зона ${runId}`,
        description: 'Проверка canonical WORK_AREA',
        assignmentKind: AssignmentKind.WORK_AREA,
        positions: { create: [{ title: 'Оператор зоны', minRequired: 1, maxRequired: 1, defaultPlanned: 1, plannedCount: 1 }] },
      },
      include: { positions: true },
    });

    await expectStatus('WORKER начинает только собственную смену', 201, request('POST', '/shift/start', { userId: ids.workerA, factoryId }));
    await expectStatus('Второй WORKER начинает собственную смену', 201, request('POST', '/shift/start', { userId: ids.workerB, factoryId }));
    await expectStatus('Третий WORKER начинает собственную смену', 201, request('POST', '/shift/start', { userId: ids.workerC, factoryId }));
    await expectStatus('WORKER не назначает другого сотрудника прямым API', 403, request('POST', `/work-areas/${timeArea.id}/assign`, {
      userId: ids.workerA,
      factoryId,
      body: { targetUserId: ids.workerB, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, operationId: `p3-${runId}-worker-spoof` },
    }));
    await expectStatus('Legacy TIME route не создаёт свободное назначение в обход рабочих зон', 409, request('POST', '/assignments/time', {
      userId: ids.master,
      factoryId,
      body: { targetUserId: ids.workerA, timeRoleName: 'Свободный обход canonical справочника' },
    }));
    check(await db.assignment.count({ where: { factoryId, userId: ids.workerA, endedAt: null } }) === 0, 'Legacy TIME route не оставляет активную Assignment запись');

    const personFirstOperation = `p3-${runId}-person-first`;
    const personFirst = await expectStatus('Person-first назначает WORKER в canonical TIME slot', 201, request('POST', `/work-areas/${timeArea.id}/assign`, {
      userId: ids.master,
      factoryId,
      body: { targetUserId: ids.workerA, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, operationId: personFirstOperation },
    }));
    const personFirstRepeat = await expectStatus('Повтор person-first с operationId идемпотентен', 201, request('POST', `/work-areas/${timeArea.id}/assign`, {
      userId: ids.master,
      factoryId,
      body: { targetUserId: ids.workerA, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, operationId: personFirstOperation },
    }));
    check(personFirst.data?.id && personFirst.data.id === personFirstRepeat.data?.id, 'Double-submit возвращает одну Assignment запись');
    check(await db.assignment.count({ where: { factoryId, userId: ids.workerA, endedAt: null } }) === 1, 'У сотрудника только одно активное назначение');
    await expectStatus('Освобождение TIME использует общий Assignment engine', 201, request('POST', '/assignments/release', { userId: ids.master, factoryId, body: { targetUserId: ids.workerA } }));

    const concurrent = await Promise.all([
      request('POST', `/work-areas/${timeArea.id}/assign`, {
        userId: ids.master,
        factoryId,
        body: { targetUserId: ids.workerA, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, operationId: `p3-${runId}-slot-a` },
      }),
      request('POST', `/work-areas/${timeArea.id}/assign`, {
        userId: ids.master,
        factoryId,
        body: { targetUserId: ids.workerB, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, operationId: `p3-${runId}-slot-b` },
      }),
    ]);
    check(concurrent.filter((result) => result.status === 201).length === 1 && concurrent.filter((result) => result.status === 409).length === 1, 'Concurrent slot-first допускает ровно одного победителя', concurrent.map((result) => result.status));
    const slotWinner = concurrent.find((result) => result.status === 201)?.data;
    check(await db.assignment.count({ where: { factoryId, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, endedAt: null } }) === 1, 'В одном TIME slot нет двух активных Assignment');
    if (slotWinner?.userId) {
      await expectStatus('Освобождение победителя concurrent slot', 201, request('POST', '/assignments/release', { userId: ids.master, factoryId, body: { targetUserId: slotWinner.userId } }));
    }

    const workAreaAssignment = await expectStatus('WORK_AREA использует тот же endpoint и Assignment', 201, request('POST', `/work-areas/${workArea.id}/assign`, {
      userId: ids.master,
      factoryId,
      body: { targetUserId: ids.workerC, workAreaPositionId: workArea.positions[0].id, slotIndex: 1, operationId: `p3-${runId}-work-area` },
    }));
    if (!workAreaAssignment.data?.id) throw new Error('WORK_AREA assignment was not created');
    const storedWorkArea = await db.assignment.findUnique({ where: { id: workAreaAssignment.data.id } });
    check(storedWorkArea?.kind === AssignmentKind.WORK_AREA && storedWorkArea.workAreaPositionId === workArea.positions[0].id, 'WORK_AREA хранится в canonical Assignment с canonical position');
    const moved = await expectStatus('Move WORK_AREA → TIME использует sourceAssignmentId и один command path', 201, request('POST', `/work-areas/${timeArea.id}/assign`, {
      userId: ids.master,
      factoryId,
      body: { targetUserId: ids.workerC, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, sourceAssignmentId: workAreaAssignment.data.id, operationId: `p3-${runId}-move` },
    }));
    check(moved.data?.kind === AssignmentKind.TIME && await db.assignment.count({ where: { factoryId, userId: ids.workerC, endedAt: null } }) === 1, 'Move закрывает источник и не создаёт duplicate active assignment');
    await expectStatus('Освобождение после move', 201, request('POST', '/assignments/release', { userId: ids.master, factoryId, body: { targetUserId: ids.workerC } }));

    const current = factoryShiftTarget();
    const currentDate = current.shiftDate;
    const plan = await expectStatus('Старший фирмы создаёт план текущей смены только своей компании', 201, request('POST', '/shift/contractor-submissions', {
      userId: ids.leadA,
      factoryId,
      body: { targetShiftDate: currentDate, shiftType: current.shiftType, contractorUserIds: [ids.contractorA], operationId: `p3-${runId}-plan-a` },
    }));
    const planRepeat = await expectStatus('Повтор плана той же фирмы идемпотентен', 201, request('POST', '/shift/contractor-submissions', {
      userId: ids.leadA,
      factoryId,
      body: { targetShiftDate: currentDate, shiftType: current.shiftType, contractorUserIds: [ids.contractorA], operationId: `p3-${runId}-plan-a` },
    }));
    check(plan.data?.id === planRepeat.data?.id && plan.data?.companyId === companyA.id && plan.data?.companyNameSnapshot === companyA.name, 'План сохраняет companyId и исторический company snapshot');
    const item = plan.data?.items?.[0];
    if (!item) throw new Error('Contractor plan item missing');

    const beforeArrival = await expectStatus('Мастер не назначает запланированного, но не прибывшего наёмника', 409, request('POST', `/work-areas/${timeArea.id}/assign`, {
      userId: ids.master,
      factoryId,
      body: { targetUserId: ids.contractorA, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, operationId: `p3-${runId}-before-arrival` },
    }));
    check(/прибыт|смен/i.test(JSON.stringify(beforeArrival.data)), 'Ошибка до прибытия человекочитаемая');
    const masterPeopleBefore = await expectStatus('Мастер получает текущий список до фактического прибытия', 200, request('GET', '/shift/people?includeAll=true', { userId: ids.master, factoryId }));
    check(!masterPeopleBefore.data?.some((person) => person.userId === ids.contractorA), 'Плановый наёмник скрыт от текущего списка мастера');

    await expectStatus('Старший другой фирмы не меняет факт чужого плана', 409, request('PATCH', `/shift/contractor-submissions/${plan.data.id}/items/${item.id}/actual`, {
      userId: ids.leadB,
      factoryId,
      body: { actualStatus: 'ARRIVED', expectedVersion: item.version, operationId: `p3-${runId}-cross-company` },
    }));
    const arrived = await expectStatus('Старший своей фирмы подтверждает фактическое прибытие', 200, request('PATCH', `/shift/contractor-submissions/${plan.data.id}/items/${item.id}/actual`, {
      userId: ids.leadA,
      factoryId,
      body: { actualStatus: 'ARRIVED', expectedVersion: item.version, operationId: `p3-${runId}-arrived` },
    }));
    const arrivedRepeat = await expectStatus('Повтор факта с тем же operationId идемпотентен', 200, request('PATCH', `/shift/contractor-submissions/${plan.data.id}/items/${item.id}/actual`, {
      userId: ids.leadA,
      factoryId,
      body: { actualStatus: 'ARRIVED', expectedVersion: item.version, operationId: `p3-${runId}-arrived` },
    }));
    check(arrived.data?.id === arrivedRepeat.data?.id && arrived.data?.actualStatus === ContractorActualStatus.ARRIVED, 'Plan и fact разделены, повтор не создаёт второй факт');
    const masterPeopleAfter = await expectStatus('После прибытия мастер видит наёмника', 200, request('GET', '/shift/people?includeAll=true', { userId: ids.master, factoryId }));
    check(masterPeopleAfter.data?.some((person) => person.userId === ids.contractorA && person.companyId === companyA.id), 'Фактически прибывший наёмник виден с badge фирмы');
    const contractorAssignment = await expectStatus('После прибытия мастер назначает наёмника в canonical TIME', 201, request('POST', `/work-areas/${timeArea.id}/assign`, {
      userId: ids.master,
      factoryId,
      body: { targetUserId: ids.contractorA, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, operationId: `p3-${runId}-contractor-assign` },
    }));
    check(contractorAssignment.data?.kind === AssignmentKind.TIME, 'Фактический наёмник использует общий Assignment engine');
    await expectStatus('Освобождение фактического наёмника', 201, request('POST', '/assignments/release', { userId: ids.master, factoryId, body: { targetUserId: ids.contractorA } }));

    const replacementOp = `p3-${runId}-replacement`;
    const replacement = await expectStatus('Старший добавляет фактическую замену текущей смены', 201, request('POST', '/shift/contractor-lead/current-arrivals', {
      userId: ids.leadA,
      factoryId,
      body: { contractorUserId: ids.contractorA2, operationId: replacementOp },
    }));
    const replacementRepeat = await expectStatus('Повтор замены с operationId идемпотентен', 201, request('POST', '/shift/contractor-lead/current-arrivals', {
      userId: ids.leadA,
      factoryId,
      body: { contractorUserId: ids.contractorA2, operationId: replacementOp },
    }));
    check(replacement.data?.id === replacementRepeat.data?.id, 'Замена не создаёт второй submission item');
    check(await db.shiftSession.count({ where: { factoryId, userId: ids.contractorA2, status: ShiftSessionStatus.ACTIVE } }) === 1, 'Замена создаёт ровно одну active ShiftSession');

    const otherCompanyPlan = await expectStatus('Вторая фирма создаёт независимый план', 201, request('POST', '/shift/contractor-submissions', {
      userId: ids.leadB,
      factoryId,
      body: { targetShiftDate: currentDate, shiftType: current.shiftType, contractorUserIds: [ids.contractorB], operationId: `p3-${runId}-plan-b` },
    }));
    check(otherCompanyPlan.data?.companyId === companyB.id, 'Планы двух фирм не смешиваются');
    const poolA = await expectStatus('Старший видит pool только своей фирмы', 200, request('GET', '/shift/contractor-lead/pool', { userId: ids.leadA, factoryId }));
    check(poolA.data?.people?.every((person) => [ids.contractorA, ids.contractorA2].includes(person.userId)) && !poolA.data?.people?.some((person) => person.userId === ids.contractorB), 'Company isolation действует в pool');
    if (otherFactory) {
      await expectStatus('Чужой завод запрещён для старшего фирмы', 403, request('GET', '/shift/contractor-lead/pool', { userId: ids.leadA, factoryId: otherFactory.id }));
    }

    const techAreas = await expectStatus('TECH_* читает canonical TIME/WORK_AREA справочник', 200, request('GET', '/work-areas', { userId: ids.tech, factoryId }));
    check(techAreas.data?.some((area) => area.id === timeArea.id && area.assignmentKind === AssignmentKind.TIME), 'TECH_* видит TIME без mutating UI');
    await expectStatus('TECH_* не назначает через прямой API', 403, request('POST', `/work-areas/${timeArea.id}/assign`, { userId: ids.tech, factoryId, body: { targetUserId: ids.workerA } }));
    await expectStatus('TECH_* читает безопасный line overview', 200, request('GET', '/lines/shift-overview', { userId: ids.tech, factoryId }));
    const storeAreas = await expectStatus('STORE читает TIME positions', 200, request('GET', '/work-areas', { userId: ids.store, factoryId }));
    check(storeAreas.data?.some((area) => area.id === timeArea.id), 'STORE видит canonical TIME positions');
    await expectStatus('STORE не получает full line overview', 403, request('GET', '/lines/shift-overview', { userId: ids.store, factoryId }));
    const storePeople = await expectStatus('STORE получает только свободных WORKER/CONTRACTOR', 200, request('GET', '/shift/people?includeAll=true', { userId: ids.store, factoryId }));
    check(storePeople.data?.every((person) => ['WORKER', 'CONTRACTOR'].includes(person.role) && person.employeeState === EmployeeState.AVAILABLE && !person.currentAssignment), 'STORE read-model не раскрывает занятых или управляющие роли');
    const storeDirectory = await expectStatus('STORE People directory ограничен свободными исполнителями', 200, request('GET', '/people', { userId: ids.store, factoryId }));
    check(storeDirectory.data?.people?.every((person) => ['WORKER', 'CONTRACTOR'].includes(person.role) && person.employeeState === EmployeeState.AVAILABLE), 'STORE directory не раскрывает руководство и занятых сотрудников');
    const storeSearch = await expectStatus('STORE search сохраняет тот же ограниченный scope', 200, request('GET', '/people/search?q=zv3tmp', { userId: ids.store, factoryId }));
    check(storeSearch.data?.results?.every((person) => ['WORKER', 'CONTRACTOR'].includes(person.role) && !person.currentAssignmentSummary), 'STORE search не обходит scope списка');
    await expectStatus('STORE не открывает профиль занятой управляющей роли прямым API', 403, request('GET', `/people/${ids.master}`, { userId: ids.store, factoryId }));
    await expectStatus('WORKER читает безопасный line overview', 200, request('GET', '/lines/shift-overview', { userId: ids.workerA, factoryId }));
    await expectStatus('Обычный наёмник не читает общий line overview', 403, request('GET', '/lines/shift-overview', { userId: ids.contractorA, factoryId }));

    const next = addFactoryShifts(current, 1);
    await expectStatus('Свободный текст TIME запрещён в будущем плане', 409, request('POST', '/shift/future-assignments', {
      userId: ids.master,
      factoryId,
      body: { targetUserId: ids.workerA, shiftDate: next.shiftDate, shiftType: next.shiftType, kind: 'TIME', timeRoleName: 'Свободный текст' },
    }));
    const futureOperationId = `zv3-future-time-${runId}`;
    const futureBody = { targetUserId: ids.workerA, shiftDate: next.shiftDate, shiftType: next.shiftType, kind: 'TIME', workAreaId: timeArea.id, workAreaPositionId: timeArea.positions[0].id, slotIndex: 1, operationId: futureOperationId };
    const [futureAssignment, futureReplay] = await Promise.all([
      expectStatus('Будущий TIME использует canonical WorkAreaPosition', 201, request('POST', '/shift/future-assignments', {
        userId: ids.master,
        factoryId,
        body: futureBody,
      })),
      expectStatus('Повтор future assignment идемпотентен', 201, request('POST', '/shift/future-assignments', {
        userId: ids.master,
        factoryId,
        body: futureBody,
      })),
    ]);
    createdFutureAssignmentId = futureAssignment.data?.id ?? null;
    check(futureAssignment.data?.kind === AssignmentKind.TIME && futureAssignment.data?.workAreaPositionId === timeArea.positions[0].id, 'PlannedShiftAssignment хранит canonical TIME position');
    check(Boolean(createdFutureAssignmentId) && futureReplay.data?.id === createdFutureAssignmentId, 'Double submit возвращает один PlannedShiftAssignment');

    for (const userId of [ids.workerA, ids.workerB, ids.workerC, ids.contractorA, ids.contractorA2]) {
      const activeAssignment = await db.assignment.findFirst({ where: { factoryId, userId, endedAt: null } });
      if (activeAssignment) await request('POST', '/assignments/release', { userId: ids.master, factoryId, body: { targetUserId: userId } });
      const activeSession = await db.shiftSession.findFirst({ where: { factoryId, userId, status: ShiftSessionStatus.ACTIVE } });
      if (activeSession) await request('POST', '/shift/end', { userId, factoryId });
    }
    const month = current.shiftDate.slice(0, 7);
    const workerArchive = await expectStatus('WORKER открывает только личный календарный архив', 200, request('GET', `/shift/past?month=${month}`, { userId: ids.workerA, factoryId }));
    check(Array.isArray(workerArchive.data?.shifts), 'Личный архив строится из ShiftSession/Assignment history');
    const spoofArchive = await expectStatus('WORKER не подменяет userId личного архива', 200, request('GET', `/shift/past?month=${month}&userId=${ids.workerB}`, { userId: ids.workerA, factoryId }));
    check(JSON.stringify(spoofArchive.data) === JSON.stringify(workerArchive.data), 'userId spoof не меняет личный архив WORKER');
    const shiftKey = `${current.shiftDate}_${current.shiftType}`;
    const shiftArchive = await expectStatus('MASTER читает архив смены с фактом наёмных', 200, request('GET', `/shift/past/${shiftKey}`, { userId: ids.master, factoryId }));
    check(shiftArchive.data?.summary?.contractorCount >= 2, 'Архив считает только фактически прибывших наёмных');
    check(shiftArchive.data?.summary?.contractorCompanies?.some((row) => row.companyName === companyA.name && row.count >= 2), 'Архив использует исторический company snapshot');

    await db.externalCompany.update({ where: { id: companyB.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Завершение проверки Пласта 3' } });
    await expectStatus('Деактивированная фирма не управляет наёмниками', 409, request('GET', '/shift/contractor-lead/pool', { userId: ids.leadB, factoryId }));
    const auditActions = await db.auditLog.findMany({
      where: { factoryId, userId: { in: [ids.master, ids.leadA] }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
      select: { action: true },
    });
    const actionSet = new Set(auditActions.map((row) => row.action));
    check(actionSet.has('CONTRACTOR_SUBMISSION_CREATED') && actionSet.has('CONTRACTOR_ARRIVAL_CONFIRMED') && actionSet.has('ASSIGNMENT_TIME_CREATED'), 'Ключевые plan/fact/assignment действия записаны в общий аудит');
  } finally {
    if (createdFutureAssignmentId) {
      await request('POST', `/shift/future-assignments/${createdFutureAssignmentId}/release`, { userId: ids.master, factoryId, body: { operationId: `zv3-future-release-${runId}` } }).catch(() => null);
    }
    const now = new Date();
    await db.assignment.updateMany({ where: { factoryId, userId: { in: testUserIds }, endedAt: null }, data: { endedAt: now, endedById: ids.master, comment: 'Завершение проверки Пласта 3' } });
    await db.shiftSession.updateMany({ where: { factoryId, userId: { in: testUserIds }, status: ShiftSessionStatus.ACTIVE }, data: { status: ShiftSessionStatus.ENDED, endedAt: now, endedById: ids.master } });
    await db.user.updateMany({ where: { id: { in: testUserIds } }, data: { employeeState: EmployeeState.OFF_SHIFT, blockedAt: now } });
    await db.userFactoryAccess.updateMany({ where: { factoryId, userId: { in: testUserIds } }, data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение проверки Пласта 3' } });
    if (timeArea || workArea) {
      await db.workArea.updateMany({ where: { id: { in: [timeArea?.id, workArea?.id].filter(Boolean) } }, data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение проверки Пласта 3' } });
    }
    if (companyA || companyB) {
      await db.externalCompany.updateMany({ where: { id: { in: [companyA?.id, companyB?.id].filter(Boolean) } }, data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение проверки Пласта 3' } });
    }
  }
}

main()
  .catch((error) => failed.push({ name: 'Необработанная ошибка regression', detail: String(error?.stack || error) }))
  .finally(async () => {
    await db.$disconnect();
    for (const row of passed) console.log(`PASS ${row.name}`);
    for (const row of failed) console.error(`FAIL ${row.name}: ${JSON.stringify(row.detail ?? '')}`);
    console.log(`\nPilot fix Plast 3 regression: ${passed.length} passed, ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  });
