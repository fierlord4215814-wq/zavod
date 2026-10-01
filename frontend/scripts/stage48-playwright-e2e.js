const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const pilot = spawnSync(process.execPath, ['backend/scripts/stage47-pilot-scenario.js'], {
  cwd: rootDir,
  encoding: 'utf8',
  stdio: 'inherit',
});

if (pilot.status !== 0) {
  process.exit(pilot.status ?? 1);
}

async function cleanupPilotAssignments() {
  const { PrismaClient } = require(path.join(backendDir, 'node_modules/@prisma/client'));
  const db = new PrismaClient();
  const pilotUsers = ['pilot-worker-1', 'pilot-worker-2', 'pilot-worker-3', 'pilot-contractor-1', 'pilot-contractor-2'];
  try {
    await db.assignment.updateMany({
      where: { userId: { in: pilotUsers }, endedAt: null },
      data: { endedAt: new Date(Date.now() - 10 * 60 * 1000), endedById: 'test-admin', comment: 'Stage48 browser e2e pilot cleanup' },
    });
    await db.assignment.updateMany({
      where: { userId: { in: pilotUsers }, endedAt: { not: null } },
      data: { startedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await db.user.updateMany({
      where: { id: { in: pilotUsers } },
      data: { employeeState: 'AVAILABLE' },
    });
    await db.plannedLineAssignment.updateMany({
      where: { userId: { in: ['pilot-worker-3', 'pilot-contractor-2'] }, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: 'test-admin' },
    });
  } finally {
    await db.$disconnect();
  }
}

cleanupPilotAssignments().then(() => {
process.env.STAGE_E2E_SPEC = 'e2e/stage48-shift-timeline-planning.spec.ts';
process.env.STAGE_E2E_TIMEOUT_MS = process.env.STAGE_E2E_TIMEOUT_MS || '300000';
require('./stage31-playwright-e2e');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
