require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OkkService } = require('../dist/modules/okk/okk.service');

const factoryId = 'factory-nine';
const users = {
  master: { id: 'master', lastName: 'Примеров', firstName: 'Борис', middleName: '9', role: 'MASTER' },
  actor: { id: 'actor', lastName: 'Примеров', firstName: 'Дмитрий', middleName: '9', role: 'TECHNOLOG' },
  okk: { id: 'okk', lastName: 'Примеров', firstName: 'Евгений', middleName: '9', role: 'OKK' },
};

function fixture() {
  let record;
  const db = {
    $transaction: async (callback) => callback(db),
    line: { findFirst: async ({ where }) => where.factoryId === factoryId ? { id: 'line-nine' } : null },
    userFactoryAccess: {
      findFirst: async ({ where, select }) => {
        assert.equal(where.factoryId, factoryId);
        assert.equal(where.isActive, true);
        assert.equal(where.isGuest, false);
        assert.deepEqual(select.user.select, { id: true, lastName: true, firstName: true, middleName: true });
        const person = users[where.userId];
        if (!person || (where.role && where.role !== person.role)) return null;
        return { userId: person.id, role: person.role, user: person, department: { name: 'Учебный отдел' } };
      },
    },
    okkRecord: {
      create: async ({ data }) => (record = { id: 'record-nine', ...data }),
      findFirst: async ({ where }) => where.factoryId === factoryId ? record : null,
      update: async ({ data }) => (record = { ...record, ...data }),
    },
  };
  const service = new OkkService(
    { db }, { broadcast() {} }, { sendPush() {} },
    { async writeTx() {} }, {}, {},
  );
  return { service, getRecord: () => record };
}

test('ОКК saves canonical factory-user names for master, actor and completion', async () => {
  const { service, getRecord } = fixture();
  const actor = { userId: 'actor', selectedFactoryId: factoryId, role: 'TECHNOLOG' };
  await service.createRecord(actor, {
    lineId: 'line-nine', assignedMasterId: 'master', defectDate: '2026-09-28',
    shiftLabel: 'Ночь', productName: 'Учебная продукция', mismatchReason: 'Проверка',
    defectQuantity: '1 шт',
  });
  assert.equal(getRecord().masterNameSnapshot, 'Примеров Борис 9');
  assert.equal(getRecord().blockedByNameSnapshot, 'Примеров Дмитрий 9');
  await service.markCompletion(actor, 'record-nine', {
    completionMark: 'Учебное выполнение', unblockDate: '2026-09-28',
    completedByUserId: 'okk', blockedByUserId: 'actor', correctiveActions: 'Проверка',
  });
  assert.equal(getRecord().completedByNameSnapshot, 'Примеров Евгений 9');
  assert.equal(getRecord().blockedByNameSnapshot, 'Примеров Дмитрий 9');
});

test('ОКК rejects a master outside the selected factory', async () => {
  const { service, getRecord } = fixture();
  await assert.rejects(service.createRecord(
    { userId: 'actor', selectedFactoryId: 'foreign-factory', role: 'TECHNOLOG' },
    { lineId: 'line-nine', assignedMasterId: 'master', defectDate: '2026-09-28', shiftLabel: 'Ночь', productName: 'Учебная продукция', mismatchReason: 'Проверка', defectQuantity: '1 шт' },
  ));
  assert.equal(getRecord(), undefined);
});
