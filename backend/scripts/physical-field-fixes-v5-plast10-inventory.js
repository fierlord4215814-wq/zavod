const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function normalized(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}

function signature(row) {
  return crypto.createHash('sha256').update(JSON.stringify(normalized(row))).digest('hex');
}

function mapRows(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, signature(row)]));
}

async function factory4() {
  const factory = await prisma.factory.findFirst({
    where: { OR: [{ code: 'factory-4' }, { name: 'Завод 4' }] },
    select: { id: true, name: true },
  });
  if (!factory) throw new Error('Завод 4 не найден.');
  return factory;
}

async function snapshot(factoryId) {
  const [departments, jobTitles, accesses, users, lines, positions, templates, checklistTemplates, chats, tasks, announcements, assignments] = await Promise.all([
    prisma.department.findMany({ where: { factoryId }, select: { id: true, factoryId: true, name: true, normalizedName: true, code: true, scope: true, isActive: true, deletedAt: true, deactivatedAt: true } }),
    prisma.jobTitle.findMany({ where: { factoryId }, select: { id: true, factoryId: true, departmentId: true, parentJobTitleId: true, name: true, code: true, baseRole: true, shiftDurationHours: true, isActive: true, deletedAt: true, deactivatedAt: true } }),
    prisma.userFactoryAccess.findMany({ where: { factoryId }, select: { id: true, userId: true, factoryId: true, role: true, departmentId: true, jobTitleId: true, companyId: true, isActive: true, isGuest: true } }),
    prisma.user.findMany({ where: { OR: [{ factoryId }, { factoryAccess: { some: { factoryId } } }] }, select: { id: true, factoryId: true, role: true, employeeState: true, blockedAt: true, deletedAt: true } }),
    prisma.line.findMany({ where: { factoryId }, select: { id: true, factoryId: true, name: true, status: true, defaultStaffingTemplateId: true, deletedAt: true, deactivatedAt: true } }),
    prisma.linePosition.findMany({ where: { factoryId }, select: { id: true, factoryId: true, lineId: true, name: true, displayName: true, skillCode: true, sortOrder: true, isActive: true, deletedAt: true, deactivatedAt: true } }),
    prisma.lineStaffingTemplate.findMany({ where: { factoryId }, select: { id: true, factoryId: true, lineId: true, name: true, isActive: true, deletedAt: true, deactivatedAt: true } }),
    prisma.checklistTemplate.findMany({ where: { factoryId }, select: { id: true, factoryId: true, departmentId: true, lineId: true, name: true, scope: true, frequencyRule: true, isActive: true, archivedAt: true } }),
    prisma.chat.findMany({ where: { factoryId }, select: { id: true, factoryId: true, departmentId: true, type: true, title: true, isActive: true, isHidden: true, archivedAt: true } }),
    prisma.task.findMany({ where: { factoryId }, select: { id: true, factoryId: true, lineId: true, type: true, status: true, description: true, archivedAt: true, deletedAt: true } }),
    prisma.announcement.findMany({ where: { factoryId }, select: { id: true, factoryId: true, departmentId: true, title: true, text: true, priority: true, archivedAt: true, deletedAt: true } }),
    prisma.assignment.findMany({ where: { factoryId }, select: { id: true, factoryId: true, userId: true, kind: true, lineId: true, positionId: true, slotIndex: true, washSessionId: true, workAreaId: true, workAreaPositionId: true, endedAt: true, version: true } }),
  ]);
  return {
    departments: mapRows(departments),
    jobTitles: mapRows(jobTitles),
    accesses: mapRows(accesses),
    users: mapRows(users),
    lines: mapRows(lines),
    positions: mapRows(positions),
    templates: mapRows(templates),
    checklistTemplates: mapRows(checklistTemplates),
    chats: mapRows(chats),
    tasks: mapRows(tasks),
    announcements: mapRows(announcements),
    assignments: mapRows(assignments),
  };
}

function compareBaseline(before, after) {
  const byModel = {};
  for (const [model, rows] of Object.entries(before.snapshot ?? {})) {
    const current = after[model] ?? {};
    const changed = Object.entries(rows).filter(([id, hash]) => current[id] !== hash).length;
    if (changed) byModel[model] = changed;
  }
  return { count: Object.values(byModel).reduce((sum, count) => sum + count, 0), byModel };
}

async function markerInventory(factoryId, marker, artifactPath) {
  const artifact = artifactPath && fs.existsSync(artifactPath)
    ? JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    : {};
  const userId = artifact.internal?.userId || '';
  const containsMarker = { contains: marker, mode: 'insensitive' };
  const [departments, jobTitles, lines, positions, templates, checklistTemplates, chats, tasks, announcements, activeAssignments, activePlans, activePlannedAssignments, user, access, auditRows] = await Promise.all([
    prisma.department.count({ where: { factoryId, OR: [{ name: containsMarker }, { code: containsMarker }], isActive: true, deletedAt: null } }),
    prisma.jobTitle.count({ where: { factoryId, OR: [{ name: containsMarker }, { code: containsMarker }], isActive: true, deletedAt: null } }),
    prisma.line.count({ where: { factoryId, name: containsMarker, deletedAt: null, deactivatedAt: null } }),
    prisma.linePosition.count({ where: { factoryId, OR: [{ name: containsMarker }, { displayName: containsMarker }], isActive: true, deletedAt: null } }),
    prisma.lineStaffingTemplate.count({ where: { factoryId, name: containsMarker, isActive: true, deletedAt: null } }),
    prisma.checklistTemplate.count({ where: { factoryId, name: containsMarker, isActive: true, archivedAt: null } }),
    prisma.chat.count({ where: { factoryId, title: containsMarker, isActive: true } }),
    prisma.task.count({ where: { factoryId, description: containsMarker, status: { not: 'DONE' }, archivedAt: null, deletedAt: null } }),
    prisma.announcement.count({ where: { factoryId, OR: [{ title: containsMarker }, { text: containsMarker }], archivedAt: null, deletedAt: null } }),
    prisma.assignment.count({ where: { factoryId, endedAt: null, OR: [{ userId: userId || '__none__' }, { line: { name: containsMarker } }] } }),
    prisma.lineShiftWorkPlan.count({
      where: {
        factoryId,
        line: { name: containsMarker, deletedAt: null, deactivatedAt: null },
      },
    }),
    prisma.plannedLineAssignment.count({ where: { factoryId, releasedAt: null, OR: [{ userId: userId || '__none__' }, { line: { name: containsMarker } }] } }),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { blockedAt: true, deletedAt: true } }) : null,
    userId ? prisma.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId, factoryId } }, select: { isActive: true, isGuest: true } }) : null,
    prisma.auditLog.findMany({ where: { factoryId }, select: { action: true, entityType: true, entityId: true, details: true }, orderBy: { createdAt: 'desc' }, take: 1000 }),
  ]);
  const auditMarkerCount = auditRows.filter((row) => JSON.stringify(row).includes(marker)).length;
  const active = {
    departments,
    jobTitles,
    lines,
    positions,
    templates,
    checklistTemplates,
    chats,
    tasks,
    announcements,
    assignments: activeAssignments,
    futureLinePlans: activePlans,
    plannedAssignments: activePlannedAssignments,
    users: user && !user.blockedAt && !user.deletedAt ? 1 : 0,
    factoryAccesses: access?.isActive ? 1 : 0,
  };
  return {
    marker,
    active,
    activeTotal: Object.values(active).reduce((sum, count) => sum + count, 0),
    auditMarkerCount,
    userFinalState: user ? { blocked: Boolean(user.blockedAt), deleted: Boolean(user.deletedAt) } : null,
    accessFinalState: access ? { active: access.isActive, guest: access.isGuest } : null,
    physicalDeletes: 0,
  };
}

async function main() {
  const mode = argument('--mode') || 'inspect';
  const output = argument('--output');
  const baselinePath = argument('--baseline');
  const marker = argument('--marker');
  const artifactPath = argument('--artifact');
  const factory = await factory4();
  const current = await snapshot(factory.id);

  if (mode === 'baseline') {
    if (!output) throw new Error('Для baseline укажите --output.');
    const result = { generatedAt: new Date().toISOString(), factory: factory.name, snapshot: current };
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ mode, factory: factory.name, models: Object.fromEntries(Object.entries(current).map(([key, rows]) => [key, Object.keys(rows).length])) }, null, 2));
    return;
  }

  const baseline = baselinePath && fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
  const preexisting = baseline ? compareBaseline(baseline, current) : null;
  const markerState = marker ? await markerInventory(factory.id, marker, artifactPath) : null;
  const result = { mode, generatedAt: new Date().toISOString(), factory: factory.name, preexisting, markerState };
  console.log(JSON.stringify(result, null, 2));
  if (output) fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if ((preexisting?.count ?? 0) > 0 || (markerState?.activeTotal ?? 0) > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
