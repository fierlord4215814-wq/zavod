const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const { ForbiddenException } = require('@nestjs/common');
const { NestFactory, Reflector } = require('@nestjs/core');
const { UserRole } = require('@prisma/client');
const { AppModule } = require('../dist/app.module');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { ArchiveService } = require('../dist/modules/archive/archive.service');
const { OrdersController } = require('../dist/modules/orders/orders.controller');
const { OrdersService } = require('../dist/modules/orders/orders.service');
const { ReturnsController } = require('../dist/modules/returns/returns.controller');
const { ReturnsService } = require('../dist/modules/returns/returns.service');
const { AuditService } = require('../dist/common/audit.service');
const { PermissionGuard } = require('../dist/common/permission.guard');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { UserContextService } = require('../dist/common/user-context.service');

const EXPECTED_STORE_MATERIAL_PERMISSIONS = [
  'orders.read',
  'orders.restock',
  'orders.take',
  'returns.manage',
  'returns.publication.read',
  'returns.read',
];
const FORBIDDEN_STORE_MATERIAL_PERMISSIONS = [
  'orders.archive.read',
  'orders.items.manage',
  'orders.manage',
  'orders.request',
  'orders.requests.manage',
  'orders.settings.manage',
  'orders.settings.read',
  'stock.manage',
  'stock.read',
];

const passed = [];
const failures = [];

function check(name, condition, detail) {
  (condition ? passed : failures).push({ name, ...(detail === undefined ? {} : { detail }) });
}

async function denied(action) {
  try {
    await action();
    return { denied: false, message: null };
  } catch (error) {
    const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return {
      denied: error instanceof ForbiddenException || error?.status === 403 || response?.code === 'FORBIDDEN',
      message: response?.message ?? error?.message ?? String(error),
    };
  }
}

async function rejected(action) {
  try {
    await action();
    return { rejected: false, message: null };
  } catch (error) {
    const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return { rejected: true, message: response?.message ?? error?.message ?? String(error) };
  }
}

function guardContext(controller, handler, user, url, method) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user, url, method }) }),
  };
}

async function guardDenied(guard, controller, handler, user, url, method) {
  return denied(() => guard.canActivate(guardContext(controller, handler, user, url, method)));
}

function relevant(codes) {
  return codes.filter((code) => code.startsWith('orders.') || code.startsWith('returns.') || code.startsWith('stock.')).sort();
}

async function main() {
  const marker = `store-contract-${Date.now()}`;
  const ids = { factoryId: '', foreignFactoryId: '', departmentId: '', foreignDepartmentId: '', userId: '', accessId: '', itemId: '', foreignItemId: '', foreignDepartmentItemId: '', returnId: '', requestId: '' };
  let markerCleanup = {};
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const db = prisma.db;

  try {
    const orders = app.get(OrdersService);
    const returns = app.get(ReturnsService);
    const returnsController = app.get(ReturnsController);
    const archive = app.get(ArchiveService);
    const contextService = app.get(UserContextService);
    const guard = new PermissionGuard(app.get(Reflector), app.get(AuditService));

    const activeRoleCodes = (await db.rolePermission.findMany({
      where: { role: UserRole.STORE, isActive: true },
      select: { permissionCode: true },
      orderBy: { permissionCode: 'asc' },
    })).map((row) => row.permissionCode);
    check('STORE has the exact material-contract grants', JSON.stringify(relevant(activeRoleCodes)) === JSON.stringify(EXPECTED_STORE_MATERIAL_PERMISSIONS), { relevant: relevant(activeRoleCodes) });
    check('STORE has no forbidden stock or order authority', FORBIDDEN_STORE_MATERIAL_PERMISSIONS.every((code) => !activeRoleCodes.includes(code)), { forbiddenPresent: FORBIDDEN_STORE_MATERIAL_PERMISSIONS.filter((code) => activeRoleCodes.includes(code)) });

    const factory = await db.factory.create({ data: { name: `Изолированная площадка ${marker}`, code: marker } });
    ids.factoryId = factory.id;
    const foreignFactory = await db.factory.create({ data: { name: `Чужая площадка ${marker}`, code: `${marker}-foreign` } });
    ids.foreignFactoryId = foreignFactory.id;
    const department = await db.department.create({ data: { factoryId: factory.id, name: `Склад ${marker}`, normalizedName: `склад ${marker}`, code: `${marker}-store` } });
    ids.departmentId = department.id;
    const foreignDepartment = await db.department.create({ data: { factoryId: factory.id, name: `Другой отдел ${marker}`, normalizedName: `другой отдел ${marker}`, code: `${marker}-foreign-dept` } });
    ids.foreignDepartmentId = foreignDepartment.id;
    const user = await db.user.create({ data: { factoryId: factory.id, firstName: 'Кладовщик', lastName: 'Проверочный', role: UserRole.STORE } });
    ids.userId = user.id;
    const access = await db.userFactoryAccess.create({ data: { userId: user.id, factoryId: factory.id, departmentId: department.id, role: UserRole.STORE, isGuest: false } });
    ids.accessId = access.id;

    const item = await db.minimumStockItem.create({ data: {
      factoryId: factory.id,
      departmentId: department.id,
      name: `Контроль остатка ${Date.now()}`,
      category: 'Материалы',
      minThreshold: 4,
      initialQuantity: 10,
      currentQuantity: 10,
      referenceQuantity: 10,
      unit: 'шт',
      createdById: user.id,
    } });
    ids.itemId = item.id;
    const foreignDepartmentItem = await db.minimumStockItem.create({ data: {
      factoryId: factory.id,
      departmentId: foreignDepartment.id,
      name: `Остаток другого отдела ${Date.now()}`,
      minThreshold: 1,
      initialQuantity: 2,
      currentQuantity: 2,
      referenceQuantity: 2,
      unit: 'шт',
      createdById: user.id,
    } });
    ids.foreignDepartmentItemId = foreignDepartmentItem.id;
    const foreignItem = await db.minimumStockItem.create({ data: {
      factoryId: foreignFactory.id,
      name: `Чужой остаток ${Date.now()}`,
      minThreshold: 1,
      initialQuantity: 2,
      currentQuantity: 2,
      referenceQuantity: 2,
      unit: 'шт',
      createdById: user.id,
    } });
    ids.foreignItemId = foreignItem.id;
    const returnRecord = await db.returnRecord.create({ data: {
      factoryId: factory.id,
      createdById: user.id,
      description: `Возврат материала ${Date.now()}`,
      photoUrl: 'attachment-pending',
      receivedAt: new Date(),
      article: 'MAT-01',
      productName: 'Материал возврата',
      mismatchReason: 'Проверка частичной выдачи',
      quantity: 10,
      unit: 'шт',
      status: 'ACTIVE',
    } });
    ids.returnId = returnRecord.id;
    const request = await db.orderRequest.create({ data: {
      factoryId: factory.id,
      departmentId: department.id,
      sourceType: 'MANUAL',
      title: 'Контрольная заявка',
      reasonComment: 'Проверка запрета решения',
      status: 'ACTIVE',
      createdById: user.id,
    } });
    ids.requestId = request.id;

    let store = await contextService.resolveForFactory(user.id, factory.id);
    check('STORE context is active and factory-scoped', !store.isGuest && !store.isAdmin && store.role === UserRole.STORE && store.selectedFactoryId === factory.id && store.departmentId === department.id, { role: store.role, isGuest: store.isGuest, departmentMatch: store.departmentId === department.id });
    check('resolved permissions equal the canonical role grants', JSON.stringify(relevant(store.permissions)) === JSON.stringify(EXPECTED_STORE_MATERIAL_PERMISSIONS), { relevant: relevant(store.permissions) });

    const visibleItems = await orders.items(store, { includeArchive: 'true' });
    check('STORE reads actual balances in its department', visibleItems.some((entry) => entry.id === item.id), { count: visibleItems.length });
    check('STORE does not read another department balance', !visibleItems.some((entry) => entry.id === foreignDepartmentItem.id));
    check('STORE does not read another factory balance', !visibleItems.some((entry) => entry.id === foreignItem.id));
    check('direct cross-department filter is denied', (await denied(() => orders.items(store, { departmentId: foreignDepartment.id }))).denied);
    check('direct cross-factory item access returns no data', (await rejected(() => orders.item(store, foreignItem.id))).rejected);

    const takeOperationId = `${marker}-take`;
    const afterTake = await orders.take(store, item.id, { quantity: 3, comment: 'Выдача в работу', operationId: takeOperationId });
    const afterTakeReplay = await orders.take(store, item.id, { quantity: 3, comment: 'Выдача в работу', operationId: takeOperationId });
    check('TAKE subtracts the exact quantity', afterTake.currentQuantity === 7, { currentQuantity: afterTake.currentQuantity });
    check('TAKE replay is idempotent', afterTakeReplay.currentQuantity === 7 && await db.minimumStockMovement.count({ where: { itemId: item.id, type: 'TAKE' } }) === 1);

    const restockOperationId = `${marker}-restock`;
    const afterRestock = await orders.restock(store, item.id, { quantity: 5, comment: 'Приход материала', operationId: restockOperationId });
    const afterRestockReplay = await orders.restock(store, item.id, { quantity: 5, comment: 'Приход материала', operationId: restockOperationId });
    check('RESTOCK adds the exact quantity', afterRestock.currentQuantity === 12, { currentQuantity: afterRestock.currentQuantity });
    check('RESTOCK replay is idempotent', afterRestockReplay.currentQuantity === 12 && await db.minimumStockMovement.count({ where: { itemId: item.id, type: 'RESTOCK' } }) === 1);
    const invalidQuantity = await rejected(() => orders.take(store, item.id, { quantity: 0, comment: 'Неверное количество', operationId: `${marker}-invalid` }));
    check('invalid quantity has a Russian user-facing error', invalidQuantity.rejected && /количеств|больше нуля|укажите/i.test(invalidQuantity.message ?? ''), { message: invalidQuantity.message });

    check('STORE cannot create an item', (await denied(() => orders.createItem(store, { name: 'Запрещено', unit: 'шт', minThreshold: 1, initialQuantity: 1 }))).denied);
    check('STORE cannot edit an item', (await denied(() => orders.updateItem(store, item.id, { name: 'Запрещено' }))).denied);
    check('STORE cannot archive an item', (await denied(() => orders.archiveItem(store, item.id, { comment: 'Запрещено' }))).denied);
    check('STORE cannot create an order request', (await denied(() => orders.createManualRequest(store, { title: 'Запрещено', unit: 'шт', reasonComment: 'Запрещено', operationId: `${marker}-request` }))).denied);
    check('STORE cannot decide an order request', (await denied(() => orders.closeRequest(store, request.id, { closeStatus: 'ORDERED' }))).denied);

    const listedReturns = await returns.listReturns(store, factory.id, { includeArchive: true });
    check('STORE reads Returns in its selected factory', listedReturns.some((entry) => entry.id === returnRecord.id));
    const releaseOperationId = `${marker}-return-release`;
    const release = await returns.partialRelease(store, returnRecord.id, { quantity: 4, comment: 'Частичная выдача', operationId: releaseOperationId });
    const releaseReplay = await returns.partialRelease(store, returnRecord.id, { quantity: 4, comment: 'Частичная выдача', operationId: releaseOperationId });
    check('Return partial release preserves the remaining ledger', release.operation.quantityAfter === '6' && releaseReplay.operation.quantityAfter === '6', { after: release.operation.quantityAfter });
    check('Return release replay is idempotent', releaseReplay.idempotent === true && await db.quantityReleaseOperation.count({ where: { sourceId: returnRecord.id } }) === 1);
    const enrichedReturns = await returns.listReturns(store, factory.id, { includeArchive: true });
    const enrichedReturn = enrichedReturns.find((entry) => entry.id === returnRecord.id);
    check('Return list exposes current quantity and immutable history', enrichedReturn?.quantitySummary?.remaining === '6' && enrichedReturn?.releaseHistory?.length === 1, { remaining: enrichedReturn?.quantitySummary?.remaining, history: enrichedReturn?.releaseHistory?.length });
    check('Returns controller denies a foreign factory query', (await denied(() => returnsController.listReturns({ user: store }, store, foreignFactory.id, {}))).denied);

    const archiveSections = await archive.sections(store);
    const sectionKeys = archiveSections.map((entry) => entry.key);
    check('STORE archive contains Returns and actual balances', sectionKeys.includes('returns') && sectionKeys.includes('orders'), { sectionKeys });
    check('STORE archive excludes StockDefect/Некондиция', !sectionKeys.includes('stock'), { sectionKeys });

    const createGuard = await guardDenied(guard, OrdersController, OrdersController.prototype.createItem, store, '/orders/items', 'POST');
    check('backend route guard denies item creation', createGuard.denied, createGuard);
    check('backend route guard allows TAKE', await guard.canActivate(guardContext(OrdersController, OrdersController.prototype.take, store, `/orders/items/${item.id}/take`, 'POST')) === true);
    check('backend route guard allows RESTOCK', await guard.canActivate(guardContext(OrdersController, OrdersController.prototype.restock, store, `/orders/items/${item.id}/restock`, 'POST')) === true);
    check('backend route guard denies request creation', (await guardDenied(guard, OrdersController, OrdersController.prototype.createManualRequest, store, '/orders/requests', 'POST')).denied);
    check('backend route guard denies request decisions', (await guardDenied(guard, OrdersController, OrdersController.prototype.closeRequest, store, `/orders/requests/${request.id}/close`, 'POST')).denied);

    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId: user.id, factoryId: factory.id, permissionCode: 'orders.take' } },
      update: { effect: 'DENY' },
      create: { userId: user.id, factoryId: factory.id, permissionCode: 'orders.take', effect: 'DENY' },
    });
    store = await contextService.resolveForFactory(user.id, factory.id);
    check('effective DENY removes a role permission', !store.permissions.includes('orders.take'));
    check('direct TAKE route is denied after effective DENY', (await guardDenied(guard, OrdersController, OrdersController.prototype.take, store, `/orders/items/${item.id}/take`, 'POST')).denied);
    await db.userPermissionOverride.upsert({
      where: { userId_factoryId_permissionCode: { userId: user.id, factoryId: factory.id, permissionCode: 'orders.request' } },
      update: { effect: 'ALLOW' },
      create: { userId: user.id, factoryId: factory.id, permissionCode: 'orders.request', effect: 'ALLOW' },
    });
    store = await contextService.resolveForFactory(user.id, factory.id);
    check('effective ALLOW adds a granular permission', store.permissions.includes('orders.request'));
    check('direct request route follows effective ALLOW', await guard.canActivate(guardContext(OrdersController, OrdersController.prototype.createManualRequest, store, '/orders/requests', 'POST')) === true);

    await db.user.update({ where: { id: user.id }, data: { blockedAt: new Date() } });
    check('blocked STORE resolves to a guest context', (await contextService.resolveForFactory(user.id, factory.id)).isGuest === true);
    await db.user.update({ where: { id: user.id }, data: { blockedAt: null } });
    await db.userFactoryAccess.update({ where: { id: access.id }, data: { isActive: false, deactivatedAt: new Date(), deactivationReason: 'Завершение изолированной проверки' } });
    check('deactivated UserFactoryAccess resolves to a guest context', (await contextService.resolveForFactory(user.id, factory.id)).isGuest === true);

    const orderAudits = await db.auditLog.findMany({ where: { factoryId: factory.id, action: { in: ['ORDER_ITEM_TAKEN', 'ORDER_ITEM_RESTOCKED', 'RETURN_QUANTITY_PARTIALLY_RELEASED', 'ACCESS_DENIED'] } }, select: { action: true } });
    const auditActions = new Set(orderAudits.map((entry) => entry.action));
    check('material actions and denials are audited', ['ORDER_ITEM_TAKEN', 'ORDER_ITEM_RESTOCKED', 'RETURN_QUANTITY_PARTIALLY_RELEASED', 'ACCESS_DENIED'].every((action) => auditActions.has(action)), { auditActions: [...auditActions].sort() });

    const ordersSource = fs.readFileSync(path.join(rootDir, 'backend/src/modules/orders/orders.service.ts'), 'utf8');
    const controllerSource = fs.readFileSync(path.join(rootDir, 'backend/src/modules/orders/orders.controller.ts'), 'utf8');
    const frontendSource = fs.readFileSync(path.join(rootDir, 'frontend/src/screens/OrdersStockScreen.tsx'), 'utf8');
    const attachmentSource = fs.readFileSync(path.join(rootDir, 'backend/src/modules/attachments/attachments.service.ts'), 'utf8');
    check('orders authority has no STORE or stock.manage compatibility bypass', !/(UserRole\.STORE|role\s*===\s*['"]STORE['"]|stock\.manage)/.test(ordersSource));
    check('frontend item management has no STORE or stock.manage bypass', !/(role\s*===\s*['"]STORE['"]|stock\.manage)/.test(frontendSource));
    check('controller uses exact granular mutation permissions', [
      /@Post\('items'\)[\s\S]{0,100}@RequirePermission\('orders\.items\.manage'\)/,
      /@Post\('items\/:id\/take'\)[\s\S]{0,100}@RequirePermission\('orders\.take'\)/,
      /@Post\('items\/:id\/restock'\)[\s\S]{0,100}@RequirePermission\('orders\.restock'\)/,
      /@Post\('requests'\)[\s\S]{0,100}@RequirePermission\('orders\.request'\)/,
      /@Post\('requests\/:id\/close'\)[\s\S]{0,100}@RequirePermission\('orders\.requests\.manage'\)/,
    ].every((pattern) => pattern.test(controllerSource)));
    check('attachment authority follows the canonical entities', [
      "RETURN_RECORD: { read: 'returns.read', write: 'returns.manage' }",
      "MINIMUM_STOCK_ITEM: { read: 'orders.read', write: 'orders.items.manage' }",
      "MINIMUM_STOCK_MOVEMENT: { read: 'orders.read', write: 'orders.take' }",
      "ORDER_REQUEST: { read: 'orders.read', write: 'orders.request' }",
    ].every((snippet) => attachmentSource.includes(snippet)));
    const publicSamples = JSON.stringify({ visibleItems, afterTake, afterRestock, enrichedReturn, archiveSections });
    check('public material responses expose no storage path or secret fields', !/storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken|authToken|secret/i.test(publicSamples));
  } finally {
    const now = new Date();
    if (ids.requestId) await db.orderRequest.updateMany({ where: { id: ids.requestId, status: 'ACTIVE' }, data: { status: 'NOT_NEEDED', closedAt: now, closeComment: 'Завершение изолированной проверки' } });
    if (ids.returnId) await db.returnRecord.updateMany({ where: { id: ids.returnId }, data: { status: 'ARCHIVED', archivedAt: now, deletedAt: now } });
    for (const id of [ids.itemId, ids.foreignDepartmentItemId, ids.foreignItemId].filter(Boolean)) {
      await db.minimumStockItem.updateMany({ where: { id }, data: { isActive: false, archivedAt: now } });
    }
    if (ids.accessId) await db.userFactoryAccess.updateMany({ where: { id: ids.accessId }, data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение изолированной проверки' } });
    if (ids.userId) await db.user.updateMany({ where: { id: ids.userId }, data: { deletedAt: now, blockedAt: now } });
    for (const id of [ids.departmentId, ids.foreignDepartmentId].filter(Boolean)) {
      await db.department.updateMany({ where: { id }, data: { isActive: false, deactivatedAt: now, deletedAt: now, deactivationReason: 'Завершение изолированной проверки' } });
    }
    for (const id of [ids.factoryId, ids.foreignFactoryId].filter(Boolean)) {
      await db.factory.updateMany({ where: { id }, data: { isActive: false, deactivatedAt: now, deletedAt: now, deactivationReason: 'Завершение изолированной проверки' } });
    }
    const markerFactoryIds = (await db.factory.findMany({
      where: { code: { startsWith: 'store-contract-' } },
      select: { id: true },
    })).map((factory) => factory.id);
    if (markerFactoryIds.length) {
      const [requests, returns, items, accesses, users, departments, factories] = await db.$transaction([
        db.orderRequest.updateMany({ where: { factoryId: { in: markerFactoryIds }, status: 'ACTIVE' }, data: { status: 'NOT_NEEDED', closedAt: now, closeComment: 'Завершение изолированной проверки' } }),
        db.returnRecord.updateMany({ where: { factoryId: { in: markerFactoryIds }, deletedAt: null }, data: { status: 'ARCHIVED', archivedAt: now, deletedAt: now } }),
        db.minimumStockItem.updateMany({ where: { factoryId: { in: markerFactoryIds }, OR: [{ isActive: true }, { archivedAt: null }] }, data: { isActive: false, archivedAt: now } }),
        db.userFactoryAccess.updateMany({ where: { factoryId: { in: markerFactoryIds }, isActive: true }, data: { isActive: false, deactivatedAt: now, deactivationReason: 'Завершение изолированной проверки' } }),
        db.user.updateMany({ where: { factoryId: { in: markerFactoryIds }, deletedAt: null }, data: { deletedAt: now, blockedAt: now } }),
        db.department.updateMany({ where: { factoryId: { in: markerFactoryIds }, OR: [{ isActive: true }, { deletedAt: null }] }, data: { isActive: false, deactivatedAt: now, deletedAt: now, deactivationReason: 'Завершение изолированной проверки' } }),
        db.factory.updateMany({ where: { id: { in: markerFactoryIds }, OR: [{ isActive: true }, { deletedAt: null }] }, data: { isActive: false, deactivatedAt: now, deletedAt: now, deactivationReason: 'Завершение изолированной проверки' } }),
      ]);
      markerCleanup = {
        factories: factories.count,
        departments: departments.count,
        users: users.count,
        accesses: accesses.count,
        items: items.count,
        returns: returns.count,
        requests: requests.count,
      };
    }
    await app.close();
  }

  const activeFixtures = await (async () => {
    const prismaApp = await NestFactory.createApplicationContext(AppModule, { logger: false });
    try {
      const checkDb = prismaApp.get(PrismaService).db;
      const markerFactoryIds = (await checkDb.factory.findMany({ where: { code: { startsWith: 'store-contract-' } }, select: { id: true } })).map((factory) => factory.id);
      return {
        factories: await checkDb.factory.count({ where: { code: { startsWith: 'store-contract-' }, isActive: true, deletedAt: null } }),
        departments: await checkDb.department.count({ where: { factoryId: { in: markerFactoryIds }, isActive: true, deletedAt: null } }),
        users: await checkDb.user.count({ where: { factoryId: { in: markerFactoryIds }, deletedAt: null } }),
        accesses: await checkDb.userFactoryAccess.count({ where: { factoryId: { in: markerFactoryIds }, isActive: true } }),
        items: await checkDb.minimumStockItem.count({ where: { factoryId: { in: markerFactoryIds }, isActive: true, archivedAt: null } }),
        movements: await checkDb.minimumStockMovement.count({ where: { factoryId: { in: markerFactoryIds }, item: { isActive: true, archivedAt: null } } }),
        returns: await checkDb.returnRecord.count({ where: { factoryId: { in: markerFactoryIds }, deletedAt: null } }),
        requests: await checkDb.orderRequest.count({ where: { factoryId: { in: markerFactoryIds }, status: 'ACTIVE' } }),
      };
    } finally {
      await prismaApp.close();
    }
  })();
  check('isolated fixture leaves no active runtime data', Object.values(activeFixtures).every((count) => count === 0), activeFixtures);

  console.log(JSON.stringify({
    passed: passed.length,
    failed: failures.length,
    checks: passed,
    failures,
    writes: 'isolated fixtures and canonical ledgers only',
    physicalDeletes: 0,
    markerCleanup,
    activeFixtures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
