/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');
const { WashService } = require('../dist/modules/wash/wash.service');
const { PrismaService } = require('../dist/prisma/prisma.service');

async function main() {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  prismaService.$connect = prisma.$connect.bind(prisma);
  prismaService.$disconnect = prisma.$disconnect.bind(prisma);
  Object.assign(prismaService, prisma);
  const washService = new WashService(prismaService);

  const factoryId = 'factory-e2e';
  const [line, starter, workerA, workerB, outsider] = await Promise.all([
    prisma.line.create({ data: { factoryId, name: 'L-E2E' } }),
    prisma.user.create({ data: { factoryId } }),
    prisma.user.create({ data: { factoryId } }),
    prisma.user.create({ data: { factoryId } }),
    prisma.user.create({ data: { factoryId: 'other-factory' } }),
  ]);

  await prisma.assignment.createMany({
    data: [
      { userId: workerA.id, lineId: line.id, factoryId },
      { userId: workerB.id, lineId: line.id, factoryId },
    ],
  });

  const session = await washService.startWash(line.id, starter.id);

  let conflictOnSecondStart = false;
  try { await washService.startWash(line.id, starter.id); } catch { conflictOnSecondStart = true; }

  const issue = await washService.addIssue(session.id, starter.id, 'broken nozzle');

  let conflictOnCompleteWithIssue = false;
  try { await washService.completeWash(session.id); } catch { conflictOnCompleteWithIssue = true; }

  await washService.resolveIssue(issue.id, starter.id);
  const completed = await washService.completeWash(session.id);

  const users = await prisma.user.findMany({ where: { id: { in: [workerA.id, workerB.id, outsider.id] } } });
  const workersAvailable = users.filter((u) => [workerA.id, workerB.id].includes(u.id)).every((u) => u.employeeState === 'AVAILABLE');
  const outsiderUntouched = users.find((u) => u.id === outsider.id)?.employeeState === 'AVAILABLE';

  console.log(JSON.stringify({
    secondStartConflict: conflictOnSecondStart,
    completeWithIssueConflict: conflictOnCompleteWithIssue,
    completeAfterResolveDone: completed.status === 'DONE',
    workersAvailable,
    outsiderUntouched,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
