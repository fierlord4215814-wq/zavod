const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { PrismaClient } = require('../../../backend/node_modules/@prisma/client');

const runtime = process.env.LOCAL01_RUNTIME_DIR;
assert.equal(resolve(runtime || '').toLowerCase(), 'c:\\users\\79164\\appdata\\local\\zavod-local01-functional\\run-20260924-0b9b24e0');
const files = [
  'backend/prisma/schema.prisma', 'backend/prisma/system-foundation.cjs',
  'backend/src/common/effective-permissions.ts', 'backend/src/common/user-context.service.ts',
  'backend/src/modules/chats/chats.controller.ts', 'backend/src/modules/chats/chats.service.ts',
  'backend/src/modules/chats/chat-message-delete-policy.ts',
  'backend/src/modules/attachments/attachments.service.ts', 'backend/src/modules/attachments/file-storage.service.ts',
  'backend/src/modules/attachments/attachments.controller.ts',
  'backend/src/modules/checklists/checklists.controller.ts', 'backend/src/modules/checklists/checklists.service.ts',
  'backend/src/modules/notifications/notifications.service.ts', 'backend/src/ws/ws.service.ts', 'backend/src/ws/events.ts',
  'frontend/src/navigation/permissions.ts', 'frontend/src/screens/ChecklistsScreen.tsx',
  'frontend/src/screens/ShiftPeopleScreen.tsx', 'frontend/src/screens/ChatsScreen.tsx',
  'frontend/src/components/PersonProfileModal.tsx', 'frontend/src/App.tsx', 'frontend/src/api/attachments.ts',
].filter((file) => { try { readFileSync(file); return true; } catch { return false; } });
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const password = readFileSync(join(runtime, 'secrets/db-password.txt'), 'utf8').trim();
const prisma = new PrismaClient({ datasources: { db: { url: `postgresql://local01_owner:${encodeURIComponent(password)}@127.0.0.1:15436/zavod_local01_c0?schema=public` } } });

async function main() {
  const identity = await prisma.$queryRawUnsafe('SELECT current_database() AS database, current_user AS username, inet_server_addr()::text AS address, inet_server_port() AS port, current_setting(\'data_directory\') AS data_directory');
  assert.equal(identity[0].database, 'zavod_local01_c0');
  assert.equal(identity[0].port, 15436);
  assert.equal(identity[0].data_directory.replace(/\\/g, '/').toLowerCase(), `${runtime.replace(/\\/g, '/').toLowerCase()}/pgdata`);
  const defaults = await prisma.rolePermission.findMany({ where: { role: { in: ['WORKER', 'CONTRACTOR', 'CONTRACTOR_LEAD'] }, permissionCode: { startsWith: 'chats.' } }, select: { role: true, permissionCode: true, isActive: true }, orderBy: [{ role: 'asc' }, { permissionCode: 'asc' }] });
  const overrides = await prisma.$queryRawUnsafe('SELECT o."userId", o."factoryId", o."permissionCode", o.effect FROM "UserPermissionOverride" o WHERE o."permissionCode" LIKE \'chats.%\' AND EXISTS (SELECT 1 FROM "UserFactoryAccess" a WHERE a."userId"=o."userId" AND a.role IN (\'WORKER\',\'CONTRACTOR\',\'CONTRACTOR_LEAD\'))');
  const migrations = readdirSync('backend/prisma/migrations', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ name: e.name, sha256: hash(`backend/prisma/migrations/${e.name}/migration.sql`) }));
  const applied = await prisma.$queryRawUnsafe('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), identity, files: files.map((file) => ({ file, sha256: hash(file) })), migrationCount: migrations.length, migrations, applied, defaults, overrides, runtimeSecretFileNames: readdirSync(join(runtime, 'secrets')) }, null, 2));
}
main().finally(() => prisma.$disconnect()).catch((error) => { console.error(error.message.replaceAll(password, '[REDACTED]')); process.exitCode = 1; });
