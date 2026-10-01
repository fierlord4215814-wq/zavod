const fs = require('node:fs');
const path = require('node:path');
const { NotificationsService } = require('../dist/modules/notifications/notifications.service');

const rootDir = path.resolve(__dirname, '..', '..');
const passed = [];
const failed = [];

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function record(name, condition, detail) {
  (condition ? passed : failed).push({ name, ...(detail === undefined ? {} : { detail }) });
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}: ${name}\n`);
}

function cleanHumanText(value) {
  return !/(?:__PFFV5|STAGE_PREPILOT|PILOT_CONCURRENCY|operationId|double[-_\s]?submit|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/i.test(String(value ?? ''));
}

async function main() {
  const rawNotification = {
    id: 'notification-internal-ref',
    factoryId: 'factory-current',
    departmentId: 'department-current',
    userId: 'user-current',
    type: 'STAGE_PREPILOT_REALTIME',
    title: 'STAGE_PREPILOT_REALTIME __PFFV5_P4_20260808__',
    message: 'double submit operationId 3f85c9ce-8b1c-4ff3-9c8f-8b04ff22ee65 at 2026-08-08T12:00:00.000Z',
    entityType: 'TASK',
    entityId: '3f85c9ce-8b1c-4ff3-9c8f-8b04ff22ee65',
    severity: 'WARNING',
    readAt: null,
    expiresAt: null,
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
  };
  const rawSnapshot = JSON.stringify(rawNotification);
  const queries = [];
  const updates = [];
  const prisma = {
    db: {
      notification: {
        findMany: async (query) => { queries.push(query); return [rawNotification]; },
        findFirst: async (query) => { queries.push(query); return rawNotification; },
        update: async (query) => {
          updates.push(query);
          return { ...rawNotification, readAt: query.data.readAt };
        },
      },
    },
  };
  const audit = { write: async () => undefined };
  const ws = { sendToUsers: () => undefined };
  const push = { sendNotificationToUsers: async () => undefined };
  const service = new NotificationsService(prisma, audit, ws, push);
  const user = {
    userId: 'user-current',
    selectedFactoryId: 'factory-current',
    role: 'WORKER',
    departmentId: 'department-current',
    companyId: null,
    permissions: [],
    isAdmin: false,
    isGuest: false,
    scope: { type: 'FACTORY', factoryId: 'factory-current', departmentId: 'department-current' },
    id: 'user-current',
    factoryId: 'factory-current',
  };

  const list = await service.list(user);
  record('notification list returns one visible item', list.length === 1);
  record('notification title and message are human presentation text', cleanHumanText(list[0]?.title) && cleanHumanText(list[0]?.message), list[0] && { title: list[0].title, message: list[0].message });
  record('notification presentation keeps useful entity route', list[0]?.sourceRoute === 'tasks');
  record('raw notification storage remains immutable', JSON.stringify(rawNotification) === rawSnapshot);
  record('notification list remains factory/user/department scoped', JSON.stringify(queries[0]?.where ?? {}).includes('factory-current') && JSON.stringify(queries[0]?.where ?? {}).includes('user-current'));

  const readResult = await service.markRead(user, rawNotification.id);
  record('read endpoint also returns human presentation text', cleanHumanText(readResult?.title) && cleanHumanText(readResult?.message));
  record('read endpoint changes only readAt in mocked storage', updates.length === 1 && Object.keys(updates[0].data).length === 1 && updates[0].data.readAt instanceof Date);

  const guest = { ...user, isGuest: true, scope: { type: 'GUEST', factoryId: 'factory-current' } };
  await service.list(guest);
  record('guest notification query is denied by backend visibility scope', JSON.stringify(queries.at(-1)?.where ?? {}).includes('__guest_forbidden__'));

  const notificationSource = read('backend/src/modules/notifications/notifications.service.ts');
  const adminSource = read('backend/src/modules/admin/admin.service.ts');
  const premiumSource = read('frontend/src/components/PremiumShell.tsx');
  const appSource = read('frontend/src/App.tsx');
  const bugReportSource = read('frontend/src/screens/BugReportScreen.tsx');
  const attachmentSource = read('frontend/src/components/AttachmentPicker.tsx');
  const taskSource = read('frontend/src/screens/TasksScreen.tsx');
  const shiftPeopleSource = read('frontend/src/screens/ShiftPeopleScreen.tsx');

  record('list, read, WebSocket and push use one notification presenter', /\.map\(\(notification\) => this\.presentNotification\(notification\)\)/.test(notificationSource)
    && /return this\.presentNotification\(updated\)/.test(notificationSource)
    && /const payload = this\.presentNotification\(notification\)/.test(notificationSource)
    && /sendNotificationToUsers\(recipientIds, payload\)/.test(notificationSource));
  record('internal notification create still stores original title and message', /title: input\.title[\s\S]*message: input\.message/.test(notificationSource));
  record('delegation candidates and mutation share factory, department and hierarchy policy', /canDelegateTargetAccess/.test(adminSource)
    && /permissionCopyPlan/.test(adminSource)
    && /Нельзя выдавать права в другом заводе/.test(adminSource)
    && /Делегирование доступно только внутри своего отдела/.test(adminSource));
  record('canonical PremiumSheet owns body lock and Android Back', /useBodyScrollLock\(open\)/.test(premiumSource)
    && /useMobileBackLayer\(open/.test(premiumSource));
  record('request UI close and business completion have distinct labels', /Закрыть окно/.test(taskSource) && /Завершить заявку/.test(taskSource));
  record('work-area presentation uses one human three-count summary', /Нужно: \{required\}/.test(shiftPeopleSource)
    && /Назначено: \{assigned\}/.test(shiftPeopleSource)
    && /Не хватает: \{missing\}/.test(shiftPeopleSource)
    && !/Свободно: \{(?:free|Math\.max\(planned - actual)/.test(shiftPeopleSource)
    && !/Дефицит: \{missing\}/.test(shiftPeopleSource));
  record('error report keeps canonical draft guard and one attachment trigger', /useMobileFormDirty/.test(bugReportSource)
    && /singleTrigger/.test(bugReportSource)
    && /Добавить вложение/.test(attachmentSource));
  record('dirty close uses in-app dialog, not browser confirm', /AppConfirmDialog/.test(appSource)
    && /Закрыть без отправки\?/.test(appSource)
    && !/window\.(?:prompt|alert|confirm)\s*\(/.test([appSource, bugReportSource, taskSource, premiumSource].join('\n')));
  record('targeted presentation code has no secret or storage-path values', !/(?:postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@|passwordHash\s*[:=]\s*["']|storagePath\s*[:=]\s*["']|JWT_SECRET\s*[:=]\s*["'])/i.test([notificationSource, premiumSource, appSource, bugReportSource].join('\n')));

  process.stdout.write(`\nPFFV5 Plast 4 regression: ${passed.length} passed, ${failed.length} failed\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
