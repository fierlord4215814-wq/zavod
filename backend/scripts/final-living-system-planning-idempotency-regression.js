const { EmployeeState, PrismaClient, UserRole } = require('@prisma/client');
const { addFactoryShifts, factoryShiftDate, factoryShiftTarget } = require('../dist/common/shift-time');

const API = process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
const state = { passed: [], failed: [] };

function record(name, passed, detail) {
  (passed ? state.passed : state.failed).push({ name, ...(detail ? { detail } : {}) });
}

async function request(path, { method = 'GET', token, factoryId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (factoryId) headers['x-factory-id'] = factoryId;
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

async function main() {
  const runId = Date.now().toString(36);
  const userId = `flsv1tmp-planning-worker-${runId}`;
  const login = await request('/auth/login', {
    method: 'POST',
    body: { phone: '+79000004720', password: '1234' },
  });
  if (login.status !== 201 || !login.data?.token || !login.data?.recommendedFactoryId) {
    throw new Error(`MASTER bearer login failed (${login.status})`);
  }
  const token = login.data.token;
  const factoryId = login.data.recommendedFactoryId;
  const next = addFactoryShifts(factoryShiftTarget(), 1);
  let assignmentId = null;

  try {
    await db.user.create({
      data: {
        id: userId,
        factoryId,
        role: UserRole.WORKER,
        employeeState: EmployeeState.OFF_SHIFT,
      },
    });
    await db.userFactoryAccess.create({
      data: {
        userId,
        factoryId,
        role: UserRole.WORKER,
        isGuest: false,
        isActive: true,
      },
    });

    const board = await request(`/shift/future-assignment-board?targetShiftDate=${next.shiftDate}&shiftType=${next.shiftType}`, {
      token,
      factoryId,
    });
    const slot = (board.data?.workAreas ?? [])
      .flatMap((area) => (area.positions ?? []).flatMap((position) => (position.slots ?? []).map((item) => ({
        area,
        position,
        slot: item,
      }))))
      .find((item) => !item.slot.assignment);
    record('future assignment board exposes an available canonical slot', board.status === 200 && Boolean(slot), { status: board.status });
    if (!slot) return;

    const operationId = `flsv1-planning-create-${runId}`;
    const body = {
      targetUserId: userId,
      shiftDate: next.shiftDate,
      shiftType: next.shiftType,
      kind: slot.area.assignmentKind,
      workAreaId: slot.area.id,
      workAreaPositionId: slot.position.id,
      slotIndex: slot.slot.slotIndex,
      operationId,
    };
    const [created, replayed] = await Promise.all([
      request('/shift/future-assignments', { method: 'POST', token, factoryId, body }),
      request('/shift/future-assignments', { method: 'POST', token, factoryId, body }),
    ]);
    assignmentId = created.data?.id || replayed.data?.id || null;
    record(
      'duplicate future assignment submit returns the same result',
      created.status === 201 && replayed.status === 201 && Boolean(created.data?.id) && created.data.id === replayed.data?.id,
      { statuses: [created.status, replayed.status] },
    );
    const activeCount = await db.plannedShiftAssignment.count({
      where: { factoryId, userId, shiftDate: factoryShiftDate(next), shiftType: next.shiftType, releasedAt: null },
    });
    record('duplicate submit creates one active planned assignment', activeCount === 1, { activeCount });

    if (!assignmentId) return;
    const releaseOperationId = `flsv1-planning-release-${runId}`;
    const [released, releaseReplay] = await Promise.all([
      request(`/shift/future-assignments/${assignmentId}/release`, {
        method: 'POST', token, factoryId, body: { operationId: releaseOperationId },
      }),
      request(`/shift/future-assignments/${assignmentId}/release`, {
        method: 'POST', token, factoryId, body: { operationId: releaseOperationId },
      }),
    ]);
    record(
      'duplicate release submit is idempotent',
      released.status === 201 && releaseReplay.status === 201 && released.data?.id === assignmentId && releaseReplay.data?.id === assignmentId,
      { statuses: [released.status, releaseReplay.status] },
    );
    const remaining = await db.plannedShiftAssignment.count({ where: { id: assignmentId, releasedAt: null } });
    record('released test assignment is no longer active', remaining === 0, { remaining });
  } finally {
    const now = new Date();
    if (assignmentId) {
      await db.plannedShiftAssignment.updateMany({
        where: { id: assignmentId, releasedAt: null },
        data: { releasedAt: now, releasedById: login.data.userId },
      });
    }
    await db.userFactoryAccess.updateMany({
      where: { userId, factoryId },
      data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение FINAL LIVING SYSTEM planning regression' },
    });
    await db.user.updateMany({ where: { id: userId }, data: { blockedAt: now, employeeState: EmployeeState.OFF_SHIFT } });
  }
}

main()
  .catch((error) => state.failed.push({ name: 'unhandled regression error', detail: String(error?.stack || error) }))
  .finally(async () => {
    await db.$disconnect();
    console.log(JSON.stringify({ passed: state.passed.length, failed: state.failed.length, results: state }, null, 2));
    if (state.failed.length) process.exitCode = 1;
  });
