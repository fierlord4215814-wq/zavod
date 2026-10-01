'use strict';

// Reproducible local HTTP guard readback. Never prints credentials or tokens.
const { manifest } = require('./factory09-test-guests-03.cjs');
const people = manifest();
const factoryId = people[0].factoryId;
const leadId = people.find((row) => row.slug === 'contractor-lead-a').id;
const base = 'http://127.0.0.1:3000';

async function login(slug) {
  const person = people.find((row) => row.slug === slug);
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: person.phone, password: process.env.FACTORY09_TEST_PASSWORD }) });
  const body = await response.json();
  if (response.status !== 201 || !body.token) throw Error(`Normal login failed: ${slug}`);
  return { person, headers: { authorization: `Bearer ${body.token}`, 'x-factory-id': factoryId } };
}

async function main() {
  if (!process.env.FACTORY09_TEST_PASSWORD) throw Error('Test password required in process environment');
  const output = [];
  for (const slug of ['contractor-b', 'contractor-a', 'loader']) {
    const actor = await login(slug);
    const [listResponse, profileResponse] = await Promise.all([
      fetch(`${base}/people`, { headers: actor.headers }),
      fetch(`${base}/people/${leadId}`, { headers: actor.headers }),
    ]);
    const list = await listResponse.json();
    output.push({ slug, listStatus: listResponse.status, listContainsLeadA: list.people?.some((row) => row.id === leadId || row.userId === leadId),
      directLeadAStatus: profileResponse.status });
  }
  const expected = [
    ['contractor-b', false, 403],
    ['contractor-a', true, 200],
    ['loader', false, 403],
  ];
  for (const [slug, visible, status] of expected) {
    const row = output.find((item) => item.slug === slug);
    if (row.listStatus !== 200 || row.listContainsLeadA !== visible || row.directLeadAStatus !== status) {
      throw Error(`Company boundary failed for ${slug}: ${JSON.stringify(row)}`);
    }
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
