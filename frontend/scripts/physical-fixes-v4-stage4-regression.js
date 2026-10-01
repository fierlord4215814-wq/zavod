const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const chat = read('frontend/src/screens/ChatsScreen.tsx');
const types = read('frontend/src/store/app.store.ts');
const ws = read('frontend/src/ws/client.ts');
const css = read('frontend/src/styles.css');
const service = read('backend/src/modules/chats/chats.service.ts');
const controller = read('backend/src/modules/chats/chats.controller.ts');
const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260727120000_physical_fixes_v4_chat_membership/migration.sql');

let passed = 0;
let failed = 0;

function record(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

record('canonical ChatMember model owns group membership roles', /enum ChatMemberRole[\s\S]*OWNER[\s\S]*ADMIN[\s\S]*MEMBER/.test(schema)
  && /membershipRole\s+ChatMemberRole/.test(schema));
record('migration is additive and has no destructive statements', !/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(migration)
  && /ADD COLUMN "membershipRole"/.test(migration)
  && /ChatMember_single_owner_key/.test(migration));
record('direct communication block is separate from account blockedAt', /communicationBlockedAt/.test(schema)
  && /setDirectCommunicationBlock/.test(service)
  && !/user\.blockedAt\s*=/.test(service));
record('backend write guard rejects blocked direct communication', /directCommunicationBlocked\(chat\)[\s\S]{0,260}Общение в этом личном чате заблокировано/.test(service));
record('owner leave and owner removal invariants are backend-enforced', /должен сначала передать управление группой/.test(service)
  && /Главного администратора нельзя удалить/.test(service));
record('membership actions use operation locks and processed operations', /processedMembershipReplay/.test(service)
  && /operationLockKey\.processedOperation/.test(service));
record('membership system messages are created in the same transaction', /createMembershipSystemMessageTx\(tx/.test(service)
  && /kind:\s*ChatMessageKind\.SYSTEM/.test(service));
record('controller exposes leave, role, transfer, remove and block actions', [
  'chats/:id/leave',
  'chats/:id/transfer-ownership',
  'chats/:id/members/:userId/role',
  'chats/:id/members/:userId/remove',
  'chats/:id/communication-block',
].every((route) => controller.includes(route)));
record('chat DTO carries membership and communication state', /membershipRole\?:/.test(types)
  && /communicationBlocked\?:/.test(types)
  && /communicationBlockedByMe\?:/.test(types));
record('group UI shows owner/admin/member and membership actions', /Главный администратор/.test(chat)
  && /Назначить администратором/.test(chat)
  && /Передать управление/.test(chat)
  && /Выйти из чата/.test(chat));
record('personal UI has explicit block and unblock actions', /Блокировать общение/.test(chat)
  && /Разблокировать общение/.test(chat));
record('mini profile opens canonical employee profile', /Перейти в профиль/.test(chat)
  && /zavod:navigate/.test(chat)
  && /CHAT_RETURN_STATE_KEY/.test(chat));
record('realtime chat membership event refreshes access', /chat_updated/.test(ws)
  && /zavod:chat-updated/.test(chat));
record('member actions remain compact and responsive', /\.chat-member-actions/.test(css)
  && /flex-wrap:\s*wrap/.test(css));
record('changed chat UI does not use browser prompt alert or confirm', !/\b(?:window\.)?(?:prompt|alert|confirm)\s*\(/.test(chat));

console.log(`\nPhysical Fixes V4 Stage4 UI: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
