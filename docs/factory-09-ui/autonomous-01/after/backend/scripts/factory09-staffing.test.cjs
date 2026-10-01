'use strict';
require('./master-offline-guard.cjs');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { LineService } = require('../dist/modules/line/line.service');

test('ISOLATED job-title duration accepts exact 12/24 and rejects all other values', () => {
  const admin = new AdminService({}, {}, {}, {}, {});
  assert.equal(admin.normalizeJobTitleShiftDuration(12), 12);
  assert.equal(admin.normalizeJobTitleShiftDuration(24), 24);
  assert.equal(admin.normalizeJobTitleShiftDuration(undefined), 12);
  for (const value of [0, 8, 20, 25, 'сутки']) assert.throws(() => admin.normalizeJobTitleShiftDuration(value));
});

test('ISOLATED staffing items preserve nine exact Excel line totals without creating people', () => {
  const service = new LineService({}, {}, {}, {});
  const matrix = [
    [3, 2, 1], [5, 2, 1], [4, 0, 0], [1, 2, 1], [1, 2, 1],
    [1, 2, 1], [1, 2, 1], [1, 1, 1], [5, 5, 1],
  ];
  const sums = [0, 0, 0];
  const totals = matrix.map((counts) => {
    const items = counts.map((count, index) => ({ positionId: `position-${index}`, requiredCount: count,
      minRequired: count, defaultPlanned: count, plannedCount: count, maxRequired: count }))
      .filter((item) => item.requiredCount > 0)
      .map((item) => service.normalizeTemplateItem(item));
    counts.forEach((count, index) => { sums[index] += count; });
    assert.ok(items.every((item) => item.minRequired === item.defaultPlanned && item.defaultPlanned === item.maxRequired));
    return items.reduce((sum, item) => sum + item.plannedCount, 0);
  });
  assert.deepEqual(totals, [6, 8, 4, 4, 4, 4, 4, 3, 11]);
  assert.deepEqual(sums, [22, 18, 8]);
  assert.equal(totals.reduce((sum, value) => sum + value, 0), 48);
  assert.equal(matrix[2].filter((count) => count > 0).length, 1);
});
