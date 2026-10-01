const { randomBytes, scryptSync } = require('node:crypto');
const { PrismaClient, DepartmentScope, PermissionEffect, UserRole } = require('@prisma/client');

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

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
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

async function ensureAccess({ userId, factoryId, role, departmentId = null, companyId = null, isGuest = false, permissions = [] }) {
  await db.user.upsert({
    where: { id: userId },
    update: { factoryId, role, blockedAt: null, deletedAt: null },
    create: { id: userId, factoryId, role },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId } },
    update: {
      role,
      departmentId,
      companyId,
      jobTitleId: null,
      isGuest,
      isActive: true,
      deactivatedAt: null,
      deactivationReason: null,
    },
    create: { userId, factoryId, role, departmentId, companyId, isGuest, isActive: true },
  });
  for (const permissionCode of permissions) {
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId, factoryId, permissionCode } },
      update: { effect: PermissionEffect.ALLOW },
      create: { userId, factoryId, permissionCode, effect: PermissionEffect.ALLOW },
    });
  }
}

async function expectStatus(name, expected, promise) {
  const response = await promise;
  check(response.status === expected, name, response.status === expected ? undefined : { expected, actual: response.status, data: response.data });
  check(!hasForbidden(response.data), `${name}: ответ не раскрывает секреты`);
  return response;
}

async function roleCodes(role) {
  return new Set((await db.rolePermission.findMany({ where: { role, isActive: true }, select: { permissionCode: true } })).map((row) => row.permissionCode));
}

async function main() {
  const runId = Date.now().toString(36);
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  if (!factory) throw new Error('factory-4 not found');
  const factoryId = factory.id;
  const departmentRows = await db.department.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      scope: DepartmentScope.LOCAL,
      factoryId,
    },
    orderBy: { createdAt: 'asc' },
  });
  const departments = departmentRows.filter((row) => !/stage|test|demo|regression/i.test(`${row.id} ${row.name} ${row.code}`)).slice(0, 3);
  if (departments.length < 2) throw new Error('Two active departments are required');
  const [department, foreignDepartment] = departments;

  const guestId = `stage-plast2-${runId}-guest`;
  const leaderId = `stage-plast2-${runId}-leader`;
  const foreignLeaderId = `stage-plast2-${runId}-foreign-leader`;
  const ordinaryId = `stage-plast2-${runId}-ordinary`;
  const techId = `stage-plast2-${runId}-tech`;
  const storeId = `stage-plast2-${runId}-store`;
  const technologistId = `stage-plast2-${runId}-technologist`;
  const okkId = `stage-plast2-${runId}-okk`;
  const managementId = `stage-plast2-${runId}-management`;
  await ensureAccess({ userId: guestId, factoryId, role: UserRole.OTHER, isGuest: true });
  await ensureAccess({ userId: leaderId, factoryId, role: UserRole.MASTER, departmentId: department.id, permissions: ['admin.users.manage'] });
  await ensureAccess({ userId: foreignLeaderId, factoryId, role: UserRole.MASTER, departmentId: foreignDepartment.id, permissions: ['admin.users.manage'] });
  await ensureAccess({ userId: ordinaryId, factoryId, role: UserRole.WORKER, departmentId: department.id });
  await ensureAccess({ userId: techId, factoryId, role: UserRole.TECH_KIPIA, departmentId: department.id });
  await ensureAccess({ userId: storeId, factoryId, role: UserRole.STORE, departmentId: department.id });
  await ensureAccess({ userId: technologistId, factoryId, role: UserRole.TECHNOLOG, departmentId: department.id });
  await ensureAccess({ userId: okkId, factoryId, role: UserRole.OKK, departmentId: department.id });
  await ensureAccess({ userId: managementId, factoryId, role: UserRole.MANAGEMENT, departmentId: department.id });

  const guestContext = await expectStatus('Гость получает canonical варианты назначения', 200,
    request('GET', '/auth/assignment-request', { userId: guestId, factoryId }));
  const assignmentOptions = guestContext.data?.options?.assignments ?? [];
  const workerOption = assignmentOptions.find((row) => row.label === `Работник · ${department.name}`);
  const masterOption = assignmentOptions.find((row) => row.label === `Мастер · ${department.name}`);
  check(Boolean(workerOption && masterOption), 'Стартовые назначения работника и мастера доступны одним server-provided selector');
  check(!assignmentOptions.some((row) => /Старший наёмных работников|Администратор|stage|test|demo|regression/i.test(`${row.label} ${row.description}`)), 'Самоповышение и diagnostic назначения скрыты');
  await expectStatus('Гость не читает объявления даже при старой настройке guestCanRead', 403,
    request('GET', '/announcements/current', { userId: guestId, factoryId }));

  await expectStatus('Гость не может запросить CONTRACTOR_LEAD прямым API', 403,
    request('POST', '/auth/assignment-request', {
      userId: guestId,
      factoryId,
      body: { requestedRole: 'CONTRACTOR_LEAD', departmentId: department.id, operationId: `plast2-${runId}-escalate` },
    }));

  const operationId = `plast2-${runId}-worker`;
  const created = await expectStatus('Гость создаёт одну заявку WORKER', 201,
    request('POST', '/auth/assignment-request', {
      userId: guestId,
      factoryId,
      body: { assignmentOptionId: workerOption?.id, comment: 'Проверка назначения', operationId },
    }));
  const duplicate = await expectStatus('Повтор с тем же operationId идемпотентен', 201,
    request('POST', '/auth/assignment-request', {
      userId: guestId,
      factoryId,
      body: { assignmentOptionId: workerOption?.id, operationId },
    }));
  const secondOperation = await expectStatus('Вторая отправка возвращает текущую активную заявку', 201,
    request('POST', '/auth/assignment-request', {
      userId: guestId,
      factoryId,
      body: { assignmentOptionId: masterOption?.id, operationId: `${operationId}-second` },
    }));
  check(Boolean(created.data?.id) && created.data.id === duplicate.data?.id && created.data.id === secondOperation.data?.id, 'Одна активная заявка сохраняется без дублей');

  const leaderList = await expectStatus('Руководитель видит заявку только своего отдела', 200,
    request('GET', '/admin/assignment-requests?status=PENDING', { userId: leaderId, factoryId }));
  check(leaderList.data?.some((row) => row.id === created.data?.id), 'Заявка присутствует у правильного руководителя');
  const foreignList = await expectStatus('Руководитель чужого отдела получает безопасный список', 200,
    request('GET', '/admin/assignment-requests?status=PENDING', { userId: foreignLeaderId, factoryId }));
  check(!foreignList.data?.some((row) => row.id === created.data?.id), 'Заявка чужого отдела скрыта до действия');
  await expectStatus('Руководитель чужого отдела не принимает заявку прямым API', 403,
    request('POST', `/admin/assignment-requests/${created.data.id}/accept`, {
      userId: foreignLeaderId,
      factoryId,
      body: { expectedVersion: created.data.version, operationId: `plast2-${runId}-foreign-deny` },
    }));
  await expectStatus('Обычный сотрудник не открывает очередь заявок', 403,
    request('GET', '/admin/assignment-requests?status=PENDING', { userId: ordinaryId, factoryId }));

  await expectStatus('Stale version не принимает заявку', 409,
    request('POST', `/admin/assignment-requests/${created.data.id}/accept`, {
      userId: 'test-admin',
      factoryId,
      body: { expectedVersion: created.data.version + 1, operationId: `plast2-${runId}-stale` },
    }));
  const accepted = await expectStatus('ADMIN атомарно принимает заявку', 201,
    request('POST', `/admin/assignment-requests/${created.data.id}/accept`, {
      userId: 'test-admin',
      factoryId,
      body: { expectedVersion: created.data.version, reason: 'Целевая проверка пласта 2', operationId: `plast2-${runId}-accept` },
    }));
  check(accepted.data?.request?.status === 'ACCEPTED' && accepted.data?.access?.isGuest === false, 'Guest превращён в WORKER через canonical access');
  const acceptedAgain = await expectStatus('Повторное принятие идемпотентно', 201,
    request('POST', `/admin/assignment-requests/${created.data.id}/accept`, {
      userId: 'test-admin',
      factoryId,
      body: { expectedVersion: created.data.version, operationId: `plast2-${runId}-accept-repeat` },
    }));
  check(acceptedAgain.data?.idempotent === true, 'Повторное решение не создаёт вторую запись');
  const convertedMe = await expectStatus('После решения /auth/me сразу возвращает новую роль', 200,
    request('GET', '/auth/me', { userId: guestId, factoryId }));
  check(convertedMe.data?.role === 'WORKER' && convertedMe.data?.isGuest === false && convertedMe.data?.departmentId === department.id, 'Live auth context обновлён без повторного входа');

  const companyName = `Пилотная фирма ${runId}`;
  const otherCompanyName = `Пилотная фирма ${runId} Б`;
  const companyCreate = await expectStatus('ADMIN создаёт внешнюю фирму в выбранном заводе', 201,
    request('POST', '/admin/external-companies', { userId: 'test-admin', factoryId, body: { factoryId, name: companyName, operationId: `plast2-${runId}-company` } }));
  const otherCompanyCreate = await expectStatus('ADMIN создаёт вторую фирму для isolation-проверки', 201,
    request('POST', '/admin/external-companies', { userId: 'test-admin', factoryId, body: { factoryId, name: otherCompanyName, operationId: `plast2-${runId}-company-b` } }));
  const companyId = companyCreate.data?.id;
  const otherCompanyId = otherCompanyCreate.data?.id;
  if (!companyId || !otherCompanyId) throw new Error('External company creation failed');

  const contractorGuestId = `stage-plast2-${runId}-contractor-guest`;
  const companyLeadId = `stage-plast2-${runId}-company-lead`;
  const otherCompanyLeadId = `stage-plast2-${runId}-other-company-lead`;
  await ensureAccess({ userId: contractorGuestId, factoryId, role: UserRole.OTHER, isGuest: true });
  await ensureAccess({ userId: companyLeadId, factoryId, role: UserRole.CONTRACTOR_LEAD, companyId });
  await ensureAccess({ userId: otherCompanyLeadId, factoryId, role: UserRole.CONTRACTOR_LEAD, companyId: otherCompanyId });
  const contractorContext = await expectStatus('После создания фирмы сервер выдаёт atomic contractor option', 200,
    request('GET', '/auth/assignment-request', { userId: contractorGuestId, factoryId }));
  const contractorOption = contractorContext.data?.options?.assignments?.find((row) => row.label === `Наёмный работник · ${companyName}`);
  check(Boolean(contractorOption), 'Фирма доступна как единое назначение без отдельных role/company полей');
  const contractorRequest = await expectStatus('Гость запрашивает назначение в выбранную фирму', 201,
    request('POST', '/auth/assignment-request', {
      userId: contractorGuestId,
      factoryId,
      body: { assignmentOptionId: contractorOption?.id, comment: 'Проверка фирмы', operationId: `plast2-${runId}-contractor` },
    }));
  const companyLeadList = await expectStatus('Старший видит заявку своей фирмы', 200,
    request('GET', '/admin/assignment-requests?status=PENDING', { userId: companyLeadId, factoryId }));
  check(companyLeadList.data?.some((row) => row.id === contractorRequest.data?.id), 'Company scope включает только собственную заявку');
  const otherCompanyList = await expectStatus('Старший другой фирмы получает безопасный список', 200,
    request('GET', '/admin/assignment-requests?status=PENDING', { userId: otherCompanyLeadId, factoryId }));
  check(!otherCompanyList.data?.some((row) => row.id === contractorRequest.data?.id), 'Заявка другой фирмы скрыта');
  await expectStatus('Старший другой фирмы не принимает заявку прямым API', 403,
    request('POST', `/admin/assignment-requests/${contractorRequest.data.id}/accept`, {
      userId: otherCompanyLeadId,
      factoryId,
      body: { expectedVersion: contractorRequest.data.version, operationId: `plast2-${runId}-wrong-company` },
    }));
  const companyAccepted = await expectStatus('Старший фирмы принимает своего наёмного работника', 201,
    request('POST', `/admin/assignment-requests/${contractorRequest.data.id}/accept`, {
      userId: companyLeadId,
      factoryId,
      body: { expectedVersion: contractorRequest.data.version, reason: 'Принят в фирму', operationId: `plast2-${runId}-company-accept` },
    }));
  check(companyAccepted.data?.access?.role === 'CONTRACTOR' && companyAccepted.data?.access?.companyId === companyId, 'Принятие сохраняет companyId и factoryId');
  await expectStatus('Прямой API запрещает новую подрядную роль без фирмы', 409,
    request('POST', `/admin/users/${ordinaryId}/factory-access`, {
      userId: 'test-admin',
      factoryId,
      body: { factoryId, role: 'CONTRACTOR', companyId: null, operationId: `plast2-${runId}-missing-company` },
    }));

  const phoneSuffix = String(Date.now()).slice(-7);
  const canonicalPhone = `+7909${phoneSuffix}`;
  const phoneUserId = `stage-plast2-${runId}-phone`;
  await db.user.upsert({
    where: { id: phoneUserId },
    update: { factoryId, role: UserRole.WORKER, phone: canonicalPhone, normalizedPhone: canonicalPhone, passwordHash: hashPassword('1234'), passwordResetRequired: false, blockedAt: null, deletedAt: null },
    create: { id: phoneUserId, factoryId, role: UserRole.WORKER, phone: canonicalPhone, normalizedPhone: canonicalPhone, passwordHash: hashPassword('1234'), passwordResetRequired: false },
  });
  await db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId: phoneUserId, factoryId } },
    update: { role: UserRole.WORKER, departmentId: department.id, companyId: null, isGuest: false, isActive: true },
    create: { userId: phoneUserId, factoryId, role: UserRole.WORKER, departmentId: department.id, isGuest: false, isActive: true },
  });
  const phoneVariants = [canonicalPhone, `8${canonicalPhone.slice(2)}`, `+7 (${canonicalPhone.slice(2, 5)}) ${canonicalPhone.slice(5, 8)}-${canonicalPhone.slice(8, 10)}-${canonicalPhone.slice(10)}`];
  for (const phone of phoneVariants) {
    const login = await expectStatus(`Вход по формату ${phone.replace(/\d(?=\d{4})/g, '*')}`, 201,
      request('POST', '/auth/login', { body: { phone, password: '1234' } }));
    check(login.data?.userId === phoneUserId, 'Все форматы телефона указывают на один профиль');
  }
  const phoneCollisionGroups = await db.user.groupBy({ by: ['normalizedPhone'], where: { normalizedPhone: { not: null } }, _count: { _all: true }, having: { normalizedPhone: { _count: { gt: 1 } } } });
  check(phoneCollisionGroups.length === 0, 'Canonical phone storage не содержит коллизий');

  const matrix = Object.fromEntries(await Promise.all(Object.values(UserRole).map(async (role) => [role, await roleCodes(role)])));
  check(!matrix.WORKER.has('returns.read') && ![...matrix.WORKER].some((code) => code.startsWith('checklists.')), 'WORKER не получает возвраты и чек-листы');
  check(matrix.WORKER.has('defrost.read') && matrix.WORKER.has('chats.read'), 'WORKER получает требуемые рабочие коммуникации');
  check(![...matrix.WORKER].some((code) => /^(lines|tasks|orders|stock|admin|ops)\./.test(code)), 'WORKER не получает управление внутренними контурами');
  check(
    ['orders.read', 'orders.take', 'orders.restock'].every((code) => matrix.STORE.has(code))
      && ![...matrix.STORE].some((code) => /^(tasks|stock|checklists|defrost)\./.test(code))
      && !['orders.items.manage', 'orders.request', 'orders.requests.manage'].some((code) => matrix.STORE.has(code)),
    'STORE читает и двигает фактические остатки без настройки позиций, заявок и некондиции',
  );
  for (const role of ['TECH_MECHANIC', 'TECH_ELECTRIC', 'TECH_HOLOD', 'TECH_KIPIA', 'TECH_SANTECHNIK']) {
    check(matrix[role].has('lines.read') && matrix[role].has('shift.current.read') && !matrix[role].has('lines.manage') && ![...matrix[role]].some((code) => /^(orders|checklists)\./.test(code)), `${role}: read-only production matrix`);
  }
  for (const role of ['MASTER', 'MANAGEMENT', 'TECHNOLOG', 'OKK']) check(matrix[role].has('lines.manage'), `${role} может управлять линиями`);
  for (const role of ['MASTER', 'MANAGEMENT', 'TECHNOLOG', 'OKK', 'STORE']) check(matrix[role].has('returns.read'), `${role} видит возвраты`);
  check(matrix.CONTRACTOR_LEAD.has('company.members.manage') && !matrix.CONTRACTOR_LEAD.has('admin.users.manage'), 'Старший наёмных работников ограничен своей фирмой');
  check(!matrix.CONTRACTOR.has('notifications.read') && !matrix.CONTRACTOR_LEAD.has('notifications.read'), 'Наёмные роли не получают внутренние уведомления');
  check(![...matrix.CONTRACTOR].some((code) => /^(lines|people|tasks|announcements|chats|admin)\./.test(code)), 'CONTRACTOR ограничен своим статусом и сменой');
  check(![...matrix.CONTRACTOR_LEAD].some((code) => /^(lines|people|tasks|announcements|chats|admin)\./.test(code)), 'CONTRACTOR_LEAD не получает внутренние модули завода');

  await expectStatus('WORKER не читает линии прямым API', 403, request('GET', '/lines', { userId: ordinaryId, factoryId }));
  await expectStatus('WORKER не читает заявки прямым API', 403, request('GET', '/tasks', { userId: ordinaryId, factoryId }));
  await expectStatus('STORE не читает заявки прямым API', 403, request('GET', '/tasks', { userId: storeId, factoryId }));
  await expectStatus('TECH_* читает линии прямым API', 200, request('GET', '/lines', { userId: techId, factoryId }));
  await expectStatus('TECH_* не управляет линиями прямым API', 403,
    request('POST', '/lines/not-found/positions', { userId: techId, factoryId, body: { name: 'Недопустимая позиция' } }));
  for (const [label, userId] of [['TECHNOLOG', technologistId], ['OKK', okkId], ['MANAGEMENT', managementId], ['ADMIN', 'test-admin']]) {
    await expectStatus(`${label} читает линии в разрешённом scope`, 200, request('GET', '/lines', { userId, factoryId }));
  }
  await expectStatus('CONTRACTOR_LEAD не открывает общий список пользователей', 403,
    request('GET', '/admin/users', { userId: companyLeadId, factoryId }));
  await expectStatus('CONTRACTOR_LEAD не читает линии', 403,
    request('GET', '/lines', { userId: companyLeadId, factoryId }));
  const otherFactory = await db.factory.findFirst({ where: { id: { not: factoryId }, deletedAt: null }, select: { id: true } });
  if (otherFactory) {
    await expectStatus('WORKER не читает чужой завод', 403, request('GET', '/shift/current', { userId: ordinaryId, factoryId: otherFactory.id }));
    await expectStatus('Руководитель отдела не открывает заявки чужого завода', 403,
      request('GET', '/admin/assignment-requests?status=PENDING', { userId: leaderId, factoryId: otherFactory.id }));
  }

  const identityReport = await expectStatus('ADMIN получает read-only impact report', 200,
    request('GET', `/admin/organization-identity-report?factoryId=${encodeURIComponent(factoryId)}`, { userId: 'test-admin', factoryId }));
  check(identityReport.data?.automaticMergePerformed === false, 'Impact report не объединяет данные автоматически');
  check(identityReport.data?.phone?.collisionGroups === 0, 'Impact report подтверждает отсутствие phone collision');

  const auditActions = await db.auditLog.groupBy({
    by: ['action'],
    where: {
      factoryId,
      action: { in: ['ASSIGNMENT_REQUEST_CREATED', 'ASSIGNMENT_REQUEST_ACCEPTED', 'EXTERNAL_COMPANY_CREATED'] },
      createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    _count: { _all: true },
  });
  const auditSet = new Set(auditActions.map((row) => row.action));
  check(['ASSIGNMENT_REQUEST_CREATED', 'ASSIGNMENT_REQUEST_ACCEPTED', 'EXTERNAL_COMPANY_CREATED'].every((action) => auditSet.has(action)), 'Критичные действия записаны в аудит');

  for (const [id, name] of [[companyId, `Stage plast2 ${runId} company`], [otherCompanyId, `Stage plast2 ${runId} company B`]]) {
    await expectStatus('Diagnostic фирма штатно отключена после проверки', 200,
      request('PATCH', `/admin/external-companies/${id}`, {
        userId: 'test-admin',
        factoryId,
        body: { name, isActive: false, reason: 'Завершена целевая regression-проверка', operationId: `plast2-${runId}-deactivate-${id}` },
      }));
  }
  const visibleCompanies = await expectStatus('Diagnostic фирмы не засоряют обычный admin список', 200,
    request('GET', `/admin/external-companies?factoryId=${encodeURIComponent(factoryId)}`, { userId: 'test-admin', factoryId }));
  check(!visibleCompanies.data?.some((row) => row.id === companyId || row.id === otherCompanyId), 'Diagnostic фирмы скрыты после штатной деактивации и маркировки');

  await db.userFactoryAccess.updateMany({
    where: { factoryId, userId: { startsWith: `stage-plast2-${runId}-` } },
    data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Завершена целевая regression-проверка Пласта 2' },
  });

  console.log(JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', passed, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
