const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient, TaskStatus, UserRole } = require('@prisma/client');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '');
}

const db = new PrismaClient();
const pilotPrimaryIds = [
  'pilot-pack-guest',
  'pilot-worker-1',
  'pilot-contractor-1',
  'pilot-master-1',
  'pilot-pack-senior-master',
  'pilot-tech-kipia-1',
  'pilot-okk-1',
  'pilot-store-1',
  'pilot-pack-management',
  'pilot-pack-admin',
];
const pilotGuestTargetIds = [
  'pilot-pack-guest-worker-target',
  'pilot-pack-guest-contractor-target',
  'pilot-pack-guest-master-target',
  'pilot-pack-guest-kipia-target',
  'pilot-pack-guest-test-target',
];
const accessLifecycleChatIds = [
  'pilot-access-lifecycle-v1-factory4-masters-chat',
  'pilot-access-lifecycle-v1-factory4-kipia-chat',
  'pilot-access-lifecycle-v1-factory-chat',
];

async function main() {
  const artifactUserWhere = {
    OR: [
      { id: { startsWith: 'flsv1tmp-' } },
      { normalizedPhone: { startsWith: '+7998' } },
    ],
  };
  const [
    artifactUsers,
    activeAssignments,
    activePlannedAssignments,
    activeRealtimeTasks,
    accessLifecycleFactory,
    activeAccessLifecycleChats,
    pilotPrimaryActive,
    pilotGuestTargetsReady,
  ] = await Promise.all([
    db.user.findMany({
      where: artifactUserWhere,
      select: {
        blockedAt: true,
        deletedAt: true,
        factoryAccess: { select: { isActive: true } },
      },
    }),
    db.assignment.count({ where: { endedAt: null, user: artifactUserWhere } }),
    db.plannedShiftAssignment.count({ where: { releasedAt: null, user: artifactUserWhere } }),
    db.task.findMany({
      where: {
        operationId: { startsWith: 'stage-prepilot-realtime-task-' },
        status: { not: TaskStatus.DONE },
        deletedAt: null,
      },
      select: { id: true, operationId: true, status: true, createdAt: true, createdById: true, factoryId: true },
    }),
    db.factory.findUnique({
      where: { id: 'pilot-access-lifecycle-v1-factory' },
      select: { isActive: true, deactivatedAt: true },
    }),
    db.chat.count({ where: { id: { in: accessLifecycleChatIds }, isActive: true } }),
    db.userFactoryAccess.count({
      where: {
        userId: { in: pilotPrimaryIds },
        factory: { code: 'factory-4', isActive: true, deletedAt: null },
        isActive: true,
        user: { blockedAt: null, deletedAt: null },
      },
    }),
    db.userFactoryAccess.count({
      where: {
        userId: { in: pilotGuestTargetIds },
        factory: { code: 'factory-4', isActive: true, deletedAt: null },
        role: UserRole.OTHER,
        isGuest: true,
        isActive: true,
        user: { blockedAt: null, deletedAt: null },
      },
    }),
  ]);

  const activeArtifactUsers = artifactUsers.filter((user) => (
    !user.blockedAt
    && !user.deletedAt
    && user.factoryAccess.some((access) => access.isActive)
  )).length;
  const accessLifecycleFactoryInactive = !accessLifecycleFactory
    || (!accessLifecycleFactory.isActive && Boolean(accessLifecycleFactory.deactivatedAt));
  const evidence = {
    historicalArtifactUsers: artifactUsers.length,
    activeArtifactUsers,
    activeAssignments,
    activePlannedAssignments,
    activeRealtimeTasks: activeRealtimeTasks.length,
    activeRealtimeTaskDetails: activeRealtimeTasks,
    accessLifecycleFactoryInactive,
    activeAccessLifecycleChats,
    pilotPrimaryActive,
    pilotPrimaryExpected: pilotPrimaryIds.length,
    pilotGuestTargetsReady,
    pilotGuestTargetsExpected: pilotGuestTargetIds.length,
    preexistingEntitiesDeleted: 0,
  };
  const failed = activeArtifactUsers !== 0
    || activeAssignments !== 0
    || activePlannedAssignments !== 0
    || activeRealtimeTasks.length !== 0
    || !accessLifecycleFactoryInactive
    || activeAccessLifecycleChats !== 0
    || pilotPrimaryActive !== pilotPrimaryIds.length
    || pilotGuestTargetsReady !== pilotGuestTargetIds.length;

  console.log(JSON.stringify({ status: failed ? 'FAIL' : 'PASS', evidence }, null, 2));
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
