'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ArchiveXlsxService } = require('../dist/modules/archive/archive-xlsx.service');

test('hidden between archive selection and hydration never exports stale chamber snapshot', async () => {
  let query;
  const prisma = { db: { defrostEvent: { async findMany(input) { query = input; return []; } } } };
  const exporter = new ArchiveXlsxService({}, prisma);
  await assert.rejects(exporter.defrostPlan({
    factoryId: 'fixture-factory',
    items: [{ id: 'fixture-event', title: 'Stale private camera name', date: new Date() }],
  }), (error) => error?.status === 409 && !String(error).includes('Stale private camera name'));
  assert.equal(query.where.factoryId, 'fixture-factory');
  assert.equal(query.where.AND.length, 1);
});
