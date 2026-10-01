import React, { useEffect, useMemo, useRef, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { apiClient } from '../api/client';
import { createOperationId } from '../api/operation';
import { ActionModal } from '../components/ActionModal';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { CommentBox } from '../components/CommentBox';
import { CommentThread } from '../components/CommentThread';
import { PremiumKpiStrip, PremiumSectionHeader, PremiumSheet } from '../components/PremiumShell';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { displayLabel, roleLabel, taskStatusLabels, taskTypeLabels } from '../labels';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { appStore, Attachment, Task, useAppStore } from '../store/app.store';
import { factoryDateKey } from '../utils/factory-time';
import { shouldHidePilotFixtures } from '../utils/pilot-ui';

type Board = { NEW: Task[]; IN_PROGRESS: Task[]; LONG: Task[]; DONE: Task[] };
type Department = { id: string; name: string; code: string; scope: string };
type Candidate = { userId: string; displayName: string; role: string; departmentName: string | null; employeeState: string };
type LineOption = { id: string; name: string };
type TaskSettings = {
  longTaskDefaultDeadlineHours: number | null;
  longTaskEscalationEnabled: boolean;
  taskRedirectRequiresComment: boolean;
  taskDoneRequiresComment: boolean;
  taskReadReceiptsEnabled: boolean;
  taskAttachmentsEnabled: boolean;
  taskPersonalAssigneeEnabled: boolean;
};
type TaskArchive = {
  metrics: {
    total: number;
    open: number;
    closed: number;
    overdueLong: number;
    averageResponseMinutes: number;
    medianResponseMinutes: number;
    p90ResponseMinutes: number;
    averageExecutionMinutes: number;
    medianExecutionMinutes: number;
    p90ExecutionMinutes: number;
    averageResolutionMinutes: number;
    medianResolutionMinutes: number;
    p90ResolutionMinutes: number;
  };
  items: Task[];
};

type ModalMode = 'create' | 'comment' | 'redirect' | 'done' | null;
type TaskQuickFilter = 'all' | 'mine' | 'new' | 'progress' | 'long' | 'overdue' | 'done';
type TaskFilterDraft = {
  search: string;
  scope: 'all' | 'mine' | 'done';
  type: '' | 'URGENT' | 'LONG';
  departmentId: string;
  lineId: string;
};

const TASK_REFRESH_INTERVAL_MS = 7000;

const emptyBoard: Board = { NEW: [], IN_PROGRESS: [], LONG: [], DONE: [] };

function taskTitle(task: Task) {
  return task.description || task.title || `Заявка ${task.id.slice(0, 8)}`;
}

function errorMessage(error: unknown, fallback = 'Действие не выполнено') {
  return error instanceof Error ? error.message : fallback;
}

function buildDeadline(defaultHours: number | null) {
  const date = new Date(Date.now() + (defaultHours ?? 48) * 60 * 60 * 1000);
  return date.toISOString().slice(0, 16);
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function minutesLabel(value?: number | null) {
  if (value === null || value === undefined) return '—';
  if (value < 60) return `${value} мин`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`;
}

function minutesBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const startAt = new Date(start).getTime();
  const endAt = new Date(end).getTime();
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null;
  return Math.max(0, Math.round((endAt - startAt) / 60000));
}

function taskTiming(task: Task) {
  const now = new Date().toISOString();
  const takenAt = task.takenAt ?? task.startedAt ?? null;
  const doneAt = task.doneAt ?? null;
  const responseMinutes = task.responseMinutes ?? minutesBetween(task.createdAt, takenAt);
  const executionMinutes = task.executionMinutes ?? minutesBetween(takenAt, doneAt);
  const resolutionMinutes = task.resolutionMinutes ?? minutesBetween(task.createdAt, doneAt);
  const waitingReactionMinutes = task.status === 'NEW' ? minutesBetween(task.createdAt, now) : null;
  const activeExecutionMinutes = task.status === 'IN_PROGRESS' ? minutesBetween(takenAt, now) : null;
  return { takenAt, doneAt, responseMinutes, executionMinutes, resolutionMinutes, waitingReactionMinutes, activeExecutionMinutes };
}

function timingChips(task: Task) {
  const timing = taskTiming(task);
  if (task.status === 'NEW') return [{ label: 'Ожидает реакции', value: minutesLabel(timing.waitingReactionMinutes) }];
  if (task.status === 'IN_PROGRESS') {
    return [
      { label: 'Реакция', value: minutesLabel(timing.responseMinutes) },
      { label: 'В работе', value: minutesLabel(timing.activeExecutionMinutes) },
    ];
  }
  return [
    { label: 'Реакция', value: minutesLabel(timing.responseMinutes) },
    { label: 'Исполнение', value: minutesLabel(timing.executionMinutes) },
    { label: 'Всего', value: minutesLabel(timing.resolutionMinutes) },
  ];
}

function boardSignature(board: Board) {
  return (['NEW', 'IN_PROGRESS', 'LONG', 'DONE'] as const)
    .flatMap((status) => board[status].map((task) => `${task.id}:${task.status}:${task.commentsCount ?? task.comments?.length ?? 0}:${task.readsCount ?? 0}:${task.overdue ? 'overdue' : ''}`))
    .join('|');
}

export function TasksScreen({ targetTaskId, onTargetConsumed }: { targetTaskId?: string; onTargetConsumed?: () => void } = {}) {
  const { currentUser } = useAppStore();
  const fixtureQuery = shouldHidePilotFixtures() ? '' : '?includeFixtures=true';
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [lines, setLines] = useState<LineOption[]>([]);
  const [settings, setSettings] = useState<TaskSettings | null>(null);
  const [archive, setArchive] = useState<TaskArchive | null>(null);
  const [selectedTask, commitSelectedTask] = useState<Task | null>(null);
  const selectedTaskRef = useRef<Task | null>(null);
  const detailSequence = useRef(0);
  const detailPendingId = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const mounted = useRef(true);
  const [failedTargetId, setFailedTargetId] = useState<string | null>(null);
  const setSelectedTask = (task: Task | null) => {
    if (!task) {
      detailSequence.current += 1;
      detailPendingId.current = null;
      setBusy(false);
    }
    selectedTaskRef.current = task;
    commitSelectedTask(task);
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadSequence.current += 1; detailSequence.current += 1; };
  }, []);
  const [actionTask, setActionTask] = useState<Task | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [modal, setModal] = useState<ModalMode>(null);
  const [modalOperationId, setModalOperationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TaskFilterDraft['type']>('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [lineFilter, setLineFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<TaskFilterDraft>({ search: '', scope: 'all', type: '', departmentId: '', lineId: '' });
  const [candidateSearch, setCandidateSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<TaskQuickFilter>('all');
  const [liveStatus, setLiveStatus] = useState('Нет новых событий');
  const [archiveFilters, setArchiveFilters] = useState({
    dateFrom: factoryDateKey(new Date(Date.now() - 7 * 86_400_000)),
    dateTo: factoryDateKey(),
    lineId: '',
    departmentId: '',
    assigneeId: '',
    type: '',
    status: '',
    shiftType: '',
  });
  const boardSignatureRef = useRef('');
  const actionInFlightRef = useRef(false);
  const taskActionOperationIdsRef = useRef(new Map<string, string>());

  const canCreate = Boolean(currentUser?.permissions.includes('tasks.create') || currentUser?.permissions.includes('tasks.manage') || currentUser?.isAdmin);
  const canManage = Boolean(currentUser?.permissions.includes('tasks.manage') || currentUser?.isAdmin);
  const canTake = Boolean(currentUser?.permissions.includes('tasks.take') || canManage);
  const canDone = Boolean(currentUser?.permissions.includes('tasks.done') || canManage);
  const canComment = Boolean(currentUser?.permissions.includes('tasks.comment') || canManage);
  const canRedirect = Boolean(currentUser?.permissions.includes('tasks.redirect') || canManage);
  const openTaskModal = (mode: Exclude<ModalMode, null>) => {
    setModalOperationId(createOperationId(`task-${mode}`));
    setModal(mode);
  };
  const closeTaskModal = () => {
    setModal(null);
    setModalOperationId('');
  };
  useBodyScrollLock(modal === 'comment');
  useMobileBackLayer(modal === 'comment', closeTaskModal, 740);
  useMobileBackLayer(Boolean(actionTask), () => setActionTask(null), 660);
  useMobileBackLayer(archiveOpen, () => setArchiveOpen(false), 640);
  useMobileBackLayer(Boolean(selectedTask) && !modal && !actionTask && !archiveOpen, () => setSelectedTask(null), 620);

  const openFilters = () => {
    setFilterDraft({
      search,
      scope: quickFilter === 'mine' || quickFilter === 'done' ? quickFilter : 'all',
      type: typeFilter,
      departmentId: departmentFilter,
      lineId: lineFilter,
    });
    setFilterOpen(true);
  };

  const applyFilters = () => {
    setSearch(filterDraft.search.trim());
    setQuickFilter(filterDraft.scope);
    setTypeFilter(filterDraft.type);
    setDepartmentFilter(filterDraft.departmentId);
    setLineFilter(filterDraft.lineId);
    setFilterOpen(false);
  };

  const resetFilters = () => {
    setFilterDraft({ search: '', scope: 'all', type: '', departmentId: '', lineId: '' });
  };

  const taskActionOperationId = (taskId: string, action: string) => {
    const key = `${action}:${taskId}`;
    const existing = taskActionOperationIdsRef.current.get(key);
    if (existing) return { key, operationId: existing };
    const operationId = createOperationId(`task-${action}`);
    taskActionOperationIdsRef.current.set(key, operationId);
    return { key, operationId };
  };

  const loadArchive = async (filters = archiveFilters) => {
    setArchiveLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      setArchive(await apiClient.get<TaskArchive>(`/tasks/archive/summary?${params.toString()}`));
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось загрузить архив заявок'));
    } finally {
      setArchiveLoading(false);
    }
  };

  const load = async (options?: { silent?: boolean }) => {
    const sequence = ++loadSequence.current;
    const isCurrent = () => mounted.current && sequence === loadSequence.current;
    if (!options?.silent) setLoading(true);
    if (!options?.silent) setErrorText(null);
    try {
      const [boardData, departmentData, candidateData, archiveOptions] = await Promise.all([
        apiClient.get<Board>(`/tasks/board${fixtureQuery}`),
        apiClient.get<Department[]>('/tasks/recipient-departments').catch(() => []),
        apiClient.get<Candidate[]>(`/tasks/assignee-candidates${candidateSearch.trim() ? `?query=${encodeURIComponent(candidateSearch.trim())}` : ''}`).catch(() => []),
        apiClient.get<{ lines?: LineOption[] }>('/archive/options').catch(() => ({ lines: [] })),
      ]);
      if (!isCurrent()) return;
      setBoard(boardData);
      setBoardLoaded(true);
      const visibleTasks = [...boardData.NEW, ...boardData.IN_PROGRESS, ...boardData.LONG, ...boardData.DONE];
      appStore.setTasks(visibleTasks);
      // A bounded board page is not the authority for an already opened detail.
      const nextSignature = boardSignature(boardData);
      if (boardSignatureRef.current && nextSignature !== boardSignatureRef.current) {
        setLiveStatus('Обновлено: появились изменения в заявках');
      }
      boardSignatureRef.current = nextSignature;
      setDepartments(departmentData);
      setCandidates(candidateData);
      setLines(archiveOptions.lines ?? []);
      if (currentUser?.isAdmin) {
        const nextSettings = await apiClient.get<TaskSettings>('/admin/task-settings');
        if (isCurrent()) setSettings(nextSettings);
      }
    } catch (error) {
      if (isCurrent() && !options?.silent) setErrorText(errorMessage(error, 'Не удалось загрузить заявки'));
    } finally {
      if (isCurrent() && !options?.silent) setLoading(false);
    }
  };

  useEffect(() => { void load(); void loadArchive(); }, []);

  useEffect(() => {
    if (!targetTaskId || !boardLoaded) return;
    onTargetConsumed?.();
    // Same guarded detail/read endpoint as an ordinary card. Never infer denial from board limit300.
    void openDetail({ id: targetTaskId }, true);
  }, [targetTaskId, boardLoaded, board, onTargetConsumed]);

  const refreshSelectedDetail = async () => {
    if (detailPendingId.current) return;
    const selected = selectedTaskRef.current;
    if (!selected) return;
    const sequence = ++detailSequence.current;
    try {
      const detail = await apiClient.get<Task>(`/tasks/${encodeURIComponent(selected.id)}`);
      if (mounted.current && sequence === detailSequence.current && selectedTaskRef.current?.id === selected.id) setSelectedTask(detail);
    } catch (error) {
      if (mounted.current && sequence === detailSequence.current) setErrorText(errorMessage(error, 'Не удалось обновить заявку'));
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load({ silent: true });
      void refreshSelectedDetail();
    }, TASK_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [selectedTask?.id, candidateSearch]);

  useEffect(() => {
    const refreshFromRealtime = () => {
      setLiveStatus('Обновлено в реальном времени');
      void load({ silent: true });
      void refreshSelectedDetail();
    };
    window.addEventListener('zavod:task-updated', refreshFromRealtime);
    return () => window.removeEventListener('zavod:task-updated', refreshFromRealtime);
  }, [selectedTask?.id, candidateSearch]);

  const totals = useMemo(() => ({
    new: board.NEW.length,
    progress: board.IN_PROGRESS.length,
    long: board.LONG.length,
    done: board.DONE.length,
    overdue: [...board.NEW, ...board.IN_PROGRESS, ...board.LONG].filter((task) => task.overdue).length,
  }), [board]);

  const kpiFilters = useMemo(() => ([
    { value: 'new' as const, label: 'Новые', count: totals.new, hint: 'ожидают реакции', icon: '+' },
    { value: 'progress' as const, label: 'В работе', count: totals.progress, hint: 'у исполнителей', icon: '↻' },
    { value: 'long' as const, label: 'Долгие', count: totals.long, hint: 'со сроком', icon: '⌛' },
    { value: 'overdue' as const, label: 'Просрочено', count: totals.overdue, hint: 'нужна реакция', icon: '!' },
  ]), [totals]);

  const filteredBoard = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const applyFilters = (task: Task) => {
      const mine = task.assigneeId === currentUser?.userId || task.assignees?.some((assignee) => assignee.userId === currentUser?.userId);
      if (quickFilter === 'mine' && !mine) return false;
      if (quickFilter === 'overdue' && !task.overdue) return false;
      if (typeFilter && task.type !== typeFilter) return false;
      if (departmentFilter && !task.recipients?.some((recipient) => recipient.departmentId === departmentFilter)) return false;
      if (lineFilter && task.lineId !== lineFilter) return false;
      if (!needle) return true;
      const haystack = [
        taskTitle(task),
        task.lineName,
        task.status,
        task.type,
        task.assigneeName,
        ...(task.recipients?.map((recipient) => recipient.departmentName) ?? []),
        ...(task.assignees?.map((assignee) => assignee.displayName) ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    };
    return {
      NEW: board.NEW.filter(applyFilters),
      IN_PROGRESS: board.IN_PROGRESS.filter(applyFilters),
      LONG: board.LONG.filter(applyFilters),
      DONE: board.DONE.filter(applyFilters),
    } satisfies Board;
  }, [board, currentUser?.userId, departmentFilter, lineFilter, quickFilter, search, typeFilter]);

  const selectedTasks = useMemo(() => {
    if (quickFilter === 'new') return filteredBoard.NEW;
    if (quickFilter === 'progress') return filteredBoard.IN_PROGRESS;
    if (quickFilter === 'long') return filteredBoard.LONG;
    if (quickFilter === 'overdue') {
      return [...filteredBoard.NEW, ...filteredBoard.IN_PROGRESS, ...filteredBoard.LONG]
        .filter((task) => task.overdue);
    }
    if (quickFilter === 'done') return filteredBoard.DONE;
    return [...filteredBoard.NEW, ...filteredBoard.IN_PROGRESS, ...filteredBoard.LONG];
  }, [filteredBoard, quickFilter]);

  const openDetail = async (task: Pick<Task, 'id'>, linked = false) => {
    const sequence = ++detailSequence.current;
    detailPendingId.current = task.id;
    const isCurrent = () => mounted.current && sequence === detailSequence.current;
    setBusy(true);
    setErrorText(null);
    setFailedTargetId(null);
    try {
      const detail = await apiClient.get<Task>(`/tasks/${encodeURIComponent(task.id)}`);
      if (isCurrent()) setSelectedTask(detail);
    } catch (error) {
      if (isCurrent()) {
        setErrorText(`${linked ? 'Связанная заявка недоступна. ' : ''}${errorMessage(error, 'Не удалось открыть заявку')}`);
        if (linked) setFailedTargetId(task.id);
      }
    } finally {
      if (isCurrent()) {
        detailPendingId.current = null;
        setBusy(false);
      }
    }
  };

  const uploadFiles = async (entityType: string, entityId: string, nextFiles: File[]) => {
    await uploadAttachments(entityType, entityId, nextFiles);
  };

  const takeTask = async (task: Task) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    const operation = taskActionOperationId(task.id, 'take');
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/tasks/${task.id}/take`, { operationId: operation.operationId });
      taskActionOperationIdsRef.current.delete(operation.key);
      await load();
      await loadArchive();
      await openDetail(task);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось взять заявку в работу'));
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  };

  const runEscalation = async () => {
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post('/tasks/escalation/check', {});
      await load();
      await loadArchive();
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось проверить просрочки'));
    } finally {
      setBusy(false);
    }
  };

  const applyArchiveFilter = (patch: Partial<typeof archiveFilters>) => {
    const next = { ...archiveFilters, ...patch };
    setArchiveFilters(next);
    void loadArchive(next);
  };

  const renderCard = (task: Task) => {
    const urgent = task.type !== 'LONG';
    return (
      <article className={`card task-card task-card-v2 ${urgent ? 'task-urgent' : 'task-long'} ${task.overdue ? 'task-overdue' : ''}`} key={task.id}>
        <div className="line-title-row task-card-title">
          <button className="link-title" type="button" onClick={() => void openDetail(task)}>{taskTitle(task)}</button>
          <span className={`tag task-type-tag ${urgent ? 'stop' : 'pause'}`}>{displayLabel(taskTypeLabels, task.type ?? 'URGENT')}</span>
        </div>
        <div className="line-meta task-card-meta">
          <span className={`tag ${task.status === 'DONE' ? 'work' : task.status === 'IN_PROGRESS' ? 'pause' : ''}`}>{displayLabel(taskStatusLabels, task.status)}</span>
          <span className="tag">{task.lineName || 'Без линии'}</span>
          {task.lineStatusEventId ? <span className="tag stop">Из простоя</span> : null}
          {task.recipients?.slice(0, 1).map((recipient) => <span className="tag" key={recipient.departmentId}>{recipient.departmentName}</span>)}
          {task.createdAt ? <span className="tag">Создана: {formatDateTime(task.createdAt)}</span> : null}
          {task.overdue ? <span className="tag stop">Просрочена</span> : null}
        </div>
        <div className="task-timing-row">
          {timingChips(task).map((chip) => (
            <span className="task-timing-chip" key={chip.label}>
              <strong>{chip.label}</strong>
              <em>{chip.value}</em>
            </span>
          ))}
        </div>
        <div className="task-card-actions">
          <button className="secondary-button" type="button" disabled={busy || task.status === 'DONE'} onClick={() => setActionTask(task)}>Действия</button>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void openDetail(task)}>Открыть</button>
        </div>
      </article>
    );
  };

  return (
    <section className="screen-panel tasks-screen">
      <PremiumSectionHeader
        title="Заявки"
        subtitle="Межотдельская доска заявок: адресаты, исполнители, сроки, комментарии, вложения и связь с простоями линий."
      />

      {loading ? <div className="empty-state">Загружаю заявки...</div> : null}
      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {failedTargetId ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void openDetail({ id: failedTargetId }, true)}>Повторить открытие заявки</button> : null}
      {!boardLoaded && !loading ? <button className="secondary-button" type="button" onClick={() => void load()}>Повторить загрузку</button> : null}
      <PremiumKpiStrip
        className="task-kpi-grid"
        items={kpiFilters.map((item) => ({
          label: item.label,
          value: item.count,
          hint: item.hint,
          icon: item.icon,
          tone: item.value === 'overdue' ? 'danger' : item.value === 'progress' ? 'success' : item.value === 'long' ? 'neutral' : 'cool',
          active: quickFilter === item.value,
          onClick: () => setQuickFilter(item.value),
        }))}
        label="Состояние заявок"
      />

      <div className="live-refresh-row" aria-live="polite">
        <span className={`live-refresh-pill ${liveStatus.startsWith('Обновлено') ? 'updated' : ''}`}>{liveStatus}</span>
      </div>

      <div className="tab-row">
        {canCreate ? <button className="primary-button" type="button" onClick={() => { setFiles([]); openTaskModal('create'); }}>Создать заявку</button> : null}
        {canManage ? <button className="secondary-button" type="button" onClick={() => void runEscalation()}>Проверить долгие</button> : null}
        <button className="secondary-button" type="button" onClick={() => { setArchiveOpen(true); void loadArchive(); }}>Архив и метрики</button>
        {settings ? <span className="tag">Эскалация: {settings.longTaskEscalationEnabled ? 'включена' : 'выключена'}</span> : null}
      </div>

      <div className="premium-filter-trigger-row task-filter-trigger">
        <button className="secondary-button" type="button" onClick={openFilters}>Поиск и фильтры</button>
        <span className="premium-filter-summary">
          {[
            search ? `«${search}»` : '',
            quickFilter === 'mine' ? 'Мои' : quickFilter === 'done' ? `Завершённые: ${totals.done}` : '',
            typeFilter ? displayLabel(taskTypeLabels, typeFilter) : '',
            departmentFilter ? departments.find((department) => department.id === departmentFilter)?.name ?? '' : '',
            lineFilter ? lines.find((line) => line.id === lineFilter)?.name ?? '' : '',
          ].filter(Boolean).join(' · ') || 'Все доступные заявки'}
        </span>
      </div>

      <PremiumSheet
        open={filterOpen}
        title="Поиск и фильтры"
        description="Найдите заявку по описанию, линии, отделу или исполнителю."
        onClose={() => setFilterOpen(false)}
        footer={(
          <>
            <button className="secondary-button" type="button" onClick={resetFilters}>Сбросить</button>
            <button className="primary-button" type="button" onClick={applyFilters}>Показать</button>
          </>
        )}
      >
        <div className="premium-filter-form">
          <label>
            Поиск
            <input
              autoFocus
              value={filterDraft.search}
              onChange={(event) => setFilterDraft((current) => ({ ...current, search: event.target.value }))}
              placeholder="Например: КИПиА, упаковка, транспортёр"
            />
          </label>
          <label>
            Какие заявки показать
            <span className="premium-segmented-control" style={{ '--segments': 3 } as React.CSSProperties}>
              {([
                ['all', 'Все'],
                ['mine', 'Мои'],
                ['done', 'Завершённые'],
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={filterDraft.scope === value}
                  className={filterDraft.scope === value ? 'active' : ''}
                  key={value}
                  onClick={() => setFilterDraft((current) => ({ ...current, scope: value }))}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </span>
          </label>
          <label>
            Тип заявки
            <select value={filterDraft.type} onChange={(event) => setFilterDraft((current) => ({ ...current, type: event.target.value as TaskFilterDraft['type'] }))}>
              <option value="">Все типы</option>
              <option value="URGENT">Срочная</option>
              <option value="LONG">Долгая</option>
            </select>
          </label>
          <label>
            Служба / отдел
            <select value={filterDraft.departmentId} onChange={(event) => setFilterDraft((current) => ({ ...current, departmentId: event.target.value }))}>
              <option value="">Все доступные службы</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
          <label>
            Линия
            <select value={filterDraft.lineId} onChange={(event) => setFilterDraft((current) => ({ ...current, lineId: event.target.value }))}>
              <option value="">Все линии</option>
              {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
            </select>
          </label>
        </div>
      </PremiumSheet>

      <div className="task-selected-list">
        {selectedTasks.map(renderCard)}
        {!selectedTasks.length ? <div className="empty-state">По выбранному фильтру заявок нет.</div> : null}
      </div>

      {archiveOpen ? <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Архив и метрики заявок">
        <section className="modal-card premium-deep-panel task-archive-panel">
        <div className="section-toggle task-archive-header" style={{ cursor: 'default' }}>
          <span className="section-title">
            <strong>Архив и метрики заявок</strong>
            <span>Фильтры по дате, линии, отделу, исполнителю, типу, статусу и смене.</span>
          </span>
          <button className="secondary-button compact-action" type="button" onClick={() => setArchiveOpen(false)}>Закрыть</button>
        </div>
        <div className="task-archive-filters">
          <label className="field-label">
            С
            <input aria-label="Архив заявок: дата с" type="date" value={archiveFilters.dateFrom} onChange={(event) => applyArchiveFilter({ dateFrom: event.target.value })} />
          </label>
          <label className="field-label">
            По
            <input aria-label="Архив заявок: дата по" type="date" value={archiveFilters.dateTo} onChange={(event) => applyArchiveFilter({ dateTo: event.target.value })} />
          </label>
          <select value={archiveFilters.lineId} onChange={(event) => applyArchiveFilter({ lineId: event.target.value })}>
            <option value="">Все линии</option>
            {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
          </select>
          <select value={archiveFilters.departmentId} onChange={(event) => applyArchiveFilter({ departmentId: event.target.value })}>
            <option value="">Все отделы</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
          <select value={archiveFilters.assigneeId} onChange={(event) => applyArchiveFilter({ assigneeId: event.target.value })}>
            <option value="">Все исполнители</option>
            {candidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.displayName}</option>)}
          </select>
          <select value={archiveFilters.type} onChange={(event) => applyArchiveFilter({ type: event.target.value })}>
            <option value="">URGENT и LONG</option>
            <option value="URGENT">Срочные</option>
            <option value="LONG">Долгие</option>
          </select>
          <select value={archiveFilters.status} onChange={(event) => applyArchiveFilter({ status: event.target.value })}>
            <option value="">Все статусы</option>
            <option value="NEW">Новые</option>
            <option value="IN_PROGRESS">В работе</option>
            <option value="DONE">Готово</option>
          </select>
          <select value={archiveFilters.shiftType} onChange={(event) => applyArchiveFilter({ shiftType: event.target.value })}>
            <option value="">Любая смена</option>
            <option value="DAY">День</option>
            <option value="NIGHT">Ночь</option>
          </select>
        </div>
        {archiveLoading ? <div className="empty-state">Обновляю архив...</div> : null}
        {archive ? (
          <>
            <div className="metric-grid task-archive-metrics">
              <div className="metric-card"><div className="metric-label">Всего</div><div className="metric-value">{archive.metrics.total}</div></div>
              <div className="metric-card"><div className="metric-label">Открытые</div><div className="metric-value">{archive.metrics.open}</div></div>
              <div className="metric-card"><div className="metric-label">Закрытые</div><div className="metric-value">{archive.metrics.closed}</div></div>
              <div className="metric-card"><div className="metric-label">Просроченные LONG</div><div className="metric-value">{archive.metrics.overdueLong}</div></div>
              <div className="metric-card"><div className="metric-label">Реакция avg / med / p90</div><div className="metric-value small">{minutesLabel(archive.metrics.averageResponseMinutes)} / {minutesLabel(archive.metrics.medianResponseMinutes)} / {minutesLabel(archive.metrics.p90ResponseMinutes)}</div></div>
              <div className="metric-card"><div className="metric-label">Исполнение avg / med / p90</div><div className="metric-value small">{minutesLabel(archive.metrics.averageExecutionMinutes)} / {minutesLabel(archive.metrics.medianExecutionMinutes)} / {minutesLabel(archive.metrics.p90ExecutionMinutes)}</div></div>
              <div className="metric-card"><div className="metric-label">Решение avg / med / p90</div><div className="metric-value small">{minutesLabel(archive.metrics.averageResolutionMinutes)} / {minutesLabel(archive.metrics.medianResolutionMinutes)} / {minutesLabel(archive.metrics.p90ResolutionMinutes)}</div></div>
            </div>
            <div className="section-body">
              {archive.items.slice(0, 12).map(renderCard)}
              {!archive.items.length ? <div className="empty-state">По выбранным фильтрам заявок нет</div> : null}
            </div>
          </>
        ) : null}
        </section>
      </div> : null}

      {actionTask ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Действия с заявкой">
          <div className="modal-card premium-action-sheet">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Действия с заявкой</p>
                <h3>{taskTitle(actionTask)}</h3>
              </div>
              <span className={`tag ${actionTask.overdue ? 'stop' : ''}`}>{displayLabel(taskStatusLabels, actionTask.status)}</span>
            </div>
            <div className="premium-action-sheet-grid">
              {actionTask.status === 'NEW' && canTake ? <button className="primary-button success" type="button" disabled={busy} onClick={() => { const task = actionTask; setActionTask(null); void takeTask(task); }}>Взять в работу</button> : null}
              {actionTask.status !== 'DONE' && canComment ? <button className="secondary-button" type="button" disabled={busy} onClick={() => { setFiles([]); setSelectedTask(actionTask); setActionTask(null); openTaskModal('comment'); }}>Добавить комментарий</button> : null}
              {actionTask.status !== 'DONE' && canRedirect ? <button className="secondary-button" type="button" disabled={busy} onClick={() => { setFiles([]); setSelectedTask(actionTask); setActionTask(null); openTaskModal('redirect'); }}>Передать</button> : null}
              {actionTask.status !== 'DONE' && canDone ? <button className="primary-button danger" type="button" disabled={busy} onClick={() => { setFiles([]); setSelectedTask(actionTask); setActionTask(null); openTaskModal('done'); }}>Завершить заявку</button> : null}
            </div>
            <button className="secondary-button" type="button" onClick={() => setActionTask(null)}>Отмена</button>
          </div>
        </div>
      ) : null}

      {selectedTask && !modal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-dashboard-card premium-deep-panel">
            <div className="line-title-row">
              <h3>{taskTitle(selectedTask)}</h3>
              <span className={`tag ${selectedTask.overdue ? 'stop' : ''}`}>{displayLabel(taskStatusLabels, selectedTask.status)}</span>
            </div>
            <div className="line-meta">
              <span className="tag">{displayLabel(taskTypeLabels, selectedTask.type)}</span>
              <span className="tag">{selectedTask.lineName || 'Без линии'}</span>
              {selectedTask.createdByName ? <span className="tag">Автор: {selectedTask.createdByName}</span> : null}
              {selectedTask.assigneeName ? <span className="tag">Исполнитель: {selectedTask.assigneeName}</span> : null}
              {selectedTask.lineStatusEventId ? <span className="tag stop">Связана с простоем</span> : null}
              {selectedTask.deadlineAt ? <span className="tag">Срок: {formatDateTime(selectedTask.deadlineAt)}</span> : null}
              <span className="tag">Ознакомились: {selectedTask.readsCount ?? 0}</span>
            </div>
            <div className="task-timing-row detail">
              {timingChips(selectedTask).map((chip) => (
                <span className="task-timing-chip" key={chip.label}>
                  <strong>{chip.label}</strong>
                  <em>{chip.value}</em>
                </span>
              ))}
            </div>
            <AttachmentPreviewList attachments={selectedTask.attachments} />
            <CommentThread
              comments={(selectedTask.comments ?? []).map((comment) => ({
                id: comment.id,
                author: comment.authorName || 'Сотрудник',
                text: comment.message,
                createdAt: comment.createdAt,
                attachments: comment.attachments as Attachment[] | undefined,
              }))}
            />
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setSelectedTask(null)}>Закрыть окно</button>
              {selectedTask.status !== 'DONE' && canComment ? <button className="secondary-button" type="button" disabled={busy} onClick={() => { setFiles([]); openTaskModal('comment'); }}>Добавить комментарий</button> : null}
              {selectedTask.status === 'NEW' && canTake ? <button className="primary-button" type="button" disabled={busy} onClick={() => void takeTask(selectedTask)}>Взять в работу</button> : null}
              {selectedTask.status !== 'DONE' && canDone ? <button className="primary-button danger" type="button" disabled={busy} onClick={() => { setFiles([]); openTaskModal('done'); }}>Завершить заявку</button> : null}
              {selectedTask.status !== 'DONE' && canRedirect ? <button className="secondary-button" type="button" disabled={busy} onClick={() => { setFiles([]); openTaskModal('redirect'); }}>Передать</button> : null}
              <button className="primary-button" type="button" onClick={() => void openDetail(selectedTask)} disabled={busy}>Обновить</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'create' ? (
        <ActionModal
          busy={busy}
          errorText={errorText}
          title="Создать заявку"
          fields={[
            { name: 'description', label: 'Описание', type: 'textarea', required: true },
            { name: 'type', label: 'Тип', type: 'select', required: true, defaultValue: 'URGENT', options: [{ label: 'Срочная', value: 'URGENT' }, { label: 'Долгая', value: 'LONG' }] },
            { name: 'lineId', label: 'Линия', type: 'select', options: lines.map((line) => ({ label: line.name, value: line.id })) },
            { name: 'departmentId', label: 'Служба / отдел', type: 'select', options: departments.map((department) => ({ label: department.name, value: department.id })) },
            { name: 'assigneeUserId', label: 'Конкретный исполнитель', type: 'select', options: candidates.map((candidate) => ({ label: `${candidate.displayName} · ${candidate.role === 'OTHER' && candidate.departmentName ? candidate.departmentName : roleLabel(candidate.role)}`, value: candidate.userId })) },
            { name: 'deadlineAt', label: 'Дедлайн для долгой заявки', type: 'datetime-local', defaultValue: buildDeadline(settings?.longTaskDefaultDeadlineHours ?? 48) },
          ]}
          onCancel={closeTaskModal}
          onSubmit={async (values) => {
            if (actionInFlightRef.current) return;
            actionInFlightRef.current = true;
            setBusy(true);
            setErrorText(null);
            try {
            const type = String(values.type || 'URGENT').toUpperCase() === 'LONG' ? 'LONG' : 'URGENT';
            const task = await apiClient.post<Task>('/tasks', {
              type,
              description: String(values.description),
              lineId: values.lineId ? String(values.lineId) : null,
              departmentRecipientIds: values.departmentId ? [String(values.departmentId)] : [],
              assigneeUserIds: values.assigneeUserId ? [String(values.assigneeUserId)] : [],
              deadlineAt: type === 'LONG' ? new Date(String(values.deadlineAt || buildDeadline(settings?.longTaskDefaultDeadlineHours ?? 48))).toISOString() : null,
              operationId: modalOperationId || createOperationId('task-create'),
            });
            if (files.length) await uploadFiles('TASK', task.id, files);
            setFiles([]);
            closeTaskModal();
            await load();
            await loadArchive();
            } catch (error) {
              setErrorText(errorMessage(error, 'Не удалось создать заявку'));
            } finally {
              actionInFlightRef.current = false;
              setBusy(false);
            }
          }}
        >
          <div className="task-candidate-search">
            <p className="task-recipient-note">Заявку можно адресовать службе или конкретному мастеру/специалисту. Рабочие и наёмные сотрудники в список исполнителей не попадают.</p>
            <label>
              Найти исполнителя
              <input
                aria-label="Поиск исполнителя по ФИО, роли, отделу, линии или специализации"
                value={candidateSearch}
                onChange={(event) => setCandidateSearch(event.target.value)}
                placeholder="ФИО, роль, отдел или специализация"
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => void load()}>Обновить список</button>
          </div>
          <AttachmentPicker value={files} onChange={setFiles} allowFiles />
        </ActionModal>
      ) : null}

      {modal === 'comment' && selectedTask ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-form">
            <h3>Комментарий к заявке</h3>
            <CommentBox
              busy={busy}
              errorText={errorText}
              withAttachments
              onSubmit={async (message, nextFiles) => {
                if (actionInFlightRef.current) return;
                actionInFlightRef.current = true;
                setBusy(true);
                setErrorText(null);
                try {
                const comment = await apiClient.post<{ id: string }>(`/tasks/${selectedTask.id}/comment`, {
                  message,
                  operationId: modalOperationId || createOperationId('task-comment'),
                });
                if (nextFiles?.length) await uploadFiles('TASK_COMMENT', comment.id, nextFiles);
                closeTaskModal();
                await load();
                await loadArchive();
                await openDetail(selectedTask);
                } catch (error) {
                  setErrorText(errorMessage(error, 'Не удалось добавить комментарий'));
                } finally {
                  actionInFlightRef.current = false;
                  setBusy(false);
                }
              }}
            />
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeTaskModal}>Закрыть</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'redirect' && selectedTask ? (
        <ActionModal
          busy={busy}
          errorText={errorText}
          title="Передать заявку"
          fields={[
            { name: 'comment', label: 'Комментарий', type: 'textarea', required: true },
            { name: 'departmentId', label: 'Новая служба / отдел', type: 'select', options: departments.map((department) => ({ label: department.name, value: department.id })) },
            { name: 'assigneeUserId', label: 'Новый конкретный исполнитель', type: 'select', options: candidates.map((candidate) => ({ label: `${candidate.displayName} · ${candidate.role === 'OTHER' && candidate.departmentName ? candidate.departmentName : roleLabel(candidate.role)}`, value: candidate.userId })) },
          ]}
          onCancel={closeTaskModal}
          onSubmit={async (values) => {
            if (actionInFlightRef.current) return;
            actionInFlightRef.current = true;
            setBusy(true);
            setErrorText(null);
            try {
            await apiClient.post(`/tasks/${selectedTask.id}/redirect`, {
              comment: String(values.comment),
              newDepartmentRecipientIds: values.departmentId ? [String(values.departmentId)] : [],
              newAssigneeUserIds: values.assigneeUserId ? [String(values.assigneeUserId)] : [],
              operationId: modalOperationId || createOperationId('task-redirect'),
            });
            closeTaskModal();
            await load();
            await loadArchive();
            await openDetail(selectedTask);
            } catch (error) {
              setErrorText(errorMessage(error, 'Не удалось передать заявку'));
            } finally {
              actionInFlightRef.current = false;
              setBusy(false);
            }
          }}
        />
      ) : null}

      {modal === 'done' && selectedTask ? (
        <ActionModal
          busy={busy}
          errorText={errorText}
          title="Завершить заявку"
          fields={[{ name: 'comment', label: selectedTask.overdue ? 'Комментарий к закрытию просрочки' : 'Комментарий', type: 'textarea', required: Boolean(selectedTask.overdue && selectedTask.type === 'LONG') }]}
          onCancel={closeTaskModal}
          onSubmit={async (values) => {
            if (actionInFlightRef.current) return;
            actionInFlightRef.current = true;
            setBusy(true);
            setErrorText(null);
            try {
            await apiClient.post(`/tasks/${selectedTask.id}/complete`, {
              operationId: modalOperationId || createOperationId('task-done'),
              comment: String(values.comment || ''),
            });
            closeTaskModal();
            setSelectedTask(null);
            await load();
            await loadArchive();
            } catch (error) {
              setErrorText(errorMessage(error, 'Не удалось завершить заявку'));
            } finally {
              actionInFlightRef.current = false;
              setBusy(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}
