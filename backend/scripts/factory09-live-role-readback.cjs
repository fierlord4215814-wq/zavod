'use strict';

// Explicit local readback, not runtime code. No tokens, hashes or password are logged.
const { manifest } = require('./factory09-test-guests-03.cjs');
const FACTORY4_ID = '537cbb48-7fba-48b6-80af-659f82cdaeb3';
const FACTORY9_ID = manifest()[0].factoryId;
const base = 'http://127.0.0.1:3000';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function main() {
  if (process.env.FACTORY09_TEST_PASSWORD === undefined) throw Error('Test password is required only in process environment');
  const ready = await request('/ready');
  const version = await request('/version');
  if (ready.status !== 200 || ready.body?.ready !== true || version.body?.version !== 'MES4-FACTORY9-DIRECT-20260928') {
    throw Error('Unexpected backend identity');
  }
  const result = [];
  for (const row of manifest()) {
    const login = await request('/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: row.phone, password: process.env.FACTORY09_TEST_PASSWORD }),
    });
    if (login.status !== 201 || typeof login.body?.token !== 'string') throw Error(`Normal login failed for ${row.slug}: ${login.status}`);
    const token = login.body.token;
    const available = login.body.availableFactories ?? [];
    const ownHeaders = { authorization: `Bearer ${token}`, 'x-factory-id': FACTORY9_ID };
    const foreignHeaders = { authorization: `Bearer ${token}`, 'x-factory-id': FACTORY4_ID };
    const [ownLines, foreignLines, ownAdmin] = await Promise.all([
      request('/lines', { headers: ownHeaders }),
      request('/lines', { headers: foreignHeaders }),
      request('/admin/users', { headers: ownHeaders }),
    ]);
    result.push({ slug: row.slug, login: login.status, factories: available.map((item) => item.code ?? item.id),
      ownLines: ownLines.status, foreignLines: foreignLines.status, ownAdmin: ownAdmin.status });
  }
  for (const row of result) {
    if (row.factories.length !== 1 || !row.factories.includes('factory-9')) throw Error(`Unexpected factory scope for ${row.slug}`);
    if (row.foreignLines !== 403 || row.ownAdmin !== 403) throw Error(`Factory/admin denial failed for ${row.slug}`);
  }
  process.stdout.write(`${JSON.stringify({ backend: 'MES4-FACTORY9-DIRECT-20260928', roles: result }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
