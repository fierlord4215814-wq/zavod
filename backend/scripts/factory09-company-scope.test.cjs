'use strict';
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PeopleService } = require('../dist/modules/people/people.service');

function service() {
  let queried;
  const db = { userFactoryAccess: { findMany: async ({ where }) => { queried = where; return []; } } };
  const instance = new PeopleService({ db }, {}, {});
  instance.writeDenied = async () => {};
  return { instance, query: () => queried };
}

const contractor = { userId: 'contractor-b', selectedFactoryId: 'factory-nine', role: 'CONTRACTOR',
  companyId: 'company-b', isAdmin: false, isGuest: false, permissions: [] };
const foreignLead = { id: 'lead-a', role: 'CONTRACTOR_LEAD', factoryAccess: [{ role: 'CONTRACTOR_LEAD', companyId: 'company-a' }] };

test('contractor directory includes only a lead of the same company', async () => {
  const { instance, query } = service();
  await instance.list(contractor);
  assert.equal(query().factoryId, 'factory-nine');
  assert.deepEqual(query().OR, [
    { userId: 'contractor-b' },
    { role: { in: ['MASTER', 'MANAGEMENT'] } },
    { role: 'CONTRACTOR_LEAD', companyId: 'company-b' },
  ]);
  const noCompany = service();
  await noCompany.instance.list({ ...contractor, companyId: null });
  assert.equal(noCompany.query().OR.length, 2);
  const worker = service();
  await worker.instance.list({ ...contractor, role: 'WORKER' });
  assert.equal(worker.query().OR.length, 2);
});

test('direct profile denies foreign lead, permits same-company lead and factory management', async () => {
  const { instance } = service();
  await assert.rejects(instance.assertCanReadProfile(contractor, foreignLead), (error) => error?.getStatus?.() === 403);
  await assert.doesNotReject(instance.assertCanReadProfile(contractor,
    { ...foreignLead, factoryAccess: [{ role: 'CONTRACTOR_LEAD', companyId: 'company-b' }] }));
  await assert.doesNotReject(instance.assertCanReadProfile(contractor,
    { id: 'master', factoryAccess: [{ role: 'MASTER', companyId: null }] }));
  await assert.rejects(instance.assertCanReadProfile({ ...contractor, role: 'WORKER' }, foreignLead),
    (error) => error?.getStatus?.() === 403);
});
