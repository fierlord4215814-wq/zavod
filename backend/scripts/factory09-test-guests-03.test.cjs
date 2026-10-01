'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { manifest, assertLocalTarget, inspect, createGuests } = require('./factory09-test-guests-03.cjs');

function fixtureDb(options = {}) {
  const state = { users: [], audits: [] };
  let queue = Promise.resolve();
  const copy = (value) => structuredClone(value);
  const facade = (draft) => ({
    user: {
      async findMany({ where }) {
        if (where.id?.in) return copy(draft.users.filter((row) => where.id.in.includes(row.id)));
        return copy(draft.users.filter((row) => row.phone != null || row.normalizedPhone != null));
      },
      async create({ data }) {
        if (options.failAt === draft.users.length + 1) throw new Error('synthetic insert failure');
        if (draft.users.some((row) => row.id === data.id || row.normalizedPhone === data.normalizedPhone)) {
          const error = new Error('synthetic unique collision');
          error.code = 'P2002';
          throw error;
        }
        draft.users.push({
          id: data.id, factoryId: data.factoryId, firstName: data.firstName, lastName: data.lastName,
          phone: data.phone, normalizedPhone: data.normalizedPhone, passwordHash: data.passwordHash,
          factoryAccess: [{ factoryId: data.factoryAccess.create.factoryId, role: data.factoryAccess.create.role,
            isGuest: data.factoryAccess.create.isGuest, isActive: true, departmentId: null, jobTitleId: null, companyId: null }],
        });
      },
    },
    auditLog: {
      async findMany({ where }) {
        return copy(draft.audits.filter((row) => row.action === where.action && where.entityId.in.includes(row.entityId)));
      },
      async create({ data }) { draft.audits.push(copy(data)); },
    },
  });
  const db = facade(state);
  db.$transaction = async (fn) => {
    const previous = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const draft = copy(state);
      const result = await fn(facade(draft));
      state.users = draft.users;
      state.audits = draft.audits;
      return result;
    } finally {
      release();
    }
  };
  return { db, state };
}

test('manifest is a bounded, unique, factory9-only plan with one unassigned guest', () => {
  const rows = manifest();
  assert.equal(rows.length, 22);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  assert.equal(new Set(rows.map((row) => row.phone)).size, rows.length);
  assert.ok(rows.every((row) => row.fullName.endsWith(' 9') && row.factoryId === rows[0].factoryId));
  assert.equal(rows.filter((row) => row.intendedRole === 'UNASSIGNED').length, 1);
  assert.equal(rows.filter((row) => row.intendedCompany === 'Б').length, 1);
});

test('target guard refuses other hosts, databases and ports', () => {
  assert.doesNotThrow(() => assertLocalTarget('postgresql://user:password@localhost:5432/mes'));
  assert.throws(() => assertLocalTarget('postgresql://user:password@example.com:5432/mes'));
  assert.throws(() => assertLocalTarget('postgresql://user:password@localhost:5433/mes'));
  assert.throws(() => assertLocalTarget('postgresql://user:password@localhost:5432/other'));
});

test('normalized legacy-phone collision blocks any creation', async () => {
  const { db, state } = fixtureDb();
  state.users.push({ id: 'old-person', phone: '89900009201', normalizedPhone: null, factoryAccess: [] });
  await assert.rejects(() => createGuests(db, 'dummy-for-isolated-test'), /Phone collision/);
  assert.equal(state.users.length, 1);
  assert.equal(state.audits.length, 0);
});

test('creation is atomic on failure and rerun preserves UI assignment and hash', async () => {
  const broken = fixtureDb({ failAt: 3 });
  await assert.rejects(() => createGuests(broken.db, 'dummy-for-isolated-test'), /synthetic insert failure/);
  assert.equal(broken.state.users.length, 0);
  assert.equal(broken.state.audits.length, 0);

  const normal = fixtureDb();
  assert.equal((await createGuests(normal.db, 'dummy-for-isolated-test')).created, 22);
  assert.equal(normal.state.users.length, 22);
  assert.equal(normal.state.audits.length, 22);
  const first = normal.state.users[0];
  const oldHash = first.passwordHash;
  first.factoryAccess[0].role = 'MANAGEMENT';
  first.factoryAccess[0].isGuest = false;
  first.factoryAccess[0].jobTitleId = 'ui-assigned-job';
  assert.equal((await createGuests(normal.db, 'different-dummy-for-isolated-test')).created, 0);
  assert.equal(first.passwordHash, oldHash);
  assert.equal(first.factoryAccess[0].role, 'MANAGEMENT');
  assert.equal(first.factoryAccess[0].jobTitleId, 'ui-assigned-job');
  assert.equal(normal.state.audits.length, 22);
  assert.equal(await inspect(normal.db, manifest()), 22);
});

test('two concurrent first-runs leave exactly one complete set', async () => {
  const { db, state } = fixtureDb();
  const outcomes = await Promise.allSettled([
    createGuests(db, 'dummy-for-isolated-test'),
    createGuests(db, 'dummy-for-isolated-test'),
  ]);
  assert.equal(outcomes.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((row) => row.status === 'rejected').length, 1);
  assert.equal(state.users.length, 22);
  assert.equal(state.audits.length, 22);
  assert.equal(await inspect(db, manifest()), 22);
});
