'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthService } = require('../dist/modules/auth/auth.service');
const { hashPassword, assertPasswordPolicy } = require('../dist/common/password');
const { verifyAuthToken } = require('../dist/common/auth-token');

function fixture() {
  const row = {
    id: 'synthetic-user', factoryId: 'synthetic-factory', normalizedPhone: '+79900001111',
    passwordHash: hashPassword('correct-six'), authUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
    failedLoginCount: 0, failedLoginStage: 0, lockedUntil: null, lastLoginAt: null,
    blockedAt: null, deletedAt: null, passwordResetRequired: false, role: 'WORKER', employeeState: 'AVAILABLE',
  };
  const clone = () => ({ ...row });
  const same = (a, b) => a instanceof Date || b instanceof Date
    ? (a?.getTime?.() ?? null) === (b?.getTime?.() ?? null) : a === b;
  const db = { user: {
    async findMany({ where }) { return where.normalizedPhone.in.includes(row.normalizedPhone) ? [clone()] : []; },
    async findUnique({ where }) { return where.id === row.id ? clone() : null; },
    async updateMany({ where, data }) {
      if (Object.entries(where).some(([key, value]) => !same(row[key], value))) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  } };
  const audits = [];
  const service = new AuthService({ db }, {}, { async write(item) { audits.push(item); } }, {});
  service.getAvailableFactories = async () => [];
  let clock = new Date('2026-09-30T10:00:00.000Z');
  service.now = () => clock;
  return { row, audits, service, setClock(value) { clock = new Date(value); } };
}

test('new password policy accepts 6, refuses 5 and retains safe upper bound', () => {
  assert.throws(() => assertPasswordPolicy('12345'), /не менее 6/);
  assert.doesNotThrow(() => assertPasswordPolicy('123456'));
  assert.throws(() => assertPasswordPolicy('x'.repeat(129)), /не более 128/);
});

test('three bad attempts lock 10 minutes, next series locks one hour, then cap; success resets', async () => {
  const f = fixture();
  const wrong = (client) => f.service.login({ phone: '8 (990) 000-11-11', password: 'wrong' }, client);
  for (let i = 0; i < 3; i += 1) await assert.rejects(wrong(`client-${i}`), /Неверный телефон или пароль/);
  assert.equal(f.row.failedLoginStage, 1);
  assert.equal(f.row.lockedUntil.toISOString(), '2026-09-30T10:10:00.000Z');
  await assert.rejects(f.service.login({ phone: '+79900001111', password: 'correct-six' }, 'owner'), /Слишком много попыток/);
  assert.equal(f.row.lockedUntil.toISOString(), '2026-09-30T10:10:00.000Z');
  f.setClock('2026-09-30T10:10:00.000Z');
  for (let i = 0; i < 3; i += 1) await assert.rejects(wrong(`second-${i}`), /Неверный телефон или пароль/);
  assert.equal(f.row.failedLoginStage, 2);
  assert.equal(f.row.lockedUntil.toISOString(), '2026-09-30T11:10:00.000Z');
  f.setClock('2026-09-30T11:10:00.000Z');
  for (let i = 0; i < 3; i += 1) await assert.rejects(wrong(`third-${i}`), /Неверный телефон или пароль/);
  assert.equal(f.row.failedLoginStage, 2);
  assert.equal(f.row.lockedUntil.toISOString(), '2026-09-30T12:10:00.000Z');
  f.setClock('2026-09-30T12:10:00.000Z');
  const response = await f.service.login({ phone: '+79900001111', password: 'correct-six' }, 'owner-new');
  assert.equal(response.requiresPasswordChange, false);
  assert.equal(f.row.failedLoginStage, 0);
  assert.equal(f.row.failedLoginCount, 0);
  assert.equal(f.row.lockedUntil, null);
});

test('concurrent errors serialize by compare-and-swap and do not revoke an existing session', async () => {
  const f = fixture();
  const first = await f.service.login({ phone: '+79900001111', password: 'correct-six' }, 'first-device');
  const epoch = f.row.authUpdatedAt.getTime();
  await Promise.all([0, 1, 2].map((i) => assert.rejects(
    f.service.login({ phone: '+79900001111', password: 'wrong' }, `attacker-${i}`),
  )));
  assert.equal(f.row.failedLoginStage, 1);
  assert.equal(f.row.authUpdatedAt.getTime(), epoch);
  assert.equal(verifyAuthToken(first.token)?.userId, f.row.id);
  const newService = new AuthService({ db: f.service.prisma.db }, {}, { async write() {} }, {});
  newService.now = () => new Date('2026-09-30T10:00:01.000Z');
  await assert.rejects(newService.login({ phone: '+79900001111', password: 'correct-six' }, 'second-device'), /Слишком много попыток/);
});
