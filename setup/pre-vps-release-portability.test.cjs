'use strict';

// Source-only portability check: no application, database, Docker or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { canonicalBuildFiles } = require('./deployment-context');
const { releaseIdForStaged, schemaFingerprint } = require('./zavod-setup');

const sourceRoot = path.resolve(__dirname, '..');
const collectorSource = fs.readFileSync(path.join(__dirname, 'deployment-context.js'), 'utf8');

function collectWith(pathImpl) {
  const nativePath = (value) => String(value).replace(/\\/g, '/');
  const fsAdapter = {
    ...fs,
    lstatSync: (value, ...args) => fs.lstatSync(nativePath(value), ...args),
    readdirSync: (value, ...args) => fs.readdirSync(nativePath(value), ...args),
  };
  const context = { module: { exports: {} }, require: (id) => {
    if (id === 'node:fs') return fsAdapter;
    if (id === 'node:path') return pathImpl;
    if (id === 'node:os') return os;
    throw new Error(`Unexpected module: ${id}`);
  } };
  vm.runInNewContext(collectorSource, context, { filename: 'deployment-context.js' });
  return Array.from(context.module.exports.collectBuildFiles(sourceRoot));
}

test('POSIX and Windows collectors produce the same ordered list, release ID and schema fingerprint', () => {
  const posix = collectWith(path.posix);
  const windows = collectWith(path.win32);
  assert.ok(posix.length > 50);
  assert.deepEqual(windows, posix);
  assert.deepEqual(posix, [...posix].sort());
  assert.ok(posix.every((relative) => !relative.includes('\\')));
  assert.equal(releaseIdForStaged({ path: sourceRoot, files: posix }), releaseIdForStaged({ path: sourceRoot, files: windows }));
  assert.equal(schemaFingerprint(posix), schemaFingerprint(windows));
});

test('mixed separator, reversed order and duplicate paths are canonical before hashing', () => {
  const files = collectWith(path.posix);
  const mixed = files.map((relative, index) => index % 2 ? relative.replace(/\//g, '\\') : relative).reverse();
  mixed.push(files[0], files[0].replace(/\//g, '\\'));
  assert.deepEqual(canonicalBuildFiles(mixed), files);
  assert.equal(releaseIdForStaged({ path: sourceRoot, files }), releaseIdForStaged({ path: sourceRoot, files: mixed }));
  assert.equal(schemaFingerprint(files), schemaFingerprint(mixed));
  for (const unsafe of ['../escape', 'a/./b', '/absolute', 'C:/absolute', 'a//b']) {
    assert.throws(() => canonicalBuildFiles([unsafe]));
  }
});

test('changing one staged byte changes release identity; changing one schema byte changes schema fingerprint', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zavod-release-portability-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const schema = 'backend/prisma/schema.prisma';
  const migration = 'backend/prisma/migrations/20260930000000_fixture/migration.sql';
  const frontend = 'frontend/src/example.ts';
  for (const relative of [schema, migration, frontend]) fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true });
  fs.writeFileSync(path.join(temp, schema), 'model Example { id String @id }\n');
  fs.writeFileSync(path.join(temp, migration), '-- fixture only\n');
  fs.writeFileSync(path.join(temp, frontend), 'export const value = 1;\n');
  const files = [schema, migration, frontend];
  const beforeRelease = releaseIdForStaged({ path: temp, files });
  const beforeSchema = schemaFingerprint(files, temp);
  fs.writeFileSync(path.join(temp, frontend), 'export const value = 2;\n');
  assert.notEqual(releaseIdForStaged({ path: temp, files }), beforeRelease);
  assert.equal(schemaFingerprint(files, temp), beforeSchema);
  fs.writeFileSync(path.join(temp, migration), '-- changed fixture only\n');
  assert.notEqual(schemaFingerprint(files, temp), beforeSchema);
});
