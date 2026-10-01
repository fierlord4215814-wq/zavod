const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backendDir = path.join(root, 'backend');
const { Prisma, PrismaClient } = require(path.join(backendDir, 'node_modules', '@prisma', 'client'));
const envPath = path.join(backendDir, '.env');
const artifactPath = path.join(root, 'docs', 'physical-field-fixes-v5-plast17a', 'test-artifacts.json');

if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((value) => value.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}

const db = new PrismaClient();
const excludedTechnicalModels = new Set(['AuditLog']);
const fingerprintVersion = 'business-v2';
const userTechnicalFieldsExcluded = [
  'lastLoginAt',
  'failedLoginCount',
  'lockedUntil',
  'authUpdatedAt',
  'updatedAt',
];

function quoteIdentifier(value) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe model name: ${value}`);
  return `"${value.replace(/"/g, '""')}"`;
}

async function fingerprintModel(model) {
  const table = quoteIdentifier(model.dbName || model.name);
  const normalizedRow = model.name === 'User'
    ? `(${userTechnicalFieldsExcluded.reduce((expression, field) => `${expression} - '${field}'`, 'to_jsonb(t)')})`
    : 'to_jsonb(t)';
  const rows = await db.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS count,
      md5(COALESCE(string_agg(md5((${normalizedRow})::text), '' ORDER BY md5((${normalizedRow})::text)), '')) AS fingerprint
    FROM ${table} AS t
  `);
  return {
    model: model.name,
    count: Number(rows[0]?.count ?? 0),
    fingerprint: String(rows[0]?.fingerprint ?? ''),
  };
}

async function main() {
  const models = Prisma.dmmf.datamodel.models.filter((model) => !excludedTechnicalModels.has(model.name));
  const tableFingerprints = [];
  for (const model of models) tableFingerprints.push(await fingerprintModel(model));

  const roleRows = await db.rolePermission.findMany({
    select: { role: true, permissionCode: true },
    orderBy: [{ role: 'asc' }, { permissionCode: 'asc' }],
  });
  const rolePermissions = Object.fromEntries(
    [...new Set(roleRows.map((row) => row.role))].map((role) => [
      role,
      roleRows.filter((row) => row.role === role).map((row) => row.permissionCode),
    ]),
  );

  const digest = crypto.createHash('sha256')
    .update(JSON.stringify(tableFingerprints))
    .digest('hex');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const snapshot = {
    capturedAt: new Date().toISOString(),
    label: process.env.P17A_DB_SNAPSHOT_LABEL || 'snapshot',
    mode: 'READ_ONLY_FINGERPRINT',
    fingerprintVersion,
    excludedTechnicalModels: [...excludedTechnicalModels],
    userTechnicalFieldsExcluded,
    tableCount: tableFingerprints.length,
    tableFingerprints,
    combinedFingerprint: digest,
    rolePermissions,
    secretsIncluded: false,
  };
  const previousSnapshots = Array.isArray(artifact.databaseSnapshots)
    ? artifact.databaseSnapshots
    : artifact.database?.combinedFingerprint
      ? [{ ...artifact.database, label: artifact.database.label || 'before-browser' }]
      : [];
  artifact.databaseSnapshots = [
    ...previousSnapshots.filter((item) => item.label !== snapshot.label),
    snapshot,
  ];
  artifact.database = snapshot;
  const comparableSnapshots = artifact.databaseSnapshots.filter((item) => item.fingerprintVersion === fingerprintVersion);
  artifact.databaseComparison = comparableSnapshots.length > 1
    ? {
      fingerprintVersion,
      firstLabel: comparableSnapshots[0].label,
      lastLabel: snapshot.label,
      firstFingerprint: comparableSnapshots[0].combinedFingerprint,
      lastFingerprint: snapshot.combinedFingerprint,
      unchanged: comparableSnapshots[0].combinedFingerprint === snapshot.combinedFingerprint,
    }
    : null;
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    artifact: path.relative(root, artifactPath).replace(/\\/g, '/'),
    tableCount: tableFingerprints.length,
    combinedFingerprint: digest,
    roles: Object.keys(rolePermissions),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
