import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { PremiumSectionHeader, PremiumSheet } from '../components/PremiumShell';
import { addFactoryDays, factoryDateKey, factoryDateTimeLabel } from '../utils/factory-time';

type Overview = {
  activeTasksCount: number;
  overdueLongTasksCount: number;
  activeWashCount: number;
  washIssuesCount: number;
  activeDefrostCount: number;
  lowStockItemsCount: number;
  openOrderRequestsCount: number;
  activeImportantShiftLogsCount: number;
  unreadNotificationsCount: number;
  checklistAutoClosedCount: number;
  recentAccessDeniedCount: number;
};

type OpsEvent = {
  id: string;
  source: string;
  module: string;
  action: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  actorId?: string | null;
  actorName?: string | null;
  entityType?: string | null;
  entityLabel?: string | null;
  entityName?: string | null;
  entityId?: string | null;
  actionLabel?: string | null;
  message: string;
  createdAt: string;
};

type AuditRow = {
  id: string;
  module: string;
  action: string;
  actionLabel?: string;
  entityType: string;
  entityLabel?: string;
  entityName?: string | null;
  entityId?: string | null;
  userId?: string | null;
  actorName?: string | null;
  createdAt: string;
  detailsSummary?: string[];
  detailRows?: Array<{ label: string; value?: string; before?: string; after?: string }>;
};

type ModuleSummary = { module: string; count: number; scope?: string; scopeLabel?: string };

type OpsLine = {
  lineId: string;
  lineName: string;
  lostMinutes: number;
  lostLabel: string;
  downtimeCount: number;
  averageDowntimeMinutes: number | null;
  maxDowntimeMinutes: number | null;
  downtimeSharePercent: number;
  openTasks: number;
  linkedTasks: number;
  currentOpenDowntime?: OpsDowntime | null;
  planCompletionLabel?: string | null;
};

type OpsDowntime = {
  eventId: string;
  lineName: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  durationLabel: string;
  reasonLabel: string;
  comment?: string | null;
  isOpen: boolean;
  hasCorrection: boolean;
  relationHint: string;
};

type OpsTask = {
  id: string;
  lineId?: string | null;
  lineName?: string | null;
  title: string;
  status?: string;
  statusLabel: string;
  type?: string;
  typeLabel: string;
  createdAt: string;
  responseLabel: string;
  executionLabel?: string;
  resolutionLabel: string;
  overdueLong: boolean;
  downtimeLinked?: boolean;
  redirectCount: number;
  downtimeRelationLabel: string;
  departmentRecipients: Array<{ departmentName: string }>;
  assigneeName?: string | null;
};

type OpsDepartment = {
  departmentName: string;
  received: number;
  taken: number;
  closed: number;
  open: number;
  overdue: number;
  averageResponseMinutes: number | null;
  maxResponseMinutes: number | null;
  onTimePercent: number | null;
  redirects: number;
};

type OpsProblem = {
  title: string;
  source: string;
  lineName?: string | null;
  departmentName?: string | null;
  count: number;
  totalLabel: string;
};

type OpsDowntimeReason = {
  reason: string;
  reasonLabel: string;
  count: number;
  totalMinutes: number;
  totalLabel: string;
  averageMinutes: number | null;
};

type OpsInsight = {
  key: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  text: string;
  detail?: string;
};

type OperationsAnalytics = {
  generatedAt: string;
  period: { label: string; days: number; capped: boolean; asOf: string };
  summary: {
    totalLostMinutes: number;
    totalLostLabel: string;
    downtimeCount: number;
    averageDowntimeMinutes: number | null;
    medianDowntimeMinutes: number | null;
    p90DowntimeMinutes: number | null;
    openDowntimeCount: number;
    preliminary: boolean;
    worstLine?: OpsLine | null;
    urgentOpenTasks: number;
    overdueLongTasks: number;
    tasksTotal: number;
    tasksOpen: number;
    tasksCompleted: number;
    averageResponseMinutes: number | null;
    medianResponseMinutes: number | null;
    p90ResponseMinutes: number | null;
    maxResponseMinutes: number | null;
    averageExecutionMinutes: number | null;
    medianExecutionMinutes: number | null;
    p90ExecutionMinutes: number | null;
    maxExecutionMinutes: number | null;
    averageResolutionMinutes: number | null;
    medianResolutionMinutes: number | null;
    p90ResolutionMinutes: number | null;
    tenMinuteDailyEffect: { yearlyLabel: string; text: string };
  };
  weakSpots: OpsInsight[];
  lineEvents: { stop: number; pause: number; work: number; downtimeLinkedTasks: number };
  quality: { okkDefects: number; stockDefects: number; stockDefectQuantity: number; returns: number };
  checklists: { started: number; active: number; runsCompleted: number; checksCompleted: number; checksOverdue: number; manuallyClosed: number; shiftClosed: number };
  wash: { active: number; completed: number; issues: number; openIssues: number; miniTasks: number; miniTasksDone: number };
  lines: OpsLine[];
  downtimeReasons: OpsDowntimeReason[];
  downtimes: OpsDowntime[];
  tasks: OpsTask[];
  departments: OpsDepartment[];
  repeatedProblems: OpsProblem[];
  dataQuality: { status: string; warnings: Array<{ code: string; label: string; count: number }> };
  limitations: string[];
  filterOptions: {
    lines: Array<{ id: string; name: string; status: string }>;
    departments: Array<{ id: string; name: string }>;
    taskScopes?: Array<{ value: string; label: string }>;
  };
};

const tabs = ['Потери', 'Обзор', 'События', 'Аудит', 'Модули'] as const;
type Tab = typeof tabs[number];

const moduleLabels: Record<string, string> = {
  Tasks: 'Заявки',
  Wash: 'Мойка',
  Checklists: 'Чек-листы',
  Orders: 'Заказы',
  OKK: 'ОКК',
  Stock: 'Остатки',
  Returns: 'Возвраты',
  ShiftLog: 'Пересменка',
  Defrost: 'Оттайка',
  Notifications: 'Уведомления',
  Chats: 'Чаты',
  Announcements: 'Объявления',
  Assignments: 'Назначения',
  Lines: 'Линии',
  Errors: 'Ошибки пользователей',
  Admin: 'Администрирование',
  'Auth/access': 'Доступ',
  System: 'Система',
};

const actionLabels: Record<string, string> = {
  ACCESS_DENIED: 'Отказ доступа',
  OPERATIONAL_ANALYTICS_VIEWED: 'Просмотр операционной аналитики',
  TASK_CREATED: 'Заявка создана',
  TASK_REDIRECTED: 'Заявка передана',
  TASK_TAKEN: 'Заявка взята в работу',
  TASK_DONE: 'Заявка завершена',
  TASK_LONG_ESCALATED: 'Долгая заявка просрочена',
};

const severityLabels: Record<OpsEvent['severity'], string> = {
  INFO: 'Информация',
  WARNING: 'Внимание',
  CRITICAL: 'Критично',
};

function todayInput() {
  return factoryDateKey();
}

function weekAgoInput() {
  return addFactoryDays(factoryDateKey(), -7);
}

const fallbackTaskScopes = [
  { value: 'all', label: 'Все заявки' },
  { value: 'open', label: 'Только открытые' },
  { value: 'overdue', label: 'Просроченные долгие заявки' },
  { value: 'downtimeLinked', label: 'Созданы из простоя' },
  { value: 'downtimeContext', label: 'В период простоя' },
  { value: 'withoutDowntime', label: 'Без связи с простоем' },
];

export function OpsAuditScreen() {
  const [tab, setTab] = useState<Tab>('Потери');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [operations, setOperations] = useState<OperationsAnalytics | null>(null);
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [filters, setFilters] = useState({
    dateFrom: weekAgoInput(),
    dateTo: todayInput(),
    shiftType: 'all',
    lineId: '',
    departmentId: '',
    taskType: '',
    taskStatus: '',
    taskScope: 'all',
    eventModule: '',
    eventSeverity: '',
    eventSearch: '',
    accessDeniedOnly: false,
  });
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<AuditRow | null>(null);

  const operationsUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.shiftType && filters.shiftType !== 'all') params.set('shiftType', filters.shiftType);
    if (filters.lineId) params.set('lineId', filters.lineId);
    if (filters.departmentId) params.set('departmentId', filters.departmentId);
    if (filters.taskType) params.set('taskType', filters.taskType);
    if (filters.taskStatus) params.set('taskStatus', filters.taskStatus);
    if (filters.taskScope && filters.taskScope !== 'all') params.set('taskScope', filters.taskScope);
    return `/ops/operations/overview?${params.toString()}`;
  }, [filters]);

  const summaryQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.departmentId) params.set('departmentId', filters.departmentId);
    return params.toString();
  }, [filters.dateFrom, filters.dateTo, filters.departmentId]);

  const timelineQuery = useMemo(() => {
    const params = new URLSearchParams(summaryQuery);
    if (filters.eventModule) params.set('module', filters.eventModule);
    if (filters.eventSeverity) params.set('severity', filters.eventSeverity);
    if (filters.eventSearch.trim()) params.set('search', filters.eventSearch.trim());
    if (filters.accessDeniedOnly) params.set('accessDeniedOnly', 'true');
    return params.toString();
  }, [summaryQuery, filters.eventModule, filters.eventSeverity, filters.eventSearch, filters.accessDeniedOnly]);

  const load = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const [nextOperations, nextOverview, nextEvents, nextAudit, nextModules] = await Promise.all([
        apiClient.get<OperationsAnalytics>(operationsUrl),
        apiClient.get<Overview>(`/ops/overview?${summaryQuery}`),
        apiClient.get<OpsEvent[]>(`/ops/events?limit=50&${timelineQuery}`),
        apiClient.get<AuditRow[]>(`/ops/audit?limit=50&${timelineQuery}`),
        apiClient.get<ModuleSummary[]>(`/ops/module-summary?${summaryQuery}`),
      ]);
      setOperations(nextOperations);
      setOverview(nextOverview);
      setEvents(nextEvents);
      setAudit(nextAudit);
      setModules(nextModules);
    } catch (error) {
      setOperations(null);
      setOverview(null);
      setEvents([]);
      setAudit([]);
      setModules([]);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить операционную сводку.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const applyQuickPeriod = (period: 'today' | 'yesterday' | 'week' | 'month' | 'prevMonth') => {
    const today = factoryDateKey();
    let start = today;
    let end = today;
    if (period === 'yesterday') {
      start = addFactoryDays(today, -1);
      end = start;
    } else if (period === 'week') {
      start = addFactoryDays(today, -6);
    } else if (period === 'month') {
      start = `${today.slice(0, 7)}-01`;
    } else if (period === 'prevMonth') {
      end = addFactoryDays(`${today.slice(0, 7)}-01`, -1);
      start = `${end.slice(0, 7)}-01`;
    }
    setFilters((current) => ({ ...current, dateFrom: start, dateTo: end }));
  };

  return (
    <section className="screen-panel ops-audit-screen">
      <PremiumSectionHeader
        title="Статистика / Аудит"
        subtitle="Операционная картина по простоям, заявкам, реакции отделов и качеству данных без финансовых допущений."
      />

      <div className="tab-row">
        {tabs.map((item) => (
          <button className={`tab-button ${tab === item ? 'active' : ''}`} key={item} type="button" onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>

      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {loading ? <div className="empty-state">Загрузка...</div> : null}

      {operations ? (
        <div className="ops-filter-summary" data-testid="ops-filter-summary">
          <div>
            <span className="section-eyebrow">Период</span>
            <strong>{operations.period.label}</strong>
            <small>
              {filters.lineId ? operations.filterOptions.lines.find((line) => line.id === filters.lineId)?.name ?? 'Выбранная линия' : 'Все линии'}
              {filters.departmentId ? ` · ${operations.filterOptions.departments.find((department) => department.id === filters.departmentId)?.name ?? 'Выбранный отдел'}` : ''}
            </small>
          </div>
          <button className="secondary-button" type="button" onClick={() => setFiltersOpen(true)}>Фильтры</button>
        </div>
      ) : null}

      {tab === 'Потери' && operations ? (
        <div className="ops-analytics">
          <div className="ops-owner-hero">
            <div>
              <span className="section-eyebrow">Период: {operations.period.label}</span>
              <h3>Потеряно времени: {operations.summary.totalLostLabel}</h3>
              <p>{operations.summary.tenMinuteDailyEffect.text}</p>
            </div>
            <div className="ops-hero-badges">
              <span>Простоев: {operations.summary.downtimeCount}</span>
              <span>Открытых простоев: {operations.summary.openDowntimeCount}</span>
              <span>Открытых заявок: {operations.summary.tasksOpen}</span>
              <span>Просроченных долгих: {operations.summary.overdueLongTasks}</span>
              {operations.summary.preliminary ? <span className="ops-preliminary-badge">Предварительно на {factoryDateTimeLabel(operations.period.asOf)}</span> : null}
            </div>
          </div>

          <div className="metric-grid ops-metric-grid premium-kpi-strip" data-count="4">
            <Metric label="Самая проблемная линия" value={operations.summary.worstLine?.lineName ?? 'Нет данных'} detail={operations.summary.worstLine?.lostLabel ?? 'Потерь не найдено'} />
            <Metric label="Средний простой" value={minutesLabel(operations.summary.averageDowntimeMinutes)} detail={`Медиана: ${minutesLabel(operations.summary.medianDowntimeMinutes)} · p90: ${minutesLabel(operations.summary.p90DowntimeMinutes)}`} />
            <Metric label="Срочные открытые" value={operations.summary.urgentOpenTasks} detail="Нужно держать в фокусе смены" />
            <Metric label="Средняя реакция" value={minutesLabel(operations.summary.averageResponseMinutes)} detail={`Медиана: ${minutesLabel(operations.summary.medianResponseMinutes)} · p90: ${minutesLabel(operations.summary.p90ResponseMinutes)}`} />
            <Metric label="Среднее исполнение" value={minutesLabel(operations.summary.averageExecutionMinutes)} detail={`Медиана: ${minutesLabel(operations.summary.medianExecutionMinutes)} · p90: ${minutesLabel(operations.summary.p90ExecutionMinutes)}`} />
            <Metric label="Среднее решение" value={minutesLabel(operations.summary.averageResolutionMinutes)} detail={`Медиана: ${minutesLabel(operations.summary.medianResolutionMinutes)} · p90: ${minutesLabel(operations.summary.p90ResolutionMinutes)}`} />
            <Metric label="Эффект 10 минут" value={operations.summary.tenMinuteDailyEffect.yearlyLabel} detail="Не больше подтверждённых потерь за выбранный период" />
            <Metric label="Качество данных" value={operations.dataQuality.status} detail={`${operations.dataQuality.warnings.length} предупреждений`} />
          </div>

          <section className="ops-analytics-section">
            <div className="line-title-row">
              <h3>Выводы руководителю</h3>
            </div>
            <div className="ops-insight-grid">
              {operations.weakSpots.map((insight) => (
                <article className={`ops-insight-card ${insight.severity.toLowerCase()}`} key={insight.key}>
                  <div>
                    <strong>{insight.title}</strong>
                    <span>{insight.text}</span>
                    {insight.detail ? <span>{insight.detail}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="ops-analytics-section">
            <h3>Линии и простои</h3>
            <div className="metric-grid ops-metric-grid">
              <Metric label="Остановки" value={operations.lineEvents.stop} />
              <Metric label="Паузы" value={operations.lineEvents.pause} />
              <Metric label="Возвраты в работу" value={operations.lineEvents.work} />
              <Metric label="Заявки из простоя" value={operations.lineEvents.downtimeLinkedTasks} detail="Только по подтверждённой связи" />
            </div>
          </section>

          <section className="ops-analytics-section">
            <h3>Качество</h3>
            <div className="metric-grid ops-metric-grid">
              <Metric label="Брак ОКК" value={operations.quality.okkDefects} />
              <Metric label="Некондиция" value={operations.quality.stockDefects} detail={`Количество: ${operations.quality.stockDefectQuantity}`} />
              <Metric label="Возвраты" value={operations.quality.returns} />
            </div>
          </section>

          <section className="ops-analytics-section">
            <h3>Дисциплина чек-листов</h3>
            <div className="metric-grid ops-metric-grid">
              <Metric label="Запущено" value={operations.checklists.started} />
              <Metric label="Активно на конец периода" value={operations.checklists.active} />
              <Metric label="Проверок выполнено" value={operations.checklists.checksCompleted} detail={`Запусков завершено: ${operations.checklists.runsCompleted}`} />
              <Metric label="Просрочено" value={operations.checklists.checksOverdue} />
              <Metric label="Закрыто вручную" value={operations.checklists.manuallyClosed} />
              <Metric label="Закрыто сменой" value={operations.checklists.shiftClosed} />
            </div>
          </section>

          <section className="ops-analytics-section">
            <h3>Мойка</h3>
            <div className="metric-grid ops-metric-grid">
              <Metric label="Активные мойки" value={operations.wash.active} />
              <Metric label="Завершённые мойки" value={operations.wash.completed} />
              <Metric label="Открытые проблемы" value={operations.wash.openIssues} detail={`Всего проблем: ${operations.wash.issues}`} />
              <Metric label="Мини-задания" value={operations.wash.miniTasks} detail={`Выполнено: ${operations.wash.miniTasksDone}`} />
            </div>
          </section>

          <AnalyticsSection title="Линии с потерями" empty="За выбранный период потерь по линиям не найдено.">
            {operations.lines.map((line) => (
              <article className="ops-row-card" key={line.lineId}>
                <div>
                  <strong>{line.lineName}</strong>
                  <span>{line.lostLabel} · простоев: {line.downtimeCount} · заявок открыто: {line.openTasks}</span>
                </div>
                <div className="ops-row-meta">
                  <span>Доля периода: {line.downtimeSharePercent}%</span>
                  <span>План: {line.planCompletionLabel ?? 'нет данных'}</span>
                  {line.currentOpenDowntime ? <span className="tag pause">Простой открыт</span> : null}
                </div>
              </article>
            ))}
          </AnalyticsSection>

          <AnalyticsSection title="Причины простоев" empty="Причины простоев за выбранный период не найдены.">
            {operations.downtimeReasons.map((reason) => (
              <article className="ops-row-card" key={reason.reason}>
                <div>
                  <strong>{reason.reasonLabel}</strong>
                  <span>Событий: {reason.count} · суммарно: {reason.totalLabel}</span>
                </div>
                <div className="ops-row-meta">
                  <span>Среднее: {minutesLabel(reason.averageMinutes)}</span>
                </div>
              </article>
            ))}
          </AnalyticsSection>

          <AnalyticsSection title="Реакция отделов" empty="Заявок по отделам за период нет.">
            {operations.departments.map((department) => (
              <article className="ops-row-card" key={department.departmentName}>
                <div>
                  <strong>{department.departmentName}</strong>
                  <span>Получено: {department.received} · закрыто: {department.closed} · открыто: {department.open}</span>
                </div>
                <div className="ops-row-meta">
                  <span>Реакция: {minutesLabel(department.averageResponseMinutes)}</span>
                  <span>Максимум: {minutesLabel(department.maxResponseMinutes)}</span>
                  <span>В срок: {department.onTimePercent === null ? 'нет данных' : `${department.onTimePercent}%`}</span>
                </div>
              </article>
            ))}
          </AnalyticsSection>

          <AnalyticsSection title="Крупные простои" empty="Крупных простоев за период нет.">
            {operations.downtimes.map((item) => (
              <article className="ops-row-card" key={item.eventId}>
                <div>
                  <strong>{item.lineName} · {item.durationLabel}</strong>
                  <span>{item.reasonLabel} · {factoryDateTimeLabel(item.startAt)}</span>
                  {item.comment ? <span>{item.comment}</span> : null}
                </div>
                <div className="ops-row-meta">
                  {item.isOpen ? <span className="tag pause">Продолжается</span> : <span>{item.relationHint}</span>}
                  {item.hasCorrection ? <span>Время уточнялось</span> : null}
                </div>
              </article>
            ))}
          </AnalyticsSection>

          <AnalyticsSection title="Заявки, влияющие на потери" empty="Заявок по выбранному периоду нет.">
            {operations.tasks.slice(0, 20).map((task) => (
              <article className="ops-row-card" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.lineName ?? 'Линия не указана'} · {task.typeLabel} · {task.statusLabel}</span>
                  <span>{task.downtimeRelationLabel}</span>
                </div>
                <div className="ops-row-meta">
                  <span>Реакция: {task.responseLabel}</span>
                  <span>Исполнение: {task.executionLabel ?? 'нет данных'}</span>
                  <span>Решение: {task.resolutionLabel}</span>
                  {task.overdueLong ? <span className="tag stop">Просрочена</span> : null}
                </div>
              </article>
            ))}
          </AnalyticsSection>

          <AnalyticsSection title="Повторяющиеся проблемы" empty="Повторяющиеся проблемы пока не проявились.">
            {operations.repeatedProblems.map((problem) => (
              <article className="ops-row-card" key={`${problem.source}-${problem.title}-${problem.lineName ?? ''}`}>
                <div>
                  <strong>{problem.title}</strong>
                  <span>{problem.source} · повторов: {problem.count} · суммарно: {problem.totalLabel}</span>
                </div>
                <div className="ops-row-meta">
                  {problem.lineName ? <span>{problem.lineName}</span> : null}
                  {problem.departmentName ? <span>{problem.departmentName}</span> : null}
                </div>
              </article>
            ))}
          </AnalyticsSection>

          <AnalyticsSection title="Качество данных" empty="Предупреждений по данным нет.">
            {operations.dataQuality.warnings.map((warning) => (
              <article className="ops-row-card" key={warning.code}>
                <div>
                  <strong>{warning.label}</strong>
                  <span>Найдено: {warning.count}</span>
                </div>
              </article>
            ))}
          </AnalyticsSection>

          <details className="ops-limitations">
            <summary>Что аналитика не придумывает</summary>
            <ul>
              {operations.limitations.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </details>
        </div>
      ) : null}

      {tab === 'Обзор' && overview ? (
        <div className="metric-grid premium-kpi-strip ops-overview-metric-grid" data-count="4">
          <Metric label="Просроченные заявки" value={overview.overdueLongTasksCount} />
          <Metric label="Активные заявки" value={overview.activeTasksCount} />
          <Metric label="Активные мойки" value={overview.activeWashCount} />
          <Metric label="Проблемы мойки" value={overview.washIssuesCount} />
          <Metric label="Остатки ниже порога" value={overview.lowStockItemsCount} />
          <Metric label="Заявки на заказ" value={overview.openOrderRequestsCount} />
          <Metric label="Важные пересменки" value={overview.activeImportantShiftLogsCount} />
          <Metric label="Непрочитанные уведомления" value={overview.unreadNotificationsCount} />
          <Metric label="Автозакрытые чек-листы" value={overview.checklistAutoClosedCount} />
          <Metric label="Отказы доступа" value={overview.recentAccessDeniedCount} />
        </div>
      ) : null}

      {tab === 'События' ? (
        <div className="section-stack">
          {!events.length && !loading ? <div className="empty-state">Событий пока нет.</div> : null}
          {events.map((item) => <EventCard item={item} key={item.id} />)}
        </div>
      ) : null}

      {tab === 'Аудит' ? (
        <div className="section-stack">
          {!audit.length && !loading ? <div className="empty-state">Записей аудита пока нет.</div> : null}
          {audit.map((item) => (
            <article className="card ops-audit-card" key={item.id}>
              <div className="line-title-row">
                <h3 className="line-name">{item.actionLabel ?? humanAction(item.action)}</h3>
                <span className="tag">{humanModule(item.module)}</span>
              </div>
              <p className="line-meta">{item.entityLabel ?? item.entityType}: {item.entityName ?? 'Объект системы'}</p>
              <p className="line-meta">{factoryDateTimeLabel(item.createdAt)} · {item.actorName ?? 'Система'}</p>
              {item.detailsSummary?.length ? (
                <div className="tag-row">
                  {item.detailsSummary.map((detail) => <span className="tag" key={detail}>{detail}</span>)}
                </div>
              ) : (
                <p className="line-meta">Дополнительных деталей нет.</p>
              )}
              <button className="secondary-button compact-action" type="button" onClick={() => setSelectedAudit(item)}>Подробнее</button>
            </article>
          ))}
        </div>
      ) : null}

      {tab === 'Модули' ? (
        <div className="metric-grid ops-module-grid">
          {modules.map((item) => <Metric label={humanModule(item.module)} value={item.count} detail={item.scopeLabel ?? 'За выбранный период'} key={item.module} />)}
        </div>
      ) : null}

      {operations ? (
        <PremiumSheet
          open={filtersOpen}
          title="Фильтры статистики"
          eyebrow="Статистика / Аудит"
          description="Период считается по времени завода. Фильтры применяются ко всем вкладкам."
          onClose={() => setFiltersOpen(false)}
          footer={<button className="action-button work" type="button" disabled={loading} onClick={() => { void load().then(() => setFiltersOpen(false)); }}>Применить фильтры</button>}
        >
          <div className="ops-filter-sheet-grid">
            <div className="ops-quick-periods">
              <span>Быстрый период</span>
              <div>
                <button type="button" onClick={() => applyQuickPeriod('today')}>Сегодня</button>
                <button type="button" onClick={() => applyQuickPeriod('yesterday')}>Вчера</button>
                <button type="button" onClick={() => applyQuickPeriod('week')}>7 дней</button>
                <button type="button" onClick={() => applyQuickPeriod('month')}>Этот месяц</button>
                <button type="button" onClick={() => applyQuickPeriod('prevMonth')}>Прошлый месяц</button>
              </div>
            </div>
            <label><span>С</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
            <label><span>По</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
            <label><span>Линия</span><select value={filters.lineId} onChange={(event) => setFilters((current) => ({ ...current, lineId: event.target.value }))}><option value="">Все линии</option>{operations.filterOptions.lines.map((line) => <option value={line.id} key={line.id}>{line.name}</option>)}</select></label>
            <label><span>Смена</span><select value={filters.shiftType} onChange={(event) => setFilters((current) => ({ ...current, shiftType: event.target.value }))}><option value="all">Все</option><option value="DAY">День</option><option value="NIGHT">Ночь</option></select></label>
            <label><span>Отдел</span><select value={filters.departmentId} onChange={(event) => setFilters((current) => ({ ...current, departmentId: event.target.value }))}><option value="">Все отделы</option>{operations.filterOptions.departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label>
            <label><span>Тип заявки</span><select value={filters.taskType} onChange={(event) => setFilters((current) => ({ ...current, taskType: event.target.value }))}><option value="">Все типы</option><option value="URGENT">Срочные</option><option value="LONG">Долгие</option></select></label>
            <label><span>Статус заявки</span><select value={filters.taskStatus} onChange={(event) => setFilters((current) => ({ ...current, taskStatus: event.target.value }))}><option value="">Все статусы</option><option value="NEW">Новые</option><option value="IN_PROGRESS">В работе</option><option value="DONE">Завершённые</option></select></label>
            <label><span>Какие заявки учитывать</span><select value={filters.taskScope} onChange={(event) => setFilters((current) => ({ ...current, taskScope: event.target.value }))}>{(operations.filterOptions.taskScopes ?? fallbackTaskScopes).map((scope) => <option value={scope.value} key={scope.value}>{scope.label}</option>)}</select></label>
            <label><span>Модуль событий</span><select value={filters.eventModule} onChange={(event) => setFilters((current) => ({ ...current, eventModule: event.target.value }))}><option value="">Все модули</option>{Object.entries(moduleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>Важность событий</span><select value={filters.eventSeverity} onChange={(event) => setFilters((current) => ({ ...current, eventSeverity: event.target.value }))}><option value="">Любая</option><option value="INFO">Информация</option><option value="WARNING">Внимание</option><option value="CRITICAL">Критично</option></select></label>
            <label><span>Поиск в событиях и аудите</span><input type="search" value={filters.eventSearch} placeholder="Заявка, мойка, отказ..." onChange={(event) => setFilters((current) => ({ ...current, eventSearch: event.target.value }))} /></label>
            <label className="ops-checkbox-filter"><input type="checkbox" checked={filters.accessDeniedOnly} onChange={(event) => setFilters((current) => ({ ...current, accessDeniedOnly: event.target.checked }))} /><span>Только отказы доступа</span></label>
          </div>
        </PremiumSheet>
      ) : null}

      <PremiumSheet
        open={Boolean(selectedAudit)}
        title={selectedAudit?.actionLabel ?? 'Детали события'}
        eyebrow="Аудит"
        description={selectedAudit ? `${selectedAudit.entityLabel ?? 'Объект'}: ${selectedAudit.entityName ?? 'Объект системы'}` : undefined}
        onClose={() => setSelectedAudit(null)}
      >
        {selectedAudit ? (
          <div className="ops-audit-detail">
            <div><span>Кто</span><strong>{selectedAudit.actorName ?? 'Система'}</strong></div>
            <div><span>Когда</span><strong>{factoryDateTimeLabel(selectedAudit.createdAt)}</strong></div>
            {(selectedAudit.detailRows ?? []).map((row) => (
              <div key={`${row.label}-${row.value ?? row.before ?? ''}-${row.after ?? ''}`}>
                <span>{row.label}</span>
                {row.before !== undefined || row.after !== undefined
                  ? <strong>{row.before ?? 'не задано'} → {row.after ?? 'не задано'}</strong>
                  : <strong>{row.value ?? 'не задано'}</strong>}
              </div>
            ))}
            {!selectedAudit.detailRows?.length ? <div className="empty-state compact">Дополнительных изменений нет.</div> : null}
          </div>
        ) : null}
      </PremiumSheet>
    </section>
  );
}

function AnalyticsSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <section className="ops-analytics-section">
      <div className="line-title-row">
        <h3>{title}</h3>
      </div>
      {items.length ? <div className="section-stack">{items}</div> : <div className="empty-state compact">{empty}</div>}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </div>
  );
}

function EventCard({ item }: { item: OpsEvent }) {
  return (
    <article className={`card ${item.severity === 'CRITICAL' ? 'active-card' : ''}`} style={{ padding: 12 }}>
      <div className="line-title-row">
        <h3 className="line-name">{item.message || item.actionLabel || humanAction(item.action)}</h3>
        <span className={`tag ${item.severity === 'CRITICAL' ? 'stop' : item.severity === 'WARNING' ? 'pause' : ''}`}>{severityLabels[item.severity]}</span>
      </div>
      <p className="line-meta">{humanModule(item.module)} · {item.actionLabel ?? humanAction(item.action)}</p>
      <p className="line-meta">{factoryDateTimeLabel(item.createdAt)} · {item.actorName ?? 'Система'}</p>
      {item.entityLabel ? <p className="line-meta">{item.entityLabel}: {item.entityName ?? 'Объект системы'}</p> : null}
    </article>
  );
}

function minutesLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return 'нет данных';
  if (value < 60) return `${value} мин`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`;
}

function humanModule(module: string) {
  return moduleLabels[module] ?? module;
}

function humanAction(action: string) {
  if (actionLabels[action]) return actionLabels[action];
  return action
    .toLocaleLowerCase('ru-RU')
    .replace(/_/g, ' ')
    .replace(/^./, (char) => char.toLocaleUpperCase('ru-RU'));
}
