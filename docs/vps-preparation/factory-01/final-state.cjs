const h = require('./own-runtime.cjs'), { manifest, attachments, files } = require('./pair.cjs');
const { assert, path, receipt } = h, s = require('./structure.json'), pair = require('./pair-restore.json');
(async () => {
  const p = h.prisma();
  try {
    await h.verify(p); const ready = await (await fetch('http://127.0.0.1:3000/ready')).json();
    const version = await (await fetch('http://127.0.0.1:3000/version')).json();
    assert(ready.ready); assert.equal(version.version, 'FACTORY01-20260926-T1');
    const tables = await manifest(p); assert.deepEqual(tables, pair.sourceTables, 'No main T1 change during copy exercises');
    const bound = await attachments(p, path.join(h.runtime, 'uploads')), physical = files(path.join(h.runtime, 'uploads'));
    assert.deepEqual(bound, pair.sourceAttachments); assert.equal(h.sha(Buffer.from(JSON.stringify(physical))), pair.physicalFiles.manifestSha256);
    const factory = await p.factory.findUnique({ where: { id: s.factory }, select: { id: true, name: true, code: true, isActive: true } });
    const access = await p.userFactoryAccess.groupBy({ by: ['role', 'isActive', 'isGuest'], where: { factoryId: s.factory }, _count: { _all: true } });
    const idle = { assignments: await p.assignment.count({ where: { factoryId: s.factory, endedAt: null } }),
      sessions: await p.shiftSession.count({ where: { factoryId: s.factory, endedAt: null } }),
      tasks: await p.task.count({ where: { factoryId: s.factory, status: { not: 'DONE' }, deletedAt: null } }),
      runs: await p.checklistRun.count({ where: { factoryId: s.factory, status: { in: ['ACTIVE', 'PAUSED'] } } }),
      blocked: await p.user.count({ where: { blockedAt: { not: null } } }),
      inactiveAccess: await p.userFactoryAccess.count({ where: { factoryId: s.factory, isActive: false } }) };
    assert(Object.values(idle).every(n => n === 0)); assert(factory.isActive);
    const copyConnections = await p.$queryRawUnsafe("SELECT datname,count(*)::int AS count FROM pg_stat_activity WHERE datname IN ('zavod_factory01_restore','zavod_factory01_handover','zavod_factory01_handover_restore') GROUP BY datname");
    assert.equal(copyConnections.length, 0, 'No copy application/connections may be left active');
    const locks = await p.$queryRawUnsafe("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname LIKE 'zavod_factory01%' AND wait_event_type='Lock'");
    assert.equal(locks[0].count, 0);
    const ev = { status: 'PASS_MAIN_T1_ACTIVE_UNCHANGED_COPIES_STOPPED_SAFE_IDLE', atUtc: new Date().toISOString(), version: version.version, ready: true,
      factory, access, idle, copyConnections, lockWaiters: 0, counts: await h.counts(p),
      mainAll90UnchangedDuringRestore: true, attachmentCount: bound.length, physicalFiles: physical.length,
      physicalDigest: pair.physicalFiles.manifestSha256, migrations: tables._prisma_migrations.count,
      activeFuturePlans: await p.plannedLineAssignment.count({ where: { factoryId: s.factory, releasedAt: null } }),
      tables, attachmentBindings: bound };
    receipt('final-live-state', ev); console.log(JSON.stringify({ status: ev.status, factory, idle, users: access.reduce((n, x) => n + x._count._all, 0), attachments: bound.length, migrations: ev.migrations }));
  } finally { await p.$disconnect(); }
})().catch(e => { console.error(h.safeError(e)); process.exitCode = 1; });
