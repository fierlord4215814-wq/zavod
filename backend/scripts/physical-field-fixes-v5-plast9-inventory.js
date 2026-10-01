const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const envPath = path.join(backendDir, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

process.env.ANNOUNCEMENT_MAINTENANCE_ENABLED = 'false';
process.env.CHECKLIST_MAINTENANCE_ENABLED = 'false';

const { NestFactory } = require('@nestjs/core');
const { DepartmentScope } = require('@prisma/client');
const { AppModule } = require('../dist/app.module');
const { AdminService } = require('../dist/modules/admin/admin.service');
const { DirectoryService } = require('../dist/modules/directory/directory.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { hasPilotFixtureMarker, isPilotVisibleLine } = require('../dist/common/pilot-visibility');

const APPLY = process.argv.includes('--apply');
const REASON = 'PFFV5_P9_DEFAULT_STAFFING_RECONCILIATION';
const DEPARTMENT_REASON = 'PFFV5_P9_DEPARTMENT_FIXTURE_RECONCILIATION';

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function classifyLine(line) {
  const activeTemplates = line.staffingTemplates.filter((item) => item.isActive && !item.deletedAt);
  const approvedTemplates = activeTemplates.filter((item) => normalizeName(item.name) === 'утвержденный состав');
  const defaultTemplate = activeTemplates.find((item) => item.id === line.defaultStaffingTemplateId) ?? null;

  if (line.defaultStaffingTemplateId) {
    if (!defaultTemplate || defaultTemplate.lineId !== line.id || defaultTemplate.factoryId !== line.factoryId) {
      return { classification: 'DATA_CONFLICT', activeTemplates, approvedTemplates, defaultTemplate: null };
    }
    return { classification: 'DEFAULT_OK', activeTemplates, approvedTemplates, defaultTemplate };
  }
  if (approvedTemplates.length === 1) {
    return { classification: 'UNIQUE_APPROVED_TEMPLATE_NOT_LINKED', activeTemplates, approvedTemplates, defaultTemplate: null };
  }
  if (approvedTemplates.length > 1 || activeTemplates.length > 1) {
    return { classification: 'MULTIPLE_POSSIBLE_TEMPLATES', activeTemplates, approvedTemplates, defaultTemplate: null };
  }
  if (activeTemplates.length === 0) {
    return { classification: 'NO_TEMPLATE', activeTemplates, approvedTemplates, defaultTemplate: null };
  }
  return { classification: 'DATA_CONFLICT', activeTemplates, approvedTemplates, defaultTemplate: null };
}

function classifyDepartments(rows) {
  const result = new Map();
  const visible = rows.filter((item) => {
    const isPhysicalFieldFixFixture = [item.name, item.code]
      .some((value) => /(?:^|[_-])PFFV5[_-]P\d+(?:[_-]|$)/i.test(String(value ?? '')));
    if (isPhysicalFieldFixFixture || hasPilotFixtureMarker(item.id, item.name, item.code)) {
      result.set(item.id, 'PROVEN_TEST_FIXTURE');
      return false;
    }
    return true;
  });
  const groups = new Map();
  for (const item of visible) {
    const key = normalizeName(item.normalizedName || item.name);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) {
    const scopes = new Set(group.map((item) => `${item.scope}:${item.factoryId ?? 'GLOBAL'}`));
    const classification = group.length === 1 || scopes.size === group.length
      ? 'LEGITIMATELY_DISTINCT'
      : 'AMBIGUOUS';
    for (const item of group) result.set(item.id, classification);
  }
  return result;
}

function countBy(values, allowed) {
  return Object.fromEntries(allowed.map((key) => [key, values.filter((value) => value === key).length]));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const adminService = app.get(AdminService);
    const directory = app.get(DirectoryService);
    const factory = await prisma.db.factory.findFirst({
      where: { OR: [{ code: 'factory-4' }, { name: 'Завод 4' }] },
      select: { id: true, name: true },
    });
    if (!factory) throw new Error('Завод 4 не найден.');

    const rawLines = await prisma.db.line.findMany({
      where: { factoryId: factory.id, deletedAt: null },
      include: {
        staffingTemplates: {
          where: { deletedAt: null },
          include: { items: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const lines = rawLines.filter(isPilotVisibleLine).map((line) => ({ line, ...classifyLine(line) }));
    const mutationPlan = lines
      .filter((item) => item.classification === 'UNIQUE_APPROVED_TEMPLATE_NOT_LINKED')
      .map((item) => ({ lineId: item.line.id, templateId: item.approvedTemplates[0].id, lineName: item.line.name }));

    let applied = 0;
    if (APPLY && mutationPlan.length) {
      const actor = await prisma.db.user.findUnique({ where: { id: 'test-admin' }, select: { id: true } });
      await prisma.db.$transaction(async (tx) => {
        for (const item of mutationPlan) {
          const template = await tx.lineStaffingTemplate.findFirst({
            where: {
              id: item.templateId,
              lineId: item.lineId,
              factoryId: factory.id,
              isActive: true,
              deletedAt: null,
              name: 'Утверждённый состав',
            },
            select: { id: true },
          });
          if (!template) throw new Error(`Состав линии «${item.lineName}» изменился после dry-run.`);
          const updated = await tx.line.updateMany({
            where: { id: item.lineId, factoryId: factory.id, defaultStaffingTemplateId: null },
            data: { defaultStaffingTemplateId: template.id, version: { increment: 1 } },
          });
          if (updated.count !== 1) throw new Error(`Линия «${item.lineName}» изменилась после dry-run.`);
          await tx.auditLog.create({
            data: {
              userId: actor?.id ?? null,
              factoryId: factory.id,
              action: REASON,
              entityType: 'Line',
              entityId: item.lineId,
              details: { reason: REASON, templateName: 'Утверждённый состав' },
            },
          });
          applied += 1;
        }
      });
    }

    const departmentRows = await prisma.db.department.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { factoryId: factory.id },
          { factoryId: null, scope: DepartmentScope.GLOBAL },
        ],
      },
      include: {
        _count: {
          select: {
            userAccess: true,
            taskRecipients: true,
            checklistTemplates: true,
            chats: true,
            chatMembers: true,
            chatMessages: true,
            announcements: true,
            announcementAudiences: true,
            workAreas: true,
            jobTitles: true,
            assignmentRequests: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const departmentClasses = classifyDepartments(departmentRows);
    const canonicalDepartments = await directory.canonicalDepartments(factory.id);
    const canonicalNames = canonicalDepartments.map((item) => normalizeName(item.name));
    const duplicateCanonicalNames = canonicalNames.filter((name, index) => canonicalNames.indexOf(name) !== index);
    const departmentMutationPlan = departmentRows.filter((item) => {
      if (departmentClasses.get(item.id) !== 'PROVEN_TEST_FIXTURE') return false;
      if (!/^pffv5-p9-duplicate-proof-/i.test(String(item.code ?? ''))) return false;
      if (Object.values(item._count).some((count) => count !== 0)) return false;
      return departmentRows.some((candidate) => candidate.id !== item.id
        && departmentClasses.get(candidate.id) === 'LEGITIMATELY_DISTINCT'
        && normalizeName(candidate.normalizedName || candidate.name) === normalizeName(item.normalizedName || item.name));
    });
    let departmentsSoftDeactivated = 0;
    if (APPLY && departmentMutationPlan.length) {
      const admin = {
        userId: 'test-admin', id: 'test-admin', selectedFactoryId: factory.id, factoryId: factory.id,
        role: 'ADMIN', departmentId: null, companyId: null, permissions: ['admin.departments.manage'],
        isAdmin: true, isGuest: false, scope: { type: 'FACTORY', factoryId: factory.id },
      };
      for (const item of departmentMutationPlan) {
        await adminService.updateDepartmentStatus(admin, item.id, { isActive: false, reason: DEPARTMENT_REASON });
        departmentsSoftDeactivated += 1;
      }
    }

    const lineClasses = lines.map((item) => item.classification);
    const referenceKeys = [
      'userAccess',
      'taskRecipients',
      'checklistTemplates',
      'chats',
      'chatMembers',
      'chatMessages',
      'announcements',
      'announcementAudiences',
      'workAreas',
      'jobTitles',
      'assignmentRequests',
    ];
    const referenceTotals = {};
    for (const item of departmentRows) {
      const classification = departmentClasses.get(item.id);
      if (!classification) continue;
      referenceTotals[classification] ??= Object.fromEntries(referenceKeys.map((key) => [key, 0]));
      for (const key of referenceKeys) referenceTotals[classification][key] += item._count[key];
    }
    const classifierSafety = {
      uniqueApproved: classifyLine({
        id: 'line', factoryId: 'factory', defaultStaffingTemplateId: null,
        staffingTemplates: [{ id: 'template', lineId: 'line', factoryId: 'factory', name: 'Утверждённый состав', isActive: true, deletedAt: null }],
      }).classification,
      ambiguous: classifyLine({
        id: 'line', factoryId: 'factory', defaultStaffingTemplateId: null,
        staffingTemplates: [
          { id: 'one', lineId: 'line', factoryId: 'factory', name: 'Утверждённый состав', isActive: true, deletedAt: null },
          { id: 'two', lineId: 'line', factoryId: 'factory', name: 'Утверждённый состав', isActive: true, deletedAt: null },
        ],
      }).classification,
      noTemplate: classifyLine({ id: 'line', factoryId: 'factory', defaultStaffingTemplateId: null, staffingTemplates: [] }).classification,
    };
    const report = {
      mode: APPLY ? 'apply' : 'dry-run',
      factory: factory.name,
      lines: {
        total: lines.length,
        classifications: countBy(lineClasses, [
          'DEFAULT_OK',
          'UNIQUE_APPROVED_TEMPLATE_NOT_LINKED',
          'MULTIPLE_POSSIBLE_TEMPLATES',
          'NO_TEMPLATE',
          'DATA_CONFLICT',
        ]),
        requiredCounts: lines.map((item) => item.defaultTemplate
          ? item.defaultTemplate.items.reduce((sum, row) => sum + Number(row.plannedCount ?? row.defaultPlanned ?? row.requiredCount ?? 0), 0)
          : null),
        mutationPlan: mutationPlan.map((item) => ({ line: item.lineName, action: 'LINK_UNIQUE_APPROVED_TEMPLATE' })),
        applied,
      },
      departments: {
        inspected: departmentRows.length,
        classifications: countBy([...departmentClasses.values()], [
          'PROVEN_SAME_DEPARTMENT_DUPLICATE',
          'PROVEN_TEST_FIXTURE',
          'LEGITIMATELY_DISTINCT',
          'AMBIGUOUS',
        ]),
        canonicalCount: canonicalDepartments.length,
        duplicateCanonicalNames: duplicateCanonicalNames.length,
        mutationPlan: departmentMutationPlan.map(() => ({ action: 'SOFT_DEACTIVATE_PROVEN_P9_FIXTURE' })),
        referenceTotals,
        softDeactivated: departmentsSoftDeactivated,
      },
      classifierSafety,
      physicalDeletes: 0,
    };
    console.log(JSON.stringify(report, null, 2));
    if (duplicateCanonicalNames.length
      || lineClasses.includes('DATA_CONFLICT')
      || lineClasses.includes('MULTIPLE_POSSIBLE_TEMPLATES')
      || classifierSafety.uniqueApproved !== 'UNIQUE_APPROVED_TEMPLATE_NOT_LINKED'
      || classifierSafety.ambiguous !== 'MULTIPLE_POSSIBLE_TEMPLATES'
      || classifierSafety.noTemplate !== 'NO_TEMPLATE') {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
