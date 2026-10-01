const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const approvedNames = new Set([
  'Пицца Цезарь',
  'Пицца Рондо',
  'Основа Райкорт',
  'Блины конверт №3',
  'Блины конверт №4',
  'Чебурек',
  'Блины Трубочка',
  'Фрикадельки, наггетсы, куриные палочки',
  'Котлеты',
  'Экструзионные пельмени',
  'Манты и Хинкали 7 лепестков',
  'Хинкали мини',
  'Пельмени Сигнал-пак',
]);

const fixturePatterns = [
  /^Stage\d*/i,
  /^PILOT_/i,
  /^PILOT fixture\b/i,
  /^Integrity control\b/i,
  /\bbrowser regression\b/i,
  /\boperational loss\b/i,
  /^Операционные потери\s+\d{10,}/i,
  /^Провер(?:ка|очная).*?(?:\d{10,}|mpz|mq\d|mr\w)/i,
  /^Контроль (?:мойки|параллельности|доступа)\s+\d{10,}/i,
  /^Линия теста$/i,
];

function isProvenFixture(name) {
  return fixturePatterns.some((pattern) => pattern.test(name));
}

async function dependencyCounts(lineIds) {
  const where = { lineId: { in: lineIds } };
  const [
    assignments,
    tasks,
    washSessions,
    washControlItems,
    positions,
    templates,
    lineEvents,
    defrostEvents,
    shiftResults,
    shiftStates,
    workPlans,
    plannedAssignments,
    okkRecords,
    userSkills,
    skillCredits,
  ] = await Promise.all([
    prisma.assignment.count({ where }),
    prisma.task.count({ where }),
    prisma.washSession.count({ where }),
    prisma.washControlItem.count({ where }),
    prisma.linePosition.count({ where }),
    prisma.lineStaffingTemplate.count({ where }),
    prisma.lineEvent.count({ where }),
    prisma.defrostEvent.count({ where }),
    prisma.lineShiftResult.count({ where }),
    prisma.lineShiftState.count({ where }),
    prisma.lineShiftWorkPlan.count({ where }),
    prisma.plannedLineAssignment.count({ where }),
    prisma.okkRecord.count({ where }),
    prisma.userSkill.count({ where }),
    prisma.userSkillCredit.count({ where }),
  ]);
  return {
    assignments,
    tasks,
    washSessions,
    washControlItems,
    positions,
    templates,
    lineEvents,
    defrostEvents,
    shiftResults,
    shiftStates,
    workPlans,
    plannedAssignments,
    okkRecords,
    userSkills,
    skillCredits,
  };
}

async function main() {
  const factory = await prisma.factory.findUnique({
    where: { code: 'factory-4' },
    select: { id: true, name: true },
  });
  if (!factory) throw new Error('Завод 4 не найден');

  const allLines = await prisma.line.findMany({
    where: { factoryId: factory.id },
    select: { id: true, name: true, deletedAt: true },
    orderBy: { name: 'asc' },
  });
  const fixtureLines = allLines.filter(
    (line) => !approvedNames.has(line.name) && isProvenFixture(line.name),
  );
  const fixtureIds = fixtureLines.map((line) => line.id);
  const ambiguousLines = allLines.filter(
    (line) => !approvedNames.has(line.name) && !isProvenFixture(line.name),
  );
  const counts = fixtureIds.length ? await dependencyCounts(fixtureIds) : {};

  if (APPLY && fixtureIds.length) {
    await prisma.$transaction(async (tx) => {
      await tx.userSkillCredit.deleteMany({ where: { lineId: { in: fixtureIds } } });
      await tx.assignment.deleteMany({ where: { lineId: { in: fixtureIds } } });
      await tx.task.deleteMany({ where: { lineId: { in: fixtureIds } } });
      await tx.washControlItem.deleteMany({ where: { lineId: { in: fixtureIds } } });
      await tx.washSession.deleteMany({ where: { lineId: { in: fixtureIds } } });
      await tx.line.deleteMany({ where: { id: { in: fixtureIds }, factoryId: factory.id } });
    }, { timeout: 120_000 });
  }

  const remainingFixtureCount = APPLY
    ? await prisma.line.count({ where: { id: { in: fixtureIds } } })
    : fixtureIds.length;
  const activeApproved = await prisma.line.findMany({
    where: { factoryId: factory.id, deletedAt: null },
    select: { name: true },
    orderBy: { name: 'asc' },
  });

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    factory: factory.name,
    provenFixtureLines: fixtureLines.length,
    fixtureDependencies: counts,
    ambiguousLegacyLinesPreserved: ambiguousLines.length,
    ambiguousLegacyNames: ambiguousLines.map((line) => line.name),
    deletedFixtureLines: APPLY ? fixtureLines.length - remainingFixtureCount : 0,
    remainingFixtureLines: remainingFixtureCount,
    activeLineCount: activeApproved.length,
    activeLineNames: activeApproved.map((line) => line.name),
    usersChanged: 0,
    uploadsChanged: 0,
    auditChanged: 0,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
