'use strict';

// Explicit, one-time local fixture preparation. This file is never imported by runtime or seed.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { PrismaClient, UserRole } = require('@prisma/client');
const { hashPassword, normalizePhone, maskPhone } = require('../dist/common/password');

const SET = 'FACTORY9-TEST-GUESTS-03';
const FACTORY4_ID = '537cbb48-7fba-48b6-80af-659f82cdaeb3';
const FACTORY9_ID = 'f33f9682-8168-4562-a8c8-5c196b2c0d37';
const CONFIRM = 'CREATE_LOCAL_MES_FACTORY9_TEST_GUESTS_03';

// Future assignments are metadata only. This script creates every person as OTHER/isGuest.
const roster = [
  ['production-head', 'Андрей', 'Примеров', 'MANAGEMENT', 'Начальник производства'],
  ['master-24', 'Борис', 'Примеров', 'MASTER', 'Мастер цеха'],
  ['senior-master-12', 'Виктор', 'Примеров', 'MASTER', 'Старший мастер'],
  ['raw-master-12', 'Григорий', 'Примеров', 'MASTER', 'Сырьевой мастер'],
  ['technolog-okk-24', 'Дмитрий', 'Примеров', 'TECHNOLOG + ОКК', 'Сменный технолог'],
  ['okk', 'Евгений', 'Примеров', 'OKK', 'Инспектор ОКК'],
  ['mechanic-24', 'Жанна', 'Примерова', 'TECH_MECHANIC', 'Механик'],
  ['kipia', 'Зоя', 'Примерова', 'TECH_KIPIA', 'Специалист КИПиА'],
  ['electric', 'Игорь', 'Примеров', 'TECH_ELECTRIC', 'Электрик'],
  ['holod', 'Кирилл', 'Примеров', 'TECH_HOLOD', 'Холодильщик'],
  ['santechnik', 'Лариса', 'Примерова', 'TECH_SANTECHNIK', 'Сантехник'],
  ['store', 'Марина', 'Примерова', 'STORE', 'Кладовщик'],
  ['loader', 'Николай', 'Примеров', 'WORKER', 'Загрузчик'],
  ['packer', 'Олег', 'Примеров', 'WORKER', 'Фасовщик'],
  ['handler', 'Павел', 'Примеров', 'WORKER', 'Грузчик'],
  ['forklift-12', 'Роман', 'Примеров', 'WORKER', 'Водитель погрузчика'],
  ['cleaner-12', 'Светлана', 'Примерова', 'WORKER', 'Уборщица производства'],
  ['operator-12', 'Тимур', 'Примеров', 'WORKER', 'Оператор-наладчик'],
  ['contractor-a', 'Ульяна', 'Примерова', 'CONTRACTOR', 'Наёмный работник', 'А'],
  ['contractor-lead-a', 'Фёдор', 'Примеров', 'CONTRACTOR_LEAD', 'Начальник наёмных работников', 'А'],
  ['contractor-b', 'Юлия', 'Примерова', 'CONTRACTOR', 'Наёмный работник', 'Б'],
  ['unassigned-control', 'Яков', 'Примеров', 'UNASSIGNED', null],
].map(([slug, firstName, lastName, intendedRole, intendedJob, intendedCompany], index) => ({
  slug,
  firstName: `${firstName} 9`,
  lastName,
  fullName: `${lastName} ${firstName} 9`,
  phone: `+79900009${String(201 + index).padStart(3, '0')}`,
  intendedRole,
  intendedJob,
  intendedCompany: intendedCompany ?? null,
}));

function fixtureId(slug) {
  const hex = createHash('sha256').update(`${SET}:mes:${FACTORY9_ID}:${slug}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function manifest() {
  return roster.map((row) => ({ ...row, id: fixtureId(row.slug), factoryId: FACTORY9_ID }));
}

function assertLocalTarget(urlValue) {
  const url = new URL(urlValue);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Not a PostgreSQL URL');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Target is not loopback');
  assert.equal(url.port || '5432', '5432', 'Target port is not 5432');
  assert.equal(url.pathname, '/mes', 'Target DB is not mes');
}

async function readTarget(db) {
  const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port');
  assert.equal(identity?.db, 'mes', 'Connected DB mismatch');
  assert.equal(identity?.port, 5432, 'Connected port mismatch');
  assert.ok(['127.0.0.1', '::1'].includes(String(identity?.addr).split('/')[0]), 'Connected server is not loopback');
  const factories = await db.factory.findMany({ where: { code: { in: ['factory-4', 'factory-9'] } }, select: { id: true, code: true, isActive: true, deletedAt: true } });
  assert.equal(factories.length, 2, 'Required factories missing');
  for (const [code, id] of [['factory-4', FACTORY4_ID], ['factory-9', FACTORY9_ID]]) {
    const row = factories.find((item) => item.code === code);
    assert.equal(row?.id, id, `${code} identity mismatch`);
    assert.equal(row?.isActive, true, `${code} inactive`);
    assert.equal(row?.deletedAt, null, `${code} deleted`);
  }
  const migrations = await db.$queryRawUnsafe('SELECT count(*)::int AS applied FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
  assert.equal(migrations[0]?.applied, 57, 'Expected 57 applied migrations');
  return { db: identity.db, addr: identity.addr, port: identity.port };
}

async function inspect(db, expected) {
  const ids = expected.map((row) => row.id);
  const phoneRows = await db.user.findMany({
    where: { OR: [{ phone: { not: null } }, { normalizedPhone: { not: null } }] },
    select: { id: true, phone: true, normalizedPhone: true },
  });
  const matches = await db.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, factoryId: true, firstName: true, lastName: true, phone: true, normalizedPhone: true,
      factoryAccess: { select: { factoryId: true, role: true, isGuest: true, isActive: true, departmentId: true, jobTitleId: true, companyId: true } },
    },
  });
  const byId = new Map(matches.map((user) => [user.id, user]));
  for (const row of expected) {
    const user = byId.get(row.id);
    const phoneOwner = phoneRows.find((candidate) => (
      normalizePhone(candidate.normalizedPhone ?? '') === row.phone
      || normalizePhone(candidate.phone ?? '') === row.phone
    ));
    if (phoneOwner && phoneOwner.id !== row.id) throw new Error(`Phone collision for ${row.slug}; no existing account will be modified`);
    if (!user) continue;
    assert.equal(user.factoryId, FACTORY9_ID, `Fixture ${row.slug} moved to another home factory`);
    assert.equal(user.normalizedPhone, row.phone, `Fixture ${row.slug} phone changed`);
    assert.equal(user.phone, row.phone, `Fixture ${row.slug} phone changed`);
    assert.equal(user.firstName, row.firstName, `Fixture ${row.slug} name changed`);
    assert.equal(user.lastName, row.lastName, `Fixture ${row.slug} name changed`);
    assert.ok(user.factoryAccess.some((access) => access.factoryId === FACTORY9_ID), `Fixture ${row.slug} lost factory9 access`);
  }
  const existingCount = expected.filter((row) => byId.has(row.id)).length;
  if (existingCount !== 0 && existingCount !== expected.length) throw new Error('Partial fixture set found; refusing to fill missing accounts');
  if (existingCount === expected.length) {
    const audits = await db.auditLog.findMany({ where: { action: 'FACTORY9_TEST_GUEST_CREATED', entityId: { in: ids } }, select: { entityId: true, factoryId: true, details: true } });
    assert.equal(audits.length, expected.length, 'Fixture ownership audit incomplete');
    for (const audit of audits) {
      assert.equal(audit.factoryId, FACTORY9_ID, 'Fixture audit factory mismatch');
      assert.equal(audit.details?.fixtureSet, SET, 'Fixture audit set mismatch');
    }
  }
  return existingCount;
}

async function createGuests(db, password) {
  const expected = manifest();
  const existing = await inspect(db, expected);
  if (existing === expected.length) return { created: 0, existing };
  assert.equal(existing, 0);
  assert.equal(typeof password, 'string', 'Test password must come from environment');
  assert.ok(password.length > 0, 'Test password is empty');
  const now = new Date();
  await db.$transaction(async (tx) => {
    // Repeat the collision check inside the transaction. Unique phone/ID constraints close races.
    assert.equal(await inspect(tx, expected), 0, 'Fixture set appeared during transaction');
    for (const row of expected) {
      await tx.user.create({
        data: {
          id: row.id,
          factoryId: FACTORY9_ID,
          firstName: row.firstName,
          lastName: row.lastName,
          role: UserRole.OTHER,
          phone: row.phone,
          normalizedPhone: row.phone,
          passwordHash: hashPassword(password),
          passwordChangedAt: now,
          authUpdatedAt: now,
          factoryAccess: { create: { factoryId: FACTORY9_ID, role: UserRole.OTHER, isGuest: true, isActive: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          factoryId: FACTORY9_ID,
          userId: row.id,
          action: 'FACTORY9_TEST_GUEST_CREATED',
          entityType: 'User',
          entityId: row.id,
          details: { fixtureSet: SET, slug: row.slug, phone: maskPhone(row.phone), initialRole: 'OTHER', initialGuest: true },
        },
      });
    }
  }, { timeout: 30000 });
  return { created: expected.length, existing: 0 };
}

async function main() {
  assert.equal(process.env.FACTORY9_GUESTS_CONFIRM, CONFIRM, 'Explicit local fixture confirmation missing');
  const url = process.env.DATABASE_URL;
  assert.ok(url, 'DATABASE_URL missing');
  assertLocalTarget(url);
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const target = await readTarget(db);
    const expected = manifest();
    assert.equal(new Set(expected.map((row) => row.id)).size, expected.length, 'Duplicate fixture ID');
    assert.equal(new Set(expected.map((row) => row.phone)).size, expected.length, 'Duplicate fixture phone');
    for (const row of expected) {
      assert.equal(normalizePhone(row.phone), row.phone, `Invalid test phone ${row.slug}`);
      assert.ok(row.fullName.endsWith(' 9'), `Missing name marker ${row.slug}`);
    }
    const before = await inspect(db, expected);
    const plan = { set: SET, target, factoryId: FACTORY9_ID, count: expected.length, alreadyPresent: before,
      inserts: before === 0 ? { User: expected.length, UserFactoryAccess: expected.length, AuditLog: expected.length } : { User: 0, UserFactoryAccess: 0, AuditLog: 0 },
      people: expected.map(({ id, phone, fullName, intendedRole, intendedJob, intendedCompany, slug }) => ({ id, phone, fullName, intendedRole, intendedJob, intendedCompany, slug })) };
    if (process.argv.includes('--plan')) { process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`); return; }
    assert.ok(process.argv.includes('--apply'), 'Use --plan or --apply');
    const result = await createGuests(db, process.env.FACTORY9_TEST_PASSWORD);
    const after = await inspect(db, expected);
    assert.equal(after, expected.length, 'Postwrite fixture count mismatch');
    process.stdout.write(`${JSON.stringify({ set: SET, target, created: result.created, preservedExisting: result.existing, verified: after, passwordPrinted: false }, null, 2)}\n`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const reason = error.code === 'ERR_ASSERTION' ? error.message : (error.code ?? 'unexpected error');
    process.stderr.write(`${SET} FAILED: ${reason}\n`);
    process.exitCode = 1;
  });
}

module.exports = { SET, roster, manifest, fixtureId, assertLocalTarget, inspect, createGuests };
