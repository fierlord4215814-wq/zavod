import * as fs from 'node:fs';
import * as path from 'node:path';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { AssignmentKind, AssignmentRequestStatus, DepartmentScope, PermissionEffect, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { nextAuthEpoch } from '../../common/auth-token';
import {
  dataHygieneGroupLabel,
  dataHygieneReasons,
  dirtyStockReason,
  primaryDataHygieneGroup,
  type DataHygieneGroup,
  type DataHygieneReason,
} from '../../common/data-hygiene';
import { ConflictError } from '../../common/errors/conflict.exception';
import { resolveEffectivePermissions } from '../../common/effective-permissions';
import { maskPhone, normalizePhone, normalizePhoneSearchDigits } from '../../common/password';
import { dedupePilotLines, hasPilotFixtureMarker, hasRuntimeFixtureMarker, isDiagnosticFixtureActor, isPilotFixtureUser, isPilotVisibleLine, pilotDisplayName } from '../../common/pilot-visibility';
import { generateRecoveryCredential, hashRecoveryCredential, PASSWORD_RECOVERY_TTL_MINUTES, recoveryCredentialExpiresAt } from '../../common/recovery-credential';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { WsService } from '../../ws/ws.service';
import { LineService } from '../line/line.service';
import { StaffingControlPolicyService } from '../line/staffing-control-policy.service';

const CRITICAL_ADMIN_PERMISSIONS = ['admin.overview.read', 'admin.users.manage', 'admin.roles.manage'];
const ADMIN_PERMISSION_PREFIXES = ['admin.', 'users.manage', 'factory.manage', 'lines.manage', 'assignments.manage'];
const OPERATOR_ROLES: UserRole[] = [UserRole.WORKER, UserRole.CONTRACTOR, UserRole.CONTRACTOR_LEAD];
const NON_DELEGATABLE_PERMISSION_PREFIXES = ['admin.', 'users.password.', 'settings.', 'factory.manage', 'ops.audit.'];
const NON_DELEGATABLE_PERMISSION_EXACT = new Set([
  'audit.read',
  'admin.read',
  'config.read',
  'checklists.settings.read',
  'checklists.settings.manage',
  'ops.audit.full',
]);
const NON_DELEGATABLE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.MANAGEMENT, UserRole.CONTRACTOR, UserRole.CONTRACTOR_LEAD];
const DELEGATION_AUTHORITY_PERMISSION = 'admin.users.manage';
const DELEGATABLE_OPERATOR_ROLES: UserRole[] = [UserRole.WORKER];
const OPERATIONAL_DELEGATION_PERMISSIONS = ['assignments.manage', 'shift.future.manage', 'shift.current.manage', 'lines.manage'];

type AdminDb = Prisma.TransactionClient | PrismaService['db'];

type UserFilters = {
  search?: string;
  role?: UserRole;
  departmentId?: string;
  factoryId?: string;
  blocked?: string;
  hasFactoryAccess?: string;
};

type CreateFactoryBody = {
  name?: string;
  code?: string;
  description?: string;
  template?: 'EMPTY' | 'BASIC_SERVICES' | 'COPY_FACTORY_4';
};

type FactorySetupBody = {
  name?: string;
  code?: string;
  description?: string;
  isActive?: boolean;
  mode?: 'EMPTY' | 'COPY';
  sourceFactoryId?: string;
  categories?: string[] | Record<string, boolean>;
};

type FactoryConfigImportBody = {
  config?: any;
  file?: any;
  target?: {
    name?: string;
    code?: string;
    description?: string;
    isActive?: boolean;
  };
  name?: string;
  code?: string;
  description?: string;
  isActive?: boolean;
};

type LineBody = {
  factoryId?: string;
  name?: string;
  status?: 'WORK' | 'PAUSE' | 'STOP';
  isActive?: boolean;
  reason?: string;
};

type LinePositionBody = {
  name?: string;
  displayName?: string | null;
  skillCode?: string | null;
  skillFamilyKey?: string | null;
  isExtraSlot?: boolean;
  doesNotAffectShortage?: boolean;
  isFlexibleSkillGroup?: boolean;
  sortOrder?: number;
  isActive?: boolean;
  reason?: string;
};

type StaffingTemplateItemBody = {
  positionId: string;
  requiredCount?: number;
  minRequired?: number | null;
  maxRequired?: number | null;
  defaultPlanned?: number | null;
  plannedCount?: number | null;
  isFlexible?: boolean;
  isExtraSlot?: boolean;
  doesNotAffectShortage?: boolean;
  sortOrder?: number;
};

type StaffingTemplateBody = {
  name?: string;
  isActive?: boolean;
  items?: StaffingTemplateItemBody[];
  reason?: string;
};

type DepartmentBody = {
  factoryId?: string | null;
  name?: string;
  code?: string;
  scope?: 'LOCAL' | 'GLOBAL';
  isActive?: boolean;
  reason?: string;
};

type ExternalCompanyBody = {
  factoryId?: string;
  name?: string;
  isActive?: boolean;
  reason?: string;
};

type AssignmentRequestDecisionBody = {
  expectedVersion?: number;
  jobTitleId?: string | null;
  reason?: string;
  operationId?: string;
};

type WorkAreaBody = {
  factoryId?: string;
  departmentId?: string | null;
  assignmentKind?: 'TIME' | 'WORK_AREA';
  name?: string;
  description?: string | null;
  isActive?: boolean;
  reason?: string;
};

type WorkAreaPositionBody = {
  title?: string;
  minRequired?: number;
  maxRequired?: number;
  defaultPlanned?: number;
  plannedCount?: number | null;
  isFlexible?: boolean;
  isExtraSlot?: boolean;
  doesNotAffectShortage?: boolean;
  sortOrder?: number;
  isActive?: boolean;
  reason?: string;
};

type JobTitleBody = {
  factoryId?: string | null;
  departmentId?: string | null;
  parentJobTitleId?: string | null;
  name?: string;
  code?: string;
  baseRole?: UserRole;
  permissionPreset?: string | null;
  description?: string | null;
  shiftDurationHours?: number;
  isActive?: boolean;
  reason?: string;
};

type PermissionCopyBody = {
  factoryId?: string;
  sourceUserId?: string;
  reason?: string;
};

type DelegationHierarchyDecision = {
  allowed: boolean;
  checked: boolean;
  mode: 'job-title-tree' | 'fallback-no-job-title' | 'legacy-role' | 'denied';
  reason: string | null;
  actorJobTitleId?: string | null;
  candidateJobTitleId?: string | null;
};

const SHARED_SERVICE_DEPARTMENTS = [
  { name: 'Механики', code: 'mechanics' },
  { name: 'КИПиА', code: 'kipia' },
  { name: 'Холодильная служба', code: 'holod' },
  { name: 'Электрики', code: 'electric' },
  { name: 'Сантехники', code: 'santechnik' },
  { name: 'Технологи', code: 'technolog' },
  { name: 'Другие службы', code: 'service-other' },
];

const FACTORY_SETUP_CATEGORIES = [
  { key: 'localDepartments', label: 'Локальные отделы', description: 'Отделы, которые принадлежат выбранному заводу.' },
  { key: 'globalServices', label: 'Общие службы', description: 'Проверить и подключить общие службы без выдачи доступа людям.' },
  { key: 'lines', label: 'Линии', description: 'Производственные линии нового завода.' },
  { key: 'linePositions', label: 'Позиции линий', description: 'Рабочие места и коды навыков внутри линий.' },
  { key: 'staffingTemplates', label: 'Шаблоны состава', description: 'Плановые составы линий с привязкой к скопированным позициям.' },
  { key: 'workAreas', label: 'Рабочие зоны', description: 'Повременщики и отдельные рабочие зоны.' },
  { key: 'workAreaPositions', label: 'Позиции рабочих зон', description: 'Слоты внутри рабочих зон.' },
  { key: 'jobTitles', label: 'Основа должностей', description: 'Должности и базовые наборы прав без копирования людей.' },
  { key: 'moduleSettings', label: 'Настройки модулей', description: 'Настройки смен, заявок, мойки, оттайки, заказов, чек-листов, чатов и объявлений.' },
];

const FACTORY_SETUP_CATEGORY_KEYS = FACTORY_SETUP_CATEGORIES.map((category) => category.key);
const FACTORY_CONFIG_SCHEMA_VERSION = 'factory-config-v1';
const RECOVERY_WINDOW_DAYS = 30;
const RECOVERY_TYPES = ['factory', 'department', 'job-title', 'line', 'line-position', 'staffing-template', 'work-area', 'work-area-position', 'factory-access'] as const;
type RecoveryType = typeof RECOVERY_TYPES[number];
const SETTINGS_MODELS = [
  'shiftSettings',
  'taskSettings',
  'washSettings',
  'defrostSettings',
  'orderSettings',
  'checklistSettings',
  'chatSettings',
  'announcementSettings',
];

const FORBIDDEN_FACTORY_CONFIG_KEYS = new Set([
  'users',
  'userFactoryAccess',
  'factoryAccess',
  'shiftSessions',
  'assignments',
  'plannedLineAssignments',
  'shiftWillBe',
  'lineShiftWorkPlans',
  'lineEvents',
  'tasks',
  'taskHistory',
  'taskComments',
  'washSessions',
  'washEvents',
  'okkRecords',
  'returnRecords',
  'stockDefects',
  'minimumStockMovements',
  'orderRequests',
  'chats',
  'chatMessages',
  'chatReads',
  'attachments',
  'announcements',
  'announcementReads',
  'audit',
  'auditLogs',
  'notifications',
  'sessions',
  'passwordHash',
  'storagePath',
  'tokens',
  'accessToken',
  'refreshToken',
  'secret',
]);

const SETTING_ALLOWED_KEYS: Record<string, string[]> = {
  shiftSettings: [
    'dayShiftStartTime',
    'dayShiftEndTime',
    'nightShiftStartTime',
    'nightShiftEndTime',
    'willBeOpenHoursBeforeShift',
    'noShowCheckMinutesAfterShiftStart',
    'minAssignmentMoveIntervalMinutes',
    'contractorLeadMaxPeoplePerShift',
    'returnRequestEnabled',
    'autoCloseChecklistsAtShiftEnd',
    'sendHomeRequiresComment',
    'willBeCancelRequiresComment',
  ],
  taskSettings: [
    'longTaskDefaultDeadlineHours',
    'longTaskEscalationEnabled',
    'longTaskEscalationGraceMinutes',
    'urgentTaskRequiresLineWhenCreatedFromLine',
    'taskRedirectRequiresComment',
    'taskDoneRequiresComment',
    'taskReadReceiptsEnabled',
    'taskAttachmentsEnabled',
    'taskDepartmentRecipientsEnabled',
    'taskPersonalAssigneeEnabled',
    'taskChatMirrorEnabledReserved',
    'taskStorageRetentionMode',
  ],
  washSettings: [
    'washIssueRequiresPhoto',
    'washIssueResolveRequiresPhoto',
    'washCompleteRequiresOkkReview',
    'washCompleteRequiresNoOpenIssues',
    'washMiniTasksEnabled',
    'washControlEnabled',
    'washOkkReviewEnabled',
    'washDefaultControlItems',
    'washAllowNonLineWorkers',
    'washMessagesEnabled',
    'washAttachmentsEnabled',
  ],
  defrostSettings: [
    'defrostCommentRequiredOnStart',
    'defrostCommentRequiredOnEnd',
    'defrostShowOnLineDashboard',
    'defrostCalendarEnabled',
    'defrostAttachmentsEnabled',
  ],
  orderSettings: [
    'lowStockNotificationsEnabled',
    'orderRequestNotificationsEnabled',
    'restockRequiresComment',
    'takeRequiresComment',
    'archiveRequiresComment',
    'defaultUnit',
    'warningYellowPercent',
    'warningRedPercent',
  ],
  checklistSettings: [
    'autoCloseAtDayShiftEnd',
    'autoCloseAtNightShiftEnd',
    'requirePauseComment',
    'allowEditAfterCloseHours',
    'checklistAttachmentsEnabled',
    'archiveEnabled',
  ],
  chatSettings: [
    'chatEnabled',
    'attachmentsEnabled',
    'editWindowMinutes',
    'deleteWindowMinutes',
    'retentionMonths',
    'voiceReserved',
    'videoReserved',
  ],
  announcementSettings: [
    'defaultVisibleDays',
    'archiveRetentionDays',
    'attachmentsEnabled',
    'guestCanRead',
    'importantBadgeEnabled',
  ],
};

const ADMIN_SETTING_LABELS: Record<string, string> = {
  dayShiftStartTime: 'Начало дневной смены',
  dayShiftEndTime: 'Конец дневной смены',
  nightShiftStartTime: 'Начало ночной смены',
  nightShiftEndTime: 'Конец ночной смены',
  willBeOpenHoursBeforeShift: 'Окно “Я буду”, часов',
  noShowCheckMinutesAfterShiftStart: 'Проверка неявки, минут',
  minAssignmentMoveIntervalMinutes: 'Пауза между переносами',
  contractorLeadMaxPeoplePerShift: 'Лимит бригадира',
  returnRequestEnabled: 'Возврат на смену',
  autoCloseChecklistsAtShiftEnd: 'Автозакрытие чек-листов',
  sendHomeRequiresComment: 'Комментарий при отправке домой',
  willBeCancelRequiresComment: 'Комментарий при отмене “Я буду”',
  longTaskDefaultDeadlineHours: 'Срок длинной заявки, часов',
  longTaskEscalationEnabled: 'Эскалация длинных заявок',
  longTaskEscalationGraceMinutes: 'Льготное время эскалации, минут',
  urgentTaskRequiresLineWhenCreatedFromLine: 'Линия обязательна из простоя',
  taskRedirectRequiresComment: 'Комментарий при передаче',
  taskDoneRequiresComment: 'Комментарий при закрытии',
  taskReadReceiptsEnabled: 'Отметки чтения заявок',
  taskAttachmentsEnabled: 'Вложения в заявках',
  taskDepartmentRecipientsEnabled: 'Адресация заявок отделам',
  taskPersonalAssigneeEnabled: 'Персональный исполнитель заявки',
  taskChatMirrorEnabledReserved: 'Резерв зеркала заявки в чат',
  taskStorageRetentionMode: 'Хранение заявок',
  washIssueRequiresPhoto: 'Фото для проблемы мойки',
  washIssueResolveRequiresPhoto: 'Фото при закрытии проблемы мойки',
  washCompleteRequiresOkkReview: 'ОКК перед завершением мойки',
  washCompleteRequiresNoOpenIssues: 'Завершение мойки без открытых проблем',
  washMiniTasksEnabled: 'Мини-задачи мойки',
  washControlEnabled: 'Контроль мойки',
  washOkkReviewEnabled: 'ОКК-проверка мойки',
  washDefaultControlItems: 'Типовые пункты контроля мойки',
  washAllowNonLineWorkers: 'Мойка вне работников линии',
  washMessagesEnabled: 'Сообщения по мойке',
  washAttachmentsEnabled: 'Вложения в мойке',
  defrostCommentRequiredOnStart: 'Комментарий при запуске оттайки',
  defrostCommentRequiredOnEnd: 'Комментарий при завершении оттайки',
  defrostShowOnLineDashboard: 'Оттайка на экране линии',
  defrostCalendarEnabled: 'Календарь оттайки',
  defrostAttachmentsEnabled: 'Вложения в оттайке',
  lowStockNotificationsEnabled: 'Уведомления о низком остатке',
  orderRequestNotificationsEnabled: 'Уведомления о заявках на заказ',
  restockRequiresComment: 'Комментарий при пополнении',
  takeRequiresComment: 'Комментарий при списании',
  archiveRequiresComment: 'Комментарий при архивировании',
  defaultUnit: 'Единица по умолчанию',
  warningYellowPercent: 'Жёлтый порог, %',
  warningRedPercent: 'Красный порог, %',
  autoCloseAtDayShiftEnd: 'Автозакрытие в конце дневной смены',
  autoCloseAtNightShiftEnd: 'Автозакрытие в конце ночной смены',
  requirePauseComment: 'Комментарий при паузе чек-листа',
  allowEditAfterCloseHours: 'Редактирование после закрытия, часов',
  checklistAttachmentsEnabled: 'Вложения в чек-листах',
  archiveEnabled: 'Архив чек-листов',
  chatEnabled: 'Чаты включены',
  attachmentsEnabled: 'Вложения включены',
  editWindowMinutes: 'Окно редактирования, минут',
  deleteWindowMinutes: 'Окно удаления, минут',
  retentionMonths: 'Срок хранения, месяцев',
  voiceReserved: 'Резерв голосовых сообщений',
  videoReserved: 'Резерв видео',
  defaultVisibleDays: 'Срок показа по умолчанию, дней',
  archiveRetentionDays: 'Срок хранения архива, дней',
  guestCanRead: 'Гости читают объявления',
  importantBadgeEnabled: 'Метка важных объявлений',
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly wsService: WsService,
    private readonly lineService: LineService,
    private readonly staffingControlPolicy: StaffingControlPolicyService,
  ) {}

  async overview(user: UserContext) {
    this.assertAdmin(user);
    const factoryId = user.selectedFactoryId;
    const [
      factories,
      activeAccesses,
      usersWithoutAccess,
      departments,
      lines,
      permissionsCount,
      rolesWithPermissions,
    ] = await Promise.all([
      this.prisma.db.factory.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, name: true, isActive: true },
      }),
      this.prisma.db.userFactoryAccess.findMany({
        where: { factoryId, isActive: true, user: { deletedAt: null } },
        include: { user: { select: { id: true, blockedAt: true, deletedAt: true } } },
      }),
      this.prisma.db.user.findMany({
        where: { deletedAt: null, factoryAccess: { none: { isActive: true } } },
        select: { id: true },
      }),
      this.prisma.db.department.findMany({
        where: { deletedAt: null, isActive: true, OR: [{ factoryId }, { scope: 'GLOBAL' }] },
        include: {
          userAccess: {
            where: { isActive: true, role: { in: [UserRole.MANAGEMENT, UserRole.ADMIN] } },
            include: { user: { select: { id: true } } },
          },
        },
      }),
      this.prisma.db.line.findMany({
        where: { factoryId, deletedAt: null, deactivatedAt: null },
        include: {
          positions: { where: { isActive: true, deletedAt: null }, select: { id: true } },
          staffingTemplates: { where: { isActive: true, deletedAt: null }, select: { id: true } },
        },
      }),
      this.prisma.db.permission.count(),
      this.prisma.db.rolePermission.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } }),
    ]);

    const visibleFactories = factories.filter((factory) => !hasRuntimeFixtureMarker(factory.id, factory.code, factory.name));
    const visibleAccesses = activeAccesses.filter((access) => (
      !isDiagnosticFixtureActor(access.user.id) && !hasPilotFixtureMarker(access.user.id)
    ));
    const visibleUsers = new Set(visibleAccesses.map((access) => access.userId));
    const visibleDepartments = departments.filter((department) => !hasRuntimeFixtureMarker(department.id, department.code, department.name));
    const visibleLines = dedupePilotLines(lines.filter((line) => isPilotVisibleLine(line)));
    const factoriesCount = visibleFactories.length;
    const activeFactories = visibleFactories.filter((factory) => factory.isActive).length;
    const usersCount = visibleUsers.size;
    const blockedUsersCount = visibleAccesses.filter((access) => Boolean(access.user.blockedAt)).length;
    const departmentsCount = visibleDepartments.length;
    const linesCount = visibleLines.length;
    const positionsCount = visibleLines.reduce((sum, line) => sum + line.positions.length, 0);
    const templatesCount = visibleLines.reduce((sum, line) => sum + line.staffingTemplates.length, 0);
    const activeUserAccessCount = visibleAccesses.length;
    const usersWithoutFactoryAccess = usersWithoutAccess.filter((item) => (
      !isDiagnosticFixtureActor(item.id) && !hasPilotFixtureMarker(item.id)
    )).length;
    const usersWithoutDepartment = visibleAccesses.filter((access) => !access.isGuest && !access.departmentId).length;
    const linesWithoutActivePositions = visibleLines.filter((line) => line.positions.length === 0).length;
    const linesWithoutTemplates = visibleLines.filter((line) => line.staffingTemplates.length === 0).length;
    const rolesWithoutPermissions = Object.values(UserRole).filter(
      (role) => !rolesWithPermissions.some((item) => item.role === role && item._count._all > 0),
    );
    const departmentsWithoutManagementUsers = visibleDepartments.filter((department) => (
      department.userAccess.filter((access) => !isDiagnosticFixtureActor(access.user.id)).length === 0
    ));

    return {
      factoriesCount,
      activeFactories,
      usersCount,
      blockedUsersCount,
      departmentsCount,
      rolesCount: Object.keys(UserRole).length,
      permissionsCount,
      linesCount,
      positionsCount,
      staffingTemplatesCount: templatesCount,
      activeLinesCount: linesCount,
      activeUserAccessCount,
      selectedFactoryId: factoryId,
      warnings: {
        usersWithoutFactoryAccess,
        usersWithoutDepartment,
        linesWithoutActivePositions,
        linesWithoutStaffingTemplates: linesWithoutTemplates,
        rolesWithoutPermissions,
        departmentsWithoutManagementUsers: departmentsWithoutManagementUsers.map((department) => ({
          id: department.id,
          name: department.name,
          scope: department.scope,
          factoryId: department.factoryId,
        })),
      },
    };
  }

  async users(user: UserContext, filters: UserFilters = {}) {
    const factoryId = filters.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const manageableFactoryIds = filters.hasFactoryAccess === 'false'
      ? (await this.prisma.db.userFactoryAccess.findMany({
          where: {
            userId: user.userId,
            role: UserRole.ADMIN,
            isActive: true,
            factory: { isActive: true, deletedAt: null },
          },
          select: { factoryId: true },
        })).map((access) => access.factoryId)
      : [];
    const blockedFilter = filters.blocked === 'true'
      ? { blockedAt: { not: null } }
      : filters.blocked === 'false'
        ? { blockedAt: null }
        : {};

    const accessWhere: Prisma.UserFactoryAccessWhereInput = {
      ...(filters.hasFactoryAccess === 'false' ? {} : { factoryId }),
      ...(filters.hasFactoryAccess === 'false' ? {} : { isActive: true }),
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    };
    const searchTerms = String(filters.search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    const searchWhere: Prisma.UserWhereInput = searchTerms.length
      ? {
          AND: searchTerms.map((term) => {
            const digits = normalizePhoneSearchDigits(term);
            return {
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { firstName: { contains: term, mode: 'insensitive' } },
                { middleName: { contains: term, mode: 'insensitive' } },
                ...(digits.length >= 3
                  ? [
                      { normalizedPhone: { contains: digits, mode: 'insensitive' as const } },
                      { phone: { contains: digits, mode: 'insensitive' as const } },
                    ]
                  : []),
              ],
            };
          }),
        }
      : {};

    const users = await this.prisma.db.user.findMany({
      where: {
        deletedAt: null,
        ...blockedFilter,
        ...(filters.hasFactoryAccess === 'false'
          ? {
              AND: [
                searchWhere,
                { factoryAccess: { none: { factoryId, isActive: true } } },
                {
                  factoryAccess: {
                    some: {
                      factoryId: { in: manageableFactoryIds },
                      isActive: true,
                      factory: { isActive: true, deletedAt: null },
                    },
                  },
                },
              ],
            }
          : { ...searchWhere, factoryAccess: { some: accessWhere } }),
      },
      include: {
        factoryAccess: {
          where: { factoryId },
          include: { factory: true, department: true, jobTitle: true, company: true },
          orderBy: { createdAt: 'asc' },
        },
        permissionOverrides: { where: { factoryId } },
      },
      orderBy: [{ role: 'asc' }, { id: 'asc' }],
    });

    return users.filter((target) => !isPilotFixtureUser(target)).map((target) => {
      const selectedAccess = target.factoryAccess.find((access) => access.factoryId === factoryId) ?? null;
      return {
        id: target.id,
        displayName: pilotDisplayName(target),
        lastName: target.lastName,
        firstName: target.firstName,
        middleName: target.middleName,
        globalRole: target.role,
        employeeState: target.employeeState,
        blockedAt: target.blockedAt,
        deletedAt: target.deletedAt,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
        overridesCount: target.permissionOverrides.length,
        selectedFactoryAccess: selectedAccess ? this.serializeAccess(selectedAccess) : null,
        factoryAccesses: target.factoryAccess.map((access) => this.serializeAccess(access)),
      };
    });
  }

  async assignmentRequests(user: UserContext, status?: string, factoryId?: string) {
    this.assertAssignmentRequestReviewer(user);
    const targetFactoryId = factoryId?.trim() || user.selectedFactoryId;
    if (targetFactoryId !== user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Заявки другого завода недоступны.' });
    }
    const requestedStatus = Object.values(AssignmentRequestStatus).includes(status as AssignmentRequestStatus)
      ? status as AssignmentRequestStatus
      : AssignmentRequestStatus.PENDING;
    const actorAccess = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId: targetFactoryId } },
    });
    const requests = await this.prisma.db.assignmentRequest.findMany({
      where: { factoryId: targetFactoryId, status: requestedStatus },
      include: { requestedBy: true, department: true, company: true, decidedBy: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return requests
      .filter((request) => this.canReviewAssignmentRequest(user, actorAccess, request))
      .map((request) => this.serializeAssignmentRequest(request));
  }

  async acceptAssignmentRequest(user: UserContext, requestId: string, body: AssignmentRequestDecisionBody = {}) {
    this.assertAssignmentRequestReviewer(user);
    const request = await this.prisma.db.assignmentRequest.findUnique({
      where: { id: requestId },
      include: { requestedBy: true, department: true, company: true },
    });
    if (!request || request.factoryId !== user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Заявка недоступна в выбранном заводе.' });
    }
    if (request.status === AssignmentRequestStatus.ACCEPTED) {
      return { ok: true, idempotent: true, request: this.serializeAssignmentRequest(request) };
    }
    if (request.status !== AssignmentRequestStatus.PENDING) {
      throw new ConflictError('Заявка уже рассмотрена другим пользователем.');
    }
    const actorAccess = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId: user.selectedFactoryId } },
    });
    if (!this.canReviewAssignmentRequest(user, actorAccess, request)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Эту заявку должен рассмотреть руководитель выбранного подразделения или фирмы.' });
    }
    const expectedVersion = Number(body.expectedVersion ?? request.version);
    const reason = String(body.reason ?? '').trim() || 'Назначение по заявке гостя';

    const result = await this.prisma.db.$transaction(async (tx) => {
      const targetAccess = await tx.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId: request.requestedById, factoryId: request.factoryId } },
        include: { user: true },
      });
      if (!targetAccess || !targetAccess.isActive || !targetAccess.isGuest || targetAccess.user.blockedAt || targetAccess.user.deletedAt) {
        throw new ConflictError('Гостевой доступ пользователя уже изменён или недоступен.');
      }
      const jobTitleId = body.jobTitleId?.trim() || null;
      await this.assertJobTitleScopeTx(tx, jobTitleId, request.factoryId, request.departmentId);
      await this.assertAccessOrganizationContextTx(
        tx,
        request.requestedRole,
        request.departmentId,
        request.companyId,
        request.factoryId,
      );
      const claimed = await tx.assignmentRequest.updateMany({
        where: { id: request.id, status: AssignmentRequestStatus.PENDING, version: expectedVersion },
        data: {
          status: AssignmentRequestStatus.ACCEPTED,
          activeKey: null,
          version: { increment: 1 },
          decidedAt: new Date(),
          decidedById: user.userId,
          decisionReason: reason,
        },
      });
      if (claimed.count !== 1) throw new ConflictError('Заявка уже рассмотрена или была обновлена. Обновите список.');

      const nextDepartmentId = request.requestedRole === UserRole.CONTRACTOR ? null : request.departmentId;
      const nextCompanyId = request.requestedRole === UserRole.CONTRACTOR ? request.companyId : null;
      const access = await tx.userFactoryAccess.update({
        where: { userId_factoryId: { userId: request.requestedById, factoryId: request.factoryId } },
        data: {
          role: request.requestedRole,
          departmentId: nextDepartmentId,
          jobTitleId,
          companyId: nextCompanyId,
          isGuest: false,
          isActive: true,
        },
        include: { factory: true, department: true, jobTitle: true, company: true },
      });
      await tx.user.update({ where: { id: request.requestedById }, data: { role: request.requestedRole } });
      const snapshot = {
        role: request.requestedRole,
        departmentId: nextDepartmentId,
        departmentName: access.department?.name ?? null,
        jobTitleId,
        jobTitleName: access.jobTitle?.name ?? null,
        companyId: nextCompanyId,
        companyName: access.company?.name ?? null,
      };
      const decided = await tx.assignmentRequest.update({
        where: { id: request.id },
        data: { decisionSnapshot: snapshot },
        include: { requestedBy: true, department: true, company: true, decidedBy: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: request.factoryId,
        action: 'ASSIGNMENT_REQUEST_ACCEPTED',
        entityType: 'AssignmentRequest',
        entityId: request.id,
        details: { targetUserId: request.requestedById, ...snapshot, reason },
      });
      return { decided, access };
    });
    this.wsService.notifyAuthChanged(request.requestedById, request.factoryId);
    return { ok: true, idempotent: false, request: this.serializeAssignmentRequest(result.decided), access: this.serializeAccess(result.access) };
  }

  async rejectAssignmentRequest(user: UserContext, requestId: string, body: AssignmentRequestDecisionBody = {}) {
    this.assertAssignmentRequestReviewer(user);
    const reason = String(body.reason ?? '').trim();
    if (!reason) throw new ConflictError('Укажите причину отклонения заявки.');
    const request = await this.prisma.db.assignmentRequest.findUnique({
      where: { id: requestId },
      include: { requestedBy: true, department: true, company: true },
    });
    if (!request || request.factoryId !== user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Заявка недоступна в выбранном заводе.' });
    }
    if (request.status === AssignmentRequestStatus.REJECTED) {
      return { ok: true, idempotent: true, request: this.serializeAssignmentRequest(request) };
    }
    if (request.status !== AssignmentRequestStatus.PENDING) throw new ConflictError('Заявка уже рассмотрена.');
    const actorAccess = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId: user.selectedFactoryId } },
    });
    if (!this.canReviewAssignmentRequest(user, actorAccess, request)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет права рассматривать эту заявку.' });
    }
    const expectedVersion = Number(body.expectedVersion ?? request.version);
    const decided = await this.prisma.db.$transaction(async (tx) => {
      const claimed = await tx.assignmentRequest.updateMany({
        where: { id: request.id, status: AssignmentRequestStatus.PENDING, version: expectedVersion },
        data: {
          status: AssignmentRequestStatus.REJECTED,
          activeKey: null,
          version: { increment: 1 },
          decidedAt: new Date(),
          decidedById: user.userId,
          decisionReason: reason,
        },
      });
      if (claimed.count !== 1) throw new ConflictError('Заявка уже рассмотрена или была обновлена. Обновите список.');
      const row = await tx.assignmentRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: { requestedBy: true, department: true, company: true, decidedBy: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: request.factoryId,
        action: 'ASSIGNMENT_REQUEST_REJECTED',
        entityType: 'AssignmentRequest',
        entityId: request.id,
        details: { targetUserId: request.requestedById, requestedRole: request.requestedRole, reason },
      });
      return row;
    });
    return { ok: true, idempotent: false, request: this.serializeAssignmentRequest(decided) };
  }

  async mediaOverview(user: UserContext) {
    this.assertAdmin(user);
    const factoryId = user.selectedFactoryId;
    const [attachmentsCount, deletedAttachmentsCount, size, byEntityType, byKind, largeFilesCount] = await Promise.all([
      this.prisma.db.attachment.count({ where: { factoryId, deletedAt: null } }),
      this.prisma.db.attachment.count({ where: { factoryId, deletedAt: { not: null } } }),
      this.prisma.db.attachment.aggregate({ where: { factoryId, deletedAt: null }, _sum: { sizeBytes: true } }),
      this.prisma.db.attachment.groupBy({ by: ['entityType'], where: { factoryId, deletedAt: null }, _count: { _all: true } }),
      this.prisma.db.attachment.groupBy({ by: ['kind'], where: { factoryId, deletedAt: null }, _count: { _all: true } }),
      this.prisma.db.attachment.count({ where: { factoryId, deletedAt: null, sizeBytes: { gt: 10 * 1024 * 1024 } } }),
    ]);
    return {
      attachmentsCount,
      deletedAttachmentsCount,
      totalSizeBytes: size._sum.sizeBytes ?? 0,
      byEntityType: byEntityType.map((item) => ({ entityType: item.entityType, count: item._count._all })),
      byKind: byKind.map((item) => ({ kind: item.kind, count: item._count._all })),
      localStorageConfigured: true,
      warnings: [
        'Используется локальное хранилище разработки.',
        'Политика промышленного хранилища ещё не настроена.',
        ...(largeFilesCount ? [`Крупные файлы в этом заводе: ${largeFilesCount}`] : []),
      ],
    };
  }

  async shiftSettings(user: UserContext) {
    this.assertAdmin(user);
    return this.ensureShiftSettings(user.selectedFactoryId);
  }

  async taskSettings(user: UserContext) {
    this.assertAdmin(user);
    return this.ensureTaskSettings(user.selectedFactoryId);
  }

  async washSettings(user: UserContext) {
    this.assertAdmin(user);
    return this.ensureWashSettings(user.selectedFactoryId);
  }

  async defrostSettings(user: UserContext) {
    this.assertAdmin(user);
    return this.ensureDefrostSettings(user.selectedFactoryId);
  }

  async previewTaskSettings(user: UserContext, body: any) {
    this.assertAdmin(user);
    const current = await this.ensureTaskSettings(user.selectedFactoryId);
    const nextValue = this.normalizeTaskSettingsInput(current, body);
    const warnings = [
      ...(nextValue.longTaskEscalationEnabled === false ? ['Эскалация просроченных длинных заявок будет отключена.'] : []),
      ...(nextValue.taskRedirectRequiresComment === false ? ['Передача без комментария снижает прослеживаемость заявки.'] : []),
      ...(nextValue.taskReadReceiptsEnabled === false ? ['Отметки чтения заявок будут отключены.'] : []),
      ...(nextValue.taskAttachmentsEnabled === false ? ['Вложения заявок должны быть отключены в интерфейсе.'] : []),
    ];
    const allowed = nextValue.longTaskEscalationGraceMinutes >= 0;
    return {
      factoryId: user.selectedFactoryId,
      oldValue: this.cleanTaskSettings(current),
      nextValue,
      warnings,
      allowed,
      reason: allowed ? null : 'В настройках заявок есть недопустимые числовые пределы.',
    };
  }

  async updateTaskSettings(user: UserContext, body: any) {
    this.assertAdmin(user);
    const preview = await this.previewTaskSettings(user, body);
    if (!preview.allowed) throw new ConflictError(preview.reason ?? 'task settings update is not allowed');
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.taskSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('task settings not found');
      const updated = await tx.taskSettings.update({ where: { factoryId: user.selectedFactoryId }, data: preview.nextValue });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'TASK_SETTINGS_UPDATED',
        entityType: 'TaskSettings',
        entityId: updated.id,
        details: {
          oldValue: this.cleanTaskSettings(current),
          newValue: this.cleanTaskSettings(updated),
          warnings: preview.warnings,
          reason: body.reason ?? null,
        },
      });
      return updated;
    });
  }

  async previewWashSettings(user: UserContext, body: any) {
    this.assertAdmin(user);
    const current = await this.ensureWashSettings(user.selectedFactoryId);
    const nextValue = this.normalizeWashSettingsInput(current, body);
    const warnings = [
      ...(nextValue.washCompleteRequiresNoOpenIssues === false ? ['Wash can be completed with open issues. This weakens process control.'] : []),
      ...(nextValue.washCompleteRequiresOkkReview === true ? ['Wash completion will require approved OKK review.'] : []),
      ...(nextValue.washAttachmentsEnabled === false ? ['Wash attachment UI should be disabled when this is off.'] : []),
      ...(nextValue.washControlEnabled === false ? ['Wash control items will be disabled.'] : []),
    ];
    return {
      factoryId: user.selectedFactoryId,
      oldValue: this.cleanWashSettings(current),
      nextValue,
      warnings,
      allowed: true,
      reason: null,
    };
  }

  async updateWashSettings(user: UserContext, body: any) {
    this.assertAdmin(user);
    const preview = await this.previewWashSettings(user, body);
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.washSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('wash settings not found');
      const updated = await tx.washSettings.update({ where: { factoryId: user.selectedFactoryId }, data: preview.nextValue });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'WASH_SETTINGS_UPDATED',
        entityType: 'WashSettings',
        entityId: updated.id,
        details: {
          oldValue: this.cleanWashSettings(current),
          newValue: this.cleanWashSettings(updated),
          warnings: preview.warnings,
          reason: body.reason ?? null,
        },
      });
      return updated;
    });
  }

  async previewDefrostSettings(user: UserContext, body: any) {
    this.assertAdmin(user);
    const current = await this.ensureDefrostSettings(user.selectedFactoryId);
    const nextValue = this.normalizeDefrostSettingsInput(current, body);
    const warnings = [
      ...(nextValue.defrostCommentRequiredOnStart === false ? ['Defrost can be started without comment.'] : []),
      ...(nextValue.defrostCommentRequiredOnEnd === false ? ['Defrost can be completed without comment.'] : []),
      ...(nextValue.defrostShowOnLineDashboard === false ? ['Line dashboard defrost indicator will be hidden.'] : []),
      ...(nextValue.defrostCalendarEnabled === false ? ['Defrost calendar view should be hidden when this is off.'] : []),
    ];
    return {
      factoryId: user.selectedFactoryId,
      oldValue: this.cleanDefrostSettings(current),
      nextValue,
      warnings,
      allowed: true,
      reason: null,
    };
  }

  async updateDefrostSettings(user: UserContext, body: any) {
    this.assertAdmin(user);
    const preview = await this.previewDefrostSettings(user, body);
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.defrostSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('defrost settings not found');
      const updated = await tx.defrostSettings.update({ where: { factoryId: user.selectedFactoryId }, data: preview.nextValue });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'DEFROST_SETTINGS_UPDATED',
        entityType: 'DefrostSettings',
        entityId: updated.id,
        details: {
          oldValue: this.cleanDefrostSettings(current),
          newValue: this.cleanDefrostSettings(updated),
          warnings: preview.warnings,
          reason: body.reason ?? null,
        },
      });
      return updated;
    });
  }

  async previewShiftSettings(user: UserContext, body: any) {
    this.assertAdmin(user);
    const current = await this.ensureShiftSettings(user.selectedFactoryId);
    const nextValue = this.normalizeShiftSettingsInput(current, body);
    const warnings = [
      ...(nextValue.minAssignmentMoveIntervalMinutes < 5 ? ['Minimum move interval below 5 minutes weakens shift discipline.'] : []),
      ...(nextValue.contractorLeadMaxPeoplePerShift > 6 ? ['Contractor lead max above 6 should be a conscious factory-level decision.'] : []),
      ...(nextValue.returnRequestEnabled === false ? ['Return-to-shift requests will be disabled for workers and contractors.'] : []),
      ...(nextValue.sendHomeRequiresComment === false ? ['Send-home without comment reduces audit quality.'] : []),
    ];
    return {
      factoryId: user.selectedFactoryId,
      oldValue: this.cleanShiftSettings(current),
      nextValue,
      warnings,
      allowed: nextValue.minAssignmentMoveIntervalMinutes >= 1 && nextValue.contractorLeadMaxPeoplePerShift >= 1,
      reason: nextValue.minAssignmentMoveIntervalMinutes < 1 || nextValue.contractorLeadMaxPeoplePerShift < 1
        ? 'Shift settings contain invalid numeric limits.'
        : null,
    };
  }

  async updateShiftSettings(user: UserContext, body: any) {
    this.assertAdmin(user);
    const preview = await this.previewShiftSettings(user, body);
    if (!preview.allowed) throw new ConflictError(preview.reason ?? 'shift settings update is not allowed');
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.shiftSettings.findUnique({ where: { factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('shift settings not found');
      const updated = await tx.shiftSettings.update({
        where: { factoryId: user.selectedFactoryId },
        data: preview.nextValue,
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'SHIFT_SETTINGS_UPDATED',
        entityType: 'ShiftSettings',
        entityId: updated.id,
        details: {
          oldValue: this.cleanShiftSettings(current),
          newValue: this.cleanShiftSettings(updated),
          warnings: preview.warnings,
          reason: body.reason ?? null,
        },
      });
      return updated;
    });
  }

  async userProfile(user: UserContext, userId: string) {
    this.assertAdmin(user);
    const manageableFactoryIds = (await this.prisma.db.userFactoryAccess.findMany({
      where: {
        userId: user.userId,
        role: UserRole.ADMIN,
        isActive: true,
        factory: { isActive: true, deletedAt: null },
      },
      select: { factoryId: true },
    })).map((access) => access.factoryId);
    const target = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: {
        factoryAccess: {
          where: { factoryId: { in: manageableFactoryIds } },
          include: { factory: true, department: true, jobTitle: true, company: true },
          orderBy: { createdAt: 'asc' },
        },
        permissionOverrides: {
          where: { factoryId: user.selectedFactoryId },
          include: { permission: true },
          orderBy: { createdAt: 'desc' },
        },
        assignments: {
          where: { factoryId: user.selectedFactoryId, endedAt: null },
          include: { line: true, position: true, staffingTemplate: true },
          take: 1,
        },
        audits: {
          where: { factoryId: user.selectedFactoryId },
          orderBy: { createdAt: 'desc' },
          take: 8,
        },
      },
    });

    if (!target || !target.factoryAccess.some((access) => access.factoryId === user.selectedFactoryId)) return null;

    const selectedAccess = target.factoryAccess.find((access) => access.factoryId === user.selectedFactoryId) ?? null;
    const isLastAdmin = selectedAccess?.role === UserRole.ADMIN
      ? await this.isLastAdmin(userId, user.selectedFactoryId)
      : false;
    const permissionsSummary = selectedAccess
      ? await this.effectivePermissionCodes(target.id, user.selectedFactoryId, selectedAccess.role)
      : [];

    return {
      id: target.id,
      displayName: pilotDisplayName(target),
      lastName: target.lastName,
      firstName: target.firstName,
      middleName: target.middleName,
      globalRole: target.role,
      employeeState: target.employeeState,
      blockedAt: target.blockedAt,
      deletedAt: target.deletedAt,
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
      selectedFactoryAccess: selectedAccess ? this.serializeAccess(selectedAccess) : null,
      factoryAccesses: target.factoryAccess.map((access) => this.serializeAccess(access)),
      permissionsSummary,
      safety: {
        isLastAdmin,
        canBlock: !isLastAdmin,
        canChangeRole: !isLastAdmin,
        warnings: [
          ...(isLastAdmin ? ['Это последний активный ADMIN выбранного завода.'] : []),
          ...(target.blockedAt ? ['Пользователь заблокирован и не получает рабочий контекст.'] : []),
          ...(!selectedAccess ? ['У пользователя нет доступа к выбранному заводу.'] : []),
        ],
      },
      overrides: target.permissionOverrides.map((override) => ({
        id: override.id,
        factoryId: override.factoryId,
        permissionCode: override.permissionCode,
        effect: override.effect,
      })),
      currentAssignment: target.assignments[0]
        ? {
            kind: target.assignments[0].kind,
            lineId: target.assignments[0].lineId,
            lineName: target.assignments[0].line?.name ?? null,
            positionId: target.assignments[0].positionId,
            positionName: target.assignments[0].position?.name ?? null,
            staffingTemplateId: target.assignments[0].staffingTemplateId,
            staffingTemplateName: target.assignments[0].staffingTemplate?.name ?? null,
            washSessionId: target.assignments[0].washSessionId,
            timeRoleName: target.assignments[0].timeRoleName,
            startedAt: target.assignments[0].startedAt,
          }
        : null,
      auditSummary: target.audits.map((audit) => ({
        id: audit.id,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId,
        createdAt: audit.createdAt,
      })),
    };
  }

  async updateUserIdentity(
    user: UserContext,
    userId: string,
    body: { lastName?: string; firstName?: string; middleName?: string | null },
  ) {
    if (!user.isAdmin || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Изменение ФИО доступно только администратору.' });
    }
    const normalizePart = (value: unknown, required: boolean) => {
      const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
      if (required && !normalized) throw new ConflictError('Заполните фамилию и имя сотрудника.');
      if (normalized.length > 80) throw new ConflictError('Каждая часть ФИО должна быть не длиннее 80 символов.');
      return normalized || null;
    };
    const nextIdentity = {
      lastName: normalizePart(body.lastName, true)!,
      firstName: normalizePart(body.firstName, true)!,
      middleName: normalizePart(body.middleName, false),
    };
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
          factoryAccess: { some: { factoryId: user.selectedFactoryId, isActive: true } },
        },
        select: { id: true, lastName: true, firstName: true, middleName: true },
      });
      if (!target) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Пользователь недоступен в выбранном заводе.' });
      }
      const result = await tx.user.update({
        where: { id: userId },
        data: nextIdentity,
        select: { id: true, lastName: true, firstName: true, middleName: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'USER_IDENTITY_UPDATED',
        entityType: 'User',
        entityId: userId,
        details: {
          oldValue: { lastName: target.lastName, firstName: target.firstName, middleName: target.middleName },
          newValue: nextIdentity,
        },
      });
      return result;
    });
    this.wsService.notifyAuthChanged(userId, user.selectedFactoryId);
    return { ...updated, displayName: pilotDisplayName(updated) };
  }

  async previewFactoryAccess(user: UserContext, userId: string, body: { factoryId?: string; isActive?: boolean; role?: UserRole; departmentId?: string | null; jobTitleId?: string | null; companyId?: string | null }) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const current = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId, factoryId } },
      include: { factory: true, department: true, user: true, jobTitle: true },
    });
    if (!current) throw new ConflictError('factory access not found');
    const oldAccess = this.cleanAccess(current);
    const nextAccess = {
      ...oldAccess,
      ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
      ...(body.jobTitleId !== undefined ? { jobTitleId: body.jobTitleId } : {}),
      ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
    };
    const warnings = [
      ...(current.role === UserRole.ADMIN && body.isActive === false ? ['Disabling ADMIN factory access is a critical action.'] : []),
      ...(current.isActive && body.isActive === false ? ['Пользователь потеряет рабочий доступ к этому заводу. История сохранится.'] : []),
    ];
    const blocked = current.role === UserRole.ADMIN && body.isActive === false && (await this.isLastAdmin(userId, factoryId));
    return {
      targetUserId: userId,
      factoryId,
      oldAccess,
      nextAccess,
      warnings,
      allowed: !blocked,
      reason: blocked ? 'Cannot disable access for the last active ADMIN.' : null,
    };
  }

  async previewRoleDepartment(user: UserContext, userId: string, body: { factoryId?: string; role?: UserRole; departmentId?: string | null }) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const access = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId, factoryId } },
      include: { department: true },
    });
    if (!access) throw new ConflictError('factory access not found');
    const oldValue = this.cleanAccess(access);
    const newRole = body.role ?? access.role;
    const newDepartmentId = body.departmentId !== undefined ? body.departmentId : access.departmentId;
    const nextValue = { ...oldValue, role: newRole, departmentId: newDepartmentId };
    const [currentPermissions, nextPermissions] = await Promise.all([
      this.rolePermissionCodes(access.role),
      this.rolePermissionCodes(newRole),
    ]);
    const warnings = [
      ...(newRole === UserRole.ADMIN && access.role !== UserRole.ADMIN ? ['Assigning ADMIN is a critical action and writes ADMIN_ASSIGNED audit.'] : []),
      ...(access.role === UserRole.ADMIN && newRole !== UserRole.ADMIN ? ['Removing ADMIN is a critical action.'] : []),
      ...(OPERATOR_ROLES.includes(newRole) && nextPermissions.some((code) => this.isAdminLikePermission(code)) ? ['Operator-like role should not receive management/admin permissions.'] : []),
    ];
    const blocked = access.role === UserRole.ADMIN && newRole !== UserRole.ADMIN && (await this.isLastAdmin(userId, factoryId));
    return {
      targetUserId: userId,
      factoryId,
      oldValue,
      nextValue,
      permissions: {
        current: currentPermissions,
        next: nextPermissions,
        added: nextPermissions.filter((code) => !currentPermissions.includes(code)),
        removed: currentPermissions.filter((code) => !nextPermissions.includes(code)),
      },
      warnings,
      allowed: !blocked,
      reason: blocked ? 'Cannot remove ADMIN role from the last active ADMIN.' : null,
    };
  }

  async previewBlockStatus(user: UserContext, userId: string, body: { blocked: boolean }) {
    this.assertAdmin(user);
    const target = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: { factoryAccess: { where: { isActive: true } } },
    });
    if (!target || !target.factoryAccess.some((access) => access.factoryId === user.selectedFactoryId)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Пользователь недоступен в выбранном заводе.' });
    }
    const isAdminInSelectedFactory = target.factoryAccess.some((access) => access.factoryId === user.selectedFactoryId && access.role === UserRole.ADMIN && access.isActive);
    const actorAdminAccesses = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        userId: user.userId,
        role: UserRole.ADMIN,
        isActive: true,
        factoryId: { in: target.factoryAccess.map((access) => access.factoryId) },
      },
      select: { factoryId: true },
    });
    const actorAdminFactories = new Set(actorAdminAccesses.map((access) => access.factoryId));
    const missingFactoryAuthority = target.factoryAccess.some((access) => !actorAdminFactories.has(access.factoryId));
    const wouldRemoveLastAdmin = body.blocked && (await Promise.all(
      target.factoryAccess
        .filter((access) => access.role === UserRole.ADMIN)
        .map((access) => this.isLastAdmin(userId, access.factoryId)),
    )).some(Boolean);
    const blocked = missingFactoryAuthority || wouldRemoveLastAdmin;
    return {
      targetUserId: userId,
      oldBlockedAt: target.blockedAt,
      nextBlocked: body.blocked,
      warnings: [
        ...(body.blocked ? ['Пользователь не будет получать рабочий контекст, пока заблокирован. История сохранится.'] : ['Пользователь снова сможет получать рабочий контекст, если доступ к заводу активен.']),
        ...(isAdminInSelectedFactory ? ['У пользователя есть ADMIN-доступ в выбранном заводе.'] : []),
      ],
      allowed: !blocked,
      reason: missingFactoryAuthority
        ? 'Пользователь работает в заводе, которым вы не управляете.'
        : wouldRemoveLastAdmin
          ? 'Нельзя заблокировать последнего активного администратора завода.'
          : null,
    };
  }

  async updateFactoryAccess(user: UserContext, userId: string, body: { factoryId?: string; isActive?: boolean; role?: UserRole; departmentId?: string | null; jobTitleId?: string | null; companyId?: string | null; reason?: string }) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const current = await tx.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId, factoryId } },
        include: { user: true, jobTitle: true },
      });
      if (!current) throw new ConflictError('factory access not found');
      if (current.role === UserRole.ADMIN && body.isActive === false) await this.assertNotLastAdmin(tx, user.userId, userId, factoryId);
      if (current.isActive && body.isActive === false) this.assertRecoveryReason(body.reason);
      const nextDepartmentId = body.departmentId !== undefined ? body.departmentId : current.departmentId;
      const nextJobTitleId = body.jobTitleId !== undefined
        ? body.jobTitleId
        : (body.departmentId !== undefined && body.departmentId !== current.departmentId ? null : current.jobTitleId);
      const nextRole = body.role ?? current.role;
      const nextCompanyId = body.companyId !== undefined ? body.companyId : current.companyId;
      const changesOrganization = body.role !== undefined || body.departmentId !== undefined || body.companyId !== undefined;
      const onlyDeactivatesAccess = body.isActive === false
        && body.role === undefined
        && body.departmentId === undefined
        && body.jobTitleId === undefined
        && body.companyId === undefined;
      if (!onlyDeactivatesAccess) {
        await this.assertJobTitleScopeTx(tx, nextJobTitleId ?? null, factoryId, nextDepartmentId ?? null);
        const legacyContractorWithoutCompany = (nextRole === UserRole.CONTRACTOR || nextRole === UserRole.CONTRACTOR_LEAD) && !nextCompanyId;
        if (changesOrganization || !legacyContractorWithoutCompany) {
          await this.assertAccessOrganizationContextTx(tx, nextRole, nextDepartmentId, nextCompanyId, factoryId);
        }
      }
      const before = this.cleanAccess(current);
      const updated = await tx.userFactoryAccess.update({
        where: { userId_factoryId: { userId, factoryId } },
        data: {
          ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
          ...(body.role ? { role: body.role } : {}),
          ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
          jobTitleId: nextJobTitleId ?? null,
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
          ...(typeof body.isActive === 'boolean'
            ? (body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason))
            : {}),
        },
        include: { factory: true, department: true, jobTitle: true, company: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: body.isActive === false
          ? 'FACTORY_ACCESS_REVOKED'
          : body.isActive === true && current.isActive === false
            ? 'USER_FACTORY_ACCESS_RESTORED'
          : body.role && body.role !== current.role
            ? 'USER_FACTORY_ROLE_CHANGED'
            : 'FACTORY_ACCESS_GRANTED',
        entityType: 'UserFactoryAccess',
        entityId: updated.id,
        details: { targetId: userId, oldValue: before, newValue: this.cleanAccess(updated), reason: body.reason ?? null },
      });
      return this.serializeAccess(updated);
    });
    this.wsService.notifyAuthChanged(userId);
    return result;
  }

  async grantFactoryAccess(user: UserContext, userId: string, body: { factoryId?: string; role?: UserRole; departmentId?: string | null; jobTitleId?: string | null; companyId?: string | null; isGuest?: boolean; reason?: string }) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const role = body.role ?? UserRole.WORKER;
    const result = await this.prisma.db.$transaction(async (tx) => {
      const [target, factory] = await Promise.all([
        tx.user.findFirst({ where: { id: userId, deletedAt: null } }),
        tx.factory.findFirst({ where: { id: factoryId, deletedAt: null } }),
      ]);
      if (!target) throw new ConflictError('Пользователь не найден');
      if (!factory) throw new ConflictError('Завод не найден');
      await this.assertAccessOrganizationContextTx(tx, role, body.departmentId ?? null, body.companyId ?? null, factoryId);
      await this.assertJobTitleScopeTx(tx, body.jobTitleId ?? null, factoryId, body.departmentId ?? null);
      const updated = await tx.userFactoryAccess.upsert({
        where: { userId_factoryId: { userId, factoryId } },
        create: {
          userId,
          factoryId,
          role,
          departmentId: body.departmentId ?? null,
          jobTitleId: body.jobTitleId ?? null,
          companyId: body.companyId ?? null,
          isGuest: Boolean(body.isGuest),
          isActive: true,
        },
        update: {
          role,
          departmentId: body.departmentId ?? null,
          jobTitleId: body.jobTitleId ?? null,
          companyId: body.companyId ?? null,
          isGuest: Boolean(body.isGuest),
          isActive: true,
        },
        include: { factory: true, department: true, jobTitle: true, company: true },
      });
      await tx.user.update({ where: { id: userId }, data: { role } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: 'FACTORY_ACCESS_GRANTED',
        entityType: 'UserFactoryAccess',
        entityId: updated.id,
        details: { targetId: userId, newValue: this.cleanAccess(updated), reason: body.reason ?? null },
      });
      return this.serializeAccess(updated);
    });
    this.wsService.notifyAuthChanged(userId);
    return result;
  }

  async updateRoleDepartment(user: UserContext, userId: string, body: { factoryId?: string; role?: UserRole; departmentId?: string | null; jobTitleId?: string | null; companyId?: string | null; reason?: string }) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const access = await tx.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId, factoryId } },
        include: { factory: true, department: true, user: true, jobTitle: true },
      });
      if (!access) throw new ConflictError('factory access not found');
      if (access.role === UserRole.ADMIN && body.role && body.role !== UserRole.ADMIN) await this.assertNotLastAdmin(tx, user.userId, userId, factoryId);
      if (body.role === UserRole.ADMIN && access.role !== UserRole.ADMIN) await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: 'ADMIN_ASSIGNED',
        entityType: 'User',
        entityId: userId,
        details: { oldValue: access.role, newValue: body.role, reason: body.reason ?? null, notificationTodo: true },
      });
      const before = this.cleanAccess(access);
      const nextDepartmentId = body.departmentId !== undefined ? body.departmentId : access.departmentId;
      const nextJobTitleId = body.jobTitleId !== undefined
        ? body.jobTitleId
        : (body.departmentId !== undefined && body.departmentId !== access.departmentId ? null : access.jobTitleId);
      const nextRole = body.role ?? access.role;
      const nextCompanyId = body.companyId !== undefined ? body.companyId : access.companyId;
      await this.assertJobTitleScopeTx(tx, nextJobTitleId ?? null, factoryId, nextDepartmentId ?? null);
      await this.assertAccessOrganizationContextTx(tx, nextRole, nextDepartmentId, nextCompanyId, factoryId);
      const updated = await tx.userFactoryAccess.update({
        where: { userId_factoryId: { userId, factoryId } },
        data: {
          ...(body.role ? { role: body.role } : {}),
          ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
          jobTitleId: nextJobTitleId ?? null,
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        },
        include: { factory: true, department: true, jobTitle: true, company: true },
      });
      await tx.user.update({ where: { id: userId }, data: { ...(body.role ? { role: body.role } : {}) } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: body.role && body.role !== access.role ? 'ADMIN_USER_ROLE_CHANGED' : 'ADMIN_USER_DEPARTMENT_CHANGED',
        entityType: 'UserFactoryAccess',
        entityId: updated.id,
        details: { targetId: userId, oldValue: before, newValue: this.cleanAccess(updated), reason: body.reason ?? null },
      });
      return this.serializeAccess(updated);
    });
    this.wsService.notifyAuthChanged(userId, factoryId);
    return result;
  }

  async updateBlockStatus(user: UserContext, userId: string, body: { blocked: boolean; reason?: string }) {
    this.assertAdmin(user);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        include: { factoryAccess: true },
      });
      if (!target) throw new ConflictError('user not found');
      const activeAccesses = target.factoryAccess.filter((access) => access.isActive);
      if (!activeAccesses.some((access) => access.factoryId === user.selectedFactoryId)) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Пользователь недоступен в выбранном заводе.' });
      }
      const actorAdminAccesses = await tx.userFactoryAccess.findMany({
        where: {
          userId: user.userId,
          role: UserRole.ADMIN,
          isActive: true,
          factoryId: { in: activeAccesses.map((access) => access.factoryId) },
        },
        select: { factoryId: true },
      });
      const actorAdminFactories = new Set(actorAdminAccesses.map((access) => access.factoryId));
      if (activeAccesses.some((access) => !actorAdminFactories.has(access.factoryId))) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Пользователь работает в заводе, которым вы не управляете.' });
      }
      if (body.blocked) {
        for (const access of activeAccesses.filter((item) => item.role === UserRole.ADMIN)) {
          await this.assertNotLastAdmin(tx, user.userId, userId, access.factoryId);
        }
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { blockedAt: body.blocked ? new Date() : null },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: body.blocked ? 'ADMIN_USER_BLOCKED' : 'ADMIN_USER_UNBLOCKED',
        entityType: 'User',
        entityId: userId,
        details: { targetId: userId, oldValue: target.blockedAt, newValue: updated.blockedAt, reason: body.reason ?? null },
      });
      return { id: updated.id, blockedAt: updated.blockedAt };
    });
    this.wsService.notifyAuthChanged(userId);
    return result;
  }

  async passwordResetPreview(user: UserContext, userId: string) {
    const decision = await this.passwordResetDecision(user, userId);
    const recoveryActive = Boolean(
      decision.target?.passwordRecoveryHash
      && decision.target.passwordRecoveryExpiresAt
      && decision.target.passwordRecoveryExpiresAt.getTime() > Date.now(),
    );
    return {
      allowed: decision.allowed,
      reason: decision.reason,
      passwordResetRequired: decision.target?.passwordResetRequired ?? false,
      recoveryActive,
      recoveryExpiresAt: recoveryActive ? decision.target?.passwordRecoveryExpiresAt ?? null : null,
    };
  }

  async resetPassword(user: UserContext, userId: string, body: { reason?: string } = {}) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const decision = await this.passwordResetDecision(user, userId, tx);
      if (!decision.allowed || !decision.target) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: decision.reason ?? 'Нет права сбросить пароль этого сотрудника.',
        });
      }

      const now = new Date();
      const recoveryCredential = generateRecoveryCredential();
      const passwordRecoveryHash = hashRecoveryCredential(recoveryCredential);
      const passwordRecoveryExpiresAt = recoveryCredentialExpiresAt(now);
      const replacedExisting = Boolean(
        decision.target.passwordResetRequired
        || decision.target.passwordRecoveryHash
        || decision.target.passwordRecoveryConsumedAt,
      );
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordResetRequired: true,
          passwordRecoveryHash,
          passwordRecoveryExpiresAt,
          passwordRecoveryIssuedAt: now,
          passwordRecoveryIssuedById: user.userId,
          passwordRecoveryFactoryId: user.selectedFactoryId,
          passwordRecoveryConsumedAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
          authUpdatedAt: nextAuthEpoch(decision.target.authUpdatedAt, now.getTime()),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: decision.actorIsAdmin ? 'ADMIN_PASSWORD_RECOVERY_ISSUED' : 'MANAGER_PASSWORD_RECOVERY_ISSUED',
        entityType: 'User',
        entityId: userId,
        details: {
          targetUserId: userId,
          reason: body.reason?.trim() || 'Сброс пароля подтверждён руководителем',
          expiresAt: passwordRecoveryExpiresAt.toISOString(),
          ttlMinutes: PASSWORD_RECOVERY_TTL_MINUTES,
          replacedExisting,
        },
      });
      return {
        ok: true,
        passwordResetRequired: true,
        recoveryCredential,
        recoveryExpiresAt: passwordRecoveryExpiresAt,
        replacedExisting,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.wsService.notifyAuthChanged(userId);
    return result;
  }

  private async passwordResetDecision(user: UserContext, userId: string, db: AdminDb = this.prisma.db) {
    if (!user?.selectedFactoryId || user.isGuest) {
      return { allowed: false, reason: 'Войдите и выберите завод.', target: null as any, actorIsAdmin: false };
    }
    if (user.userId === userId) {
      return { allowed: false, reason: 'Для своего профиля используйте обычную смену пароля.', target: null as any, actorIsAdmin: false };
    }

    const [actor, target] = await Promise.all([
      db.user.findUnique({
        where: { id: user.userId },
        include: {
          permissionOverrides: true,
          factoryAccess: {
            where: { factoryId: user.selectedFactoryId, isActive: true },
            include: { jobTitle: true, factory: { select: { isActive: true, deletedAt: true } } },
          },
        },
      }),
      db.user.findUnique({
        where: { id: userId },
        include: {
          factoryAccess: {
            where: { factoryId: user.selectedFactoryId, isActive: true },
            include: { jobTitle: true },
          },
        },
      }),
    ]);
    const actorAccess = actor?.factoryAccess[0] ?? null;
    const targetAccess = target?.factoryAccess[0] ?? null;
    if (
      !actor
      || actor.deletedAt
      || actor.blockedAt
      || actor.passwordResetRequired
      || !actorAccess?.isActive
      || actorAccess.isGuest
      || !actorAccess.factory.isActive
      || actorAccess.factory.deletedAt
      || !target
      || !targetAccess
      || target.deletedAt
      || target.blockedAt
    ) {
      return { allowed: false, reason: 'Сотрудник или назначающий недоступен в выбранном заводе.', target, actorIsAdmin: false };
    }

    const rolePermissions = await db.rolePermission.findMany({
      where: { role: actorAccess.role, isActive: true },
      select: { permissionCode: true },
    });
    const currentActorPermissions = resolveEffectivePermissions({
      role: actorAccess.role,
      isGuest: false,
      rolePermissionCodes: rolePermissions.map((item) => item.permissionCode),
      overrides: actor.permissionOverrides.filter((override) => (
        override.factoryId === null || override.factoryId === user.selectedFactoryId
      )),
    });
    const actorIsAdmin = actorAccess.role === UserRole.ADMIN;

    if (actorIsAdmin) {
      return { allowed: true, reason: null, target, actorIsAdmin };
    }
    if (targetAccess.role === UserRole.ADMIN || targetAccess.role === UserRole.MANAGEMENT) {
      return { allowed: false, reason: 'Нельзя сбросить пароль равного или вышестоящего сотрудника.', target, actorIsAdmin };
    }

    if (currentActorPermissions.includes('company.members.manage')) {
      const allowed = actorAccess.role === UserRole.CONTRACTOR_LEAD
        && Boolean(actorAccess.companyId)
        && actorAccess.companyId === targetAccess.companyId
        && targetAccess.role === UserRole.CONTRACTOR
        && !targetAccess.isGuest;
      return {
        allowed,
        reason: allowed ? null : 'Можно управлять только наёмными работниками своей фирмы.',
        target,
        actorIsAdmin,
      };
    }

    const canManagePeople = actorAccess.role === UserRole.MANAGEMENT
      || currentActorPermissions.includes('people.profile.manage')
      || currentActorPermissions.includes(DELEGATION_AUTHORITY_PERMISSION);
    if (!canManagePeople) {
      return { allowed: false, reason: 'Нет права управлять сотрудниками.', target, actorIsAdmin };
    }
    if (!actorAccess.departmentId || targetAccess.departmentId !== actorAccess.departmentId || targetAccess.isGuest) {
      return { allowed: false, reason: 'Можно управлять только сотрудниками своего отдела.', target, actorIsAdmin };
    }

    const targetEffective = await this.effectivePermissionCodes(userId, user.selectedFactoryId, targetAccess.role, db);
    if (targetEffective.includes(DELEGATION_AUTHORITY_PERMISSION)) {
      return { allowed: false, reason: 'Нельзя сбросить пароль равного руководителя.', target, actorIsAdmin };
    }
    const hierarchy = await this.jobTitleTreeDecision(actorAccess, targetAccess, db);
    if (hierarchy.checked && !hierarchy.allowed) {
      return { allowed: false, reason: hierarchy.reason ?? 'Можно управлять только подчинёнными должностями.', target, actorIsAdmin };
    }
    if (!hierarchy.checked && targetAccess.role !== UserRole.WORKER) {
      return {
        allowed: false,
        reason: 'Для этой должности сначала настройте подчинённость в иерархии должностей.',
        target,
        actorIsAdmin,
      };
    }
    return { allowed: true, reason: null, target, actorIsAdmin };
  }

  async factories(user: UserContext) {
    this.assertAdmin(user);
    const accesses = await this.prisma.db.userFactoryAccess.findMany({
      where: {
        userId: user.userId,
        isActive: true,
        factory: { deletedAt: null },
      },
      include: { factory: { include: { _count: { select: { userAccess: true, departments: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const factoryIds = accesses.map((access) => access.factoryId);
    const lineCounts = await this.prisma.db.line.groupBy({
      by: ['factoryId'],
      where: { factoryId: { in: factoryIds }, deletedAt: null },
      _count: { _all: true },
    });
    const linesByFactory = new Map(lineCounts.map((item) => [item.factoryId, item._count._all]));
    return accesses.map(({ factory }) => ({
      id: factory.id,
      name: factory.name,
      code: factory.code,
      isActive: factory.isActive,
      counts: { users: factory._count.userAccess, departments: factory._count.departments, lines: linesByFactory.get(factory.id) ?? 0 },
    }));
  }

  async factorySetupOptions(user: UserContext) {
    this.assertAdmin(user);
    const factories = await this.factories(user);
    return {
      sourceFactories: factories.filter((factory) => !hasPilotFixtureMarker(factory.id, factory.name, factory.code)),
      categories: FACTORY_SETUP_CATEGORIES,
      defaults: {
        mode: 'COPY',
        categories: FACTORY_SETUP_CATEGORY_KEYS,
      },
      notCopied: [
        'Смены, назначения и планирование смен',
        'Заявки, история заявок и простои',
        'Мойка, ОКК, возвраты, складские движения',
        'Чаты, сообщения, вложения и объявления',
        'Аудит, уведомления, сессии и история пользователей',
        'Доступы пользователей к заводу',
      ],
    };
  }

  async factorySetupPreview(user: UserContext, body: FactorySetupBody) {
    this.assertAdmin(user);
    const normalized = await this.normalizeFactorySetupInput(user, body, false);
    const counts = normalized.mode === 'COPY' && normalized.sourceFactoryId
      ? await this.factorySetupCounts(normalized.sourceFactoryId, normalized.categories)
      : this.emptyFactorySetupCounts();
    return {
      mode: normalized.mode,
      target: {
        name: normalized.name,
        code: normalized.code,
        isActive: normalized.isActive,
      },
      sourceFactoryId: normalized.sourceFactoryId,
      sourceFactoryName: normalized.sourceFactoryName,
      categories: FACTORY_SETUP_CATEGORIES.map((category) => ({
        ...category,
        selected: normalized.categories.includes(category.key),
      })),
      counts,
      warnings: this.factorySetupPreviewWarnings(normalized, counts),
      writesDatabase: false,
      runtimeCopied: false,
      notCopied: [
        'Пользователи и доступы не копируются автоматически.',
        'История смен, заявки, чаты, вложения, архивы, аудит и уведомления не копируются.',
      ],
    };
  }

  async factorySetupCreate(user: UserContext, body: FactorySetupBody) {
    this.assertAdmin(user);
    const normalized = await this.normalizeFactorySetupInput(user, body, true);
    return this.prisma.db.$transaction(async (tx) => {
      const duplicate = await tx.factory.findUnique({ where: { code: normalized.code } });
      if (duplicate && !duplicate.deletedAt) throw new ConflictError('Завод с таким кодом уже существует');

      const factory = await tx.factory.create({
        data: {
          name: normalized.name,
          code: normalized.code,
          isActive: normalized.isActive,
        },
      });

      await tx.userFactoryAccess.upsert({
        where: { userId_factoryId: { userId: user.userId, factoryId: factory.id } },
        update: { isActive: true, role: UserRole.ADMIN, departmentId: null, isGuest: false },
        create: { userId: user.userId, factoryId: factory.id, role: UserRole.ADMIN, departmentId: null, isGuest: false, isActive: true },
      });

      let copyResult = this.emptyFactorySetupCounts();
      if (normalized.mode === 'COPY' && normalized.sourceFactoryId) {
        copyResult = await this.copyFactoryConfigurationTx(tx, normalized.sourceFactoryId, factory.id, normalized.categories);
      } else if (normalized.categories.includes('globalServices')) {
        await this.ensureSharedServicesTx(tx);
      }

      if (normalized.categories.includes('moduleSettings') && normalized.mode !== 'COPY') {
        await this.ensureDefaultFactorySettingsTx(tx, factory.id);
      }

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: factory.id,
        action: 'FACTORY_CREATED',
        entityType: 'Factory',
        entityId: factory.id,
        details: {
          name: factory.name,
          code: factory.code,
          sourceFactoryId: normalized.sourceFactoryId ?? null,
          mode: normalized.mode,
          adminAccessGrantedTo: user.userId,
        },
      });
      if (normalized.mode === 'COPY') {
        await this.auditService.writeTx(tx, {
          userId: user.userId,
          factoryId: factory.id,
          action: 'FACTORY_CONFIG_CLONED',
          entityType: 'Factory',
          entityId: factory.id,
          details: {
            sourceFactoryId: normalized.sourceFactoryId,
            categories: normalized.categories,
            counts: copyResult,
            runtimeCopied: false,
          },
        });
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: factory.id,
        action: 'FACTORY_SETUP_COMPLETED',
        entityType: 'Factory',
        entityId: factory.id,
        details: {
          mode: normalized.mode,
          categories: normalized.categories,
          nextStep: 'Выдать доступ пользователям',
        },
      });

      const health = await this.buildFactoryConfigHealth(tx, factory.id);
      return {
        factory: {
          id: factory.id,
          name: factory.name,
          code: factory.code,
          isActive: factory.isActive,
        },
        copied: copyResult,
        runtimeCopied: false,
        nextSteps: [
          'Добавить администратора или руководителя',
          'Выдать доступ мастерам и службам',
          'Проверить линии, позиции и шаблоны состава',
          'Проверить настройки модулей',
        ],
        health,
      };
    });
  }

  async factoryConfigHealth(user: UserContext, factoryId: string) {
    this.assertAdminFactoryScope(user, factoryId);
    await this.assertFactoryVisible(factoryId);
    const health = await this.buildFactoryConfigHealth(this.prisma.db, factoryId);
    await this.auditService.write({
      userId: user.userId,
      factoryId,
      action: 'FACTORY_CONFIG_HEALTH_VIEWED',
      entityType: 'Factory',
      entityId: factoryId,
      details: { status: health.status, warnings: health.warnings.length },
    });
    return health;
  }

  async factoryConfigExport(user: UserContext, factoryId: string) {
    this.assertAdminFactoryScope(user, factoryId);
    const factory = await this.assertFactoryVisible(factoryId);
    const config = await this.buildFactoryConfigExport(factory);
    await this.auditService.write({
      userId: user.userId,
      factoryId,
      action: 'FACTORY_CONFIG_EXPORTED',
      entityType: 'Factory',
      entityId: factoryId,
      details: {
        schemaVersion: FACTORY_CONFIG_SCHEMA_VERSION,
        counts: config.counts,
        runtimeCopied: false,
      },
    });
    return config;
  }

  async factoryConfigImportPreview(user: UserContext, body: FactoryConfigImportBody) {
    this.assertAdmin(user);
    const config = this.extractFactoryConfigFile(body);
    const validation = this.validateFactoryConfigFile(config);
    const target = this.normalizeFactoryConfigImportTarget(body, false);
    const result = {
      schemaVersion: config?.schemaVersion ?? null,
      sourceFactory: config?.sourceFactory ?? null,
      target,
      counts: this.factoryConfigImportCounts(config),
      warnings: validation.warnings,
      errors: validation.errors,
      writesDatabase: false,
      runtimeCopied: false,
      notImported: this.factoryConfigNotImportedList(),
    };
    if (!validation.errors.length) {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'FACTORY_CONFIG_IMPORT_PREVIEWED',
        entityType: 'FactoryConfig',
        entityId: null,
        details: {
          schemaVersion: config.schemaVersion,
          sourceFactory: config.sourceFactory ?? null,
          counts: result.counts,
          runtimeCopied: false,
        },
      });
    }
    return result;
  }

  async factoryConfigImportCreate(user: UserContext, body: FactoryConfigImportBody) {
    this.assertAdmin(user);
    const config = this.extractFactoryConfigFile(body);
    const validation = this.validateFactoryConfigFile(config);
    if (validation.errors.length) {
      throw new ConflictError(validation.errors[0]);
    }
    const target = this.normalizeFactoryConfigImportTarget(body, true);
    return this.prisma.db.$transaction(async (tx) => {
      const duplicate = await tx.factory.findUnique({ where: { code: target.code } });
      if (duplicate && !duplicate.deletedAt) throw new ConflictError('Завод с таким кодом уже существует');

      const factory = await tx.factory.create({
        data: {
          name: target.name,
          code: target.code,
          isActive: target.isActive,
        },
      });

      await tx.userFactoryAccess.upsert({
        where: { userId_factoryId: { userId: user.userId, factoryId: factory.id } },
        update: { isActive: true, role: UserRole.ADMIN, departmentId: null, isGuest: false },
        create: { userId: user.userId, factoryId: factory.id, role: UserRole.ADMIN, departmentId: null, isGuest: false, isActive: true },
      });

      const imported = await this.importFactoryConfigTx(tx, factory.id, config);

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: factory.id,
        action: 'FACTORY_CREATED_FROM_IMPORT',
        entityType: 'Factory',
        entityId: factory.id,
        details: {
          name: factory.name,
          code: factory.code,
          sourceFactory: config.sourceFactory ?? null,
          adminAccessGrantedTo: user.userId,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: factory.id,
        action: 'FACTORY_CONFIG_IMPORTED',
        entityType: 'Factory',
        entityId: factory.id,
        details: {
          schemaVersion: config.schemaVersion,
          counts: imported,
          runtimeCopied: false,
          warnings: validation.warnings,
        },
      });

      const health = await this.buildFactoryConfigHealth(tx, factory.id);
      return {
        factory: {
          id: factory.id,
          name: factory.name,
          code: factory.code,
          isActive: factory.isActive,
        },
        imported,
        runtimeCopied: false,
        warnings: validation.warnings,
        notImported: this.factoryConfigNotImportedList(),
        health,
      };
    });
  }

  async factoryContext(user: UserContext, factoryId: string) {
    this.assertAdminFactoryScope(user, factoryId);
    const factory = await this.prisma.db.factory.findFirst({ where: { id: factoryId, deletedAt: null } });
    if (!factory) throw new ConflictError('Завод не найден');

    const [
      accessRows,
      localDepartments,
      globalServices,
      rawLines,
      workAreas,
      auditRows,
      factories,
      shiftSettings,
      taskSettings,
      washSettings,
      defrostSettings,
      orderSettings,
      checklistSettings,
      chatSettings,
      announcementSettings,
      jobTitles,
    ] = await Promise.all([
      this.prisma.db.userFactoryAccess.findMany({
        where: { factoryId },
        include: { user: true, department: true, factory: true, jobTitle: true },
        orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.db.department.findMany({
        where: { factoryId, deletedAt: null },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.db.department.findMany({
        where: { factoryId: null, scope: 'GLOBAL', deletedAt: null },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.db.line.findMany({
        where: { factoryId, deletedAt: null },
        include: {
          positions: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          staffingTemplates: {
            include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.workArea.findMany({
        where: { factoryId, deletedAt: null },
        include: { positions: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.db.auditLog.findMany({
        where: { factoryId },
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.db.factory.findMany({
        where: { deletedAt: null },
        include: { _count: { select: { userAccess: true, departments: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.shiftSettings.findUnique({ where: { factoryId } }),
      this.prisma.db.taskSettings.findUnique({ where: { factoryId } }),
      this.prisma.db.washSettings.findUnique({ where: { factoryId } }),
      this.prisma.db.defrostSettings.findUnique({ where: { factoryId } }),
      this.prisma.db.orderSettings.findUnique({ where: { factoryId } }),
      this.prisma.db.checklistSettings.findUnique({ where: { factoryId } }),
      this.prisma.db.chatSettings.findUnique({ where: { factoryId } }),
      this.prisma.db.announcementSettings.findUnique({ where: { factoryId } }),
      this.prisma.db.jobTitle.findMany({
        where: { deletedAt: null, OR: [{ factoryId }, { factoryId: null }] },
        include: { department: true, factory: true, parentJobTitle: true, childJobTitles: true },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
    ]);

    const activeVisibleAccess = accessRows.filter((access) => access.isActive && !access.isGuest && !access.user.blockedAt && !access.user.deletedAt && !isPilotFixtureUser(access.user));
    const departmentAccessCounts = new Map<string, number>();
    for (const access of activeVisibleAccess) {
      if (!access.departmentId) continue;
      departmentAccessCounts.set(access.departmentId, (departmentAccessCounts.get(access.departmentId) ?? 0) + 1);
    }

    const visibleLocalDepartments = localDepartments.filter((department) => !hasRuntimeFixtureMarker(department.id, department.name, department.code));
    const visibleGlobalServices = globalServices.filter((department) => !hasRuntimeFixtureMarker(department.id, department.name, department.code));
    const visibleLines = dedupePilotLines(rawLines.filter((line) => isPilotVisibleLine(line)));
    const visibleWorkAreas = workAreas.filter((area) => !hasRuntimeFixtureMarker(area.id, area.name));
    const activePositionsCount = visibleLines.reduce((sum, line) => sum + line.positions.filter((position) => position.isActive && !position.deletedAt).length, 0);
    const activeTemplateCount = visibleLines.reduce((sum, line) => sum + line.staffingTemplates.filter((template) => template.isActive && !template.deletedAt).length, 0);

    return {
      factory: {
        id: factory.id,
        name: factory.name,
        code: factory.code,
        isActive: factory.isActive,
        createdAt: factory.createdAt,
        updatedAt: factory.updatedAt,
      },
      counts: {
        usersWithAccess: activeVisibleAccess.length,
        localDepartments: visibleLocalDepartments.filter((department) => department.isActive).length,
        globalServices: visibleGlobalServices.filter((department) => department.isActive).length,
        lines: visibleLines.length,
        positions: activePositionsCount,
        staffingTemplates: activeTemplateCount,
        workAreas: visibleWorkAreas.filter((area) => area.isActive).length,
      },
      pilotVisibleFactories: factories
        .filter((item) => !hasRuntimeFixtureMarker(item.id, item.name, item.code))
        .map((item) => ({
          id: item.id,
          name: item.name,
          code: item.code,
          isActive: item.isActive,
          counts: { users: item._count.userAccess, departments: item._count.departments },
        })),
      usersWithAccess: accessRows
        .filter((access) => !isPilotFixtureUser(access.user))
        .map((access) => ({
          id: access.user.id,
          displayName: pilotDisplayName(access.user),
          role: access.role,
          departmentId: access.departmentId,
          departmentName: access.department?.name ?? null,
          jobTitleId: access.jobTitleId,
          jobTitleName: access.jobTitle?.name ?? null,
          isActive: access.isActive,
          isGuest: access.isGuest,
          blockedAt: access.user.blockedAt,
          accessId: access.id,
        })),
      localDepartments: visibleLocalDepartments.map((department) => this.serializeContextDepartment(department, departmentAccessCounts.get(department.id) ?? 0, false)),
      globalServices: visibleGlobalServices.map((department) => this.serializeContextDepartment(department, departmentAccessCounts.get(department.id) ?? 0, true)),
      lines: visibleLines.map((line) => this.serializeLineConfig(this.sanitizeContextLine(line))),
      staffingTemplates: visibleLines.flatMap((line) =>
        line.staffingTemplates
          .filter((template) => template.isActive && !template.deletedAt)
          .map((template) => ({
            id: template.id,
            lineId: line.id,
            lineName: line.name,
            name: template.name,
            positionsCount: template.items.length,
            plannedCount: template.items.reduce((sum, item) => sum + (item.plannedCount ?? item.defaultPlanned ?? item.requiredCount), 0),
            items: template.items.map((item) => ({
              id: item.id,
              positionName: item.position?.displayName ?? item.position?.name ?? item.positionId,
              plannedCount: item.plannedCount ?? item.defaultPlanned ?? item.requiredCount,
              minRequired: item.minRequired ?? item.requiredCount,
              maxRequired: item.maxRequired ?? item.requiredCount,
            })),
          })),
      ),
      workAreas: visibleWorkAreas.map((area) => this.serializeWorkArea(area)),
      jobTitles: jobTitles
        .filter((title) => !hasRuntimeFixtureMarker(title.id, title.name, title.code, title.description))
        .map((title) => this.serializeJobTitle(title)),
      moduleSettings: [
        this.serializeModuleSettings('shift', 'Смена', factoryId, shiftSettings),
        this.serializeModuleSettings('tasks', 'Заявки', factoryId, taskSettings),
        this.serializeModuleSettings('wash', 'Мойка', factoryId, washSettings),
        this.serializeModuleSettings('defrost', 'Оттайка', factoryId, defrostSettings),
        this.serializeModuleSettings('orders', 'Заказы / Остатки', factoryId, orderSettings),
        this.serializeModuleSettings('checklists', 'Чек-листы', factoryId, checklistSettings),
        this.serializeModuleSettings('chats', 'Чаты', factoryId, chatSettings),
        this.serializeModuleSettings('announcements', 'Объявления', factoryId, announcementSettings),
      ],
      recentAudit: auditRows
        .filter((audit) => !hasPilotFixtureMarker(audit.action, audit.entityType, audit.entityId, audit.user?.id, (audit.user as any)?.displayName, JSON.stringify(audit.details)))
        .map((audit) => ({
        id: audit.id,
        factoryId: audit.factoryId,
        action: audit.action,
        entityType: this.auditEntityLabel(audit.entityType),
        entityId: audit.entityId,
        actorName: audit.user ? pilotDisplayName(audit.user) : 'Система',
        createdAt: audit.createdAt,
        detailsSummary: this.auditDetailsSummary(audit.details),
      })),
    };
  }

  async createFactory(user: UserContext, body: CreateFactoryBody) {
    this.assertAdmin(user);
    const name = body.name?.trim();
    const code = this.normalizeFactoryCode(body.code || body.name || '');
    const template = body.template ?? 'EMPTY';
    if (!name) throw new ConflictError('Название завода обязательно');
    if (!code) throw new ConflictError('Код завода обязателен');
    if (!['EMPTY', 'BASIC_SERVICES', 'COPY_FACTORY_4'].includes(template)) {
      throw new ConflictError('Неизвестный шаблон создания завода');
    }

    return this.prisma.db.$transaction(async (tx) => {
      const duplicate = await tx.factory.findUnique({ where: { code } });
      if (duplicate && !duplicate.deletedAt) throw new ConflictError('Завод с таким кодом уже существует');

      const factory = await tx.factory.create({
        data: { name, code, isActive: true },
      });

      await tx.userFactoryAccess.upsert({
        where: { userId_factoryId: { userId: user.userId, factoryId: factory.id } },
        update: { isActive: true, role: UserRole.ADMIN, departmentId: null, isGuest: false },
        create: { userId: user.userId, factoryId: factory.id, role: UserRole.ADMIN, departmentId: null, isGuest: false, isActive: true },
      });

      if (template === 'BASIC_SERVICES' || template === 'COPY_FACTORY_4') {
        await this.ensureSharedServicesTx(tx);
      }
      if (template === 'COPY_FACTORY_4') {
        await this.copyFactory4StructureTx(tx, factory.id);
      }

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: factory.id,
        action: 'FACTORY_CREATED',
        entityType: 'Factory',
        entityId: factory.id,
        details: {
          name,
          code,
          template,
          description: body.description?.trim() || null,
          adminAccessGrantedTo: user.userId,
        },
      });

      return factory;
    });
  }

  async updateFactoryStatus(user: UserContext, factoryId: string, body: { isActive: boolean; reason?: string }) {
    this.assertAdmin(user);
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const actorAccess = await tx.userFactoryAccess.findFirst({
        where: { userId: user.userId, factoryId, role: UserRole.ADMIN, isActive: true },
        select: { id: true },
      });
      if (!actorAccess) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет права управлять этим заводом.' });
      }
      const factory = await tx.factory.findUnique({ where: { id: factoryId } });
      if (!factory) throw new ConflictError('factory not found');
      if (!body.isActive) {
        this.assertRecoveryReason(body.reason);
        const activeCount = await tx.factory.count({ where: { isActive: true, deletedAt: null } });
        if (activeCount <= 1) throw new ConflictError('cannot deactivate the last active factory');
      }
      const updated = await tx.factory.update({
        where: { id: factoryId },
        data: {
          isActive: body.isActive,
          ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: body.isActive ? 'FACTORY_RESTORED' : 'FACTORY_DEACTIVATED',
        entityType: 'Factory',
        entityId: factoryId,
        details: { oldValue: factory.isActive, newValue: updated.isActive, reason: body.reason ?? null },
      });
      return updated;
    });
    if (!body.isActive) this.wsService.notifyFactoryUnavailable(factoryId);
    return updated;
  }

  async dataHygieneSummary(user: UserContext, query: { factoryId?: string } = {}) {
    const factoryId = query.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const report = await this.buildDataHygieneReport(factoryId);
    await this.auditService.write({
      userId: user.userId,
      factoryId,
      action: 'DATA_HYGIENE_VIEWED',
      entityType: 'DataHygiene',
      entityId: factoryId,
      details: { mode: 'summary', total: report.total },
    });
    return {
      factoryId,
      total: report.total,
      groups: report.groups,
      types: report.types,
      recommendations: report.recommendations,
      generatedAt: report.generatedAt,
    };
  }

  async dataHygieneRecords(user: UserContext, query: { factoryId?: string; group?: string; type?: string; page?: string; pageSize?: string } = {}) {
    const factoryId = query.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 30, 5), 100);
    const report = await this.buildDataHygieneReport(factoryId);
    const filtered = report.records.filter((record) =>
      (!query.group || record.group === query.group)
      && (!query.type || record.type === query.type),
    );
    return {
      factoryId,
      total: filtered.length,
      page,
      pageSize,
      records: filtered.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  async latestPilotHealthReport(user: UserContext) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGEMENT) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к проверке готовности пилота.' });
    }
    const reportPath = path.join(this.projectRootDir(), '.codex-runtime', 'pilot-health-report', 'latest.json');
    if (!fs.existsSync(reportPath)) {
      return {
        schemaVersion: 1,
        status: 'UNKNOWN',
        summary: { OK: 0, INFO: 0, WARNING: 0, P2: 0, P1: 0, P0: 0, blockerCount: 0, warningCount: 0 },
        generatedAt: null,
        message: 'Отчёт проверки готовности пилота ещё не сформирован. Запустите npm run pilot:health-report --workspace backend.',
      };
    }
    try {
      return this.redactPilotHealthReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
    } catch {
      return {
        schemaVersion: 1,
        status: 'BROKEN_REPORT',
        summary: { OK: 0, INFO: 0, WARNING: 0, P2: 0, P1: 1, P0: 0, blockerCount: 1, warningCount: 0 },
        generatedAt: null,
        message: 'Последний отчёт проверки готовности пилота повреждён или не читается.',
      };
    }
  }

  async recovery(user: UserContext, query: { factoryId?: string; type?: string; diagnostic?: string } = {}) {
    const factoryId = query.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const filterType = RECOVERY_TYPES.includes(query.type as RecoveryType) ? query.type as RecoveryType : null;
    const items: any[] = [];
    const actorIds = new Set<string>();
    const addActor = (value?: string | null) => { if (value) actorIds.add(value); };
    const include = (type: RecoveryType) => !filterType || filterType === type;

    const [
      factories,
      departments,
      jobTitles,
      accesses,
      lines,
      linePositions,
      templates,
      workAreas,
      workAreaPositions,
    ] = await Promise.all([
      include('factory') ? this.prisma.db.factory.findMany({ where: { id: factoryId, isActive: false, deletedAt: null }, orderBy: { updatedAt: 'desc' } }) : [],
      include('department') ? this.prisma.db.department.findMany({ where: { AND: [{ OR: [{ factoryId }, { factoryId: null }] }, { OR: [{ isActive: false }, { deletedAt: { not: null } }] }] }, include: { factory: true }, orderBy: { updatedAt: 'desc' } }) : [],
      include('job-title') ? this.prisma.db.jobTitle.findMany({ where: { AND: [{ OR: [{ factoryId }, { factoryId: null }] }, { OR: [{ isActive: false }, { deletedAt: { not: null } }] }] }, include: { factory: true, department: true }, orderBy: { updatedAt: 'desc' } }) : [],
      include('factory-access') ? this.prisma.db.userFactoryAccess.findMany({ where: { factoryId, isActive: false }, include: { user: true, factory: true, department: true }, orderBy: { updatedAt: 'desc' } }) : [],
      include('line') ? this.prisma.db.line.findMany({ where: { factoryId, deletedAt: { not: null } }, orderBy: { updatedAt: 'desc' } }) : [],
      include('line-position') ? this.prisma.db.linePosition.findMany({ where: { factoryId, OR: [{ isActive: false }, { deletedAt: { not: null } }] }, include: { line: true }, orderBy: { updatedAt: 'desc' } }) : [],
      include('staffing-template') ? this.prisma.db.lineStaffingTemplate.findMany({ where: { factoryId, OR: [{ isActive: false }, { deletedAt: { not: null } }] }, include: { line: true }, orderBy: { updatedAt: 'desc' } }) : [],
      include('work-area') ? this.prisma.db.workArea.findMany({ where: { factoryId, OR: [{ isActive: false }, { deletedAt: { not: null } }] }, include: { factory: true, department: true }, orderBy: { updatedAt: 'desc' } }) : [],
      include('work-area-position') ? this.prisma.db.workAreaPosition.findMany({ where: { OR: [{ isActive: false }, { deletedAt: { not: null } }], workArea: { factoryId } }, include: { workArea: true }, orderBy: { updatedAt: 'desc' } }) : [],
    ]);

    for (const item of [...factories, ...departments, ...jobTitles, ...accesses, ...lines, ...linePositions, ...templates, ...workAreas, ...workAreaPositions] as any[]) {
      addActor(item.deactivatedById);
      addActor(item.restoredById);
    }
    const actors = actorIds.size
      ? await this.prisma.db.user.findMany({ where: { id: { in: [...actorIds] } }, select: { id: true } })
      : [];
    const actorNames = new Map(actors.map((actor) => [actor.id, pilotDisplayName(actor)]));

    items.push(...factories.map((item) => this.recoveryItem('factory', item.id, item.name, item, { factoryId: item.id, factoryName: item.name }, actorNames)));
    items.push(...departments.map((item) => this.recoveryItem('department', item.id, item.name, item, { factoryId: item.factoryId, factoryName: item.factory?.name ?? (item.scope === 'GLOBAL' ? 'Общая служба' : null) }, actorNames)));
    items.push(...jobTitles.map((item) => this.recoveryItem('job-title', item.id, item.name, item, { factoryId: item.factoryId, factoryName: item.factory?.name ?? 'Общая должность', departmentName: item.department?.name ?? null }, actorNames)));
    const diagnosticAccessIds = new Set(accesses.filter((item) => isPilotFixtureUser(item.user)).map((item) => item.id));
    items.push(...accesses.map((item) => {
      const displayName = pilotDisplayName(item.user);
      const label = diagnosticAccessIds.has(item.id) && displayName === item.user.id ? 'Диагностический сотрудник' : displayName;
      return this.recoveryItem('factory-access', item.id, `${label} — ${item.isGuest ? 'Гость' : this.roleLabel(item.role)}`, item, { factoryId: item.factoryId, factoryName: item.factory?.name ?? null, departmentName: item.department?.name ?? null }, actorNames);
    }));
    items.push(...lines.map((item) => this.recoveryItem('line', item.id, item.name, item, { factoryId: item.factoryId, factoryName: null }, actorNames)));
    items.push(...linePositions.map((item) => this.recoveryItem('line-position', item.id, item.displayName || item.name, item, { factoryId: item.factoryId, factoryName: null, parentName: item.line?.name ?? null }, actorNames)));
    items.push(...templates.map((item) => this.recoveryItem('staffing-template', item.id, item.name, item, { factoryId: item.factoryId, factoryName: null, parentName: item.line?.name ?? null }, actorNames)));
    items.push(...workAreas.map((item) => this.recoveryItem('work-area', item.id, item.name, item, { factoryId: item.factoryId, factoryName: item.factory?.name ?? null, departmentName: item.department?.name ?? null }, actorNames)));
    items.push(...workAreaPositions.map((item) => this.recoveryItem('work-area-position', item.id, item.title, item, { factoryId: item.workArea?.factoryId ?? null, factoryName: null, parentName: item.workArea?.name ?? null }, actorNames)));

    const diagnosticMode = query.diagnostic === 'true' || query.diagnostic === '1';
    const sorted = items
      .map((item) => {
        const reasons = dataHygieneReasons({
          id: item.id,
          title: item.title,
          name: item.name,
          description: item.reason,
        });
        if (item.type === 'factory-access' && diagnosticAccessIds.has(item.id) && !reasons.some((reason) => reason.group === 'test-records')) {
          reasons.push({ group: 'test-records', label: 'Доступ принадлежит диагностическому пользователю.' });
        }
        if (reasons.length) reasons.push({ group: 'old-disabled', label: 'Отключённая запись имеет диагностический признак и скрыта из обычного восстановления.' });
        return {
          ...item,
          diagnosticReasons: reasons.map((reason) => reason.label),
          diagnosticGroup: reasons[0]?.group ?? null,
          diagnosticLabel: reasons.length ? 'Диагностическая или нечитаемая запись' : null,
        };
      })
      .filter((item) => diagnosticMode ? item.diagnosticReasons.length > 0 : item.diagnosticReasons.length === 0)
      .sort((left, right) => new Date(right.deactivatedAt ?? right.updatedAt ?? 0).getTime() - new Date(left.deactivatedAt ?? left.updatedAt ?? 0).getTime());
    return {
      factoryId,
      diagnosticMode,
      total: sorted.length,
      expiringSoon: sorted.filter((item) => item.daysLeft !== null && item.daysLeft <= 3 && item.daysLeft >= 0).length,
      items: sorted,
    };
  }

  async restoreRecoveryObject(user: UserContext, type: string, id: string, body: { reason?: string } = {}) {
    this.assertAdmin(user);
    if (!RECOVERY_TYPES.includes(type as RecoveryType)) throw new ConflictError('Неизвестный тип восстановления');
    const recoveryType = type as RecoveryType;
    return this.prisma.db.$transaction(async (tx) => {
      const reason = body.reason?.trim() || 'Восстановлено через Центр восстановления';
      const restored = await this.restoreByTypeTx(tx, user, recoveryType, id, reason);
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: restored.factoryId ?? user.selectedFactoryId,
        action: restored.action,
        entityType: restored.entityType,
        entityId: id,
        details: { objectType: recoveryType, objectName: restored.name, reason, recoveryCenter: true },
      });
      return { ok: true, type: recoveryType, id, title: restored.name, restoredAt: new Date() };
    });
  }

  async departments(user: UserContext, factoryId = user.selectedFactoryId) {
    this.assertAdminFactoryScope(user, factoryId);
    const departments = await this.prisma.db.department.findMany({
      where: { deletedAt: null, OR: [{ factoryId }, { scope: 'GLOBAL' }] },
      include: { factory: true, _count: { select: { userAccess: true } } },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    });
    return departments.map((department) => ({
      id: department.id,
      factoryId: department.factoryId,
      factoryName: department.factory?.name ?? null,
      scope: department.scope,
      name: department.name,
      code: department.code,
      isActive: department.isActive,
      userCount: department._count.userAccess,
    }));
  }

  async externalCompanies(user: UserContext, factoryId = user.selectedFactoryId) {
    this.assertAdminFactoryScope(user, factoryId);
    const companies = await this.prisma.db.externalCompany.findMany({
      where: { factoryId },
      include: {
        _count: { select: { userAccess: true, assignmentRequests: true } },
        userAccess: {
          where: { isActive: true, role: UserRole.CONTRACTOR_LEAD, user: { blockedAt: null, deletedAt: null } },
          include: { user: true },
        },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return companies.filter((company) => !hasPilotFixtureMarker(company.id, company.name)).map((company) => ({
      id: company.id,
      factoryId: company.factoryId,
      name: company.name,
      isActive: company.isActive,
      membersCount: company._count.userAccess,
      requestsCount: company._count.assignmentRequests,
      leads: company.userAccess.map((access) => ({ userId: access.userId, displayName: pilotDisplayName(access.user) })),
    }));
  }

  async createExternalCompany(user: UserContext, body: ExternalCompanyBody) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new ConflictError('Название фирмы обязательно');
    const normalizedName = this.normalizeOrganizationName(name);
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertFactoryExistsTx(tx, factoryId);
      const duplicate = await tx.externalCompany.findUnique({ where: { factoryId_normalizedName: { factoryId, normalizedName } } });
      if (duplicate) throw new ConflictError('Фирма с таким названием уже существует в выбранном заводе');
      const company = await tx.externalCompany.create({ data: { factoryId, name, normalizedName, isActive: body.isActive ?? true } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: 'EXTERNAL_COMPANY_CREATED',
        entityType: 'ExternalCompany',
        entityId: company.id,
        details: { name: company.name, isActive: company.isActive },
      });
      return company;
    });
  }

  async updateExternalCompany(user: UserContext, companyId: string, body: ExternalCompanyBody) {
    this.assertAdmin(user);
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.externalCompany.findFirst({
        where: { id: companyId, factoryId: user.selectedFactoryId },
      });
      if (!current) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Фирма недоступна в выбранном заводе.' });
      const name = body.name !== undefined ? String(body.name).trim().replace(/\s+/g, ' ') : current.name;
      if (!name) throw new ConflictError('Название фирмы обязательно');
      const normalizedName = this.normalizeOrganizationName(name);
      const duplicate = await tx.externalCompany.findFirst({ where: { id: { not: companyId }, factoryId: current.factoryId, normalizedName } });
      if (duplicate) throw new ConflictError('Фирма с таким названием уже существует в выбранном заводе');
      if (current.isActive && body.isActive === false && !body.reason?.trim()) throw new ConflictError('Укажите причину отключения фирмы.');
      const updated = await tx.externalCompany.update({
        where: { id: companyId },
        data: {
          name,
          normalizedName,
          ...(typeof body.isActive === 'boolean' ? {
            isActive: body.isActive,
            deactivatedAt: body.isActive ? null : new Date(),
            deactivatedById: body.isActive ? null : user.userId,
            deactivationReason: body.isActive ? null : body.reason?.trim() || null,
          } : {}),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: current.factoryId,
        action: typeof body.isActive === 'boolean' && body.isActive !== current.isActive
          ? (body.isActive ? 'EXTERNAL_COMPANY_RESTORED' : 'EXTERNAL_COMPANY_DEACTIVATED')
          : 'EXTERNAL_COMPANY_UPDATED',
        entityType: 'ExternalCompany',
        entityId: companyId,
        details: { oldValue: { name: current.name, isActive: current.isActive }, newValue: { name: updated.name, isActive: updated.isActive }, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  async organizationIdentityReport(user: UserContext, factoryId = user.selectedFactoryId) {
    this.assertAdminFactoryScope(user, factoryId);
    const [departments, users] = await Promise.all([
      this.prisma.db.department.findMany({
        where: { deletedAt: null, OR: [{ factoryId }, { scope: DepartmentScope.GLOBAL }] },
        include: {
          _count: { select: { userAccess: true, taskRecipients: true, chats: true } },
        },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.db.user.findMany({
        where: { deletedAt: null, OR: [{ phone: { not: null } }, { normalizedPhone: { not: null } }] },
        select: { id: true, phone: true, normalizedPhone: true, lastName: true, firstName: true, middleName: true },
      }),
    ]);
    const departmentGroups = new Map<string, typeof departments>();
    for (const department of departments) {
      const key = `${department.factoryId ?? 'GLOBAL'}:${this.normalizeOrganizationName(department.name)}`;
      departmentGroups.set(key, [...(departmentGroups.get(key) ?? []), department]);
    }
    const duplicateDepartments = [...departmentGroups.values()]
      .filter((items) => items.length > 1)
      .map((items) => ({
        name: items[0].name,
        factoryId: items[0].factoryId,
        canonicalId: items.find((item) => item.isActive)?.id ?? items[0].id,
        duplicates: items.slice(1).map((item) => ({
          id: item.id,
          active: item.isActive,
          impact: {
            users: item._count.userAccess,
            requests: item._count.taskRecipients,
            chats: item._count.chats,
          },
        })),
      }));
    const phoneGroups = new Map<string, string[]>();
    for (const target of users) {
      const canonical = normalizePhone(target.normalizedPhone ?? target.phone ?? '');
      if (!canonical) continue;
      phoneGroups.set(canonical, [...(phoneGroups.get(canonical) ?? []), target.id]);
    }
    const phoneCollisions = [...phoneGroups.values()].filter((ids) => ids.length > 1);
    return {
      factoryId,
      departmentDuplicateGroups: duplicateDepartments,
      phone: {
        collisionGroups: phoneCollisions.length,
        collisionRecords: phoneCollisions.reduce((sum, ids) => sum + ids.length, 0),
        invalidRecords: users.filter((target) => !normalizePhone(target.normalizedPhone ?? target.phone ?? '')).length,
      },
      automaticMergePerformed: false,
      generatedAt: new Date().toISOString(),
    };
  }

  async updateDepartmentStatus(user: UserContext, departmentId: string, body: { isActive: boolean; reason?: string }) {
    this.assertAdmin(user);
    return this.prisma.db.$transaction(async (tx) => {
      const department = await tx.department.findUnique({ where: { id: departmentId } });
      if (!department) throw new ConflictError('department not found');
      if (department.factoryId && department.factoryId !== user.selectedFactoryId) throw new ConflictError('cross-factory access denied');
      if (department.isActive && body.isActive === false) this.assertRecoveryReason(body.reason);
      if (!department.isActive && body.isActive) {
        const duplicate = await tx.department.findFirst({
          where: { id: { not: department.id }, factoryId: department.factoryId, normalizedName: department.normalizedName, isActive: true, deletedAt: null },
        });
        if (duplicate) throw new ConflictError('Активный отдел с таким названием уже существует');
      }
      const updated = await tx.department.update({
        where: { id: departmentId },
        data: {
          isActive: body.isActive,
          deletedAt: body.isActive ? null : new Date(),
          ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: department.factoryId,
        action: body.isActive ? 'DEPARTMENT_RESTORED' : 'DEPARTMENT_DEACTIVATED',
        entityType: 'Department',
        entityId: departmentId,
        details: { oldValue: department.isActive, newValue: updated.isActive, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  async createDepartment(user: UserContext, body: DepartmentBody) {
    this.assertAdmin(user);
    const name = body.name?.trim();
    if (!name) throw new ConflictError('Название отдела обязательно');
    const scope = body.scope === 'GLOBAL' ? DepartmentScope.GLOBAL : DepartmentScope.LOCAL;
    const factoryId = scope === DepartmentScope.GLOBAL ? null : (body.factoryId || user.selectedFactoryId);
    if (factoryId) this.assertAdminFactoryScope(user, factoryId);
    const code = this.normalizeAdminCode(body.code || name);
    const normalizedName = this.normalizeOrganizationName(name);
    if (!code) throw new ConflictError('Код отдела обязателен');
    return this.prisma.db.$transaction(async (tx) => {
      if (factoryId) await this.assertFactoryExistsTx(tx, factoryId);
      const duplicate = await tx.department.findFirst({ where: { factoryId, deletedAt: null, OR: [{ code }, { normalizedName }] } });
      if (duplicate) throw new ConflictError('Отдел или служба с таким названием или кодом уже существует');
      const department = await tx.department.create({
        data: { factoryId, name, normalizedName, code, scope, isActive: body.isActive ?? true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: 'DEPARTMENT_CREATED',
        entityType: 'Department',
        entityId: department.id,
        details: { newValue: department, reason: body.reason ?? null },
      });
      return department;
    });
  }

  async updateDepartment(user: UserContext, departmentId: string, body: DepartmentBody) {
    this.assertAdmin(user);
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.department.findFirst({ where: { id: departmentId, deletedAt: null } });
      if (!current) throw new ConflictError('Отдел или служба не найдены');
      if (current.factoryId) this.assertAdminFactoryScope(user, current.factoryId);
      if (current.factoryId && current.factoryId !== (body.factoryId || current.factoryId)) await this.assertFactoryExistsTx(tx, current.factoryId);
      const scope = body.scope === 'GLOBAL' ? DepartmentScope.GLOBAL : body.scope === 'LOCAL' ? DepartmentScope.LOCAL : current.scope;
      const nextFactoryId = scope === DepartmentScope.GLOBAL ? null : (body.factoryId !== undefined ? body.factoryId : current.factoryId ?? user.selectedFactoryId);
      if (nextFactoryId) this.assertAdminFactoryScope(user, nextFactoryId);
      if (nextFactoryId) await this.assertFactoryExistsTx(tx, nextFactoryId);
      const code = body.code !== undefined ? this.normalizeAdminCode(body.code || current.code) : current.code;
      const name = body.name?.trim() || current.name;
      const normalizedName = this.normalizeOrganizationName(name);
      const duplicate = await tx.department.findFirst({
        where: { id: { not: departmentId }, factoryId: nextFactoryId, deletedAt: null, OR: [{ code }, { normalizedName }] },
      });
      if (duplicate) throw new ConflictError('Отдел или служба с таким названием или кодом уже существует');
      if (current.isActive && body.isActive === false) this.assertRecoveryReason(body.reason);
      const updated = await tx.department.update({
        where: { id: departmentId },
        data: {
          factoryId: nextFactoryId,
          scope,
          code,
          name,
          normalizedName,
          ...(typeof body.isActive === 'boolean' ? {
            isActive: body.isActive,
            deletedAt: body.isActive ? null : new Date(),
            ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
          } : {}),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: updated.factoryId,
        action: typeof body.isActive === 'boolean' && body.isActive !== current.isActive
          ? (body.isActive ? 'DEPARTMENT_REACTIVATED' : 'DEPARTMENT_DEACTIVATED')
          : 'DEPARTMENT_UPDATED',
        entityType: 'Department',
        entityId: departmentId,
        details: { oldValue: current, newValue: updated, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  async jobTitles(user: UserContext, factoryId = user.selectedFactoryId) {
    this.assertAdminFactoryScope(user, factoryId);
    const titles = await this.prisma.db.jobTitle.findMany({
      where: { deletedAt: null, OR: [{ factoryId }, { factoryId: null }] },
      include: { department: true, factory: true, parentJobTitle: true, childJobTitles: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return titles.map((title) => this.serializeJobTitle(title));
  }

  async createJobTitle(user: UserContext, body: JobTitleBody) {
    this.assertAdmin(user);
    const name = body.name?.trim();
    if (!name) throw new ConflictError('Название должности обязательно');
    const baseRole = body.baseRole ?? UserRole.WORKER;
    const shiftDurationHours = this.normalizeJobTitleShiftDuration(body.shiftDurationHours);
    const factoryId = body.factoryId === null ? null : (body.factoryId || user.selectedFactoryId);
    if (factoryId) this.assertAdminFactoryScope(user, factoryId);
    const code = this.normalizeAdminCode(body.code || name);
    return this.prisma.db.$transaction(async (tx) => {
      if (factoryId) await this.assertFactoryExistsTx(tx, factoryId);
      await this.assertDepartmentBelongsToFactoryTx(tx, body.departmentId ?? null, factoryId);
      const parentJobTitle = await this.assertJobTitleParentTx(tx, {
        jobTitleId: null,
        parentJobTitleId: body.parentJobTitleId ?? null,
        factoryId,
        departmentId: body.departmentId ?? null,
      });
      const duplicate = await tx.jobTitle.findFirst({ where: { factoryId, code, deletedAt: null } });
      if (duplicate) throw new ConflictError('Должность с таким кодом уже существует');
      const title = await tx.jobTitle.create({
        data: {
          factoryId,
          departmentId: body.departmentId ?? null,
          parentJobTitleId: parentJobTitle?.id ?? null,
          name,
          code,
          baseRole,
          permissionPreset: body.permissionPreset?.trim() || null,
          description: body.description?.trim() || null,
          shiftDurationHours,
          isActive: body.isActive ?? true,
        },
        include: { department: true, factory: true, parentJobTitle: true, childJobTitles: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: 'JOB_TITLE_CREATED',
        entityType: 'JobTitle',
        entityId: title.id,
        details: { newValue: this.cleanJobTitle(title), reason: body.reason ?? null },
      });
      return this.serializeJobTitle(title);
    });
  }

  async updateJobTitle(user: UserContext, jobTitleId: string, body: JobTitleBody) {
    this.assertAdmin(user);
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.jobTitle.findFirst({ where: { id: jobTitleId }, include: { department: true, factory: true, parentJobTitle: true, childJobTitles: true } });
      if (!current) throw new ConflictError('Должность не найдена');
      if (current.factoryId) this.assertAdminFactoryScope(user, current.factoryId);
      const factoryId = body.factoryId === undefined ? current.factoryId : body.factoryId;
      const nextFactoryId = factoryId === null ? null : (factoryId || user.selectedFactoryId);
      if (nextFactoryId) this.assertAdminFactoryScope(user, nextFactoryId);
      const nextDepartmentId = body.departmentId !== undefined ? body.departmentId : current.departmentId;
      if (nextFactoryId) await this.assertFactoryExistsTx(tx, nextFactoryId);
      await this.assertDepartmentBelongsToFactoryTx(tx, nextDepartmentId, nextFactoryId);
      const parentJobTitle = await this.assertJobTitleParentTx(tx, {
        jobTitleId,
        parentJobTitleId: body.parentJobTitleId === undefined ? current.parentJobTitleId : body.parentJobTitleId,
        factoryId: nextFactoryId,
        departmentId: nextDepartmentId,
      });
      const code = body.code !== undefined ? this.normalizeAdminCode(body.code || current.code) : current.code;
      const shiftDurationHours = this.normalizeJobTitleShiftDuration(body.shiftDurationHours, current.shiftDurationHours);
      const duplicate = await tx.jobTitle.findFirst({ where: { id: { not: jobTitleId }, factoryId: nextFactoryId, code, deletedAt: null } });
      if (duplicate) throw new ConflictError('Должность с таким кодом уже существует');
      if (current.isActive && body.isActive === false) this.assertRecoveryReason(body.reason);
      if (current.isActive && body.isActive === false && current.childJobTitles.some((child: any) => child.isActive && !child.deletedAt)) {
        throw new ConflictError('Сначала отключите или переназначьте подчинённые должности этой ветки.');
      }
      const updated = await tx.jobTitle.update({
        where: { id: jobTitleId },
        data: {
          factoryId: nextFactoryId,
          ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
          parentJobTitleId: parentJobTitle?.id ?? null,
          ...(body.name ? { name: body.name.trim() } : {}),
          code,
          ...(body.baseRole ? { baseRole: body.baseRole } : {}),
          ...(body.permissionPreset !== undefined ? { permissionPreset: body.permissionPreset?.trim() || null } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          shiftDurationHours,
          ...(typeof body.isActive === 'boolean' ? {
            isActive: body.isActive,
            deletedAt: body.isActive ? null : new Date(),
            ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
          } : {}),
        },
        include: { department: true, factory: true, parentJobTitle: true, childJobTitles: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: updated.factoryId,
        action: typeof body.isActive === 'boolean' && body.isActive !== current.isActive
          ? (body.isActive ? 'JOB_TITLE_REACTIVATED' : 'JOB_TITLE_DEACTIVATED')
          : 'JOB_TITLE_UPDATED',
        entityType: 'JobTitle',
        entityId: jobTitleId,
        details: { oldValue: this.cleanJobTitle(current), newValue: this.cleanJobTitle(updated), reason: body.reason ?? null },
      });
      return this.serializeJobTitle(updated);
    });
  }

  private async assertJobTitleScopeTx(tx: Prisma.TransactionClient, jobTitleId: string | null, factoryId: string, departmentId: string | null) {
    if (!jobTitleId) return null;
    const title = await tx.jobTitle.findFirst({
      where: { id: jobTitleId, deletedAt: null },
      include: { department: true, factory: true },
    });
    if (!title || !title.isActive) throw new ConflictError('Должность не найдена или отключена.');
    if ((title.departmentId ?? null) !== (departmentId ?? null)) {
      throw new ConflictError('Должность должна относиться к выбранному отделу.');
    }
    if (title.factoryId && title.factoryId !== factoryId) {
      throw new ConflictError('Должность относится к другому заводу.');
    }
    return title;
  }

  private async assertJobTitleParentTx(
    tx: Prisma.TransactionClient,
    input: { jobTitleId: string | null; parentJobTitleId?: string | null; factoryId: string | null; departmentId: string | null },
  ) {
    const parentJobTitleId = input.parentJobTitleId ?? null;
    if (!parentJobTitleId) return null;
    if (input.jobTitleId && parentJobTitleId === input.jobTitleId) {
      throw new ConflictError('Должность не может подчиняться самой себе.');
    }
    const parent = await tx.jobTitle.findFirst({
      where: { id: parentJobTitleId, deletedAt: null },
      select: { id: true, name: true, factoryId: true, departmentId: true, parentJobTitleId: true, isActive: true },
    });
    if (!parent || !parent.isActive) throw new ConflictError('Родительская должность не найдена или отключена.');
    if ((parent.departmentId ?? null) !== (input.departmentId ?? null)) {
      throw new ConflictError('Родительская должность должна быть из того же отдела.');
    }
    if (input.factoryId === null) {
      if (parent.factoryId !== null) throw new ConflictError('Общая должность не может подчиняться должности конкретного завода.');
    } else if (parent.factoryId && parent.factoryId !== input.factoryId) {
      throw new ConflictError('Родительская должность относится к другому заводу.');
    }

    let cursor = parent.parentJobTitleId;
    const seen = new Set<string>([parent.id]);
    while (cursor) {
      if (input.jobTitleId && cursor === input.jobTitleId) {
        throw new ConflictError('Нельзя создать цикл в дереве должностей.');
      }
      if (seen.has(cursor)) throw new ConflictError('В дереве должностей найден цикл.');
      seen.add(cursor);
      const next = await tx.jobTitle.findUnique({ where: { id: cursor }, select: { id: true, parentJobTitleId: true } });
      cursor = next?.parentJobTitleId ?? null;
    }
    return parent;
  }

  async roles() {
    const rolePermissionCounts = await this.prisma.db.rolePermission.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } });
    const counts = new Map(rolePermissionCounts.map((item) => [item.role, item._count._all]));
    return Object.values(UserRole).map((role) => ({ role, permissionsCount: counts.get(role) ?? 0, system: true }));
  }

  async rolePermissions(role: UserRole) {
    const rows = await this.prisma.db.rolePermission.findMany({ where: { role, isActive: true }, orderBy: { permissionCode: 'asc' } });
    return { role, permissionCodes: rows.map((item) => item.permissionCode) };
  }

  async updateRolePermissions(user: UserContext, role: UserRole, body: { permissionCodes: string[]; reason?: string }) {
    this.assertAdmin(user);
    const preview = await this.previewRolePermissions(user, role, body);
    if (!preview.allowed) throw new ConflictError(preview.reason ?? 'role permission update is not allowed');
    const nextCodes = [...new Set(body.permissionCodes ?? [])].sort();
    const known = await this.prisma.db.permission.findMany({ where: { code: { in: nextCodes } }, select: { code: true } });
    if (known.length !== nextCodes.length) throw new ConflictError('unknown permission code');
    if (role === UserRole.ADMIN && CRITICAL_ADMIN_PERMISSIONS.some((code) => !nextCodes.includes(code))) {
      throw new ConflictError('cannot remove critical admin permissions from ADMIN');
    }
    const result = await this.prisma.db.$transaction(async (tx) => {
      const current = await tx.rolePermission.findMany({ where: { role, isActive: true }, select: { permissionCode: true } });
      const currentCodes = current.map((item) => item.permissionCode).sort();
      const added = nextCodes.filter((code) => !currentCodes.includes(code));
      const removed = currentCodes.filter((code) => !nextCodes.includes(code));
      if (removed.length) {
        await tx.rolePermission.updateMany({ where: { role, permissionCode: { in: removed } }, data: { isActive: false } });
      }
      for (const permissionCode of added) {
        await tx.rolePermission.upsert({
          where: { role_permissionCode: { role, permissionCode } },
          update: { isActive: true },
          create: { role, permissionCode, isActive: true },
        });
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ADMIN_ROLE_PERMISSIONS_CHANGED',
        entityType: 'RolePermission',
        entityId: role,
        details: { role, oldValue: currentCodes, newValue: nextCodes, added, removed, dangerousWarnings: preview.warnings, reason: body.reason ?? null },
      });
      return { role, permissionCodes: nextCodes, added, removed };
    });
    this.wsService.notifyRoleChanged(role);
    return result;
  }

  async previewRolePermissions(user: UserContext, role: UserRole, body: { permissionCodes: string[] }) {
    this.assertAdmin(user);
    const nextPermissions = [...new Set(body.permissionCodes ?? [])].sort();
    const currentPermissions = await this.rolePermissionCodes(role);
    const added = nextPermissions.filter((code) => !currentPermissions.includes(code));
    const removed = currentPermissions.filter((code) => !nextPermissions.includes(code));
    const dangerousRemoved = removed.filter((code) => CRITICAL_ADMIN_PERMISSIONS.includes(code) || code === 'audit.read');
    const adminLikeAdded = added.filter((code) => this.isAdminLikePermission(code));
    const warnings = [
      ...(dangerousRemoved.length ? [`Удаляются критичные права: ${dangerousRemoved.join(', ')}`] : []),
      ...(role === UserRole.ADMIN && CRITICAL_ADMIN_PERMISSIONS.some((code) => !nextPermissions.includes(code)) ? ['Администратор должен сохранять критичные права администрирования.'] : []),
      ...(role !== UserRole.ADMIN && adminLikeAdded.length ? [`Роли добавляются административные или управленческие права: ${adminLikeAdded.join(', ')}`] : []),
      ...(OPERATOR_ROLES.includes(role) && nextPermissions.some((code) => this.isAdminLikePermission(code)) ? ['Работники, наёмные работники и бригадиры не должны получать административные права по умолчанию.'] : []),
      ...(removed.includes('audit.read') ? ['Отключение аудита снижает прозрачность администрирования.'] : []),
    ];
    const allowed = !(role === UserRole.ADMIN && CRITICAL_ADMIN_PERMISSIONS.some((code) => !nextPermissions.includes(code)))
      && !(OPERATOR_ROLES.includes(role) && nextPermissions.some((code) => this.isAdminLikePermission(code)));
    return {
      role,
      currentPermissions,
      nextPermissions,
      added,
      removed,
      dangerousRemoved,
      warnings,
      allowed,
      reason: allowed ? null : 'Permission diff violates admin safety policy.',
    };
  }

  async permissionDelegationContext(user: UserContext, factoryIdOverride?: string) {
    const factoryId = factoryIdOverride || user.selectedFactoryId;
    if (!factoryId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Не выбран завод.' });
    const isFullAdmin = user.isAdmin && user.role === UserRole.ADMIN;
    if (factoryId !== user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя выдавать права в другом заводе.' });
    }
    if (!isFullAdmin && !user.departmentId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Делегирование доступно только внутри своего отдела.' });
    }

    const accessWhere: Prisma.UserFactoryAccessWhereInput = {
      factoryId,
      isActive: true,
      user: { deletedAt: null, blockedAt: null },
      role: { notIn: NON_DELEGATABLE_ROLES },
      ...(isFullAdmin ? {} : { OR: [{ departmentId: user.departmentId }, { isGuest: true }] }),
    };
    const sourceWhere: Prisma.UserFactoryAccessWhereInput = {
      ...accessWhere,
      isGuest: false,
      ...(isFullAdmin ? {} : { departmentId: user.departmentId }),
    };
    const [factory, sourceAccesses, targetAccesses] = await Promise.all([
      this.prisma.db.factory.findFirst({ where: { id: factoryId, deletedAt: null }, select: { id: true, name: true, code: true } }),
      this.prisma.db.userFactoryAccess.findMany({
        where: sourceWhere,
        include: { user: true, department: true, jobTitle: true },
        orderBy: [{ role: 'asc' }, { userId: 'asc' }],
      }),
      this.prisma.db.userFactoryAccess.findMany({
        where: accessWhere,
        include: { user: true, department: true, jobTitle: true },
        orderBy: [{ isGuest: 'desc' }, { role: 'asc' }, { userId: 'asc' }],
      }),
    ]);
    if (!factory) throw new ConflictError('Завод не найден.');

    const actorEffective = isFullAdmin ? [] : await this.effectivePermissionCodes(user.userId, factoryId, user.role as UserRole);
    const actorAccess = isFullAdmin ? null : await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId } },
      include: { jobTitle: true },
    });
    const visibleSourceAccesses = [];
    for (const access of sourceAccesses) {
      if (isPilotFixtureUser(access.user)) continue;
      const decision = isFullAdmin ? { allowed: true } : await this.canDelegateSourceAccess(user, factoryId, access, actorEffective, actorAccess);
      if (decision.allowed) visibleSourceAccesses.push(access);
    }
    const visibleTargetAccesses = [];
    for (const access of targetAccesses) {
      if (isPilotFixtureUser(access.user)) continue;
      const decision = isFullAdmin ? { allowed: true } : await this.canDelegateTargetAccess(user, factoryId, access, actorAccess);
      if (decision.allowed) visibleTargetAccesses.push(access);
    }
    const candidates = (items: any[]) => items.map((access) => this.serializeDelegationCandidate(access));

    return {
      factory,
      actor: {
        userId: user.userId,
        role: user.role,
        departmentId: user.departmentId,
        jobTitleId: actorAccess?.jobTitleId ?? null,
        jobTitleName: actorAccess?.jobTitle?.name ?? null,
        fullAdmin: isFullAdmin,
      },
      sourceCandidates: candidates(visibleSourceAccesses),
      targetCandidates: candidates(visibleTargetAccesses),
      warnings: [
        ...(isFullAdmin ? [] : ['Можно назначать только в своём отделе, только в выбранном заводе и только на уровень ниже.']),
        'Недоступные выдающему пользователю и административные права не копируются.',
      ],
    };
  }

  async permissionCopyPreview(user: UserContext, sourceUserId: string, targetUserId: string, body: PermissionCopyBody = {}) {
    const plan = await this.permissionCopyPlan(user, sourceUserId, targetUserId, body);
    return this.serializePermissionCopyPlan(plan);
  }

  async permissionCopyApply(user: UserContext, sourceUserId: string, targetUserId: string, body: PermissionCopyBody = {}) {
    const plan = await this.permissionCopyPlan(user, sourceUserId, targetUserId, body);
    if (!plan.allowed) throw new ConflictError(plan.reason ?? 'Делегирование прав сейчас недоступно.');

    const result = await this.prisma.db.$transaction(async (tx) => {
      const updatedAccess = await tx.userFactoryAccess.update({
        where: { userId_factoryId: { userId: targetUserId, factoryId: plan.factoryId } },
        data: {
          role: plan.nextRole,
          departmentId: plan.nextDepartmentId,
          jobTitleId: plan.nextJobTitleId,
          isGuest: false,
          isActive: true,
        },
        include: { factory: true, department: true, user: true, jobTitle: true },
      });
      await tx.user.update({ where: { id: targetUserId }, data: { role: plan.nextRole } });

      const targetRoleBase = new Set(plan.targetRoleBaseCodes);
      const desired = new Set(plan.desiredCodes);
      let upsertedAllows = 0;
      let upsertedDenies = 0;
      let deletedOverrides = 0;

      for (const permissionCode of plan.syncPermissionCodes) {
        const shouldHave = desired.has(permissionCode);
        const inRoleBase = targetRoleBase.has(permissionCode);
        if (shouldHave && !inRoleBase) {
          await tx.userPermissionOverride.upsert({
            where: { userId_factoryId_permissionCode: { userId: targetUserId, factoryId: plan.factoryId, permissionCode } },
            update: { effect: PermissionEffect.ALLOW },
            create: { userId: targetUserId, factoryId: plan.factoryId, permissionCode, effect: PermissionEffect.ALLOW },
          });
          upsertedAllows += 1;
          continue;
        }
        if (!shouldHave && inRoleBase) {
          await tx.userPermissionOverride.upsert({
            where: { userId_factoryId_permissionCode: { userId: targetUserId, factoryId: plan.factoryId, permissionCode } },
            update: { effect: PermissionEffect.DENY },
            create: { userId: targetUserId, factoryId: plan.factoryId, permissionCode, effect: PermissionEffect.DENY },
          });
          upsertedDenies += 1;
          continue;
        }
        const deleted = await tx.userPermissionOverride.deleteMany({
          where: { userId: targetUserId, factoryId: plan.factoryId, permissionCode },
        });
        deletedOverrides += deleted.count;
      }

      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: plan.factoryId,
        action: 'ADMIN_USER_PERMISSION_DELEGATED',
        entityType: 'User',
        entityId: targetUserId,
        details: {
          sourceUserId,
          targetUserId,
          oldAccess: plan.oldAccess,
          newAccess: this.cleanAccess(updatedAccess),
          addedCount: plan.added.length,
          removedCount: plan.removed.length,
          hiddenCount: plan.hiddenCount,
          grantedPermissions: plan.desiredCodes,
          addedPermissions: plan.added,
          removedPermissions: plan.removed,
          sourceRole: plan.source.role,
          nextRole: plan.nextRole,
          nextDepartmentId: plan.nextDepartmentId,
          nextDepartmentName: plan.nextDepartmentName,
          nextJobTitleId: plan.nextJobTitleId,
          nextJobTitleName: plan.nextJobTitleName,
          sourceJobTitleId: plan.source.jobTitleId,
          sourceJobTitleName: plan.source.jobTitleName,
          previousJobTitleId: plan.oldAccess.jobTitleId ?? null,
          previousJobTitleName: plan.oldAccess.jobTitleName ?? null,
          jobTitleHierarchy: plan.jobTitleHierarchy,
          upsertedAllows,
          upsertedDenies,
          deletedOverrides,
          reason: body.reason?.trim() || null,
        },
      });

      return {
        ok: true,
        access: this.serializeAccess(updatedAccess),
        nextAccess: {
          role: plan.nextRole,
          departmentId: plan.nextDepartmentId,
          departmentName: plan.nextDepartmentName,
          jobTitleId: plan.nextJobTitleId,
          jobTitleName: plan.nextJobTitleName,
          isGuest: false,
        },
        added: plan.added,
        removed: plan.removed,
        hiddenCount: plan.hiddenCount,
        jobTitleHierarchy: plan.jobTitleHierarchy,
        changedOverrides: { upsertedAllows, upsertedDenies, deletedOverrides },
      };
    });
    this.wsService.notifyAuthChanged(targetUserId, plan.factoryId);
    return result;
  }

  private async legacyPermissionCopyPreview(_user: UserContext, sourceUserId: string, targetUserId: string) {
    const [source, target] = await Promise.all([
      this.prisma.db.userFactoryAccess.findFirst({ where: { userId: sourceUserId, isActive: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.db.userFactoryAccess.findFirst({ where: { userId: targetUserId, isActive: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    if (!source || !target) throw new ConflictError('source or target access not found');
    const [sourcePerms, targetPerms] = await Promise.all([
      this.prisma.db.rolePermission.findMany({ where: { role: source.role, isActive: true }, select: { permissionCode: true } }),
      this.prisma.db.rolePermission.findMany({ where: { role: target.role, isActive: true }, select: { permissionCode: true } }),
    ]);
    const sourceCodes = sourcePerms.map((item) => item.permissionCode).sort();
    const targetCodes = targetPerms.map((item) => item.permissionCode).sort();
    return {
      sourceUserId,
      targetUserId,
      allowedAdds: sourceCodes.filter((code) => !targetCodes.includes(code)),
      allowedRemoves: targetCodes.filter((code) => !sourceCodes.includes(code)),
      blockedAdds: [],
      blockedRemoves: [],
      warnings: ['Это только предпросмотр. Права этим запросом не меняются.'],
    };
  }

  private async permissionCopyPlan(user: UserContext, sourceUserId: string, targetUserId: string, body: PermissionCopyBody) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    if (!factoryId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Не выбран завод.' });
    if (!sourceUserId || !targetUserId) throw new ConflictError('Выберите пользователя-образец и получателя прав.');
    if (sourceUserId === targetUserId) throw new ConflictError('Нельзя копировать права пользователя самому себе.');

    const isFullAdmin = user.isAdmin && user.role === UserRole.ADMIN;
    if (factoryId !== user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя выдавать права в другом заводе.' });
    }

    const [sourceAccess, targetAccess] = await Promise.all([
      this.prisma.db.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId: sourceUserId, factoryId } },
        include: { user: true, department: true, factory: true, jobTitle: true },
      }),
      this.prisma.db.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId: targetUserId, factoryId } },
        include: { user: true, department: true, factory: true, jobTitle: true },
      }),
    ]);
    if (!sourceAccess || !targetAccess) throw new ConflictError('Доступ пользователя-образца или получателя к выбранному заводу не найден.');
    if (!sourceAccess.isActive || !targetAccess.isActive) throw new ConflictError('Доступ пользователя к выбранному заводу отключён.');
    if (sourceAccess.user.deletedAt || sourceAccess.user.blockedAt || targetAccess.user.deletedAt || targetAccess.user.blockedAt) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нельзя делегировать права заблокированному или удалённому пользователю.' });
    }
    if (NON_DELEGATABLE_ROLES.includes(sourceAccess.role) || NON_DELEGATABLE_ROLES.includes(targetAccess.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'ADMIN и руководство не участвуют в копировании прав по образцу.' });
    }

    const [sourceEffective, targetEffective, sourceRoleBase, targetCurrentBase, targetRoleBase, actorEffective, actorAccess] = await Promise.all([
      this.effectivePermissionCodes(sourceUserId, factoryId, sourceAccess.role),
      this.effectivePermissionCodes(targetUserId, factoryId, targetAccess.role),
      this.rolePermissionCodes(sourceAccess.role),
      this.rolePermissionCodes(targetAccess.role),
      this.rolePermissionCodes(sourceAccess.role),
      isFullAdmin ? Promise.resolve([]) : this.effectivePermissionCodes(user.userId, factoryId, user.role as UserRole),
      isFullAdmin ? Promise.resolve(null) : this.prisma.db.userFactoryAccess.findUnique({
        where: { userId_factoryId: { userId: user.userId, factoryId } },
        include: { jobTitle: true },
      }),
    ]);

    if (!isFullAdmin) {
      if (!user.departmentId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'У выдающего пользователя не задан отдел.' });
      if (sourceAccess.departmentId !== user.departmentId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Пользователь-образец должен быть из вашего отдела.' });
      }
      const sourceHierarchy = await this.canDelegateSourceByHierarchy(user, factoryId, actorEffective, sourceAccess, sourceEffective, sourceRoleBase, actorAccess);
      if (!sourceHierarchy.allowed) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: sourceHierarchy.reason ?? 'Можно назначать только подчинённые должности и права ниже своих.' });
      }
      if (!targetAccess.isGuest && targetAccess.departmentId !== user.departmentId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Получатель должен быть гостем или сотрудником вашего отдела.' });
      }
      const targetHierarchy = await this.canDelegateTargetByHierarchy(user, factoryId, targetAccess, targetEffective, actorAccess);
      if (!targetHierarchy.allowed) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: targetHierarchy.reason ?? 'Нельзя изменять права равного или вышестоящего сотрудника.' });
      }
    }

    const sourceHierarchy = isFullAdmin
      ? { allowed: true, checked: false, mode: 'legacy-role', reason: null } as DelegationHierarchyDecision
      : await this.canDelegateSourceByHierarchy(user, factoryId, actorEffective, sourceAccess, sourceEffective, sourceRoleBase, actorAccess);
    const targetHierarchy = isFullAdmin
      ? { allowed: true, checked: false, mode: 'legacy-role', reason: null } as DelegationHierarchyDecision
      : await this.canDelegateTargetByHierarchy(user, factoryId, targetAccess, targetEffective, actorAccess);

    const actorPermissions = new Set(user.permissions);
    const canTouchPermission = (code: string) => this.isDepartmentDelegatablePermission(code) && (isFullAdmin || actorPermissions.has(code));
    const sourceAllowed = sourceEffective.filter(canTouchPermission);
    const desiredCodes = [...new Set(sourceAllowed)].sort();
    const currentDelegatable = targetEffective.filter(canTouchPermission).sort();
    const hiddenCount = sourceEffective.filter((code) => !desiredCodes.includes(code)).length;
    const added = desiredCodes.filter((code) => !currentDelegatable.includes(code));
    const removed = currentDelegatable.filter((code) => !desiredCodes.includes(code));
    const syncPermissionCodes = Array.from(new Set([
      ...desiredCodes,
      ...currentDelegatable,
      ...sourceRoleBase.filter(canTouchPermission),
      ...targetCurrentBase.filter(canTouchPermission),
      ...targetRoleBase.filter(canTouchPermission),
    ])).sort();

    return {
      factoryId,
      sourceUserId,
      targetUserId,
      source: this.serializeDelegationCandidate(sourceAccess),
      target: this.serializeDelegationCandidate(targetAccess),
      oldAccess: this.cleanAccess(targetAccess),
      nextRole: sourceAccess.role,
      nextDepartmentId: sourceAccess.departmentId,
      nextDepartmentName: sourceAccess.department?.name ?? null,
      nextJobTitleId: sourceAccess.jobTitleId ?? null,
      nextJobTitleName: sourceAccess.jobTitle?.name ?? null,
      jobTitleHierarchy: {
        source: sourceHierarchy,
        target: targetHierarchy,
        checked: sourceHierarchy.checked || targetHierarchy.checked,
      },
      sourceEffective,
      targetEffective,
      desiredCodes,
      targetRoleBaseCodes: targetRoleBase,
      syncPermissionCodes,
      added,
      removed,
      hiddenCount,
      allowed: true,
      reason: null as string | null,
      warnings: [
        ...(hiddenCount ? [`Скрыто прав, которые нельзя выдать этим действием: ${hiddenCount}.`] : []),
        ...(targetAccess.isGuest ? ['Получатель перестанет быть гостем выбранного завода.'] : []),
        'Копируются только права выбранного завода и доступного отдела.',
      ],
    };
  }

  private async canDelegateSourceAccess(user: UserContext, factoryId: string, access: any, actorEffective: string[], actorAccess?: any) {
    if (access.isGuest || access.departmentId !== user.departmentId) return { allowed: false, checked: false, mode: 'denied', reason: 'Источник должен быть сотрудником вашего отдела.' } as DelegationHierarchyDecision;
    if (NON_DELEGATABLE_ROLES.includes(access.role)) return { allowed: false, checked: false, mode: 'denied', reason: 'Эта роль не участвует в делегировании.' } as DelegationHierarchyDecision;
    const [sourceEffective, sourceRoleBase] = await Promise.all([
      this.effectivePermissionCodes(access.userId, factoryId, access.role),
      this.rolePermissionCodes(access.role),
    ]);
    return this.canDelegateSourceByHierarchy(user, factoryId, actorEffective, access, sourceEffective, sourceRoleBase, actorAccess);
  }

  private async canDelegateTargetAccess(user: UserContext, factoryId: string, access: any, actorAccess?: any) {
    if (NON_DELEGATABLE_ROLES.includes(access.role)) return { allowed: false, checked: false, mode: 'denied', reason: 'Эта роль не участвует в делегировании.' } as DelegationHierarchyDecision;
    if (access.isGuest) return { allowed: true, checked: false, mode: 'legacy-role', reason: null } as DelegationHierarchyDecision;
    const targetEffective = await this.effectivePermissionCodes(access.userId, factoryId, access.role);
    return this.canDelegateTargetByHierarchy(user, factoryId, access, targetEffective, actorAccess);
  }

  private async canDelegateSourceByHierarchy(
    user: UserContext,
    _factoryId: string,
    actorEffective: string[],
    sourceAccess: any,
    sourceEffective: string[],
    _sourceRoleBase: string[],
    actorAccess?: any,
  ): Promise<DelegationHierarchyDecision> {
    if (!actorEffective.includes(DELEGATION_AUTHORITY_PERMISSION)) {
      return { allowed: false, checked: false, mode: 'denied', reason: 'У выдающего пользователя нет права управлять сотрудниками отдела.' };
    }
    const treeDecision = await this.jobTitleTreeDecision(actorAccess, sourceAccess);
    if (treeDecision.checked) {
      if (!treeDecision.allowed) return treeDecision;
      return treeDecision;
    }
    if (sourceEffective.includes(DELEGATION_AUTHORITY_PERMISSION)) {
      return { allowed: false, checked: false, mode: 'legacy-role', reason: 'Образец имеет право управлять людьми, а формальная подчинённость должностей не задана.' };
    }
    if (sourceAccess.role === user.role) {
      return { allowed: true, checked: false, mode: 'legacy-role', reason: null };
    }
    if (DELEGATABLE_OPERATOR_ROLES.includes(sourceAccess.role) && OPERATIONAL_DELEGATION_PERMISSIONS.some((code) => actorEffective.includes(code))) {
      return { allowed: true, checked: false, mode: 'legacy-role', reason: null };
    }
    return { allowed: false, checked: false, mode: 'legacy-role', reason: 'Можно назначать только подчинённые должности или безопасные роли ниже своей.' };
  }

  private async canDelegateTargetByHierarchy(
    _user: UserContext,
    _factoryId: string,
    access: any,
    targetEffective: string[],
    actorAccess?: any,
  ): Promise<DelegationHierarchyDecision> {
    if (access.isGuest) return { allowed: true, checked: false, mode: 'legacy-role', reason: null };
    if (NON_DELEGATABLE_ROLES.includes(access.role)) return { allowed: false, checked: false, mode: 'denied', reason: 'Эта роль не участвует в делегировании.' };
    if (targetEffective.includes(DELEGATION_AUTHORITY_PERMISSION)) {
      return { allowed: false, checked: false, mode: 'legacy-role', reason: 'Получатель уже имеет право управлять людьми. Этот сценарий нельзя менять через копирование прав.' };
    }
    const treeDecision = await this.jobTitleTreeDecision(actorAccess, access);
    if (treeDecision.checked) return treeDecision;
    return { allowed: true, checked: false, mode: 'legacy-role', reason: null };
  }

  private async jobTitleTreeDecision(
    actorAccess: any,
    candidateAccess: any,
    db: AdminDb = this.prisma.db,
  ): Promise<DelegationHierarchyDecision> {
    if (!actorAccess?.jobTitleId || !candidateAccess?.jobTitleId) {
      return {
        allowed: true,
        checked: false,
        mode: 'fallback-no-job-title',
        reason: null,
        actorJobTitleId: actorAccess?.jobTitleId ?? null,
        candidateJobTitleId: candidateAccess?.jobTitleId ?? null,
      };
    }
    const base = {
      checked: true,
      actorJobTitleId: actorAccess.jobTitleId,
      candidateJobTitleId: candidateAccess.jobTitleId,
    };
    if (actorAccess.factoryId !== candidateAccess.factoryId || (actorAccess.departmentId ?? null) !== (candidateAccess.departmentId ?? null)) {
      return { ...base, allowed: false, mode: 'job-title-tree', reason: 'Должность должна быть внутри вашего отдела и завода.' };
    }
    if (actorAccess.jobTitleId === candidateAccess.jobTitleId) {
      return { ...base, allowed: false, mode: 'job-title-tree', reason: 'Нельзя назначать равную должность.' };
    }
    const isLower = await this.isJobTitleDescendant(candidateAccess.jobTitleId, actorAccess.jobTitleId, db);
    return {
      ...base,
      allowed: isLower,
      mode: 'job-title-tree',
      reason: isLower ? null : 'Можно назначать только должности ниже вашей в дереве подчинения.',
    };
  }

  private async isJobTitleDescendant(
    candidateJobTitleId: string,
    ancestorJobTitleId: string,
    db: AdminDb = this.prisma.db,
  ) {
    let cursor: string | null = candidateJobTitleId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      const title: { id: string; parentJobTitleId: string | null; deletedAt: Date | null } | null = await db.jobTitle.findUnique({
        where: { id: cursor },
        select: { id: true, parentJobTitleId: true, deletedAt: true },
      });
      if (!title || title.deletedAt) return false;
      if (title.parentJobTitleId === ancestorJobTitleId) return true;
      cursor = title.parentJobTitleId;
    }
    return false;
  }

  private serializePermissionCopyPlan(plan: Awaited<ReturnType<AdminService['permissionCopyPlan']>>) {
    return {
      sourceUserId: plan.sourceUserId,
      targetUserId: plan.targetUserId,
      factoryId: plan.factoryId,
      source: plan.source,
      target: plan.target,
      nextAccess: {
        role: plan.nextRole,
        departmentId: plan.nextDepartmentId,
        departmentName: plan.nextDepartmentName,
        jobTitleId: plan.nextJobTitleId,
        jobTitleName: plan.nextJobTitleName,
        isGuest: false,
      },
      added: plan.added,
      removed: plan.removed,
      grantedPermissions: plan.desiredCodes,
      allowedAdds: plan.added,
      allowedRemoves: plan.removed,
      hiddenCount: plan.hiddenCount,
      blockedAdds: [],
      blockedRemoves: [],
      warnings: plan.warnings,
      allowed: plan.allowed,
      reason: plan.reason,
      jobTitleHierarchy: plan.jobTitleHierarchy,
    };
  }

  private async effectivePermissionCodes(
    userId: string,
    factoryId: string,
    role: UserRole,
    db: AdminDb = this.prisma.db,
  ) {
    const [rolePermissions, overrides] = await Promise.all([
      db.rolePermission.findMany({ where: { role, isActive: true }, select: { permissionCode: true } }),
      db.userPermissionOverride.findMany({
        where: { userId, OR: [{ factoryId }, { factoryId: null }] },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return resolveEffectivePermissions({
      role,
      isGuest: false,
      rolePermissionCodes: rolePermissions.map((item) => item.permissionCode),
      overrides,
    });
  }

  private serializeDelegationCandidate(access: any) {
    return {
      userId: access.userId,
      displayName: pilotDisplayName(access.user),
      role: access.role,
      departmentId: access.departmentId,
      departmentName: access.department?.name ?? null,
      jobTitleId: access.jobTitleId ?? null,
      jobTitleName: access.jobTitle?.name ?? null,
      phoneLabel: access.user?.normalizedPhone || access.user?.phone
        ? maskPhone(access.user.normalizedPhone ?? access.user.phone)
        : null,
      isGuest: access.isGuest,
      isActive: access.isActive,
    };
  }

  private isDepartmentDelegatablePermission(code: string) {
    if (NON_DELEGATABLE_PERMISSION_EXACT.has(code)) return false;
    if (NON_DELEGATABLE_PERMISSION_PREFIXES.some((prefix) => code.startsWith(prefix) || code === prefix)) return false;
    if (code.endsWith('.manage')) return false;
    if (code.includes('.settings.')) return false;
    return !this.isAdminLikePermission(code);
  }

  async permissions() {
    const permissions = await this.prisma.db.permission.findMany({ orderBy: { code: 'asc' } });
    return permissions.map((permission) => ({
      id: permission.id,
      code: permission.code,
      group: permission.code.split('.')[0],
      description: permission.description,
    }));
  }

  async linesConfig(user: UserContext, factoryId = user.selectedFactoryId) {
    this.assertAdminFactoryScope(user, factoryId);
    const lines = await this.prisma.db.line.findMany({
      where: { factoryId },
      include: {
        positions: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        staffingTemplates: { include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { name: 'asc' },
    });
    return lines.map((line) => this.serializeLineConfig(line));
  }

  async staffingControlContext(user: UserContext) {
    const decision = await this.staffingControlPolicy.decision(user);
    const factory = await this.prisma.db.factory.findFirst({
      where: { id: user.selectedFactoryId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
    });
    if (!factory) throw new ConflictError('Выбранный завод не найден');
    if (!decision.allowed) {
      return { ...decision, factory, lines: [] };
    }
    const lines = await this.prisma.db.line.findMany({
      where: { factoryId: user.selectedFactoryId, deletedAt: null, deactivatedAt: null },
      include: {
        positions: {
          where: { isActive: true, deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        staffingTemplates: {
          where: { isActive: true, deletedAt: null },
          include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    return { ...decision, factory, lines: lines.map((line) => this.serializeLineConfig(line)) };
  }

  async createStaffingControlTemplate(user: UserContext, lineId: string, body: StaffingTemplateBody) {
    await this.staffingControlPolicy.assertCanManage(user);
    if (!body.name?.trim() || !body.items?.length) throw new ConflictError('Укажите название и хотя бы одну позицию состава');
    return this.lineService.createStaffingTemplate(user, lineId, {
      name: body.name.trim(),
      isActive: body.isActive,
      items: this.strictStaffingItems(body.items),
    });
  }

  async updateStaffingControlTemplate(user: UserContext, lineId: string, templateId: string, body: StaffingTemplateBody) {
    await this.staffingControlPolicy.assertCanManage(user);
    await this.assertStaffingTemplateEditSafe(user, lineId, templateId, body);
    if (!body.name?.trim() || !body.items?.length) throw new ConflictError('Укажите название и хотя бы одну позицию состава');
    return this.lineService.updateStaffingTemplate(user, lineId, templateId, {
      name: body.name.trim(),
      isActive: body.isActive,
      items: this.strictStaffingItems(body.items),
    });
  }

  async previewStaffingControlDefault(user: UserContext, lineId: string, templateId: string) {
    await this.staffingControlPolicy.assertCanManage(user);
    return this.lineService.previewTemplateActivation(user, lineId, { staffingTemplateId: templateId });
  }

  async setStaffingControlDefault(
    user: UserContext,
    lineId: string,
    templateId: string,
    body: { expectedVersion?: number | null; operationId?: string | null; confirmRemap?: boolean },
  ) {
    await this.staffingControlPolicy.assertCanManage(user);
    return this.lineService.activateTemplate(user, lineId, {
      staffingTemplateId: templateId,
      expectedVersion: body.expectedVersion,
      operationId: body.operationId,
      confirmRemap: body.confirmRemap,
    });
  }

  private async assertStaffingTemplateEditSafe(
    user: UserContext,
    lineId: string,
    templateId: string,
    body: StaffingTemplateBody,
  ) {
    if (!body.items) return;
    const template = await this.prisma.db.lineStaffingTemplate.findFirst({
      where: { id: templateId, lineId, factoryId: user.selectedFactoryId, deletedAt: null },
      include: { items: true, line: true },
    });
    if (!template) throw new ConflictError('Шаблон состава не найден');

    const fingerprint = (items: Array<any>) => JSON.stringify(items
      .map((item) => ({
        positionId: item.positionId,
        requiredCount: Number(item.requiredCount ?? item.defaultPlanned ?? item.plannedCount ?? 1),
        minRequired: Number(item.minRequired ?? item.requiredCount ?? 1),
        defaultPlanned: Number(item.defaultPlanned ?? item.plannedCount ?? item.requiredCount ?? 1),
        maxRequired: Number(item.maxRequired ?? item.requiredCount ?? 1),
        isExtraSlot: Boolean(item.isExtraSlot),
        doesNotAffectShortage: Boolean(item.doesNotAffectShortage),
      }))
      .sort((left, right) => left.positionId.localeCompare(right.positionId)));
    if (fingerprint(template.items) === fingerprint(body.items)) return;

    const [activeAssignments, plannedAssignments, workPlans, shiftStates] = await Promise.all([
      this.prisma.db.assignment.count({
        where: { factoryId: user.selectedFactoryId, lineId, endedAt: null, staffingTemplateId: templateId },
      }),
      this.prisma.db.plannedLineAssignment.count({
        where: { factoryId: user.selectedFactoryId, lineId, releasedAt: null, staffingTemplateId: templateId },
      }),
      this.prisma.db.lineShiftWorkPlan.count({
        where: { factoryId: user.selectedFactoryId, lineId, staffingTemplateId: templateId },
      }),
      this.prisma.db.lineShiftState.count({
        where: { factoryId: user.selectedFactoryId, lineId, staffingTemplateId: templateId },
      }),
    ]);
    if (template.line.defaultStaffingTemplateId === templateId
      || activeAssignments
      || plannedAssignments
      || workPlans
      || shiftStates) {
      throw new ConflictError('Этот состав уже используется. Дублируйте шаблон, измените копию и сделайте её основной через предварительную проверку перестановок.');
    }
  }

  private strictStaffingItems(items: StaffingTemplateItemBody[]) {
    return items.map((item) => ({
      ...item,
      minRequired: item.minRequired ?? undefined,
      maxRequired: item.maxRequired ?? undefined,
      defaultPlanned: item.defaultPlanned ?? undefined,
      plannedCount: item.plannedCount ?? undefined,
    }));
  }

  async lineConfig(user: UserContext, lineId: string) {
    this.assertAdmin(user);
    const line = await this.prisma.db.line.findFirst({
      where: { id: lineId, factoryId: user.selectedFactoryId },
      include: {
        positions: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        staffingTemplates: { include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } } },
      },
    });
    if (!line) throw new ConflictError('line not found');
    return this.serializeLineConfig(line);
  }

  async createLine(user: UserContext, body: LineBody) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const name = body.name?.trim();
    if (!name) throw new ConflictError('Название линии обязательно');
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertFactoryExistsTx(tx, factoryId);
      const duplicate = await tx.line.findFirst({ where: { factoryId, name, deletedAt: null } });
      if (duplicate) throw new ConflictError('Линия с таким названием уже существует');
      const line = await tx.line.create({
        data: { factoryId, name, status: 'STOP', deletedAt: body.isActive === false ? new Date() : null },
        include: { positions: true, staffingTemplates: { include: { items: { include: { position: true } } } } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: 'LINE_CREATED',
        entityType: 'Line',
        entityId: line.id,
        details: { newValue: { id: line.id, name: line.name, status: line.status, active: !line.deletedAt }, reason: body.reason ?? null },
      });
      return this.serializeLineConfig(line);
    });
  }

  async updateLine(user: UserContext, lineId: string, body: LineBody) {
    this.assertAdmin(user);
    if (body.status) {
      throw new ConflictError('Рабочий статус линии меняется только в разделе «Линии».');
    }
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.line.findFirst({
        where: { id: lineId, factoryId: user.selectedFactoryId },
        include: { positions: true, staffingTemplates: { include: { items: { include: { position: true } } } } },
      });
      if (!current) throw new ConflictError('Линия не найдена');
      const nextName = body.name?.trim() || current.name;
      const duplicate = await tx.line.findFirst({ where: { id: { not: lineId }, factoryId: current.factoryId, name: nextName, deletedAt: null } });
      if (duplicate) throw new ConflictError('Линия с таким названием уже существует');
      if (!current.deletedAt && body.isActive === false) this.assertRecoveryReason(body.reason);
      const updated = await tx.line.update({
        where: { id: lineId },
        data: {
          name: nextName,
          ...(typeof body.isActive === 'boolean' ? {
            deletedAt: body.isActive ? null : new Date(),
            ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
          } : {}),
          version: { increment: 1 },
        },
        include: { positions: true, staffingTemplates: { include: { items: { include: { position: true } } } } },
      });
      const activeChanged = typeof body.isActive === 'boolean' && Boolean(!current.deletedAt) !== body.isActive;
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: current.factoryId,
        action: activeChanged ? (body.isActive ? 'LINE_REACTIVATED' : 'LINE_DEACTIVATED') : 'LINE_UPDATED',
        entityType: 'Line',
        entityId: lineId,
        details: {
          oldValue: { id: current.id, name: current.name, status: current.status, active: !current.deletedAt },
          newValue: { id: updated.id, name: updated.name, status: updated.status, active: !updated.deletedAt },
          reason: body.reason ?? null,
        },
      });
      return this.serializeLineConfig(updated);
    });
  }

  async linePositions(user: UserContext, lineId: string) {
    return (await this.lineConfig(user, lineId)).positions;
  }

  async lineTemplates(user: UserContext, lineId: string) {
    return (await this.lineConfig(user, lineId)).staffingTemplates;
  }

  async createPosition(user: UserContext, lineId: string, body: LinePositionBody) {
    this.assertAdmin(user);
    if (!body.name?.trim()) throw new ConflictError('Название позиции обязательно');
    const name = body.name.trim();
    const displayName = body.displayName?.trim() || name;
    return this.prisma.db.$transaction(async (tx) => {
      const line = await tx.line.findFirst({ where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null } });
      if (!line) throw new ConflictError('Линия не найдена');
      const normalizedName = this.normalizePositionName(displayName);
      const position = await tx.linePosition.create({
        data: {
          factoryId: line.factoryId,
          lineId,
          name,
          displayName,
          normalizedName,
          skillCode: body.skillCode?.trim() || normalizedName,
          skillFamilyKey: body.skillFamilyKey?.trim() || normalizedName,
          isExtraSlot: Boolean(body.isExtraSlot),
          doesNotAffectShortage: Boolean(body.doesNotAffectShortage),
          isFlexibleSkillGroup: Boolean(body.isFlexibleSkillGroup),
          sortOrder: body.sortOrder ?? 0,
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: line.factoryId,
        action: 'LINE_POSITION_CREATED',
        entityType: 'LinePosition',
        entityId: position.id,
        details: { lineId, newValue: position },
      });
      return position;
    });
  }

  async updatePosition(user: UserContext, lineId: string, positionId: string, body: LinePositionBody) {
    this.assertAdmin(user);
    return this.prisma.db.$transaction(async (tx) => {
      const position = await tx.linePosition.findFirst({
        where: { id: positionId, lineId, factoryId: user.selectedFactoryId },
        include: { line: true },
      });
      if (!position) throw new ConflictError('Позиция не найдена');
      if (body.isActive === false) {
        this.assertRecoveryReason(body.reason);
        const activeAssignments = await tx.assignment.count({ where: { positionId, endedAt: null } });
        if (activeAssignments > 0) throw new ConflictError('Нельзя отключить позицию с активными назначениями');
      }
      const nextName = body.name?.trim() || position.name;
      const nextDisplayName = body.displayName !== undefined ? body.displayName?.trim() || null : position.displayName;
      const normalizedName = body.name || body.displayName ? this.normalizePositionName(nextDisplayName || nextName) : position.normalizedName;
      const updated = await tx.linePosition.update({
        where: { id: positionId },
        data: {
          name: nextName,
          displayName: nextDisplayName,
          normalizedName,
          ...(body.skillCode !== undefined ? { skillCode: body.skillCode?.trim() || null } : {}),
          ...(body.skillFamilyKey !== undefined ? { skillFamilyKey: body.skillFamilyKey?.trim() || null } : {}),
          ...(typeof body.isExtraSlot === 'boolean' ? { isExtraSlot: body.isExtraSlot } : {}),
          ...(typeof body.doesNotAffectShortage === 'boolean' ? { doesNotAffectShortage: body.doesNotAffectShortage } : {}),
          ...(typeof body.isFlexibleSkillGroup === 'boolean' ? { isFlexibleSkillGroup: body.isFlexibleSkillGroup } : {}),
          ...(typeof body.sortOrder === 'number' ? { sortOrder: body.sortOrder } : {}),
          ...(typeof body.isActive === 'boolean' ? {
            isActive: body.isActive,
            deletedAt: body.isActive ? null : new Date(),
            ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
          } : {}),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: position.factoryId,
        action: typeof body.isActive === 'boolean' && body.isActive !== position.isActive
          ? (body.isActive ? 'LINE_POSITION_REACTIVATED' : 'LINE_POSITION_DEACTIVATED')
          : 'LINE_POSITION_UPDATED',
        entityType: 'LinePosition',
        entityId: positionId,
        details: {
          lineId,
          positionId,
          oldValue: position,
          newValue: updated,
          reason: body.reason ?? null,
        },
      });
      return updated;
    });
  }

  async createTemplate(user: UserContext, lineId: string, body: StaffingTemplateBody) {
    this.assertAdmin(user);
    if (!body.name?.trim()) throw new ConflictError('Название шаблона обязательно');
    const name = body.name.trim();
    return this.prisma.db.$transaction(async (tx) => {
      const line = await tx.line.findFirst({ where: { id: lineId, factoryId: user.selectedFactoryId, deletedAt: null } });
      if (!line) throw new ConflictError('Линия не найдена');
      const items = await this.normalizeTemplateItemsTx(tx, line.factoryId, lineId, body.items ?? []);
      const template = await tx.lineStaffingTemplate.create({
        data: {
          factoryId: line.factoryId,
          lineId,
          name,
          items: { create: items.map((item) => this.templateItemData(item)) },
        },
        include: { items: { include: { position: true } } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: line.factoryId,
        action: 'STAFFING_TEMPLATE_CREATED',
        entityType: 'LineStaffingTemplate',
        entityId: template.id,
        details: { lineId, newValue: template },
      });
      return template;
    });
  }

  async updateTemplate(user: UserContext, lineId: string, templateId: string, body: StaffingTemplateBody) {
    this.assertAdmin(user);
    return this.prisma.db.$transaction(async (tx) => {
      const template = await tx.lineStaffingTemplate.findFirst({
        where: { id: templateId, lineId, factoryId: user.selectedFactoryId },
        include: { items: true, line: true },
      });
      if (!template) throw new ConflictError('Шаблон состава не найден');
      const items = body.items
        ? await this.normalizeTemplateItemsTx(tx, template.factoryId, lineId, body.items)
        : null;
      if (template.isActive && body.isActive === false) this.assertRecoveryReason(body.reason);
      if (body.items) {
        await tx.lineStaffingTemplateItem.deleteMany({ where: { templateId } });
      }
      const updated = await tx.lineStaffingTemplate.update({
        where: { id: templateId },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(typeof body.isActive === 'boolean' ? {
            isActive: body.isActive,
            deletedAt: body.isActive ? null : new Date(),
            ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
          } : {}),
          ...(items ? { items: { create: items.map((item) => this.templateItemData(item)) } } : {}),
        },
        include: { items: { include: { position: true } } },
      });
      if (body.isActive === false) {
        await tx.line.updateMany({
          where: { id: lineId, factoryId: template.factoryId, defaultStaffingTemplateId: templateId },
          data: { defaultStaffingTemplateId: null, version: { increment: 1 } },
        });
      }
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: template.factoryId,
        action: typeof body.isActive === 'boolean' && body.isActive !== template.isActive
          ? (body.isActive ? 'STAFFING_TEMPLATE_REACTIVATED' : 'STAFFING_TEMPLATE_DEACTIVATED')
          : 'STAFFING_TEMPLATE_UPDATED',
        entityType: 'LineStaffingTemplate',
        entityId: templateId,
        details: { lineId, templateId, oldValue: template, newValue: updated, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  async workAreasConfig(user: UserContext, factoryId = user.selectedFactoryId) {
    this.assertAdminFactoryScope(user, factoryId);
    const areas = await this.prisma.db.workArea.findMany({
      where: { factoryId, deletedAt: null },
      include: { positions: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: { name: 'asc' },
    });
    return areas.map((area) => this.serializeWorkArea(area));
  }

  async createWorkArea(user: UserContext, body: WorkAreaBody) {
    const factoryId = body.factoryId || user.selectedFactoryId;
    this.assertAdminFactoryScope(user, factoryId);
    const name = body.name?.trim();
    if (!name) throw new ConflictError('Название рабочей зоны обязательно');
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertFactoryExistsTx(tx, factoryId);
      await this.assertDepartmentBelongsToFactoryTx(tx, body.departmentId ?? null, factoryId);
      const duplicate = await tx.workArea.findFirst({ where: { factoryId, name, deletedAt: null } });
      if (duplicate) throw new ConflictError('Рабочая зона с таким названием уже существует');
      const area = await tx.workArea.create({
        data: {
          factoryId,
          departmentId: body.departmentId ?? null,
          assignmentKind: body.assignmentKind === 'TIME' ? AssignmentKind.TIME : AssignmentKind.WORK_AREA,
          name,
          description: body.description?.trim() || null,
          isActive: body.isActive ?? true,
        },
        include: { positions: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: 'WORK_AREA_CREATED',
        entityType: 'WorkArea',
        entityId: area.id,
        details: { newValue: this.cleanWorkArea(area), reason: body.reason ?? null },
      });
      return this.serializeWorkArea(area);
    });
  }

  async updateWorkArea(user: UserContext, workAreaId: string, body: WorkAreaBody) {
    this.assertAdmin(user);
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.workArea.findFirst({
        where: { id: workAreaId, factoryId: user.selectedFactoryId },
        include: { positions: true },
      });
      if (!current) throw new ConflictError('Рабочая зона не найдена');
      const factoryId = body.factoryId || current.factoryId;
      this.assertAdminFactoryScope(user, factoryId);
      await this.assertFactoryExistsTx(tx, factoryId);
      await this.assertDepartmentBelongsToFactoryTx(tx, body.departmentId !== undefined ? body.departmentId : current.departmentId, factoryId);
      const nextName = body.name?.trim() || current.name;
      const duplicate = await tx.workArea.findFirst({ where: { id: { not: workAreaId }, factoryId, name: nextName, deletedAt: null } });
      if (duplicate) throw new ConflictError('Рабочая зона с таким названием уже существует');
      if (current.isActive && body.isActive === false) this.assertRecoveryReason(body.reason);
      const updated = await tx.workArea.update({
        where: { id: workAreaId },
        data: {
          factoryId,
          name: nextName,
          ...(body.assignmentKind !== undefined ? { assignmentKind: body.assignmentKind === 'TIME' ? AssignmentKind.TIME : AssignmentKind.WORK_AREA } : {}),
          ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(typeof body.isActive === 'boolean' ? {
            isActive: body.isActive,
            deletedAt: body.isActive ? null : new Date(),
            ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
          } : {}),
        },
        include: { positions: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId,
        action: typeof body.isActive === 'boolean' && body.isActive !== current.isActive
          ? (body.isActive ? 'WORK_AREA_REACTIVATED' : 'WORK_AREA_DEACTIVATED')
          : 'WORK_AREA_UPDATED',
        entityType: 'WorkArea',
        entityId: workAreaId,
        details: { oldValue: this.cleanWorkArea(current), newValue: this.cleanWorkArea(updated), reason: body.reason ?? null },
      });
      return this.serializeWorkArea(updated);
    });
  }

  async createWorkAreaPosition(user: UserContext, workAreaId: string, body: WorkAreaPositionBody) {
    this.assertAdmin(user);
    const title = body.title?.trim();
    if (!title) throw new ConflictError('Название позиции рабочей зоны обязательно');
    return this.prisma.db.$transaction(async (tx) => {
      const area = await tx.workArea.findFirst({
        where: { id: workAreaId, factoryId: user.selectedFactoryId, deletedAt: null },
      });
      if (!area) throw new ConflictError('Рабочая зона не найдена');
      const data = this.workAreaPositionData(body, title);
      const position = await tx.workAreaPosition.create({ data: { workAreaId, ...data } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: area.factoryId,
        action: 'WORK_AREA_POSITION_CREATED',
        entityType: 'WorkAreaPosition',
        entityId: position.id,
        details: { workAreaId, newValue: position, reason: body.reason ?? null },
      });
      return position;
    });
  }

  async updateWorkAreaPosition(user: UserContext, workAreaId: string, positionId: string, body: WorkAreaPositionBody) {
    this.assertAdmin(user);
    return this.prisma.db.$transaction(async (tx) => {
      const position = await tx.workAreaPosition.findFirst({
        where: {
          id: positionId,
          workAreaId,
          workArea: { factoryId: user.selectedFactoryId },
        },
        include: { workArea: true },
      });
      if (!position) throw new ConflictError('Позиция рабочей зоны не найдена');
      if (body.isActive === false) {
        this.assertRecoveryReason(body.reason);
        const activeAssignments = await tx.assignment.count({ where: { workAreaPositionId: positionId, endedAt: null } });
        if (activeAssignments > 0) throw new ConflictError('Нельзя отключить позицию с активными назначениями');
      }
      const data = this.workAreaPositionData(body, body.title?.trim() || position.title, position);
      const updated = await tx.workAreaPosition.update({
        where: { id: positionId },
        data: {
          ...data,
          ...(typeof body.isActive === 'boolean' ? {
            isActive: body.isActive,
            deletedAt: body.isActive ? null : new Date(),
            ...(body.isActive ? this.restoreMetadata(user.userId) : this.deactivationMetadata(user.userId, body.reason)),
          } : {}),
        },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: position.workArea.factoryId,
        action: typeof body.isActive === 'boolean' && body.isActive !== position.isActive
          ? (body.isActive ? 'WORK_AREA_POSITION_REACTIVATED' : 'WORK_AREA_POSITION_DEACTIVATED')
          : 'WORK_AREA_POSITION_UPDATED',
        entityType: 'WorkAreaPosition',
        entityId: positionId,
        details: { workAreaId, oldValue: position, newValue: updated, reason: body.reason ?? null },
      });
      return updated;
    });
  }

  private normalizeFactoryCode(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9а-яё-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }

  private async ensureSharedServicesTx(tx: Prisma.TransactionClient) {
    for (const service of SHARED_SERVICE_DEPARTMENTS) {
      const existing = await tx.department.findFirst({
        where: { factoryId: null, code: service.code, deletedAt: null },
      });
      if (existing) {
        if (!existing.isActive || existing.scope !== 'GLOBAL') {
          await tx.department.update({
            where: { id: existing.id },
            data: { isActive: true, scope: 'GLOBAL', normalizedName: this.normalizeOrganizationName(service.name) },
          });
        }
        continue;
      }
      await tx.department.create({
        data: {
          factoryId: null,
          name: service.name,
          normalizedName: this.normalizeOrganizationName(service.name),
          code: service.code,
          scope: 'GLOBAL',
          isActive: true,
        },
      });
    }
  }

  private async normalizeFactorySetupInput(user: UserContext, body: FactorySetupBody, requireSource: boolean) {
    const name = body.name?.trim();
    const code = this.normalizeFactoryCode(body.code || body.name || '');
    const mode = body.mode === 'EMPTY' ? 'EMPTY' : 'COPY';
    const categories = this.normalizeSetupCategories(body.categories, mode);
    if (!name) throw new ConflictError('Название завода обязательно');
    if (!code) throw new ConflictError('Код завода обязателен');

    let sourceFactoryId: string | undefined;
    let sourceFactoryName: string | undefined;
    if (mode === 'COPY') {
      sourceFactoryId = body.sourceFactoryId || user.selectedFactoryId;
      if (!sourceFactoryId && requireSource) throw new ConflictError('Выберите завод-источник');
      if (sourceFactoryId) {
        const sourceFactory = await this.prisma.db.factory.findFirst({ where: { id: sourceFactoryId, deletedAt: null } });
        if (!sourceFactory) throw new ConflictError('Завод-источник не найден');
        sourceFactoryName = sourceFactory.name;
      }
    }

    return {
      name,
      code,
      isActive: body.isActive !== false,
      mode,
      sourceFactoryId,
      sourceFactoryName,
      categories,
    };
  }

  private normalizeSetupCategories(input: FactorySetupBody['categories'], mode: 'EMPTY' | 'COPY') {
    if (mode === 'EMPTY') return input && this.categoryEnabled(input, 'moduleSettings') ? ['moduleSettings'] : [];
    if (!input) return [...FACTORY_SETUP_CATEGORY_KEYS];
    if (Array.isArray(input)) return input.filter((key) => FACTORY_SETUP_CATEGORY_KEYS.includes(key));
    return FACTORY_SETUP_CATEGORY_KEYS.filter((key) => Boolean(input[key]));
  }

  private categoryEnabled(input: FactorySetupBody['categories'], key: string) {
    if (!input) return false;
    return Array.isArray(input) ? input.includes(key) : Boolean(input[key]);
  }

  private emptyFactorySetupCounts() {
    return {
      localDepartments: 0,
      globalServices: 0,
      lines: 0,
      linePositions: 0,
      staffingTemplates: 0,
      staffingTemplateItems: 0,
      workAreas: 0,
      workAreaPositions: 0,
      jobTitles: 0,
      moduleSettings: 0,
    };
  }

  private async factorySetupCounts(sourceFactoryId: string, categories: string[]) {
    const counts = this.emptyFactorySetupCounts();
    if (categories.includes('localDepartments')) {
      const departments = await this.prisma.db.department.findMany({ where: { factoryId: sourceFactoryId, deletedAt: null } });
      counts.localDepartments = departments.filter((department) => !hasPilotFixtureMarker(department.id, department.name, department.code)).length;
    }
    if (categories.includes('globalServices')) {
      counts.globalServices = await this.prisma.db.department.count({ where: { factoryId: null, scope: 'GLOBAL', deletedAt: null, isActive: true } });
    }
    if (categories.includes('lines') || categories.includes('linePositions') || categories.includes('staffingTemplates')) {
      const lines = await this.prisma.db.line.findMany({
        where: { factoryId: sourceFactoryId, deletedAt: null },
        include: {
          positions: { where: { deletedAt: null } },
          staffingTemplates: { where: { deletedAt: null }, include: { items: { include: { position: true } } } },
        },
      });
      const visibleLines = lines.filter((line) => !hasPilotFixtureMarker(line.id, line.name));
      counts.lines = categories.includes('lines') ? visibleLines.length : 0;
      counts.linePositions = categories.includes('linePositions')
        ? visibleLines.reduce((sum, line) => sum + line.positions.filter((position) => !hasPilotFixtureMarker(position.id, position.name, position.displayName, position.skillCode, position.skillFamilyKey)).length, 0)
        : 0;
      if (categories.includes('staffingTemplates')) {
        const templates = visibleLines.flatMap((line) => line.staffingTemplates.filter((template) => !hasPilotFixtureMarker(template.id, template.name)));
        counts.staffingTemplates = templates.length;
        counts.staffingTemplateItems = templates.reduce((sum, template) => sum + template.items.filter((item) => !hasPilotFixtureMarker(item.id, item.positionId, item.position?.name, item.position?.displayName)).length, 0);
      }
    }
    if (categories.includes('workAreas')) {
      const areas = await this.prisma.db.workArea.findMany({ where: { factoryId: sourceFactoryId, deletedAt: null } });
      counts.workAreas = areas.filter((area) => !hasPilotFixtureMarker(area.id, area.name, area.description)).length;
    }
    if (categories.includes('workAreaPositions')) {
      const areas = await this.prisma.db.workArea.findMany({ where: { factoryId: sourceFactoryId, deletedAt: null }, include: { positions: { where: { deletedAt: null } } } });
      counts.workAreaPositions = areas
        .filter((area) => !hasPilotFixtureMarker(area.id, area.name, area.description))
        .reduce((sum, area) => sum + area.positions.filter((position) => !hasPilotFixtureMarker(position.id, position.title)).length, 0);
    }
    if (categories.includes('jobTitles')) {
      const titles = await this.prisma.db.jobTitle.findMany({ where: { deletedAt: null, OR: [{ factoryId: sourceFactoryId }, { factoryId: null }] } });
      counts.jobTitles = titles.filter((title) => !hasPilotFixtureMarker(title.id, title.name, title.code, title.description)).length;
    }
    if (categories.includes('moduleSettings')) {
      const settings = await Promise.all(SETTINGS_MODELS.map((model) => (this.prisma.db as any)[model].findUnique({ where: { factoryId: sourceFactoryId } })));
      counts.moduleSettings = settings.filter(Boolean).length;
    }
    return counts;
  }

  private factorySetupPreviewWarnings(normalized: { mode: string; categories: string[] }, counts: ReturnType<AdminService['emptyFactorySetupCounts']>) {
    const warnings: string[] = [];
    if (normalized.mode === 'EMPTY') warnings.push('Будет создан пустой завод. Линии, отделы и состав нужно настроить вручную.');
    if (normalized.mode === 'COPY' && !normalized.categories.includes('lines')) warnings.push('Линии не выбраны для копирования.');
    if (normalized.mode === 'COPY' && normalized.categories.includes('staffingTemplates') && !normalized.categories.includes('linePositions')) {
      warnings.push('Шаблоны состава требуют позиции линий. Позиции будут нужны для корректной привязки.');
    }
    if (normalized.mode === 'COPY' && counts.lines === 0 && normalized.categories.includes('lines')) warnings.push('У завода-источника нет линий для копирования.');
    warnings.push('Пользователи, доступы, история смен, заявки, чаты, вложения и аудит не копируются.');
    return warnings;
  }

  private async copyFactoryConfigurationTx(tx: Prisma.TransactionClient, sourceFactoryId: string, targetFactoryId: string, categories: string[]) {
    const counts = this.emptyFactorySetupCounts();
    const departmentIdMap = new Map<string, string>();
    const lineIdMap = new Map<string, string>();
    const positionIdMap = new Map<string, string>();

    if (categories.includes('globalServices')) {
      await this.ensureSharedServicesTx(tx);
      counts.globalServices = await tx.department.count({ where: { factoryId: null, scope: 'GLOBAL', deletedAt: null, isActive: true } });
    }

    if (categories.includes('localDepartments')) {
      const departments = (await tx.department.findMany({ where: { factoryId: sourceFactoryId, deletedAt: null }, orderBy: { createdAt: 'asc' } }))
        .filter((department) => !hasPilotFixtureMarker(department.id, department.name, department.code));
      for (const department of departments) {
        const created = await tx.department.create({
          data: {
            factoryId: targetFactoryId,
            name: department.name,
            normalizedName: this.normalizeOrganizationName(department.name),
            code: department.code,
            scope: DepartmentScope.LOCAL,
            isActive: department.isActive,
          },
        });
        departmentIdMap.set(department.id, created.id);
        counts.localDepartments += 1;
      }
    }

    if (categories.includes('lines')) {
      const lines = (await tx.line.findMany({
        where: { factoryId: sourceFactoryId, deletedAt: null },
        include: {
          positions: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          staffingTemplates: { where: { deletedAt: null }, include: { items: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { name: 'asc' },
      })).filter((line) => !hasPilotFixtureMarker(line.id, line.name));
      for (const line of lines) {
        const createdLine = await tx.line.create({
          data: {
            factoryId: targetFactoryId,
            name: line.name,
            status: 'STOP',
            version: line.version,
          },
        });
        lineIdMap.set(line.id, createdLine.id);
        counts.lines += 1;

        if (categories.includes('linePositions')) {
          const visiblePositions = line.positions.filter((position) => !hasPilotFixtureMarker(position.id, position.name, position.displayName, position.skillCode, position.skillFamilyKey));
          for (const position of visiblePositions) {
            const createdPosition = await tx.linePosition.create({
              data: {
                factoryId: targetFactoryId,
                lineId: createdLine.id,
                name: position.name,
                displayName: position.displayName,
                normalizedName: position.normalizedName,
                skillCode: position.skillCode,
                skillFamilyKey: position.skillFamilyKey,
                isExtraSlot: position.isExtraSlot,
                doesNotAffectShortage: position.doesNotAffectShortage,
                isFlexibleSkillGroup: position.isFlexibleSkillGroup,
                sortOrder: position.sortOrder,
                isActive: position.isActive,
              },
            });
            positionIdMap.set(position.id, createdPosition.id);
            counts.linePositions += 1;
          }
        }

        if (categories.includes('staffingTemplates')) {
          const visibleTemplates = line.staffingTemplates.filter((template) => !hasPilotFixtureMarker(template.id, template.name));
          for (const template of visibleTemplates) {
            const createItems = template.items
              .filter((item) => positionIdMap.has(item.positionId) && !hasPilotFixtureMarker(item.id, item.positionId))
              .map((item) => ({
                positionId: positionIdMap.get(item.positionId)!,
                requiredCount: item.requiredCount,
                minRequired: item.minRequired,
                maxRequired: item.maxRequired,
                defaultPlanned: item.defaultPlanned,
                plannedCount: item.plannedCount,
                isFlexible: item.isFlexible,
                isExtraSlot: item.isExtraSlot,
                doesNotAffectShortage: item.doesNotAffectShortage,
                sortOrder: item.sortOrder,
              }));
            const createdTemplate = await tx.lineStaffingTemplate.create({
              data: {
                factoryId: targetFactoryId,
                lineId: createdLine.id,
                name: template.name,
                isActive: template.isActive,
                items: { create: createItems },
              },
            });
            counts.staffingTemplates += 1;
            counts.staffingTemplateItems += createItems.length;
            void createdTemplate;
          }
        }
      }
    }

    if (categories.includes('workAreas')) {
      const workAreas = (await tx.workArea.findMany({
        where: { factoryId: sourceFactoryId, deletedAt: null },
        include: { positions: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { name: 'asc' },
      })).filter((area) => !hasPilotFixtureMarker(area.id, area.name, area.description));
      for (const area of workAreas) {
        const createdArea = await tx.workArea.create({
          data: {
            factoryId: targetFactoryId,
            departmentId: area.departmentId ? departmentIdMap.get(area.departmentId) ?? null : null,
            name: area.name,
            description: area.description,
            isActive: area.isActive,
          },
        });
        counts.workAreas += 1;
        if (categories.includes('workAreaPositions')) {
          const visiblePositions = area.positions.filter((position) => !hasPilotFixtureMarker(position.id, position.title));
          for (const position of visiblePositions) {
            await tx.workAreaPosition.create({
              data: {
                workAreaId: createdArea.id,
                title: position.title,
                minRequired: position.minRequired,
                maxRequired: position.maxRequired,
                defaultPlanned: position.defaultPlanned,
                plannedCount: position.plannedCount,
                isFlexible: position.isFlexible,
                isExtraSlot: position.isExtraSlot,
                doesNotAffectShortage: position.doesNotAffectShortage,
                sortOrder: position.sortOrder,
                isActive: position.isActive,
              },
            });
            counts.workAreaPositions += 1;
          }
        }
      }
    }

    if (categories.includes('jobTitles')) {
      const titles = (await tx.jobTitle.findMany({ where: { factoryId: sourceFactoryId, deletedAt: null }, orderBy: { createdAt: 'asc' } }))
        .filter((title) => !hasPilotFixtureMarker(title.id, title.name, title.code, title.description));
      for (const title of titles) {
        await tx.jobTitle.create({
          data: {
            factoryId: targetFactoryId,
            departmentId: title.departmentId ? departmentIdMap.get(title.departmentId) ?? null : null,
            name: title.name,
            code: title.code,
            baseRole: title.baseRole,
            shiftDurationHours: title.shiftDurationHours,
            permissionPreset: title.permissionPreset,
            description: title.description,
            isActive: title.isActive,
          },
        });
        counts.jobTitles += 1;
      }
    }

    if (categories.includes('moduleSettings')) {
      counts.moduleSettings = await this.copyModuleSettingsTx(tx, sourceFactoryId, targetFactoryId);
    }

    return counts;
  }

  private async copyModuleSettingsTx(tx: Prisma.TransactionClient, sourceFactoryId: string, targetFactoryId: string) {
    let copied = 0;
    for (const model of SETTINGS_MODELS) {
      const source = await (tx as any)[model].findUnique({ where: { factoryId: sourceFactoryId } });
      if (!source) continue;
      const data = { ...source };
      delete data.id;
      delete data.factoryId;
      delete data.createdAt;
      delete data.updatedAt;
      await (tx as any)[model].create({ data: { ...data, factoryId: targetFactoryId } });
      copied += 1;
    }
    return copied;
  }

  private async ensureDefaultFactorySettingsTx(tx: Prisma.TransactionClient, factoryId: string) {
    for (const model of SETTINGS_MODELS) {
      const existing = await (tx as any)[model].findUnique({ where: { factoryId } });
      if (!existing) await (tx as any)[model].create({ data: { factoryId } });
    }
  }

  private async buildDataHygieneReport(factoryId: string) {
    const records: any[] = [];
    const factory = await this.prisma.db.factory.findUnique({ where: { id: factoryId } });
    const factoryName = factory?.name ?? null;
    const addRecord = (input: any) => {
      const reasons: DataHygieneReason[] = input.forceReasons ?? dataHygieneReasons({
        id: input.id,
        title: input.title,
        name: input.name,
        description: input.description,
        unit: input.unit,
        quantities: input.quantities,
        disabled: input.disabled,
        hiddenFromRuntime: input.hiddenFromRuntime,
        incompleteConfig: input.incompleteConfig,
      });
      if (!reasons.length) return;
      const group = primaryDataHygieneGroup(reasons);
      records.push({
        id: input.id,
        type: input.type,
        typeLabel: input.typeLabel,
        title: input.title || input.name || 'Без названия',
        factoryId: input.factoryId ?? factoryId,
        factoryName: input.factoryName ?? factoryName,
        group,
        groupLabel: dataHygieneGroupLabel(group),
        reasons: reasons.map((reason) => reason.label),
        source: input.source,
        whereFound: input.whereFound,
        hiddenFromRuntime: Boolean(input.hiddenFromRuntime || input.disabled || group !== 'incomplete-config'),
        safeActions: ['Открыть', 'Оставить как есть'],
        createdAt: input.createdAt ?? null,
        updatedAt: input.updatedAt ?? null,
      });
    };

    const [
      factories,
      departments,
      jobTitles,
      users,
      accesses,
      lines,
      linePositions,
      templates,
      workAreas,
      workAreaPositions,
      stockItems,
      chats,
      chatMessages,
      okkRecords,
      returnRecords,
      checklistTemplates,
      announcements,
    ] = await Promise.all([
      this.prisma.db.factory.findMany({ where: { OR: [{ id: factoryId }, { isActive: false }, { deletedAt: { not: null } }] }, take: 200 }),
      this.prisma.db.department.findMany({ where: { OR: [{ factoryId }, { factoryId: null }] }, include: { factory: true }, take: 500 }),
      this.prisma.db.jobTitle.findMany({ where: { OR: [{ factoryId }, { factoryId: null }] }, include: { factory: true, department: true }, take: 500 }),
      this.prisma.db.user.findMany({
        where: { OR: [{ factoryId }, { factoryAccess: { some: { factoryId } } }] },
        select: { id: true, factoryId: true, role: true, blockedAt: true, deletedAt: true, createdAt: true, updatedAt: true },
        take: 500,
      }),
      this.prisma.db.userFactoryAccess.findMany({ where: { factoryId }, include: { user: true, factory: true, department: true }, take: 500 }),
      this.prisma.db.line.findMany({ where: { factoryId }, take: 700 }),
      this.prisma.db.linePosition.findMany({ where: { factoryId }, include: { line: true }, take: 1000 }),
      this.prisma.db.lineStaffingTemplate.findMany({ where: { factoryId }, include: { line: true, items: true }, take: 700 }),
      this.prisma.db.workArea.findMany({ where: { factoryId }, include: { factory: true, department: true }, take: 500 }),
      this.prisma.db.workAreaPosition.findMany({ where: { workArea: { factoryId } }, include: { workArea: true }, take: 1000 }),
      this.prisma.db.minimumStockItem.findMany({ where: { factoryId }, take: 700 }),
      this.prisma.db.chat.findMany({ where: { OR: [{ factoryId }, { factoryId: null }] }, select: { id: true, factoryId: true, title: true, description: true, isActive: true, archivedAt: true, createdAt: true, updatedAt: true }, take: 300 }),
      this.prisma.db.chatMessage.findMany({ where: { OR: [{ factoryId }, { chat: { factoryId } }] }, select: { id: true, factoryId: true, text: true, operationId: true, createdAt: true, deletedAt: true }, orderBy: { createdAt: 'desc' }, take: 300 }),
      this.prisma.db.okkRecord.findMany({ where: { factoryId }, select: { id: true, description: true, article: true, productName: true, mismatchReason: true, status: true, archivedAt: true, deletedAt: true, createdAt: true, updatedAt: true }, take: 300 }),
      this.prisma.db.returnRecord.findMany({ where: { factoryId }, select: { id: true, description: true, article: true, productName: true, mismatchReason: true, status: true, archivedAt: true, deletedAt: true, createdAt: true, updatedAt: true }, take: 300 }),
      this.prisma.db.checklistTemplate.findMany({ where: { factoryId }, select: { id: true, name: true, description: true, isActive: true, archivedAt: true, createdAt: true, updatedAt: true }, take: 300 }),
      this.prisma.db.announcement.findMany({ where: { OR: [{ factoryId }, { factoryId: null }] }, select: { id: true, title: true, text: true, archivedAt: true, deletedAt: true, createdAt: true, updatedAt: true }, take: 300 }),
    ]);

    for (const item of factories) addRecord({ id: item.id, type: 'factory', typeLabel: 'Завод', name: item.name, description: item.code, factoryId: item.id, factoryName: item.name, disabled: !item.isActive || Boolean(item.deletedAt), source: 'Заводы', whereFound: 'Список заводов', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of departments) addRecord({ id: item.id, type: 'department', typeLabel: 'Отдел или служба', name: item.name, description: item.code, factoryId: item.factoryId, factoryName: item.factory?.name ?? (item.factoryId ? factoryName : 'Общая служба'), disabled: !item.isActive || Boolean(item.deletedAt), source: 'Отделы и службы', whereFound: 'Админка', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of jobTitles) addRecord({ id: item.id, type: 'job-title', typeLabel: 'Должность', name: item.name, description: item.description ?? item.code, factoryId: item.factoryId, factoryName: item.factory?.name ?? (item.factoryId ? factoryName : 'Общая должность'), disabled: !item.isActive || Boolean(item.deletedAt), source: 'Должности и роли', whereFound: 'Админка', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of users) addRecord({ id: item.id, type: 'user', typeLabel: 'Пользователь', name: pilotDisplayName(item), description: item.role, factoryId: item.factoryId, factoryName, disabled: Boolean(item.blockedAt || item.deletedAt), source: 'Пользователи', whereFound: 'Список людей и доступов', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of accesses) addRecord({ id: item.id, type: 'factory-access', typeLabel: 'Доступ к заводу', name: pilotDisplayName(item.user), description: `${item.role} ${item.department?.name ?? ''}`, factoryId: item.factoryId, factoryName: item.factory?.name ?? factoryName, disabled: !item.isActive, source: 'Пользователи с доступом', whereFound: 'Админка и восстановление', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of lines) addRecord({ id: item.id, type: 'line', typeLabel: 'Линия', name: item.name, description: item.status, factoryId: item.factoryId, factoryName, disabled: Boolean(item.deletedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.name), source: 'Линии', whereFound: 'Смена / линии / админка', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of linePositions) addRecord({ id: item.id, type: 'line-position', typeLabel: 'Позиция линии', name: item.displayName || item.name, description: `${item.skillCode ?? ''} ${item.skillFamilyKey ?? ''}`, factoryId: item.factoryId, factoryName, disabled: !item.isActive || Boolean(item.deletedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.name, item.displayName, item.skillCode), source: 'Линии и позиции', whereFound: item.line?.name ?? 'Позиции линий', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of templates) addRecord({ id: item.id, type: 'staffing-template', typeLabel: 'Шаблон состава', name: item.name, description: item.line?.name ?? '', factoryId: item.factoryId, factoryName, disabled: !item.isActive || Boolean(item.deletedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.name), incompleteConfig: !item.items.length && item.isActive && !item.deletedAt, source: 'Шаблоны состава', whereFound: item.line?.name ?? 'Шаблоны состава', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of workAreas) addRecord({ id: item.id, type: 'work-area', typeLabel: 'Рабочая зона', name: item.name, description: item.description, factoryId: item.factoryId, factoryName: item.factory?.name ?? factoryName, disabled: !item.isActive || Boolean(item.deletedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.name, item.description), source: 'Повременщики', whereFound: 'Рабочие зоны', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of workAreaPositions) addRecord({ id: item.id, type: 'work-area-position', typeLabel: 'Позиция рабочей зоны', name: item.title, description: item.workArea?.name ?? '', factoryId: item.workArea?.factoryId ?? factoryId, factoryName, disabled: !item.isActive || Boolean(item.deletedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.title), source: 'Повременщики', whereFound: item.workArea?.name ?? 'Рабочие зоны', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of stockItems) {
      const reason = dirtyStockReason({ id: item.id, name: item.name, description: item.description, unit: item.unit, quantities: [item.minThreshold, item.initialQuantity, item.currentQuantity, item.referenceQuantity] });
      addRecord({ id: item.id, type: 'minimum-stock-item', typeLabel: 'Остаток', name: item.name, description: item.description, unit: item.unit, quantities: [item.minThreshold, item.initialQuantity, item.currentQuantity, item.referenceQuantity], factoryId: item.factoryId, factoryName, disabled: !item.isActive || Boolean(item.archivedAt), hiddenFromRuntime: Boolean(reason), source: 'Заказы / Остатки', whereFound: 'Рабочий список остатков', createdAt: item.createdAt, updatedAt: item.updatedAt });
    }
    for (const item of chats) addRecord({ id: item.id, type: 'chat', typeLabel: 'Чат', name: item.title, description: item.description, factoryId: item.factoryId, factoryName, disabled: !item.isActive || Boolean(item.archivedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.title, item.description), source: 'Чаты', whereFound: 'Список чатов', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of chatMessages) {
      const hidden = hasPilotFixtureMarker(item.id, item.operationId, item.text);
      if (hidden) addRecord({ id: item.id, type: 'chat-message', typeLabel: 'Сообщение чата', name: 'Тестовое сообщение чата', description: item.operationId ?? null, factoryId: item.factoryId, factoryName, disabled: Boolean(item.deletedAt), hiddenFromRuntime: true, source: 'Чаты', whereFound: 'Лента сообщений', createdAt: item.createdAt, updatedAt: item.createdAt });
    }
    for (const item of okkRecords) addRecord({ id: item.id, type: 'okk-record', typeLabel: 'Запись ОКК', name: item.productName || item.article || item.description, description: item.mismatchReason, factoryId, factoryName, disabled: Boolean(item.archivedAt || item.deletedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.description, item.article, item.productName), source: 'ОКК', whereFound: 'Активный журнал и архив', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of returnRecords) addRecord({ id: item.id, type: 'return-record', typeLabel: 'Возврат на производство', name: item.productName || item.article || item.description, description: item.mismatchReason, factoryId, factoryName, disabled: Boolean(item.archivedAt || item.deletedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.description, item.article, item.productName), source: 'Возвраты', whereFound: 'Журнал возвратов', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of checklistTemplates) addRecord({ id: item.id, type: 'checklist-template', typeLabel: 'Шаблон чек-листа', name: item.name, description: item.description, factoryId, factoryName, disabled: !item.isActive || Boolean(item.archivedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.name, item.description), source: 'Чек-листы', whereFound: 'Библиотека шаблонов', createdAt: item.createdAt, updatedAt: item.updatedAt });
    for (const item of announcements) addRecord({ id: item.id, type: 'announcement', typeLabel: 'Объявление', name: item.title, description: item.text, factoryId, factoryName, disabled: Boolean(item.archivedAt || item.deletedAt), hiddenFromRuntime: hasPilotFixtureMarker(item.id, item.title, item.text), source: 'Объявления', whereFound: 'Новые и архив объявлений', createdAt: item.createdAt, updatedAt: item.updatedAt });

    try {
      const health = await this.buildFactoryConfigHealth(this.prisma.db, factoryId);
      for (const warning of health.warnings ?? []) {
        addRecord({
          id: warning.id,
          type: 'factory-config-health',
          typeLabel: 'Проверка конфигурации',
          title: warning.title,
          description: warning.detail,
          factoryId,
          factoryName,
          incompleteConfig: true,
          source: 'Готовность завода',
          whereFound: warning.section,
          forceReasons: [{ group: 'incomplete-config', label: warning.detail }],
        });
      }
    } catch {
      // Диагностика данных не должна падать из-за одной недоступной проверки готовности.
    }

    const unique = new Map<string, any>();
    for (const record of records) unique.set(`${record.type}:${record.id}:${record.group}`, record);
    const sorted = Array.from(unique.values()).sort((left, right) => String(right.updatedAt ?? right.createdAt ?? '').localeCompare(String(left.updatedAt ?? left.createdAt ?? '')));
    const groupKeys: DataHygieneGroup[] = ['test-records', 'broken-names', 'dirty-stock', 'old-disabled', 'hidden-runtime', 'incomplete-config'];
    const groups = groupKeys.map((group) => ({ group, label: dataHygieneGroupLabel(group), count: sorted.filter((record) => record.group === group).length }));
    const typeCounts = new Map<string, number>();
    for (const record of sorted) typeCounts.set(record.typeLabel, (typeCounts.get(record.typeLabel) ?? 0) + 1);
    return {
      factoryId,
      total: sorted.length,
      groups,
      types: Array.from(typeCounts.entries()).map(([label, count]) => ({ label, count })),
      records: sorted,
      recommendations: [
        'Обычные рабочие списки скрывают явные диагностические записи без удаления истории.',
        'Проблемные отключённые записи смотрите в диагностическом режиме восстановления.',
        'Физическая очистка данных в Stage62 не выполняется.',
      ],
      generatedAt: new Date(),
    };
  }

  private async buildFactoryConfigHealth(client: any, factoryId: string) {
    const factory = await client.factory.findFirst({ where: { id: factoryId, deletedAt: null } });
    if (!factory) throw new ConflictError('Завод не найден');
    const [
      lines,
      workAreas,
      departments,
      jobTitles,
      adminAccessCount,
      managementAccessCount,
      shiftSettings,
      taskSettings,
    ] = await Promise.all([
      client.line.findMany({
        where: { factoryId, deletedAt: null },
        include: {
          positions: { where: { deletedAt: null } },
          staffingTemplates: { where: { deletedAt: null }, include: { items: true } },
        },
      }),
      client.workArea.findMany({ where: { factoryId, deletedAt: null }, include: { positions: { where: { deletedAt: null } } } }),
      client.department.findMany({ where: { factoryId, deletedAt: null }, include: { userAccess: { where: { isActive: true } } } }),
      client.jobTitle.findMany({ where: { deletedAt: null, OR: [{ factoryId }, { factoryId: null }] } }),
      client.userFactoryAccess.count({ where: { factoryId, role: UserRole.ADMIN, isActive: true, user: { blockedAt: null, deletedAt: null } } }),
      client.userFactoryAccess.count({ where: { factoryId, role: UserRole.MANAGEMENT, isActive: true, user: { blockedAt: null, deletedAt: null } } }),
      client.shiftSettings.findUnique({ where: { factoryId } }),
      client.taskSettings.findUnique({ where: { factoryId } }),
    ]);

    const visibleLines = lines.filter((line: any) => !hasPilotFixtureMarker(line.id, line.name));
    const visibleWorkAreas = workAreas.filter((area: any) => !hasPilotFixtureMarker(area.id, area.name, area.description));
    const visibleDepartments = departments.filter((department: any) => !hasPilotFixtureMarker(department.id, department.name, department.code));
    const visibleJobTitles = jobTitles.filter((title: any) => !hasPilotFixtureMarker(title.id, title.name, title.code, title.description));
    const warnings: Array<{ id: string; severity: string; title: string; detail: string; section: string; actionLabel: string }> = [];
    const push = (severity: 'ok' | 'warning' | 'blocker', id: string, title: string, detail: string, section: string) => {
      warnings.push({ id, severity, title, detail, section, actionLabel: 'Перейти к настройке' });
    };

    if (!visibleLines.some((line: any) => !line.deletedAt)) push('blocker', 'no-active-lines', 'Нет активных линий', 'Добавьте хотя бы одну производственную линию.', 'Линии и позиции');
    for (const line of visibleLines) {
      const activePositions = line.positions.filter((position: any) =>
        position.isActive &&
        !position.deletedAt &&
        !hasPilotFixtureMarker(position.id, position.name, position.displayName, position.skillCode, position.skillFamilyKey),
      );
      const activeTemplates = line.staffingTemplates.filter((template: any) => template.isActive && !template.deletedAt && !hasPilotFixtureMarker(template.id, template.name));
      if (!activePositions.length) push('blocker', `line-${line.id}-positions`, `Линия без позиций: ${line.name}`, 'Назначения и расчёт нехватки людей не будут понятны.', 'Линии и позиции');
      if (!activeTemplates.length) push('warning', `line-${line.id}-template`, `Линия без активного шаблона: ${line.name}`, 'Мастеру будет сложнее планировать состав смены.', 'Шаблоны состава');
      for (const template of activeTemplates) {
        if (!template.items.length) push('blocker', `template-${template.id}-items`, `Шаблон без строк: ${template.name}`, 'Добавьте позиции и плановые количества.', 'Шаблоны состава');
      }
      for (const position of activePositions) {
        if (!position.skillCode) push('warning', `position-${position.id}-skill`, `Позиция без навыка: ${position.displayName ?? position.name}`, 'Рекомендации назначений будут менее точными.', 'Позиции на линиях');
      }
    }
    for (const area of visibleWorkAreas) {
      if (area.isActive && !area.positions.some((position: any) => position.isActive && !position.deletedAt && !hasPilotFixtureMarker(position.id, position.title))) {
        push('warning', `work-area-${area.id}-positions`, `Рабочая зона без позиций: ${area.name}`, 'Добавьте слоты для повременщиков.', 'Рабочие зоны');
      }
    }
    for (const department of visibleDepartments) {
      if (department.isActive && !department.userAccess.length) push('warning', `department-${department.id}-users`, `Отдел без пользователей: ${department.name}`, 'Выдайте доступ сотрудникам после создания завода.', 'Пользователи и доступы');
    }
    for (const title of visibleJobTitles) {
      if (title.isActive && !title.departmentId && title.factoryId) push('warning', `job-title-${title.id}-department`, `Должность без отдела: ${title.name}`, 'Привяжите должность к отделу или службе.', 'Должности и роли');
      if (title.isActive && !title.permissionPreset) push('warning', `job-title-${title.id}-preset`, `Должность без набора прав: ${title.name}`, 'Укажите понятный набор прав.', 'Должности и роли');
    }
    if (!adminAccessCount) push('blocker', 'no-admin', 'Нет администратора на заводе', 'Выдайте доступ ADMIN хотя бы одному пользователю.', 'Пользователи и доступы');
    if (!managementAccessCount) push('warning', 'no-management', 'Нет руководителя на заводе', 'Добавьте руководителя для контроля смен и настроек.', 'Пользователи и доступы');
    if (!shiftSettings) push('warning', 'no-shift-settings', 'Нет настроек смен', 'Создайте или проверьте настройки смен.', 'Настройки модулей');
    if (!taskSettings) push('warning', 'no-task-settings', 'Нет настроек заявок', 'Создайте или проверьте настройки заявок.', 'Настройки модулей');

    const blockers = warnings.filter((item) => item.severity === 'blocker').length;
    const warningCount = warnings.filter((item) => item.severity === 'warning').length;
    return {
      factory: { id: factory.id, name: factory.name, code: factory.code, isActive: factory.isActive },
      status: blockers ? 'blocker' : warningCount ? 'warning' : 'ready',
      summary: {
        ready: blockers === 0,
        blockers,
        warnings: warningCount,
        checks: warnings.length,
      },
      warnings,
      positive: [
        ...(visibleLines.length ? [`Линии: ${visibleLines.length}`] : []),
        ...(visibleDepartments.length ? [`Локальные отделы: ${visibleDepartments.length}`] : []),
        ...(visibleWorkAreas.length ? [`Рабочие зоны: ${visibleWorkAreas.length}`] : []),
        ...(shiftSettings ? ['Настройки смен созданы'] : []),
        ...(taskSettings ? ['Настройки заявок созданы'] : []),
      ],
    };
  }

  private async assertFactoryVisible(factoryId: string) {
    const factory = await this.prisma.db.factory.findFirst({ where: { id: factoryId, deletedAt: null } });
    if (!factory) throw new ConflictError('Завод не найден');
    return factory;
  }

  private async copyFactory4StructureTx(tx: Prisma.TransactionClient, targetFactoryId: string) {
    const sourceFactory = await tx.factory.findUnique({ where: { code: 'factory-4' } });
    if (!sourceFactory) return;

    const sourceDepartments = await tx.department.findMany({
      where: { factoryId: sourceFactory.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    for (const department of sourceDepartments) {
      const existing = await tx.department.findFirst({
        where: { factoryId: targetFactoryId, code: department.code, deletedAt: null },
      });
      if (!existing) {
        await tx.department.create({
          data: {
            factoryId: targetFactoryId,
            name: department.name,
            normalizedName: this.normalizeOrganizationName(department.name),
            code: department.code,
            scope: department.scope,
            isActive: department.isActive,
          },
        });
      }
    }

    const sourceLines = await tx.line.findMany({
      where: { factoryId: sourceFactory.id, deletedAt: null },
      include: {
        positions: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        staffingTemplates: {
          where: { deletedAt: null },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    for (const line of sourceLines) {
      const targetLine = await tx.line.create({
        data: {
          factoryId: targetFactoryId,
          name: line.name,
          status: line.status,
          version: line.version,
        },
      });
      const positionIdMap = new Map<string, string>();
      for (const position of line.positions) {
        const createdPosition = await tx.linePosition.create({
          data: {
            factoryId: targetFactoryId,
            lineId: targetLine.id,
            name: position.name,
            displayName: position.displayName,
            normalizedName: position.normalizedName,
            skillCode: position.skillCode,
            skillFamilyKey: position.skillFamilyKey,
            isExtraSlot: position.isExtraSlot,
            doesNotAffectShortage: position.doesNotAffectShortage,
            isFlexibleSkillGroup: position.isFlexibleSkillGroup,
            sortOrder: position.sortOrder,
            isActive: position.isActive,
          },
        });
        positionIdMap.set(position.id, createdPosition.id);
      }
      for (const template of line.staffingTemplates) {
        await tx.lineStaffingTemplate.create({
          data: {
            factoryId: targetFactoryId,
            lineId: targetLine.id,
            name: template.name,
            isActive: template.isActive,
            items: {
              create: template.items
                .filter((item) => positionIdMap.has(item.positionId))
                .map((item) => ({
                  positionId: positionIdMap.get(item.positionId)!,
                  requiredCount: item.requiredCount,
                  minRequired: item.minRequired,
                  maxRequired: item.maxRequired,
                  defaultPlanned: item.defaultPlanned,
                  plannedCount: item.plannedCount,
                  isFlexible: item.isFlexible,
                  isExtraSlot: item.isExtraSlot,
                  doesNotAffectShortage: item.doesNotAffectShortage,
                  sortOrder: item.sortOrder,
                })),
            },
          },
        });
      }
    }

    const sourceWorkAreas = await tx.workArea.findMany({
      where: { factoryId: sourceFactory.id, deletedAt: null },
      include: { positions: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    for (const area of sourceWorkAreas) {
      await tx.workArea.create({
        data: {
          factoryId: targetFactoryId,
          departmentId: null,
          name: area.name,
          description: area.description,
          isActive: area.isActive,
          positions: {
            create: area.positions.map((position) => ({
              title: position.title,
              minRequired: position.minRequired,
              maxRequired: position.maxRequired,
              defaultPlanned: position.defaultPlanned,
              plannedCount: position.plannedCount,
              isFlexible: position.isFlexible,
              isExtraSlot: position.isExtraSlot,
              doesNotAffectShortage: position.doesNotAffectShortage,
              sortOrder: position.sortOrder,
              isActive: position.isActive,
            })),
          },
        },
      });
    }
  }

  private assertAdmin(user: UserContext) {
    if (!user.isAdmin || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'admin access required' });
    }
  }

  private assertAdminFactoryScope(user: UserContext, factoryId: string) {
    this.assertAdmin(user);
    if (!factoryId || factoryId !== user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Сначала выберите нужный завод.' });
    }
  }

  private assertAssignmentRequestReviewer(user: UserContext) {
    if (user.isGuest || (!user.isAdmin && !user.permissions.includes('admin.users.manage') && !user.permissions.includes('company.members.manage'))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет права рассматривать заявки на назначение.' });
    }
  }

  private canReviewAssignmentRequest(user: UserContext, actorAccess: any, request: any) {
    if (request.factoryId !== user.selectedFactoryId) return false;
    if (user.isAdmin) return true;
    if (request.requestedRole === UserRole.CONTRACTOR) {
      return Boolean(
        user.permissions.includes('company.members.manage')
        && actorAccess?.role === UserRole.CONTRACTOR_LEAD
        && actorAccess?.companyId
        && actorAccess.companyId === request.companyId,
      );
    }
    if (!user.permissions.includes('admin.users.manage')) return false;
    if (user.role === UserRole.MANAGEMENT) return true;
    if (!user.departmentId || request.departmentId !== user.departmentId) return false;
    if (request.requestedRole === UserRole.MASTER) return user.role === UserRole.MASTER;
    return true;
  }

  private serializeAssignmentRequest(request: any) {
    return {
      id: request.id,
      status: request.status,
      requestedById: request.requestedById,
      requestedByName: request.requestedBy ? pilotDisplayName(request.requestedBy) : null,
      requestedRole: request.requestedRole,
      departmentId: request.departmentId,
      departmentName: request.department?.name ?? null,
      companyId: request.companyId,
      companyName: request.company?.name ?? null,
      comment: request.comment,
      version: request.version,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
      decidedByName: request.decidedBy ? pilotDisplayName(request.decidedBy) : null,
      decisionReason: request.decisionReason,
      decision: request.decisionSnapshot ?? null,
    };
  }

  private normalizeOrganizationName(value: string) {
    return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  private assertRecoveryReason(reason?: string | null) {
    if (!reason?.trim()) throw new ConflictError('Укажите причину отключения. Объект попадёт в Центр восстановления.');
  }

  private recoveryUntil(from = new Date()) {
    return new Date(from.getTime() + RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }

  private deactivationMetadata(actorId: string, reason?: string | null) {
    const now = new Date();
    return {
      deactivatedAt: now,
      deactivatedById: actorId,
      deactivationReason: reason?.trim() || 'Причина не указана',
      recoveryUntil: this.recoveryUntil(now),
      restoredAt: null,
      restoredById: null,
    };
  }

  private restoreMetadata(actorId: string) {
    return {
      deactivatedAt: null,
      deactivatedById: null,
      deactivationReason: null,
      recoveryUntil: null,
      restoredAt: new Date(),
      restoredById: actorId,
    };
  }

  private recoveryTypeLabel(type: RecoveryType) {
    const labels: Record<RecoveryType, string> = {
      factory: 'Завод',
      department: 'Отдел / служба',
      'job-title': 'Должность',
      line: 'Линия',
      'line-position': 'Позиция линии',
      'staffing-template': 'Шаблон состава',
      'work-area': 'Рабочая зона',
      'work-area-position': 'Позиция рабочей зоны',
      'factory-access': 'Доступ к заводу',
    };
    return labels[type];
  }

  private roleLabel(role: UserRole) {
    const labels: Partial<Record<UserRole, string>> = {
      ADMIN: 'Администратор',
      MANAGEMENT: 'Руководство',
      MASTER: 'Мастер',
      WORKER: 'Работник',
      CONTRACTOR: 'Наёмный работник',
      CONTRACTOR_LEAD: 'Старший наёмных работников',
      OKK: 'ОКК',
      STORE: 'Склад',
      TECHNOLOG: 'Технолог',
      TECH_KIPIA: 'КИПиА',
      TECH_HOLOD: 'Холодильная служба',
      TECH_MECHANIC: 'Механик',
      TECH_ELECTRIC: 'Электрик',
      TECH_SANTECHNIK: 'Сантехник',
      OTHER: 'Без назначенной роли',
    };
    return labels[role] ?? String(role);
  }

  private recoveryItem(type: RecoveryType, id: string, title: string, item: any, context: any, actorNames: Map<string, string>) {
    const deactivatedAt = item.deactivatedAt ?? item.deletedAt ?? (item.isActive === false ? item.updatedAt : null);
    const recoveryUntil = item.recoveryUntil ?? (deactivatedAt ? this.recoveryUntil(new Date(deactivatedAt)) : null);
    const daysLeft = recoveryUntil
      ? Math.ceil((new Date(recoveryUntil).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;
    return {
      id,
      type,
      typeLabel: this.recoveryTypeLabel(type),
      title,
      factoryId: context.factoryId ?? null,
      factoryName: context.factoryName ?? null,
      parentName: context.parentName ?? null,
      departmentName: context.departmentName ?? null,
      deactivatedAt,
      deactivatedById: item.deactivatedById ?? null,
      deactivatedByName: item.deactivatedById ? actorNames.get(item.deactivatedById) ?? 'Неизвестный администратор' : 'Не указано',
      reason: item.deactivationReason ?? 'Причина не указана',
      recoveryUntil,
      daysLeft,
      quickRecoveryExpired: daysLeft !== null && daysLeft < 0,
      details: [
        context.parentName ? `Связано: ${context.parentName}` : null,
        context.departmentName ? `Отдел: ${context.departmentName}` : null,
        context.factoryName ? `Завод: ${context.factoryName}` : null,
      ].filter(Boolean),
    };
  }

  private async restoreByTypeTx(tx: Prisma.TransactionClient, user: UserContext, type: RecoveryType, id: string, reason: string) {
    const meta = this.restoreMetadata(user.userId);
    if (type === 'factory') {
      const actorAccess = await tx.userFactoryAccess.findFirst({
        where: { userId: user.userId, factoryId: id, role: UserRole.ADMIN, isActive: true },
        select: { id: true },
      });
      if (!actorAccess) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет права восстанавливать этот завод.' });
      }
      const current = await tx.factory.findUnique({ where: { id } });
      if (!current) throw new ConflictError('Завод не найден');
      const updated = await tx.factory.update({ where: { id }, data: { isActive: true, deletedAt: null, ...meta } });
      return { factoryId: updated.id, name: updated.name, entityType: 'Factory', action: 'FACTORY_RESTORED' };
    }
    if (type === 'department') {
      const current = await tx.department.findFirst({ where: { id, OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }] } });
      if (!current) throw new ConflictError('Отдел или служба не найдены');
      const updated = await tx.department.update({ where: { id }, data: { isActive: true, deletedAt: null, ...meta } });
      return { factoryId: updated.factoryId ?? user.selectedFactoryId, name: updated.name, entityType: 'Department', action: 'DEPARTMENT_RESTORED' };
    }
    if (type === 'job-title') {
      const current = await tx.jobTitle.findFirst({ where: { id, OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }] } });
      if (!current) throw new ConflictError('Должность не найдена');
      const updated = await tx.jobTitle.update({ where: { id }, data: { isActive: true, deletedAt: null, ...meta } });
      return { factoryId: updated.factoryId ?? user.selectedFactoryId, name: updated.name, entityType: 'JobTitle', action: 'JOB_TITLE_RESTORED' };
    }
    if (type === 'factory-access') {
      const current = await tx.userFactoryAccess.findFirst({ where: { id, factoryId: user.selectedFactoryId }, include: { user: true } });
      if (!current) throw new ConflictError('Доступ к заводу не найден');
      const updated = await tx.userFactoryAccess.update({ where: { id }, data: { isActive: true, ...meta }, include: { user: true } });
      return { factoryId: updated.factoryId, name: pilotDisplayName(updated.user), entityType: 'UserFactoryAccess', action: 'USER_FACTORY_ACCESS_RESTORED' };
    }
    if (type === 'line') {
      const current = await tx.line.findFirst({ where: { id, factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('Линия не найдена');
      const updated = await tx.line.update({ where: { id }, data: { deletedAt: null, ...meta, version: { increment: 1 } } });
      return { factoryId: updated.factoryId, name: updated.name, entityType: 'Line', action: 'LINE_RESTORED' };
    }
    if (type === 'line-position') {
      const current = await tx.linePosition.findFirst({ where: { id, factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('Позиция линии не найдена');
      const updated = await tx.linePosition.update({ where: { id }, data: { isActive: true, deletedAt: null, ...meta } });
      return { factoryId: updated.factoryId, name: updated.displayName ?? updated.name, entityType: 'LinePosition', action: 'LINE_POSITION_RESTORED' };
    }
    if (type === 'staffing-template') {
      const current = await tx.lineStaffingTemplate.findFirst({ where: { id, factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('Шаблон состава не найден');
      const updated = await tx.lineStaffingTemplate.update({ where: { id }, data: { isActive: true, deletedAt: null, ...meta } });
      return { factoryId: updated.factoryId, name: updated.name, entityType: 'LineStaffingTemplate', action: 'STAFFING_TEMPLATE_RESTORED' };
    }
    if (type === 'work-area') {
      const current = await tx.workArea.findFirst({ where: { id, factoryId: user.selectedFactoryId } });
      if (!current) throw new ConflictError('Рабочая зона не найдена');
      const updated = await tx.workArea.update({ where: { id }, data: { isActive: true, deletedAt: null, ...meta } });
      return { factoryId: updated.factoryId, name: updated.name, entityType: 'WorkArea', action: 'WORK_AREA_RESTORED' };
    }
    const current = await tx.workAreaPosition.findFirst({ where: { id, workArea: { factoryId: user.selectedFactoryId } }, include: { workArea: true } });
    if (!current) throw new ConflictError('Позиция рабочей зоны не найдена');
    const updated = await tx.workAreaPosition.update({ where: { id }, data: { isActive: true, deletedAt: null, ...meta } });
    return { factoryId: current.workArea.factoryId, name: updated.title, entityType: 'WorkAreaPosition', action: 'WORK_AREA_POSITION_RESTORED' };
  }

  private async assertNotLastAdmin(tx: Prisma.TransactionClient, actorId: string, targetUserId: string, factoryId: string) {
    const activeAdmins = await tx.userFactoryAccess.count({
      where: { factoryId, role: UserRole.ADMIN, isActive: true, user: { blockedAt: null, deletedAt: null } },
    });
    const targetIsAdmin = await tx.userFactoryAccess.findFirst({
      where: { userId: targetUserId, factoryId, role: UserRole.ADMIN, isActive: true, user: { blockedAt: null, deletedAt: null } },
    });
    if (targetIsAdmin && activeAdmins <= 1) {
      await this.auditService.write({
        userId: actorId,
        factoryId,
        action: 'LAST_ADMIN_GUARD_BLOCKED',
        entityType: 'UserFactoryAccess',
        entityId: targetIsAdmin.id,
        details: { targetUserId, activeAdmins, reason: 'Нельзя убрать последнего активного администратора завода.' },
      });
      throw new ConflictError('Нельзя убрать последнего активного администратора завода.');
    }
  }

  private async isLastAdmin(userId: string, factoryId: string) {
    const activeAdmins = await this.prisma.db.userFactoryAccess.count({
      where: { factoryId, role: UserRole.ADMIN, isActive: true, user: { blockedAt: null, deletedAt: null } },
    });
    const targetIsAdmin = await this.prisma.db.userFactoryAccess.findFirst({
      where: { userId, factoryId, role: UserRole.ADMIN, isActive: true, user: { blockedAt: null, deletedAt: null } },
    });
    return Boolean(targetIsAdmin && activeAdmins <= 1);
  }

  private async rolePermissionCodes(role: UserRole) {
    const rows = await this.prisma.db.rolePermission.findMany({
      where: { role, isActive: true },
      select: { permissionCode: true },
      orderBy: { permissionCode: 'asc' },
    });
    return rows.map((row) => row.permissionCode);
  }

  private isAdminLikePermission(code: string) {
    return ADMIN_PERMISSION_PREFIXES.some((prefix) => code.startsWith(prefix) || code === prefix);
  }

  private async assertTemplateItems(factoryId: string, lineId: string, items: Array<{ positionId: string; requiredCount: number }>) {
    for (const item of items) {
      if (!item.positionId || item.requiredCount < 1) throw new ConflictError('invalid template item');
    }
    const positionIds = [...new Set(items.map((item) => item.positionId))];
    if (!positionIds.length) return;
    const count = await this.prisma.db.linePosition.count({ where: { id: { in: positionIds }, factoryId, lineId, isActive: true, deletedAt: null } });
    if (count !== positionIds.length) throw new ConflictError('template item position does not belong to line');
  }

  private async assertTemplateItemsTx(tx: Prisma.TransactionClient, factoryId: string, lineId: string, items: StaffingTemplateItemBody[]) {
    for (const item of items) {
      const planned = item.plannedCount ?? item.defaultPlanned ?? item.requiredCount;
      const min = item.minRequired ?? item.requiredCount ?? planned;
      const max = item.maxRequired ?? planned ?? min;
      if (!item.positionId || !Number.isInteger(Number(min)) || !Number.isInteger(Number(max)) || !Number.isInteger(Number(planned))) {
        throw new ConflictError('Строка шаблона состава заполнена некорректно');
      }
      if (Number(min) < 0 || Number(max) < Number(min) || Number(planned) < Number(min) || Number(planned) > Number(max)) {
        throw new ConflictError('План и диапазон состава должны быть положительными и согласованными');
      }
      if (!Number.isInteger(Number(item.sortOrder ?? 0)) || Number(item.sortOrder ?? 0) < 0) {
        throw new ConflictError('Порядок строки шаблона должен быть целым неотрицательным числом');
      }
    }
    const positionIds = [...new Set(items.map((item) => item.positionId))];
    if (positionIds.length !== items.length) throw new ConflictError('Позиция не должна повторяться в одном шаблоне');
    if (!positionIds.length) return;
    const count = await tx.linePosition.count({ where: { id: { in: positionIds }, factoryId, lineId, isActive: true, deletedAt: null } });
    if (count !== positionIds.length) throw new ConflictError('Позиция шаблона не относится к выбранной линии');
  }

  private async normalizeTemplateItemsTx(
    tx: Prisma.TransactionClient,
    factoryId: string,
    lineId: string,
    items: StaffingTemplateItemBody[],
  ) {
    await this.assertTemplateItemsTx(tx, factoryId, lineId, items);
    if (!items.length) return [];
    const positions = await tx.linePosition.findMany({
      where: { id: { in: items.map((item) => item.positionId) }, factoryId, lineId, isActive: true, deletedAt: null },
      select: { id: true, isExtraSlot: true, doesNotAffectShortage: true },
    });
    const byId = new Map(positions.map((position) => [position.id, position]));
    return items.map((item) => {
      const position = byId.get(item.positionId)!;
      return {
        ...item,
        isExtraSlot: Boolean(item.isExtraSlot || position.isExtraSlot),
        doesNotAffectShortage: Boolean(item.doesNotAffectShortage || position.doesNotAffectShortage),
      };
    });
  }

  private templateItemData(item: StaffingTemplateItemBody) {
    const requiredCount = Math.max(0, Number(item.requiredCount ?? item.defaultPlanned ?? item.plannedCount ?? 1));
    const minRequired = item.minRequired === null || item.minRequired === undefined ? requiredCount : Number(item.minRequired);
    const maxRequired = item.maxRequired === null || item.maxRequired === undefined ? Math.max(requiredCount, minRequired) : Number(item.maxRequired);
    const defaultPlanned = item.defaultPlanned === null || item.defaultPlanned === undefined ? requiredCount : Number(item.defaultPlanned);
    const plannedCount = item.plannedCount === null || item.plannedCount === undefined ? defaultPlanned : Number(item.plannedCount);
    return {
      positionId: item.positionId,
      requiredCount,
      minRequired,
      maxRequired,
      defaultPlanned,
      plannedCount,
      isFlexible: item.isFlexible ?? minRequired !== maxRequired,
      isExtraSlot: Boolean(item.isExtraSlot),
      doesNotAffectShortage: Boolean(item.doesNotAffectShortage),
      sortOrder: item.sortOrder ?? 0,
    };
  }

  private workAreaPositionData(body: WorkAreaPositionBody, title: string, current?: any) {
    const minRequired = Number(body.minRequired ?? current?.minRequired ?? 1);
    const maxRequired = Number(body.maxRequired ?? current?.maxRequired ?? minRequired);
    const defaultPlanned = Number(body.defaultPlanned ?? current?.defaultPlanned ?? minRequired);
    const plannedCount = body.plannedCount === null ? null : Number(body.plannedCount ?? current?.plannedCount ?? defaultPlanned);
    if (!Number.isInteger(minRequired) || !Number.isInteger(maxRequired) || !Number.isInteger(defaultPlanned) || (plannedCount !== null && !Number.isInteger(plannedCount))) {
      throw new ConflictError('Численность рабочей зоны должна быть целым числом');
    }
    if (minRequired < 0 || maxRequired < minRequired || defaultPlanned < 0 || (plannedCount !== null && plannedCount < 0)) {
      throw new ConflictError('Минимум, план и максимум рабочей зоны должны быть согласованы');
    }
    return {
      title,
      minRequired,
      maxRequired,
      defaultPlanned,
      plannedCount,
      isFlexible: body.isFlexible ?? minRequired !== maxRequired,
      isExtraSlot: Boolean(body.isExtraSlot ?? current?.isExtraSlot ?? false),
      doesNotAffectShortage: Boolean(body.doesNotAffectShortage ?? current?.doesNotAffectShortage ?? false),
      sortOrder: body.sortOrder ?? current?.sortOrder ?? 0,
    };
  }

  private async assertFactoryExistsTx(tx: Prisma.TransactionClient, factoryId: string) {
    const factory = await tx.factory.findFirst({ where: { id: factoryId, deletedAt: null } });
    if (!factory) throw new ConflictError('Завод не найден');
  }

  private async buildFactoryConfigExport(factory: { id: string; name: string; code: string; isActive: boolean }) {
    const [
      departments,
      globalServices,
      lines,
      workAreas,
      jobTitles,
      settings,
    ] = await Promise.all([
      this.prisma.db.department.findMany({ where: { factoryId: factory.id, deletedAt: null }, orderBy: [{ name: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.db.department.findMany({ where: { factoryId: null, scope: 'GLOBAL', deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.db.line.findMany({
        where: { factoryId: factory.id, deletedAt: null },
        include: {
          positions: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          staffingTemplates: {
            where: { deletedAt: null },
            include: { items: { include: { position: true }, orderBy: [{ sortOrder: 'asc' }] } },
            orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.db.workArea.findMany({
        where: { factoryId: factory.id, deletedAt: null },
        include: { positions: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.db.jobTitle.findMany({
        where: { factoryId: factory.id, deletedAt: null },
        include: { department: true },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      }),
      Promise.all(SETTINGS_MODELS.map(async (model) => ({ model, value: await (this.prisma.db as any)[model].findUnique({ where: { factoryId: factory.id } }) }))),
    ]);

    const usedKeys = new Set<string>();
    const departmentKeys = new Map<string, string>();
    const positionKeys = new Map<string, string>();

    const exportDepartments = departments
      .filter((department) => !hasPilotFixtureMarker(department.id, department.name, department.code))
      .map((department) => {
        const localKey = this.factoryConfigLocalKey('department', department.code || department.name, usedKeys);
        departmentKeys.set(department.id, localKey);
        return { localKey, name: department.name, code: department.code, scope: 'LOCAL', isActive: department.isActive };
      });

    const exportGlobalServices = globalServices
      .filter((department) => !hasPilotFixtureMarker(department.id, department.name, department.code))
      .map((department) => ({
        localKey: this.factoryConfigLocalKey('global-service', department.code || department.name, usedKeys),
        name: department.name,
        code: department.code,
        isActive: department.isActive,
      }));

    const exportLines = lines
      .filter((line) => !hasPilotFixtureMarker(line.id, line.name))
      .map((line) => {
        const lineLocalKey = this.factoryConfigLocalKey('line', line.name, usedKeys);
        const positions = line.positions
          .filter((position) => !hasPilotFixtureMarker(position.id, position.name, position.displayName, position.skillCode, position.skillFamilyKey))
          .map((position) => {
            const positionLocalKey = this.factoryConfigLocalKey('position', `${line.name}-${position.name}`, usedKeys);
            positionKeys.set(position.id, positionLocalKey);
            return {
              localKey: positionLocalKey,
              name: position.name,
              displayName: position.displayName,
              normalizedName: position.normalizedName,
              skillCode: position.skillCode,
              skillFamilyKey: position.skillFamilyKey,
              isExtraSlot: position.isExtraSlot,
              doesNotAffectShortage: position.doesNotAffectShortage,
              isFlexibleSkillGroup: position.isFlexibleSkillGroup,
              sortOrder: position.sortOrder,
              isActive: position.isActive,
            };
          });
        const staffingTemplates = line.staffingTemplates
          .filter((template) => !hasPilotFixtureMarker(template.id, template.name))
          .map((template) => ({
            localKey: this.factoryConfigLocalKey('template', `${line.name}-${template.name}`, usedKeys),
            name: template.name,
            isActive: template.isActive,
            items: template.items
              .filter((item) => positionKeys.has(item.positionId) && !hasPilotFixtureMarker(item.id, item.positionId, item.position?.name, item.position?.displayName))
              .map((item) => ({
                positionLocalKey: positionKeys.get(item.positionId),
                requiredCount: item.requiredCount,
                minRequired: item.minRequired,
                maxRequired: item.maxRequired,
                defaultPlanned: item.defaultPlanned,
                plannedCount: item.plannedCount,
                isFlexible: item.isFlexible,
                isExtraSlot: item.isExtraSlot,
                doesNotAffectShortage: item.doesNotAffectShortage,
                sortOrder: item.sortOrder,
              })),
          }));
        return { localKey: lineLocalKey, name: line.name, version: line.version, isActive: !line.deletedAt, positions, staffingTemplates };
      });

    const exportWorkAreas = workAreas
      .filter((area) => !hasPilotFixtureMarker(area.id, area.name, area.description))
      .map((area) => ({
        localKey: this.factoryConfigLocalKey('work-area', area.name, usedKeys),
        departmentLocalKey: area.departmentId ? departmentKeys.get(area.departmentId) ?? null : null,
        name: area.name,
        description: area.description,
        isActive: area.isActive,
        positions: area.positions
          .filter((position) => !hasPilotFixtureMarker(position.id, position.title))
          .map((position) => ({
            localKey: this.factoryConfigLocalKey('work-area-position', `${area.name}-${position.title}`, usedKeys),
            title: position.title,
            minRequired: position.minRequired,
            maxRequired: position.maxRequired,
            defaultPlanned: position.defaultPlanned,
            plannedCount: position.plannedCount,
            isFlexible: position.isFlexible,
            isExtraSlot: position.isExtraSlot,
            doesNotAffectShortage: position.doesNotAffectShortage,
            sortOrder: position.sortOrder,
            isActive: position.isActive,
          })),
      }));

    const exportJobTitles = jobTitles
      .filter((title) => !hasPilotFixtureMarker(title.id, title.name, title.code, title.description))
      .map((title) => ({
        localKey: this.factoryConfigLocalKey('job-title', title.code || title.name, usedKeys),
        departmentLocalKey: title.departmentId ? departmentKeys.get(title.departmentId) ?? null : null,
        name: title.name,
        code: title.code,
        baseRole: title.baseRole,
        shiftDurationHours: title.shiftDurationHours,
        permissionPreset: title.permissionPreset,
        description: title.description,
        isActive: title.isActive,
      }));

    const moduleSettings = settings
      .filter((item) => item.value)
      .map((item) => ({ model: item.model, data: this.safeModuleSettingsData(item.model, item.value) }));

    const config = {
      localDepartments: exportDepartments,
      globalServiceRefs: exportGlobalServices,
      lines: exportLines,
      workAreas: exportWorkAreas,
      jobTitles: exportJobTitles,
      moduleSettings,
    };
    return {
      schemaVersion: FACTORY_CONFIG_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sourceFactory: { name: factory.name, code: factory.code },
      config,
      counts: this.factoryConfigImportCounts({ schemaVersion: FACTORY_CONFIG_SCHEMA_VERSION, config }),
      runtimeCopied: false,
      notExported: this.factoryConfigNotImportedList(),
    };
  }

  private extractFactoryConfigFile(body: FactoryConfigImportBody) {
    const candidate = body?.config ?? body?.file ?? body;
    if (typeof candidate === 'string') {
      try {
        return JSON.parse(candidate);
      } catch {
        return { schemaVersion: null, config: null, __parseError: true };
      }
    }
    return candidate;
  }

  private normalizeFactoryConfigImportTarget(body: FactoryConfigImportBody, requireTarget: boolean) {
    const raw = body?.target ?? body ?? {};
    const name = raw.name?.trim();
    const code = this.normalizeFactoryCode(raw.code || raw.name || '');
    if (requireTarget && !name) throw new ConflictError('Название нового завода обязательно');
    if (requireTarget && !code) throw new ConflictError('Код нового завода обязателен');
    return { name: name ?? '', code, description: raw.description?.trim() || null, isActive: raw.isActive !== false };
  }

  private validateFactoryConfigFile(file: any) {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!file || typeof file !== 'object' || Array.isArray(file)) return { errors: ['Файл конфигурации должен быть JSON-объектом.'], warnings };
    if (file.__parseError) errors.push('Файл не удалось прочитать как JSON.');
    if (file.schemaVersion !== FACTORY_CONFIG_SCHEMA_VERSION) errors.push(`Поддерживается только схема ${FACTORY_CONFIG_SCHEMA_VERSION}.`);
    const config = file.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      errors.push('В файле отсутствует объект config.');
      return { errors, warnings };
    }
    const forbidden = this.scanForbiddenConfigKeys(file);
    if (forbidden.length) errors.push(`Файл содержит рабочую историю или секретные поля: ${forbidden.slice(0, 8).join(', ')}.`);

    const localDepartments = this.arrayConfig(config.localDepartments);
    const globalServiceRefs = this.arrayConfig(config.globalServiceRefs);
    const lines = this.arrayConfig(config.lines);
    const workAreas = this.arrayConfig(config.workAreas);
    const jobTitles = this.arrayConfig(config.jobTitles);
    const moduleSettings = this.arrayConfig(config.moduleSettings);
    this.validateUniqueLocalKeys(localDepartments, 'отделы', errors);
    this.validateUniqueLocalKeys(globalServiceRefs, 'общие службы', errors);
    this.validateUniqueLocalKeys(lines, 'линии', errors);
    this.validateUniqueLocalKeys(workAreas, 'рабочие зоны', errors);
    this.validateUniqueLocalKeys(jobTitles, 'должности', errors);
    const departmentKeys = new Set(localDepartments.map((item) => item.localKey).filter(Boolean));

    for (const department of localDepartments) {
      if (!this.safeText(department.name)) errors.push('У отдела должно быть название.');
      if (!this.safeText(department.code)) errors.push(`У отдела "${department.name ?? department.localKey}" должен быть код.`);
      if (hasPilotFixtureMarker(department.localKey, department.name, department.code)) warnings.push(`Тестовый отдел пропущен при импорте: ${department.name ?? department.localKey}`);
    }
    for (const service of globalServiceRefs) {
      if (!this.safeText(service.code)) errors.push(`У общей службы "${service.name ?? service.localKey}" должен быть код.`);
      if (hasPilotFixtureMarker(service.localKey, service.name, service.code)) warnings.push(`Тестовая общая служба пропущена при импорте: ${service.name ?? service.localKey}`);
    }
    for (const line of lines) {
      if (!this.safeText(line.name)) errors.push('У линии должно быть название.');
      if (hasPilotFixtureMarker(line.localKey, line.name)) warnings.push(`Тестовая линия пропущена при импорте: ${line.name ?? line.localKey}`);
      const positions = this.arrayConfig(line.positions);
      this.validateUniqueLocalKeys(positions, `позиции линии ${line.name ?? line.localKey}`, errors);
      const linePositionKeys = new Set<string>();
      for (const position of positions) {
        if (!this.safeText(position.name)) errors.push(`У позиции линии "${line.name ?? line.localKey}" должно быть название.`);
        if (position.localKey) linePositionKeys.add(position.localKey);
      }
      for (const template of this.arrayConfig(line.staffingTemplates)) {
        if (!this.safeText(template.name)) errors.push(`У шаблона линии "${line.name ?? line.localKey}" должно быть название.`);
        for (const item of this.arrayConfig(template.items)) {
          if (!linePositionKeys.has(item.positionLocalKey)) errors.push(`Строка шаблона "${template.name ?? template.localKey}" ссылается на неизвестную позицию.`);
          this.validateNonNegativeInt(item.requiredCount, 'План шаблона состава', errors);
          if (item.minRequired !== null && item.minRequired !== undefined) this.validateNonNegativeInt(item.minRequired, 'Минимум шаблона состава', errors);
          if (item.maxRequired !== null && item.maxRequired !== undefined) this.validateNonNegativeInt(item.maxRequired, 'Максимум шаблона состава', errors);
        }
      }
    }
    for (const area of workAreas) {
      if (!this.safeText(area.name)) errors.push('У рабочей зоны должно быть название.');
      if (area.departmentLocalKey && !departmentKeys.has(area.departmentLocalKey)) errors.push(`Рабочая зона "${area.name ?? area.localKey}" ссылается на неизвестный отдел.`);
      for (const position of this.arrayConfig(area.positions)) {
        if (!this.safeText(position.title)) errors.push(`У позиции рабочей зоны "${area.name ?? area.localKey}" должно быть название.`);
        this.validateNonNegativeInt(position.minRequired, 'Минимум рабочей зоны', errors);
        this.validateNonNegativeInt(position.maxRequired, 'Максимум рабочей зоны', errors);
        this.validateNonNegativeInt(position.defaultPlanned, 'План рабочей зоны', errors);
      }
    }
    for (const title of jobTitles) {
      if (!this.safeText(title.name)) errors.push('У должности должно быть название.');
      if (!this.safeText(title.code)) errors.push(`У должности "${title.name ?? title.localKey}" должен быть код.`);
      if (!Object.values(UserRole).includes(title.baseRole)) errors.push(`У должности "${title.name ?? title.localKey}" неизвестная базовая роль.`);
      if (title.shiftDurationHours !== undefined && ![12, 24].includes(Number(title.shiftDurationHours))) {
        errors.push(`У должности "${title.name ?? title.localKey}" длительность смены должна быть 12 или 24 часа.`);
      }
      if (title.departmentLocalKey && !departmentKeys.has(title.departmentLocalKey)) errors.push(`Должность "${title.name ?? title.localKey}" ссылается на неизвестный отдел.`);
    }
    for (const setting of moduleSettings) {
      if (!SETTINGS_MODELS.includes(setting.model)) {
        errors.push(`Неизвестный блок настроек: ${setting.model ?? 'без имени'}.`);
        continue;
      }
      const allowed = new Set(SETTING_ALLOWED_KEYS[setting.model] ?? []);
      for (const key of Object.keys(setting.data ?? {})) if (!allowed.has(key)) errors.push(`Настройка ${setting.model}.${key} не разрешена для импорта.`);
    }
    if (!lines.length && !workAreas.length && !localDepartments.length) warnings.push('В файле мало структуры: нет линий, рабочих зон и локальных отделов.');
    warnings.push('Пользователи, доступы, смены, заявки, чаты, вложения, объявления, уведомления и аудит не импортируются.');
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }

  private async importFactoryConfigTx(tx: Prisma.TransactionClient, factoryId: string, file: any) {
    const counts = this.emptyFactorySetupCounts();
    const config = file.config ?? {};
    const departmentMap = new Map<string, string>();
    const positionMap = new Map<string, string>();
    if (this.arrayConfig(config.globalServiceRefs).length) {
      await this.ensureSharedServicesTx(tx);
      counts.globalServices = await tx.department.count({ where: { factoryId: null, scope: 'GLOBAL', deletedAt: null, isActive: true } });
    }
    for (const department of this.arrayConfig(config.localDepartments)) {
      if (hasPilotFixtureMarker(department.localKey, department.name, department.code)) continue;
      const created = await tx.department.create({ data: { factoryId, name: department.name, normalizedName: this.normalizeOrganizationName(department.name), code: this.normalizeAdminCode(department.code || department.name), scope: DepartmentScope.LOCAL, isActive: department.isActive !== false } });
      departmentMap.set(department.localKey, created.id);
      counts.localDepartments += 1;
    }
    for (const line of this.arrayConfig(config.lines)) {
      if (hasPilotFixtureMarker(line.localKey, line.name)) continue;
      const createdLine = await tx.line.create({ data: { factoryId, name: line.name, status: 'STOP', version: Number(line.version ?? 1) } });
      counts.lines += 1;
      for (const position of this.arrayConfig(line.positions)) {
        if (hasPilotFixtureMarker(position.localKey, position.name, position.displayName, position.skillCode, position.skillFamilyKey)) continue;
        const createdPosition = await tx.linePosition.create({
          data: {
            factoryId,
            lineId: createdLine.id,
            name: position.name,
            displayName: position.displayName ?? null,
            normalizedName: position.normalizedName ?? this.normalizePositionName(position.displayName || position.name),
            skillCode: position.skillCode ?? null,
            skillFamilyKey: position.skillFamilyKey ?? null,
            isExtraSlot: Boolean(position.isExtraSlot),
            doesNotAffectShortage: Boolean(position.doesNotAffectShortage),
            isFlexibleSkillGroup: Boolean(position.isFlexibleSkillGroup),
            sortOrder: Number(position.sortOrder ?? 0),
            isActive: position.isActive !== false,
          },
        });
        positionMap.set(position.localKey, createdPosition.id);
        counts.linePositions += 1;
      }
      for (const template of this.arrayConfig(line.staffingTemplates)) {
        if (hasPilotFixtureMarker(template.localKey, template.name)) continue;
        const items = this.arrayConfig(template.items).filter((item) => positionMap.has(item.positionLocalKey)).map((item) => ({
          positionId: positionMap.get(item.positionLocalKey)!,
          requiredCount: Number(item.requiredCount ?? item.defaultPlanned ?? item.plannedCount ?? 1),
          minRequired: item.minRequired === null || item.minRequired === undefined ? null : Number(item.minRequired),
          maxRequired: item.maxRequired === null || item.maxRequired === undefined ? null : Number(item.maxRequired),
          defaultPlanned: item.defaultPlanned === null || item.defaultPlanned === undefined ? null : Number(item.defaultPlanned),
          plannedCount: item.plannedCount === null || item.plannedCount === undefined ? null : Number(item.plannedCount),
          isFlexible: Boolean(item.isFlexible),
          isExtraSlot: Boolean(item.isExtraSlot),
          doesNotAffectShortage: Boolean(item.doesNotAffectShortage),
          sortOrder: Number(item.sortOrder ?? 0),
        }));
        await tx.lineStaffingTemplate.create({ data: { factoryId, lineId: createdLine.id, name: template.name, isActive: template.isActive !== false, items: { create: items } } });
        counts.staffingTemplates += 1;
        counts.staffingTemplateItems += items.length;
      }
    }
    for (const area of this.arrayConfig(config.workAreas)) {
      if (hasPilotFixtureMarker(area.localKey, area.name, area.description)) continue;
      const createdArea = await tx.workArea.create({ data: { factoryId, departmentId: area.departmentLocalKey ? departmentMap.get(area.departmentLocalKey) ?? null : null, name: area.name, description: area.description ?? null, isActive: area.isActive !== false } });
      counts.workAreas += 1;
      for (const position of this.arrayConfig(area.positions)) {
        if (hasPilotFixtureMarker(position.localKey, position.title)) continue;
        await tx.workAreaPosition.create({ data: { workAreaId: createdArea.id, title: position.title, minRequired: Number(position.minRequired ?? 1), maxRequired: Number(position.maxRequired ?? position.minRequired ?? 1), defaultPlanned: Number(position.defaultPlanned ?? position.minRequired ?? 1), plannedCount: position.plannedCount === null || position.plannedCount === undefined ? null : Number(position.plannedCount), isFlexible: Boolean(position.isFlexible), isExtraSlot: Boolean(position.isExtraSlot), doesNotAffectShortage: Boolean(position.doesNotAffectShortage), sortOrder: Number(position.sortOrder ?? 0), isActive: position.isActive !== false } });
        counts.workAreaPositions += 1;
      }
    }
    for (const title of this.arrayConfig(config.jobTitles)) {
      if (hasPilotFixtureMarker(title.localKey, title.name, title.code, title.description)) continue;
      await tx.jobTitle.create({ data: { factoryId, departmentId: title.departmentLocalKey ? departmentMap.get(title.departmentLocalKey) ?? null : null, name: title.name, code: this.normalizeAdminCode(title.code || title.name), baseRole: title.baseRole, shiftDurationHours: this.normalizeJobTitleShiftDuration(title.shiftDurationHours), permissionPreset: title.permissionPreset ?? null, description: title.description ?? null, isActive: title.isActive !== false } });
      counts.jobTitles += 1;
    }
    for (const setting of this.arrayConfig(config.moduleSettings)) {
      if (!SETTINGS_MODELS.includes(setting.model)) continue;
      const data = this.safeModuleSettingsData(setting.model, setting.data);
      const existing = await (tx as any)[setting.model].findUnique({ where: { factoryId } });
      if (existing) await (tx as any)[setting.model].update({ where: { factoryId }, data });
      else await (tx as any)[setting.model].create({ data: { ...data, factoryId } });
      counts.moduleSettings += 1;
    }
    return counts;
  }

  private factoryConfigImportCounts(file: any) {
    const counts = this.emptyFactorySetupCounts();
    const config = file?.config ?? {};
    counts.localDepartments = this.arrayConfig(config.localDepartments).filter((item) => !hasPilotFixtureMarker(item.localKey, item.name, item.code)).length;
    counts.globalServices = this.arrayConfig(config.globalServiceRefs).filter((item) => !hasPilotFixtureMarker(item.localKey, item.name, item.code)).length;
    const lines = this.arrayConfig(config.lines).filter((item) => !hasPilotFixtureMarker(item.localKey, item.name));
    counts.lines = lines.length;
    counts.linePositions = lines.reduce((sum, line) => sum + this.arrayConfig(line.positions).filter((item) => !hasPilotFixtureMarker(item.localKey, item.name, item.displayName, item.skillCode, item.skillFamilyKey)).length, 0);
    counts.staffingTemplates = lines.reduce((sum, line) => sum + this.arrayConfig(line.staffingTemplates).filter((item) => !hasPilotFixtureMarker(item.localKey, item.name)).length, 0);
    counts.staffingTemplateItems = lines.reduce((sum, line) => sum + this.arrayConfig(line.staffingTemplates).reduce((nestedSum, template) => nestedSum + this.arrayConfig(template.items).length, 0), 0);
    const workAreas = this.arrayConfig(config.workAreas).filter((item) => !hasPilotFixtureMarker(item.localKey, item.name, item.description));
    counts.workAreas = workAreas.length;
    counts.workAreaPositions = workAreas.reduce((sum, area) => sum + this.arrayConfig(area.positions).filter((item) => !hasPilotFixtureMarker(item.localKey, item.title)).length, 0);
    counts.jobTitles = this.arrayConfig(config.jobTitles).filter((item) => !hasPilotFixtureMarker(item.localKey, item.name, item.code, item.description)).length;
    counts.moduleSettings = this.arrayConfig(config.moduleSettings).filter((item) => SETTINGS_MODELS.includes(item.model)).length;
    return counts;
  }

  private factoryConfigNotImportedList() {
    return [
      'Пользователи и доступы к заводам',
      'Смены, отметки “Я буду”, назначения и планы смен',
      'История линий, простои, заявки и комментарии',
      'Мойка, ОКК, возвраты, некондиция и складские движения',
      'Чаты, сообщения, объявления, ознакомления и уведомления',
      'Вложения, файлы, пути хранения и физическое хранилище',
      'Аудит, сессии, токены, хэши паролей и любые секреты',
    ];
  }

  private safeModuleSettingsData(model: string, value: any) {
    const allowed = new Set(SETTING_ALLOWED_KEYS[model] ?? []);
    const clean: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value ?? {})) {
      if (allowed.has(key)) clean[key] = this.cloneJsonSafe(raw);
    }
    return clean;
  }

  private scanForbiddenConfigKeys(value: any, path: string[] = [], hits: string[] = []) {
    if (!value || typeof value !== 'object') return hits;
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.scanForbiddenConfigKeys(item, [...path, String(index)], hits));
      return [...new Set(hits)];
    }
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      const exactForbidden = Array.from(FORBIDDEN_FACTORY_CONFIG_KEYS).some((forbidden) => forbidden.toLowerCase() === normalized);
      const idForbidden = ['id', 'factoryid', 'userid', 'departmentid', 'lineid', 'positionid', 'authorid', 'createdbyid'].includes(normalized);
      if (exactForbidden || idForbidden) hits.push([...path, key].join('.'));
      this.scanForbiddenConfigKeys(nested, [...path, key], hits);
    }
    return [...new Set(hits)];
  }

  private validateUniqueLocalKeys(items: any[], label: string, errors: string[]) {
    const seen = new Set<string>();
    for (const item of items) {
      if (!this.safeText(item.localKey)) {
        errors.push(`В блоке "${label}" у записи нет локального ключа.`);
        continue;
      }
      if (seen.has(item.localKey)) errors.push(`В блоке "${label}" повторяется локальный ключ.`);
      seen.add(item.localKey);
    }
  }

  private validateNonNegativeInt(value: unknown, label: string, errors: string[]) {
    const numeric = Number(value ?? 0);
    if (!Number.isInteger(numeric) || numeric < 0) errors.push(`${label}: нужно целое число не меньше нуля.`);
  }

  private safeText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private arrayConfig(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }

  private cloneJsonSafe(value: unknown) {
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  }

  private factoryConfigLocalKey(prefix: string, raw: unknown, used: Set<string>) {
    const source = String(raw ?? prefix).trim().toLowerCase();
    let base = source
      .normalize('NFKD')
      .replace(/[^\wА-Яа-яЁё]+/g, '-')
      .replace(/_+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 56);
    if (!base) base = prefix;
    let key = `${prefix}-${base}`.slice(0, 80);
    let index = 2;
    while (used.has(key)) {
      key = `${prefix}-${base}-${index}`.slice(0, 80);
      index += 1;
    }
    used.add(key);
    return key;
  }

  private async assertDepartmentBelongsToFactoryTx(tx: Prisma.TransactionClient, departmentId: string | null | undefined, factoryId: string | null) {
    if (!departmentId) return;
    const department = await tx.department.findFirst({ where: { id: departmentId, deletedAt: null } });
    if (!department) throw new ConflictError('Отдел или служба не найдены');
    if (department.scope === DepartmentScope.GLOBAL) return;
    if (!factoryId || department.factoryId !== factoryId) throw new ConflictError('Отдел не относится к выбранному заводу');
  }

  private async assertCompanyScopeTx(tx: Prisma.TransactionClient, companyId: string | null | undefined, factoryId: string) {
    if (!companyId) return;
    const company = await tx.externalCompany.findFirst({ where: { id: companyId, factoryId, isActive: true } });
    if (!company) throw new ConflictError('Фирма наёмных работников не найдена или отключена');
  }

  private async assertAccessOrganizationContextTx(
    tx: Prisma.TransactionClient,
    role: UserRole,
    departmentId: string | null | undefined,
    companyId: string | null | undefined,
    factoryId: string,
  ) {
    const contractorRole = role === UserRole.CONTRACTOR || role === UserRole.CONTRACTOR_LEAD;
    if (contractorRole && !companyId) throw new ConflictError('Для наёмного работника выберите фирму');
    if (contractorRole && departmentId) throw new ConflictError('Наёмный работник назначается в фирму, а не во внутренний отдел');
    if (!contractorRole && companyId) throw new ConflictError('Фирма доступна только для ролей наёмных работников');
    await this.assertDepartmentBelongsToFactoryTx(tx, departmentId, factoryId);
    await this.assertCompanyScopeTx(tx, companyId, factoryId);
  }

  private normalizeAdminCode(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9а-яё-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }

  private normalizePositionName(value: string) {
    return this.normalizeAdminCode(value).replace(/-/g, '_') || 'position';
  }

  private serializeContextDepartment(department: any, userCount: number, shared: boolean) {
    return {
      id: department.id,
      factoryId: department.factoryId,
      factoryName: department.factory?.name ?? null,
      scope: department.scope,
      name: department.name,
      code: department.code,
      isActive: department.isActive,
      userCount,
      kind: shared ? 'GLOBAL_SERVICE' : 'LOCAL_DEPARTMENT',
      contextNote: shared
        ? 'Общая служба: доступ сотрудников всё равно задаётся через выбранный завод.'
        : 'Локальный отдел выбранного завода.',
    };
  }

  private serializeJobTitle(title: any) {
    return {
      id: title.id,
      factoryId: title.factoryId,
      factoryName: title.factory?.name ?? null,
      departmentId: title.departmentId,
      departmentName: title.department?.name ?? null,
      parentJobTitleId: title.parentJobTitleId ?? null,
      parentJobTitleName: title.parentJobTitle?.name ?? null,
      childrenCount: Array.isArray(title.childJobTitles) ? title.childJobTitles.filter((child: any) => child.isActive && !child.deletedAt).length : 0,
      name: title.name,
      code: title.code,
      baseRole: title.baseRole,
      shiftDurationHours: title.shiftDurationHours,
      permissionPreset: title.permissionPreset,
      description: title.description,
      isActive: title.isActive,
      deletedAt: title.deletedAt,
    };
  }

  private cleanJobTitle(title: any) {
    return {
      id: title.id,
      factoryId: title.factoryId,
      departmentId: title.departmentId,
      parentJobTitleId: title.parentJobTitleId ?? null,
      parentJobTitleName: title.parentJobTitle?.name ?? null,
      name: title.name,
      code: title.code,
      baseRole: title.baseRole,
      shiftDurationHours: title.shiftDurationHours,
      permissionPreset: title.permissionPreset,
      isActive: title.isActive,
      deletedAt: title.deletedAt,
    };
  }

  private normalizeJobTitleShiftDuration(value: unknown, fallback = 12): 12 | 24 {
    const duration = value === undefined || value === null || value === '' ? Number(fallback) : Number(value);
    if (duration !== 12 && duration !== 24) {
      throw new ConflictError('Длительность смены для должности должна быть 12 или 24 часа');
    }
    return duration;
  }

  private serializeWorkArea(area: any) {
    return {
      id: area.id,
      factoryId: area.factoryId,
      departmentId: area.departmentId,
      assignmentKind: area.assignmentKind,
      name: area.name,
      description: area.description,
      isActive: area.isActive,
      deletedAt: area.deletedAt,
      positions: (area.positions ?? []).map((position: any) => ({
        id: position.id,
        title: position.title,
        minRequired: position.minRequired,
        maxRequired: position.maxRequired,
        defaultPlanned: position.defaultPlanned,
        plannedCount: position.plannedCount,
        isFlexible: position.isFlexible,
        isExtraSlot: position.isExtraSlot,
        doesNotAffectShortage: position.doesNotAffectShortage,
        sortOrder: position.sortOrder,
        isActive: position.isActive,
        deletedAt: position.deletedAt,
      })),
    };
  }

  private cleanWorkArea(area: any) {
    return {
      id: area.id,
      factoryId: area.factoryId,
      departmentId: area.departmentId,
      assignmentKind: area.assignmentKind,
      name: area.name,
      description: area.description,
      isActive: area.isActive,
      deletedAt: area.deletedAt,
    };
  }

  private serializeModuleSettings(key: string, title: string, factoryId: string, settings: any) {
    return {
      key,
      title,
      factoryId,
      scope: 'factory',
      scopeLabel: `Настройки для выбранного завода`,
      configured: Boolean(settings),
      summary: this.moduleSettingsSummary(settings),
    };
  }

  private moduleSettingsSummary(settings: any) {
    if (!settings) return ['Настройки ещё не созданы для этого завода.'];
    return Object.entries(settings)
      .filter(([key]) => !['id', 'factoryId', 'createdAt', 'updatedAt'].includes(key))
      .slice(0, 5)
      .map(([key, value]) => `${this.adminSettingLabel(key)}: ${this.adminSettingValue(value)}`);
  }

  private adminSettingLabel(key: string) {
    return ADMIN_SETTING_LABELS[key] ?? 'Техническая настройка без русского названия';
  }

  private adminSettingValue(value: unknown) {
    if (typeof value === 'boolean') return value ? 'включено' : 'выключено';
    if (value === null || value === undefined || value === '') return 'не задано';
    if (Array.isArray(value)) return value.length ? `пунктов: ${value.length}` : 'пусто';
    if (typeof value === 'object') return 'задано';
    return String(value);
  }

  private auditDetailsSummary(details: Prisma.JsonValue) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
    const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
    const keyLabels: Record<string, string> = {
      path: 'раздел',
      role: 'роль',
      method: 'действие',
      isGuest: 'гость',
      reason: 'причина',
      total: 'всего',
      acknowledged: 'ознакомились',
      marker: 'пометка',
      priority: 'важность',
      visibleFrom: 'начало показа',
      visibleUntil: 'срок действия',
      departmentId: 'отдел',
      attachmentEntityId: 'связанный объект',
      attachmentEntityType: 'раздел',
      kind: 'тип',
      mimeType: 'тип файла',
      sizeBytes: 'размер',
      factoryId: 'завод',
      includeArchive: 'архив',
      schemaVersion: 'версия схемы',
      sourceFactoryId: 'завод-источник',
      sourceFactory: 'завод-источник',
      targetFactoryId: 'завод-получатель',
      runtimeCopied: 'рабочая история скопирована',
      oldValue: 'старое значение',
      newValue: 'новое значение',
    };
    return Object.entries(details as Record<string, unknown>)
      .filter(([key]) => !/password|token|secret|storagePath/i.test(key))
      .slice(0, 4)
      .map(([key, value]) => {
        const label = keyLabels[key] ?? this.adminAuditKeyLabel(key);
        if (typeof value === 'object') return `${label === 'техническое поле' ? 'изменение' : label}: изменено`;
        const safeValue = this.adminAuditValueLabel(key, String(value).replace(uuidPattern, 'идентификатор скрыт'));
        if (label === 'техническое поле') return `изменение: ${safeValue}`;
        return `${keyLabels[key] ?? this.adminAuditKeyLabel(key)}: ${safeValue}`;
      });
  }

  private adminAuditValueLabel(key: string, value: string) {
    const roleLabels: Record<string, string> = {
      ADMIN: 'Администратор',
      MANAGEMENT: 'Руководство',
      MASTER: 'Мастер',
      WORKER: 'Работник',
      CONTRACTOR: 'Наёмный работник',
      CONTRACTOR_LEAD: 'Старший наёмных работников',
      OKK: 'ОКК',
      STORE: 'Склад',
      TECHNOLOGIST: 'Технолог',
      TECH_KIPIA: 'КИПиА',
      TECH_HOLOD: 'Холодильная служба',
      TECH_MECHANIC: 'Механик',
      GUEST: 'Гость',
    };
    const methodLabels: Record<string, string> = {
      GET: 'просмотр',
      POST: 'создание',
      PATCH: 'изменение',
      PUT: 'изменение',
      DELETE: 'отключение',
    };
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return 'дата и время';
    if (key === 'role') return roleLabels[value] ?? 'роль';
    if (key === 'method') return methodLabels[value] ?? 'действие';
    if (key === 'schemaVersion') return 'версия 1';
    if (key === 'reason') {
      if (value === 'announcement report scope denied') return 'нет доступа к отчёту ознакомления';
      if (value === 'access denied') return 'доступ запрещён';
      if (/[A-Za-z]/.test(value)) return 'доступ запрещён';
    }
    if (key === 'status') {
      if (value === 'blocker') return 'есть блокеры';
      if (value === 'warning') return 'нужно проверить';
      if (value === 'ready') return 'готово';
    }
    if (value === 'true') return 'да';
    if (value === 'false') return 'нет';
    if (key === 'path') {
      const route = value.split('?')[0];
      if (route.startsWith('/ops/operations')) return 'операционная аналитика';
      if (route.startsWith('/admin/factories')) return 'администрирование завода';
      if (route.startsWith('/admin/recovery')) return 'восстановление данных';
      if (route.startsWith('/archive')) return 'архив';
      if (route.startsWith('/checklists')) return 'чек-листы';
      if (route.startsWith('/announcements')) return 'объявления';
      if (route.startsWith('/chats')) return 'чаты';
      if (route.startsWith('/tasks')) return 'заявки';
      if (route.startsWith('/wash')) return 'мойка';
      return 'раздел системы';
    }
    if (/[a-z]+[A-Z][A-Za-z]+/.test(value)) return 'скрыто';
    if (/^[A-Z_]{2,}$/.test(value)) return 'значение';
    return value;
  }

  private adminAuditKeyLabel(key: string) {
    const readable = key.replace(/([A-Z])/g, ' $1').toLowerCase();
    const wordLabels: Record<string, string> = {
      audit: 'аудит',
      config: 'конфигурация',
      count: 'количество',
      create: 'создание',
      deleted: 'отключено',
      export: 'экспорт',
      factory: 'завод',
      import: 'импорт',
      include: 'включено',
      role: 'роль',
      source: 'источник',
      target: 'получатель',
      user: 'пользователь',
    };
    const translated = readable
      .split(/[^a-zа-яё0-9]+/i)
      .filter(Boolean)
      .map((part) => wordLabels[part] ?? part)
      .join(' ');
    return /[A-Za-z]/.test(translated) ? 'техническое поле' : translated;
  }

  private auditEntityLabel(entityType: string) {
    const labels: Record<string, string> = {
      Factory: 'Завод',
      FactoryConfig: 'Конфигурация завода',
      Permission: 'Право',
      Auth: 'Авторизация',
      AuditLog: 'Аудит',
      Announcement: 'Объявление',
      AnnouncementSettings: 'Настройки объявлений',
      Attachment: 'Вложение',
      Assignment: 'Назначение сотрудника',
      Chat: 'Чат',
      ChatMessage: 'Сообщение чата',
      ChatPoll: 'Опрос в чате',
      ChatSettings: 'Настройки чатов',
      Defrost: 'Оттайка',
      DefrostEvent: 'Событие оттайки',
      ErrorReport: 'Сообщение об ошибке',
      User: 'Пользователь',
      UserFactoryAccess: 'Доступ сотрудника',
      UserPermissionOverride: 'Индивидуальное право',
      UserProfileNote: 'Заметка в профиле',
      UserSkill: 'Навык сотрудника',
      Department: 'Отдел',
      Line: 'Линия',
      LineEvent: 'Событие линии',
      LinePosition: 'Позиция линии',
      LineShiftResult: 'Итог смены линии',
      LineShiftState: 'Состояние линии в смене',
      LineShiftWorkPlan: 'План работы линии',
      LineShiftWorkPlanRow: 'Строка плана линии',
      LineStaffingTemplate: 'Шаблон состава',
      LineStaffingTemplateItem: 'Позиция шаблона состава',
      MinimumStockItem: 'Позиция остатка',
      OkkRecord: 'Запись ОКК',
      OrderRequest: 'Заявка на заказ',
      People: 'Сотрудники',
      PlannedLineAssignment: 'Плановое назначение на линию',
      PlannedShiftAssignment: 'Плановое назначение в смену',
      PushSubscription: 'Подписка на уведомления',
      ReturnRecord: 'Возврат',
      RolePermission: 'Право роли',
      ShiftLog: 'Запись пересменки',
      ShiftLogComment: 'Комментарий пересменки',
      ShiftReturnRequest: 'Заявка на возврат в смену',
      ShiftSession: 'Смена',
      ShiftWillBe: 'Отметка “Я буду”',
      StockDefect: 'Некондиция',
      Task: 'Заявка',
      TaskComment: 'Комментарий заявки',
      ChecklistTemplate: 'Шаблон чек-листа',
      ChecklistTemplateRow: 'Пункт шаблона чек-листа',
      Checklist: 'Чек-лист',
      ChecklistReport: 'Отчёт чек-листа',
      ChecklistRun: 'Запуск чек-листа',
      ChecklistRunRow: 'Пункт чек-листа',
      ChecklistRunCheck: 'Проверка чек-листа',
      ChecklistSettings: 'Настройки чек-листов',
      ContractorShiftSubmission: 'Подача подрядчиков',
      ContractorShiftSubmissionItem: 'Сотрудник подрядчика',
      DataHygiene: 'Диагностика данных',
      OrderSettings: 'Настройки заказов',
      TaskSettings: 'Настройки заявок',
      WashSession: 'Мойка',
      WashMessage: 'Сообщение мойки',
      WashIssue: 'Проблема мойки',
      WashControlItem: 'Задание мойки',
      WashOkkReview: 'Проверка ОКК по мойке',
      WashSettings: 'Настройки мойки',
      WorkArea: 'Рабочая зона',
      WorkAreaPosition: 'Позиция рабочей зоны',
      ShiftSettings: 'Настройки смены',
      DefrostSettings: 'Настройки оттайки',
      OpsAnalytics: 'Операционная аналитика',
      Notification: 'Уведомление',
    };
    return labels[entityType] ?? (/[A-Za-z]/.test(entityType) ? 'Объект системы' : entityType);
  }

  private sanitizeContextLine(line: any) {
    return {
      ...line,
      positions: line.positions.filter((position: any) =>
        position.isActive &&
        !position.deletedAt &&
        !hasPilotFixtureMarker(position.id, position.name, position.displayName, position.skillCode, position.skillFamilyKey),
      ),
      staffingTemplates: line.staffingTemplates
        .filter((template: any) => template.isActive && !template.deletedAt && !hasPilotFixtureMarker(template.id, template.name))
        .map((template: any) => ({
          ...template,
          items: template.items.filter((item: any) =>
            !hasPilotFixtureMarker(item.id, item.positionId, item.position?.name, item.position?.displayName),
          ),
        })),
    };
  }

  private serializeAccess(access: any) {
    return {
      id: access.id,
      factoryId: access.factoryId,
      factoryName: access.factory?.name ?? null,
      role: access.role,
      departmentId: access.departmentId,
      departmentName: access.department?.name ?? null,
      jobTitleId: access.jobTitleId ?? null,
      jobTitleName: access.jobTitle?.name ?? null,
      companyId: access.companyId ?? null,
      companyName: access.company?.name ?? null,
      isGuest: access.isGuest,
      isActive: access.isActive,
    };
  }

  private cleanAccess(access: any) {
    return {
      role: access.role,
      departmentId: access.departmentId,
      jobTitleId: access.jobTitleId ?? null,
      jobTitleName: access.jobTitle?.name ?? null,
      companyId: access.companyId ?? null,
      isGuest: access.isGuest,
      isActive: access.isActive,
    };
  }

  private serializeLineConfig(line: any) {
    return {
      id: line.id,
      factoryId: line.factoryId,
      name: line.name,
      status: line.status,
      deletedAt: line.deletedAt,
      defaultStaffingTemplateId: line.defaultStaffingTemplateId,
      positions: line.positions.map((position: any) => ({
        id: position.id,
        name: position.name,
        displayName: position.displayName,
        normalizedName: position.normalizedName,
        skillCode: position.skillCode,
        skillFamilyKey: position.skillFamilyKey,
        isExtraSlot: position.isExtraSlot,
        doesNotAffectShortage: position.doesNotAffectShortage,
        sortOrder: position.sortOrder,
        isActive: position.isActive,
        deletedAt: position.deletedAt,
      })),
      staffingTemplates: line.staffingTemplates.map((template: any) => ({
        id: template.id,
        name: template.name,
        isActive: template.isActive,
        deletedAt: template.deletedAt,
        items: template.items.map((item: any) => ({
          id: item.id,
          positionId: item.positionId,
          positionName: item.position?.name ?? null,
          requiredCount: item.requiredCount,
          minRequired: item.minRequired,
          maxRequired: item.maxRequired,
          defaultPlanned: item.defaultPlanned,
          plannedCount: item.plannedCount,
          isFlexible: item.isFlexible,
          isExtraSlot: item.isExtraSlot,
          doesNotAffectShortage: item.doesNotAffectShortage,
          sortOrder: item.sortOrder,
        })),
      })),
    };
  }

  private async ensureShiftSettings(factoryId: string) {
    const existing = await this.prisma.db.shiftSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.shiftSettings.create({ data: { factoryId } });
  }

  private async ensureTaskSettings(factoryId: string) {
    const existing = await this.prisma.db.taskSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.taskSettings.create({ data: { factoryId } });
  }

  private async ensureWashSettings(factoryId: string) {
    const existing = await this.prisma.db.washSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.washSettings.create({ data: { factoryId } });
  }

  private async ensureDefrostSettings(factoryId: string) {
    const existing = await this.prisma.db.defrostSettings.findUnique({ where: { factoryId } });
    if (existing) return existing;
    return this.prisma.db.defrostSettings.create({ data: { factoryId } });
  }

  private normalizeShiftSettingsInput(current: any, body: any) {
    const numeric = (key: string) => {
      const value = body[key];
      return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : current[key];
    };
    const text = (key: string) => {
      const value = body[key];
      return typeof value === 'string' && value.trim() ? value.trim() : current[key];
    };
    const bool = (key: string) => (typeof body[key] === 'boolean' ? body[key] : current[key]);
    return {
      dayShiftStartTime: text('dayShiftStartTime'),
      dayShiftEndTime: text('dayShiftEndTime'),
      nightShiftStartTime: text('nightShiftStartTime'),
      nightShiftEndTime: text('nightShiftEndTime'),
      willBeOpenHoursBeforeShift: numeric('willBeOpenHoursBeforeShift'),
      noShowCheckMinutesAfterShiftStart: numeric('noShowCheckMinutesAfterShiftStart'),
      minAssignmentMoveIntervalMinutes: numeric('minAssignmentMoveIntervalMinutes'),
      contractorLeadMaxPeoplePerShift: numeric('contractorLeadMaxPeoplePerShift'),
      returnRequestEnabled: bool('returnRequestEnabled'),
      autoCloseChecklistsAtShiftEnd: bool('autoCloseChecklistsAtShiftEnd'),
      sendHomeRequiresComment: bool('sendHomeRequiresComment'),
      willBeCancelRequiresComment: bool('willBeCancelRequiresComment'),
    };
  }

  private cleanShiftSettings(settings: any) {
    return {
      dayShiftStartTime: settings.dayShiftStartTime,
      dayShiftEndTime: settings.dayShiftEndTime,
      nightShiftStartTime: settings.nightShiftStartTime,
      nightShiftEndTime: settings.nightShiftEndTime,
      willBeOpenHoursBeforeShift: settings.willBeOpenHoursBeforeShift,
      noShowCheckMinutesAfterShiftStart: settings.noShowCheckMinutesAfterShiftStart,
      minAssignmentMoveIntervalMinutes: settings.minAssignmentMoveIntervalMinutes,
      contractorLeadMaxPeoplePerShift: settings.contractorLeadMaxPeoplePerShift,
      returnRequestEnabled: settings.returnRequestEnabled,
      autoCloseChecklistsAtShiftEnd: settings.autoCloseChecklistsAtShiftEnd,
      sendHomeRequiresComment: settings.sendHomeRequiresComment,
      willBeCancelRequiresComment: settings.willBeCancelRequiresComment,
    };
  }

  private projectRootDir() {
    const cwd = process.cwd();
    return path.basename(cwd).toLowerCase() === 'backend' ? path.resolve(cwd, '..') : cwd;
  }

  private redactPilotHealthReport(value: any): any {
    if (Array.isArray(value)) return value.map((item) => this.redactPilotHealthReport(item));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, any> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (/passwordHash|storagePath|databaseUrl|DATABASE_URL|JWT_SECRET|accessToken|refreshToken|authToken|tokenHash|secret/i.test(key)) {
        result[key] = '[redacted]';
      } else {
        result[key] = this.redactPilotHealthReport(inner);
      }
    }
    return result;
  }

  private normalizeTaskSettingsInput(current: any, body: any) {
    const numericNullable = (key: string) => {
      if (body[key] === null) return null;
      return typeof body[key] === 'number' && Number.isFinite(body[key]) ? Math.trunc(body[key]) : current[key];
    };
    const numeric = (key: string) => {
      const value = body[key];
      return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : current[key];
    };
    const bool = (key: string) => (typeof body[key] === 'boolean' ? body[key] : current[key]);
    const textNullable = (key: string) => {
      if (body[key] === null) return null;
      return typeof body[key] === 'string' ? body[key].trim() || null : current[key];
    };
    return {
      longTaskDefaultDeadlineHours: numericNullable('longTaskDefaultDeadlineHours'),
      longTaskEscalationEnabled: bool('longTaskEscalationEnabled'),
      longTaskEscalationGraceMinutes: numeric('longTaskEscalationGraceMinutes'),
      urgentTaskRequiresLineWhenCreatedFromLine: bool('urgentTaskRequiresLineWhenCreatedFromLine'),
      taskRedirectRequiresComment: bool('taskRedirectRequiresComment'),
      taskDoneRequiresComment: bool('taskDoneRequiresComment'),
      taskReadReceiptsEnabled: bool('taskReadReceiptsEnabled'),
      taskAttachmentsEnabled: bool('taskAttachmentsEnabled'),
      taskDepartmentRecipientsEnabled: bool('taskDepartmentRecipientsEnabled'),
      taskPersonalAssigneeEnabled: bool('taskPersonalAssigneeEnabled'),
      taskChatMirrorEnabledReserved: bool('taskChatMirrorEnabledReserved'),
      taskStorageRetentionMode: textNullable('taskStorageRetentionMode'),
    };
  }

  private cleanTaskSettings(settings: any) {
    return {
      longTaskDefaultDeadlineHours: settings.longTaskDefaultDeadlineHours,
      longTaskEscalationEnabled: settings.longTaskEscalationEnabled,
      longTaskEscalationGraceMinutes: settings.longTaskEscalationGraceMinutes,
      urgentTaskRequiresLineWhenCreatedFromLine: settings.urgentTaskRequiresLineWhenCreatedFromLine,
      taskRedirectRequiresComment: settings.taskRedirectRequiresComment,
      taskDoneRequiresComment: settings.taskDoneRequiresComment,
      taskReadReceiptsEnabled: settings.taskReadReceiptsEnabled,
      taskAttachmentsEnabled: settings.taskAttachmentsEnabled,
      taskDepartmentRecipientsEnabled: settings.taskDepartmentRecipientsEnabled,
      taskPersonalAssigneeEnabled: settings.taskPersonalAssigneeEnabled,
      taskChatMirrorEnabledReserved: settings.taskChatMirrorEnabledReserved,
      taskStorageRetentionMode: settings.taskStorageRetentionMode,
    };
  }

  private normalizeWashSettingsInput(current: any, body: any) {
    const bool = (key: string) => (typeof body[key] === 'boolean' ? body[key] : current[key]);
    return {
      washIssueRequiresPhoto: bool('washIssueRequiresPhoto'),
      washIssueResolveRequiresPhoto: bool('washIssueResolveRequiresPhoto'),
      washCompleteRequiresOkkReview: bool('washCompleteRequiresOkkReview'),
      washCompleteRequiresNoOpenIssues: bool('washCompleteRequiresNoOpenIssues'),
      washMiniTasksEnabled: bool('washMiniTasksEnabled'),
      washControlEnabled: bool('washControlEnabled'),
      washOkkReviewEnabled: bool('washOkkReviewEnabled'),
      washDefaultControlItems: body.washDefaultControlItems === undefined ? current.washDefaultControlItems : body.washDefaultControlItems,
      washAllowNonLineWorkers: bool('washAllowNonLineWorkers'),
      washMessagesEnabled: bool('washMessagesEnabled'),
      washAttachmentsEnabled: bool('washAttachmentsEnabled'),
    };
  }

  private cleanWashSettings(settings: any) {
    return {
      washIssueRequiresPhoto: settings.washIssueRequiresPhoto,
      washIssueResolveRequiresPhoto: settings.washIssueResolveRequiresPhoto,
      washCompleteRequiresOkkReview: settings.washCompleteRequiresOkkReview,
      washCompleteRequiresNoOpenIssues: settings.washCompleteRequiresNoOpenIssues,
      washMiniTasksEnabled: settings.washMiniTasksEnabled,
      washControlEnabled: settings.washControlEnabled,
      washOkkReviewEnabled: settings.washOkkReviewEnabled,
      washDefaultControlItems: settings.washDefaultControlItems,
      washAllowNonLineWorkers: settings.washAllowNonLineWorkers,
      washMessagesEnabled: settings.washMessagesEnabled,
      washAttachmentsEnabled: settings.washAttachmentsEnabled,
    };
  }

  private normalizeDefrostSettingsInput(current: any, body: any) {
    const bool = (key: string) => (typeof body[key] === 'boolean' ? body[key] : current[key]);
    return {
      defrostCommentRequiredOnStart: bool('defrostCommentRequiredOnStart'),
      defrostCommentRequiredOnEnd: bool('defrostCommentRequiredOnEnd'),
      defrostShowOnLineDashboard: bool('defrostShowOnLineDashboard'),
      defrostCalendarEnabled: bool('defrostCalendarEnabled'),
      defrostAttachmentsEnabled: bool('defrostAttachmentsEnabled'),
    };
  }

  private cleanDefrostSettings(settings: any) {
    return {
      defrostCommentRequiredOnStart: settings.defrostCommentRequiredOnStart,
      defrostCommentRequiredOnEnd: settings.defrostCommentRequiredOnEnd,
      defrostShowOnLineDashboard: settings.defrostShowOnLineDashboard,
      defrostCalendarEnabled: settings.defrostCalendarEnabled,
      defrostAttachmentsEnabled: settings.defrostAttachmentsEnabled,
    };
  }
}
