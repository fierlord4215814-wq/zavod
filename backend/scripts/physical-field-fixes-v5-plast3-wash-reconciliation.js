const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { WashService } = require('../dist/modules/wash/wash.service');

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function maskedId(value) {
  const id = String(value ?? '');
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function publicReport(report, factory) {
  return {
    factory: { code: factory.code, name: factory.name },
    reason: report.reason,
    mode: report.mode,
    serverNow: report.serverNow,
    counts: report.counts,
    mutations: {
      sessionsClosed: report.mutations.sessionsClosed,
      assignmentsClosed: report.mutations.assignmentsClosed,
      physicalDeletes: report.mutations.physicalDeletes,
      sessionRefs: report.mutations.sessionIds.map(maskedId),
    },
    after: report.after ?? null,
    inventory: report.inventory.map((item, index) => ({
      ref: `WASH-${String(index + 1).padStart(2, '0')}`,
      id: maskedId(item.id),
      classification: item.classification,
      dataConflict: item.hasDataConflict,
      ageHours: item.ageHours,
      line: item.lineLabel,
      participants: item.participants,
      problems: item.problems,
      tasks: item.tasks,
      comments: item.comments,
      events: item.events,
      okkActivity: item.okkActivity,
      attachments: item.attachments,
      hasCompletionEvent: item.hasCompletionEvent,
    })),
  };
}

async function main() {
  process.env.SHIFT_MAINTENANCE_ENABLED = 'false';
  const apply = process.argv.includes('--apply');
  const factoryId = optionValue('--factory-id');
  const factoryCode = optionValue('--factory-code') || 'factory-4';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const washService = app.get(WashService);
    const factory = factoryId
      ? await prisma.db.factory.findFirst({ where: { id: factoryId, deletedAt: null }, select: { id: true, code: true, name: true } })
      : await prisma.db.factory.findFirst({ where: { code: factoryCode, deletedAt: null }, select: { id: true, code: true, name: true } });
    if (!factory) throw new Error('Завод для безопасной сверки не найден.');
    const report = await washService.reconcileLegacyTestSessions(factory.id, { apply });
    process.stdout.write(`${JSON.stringify(publicReport(report, factory), null, 2)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`Сверка legacy-моек не выполнена: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
