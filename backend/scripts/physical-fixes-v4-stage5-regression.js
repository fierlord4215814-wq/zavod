const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../node_modules/@prisma/client');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const FACTORY_ID = '537cbb48-7fba-48b6-80af-659f82cdaeb3';
const RUN_ID = 'PFFV4_20260727T075200Z';
const MARKER = '__PFFV4_PFFV4_20260727T075200Z__';
const manifestPath = path.resolve(__dirname, '../../docs/physical-fixes-v4-test-artifacts.json');
const attempt = `${Date.now()}-${process.pid}`;
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
const createdArtifacts = [];
const announcementIds = [];
const returnIds = [];

function record(name, ok, details) {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL: ${name}${details ? ` — ${details}` : ''}`);
}

async function request(userId, method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
      'x-factory-id': FACTORY_ID,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

async function uploadTinyPhoto(userId, entityId) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4gAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('entityType', 'RETURN_RECORD');
  form.append('entityId', entityId);
  form.append('kind', 'PHOTO');
  form.append('operationId', `return-photo:${attempt}`);
  form.append('file', new Blob([png], { type: 'image/png' }), 'return-photo.png');
  const response = await fetch(`${API}/attachments/upload`, {
    method: 'POST',
    headers: {
      'x-user-id': userId,
      'x-factory-id': FACTORY_ID,
    },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

function addArtifact(model, id, businessKey, cleanupStatus = 'ARCHIVED') {
  if (!id) return;
  createdArtifacts.push({
    model,
    id,
    businessKey,
    marker: MARKER,
    createdByRun: RUN_ID,
    cleanupStatus,
  });
}

function persistArtifacts() {
  if (!fs.existsSync(manifestPath) || !createdArtifacts.length) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const known = new Set((manifest.artifacts ?? []).map((item) => `${item.model}:${item.id}`));
  for (const artifact of createdArtifacts) {
    if (!known.has(`${artifact.model}:${artifact.id}`)) manifest.artifacts.push(artifact);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function profile(viewerId, targetId) {
  return request(viewerId, 'GET', `/people/${targetId}`);
}

function hasVisiblePhone(result) {
  return result.status === 200
    && /^\+?\d/.test(String(result.payload?.phone ?? ''))
    && result.payload?.phoneLabel !== 'Телефон скрыт';
}

async function createAnnouncement(userId, body, key) {
  const result = await request(userId, 'POST', '/announcements', body);
  const id = result.payload?.id ?? null;
  if (id) {
    announcementIds.push(id);
    addArtifact('Announcement', id, `${MARKER}:stage5-announcement:${key}`);
  }
  return result;
}

async function createReturn(userId, suffix) {
  const lines = await request(userId, 'GET', '/returns/publication-lines');
  const lineId = lines.payload?.[0]?.id ?? null;
  const result = await request(userId, 'POST', '/returns', {
    title: `Повреждённая упаковка ${suffix}`,
    reason: 'Продукция возвращена для проверки упаковки',
    article: `1050-${suffix}`,
    quantity: 30,
    unit: 'гофр',
    lineId,
    photoUrl: 'attachment-pending',
    operationId: `${MARKER}:stage5-return:${suffix}`,
  });
  const id = result.payload?.id ?? null;
  if (id) {
    returnIds.push(id);
    addArtifact('ReturnRecord', id, `${MARKER}:stage5-return:${suffix}`);
  }
  return result;
}

async function main() {
  try {
    const health = await fetch(`${API}/health`);
    record('fresh backend health is available', health.ok, `HTTP ${health.status}`);

    const workerToMaster = await profile('pilot-pack-worker-source', 'pilot-pack-master-source');
    record('WORKER sees direct master phone', hasVisiblePhone(workerToMaster), `HTTP ${workerToMaster.status}`);
    const contractorToLead = await profile('contractor-1', 'contractor-lead-1');
    record('CONTRACTOR sees contractor leader phone', hasVisiblePhone(contractorToLead), `HTTP ${contractorToLead.status}`);
    const leadToOwnContractor = await profile('mobile-contractor-lead', 'pilot-contractor-1');
    record('CONTRACTOR_LEAD sees phone only inside own company scope', hasVisiblePhone(leadToOwnContractor), `HTTP ${leadToOwnContractor.status}`);
    const masterToWorker = await profile('pilot-pack-master-source', 'pilot-pack-worker-source');
    record('MASTER sees WORKER phone', hasVisiblePhone(masterToWorker), `HTTP ${masterToWorker.status}`);
    const okkToWorker = await profile('test-okk', 'pilot-pack-worker-source');
    record('OKK sees phone in available factory context', hasVisiblePhone(okkToWorker), `HTTP ${okkToWorker.status}`);
    const storeToWorker = await profile('test-store', 'pilot-pack-worker-source');
    record('STORE sees phone in its available people context', hasVisiblePhone(storeToWorker), `HTTP ${storeToWorker.status}`);
    const techToWorker = await profile('mobile-tech-electric', 'pilot-pack-worker-source');
    record('TECH role sees phone in available factory context', hasVisiblePhone(techToWorker), `HTTP ${techToWorker.status}`);
    const otherToWorker = await profile('mobile-other-specialist', 'pilot-pack-worker-source');
    record('OTHER role reaches canonical DTO phone policy', hasVisiblePhone(otherToWorker), `HTTP ${otherToWorker.status}`);
    const managementToAdmin = await profile('test-management', 'test-admin');
    record('MANAGEMENT sees phone inside its department scope', hasVisiblePhone(managementToAdmin), `HTTP ${managementToAdmin.status}`);
    const workerPeer = await profile('pilot-pack-worker-source', 'worker-1');
    record('WORKER cannot read arbitrary peer profile phone', workerPeer.status === 403 || workerPeer.payload?.phone == null, `HTTP ${workerPeer.status}`);
    const guestProfile = await profile('pilot-pack-guest', 'pilot-pack-master-source');
    record('GUEST cannot open another employee profile', guestProfile.status === 403, `HTTP ${guestProfile.status}`);

    const delegation = await request('pilot-pack-senior-master', 'GET', `/admin/permission-delegation/context?factoryId=${FACTORY_ID}`);
    record('delegation context returns server-filtered candidates without search',
      delegation.status === 200
      && delegation.payload?.sourceCandidates?.length > 0
      && delegation.payload?.targetCandidates?.length > 0,
      `HTTP ${delegation.status}`,
    );
    record('delegation candidates carry human context',
      [...(delegation.payload?.sourceCandidates ?? []), ...(delegation.payload?.targetCandidates ?? [])]
        .every((candidate) => candidate.displayName && candidate.role && 'departmentName' in candidate));

    const audienceDepartments = await request('pilot-pack-master-source', 'GET', '/announcements/audience-departments');
    const audienceAccess = await prisma.userFactoryAccess.findMany({
      where: {
        factoryId: FACTORY_ID,
        userId: { in: ['pilot-pack-master-source', 'test-okk'] },
        isActive: true,
      },
      select: { departmentId: true },
    });
    const departmentIds = [...new Set(audienceAccess.map((item) => item.departmentId).filter(Boolean))];
    record('publisher receives factory-scoped audience departments',
      audienceDepartments.status === 200
      && departmentIds.length === 2
      && departmentIds.every((id) => audienceDepartments.payload?.some((item) => item.id === id)),
      `HTTP ${audienceDepartments.status}`,
    );

    const factoryAnnouncement = await createAnnouncement('pilot-pack-master-source', {
      title: `Информация для смены ${attempt}`,
      text: 'Объявление для всех сотрудников выбранного завода.',
      audienceType: 'FACTORY',
    }, 'factory');
    record('MASTER publishes for all factory', factoryAnnouncement.status === 201
      && factoryAnnouncement.payload?.audienceType === 'FACTORY'
      && factoryAnnouncement.payload?.scopeLabel === 'Весь завод', `HTTP ${factoryAnnouncement.status}`);
    const factoryVisible = await request('test-store', 'GET', `/announcements/${factoryAnnouncement.payload?.id}`);
    record('factory announcement is visible to another service', factoryVisible.status === 200, `HTTP ${factoryVisible.status}`);

    const ownDepartmentAnnouncement = await createAnnouncement('pilot-pack-master-source', {
      title: `Информация мастерам ${attempt}`,
      text: 'Объявление только для отдела мастеров.',
      audienceType: 'MY_DEPARTMENT',
    }, 'own-department');
    record('publisher can target own department', ownDepartmentAnnouncement.status === 201
      && ownDepartmentAnnouncement.payload?.audienceType === 'MY_DEPARTMENT', `HTTP ${ownDepartmentAnnouncement.status}`);
    const ownVisible = await request('pilot-pack-worker-source', 'GET', `/announcements/${ownDepartmentAnnouncement.payload?.id}`);
    const ownHidden = await request('test-okk', 'GET', `/announcements/${ownDepartmentAnnouncement.payload?.id}`);
    record('own-department audience is exact', ownVisible.status === 200 && ownHidden.status === 403,
      `own=${ownVisible.status}, outside=${ownHidden.status}`);

    const selectedAnnouncement = await createAnnouncement('test-okk', {
      title: `Информация двум отделам ${attempt}`,
      text: 'Объявление выбранным отделам.',
      audienceType: 'SELECTED',
      departmentIds,
    }, 'selected');
    record('OKK publishes to multiple selected departments', selectedAnnouncement.status === 201
      && selectedAnnouncement.payload?.audienceType === 'SELECTED'
      && selectedAnnouncement.payload?.departmentIds?.length === 2, `HTTP ${selectedAnnouncement.status}`);
    const selectedVisibleMasterDepartment = await request('pilot-pack-worker-source', 'GET', `/announcements/${selectedAnnouncement.payload?.id}`);
    const selectedVisibleOkkDepartment = await request('test-okk', 'GET', `/announcements/${selectedAnnouncement.payload?.id}`);
    const selectedHiddenOutside = await request('test-store', 'GET', `/announcements/${selectedAnnouncement.payload?.id}`);
    record('selected departments have exact visibility',
      selectedVisibleMasterDepartment.status === 200
      && selectedVisibleOkkDepartment.status === 200
      && selectedHiddenOutside.status === 403,
      `master=${selectedVisibleMasterDepartment.status}, okk=${selectedVisibleOkkDepartment.status}, outside=${selectedHiddenOutside.status}`);
    const selectedPayload = JSON.stringify(selectedAnnouncement.payload);
    record('announcement DTO has concise audience and no forbidden fields',
      /Отделы:/.test(selectedAnnouncement.payload?.scopeLabel ?? '')
      && ['storagePath', 'passwordHash', 'DATABASE_URL', 'accessToken', 'refreshToken', 'secret']
        .every((field) => !selectedPayload.includes(field)));

    const emptySelected = await request('test-okk', 'POST', '/announcements', {
      title: 'Нельзя сохранить',
      text: 'Пустая аудитория',
      audienceType: 'SELECTED',
      departmentIds: [],
    });
    record('selected audience cannot be empty', emptySelected.status === 409, `HTTP ${emptySelected.status}`);

    const foreignDepartment = await prisma.department.findFirst({
      where: {
        factoryId: { not: FACTORY_ID },
        deletedAt: null,
        scope: 'LOCAL',
      },
      select: { id: true },
    });
    if (foreignDepartment) {
      const crossFactoryAudience = await request('test-okk', 'POST', '/announcements', {
        title: 'Чужой отдел',
        text: 'Не должно сохраниться',
        audienceType: 'SELECTED',
        departmentIds: [foreignDepartment.id],
      });
      record('announcement audience rejects foreign factory department', crossFactoryAudience.status === 409, `HTTP ${crossFactoryAudience.status}`);
    }

    for (const [label, userId] of [['WORKER', 'pilot-pack-worker-source'], ['CONTRACTOR', 'contractor-1'], ['GUEST', 'pilot-pack-guest']]) {
      const denied = await request(userId, 'POST', '/announcements', {
        title: 'Запрещённая публикация',
        text: 'Не должна сохраниться',
        audienceType: 'FACTORY',
      });
      record(`${label} cannot publish announcement through direct API`, denied.status === 403, `HTTP ${denied.status}`);
    }

    const storeReturn = await createReturn('test-store', `store-${attempt}`);
    record('STORE creates return publication', storeReturn.status === 201 && Boolean(storeReturn.payload?.id), `HTTP ${storeReturn.status}`);
    let photo = { status: 0, payload: null };
    if (storeReturn.payload?.id) photo = await uploadTinyPhoto('test-store', storeReturn.payload.id);
    if (photo.payload?.id) addArtifact('Attachment', photo.payload.id, `${MARKER}:stage5-return-photo`, 'PRESERVED_IN_ARCHIVE');
    record('return publication receives a guarded photo attachment', photo.status === 201 && Boolean(photo.payload?.id), `HTTP ${photo.status}`);

    const okkReturn = await createReturn('test-okk', `okk-${attempt}`);
    record('OKK creates return publication', okkReturn.status === 201 && Boolean(okkReturn.payload?.id), `HTTP ${okkReturn.status}`);

    const workerReturns = await request('pilot-pack-worker-source', 'GET', '/returns');
    const contractorReturns = await request('contractor-1', 'GET', '/returns');
    const managementReturns = await request('test-management', 'GET', '/returns');
    const visibleReturn = (workerReturns.payload ?? []).find((item) => item.id === storeReturn.payload?.id);
    record('all assigned factory employees can read return feed',
      workerReturns.status === 200 && contractorReturns.status === 200 && managementReturns.status === 200,
      `worker=${workerReturns.status}, contractor=${contractorReturns.status}, management=${managementReturns.status}`);
    record('return feed DTO carries photo, article, quantity, unit, author and optional line',
      visibleReturn?.attachments?.length === 1
      && visibleReturn?.article
      && visibleReturn?.quantity === 30
      && visibleReturn?.unit === 'гофр'
      && visibleReturn?.author?.displayName
      && visibleReturn?.line?.name);

    const masterReturnDenied = await createReturn('pilot-pack-master-source', `master-denied-${attempt}`);
    record('MASTER cannot publish return through direct API', masterReturnDenied.status === 403, `HTTP ${masterReturnDenied.status}`);
    const guestReturns = await request('pilot-pack-guest', 'GET', '/returns');
    record('GUEST cannot read return feed', guestReturns.status === 403, `HTTP ${guestReturns.status}`);

    const foreignFactory = await prisma.factory.findFirst({
      where: { id: { not: FACTORY_ID }, deletedAt: null },
      select: { id: true },
    });
    if (foreignFactory) {
      const crossFactoryReturns = await request('pilot-pack-worker-source', 'GET', `/returns?factoryId=${foreignFactory.id}`);
      record('return feed rejects cross-factory query', crossFactoryReturns.status === 403, `HTTP ${crossFactoryReturns.status}`);
    }

    const relevantAudit = await prisma.auditLog.findMany({
      where: {
        factoryId: FACTORY_ID,
        entityId: { in: [...announcementIds, ...returnIds] },
        action: { in: ['ANNOUNCEMENT_CREATED', 'RETURN_RECORD_CREATED'] },
      },
      select: { action: true, entityId: true },
    });
    record('announcement and return publications are audited',
      relevantAudit.some((item) => item.action === 'ANNOUNCEMENT_CREATED')
      && relevantAudit.some((item) => item.action === 'RETURN_RECORD_CREATED'));
  } finally {
    for (const id of announcementIds) {
      const archived = await request('test-admin', 'POST', `/announcements/${id}/archive`, {});
      record(`announcement ${id.slice(0, 8)} archived through normal flow`, archived.status === 201, `HTTP ${archived.status}`);
    }
    for (const id of returnIds) {
      const archived = await request('test-store', 'POST', `/returns/${id}/archive`, {});
      record(`return ${id.slice(0, 8)} archived through normal flow`, archived.status === 201, `HTTP ${archived.status}`);
    }
    persistArtifacts();
    await prisma.$disconnect();
  }

  console.log(`\nPhysical Fixes V4 Stage5: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(async (error) => {
  console.error(error?.stack || error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
