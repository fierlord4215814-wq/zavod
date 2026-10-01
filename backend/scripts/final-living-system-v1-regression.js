const { PrismaClient } = require('@prisma/client');

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const BASE_RUN_ID = process.env.FLSV1_RUN_ID || 'FLSV1_20260729T100947Z';
const runId = `${BASE_RUN_ID}_${Date.now()}`;
const db = new PrismaClient();
const state = { ok: [], failures: [], runId, artifact: null, cleanup: null };
const knownPassword = '1234';
const temporaryPassword = 'm';
const phone = `+7998${String(Date.now()).slice(-7)}`;
const canonicalPhone = phone;
let registeredUserId = null;
let factoryId = null;
const actorTokens = new Map();

function record(name, passed, detail) {
  (passed ? state.ok : state.failures).push({ name, ...(detail ? { detail } : {}) });
}

function clean(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, inner) => (
    /passwordHash|setupToken|accessToken|refreshToken|authToken|DATABASE_URL|storagePath|secret/i.test(key)
      ? '[hidden]'
      : inner
  )));
}

async function request(path, {
  method = 'GET',
  token,
  userId,
  selectedFactoryId,
  body,
  clientIp,
} = {}) {
  const headers = {};
  const bearer = token || (userId ? actorTokens.get(userId) : null);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (userId && !bearer) throw new Error(`Bearer token is not initialized for ${userId}`);
  if (selectedFactoryId) headers['x-factory-id'] = selectedFactoryId;
  if (clientIp) headers['cf-connecting-ip'] = clientIp;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function expectStatus(name, expected, promise, predicate) {
  const response = await promise;
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  const passed = expectedStatuses.includes(response.status) && (!predicate || predicate(response));
  record(name, passed, passed ? { status: response.status } : {
    expected: expectedStatuses,
    status: response.status,
    data: clean(response.data),
  });
  return response;
}

async function resetPreview(actorId, targetId, expectedAllowed, name) {
  return expectStatus(
    name,
    200,
    request(`/admin/users/${targetId}/password-reset/preview`, {
      userId: actorId,
      selectedFactoryId: factoryId,
    }),
    (response) => response.data?.allowed === expectedAllowed,
  );
}

async function initializeActorTokens(actorIds) {
  const actors = await db.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, phone: true },
  });
  for (const actorId of actorIds) {
    const actor = actors.find((item) => item.id === actorId);
    if (!actor?.phone) throw new Error(`Pilot actor has no login phone: ${actorId}`);
    const login = await request('/auth/login', {
      method: 'POST',
      body: { phone: actor.phone, password: knownPassword },
      clientIp: `198.51.100.${220 + actorTokens.size}`,
    });
    if (login.status !== 201 || !login.data?.token) throw new Error(`Pilot actor bearer login failed: ${actorId}`);
    actorTokens.set(actorId, login.data.token);
  }
}

async function restorePilotPassword() {
  const target = await db.user.findUnique({
    where: { id: 'pilot-pack-worker-source' },
    select: { passwordResetRequired: true },
  });
  if (!target) return;
  if (target.passwordResetRequired) {
    const resetLogin = await request('/auth/login', {
      method: 'POST',
      body: { phone: '+79000009012', password: '' },
      clientIp: '198.51.100.231',
    });
    if (resetLogin.status === 201 && resetLogin.data?.setupToken) {
      await request('/auth/set-password', {
        method: 'POST',
        body: {
          setupToken: resetLogin.data.setupToken,
          newPassword: knownPassword,
          passwordRepeat: knownPassword,
        },
        clientIp: '198.51.100.231',
      });
    }
    return;
  }

  const knownLogin = await request('/auth/login', {
    method: 'POST',
    body: { phone: '+79000009012', password: knownPassword },
    clientIp: '198.51.100.232',
  });
  if (knownLogin.status === 201) return;
  const temporaryLogin = await request('/auth/login', {
    method: 'POST',
    body: { phone: '+79000009012', password: temporaryPassword },
    clientIp: '198.51.100.233',
  });
  if (temporaryLogin.status === 201 && temporaryLogin.data?.token) {
    await request('/auth/change-password', {
      method: 'POST',
      token: temporaryLogin.data.token,
      selectedFactoryId: factoryId,
      body: { oldPassword: temporaryPassword, newPassword: knownPassword },
    });
  }
}

async function cleanupRegistrationArtifact() {
  if (!registeredUserId) {
    const user = await db.user.findUnique({
      where: { normalizedPhone: canonicalPhone },
      select: { id: true },
    });
    registeredUserId = user?.id ?? null;
  }
  if (!registeredUserId) return;
  await request(`/admin/users/${registeredUserId}/factory-access`, {
    method: 'PATCH',
    userId: 'test-admin',
    selectedFactoryId: factoryId,
    body: {
      factoryId,
      isActive: true,
      reason: `${runId}: registration regression cleanup preparation`,
    },
  });
  await request(`/admin/users/${registeredUserId}/block-status`, {
    method: 'PATCH',
    userId: 'test-admin',
    selectedFactoryId: factoryId,
    body: {
      blocked: true,
      reason: `${runId}: registration regression cleanup`,
    },
  });
  await request(`/admin/users/${registeredUserId}/factory-access`, {
    method: 'PATCH',
    userId: 'test-admin',
    selectedFactoryId: factoryId,
    body: {
      factoryId,
      isActive: false,
      reason: `${runId}: registration regression cleanup`,
    },
  });
}

async function main() {
  const health = await request('/health');
  record('fresh backend health', health.status === 200 && health.data?.status === 'ok', { status: health.status });

  const factory = await db.factory.findUnique({ where: { code: 'factory-4' }, select: { id: true } });
  if (!factory) throw new Error('Registration factory is not configured');
  factoryId = factory.id;
  const otherFactory = await db.factory.findFirst({
    where: { id: { not: factoryId }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  await initializeActorTokens([
    'pilot-master-1',
    'pilot-pack-kipia-lead',
    'pilot-pack-management',
    'contractor-lead-1',
    'pilot-pack-admin',
    'pilot-worker-1',
    'test-admin',
  ]);

  const startedAt = new Date();

  try {
    await expectStatus('registration rejects invalid phone', 403, request('/auth/register', {
      method: 'POST',
      clientIp: '198.51.100.201',
      body: { phone: '123', password: 'x', passwordRepeat: 'x', operationId: `${runId}_invalid` },
    }));
    await expectStatus('registration rejects empty password', 403, request('/auth/register', {
      method: 'POST',
      clientIp: '198.51.100.202',
      body: { phone: `+7997${String(Date.now()).slice(-7)}`, password: '', passwordRepeat: '', operationId: `${runId}_empty` },
    }));
    await expectStatus('registration rejects mismatched passwords', 403, request('/auth/register', {
      method: 'POST',
      clientIp: '198.51.100.203',
      body: { phone: `+7996${String(Date.now()).slice(-7)}`, password: 'x', passwordRepeat: 'y', operationId: `${runId}_mismatch` },
    }));

    const registrationBody = {
      phone,
      password: 'x',
      passwordRepeat: 'x',
      operationId: runId,
      role: 'ADMIN',
      factoryId: otherFactory?.id,
      departmentId: 'forbidden',
    };
    const doubleSubmit = await Promise.all([
      request('/auth/register', { method: 'POST', clientIp: '198.51.100.204', body: registrationBody }),
      request('/auth/register', { method: 'POST', clientIp: '198.51.100.204', body: registrationBody }),
    ]);
    const successfulRegistration = doubleSubmit.find((item) => item.status === 201);
    record(
      'double submit creates one account',
      doubleSubmit.filter((item) => item.status === 201).length === 1
        && doubleSubmit.filter((item) => item.status === 403).length === 1,
      { statuses: doubleSubmit.map((item) => item.status) },
    );
    registeredUserId = successfulRegistration?.data?.userId ?? null;
    record(
      'registration response enters Guest/Pending assignment',
      Boolean(
        registeredUserId
        && successfulRegistration?.data?.token
        && successfulRegistration.data.availableFactories?.length === 1
        && successfulRegistration.data.availableFactories[0]?.isGuest === true,
      ),
    );

    const registered = await db.user.findUnique({
      where: { normalizedPhone: canonicalPhone },
      include: { factoryAccess: true },
    });
    record('canonical phone creates exactly one user', Boolean(registered && registered.id === registeredUserId), {
      count: await db.user.count({ where: { normalizedPhone: canonicalPhone } }),
    });
    record(
      'registration ignores attempted privilege/factory injection',
      Boolean(
        registered
        && registered.role === 'OTHER'
        && registered.factoryAccess.length === 1
        && registered.factoryAccess[0].factoryId === factoryId
        && registered.factoryAccess[0].role === 'OTHER'
        && registered.factoryAccess[0].isGuest === true
        && registered.factoryAccess[0].departmentId === null
        && registered.factoryAccess[0].jobTitleId === null
        && registered.factoryAccess[0].companyId === null,
      ),
    );
    record(
      'password is stored only as a protected hash',
      Boolean(registered?.passwordHash && registered.passwordHash !== 'x' && registered.passwordHash.startsWith('scrypt$')),
    );

    await expectStatus('same phone in +7/8 format is rejected', 403, request('/auth/register', {
      method: 'POST',
      clientIp: '198.51.100.205',
      body: {
        phone: `8${canonicalPhone.slice(2)}`,
        password: 'x',
        passwordRepeat: 'x',
        operationId: `${runId}_alternate`,
      },
    }));
    await expectStatus('pre-existing phone is rejected', 403, request('/auth/register', {
      method: 'POST',
      clientIp: '198.51.100.206',
      body: {
        phone: '+79000004701',
        password: 'x',
        passwordRepeat: 'x',
        operationId: `${runId}_existing`,
      },
    }));
    await expectStatus('blocked legacy duplicate does not lock out the one usable profile', 201, request('/auth/login', {
      method: 'POST',
      clientIp: '198.51.100.208',
      body: { phone: '+79000004701', password: knownPassword },
    }), (response) => response.data?.userId === 'pilot-worker-1' && Boolean(response.data?.token));

    const registeredToken = successfulRegistration?.data?.token;
    await expectStatus('registered Guest refresh uses canonical /auth/me', 200, request('/auth/me', {
      token: registeredToken,
      selectedFactoryId: factoryId,
    }), (response) => response.data?.isGuest === true && response.data?.role === 'OTHER');
    await expectStatus('registered Guest reconnect remains canonical', 200, request('/auth/me', {
      token: registeredToken,
      selectedFactoryId: factoryId,
    }), (response) => response.data?.isGuest === true && response.data?.availableFactories?.length === 1);
    await expectStatus('registered Guest cannot read production shift', 403, request('/shift/current', {
      token: registeredToken,
      selectedFactoryId: factoryId,
    }));
    await expectStatus('registered Guest cannot read announcements', 403, request('/announcements/current', {
      token: registeredToken,
      selectedFactoryId: factoryId,
    }));

    const limiterPhone = `+7995${String(Date.now()).slice(-7)}`;
    const limited = [];
    for (let index = 0; index < 6; index += 1) {
      limited.push(await request('/auth/register', {
        method: 'POST',
        clientIp: '198.51.100.207',
        body: {
          phone: limiterPhone,
          password: 'x',
          passwordRepeat: 'y',
          operationId: `${runId}_limit_${index}`,
        },
      }));
    }
    record('registration rate limit returns 429', limited.slice(0, 5).every((item) => item.status === 403) && limited[5].status === 429, {
      statuses: limited.map((item) => item.status),
    });

    await resetPreview('pilot-master-1', 'pilot-pack-worker-source', true, 'MASTER can reset subordinate in own department');
    await resetPreview('pilot-pack-kipia-lead', 'pilot-tech-kipia-1', true, 'service lead uses the same hierarchy policy');
    await resetPreview('pilot-pack-management', 'pilot-pack-worker-source', false, 'MANAGEMENT cannot reset an employee from another department');
    await resetPreview('pilot-pack-management', 'pilot-pack-admin', false, 'MANAGEMENT cannot reset ADMIN');
    await resetPreview('contractor-lead-1', 'contractor-1', true, 'contractor lead can reset own company worker');
    await resetPreview('contractor-lead-1', 'pilot-pack-worker-source', false, 'contractor lead cannot reset foreign company employee');
    await resetPreview('pilot-pack-admin', 'pilot-pack-worker-source', true, 'ADMIN keeps full factory reset scenario');
    await expectStatus('ordinary WORKER direct reset preview is denied', 403, request('/admin/users/pilot-pack-worker-source/password-reset/preview', {
      userId: 'pilot-worker-1',
      selectedFactoryId: factoryId,
    }));
    if (otherFactory) {
      await expectStatus('cross-factory reset is denied', 403, request('/admin/users/pilot-pack-worker-source/password-reset', {
        method: 'POST',
        userId: 'pilot-master-1',
        selectedFactoryId: otherFactory.id,
        body: { reason: `${runId}: cross-factory denial` },
      }));
    }

    const oldLogin = await expectStatus('subordinate login works before manager reset', 201, request('/auth/login', {
      method: 'POST',
      clientIp: '198.51.100.210',
      body: { phone: '+79000009012', password: knownPassword },
    }), (response) => Boolean(response.data?.token));
    const resetResponses = await Promise.all([
      request('/admin/users/pilot-pack-worker-source/password-reset', {
        method: 'POST',
        userId: 'pilot-master-1',
        selectedFactoryId: factoryId,
        body: { reason: `${runId}: manager reset` },
      }),
      request('/admin/users/pilot-pack-worker-source/password-reset', {
        method: 'POST',
        userId: 'pilot-master-1',
        selectedFactoryId: factoryId,
        body: { reason: `${runId}: manager reset duplicate` },
      }),
    ]);
    record(
      'manager reset double submit is idempotent',
      resetResponses.every((item) => item.status === 201)
        && resetResponses.filter((item) => item.data?.idempotent === false).length === 1
        && resetResponses.filter((item) => item.data?.idempotent === true).length === 1,
      { results: resetResponses.map((item) => ({ status: item.status, idempotent: item.data?.idempotent })) },
    );
    await expectStatus('old bearer session is revoked without one-second delay', 200, request('/auth/me', {
      token: oldLogin.data?.token,
      selectedFactoryId: factoryId,
    }), (response) => response.data?.isGuest === true);

    const resetLogin = await expectStatus('reset flow requires phone but not old password', 201, request('/auth/login', {
      method: 'POST',
      clientIp: '198.51.100.211',
      body: { phone: '+79000009012', password: '' },
    }), (response) => response.data?.requiresPasswordChange === true && Boolean(response.data?.setupToken));
    await expectStatus('reset flow rejects mismatched new passwords', 403, request('/auth/set-password', {
      method: 'POST',
      clientIp: '198.51.100.211',
      body: { setupToken: resetLogin.data?.setupToken, newPassword: temporaryPassword, passwordRepeat: 'different' },
    }));
    const setPassword = await expectStatus('reset accepts a non-empty one-character password', 201, request('/auth/set-password', {
      method: 'POST',
      clientIp: '198.51.100.211',
      body: {
        setupToken: resetLogin.data?.setupToken,
        newPassword: temporaryPassword,
        passwordRepeat: temporaryPassword,
      },
    }), (response) => Boolean(response.data?.token));
    await expectStatus('used setup token cannot be replayed', 403, request('/auth/set-password', {
      method: 'POST',
      clientIp: '198.51.100.211',
      body: {
        setupToken: resetLogin.data?.setupToken,
        newPassword: 'z',
        passwordRepeat: 'z',
      },
    }));
    await expectStatus('old password is rejected after reset', 401, request('/auth/login', {
      method: 'POST',
      clientIp: '198.51.100.212',
      body: { phone: '+79000009012', password: knownPassword },
    }));
    await expectStatus('new password works after reset', 201, request('/auth/login', {
      method: 'POST',
      clientIp: '198.51.100.213',
      body: { phone: '+79000009012', password: temporaryPassword },
    }));
    await expectStatus('pilot password is restored through canonical change-password', 201, request('/auth/change-password', {
      method: 'POST',
      token: setPassword.data?.token,
      selectedFactoryId: factoryId,
      body: { oldPassword: temporaryPassword, newPassword: knownPassword },
    }), (response) => response.data?.ok === true);

    const managerResetAudits = await db.auditLog.count({
      where: {
        factoryId,
        action: 'MANAGER_PASSWORD_RESET',
        entityId: 'pilot-pack-worker-source',
        createdAt: { gte: startedAt },
      },
    });
    record('manager reset writes exactly one audit on double submit', managerResetAudits === 1, { count: managerResetAudits });
    const authAudits = await db.auditLog.findMany({
      where: {
        createdAt: { gte: startedAt },
        action: {
          in: [
            'USER_SELF_REGISTERED',
            'MANAGER_PASSWORD_RESET',
            'PASSWORD_RESET_FLOW_STARTED',
            'PASSWORD_SET_AFTER_RESET',
          ],
        },
      },
      select: { details: true },
    });
    const auditText = JSON.stringify(authAudits.map((item) => item.details));
    record(
      'auth audit contains no passwords, hashes, setup tokens or secrets',
      !/passwordHash|newPassword|oldPassword|passwordRepeat|setupToken|DATABASE_URL|JWT_SECRET|Bearer\s+/i.test(auditText),
    );

    const loginLimiterPhone = `+7994${String(Date.now()).slice(-7)}`;
    const loginLimited = [];
    for (let index = 0; index < 11; index += 1) {
      loginLimited.push(await request('/auth/login', {
        method: 'POST',
        clientIp: '198.51.100.214',
        body: { phone: loginLimiterPhone, password: 'wrong' },
      }));
    }
    record('login rate limit returns 429', loginLimited.slice(0, 10).every((item) => item.status === 401) && loginLimited[10].status === 429, {
      statuses: loginLimited.map((item) => item.status),
    });
  } finally {
    await restorePilotPassword();
    await cleanupRegistrationArtifact();

    const activeArtifacts = await db.user.count({
      where: {
        normalizedPhone: canonicalPhone,
        blockedAt: null,
        deletedAt: null,
        factoryAccess: { some: { isActive: true } },
      },
    });
    const access = registeredUserId
      ? await db.userFactoryAccess.findUnique({
          where: { userId_factoryId: { userId: registeredUserId, factoryId } },
          select: { isActive: true },
        })
      : null;
    const user = registeredUserId
      ? await db.user.findUnique({ where: { id: registeredUserId }, select: { blockedAt: true } })
      : null;
    state.artifact = registeredUserId ? { userId: registeredUserId, phoneMarker: canonicalPhone } : null;
    state.cleanup = {
      activeArtifacts,
      registrationUserBlocked: Boolean(user?.blockedAt),
      registrationFactoryAccessActive: access?.isActive ?? null,
      preexistingEntitiesDeleted: 0,
    };
    record(
      'canonical cleanup leaves zero active registration artifacts',
      activeArtifacts === 0 && Boolean(user?.blockedAt) && access?.isActive === false,
      state.cleanup,
    );
    const restoredLogin = await request('/auth/login', {
      method: 'POST',
      clientIp: '198.51.100.240',
      body: { phone: '+79000009012', password: knownPassword },
    });
    record('pre-existing pilot password/state restored', restoredLogin.status === 201 && Boolean(restoredLogin.data?.token), {
      status: restoredLogin.status,
    });
  }

  console.log(JSON.stringify(state, null, 2));
  if (state.failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
