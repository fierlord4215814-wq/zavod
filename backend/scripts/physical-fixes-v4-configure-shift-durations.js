const API = process.env.API_URL || process.env.ZAVOD_API_URL || 'http://127.0.0.1:3000';
const ADMIN_ID = 'pilot-pack-admin';
const FACTORY_CODE = 'factory-4';
const DAY_LONG_JOB_TITLE_CODES = new Set([
  'pilot-pack-electrician-v1',
  'pilot-pack-cold-specialist-v1',
]);

async function request(pathname, options = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': ADMIN_ID,
      ...(options.factoryId ? { 'x-factory-id': options.factoryId } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname}: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  const factories = await request('/admin/factories');
  const factory = factories.find((item) => item.code === FACTORY_CODE);
  if (!factory) throw new Error(`factory ${FACTORY_CODE} not found`);

  const titles = await request(`/admin/job-titles?factoryId=${encodeURIComponent(factory.id)}`, {
    factoryId: factory.id,
  });
  const matched = titles.filter((title) => DAY_LONG_JOB_TITLE_CODES.has(title.code));
  const matchedCodes = new Set(matched.map((title) => title.code));
  const missing = [...DAY_LONG_JOB_TITLE_CODES].filter((code) => !matchedCodes.has(code));
  if (missing.length) throw new Error(`job titles not found: ${missing.join(', ')}`);

  let changed = 0;
  for (const title of matched) {
    if (title.shiftDurationHours === 24) continue;
    await request(`/admin/job-titles/${encodeURIComponent(title.id)}`, {
      method: 'PATCH',
      factoryId: factory.id,
      body: {
        shiftDurationHours: 24,
        reason: 'Физический пилот: суточная смена должности',
      },
    });
    changed += 1;
  }

  const verified = await request(`/admin/job-titles?factoryId=${encodeURIComponent(factory.id)}`, {
    factoryId: factory.id,
  });
  const result = verified
    .filter((title) => DAY_LONG_JOB_TITLE_CODES.has(title.code))
    .map((title) => ({
      code: title.code,
      shiftDurationHours: title.shiftDurationHours,
    }));
  if (result.length !== DAY_LONG_JOB_TITLE_CODES.size || result.some((title) => title.shiftDurationHours !== 24)) {
    throw new Error(`shift duration verification failed: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify({ factoryCode: FACTORY_CODE, changed, titles: result }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
