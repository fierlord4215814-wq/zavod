'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { AuthService } = require('../dist/modules/auth/auth.service');
const { hashPassword } = require('../dist/common/password');
const { verifyAuthToken } = require('../dist/common/auth-token');

if (!process.env.DATABASE_URL?.includes('127.0.0.1:15446/zavod_upgrade')) {
  throw new Error('This test requires the exact disposable zavod_upgrade target on 127.0.0.1:15446.');
}
const db = new PrismaClient();
const userId = randomUUID();
const phone = `+799${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
const now = '2026-09-30T10:00:00.000Z';
function service(at) {
  const auth = new AuthService({ db }, {}, { async write() {} }, {});
  auth.getAvailableFactories = async () => [];
  auth.now = () => new Date(at);
  return auth;
}

test('SQL CAS, restart persistence and existing token survive wrong-password lock', async () => {
  await db.user.create({ data: { id: userId, factoryId: 'pre-vps-factory', normalizedPhone: phone,
    phone, role: 'WORKER', passwordHash: hashPassword('six-and-more') } });
  const owner = service(now);
  const session = await owner.login({ phone, password: 'six-and-more' }, 'owner');
  await Promise.all([0, 1, 2].map((index) => assert.rejects(
    service(now).login({ phone, password: 'wrong' }, `attacker-${index}`), /Неверный телефон или пароль/,
  )));
  const locked = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(locked.failedLoginCount, 0);
  assert.equal(locked.failedLoginStage, 1);
  assert.equal(locked.lockedUntil.toISOString(), '2026-09-30T10:10:00.000Z');
  assert.equal(verifyAuthToken(session.token)?.userId, userId);
  await assert.rejects(service('2026-09-30T10:09:59.999Z').login({ phone, password: 'six-and-more' }, 'new-device'), /Слишком много попыток/);
  const accepted = await service('2026-09-30T10:10:00.000Z').login({ phone, password: 'six-and-more' }, 'new-device');
  assert.equal(accepted.userId, userId);
  const reset = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(reset.failedLoginStage, 0);
  assert.equal(reset.lockedUntil, null);
});

test.after(async () => { await db.$disconnect(); });
