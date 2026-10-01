import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { ActionModal } from '../components/ActionModal';
import { PremiumKpiStrip, PremiumSectionHeader } from '../components/PremiumShell';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { appStore, Line, LineStatus, LineTaskSummary, useAppStore, WashSession } from '../store/app.store';
import {
  factoryDateTimeInput,
  factoryDateTimeInputToIso,
  factoryDateTimeLabel,
  factoryDurationLabel,
  factoryShortDateTimeLabel,
} from '../utils/factory-time';
import { isPilotFixtureText } from '../utils/pilot-ui';

const PENDING_WASH_SESSION_KEY = 'zavod.pendingWashSessionId';
const PENDING_LINE_TIMELINE_KEY = 'zavod.pendingLineTimeline';
const PENDING_LINE_ASSIGNMENT_CONTEXT_KEY = 'zavod.pendingLineAssignmentContext';

const statusMeta: Record<LineStatus, { label: string; className: string; tagClass: string }> = {
  WORK: { label: 'Работает', className: 'status-work', tagClass: 'work' },
  PAUSE: { label: 'Простой', className: 'status-pause', tagClass: 'pause' },
  STOP: { label: 'Остановлена', className: 'status-stop', tagClass: 'stop' },
  PLAN: { label: 'План', className: 'status-plan', tagClass: '' },
  PLANNING: { label: 'Планируется', className: 'status-plan', tagClass: '' },
};

const operationalStatusMeta: Record<NonNullable<Line['operationalState']>, { label: string; className: string; tagClass: string }> = {
  RUNNING: statusMeta.WORK,
  DOWNTIME: statusMeta.PAUSE,
  WASH: { label: 'На мойке', className: 'status-wash', tagClass: 'wash' },
  DEFROST: { label: 'На оттайке', className: 'status-defrost', tagClass: 'defrost' },
  STOPPED: statusMeta.STOP,
};

type PendingAction =
  | { mode: 'status'; line: Line; status: LineStatus }
  | { mode: 'start'; line: Line }
  | null;

type LineTimelineEvent = {
  id: string;
  kind: string;
  occurredAt: string;
  endedAt?: string | null;
  durationMs: number;
  title: string;
  description?: string | null;
  downtimeReason?: string | null;
  downtimeReasonLabel?: string | null;
  comment?: string | null;
  status: string;
  sourceType: 'LINE_EVENT' | 'TASK' | 'ASSIGNMENT' | 'WASH_SESSION' | 'DEFROST_EVENT';
  sourceId: string;
  canOpen: boolean;
  actorName?: string | null;
  linkedToDowntime?: boolean;
  responseMs?: number | null;
  executionMs?: number | null;
  totalMs?: number | null;
};

type LineTimelineResponse = {
  line: { id: string; name: string };
  shift: { shiftDate: string; shiftType: 'DAY' | 'NIGHT'; startsAt: string; endsAt: string; isCurrent: boolean };
  navigation: {
    previous: { shiftDate: string; shiftType: 'DAY' | 'NIGHT' };
    next: { shiftDate: string; shiftType: 'DAY' | 'NIGHT' } | null;
  };
  currentStatus: 'WORK' | 'DOWNTIME' | 'STOPPED' | 'WASH' | 'DEFROST' | null;
  summary: {
    workDurationMs: number;
    downtimeDurationMs: number;
    stoppedDurationMs: number;
    washDurationMs: number;
    defrostDurationMs: number;
    linkedTaskCount: number;
    averageTaskReactionMs: number | null;
  };
  events: LineTimelineEvent[];
  diagnostics: Array<{ code: string; message: string; count: number }>;
  message?: string | null;
};

type LineDashboardResponse = {
  line: Pick<Line, 'id' | 'name' | 'status' | 'version' | 'operationalState' | 'activeWash' | 'activeDefrost'>;
  assignedCount: number;
  requiredCount: number;
  activeTemplate?: { id: string; name: string } | null;
  structureConfigured: boolean;
  structureMessage: string | null;
  assignmentsByPosition: Array<{
    position: { id: string; name: string; displayName?: string | null };
    assignments: Array<{ id: string; userId: string; displayName: string; startedAt: string }>;
  }>;
  withoutPosition: Array<{ id: string; userId: string; displayName: string; startedAt: string }>;
  activeTasks: LineTaskSummary[];
  activeWash: Array<{ id: string; status: string; createdAt: string }>;
  activeDefrost?: { id: string; status: string; startAt: string } | null;
  recentEvents: Array<{
    id: string;
    status: string;
    humanTitle?: string | null;
    actorName?: string | null;
    occurredAt?: string | null;
    correctedStartAt?: string | null;
    createdAt: string;
  }>;
};

type WorkAreaSummary = {
  id: string;
  name: string;
  assignmentKind: 'TIME' | 'WORK_AREA';
  shortageSummary: Array<{
    workAreaPositionId: string;
    title: string;
    plannedCount: number;
    required: number;
    actual: number;
    missing: number;
  }>;
};

function timelineDuration(value?: number | null) {
  if (value === null || value === undefined) return 'нет данных';
  const minutes = Math.max(0, Math.round(value / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${minutes} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function timelineTime(value?: string | null) {
  if (!value) return 'время не указано';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function timelineDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function timelineEventClass(kind: string) {
  if (kind.includes('WASH')) return 'wash';
  if (kind.includes('DEFROST')) return 'defrost';
  if (kind.includes('DOWNTIME')) return 'downtime';
  if (kind.includes('STOP')) return 'stopped';
  if (kind.includes('TASK')) return 'task';
  if (kind.includes('ASSIGNMENT')) return 'assignment';
  return 'work';
}

function statusDescription(status: LineStatus) {
  if (status === 'STOP') return 'Остановка уберет линию из активного списка и сохранится в истории. Укажите причину.';
  if (status === 'PAUSE') return 'Простой требует комментарий, чтобы следующая смена понимала причину.';
  return 'Линия будет добавлена в текущую смену со статусом «Работает».';
}

function openWashScreen(sessionId?: string) {
  if (sessionId) window.sessionStorage.setItem(PENDING_WASH_SESSION_KEY, sessionId);
  window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Wash' } }));
}

function openDefrostScreen() {
  window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Defrost' } }));
}

function openLineAssignmentContext(lineId: string, readOnly: boolean) {
  window.sessionStorage.setItem(PENDING_LINE_ASSIGNMENT_CONTEXT_KEY, JSON.stringify({ lineId, readOnly }));
  window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Shift' } }));
}

function taskCountLabel(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'заявок';
  if (mod10 === 1) return 'заявка';
  if (mod10 >= 2 && mod10 <= 4) return 'заявки';
  return 'заявок';
}

export type SituationTaskReturn = { selectedLineId: string | null };
export function SituationScreen({ taskReturn }: { taskReturn?: SituationTaskReturn } = {}) {
  const { currentUser, lines, washSessions } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionRequestInFlightRef = useRef(false);
  const [serverNowIso, setServerNowIso] = useState<string | null>(null);
  const [downtimeReasons, setDowntimeReasons] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(taskReturn?.selectedLineId ?? null);
  useEffect(() => { if (taskReturn?.selectedLineId) void loadLineDetail(taskReturn.selectedLineId); }, []);
  const [showInactivePicker, setShowInactivePicker] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [runtimeStats, setRuntimeStats] = useState<any | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [timeline, setTimeline] = useState<LineTimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [lineDetail, setLineDetail] = useState<LineDashboardResponse | null>(null);
  const [lineDetailLoading, setLineDetailLoading] = useState(false);
  const [workAreas, setWorkAreas] = useState<WorkAreaSummary[]>([]);
  const canManageLines = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('lines.manage'));
  const canManageAssignments = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('assignments.manage'));
  const canReadWash = Boolean(
    currentUser?.isAdmin
    || currentUser?.permissions.includes('wash.read')
    || currentUser?.permissions.includes('wash.manage'),
  );
  const canReadDefrost = Boolean(
    currentUser?.isAdmin
    || currentUser?.permissions.includes('defrost.read')
    || currentUser?.permissions.includes('defrost.manage'),
  );
  const hasOpenLineLayer = Boolean(selectedLineId || showInactivePicker || timeline || timelineLoading || runtimeStats);
  useBodyScrollLock(hasOpenLineLayer);
  useMobileBackLayer(Boolean(selectedLineId) && !timeline && !runtimeStats && !pendingAction, () => setSelectedLineId(null), 680);
  useMobileBackLayer(showInactivePicker && !pendingAction, () => setShowInactivePicker(false), 700);
  useMobileBackLayer(Boolean(runtimeStats), () => setRuntimeStats(null), 740);
  useMobileBackLayer(Boolean(timeline || timelineLoading), () => closeLineTimeline(), 760);

  const loadRemoteData = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    if (!options?.silent) setErrorText(null);
    try {
      const linesData = await apiClient.get<Line[]>('/lines');
      const [washResult, workAreasResult, reasonsResult, healthResult] = await Promise.allSettled([
        canReadWash ? apiClient.get<WashSession[]>('/wash') : Promise.resolve([]),
        apiClient.get<WorkAreaSummary[]>('/work-areas'),
        apiClient.get<Array<{ value: string; label: string }>>('/lines/downtime-reasons'),
        apiClient.get<{ timestamp: string }>('/health'),
      ]);
      const washesData = washResult.status === 'fulfilled' ? washResult.value : [];
      const workAreasData = workAreasResult.status === 'fulfilled' ? workAreasResult.value : [];
      const cleanLines = linesData.filter((line) => !isPilotFixtureText(line.name, line.id));
      appStore.setLines(cleanLines);
      appStore.setWashSessions(washesData.filter((wash) => wash.active && !isPilotFixtureText(wash.id, wash.lineName)));
      setWorkAreas(workAreasData.filter((area) => !isPilotFixtureText(area.id, area.name)));
      if (reasonsResult.status === 'fulfilled') setDowntimeReasons(reasonsResult.value);
      if (healthResult.status === 'fulfilled' && healthResult.value.timestamp) setServerNowIso(healthResult.value.timestamp);
      if (!options?.silent && (washResult.status === 'rejected' || workAreasResult.status === 'rejected')) {
        setErrorText('Линии загружены. Часть дополнительных данных сейчас недоступна.');
      }
    } catch (error) {
      if (!options?.silent) {
        appStore.setLines([]);
        appStore.setWashSessions([]);
        setWorkAreas([]);
      }
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить данные линий.');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  useEffect(() => { void loadRemoteData(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void apiClient.get<{ timestamp: string }>('/health')
        .then((health) => { if (health.timestamp) setServerNowIso(health.timestamp); })
        .catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const refreshOperationalData = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void loadRemoteData({ silent: true }), 60);
    };
    window.addEventListener('zavod:operational-data-invalidated', refreshOperationalData);
    return () => {
      window.removeEventListener('zavod:operational-data-invalidated', refreshOperationalData);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, []);

  const activeWashSessions = useMemo(() => washSessions.filter((wash) => wash.active), [washSessions]);
  const washLines = useMemo(() => lines.filter((line) => line.operationalState === 'WASH'), [lines]);
  const defrostLines = useMemo(() => lines.filter((line) => line.operationalState === 'DEFROST'), [lines]);
  const washLineIds = useMemo(() => new Set(washLines.map((line) => line.id)), [washLines]);
  const activeLineWashSessions = useMemo(
    () => activeWashSessions.filter((wash) => Boolean(wash.lineId) && washLineIds.has(wash.lineId!)),
    [activeWashSessions, washLineIds],
  );

  const downtimeLines = useMemo(() => lines.filter((line) => line.operationalState === 'DOWNTIME'), [lines]);
  const workingLines = useMemo(() => lines.filter((line) => line.operationalState === 'RUNNING'), [lines]);
  const stoppedLines = useMemo(() => lines.filter((line) => line.operationalState === 'STOPPED'), [lines]);
  const selectedLine = lines.find((line) => line.id === selectedLineId) ?? null;
  const selectedWash = selectedLine ? washSessions.find((wash) => wash.lineId === selectedLine.id) : null;
  const selectedLineHasPrimaryAction = Boolean(selectedLine && (
    selectedLine.operationalState === 'STOPPED'
    || selectedLine.operationalState === 'DOWNTIME'
    || selectedLine.operationalState === 'WASH'
    || selectedLine.operationalState === 'DEFROST'
  ));
  const workAreaCards = useMemo(() => workAreas.map((area) => {
    const required = area.shortageSummary.reduce((sum, item) => sum + item.required, 0);
    const planned = area.shortageSummary.reduce((sum, item) => sum + item.plannedCount, 0);
    const assigned = area.shortageSummary.reduce((sum, item) => sum + item.actual, 0);
    const deficit = area.shortageSummary.reduce((sum, item) => sum + item.missing, 0);
    const surplus = area.shortageSummary.reduce((sum, item) => sum + Math.max(item.actual - item.required, 0), 0);
    return {
      ...area,
      required,
      planned,
      assigned,
      free: Math.max(planned - assigned, 0),
      deficit,
      surplus,
      statusLabel: deficit > 0 ? 'Нехватка' : assigned >= planned && planned > 0 ? 'Укомплектована' : 'Есть свободные места',
      statusTone: deficit > 0 ? 'stop' : assigned >= planned && planned > 0 ? 'work' : 'pause',
    };
  }), [workAreas]);
  const workerCount = new Set(workingLines.flatMap((line) => line.activeAssignments?.map((assignment) => assignment.userId) ?? [])).size
    || workingLines.reduce((total, line) => total + (line.assignedCount ?? 0), 0);

  const loadLineDetail = async (lineId: string) => {
    setLineDetailLoading(true);
    setLineDetail(null);
    setErrorText(null);
    try {
      setLineDetail(await apiClient.get<LineDashboardResponse>(`/lines/${lineId}/dashboard`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось открыть подробности линии.');
    } finally {
      setLineDetailLoading(false);
    }
  };

  const openLineDetail = (line: Line) => {
    setSelectedLineId(line.id);
    void loadLineDetail(line.id);
  };

  const closeLineDetail = () => {
    setSelectedLineId(null);
    setLineDetail(null);
  };

  const openTask = (taskId: string) => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: {
      screen: 'Tasks', taskId, taskReturn: { selectedLineId } satisfies SituationTaskReturn,
    } }));
  };

  const openPendingAction = (action: Exclude<PendingAction, null>) => {
    setPendingAction(action);
    setErrorText(null);
    void apiClient.get<{ timestamp: string }>('/health')
      .then((health) => { if (health.timestamp) setServerNowIso(health.timestamp); })
      .catch(() => undefined);
  };

  const updateStatus = async (line: Line, status: LineStatus, comment?: string, downtimeReason?: string | null, effectiveAt?: string | null) => {
    setErrorText(null);
    await apiClient.patch(`/lines/${line.id}/status`, {
      status,
      comment,
      downtimeReason: downtimeReason || undefined,
      ...(typeof line.version === 'number' ? { expectedVersion: line.version } : {}),
      ...(effectiveAt ? { effectiveAt } : {}),
    });
    await loadRemoteData();
  };

  const confirmAction = async (values: Record<string, string | boolean>) => {
    if (!pendingAction) return;
    const status = pendingAction.mode === 'start' ? 'WORK' : pendingAction.status;
    const comment = String(values.comment ?? '').trim();
    const downtimeReason = String(values.downtimeReason ?? '').trim();
    if ((status === 'PAUSE' || status === 'STOP') && !comment) {
      setErrorText('Комментарий обязателен для простоя или остановки линии.');
      return;
    }
    if ((status === 'PAUSE' || status === 'STOP') && !downtimeReason) {
      setErrorText(downtimeReasons.length ? 'Выберите причину простоя.' : 'Список причин сейчас недоступен. Обновите экран и повторите действие.');
      return;
    }
    const effectiveMode = values.effectiveMode === 'CUSTOM' ? 'CUSTOM' : 'NOW';
    const effectiveAt = effectiveMode === 'CUSTOM' ? factoryDateTimeInputToIso(String(values.effectiveAt ?? '')) : null;
    if (effectiveMode === 'CUSTOM' && !effectiveAt) {
      setErrorText('Укажите корректное фактическое время события.');
      return;
    }
    if (actionRequestInFlightRef.current) return;
    actionRequestInFlightRef.current = true;
    setActionBusy(true);
    try {
      await updateStatus(pendingAction.line, status, comment || undefined, downtimeReason || null, effectiveAt);
      setSelectedLineId(pendingAction.line.id);
      await loadLineDetail(pendingAction.line.id);
      setPendingAction(null);
      setShowInactivePicker(false);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось изменить состояние линии. Повторите действие.');
    } finally {
      actionRequestInFlightRef.current = false;
      setActionBusy(false);
    }
  };

  const openRuntimeStats = async (line: Line) => {
    setStatsLoading(true);
    setErrorText(null);
    try {
      setRuntimeStats(await apiClient.get<any>(`/lines/${line.id}/dashboard`));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось открыть статистику линии.');
    } finally {
      setStatsLoading(false);
    }
  };

  const openLineTimeline = async (
    line: Pick<Line, 'id' | 'name'>,
    target?: { shiftDate: string; shiftType: 'DAY' | 'NIGHT' } | null,
    persist = true,
  ) => {
    setTimelineLoading(true);
    setErrorText(null);
    try {
      const params = target ? `?shiftDate=${encodeURIComponent(target.shiftDate)}&shiftType=${target.shiftType}` : '';
      const data = await apiClient.get<LineTimelineResponse>(`/lines/${line.id}/timeline${params}`);
      setTimeline(data);
      if (persist) {
        window.sessionStorage.setItem(PENDING_LINE_TIMELINE_KEY, JSON.stringify({ lineId: line.id, lineName: line.name, shiftDate: data.shift.shiftDate, shiftType: data.shift.shiftType }));
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось открыть историю линии.');
    } finally {
      setTimelineLoading(false);
    }
  };

  const closeLineTimeline = () => {
    window.sessionStorage.removeItem(PENDING_LINE_TIMELINE_KEY);
    setTimeline(null);
  };

  const openTimelineSource = (event: LineTimelineEvent) => {
    if (!event.canOpen) return;
    if (event.sourceType === 'TASK') {
      openTask(event.sourceId);
      return;
    }
    if (event.sourceType === 'WASH_SESSION') {
      openWashScreen(event.sourceId);
      return;
    }
    if (event.sourceType === 'DEFROST_EVENT') {
      window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Defrost' } }));
      return;
    }
    if (event.sourceType === 'ASSIGNMENT') {
      window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'People' } }));
    }
  };

  useEffect(() => {
    const raw = window.sessionStorage.getItem(PENDING_LINE_TIMELINE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { lineId?: string; lineName?: string; shiftDate?: string; shiftType?: 'DAY' | 'NIGHT' };
      if (!saved.lineId || !saved.shiftDate || !saved.shiftType) return;
      void openLineTimeline(
        { id: saved.lineId, name: saved.lineName || 'Линия' },
        { shiftDate: saved.shiftDate, shiftType: saved.shiftType },
        false,
      );
    } catch {
      window.sessionStorage.removeItem(PENDING_LINE_TIMELINE_KEY);
    }
  }, []);

  const renderLineCard = (line: Line, section: 'downtime' | 'work' | 'defrost' | 'stopped' = 'work') => {
    const meta = line.operationalState ? operationalStatusMeta[line.operationalState] : statusMeta.STOP;
    const downtime = line.activeDowntimeEvent;
    const task = line.activeTaskSummary;
    const taskSummary = task
      ? task.hasAssignee && task.assigneeDisplayName
        ? `${task.serviceLabel || 'Исполнитель'} — ${task.assigneeDisplayName}`
        : `${task.serviceLabel || 'Служба'} — ожидает исполнителя`
      : null;
    return (
      <article className={`line-card ${section === 'downtime' ? 'status-pause line-card-downtime' : section === 'defrost' ? 'status-defrost line-card-defrost' : section === 'stopped' ? 'status-stop line-card-stopped' : meta.className}`} key={line.id}>
        <div className="line-title-row">
          <button className="link-button" type="button" onClick={() => openLineDetail(line)}>
            <h3 className="line-name">{line.name}</h3>
          </button>
          <span className={`tag ${section === 'downtime' ? 'pause' : section === 'defrost' ? 'defrost' : section === 'stopped' ? 'stop' : meta.tagClass}`}>
            {section === 'downtime' ? 'Простой' : section === 'defrost' ? 'На оттайке' : section === 'stopped' ? 'Остановлена' : meta.label}
          </span>
        </div>
        <div className="line-meta">
          <span className="tag">Людей: {line.activeWorkersCount ?? 0}</span>
          {section === 'downtime' ? <span className="tag pause">С начала: {factoryShortDateTimeLabel(downtime?.correctedStartAt ?? downtime?.createdAt)}</span> : null}
          {section === 'downtime' ? <span className="tag pause">Длится: {factoryDurationLabel(downtime?.correctedStartAt ?? downtime?.createdAt, serverNowIso)}</span> : null}
          {section === 'defrost' ? <span className="tag defrost">С начала: {factoryShortDateTimeLabel(line.activeDefrost?.startAt)}</span> : null}
          {section === 'defrost' ? <span className="tag defrost">Длится: {factoryDurationLabel(line.activeDefrost?.startAt, serverNowIso)}</span> : null}
          {section === 'stopped' ? <span className="tag stop">Ожидает запуска</span> : null}
        </div>
        {section === 'downtime' ? (
          <div className="line-downtime-note">
            <strong>{downtime?.downtimeReasonLabel || 'Причина не указана'}</strong>
            <span>{downtime?.comment || 'Комментарий не указан'}</span>
          </div>
        ) : null}
        {section === 'defrost' && line.activeDefrost?.comment ? <div className="line-downtime-note"><span>{line.activeDefrost.comment}</span></div> : null}
        {taskSummary ? (
          <div className={`line-task-summary ${task?.hasAssignee ? 'assigned' : 'waiting'}`}>
            <span className="line-task-summary-label">Активная заявка</span>
            <strong>{taskSummary}</strong>
            <span>{task?.taskStatusLabel}{task?.additionalActiveCount ? ` · + ещё ${task.additionalActiveCount} ${taskCountLabel(task.additionalActiveCount)}` : ''}</span>
          </div>
        ) : null}
        <div className="action-grid">
          {canManageLines && (line.operationalState === 'DOWNTIME' || line.operationalState === 'STOPPED') ? <button className="action-button work" type="button" onClick={() => openPendingAction({ mode: 'status', line, status: 'WORK' })}>Вернуть в работу</button> : null}
          {canManageLines && line.operationalState === 'RUNNING' ? <button className="action-button pause" type="button" onClick={() => openPendingAction({ mode: 'status', line, status: 'PAUSE' })}>Простой</button> : null}
          {canManageLines && line.operationalState === 'RUNNING' ? <button className="action-button stop" type="button" onClick={() => openPendingAction({ mode: 'status', line, status: 'STOP' })}>Остановить</button> : null}
          {line.operationalState === 'DEFROST' && canReadDefrost ? <button className="action-button" type="button" onClick={openDefrostScreen}>Открыть оттайку</button> : null}
          <button className="secondary-button" type="button" onClick={() => openLineDetail(line)}>Подробнее</button>
        </div>
      </article>
    );
  };

  const renderWashCard = (wash: WashSession) => {
    const openIssues = wash.issues?.filter((issue) => issue.status !== 'RESOLVED').length ?? 0;
    const openTasks = wash.controlItems?.filter((item) => !['DONE', 'CANCELLED'].includes(String(item.status))).length ?? 0;
    const line = lines.find((item) => item.id === wash.lineId);
    return (
      <article className="line-card status-wash line-card-wash" key={wash.id}>
        <div className="line-title-row">
          <div>
            <h3 className="line-name">{wash.lineName || 'Мойка без линии'}</h3>
            <div className="line-meta">
              <span className="tag wash">На мойке</span>
              {wash.lifecycleLabel && wash.lifecycleLabel !== 'Мойка идет' ? <span className="tag pause">{wash.lifecycleLabel}</span> : null}
              <span className="tag">Начало: {factoryShortDateTimeLabel(wash.createdAt)}</span>
              {wash.startedByName ? <span className="tag">Начал: {wash.startedByName}</span> : null}
            </div>
          </div>
        </div>
        {wash.objectDescription ? <div className="worker-list">{wash.objectDescription}</div> : null}
        <div className="line-meta">
          <span className="tag wash">Проблем: {openIssues}</span>
          <span className="tag wash">Заданий: {openTasks}</span>
          {wash.targetType === 'OTHER' ? <span className="tag">Объект без линии</span> : null}
        </div>
        <div className="action-grid">
          <button className="action-button" type="button" onClick={() => openWashScreen(wash.id)}>Открыть мойку</button>
          {line ? <button className="secondary-button" type="button" onClick={() => openLineDetail(line)}>Подробнее</button> : null}
        </div>
      </article>
    );
  };

  return (
    <section className="screen-panel">
      <PremiumSectionHeader
        title="Линии"
        subtitle="Рабочее состояние линий смены, люди на местах, простои и быстрый переход к активной мойке."
      />
      {errorText ? (
        <div className="empty-state error-state">
          {errorText}
          <button className="secondary-button" type="button" onClick={() => void loadRemoteData()}>Повторить</button>
        </div>
      ) : null}

      {loading ? <div className="empty-state">Загрузка линий...</div> : null}
      {!loading ? (
        <>
          <PremiumKpiStrip
            className="line-filter-metrics"
            items={[
              { label: 'Простой', value: downtimeLines.length, icon: '∿', tone: 'danger' },
              { label: 'В работе', value: workingLines.length, icon: 'Ⅱ', tone: 'success' },
              { label: 'Мойка', value: washLines.length, icon: '◎', tone: 'cool' },
              { label: 'Оттайка', value: defrostLines.length, icon: '◌', tone: 'cool' },
              { label: 'Назначены', value: workerCount, icon: '☷', tone: 'muted' },
            ]}
          />

          <div className="lines-state-layout">
            <section className="line-state-section downtime">
              <div className="line-state-header">
                <div>
                  <span className="section-kicker">Красная зона</span>
                  <h3>Простой — {downtimeLines.length}</h3>
                </div>
              </div>
              <div className="section-stack">
                {downtimeLines.length ? downtimeLines.map((line) => renderLineCard(line, 'downtime')) : <div className="empty-state compact">Сейчас линий в простое нет.</div>}
              </div>
            </section>

            <section className="line-state-section work">
              <div className="line-state-header">
                <div>
                  <span className="section-kicker">Рабочая зона</span>
                  <h3>Линии в работе — {workingLines.length}</h3>
                </div>
              </div>
              <div className="section-stack">
                {workingLines.length ? workingLines.map((line) => renderLineCard(line, 'work')) : <div className="empty-state compact">Работающих линий сейчас нет.</div>}
              </div>
            </section>

            <section className="line-state-section wash">
              <div className="line-state-header">
                <div>
                  <span className="section-kicker">Отдельная процедура</span>
                  <h3>Производится мойка — {washLines.length}</h3>
                </div>
                <button className="secondary-button" type="button" onClick={() => openWashScreen()}>Открыть раздел мойки</button>
              </div>
              <div className="section-stack">
                {activeLineWashSessions.length ? activeLineWashSessions.map(renderWashCard) : <div className="empty-state compact">Сейчас мойка линий не ведётся.</div>}
              </div>
            </section>

            <section className="line-state-section defrost">
              <div className="line-state-header">
                <div>
                  <span className="section-kicker">Холодильная служба</span>
                  <h3>На оттайке — {defrostLines.length}</h3>
                </div>
                {canReadDefrost ? <button className="secondary-button" type="button" onClick={openDefrostScreen}>Открыть раздел оттайки</button> : null}
              </div>
              <div className="section-stack">
                {defrostLines.length ? defrostLines.map((line) => renderLineCard(line, 'defrost')) : <div className="empty-state compact">Сейчас линий на оттайке нет.</div>}
              </div>
            </section>

            <details className="line-state-section stopped" open={stoppedLines.length > 0}>
              <summary>
                <span>Остановленные линии — {stoppedLines.length}</span>
                {canManageLines ? <button className="primary-button compact-action" type="button" onClick={(event) => { event.preventDefault(); setShowInactivePicker(true); }}>Запустить новую линию</button> : null}
              </summary>
              <div className="section-stack">
                {stoppedLines.length ? stoppedLines.map((line) => renderLineCard(line, 'stopped')) : <div className="empty-state compact">Остановленных линий без мойки сейчас нет.</div>}
              </div>
            </details>
          </div>

          <section className="line-state-section work-area-summary-section" data-testid="lines-work-area-summary">
            <div className="line-state-header">
              <div>
                <span className="section-kicker">Рабочие зоны</span>
                <h3>Повременщики и рабочие зоны — {workAreaCards.length}</h3>
              </div>
              <span className="tag">Не входят в KPI линий</span>
            </div>
            <div className="dashboard-grid">
              {workAreaCards.map((area) => (
                <article className="card compact-card" key={area.id}>
                  <div className="line-title-row">
                    <div>
                      <h4>{area.name}</h4>
                      <span>{area.assignmentKind === 'TIME' ? 'Повременщики' : 'Рабочая зона'}</span>
                    </div>
                    <span className={`tag ${area.statusTone}`}>{area.statusLabel}</span>
                  </div>
                  <div className="line-meta">
                    <span className="tag">Нужно: {area.required}</span>
                    <span className="tag">Назначено: {area.assigned}</span>
                    <span className={`tag ${area.deficit > 0 ? 'stop' : 'work'}`}>Не хватает: {area.deficit}</span>
                  </div>
                </article>
              ))}
              {!workAreaCards.length ? <div className="empty-state compact">Рабочие зоны для этого завода не настроены.</div> : null}
            </div>
          </section>

          {selectedLine && !pendingAction && !timeline && !timelineLoading && !runtimeStats ? (
            <div className="modal-backdrop line-detail-backdrop" role="dialog" aria-modal="true" aria-label={`Подробнее о линии ${selectedLine.name}`}>
              <div className="modal-card line-dashboard-card line-detail-inline-card">
                <div className="line-detail-header">
                  <div>
                    <span className="section-kicker">Состояние линии</span>
                    <h3 className="line-name">{selectedLine.name}</h3>
                    <div className="line-meta">
                      <span className={`tag ${selectedLine.operationalState ? operationalStatusMeta[selectedLine.operationalState].tagClass : ''}`}>
                        {selectedLine.operationalState ? operationalStatusMeta[selectedLine.operationalState].label : 'Состояние обновляется'}
                      </span>
                    </div>
                  </div>
                  <button className="secondary-button compact-action" type="button" onClick={closeLineDetail}>Закрыть</button>
                </div>

                {lineDetailLoading ? <div className="empty-state compact">Загрузка подробностей...</div> : null}
                {lineDetail ? (
                  <div className="line-detail-content">
                    <section className="premium-detail-section line-detail-people">
                      <div className="section-subhead">
                        <h4>Состав и люди</h4>
                        <span>{lineDetail.assignedCount}/{lineDetail.requiredCount || '—'}</span>
                      </div>
                      <div className="line-detail-list">
                        {lineDetail.activeTemplate ? <div className="line-meta"><span className="tag">Утверждённый состав: {lineDetail.activeTemplate.name}</span></div> : null}
                        {!lineDetail.structureConfigured ? (
                          <div className="empty-state compact">
                            <span>{lineDetail.structureMessage || 'Состав линии не настроен'}</span>
                            {canManageAssignments ? <button className="secondary-button compact-action" type="button" onClick={() => openLineAssignmentContext(selectedLine.id, false)}>Настроить состав</button> : null}
                          </div>
                        ) : null}
                        {lineDetail.assignmentsByPosition.map((group) => (
                          <div className="line-detail-row" key={group.position.id}>
                            <strong>{group.position.displayName ?? group.position.name}</strong>
                            <span>{group.assignments.map((item) => item.displayName).join(', ') || 'Позиция свободна'}</span>
                          </div>
                        ))}
                        {lineDetail.withoutPosition.length ? (
                          <div className="line-detail-row">
                            <strong>Без позиции</strong>
                            <span>{lineDetail.withoutPosition.map((item) => item.displayName).join(', ')}</span>
                          </div>
                        ) : null}
                        {lineDetail.structureConfigured && !lineDetail.assignmentsByPosition.length && !lineDetail.withoutPosition.length ? <div className="empty-state compact">На линии пока нет назначенных сотрудников.</div> : null}
                      </div>
                    </section>

                    <section className="premium-detail-section line-detail-last-event">
                      <div className="section-subhead"><h4>Последнее событие</h4></div>
                      {lineDetail.recentEvents[0] ? (
                        <div className="line-last-event">
                          <strong>{lineDetail.recentEvents[0].humanTitle || 'Событие линии'}</strong>
                          <span>{factoryDateTimeLabel(lineDetail.recentEvents[0].occurredAt ?? lineDetail.recentEvents[0].correctedStartAt ?? lineDetail.recentEvents[0].createdAt)}
                            {lineDetail.recentEvents[0].actorName ? ` · ${lineDetail.recentEvents[0].actorName}` : ''}
                          </span>
                        </div>
                      ) : <div className="empty-state compact">Событий по линии пока нет.</div>}
                    </section>

                    <section className="premium-detail-section line-detail-tasks">
                      <div className="section-subhead">
                        <h4>Активные заявки</h4>
                        <span>{lineDetail.activeTasks.length}</span>
                      </div>
                      <div className="line-detail-list">
                        {lineDetail.activeTasks.map((task) => (
                          <div className="line-detail-task" key={task.taskId}>
                            <div>
                              <strong>{task.serviceLabel || 'Служба не указана'}{task.assigneeDisplayName ? ` — ${task.assigneeDisplayName}` : ''}</strong>
                              <span>{task.sourceLabel} · {task.taskTypeLabel} · {task.taskStatusLabel}</span>
                              <small>{task.taskStatus === 'IN_PROGRESS' ? `В работе ${factoryDurationLabel(task.startedAt ?? task.createdAt, serverNowIso)}` : `Ожидает ${factoryDurationLabel(task.createdAt, serverNowIso)}`}</small>
                            </div>
                            {task.canOpen ? <button className="secondary-button compact-action" type="button" onClick={() => openTask(task.taskId)}>Открыть заявку</button> : null}
                          </div>
                        ))}
                        {!lineDetail.activeTasks.length ? <div className="empty-state compact">Доступных вам активных заявок по линии нет.</div> : null}
                      </div>
                    </section>

                    <section className="premium-detail-section line-detail-state">
                      <div className="section-subhead"><h4>Текущее состояние</h4></div>
                      <div className="line-state-summary">
                        <span className={`tag ${selectedLine.operationalState ? operationalStatusMeta[selectedLine.operationalState].tagClass : ''}`}>
                          Линия: {selectedLine.operationalState ? operationalStatusMeta[selectedLine.operationalState].label : 'состояние обновляется'}
                        </span>
                        <span className={`tag ${selectedLine.operationalState === 'WASH' ? 'wash' : ''}`}>Мойка: {selectedLine.operationalState === 'WASH' ? 'идёт' : 'нет'}</span>
                        <span className={`tag ${lineDetail.activeDefrost ? 'pause' : ''}`}>Оттайка: {lineDetail.activeDefrost ? 'активна' : 'нет'}</span>
                      </div>
                    </section>
                  </div>
                ) : null}

                <div className="detail-sticky-actions">
                  {canManageLines && (selectedLine.operationalState === 'STOPPED' || selectedLine.operationalState === 'DOWNTIME') ? (
                    <button className="primary-button" type="button" onClick={() => openPendingAction({ mode: 'status', line: selectedLine, status: 'WORK' })}>Вернуть в работу</button>
                  ) : null}
                  {selectedLine.operationalState === 'WASH' ? (
                    <button className="primary-button" type="button" onClick={() => openWashScreen(selectedWash?.id ?? selectedLine.activeWash?.id)}>Открыть мойку</button>
                  ) : null}
                  {selectedLine.operationalState === 'DEFROST' && canReadDefrost ? (
                    <button className="primary-button" type="button" onClick={openDefrostScreen}>Открыть оттайку</button>
                  ) : null}
                  <button className={selectedLineHasPrimaryAction ? 'secondary-button' : 'primary-button'} type="button" onClick={() => openLineAssignmentContext(selectedLine.id, !canManageAssignments)}>Состав и люди</button>
                  <button className="secondary-button" type="button" onClick={() => void openLineTimeline(selectedLine)}>История линии</button>
                  <button className="secondary-button" type="button" onClick={() => void openRuntimeStats(selectedLine)}>Текущее состояние</button>
                  <button className="secondary-button" type="button" disabled={lineDetailLoading} onClick={() => void loadLineDetail(selectedLine.id)}>Обновить</button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {showInactivePicker && !pendingAction ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>Запустить новую линию</h3>
            <p>Выберите остановленную линию, которую нужно вернуть в работу.</p>
            <div className="section-stack">
              {stoppedLines.length ? stoppedLines.map((line) => (
                <button className="secondary-button" key={line.id} type="button" onClick={() => openPendingAction({ mode: 'start', line })}>
                  {line.name}
                </button>
              )) : <div className="empty-state compact">Остановленных линий нет.</div>}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setShowInactivePicker(false)}>Отмена</button>
            </div>
          </div>
        </div>
      ) : null}

      {timeline || timelineLoading ? (
        <div className="modal-backdrop line-timeline-backdrop" role="dialog" aria-modal="true" aria-label="История линии">
          <div className="modal-card line-timeline-modal">
            <div className="modal-header line-timeline-header">
              <div>
                <span className="section-kicker">История линии</span>
                <h3>{timeline?.line.name ?? 'Загружаю линию...'}</h3>
                {timeline ? <span>{timeline.shift.shiftType === 'NIGHT' ? 'Ночная' : 'Дневная'} смена · {timelineDate(timeline.shift.shiftDate)}</span> : null}
              </div>
              <div className="line-timeline-header-actions">
                {timeline ? <button className="secondary-button compact-action" type="button" disabled={timelineLoading} onClick={() => void openLineTimeline(timeline.line, { shiftDate: timeline.shift.shiftDate, shiftType: timeline.shift.shiftType })}>Обновить</button> : null}
                <button className="secondary-button compact-action" type="button" onClick={closeLineTimeline}>Закрыть окно</button>
              </div>
            </div>

            {timeline ? (
              <div className="line-timeline-scroll">
                <div className="line-timeline-picker">
                  <button aria-label="Предыдущая смена" className="secondary-button line-period-arrow" title="Предыдущая смена" type="button" disabled={timelineLoading} onClick={() => void openLineTimeline(timeline.line, timeline.navigation.previous)}>←</button>
                  <label>
                    <span className="visually-hidden">Дата смены</span>
                    <input
                      type="date"
                      value={timeline.shift.shiftDate}
                      disabled={timelineLoading}
                      onChange={(event) => void openLineTimeline(timeline.line, { shiftDate: event.target.value, shiftType: timeline.shift.shiftType })}
                    />
                  </label>
                  <button aria-label="Следующая смена" className="secondary-button line-period-arrow" title="Следующая смена" type="button" disabled={timelineLoading || !timeline.navigation.next} onClick={() => timeline.navigation.next && void openLineTimeline(timeline.line, timeline.navigation.next)}>→</button>
                  <div className="segmented-control" role="group" aria-label="Тип смены">
                    <button type="button" aria-pressed={timeline.shift.shiftType === 'DAY'} disabled={timelineLoading} onClick={() => void openLineTimeline(timeline.line, { shiftDate: timeline.shift.shiftDate, shiftType: 'DAY' })}>День</button>
                    <button type="button" aria-pressed={timeline.shift.shiftType === 'NIGHT'} disabled={timelineLoading} onClick={() => void openLineTimeline(timeline.line, { shiftDate: timeline.shift.shiftDate, shiftType: 'NIGHT' })}>Ночь</button>
                  </div>
                </div>

                <div className="metric-grid line-timeline-summary">
                  <div className="metric-card success"><div className="metric-label">Работа</div><div className="metric-value compact-value">{timelineDuration(timeline.summary.workDurationMs)}</div></div>
                  <div className="metric-card danger"><div className="metric-label">Простой</div><div className="metric-value compact-value">{timelineDuration(timeline.summary.downtimeDurationMs)}</div></div>
                  <div className="metric-card muted"><div className="metric-label">Остановка</div><div className="metric-value compact-value">{timelineDuration(timeline.summary.stoppedDurationMs)}</div></div>
                  <div className="metric-card"><div className="metric-label">Мойка</div><div className="metric-value compact-value">{timelineDuration(timeline.summary.washDurationMs)}</div></div>
                  <div className="metric-card"><div className="metric-label">Оттайка</div><div className="metric-value compact-value">{timelineDuration(timeline.summary.defrostDurationMs)}</div></div>
                  <div className="metric-card"><div className="metric-label">Связанные заявки</div><div className="metric-value compact-value">{timeline.summary.linkedTaskCount}</div></div>
                  <div className="metric-card"><div className="metric-label">Средняя реакция</div><div className="metric-value compact-value">{timelineDuration(timeline.summary.averageTaskReactionMs)}</div></div>
                </div>

                {timeline.diagnostics.map((diagnostic) => (
                  <div className="empty-state compact warning-state" key={diagnostic.code}>{diagnostic.message} Проверьте последовательность событий.</div>
                ))}
                {timeline.message ? <div className="empty-state compact">{timeline.message}</div> : null}
                <div className="line-timeline-list">
                  {timeline.events.map((event) => {
                    const interval = Boolean(event.endedAt && event.durationMs > 0);
                    return (
                      <article className={`line-timeline-event ${timelineEventClass(event.kind)} ${interval ? 'interval' : 'marker'}`} key={event.id}>
                        <div className="line-timeline-rail" aria-hidden="true"><span /></div>
                        <div className="line-timeline-event-body">
                          <div className="line-timeline-event-heading">
                            <span className="line-timeline-time">
                              {timelineTime(event.occurredAt)}{interval ? `–${timelineTime(event.endedAt)}` : ''}
                            </span>
                            {interval ? <span className="tag">{timelineDuration(event.durationMs)}</span> : null}
                          </div>
                          <strong>{event.title}</strong>
                          {event.downtimeReasonLabel ? <span>Причина: {event.downtimeReasonLabel}</span> : null}
                          {event.comment ? <span>Комментарий: {event.comment}</span> : !event.downtimeReasonLabel && event.description ? <span>{event.description}</span> : null}
                          {event.actorName ? <span>Ответственный: {event.actorName}</span> : null}
                          {event.sourceType === 'TASK' && event.linkedToDowntime ? <span className="tag pause">Связана с простоем</span> : null}
                          {event.sourceType === 'TASK' && event.responseMs !== null && event.responseMs !== undefined ? <span>Реакция: {timelineDuration(event.responseMs)}</span> : null}
                          {event.canOpen ? <button className="secondary-button compact-action" type="button" onClick={() => openTimelineSource(event)}>Открыть</button> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : <div className="empty-state">Загружаю историю линии...</div>}
          </div>
        </div>
      ) : null}

      {runtimeStats ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-dashboard-card line-stats-modal">
            <div className="modal-header">
              <h3>Текущее состояние: {runtimeStats.line?.name ?? 'линия'}</h3>
              <button className="secondary-button" type="button" disabled={statsLoading} onClick={() => setRuntimeStats(null)}>Закрыть окно</button>
            </div>
            {statsLoading ? <div className="empty-state compact">Загружаю статистику...</div> : null}
            <div className="metric-grid">
              <div className="metric-card"><div className="metric-label">Людей на линии</div><div className="metric-value">{runtimeStats.assignments?.length ?? 0}</div></div>
              <div className="metric-card"><div className="metric-label">Заявки</div><div className="metric-value">{runtimeStats.activeTasks?.length ?? 0}</div></div>
              <div className="metric-card"><div className="metric-label">Мойка</div><div className="metric-value">{runtimeStats.activeWash?.length ?? 0}</div></div>
              <div className="metric-card"><div className="metric-label">События</div><div className="metric-value">{runtimeStats.recentEvents?.length ?? 0}</div></div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingAction ? (
        <ActionModal
          title={pendingAction.mode === 'start' || pendingAction.status === 'WORK' ? 'Вернуть в работу' : `Изменить статус: ${statusMeta[pendingAction.status].label}`}
          description={`${pendingAction.line.name}. ${statusDescription(pendingAction.mode === 'start' ? 'WORK' : pendingAction.status)}`}
          fields={[
            {
              name: 'effectiveMode',
              label: 'Время события',
              type: 'select',
              defaultValue: 'NOW',
              required: true,
              options: [
                { label: 'Сейчас', value: 'NOW' },
                { label: 'Указать фактическое время', value: 'CUSTOM' },
              ],
            },
            {
              name: 'effectiveAt',
              label: 'Фактическое время',
              type: 'datetime-local',
              defaultValue: factoryDateTimeInput(serverNowIso),
            },
            ...(pendingAction.mode !== 'start' && (pendingAction.status === 'PAUSE' || pendingAction.status === 'STOP') ? [{
              name: 'downtimeReason',
              label: 'Причина простоя',
              type: 'select' as const,
              required: true,
              defaultValue: downtimeReasons[0]?.value ?? '',
              options: downtimeReasons,
            }] : []),
            {
              name: 'comment',
              label: 'Комментарий',
              type: 'textarea',
              required: pendingAction.mode !== 'start' && (pendingAction.status === 'PAUSE' || pendingAction.status === 'STOP'),
            },
          ]}
          confirmLabel="Подтвердить"
          busy={actionBusy}
          errorText={errorText}
          onCancel={() => setPendingAction(null)}
          onSubmit={confirmAction}
        >
          <div className="empty-state compact">
            Можно указать фактическое время, если событие отметили не сразу. Сервер примет только интервал в пределах 30 минут.
          </div>
        </ActionModal>
      ) : null}
    </section>
  );
}
