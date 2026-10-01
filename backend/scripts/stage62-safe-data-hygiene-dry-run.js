const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const rootDir = path.resolve(__dirname, '..', '..');
const envPath = path.join(rootDir, 'backend', '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const db = new PrismaClient();
const STAGE_OR_TEST_RE = /(stage\s*\d+|stage\d+|regression|browser|e2e|demo|test-fixture|fixture|simulation|autotest|auto-test)/i;
const MOJIBAKE_RE = /(\?{3,}|�|пїЅ|Ð|Гђ|Рџ|Р Сџ|вЂ|РІС)/;
const ALLOWED_UNITS = ['шт', 'кг', 'г', 'м', 'см', 'л', 'мл', 'упак.', 'короб', 'рулон', 'пара'];
const INTEGER_UNITS = new Set(['шт', 'короб', 'пара', 'упак.', 'рулон']);

function hasMarker(...values) {
  return values.filter((value) => typeof value === 'string').some((value) => STAGE_OR_TEST_RE.test(value) || MOJIBAKE_RE.test(value) || /^\s*\?{3,}\s*$/.test(value));
}

function dirtyStock(item) {
  const unit = String(item.unit ?? '').trim();
  const name = String(item.name ?? '').trim().toLocaleLowerCase('ru-RU');
  if (hasMarker(item.id, item.name, item.description)) return true;
  if (name === 'апра') return true;
  if (!ALLOWED_UNITS.includes(unit)) return true;
  if (/\d/.test(unit)) return true;
  if (INTEGER_UNITS.has(unit)) {
    return [item.minThreshold, item.initialQuantity, item.currentQuantity, item.referenceQuantity].some((value) => Number.isFinite(Number(value)) && !Number.isInteger(Number(value)));
  }
  return false;
}

async function main() {
  const factory = await db.factory.findUnique({ where: { code: 'factory-4' } });
  const factoryId = process.argv.find((arg) => arg.startsWith('--factoryId='))?.slice('--factoryId='.length) || factory?.id;
  if (!factoryId) throw new Error('factory-4 not found and --factoryId was not provided');

  const [
    lines,
    workAreas,
    stockItems,
    recoveryLines,
    recoveryDepartments,
    chats,
    messages,
  ] = await Promise.all([
    db.line.findMany({ where: { factoryId }, select: { id: true, name: true } }),
    db.workArea.findMany({ where: { factoryId }, select: { id: true, name: true, description: true } }),
    db.minimumStockItem.findMany({ where: { factoryId } }),
    db.line.findMany({ where: { factoryId, deletedAt: { not: null } }, select: { id: true, name: true } }),
    db.department.findMany({ where: { AND: [{ OR: [{ factoryId }, { factoryId: null }] }, { OR: [{ isActive: false }, { deletedAt: { not: null } }] }] }, select: { id: true, name: true, code: true } }).catch(() => []),
    db.chat.findMany({ where: { OR: [{ factoryId }, { factoryId: null }] }, select: { id: true, title: true, description: true } }),
    db.chatMessage.findMany({ where: { OR: [{ factoryId }, { chat: { factoryId } }] }, select: { id: true, text: true, operationId: true }, take: 300 }),
  ]);

  const stageRecords = [...lines, ...workAreas, ...chats].filter((item) => hasMarker(item.id, item.name, item.title, item.description));
  const mojibakeRecords = [...lines, ...workAreas, ...chats, ...recoveryDepartments].filter((item) => MOJIBAKE_RE.test(String(item.name ?? item.title ?? item.code ?? '')) || /^\s*\?{3,}\s*$/.test(String(item.name ?? item.title ?? '')));
  const dirtyStockRecords = stockItems.filter(dirtyStock);
  const recoveryHidden = [...recoveryLines, ...recoveryDepartments].filter((item) => hasMarker(item.id, item.name, item.code));
  const autoTestMessages = messages.filter((item) => hasMarker(item.id, item.operationId, item.text));

  const result = {
    mode: 'dry-run',
    factoryId,
    changed: false,
    counts: {
      stageOrTestRecords: stageRecords.length,
      mojibakeRecords: mojibakeRecords.length,
      dirtyStockRecords: dirtyStockRecords.length,
      recoveryRecordsHiddenFromNormalView: recoveryHidden.length,
      autoTestChatMessagesHiddenFromRuntime: autoTestMessages.length,
    },
    affectedEntities: {
      lines: lines.filter((item) => hasMarker(item.id, item.name)).length,
      workAreas: workAreas.filter((item) => hasMarker(item.id, item.name, item.description)).length,
      stockItems: dirtyStockRecords.length,
      recovery: recoveryHidden.length,
      chats: chats.filter((item) => hasMarker(item.id, item.title, item.description)).length,
      chatMessages: autoTestMessages.length,
    },
    recommendations: [
      'Не выполнять physical delete: Stage62 только скрывает мусор из обычного runtime.',
      'Проблемные записи доступны в админской диагностике.',
      'Apply-очистку делать отдельным wizard-этапом с явным подтверждением.',
    ],
  };
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
