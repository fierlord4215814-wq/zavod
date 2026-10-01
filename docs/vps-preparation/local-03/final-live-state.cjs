const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ownPrisma, verifyOwnDb } = require('../local-02/own-db.cjs');

const A = '8d097917-598c-4c7d-9e31-4e8d2b629ce7';
const B = '7e9fa429-61a5-48a7-8c23-bdfda0a34bdf';
const K = '6e4df6fe-bc76-4eff-a15a-a93c070a6032';
const M = '7a7ad710-31ef-49a0-b41d-7293c80e0400';
const ids = {
  line: '56359bdd-14cb-451c-9500-1e2551d1264a',
  position: 'ca5a503a-fc12-440c-819e-095968c80677',
  staffing: 'f9e8442b-2d5f-4578-a1ae-5cafaf8513a2',
  checklist: '2b03de2f-b23e-4e82-b4ff-f7f970f78645',
  stock: '492e52f7-3710-487f-a211-3ba1e4e9383b',
  returns: '141b7644-cfdf-4c6c-a732-3b5fb8031303',
};
async function main() {
  const db = ownPrisma();
  try {
    await verifyOwnDb(db);
    const [ready, version, frontend] = await Promise.all([
      fetch('http://127.0.0.1:3000/ready'),
      fetch('http://127.0.0.1:3000/version'),
      fetch('http://127.0.0.1:5173/'),
    ]);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ready, true);
    assert.equal(version.status, 200);
    assert.equal((await version.json()).version, 'LOCAL03-20260924-C1');
    assert.equal(frontend.status, 200);
    const b = await db.factory.findUniqueOrThrow({ where: { id: B }, select: { isActive: true } });
    const accesses = await db.userFactoryAccess.findMany({ where: { factoryId: B }, select: { userId: true, isActive: true, role: true } });
    const aKipia = await db.userFactoryAccess.findFirstOrThrow({ where: { factoryId: A, userId: K }, select: { isActive: true, role: true } });
    const line = await db.line.findUniqueOrThrow({ where: { id: ids.line }, select: { status: true, deletedAt: true, defaultStaffingTemplateId: true } });
    const position = await db.linePosition.findUniqueOrThrow({ where: { id: ids.position }, select: { isActive: true, deletedAt: true } });
    const staffing = await db.lineStaffingTemplate.findUniqueOrThrow({ where: { id: ids.staffing }, select: { isActive: true, deletedAt: true } });
    const checklist = await db.checklistTemplate.findUniqueOrThrow({ where: { id: ids.checklist }, select: { isActive: true, archivedAt: true } });
    const stock = await db.stockDefect.findUniqueOrThrow({ where: { id: ids.stock }, select: { status: true } });
    const returns = await db.returnRecord.findUniqueOrThrow({ where: { id: ids.returns }, select: { status: true, archivedAt: true } });
    const migrations = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    const ownOpenAssignment = await db.assignment.count({ where: { lineId: ids.line, endedAt: null } });
    assert.equal(b.isActive, false);
    assert.equal(accesses.find((item) => item.userId === K).isActive, false);
    assert.equal(accesses.find((item) => item.userId === M).isActive, false);
    assert.equal(aKipia.isActive, true);
    assert.equal(line.status, 'STOP');
    assert.ok(line.deletedAt);
    assert.equal(line.defaultStaffingTemplateId, null);
    assert.equal(position.isActive, false);
    assert.ok(position.deletedAt);
    assert.equal(staffing.isActive, false);
    assert.ok(staffing.deletedAt);
    assert.equal(checklist.isActive, false);
    assert.ok(checklist.archivedAt);
    assert.equal(stock.status, 'ARCHIVED');
    assert.equal(returns.status, 'ARCHIVED');
    assert.ok(returns.archivedAt);
    assert.equal(ownOpenAssignment, 0);
    assert.equal(migrations[0].n, 57);
    const result = {
      status: 'PASS_FINAL_C1_VISIBLE_B_INACTIVE_FIXTURES_SOFT_CLOSED',
      backendReady: true,
      backendVersion: 'LOCAL03-20260924-C1',
      frontendHttp: 200,
      migrationCount: 57,
      bInactive: true,
      bKipiaAndMasterAccessInactive: true,
      aKipiaAccessActive: true,
      lineStoppedAndSoftClosed: true,
      positionAndStaffingInactive: true,
      tenPointTemplateArchived: true,
      stockAndReturnArchived: true,
      ownLineOpenAssignments: ownOpenAssignment,
    };
    fs.writeFileSync(path.join(__dirname, 'final-live-state.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(result.status);
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
