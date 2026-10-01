import { expect, Locator, Page, Route, test } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const phase = process.env.THEME_EVIDENCE_PHASE === 'before' ? 'before' : 'after';
const batch = process.env.THEME_EVIDENCE_BATCH || `20260913-three-themes-${phase}-${Date.now()}`;
const uniqueScope = process.env.THEME_UNIQUE_SCOPE || 'all';
const correctionBatch = process.env.THEME_CORRECTION_BATCH || '';
const correctionPhase = process.env.THEME_CORRECTION_PHASE === 'before' ? 'before' : 'after';
const correctionPart = process.env.THEME_CORRECTION_PART || 'all';
const evidenceRoot = correctionBatch
  ? path.resolve(__dirname, '../../docs/theme-switching/corrections', correctionBatch, 'screenshots', `${correctionPhase}-${correctionPart}`)
  : path.resolve(__dirname, '../../docs/theme-switching/screenshots', batch);
const runtimePath = path.join(evidenceRoot, 'runtime.json');
const indexPath = path.join(evidenceRoot, 'index.csv');
const widths = [1440, 360, 390, 430] as const;
const coverageWidths = [1440, 390] as const;
const coverageThemes = ['gray', 'light'] as const;
const topLevelScreens = [
  ['Shift', 'Смена', 'shift'],
  ['ShiftHistory', 'История смен', 'shift-history'],
  ['People', 'Люди', 'people'],
  ['Admin', 'Администрирование', 'admin'],
  ['Situation', 'Линии', 'situation'],
  ['Tasks', 'Заявки', 'tasks'],
  ['Wash', 'Мойка', 'wash'],
  ['OKK', 'ОКК', 'okk'],
  ['Stock', 'Некондиция', 'stock'],
  ['Orders', 'Заказы / Остатки', 'orders'],
  ['Checklists', 'Чек-листы', 'checklists'],
  ['Defrost', 'Оттайка', 'defrost'],
  ['Returns', 'Возвраты на производство', 'returns'],
  ['Log', 'Пересменка', 'shift-log'],
  ['Chats', 'Чаты', 'chats'],
  ['Announcements', 'Объявления', 'announcements'],
  ['Archive', 'Архив', 'archive'],
  ['Notifications', 'Уведомления', 'notifications'],
  ['Ops', 'Статистика / Аудит', 'ops'],
  ['Report', 'Сообщить об ошибке', 'report'],
] as const;
const adminSections = [
  'Обзор', 'Заводы', 'Пользователи и доступы', 'Отделы и службы', 'Должности и роли',
  'Линии и позиции', 'Позиции на линиях', 'Шаблоны состава', 'Повременщики / рабочие зоны',
  'Роли и права', 'Настройки модулей', 'Восстановление', 'Диагностика данных', 'Аудит действий админки',
] as const;
const archiveSections = [
  ['tasks', 'Заявки и простои'], ['checklists', 'Чек-листы'], ['okk', 'ОКК'],
  ['returns', 'Возвраты на производство'], ['stock', 'Некондиция'], ['orders', 'Заказы / Остатки'],
  ['wash', 'Мойка'], ['defrost', 'Оттайка'], ['shiftLog', 'Пересменка / Журнал'],
  ['announcements', 'Объявления'], ['attachments', 'Файлы и вложения'],
] as const;
const opsTabs = ['Потери', 'Обзор', 'События', 'Аудит', 'Модули'] as const;
const permissions = [
  'shift.self.read', 'shift.current.read', 'shift.future.read', 'assignments.manage',
  'people.profile.read', 'people.read', 'admin.overview.read', 'admin.users.read',
  'admin.roles.read', 'admin.factories.read', 'admin.departments.read', 'admin.lines.read',
  'admin.read', 'config.read', 'lines.read', 'tasks.read', 'wash.read', 'okk.read',
  'stock.read', 'orders.read', 'checklists.templates.read', 'checklists.runs.self',
  'checklists.runs.read', 'returns.publication.read', 'shift-log.read', 'shift-log.archive.read',
  'defrost.read', 'chats.read', 'announcements.read', 'announcements.archive.read',
  'notifications.read', 'ops.overview.read', 'ops.events.read', 'ops.audit.read',
  'ops.statistics.read',
];

type Runtime = {
  phase: string;
  batch: string;
  screenshots: Array<Record<string, unknown>>;
  apiReads: string[];
  apiWrites: Array<{ method: string; path: string }>;
  pageErrors: string[];
  consoleErrors: string[];
  requestFailures: Array<{ url: string; error: string }>;
  isolatedFixtureWrites: Array<{ method: string; path: string }>;
  computedStyles: Array<Record<string, unknown>>;
  visibilityChecks: Array<Record<string, unknown>>;
};

const runtime: Runtime = {
  phase: correctionBatch ? correctionPhase : phase,
  batch: correctionBatch || batch,
  screenshots: [],
  apiReads: [],
  apiWrites: [],
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  isolatedFixtureWrites: [],
  computedStyles: [],
  visibilityChecks: [],
};

const productStyleFingerprint = crypto.createHash('sha256')
  .update(fs.readFileSync(path.resolve(__dirname, '../src/styles.css')))
  .digest('hex');
const harnessFingerprint = crypto.createHash('sha256')
  .update(fs.readFileSync(__filename))
  .digest('hex');

type IsolatedIdentity = 'admin' | 'anonymous' | 'factory-picker' | 'guest';
type IsolatedOptions = {
  identity?: IsolatedIdentity;
  authDelayMs?: number;
  allowForcedPasswordFixture?: boolean;
  checklistState?: 'filled' | 'empty' | 'error';
};

function viewportName(width: number) {
  return width === 1440 ? 'desktop' : String(width);
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

const checklistRowFixture = {
  id: 'theme-checklist-row-temperature',
  templateRowId: 'theme-checklist-template-row-temperature',
  title: 'Температура продукта',
  description: 'Проверьте температуру перед передачей смены.',
  sortOrder: 0,
  rowType: 'NUMBER',
  requiredAnswer: true,
  status: 'PENDING',
  requiresPhoto: false,
  requiresComment: false,
  isRequired: true,
  unit: '°C',
  minValue: 2,
  maxValue: 6,
};

const checklistTemplateFixture = {
  id: 'theme-checklist-template-temperature',
  scope: 'LINE',
  departmentId: 'theme-evidence-department',
  departmentName: 'Производство',
  departmentLabel: 'Производство',
  lineId: 'theme-evidence-line',
  lineName: 'Линия фасовки № 1',
  name: 'Контроль температуры линии',
  description: 'Заполненное контрольное состояние темы.',
  isActive: true,
  assignmentRoles: ['ADMIN'],
  assignmentUserIds: [],
  shiftType: 'DAY',
  shiftLabel: 'Дневная смена',
  frequencyRule: 'ONCE_PER_SHIFT',
  frequencyLabel: 'Раз за смену',
  assignmentLabel: 'Линия фасовки № 1',
  isMandatory: true,
  availability: { alreadyTaken: true, duplicateBlocked: true, currentRun: { id: 'theme-checklist-run-active', status: 'ACTIVE' } },
  rows: [{ ...checklistRowFixture, id: 'theme-checklist-template-row-temperature' }],
};

const checklistAvailableTemplateFixture = {
  ...checklistTemplateFixture,
  id: 'theme-checklist-template-sanitation',
  name: 'Проверка санитарного состояния',
  description: 'Доступный чек-лист для новой проверки.',
  availability: { alreadyTaken: false, duplicateBlocked: false, currentRun: null },
  rows: [{
    ...checklistRowFixture,
    id: 'theme-checklist-template-row-sanitation',
    title: 'Рабочая поверхность очищена',
    rowType: 'YES_NO',
    unit: null,
    minValue: null,
    maxValue: null,
  }],
};

const checklistActiveRunFixture = {
  id: 'theme-checklist-run-active',
  userId: 'theme-evidence-user',
  status: 'ACTIVE',
  startedAt: '2026-09-14T05:15:00.000Z',
  nextCheckAt: null,
  shiftEndsAt: '2026-09-14T17:00:00.000Z',
  frequencyRule: 'ONCE_PER_SHIFT',
  frequencyLabel: 'Раз за смену',
  template: {
    id: checklistTemplateFixture.id,
    name: checklistTemplateFixture.name,
    description: checklistTemplateFixture.description,
    departmentId: checklistTemplateFixture.departmentId,
    departmentName: checklistTemplateFixture.departmentName,
    departmentLabel: checklistTemplateFixture.departmentLabel,
    frequencyRule: checklistTemplateFixture.frequencyRule,
  },
  departmentName: 'Производство',
  departmentLabel: 'Производство',
  lineId: 'theme-evidence-line',
  lineName: 'Линия фасовки № 1',
  lineLabel: 'Линия фасовки № 1',
  shiftDate: '2026-09-14',
  shiftType: 'DAY',
  shiftLabel: 'Дневная смена',
  rows: [checklistRowFixture],
  currentCheck: { id: 'theme-checklist-check-active', sequence: 1, status: 'ACTIVE', dueAt: null, rows: [checklistRowFixture] },
  checks: [{ id: 'theme-checklist-check-active', sequence: 1, status: 'ACTIVE', dueAt: null, rows: [checklistRowFixture] }],
  attachments: [],
  pauseEvents: [],
  executorName: 'Тест оформления',
  completion: { total: 1, done: 0, missingRequired: 1, percent: 0 },
};

const checklistClosedRunFixture = {
  ...checklistActiveRunFixture,
  id: 'theme-checklist-run-closed',
  status: 'CLOSED',
  startedAt: '2026-09-13T05:15:00.000Z',
  closedAt: '2026-09-13T05:25:00.000Z',
  rows: [{ ...checklistRowFixture, status: 'OK', answerNumber: 4 }],
  currentCheck: null,
  checks: [{ id: 'theme-checklist-check-closed', sequence: 1, status: 'COMPLETED', completedAt: '2026-09-13T05:25:00.000Z' }],
  completion: { total: 1, done: 1, missingRequired: 0, percent: 100 },
};

function checklistArchiveTableFixture() {
  return {
    template: checklistTemplateFixture,
    columns: [{ id: 'theme-checklist-template-row-temperature', title: 'Температура продукта', rowType: 'NUMBER', unit: '°C' }],
    rows: [{
      id: 'theme-checklist-run-closed',
      date: '13.09.2026',
      time: '08:25',
      shiftLabel: 'Дневная смена',
      statusLabel: 'Завершён',
      userName: 'Тест оформления',
      lineName: 'Линия фасовки № 1',
      values: {
        'theme-checklist-template-row-temperature': {
          title: 'Температура продукта', value: '4 °C', status: 'OK', comment: null, attachments: [],
        },
      },
    }],
  };
}

async function installIsolatedAppState(page: Page, initialTheme: string | null = null, options: IsolatedOptions = {}) {
  const identity = options.identity ?? 'admin';
  const checklistState = options.checklistState ?? 'empty';
  await page.addInitScript(({ permissions: grantedPermissions, initialTheme: selectedTheme, identity: selectedIdentity }) => {
    const harnessSessionKey = 'zavod.theme-evidence.initialized';
    if (!window.sessionStorage.getItem(harnessSessionKey)) {
      window.localStorage.clear();
      window.sessionStorage.clear();
      if (selectedTheme) window.localStorage.setItem('zavod.appearanceTheme', selectedTheme);
      window.sessionStorage.setItem(harnessSessionKey, '1');
    }
    if (selectedIdentity !== 'anonymous') {
      const userId = selectedIdentity === 'guest' ? 'theme-evidence-guest' : 'theme-evidence-user';
      window.localStorage.setItem('zavod.authToken', 'theme-evidence-token');
      window.localStorage.setItem('zavod.devUserId', userId);
      if (selectedIdentity !== 'factory-picker') window.localStorage.setItem('zavod.selectedFactoryId', 'theme-evidence-factory');
      window.localStorage.setItem(
        `zavod.quick-nav.${userId}.theme-evidence-factory`,
        JSON.stringify(['Report', 'Situation', 'Tasks', 'Checklists']),
      );
    }
    Object.defineProperty(window, '__themeEvidence', {
      configurable: true,
      value: { permissions: grantedPermissions, firstFrameTheme: null },
    });
    const evidence = (window as Window & { __themeEvidence: { firstFrameTheme: string | null } }).__themeEvidence;
    requestAnimationFrame(() => {
      evidence.firstFrameTheme = document.documentElement.dataset.theme || 'dark';
    });
  }, { permissions, initialTheme, identity });

  await page.route('http://127.0.0.1:5173/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.replace(/^\/api/, '');
    if (request.method() !== 'GET') {
      if (options.allowForcedPasswordFixture && request.method() === 'POST' && apiPath === '/auth/login') {
        runtime.isolatedFixtureWrites.push({ method: request.method(), path: apiPath });
        await json(route, {
          userId: 'theme-evidence-password-user', availableFactories: [], recommendedFactoryId: null,
          requiresPasswordChange: true, setupToken: 'isolated-theme-setup-token',
        });
        return;
      }
      runtime.apiWrites.push({ method: request.method(), path: apiPath });
      await json(route, { message: 'Изолированный theme harness блокирует запись.' }, 409);
      return;
    }
    runtime.apiReads.push(apiPath);
    if (apiPath === '/auth/me') {
      if (options.authDelayMs) await new Promise((resolve) => setTimeout(resolve, options.authDelayMs));
      const isGuest = identity === 'guest';
      await json(route, {
        userId: isGuest ? 'theme-evidence-guest' : 'theme-evidence-user',
        selectedFactoryId: identity === 'factory-picker' ? '' : 'theme-evidence-factory',
        role: isGuest ? 'GUEST' : 'ADMIN', departmentId: isGuest ? null : 'theme-evidence-department',
        companyId: null, permissions: isGuest ? [] : permissions, isAdmin: !isGuest, isGuest,
        displayName: isGuest ? 'Гость оформления' : 'Тест оформления',
        jobTitleName: isGuest ? null : 'Администратор', departmentName: isGuest ? null : 'Производство', companyName: null,
        availableFactories: [{
          id: 'theme-evidence-factory', name: 'Завод оформления', code: 'THEME',
          role: isGuest ? 'GUEST' : 'ADMIN', departmentId: isGuest ? null : 'theme-evidence-department',
          departmentName: isGuest ? null : 'Производство', isGuest,
        }],
      });
      return;
    }
    if (apiPath === '/auth/assignment-request') {
      await json(route, { status: 'WAITING_ASSIGNMENT', request: null, options: { assignments: [] } });
      return;
    }
    if (apiPath === '/notifications/push/status') {
      await json(route, { available: false, publicKey: null, reason: 'Недоступно в изолированной проверке.', activeSubscriptions: 0 });
      return;
    }
    if (apiPath === '/notifications/unread-count') { await json(route, { count: 3 }); return; }
    if (apiPath === '/announcements/current') { await json(route, { total: 0, current: null, items: [] }); return; }
    if (apiPath === '/people') { await json(route, { people: [], groups: {} }); return; }
    if (apiPath.startsWith('/tasks/board')) { await json(route, { NEW: [], IN_PROGRESS: [], LONG: [], DONE: [] }); return; }
    if (apiPath === '/admin/overview') {
      await json(route, {
        factoriesCount: 1, activeFactories: 1, usersCount: 0, blockedUsersCount: 0,
        departmentsCount: 0, rolesCount: 0, permissionsCount: permissions.length,
        linesCount: 0, positionsCount: 0, staffingTemplatesCount: 0,
        selectedFactoryId: 'theme-evidence-factory',
        warnings: {
          usersWithoutFactoryAccess: 0, usersWithoutDepartment: 0, linesWithoutActivePositions: 0,
          linesWithoutStaffingTemplates: 0, rolesWithoutPermissions: [], departmentsWithoutManagementUsers: [],
        },
      });
      return;
    }
    if (apiPath === '/admin/factories/setup/options') {
      await json(route, { sourceFactories: [], defaults: { categories: [] } });
      return;
    }
    if (/^\/admin\/roles\/[^/]+\/permissions$/.test(apiPath)) { await json(route, { permissionCodes: [] }); return; }
    if (
      apiPath === '/admin/shift-settings' || apiPath === '/admin/task-settings' ||
      apiPath === '/admin/wash-settings' || apiPath === '/checklists/settings' ||
      apiPath === '/orders/settings' || apiPath === '/admin/defrost-settings' ||
      apiPath === '/admin/chat-settings' || apiPath === '/admin/announcement-settings'
    ) { await json(route, {}); return; }
    if (
      apiPath.startsWith('/admin/users') || apiPath === '/admin/factories' ||
      apiPath.startsWith('/admin/departments') || apiPath === '/admin/roles' ||
      apiPath === '/admin/permissions' || apiPath.startsWith('/admin/lines-config') ||
      apiPath.startsWith('/admin/work-areas') || apiPath.startsWith('/admin/job-titles') ||
      apiPath.startsWith('/admin/assignment-requests') || apiPath.startsWith('/admin/external-companies')
    ) { await json(route, []); return; }
    if (apiPath === '/admin/staffing-control/context') { await json(route, { allowed: false }); return; }
    if (apiPath.startsWith('/admin/permission-delegation/context')) { await json(route, {}, 404); return; }
    if (
      /^\/admin\/factories\/[^/]+\/(context|config-health)$/.test(apiPath) ||
      apiPath === '/admin/recovery' || apiPath === '/admin/data-hygiene/summary' ||
      apiPath === '/admin/data-hygiene/records' || apiPath === '/admin/organization-identity-report'
    ) { await json(route, {}, 404); return; }
    if (apiPath === '/orders/summary') { await json(route, { belowThreshold: 0, criticalItems: 0, activeRequests: 0, itemsCount: 0 }); return; }
    if (apiPath.startsWith('/checklists/templates/library')) {
      await json(route, checklistState === 'filled' ? [checklistTemplateFixture] : []);
      return;
    }
    if (apiPath.startsWith('/checklists/archive/by-template')) {
      await json(route, checklistState === 'filled'
        ? checklistArchiveTableFixture()
        : { template: null, columns: [], rows: [] });
      return;
    }
    if (apiPath.startsWith('/checklists/archive/template/')) {
      const matrix = checklistState === 'filled'
        ? checklistArchiveTableFixture()
        : { template: null, columns: [], rows: [] };
      await json(route, { template: matrix.template, groups: [], runs: [], matrix });
      return;
    }
    if (apiPath.startsWith('/checklists/archive')) {
      await json(route, checklistState === 'filled'
        ? { runs: [checklistClosedRunFixture], templates: [checklistTemplateFixture] }
        : { runs: [], templates: [] });
      return;
    }
    if (apiPath.startsWith('/checklists/workspace')) {
      if (checklistState === 'error') {
        await json(route, { message: 'Не удалось загрузить чек-листы для контрольной проверки.' }, 503);
        return;
      }
      await json(route, {
        generatedAt: '2026-09-14T09:00:00.000Z',
        shift: { shiftDate: '2026-09-14', shiftType: 'DAY', startsAt: '2026-09-14T05:00:00.000Z', endsAt: '2026-09-14T17:00:00.000Z' },
        activeRuns: checklistState === 'filled' ? [checklistActiveRunFixture] : [],
        completedRuns: checklistState === 'filled' ? [checklistClosedRunFixture] : [],
        available: checklistState === 'filled' ? [checklistAvailableTemplateFixture] : [],
        manager: {
          summary: checklistState === 'filled'
            ? { inProgress: 1, dueSoon: 0, overdue: 0, paused: 0, completed: 1, autoClosed: 0, notTaken: 1 }
            : { inProgress: 0, dueSoon: 0, overdue: 0, paused: 0, completed: 0, autoClosed: 0, notTaken: 0 },
          runs: checklistState === 'filled' ? [checklistActiveRunFixture] : [],
        },
      });
      return;
    }
    if (apiPath === '/shift/timeline') {
      await json(route, {
        current: { shiftDate: '2026-09-13', targetShiftDate: '2026-09-13', shiftType: 'DAY', label: 'Дневная смена 13 сентября' },
        next: { shiftDate: '2026-09-13', targetShiftDate: '2026-09-13', shiftType: 'NIGHT', label: 'Ночная смена 13 сентября' },
        future: [], past: [],
      });
      return;
    }
    if (apiPath === '/health') { await json(route, { timestamp: '2026-09-13T09:00:00.000Z' }); return; }
    if (apiPath === '/shift-log/handover/previous' || apiPath === '/shift-log/handover/summary') { await json(route, null); return; }
    if (apiPath === '/shift-log/handover/availability') { await json(route, { available: false }); return; }
    if (apiPath === '/archive/options') {
      await json(route, {
        sections: [
          ['tasks', 'Заявки и простои'], ['checklists', 'Чек-листы'], ['okk', 'ОКК'],
          ['returns', 'Возвраты на производство'], ['stock', 'Некондиция'], ['orders', 'Заказы / Остатки'],
          ['wash', 'Мойка'], ['defrost', 'Оттайка'], ['shiftLog', 'Пересменка / Журнал'],
          ['announcements', 'Объявления'], ['attachments', 'Файлы и вложения'],
        ].map(([key, label]) => ({ key, label, description: 'Изолированная визуальная проверка темы.' })),
        departments: [], lines: [], checklistTemplates: [],
      });
      return;
    }
    if (apiPath === '/archive/downtime/options') { await json(route, { lines: [], departments: [], assignees: [], reasons: [] }); return; }
    if (apiPath.startsWith('/archive/items')) { await json(route, { items: [], page: 1, pageSize: 24, total: 0, hasMore: false, metrics: null }); return; }
    if (apiPath.startsWith('/archive/attachments')) { await json(route, { items: [], page: 1, pageSize: 24, total: 0, hasMore: false }); return; }
    if (apiPath.startsWith('/ops/operations/overview')) {
      await json(route, {
        generatedAt: '2026-09-13T09:00:00.000Z', period: { label: '7 дней', days: 7, capped: false, asOf: '2026-09-13' },
        summary: {
          totalLostMinutes: 0, totalLostLabel: '0 мин', downtimeCount: 0, averageDowntimeMinutes: null,
          medianDowntimeMinutes: null, p90DowntimeMinutes: null, openDowntimeCount: 0, preliminary: false,
          worstLine: null, urgentOpenTasks: 0, overdueLongTasks: 0, tasksTotal: 0, tasksOpen: 0,
          tasksCompleted: 0, averageResponseMinutes: null, medianResponseMinutes: null, p90ResponseMinutes: null,
          maxResponseMinutes: null, averageExecutionMinutes: null, medianExecutionMinutes: null,
          p90ExecutionMinutes: null, maxExecutionMinutes: null, averageResolutionMinutes: null,
          medianResolutionMinutes: null, p90ResolutionMinutes: null,
          tenMinuteDailyEffect: { yearlyLabel: '0 ч', text: 'Нет потерь времени в изолированном состоянии.' },
        },
        weakSpots: [], lineEvents: { stop: 0, pause: 0, work: 0, downtimeLinkedTasks: 0 },
        quality: { okkDefects: 0, stockDefects: 0, stockDefectQuantity: 0, returns: 0 },
        checklists: { started: 0, active: 0, runsCompleted: 0, checksCompleted: 0, checksOverdue: 0, manuallyClosed: 0, shiftClosed: 0 },
        wash: { active: 0, completed: 0, issues: 0, openIssues: 0, miniTasks: 0, miniTasksDone: 0 },
        lines: [], downtimeReasons: [], downtimes: [], tasks: [], departments: [], repeatedProblems: [],
        dataQuality: { status: 'OK', warnings: [] }, limitations: [],
        filterOptions: { lines: [], departments: [], taskScopes: [] },
      });
      return;
    }
    if (apiPath.startsWith('/ops/overview')) {
      await json(route, {
        activeTasksCount: 0, overdueLongTasksCount: 0, activeWashCount: 0, washIssuesCount: 0,
        activeDefrostCount: 0, lowStockItemsCount: 0, openOrderRequestsCount: 0,
        activeImportantShiftLogsCount: 0, unreadNotificationsCount: 0, checklistAutoClosedCount: 0,
        recentAccessDeniedCount: 0,
      });
      return;
    }
    if (apiPath.startsWith('/ops/events') || apiPath.startsWith('/ops/audit') || apiPath.startsWith('/ops/module-summary')) { await json(route, []); return; }
    if (apiPath === '/chats' || apiPath === '/error-reports' || apiPath.startsWith('/tasks')) { await json(route, []); return; }
    await json(route, []);
  });
}

async function capture(page: Page, name: string, extra: Record<string, unknown> = {}, fullPage = false) {
  const file = `${name}.png`;
  const target = path.join(evidenceRoot, file);
  await page.screenshot({ path: target, fullPage, animations: 'disabled' });
  const geometry = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme || 'dark',
    width: innerWidth,
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    textColor: getComputedStyle(document.body).color,
  }));
  runtime.screenshots.push({
    file,
    capturedAt: new Date().toISOString(),
    productStyleFingerprint,
    harnessFingerprint,
    ...geometry,
    ...extra,
  });
  expect(geometry.overflowX).toBeLessThanOrEqual(4);
}

async function recordLocatorComputedStyle(
  locator: Locator,
  selectorLabel: string,
  caseId: string,
  extra: Record<string, unknown> = {},
) {
  await expect(locator).toBeVisible();
  const style = await locator.evaluate((element, selectorValue) => {
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const control = element as HTMLButtonElement | HTMLInputElement;
    return {
      selector: selectorValue,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      borderColor: computed.borderColor,
      opacity: computed.opacity,
      disabled: 'disabled' in control ? Boolean(control.disabled) : null,
      ariaPressed: element.getAttribute('aria-pressed'),
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }, selectorLabel);
  runtime.computedStyles.push({ caseId, ...extra, ...style });
  return style;
}

async function recordComputedStyle(
  page: Page,
  selector: string,
  caseId: string,
  extra: Record<string, unknown> = {},
) {
  const locator = page.locator(selector).filter({ visible: true }).first();
  await expect(locator).toBeVisible();
  const style = await locator.evaluate((element, selectorValue) => {
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const control = element as HTMLButtonElement | HTMLInputElement;
    return {
      selector: selectorValue,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      borderColor: computed.borderColor,
      opacity: computed.opacity,
      disabled: 'disabled' in control ? Boolean(control.disabled) : null,
      ariaPressed: element.getAttribute('aria-pressed'),
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }, selector);
  runtime.computedStyles.push({ caseId, ...extra, ...style });
  return style;
}

async function recordTargetVisibility(
  page: Page,
  locator: Locator,
  caseId: string,
  extra: Record<string, unknown> = {},
  scrollMethod: 'none' | 'scrollIntoView-center' = 'none',
) {
  await expect(locator).toBeVisible();
  if (scrollMethod === 'scrollIntoView-center') {
    await locator.evaluate((element) => element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' }));
    await page.waitForTimeout(80);
  }
  const visibility = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    let clipLeft = 0;
    let clipTop = 0;
    let clipRight = innerWidth;
    let clipBottom = innerHeight;
    const clippingAncestors: Array<Record<string, unknown>> = [];
    let ancestor = element.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
      const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
      if (clipsX || clipsY) {
        const ancestorRect = ancestor.getBoundingClientRect();
        if (clipsX) {
          clipLeft = Math.max(clipLeft, ancestorRect.left);
          clipRight = Math.min(clipRight, ancestorRect.right);
        }
        if (clipsY) {
          clipTop = Math.max(clipTop, ancestorRect.top);
          clipBottom = Math.min(clipBottom, ancestorRect.bottom);
        }
        clippingAncestors.push({
          tag: ancestor.tagName,
          className: ancestor.className,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          scrollLeft: ancestor.scrollLeft,
          scrollTop: ancestor.scrollTop,
          rect: { x: ancestorRect.x, y: ancestorRect.y, width: ancestorRect.width, height: ancestorRect.height },
        });
      }
      ancestor = ancestor.parentElement;
    }
    const epsilon = 1;
    const fullyInsideClip = rect.left >= clipLeft - epsilon
      && rect.top >= clipTop - epsilon
      && rect.right <= clipRight + epsilon
      && rect.bottom <= clipBottom + epsilon;
    const insetX = Math.min(6, Math.max(1, rect.width / 8));
    const insetY = Math.min(6, Math.max(1, rect.height / 8));
    const points = [
      [rect.left + insetX, rect.top + insetY],
      [rect.right - insetX, rect.top + insetY],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + insetX, rect.bottom - insetY],
      [rect.right - insetX, rect.bottom - insetY],
    ].map(([x, y]) => {
      const topElement = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
        ? document.elementFromPoint(x, y)
        : null;
      return {
        x,
        y,
        topTag: topElement?.tagName ?? null,
        topClass: topElement instanceof HTMLElement ? topElement.className : null,
        targetOwnsHit: Boolean(topElement && (topElement === element || element.contains(topElement))),
      };
    });
    const hitTestClear = points.every((point) => point.targetOwnsHit);
    return {
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      effectiveClip: { left: clipLeft, top: clipTop, right: clipRight, bottom: clipBottom },
      clippingAncestors,
      fullyInsideClip,
      hitTestClear,
      fullyVisible: fullyInsideClip && hitTestClear && rect.width > 0 && rect.height > 0,
      points,
    };
  });
  const record = { caseId, scrollMethod, ...extra, ...visibility };
  runtime.visibilityChecks.push(record);
  return record;
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function correctionCombinations() {
  const result: Array<{ width: typeof widths[number]; theme: 'dark' | 'gray' | 'light' }> = [];
  for (const width of widths) {
    for (const theme of ['gray', 'light'] as const) result.push({ width, theme });
    if (correctionPhase === 'after' && (width === 1440 || width === 390)) result.push({ width, theme: 'dark' });
  }
  return result;
}

function tc14LabelCombinations() {
  const result: Array<{ width: typeof widths[number]; theme: 'dark' | 'gray' | 'light' }> = [];
  for (const width of widths) {
    for (const theme of ['gray', 'light'] as const) result.push({ width, theme });
    if (width === 1440 || width === 390) result.push({ width, theme: 'dark' });
  }
  return result;
}

function correctionPartEnabled(part: string) {
  return Boolean(correctionBatch)
    && (correctionPart === 'all' || correctionPart === part || correctionPart.startsWith(`${part}-`));
}

async function navigateToScreen(page: Page, screen: string, heading?: string) {
  await page.evaluate((nextScreen) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } }));
  }, screen);
  if (heading) {
    await expect(page.getByRole('heading', { name: heading, exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  }
}

async function openWithTheme(page: Page, theme: 'dark' | 'gray' | 'light') {
  await page.goto('/manifest.webmanifest');
  await page.evaluate((selectedTheme) => localStorage.setItem('zavod.appearanceTheme', selectedTheme), theme);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

function galleryHtml(theme = 'dark', overlay = false) {
  return `<!doctype html><html lang="ru" data-theme="${theme}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <script type="module">import '/src/styles.css';</script></head><body>
    <main class="app-shell theme-evidence-gallery">
      <header class="topbar"><div class="brand"><span class="brand-mark"></span><div class="brand-copy"><h1 class="brand-name">Завод оформления</h1><p class="brand-subtitle">Проверка общей палитры</p></div></div><div class="status-pill"><span class="status-dot"></span>Онлайн</div></header>
      <section class="screen-panel"><div class="screen-heading"><span class="eyebrow">Рабочая поверхность</span><h2>Смена и показатели</h2><p>Основной, вторичный и приглушённый русский текст.</p></div>
        <div class="dashboard-grid">
          <article class="section-card"><div class="section-subhead"><span>01</span><div><strong>Карточка и вложенная поверхность</strong><p>Граница, тень и иерархия остаются различимыми.</p></div></div><div class="line-card"><strong>Линия фасовки № 12</strong><p class="line-meta">План 1 250 · факт 984 · осталось 266</p><div class="button-row"><button class="action-button">Продолжить</button><button class="secondary-button">Подробнее</button><button class="danger-button">Остановить</button></div></div></article>
          <article class="section-card"><div class="kpi-grid"><div class="kpi-card"><span>В работе</span><strong>18</strong></div><div class="kpi-card success"><span>Готово</span><strong>42</strong></div><div class="kpi-card warning"><span>Внимание</span><strong>3</strong></div></div><div class="status-row"><span class="tag">Обычный</span><span class="tag status-success">Работает</span><span class="tag status-warning">Ожидает</span><span class="tag status-danger">Остановлено</span></div></article>
        </div>
        <article class="section-card"><div class="screen-heading compact"><h3>Форма и системные элементы</h3><p>Placeholder, focus, disabled, selected и validation.</p></div><div class="form-grid">
          <label class="field-label">Название<input value="Длинная русская подпись производственного участка" aria-label="Название"></label>
          <label class="field-label">Подразделение<select aria-label="Подразделение"><option>Производство и упаковка</option></select></label>
          <label class="field-label">Дата<input type="date" value="2026-09-13" aria-label="Дата"></label>
          <label class="field-label">Поиск<input placeholder="Введите фамилию или участок" aria-label="Поиск"></label>
          <label class="field-label">Файл<input type="file" aria-label="Файл"></label>
          <label class="checkbox-row"><input type="checkbox" checked> Выбранный пункт с длинной подписью</label>
          <button class="secondary-button" disabled>Недоступное действие</button>
        </div><div class="empty-state success-state"><strong>Изменения сохранены</strong><p>Положительное состояние не стало золотым.</p></div><div class="empty-state error-state"><strong>Не удалось сохранить</strong><p>Опасное состояние остаётся красным и читаемым.</p></div></article>
        <article class="section-card"><div class="screen-heading compact"><h3>Таблица, чат и календарь</h3></div><div class="table-scroll"><table><thead><tr><th>Сотрудник</th><th>Состояние</th><th>Результат</th></tr></thead><tbody><tr><td>Александрова Мария</td><td>На линии</td><td>Выполнено</td></tr><tr><td>Петров Алексей</td><td>Перерыв</td><td>Ожидает</td></tr></tbody></table></div><div class="messenger-message-list"><div class="chat-message own"><strong>Мастер смены</strong><p>Проверьте температуру перед передачей.</p></div><div class="chat-message"><strong>Оператор</strong><p>Проверено, замечаний нет.</p></div></div></article>
      </section>
      <nav class="bottom-nav"><button class="nav-button active"><span>Смена</span></button><button class="nav-button"><span>Линии</span></button><button class="nav-button"><span>Заявки</span></button><button class="nav-button"><span>Настройки</span></button></nav>
    </main>${overlay ? '<div class="modal-backdrop"><section class="modal-card" role="dialog"><div class="modal-header"><div><span class="eyebrow">Подтверждение</span><h3>Сохранить изменение?</h3></div></div><div class="modal-body"><p>Проверьте выбранное значение и комментарий.</p><label class="field-label">Комментарий<textarea>Причина изменения указана полностью.</textarea></label><div class="button-row"><button class="secondary-button">Отмена</button><button class="action-button">Сохранить</button></div></div></section></div>' : ''}
    </body></html>`;
}

test.beforeAll(() => fs.mkdirSync(evidenceRoot, { recursive: true }));
test.beforeEach(async ({ page }) => {
  if (!correctionBatch) return;
  page.on('console', (message) => {
    if (message.type() === 'error') runtime.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    runtime.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'UNKNOWN' });
  });
});
test.afterAll(() => {
  fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
  if (!correctionBatch) return;
  const columns = [
    'file', 'sha256', 'bytes', 'theme', 'width', 'state', 'role', 'capturedAt',
    'productStyleFingerprint', 'harnessFingerprint', 'oldReviewId', 'sourceRelativePath',
    'visibilityStatus', 'scrollMethod', 'correctionPhase', 'correctionPart',
  ];
  const lines = [columns.map(csvCell).join(',')];
  for (const screenshot of runtime.screenshots) {
    const file = String(screenshot.file ?? '');
    const filePath = path.join(evidenceRoot, file);
    const bytes = fs.readFileSync(filePath);
    const row = {
      ...screenshot,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      correctionPhase,
      correctionPart,
    };
    lines.push(columns.map((column) => csvCell(row[column as keyof typeof row])).join(','));
  }
  fs.writeFileSync(indexPath, `${lines.join('\n')}\n`, 'utf8');
});

test('Dark baseline before theme implementation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'before');
  test.setTimeout(180_000);
  page.on('pageerror', (error) => runtime.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtime.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    runtime.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'UNKNOWN' });
  });
  await installIsolatedAppState(page);
  await page.route('**/__theme-gallery**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml('dark', url.searchParams.get('overlay') === '1') });
  });

  for (const width of widths) {
    const viewport = viewportName(width);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Report' } })));
    await expect(page.getByRole('heading', { name: 'Сообщить об ошибке', exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    await capture(page, `${viewport}-dark-before-settings`, { state: 'settings' });
    await page.locator('.mobile-sheet-backdrop').evaluate((element) => (element as HTMLElement).click());
    await page.getByLabel('Тема').fill('Не открывается заявка после смены завода');
    await page.getByLabel('Описание').fill('Поля и нижние действия должны сохранять прежнюю геометрию и контраст.');
    await page.locator('.bug-report-card').scrollIntoViewIfNeeded();
    await capture(page, `${viewport}-dark-before-form`, { state: 'real-report-form' }, true);

    await page.goto('/__theme-gallery');
    await expect(page.getByRole('heading', { name: 'Смена и показатели' })).toBeVisible();
    await capture(page, `${viewport}-dark-before-gallery`, { state: 'shared-components' }, true);
    await page.goto('/__theme-gallery?overlay=1');
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, `${viewport}-dark-before-overlay`, { state: 'modal' });
  }
  expect(runtime.apiWrites).toEqual([]);
  expect(runtime.pageErrors).toEqual([]);
});

test('Theme behavior is immediate, local and independent from app lifecycle', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'after');
  test.setTimeout(180_000);
  let productSockets = 0;
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/ws') productSockets += 1;
  });
  page.on('pageerror', (error) => runtime.pageErrors.push(error.message));
  await installIsolatedAppState(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Report' } })));
  await expect(page.getByRole('heading', { name: 'Сообщить об ошибке', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  const settings = page.getByRole('region', { name: 'Настройки' });
  await expect(settings).toBeVisible();
  await settings.locator('.appearance-settings-card').scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);

  const shell = page.locator('.app-shell');
  await shell.evaluate((element) => { (element as HTMLElement).dataset.themeMountProbe = 'preserved'; });
  const readsBeforeTheme = runtime.apiReads.length;
  const socketsBeforeTheme = productSockets;
  await settings.getByRole('button', { name: 'Серая', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'gray');
  await expect(settings.getByRole('button', { name: 'Серая', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings).toContainText('Выбрана: Серая');
  await expect(shell).toHaveAttribute('data-theme-mount-probe', 'preserved');
  expect(await page.evaluate(() => localStorage.getItem('zavod.appearanceTheme'))).toBe('gray');
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#cbd2d8');
  await page.waitForTimeout(250);
  expect(runtime.apiReads.length).toBe(readsBeforeTheme);
  expect(productSockets).toBe(socketsBeforeTheme);

  await settings.getByRole('button', { name: 'Светлая', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(settings).toContainText('Выбрана: Светлая');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  expect(await page.locator('meta[name="background-color"]').getAttribute('content')).toBe('#f3efe7');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => (window as Window & { __themeEvidence: { firstFrameTheme: string | null } }).__themeEvidence.firstFrameTheme)).toBe('light');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  await page.getByRole('region', { name: 'Настройки' }).getByRole('button', { name: 'Сменить завод', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const factoryPicker = page.getByRole('dialog', { name: 'Выберите завод' });
  await expect(factoryPicker).toBeVisible();
  await factoryPicker.getByRole('button', { name: /Завод оформления/ }).click();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  await page.getByRole('region', { name: 'Настройки' }).getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
  const restoredSettings = page.getByRole('region', { name: 'Настройки' });
  await restoredSettings.locator('.appearance-settings-card').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const nativeSetItem = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value(this: Storage, key: string, value: string) {
        if (key === 'zavod.appearanceTheme') throw new DOMException('Storage unavailable', 'QuotaExceededError');
        return nativeSetItem.call(this, key, value);
      },
    });
  });
  await restoredSettings.getByRole('button', { name: 'Серая', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'gray');
  await expect(restoredSettings).toContainText('Тема применена, но браузер не смог сохранить выбор на устройстве.');

  await page.reload();
  await page.evaluate(() => localStorage.setItem('zavod.appearanceTheme', 'unknown-theme'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => (window as Window & { __themeEvidence: { firstFrameTheme: string | null } }).__themeEvidence.firstFrameTheme)).toBe('dark');
  await page.evaluate(() => localStorage.removeItem('zavod.appearanceTheme'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(runtime.apiWrites).toEqual([]);
  expect(runtime.pageErrors).toEqual([]);
});

test('Three themes visual evidence on shared sensitive states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'after');
  test.setTimeout(300_000);
  page.on('pageerror', (error) => runtime.pageErrors.push(error.message));
  await installIsolatedAppState(page, 'dark');
  await page.route('**/__theme-gallery**', async (route) => {
    const url = new URL(route.request().url());
    const requestedTheme = url.searchParams.get('theme') || 'dark';
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: galleryHtml(requestedTheme, url.searchParams.get('overlay') === '1'),
    });
  });

  for (const width of widths) {
    const viewport = viewportName(width);
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark', 'gray', 'light'] as const) {
      const themeLabel = theme === 'dark' ? 'Тёмная' : theme === 'gray' ? 'Серая' : 'Светлая';
      await page.goto('/');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Report' } })));
      await expect(page.getByRole('heading', { name: 'Сообщить об ошибке', exact: true })).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
      const settings = page.getByRole('region', { name: 'Настройки' });
      await settings.getByRole('button', { name: themeLabel, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await settings.locator('.appearance-settings-card').scrollIntoViewIfNeeded();
      await capture(page, `${viewport}-${theme}-after-settings`, { state: 'settings-theme-selector', selectedTheme: theme });
      await page.locator('.mobile-sheet-backdrop').evaluate((element) => (element as HTMLElement).click());
      await page.getByLabel('Тема').fill('Не открывается заявка после смены завода');
      await page.getByLabel('Описание').fill('Поля и нижние действия должны сохранять прежнюю геометрию и контраст.');
      await page.locator('.bug-report-card').scrollIntoViewIfNeeded();
      await capture(page, `${viewport}-${theme}-after-form`, { state: 'real-report-form', selectedTheme: theme }, true);

      await page.goto(`/__theme-gallery?theme=${theme}`);
      await expect(page.getByRole('heading', { name: 'Смена и показатели' })).toBeVisible();
      await capture(page, `${viewport}-${theme}-after-gallery`, { state: 'shared-components', selectedTheme: theme }, true);
      await page.goto(`/__theme-gallery?theme=${theme}&overlay=1`);
      await expect(page.getByRole('dialog')).toBeVisible();
      await capture(page, `${viewport}-${theme}-after-overlay`, { state: 'modal', selectedTheme: theme });
    }
  }
  expect(runtime.apiWrites).toEqual([]);
  expect(runtime.pageErrors).toEqual([]);
});

test('Gray and Light cover every non-guest top-level screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'after');
  test.setTimeout(600_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray');

  for (const width of coverageWidths) {
    const viewport = viewportName(width);
    await page.setViewportSize({ width, height: 844 });
    for (const theme of coverageThemes) {
      await page.goto('/');
      await page.evaluate((selectedTheme) => {
        localStorage.setItem('zavod.appearanceTheme', selectedTheme);
        document.documentElement.dataset.theme = selectedTheme;
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const [screen, heading, slug] of topLevelScreens) {
        await page.evaluate((nextScreen) => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: nextScreen } })), screen);
        if (screen === 'Chats' || screen === 'Announcements') {
          await expect(page.locator(screen === 'Chats' ? '.chats-screen' : '.announcements-screen')).toBeVisible({ timeout: 20_000 });
        } else {
          await expect(page.getByRole('heading', { name: heading, exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
        }
        await capture(page, `${viewport}-${theme}-screen-${slug}`, { state: 'top-level-screen', selectedTheme: theme, screen }, true);
      }
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Gray and Light cover Admin, Archive and Ops unique subviews', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'after');
  test.setTimeout(900_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray');

  for (const width of coverageWidths) {
    const viewport = viewportName(width);
    await page.setViewportSize({ width, height: 844 });
    for (const theme of coverageThemes) {
      await page.goto('/');
      await page.evaluate((selectedTheme) => {
        localStorage.setItem('zavod.appearanceTheme', selectedTheme);
        document.documentElement.dataset.theme = selectedTheme;
      }, theme);

      if (uniqueScope === 'all' || uniqueScope === 'admin') {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Admin' } })));
        await expect(page.getByRole('heading', { name: 'Администрирование', exact: true })).toBeVisible();
        const adminNav = page.locator('.admin-task-nav[aria-label="Разделы администрирования"]');
        await expect(adminNav).toBeVisible();
        for (const section of adminSections) {
          const button = adminNav.getByRole('button', { name: section, exact: true });
          await button.click();
          await expect(button).toHaveClass(/active/);
          await capture(page, `${viewport}-${theme}-admin-${adminSections.indexOf(section) + 1}`, { state: 'admin-subsection', selectedTheme: theme, section }, true);
        }
      }

      if (uniqueScope === 'all' || uniqueScope === 'archive') {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Archive' } })));
        await expect(page.getByRole('navigation', { name: 'Разделы архива' })).toBeVisible();
        for (const [key, label] of archiveSections) {
          await page.locator(`[data-archive-category="${key}"]`).click();
          await expect(page.getByRole('heading', { name: label, exact: true }).filter({ visible: true }).first()).toBeVisible();
          await capture(page, `${viewport}-${theme}-archive-${key.toLowerCase()}`, { state: 'archive-category', selectedTheme: theme, section: key }, true);
          await page.getByRole('button', { name: 'Назад к разделам архива' }).click();
          await expect(page.getByRole('navigation', { name: 'Разделы архива' })).toBeVisible();
        }
      }

      if (uniqueScope === 'all' || uniqueScope === 'ops') {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Ops' } })));
        await expect(page.getByRole('heading', { name: 'Статистика / Аудит', exact: true })).toBeVisible();
        for (const tab of opsTabs) {
          const button = page.getByRole('button', { name: tab, exact: true }).filter({ visible: true }).first();
          await button.click();
          await expect(button).toHaveClass(/active/);
          await capture(page, `${viewport}-${theme}-ops-${opsTabs.indexOf(tab) + 1}`, { state: 'ops-tab', selectedTheme: theme, tab }, true);
        }
      }
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Three themes cover login, registration and forced-password states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'after');
  test.setTimeout(420_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'dark', { identity: 'anonymous', allowForcedPasswordFixture: true });

  for (const width of widths) {
    const viewport = viewportName(width);
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark', 'gray', 'light'] as const) {
      await openWithTheme(page, theme);
      await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
      await capture(page, `${viewport}-${theme}-auth-login`, { state: 'login', selectedTheme: theme }, true);

      await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Регистрация', exact: true })).toBeVisible();
      await capture(page, `${viewport}-${theme}-auth-registration`, { state: 'registration', selectedTheme: theme }, true);
      await page.getByRole('button', { name: 'Назад ко входу', exact: true }).click();

      const loginForm = page.locator('form').filter({ has: page.locator('#login-phone') });
      await loginForm.locator('#login-phone').fill('+79990000000');
      await loginForm.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(page.getByLabel('Новый пароль', { exact: true })).toBeVisible();
      await capture(page, `${viewport}-${theme}-auth-forced-password`, { state: 'forced-password', selectedTheme: theme }, true);
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Three themes cover factory picker', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'after');
  test.setTimeout(300_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'dark', { identity: 'factory-picker' });

  for (const width of widths) {
    const viewport = viewportName(width);
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark', 'gray', 'light'] as const) {
      await openWithTheme(page, theme);
      await expect(page.getByRole('dialog', { name: 'Выберите завод' })).toBeVisible();
      await capture(page, `${viewport}-${theme}-factory-picker`, { state: 'factory-picker', selectedTheme: theme });
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Three themes cover guest home', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'after');
  test.setTimeout(300_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'dark', { identity: 'guest' });

  for (const width of widths) {
    const viewport = viewportName(width);
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark', 'gray', 'light'] as const) {
      await openWithTheme(page, theme);
      await expect(page.getByTestId('guest-home-screen')).toBeVisible();
      await capture(page, `${viewport}-${theme}-guest-home`, { state: 'guest-home', selectedTheme: theme }, true);
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Three themes cover initial loading state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || phase !== 'after');
  test.setTimeout(360_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'dark', { identity: 'admin', authDelayMs: 1_200 });

  for (const width of widths) {
    const viewport = viewportName(width);
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark', 'gray', 'light'] as const) {
      await openWithTheme(page, theme);
      await expect(page.getByText('Загружаю доступные заводы...', { exact: true })).toBeVisible({ timeout: 800 });
      await capture(page, `${viewport}-${theme}-initial-loading`, { state: 'initial-loading', selectedTheme: theme });
      await expect(page.locator('.topbar')).toBeVisible({ timeout: 10_000 });
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Theme correction headings and Admin owners', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('headings-admin'));
  test.setTimeout(600_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });

  for (const { width, theme } of correctionCombinations()) {
    const viewport = viewportName(width);
    const meta = { role: 'Admin', selectedTheme: theme, width };
    await page.setViewportSize({ width, height: 844 });
    await openWithTheme(page, theme);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zavod:open-settings')));
    await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible();
    const settingsTitle = await recordComputedStyle(page, '.mobile-sheet-header h2', 'settings-title', meta);
    await capture(page, `${viewport}-${theme}-settings-title`, { ...meta, state: 'settings-title' });
    if (correctionPhase === 'after' && theme !== 'dark') expect(settingsTitle.color).not.toBe('rgb(255, 255, 255)');
    await page.locator('.mobile-sheet-backdrop').evaluate((element) => (element as HTMLElement).click());

    await navigateToScreen(page, 'Shift', 'Смена');
    const shiftHeading = await recordComputedStyle(page, '.section-subhead h3', 'shift-section-heading', meta);
    await capture(page, `${viewport}-${theme}-shift-sections`, { ...meta, state: 'shift-section-headings' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(shiftHeading.color).not.toBe('rgb(255, 255, 255)');

    await navigateToScreen(page, 'OKK', 'ОКК');
    const okkHeading = await recordComputedStyle(page, '.okk-screen .section-subhead h3', 'okk-section-heading', meta);
    await capture(page, `${viewport}-${theme}-okk-heading`, { ...meta, state: 'okk-section-heading' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(okkHeading.color).not.toBe('rgb(255, 255, 255)');

    await navigateToScreen(page, 'Log', 'Пересменка');
    const shiftLogNote = await recordComputedStyle(page, '.shift-log-scope-note', 'shift-log-scope-note', meta);
    await capture(page, `${viewport}-${theme}-shift-log-note`, { ...meta, state: 'shift-log-scope-note' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(shiftLogNote.color).not.toContain('236, 240, 245');

    await navigateToScreen(page, 'Admin', 'Администрирование');
    const adminGroup = await recordComputedStyle(page, '.admin-task-nav-group strong', 'admin-group-heading', meta);
    await expect(page.locator('.admin-task-nav-group > div:first-child > strong')).toHaveCount(4);
    await capture(page, `${viewport}-${theme}-admin-groups`, { ...meta, state: 'admin-group-headings' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(adminGroup.color).not.toBe('rgb(255, 255, 255)');

    const adminNav = page.locator('.admin-task-nav[aria-label="Разделы администрирования"]');
    await adminNav.getByRole('button', { name: 'Заводы', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Заводы/ }).filter({ visible: true }).first()).toBeVisible();
    const factoryChoices = page.locator('.wizard-choice-grid .factory-chip');
    await expect(factoryChoices).toHaveCount(2);
    await factoryChoices.nth(1).click();
    const inactiveFactoryChoice = await recordComputedStyle(page, '.wizard-choice-grid .factory-chip:not(.active)', 'admin-factory-choice-inactive', meta);
    const activeFactoryChoice = await recordComputedStyle(page, '.wizard-choice-grid .factory-chip.active', 'admin-factory-choice-active', meta);
    await recordComputedStyle(page, '.wizard-choice-grid .factory-chip.active span', 'admin-factory-choice-active-description', meta);
    await capture(page, `${viewport}-${theme}-admin-factory-choices`, { ...meta, state: 'admin-factory-choices' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') {
      expect(inactiveFactoryChoice.backgroundColor).not.toContain('15, 23, 42');
      expect(activeFactoryChoice.color).not.toContain('220, 252, 231');
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Theme correction control variants', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('controls'));
  test.setTimeout(600_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });

  for (const { width, theme } of correctionCombinations()) {
    const viewport = viewportName(width);
    const meta = { role: 'Admin', selectedTheme: theme, width };
    await page.setViewportSize({ width, height: 844 });
    await openWithTheme(page, theme);

    await navigateToScreen(page, 'Tasks', 'Заявки');
    const taskPrimary = await recordComputedStyle(page, '.tasks-screen > .tab-row .primary-button', 'tasks-primary', meta);
    const taskLive = await recordComputedStyle(page, '.tasks-screen .live-refresh-pill', 'tasks-live-pill', meta);
    await page.locator('.tasks-screen > .tab-row .primary-button').focus();
    await recordComputedStyle(page, '.tasks-screen > .tab-row .primary-button:focus', 'tasks-primary-focus', meta);
    await capture(page, `${viewport}-${theme}-tasks-controls`, { ...meta, state: 'tasks-controls' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') {
      expect(taskPrimary.color).toBe('rgb(17, 16, 13)');
      expect(taskLive.backgroundColor).not.toContain('9, 13, 17');
    }

    await navigateToScreen(page, 'Announcements');
    await expect(page.locator('.announcements-screen')).toBeVisible();
    const announcementTab = await recordComputedStyle(page, '.announcement-tabs button:not(.active)', 'announcements-inactive-tab', meta);
    await page.locator('.announcement-tabs button:not(.active)').first().focus();
    await recordComputedStyle(page, '.announcement-tabs button:not(.active):focus', 'announcements-inactive-tab-focus', meta);
    await recordComputedStyle(page, '.announcements-screen .live-refresh-pill', 'announcements-live-pill', meta);
    if (width <= 768) {
      const mobileBar = await recordComputedStyle(page, '.announcement-mobile-bar', 'announcements-mobile-header', meta);
      await recordComputedStyle(page, '.announcement-mobile-bar span', 'announcements-mobile-subtitle', meta);
      if (correctionPhase === 'after' && theme !== 'dark') expect(mobileBar.backgroundColor).not.toContain('6, 10, 13');
    }
    await capture(page, `${viewport}-${theme}-announcements-controls`, { ...meta, state: 'announcements-controls' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(announcementTab.backgroundColor).not.toContain('9, 13, 17');

    await navigateToScreen(page, 'People', 'Люди');
    const peopleTabs = await recordComputedStyle(page, '.people-shift-tabs', 'people-tabs-surface', meta);
    await recordComputedStyle(page, '.people-shift-tabs > button:not(.active)', 'people-tab-inactive', meta);
    await recordComputedStyle(page, '.people-shift-tabs > button.active', 'people-tab-selected', meta);
    await capture(page, `${viewport}-${theme}-people-tabs`, { ...meta, state: 'people-tabs' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(peopleTabs.backgroundColor).not.toContain('2, 5, 7');

    await navigateToScreen(page, 'Orders', 'Заказы / Остатки');
    const ordersTabs = await recordComputedStyle(page, '.orders-stock-tabs', 'orders-tabs-surface', meta);
    await recordComputedStyle(page, '.orders-stock-tabs > button:not(.active)', 'orders-tab-inactive', meta);
    await recordComputedStyle(page, '.orders-stock-tabs > button.active', 'orders-tab-selected', meta);
    await capture(page, `${viewport}-${theme}-orders-tabs`, { ...meta, state: 'orders-tabs' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(ordersTabs.backgroundColor).not.toContain('2, 5, 7');
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Theme correction Checklists normal state and checkbox consumers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('checklists'));
  test.setTimeout(720_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  await page.route('**/__theme-gallery**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: galleryHtml(url.searchParams.get('theme') || 'dark', false),
    });
  });

  for (const { width, theme } of correctionCombinations()) {
    const viewport = viewportName(width);
    const meta = { role: 'Admin', selectedTheme: theme, width };
    await page.setViewportSize({ width, height: 844 });
    await openWithTheme(page, theme);

    await navigateToScreen(page, 'Checklists', 'Чек-листы');
    await expect(page.getByText('Контроль температуры линии', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Cannot read properties of undefined/)).toHaveCount(0);
    const checklistHeading = await recordComputedStyle(page, '.checklists-screen .section-subhead h3', 'checklists-section-heading', meta);
    await capture(page, `${viewport}-${theme}-checklists-filled`, { ...meta, state: 'checklists-filled' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(checklistHeading.color).not.toBe('rgb(255, 255, 255)');

    await page.locator('.checklist-kpi-strip').getByRole('button', { name: /Архив/ }).click();
    await expect(page.getByRole('heading', { name: 'Завершённые чек-листы', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Фильтры и отчёты', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Фильтры и отчёты', exact: true })).toBeVisible();
    const checklistCheckbox = await recordComputedStyle(page, '.checklist-archive-filters .checkbox-row', 'checklists-real-checkbox', meta);
    await capture(page, `${viewport}-${theme}-checklists-real-checkbox`, { ...meta, state: 'checklists-real-checkbox' });
    if (correctionPhase === 'after' && theme !== 'dark') expect(checklistCheckbox.color).not.toBe('rgb(219, 234, 254)');
    await page.locator('.checklist-archive-tools').getByRole('button', { name: 'Закрыть', exact: true }).filter({ visible: true }).first().click();

    await page.goto(`/__theme-gallery?theme=${theme}`);
    const galleryCheckbox = await recordComputedStyle(page, '.theme-evidence-gallery .checkbox-row', 'gallery-checkbox', meta);
    await expect(page.locator('.theme-evidence-gallery .checkbox-row input')).toBeChecked();
    await capture(page, `${viewport}-${theme}-gallery-checkbox`, { ...meta, state: 'gallery-checkbox' }, true);
    if (correctionPhase === 'after' && theme !== 'dark') expect(galleryCheckbox.color).not.toBe('rgb(219, 234, 254)');

    await openWithTheme(page, theme);
    await navigateToScreen(page, 'Chats');
    await expect(page.locator('.chats-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Создать чат', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const chatCheckbox = await recordComputedStyle(page, '.modal-card .checkbox-row', 'chats-real-checkbox', meta);
    await capture(page, `${viewport}-${theme}-chats-real-checkbox`, { ...meta, state: 'chats-real-checkbox' });
    if (correctionPhase === 'after' && theme !== 'dark') expect(chatCheckbox.color).not.toBe('rgb(219, 234, 254)');
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Theme correction Checklists empty state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('checklists') || correctionPhase !== 'after');
  test.setTimeout(360_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { checklistState: 'empty' });
  for (const width of widths) {
    for (const theme of ['gray', 'light'] as const) {
      const viewport = viewportName(width);
      const meta = { role: 'Admin', selectedTheme: theme, width };
      await page.setViewportSize({ width, height: 844 });
      await openWithTheme(page, theme);
      await navigateToScreen(page, 'Checklists', 'Чек-листы');
      await expect(page.getByText('Сейчас у вас нет чек-листов в работе.', { exact: true })).toBeVisible();
      await expect(page.getByText(/Cannot read properties of undefined/)).toHaveCount(0);
      await capture(page, `${viewport}-${theme}-checklists-empty`, { ...meta, state: 'checklists-empty' }, true);
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Theme correction Checklists handled error state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('checklists') || correctionPhase !== 'after');
  test.setTimeout(360_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { checklistState: 'error' });
  for (const width of widths) {
    for (const theme of ['gray', 'light'] as const) {
      const viewport = viewportName(width);
      const meta = { role: 'Admin', selectedTheme: theme, width };
      await page.setViewportSize({ width, height: 844 });
      await openWithTheme(page, theme);
      await navigateToScreen(page, 'Checklists', 'Чек-листы');
      await expect(page.getByText('Ошибка сервера. Повторите позже.', { exact: true })).toBeVisible();
      await expect(page.getByText(/Cannot read properties of undefined/)).toHaveCount(0);
      await capture(page, `${viewport}-${theme}-checklists-handled-error`, { ...meta, state: 'checklists-handled-error' }, true);
    }
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('Theme correction disabled primary state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('loading'));
  test.setTimeout(360_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { identity: 'admin', authDelayMs: 1_200 });
  for (const { width, theme } of correctionCombinations()) {
    const viewport = viewportName(width);
    const meta = { role: 'Anonymous/loading fixture', selectedTheme: theme, width };
    await page.setViewportSize({ width, height: 844 });
    await openWithTheme(page, theme);
    await expect(page.getByText('Загружаю доступные заводы...', { exact: true })).toBeVisible({ timeout: 800 });
    const disabledPrimary = await recordComputedStyle(page, '.dev-login-card .primary-button:disabled', 'loading-disabled-primary', meta);
    await capture(page, `${viewport}-${theme}-initial-loading-disabled`, { ...meta, state: 'initial-loading-disabled' });
    if (correctionPhase === 'after' && theme !== 'dark') {
      expect(disabledPrimary.disabled).toBe(true);
      expect(disabledPrimary.opacity).toBe('0.88');
      expect(disabledPrimary.color).not.toBe('rgb(137, 147, 155)');
    }
    await expect(page.locator('.topbar')).toBeVisible({ timeout: 10_000 });
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

test('TC14-01 real modal form labels and affected shared consumers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || !correctionPartEnabled('tc14-labels'));
  test.setTimeout(600_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });

  for (const { width, theme } of tc14LabelCombinations()) {
    const viewport = viewportName(width);
    const meta = { role: 'Admin', selectedTheme: theme, width, focusedField: 'Название', selectedChatType: 'FACTORY' };
    await page.setViewportSize({ width, height: 844 });
    await openWithTheme(page, theme);
    await navigateToScreen(page, 'Chats');
    await expect(page.locator('.chats-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Создать чат', exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Создать чат', exact: true })).toBeVisible();
    const initialFormLabels = dialog.locator('.form-grid > label');
    await initialFormLabels.nth(1).locator('select').selectOption('FACTORY');
    const checkbox = dialog.locator('.form-grid > label.checkbox-row input[type="checkbox"]');
    await checkbox.check();
    await initialFormLabels.nth(0).locator('input').focus();
    await expect(initialFormLabels.nth(1).locator('select')).toHaveValue('FACTORY');
    await expect(checkbox).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeEnabled();

    const formLabels = dialog.locator('.form-grid > label');
    await expect(formLabels).toHaveCount(4);
    const titleLabel = formLabels.nth(0);
    const typeLabel = formLabels.nth(1);
    const descriptionLabel = formLabels.nth(2);
    const checkboxLabel = formLabels.nth(3);
    const titleStyle = await recordLocatorComputedStyle(titleLabel, 'Chats create label: Название', 'tc14-chat-label-title', meta);
    const typeStyle = await recordLocatorComputedStyle(typeLabel, 'Chats create label: Тип', 'tc14-chat-label-type', meta);
    const descriptionStyle = await recordLocatorComputedStyle(descriptionLabel, 'Chats create label: Описание', 'tc14-chat-label-description', meta);
    const checkboxStyle = await recordLocatorComputedStyle(checkboxLabel, 'Chats create checkbox label', 'tc14-chat-checkbox-label', meta);
    const visibility = [];
    visibility.push(await recordTargetVisibility(page, titleLabel, 'tc14-chat-label-title-visible', meta));
    visibility.push(await recordTargetVisibility(page, typeLabel, 'tc14-chat-label-type-visible', meta));
    visibility.push(await recordTargetVisibility(page, descriptionLabel, 'tc14-chat-label-description-visible', meta));
    visibility.push(await recordTargetVisibility(page, checkboxLabel, 'tc14-chat-checkbox-label-visible', meta));
    await capture(page, `${viewport}-${theme}-chat-form-labels`, {
      ...meta,
      state: 'tc14-chat-form-labels',
      visibilityStatus: visibility.every((item) => item.fullyVisible) ? 'VERIFIED_VISIBLE' : 'BLOCKED',
      scrollMethod: 'none',
    });
    expect(visibility.every((item) => item.fullyVisible)).toBe(true);
    if (theme === 'dark') {
      expect([titleStyle.color, typeStyle.color, descriptionStyle.color]).toEqual([
        'rgb(219, 234, 254)', 'rgb(219, 234, 254)', 'rgb(219, 234, 254)',
      ]);
      expect(checkboxStyle.color).toBe('rgb(219, 234, 254)');
    } else if (correctionPhase === 'before') {
      expect([titleStyle.color, typeStyle.color, descriptionStyle.color]).toEqual([
        'rgb(219, 234, 254)', 'rgb(219, 234, 254)', 'rgb(219, 234, 254)',
      ]);
      expect(checkboxStyle.color).not.toBe('rgb(219, 234, 254)');
    } else {
      expect(titleStyle.color).not.toBe('rgb(219, 234, 254)');
      expect(typeStyle.color).toBe(titleStyle.color);
      expect(descriptionStyle.color).toBe(titleStyle.color);
      expect(checkboxStyle.color).toBe(titleStyle.color);
    }
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    if (theme === 'dark' || (width !== 1440 && width !== 390)) continue;

    await navigateToScreen(page, 'Announcements');
    await expect(page.locator('.announcements-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Создать объявление', exact: true }).filter({ visible: true }).first().click();
    const announcementDialog = page.getByRole('dialog', { name: 'Создать объявление' });
    const announcementLabel = announcementDialog.locator('.form-grid > label').first();
    await announcementLabel.locator('input').focus();
    const announcementStyle = await recordLocatorComputedStyle(announcementLabel, 'Announcement create label: Заголовок', 'tc14-announcement-label', meta);
    const announcementVisibility = await recordTargetVisibility(page, announcementLabel, 'tc14-announcement-label-visible', meta, 'scrollIntoView-center');
    await capture(page, `${viewport}-${theme}-announcement-form-label`, {
      ...meta,
      state: 'tc14-announcement-form-label',
      visibilityStatus: announcementVisibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
      scrollMethod: 'scrollIntoView-center',
    });
    expect(announcementVisibility.fullyVisible).toBe(true);
    if (correctionPhase === 'before') expect(announcementStyle.color).toBe('rgb(219, 234, 254)');
    else expect(announcementStyle.color).not.toBe('rgb(219, 234, 254)');
    await announcementDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    await navigateToScreen(page, 'Returns');
    await expect(page.locator('.returns-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Опубликовать возврат', exact: true }).click();
    const returnsDialog = page.getByRole('dialog', { name: 'Возврат на производство' });
    const returnsLabel = returnsDialog.locator('.form-grid > label').first();
    await returnsLabel.locator('input').focus();
    const returnsStyle = await recordLocatorComputedStyle(returnsLabel, 'Returns create label: Заголовок', 'tc14-returns-label', meta);
    const returnsVisibility = await recordTargetVisibility(page, returnsLabel, 'tc14-returns-label-visible', meta, 'scrollIntoView-center');
    await capture(page, `${viewport}-${theme}-returns-form-label`, {
      ...meta,
      state: 'tc14-returns-form-label',
      visibilityStatus: returnsVisibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
      scrollMethod: 'scrollIntoView-center',
    });
    expect(returnsVisibility.fullyVisible).toBe(true);
    if (correctionPhase === 'before') expect(returnsStyle.color).toBe('rgb(219, 234, 254)');
    else expect(returnsStyle.color).not.toBe('rgb(219, 234, 254)');
    await returnsDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
  expect(runtime.isolatedFixtureWrites).toEqual([]);
});

const tc14ChecklistVisibilityTargets = [
  { oldReviewId: 'TC14-IMG-0014', width: 360, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/360-gray-checklists-real-checkbox.png' },
  { oldReviewId: 'TC14-IMG-0018', width: 360, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/360-light-checklists-real-checkbox.png' },
  { oldReviewId: 'TC14-IMG-0022', width: 390, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/390-gray-checklists-real-checkbox.png' },
  { oldReviewId: 'TC14-IMG-0026', width: 390, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/390-light-checklists-real-checkbox.png' },
  { oldReviewId: 'TC14-IMG-0030', width: 390, theme: 'dark', sourceRelativePath: 'screenshots/after-checklists/390-dark-checklists-real-checkbox.png' },
  { oldReviewId: 'TC14-IMG-0034', width: 430, theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/430-gray-checklists-real-checkbox.png' },
  { oldReviewId: 'TC14-IMG-0038', width: 430, theme: 'light', sourceRelativePath: 'screenshots/after-checklists/430-light-checklists-real-checkbox.png' },
] as const;

test('TC14-E01 target-visible mobile Checklists controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-checklists'));
  test.setTimeout(480_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  for (const target of tc14ChecklistVisibilityTargets) {
    const meta = { role: 'Admin', selectedTheme: target.theme, width: target.width, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
    await page.setViewportSize({ width: target.width, height: 844 });
    await openWithTheme(page, target.theme);
    await navigateToScreen(page, 'Checklists', 'Чек-листы');
    await page.locator('.checklist-kpi-strip').getByRole('button', { name: /Архив/ }).click();
    await page.getByRole('button', { name: 'Фильтры и отчёты', exact: true }).click();
    const onlyDeviations = page.getByRole('checkbox', { name: 'Только отклонения', exact: true }).locator('..');
    const visibility = await recordTargetVisibility(page, onlyDeviations, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
    await capture(page, `${target.width}-${target.theme}-checklists-only-deviations-visible`, {
      ...meta,
      state: 'tc14-checklists-only-deviations-visible',
      visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
      scrollMethod: 'scrollIntoView-center',
    });
    expect(visibility.fullyVisible).toBe(true);
    await page.locator('.checklist-archive-tools .premium-sheet-footer').getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
  expect(runtime.isolatedFixtureWrites).toEqual([]);
});

const tc14GalleryVisibilityTargets = [
  { oldReviewId: 'TC14-IMG-0003', theme: 'gray', sourceRelativePath: 'screenshots/after-checklists/desktop-gray-gallery-checkbox.png' },
  { oldReviewId: 'TC14-IMG-0007', theme: 'light', sourceRelativePath: 'screenshots/after-checklists/desktop-light-gallery-checkbox.png' },
  { oldReviewId: 'TC14-IMG-0011', theme: 'dark', sourceRelativePath: 'screenshots/after-checklists/desktop-dark-gallery-checkbox.png' },
] as const;

test('TC14-E01 target-visible desktop gallery controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-gallery'));
  test.setTimeout(240_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await page.route('**/__theme-gallery**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: galleryHtml(url.searchParams.get('theme') || 'dark', false) });
  });
  for (const target of tc14GalleryVisibilityTargets) {
    const meta = { role: 'Static isolated gallery', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
    await page.setViewportSize({ width: 1440, height: 844 });
    await page.goto(`/__theme-gallery?theme=${target.theme}`);
    const checkbox = page.locator('.theme-evidence-gallery .checkbox-row');
    const visibility = await recordTargetVisibility(page, checkbox, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
    await capture(page, `desktop-${target.theme}-gallery-checkbox-visible`, {
      ...meta,
      state: 'tc14-gallery-checkbox-visible',
      visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
      scrollMethod: 'scrollIntoView-center',
    });
    expect(visibility.fullyVisible).toBe(true);
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
});

const tc14OrdersVisibilityTargets = [
  { oldReviewId: 'TC14-IMG-0060', theme: 'gray', sourceRelativePath: 'screenshots/after-controls/desktop-gray-orders-tabs.png' },
  { oldReviewId: 'TC14-IMG-0064', theme: 'light', sourceRelativePath: 'screenshots/after-controls/desktop-light-orders-tabs.png' },
  { oldReviewId: 'TC14-IMG-0068', theme: 'dark', sourceRelativePath: 'screenshots/after-controls/desktop-dark-orders-tabs.png' },
] as const;

test('TC14-E01 target-visible desktop Orders controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge' || correctionPhase !== 'after' || !correctionPartEnabled('tc14-visible-orders'));
  test.setTimeout(240_000);
  const localPageErrors: string[] = [];
  page.on('pageerror', (error) => { localPageErrors.push(error.message); runtime.pageErrors.push(error.message); });
  await installIsolatedAppState(page, 'gray', { checklistState: 'filled' });
  for (const target of tc14OrdersVisibilityTargets) {
    const meta = { role: 'Admin', selectedTheme: target.theme, width: 1440, oldReviewId: target.oldReviewId, sourceRelativePath: target.sourceRelativePath };
    await page.setViewportSize({ width: 1440, height: 844 });
    await openWithTheme(page, target.theme);
    await navigateToScreen(page, 'Orders', 'Заказы / Остатки');
    const tabs = page.locator('.orders-stock-tabs');
    const visibility = await recordTargetVisibility(page, tabs, `${target.oldReviewId}-visible`, meta, 'scrollIntoView-center');
    await capture(page, `desktop-${target.theme}-orders-tabs-visible`, {
      ...meta,
      state: 'tc14-orders-tabs-visible',
      visibilityStatus: visibility.fullyVisible ? 'VERIFIED_VISIBLE' : 'BLOCKED',
      scrollMethod: 'scrollIntoView-center',
    });
    expect(visibility.fullyVisible).toBe(true);
  }
  expect(localPageErrors).toEqual([]);
  expect(runtime.apiWrites).toEqual([]);
  expect(runtime.isolatedFixtureWrites).toEqual([]);
});
