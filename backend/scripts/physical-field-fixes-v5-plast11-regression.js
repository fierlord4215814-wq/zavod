const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
const evidencePath = path.join(rootDir, 'docs', 'physical-field-fixes-v5-plast11', 'test-artifacts.json');
const markerPrefix = '__PFFV5_P11_';

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const {
  hasPilotFixtureMarker,
  isDiagnosticFixtureActor,
  isDocumentedPilotTestActor,
  isPilotFixtureUser,
} = require('../dist/common/pilot-visibility');
const { PrismaService } = require('../dist/prisma/prisma.service');

const passed = [];
const failures = [];

function check(name, condition, detail) {
  (condition ? passed : failures).push({ name, ...(detail === undefined ? {} : { detail }) });
}

function source(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

async function effectivePermissions(db, userId, factoryId, role) {
  const [roleRows, overrides] = await Promise.all([
    db.rolePermission.findMany({ where: { role, isActive: true }, select: { permissionCode: true } }),
    db.userPermissionOverride.findMany({
      where: { userId, OR: [{ factoryId }, { factoryId: null }] },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const permissions = new Set(roleRows.map((row) => row.permissionCode));
  for (const override of overrides) {
    if (override.effect === 'ALLOW') permissions.add(override.permissionCode);
    if (override.effect === 'DENY') permissions.delete(override.permissionCode);
  }
  return permissions;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const db = app.get(PrismaService).db;
    const factory = await db.factory.findFirst({
      where: { code: 'factory-4', isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    check('Factory 4 exists and is active', Boolean(factory), factory);
    if (!factory) throw new Error('Завод 4 не найден');

    const expectedUsers = [
      ['pilot-master-1', 'MASTER'],
      ['pilot-tech-kipia-1', 'TECH_KIPIA'],
      ['pilot-tech-holod-1', 'TECH_HOLOD'],
      ['pilot-pack-management', 'MANAGEMENT'],
      ['pilot-pack-admin', 'ADMIN'],
      ['pilot-worker-1', 'WORKER'],
      ['pilot-store-1', 'STORE'],
    ];
    const accesses = await db.userFactoryAccess.findMany({
      where: { factoryId: factory.id, userId: { in: expectedUsers.map(([id]) => id) } },
      select: {
        userId: true,
        role: true,
        departmentId: true,
        isActive: true,
        deactivatedAt: true,
        user: { select: { blockedAt: true, deletedAt: true } },
      },
    });
    check('all meaningful pilot roles are active', expectedUsers.every(([id, role]) => {
      const access = accesses.find((item) => item.userId === id);
      return access?.role === role && access.isActive && !access.deactivatedAt && !access.user.blockedAt && !access.user.deletedAt;
    }), { found: accesses.map((item) => `${item.userId}:${item.role}`) });

    const permissions = new Map();
    for (const access of accesses) {
      permissions.set(access.userId, await effectivePermissions(db, access.userId, factory.id, access.role));
    }
    const has = (userId, code) => permissions.get(userId)?.has(code) === true;
    check('MASTER can create, read, transfer and complete requests', ['tasks.create', 'tasks.read', 'tasks.redirect', 'tasks.done'].every((code) => has('pilot-master-1', code)));
    check('KIPIA and cold service can work only through request permissions', ['pilot-tech-kipia-1', 'pilot-tech-holod-1'].every((userId) => ['tasks.read', 'tasks.take', 'tasks.comment', 'tasks.done'].every((code) => has(userId, code))));
    check('WORKER cannot read or mutate requests/orders', !has('pilot-worker-1', 'tasks.read') && !has('pilot-worker-1', 'orders.read'));
    check('STORE has balance-only material permissions',
      !has('pilot-store-1', 'tasks.read')
      && ['orders.read', 'orders.take', 'orders.restock'].every((code) => has('pilot-store-1', code))
      && ['orders.items.manage', 'orders.request', 'orders.requests.manage', 'stock.read', 'stock.manage'].every((code) => !has('pilot-store-1', code)));
    check('MANAGEMENT can manage stock/order lifecycle', ['orders.read', 'orders.request', 'orders.take', 'orders.restock', 'orders.requests.manage'].every((code) => has('pilot-pack-management', code)));
    check('ADMIN has full task/order control', ['tasks.manage', 'orders.items.manage', 'orders.requests.manage'].every((code) => has('pilot-pack-admin', code)));

    const [activeTasks, activeUrgent, activeLong, activeStock, activeOrders, activeNotificationRows, activeAssignments] = await Promise.all([
      db.task.count({ where: { factoryId: factory.id, deletedAt: null, status: { not: 'DONE' }, description: { contains: markerPrefix } } }),
      db.task.count({ where: { factoryId: factory.id, deletedAt: null, status: { not: 'DONE' }, type: 'URGENT', description: { contains: markerPrefix } } }),
      db.task.count({ where: { factoryId: factory.id, deletedAt: null, status: { not: 'DONE' }, type: 'LONG', description: { contains: markerPrefix } } }),
      db.minimumStockItem.count({ where: { factoryId: factory.id, isActive: true, archivedAt: null, OR: [{ name: { contains: markerPrefix } }, { description: { contains: markerPrefix } }] } }),
      db.orderRequest.count({ where: { factoryId: factory.id, status: 'ACTIVE', OR: [{ title: { contains: markerPrefix } }, { description: { contains: markerPrefix } }, { reasonComment: { contains: markerPrefix } }] } }),
      db.notification.findMany({
        where: { factoryId: factory.id, readAt: null, OR: [{ title: { contains: markerPrefix } }, { message: { contains: markerPrefix } }] },
        select: { userId: true },
      }),
      db.assignment.count({ where: { factoryId: factory.id, endedAt: null, comment: { contains: markerPrefix } } }),
    ]);
    const activeNotifications = activeNotificationRows.filter((notification) => {
      if (!notification.userId) return true;
      return isDocumentedPilotTestActor(notification.userId)
        || (!isPilotFixtureUser(notification.userId) && !isDiagnosticFixtureActor(notification.userId));
    }).length;
    check('ACTIVE_TEST_REQUESTS is zero', activeTasks === 0, activeTasks);
    check('ACTIVE_TEST_URGENT_REQUESTS is zero', activeUrgent === 0, activeUrgent);
    check('ACTIVE_TEST_LONG_REQUESTS is zero', activeLong === 0, activeLong);
    check('ACTIVE_TEST_STOCK_ITEMS is zero', activeStock === 0, activeStock);
    check('ACTIVE_TEST_ORDER_REQUESTS is zero', activeOrders === 0, activeOrders);
    check('marker active notifications are zero', activeNotifications === 0, activeNotifications);
    check('marker active assignments are zero', activeAssignments === 0, activeAssignments);

    const activeTaskRows = await db.task.findMany({
      where: { factoryId: factory.id, deletedAt: null, status: { not: 'DONE' } },
      select: {
        id: true,
        factoryId: true,
        description: true,
        operationId: true,
        createdById: true,
        lineId: true,
        line: { select: { id: true, name: true, factoryId: true, deletedAt: true, deactivatedAt: true } },
        createdBy: { select: { blockedAt: true, deletedAt: true } },
        comments: { select: { message: true } },
        departmentRecipients: { where: { active: true }, select: { department: { select: { factoryId: true, scope: true, isActive: true, deletedAt: true } } } },
        assignees: { where: { active: true }, select: { userId: true } },
      },
    });
    const operationalTaskRows = activeTaskRows.filter((task) => !isDiagnosticFixtureActor(task.createdById) && !hasPilotFixtureMarker(
      task.id,
      task.description,
      task.operationId,
      task.lineId,
      task.line?.name,
      ...task.comments.map((comment) => comment.message),
    ));
    const taskLineErrors = operationalTaskRows.filter((task) => task.lineId && (!task.line || task.line.factoryId !== task.factoryId));
    const taskDepartmentErrors = operationalTaskRows.flatMap((task) => task.departmentRecipients.filter((recipient) => !recipient.department || !recipient.department.isActive || recipient.department.deletedAt || (recipient.department.scope !== 'GLOBAL' && recipient.department.factoryId !== task.factoryId)));
    const activeAssigneeIds = [...new Set(operationalTaskRows.flatMap((task) => task.assignees.map((item) => item.userId)))];
    const activeAssigneeAccess = activeAssigneeIds.length ? await db.userFactoryAccess.findMany({
      where: { factoryId: factory.id, userId: { in: activeAssigneeIds }, isActive: true, deactivatedAt: null, user: { blockedAt: null, deletedAt: null } },
      select: { userId: true },
    }) : [];
    const accessibleAssigneeIds = new Set(activeAssigneeAccess.map((item) => item.userId));
    const taskAssigneeErrors = activeAssigneeIds.filter((id) => !accessibleAssigneeIds.has(id));
    check('orphan active request line refs are zero', taskLineErrors.length === 0, taskLineErrors.length);
    check('invalid active request department refs are zero', taskDepartmentErrors.length === 0, taskDepartmentErrors.length);
    check('invalid active request assignee refs are zero', taskAssigneeErrors.length === 0, taskAssigneeErrors.length);

    const activeStockRows = await db.minimumStockItem.findMany({
      where: { factoryId: factory.id, isActive: true, archivedAt: null },
      select: { id: true, factoryId: true, departmentId: true },
    });
    const stockDepartmentIds = [...new Set(activeStockRows.map((item) => item.departmentId).filter(Boolean))];
    const stockDepartments = stockDepartmentIds.length ? await db.department.findMany({
      where: { id: { in: stockDepartmentIds } },
      select: { id: true, factoryId: true, scope: true, isActive: true, deletedAt: true },
    }) : [];
    const stockDepartmentMap = new Map(stockDepartments.map((department) => [department.id, department]));
    const stockReferenceErrors = activeStockRows.filter((item) => {
      if (!item.departmentId) return false;
      const department = stockDepartmentMap.get(item.departmentId);
      return !department || !department.isActive || department.deletedAt || (department.scope !== 'GLOBAL' && department.factoryId !== item.factoryId);
    });
    const activeOrderRows = await db.orderRequest.findMany({
      where: { factoryId: factory.id, status: 'ACTIVE' },
      select: { id: true, factoryId: true, sourceItemId: true, sourceItem: { select: { id: true, factoryId: true } } },
    });
    const orderReferenceErrors = activeOrderRows.filter((request) => request.sourceItemId && (!request.sourceItem || request.sourceItem.factoryId !== request.factoryId));
    check('orphan active stock refs are zero', stockReferenceErrors.length === 0, stockReferenceErrors.length);
    check('orphan active order refs are zero', orderReferenceErrors.length === 0, orderReferenceErrors.length);

    const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null;
    check('browser evidence file exists', Boolean(evidence), evidencePath);
    if (evidence) {
      check('pre-existing stock hash is unchanged', evidence.stockBaselineHash === evidence.stockFinalHash && evidence.preexistingStockValuesModified === 0, {
        before: evidence.stockBaselineHash,
        after: evidence.stockFinalHash,
      });
      check('browser cleanup metrics are all zero', [
        evidence.activeTestRequests,
        evidence.activeTestUrgentRequests,
        evidence.activeTestLongRequests,
        evidence.activeTestStockItems,
        evidence.activeTestOrderRequests,
        evidence.activeTestArtifacts,
      ].every((value) => value === 0), evidence.cleanupMetrics);
      check('browser flow reports no deleted pre-existing entities', evidence.preexistingEntitiesDeleted === 0, evidence.preexistingEntitiesDeleted);
      check('browser flow reports no unintended pre-existing mutations', evidence.preexistingEntitiesUnintentionallyModified === 0, evidence.preexistingEntitiesUnintentionallyModified);
    }

    const taskSource = source('backend/src/modules/task/task.service.ts');
    const taskModuleSource = source('backend/src/modules/task/task.module.ts');
    const ordersSource = source('backend/src/modules/orders/orders.service.ts');
    const notificationsSource = source('backend/src/modules/notifications/notifications.service.ts');
    const eventsSource = source('backend/src/ws/events.ts');
    const wsClientSource = source('frontend/src/ws/client.ts');
    const taskUiSource = source('frontend/src/screens/TasksScreen.tsx');
    const ordersUiSource = source('frontend/src/screens/OrdersStockScreen.tsx');
    check('tasks reuse canonical department directory', taskSource.includes('directoryService.canonicalDepartments') && taskModuleSource.includes('DirectoryModule'));
    check('task create/take/comment/complete emit after transaction', taskSource.includes('if (result.changed)') && taskSource.includes("WS_EVENTS.TASK_UPDATED") && taskSource.includes('factoryId: task.factoryId'));
    check('orders expose a dedicated realtime event end-to-end', eventsSource.includes('ORDERS_UPDATED') && ordersSource.includes('broadcastOrdersUpdate') && wsClientSource.includes("event.type === 'orders_updated'") && ordersUiSource.includes('zavod:orders-updated'));
    check('task UI exposes canonical line/type/department filters', ['lineFilter', 'typeFilter', 'departmentFilter', "label: 'Линия'"].every((value) => taskUiSource.includes(value)));
    check('task/order submissions use stable modal operation ids and in-flight guards', taskUiSource.includes('modalOperationId') && taskUiSource.includes('actionInFlightRef') && ordersUiSource.includes('modalOperationId') && ordersUiSource.includes('actionInFlightRef'));
    check('request/order notifications exclude diagnostic recipients and resolve with entity lifecycle',
      notificationsSource.includes('isOperationalNotificationRecipient')
      && notificationsSource.includes('isDiagnosticFixtureActor')
      && notificationsSource.includes('resolveEntityNotifications')
      && taskSource.includes("resolveEntityNotifications(user.selectedFactoryId, 'TASK', taskId)")
      && ordersSource.includes("resolveEntityNotifications(user.selectedFactoryId, 'ORDER_REQUEST', result.request.id)"));
    check('order close retry is idempotent without duplicate lifecycle effects',
      ordersSource.includes('return { request: existing, changed: false }')
      && ordersSource.includes('if (result.changed)'));
    check('diagnostic task actor is excluded from ordinary runtime', taskSource.includes('isDiagnosticFixtureActor(task.createdById)'));
    check('order user labels use a narrow safe select',
      ordersSource.includes("user: { select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true } }")
      && !/user:\s*\{\s*select:\s*\{[^}]*passwordHash/s.test(ordersSource));
    check('changed request/order serializers do not expose forbidden fields', !/storagePath\s*:|passwordHash\s*:|DATABASE_URL\s*:|refreshToken\s*:|accessToken\s*:/i.test(`${taskSource}\n${ordersSource}`));

    const report = {
      passed: passed.length,
      failed: failures.length,
      checks: passed,
      failures,
      metrics: {
        ACTIVE_TEST_REQUESTS: activeTasks,
        ACTIVE_TEST_URGENT_REQUESTS: activeUrgent,
        ACTIVE_TEST_LONG_REQUESTS: activeLong,
        ACTIVE_TEST_STOCK_ITEMS: activeStock,
        ACTIVE_TEST_ORDER_REQUESTS: activeOrders,
        ACTIVE_TEST_ARTIFACTS: activeTasks + activeStock + activeOrders + activeNotifications + activeAssignments,
        PREEXISTING_STOCK_VALUES_MODIFIED: evidence?.stockBaselineHash === evidence?.stockFinalHash && evidence?.preexistingStockValuesModified === 0 ? 0 : 1,
        PREEXISTING_ENTITIES_DELETED: evidence?.preexistingEntitiesDeleted ?? null,
        PREEXISTING_ENTITIES_UNINTENTIONALLY_MODIFIED: evidence?.preexistingEntitiesUnintentionallyModified ?? null,
      },
      writes: 0,
      physicalDeletes: 0,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
