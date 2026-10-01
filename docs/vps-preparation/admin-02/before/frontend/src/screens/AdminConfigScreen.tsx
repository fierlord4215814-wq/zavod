import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { createOperationId } from '../api/operation';
import { AdminConfirmDialog } from '../components/AdminConfirmDialog';
import { CompactPeoplePicker } from '../components/CompactPeoplePicker';
import { HelpTooltip } from '../components/HelpTooltip';
import { PremiumSectionHeader, PremiumSheet } from '../components/PremiumShell';
import { lineStatusLabels, roleLabel } from '../labels';
import { canShowScreen, SCREEN_DEFINITIONS } from '../navigation/permissions';
import { useMobileFormDirty } from '../navigation/mobile-back';
import { useAppStore } from '../store/app.store';
import { diagnosticDisplayText, isPilotFixtureText, isPilotFixtureUser, permissionDescriptionLabel, permissionGroupLabel, permissionLabel, pilotUserName, shortPersonName } from '../utils/pilot-ui';

void React;

type Overview = {
  factoriesCount: number;
  activeFactories: number;
  usersCount: number;
  blockedUsersCount: number;
  departmentsCount: number;
  rolesCount: number;
  permissionsCount: number;
  linesCount: number;
  positionsCount: number;
  staffingTemplatesCount: number;
  selectedFactoryId: string;
  warnings: {
    usersWithoutFactoryAccess: number;
    usersWithoutDepartment: number;
    linesWithoutActivePositions: number;
    linesWithoutStaffingTemplates: number;
    rolesWithoutPermissions: string[];
    departmentsWithoutManagementUsers: Array<{ id: string; name: string }>;
  };
};

type SettingsMap = Record<string, unknown>;

type AccessRow = {
  id: string;
  factoryId: string;
  factoryName: string | null;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  jobTitleId: string | null;
  jobTitleName: string | null;
  companyId: string | null;
  companyName: string | null;
  isActive: boolean;
  isGuest: boolean;
};

type AdminUser = {
  id: string;
  displayName: string;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  globalRole: string;
  employeeState: string;
  blockedAt: string | null;
  selectedFactoryAccess: AccessRow | null;
  factoryAccesses: AccessRow[];
  overridesCount: number;
};

type AdminUserProfile = AdminUser & {
  permissionsSummary: string[];
  auditSummary: Array<{ id: string; action: string; entityType: string; createdAt: string }>;
  safety: { isLastAdmin: boolean; canBlock: boolean; canChangeRole: boolean; warnings: string[] };
};

type FactoryRow = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  counts: { users: number; departments: number; lines?: number };
};

type DepartmentRow = {
  id: string;
  name: string;
  code: string;
  scope: string;
  factoryId: string | null;
  factoryName: string | null;
  isActive: boolean;
  userCount: number;
};

type ExternalCompanyRow = {
  id: string;
  factoryId: string;
  name: string;
  isActive: boolean;
  membersCount: number;
  requestsCount: number;
  leads: Array<{ userId: string; displayName: string }>;
};

type AssignmentRequestRow = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  requestedById: string;
  requestedByName: string | null;
  requestedRole: string;
  departmentId: string | null;
  departmentName: string | null;
  companyId: string | null;
  companyName: string | null;
  comment: string | null;
  version: number;
  createdAt: string;
  decisionReason: string | null;
};

type OrganizationIdentityReport = {
  factoryId: string;
  departmentDuplicateGroups: Array<{
    name: string;
    duplicates: Array<{ active: boolean; impact: { users: number; requests: number; chats: number } }>;
  }>;
  phone: {
    collisionGroups: number;
    collisionRecords: number;
    invalidRecords: number;
  };
  automaticMergePerformed: boolean;
  generatedAt: string;
};

type RoleRow = { role: string; permissionsCount: number; system: boolean };
type PermissionRow = { id: string; code: string; group: string; description: string | null };

type LineConfigRow = {
  id: string;
  factoryId: string;
  name: string;
  status: string;
  deletedAt: string | null;
  defaultStaffingTemplateId?: string | null;
  positions: Array<{
    id: string;
    name: string;
    displayName?: string | null;
    skillCode?: string | null;
    skillFamilyKey?: string | null;
    sortOrder: number;
    isActive: boolean;
    deletedAt: string | null;
    isExtraSlot?: boolean;
    doesNotAffectShortage?: boolean;
    isFlexibleSkillGroup?: boolean;
  }>;
  staffingTemplates: Array<{
    id: string;
    name: string;
    isActive: boolean;
    deletedAt: string | null;
    items: Array<{
      id: string;
      positionId: string;
      positionName: string | null;
      requiredCount: number;
      minRequired?: number | null;
      maxRequired?: number | null;
      defaultPlanned?: number | null;
      plannedCount?: number | null;
      isFlexible?: boolean;
      isExtraSlot?: boolean;
      doesNotAffectShortage?: boolean;
      sortOrder: number;
    }>;
  }>;
};

type StaffingTemplateDraftItem = {
  positionId: string;
  positionName: string;
  included: boolean;
  minRequired: string;
  defaultPlanned: string;
  maxRequired: string;
  isFlexible: boolean;
  isExtraSlot: boolean;
  doesNotAffectShortage: boolean;
  sortOrder: number;
};

type StaffingTemplateDraft = {
  templateId: string;
  lineId: string;
  name: string;
  items: StaffingTemplateDraftItem[];
};

type StaffingControlContext = {
  allowed: boolean;
  reason: string | null;
  mode: 'ADMIN' | 'JOB_TITLE_HIERARCHY' | 'DENIED';
  jobTitleName: string | null;
  factory: { id: string; name: string };
  lines: LineConfigRow[];
};

type StaffingRemapPreview = {
  lineVersion: number;
  targetTemplate: { id: string; name: string } | null;
  counts: {
    activeKept: number;
    activeMoved: number;
    activeReleased: number;
    plannedKept: number;
    plannedMoved: number;
    plannedReleased: number;
  };
  requiresConfirmation: boolean;
  affectedAssignments: Array<{ displayName: string; from: string; to: string | null; action: 'MOVE' | 'RELEASE' }>;
};

function staffingTemplateDraftItems(
  line: LineConfigRow | null,
  template?: LineConfigRow['staffingTemplates'][number] | null,
): StaffingTemplateDraftItem[] {
  if (!line) return [];
  return line.positions
    .filter((position) => position.isActive && !position.deletedAt)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((position) => {
      const item = template?.items.find((entry) => entry.positionId === position.id);
      const isExtraSlot = Boolean(position.isExtraSlot || item?.isExtraSlot);
      const minRequired = item?.minRequired ?? item?.requiredCount ?? (isExtraSlot ? 0 : 1);
      const maxRequired = item?.maxRequired ?? item?.requiredCount ?? (isExtraSlot ? 1 : 1);
      const defaultPlanned = item?.defaultPlanned ?? item?.plannedCount ?? item?.requiredCount ?? minRequired;
      return {
        positionId: position.id,
        positionName: position.displayName ?? position.name,
        included: Boolean(item),
        minRequired: String(minRequired),
        defaultPlanned: String(defaultPlanned),
        maxRequired: String(maxRequired),
        isFlexible: item?.isFlexible ?? minRequired !== maxRequired,
        isExtraSlot,
        doesNotAffectShortage: Boolean(position.doesNotAffectShortage || item?.doesNotAffectShortage || isExtraSlot),
        sortOrder: item?.sortOrder ?? position.sortOrder,
      };
    });
}

type WorkAreaRow = {
  id: string;
  name: string;
  description?: string | null;
  factoryId?: string;
  departmentId?: string | null;
  isActive?: boolean;
  positions: Array<{
    id: string;
    title: string;
    minRequired: number;
    maxRequired: number;
    defaultPlanned: number;
    plannedCount?: number | null;
    isFlexible: boolean;
    isExtraSlot: boolean;
    doesNotAffectShortage: boolean;
    sortOrder?: number;
    isActive?: boolean;
    deletedAt?: string | null;
  }>;
};

type JobTitleRow = {
  id: string;
  factoryId: string | null;
  factoryName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  parentJobTitleId: string | null;
  parentJobTitleName: string | null;
  childrenCount?: number;
  name: string;
  code: string;
  baseRole: string;
  shiftDurationHours: number;
  permissionPreset: string | null;
  description: string | null;
  isActive: boolean;
  deletedAt: string | null;
};

type FactoryContext = {
  factory: {
    id: string;
    name: string;
    code: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  counts: {
    usersWithAccess: number;
    localDepartments: number;
    globalServices: number;
    lines: number;
    positions: number;
    staffingTemplates: number;
    workAreas: number;
  };
  pilotVisibleFactories: FactoryRow[];
  usersWithAccess: Array<{
    id: string;
    displayName: string;
    role: string;
    departmentId: string | null;
    departmentName: string | null;
    jobTitleId: string | null;
    jobTitleName: string | null;
    isActive: boolean;
    isGuest: boolean;
    blockedAt: string | null;
    accessId: string;
  }>;
  localDepartments: DepartmentRow[];
  globalServices: DepartmentRow[];
  lines: LineConfigRow[];
  staffingTemplates: Array<{
    id: string;
    lineId: string;
    lineName: string;
    name: string;
    positionsCount: number;
    plannedCount: number;
    items: Array<{ id: string; positionName: string; plannedCount: number; minRequired: number; maxRequired: number }>;
  }>;
  workAreas: WorkAreaRow[];
  jobTitles?: JobTitleRow[];
  moduleSettings: Array<{ key: string; title: string; factoryId: string; scope: string; scopeLabel: string; configured: boolean; summary: string[] }>;
  recentAudit: Array<{
    id: string;
    factoryId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    actorName: string;
    createdAt: string;
    detailsSummary: string[];
  }>;
};

type RecoveryItem = {
  type: string;
  typeLabel: string;
  id: string;
  title: string;
  factoryId: string | null;
  factoryName: string | null;
  departmentName?: string | null;
  parentName?: string | null;
  deactivatedAt: string | null;
  deactivatedByName: string;
  reason: string;
  recoveryUntil: string | null;
  daysLeft: number | null;
  diagnosticReasons?: string[];
  diagnosticLabel?: string | null;
};

type RecoveryResponse = {
  factoryId: string | null;
  diagnosticMode?: boolean;
  total: number;
  expiringSoon: number;
  items: RecoveryItem[];
};

type DataHygieneSummary = {
  factoryId: string;
  total: number;
  groups: Array<{ group: string; label: string; count: number }>;
  types: Array<{ label: string; count: number }>;
  recommendations: string[];
  generatedAt: string;
};

type DataHygieneRecord = {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  factoryName: string | null;
  group: string;
  groupLabel: string;
  reasons: string[];
  source: string;
  whereFound: string;
  hiddenFromRuntime: boolean;
  safeActions: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

type DataHygieneRecordsResponse = {
  factoryId: string;
  total: number;
  page: number;
  pageSize: number;
  records: DataHygieneRecord[];
};

type FactorySetupOptions = {
  sourceFactories: FactoryRow[];
  categories: Array<{ key: string; label: string; description: string }>;
  defaults: { mode: 'EMPTY' | 'COPY'; categories: string[] };
  notCopied: string[];
};

type FactorySetupPreview = {
  mode: 'EMPTY' | 'COPY';
  target: { name: string; code: string; isActive: boolean };
  sourceFactoryId?: string;
  sourceFactoryName?: string;
  categories: Array<{ key: string; label: string; description: string; selected: boolean }>;
  counts: Record<string, number>;
  warnings: string[];
  writesDatabase: boolean;
  runtimeCopied: boolean;
  notCopied: string[];
};

type FactoryConfigHealth = {
  factory: { id: string; name: string; code: string; isActive: boolean };
  status: 'ready' | 'warning' | 'blocker';
  summary: { ready: boolean; blockers: number; warnings: number; checks: number };
  warnings: Array<{ id: string; severity: 'ok' | 'warning' | 'blocker'; title: string; detail: string; section: string; actionLabel: string }>;
  positive: string[];
};

type FactorySetupResult = {
  factory: { id: string; name: string; code: string; isActive: boolean };
  copied: Record<string, number>;
  runtimeCopied: boolean;
  nextSteps: string[];
  health: FactoryConfigHealth;
};

type FactoryConfigFile = {
  schemaVersion: string;
  exportedAt?: string;
  sourceFactory?: { name?: string; code?: string };
  config?: Record<string, unknown>;
  counts?: Record<string, number>;
  runtimeCopied?: boolean;
  notExported?: string[];
};

type FactoryConfigImportPreview = {
  schemaVersion: string | null;
  sourceFactory: { name?: string; code?: string } | null;
  target: { name: string; code: string; isActive: boolean };
  counts: Record<string, number>;
  warnings: string[];
  errors: string[];
  writesDatabase: boolean;
  runtimeCopied: boolean;
  notImported: string[];
};

type FactoryConfigImportResult = {
  factory: { id: string; name: string; code: string; isActive: boolean };
  imported: Record<string, number>;
  runtimeCopied: boolean;
  warnings: string[];
  notImported: string[];
  health: FactoryConfigHealth;
};

type RolePreview = {
  role: string;
  added: string[];
  removed: string[];
  dangerousRemoved: string[];
  warnings: string[];
  allowed: boolean;
  reason: string | null;
};

type DelegationCandidate = {
  userId: string;
  displayName: string;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  jobTitleId: string | null;
  jobTitleName: string | null;
  phoneLabel: string | null;
  isGuest: boolean;
  isActive: boolean;
};

type PermissionDelegationContext = {
  factory: { id: string; name: string; code: string };
  actor: { userId: string; role: string; departmentId: string | null; jobTitleId: string | null; jobTitleName: string | null; fullAdmin: boolean };
  sourceCandidates: DelegationCandidate[];
  targetCandidates: DelegationCandidate[];
  warnings: string[];
};

type PermissionCopyPreview = {
  sourceUserId: string;
  targetUserId: string;
  factoryId: string;
  source: DelegationCandidate;
  target: DelegationCandidate;
  nextAccess: { role: string; departmentId: string | null; departmentName: string | null; jobTitleId: string | null; jobTitleName: string | null; isGuest: boolean };
  added: string[];
  removed: string[];
  grantedPermissions?: string[];
  allowedAdds?: string[];
  allowedRemoves?: string[];
  hiddenCount: number;
  warnings: string[];
  allowed: boolean;
  reason: string | null;
};

type ChangePreview = {
  warnings?: string[];
  allowed?: boolean;
  reason?: string | null;
};

type AdminData = {
  overview: Overview;
  users: AdminUser[];
  factories: FactoryRow[];
  departments: DepartmentRow[];
  roles: RoleRow[];
  permissions: PermissionRow[];
  lines: LineConfigRow[];
  workAreas: WorkAreaRow[];
  jobTitles: JobTitleRow[];
  settings: Record<string, SettingsMap>;
  factoryContext: FactoryContext | null;
  recovery: RecoveryResponse | null;
  diagnosticRecovery: RecoveryResponse | null;
  dataHygieneSummary: DataHygieneSummary | null;
  dataHygieneRecords: DataHygieneRecordsResponse | null;
};

type PendingAction = {
  title: string;
  description: string;
  consequences?: string[]; successMessage?: string;
  confirmLabel?: string;
  requireText?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  run: (reason?: string) => Promise<void | { reloadFactoryId?: string }>;
} | null;

const SECTIONS = [
  'Обзор',
  'Заводы',
  'Пользователи и доступы',
  'Отделы и службы',
  'Должности и роли',
  'Линии и позиции',
  'Позиции на линиях',
  'Шаблоны состава',
  'Повременщики / рабочие зоны',
  'Роли и права',
  'Настройки модулей',
  'Восстановление',
  'Диагностика данных',
  'Аудит действий админки',
];

const ADMIN_NAV_GROUPS = [
  {
    title: 'Завод',
    hint: 'Создание, копирование и общая готовность площадки.',
    sections: ['Обзор', 'Заводы'],
  },
  {
    title: 'Люди',
    hint: 'Доступы, отделы, службы и понятные должности.',
    sections: ['Пользователи и доступы', 'Отделы и службы', 'Должности и роли'],
  },
  {
    title: 'Производство',
    hint: 'Линии, позиции, составы и повременные зоны.',
    sections: ['Линии и позиции', 'Позиции на линиях', 'Шаблоны состава', 'Повременщики / рабочие зоны'],
  },
  {
    title: 'Безопасность и модули',
    hint: 'Права, настройки модулей и аудит изменений.',
    sections: ['Роли и права', 'Настройки модулей', 'Восстановление', 'Диагностика данных', 'Аудит действий админки'],
  },
];

const QUICK_ADMIN_ACTIONS = [
  { title: 'Создать новый завод', detail: 'Мастер создания, копирование структуры или пустая площадка.', section: 'Заводы' },
  { title: 'Добавить линию', detail: 'Производственная линия выбранного завода.', section: 'Линии и позиции' },
  { title: 'Изменить состав линии', detail: 'Позиции и шаблоны состава для смены.', section: 'Шаблоны состава' },
  { title: 'Добавить рабочую зону', detail: 'Повременщики и зоны, которые не являются линиями.', section: 'Повременщики / рабочие зоны' },
  { title: 'Создать должность', detail: 'Человекочитаемая должность поверх системной роли.', section: 'Должности и роли' },
  { title: 'Выдать человеку доступ', detail: 'Доступ пользователя к выбранному заводу, роль и отдел.', section: 'Пользователи и доступы' },
  { title: 'Настроить права', detail: 'Русская матрица системных прав по модулям.', section: 'Роли и права' },
  { title: 'Проверить готовность завода', detail: 'Сгруппированные предупреждения и следующий шаг.', section: 'Обзор' },
];

const FACTORY_TEMPLATES = [
  { value: 'EMPTY', label: 'Пустой завод' },
  { value: 'BASIC_SERVICES', label: 'Создать типовые службы' },
  { value: 'COPY_FACTORY_4', label: 'Скопировать базовую структуру Завода 4' },
];

const MODULE_SETTINGS = [
  { key: 'shift', title: 'Смена', read: '/admin/shift-settings', preview: '/admin/shift-settings/preview', update: '/admin/shift-settings' },
  { key: 'tasks', title: 'Заявки', read: '/admin/task-settings', preview: '/admin/task-settings/preview', update: '/admin/task-settings' },
  { key: 'wash', title: 'Мойка', read: '/admin/wash-settings', preview: '/admin/wash-settings/preview', update: '/admin/wash-settings' },
  { key: 'checklists', title: 'Чек-листы', read: '/checklists/settings', preview: '/checklists/settings/preview', update: '/checklists/settings' },
  { key: 'orders', title: 'Заказы / Остатки', read: '/orders/settings', preview: '/orders/settings/preview', update: '/orders/settings' },
  { key: 'defrost', title: 'Оттайка', read: '/admin/defrost-settings', preview: '/admin/defrost-settings/preview', update: '/admin/defrost-settings' },
  { key: 'chats', title: 'Чаты', read: '/admin/chat-settings', preview: '/admin/chat-settings/preview', update: '/admin/chat-settings' },
  { key: 'announcements', title: 'Объявления', read: '/admin/announcement-settings', preview: '/admin/announcement-settings/preview', update: '/admin/announcement-settings' },
];

// Only fields with a current operational consumer are editable. Legacy storage
// and reserved flags stay visible, but must not promise an effect they lack.
const OPERATIONAL_SETTINGS: Record<string, string[]> = {
  shift: ['minAssignmentMoveIntervalMinutes', 'contractorLeadMaxPeoplePerShift', 'returnRequestEnabled', 'willBeCancelRequiresComment'],
  tasks: ['longTaskDefaultDeadlineHours', 'longTaskEscalationEnabled', 'longTaskEscalationGraceMinutes', 'taskRedirectRequiresComment', 'taskDoneRequiresComment', 'taskReadReceiptsEnabled'],
  wash: ['washIssueResolveRequiresPhoto', 'washCompleteRequiresOkkReview', 'washCompleteRequiresNoOpenIssues', 'washMiniTasksEnabled', 'washControlEnabled', 'washOkkReviewEnabled'],
  defrost: [],
  orders: ['lowStockNotificationsEnabled', 'restockRequiresComment', 'takeRequiresComment', 'archiveRequiresComment', 'defaultUnit'],
  checklists: ['autoCloseAtDayShiftEnd', 'autoCloseAtNightShiftEnd', 'requirePauseComment', 'allowEditAfterCloseHours'],
  chats: ['chatEnabled', 'editWindowMinutes', 'deleteWindowMinutes'],
  announcements: ['defaultVisibleDays', 'importantBadgeEnabled'],
};

function settingReadOnlyReason(module: string, key: string) {
  if (OPERATIONAL_SETTINGS[module]?.includes(key)) return '';
  if (module === 'defrost' && ['defrostCommentRequiredOnStart', 'defrostCommentRequiredOnEnd'].includes(key)) return 'Старый параметр API. В текущем календаре оттайки комментарий необязателен по согласованному правилу.';
  if (key === 'guestCanRead') return 'Гостевой доступ запрещён действующими правилами назначения.';
  if (/Reserved|voiceReserved|videoReserved/.test(key)) return 'Зарезервировано для будущего развития.';
  return 'Хранится в конфигурации, но применение этого параметра в рабочих сценариях не подключено.';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Действие не выполнено';
}

function previewSummary(preview: ChangePreview | RolePreview | null) {
  if (!preview) return [];
  const warnings = preview.warnings ?? [];
  const details = [
    ...('added' in preview && preview.added.length ? [`Добавлено прав: ${preview.added.length}`] : []),
    ...('removed' in preview && preview.removed.length ? [`Убрано прав: ${preview.removed.length}`] : []),
    ...warnings,
  ];
  if (preview.reason) details.push(preview.reason);
  return details.length ? details : ['Изменения проверены, критичных предупреждений нет.'];
}

function summarizeSettings(settings?: SettingsMap) {
  if (!settings) return 'Настройки не загружены.';
  const keys = Object.keys(settings).filter((key) => !['id', 'factoryId', 'createdAt', 'updatedAt'].includes(key));
  return keys.slice(0, 4).map((key) => `${settingLabel(key)}: ${settingValue(settings[key])}`).join(' · ') || 'Настройки доступны.';
}

function settingLabel(key: string) {
  const labels: Record<string, string> = {
    dayShiftStartTime: 'Начало дневной смены',
    dayShiftEndTime: 'Конец дневной смены',
    nightShiftStartTime: 'Начало ночной смены',
    nightShiftEndTime: 'Конец ночной смены',
    willBeOpenHoursBeforeShift: 'Окно “Я буду”, часов',
    noShowCheckMinutesAfterShiftStart: 'Проверка неявки, минут',
    minAssignmentMoveIntervalMinutes: 'Пауза между переносами',
    contractorLeadMaxPeoplePerShift: 'Лимит бригадира',
    returnRequestEnabled: 'Возврат на смену',
    sendHomeRequiresComment: 'Комментарий при отправке домой',
    longTaskDefaultDeadlineHours: 'Срок длинной заявки, часов',
    longTaskEscalationEnabled: 'Эскалация длинных заявок',
    urgentTaskRequiresLineWhenCreatedFromLine: 'Линия обязательна из простоя',
    taskRedirectRequiresComment: 'Комментарий при передаче',
    taskDoneRequiresComment: 'Комментарий при закрытии',
    washIssueRequiresPhoto: 'Фото для проблемы мойки',
    washCompleteRequiresOkkReview: 'ОКК перед завершением мойки',
    defaultUnit: 'Единица по умолчанию',
    takeRequiresComment: 'Комментарий при списании',
    restockRequiresComment: 'Комментарий при пополнении',
    warningRedPercent: 'Красный порог, %',
    warningYellowPercent: 'Жёлтый порог, %',
    defrostCalendarEnabled: 'Календарь оттайки',
    chatAttachmentsEnabled: 'Вложения в чатах',
    announcementAttachmentsEnabled: 'Вложения в объявлениях',
    autoCloseChecklistsAtShiftEnd: 'Автозакрытие чек-листов в конце смены',
    willBeCancelRequiresComment: 'Комментарий при отмене “Я буду”',
    longTaskEscalationGraceMinutes: 'Льготное время эскалации, минут',
    taskReadReceiptsEnabled: 'Отметки чтения заявок',
    taskAttachmentsEnabled: 'Вложения в заявках',
    taskDepartmentRecipientsEnabled: 'Адресация заявок отделам',
    taskPersonalAssigneeEnabled: 'Персональный исполнитель заявки',
    taskChatMirrorEnabledReserved: 'Резерв зеркала заявки в чат',
    taskStorageRetentionMode: 'Хранение заявок',
    washIssueResolveRequiresPhoto: 'Фото при закрытии проблемы мойки',
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
    defrostAttachmentsEnabled: 'Вложения в оттайке',
    lowStockNotificationsEnabled: 'Уведомления о низком остатке',
    orderRequestNotificationsEnabled: 'Уведомления о заявках на заказ',
    archiveRequiresComment: 'Комментарий при архивировании',
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
    guestCanRead: 'Доступ гостей к объявлениям',
    importantBadgeEnabled: 'Метка важных объявлений',
  };
  return labels[key] ?? 'Техническая настройка без русского названия';
}

function settingValue(value: unknown) {
  if (typeof value === 'boolean') return value ? 'включено' : 'выключено';
  if (value === null || value === undefined || value === '') return 'не задано';
  return String(value);
}

function settingPayload(settings?: SettingsMap) {
  const payload = { ...(settings ?? {}) };
  for (const key of ['id', 'factoryId', 'createdAt', 'updatedAt']) delete payload[key];
  return payload;
}

function healthSeverityLabel(severity: 'ok' | 'warning' | 'blocker') {
  if (severity === 'blocker') return 'Блокер';
  if (severity === 'warning') return 'Проверить';
  return 'Готово';
}

function adminAuditActionLabel(action: string) {
  const labels: Record<string, string> = {
    FACTORY_CONFIG_HEALTH_VIEWED: 'Проверка готовности завода',
    FACTORY_CONFIG_EXPORTED: 'Экспорт конфигурации завода',
    FACTORY_CONFIG_IMPORT_PREVIEWED: 'Предпросмотр импорта конфигурации',
    FACTORY_CONFIG_IMPORTED: 'Импорт конфигурации завода',
    FACTORY_CREATED: 'Создан завод',
    FACTORY_UPDATED: 'Изменены название и код завода',
    FACTORY_STATUS_UPDATED: 'Изменён статус завода',
    FACTORY_RESTORED: 'Восстановлен завод',
    USER_FACTORY_ACCESS_UPDATED: 'Изменён доступ пользователя',
    USER_FACTORY_ACCESS_RESTORED: 'Восстановлен доступ пользователя',
    USER_ROLE_DEPARTMENT_UPDATED: 'Изменены роль и отдел пользователя',
    USER_BLOCK_STATUS_UPDATED: 'Изменена блокировка пользователя',
    USER_PASSWORD_RESET: 'Сброшен пароль пользователя',
    ROLE_PERMISSIONS_UPDATED: 'Изменены права роли',
    DEPARTMENT_CREATED: 'Создан отдел',
    DEPARTMENT_UPDATED: 'Изменён отдел',
    DEPARTMENT_STATUS_UPDATED: 'Изменён статус отдела',
    DEPARTMENT_RESTORED: 'Восстановлен отдел',
    JOB_TITLE_CREATED: 'Создана должность',
    JOB_TITLE_UPDATED: 'Изменена должность',
    JOB_TITLE_RESTORED: 'Восстановлена должность',
    LINE_CREATED: 'Создана линия',
    LINE_UPDATED: 'Изменена линия',
    LINE_RESTORED: 'Восстановлена линия',
    LINE_POSITION_CREATED: 'Создана позиция линии',
    LINE_POSITION_UPDATED: 'Изменена позиция линии',
    LINE_POSITION_RESTORED: 'Восстановлена позиция линии',
    STAFFING_TEMPLATE_CREATED: 'Создан шаблон состава',
    STAFFING_TEMPLATE_UPDATED: 'Изменён шаблон состава',
    STAFFING_TEMPLATE_RESTORED: 'Восстановлен шаблон состава',
    WORK_AREA_CREATED: 'Создана рабочая зона',
    WORK_AREA_UPDATED: 'Изменена рабочая зона',
    WORK_AREA_RESTORED: 'Восстановлена рабочая зона',
    WORK_AREA_POSITION_CREATED: 'Создан слот рабочей зоны',
    WORK_AREA_POSITION_UPDATED: 'Изменён слот рабочей зоны',
    WORK_AREA_POSITION_RESTORED: 'Восстановлен слот рабочей зоны',
    SHIFT_SETTINGS_UPDATED: 'Изменены настройки смен',
    TASK_SETTINGS_UPDATED: 'Изменены настройки заявок',
    WASH_SETTINGS_UPDATED: 'Изменены настройки мойки',
    DEFROST_SETTINGS_UPDATED: 'Изменены настройки оттайки',
    ACCESS_DENIED: 'Отказ в доступе',
  };
  return labels[action] ?? 'Действие админки';
}

function permissionDescription(permission: PermissionRow) {
  return permissionDescriptionLabel(permission.code, permission.group, permission.description);
}

function healthGroupKey(warning: FactoryConfigHealth['warnings'][number]) {
  const text = `${warning.id} ${warning.title} ${warning.detail}`.toLowerCase();
  if (text.includes('position') || text.includes('позиц')) return 'positions';
  if (text.includes('template') || text.includes('шаблон')) return 'templates';
  if (text.includes('skill') || text.includes('навык') || text.includes('код')) return 'skills';
  if (text.includes('user') || text.includes('доступ') || text.includes('польз')) return 'users';
  if (text.includes('department') || text.includes('отдел') || text.includes('служ')) return 'departments';
  if (text.includes('settings') || text.includes('настрой')) return 'settings';
  return warning.section || 'other';
}

function healthGroupTitle(key: string) {
  const labels: Record<string, string> = {
    positions: 'Позиции линий',
    templates: 'Шаблоны состава',
    skills: 'Навыки и коды навыков',
    users: 'Пользователи и доступы',
    departments: 'Отделы и службы',
    settings: 'Настройки модулей',
    other: 'Прочие проверки',
  };
  return labels[key] ?? key;
}

function groupedHealthWarnings(health: FactoryConfigHealth | null) {
  const groups = new Map<string, {
    key: string;
    title: string;
    severity: 'ok' | 'warning' | 'blocker';
    section: string;
    actionLabel: string;
    count: number;
    details: FactoryConfigHealth['warnings'];
  }>();
  for (const warning of health?.warnings ?? []) {
    const key = healthGroupKey(warning);
    const current = groups.get(key);
    const severity = current?.severity === 'blocker' || warning.severity === 'blocker' ? 'blocker' : warning.severity;
    groups.set(key, {
      key,
      title: healthGroupTitle(key),
      severity,
      section: current?.section ?? warning.section,
      actionLabel: current?.actionLabel ?? warning.actionLabel,
      count: (current?.count ?? 0) + 1,
      details: [...(current?.details ?? []), warning],
    });
  }
  return Array.from(groups.values()).sort((left, right) => {
    const rank = { blocker: 0, warning: 1, ok: 2 };
    return rank[left.severity] - rank[right.severity] || right.count - left.count;
  });
}

function AdminFieldLabel({ children, helpTitle, helpText }: { children: React.ReactNode; helpTitle: string; helpText: string }) {
  return (
    <span className="admin-field-label">
      <span>{children}</span>
      <HelpTooltip title={helpTitle}>{helpText}</HelpTooltip>
    </span>
  );
}

export function AdminConfigScreen({ onSelectFactory }: { onSelectFactory: (factoryId: string) => Promise<void> }) {
  const { currentUser, selectedFactoryId: activeFactoryId } = useAppStore();
  const [data, setData] = useState<AdminData | null>(null);
  const [staffingContext, setStaffingContext] = useState<StaffingControlContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null); const [noticeText, setNoticeText] = useState<string | null>(null);
  const [section, setSection] = useState(SECTIONS[0]);
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState('MASTER');
  const [rolePermissionDraft, setRolePermissionDraft] = useState<string[]>([]);
  const [settingDrafts, setSettingDrafts] = useState<Record<string, SettingsMap>>({});
  const [rolePreview, setRolePreview] = useState<RolePreview | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<AdminUserProfile | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState<{ recoveryCredential: string; recoveryExpiresAt: string; displayName: string } | null>(null);
  const [factoryEdit, setFactoryEdit] = useState<{ name: string; code: string } | null>(null);
  const [departmentEditId, setDepartmentEditId] = useState('');
  const [jobTitleEditId, setJobTitleEditId] = useState('');
  const [positionEditId, setPositionEditId] = useState('');
  const [identityForm, setIdentityForm] = useState({ lastName: '', firstName: '', middleName: '' });
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [showFactoryDiagnostics, setShowFactoryDiagnostics] = useState(false);
  const [setupOptions, setSetupOptions] = useState<FactorySetupOptions | null>(null);
  const [setupMode, setSetupMode] = useState<'EMPTY' | 'COPY'>('COPY');
  const [setupSourceFactoryId, setSetupSourceFactoryId] = useState('');
  const [setupCategories, setSetupCategories] = useState<Record<string, boolean>>({});
  const [setupPreview, setSetupPreview] = useState<FactorySetupPreview | null>(null);
  const [setupResult, setSetupResult] = useState<FactorySetupResult | null>(null);
  const [configHealth, setConfigHealth] = useState<FactoryConfigHealth | null>(null);
  const [showAllHealthGroups, setShowAllHealthGroups] = useState(false);
  const [expandedHealthGroups, setExpandedHealthGroups] = useState<Record<string, boolean>>({});
  const [showAdvancedPermissions, setShowAdvancedPermissions] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [exportConfig, setExportConfig] = useState<FactoryConfigFile | null>(null);
  const [importConfig, setImportConfig] = useState<FactoryConfigFile | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState<FactoryConfigImportPreview | null>(null);
  const [importResult, setImportResult] = useState<FactoryConfigImportResult | null>(null);
  const [importTarget, setImportTarget] = useState({ name: '', code: '', isActive: true });
  const [factoryForm, setFactoryForm] = useState({
    name: '',
    code: '',
    description: '',
    template: 'EMPTY',
    isActive: true,
  });
  const [lineForm, setLineForm] = useState({ name: '' });
  const [lineEditForm, setLineEditForm] = useState({ lineId: '', name: '' });
  const [expandedLineId, setExpandedLineId] = useState('');
  const [positionForm, setPositionForm] = useState({
    lineId: '',
    name: '',
    displayName: '',
    skillCode: '',
    sortOrder: '0',
    isExtraSlot: false,
    doesNotAffectShortage: false,
    isFlexibleSkillGroup: false,
  });
  const [templateForm, setTemplateForm] = useState<StaffingTemplateDraft>({ templateId: '', lineId: '', name: '', items: [] });
  const [workAreaForm, setWorkAreaForm] = useState({ name: '', description: '', departmentId: '', assignmentKind: 'WORK_AREA' as 'WORK_AREA' | 'TIME' });
  const [workAreaPositionForm, setWorkAreaPositionForm] = useState({ workAreaId: '', title: '', minRequired: '1', defaultPlanned: '1', maxRequired: '1' });
  const [departmentForm, setDepartmentForm] = useState({ name: '', code: '', scope: 'LOCAL' });
  const [jobTitleForm, setJobTitleForm] = useState({ name: '', code: '', baseRole: 'WORKER', departmentId: '', parentJobTitleId: '', shiftDurationHours: '12', permissionPreset: 'Работник', description: '' });
  const [jobTitleParentEdits, setJobTitleParentEdits] = useState<Record<string, string>>({});
  const [jobTitleDurationEdits, setJobTitleDurationEdits] = useState<Record<string, string>>({});
  const [accessForm, setAccessForm] = useState({ userId: '', factoryId: '', role: 'WORKER', departmentId: '', jobTitleId: '', companyId: '' });
  const [accessCandidates, setAccessCandidates] = useState<AdminUser[]>([]);
  const [externalCompanies, setExternalCompanies] = useState<ExternalCompanyRow[]>([]);
  const [externalCompanyName, setExternalCompanyName] = useState('');
  const [assignmentRequests, setAssignmentRequests] = useState<AssignmentRequestRow[]>([]);
  const [assignmentJobTitles, setAssignmentJobTitles] = useState<Record<string, string>>({});
  const [organizationIdentityReport, setOrganizationIdentityReport] = useState<OrganizationIdentityReport | null>(null);
  const [delegationContext, setDelegationContext] = useState<PermissionDelegationContext | null>(null);
  const [delegationForm, setDelegationForm] = useState({ sourceUserId: '', targetUserId: '' });
  const [delegationPicker, setDelegationPicker] = useState<'source' | 'target' | null>(null);
  const [delegationHelpOpen, setDelegationHelpOpen] = useState(false);
  const [delegationSearch, setDelegationSearch] = useState('');
  const [delegationPreview, setDelegationPreview] = useState<PermissionCopyPreview | null>(null);

  const selectedFactory = useMemo(
    () => data?.factories.find((factory) => factory.id === selectedFactoryId) ?? data?.factories[0] ?? null,
    [data?.factories, selectedFactoryId],
  );
  const factoryContext = data?.factoryContext ?? null;
  const contextFactories = useMemo(
    () => factoryContext?.pilotVisibleFactories?.length
      ? factoryContext.pilotVisibleFactories
      : (data?.factories ?? []).filter((factory) => !isPilotFixtureText(factory.id, factory.name, factory.code)),
    [data?.factories, factoryContext?.pilotVisibleFactories],
  );
  const factoryLineCount = (factory: FactoryRow) => (
    data?.factories.find((item) => item.id === factory.id)?.counts.lines
    ?? factory.counts.lines
    ?? 0
  );

  const localDepartments = useMemo(
    () => factoryContext?.localDepartments ?? (data?.departments ?? []).filter((department) => department.factoryId === selectedFactory?.id),
    [data?.departments, factoryContext?.localDepartments, selectedFactory?.id],
  );
  const roleOptions = useMemo(() => (data?.roles ?? []).map((item) => item.role), [data?.roles]);
  const sharedDepartments = useMemo(
    () => factoryContext?.globalServices ?? (data?.departments ?? []).filter((department) => department.scope === 'GLOBAL'),
    [data?.departments, factoryContext?.globalServices],
  );
  const currentJobTitles = useMemo(
    () => (data?.jobTitles ?? []).filter((title) => !isPilotFixtureText(title.id, title.name, title.code, title.description ?? '')),
    [data?.jobTitles],
  );
  const activeJobTitles = useMemo(
    () => currentJobTitles.filter((title) => title.isActive && !title.deletedAt),
    [currentJobTitles],
  );
  const jobTitleOptionsForDepartment = (departmentId: string | null | undefined) => activeJobTitles.filter((title) =>
    (title.departmentId ?? '') === (departmentId ?? '') && (!title.factoryId || title.factoryId === selectedFactoryId),
  );
  const jobTitleParentOptions = jobTitleOptionsForDepartment(jobTitleForm.departmentId || null);
  const settingsDirty = Object.entries(settingDrafts).some(([module, values]) => {
    if (!data?.settings[module]) return false;
    const original = settingPayload(data.settings[module]);
    return Object.entries(values).some(([key, value]) => !settingReadOnlyReason(module, key) && !Object.is(value, original[key]));
  });
  useMobileFormDirty('admin-module-settings', settingsDirty);
  const jobTitleChildrenByParent = useMemo(() => {
    const map = new Map<string, JobTitleRow[]>();
    currentJobTitles.forEach((title) => {
      const key = title.parentJobTitleId ?? '__root__';
      const current = map.get(key) ?? [];
      current.push(title);
      map.set(key, current);
    });
    return map;
  }, [currentJobTitles]);
  const isJobTitleDescendant = (candidateId: string, ancestorId: string): boolean => {
    const stack = [...(jobTitleChildrenByParent.get(ancestorId) ?? [])];
    while (stack.length) {
      const item = stack.shift();
      if (!item) continue;
      if (item.id === candidateId) return true;
      stack.push(...(jobTitleChildrenByParent.get(item.id) ?? []));
    }
    return false;
  };
  const pilotVisibleLocalDepartments = useMemo(
    () => localDepartments.filter((department) => !isPilotFixtureText(department.id, department.name, department.code)),
    [localDepartments],
  );
  const pilotVisibleSharedDepartments = useMemo(
    () => sharedDepartments.filter((department) => !isPilotFixtureText(department.id, department.name, department.code)),
    [sharedDepartments],
  );

  const filteredUsers = useMemo(() => {
    const users = (data?.users ?? []).filter((user) => !isPilotFixtureUser(user.id, user.displayName));
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      user.id.toLowerCase().includes(needle) ||
      pilotUserName(user.id, user.displayName).toLowerCase().includes(needle) ||
      roleLabel(user.selectedFactoryAccess?.role ?? user.globalRole).toLowerCase().includes(needle) ||
      (user.selectedFactoryAccess?.departmentName ?? '').toLowerCase().includes(needle),
    );
  }, [data?.users, search]);
  const pilotVisibleUsers = useMemo(
    () => (data?.users ?? []).filter((user) => !isPilotFixtureUser(user.id, user.displayName)),
    [data?.users],
  );
  const pilotVisibleAccessCandidates = useMemo(
    () => accessCandidates.filter((candidate) => !isPilotFixtureUser(candidate.id, candidate.displayName)),
    [accessCandidates],
  );

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, PermissionRow[]>();
    const needle = permissionSearch.trim().toLocaleLowerCase('ru');
    for (const permission of data?.permissions ?? []) {
      const searchable = [
        permission.group,
        permissionGroupLabel(permission.group),
        permission.code,
        permissionLabel(permission.code),
        permissionDescription(permission),
      ].join(' ').toLocaleLowerCase('ru');
      if (needle && !searchable.includes(needle)) continue;
      groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => permissionGroupLabel(left).localeCompare(permissionGroupLabel(right), 'ru'));
  }, [data?.permissions, permissionSearch]);
  const visiblePermissionCodes = useMemo(
    () => permissionGroups.flatMap(([, permissions]) => permissions.map((permission) => permission.code)),
    [permissionGroups],
  );
  const roleMenuPreview = useMemo(
    () => SCREEN_DEFINITIONS.filter((screen) => canShowScreen(screen.code, rolePermissionDraft, selectedRole, false)),
    [rolePermissionDraft, selectedRole],
  );
  const healthGroups = useMemo(() => groupedHealthWarnings(configHealth), [configHealth]);

  const openAdminSection = (target: string) => {
    setSection(target);
    window.requestAnimationFrame(() => {
      document.querySelector('.admin-screen')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };

  const applyDelegationDefaults = (context: PermissionDelegationContext | null) => {
    if (!context) return;
    setDelegationForm((current) => ({
      sourceUserId: current.sourceUserId && context.sourceCandidates.some((item) => item.userId === current.sourceUserId)
        ? current.sourceUserId
        : context.sourceCandidates[0]?.userId ?? '',
      targetUserId: current.targetUserId && context.targetCandidates.some((item) => item.userId === current.targetUserId)
        ? current.targetUserId
        : context.targetCandidates.find((item) => item.isGuest)?.userId ?? context.targetCandidates[0]?.userId ?? '',
    }));
  };

  const loadDelegationContext = async (factoryId?: string) => {
    const suffix = factoryId ? `?factoryId=${encodeURIComponent(factoryId)}` : '';
    const context = await apiClient.get<PermissionDelegationContext>(`/admin/permission-delegation/context${suffix}`);
    setDelegationContext(context);
    applyDelegationDefaults(context);
    return context;
  };

  const loadStaffingContext = async () => {
    const context = await apiClient.get<StaffingControlContext>('/admin/staffing-control/context');
    setStaffingContext(context);
    return context;
  };

  const load = async (factoryId?: string) => {
    setLoading(true);
    setErrorText(null);
    try {
      const canLoadOverview = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('admin.overview.read'));
      if (!canLoadOverview) {
        const [delegationValue, staffingValue] = await Promise.all([
          loadDelegationContext(factoryId || selectedFactoryId || undefined).catch(() => null),
          loadStaffingContext().catch(() => null),
        ]);
        if (!delegationValue && !staffingValue?.allowed) {
          throw new Error('Нет доступных административных действий.');
        }
        setData(null);
        setAccessCandidates([]);
        setDelegationContext(delegationValue);
        setStaffingContext(staffingValue);
        setSelectedFactoryId(delegationValue?.factory.id ?? staffingValue?.factory.id ?? '');
        setSection(staffingValue?.allowed ? 'Шаблоны состава' : 'Пользователи и доступы');
        setDelegationPreview(null);
        return;
      }
      const overview = await apiClient.get<Overview>('/admin/overview');
      const activeFactoryId = factoryId || selectedFactoryId || overview.selectedFactoryId;
      const settingsEntries = await Promise.all(MODULE_SETTINGS.map(async (item) => {
        const value = await apiClient.get<SettingsMap>(item.read);
        return [item.key, value] as const;
      }));
      setSettingDrafts(Object.fromEntries(settingsEntries.map(([key, value]) => [key, settingPayload(value)])));
      const [
        users,
        factories,
        departments,
        roles,
        permissions,
        lines,
        workAreas,
        jobTitles,
        factoryContext,
        recoveryValue,
        diagnosticRecoveryValue,
        dataHygieneSummary,
        dataHygieneRecords,
        setupOptionsValue,
        healthValue,
        delegationValue,
        assignmentRequestsValue,
        externalCompaniesValue,
        organizationIdentityValue,
        staffingContextValue,
      ] = await Promise.all([
        apiClient.get<AdminUser[]>(`/admin/users?factoryId=${encodeURIComponent(activeFactoryId)}`),
        apiClient.get<FactoryRow[]>('/admin/factories'),
        apiClient.get<DepartmentRow[]>(`/admin/departments?factoryId=${encodeURIComponent(activeFactoryId)}`),
        apiClient.get<RoleRow[]>('/admin/roles'),
        apiClient.get<PermissionRow[]>('/admin/permissions'),
        apiClient.get<LineConfigRow[]>(`/admin/lines-config?factoryId=${encodeURIComponent(activeFactoryId)}`),
        apiClient.get<WorkAreaRow[]>(`/admin/work-areas?factoryId=${encodeURIComponent(activeFactoryId)}`).catch(() => []),
        apiClient.get<JobTitleRow[]>(`/admin/job-titles?factoryId=${encodeURIComponent(activeFactoryId)}`).catch(() => []),
        apiClient.get<FactoryContext>(`/admin/factories/${encodeURIComponent(activeFactoryId)}/context`).catch(() => null),
        apiClient.get<RecoveryResponse>(`/admin/recovery?factoryId=${encodeURIComponent(activeFactoryId)}`).catch(() => null),
        apiClient.get<RecoveryResponse>(`/admin/recovery?factoryId=${encodeURIComponent(activeFactoryId)}&diagnostic=true`).catch(() => null),
        apiClient.get<DataHygieneSummary>(`/admin/data-hygiene/summary?factoryId=${encodeURIComponent(activeFactoryId)}`).catch(() => null),
        apiClient.get<DataHygieneRecordsResponse>(`/admin/data-hygiene/records?factoryId=${encodeURIComponent(activeFactoryId)}&pageSize=40`).catch(() => null),
        apiClient.get<FactorySetupOptions>('/admin/factories/setup/options').catch(() => null),
        apiClient.get<FactoryConfigHealth>(`/admin/factories/${encodeURIComponent(activeFactoryId)}/config-health`).catch(() => null),
        apiClient.get<PermissionDelegationContext>(`/admin/permission-delegation/context?factoryId=${encodeURIComponent(activeFactoryId)}`).catch(() => null),
        apiClient.get<AssignmentRequestRow[]>(`/admin/assignment-requests?status=PENDING&factoryId=${encodeURIComponent(activeFactoryId)}`).catch(() => []),
        apiClient.get<ExternalCompanyRow[]>(`/admin/external-companies?factoryId=${encodeURIComponent(activeFactoryId)}`).catch(() => []),
        apiClient.get<OrganizationIdentityReport>(`/admin/organization-identity-report?factoryId=${encodeURIComponent(activeFactoryId)}`).catch(() => null),
        apiClient.get<StaffingControlContext>('/admin/staffing-control/context').catch(() => null),
      ]);
      const accessCandidatesValue = await apiClient.get<AdminUser[]>(
        `/admin/users?factoryId=${encodeURIComponent(activeFactoryId)}&hasFactoryAccess=false`,
      );
      setStaffingContext(staffingContextValue);
      setDelegationContext(delegationValue);
      applyDelegationDefaults(delegationValue);
      if (setupOptionsValue) {
        setSetupOptions(setupOptionsValue);
        if (!setupSourceFactoryId && setupOptionsValue.sourceFactories.length) setSetupSourceFactoryId(setupOptionsValue.sourceFactories[0].id);
        if (!Object.keys(setupCategories).length) {
          setSetupCategories(Object.fromEntries(setupOptionsValue.defaults.categories.map((key) => [key, true])));
        }
      }
      setConfigHealth(healthValue);
      setAssignmentRequests(assignmentRequestsValue);
      setExternalCompanies(externalCompaniesValue);
      setOrganizationIdentityReport(organizationIdentityValue);
      setAccessCandidates(accessCandidatesValue);
      setData({
        overview,
        users,
        factories,
        departments,
        roles,
        permissions,
        lines: factoryContext?.lines ?? lines,
        workAreas: factoryContext?.workAreas ?? workAreas,
        jobTitles: factoryContext?.jobTitles ?? jobTitles,
        settings: Object.fromEntries(settingsEntries),
        factoryContext,
        recovery: recoveryValue,
        diagnosticRecovery: diagnosticRecoveryValue,
        dataHygieneSummary,
        dataHygieneRecords,
      });
      setSelectedFactoryId(activeFactoryId);
      setAccessForm((current) => ({ ...current, factoryId: activeFactoryId }));
      const selected = await apiClient.get<{ permissionCodes: string[] }>(`/admin/roles/${selectedRole}/permissions`);
      setRolePermissionDraft(selected.permissionCodes);
      setRolePreview(null);
    } catch (error) {
      const [delegationValue, staffingValue] = await Promise.all([
        loadDelegationContext(factoryId || selectedFactoryId || undefined).catch(() => null),
        loadStaffingContext().catch(() => null),
      ]);
      if (delegationValue || staffingValue?.allowed) {
        setData(null);
        setSelectedFactoryId(delegationValue?.factory.id ?? staffingValue?.factory.id ?? '');
        setSection(staffingValue?.allowed ? 'Шаблоны состава' : 'Пользователи и доступы');
        setErrorText(null);
        setDelegationPreview(null);
      } else {
        setDelegationContext(null);
        setStaffingContext(staffingValue);
        setErrorText(errorMessage(error));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedProfile(null);
    setPasswordRecovery(null);
    setFactoryEdit(null);
    setDepartmentEditId('');
    setJobTitleEditId('');
    setPositionEditId('');
    void load(activeFactoryId);
  }, [currentUser?.userId, currentUser?.permissions.join('|'), activeFactoryId]);

  const reloadFactory = async (factoryId: string) => {
    try {
      if (factoryId !== activeFactoryId) {
        await onSelectFactory(factoryId);
      } else {
        await load(factoryId);
      }
    } catch (error) {
      setErrorText(errorMessage(error));
    }
  };

  const runAction = async (reason?: string) => {
    if (!pendingAction || busy) return; const successMessage = pendingAction.successMessage;
    setBusy(true);
    setErrorText(null); setNoticeText(null);
    try {
      const result = await pendingAction.run(reason);
      setPendingAction(null);
      const reloadId = result && 'reloadFactoryId' in result && result.reloadFactoryId ? result.reloadFactoryId : selectedFactoryId;
      await reloadFactory(reloadId);
      if (selectedProfile) {
        await openProfile(selectedProfile.id);
      } if (successMessage) setNoticeText(successMessage);
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmWithPreview = async (
    previewUrl: string,
    payload: Record<string, unknown>,
    title: string,
    description: string,
    run: () => Promise<void>,
    requireText?: string,
  ) => {
    setErrorText(null);
    try {
      const preview = await apiClient.post<ChangePreview>(previewUrl, payload);
      if (preview.allowed === false) throw new Error(preview.reason || 'Настройки не прошли проверку.');
      setPendingAction({
        title,
        description,
        consequences: previewSummary(preview),
        requireText: requireText ?? (preview.warnings?.length ? 'ПОДТВЕРДИТЬ' : undefined),
        run,
      });
    } catch (error) {
      setErrorText(errorMessage(error));
    }
  };

  const previewDelegation = async () => {
    if (!delegationForm.sourceUserId || !delegationForm.targetUserId) {
      setErrorText('Выберите пользователя-образец и получателя прав.');
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const preview = await apiClient.post<PermissionCopyPreview>(
        `/admin/users/${delegationForm.targetUserId}/permission-copy-preview`,
        { sourceUserId: delegationForm.sourceUserId, factoryId: selectedFactoryId || delegationContext?.factory.id },
      );
      setDelegationPreview(preview);
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const applyDelegation = () => {
    if (!delegationPreview || !delegationPreview.allowed) return;
    setPendingAction({
      title: `Выдать права: ${delegationPreview.target.displayName}`,
      description: `Права будут приведены к образцу ${delegationPreview.source.displayName} в отделе ${delegationPreview.nextAccess.departmentName ?? 'без отдела'}.`,
      consequences: [
        `Роль: ${roleLabel(delegationPreview.nextAccess.role)}`,
        `Должность: ${delegationPreview.nextAccess.jobTitleName ?? 'должность не указана'}`,
        `Добавится прав: ${delegationPreview.added.length}`,
        `Будет убрано делегируемых прав: ${delegationPreview.removed.length}`,
        ...(delegationPreview.hiddenCount ? [`Скрыто недоступных прав: ${delegationPreview.hiddenCount}`] : []),
        ...delegationPreview.warnings,
      ],
      confirmLabel: 'Выдать права',
      requireReason: true,
      reasonLabel: 'Причина',
      reasonPlaceholder: 'Например: назначение гостя в мой отдел по решению руководителя',
      run: async (reason) => {
        await apiClient.post(`/admin/users/${delegationPreview.targetUserId}/permission-copy-apply`, {
          sourceUserId: delegationPreview.sourceUserId,
          factoryId: selectedFactoryId || delegationContext?.factory.id,
          reason: reason ?? 'Делегирование прав по образцу',
        });
        setDelegationPreview(null);
        await loadDelegationContext(selectedFactoryId || delegationContext?.factory.id);
      },
    });
  };

  const openProfile = async (userId: string) => {
    setErrorText(null); setNoticeText(null);
    setIdentityError(null);
    try {
      const profile = await apiClient.get<AdminUserProfile>(`/admin/users/${userId}`);
      setSelectedProfile(profile);
      setIdentityForm({
        lastName: profile.lastName ?? '',
        firstName: profile.firstName ?? '',
        middleName: profile.middleName ?? '',
      });
    } catch (error) {
      setErrorText(errorMessage(error));
    }
  };

  const saveIdentity = async () => {
    if (!selectedProfile || busy) return;
    if (!identityForm.lastName.trim() || !identityForm.firstName.trim()) {
      setIdentityError('Заполните фамилию и имя сотрудника.');
      return;
    }
    setBusy(true);
    setIdentityError(null);
    try {
      await apiClient.patch(`/admin/users/${selectedProfile.id}/identity`, identityForm);
      await openProfile(selectedProfile.id);
      await load(selectedFactoryId);
    } catch (error) {
      setIdentityError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const selectRolePermissions = async (role: string) => {
    setSelectedRole(role);
    setRolePreview(null);
    setErrorText(null);
    try {
      const response = await apiClient.get<{ permissionCodes: string[] }>(`/admin/roles/${role}/permissions`);
      setRolePermissionDraft(response.permissionCodes);
    } catch (error) {
      setErrorText(errorMessage(error));
    }
  };

  const previewRolePermissions = async () => {
    setErrorText(null);
    try {
      setRolePreview(await apiClient.post<RolePreview>(`/admin/roles/${selectedRole}/permissions/preview`, { permissionCodes: rolePermissionDraft }));
    } catch (error) {
      setErrorText(errorMessage(error));
    }
  };

  const togglePermission = (code: string) => {
    setRolePreview(null);
    setRolePermissionDraft((current) => (
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code].sort()
    ));
  };

  const factorySetupPayload = () => ({
    name: factoryForm.name,
    code: factoryForm.code,
    description: factoryForm.description,
    isActive: factoryForm.isActive,
    mode: setupMode,
    sourceFactoryId: setupMode === 'COPY' ? setupSourceFactoryId : undefined,
    categories: setupCategories,
  });

  const previewFactorySetup = async () => {
    setBusy(true);
    setErrorText(null);
    try {
      const preview = await apiClient.post<FactorySetupPreview>('/admin/factories/setup/preview', factorySetupPayload());
      setSetupPreview(preview);
      setSetupResult(null);
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createFactory = async () => {
    const result = await apiClient.post<FactorySetupResult>('/admin/factories/setup/create', factorySetupPayload());
    setFactoryForm({ name: '', code: '', description: '', template: 'EMPTY', isActive: true });
    setSetupPreview(null);
    setSetupResult(result);
    setConfigHealth(result.health);
    return { reloadFactoryId: result.factory.id };
  };

  const exportFactoryConfig = async () => {
    if (!selectedFactoryId) return;
    setBusy(true);
    setErrorText(null);
    try {
      const config = await apiClient.get<FactoryConfigFile>(`/admin/factories/${encodeURIComponent(selectedFactoryId)}/config-export`);
      setExportConfig(config);
      setImportResult(null);
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const downloadFactoryConfig = () => {
    if (!exportConfig) return;
    const name = exportConfig.sourceFactory?.code || selectedFactory?.code || 'factory';
    const blob = new Blob([JSON.stringify(exportConfig, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}-config.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const readImportFile = async (file?: File | null) => {
    setImportPreview(null);
    setImportResult(null);
    setErrorText(null);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as FactoryConfigFile;
      setImportConfig(parsed);
      setImportFileName(file.name);
      const sourceCode = parsed.sourceFactory?.code ? `${parsed.sourceFactory.code}-copy` : '';
      setImportTarget((current) => ({
        ...current,
        name: current.name || (parsed.sourceFactory?.name ? `${parsed.sourceFactory.name} — копия` : ''),
        code: current.code || sourceCode,
      }));
    } catch {
      setImportConfig(null);
      setImportFileName(file.name);
      setErrorText('Файл не удалось прочитать как файл конфигурации.');
    }
  };

  const previewFactoryConfigImport = async () => {
    if (!importConfig) {
      setErrorText('Выберите файл конфигурации.');
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const preview = await apiClient.post<FactoryConfigImportPreview>('/admin/factories/config-import/preview', {
        config: importConfig,
        target: importTarget,
      });
      setImportPreview(preview);
      setImportResult(null);
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createFactoryFromImport = async () => {
    if (!importConfig) throw new Error('Выберите файл конфигурации.');
    const result = await apiClient.post<FactoryConfigImportResult>('/admin/factories/config-import/create', {
      config: importConfig,
      target: importTarget,
    });
    setImportResult(result);
    setConfigHealth(result.health);
    setImportPreview(null);
    return { reloadFactoryId: result.factory.id };
  };

  const refreshAdmin = async () => {
    await load(selectedFactoryId);
    if (selectedProfile) await openProfile(selectedProfile.id);
  };

  const quickAction = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      await action();
      await refreshAdmin();
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createLine = () => quickAction(async () => {
    await apiClient.post('/admin/lines', { factoryId: selectedFactoryId, ...lineForm, reason: 'Создание линии из админки' });
    setLineForm({ name: '' });
  });

  const updateLineName = () => quickAction(async () => {
    await apiClient.patch(`/admin/lines/${lineEditForm.lineId}`, { name: lineEditForm.name, reason: 'Переименование линии из админки' });
    setLineEditForm({ lineId: '', name: '' });
  });

  const createPosition = () => quickAction(async () => {
    const lineId = positionForm.lineId || data?.lines?.[0]?.id;
    if (!lineId) throw new Error('Выберите линию');
    const body = {
      name: positionForm.name,
      displayName: positionForm.displayName || positionForm.name,
      skillCode: positionEditId ? positionForm.skillCode : positionForm.skillCode || undefined,
      sortOrder: Number(positionForm.sortOrder || 0),
      isExtraSlot: positionForm.isExtraSlot,
      doesNotAffectShortage: positionForm.doesNotAffectShortage || positionForm.isExtraSlot,
      isFlexibleSkillGroup: positionForm.isFlexibleSkillGroup,
      reason: positionEditId ? 'Изменение позиции линии из админки' : 'Создание позиции линии из админки',
    };
    if (positionEditId) await apiClient.patch(`/admin/lines/${lineId}/positions/${positionEditId}`, body);
    else await apiClient.post(`/admin/lines/${lineId}/positions`, body);
    setPositionEditId('');
    setPositionForm((current) => ({
      ...current,
      name: '',
      displayName: '',
      skillCode: '',
      isExtraSlot: false,
      doesNotAffectShortage: false,
      isFlexibleSkillGroup: false,
    }));
  });

  const saveTemplate = () => quickAction(async () => {
    const items = templateForm.items
      .filter((item) => item.included)
      .map((item) => ({
        positionId: item.positionId,
        requiredCount: Number(item.defaultPlanned),
        minRequired: Number(item.minRequired),
        defaultPlanned: Number(item.defaultPlanned),
        plannedCount: Number(item.defaultPlanned),
        maxRequired: Number(item.maxRequired),
        isFlexible: item.isFlexible || item.minRequired !== item.maxRequired,
        isExtraSlot: item.isExtraSlot,
        doesNotAffectShortage: item.doesNotAffectShortage,
        sortOrder: item.sortOrder,
      }));
    if (!items.length) throw new Error('Добавьте хотя бы одну позицию в шаблон');
    const body = {
      name: templateForm.name,
      items,
      reason: templateForm.templateId ? 'Изменение шаблона состава из админки' : 'Создание шаблона состава из админки',
    };
    if (templateForm.templateId) {
      await apiClient.patch(`/admin/staffing-control/lines/${templateForm.lineId}/templates/${templateForm.templateId}`, body);
    } else {
      await apiClient.post(`/admin/staffing-control/lines/${templateForm.lineId}/templates`, body);
    }
    setTemplateForm({ templateId: '', lineId: '', name: '', items: [] });
  });

  const duplicateTemplate = (line: LineConfigRow, template: LineConfigRow['staffingTemplates'][number]) => {
    setTemplateForm({
      templateId: '',
      lineId: line.id,
      name: `${template.name} — копия`,
      items: staffingTemplateDraftItems(line, template),
    });
    window.requestAnimationFrame(() => document.querySelector('[data-testid="admin-template-builder"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  const makeTemplateDefault = async (line: LineConfigRow, template: LineConfigRow['staffingTemplates'][number]) => {
    if (busy || line.defaultStaffingTemplateId === template.id) return;
    setBusy(true);
    setErrorText(null);
    try {
      const preview = await apiClient.post<StaffingRemapPreview>(
        `/admin/staffing-control/lines/${line.id}/templates/${template.id}/default/preview`,
        {},
      );
      const moved = preview.counts.activeMoved + preview.counts.plannedMoved;
      const released = preview.counts.activeReleased + preview.counts.plannedReleased;
      const kept = preview.counts.activeKept + preview.counts.plannedKept;
      const operationId = createOperationId('staffing-default');
      setPendingAction({
        title: `Сделать «${template.name}» основным составом`,
        description: 'Система атомарно обновит основной состав линии и связанные представления смены. История назначений сохранится.',
        consequences: [
          `Назначений останутся на местах: ${kept}.`,
          `Будут переставлены в подходящие позиции: ${moved}.`,
          `Потребуют освобождения: ${released}.`,
          ...(preview.requiresConfirmation ? ['Изменение затрагивает занятые позиции и требует явного подтверждения.'] : []),
        ],
        confirmLabel: 'Сделать основным',
        run: async () => {
          await apiClient.post(`/admin/staffing-control/lines/${line.id}/templates/${template.id}/default`, {
            expectedVersion: preview.lineVersion,
            operationId,
            confirmRemap: true,
          });
        },
      });
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createDepartment = () => quickAction(async () => {
    const body = {
      factoryId: departmentForm.scope === 'GLOBAL' ? null : selectedFactoryId,
      ...departmentForm,
      reason: departmentEditId ? 'Изменение отдела из админки' : 'Создание отдела из админки',
    };
    if (departmentEditId) await apiClient.patch(`/admin/departments/${departmentEditId}`, body);
    else await apiClient.post('/admin/departments', body);
    setDepartmentEditId('');
    setDepartmentForm({ name: '', code: '', scope: 'LOCAL' });
  });

  const createExternalCompany = () => quickAction(async () => {
    await apiClient.post('/admin/external-companies', {
      factoryId: selectedFactoryId,
      name: externalCompanyName,
    });
    setExternalCompanyName('');
  });

  const createWorkArea = () => quickAction(async () => {
    await apiClient.post('/admin/work-areas', {
      factoryId: selectedFactoryId,
      name: workAreaForm.name,
      description: workAreaForm.description || null,
      departmentId: workAreaForm.departmentId || null,
      assignmentKind: workAreaForm.assignmentKind,
        reason: 'Создание рабочей зоны из админки',
    });
    setWorkAreaForm({ name: '', description: '', departmentId: '', assignmentKind: 'WORK_AREA' });
  });

  const createWorkAreaPosition = () => quickAction(async () => {
    await apiClient.post(`/admin/work-areas/${workAreaPositionForm.workAreaId}/positions`, {
      title: workAreaPositionForm.title,
      minRequired: Number(workAreaPositionForm.minRequired || 1),
      defaultPlanned: Number(workAreaPositionForm.defaultPlanned || workAreaPositionForm.minRequired || 1),
      maxRequired: Number(workAreaPositionForm.maxRequired || workAreaPositionForm.defaultPlanned || 1),
        reason: 'Создание позиции рабочей зоны из админки',
    });
    setWorkAreaPositionForm((current) => ({ ...current, title: '' }));
  });

  const createJobTitle = () => quickAction(async () => {
    const body = {
      factoryId: jobTitleEditId ? data?.jobTitles.find((title) => title.id === jobTitleEditId)?.factoryId ?? null : selectedFactoryId,
      name: jobTitleForm.name,
      code: jobTitleForm.code || undefined,
      baseRole: jobTitleForm.baseRole,
      departmentId: jobTitleForm.departmentId || null,
      parentJobTitleId: jobTitleForm.parentJobTitleId || null,
      shiftDurationHours: Number(jobTitleForm.shiftDurationHours),
      permissionPreset: jobTitleForm.permissionPreset || null,
      description: jobTitleForm.description || null,
      reason: jobTitleEditId ? 'Изменение должности из админки' : 'Создание должности из админки',
    };
    if (jobTitleEditId) await apiClient.patch(`/admin/job-titles/${jobTitleEditId}`, body);
    else await apiClient.post('/admin/job-titles', body);
    setJobTitleEditId('');
    setJobTitleForm((current) => ({ ...current, name: '', code: '', parentJobTitleId: '', description: '' }));
  });

  const grantFactoryAccess = () => quickAction(async () => {
    const contractorRole = accessForm.role === 'CONTRACTOR' || accessForm.role === 'CONTRACTOR_LEAD';
    await apiClient.post(`/admin/users/${accessForm.userId}/factory-access`, {
      factoryId: selectedFactoryId,
      role: accessForm.role,
      departmentId: contractorRole ? null : accessForm.departmentId || null,
      jobTitleId: contractorRole ? null : accessForm.jobTitleId || null,
      companyId: contractorRole ? accessForm.companyId || null : null,
      reason: 'Выдача доступа к заводу из админки',
    });
  });

  const acceptAssignmentRequest = (request: AssignmentRequestRow) => {
    const jobTitleId = assignmentJobTitles[request.id] || null;
    setPendingAction({
      title: `Назначить: ${request.requestedByName ?? 'пользователь'}`,
      description: `Будет назначена роль «${roleLabel(request.requestedRole)}» в ${request.departmentName ?? request.companyName ?? 'выбранном контексте'}.`,
      consequences: [
        'Гостевой режим будет завершён.',
        'Права обновятся сразу, действие сохранится в аудите.',
      ],
      confirmLabel: 'Принять заявку',
      run: async (reason) => {
        await apiClient.post(`/admin/assignment-requests/${request.id}/accept`, {
          expectedVersion: request.version,
          jobTitleId,
          reason: reason || 'Назначение по заявке гостя',
        });
      },
    });
  };

  const selectVisiblePermissions = () => {
    setRolePreview(null);
    setRolePermissionDraft((current) => Array.from(new Set([...current, ...visiblePermissionCodes])).sort());
  };

  const clearVisiblePermissions = () => {
    const visible = new Set(visiblePermissionCodes);
    setRolePreview(null);
    setRolePermissionDraft((current) => current.filter((code) => !visible.has(code)));
  };

  const rejectAssignmentRequest = (request: AssignmentRequestRow) => {
    setPendingAction({
      title: `Отклонить заявку: ${request.requestedByName ?? 'пользователь'}`,
      description: 'Пользователь останется в гостевом режиме и сможет подать новую заявку после решения.',
      consequences: ['Причина будет показана пользователю.', 'Действие сохранится в аудите.'],
      confirmLabel: 'Отклонить заявку',
      requireReason: true,
      reasonLabel: 'Причина отклонения',
      reasonPlaceholder: 'Например: выбрано неверное подразделение',
      run: async (reason) => {
        await apiClient.post(`/admin/assignment-requests/${request.id}/reject`, {
          expectedVersion: request.version,
          reason,
        });
      },
    });
  };

  const renderConfigHealthPanel = (mode: 'overview' | 'full' = 'full') => {
    if (!configHealth) return null;
    const visibleGroups = showAllHealthGroups ? healthGroups : healthGroups.slice(0, 5);
    return (
      <div className={`config-health-panel admin-health-grouped ${configHealth.status}`}>
        <div className="line-title-row">
          <div>
            <h4>Готовность завода к работе</h4>
            <p>
              {configHealth.status === 'ready'
                ? 'Критичных проблем не найдено. Можно выдавать доступы и начинать ручную проверку.'
                : configHealth.status === 'blocker'
                  ? 'Есть блокеры. Сначала закройте их, иначе рабочие экраны будут неполными.'
                  : 'Есть предупреждения. Они не всегда блокируют работу, но их стоит проверить перед пилотом.'}
            </p>
          </div>
          <div className="factory-context-overview">
            <span className={`tag ${configHealth.status === 'ready' ? 'success' : configHealth.status === 'blocker' ? 'stop' : 'warning'}`}>
              {configHealth.status === 'ready' ? 'Готово' : configHealth.status === 'blocker' ? 'Блокирует работу' : 'Нужно проверить'}
            </span>
            <span className="tag">Блокеры: {configHealth.summary.blockers}</span>
            <span className="tag">Предупреждения: {configHealth.summary.warnings}</span>
          </div>
        </div>
        {configHealth.positive.length ? (
          <div className="admin-consequences success-list">
            {configHealth.positive.slice(0, mode === 'overview' ? 3 : 5).map((item) => <span key={item}>{item}</span>)}
          </div>
        ) : null}
        <div className="health-warning-list grouped">
          {healthGroups.length ? visibleGroups.map((group) => (
            <article className={`health-warning-card grouped ${group.severity}`} key={group.key}>
              <div>
                <strong>{group.title}</strong>
                <span>{healthSeverityLabel(group.severity)} · найдено пунктов: {group.count}</span>
                <small>{group.details[0]?.detail ?? 'Проверьте настройки выбранного раздела.'}</small>
              </div>
              <div className="admin-inline-actions">
                <button className="secondary-button" type="button" onClick={() => openAdminSection(group.section)}>
                  {group.actionLabel || 'Перейти к настройке'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setExpandedHealthGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                >
                  {expandedHealthGroups[group.key] ? 'Скрыть список' : 'Показать список'}
                </button>
              </div>
              {expandedHealthGroups[group.key] ? (
                <div className="admin-nested-list">
                  {group.details.map((warning) => (
                    <div className="admin-mini-row" key={warning.id}>
                      <span>{warning.title}</span>
                      <span>{warning.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          )) : <div className="empty-state compact">Критичных предупреждений нет. Завод готов к дальнейшей настройке доступа.</div>}
        </div>
        {healthGroups.length > 5 ? (
          <button className="secondary-button" type="button" onClick={() => setShowAllHealthGroups((value) => !value)}>
            {showAllHealthGroups ? 'Скрыть дополнительные проверки' : `Показать ещё: ${healthGroups.length - 5}`}
          </button>
        ) : null}
      </div>
    );
  };

  const renderAdminOverview = () => (
    <section className="admin-overview">
      <section className="card admin-card wide admin-overview-hero">
        <div className="line-title-row">
          <div>
            <h3 className="admin-heading-with-help">
              Выбран завод: {factoryContext?.factory.name ?? selectedFactory?.name ?? 'не выбран'}
              <HelpTooltip title="Контекст завода">
                Админка показывает пользователей, отделы, линии, должности и настройки именно выбранного завода. При смене завода рабочий контекст должен переключиться.
              </HelpTooltip>
            </h3>
            <p>Это стартовая страница администратора. Она показывает, что относится к выбранному заводу, что ещё нужно настроить и куда нажать дальше.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load(selectedFactoryId)}>Обновить</button>
        </div>
        <div className="factory-context-overview">
          <span className="tag">Код: {factoryContext?.factory.code ?? selectedFactory?.code ?? 'не задан'}</span>
          <span className={`tag ${selectedFactory?.isActive ? 'success' : 'stop'}`}>Статус: {selectedFactory?.isActive ? 'Активен' : 'Отключён'}</span>
          <span className="tag">Пользователи: {factoryContext?.counts.usersWithAccess ?? selectedFactory?.counts.users ?? 0}</span>
          <span className="tag">Линии: {factoryContext?.counts.lines ?? data?.lines.length ?? 0}</span>
          <span className="tag">Позиции: {factoryContext?.counts.positions ?? 0}</span>
          <span className="tag">Шаблоны: {factoryContext?.counts.staffingTemplates ?? 0}</span>
          <span className="tag">Рабочие зоны: {factoryContext?.counts.workAreas ?? 0}</span>
          <button className="tag recovery-summary-action" type="button" onClick={() => openAdminSection('Восстановление')}>
            В восстановлении: {data?.recovery?.total ?? 0}
          </button>
          <button className="tag recovery-summary-action" type="button" onClick={() => openAdminSection('Диагностика данных')}>
            Диагностика данных: {data?.dataHygieneSummary?.total ?? 0}
          </button>
        </div>
      </section>

      <section className="card admin-card wide">
        <div className="line-title-row">
          <div>
            <h3>Что нужно настроить?</h3>
            <p>Выберите обычную задачу. Система откроет нужный раздел, без поиска по длинной матрице настроек.</p>
          </div>
        </div>
        <div className="admin-quick-action-grid">
          {QUICK_ADMIN_ACTIONS.map((action) => (
            <button className="admin-action-card" type="button" key={action.title} onClick={() => openAdminSection(action.section)}>
              <strong>{action.title}</strong>
              <span>{action.detail}</span>
            </button>
          ))}
        </div>
      </section>

      {renderConfigHealthPanel('overview')}
    </section>
  );

  const renderFactoryBuilder = () => (
    <>
      <section className="card admin-card wide">
        <div className="line-title-row">
          <div>
            <h3 className="admin-heading-with-help">
              Заводы
              <HelpTooltip title="Мультизаводской доступ">
                Пользователь видит только заводы, где у него есть активный доступ. Выбор завода меняет область видимости админских данных.
              </HelpTooltip>
            </h3>
            <p>Выберите завод, чтобы увидеть его отделы, линии, шаблоны и настройки. Новый завод создаётся без физического удаления старых данных.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load(selectedFactoryId)}>Обновить</button>
        </div>
        <div className="factory-context-list" aria-label="Рабочий список заводов">
          {contextFactories.map((factory) => (
            <button
              className={`factory-chip ${factory.id === selectedFactory?.id ? 'active' : ''}`}
              key={factory.id}
              type="button"
              onClick={() => void reloadFactory(factory.id)}
            >
              <strong>{factory.name}</strong>
              <span>{factory.code}</span>
              <span>{russianCount(factory.counts.users, 'доступ', 'доступа', 'доступов')} · {russianCount(factory.counts.departments, 'отдел', 'отдела', 'отделов')} · {russianCount(factoryLineCount(factory), 'линия', 'линии', 'линий')}</span>
              <span className={`tag ${factory.isActive ? 'success' : 'stop'}`}>{factory.isActive ? 'Активен' : 'Отключён'}</span>
            </button>
          ))}
        </div>
        <div className="admin-diagnostic-details">
          <button className="secondary-button" type="button" onClick={() => setShowFactoryDiagnostics((value) => !value)}>
            {showFactoryDiagnostics ? 'Скрыть диагностику заводов' : 'Показать диагностику заводов'}
          </button>
          {showFactoryDiagnostics ? (
            <div className="admin-factory-strip">
              {data?.factories.map((factory) => (
                <button
                  className={`factory-chip ${factory.id === selectedFactory?.id ? 'active' : ''}`}
                  key={factory.id}
                  type="button"
                  onClick={() => void reloadFactory(factory.id)}
                >
                  <strong>{factory.name}</strong>
                  <span>{factory.code}</span>
                  <span>{russianCount(factory.counts.users, 'доступ', 'доступа', 'доступов')} · {russianCount(factory.counts.departments, 'отдел', 'отдела', 'отделов')} · {russianCount(factory.counts.lines ?? 0, 'линия', 'линии', 'линий')}</span>
                  <span className={`tag ${factory.isActive ? 'success' : 'stop'}`}>{factory.isActive ? 'Активен' : 'Отключён'}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

<section className="card admin-card wide factory-setup-wizard">
        <div className="line-title-row">
          <div>
            <h3>Создать завод</h3>
            <p>Пошаговый мастер создаёт новый завод и, если нужно, копирует только конфигурацию. История смен, заявки, чаты, вложения и архивы не копируются.</p>
          </div>
          <span className="tag success">Без reset и удаления данных</span>
        </div>

        <div className="wizard-steps">
          <span className="tag success">1. Основные данные</span>
          <span className="tag">2. Способ настройки</span>
          <span className="tag">3. Предпросмотр</span>
          <span className="tag">4. Проверка здоровья</span>
        </div>

        <div className="factory-wizard-layout">
          <div className="factory-wizard-main">
            <div className="admin-setup-panel">
              <h4>Основные данные</h4>
              <div className="form-grid compact-grid">
                <label>Название завода
                  <input value={factoryForm.name} onChange={(event) => { setFactoryForm((current) => ({ ...current, name: event.target.value })); setSetupPreview(null); }} placeholder="Например: Завод 5" />
                </label>
                <label>Короткий код
              <input value={factoryForm.code} onChange={(event) => { setFactoryForm((current) => ({ ...current, code: event.target.value })); setSetupPreview(null); }} placeholder="код-завода-5" />
                </label>
                <label>Площадка / комментарий
                  <input value={factoryForm.description} onChange={(event) => setFactoryForm((current) => ({ ...current, description: event.target.value }))} placeholder="Город, площадка или заметка для аудита" />
                </label>
                <label>Статус
                  <select value={factoryForm.isActive ? 'active' : 'draft'} onChange={(event) => setFactoryForm((current) => ({ ...current, isActive: event.target.value === 'active' }))}>
                    <option value="active">Активен</option>
                    <option value="draft">Черновик / отключён</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="admin-setup-panel">
              <h4>Способ настройки</h4>
              <div className="wizard-choice-grid">
                <button className={`factory-chip ${setupMode === 'EMPTY' ? 'active' : ''}`} type="button" onClick={() => { setSetupMode('EMPTY'); setSetupPreview(null); }}>
                  <strong>Пустой завод</strong>
                  <span>Создать завод без линий и отделов. Всё настраивается вручную.</span>
                </button>
                <button className={`factory-chip ${setupMode === 'COPY' ? 'active' : ''}`} type="button" onClick={() => { setSetupMode('COPY'); setSetupPreview(null); }}>
                  <strong>Скопировать с завода</strong>
                  <span>Скопировать структуру, но не историю и не пользователей.</span>
                </button>
              </div>
              {setupMode === 'COPY' ? (
                <>
                  <label className="field-label">Завод-источник
                    <select value={setupSourceFactoryId} onChange={(event) => { setSetupSourceFactoryId(event.target.value); setSetupPreview(null); }}>
                      {(setupOptions?.sourceFactories ?? contextFactories).map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}
                    </select>
                  </label>
                  <div className="copy-category-grid">
                    {(setupOptions?.categories ?? []).map((category) => (
                      <label className="copy-category-card" key={category.key}>
                        <input
                          type="checkbox"
                          checked={Boolean(setupCategories[category.key])}
                          onChange={(event) => {
                            setSetupCategories((current) => ({ ...current, [category.key]: event.target.checked }));
                            setSetupPreview(null);
                          }}
                        />
                        <span>
                          <strong>{category.label}</strong>
                          <small>{category.description}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state compact">Пустой завод создаётся без структуры. После создания мастер покажет, что нужно настроить первым.</div>
              )}
            </div>

            <div className="admin-inline-actions">
              <button className="secondary-button" type="button" disabled={busy || !factoryForm.name.trim() || !factoryForm.code.trim()} onClick={() => void previewFactorySetup()}>
                Показать предпросмотр
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={busy || !factoryForm.name.trim() || !factoryForm.code.trim()}
                onClick={() => setPendingAction({
                  title: 'Создать завод',
                  description: 'Будет создан новый завод и скопирована только выбранная конфигурация. История смен, заявки, чаты, вложения и архивы не копируются.',
                  consequences: [
                    setupPreview ? `Предпросмотр: линий ${setupPreview.counts.lines ?? 0}, позиций ${setupPreview.counts.linePositions ?? 0}, шаблонов ${setupPreview.counts.staffingTemplates ?? 0}, рабочих зон ${setupPreview.counts.workAreas ?? 0}.` : 'Перед созданием можно нажать “Показать предпросмотр”.',
                    'Пользователи не копируются автоматически. Доступы выдаются отдельно после создания.',
                    'Действие пишется в аудит.',
                  ],
                  requireText: 'ЗАВОД',
                  run: createFactory,
                })}
              >
                Создать завод
              </button>
            </div>
          </div>

          <aside className="factory-wizard-preview">
            <h4>Предпросмотр конфигурации</h4>
            {setupPreview ? (
              <>
                <div className="factory-context-overview">
                  <span className="tag">Источник: {setupPreview.sourceFactoryName ?? 'не выбран'}</span>
                  <span className="tag">История работы: не копируется</span>
                  <span className={`tag ${setupPreview.writesDatabase ? 'stop' : 'success'}`}>Проверка: без записи в БД</span>
                </div>
                <div className="metric-grid">
                  <div className="metric-card"><div className="metric-label">Линии</div><div className="metric-value">{setupPreview.counts.lines ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Позиции</div><div className="metric-value">{setupPreview.counts.linePositions ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Шаблоны</div><div className="metric-value">{setupPreview.counts.staffingTemplates ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Рабочие зоны</div><div className="metric-value">{setupPreview.counts.workAreas ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Отделы</div><div className="metric-value">{setupPreview.counts.localDepartments ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Должности</div><div className="metric-value">{setupPreview.counts.jobTitles ?? 0}</div></div>
                </div>
                <div className="admin-consequences">
                  {setupPreview.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                </div>
              </>
            ) : (
              <div className="empty-state compact">Заполните основные данные и нажмите “Показать предпросмотр”, чтобы увидеть, что будет создано.</div>
            )}

            {setupResult ? (
              <div className="factory-setup-result">
                <h4>Создан завод: {setupResult.factory.name}</h4>
                <div className="admin-consequences">
                  <span>Открыт новый контекст: {setupResult.factory.code}</span>
                  <span>История работы не копировалась</span>
                  {setupResult.nextSteps.map((step) => <span key={step}>Следующий шаг: {step}</span>)}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </section>

      <section className="card admin-card wide factory-config-transfer">
        <div className="line-title-row">
          <div>
            <h3>Экспорт и импорт конфигурации</h3>
            <p>Переносится только настройка завода: отделы, линии, позиции, шаблоны состава, рабочие зоны, должности и настройки модулей. История, пользователи, вложения, чаты, заявки, смены, аудит и секреты не попадают в файл.</p>
          </div>
          <span className="tag success">Версия схемы 1</span>
        </div>
        <div className="factory-transfer-grid">
          <div className="admin-setup-panel">
            <h4>Экспорт конфигурации</h4>
            <p>Сформируйте файл конфигурации для выбранного завода. В файле будут стабильные локальные ключи вместо внутренних id.</p>
            <div className="admin-consequences">
              <span>Включено: локальные отделы, общие службы как ссылки, линии, позиции, шаблоны, рабочие зоны, должности, настройки модулей.</span>
              <span>Не включено: пользователи, доступы, история работы, вложения, пути хранения, токены и аудит.</span>
            </div>
            <div className="admin-inline-actions">
              <button className="secondary-button" type="button" disabled={busy || !selectedFactoryId} onClick={() => void exportFactoryConfig()}>
                Сформировать экспорт
              </button>
              <button className="primary-button" type="button" disabled={!exportConfig} onClick={downloadFactoryConfig}>
                Скачать файл
              </button>
            </div>
            {exportConfig ? (
              <div className="factory-transfer-preview">
                <div className="factory-context-overview">
                  <span className="tag">Источник: {exportConfig.sourceFactory?.name ?? 'не указан'}</span>
                  <span className="tag">История работы: не экспортируется</span>
                  <span className="tag success">Без путей хранения и секретов</span>
                </div>
                <div className="metric-grid">
                  <div className="metric-card"><div className="metric-label">Линии</div><div className="metric-value">{exportConfig.counts?.lines ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Позиции</div><div className="metric-value">{exportConfig.counts?.linePositions ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Шаблоны</div><div className="metric-value">{exportConfig.counts?.staffingTemplates ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Рабочие зоны</div><div className="metric-value">{exportConfig.counts?.workAreas ?? 0}</div></div>
                </div>
              </div>
            ) : (
              <div className="empty-state compact">Нажмите “Сформировать экспорт”, чтобы увидеть состав переносимого файла.</div>
            )}
          </div>

          <div className="admin-setup-panel">
            <h4>Импорт конфигурации</h4>
            <p>Импорт создаёт только новый завод. Применение файла к существующему заводу намеренно не делается.</p>
            <div className="form-grid compact-grid">
              <label>Файл конфигурации
                <input type="file" accept="application/json,.json" onChange={(event) => void readImportFile(event.target.files?.[0])} />
              </label>
              <label>Название нового завода
                <input value={importTarget.name} onChange={(event) => { setImportTarget((current) => ({ ...current, name: event.target.value })); setImportPreview(null); }} placeholder="Например: Завод 5" />
              </label>
              <label>Код нового завода
                  <input value={importTarget.code} onChange={(event) => { setImportTarget((current) => ({ ...current, code: event.target.value })); setImportPreview(null); }} placeholder="код-завода-5" />
              </label>
              <label>Статус
                <select value={importTarget.isActive ? 'active' : 'draft'} onChange={(event) => setImportTarget((current) => ({ ...current, isActive: event.target.value === 'active' }))}>
                  <option value="active">Активен</option>
                  <option value="draft">Черновик / отключён</option>
                </select>
              </label>
            </div>
            <div className="factory-context-overview">
              <span className="tag">Файл: {importFileName || 'не выбран'}</span>
              <span className="tag">Создаётся новый завод</span>
              <span className="tag">Без записи до предпросмотра</span>
            </div>
            <div className="admin-inline-actions">
              <button className="secondary-button" type="button" disabled={busy || !importConfig} onClick={() => void previewFactoryConfigImport()}>
                Проверить файл
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={busy || !importConfig || !importPreview || importPreview.errors.length > 0 || !importTarget.name.trim() || !importTarget.code.trim()}
                onClick={() => setPendingAction({
                  title: 'Импортировать конфигурацию',
                  description: 'Будет создан новый завод из файла конфигурации. История работы, пользователи, доступы, вложения и секреты не импортируются.',
                  consequences: [
                    `Линий: ${importPreview?.counts.lines ?? 0}`,
                    `Позиций: ${importPreview?.counts.linePositions ?? 0}`,
                    `Шаблонов: ${importPreview?.counts.staffingTemplates ?? 0}`,
                    'Импорт не применяется к существующим заводам.',
                    'Действие пишется в аудит.',
                  ],
                  requireText: 'ИМПОРТ',
                  run: createFactoryFromImport,
                })}
              >
                Создать завод из файла
              </button>
            </div>
            {importPreview ? (
              <div className={`factory-transfer-preview ${importPreview.errors.length ? 'has-errors' : 'ready'}`}>
                <div className="factory-context-overview">
                  <span className="tag">Источник: {importPreview.sourceFactory?.name ?? 'не указан'}</span>
                  <span className={`tag ${importPreview.errors.length ? 'stop' : 'success'}`}>{importPreview.errors.length ? 'Есть ошибки' : 'Файл подходит'}</span>
                  <span className="tag">История работы: не импортируется</span>
                </div>
                <div className="metric-grid">
                  <div className="metric-card"><div className="metric-label">Линии</div><div className="metric-value">{importPreview.counts.lines ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Позиции</div><div className="metric-value">{importPreview.counts.linePositions ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Отделы</div><div className="metric-value">{importPreview.counts.localDepartments ?? 0}</div></div>
                  <div className="metric-card"><div className="metric-label">Настройки</div><div className="metric-value">{importPreview.counts.moduleSettings ?? 0}</div></div>
                </div>
                {importPreview.errors.length ? (
                  <div className="admin-consequences danger-list">
                    {importPreview.errors.map((item) => <span key={item}>{item}</span>)}
                  </div>
                ) : null}
                <div className="admin-consequences">
                  {importPreview.warnings.slice(0, 6).map((item) => <span key={item}>{item}</span>)}
                </div>
              </div>
            ) : null}
            {importResult ? (
              <div className="factory-setup-result">
                <h4>Создан завод: {importResult.factory.name}</h4>
                <div className="admin-consequences">
                  <span>Открыт новый контекст: {importResult.factory.code}</span>
                  <span>История работы не импортировалась</span>
                  <span>Проверка конфигурации: {importResult.health.status === 'ready' ? 'готово' : importResult.health.status === 'blocker' ? 'есть блокеры' : 'нужно проверить'}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {selectedFactory ? (
        <section className="card admin-card wide factory-context-card">
          <div className="line-title-row">
            <div>
              <h3>Выбран завод: {factoryContext?.factory.name ?? selectedFactory.name}</h3>
              <p>Контекст ниже относится именно к этому заводу: пользователи с доступом, локальные отделы, общие службы, линии, позиции, шаблоны состава, рабочие зоны, настройки и аудит.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setPendingAction({
                title: selectedFactory.isActive ? `Деактивировать ${selectedFactory.name}` : `Восстановить ${selectedFactory.name}`,
                description: 'Завод физически не удаляется. Действие пишет аудит и сохраняет историю.',
                consequences: selectedFactory.isActive
                  ? ['Нельзя деактивировать последний активный завод.', 'Пользователи не потеряют историю, но завод станет неактивным.']
                  : ['Завод снова будет доступен в выборе завода.'],
                requireText: selectedFactory.isActive ? 'ЗАВОД' : undefined,
                requireReason: selectedFactory.isActive,
                reasonPlaceholder: 'Например: завод больше не используется',
                run: (reason) => apiClient.patch(`/admin/factories/${selectedFactory.id}/status`, { isActive: !selectedFactory.isActive, reason: reason ?? 'Административное изменение' }),
              })}
            >
              {selectedFactory.isActive ? 'Деактивировать' : 'Восстановить'}
            </button>
          </div>
          {factoryEdit ? <div className="admin-setup-panel" data-testid="admin-factory-editor">
            <div className="form-grid compact-grid">
              <label>Название завода<input value={factoryEdit.name} onChange={(event) => setFactoryEdit({ ...factoryEdit, name: event.target.value })} /></label>
              <label>Код завода<input value={factoryEdit.code} onChange={(event) => setFactoryEdit({ ...factoryEdit, code: event.target.value })} /></label>
            </div>
            <button className="primary-button" type="button" disabled={busy || !factoryEdit.name.trim() || !factoryEdit.code.trim()} onClick={() => void quickAction(async () => {
              await apiClient.patch(`/admin/factories/${selectedFactory.id}`, { ...factoryEdit, reason: 'Изменение названия и кода из админки' });
              setFactoryEdit(null);
              await onSelectFactory(selectedFactory.id);
            })}>Сохранить завод</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => setFactoryEdit(null)}>Отмена</button>
          </div> : <button className="secondary-button" type="button" onClick={() => setFactoryEdit({ name: selectedFactory.name, code: selectedFactory.code })}>Изменить название и код</button>}
          <div className="factory-context-overview">
            <span className="tag">Код: {factoryContext?.factory.code ?? selectedFactory.code}</span>
            <span className={`tag ${selectedFactory.isActive ? 'success' : 'stop'}`}>Статус: {selectedFactory.isActive ? 'Активен' : 'Отключён'}</span>
            <span className="tag">Пользователи с доступом: {factoryContext?.counts.usersWithAccess ?? selectedFactory.counts.users}</span>
            <span className="tag">Локальные отделы: {factoryContext?.counts.localDepartments ?? localDepartments.length}</span>
            <span className="tag">Общие службы: {factoryContext?.counts.globalServices ?? sharedDepartments.length}</span>
            <span className="tag">Линии: {factoryContext?.counts.lines ?? (selectedFactory.counts.lines ?? data?.lines.length ?? 0)}</span>
            <span className="tag">Позиции: {factoryContext?.counts.positions ?? data?.lines.reduce((sum, line) => sum + line.positions.length, 0)}</span>
            <span className="tag">Шаблоны состава: {factoryContext?.counts.staffingTemplates ?? data?.lines.reduce((sum, line) => sum + line.staffingTemplates.length, 0)}</span>
            <span className="tag">Рабочие зоны: {factoryContext?.counts.workAreas ?? data?.workAreas.length}</span>
          </div>
          {renderConfigHealthPanel('full')}
          <div className="admin-subnav">
            {['Обзор', 'Пользователи с доступом', 'Отделы и службы', 'Должности', 'Линии и позиции', 'Позиции', 'Шаблоны состава', 'Рабочие зоны', 'Настройки модулей', 'Аудит изменений'].map((item) => (
              <span className="tag" key={item}>{item}</span>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );

  const renderPermissionDelegationPanel = () => {
    const context = delegationContext;
    if (!context) return null;
    const selectedSource = context.sourceCandidates.find((item) => item.userId === delegationForm.sourceUserId) ?? null;
    const selectedTarget = context.targetCandidates.find((item) => item.userId === delegationForm.targetUserId) ?? null;
    const canPreview = Boolean(delegationForm.sourceUserId && delegationForm.targetUserId && delegationForm.sourceUserId !== delegationForm.targetUserId);

    return (
      <div className="admin-setup-panel delegation-panel">
        <div className="line-title-row">
          <div>
            <h4>Дать права как у сотрудника</h4>
            <p>Выберите сотрудника-образец и получателя. Перед назначением система покажет точный итог.</p>
          </div>
          <div className="admin-inline-actions delegation-heading-actions">
            <span className="tag">Завод: {context.factory.name}</span>
            <button className="secondary-button compact-action" type="button" onClick={() => setDelegationHelpOpen(true)}>Как это работает</button>
          </div>
        </div>

        <div className="form-grid compact-grid delegation-picker-grid">
          <label>
            <AdminFieldLabel helpTitle="Выбрать сотрудника-образец" helpText="Выберите человека из своего отдела и ниже по подчинению. Если у образца есть лишние права, они будут скрыты и не попадут в итог.">
              У кого взять права
            </AdminFieldLabel>
            <button
              className="delegation-person-trigger"
              type="button"
              onClick={() => {
                setDelegationSearch('');
                setDelegationPicker('source');
              }}
            >
              <strong>{selectedSource ? shortPersonName(selectedSource.userId, selectedSource.displayName) : 'Выбрать сотрудника-образец'}</strong>
              <span>
                {selectedSource
                  ? `${selectedSource.jobTitleName ?? roleLabel(selectedSource.role)} · ${selectedSource.departmentName ?? 'Без отдела'}`
                  : 'Поиск по имени или телефону'}
              </span>
            </button>
          </label>
          <label>
            <AdminFieldLabel helpTitle="Получатель прав" helpText="Руководитель может назначить гостя или сотрудника только в свой отдел. Чужой отдел и другой завод сервер не примет даже при прямом запросе.">
              Кому выдать права
            </AdminFieldLabel>
            <button
              className="delegation-person-trigger"
              type="button"
              onClick={() => {
                setDelegationSearch('');
                setDelegationPicker('target');
              }}
            >
              <strong>{selectedTarget ? shortPersonName(selectedTarget.userId, selectedTarget.displayName) : 'Выбрать сотрудника или гостя'}</strong>
              <span>
                {selectedTarget
                  ? `${selectedTarget.isGuest ? 'Гость' : selectedTarget.jobTitleName ?? roleLabel(selectedTarget.role)} · ${selectedTarget.departmentName ?? 'Без отдела'}`
                  : 'Поиск по имени или телефону'}
              </span>
            </button>
          </label>
        </div>

        <PremiumSheet
          open={Boolean(delegationPicker)}
          title={delegationPicker === 'source' ? 'Выбрать сотрудника-образец' : 'Кому выдать права'}
          eyebrow={delegationPicker === 'source' ? 'Источник прав' : 'Получатель прав'}
          onClose={() => { setDelegationPicker(null); setDelegationSearch(''); }}
        >
          <CompactPeoplePicker
            autoFocus
            showAllInitially
            query={delegationSearch}
            onQueryChange={setDelegationSearch}
            actionLabel="Выбрать"
            selectedIds={[delegationPicker === 'source' ? delegationForm.sourceUserId : delegationForm.targetUserId].filter(Boolean)}
            items={(delegationPicker === 'source' ? context.sourceCandidates : context.targetCandidates).map((candidate) => ({
              id: candidate.userId,
              name: shortPersonName(candidate.userId, candidate.displayName),
              meta: `${candidate.isGuest ? 'Гость' : candidate.jobTitleName ?? roleLabel(candidate.role)} · ${candidate.departmentName ?? 'Без отдела'}`,
              phoneLabel: candidate.phoneLabel,
            }))}
            onSelect={(item) => {
              setDelegationForm((current) => ({
                ...current,
                [delegationPicker === 'source' ? 'sourceUserId' : 'targetUserId']: item.id,
              }));
              setDelegationPreview(null);
              setDelegationPicker(null);
              setDelegationSearch('');
            }}
          />
        </PremiumSheet>

        <PremiumSheet open={delegationHelpOpen} title="Как работает делегирование" onClose={() => setDelegationHelpOpen(false)}>
          <div className="delegation-help-copy">
            <p>Руководитель работает только внутри своего отдела и только с подчинёнными должностями.</p>
            <p>Система показывает и выдаёт только пересечение прав сотрудника-образца и самого руководителя.</p>
            <p>Права администратора, руководства, чужого отдела и другого завода недоступны. Сервер повторно проверяет эти ограничения при сохранении.</p>
          </div>
        </PremiumSheet>

        <div className="admin-inline-actions">
          <button className="secondary-button" type="button" disabled={busy || !canPreview} onClick={() => void previewDelegation()}>
            Проверить права
          </button>
          <button className="primary-button" type="button" disabled={busy || !delegationPreview?.allowed} onClick={() => applyDelegation()}>
            Назначить в мой отдел
          </button>
        </div>

        {context.warnings.length ? (
          <div className="admin-consequences">
            {context.warnings.map((warning) => <span key={warning}>{warning}</span>)}
          </div>
        ) : null}

        {delegationPreview ? (
          <div className={`delegation-preview ${delegationPreview.allowed ? '' : 'error-state'}`}>
            <div className="line-meta">
              <span className="tag">Источник: {selectedSource?.displayName ?? delegationPreview.source.displayName}</span>
              <span className="tag">Получатель: {selectedTarget?.displayName ?? delegationPreview.target.displayName}</span>
              <span className="tag">Будет отдел: {delegationPreview.nextAccess.departmentName ?? 'Без отдела'}</span>
              <span className="tag">Будет должность: {delegationPreview.nextAccess.jobTitleName ?? 'должность не указана'}</span>
              <span className="tag">Будет роль: {roleLabel(delegationPreview.nextAccess.role)}</span>
            </div>
            {delegationPreview.warnings.length ? (
              <div className="admin-consequences">
                {delegationPreview.warnings.map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            ) : null}
            <div className="dashboard-grid compact">
              <div>
                <h4 className="admin-heading-with-help">
                  Итоговый набор прав
                  <HelpTooltip title="Что будет выдано">
                    Здесь показан точный набор прав, который сервер разрешит применить. Список должен совпадать с результатом после сохранения.
                  </HelpTooltip>
                </h4>
                <div className="line-meta vertical">
                  {(delegationPreview.grantedPermissions ?? delegationPreview.allowedAdds ?? []).map((permission) => <span className="tag success" key={permission}>{permissionLabel(permission)}</span>)}
                  {!(delegationPreview.grantedPermissions ?? delegationPreview.allowedAdds ?? []).length ? <span className="tag">Делегируемых прав нет</span> : null}
                </div>
              </div>
              <div>
                <h4 className="admin-heading-with-help">
                  Недоступно для выдачи
                  <HelpTooltip title="Скрытые права">
                    Недоступные права не показываются как варианты и не выдаются через прямой API. Это защита от случайного повышения роли.
                  </HelpTooltip>
                </h4>
                <div className="line-meta vertical">
                  <span className="tag">Скрыто прав: {delegationPreview.hiddenCount}</span>
                  <span className="tag">Равная или вышестоящая должность, права администратора, руководства и чужие отделы не выдаются</span>
                </div>
              </div>
            </div>
            {!delegationPreview.allowed ? <div className="empty-state compact error-state">{delegationPreview.reason ?? 'Выдача прав недоступна.'}</div> : null}
          </div>
        ) : (
          <div className="empty-state compact">
            Выберите сотрудника-образец и получателя. Перед применением сервер покажет точный итог: какие права можно выдать, а какие полностью скрыты.
          </div>
        )}
      </div>
    );
  };

  const renderUsers = () => (
    <section className="card admin-card wide">
      <div className="line-title-row">
        <div>
          <h3>Пользователи с доступом</h3>
          <p>Показаны только пользователи, у которых есть доступ к выбранному заводу. Остальные пользователи системы не смешиваются с этим контекстом.</p>
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по пользователю, роли или отделу" />
      </div>
      <div className="admin-setup-panel">
        <h4 className="admin-heading-with-help">
          Выдать доступ к выбранному заводу
          <HelpTooltip title="Доступ к заводу">
            Доступ задаётся отдельно для каждого завода. Общая служба или должность не дают человеку автоматический вход на все площадки.
          </HelpTooltip>
        </h4>
        <p>Доступ выдаётся конкретному пользователю и конкретному заводу. Общая служба сама по себе не даёт доступ ко всем площадкам.</p>
        <div className="form-grid compact-grid">
          <label>
            <AdminFieldLabel helpTitle="Кого выбираем" helpText="В списке показываются реальные пользователи рабочего контура. Stage/test записи не должны попадать в обычную админскую выдачу доступа.">
              Пользователь
            </AdminFieldLabel>
            <select value={accessForm.userId} onChange={(event) => setAccessForm((current) => ({ ...current, userId: event.target.value }))}>
              <option value="">Выберите пользователя</option>
              {pilotVisibleUsers.map((user) => <option key={user.id} value={user.id}>{pilotUserName(user.id, user.displayName)}</option>)}
              {pilotVisibleAccessCandidates.length ? <optgroup label="Можно добавить в выбранный завод">
                {pilotVisibleAccessCandidates.map((user) => <option key={user.id} value={user.id}>{pilotUserName(user.id, user.displayName)}</option>)}
              </optgroup> : null}
            </select>
          </label>
          <label>
            <AdminFieldLabel helpTitle="Активный завод" helpText="Все действия ниже применяются к выбранному заводу. При переключении завода список пользователей, отделов и должностей должен обновиться.">
              Завод
            </AdminFieldLabel>
            <select disabled value={selectedFactoryId}>
              {selectedFactory ? <option value={selectedFactory.id}>{selectedFactory.name}</option> : null}
            </select>
          </label>
          <label>
            <AdminFieldLabel helpTitle="Системная роль" helpText="Роль задаёт базовые права. Опасные роли вроде администратора и руководства требуют отдельной проверки и не выдаются руководителем отдела.">
              Роль
            </AdminFieldLabel>
            <select
              value={accessForm.role}
              onChange={(event) => setAccessForm((current) => ({
                ...current,
                role: event.target.value,
                departmentId: ['CONTRACTOR', 'CONTRACTOR_LEAD'].includes(event.target.value) ? '' : current.departmentId,
                jobTitleId: ['CONTRACTOR', 'CONTRACTOR_LEAD'].includes(event.target.value) ? '' : current.jobTitleId,
                companyId: ['CONTRACTOR', 'CONTRACTOR_LEAD'].includes(event.target.value) ? current.companyId : '',
              }))}
            >
              {roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select>
          </label>
          {['CONTRACTOR', 'CONTRACTOR_LEAD'].includes(accessForm.role) ? (
            <label>
              <AdminFieldLabel helpTitle="Фирма наёмных работников" helpText="Фирма относится только к выбранному заводу и не даёт доступ к другим площадкам.">
                Фирма
              </AdminFieldLabel>
              <select value={accessForm.companyId} onChange={(event) => setAccessForm((current) => ({ ...current, companyId: event.target.value }))}>
                <option value="">Выберите фирму</option>
                {externalCompanies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label>
                <AdminFieldLabel helpTitle="Отдел или служба" helpText="Локальный отдел относится к выбранному заводу. Общая служба видна как справочник, но доступ сотруднику всё равно выдаётся через этот завод.">
                  Отдел / служба
                </AdminFieldLabel>
                <select value={accessForm.departmentId} onChange={(event) => setAccessForm((current) => ({ ...current, departmentId: event.target.value, jobTitleId: '' }))}>
                  <option value="">Без отдела</option>
                  {[...pilotVisibleLocalDepartments, ...pilotVisibleSharedDepartments].map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
              <label>
                <AdminFieldLabel helpTitle="Должность" helpText="Должность помогает показать понятное место человека в отделе и дерево подчинения. Сама по себе она не выдаёт скрытые права без роли и разрешений.">
                  Должность
                </AdminFieldLabel>
                <select value={accessForm.jobTitleId} onChange={(event) => setAccessForm((current) => ({ ...current, jobTitleId: event.target.value }))}>
                  <option value="">Без должности</option>
                  {jobTitleOptionsForDepartment(accessForm.departmentId || null).map((title) => <option key={title.id} value={title.id}>{title.name}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        <div className="admin-inline-actions">
          <button
            className="primary-button"
            disabled={busy || !accessForm.userId || (['CONTRACTOR', 'CONTRACTOR_LEAD'].includes(accessForm.role) && !accessForm.companyId)}
            type="button"
            onClick={() => void grantFactoryAccess()}
          >
            Выдать доступ
          </button>
        </div>
      </div>
      <div className="admin-setup-panel assignment-request-review" data-testid="assignment-request-review">
        <div className="line-title-row">
          <div>
            <h4>Заявки гостей на назначение</h4>
            <p>Показаны только заявки выбранного завода, которые входят в ваши полномочия.</p>
          </div>
          <span className={`tag ${assignmentRequests.length ? 'warning' : 'success'}`}>{assignmentRequests.length ? `Ожидают: ${assignmentRequests.length}` : 'Новых нет'}</span>
        </div>
        <div className="admin-list">
          {assignmentRequests.map((request) => {
            const jobTitles = request.departmentId ? jobTitleOptionsForDepartment(request.departmentId) : [];
            return (
              <article className="admin-row admin-row-stack" key={request.id}>
                <div className="line-title-row">
                  <div>
                    <strong>{request.requestedByName ?? 'Пользователь'}</strong>
                    <span>{roleLabel(request.requestedRole)} · {request.departmentName ?? request.companyName ?? 'Контекст не указан'}</span>
                  </div>
                  <span className="tag warning">На рассмотрении</span>
                </div>
                {request.comment ? <p>{request.comment}</p> : null}
                {jobTitles.length ? (
                  <label>
                    Должность
                    <select value={assignmentJobTitles[request.id] ?? ''} onChange={(event) => setAssignmentJobTitles((current) => ({ ...current, [request.id]: event.target.value }))}>
                      <option value="">Без должности</option>
                      {jobTitles.map((title) => <option key={title.id} value={title.id}>{title.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <div className="admin-inline-actions">
                  <button className="primary-button" type="button" disabled={busy} onClick={() => acceptAssignmentRequest(request)}>Принять</button>
                  <button className="danger-button" type="button" disabled={busy} onClick={() => rejectAssignmentRequest(request)}>Отклонить</button>
                </div>
              </article>
            );
          })}
          {!assignmentRequests.length ? <div className="empty-state compact">Заявок на назначение сейчас нет.</div> : null}
        </div>
      </div>
      {renderPermissionDelegationPanel()}

      <div className="admin-list">
        {filteredUsers.map((user) => (
          <article className={`admin-row ${user.blockedAt ? 'dimmed' : ''}`} key={user.id}>
            <strong>{pilotUserName(user.id, user.displayName)}</strong>
            <span>{roleLabel(user.selectedFactoryAccess?.role ?? user.globalRole)}</span>
            <span>{user.selectedFactoryAccess?.companyName ?? user.selectedFactoryAccess?.departmentName ?? 'Без подразделения'} · {user.selectedFactoryAccess?.jobTitleName ?? 'должность не указана'}</span>
            <span className="admin-status-with-help">
              {user.blockedAt ? 'Заблокирован' : 'Активен'}
              <HelpTooltip title="Статус входа">
                Активный пользователь может входить, если доступ к заводу включён. Заблокированный пользователь теряет рабочий контекст, но история не удаляется.
              </HelpTooltip>
            </span>
            <div className="admin-inline-actions">
              <button className="secondary-button" type="button" onClick={() => void openProfile(user.id)}>Профиль</button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void confirmWithPreview(
                  `/admin/users/${user.id}/block-status/preview`,
                  { blocked: !user.blockedAt },
                  user.blockedAt ? `Разблокировать ${pilotUserName(user.id, user.displayName)}` : `Заблокировать ${pilotUserName(user.id, user.displayName)}`,
                  user.blockedAt ? 'Пользователь снова сможет входить, если доступы активны.' : 'Пользователь потеряет доступ до разблокировки.',
                  () => apiClient.patch(`/admin/users/${user.id}/block-status`, { blocked: !user.blockedAt, reason: 'Изменение доступа пользователя из админки' }),
                  user.blockedAt ? undefined : 'БЛОК',
                )}
              >
                {user.blockedAt ? 'Разблокировать' : 'Заблокировать'}
              </button>
            </div>
          </article>
        ))}
      </div>
      {selectedProfile ? (
        <section className="card admin-card wide">
          <div className="line-title-row">
            <h3>Профиль пользователя: {pilotUserName(selectedProfile.id, selectedProfile.displayName)}</h3>
            <div className="admin-inline-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPendingAction({
                  title: `Сбросить пароль для ${pilotUserName(selectedProfile.id, selectedProfile.displayName)}`,
                  description: 'Будет выдан одноразовый временный код. Передайте его сотруднику после проверки личности. Старый пароль и сеансы перестанут работать.',
                  consequences: ['Код показывается один раз и действует ограниченное время.', 'Действие пишется в аудит без кода.'],
                  requireText: 'ПАРОЛЬ',
                  run: async () => {
                    const result = await apiClient.post<{ recoveryCredential: string; recoveryExpiresAt: string }>(`/admin/users/${selectedProfile.id}/password-reset`, { reason: 'Сброс пароля подтверждён в админке' });
                    setPasswordRecovery({ ...result, displayName: pilotUserName(selectedProfile.id, selectedProfile.displayName) });
                  },
                })}
              >
                Сбросить пароль
              </button>
              <button className="secondary-button" type="button" onClick={() => setSelectedProfile(null)}>Закрыть</button>
            </div>
          </div>{noticeText ? <div className="empty-state compact success-state" role="status">{noticeText}</div> : null}
          <div className="admin-subnav">
            {['Основное', 'Доступы к заводам', 'Роли', 'Отдел', 'Навыки', 'Заметки', 'Безопасность'].map((item) => <span className="tag" key={item}>{item}</span>)}
          </div>
          <div className="admin-section-block" data-testid="admin-user-identity">
            <h4>ФИО сотрудника</h4>
            <p>Это имя используется во всех рабочих разделах, истории и аудите.</p>
            <div className="form-grid compact-grid">
              <label>
                Фамилия
                <input
                  value={identityForm.lastName}
                  onChange={(event) => setIdentityForm((current) => ({ ...current, lastName: event.target.value }))}
                  autoComplete="family-name"
                  maxLength={80}
                />
              </label>
              <label>
                Имя
                <input
                  value={identityForm.firstName}
                  onChange={(event) => setIdentityForm((current) => ({ ...current, firstName: event.target.value }))}
                  autoComplete="given-name"
                  maxLength={80}
                />
              </label>
              <label>
                Отчество
                <input
                  value={identityForm.middleName}
                  onChange={(event) => setIdentityForm((current) => ({ ...current, middleName: event.target.value }))}
                  autoComplete="additional-name"
                  maxLength={80}
                />
              </label>
            </div>
            {identityError ? <div className="empty-state compact error-state" role="alert">{identityError}</div> : null}
            <button className="primary-button" type="button" disabled={busy} onClick={() => void saveIdentity()}>
              Сохранить ФИО
            </button>
          </div>
          <div className="dashboard-grid">
            <div>
              <h4>Доступы к заводам</h4>
              {selectedProfile.factoryAccesses.map((access) => (
                <div className="position-row" key={access.id}>
                  <div><strong>{access.factoryName ?? access.factoryId}</strong><span>{roleLabel(access.role)} · {access.companyName ?? access.departmentName ?? 'Без подразделения'} · {access.jobTitleName ?? 'должность не указана'}</span></div>
                  <span className="tag">{access.isActive ? 'Активен' : 'Отключён'}</span>
                  <button
                    className="secondary-button compact-action"
                    type="button"
                    onClick={() => setPendingAction({
                      title: `${access.isActive ? 'Отключить' : 'Восстановить'} доступ${access.factoryName ? `: «${access.factoryName}»` : ' к заводу'}`,
                      description: access.isActive
                        ? 'Пользователь потеряет рабочий контекст этого завода. История и аудит сохранятся.'
                        : 'Пользователь снова получит рабочий контекст согласно сохранённой роли и должности.',
                      consequences: access.isActive
                        ? ['Доступ отключается штатно без удаления пользователя и его истории.']
                        : ['Перед восстановлением сервер повторно проверит завод, отдел и должность.'],
                      requireReason: access.isActive,
                      reasonPlaceholder: 'Например: тестовый доступ завершён',
                      run: (reason) => apiClient.patch(`/admin/users/${selectedProfile.id}/factory-access`, {
                        factoryId: access.factoryId,
                        isActive: !access.isActive,
                        reason: reason ?? 'Изменение доступа к заводу из админки',
                      }),
                    })}
                  >
                    {access.isActive ? 'Отключить доступ' : 'Восстановить доступ'}
                  </button>
                </div>
              ))}
            </div>
            <div>
              <h4>Итоговые права</h4>
              <div className="line-meta">
                {selectedProfile.permissionsSummary.slice(0, 18).map((code) => <span className="tag" title={code} key={code}>{permissionLabel(code)}</span>)}
                {selectedProfile.permissionsSummary.length > 18 ? <span className="tag">+{selectedProfile.permissionsSummary.length - 18}</span> : null}
              </div>
              {selectedProfile.safety.warnings.length ? <h4>Предупреждения безопасности</h4> : null}
              <div className="line-meta">
                {selectedProfile.safety.warnings.map((warning) => <span className="tag stop" key={warning}>{warning}</span>)}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );

  const renderJobTitleTree = (departmentId: string | null, label: string) => {
    const titles = currentJobTitles.filter((title) => (title.departmentId ?? null) === departmentId);
    const roots = titles.filter((title) => !title.parentJobTitleId || !titles.some((item) => item.id === title.parentJobTitleId));
    const renderNode = (title: JobTitleRow, depth: number): React.ReactNode => {
      const children = (jobTitleChildrenByParent.get(title.id) ?? []).filter((child) => (child.departmentId ?? null) === departmentId);
      const parentValue = jobTitleParentEdits[title.id] ?? title.parentJobTitleId ?? '';
      const durationValue = jobTitleDurationEdits[title.id] ?? String(title.shiftDurationHours ?? 12);
      const parentOptions = jobTitleOptionsForDepartment(title.departmentId)
        .filter((candidate) => candidate.id !== title.id && !isJobTitleDescendant(candidate.id, title.id));
      return (
        <div className="job-title-tree-node" style={{ '--tree-depth': depth } as React.CSSProperties} key={title.id}>
          <article className={`admin-row job-title-row ${title.isActive ? '' : 'dimmed'}`}>
            <div>
              <strong>{title.name}</strong>
              <span>{roleLabel(title.baseRole)} · {title.departmentName ?? 'Без отдела'} · {title.parentJobTitleName ? `подчиняется: ${title.parentJobTitleName}` : 'верхний уровень'}</span>
            </div>
            <span className="tag">{title.permissionPreset ?? 'Набор прав не указан'}</span>
            <span className="tag">{title.shiftDurationHours === 24 ? '24 часа / сутки' : '12 часов'}</span>
            <span className={`tag ${title.isActive ? 'success' : 'pause'}`}>{title.isActive ? 'Активна' : 'Отключена'}</span>
            <label className="compact-control">Кому подчиняется
              <select
                value={parentValue}
                disabled={!title.isActive}
                onChange={(event) => setJobTitleParentEdits((current) => ({ ...current, [title.id]: event.target.value }))}
              >
                <option value="">Никому, верхний уровень</option>
                {parentOptions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <label className="compact-control">Режим смены
              <select
                value={durationValue}
                disabled={!title.isActive}
                onChange={(event) => setJobTitleDurationEdits((current) => ({ ...current, [title.id]: event.target.value }))}
              >
                <option value="12">12 часов</option>
                <option value="24">24 часа / сутки</option>
              </select>
            </label>
            <div className="admin-inline-actions">
              <button className="secondary-button" type="button" disabled={busy || !title.isActive} onClick={() => {
                setJobTitleEditId(title.id);
                setJobTitleForm({ name: title.name, code: title.code, baseRole: title.baseRole, departmentId: title.departmentId ?? '', parentJobTitleId: title.parentJobTitleId ?? '', shiftDurationHours: String(title.shiftDurationHours), permissionPreset: title.permissionPreset ?? '', description: title.description ?? '' });
                document.querySelector('[data-testid="admin-job-title-editor"]')?.scrollIntoView({ block: 'start' });
              }}>Изменить должность</button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || (
                  parentValue === (title.parentJobTitleId ?? '')
                  && Number(durationValue) === (title.shiftDurationHours ?? 12)
                )}
                onClick={() => void quickAction(async () => {
                  await apiClient.patch(`/admin/job-titles/${title.id}`, {
                    parentJobTitleId: parentValue || null,
                    shiftDurationHours: Number(durationValue),
                    reason: 'Обновление подчинения и режима смены должности из админки',
                  });
                  setJobTitleParentEdits((current) => {
                    const next = { ...current };
                    delete next[title.id];
                    return next;
                  });
                  setJobTitleDurationEdits((current) => {
                    const next = { ...current };
                    delete next[title.id];
                    return next;
                  });
                })}
              >
                Сохранить настройки
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPendingAction({
                  title: title.isActive ? `Отключить должность ${title.name}` : `Восстановить должность ${title.name}`,
                  description: 'Должность физически не удаляется и не меняет историю доступов.',
                  consequences: [
                    'Системная роль и права остаются источником доступа.',
                    title.childrenCount ? 'Если есть активные подчинённые должности, сервер не даст отключить верхний уровень.' : 'Действие пишется в аудит.',
                  ],
                  requireReason: title.isActive,
                  reasonPlaceholder: 'Например: должность больше не используется',
                  run: (reason) => apiClient.patch(`/admin/job-titles/${title.id}`, { isActive: !title.isActive, reason: reason ?? 'Обновление должности' }),
                })}
              >
                {title.isActive ? 'Отключить' : 'Восстановить'}
              </button>
            </div>
          </article>
          {children.length ? <div className="job-title-tree-children">{children.map((child) => renderNode(child, depth + 1))}</div> : null}
        </div>
      );
    };

    return (
      <div className="job-title-tree" data-testid="job-title-tree" key={departmentId ?? 'no-department'}>
        <h5>{label}</h5>
        {roots.length ? roots.map((title) => renderNode(title, 0)) : <div className="empty-state compact">В этом отделе должности ещё не настроены.</div>}
      </div>
    );
  };

  const renderJobTitles = () => (
    <section className="card admin-card wide">
      <div className="line-title-row">
        <div>
          <h3 className="admin-heading-with-help">
            Должности и роли
            <HelpTooltip title="Должность и права">
              Должность нужна для понятной структуры и подчинения. Реальные права по-прежнему определяются ролью, разрешениями и доступом к заводу.
            </HelpTooltip>
          </h3>
          <p>Должность — человекочитаемое название для выбранного завода или службы. Системная роль остаётся источником прав, а доступ к заводам задаётся отдельно.</p>
        </div>
      </div>
      <div className="admin-setup-panel" data-testid="admin-job-title-editor">
        <h4>{jobTitleEditId ? 'Изменить должность' : 'Создать должность'}</h4>
        <div className="admin-help-strip">Должность — это понятное название для людей. Поле “Кому подчиняется” задаёт дерево внутри отдела. Руководитель может назначать только подчинённые должности внутри своего отдела.</div>
        <div className="form-grid compact-grid">
          <label>Название
            <input value={jobTitleForm.name} onChange={(event) => setJobTitleForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например: Электрик" />
          </label>
          <label>Код
          <input value={jobTitleForm.code} onChange={(event) => setJobTitleForm((current) => ({ ...current, code: event.target.value }))} placeholder="электрик" />
          </label>
          <label>
            <AdminFieldLabel helpTitle="Базовая роль должности" helpText="Это роль, которую обычно получает человек на этой должности. Она не должна использоваться как скрытый способ выдать лишние права.">
              Базовая роль
            </AdminFieldLabel>
            <select aria-label="Базовая роль" value={jobTitleForm.baseRole} onChange={(event) => setJobTitleForm((current) => ({ ...current, baseRole: event.target.value }))}>
              {roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select>
          </label>
          <label>Режим смены
            <select value={jobTitleForm.shiftDurationHours} onChange={(event) => setJobTitleForm((current) => ({ ...current, shiftDurationHours: event.target.value }))}>
              <option value="12">12 часов</option>
              <option value="24">24 часа / сутки</option>
            </select>
          </label>
          <label>
            <AdminFieldLabel helpTitle="Отдел должности" helpText="Дерево подчинения строится внутри одного отдела и завода. Должность из другого отдела нельзя поставить родителем.">
              Отдел / служба
            </AdminFieldLabel>
            <select aria-label="Отдел / служба" value={jobTitleForm.departmentId} onChange={(event) => setJobTitleForm((current) => ({ ...current, departmentId: event.target.value, parentJobTitleId: '' }))}>
              <option value="">Без отдела</option>
              {[...pilotVisibleLocalDepartments, ...pilotVisibleSharedDepartments].map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
          <label>
            <AdminFieldLabel helpTitle="Уровень должности" helpText="Руководитель может назначать только должности ниже своей ветки. Равная или вышестоящая должность не доступна для делегирования.">
              Кому подчиняется
            </AdminFieldLabel>
            <select aria-label="Кому подчиняется" value={jobTitleForm.parentJobTitleId} onChange={(event) => setJobTitleForm((current) => ({ ...current, parentJobTitleId: event.target.value }))}>
              <option value="">Никому, верхний уровень</option>
              {jobTitleParentOptions.filter((title) => !jobTitleEditId || (title.id !== jobTitleEditId && !isJobTitleDescendant(title.id, jobTitleEditId))).map((title) => <option key={title.id} value={title.id}>{title.name}</option>)}
            </select>
          </label>
          <label>
            <AdminFieldLabel helpTitle="Понятное описание прав" helpText="Это человекочитаемая пометка для администратора. Источником доступа остаются системная роль, отдельные разрешения и backend-проверки.">
              Набор прав
            </AdminFieldLabel>
            <input value={jobTitleForm.permissionPreset} onChange={(event) => setJobTitleForm((current) => ({ ...current, permissionPreset: event.target.value }))} placeholder="Например: КИПиА" />
          </label>
          <label>Описание
            <input value={jobTitleForm.description} onChange={(event) => setJobTitleForm((current) => ({ ...current, description: event.target.value }))} placeholder="Что делает эта должность" />
          </label>
        </div>
        <div className="admin-inline-actions">
          <button className="primary-button" disabled={busy || !jobTitleForm.name.trim()} type="button" onClick={() => void createJobTitle()}>{jobTitleEditId ? 'Сохранить должность' : 'Создать должность'}</button>
          {jobTitleEditId ? <button className="secondary-button" type="button" onClick={() => { setJobTitleEditId(''); setJobTitleForm({ name: '', code: '', baseRole: 'WORKER', departmentId: '', parentJobTitleId: '', shiftDurationHours: '12', permissionPreset: 'Работник', description: '' }); }}>Отмена</button> : null}
        </div>
      </div>
      <div className="dashboard-grid organization-identity-grid">
        <div className="admin-setup-panel compact">
          <h4>Фирмы наёмных работников</h4>
          <p>Фирма относится только к выбранному заводу. Её сотрудники не получают доступ к другим площадкам автоматически.</p>
          <div className="form-grid compact-grid">
            <label>
              Название фирмы
              <input value={externalCompanyName} maxLength={120} onChange={(event) => setExternalCompanyName(event.target.value)} placeholder="Например: Персонал Сервис" />
            </label>
          </div>
          <div className="admin-inline-actions">
            <button className="primary-button" disabled={busy || !externalCompanyName.trim()} type="button" onClick={() => void createExternalCompany()}>Создать фирму</button>
          </div>
          <div className="admin-list">
            {externalCompanies.map((company) => (
              <article className={`admin-row ${company.isActive ? '' : 'dimmed'}`} key={company.id}>
                <strong>{company.name}</strong>
                <span>{company.membersCount} сотрудников · {company.requestsCount} заявок</span>
                <span>{company.leads.length ? `Старшие: ${company.leads.map((lead) => lead.displayName).join(', ')}` : 'Старший не назначен'}</span>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setPendingAction({
                    title: company.isActive ? `Отключить фирму ${company.name}` : `Восстановить фирму ${company.name}`,
                    description: 'Фирма не удаляется физически. История сотрудников и заявок сохраняется.',
                    consequences: [`Сотрудников: ${company.membersCount}.`, 'Действие сохранится в аудите.'],
                    requireReason: company.isActive,
                    reasonPlaceholder: 'Укажите причину отключения фирмы',
                    run: async (reason) => {
                      await apiClient.patch(`/admin/external-companies/${company.id}`, {
                        isActive: !company.isActive,
                        reason: reason || undefined,
                      });
                    },
                  })}
                >
                  {company.isActive ? 'Отключить' : 'Восстановить'}
                </button>
              </article>
            ))}
            {!externalCompanies.length ? <div className="empty-state compact">Фирмы наёмных работников пока не созданы.</div> : null}
          </div>
        </div>
        <div className="admin-setup-panel compact organization-identity-report" data-testid="organization-identity-report">
          <h4>Проверка справочников</h4>
          <p>Отчёт только показывает возможные коллизии. Автоматического объединения или удаления нет.</p>
          <div className="line-meta vertical">
            <span className={`tag ${organizationIdentityReport?.departmentDuplicateGroups.length ? 'warning' : 'success'}`}>
              Возможные дубли подразделений: {organizationIdentityReport?.departmentDuplicateGroups.length ?? 0}
            </span>
            <span className={`tag ${organizationIdentityReport?.phone.collisionGroups ? 'stop' : 'success'}`}>
              Совпадения телефонов: {organizationIdentityReport?.phone.collisionGroups ?? 0}
            </span>
            <span className={`tag ${organizationIdentityReport?.phone.invalidRecords ? 'warning' : 'success'}`}>
              Некорректные телефоны: {organizationIdentityReport?.phone.invalidRecords ?? 0}
            </span>
          </div>
          {organizationIdentityReport?.departmentDuplicateGroups.map((group) => {
            const impact = group.duplicates.reduce((total, duplicate) => ({
              users: total.users + duplicate.impact.users,
              requests: total.requests + duplicate.impact.requests,
              chats: total.chats + duplicate.impact.chats,
            }), { users: 0, requests: 0, chats: 0 });
            return (
              <div className="empty-state compact" key={group.name}>
                <strong>{group.name}</strong>
                <span>Затронуто: пользователей {impact.users}, заявок {impact.requests}, чатов {impact.chats}.</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="dashboard-grid">
        <div>
          <h4>Системные роли</h4>
          <div className="line-meta">
            {roleOptions.map((role) => <span className="tag" title={role} key={role}>{roleLabel(role)}</span>)}
          </div>
        </div>
        <div>
          <h4>Дерево должностей выбранного завода</h4>
          <div className="admin-help-strip">Если родительскую должность выбрать нельзя, значит она относится к другому отделу, другому заводу, отключена или находится ниже в этой же ветке.</div>
          <div className="admin-list job-title-tree-list">
            {[
              ...pilotVisibleLocalDepartments.map((department) => ({ id: department.id, label: department.name })),
              ...pilotVisibleSharedDepartments.map((department) => ({ id: department.id, label: `${department.name} · общая служба` })),
              { id: null, label: 'Без отдела' },
            ].map((group) => renderJobTitleTree(group.id, group.label))}
            {!currentJobTitles.length ? <div className="empty-state compact">Должности ещё не созданы. Можно начать с “Электрик”, “Сантехник”, “Оператор линии”.</div> : null}
          </div>
        </div>
      </div>
    </section>
  );

  const renderRoles = () => (
    <section className="card admin-card wide">
      <div className="line-title-row">
        <div>
          <h3 className="admin-heading-with-help">
            Роли и права
            <HelpTooltip title="Опасные права">
              Права администратора, управления пользователями, настройками и аудитом считаются опасными. Такие изменения требуют предпросмотра и серверной проверки.
            </HelpTooltip>
          </h3>
          <p>Матрица прав сгруппирована по модулям. Опасные изменения требуют предпросмотра и подтверждения.</p>
          <p>Создание собственных должностей доступно в разделе «Должности и роли». Здесь настраивается только матрица системных прав.</p>
        </div>
        <div className="admin-inline-actions">
          <select value={selectedRole} onChange={(event) => void selectRolePermissions(event.target.value)}>
            {roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select>
          <button className="secondary-button" type="button" onClick={() => void previewRolePermissions()}>Предпросмотр</button>
          <button className="secondary-button" type="button" onClick={() => setShowAdvancedPermissions((value) => !value)}>
            {showAdvancedPermissions ? 'Скрыть технические коды' : 'Расширенно'}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!rolePreview || !rolePreview.allowed}
            onClick={() => setPendingAction({
              title: `Сохранить права для ${roleLabel(selectedRole)}`,
              description: 'Сервер применит проверенную матрицу прав. Работники и наёмные работники не могут получить управленческие права по умолчанию.',
              consequences: previewSummary(rolePreview),
              requireText: rolePreview?.warnings.length || selectedRole === 'ADMIN' ? 'ПРАВА' : undefined,
              run: () => apiClient.patch(`/admin/roles/${selectedRole}/permissions`, { permissionCodes: rolePermissionDraft, reason: 'Матрица прав подтверждена в админке' }),
            })}
          >
            Сохранить матрицу
          </button>
        </div>
      </div>
      {rolePreview ? (
        <div className={`empty-state compact ${rolePreview.allowed ? '' : 'error-state'}`}>
          {previewSummary(rolePreview).join(' | ')}
        </div>
      ) : null}
      <div className="permission-toolbar">
        <label>
          <span>Поиск права</span>
          <input
            type="search"
            value={permissionSearch}
            placeholder="Например: заявки или просмотр"
            onChange={(event) => setPermissionSearch(event.target.value)}
          />
        </label>
        <div className="admin-inline-actions">
          <button className="secondary-button" type="button" disabled={!visiblePermissionCodes.length} onClick={selectVisiblePermissions}>Выбрать показанные</button>
          <button className="secondary-button" type="button" disabled={!visiblePermissionCodes.length} onClick={clearVisiblePermissions}>Очистить показанные</button>
        </div>
      </div>
      <div className="role-menu-preview" aria-label="Предпросмотр меню роли">
        <strong>Итоговое меню роли</strong>
        <span>Список строится по тем же правилам доступа, что и реальная навигация. Права на сервере остаются источником истины.</span>
        <div className="line-meta">
          {roleMenuPreview.map((screen) => <span className="tag" key={screen.code}>{screen.label}</span>)}
          {!roleMenuPreview.length ? <span className="tag warning">Нет доступных разделов</span> : null}
        </div>
      </div>
      <div className="permission-grid">
        {permissionGroups.map(([group, permissions]) => (
          <div className="permission-group" key={group}>
            <strong>{permissionGroupLabel(group)}</strong>
            {permissions.map((permission) => (
              <label className="permission-toggle human-readable" key={permission.id}>
                <input checked={rolePermissionDraft.includes(permission.code)} onChange={() => togglePermission(permission.code)} type="checkbox" />
                <span title={permission.code}>
                  <strong>{permissionLabel(permission.code)}</strong>
                  <small>{permissionDescription(permission)}</small>
                  {showAdvancedPermissions ? <code>{permission.code}</code> : null}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </section>
  );

  const renderDepartments = () => (
    <section className="card admin-card wide">
      <h3 className="admin-heading-with-help">
        Отделы и службы
        <HelpTooltip title="Локальный отдел и общая служба">
          Локальный отдел относится к выбранному заводу. Общая служба общая только как справочник, но сотрудники получают доступ к каждому заводу отдельно.
        </HelpTooltip>
      </h3>
        <p>Локальные отделы принадлежат выбранному заводу. Общие и технические службы подключаются через доступы к заводам, без автоматического глобального управленческого охвата.</p>
      <div className="admin-setup-panel" data-testid="admin-department-editor">
        <h4 className="admin-heading-with-help">
          {departmentEditId ? 'Изменить отдел или общую службу' : 'Создать отдел или общую службу'}
          <HelpTooltip title="Руководитель отдела">
            Руководитель задаётся через пользователя, его отдел, должность и право управлять сотрудниками. Название отдела само по себе не выдаёт руководящие права.
          </HelpTooltip>
        </h4>
        <div className="form-grid compact-grid">
          <label>Название
            <input value={departmentForm.name} onChange={(event) => setDepartmentForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например: Электрики" />
          </label>
          <label>Код
          <input value={departmentForm.code} onChange={(event) => setDepartmentForm((current) => ({ ...current, code: event.target.value }))} placeholder="электрики" />
          </label>
          <label>
            <AdminFieldLabel helpTitle="Тип отдела" helpText="Выберите локальный отдел для структуры конкретного завода или общую службу для единого справочника. Общая служба не открывает доступ ко всем заводам автоматически.">
              Тип
            </AdminFieldLabel>
            <select aria-label="Тип отдела" disabled={Boolean(departmentEditId)} value={departmentForm.scope} onChange={(event) => setDepartmentForm((current) => ({ ...current, scope: event.target.value }))}>
              <option value="LOCAL">Локальный отдел</option>
              <option value="GLOBAL">Общая служба</option>
            </select>
          </label>
        </div>
        <div className="admin-inline-actions">
          <button className="primary-button" disabled={busy || !departmentForm.name.trim()} type="button" onClick={() => void createDepartment()}>{departmentEditId ? 'Сохранить отдел' : 'Создать'}</button>
          {departmentEditId ? <button className="secondary-button" type="button" onClick={() => { setDepartmentEditId(''); setDepartmentForm({ name: '', code: '', scope: 'LOCAL' }); }}>Отмена</button> : null}
        </div>
      </div>
      <div className="dashboard-grid">
        <div>
          <h4>Отделы завода</h4>
          <div className="admin-list">
            {localDepartments.map((department) => (
              <article className={`admin-row ${department.isActive ? '' : 'dimmed'}`} key={department.id}>
                <strong>{department.name}</strong>
                <span>{department.code}</span>
                <span>Пользователи: {department.userCount}</span>
                <button className="secondary-button" type="button" disabled={busy || !department.isActive} onClick={() => {
                  setDepartmentEditId(department.id); setDepartmentForm({ name: department.name, code: department.code, scope: department.scope });
                  document.querySelector('[data-testid="admin-department-editor"]')?.scrollIntoView({ block: 'start' });
                }}>Изменить отдел</button>
                <button
                  className="secondary-button"
                  type="button"
                  title="Отключение не удаляет историю. Если есть активные связи, сервер применит безопасные ограничения."
                  onClick={() => setPendingAction({
                    title: department.isActive ? `Деактивировать ${department.name}` : `Восстановить ${department.name}`,
                    description: 'Отдел физически не удаляется. История и доступы сохраняются.',
                    consequences: [department.userCount ? `${department.userCount} доступов ссылаются на этот отдел.` : 'Активных доступов к отделу нет.', 'Действие пишется в аудит.'],
                    requireReason: department.isActive,
                    reasonPlaceholder: 'Например: отдел объединён с другой службой',
                    run: (reason) => apiClient.patch(`/admin/departments/${department.id}/status`, { isActive: !department.isActive, reason: reason ?? 'Обновление отдела' }),
                  })}
                >
                  {department.isActive ? 'Деактивировать' : 'Восстановить'}
                </button>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h4>Общие и технические службы</h4>
          <div className="admin-list">
            {pilotVisibleSharedDepartments.map((department) => (
              <article className={`admin-row ${department.isActive ? '' : 'dimmed'}`} key={department.id}>
                <strong>{department.name}</strong>
                <span>{department.code}</span>
                <span className="tag">Общая служба</span>
                <span>Доступы к выбранному заводу: {department.userCount}</span>
                <small>Не даёт автоматический доступ ко всем заводам. Доступ сотрудников задаётся через “Пользователи с доступом”.</small>
                <button className="secondary-button" type="button" disabled={busy || !department.isActive} onClick={() => {
                  setDepartmentEditId(department.id); setDepartmentForm({ name: department.name, code: department.code, scope: department.scope });
                  document.querySelector('[data-testid="admin-department-editor"]')?.scrollIntoView({ block: 'start' });
                }}>Изменить отдел</button>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setPendingAction({
                  title: `Деактивировать ${department.name}`, description: 'Общая служба отключается для всех связанных заводов. История сохраняется.',
                  consequences: ['Действие применяется к общему справочнику, а не только выбранному заводу.'], requireReason: true,
                  run: (reason) => apiClient.patch(`/admin/departments/${department.id}/status`, { isActive: false, reason }),
                })}>Деактивировать</button>
              </article>
            ))}
            {!pilotVisibleSharedDepartments.length ? <div className="empty-state compact">Общие службы пока не настроены. Создайте новый завод с типовыми службами или скопируйте структуру Завода 4.</div> : null}
          </div>
        </div>
      </div>
    </section>
  );

  const renderLines = () => (
    <section className="card admin-card wide">
      <h3>Линии и позиции</h3>
      <p>Производственная линия относится только к выбранному заводу. Отключение скрывает линию из рабочих экранов, но история смен, простоев и заявок сохраняется.</p>
      <p>Позиции и Шаблоны состава показаны внутри каждой линии, детальная настройка доступна в соседних разделах.</p>
      <div className="admin-setup-panel">
        <h4>Создать линию</h4>
        <div className="admin-help-strip">Линия — производственный участок. После создания добавьте позиции и шаблон состава, иначе мастер не сможет нормально назначать людей.</div>
        <div className="form-grid compact-grid">
          <label>Название линии
            <input value={lineForm.name} onChange={(event) => setLineForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например: Пицца Цезарь" />
          </label>
          <div className="admin-help-strip">Новая линия создаётся остановленной. Запустите её осознанно в разделе «Линии».</div>
        </div>
        <div className="admin-inline-actions">
          <button className="primary-button" disabled={busy || !lineForm.name.trim()} type="button" onClick={() => void createLine()}>Создать линию</button>
        </div>
      </div>
      <div className="admin-list">
        {(data?.lines ?? []).map((line) => (
          <article className={`admin-row admin-line-row ${line.deletedAt ? 'dimmed' : ''}`} key={line.id}>
            <div className="admin-line-summary">
              <div>
                <strong>{line.name}</strong>
                <span>{lineStatusLabels[line.status] ?? line.status}</span>
                <span>Позиции: {line.positions.filter((item) => item.isActive && !item.deletedAt).length} · Шаблоны: {line.staffingTemplates.filter((item) => item.isActive && !item.deletedAt).length}</span>
                <span className={`tag ${line.defaultStaffingTemplateId ? 'success' : 'warning'}`}>
                  {line.staffingTemplates.find((item) => item.id === line.defaultStaffingTemplateId)?.name
                    ? `Состав по умолчанию: ${line.staffingTemplates.find((item) => item.id === line.defaultStaffingTemplateId)?.name}`
                    : 'Состав не настроен'}
                </span>
              </div>
              <button
                className="primary-button"
                type="button"
                title="Открыть управление линией: название, позиции, шаблоны и безопасное отключение"
                onClick={() => {
                  setExpandedLineId((current) => (current === line.id ? '' : line.id));
                  setLineEditForm({ lineId: '', name: '' });
                }}
              >
                {expandedLineId === line.id ? 'Скрыть управление' : 'Управление'}
              </button>
            </div>
            {expandedLineId === line.id ? (
              <div className="admin-line-management">
                <div className="admin-help-strip">Здесь собраны действия по одной линии. Позиции и шаблоны можно открыть отдельно, а отключение не удаляет историю смен и заявок.</div>
                {lineEditForm.lineId === line.id ? (
                  <div className="admin-setup-panel compact">
                    <h4>Переименовать линию</h4>
                    <div className="form-grid compact-grid">
                      <label>Новое название
                        <input value={lineEditForm.name} onChange={(event) => setLineEditForm((current) => ({ ...current, name: event.target.value }))} />
                      </label>
                    </div>
                    <div className="admin-inline-actions">
                      <button className="primary-button" disabled={busy || !lineEditForm.name.trim()} type="button" onClick={() => void updateLineName()}>Сохранить название</button>
                      <button className="secondary-button" type="button" onClick={() => setLineEditForm({ lineId: '', name: '' })}>Отмена</button>
                    </div>
                  </div>
                ) : null}
                <div className="admin-management-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    title="Поменять только название линии"
                    onClick={() => setLineEditForm({ lineId: line.id, name: line.name })}
                  >
                    Переименовать
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    title="Открыть общий раздел настройки рабочих мест линии"
                    onClick={() => {
                      setPositionForm((current) => ({ ...current, lineId: line.id }));
                      openAdminSection('Позиции на линиях');
                    }}
                  >
                    Позиции линии
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    title="Открыть шаблоны состава для выбранной линии"
                    onClick={() => {
                      setTemplateForm({
                        templateId: '',
                        lineId: line.id,
                        name: '',
                        items: staffingTemplateDraftItems(line),
                      });
                      openAdminSection('Шаблоны состава');
                    }}
                  >
                    Шаблоны состава
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    title={line.deletedAt ? 'Вернуть линию в рабочие списки' : 'Скрыть линию из рабочих списков без удаления истории'}
                    onClick={() => setPendingAction({
                      title: line.deletedAt ? `Восстановить линию ${line.name}` : `Отключить линию ${line.name}`,
                      description: 'Линия физически не удаляется. История смен, простоев, заявок и назначений остаётся в системе.',
                      consequences: line.deletedAt
                        ? ['Линия снова появится в рабочих списках выбранного завода.']
                        : ['Новые смены не будут использовать эту линию, пока она отключена.'],
                      requireReason: !line.deletedAt,
                      reasonPlaceholder: 'Например: линия больше не используется',
                      run: (reason) => apiClient.patch(`/admin/lines/${line.id}`, { isActive: Boolean(line.deletedAt), reason: reason ?? 'Обновление линии' }),
                    })}
                  >
                    {line.deletedAt ? 'Восстановить линию' : 'Отключить линию'}
                  </button>
                </div>
                <div className="admin-nested-list">
                  <h4>Позиции</h4>
                  {line.positions.slice(0, 6).map((position) => (
                    <div className="admin-mini-row" key={position.id}>
                      <span>{position.displayName ?? position.name}</span>
                      <span className="tag" title={position.skillCode ?? 'Код навыка не задан'}>{position.skillCode ? 'Навык задан' : 'Навык не задан'}</span>
                    </div>
                  ))}
                  {line.positions.length > 6 ? <div className="empty-state compact">Ещё позиций: {line.positions.length - 6}</div> : null}
                  <h4>Шаблоны состава</h4>
                  {line.staffingTemplates.slice(0, 4).map((template) => (
                    <div className="admin-mini-row" key={template.id}>
                      <span>{template.name}</span>
                      <span className="tag">Позиции: {template.items.length}</span>
                      <span className={`tag ${template.isActive && !template.deletedAt ? 'success' : 'pause'}`}>{template.isActive && !template.deletedAt ? 'Активен' : 'Отключён'}</span>
                    </div>
                  ))}
                  {!line.staffingTemplates.length ? <div className="empty-state compact">Шаблон состава ещё не создан. Без него мастеру сложнее понять план по людям.</div> : null}
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );

  const renderLinePositions = () => {
    const selectedLine = (data?.lines ?? []).find((line) => line.id === positionForm.lineId) ?? data?.lines?.[0] ?? null;
    return (
      <section className="card admin-card wide">
        <h3>Позиции на линиях</h3>
        <p>Позиция определяет слот назначения и навык. Отключение позиции не удаляет старые назначения и навыки.</p>
        <div className="admin-setup-panel" data-testid="admin-position-editor">
          <h4>{positionEditId ? 'Изменить позицию' : 'Добавить позицию'}</h4>
          <div className="admin-help-strip">Позиция — конкретное рабочее место на линии. Код навыка помогает системе подсказать подходящего сотрудника.</div>
          <div className="form-grid compact-grid">
            <label>Линия
              <select aria-label="Линия позиции" disabled={Boolean(positionEditId)} value={positionForm.lineId || selectedLine?.id || ''} onChange={(event) => setPositionForm((current) => ({ ...current, lineId: event.target.value }))}>
                <option value="">Выберите линию</option>
                {(data?.lines ?? []).map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
              </select>
            </label>
            <label>Название
              <input value={positionForm.name} onChange={(event) => setPositionForm((current) => ({ ...current, name: event.target.value }))} placeholder="Например: Упаковщик" />
            </label>
            <label>Короткое имя
              <input value={positionForm.displayName} onChange={(event) => setPositionForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Упаковщик" />
            </label>
            <label>Код навыка
              <input value={positionForm.skillCode} onChange={(event) => setPositionForm((current) => ({ ...current, skillCode: event.target.value }))} placeholder="упаковка" />
            </label>
            <label>Порядок
              <input type="number" value={positionForm.sortOrder} onChange={(event) => setPositionForm((current) => ({ ...current, sortOrder: event.target.value }))} />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={positionForm.isExtraSlot}
                onChange={(event) => setPositionForm((current) => ({
                  ...current,
                  isExtraSlot: event.target.checked,
                  doesNotAffectShortage: event.target.checked || current.doesNotAffectShortage,
                }))}
              />
              Дополнительное место
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={positionForm.isFlexibleSkillGroup}
                onChange={(event) => setPositionForm((current) => ({ ...current, isFlexibleSkillGroup: event.target.checked }))}
              />
              Гибкая позиция
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={positionForm.doesNotAffectShortage}
                onChange={(event) => setPositionForm((current) => ({ ...current, doesNotAffectShortage: event.target.checked }))}
              />
              Не считать нехваткой
            </label>
          </div>
          <div className="admin-inline-actions">
            <button className="primary-button" disabled={busy || !(positionForm.lineId || selectedLine?.id) || !positionForm.name.trim()} type="button" onClick={() => void createPosition()}>{positionEditId ? 'Сохранить позицию' : 'Добавить позицию'}</button>
            {positionEditId ? <button className="secondary-button" type="button" onClick={() => { setPositionEditId(''); setPositionForm({ lineId: '', name: '', displayName: '', skillCode: '', sortOrder: '0', isExtraSlot: false, doesNotAffectShortage: false, isFlexibleSkillGroup: false }); }}>Отмена</button> : null}
          </div>
        </div>
        <div className="admin-list">
          {(data?.lines ?? []).map((line) => (
            <article className="admin-row admin-row-stack" key={line.id}>
              <strong>{line.name}</strong>
              <div className="admin-nested-list">
                {line.positions.map((position) => (
                  <div className={`admin-mini-row ${position.isActive && !position.deletedAt ? '' : 'dimmed'}`} key={position.id}>
                    <span>{position.displayName ?? position.name}</span>
                    <span className="tag" title={position.skillCode ?? 'Код навыка не задан'}>{position.skillCode ? 'Навык задан' : 'Навык не задан'}</span>
                    <span className="tag">Порядок: {position.sortOrder}</span>
                    {position.isExtraSlot ? <span className="tag">Дополнительно</span> : null}
                    <button className="secondary-button" type="button" disabled={busy || !position.isActive} onClick={() => {
                      setPositionEditId(position.id);
                      setPositionForm({ lineId: line.id, name: position.name, displayName: position.displayName ?? '', skillCode: position.skillCode ?? '', sortOrder: String(position.sortOrder), isExtraSlot: Boolean(position.isExtraSlot), doesNotAffectShortage: Boolean(position.doesNotAffectShortage), isFlexibleSkillGroup: Boolean(position.isFlexibleSkillGroup) });
                      document.querySelector('[data-testid="admin-position-editor"]')?.scrollIntoView({ block: 'start' });
                    }}>Изменить позицию</button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setPendingAction({
                        title: position.isActive ? `Отключить позицию ${position.displayName ?? position.name}` : `Восстановить позицию ${position.displayName ?? position.name}`,
                        description: 'Позиция физически не удаляется. Старые назначения и навыки сохраняются.',
                        consequences: ['Новые шаблоны и смены будут учитывать новый статус позиции.'],
                        requireReason: position.isActive,
                        reasonPlaceholder: 'Например: позиция перенесена на другой участок',
                        run: (reason) => apiClient.patch(`/admin/lines/${line.id}/positions/${position.id}`, { isActive: !position.isActive, reason: reason ?? 'Обновление позиции' }),
                      })}
                    >
                      {position.isActive ? 'Отключить' : 'Восстановить'}
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  };

  const renderTemplates = (lines: LineConfigRow[] = data?.lines ?? []) => {
    const selectedLine = lines.find((line) => line.id === templateForm.lineId) ?? null;
    const selectedTotal = templateForm.items
      .filter((item) => item.included)
      .reduce((sum, item) => sum + Math.max(0, Number(item.defaultPlanned) || 0), 0);
    return (
      <section className="card admin-card wide">
      <h3>Шаблоны состава</h3>
      <p>Шаблон хранит минимальное, максимальное, типовое и плановое количество, гибкие слоты и дополнительные места. Фактическое назначение людей остаётся в сменном дашборде.</p>
      <div className="admin-setup-panel">
        <h4>{templateForm.templateId ? 'Изменить шаблон состава' : 'Создать шаблон состава'}</h4>
        <div className="admin-help-strip">Выберите все нужные позиции и задайте порядок, минимум, план и максимум. Диапазон 0–1 означает необязательное место.</div>
        <div className="form-grid compact-grid">
          <label>Линия
            <select
              id="admin-template-line"
              value={templateForm.lineId}
              disabled={Boolean(templateForm.templateId)}
              onChange={(event) => {
                const line = (data?.lines ?? []).find((item) => item.id === event.target.value) ?? null;
                setTemplateForm({ templateId: '', lineId: event.target.value, name: '', items: staffingTemplateDraftItems(line) });
              }}
            >
              <option value="">Выберите линию</option>
              {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
            </select>
          </label>
          <label>Название шаблона
            <input id="admin-template-name" value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} placeholder="Утверждённый состав" />
          </label>
        </div>
        {selectedLine ? (
          <div className="admin-template-builder" data-testid="admin-template-builder">
            <div className="admin-template-builder-head">
              <span>Позиция</span>
              <span>Мин.</span>
              <span>План</span>
              <span>Макс.</span>
            </div>
            {templateForm.items.map((item, index) => (
              <div className={`admin-template-builder-row ${item.included ? 'selected' : ''}`} data-testid={`admin-template-row-${item.positionId}`} key={item.positionId}>
                <label className="checkbox-field admin-template-position">
                  <input
                    aria-label={`Включить ${item.positionName}`}
                    type="checkbox"
                    checked={item.included}
                    onChange={(event) => setTemplateForm((current) => ({
                      ...current,
                      items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, included: event.target.checked } : entry),
                    }))}
                  />
                  <span>{item.positionName}</span>
                  {item.isExtraSlot ? <span className="tag">Дополнительно</span> : null}
                </label>
                {(['minRequired', 'defaultPlanned', 'maxRequired'] as const).map((field) => (
                  <input
                    aria-label={`${field === 'minRequired' ? 'Минимум' : field === 'defaultPlanned' ? 'План' : 'Максимум'} ${item.positionName}`}
                    disabled={!item.included}
                    key={field}
                    min="0"
                    type="number"
                    value={item[field]}
                    onChange={(event) => setTemplateForm((current) => ({
                      ...current,
                      items: current.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: event.target.value } : entry),
                    }))}
                  />
                ))}
              </div>
            ))}
            <div className="admin-template-builder-total" data-testid="admin-template-total">
              <span>Итого по плану</span>
              <strong>{selectedTotal} чел.</strong>
            </div>
          </div>
        ) : <div className="empty-state compact">Сначала выберите линию.</div>}
        <div className="admin-inline-actions">
          <button
            className="primary-button"
            disabled={busy || !templateForm.lineId || !templateForm.name.trim() || !templateForm.items.some((item) => item.included)}
            type="button"
            onClick={() => void saveTemplate()}
          >
            {templateForm.templateId ? 'Сохранить шаблон' : 'Создать шаблон'}
          </button>
          {templateForm.templateId ? (
            <button className="secondary-button" type="button" onClick={() => setTemplateForm({ templateId: '', lineId: '', name: '', items: [] })}>Отмена</button>
          ) : null}
        </div>
      </div>
      <div className="admin-list">
        {lines.flatMap((line) => line.staffingTemplates.map((template) => ({ line, template }))).map(({ line, template }) => {
          const total = template.items.reduce((sum, item) => sum + Number(item.defaultPlanned ?? item.plannedCount ?? item.requiredCount ?? 0), 0);
          const isDefault = line.defaultStaffingTemplateId === template.id;
          return (
          <article className={`admin-row ${template.isActive && !template.deletedAt ? '' : 'dimmed'}`} key={template.id}>
            <strong>{template.name}</strong>
            <span>{line.name}</span>
            <span>Позиции: {template.items.length} · Люди: {total}</span>
            <span className={`tag ${isDefault ? 'success' : 'pause'}`}>{isDefault ? 'Основной состав' : 'Доступный шаблон'}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setTemplateForm({
                templateId: template.id,
                lineId: line.id,
                name: template.name,
                items: staffingTemplateDraftItems(line, template),
              })}
            >
              Редактировать шаблон
            </button>
            <button className="secondary-button" type="button" onClick={() => duplicateTemplate(line, template)}>
              Дублировать
            </button>
            {!isDefault ? (
              <button className="success-button" type="button" disabled={busy} onClick={() => void makeTemplateDefault(line, template)}>
                Сделать основным
              </button>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              onClick={() => setPendingAction({
                title: template.isActive ? `Отключить шаблон ${template.name}` : `Восстановить шаблон ${template.name}`,
                description: 'Шаблон физически не удаляется. Новые смены используют актуальные активные шаблоны.',
                consequences: ['Старые назначения и архив смен остаются без изменений.'],
                requireReason: template.isActive,
                reasonPlaceholder: 'Например: шаблон заменён новым составом',
                run: (reason) => apiClient.patch(`/admin/lines/${line.id}/staffing-templates/${template.id}`, { isActive: !template.isActive, reason: reason ?? 'Обновление шаблона' }),
              })}
            >
              {template.isActive ? 'Отключить' : 'Восстановить'}
            </button>
            <div className="admin-nested-list">
              {template.items.slice(0, 5).map((item) => (
                <div className="admin-mini-row" key={item.id}>
                  <span>{item.positionName ?? item.positionId}</span>
                  <span className="tag">План: {item.plannedCount ?? item.defaultPlanned ?? item.requiredCount}</span>
                  <span className="tag">Диапазон: {item.minRequired ?? item.requiredCount}-{item.maxRequired ?? item.requiredCount}</span>
                  {item.isExtraSlot ? <span className="tag">Дополнительно</span> : null}
                </div>
              ))}
            </div>
          </article>
          );
        })}
        {!lines.length ? <div className="empty-state compact">Для выбранного завода нет доступных производственных линий.</div> : null}
      </div>
      </section>
    );
  };

  const renderWorkAreas = () => (
    <section className="card admin-card wide">
      <h3>Повременщики / рабочие зоны</h3>
      <p>Рабочие зоны не являются производственными линиями и не меняют статус линии. Назначения идут только для работников и наёмных работников через смену.</p>
      <div className="admin-setup-panel">
        <h4>Создать рабочую зону</h4>
        <div className="admin-help-strip">Рабочая зона — это повременщики или подсобная работа. Она не запускается как линия и не меняет статус производства.</div>
        <div className="form-grid compact-grid">
          <label>Название
            <input value={workAreaForm.name} onChange={(event) => setWorkAreaForm((current) => ({ ...current, name: event.target.value }))} placeholder="Разбор коробов" />
          </label>
          <label>Отдел
            <select value={workAreaForm.departmentId} onChange={(event) => setWorkAreaForm((current) => ({ ...current, departmentId: event.target.value }))}>
              <option value="">Без отдела</option>
              {localDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
          <label>Тип назначения
            <select value={workAreaForm.assignmentKind} onChange={(event) => setWorkAreaForm((current) => ({ ...current, assignmentKind: event.target.value as 'WORK_AREA' | 'TIME' }))}>
              <option value="WORK_AREA">Рабочая зона</option>
              <option value="TIME">Повременщики</option>
            </select>
          </label>
          <label>Описание
            <input value={workAreaForm.description} onChange={(event) => setWorkAreaForm((current) => ({ ...current, description: event.target.value }))} placeholder="Для повременщиков и подсобных работ" />
          </label>
        </div>
        <div className="admin-inline-actions">
          <button className="primary-button" disabled={busy || !workAreaForm.name.trim()} type="button" onClick={() => void createWorkArea()}>Создать рабочую зону</button>
        </div>
      </div>
      <div className="admin-setup-panel">
        <h4>Добавить позицию рабочей зоны</h4>
        <div className="form-grid compact-grid">
          <label>Рабочая зона
            <select value={workAreaPositionForm.workAreaId} onChange={(event) => setWorkAreaPositionForm((current) => ({ ...current, workAreaId: event.target.value }))}>
              <option value="">Выберите зону</option>
              {(data?.workAreas ?? []).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </label>
          <label>Позиция
            <input value={workAreaPositionForm.title} onChange={(event) => setWorkAreaPositionForm((current) => ({ ...current, title: event.target.value }))} placeholder="Грузчик" />
          </label>
          <label>Минимум
            <input type="number" value={workAreaPositionForm.minRequired} onChange={(event) => setWorkAreaPositionForm((current) => ({ ...current, minRequired: event.target.value }))} />
          </label>
          <label>План
            <input type="number" value={workAreaPositionForm.defaultPlanned} onChange={(event) => setWorkAreaPositionForm((current) => ({ ...current, defaultPlanned: event.target.value }))} />
          </label>
          <label>Максимум
            <input type="number" value={workAreaPositionForm.maxRequired} onChange={(event) => setWorkAreaPositionForm((current) => ({ ...current, maxRequired: event.target.value }))} />
          </label>
        </div>
        <div className="admin-inline-actions">
          <button className="primary-button" disabled={busy || !workAreaPositionForm.workAreaId || !workAreaPositionForm.title.trim()} type="button" onClick={() => void createWorkAreaPosition()}>Добавить позицию</button>
        </div>
      </div>
      <div className="admin-list">
        {(data?.workAreas ?? []).map((area) => (
          <article className={`admin-row ${area.isActive === false ? 'dimmed' : ''}`} key={area.id}>
            <strong>{area.name}</strong>
            <span>Позиции: {area.positions.length}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setPendingAction({
                title: area.isActive === false ? `Восстановить зону ${area.name}` : `Отключить зону ${area.name}`,
                description: 'Рабочая зона физически не удаляется и не смешивается с производственными линиями.',
                consequences: ['История назначений сохраняется.'],
                requireReason: area.isActive !== false,
                reasonPlaceholder: 'Например: зона больше не используется в смене',
                run: (reason) => apiClient.patch(`/admin/work-areas/${area.id}`, { isActive: area.isActive === false, reason: reason ?? 'Обновление рабочей зоны' }),
              })}
            >
              {area.isActive === false ? 'Восстановить' : 'Отключить'}
            </button>
            <div className="admin-nested-list">
              {area.positions.map((position) => (
                <div className={`admin-mini-row ${position.isActive === false ? 'dimmed' : ''}`} key={position.id}>
                  <span>{position.title}</span>
                  <span className="tag">Диапазон: {position.minRequired}-{position.maxRequired}</span>
                  <span className="tag">План: {position.plannedCount ?? position.defaultPlanned}</span>
                  {position.isExtraSlot ? <span className="tag">Дополнительно</span> : null}
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setPendingAction({
                      title: position.isActive === false ? `Восстановить позицию ${position.title}` : `Отключить позицию ${position.title}`,
                      description: 'Позиция рабочей зоны физически не удаляется.',
                      consequences: ['Старые назначения остаются в истории.'],
                      requireReason: position.isActive !== false,
                      reasonPlaceholder: 'Например: слот больше не нужен в этой зоне',
                      run: (reason) => apiClient.patch(`/admin/work-areas/${area.id}/positions/${position.id}`, { isActive: position.isActive === false, reason: reason ?? 'Обновление позиции рабочей зоны' }),
                    })}
                  >
                    {position.isActive === false ? 'Восстановить' : 'Отключить'}
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
        {!(data?.workAreas ?? []).length ? <div className="empty-state">Рабочие зоны пока не настроены для выбранного завода.</div> : null}
      </div>
    </section>
  );

  const renderSkills = () => (
    <section className="card admin-card wide">
      <h3>Навыки</h3>
      <p>Навык = линия + позиция, а похожесть считается по названию позиции и коду навыка. Управление навыками сотрудника остаётся в разделе “Люди”.</p>
      <div className="line-meta">
        <span className="tag">0 смен: Нет опыта</span>
        <span className="tag">1-9 смен: Есть опыт</span>
        <span className="tag">10+ смен: Опытный</span>
        <span className="tag">Рекомендован руководителем</span>
      </div>
    </section>
  );

  const renderSettings = () => (
    <section className="card admin-card wide">
      <h3>Настройки модулей</h3>
      <p>Настройки для: {factoryContext?.factory.name ?? selectedFactory?.name ?? 'выбранный завод'}. Если настройка общая или ещё не создана, это явно отмечено в карточке.</p>
      <div className="settings-grid">
        {MODULE_SETTINGS.map((item) => (
          <article className="settings-card" key={item.key} data-testid={`admin-settings-${item.key}`}>
            <h4>{item.title}</h4>
            <span className="tag">{factoryContext?.factory.name ?? selectedFactory?.name}</span>
            <div className="form-grid compact-grid">
              {Object.entries(settingPayload(data?.settings[item.key])).map(([key, original]) => {
                const value = settingDrafts[item.key] && key in settingDrafts[item.key] ? settingDrafts[item.key][key] : original;
                const readOnly = settingReadOnlyReason(item.key, key);
                const change = (next: unknown) => setSettingDrafts((current) => ({
                  ...current, [item.key]: { ...current[item.key], [key]: next },
                }));
                return <label key={key}>
                  <span>{settingLabel(key)}</span>
                  {readOnly ? <><span>{settingValue(original)}</span><small>{readOnly}</small></>
                    : typeof original === 'boolean' ? <input type="checkbox" checked={Boolean(value)} onChange={(event) => change(event.target.checked)} />
                    : <input type={typeof original === 'number' || key === 'longTaskDefaultDeadlineHours' ? 'number' : 'text'}
                        value={value === null ? '' : String(value ?? '')}
                        onChange={(event) => change(typeof original === 'number' || key === 'longTaskDefaultDeadlineHours'
                          ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value)} />}
                </label>;
              })}
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !data?.settings[item.key]}
              onClick={() => void confirmWithPreview(
                item.preview,
                { ...Object.fromEntries(Object.entries(settingDrafts[item.key] ?? {}).filter(([key]) => !settingReadOnlyReason(item.key, key))), reason: 'Настройка модуля через админку' },
                `Сохранить настройки: ${item.title}`,
                'Изменения применятся только к выбранному заводу. Проверьте значения и предупреждения перед сохранением.',
                () => apiClient.patch(item.update, { ...Object.fromEntries(Object.entries(settingDrafts[item.key] ?? {}).filter(([key]) => !settingReadOnlyReason(item.key, key))), reason: 'Настройка модуля через админку' }),
                'НАСТРОЙКИ',
              )}
            >
              Проверить и сохранить
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => setSettingDrafts((current) => ({ ...current, [item.key]: settingPayload(data?.settings[item.key]) }))}>Отменить изменения</button>
          </article>
        ))}
        <article className="settings-card">
          <h4>Уведомления</h4>
          <p>Текущий центр уведомлений работает без отдельной сложной матрицы предпочтений. Расширение настроек запланировано отдельно.</p>
          <span className="tag">Будет расширено позже</span>
        </article>
      </div>
    </section>
  );

  const renderAudit = () => (
    <section className="card admin-card wide">
      <h3>Аудит изменений</h3>
      <p>Опасные действия пишутся в журнал аудита: права, доступы, блокировки, сброс пароля, заводы, отделы, линии, позиции, шаблоны и настройки. Ниже показан контекст выбранного завода.</p>
      <div className="line-meta">
        <span className="tag">Без секретов</span>
        <span className="tag">Без хэшей паролей</span>
        <span className="tag">Без путей хранения файлов</span>
        <span className="tag">ACCESS_DENIED остаётся диагностическим кодом</span>
      </div>
      <div className="admin-list">
        {(factoryContext?.recentAudit ?? []).map((item) => (
          <article className="admin-row" key={item.id}>
            <strong>{adminAuditActionLabel(item.action)}</strong>
            <span>{item.entityType}</span>
            <span>{item.actorName}</span>
            <span>{new Date(item.createdAt).toLocaleString('ru-RU')}</span>
            <div className="admin-nested-list">
              {item.detailsSummary.map((detail) => <span className="tag" key={detail}>{detail}</span>)}
            </div>
          </article>
        ))}
        {!(factoryContext?.recentAudit ?? []).length ? <div className="empty-state compact">Для выбранного завода пока нет последних изменений админки.</div> : null}
      </div>
    </section>
  );

  const renderRecovery = () => {
    const items = data?.recovery?.items ?? [];
    return (
      <section className="card admin-card wide recovery-center">
        <div className="line-title-row">
          <div>
            <h3>Центр восстановления</h3>
            <p>Здесь находятся отключённые объекты выбранного завода. Они не удаляются физически: история смен, заявок, аудита и вложений остаётся на месте.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load(selectedFactoryId)}>Обновить</button>
        </div>
        <div className="factory-context-overview">
          <span className="tag">Выбран завод: {factoryContext?.factory.name ?? selectedFactory?.name ?? 'не выбран'}</span>
          <span className="tag">В восстановлении: {data?.recovery?.total ?? 0}</span>
          <span className={`tag ${(data?.recovery?.expiringSoon ?? 0) ? 'stop' : 'success'}`}>Скоро истекает: {data?.recovery?.expiringSoon ?? 0}</span>
          <span className="tag">Окно восстановления: 30 дней</span>
        </div>
        <div className="admin-help-strip">
          Для отключения важной настройки администратор указывает причину. Эта причина видна здесь и записывается в аудит. Восстановление возвращает объект в рабочие списки без удаления истории.
        </div>
        <div className="admin-help-strip">
          Обычный режим скрывает диагностические и битые записи. Они не удалены: причина видна в разделе “Диагностика данных”.
        </div>
        <div className="admin-list recovery-list">
          {items.map((item) => (
            <article className={`admin-row recovery-row ${item.daysLeft !== null && item.daysLeft <= 3 ? 'recovery-warning' : ''}`} key={`${item.type}:${item.id}`}>
              <div>
                <strong>{diagnosticDisplayText(item.title, item.typeLabel)}</strong>
                <span>{item.typeLabel}</span>
              </div>
              <span>{diagnosticDisplayText(item.factoryName ?? factoryContext?.factory.name ?? selectedFactory?.name, 'Завод не указан')}</span>
              <span>{diagnosticDisplayText(item.departmentName ?? item.parentName, 'Без подразделения')}</span>
              <span>Отключил: {item.deactivatedByName}</span>
              <span>{item.deactivatedAt ? new Date(item.deactivatedAt).toLocaleString('ru-RU') : 'Дата не указана'}</span>
              <div className="admin-nested-list">
                <span className="tag">Причина: {diagnosticDisplayText(item.reason, 'Причина не указана')}</span>
                <span className={`tag ${item.daysLeft !== null && item.daysLeft <= 3 ? 'stop' : ''}`}>
                  {item.daysLeft === null ? 'Срок восстановления не указан' : `Осталось дней: ${Math.max(item.daysLeft, 0)}`}
                </span>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() => setPendingAction({
                  title: `Восстановить: ${diagnosticDisplayText(item.title, item.typeLabel)}`,
                  description: 'Объект снова появится в рабочих списках выбранного завода. История не удалялась и будет сохранена.',
                  consequences: [
                    `Тип: ${item.typeLabel}`,
                    `Причина отключения: ${diagnosticDisplayText(item.reason, 'Причина не указана')}`,
                    'Действие пишется в аудит.',
                  ],
                  confirmLabel: 'Восстановить',
                  run: (reason) => apiClient.post(`/admin/recovery/${item.type}/${item.id}/restore`, { reason: reason ?? 'Восстановление через Центр восстановления' }),
                })}
              >
                Восстановить
              </button>
            </article>
          ))}
          {!items.length ? (
            <div className="empty-state compact">
              В выбранном заводе нет отключённых объектов для восстановления. Если объект отключат с причиной, он появится здесь.
            </div>
          ) : null}
        </div>
        {(data?.diagnosticRecovery?.total ?? 0) > 0 ? (
          <div className="admin-help-strip">
            В диагностическом восстановлении есть записи: {data?.diagnosticRecovery?.total ?? 0}. Они скрыты из обычного списка, чтобы не мешать рабочему интерфейсу.
            <button className="secondary-button" type="button" onClick={() => openAdminSection('Диагностика данных')}>
              Открыть диагностику
            </button>
          </div>
        ) : null}
      </section>
    );
  };

  const renderDataHygiene = () => {
    const summary = data?.dataHygieneSummary;
    const records = data?.dataHygieneRecords?.records ?? [];
    const diagnosticRecoveryItems = data?.diagnosticRecovery?.items ?? [];
    return (
      <section className="card admin-card wide recovery-center">
        <div className="line-title-row">
          <div>
            <h3>Диагностика данных</h3>
            <p>Здесь видны диагностические записи, битые названия, грязные остатки и неполные конфигурации. Проверка ничего не удаляет физически: обычные рабочие списки очищены фильтрами, а проблемные записи остаются доступными для разбора.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load(selectedFactoryId)}>Обновить</button>
        </div>
        <div className="factory-context-overview">
          <span className="tag">Выбран завод: {factoryContext?.factory.name ?? selectedFactory?.name ?? 'не выбран'}</span>
          <span className="tag">Всего в диагностике: {summary?.total ?? 0}</span>
          <span className="tag">Без удаления истории</span>
          <span className="tag">Только администратор</span>
        </div>
        <div className="settings-grid">
          {(summary?.groups ?? []).map((group) => (
            <article className="settings-card" key={group.group}>
              <h4>{group.label}</h4>
              <strong>{group.count}</strong>
              <p>{group.count ? 'Записи вынесены из обычного рабочего интерфейса и доступны для диагностики.' : 'Проблем не найдено.'}</p>
            </article>
          ))}
        </div>
        <div className="admin-help-strip">
          Предварительная проверка показывает, что будет скрыто из обычных списков. Автоматическое исправление, переименование и физическая очистка не выполняются.
        </div>
        {diagnosticRecoveryItems.length ? (
          <>
            <div className="line-title-row">
              <div>
                <h4>Отключённые записи в диагностике</h4>
                <p>Их можно восстановить вручную без удаления истории. В обычный Центр восстановления они не попадают, чтобы не мешать рабочему списку.</p>
              </div>
              <span className="tag">Записей: {diagnosticRecoveryItems.length}</span>
            </div>
            <div className="admin-list recovery-list">
              {diagnosticRecoveryItems.map((item) => (
                <article className="admin-row recovery-row diagnostic-recovery-row" key={`diagnostic:${item.type}:${item.id}`}>
                  <div>
                    <strong>{diagnosticDisplayText(item.title, item.typeLabel)}</strong>
                    <span>{item.typeLabel}</span>
                  </div>
                  <span>{diagnosticDisplayText(item.factoryName ?? factoryContext?.factory.name ?? selectedFactory?.name, 'Завод не указан')}</span>
                  <span>{diagnosticDisplayText(item.departmentName ?? item.parentName, 'Без подразделения')}</span>
                  <span>Причина отключения: {diagnosticDisplayText(item.reason, 'Причина не указана')}</span>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setPendingAction({
                      title: `Восстановить: ${diagnosticDisplayText(item.title, item.typeLabel)}`,
                      description: 'Запись вернётся в рабочую конфигурацию выбранного завода. История и связи сохранятся.',
                      consequences: [
                        `Тип: ${item.typeLabel}`,
                        ...(item.diagnosticReasons ?? []),
                        'Действие сохранится в аудите.',
                      ],
                      confirmLabel: 'Восстановить',
                      run: (reason) => apiClient.post(`/admin/recovery/${item.type}/${item.id}/restore`, {
                        reason: reason ?? 'Ручное восстановление из диагностики данных',
                      }),
                    })}
                  >
                    Восстановить
                  </button>
                </article>
              ))}
            </div>
          </>
        ) : null}
        <div className="admin-list recovery-list">
          {records.map((record) => (
            <article className="admin-row recovery-row" key={`${record.type}:${record.id}:${record.group}`}>
              <div>
                <strong>{diagnosticDisplayText(record.title, record.typeLabel)}</strong>
                <span>{record.typeLabel}</span>
              </div>
              <span>{record.groupLabel}</span>
              <span>{record.source}</span>
              <span>{record.whereFound}</span>
              <div className="admin-nested-list">
                {record.reasons.map((reason) => <span className="tag" key={reason}>{reason}</span>)}
                {record.hiddenFromRuntime ? <span className="tag success">Скрыто из обычного списка</span> : null}
              </div>
              <button className="secondary-button" type="button" onClick={() => openAdminSection('Восстановление')}>
                Оставить как есть
              </button>
            </article>
          ))}
          {!records.length ? <div className="empty-state compact">Для выбранного завода проблемные записи не найдены.</div> : null}
        </div>
      </section>
    );
  };

  const renderSection = () => {
    if (section === 'Обзор') return renderAdminOverview();
    if (section === 'Заводы') return renderFactoryBuilder();
    if (section === 'Пользователи и доступы') return renderUsers();
    if (section === 'Отделы и службы') return renderDepartments();
    if (section === 'Должности и роли') return renderJobTitles();
    if (section === 'Линии и позиции') return renderLines();
    if (section === 'Позиции на линиях') return renderLinePositions();
    if (section === 'Шаблоны состава') return renderTemplates();
    if (section === 'Повременщики / рабочие зоны') return renderWorkAreas();
    if (section === 'Роли и права') return renderRoles();
    if (section === 'Настройки модулей') return renderSettings();
    if (section === 'Восстановление') return renderRecovery();
    if (section === 'Диагностика данных') return renderDataHygiene();
    return renderAudit();
  };

  return (
    <section className="screen-panel admin-screen">
      <PremiumSectionHeader
        title="Администрирование"
        subtitle="Центр управления заводами, пользователями, ролями, правами, отделами, службами, линиями, позициями, шаблонами, рабочими зонами и настройками."
      />

      {loading ? <div className="empty-state">Загрузка настроек...</div> : null}
      {errorText ? (
        <div className="empty-state error-state">
          {errorText}
          <button className="secondary-button" type="button" onClick={() => void load(selectedFactoryId)}>Повторить</button>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="metric-grid premium-kpi-strip" data-count="4">
            <div className="metric-card"><div className="metric-label">Заводы</div><div className="metric-value">{data.overview.factoriesCount}</div></div>
            <div className="metric-card"><div className="metric-label">Активные заводы</div><div className="metric-value">{data.overview.activeFactories}</div></div>
            <div className="metric-card"><div className="metric-label">Пользователи</div><div className="metric-value">{data.overview.usersCount}</div></div>
            <div className="metric-card"><div className="metric-label">Линии</div><div className="metric-value">{data.overview.linesCount}</div></div>
          </div>
          <div className="line-meta admin-overview-secondary-counts">
            <span className="tag">Позиции: {data.overview.positionsCount}</span>
            <span className="tag">Шаблоны: {data.overview.staffingTemplatesCount}</span>
          </div>

          <section className="card admin-card wide">
            <h3>Предупреждения конфигурации</h3>
            <div className="line-meta">
              <span className="tag">Без доступа: {data.overview.warnings.usersWithoutFactoryAccess}</span>
              <span className="tag">Без отдела: {data.overview.warnings.usersWithoutDepartment}</span>
              <span className="tag">Линии без позиций: {data.overview.warnings.linesWithoutActivePositions}</span>
              <span className="tag">Линии без шаблонов: {data.overview.warnings.linesWithoutStaffingTemplates}</span>
              <span className="tag">Роли без прав: {data.overview.warnings.rolesWithoutPermissions.length}</span>
            </div>
          </section>

          <div className="admin-task-nav" aria-label="Разделы администрирования">
            {ADMIN_NAV_GROUPS.map((group) => (
              <section className="admin-task-nav-group" key={group.title}>
                <div>
                  <strong>{group.title}</strong>
                  <span>{group.hint}</span>
                </div>
                <div className="admin-section-nav compact">
                  {group.sections.map((item) => (
                    <button className={`secondary-button ${section === item ? 'active' : ''}`} type="button" key={item} onClick={() => openAdminSection(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {renderSection()}
        </>
      ) : delegationContext || staffingContext?.allowed ? (
        <>
          <section className="card admin-card wide scoped-admin-summary" data-testid="scoped-admin-control-plane">
            <div className="line-title-row">
              <div>
                <h3>Управление в пределах своих полномочий</h3>
                <p>Полная админка скрыта. Доступны только подтверждённые иерархией действия выбранного завода.</p>
              </div>
              <span className="tag">Завод: {staffingContext?.factory.name ?? delegationContext?.factory.name}</span>
            </div>
            {staffingContext?.allowed ? (
              <div className="admin-help-strip" data-testid="staffing-authority-basis">
                Шаблоны состава доступны по формальной иерархии должностей{staffingContext.jobTitleName ? `: ${staffingContext.jobTitleName}` : ''}.
              </div>
            ) : null}
          </section>
          {staffingContext?.allowed ? renderTemplates(staffingContext.lines) : null}
          {delegationContext ? (
            <section className="card admin-card wide">
              <h3>Пользователи и доступы своего отдела</h3>
              {renderPermissionDelegationPanel()}
            </section>
          ) : null}
        </>
      ) : null}

      <PremiumSheet open={Boolean(passwordRecovery)} title="Временный код создан" onClose={() => setPasswordRecovery(null)}>
        {passwordRecovery ? <div className="onboarding-status-card">
          <p>Передайте код сотруднику «{passwordRecovery.displayName}» только после проверки личности. После закрытия он больше не отображается.</p>
          <strong>Временный код</strong>
          <code data-testid="password-recovery-credential">{passwordRecovery.recoveryCredential}</code>
          <p>Действует до {new Date(passwordRecovery.recoveryExpiresAt).toLocaleString('ru-RU')}. Введите код вместо пароля при входе, затем задайте личный пароль.</p>
          <button type="button" className="primary-button" onClick={() => setPasswordRecovery(null)}>Код передан</button>
        </div> : null}
      </PremiumSheet>
      {pendingAction ? (
        <AdminConfirmDialog
          title={pendingAction.title}
          description={pendingAction.description}
          consequences={pendingAction.consequences}
          confirmLabel={pendingAction.confirmLabel}
          requireText={pendingAction.requireText}
          requireReason={pendingAction.requireReason}
          reasonLabel={pendingAction.reasonLabel}
          reasonPlaceholder={pendingAction.reasonPlaceholder}
          busy={busy}
          error={errorText}
          onCancel={() => setPendingAction(null)}
          onConfirm={(reason) => void runAction(reason)}
        />
      ) : null}
    </section>
  );
}

function russianCount(value: number, one: string, few: string, many: string) {
  const absolute = Math.abs(value);
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${value} ${word}`;
}
