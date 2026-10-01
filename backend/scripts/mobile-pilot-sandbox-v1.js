const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const FACTORY_ID = 'mobile-pilot-v1-factory';
const FACTORY_CODE = 'mobile-pilot-v1';
const FACTORY_NAME = 'Завод — мобильный пилот';
const PASSWORD = '1234';

const existingAccounts = [
  ['pilot-pack-guest', 'OTHER', 'other', true],
  ['pilot-worker-1', 'WORKER', 'workers', false],
  ['pilot-contractor-1', 'CONTRACTOR', 'contractors', false],
  ['pilot-master-1', 'MASTER', 'masters', false],
  ['pilot-pack-senior-master', 'MASTER', 'masters', false],
  ['pilot-tech-kipia-1', 'TECH_KIPIA', 'kipia', false],
  ['pilot-pack-kipia-lead', 'TECH_KIPIA', 'kipia', false],
  ['pilot-okk-1', 'OKK', 'okk', false],
  ['pilot-store-1', 'STORE', 'store', false],
  ['pilot-pack-management', 'MANAGEMENT', 'management', false],
  ['pilot-pack-admin', 'ADMIN', 'management', false],
];

const newAccounts = [
  ['mobile-contractor-lead', '+79000009101', 'CONTRACTOR_LEAD', 'contractors', 'Бригадир подрядчиков'],
  ['mobile-technolog', '+79000009102', 'TECHNOLOG', 'technology', 'Технолог'],
  ['mobile-other-specialist', '+79000009103', 'OTHER', 'other', 'Специалист'],
  ['mobile-tech-mechanic', '+79000009104', 'TECH_MECHANIC', 'mechanics', 'Механик'],
  ['mobile-tech-electric', '+79000009105', 'TECH_ELECTRIC', 'electric', 'Электрик'],
  ['mobile-tech-holod', '+79000009106', 'TECH_HOLOD', 'holod', 'Холодильщик'],
  ['mobile-tech-santechnik', '+79000009107', 'TECH_SANTECHNIK', 'santechniki', 'Сантехник'],
];

const departmentSpecs = {
  workers: ['Сотрудники производства', 'LOCAL'], contractors: ['Подрядчики', 'LOCAL'],
  masters: ['Мастера', 'LOCAL'], kipia: ['КИПиА', 'LOCAL'], okk: ['ОКК', 'LOCAL'],
  store: ['Склад', 'LOCAL'], management: ['Руководство', 'LOCAL'], technology: ['Технологи', 'GLOBAL'],
  mechanics: ['Механики', 'GLOBAL'], electric: ['Электрики', 'GLOBAL'],
  holod: ['Холодильная служба', 'GLOBAL'], santechniki: ['Сантехники', 'GLOBAL'],
  other: ['Общие специалисты', 'LOCAL'],
};

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

async function ensureDepartment(alias, spec) {
  const [name, scope] = spec;
  return db.department.upsert({
    where: { factoryId_code: { factoryId: FACTORY_ID, code: `mobile-${alias}` } },
    create: { factoryId: FACTORY_ID, code: `mobile-${alias}`, name, scope, isActive: true },
    update: { name, scope, isActive: true, deletedAt: null, deactivatedAt: null },
  });
}

async function ensureJobTitle(alias, role, departmentId, name) {
  return db.jobTitle.upsert({
    where: { factoryId_code: { factoryId: FACTORY_ID, code: `mobile-${alias}-${role.toLowerCase()}` } },
    create: { factoryId: FACTORY_ID, departmentId, name, code: `mobile-${alias}-${role.toLowerCase()}`, baseRole: role, permissionPreset: 'mobile-pilot-v1', isActive: true },
    update: { departmentId, name, baseRole: role, permissionPreset: 'mobile-pilot-v1', isActive: true, deletedAt: null, deactivatedAt: null },
  });
}

async function ensureAccess(userId, role, department, jobTitle, isGuest = false) {
  return db.userFactoryAccess.upsert({
    where: { userId_factoryId: { userId, factoryId: FACTORY_ID } },
    create: { userId, factoryId: FACTORY_ID, role, departmentId: department.id, jobTitleId: jobTitle.id, isGuest, isActive: true },
    update: {
      role, departmentId: department.id, jobTitleId: jobTitle.id, isGuest, isActive: true,
      deactivatedAt: null, deactivatedById: null, deactivationReason: null, recoveryUntil: null, restoredAt: null, restoredById: null,
    },
  });
}

async function ensureChatMember(chatId, userId, canManage = false) {
  return db.chatMember.upsert({
    where: { id: `mobile-chat-member-${userId}` },
    create: { id: `mobile-chat-member-${userId}`, chatId, userId, canRead: true, canWrite: true, canManage },
    update: { chatId, userId, canRead: true, canWrite: true, canManage, hiddenAt: null },
  });
}

async function prepare() {
  const factory = await db.factory.upsert({
    where: { code: FACTORY_CODE },
    create: { id: FACTORY_ID, code: FACTORY_CODE, name: FACTORY_NAME, isActive: true },
    update: { name: FACTORY_NAME, isActive: true, deletedAt: null, deactivatedAt: null, deactivationReason: null },
  });
  const departments = {};
  for (const [alias, spec] of Object.entries(departmentSpecs)) departments[alias] = await ensureDepartment(alias, spec);
  const titles = {};
  for (const [userId, role, alias] of existingAccounts) {
    titles[`${alias}:${role}`] ??= await ensureJobTitle(alias, role, departments[alias].id, departmentSpecs[alias][0]);
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new Error(`Не найден обязательный pilot-pack пользователь: ${userId}`);
    await ensureAccess(userId, role, departments[alias], titles[`${alias}:${role}`], userId === 'pilot-pack-guest');
  }
  for (const [id, phone, role, alias, titleName] of newAccounts) {
    const normalizedPhone = normalizePhone(phone);
    const collision = await db.user.findFirst({ where: { normalizedPhone, NOT: { id } }, select: { id: true } });
    if (collision) throw new Error(`Телефон дополнительной pilot-роли уже занят: ${phone}`);
    const passwordHash = hashPassword(PASSWORD);
    await db.user.upsert({
      where: { id },
      create: { id, factoryId: FACTORY_ID, role, phone, normalizedPhone, passwordHash, passwordResetRequired: false, passwordChangedAt: new Date(), authUpdatedAt: new Date(), employeeState: 'AVAILABLE' },
      update: { factoryId: FACTORY_ID, role, phone, normalizedPhone, passwordHash, passwordResetRequired: false, passwordChangedAt: new Date(), authUpdatedAt: new Date(), employeeState: 'AVAILABLE', blockedAt: null, deletedAt: null },
    });
    const title = await ensureJobTitle(alias, role, departments[alias].id, titleName);
    await ensureAccess(id, role, departments[alias], title, false);
  }

  const adminId = 'pilot-pack-admin';
  const masterId = 'pilot-master-1';
  const allUserIds = [...existingAccounts.map(([id]) => id), ...newAccounts.map(([id]) => id)];
  const line = await db.line.upsert({
    where: { id: 'mobile-line-packing' },
    create: { id: 'mobile-line-packing', factoryId: FACTORY_ID, name: 'Фасовочная линия', status: 'WORK' },
    update: { factoryId: FACTORY_ID, name: 'Фасовочная линия', status: 'WORK', deletedAt: null, deactivatedAt: null },
  });
  await db.line.upsert({
    where: { id: 'mobile-line-freezing' },
    create: { id: 'mobile-line-freezing', factoryId: FACTORY_ID, name: 'Линия заморозки', status: 'WORK' },
    update: { factoryId: FACTORY_ID, name: 'Линия заморозки', status: 'WORK', deletedAt: null, deactivatedAt: null },
  });
  await db.lineEvent.upsert({
    where: { id: 'mobile-line-packing-start' },
    create: { id: 'mobile-line-packing-start', lineId: line.id, factoryId: FACTORY_ID, createdById: masterId, status: 'WORK', comment: 'Линия готова к работе' },
    update: { lineId: line.id, factoryId: FACTORY_ID, createdById: masterId, status: 'WORK', comment: 'Линия готова к работе' },
  });

  const task = await db.task.upsert({
    where: { id: 'mobile-task-kipia' },
    create: { id: 'mobile-task-kipia', factoryId: FACTORY_ID, lineId: line.id, createdById: masterId, type: 'LONG', status: 'NEW', description: 'Проверить датчик температуры на фасовочной линии', deadlineAt: new Date(Date.now() + 86400000), operationId: 'mobile-task-kipia-create' },
    update: { factoryId: FACTORY_ID, lineId: line.id, status: 'NEW', description: 'Проверить датчик температуры на фасовочной линии', deletedAt: null, archivedAt: null },
  });
  await db.taskDepartmentRecipient.upsert({
    where: { taskId_departmentId: { taskId: task.id, departmentId: departments.kipia.id } },
    create: { taskId: task.id, departmentId: departments.kipia.id, factoryId: FACTORY_ID, active: true },
    update: { factoryId: FACTORY_ID, active: true },
  });

  await db.checklistTemplate.upsert({
    where: { id: 'mobile-checklist-shift-start' },
    create: { id: 'mobile-checklist-shift-start', factoryId: FACTORY_ID, departmentId: departments.masters.id, name: 'Проверка линии перед сменой', description: 'Короткий маршрут мобильной проверки', scope: 'LINE', lineId: line.id, frequencyRule: 'MANUAL', isMandatory: false, launchRoles: ['MASTER', 'MANAGEMENT', 'ADMIN'], archiveRoles: ['MASTER', 'MANAGEMENT', 'ADMIN'], createdById: adminId, isActive: true },
    update: { departmentId: departments.masters.id, lineId: line.id, name: 'Проверка линии перед сменой', isActive: true, archivedAt: null },
  });
  await db.checklistTemplateRow.upsert({
    where: { id: 'mobile-checklist-row-visual' },
    create: { id: 'mobile-checklist-row-visual', templateId: 'mobile-checklist-shift-start', title: 'Осмотреть рабочую зону', sortOrder: 1, rowType: 'BOOLEAN', requiredAnswer: true, isRequired: true, isActive: true },
    update: { templateId: 'mobile-checklist-shift-start', title: 'Осмотреть рабочую зону', sortOrder: 1, isActive: true },
  });
  await db.announcement.upsert({
    where: { id: 'mobile-announcement-welcome' },
    create: { id: 'mobile-announcement-welcome', factoryId: FACTORY_ID, authorId: adminId, title: 'Добро пожаловать на мобильный пилот', text: 'Проверяйте рабочие маршруты и отправляйте найденные ошибки через раздел «Ещё».', priority: 'IMPORTANT', visibleFrom: new Date(Date.now() - 60000), visibleUntil: new Date(Date.now() + 31536000000) },
    update: { factoryId: FACTORY_ID, archivedAt: null, deletedAt: null, visibleUntil: new Date(Date.now() + 31536000000) },
  });

  const chat = await db.chat.upsert({
    where: { id: 'mobile-chat-general' },
    create: { id: 'mobile-chat-general', factoryId: FACTORY_ID, type: 'FACTORY', title: 'Общий чат мобильного пилота', description: 'Рабочий чат изолированного завода', createdById: adminId, isActive: true },
    update: { factoryId: FACTORY_ID, title: 'Общий чат мобильного пилота', isActive: true, isHidden: false, archivedAt: null },
  });
  for (const userId of allUserIds) await ensureChatMember(chat.id, userId, userId === adminId);
  await db.chatMessage.upsert({
    where: { id: 'mobile-chat-welcome' },
    create: { id: 'mobile-chat-welcome', factoryId: FACTORY_ID, chatId: chat.id, authorId: adminId, text: 'Чат готов. Здесь можно проверить сообщения и повторное подключение.', operationId: 'mobile-chat-welcome-create' },
    update: { factoryId: FACTORY_ID, chatId: chat.id, deletedAt: null },
  });

  await db.okkRecord.upsert({
    where: { id: 'mobile-okk-record' },
    create: { id: 'mobile-okk-record', factoryId: FACTORY_ID, lineId: line.id, createdById: 'pilot-okk-1', assignedMasterId: masterId, status: 'BLOCKED', description: 'Проверить маркировку упаковки', defectDate: new Date(), shiftLabel: 'День' },
    update: { factoryId: FACTORY_ID, lineId: line.id, assignedMasterId: masterId, description: 'Проверить маркировку упаковки', deletedAt: null, archivedAt: null },
  });
  await db.stockDefect.upsert({
    where: { id: 'mobile-stock-defect' },
    create: { id: 'mobile-stock-defect', factoryId: FACTORY_ID, createdById: 'pilot-store-1', productName: 'Короб транспортный', name: 'Повреждённая упаковка', quantity: 2, unit: 'штуки', status: 'ON_STOCK', comment: 'Образец карточки' },
    update: { factoryId: FACTORY_ID, quantity: 2, unit: 'штуки', status: 'ON_STOCK', deletedAt: null },
  });
  const stock = await db.minimumStockItem.upsert({
    where: { id: 'mobile-stock-gloves' },
    create: { id: 'mobile-stock-gloves', factoryId: FACTORY_ID, departmentId: departments.store.id, name: 'Перчатки защитные', category: 'Расходные материалы', storageLocation: 'Склад', minThreshold: 20, initialQuantity: 15, currentQuantity: 15, referenceQuantity: 40, unit: 'пар', createdById: 'pilot-store-1', isActive: true },
    update: { factoryId: FACTORY_ID, departmentId: departments.store.id, currentQuantity: 15, minThreshold: 20, isActive: true, archivedAt: null },
  });
  await db.orderRequest.upsert({
    where: { id: 'mobile-order-gloves' },
    create: { id: 'mobile-order-gloves', factoryId: FACTORY_ID, departmentId: departments.store.id, sourceType: 'AUTO_FROM_STOCK', sourceItemId: stock.id, title: 'Пополнить защитные перчатки', requestedQuantity: 30, reasonComment: 'Остаток ниже минимального', status: 'ACTIVE', createdById: 'pilot-store-1' },
    update: { factoryId: FACTORY_ID, sourceItemId: stock.id, requestedQuantity: 30, status: 'ACTIVE', closedAt: null, closedById: null },
  });
  await db.shiftLog.upsert({
    where: { id: 'mobile-shift-log' },
    create: { id: 'mobile-shift-log', factoryId: FACTORY_ID, departmentId: departments.masters.id, createdById: masterId, title: 'Передача смены', text: 'Линии готовы, открытая заявка передана КИПиА.', logDate: new Date(), shiftLabel: 'День', isImportant: true, status: 'ACTIVE' },
    update: { factoryId: FACTORY_ID, text: 'Линии готовы, открытая заявка передана КИПиА.', isImportant: true, isDeleted: false, deletedAt: null },
  });

  for (const model of [db.shiftSettings, db.taskSettings, db.checklistSettings, db.chatSettings, db.announcementSettings, db.orderSettings, db.washSettings, db.defrostSettings]) {
    await model.upsert({ where: { factoryId: FACTORY_ID }, create: { factoryId: FACTORY_ID }, update: {} });
  }

  const accessRows = await db.userFactoryAccess.findMany({
    where: { factoryId: FACTORY_ID, isActive: true },
    include: { user: { select: { phone: true } }, department: { select: { name: true } }, jobTitle: { select: { name: true } } },
    orderBy: [{ role: 'asc' }, { userId: 'asc' }],
  });
  const counts = {
    users: accessRows.length,
    departments: await db.department.count({ where: { factoryId: FACTORY_ID, isActive: true, deletedAt: null } }),
    lines: await db.line.count({ where: { factoryId: FACTORY_ID, deletedAt: null } }),
    tasks: await db.task.count({ where: { factoryId: FACTORY_ID, deletedAt: null } }),
    chats: await db.chat.count({ where: { factoryId: FACTORY_ID, isActive: true } }),
    announcements: await db.announcement.count({ where: { factoryId: FACTORY_ID, deletedAt: null } }),
  };
  console.log(JSON.stringify({
    ok: true,
    factory: { code: factory.code, name: factory.name },
    counts,
    accounts: accessRows.map((row) => ({ phone: row.user.phone, role: row.role, department: row.department?.name ?? null, jobTitle: row.jobTitle?.name ?? null })),
  }, null, 2));
}

prepare().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => db.$disconnect());
