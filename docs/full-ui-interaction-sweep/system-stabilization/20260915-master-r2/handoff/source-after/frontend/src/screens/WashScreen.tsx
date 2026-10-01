import React, { useEffect, useMemo, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { apiClient } from '../api/client';
import { createOperationId } from '../api/operation';
import { ActionModal } from '../components/ActionModal';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { PremiumKpiStrip, PremiumSectionHeader } from '../components/PremiumShell';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { appStore, Attachment, Line, useAppStore, WashSession, type WashControlItem } from '../store/app.store';
import { isPilotFixtureText } from '../utils/pilot-ui';

type WashModal = 'request' | 'start' | 'message' | 'issue' | 'control' | 'review' | 'complete' | 'resolveIssue' | 'finishControl' | null;
type WashListMode = 'ACTIVE' | 'REQUESTS' | 'ARCHIVE';
type WashDetailTab = 'OVERVIEW' | 'PEOPLE' | 'ISSUES' | 'TASKS' | 'CONTROL' | 'FEED' | 'OKK';

type WashRequest = {
  id: string;
  lineId?: string | null;
  lineName?: string | null;
  targetType: 'LINE' | 'OTHER' | string;
  objectName?: string | null;
  objectDescription?: string | null;
  description?: string | null;
  priority: string;
  dueAt?: string | null;
  comment?: string | null;
  status: 'NEW' | 'IN_PROGRESS' | 'WASH_STARTED' | 'DONE' | 'CANCELLED' | string;
  statusLabel: string;
  version: number;
  washSessionId?: string | null;
  createdAt: string;
  createdByName: string;
  assignedToId?: string | null;
  assignedToName?: string | null;
  attachments?: Attachment[];
};

const PENDING_WASH_SESSION_KEY = 'zavod.pendingWashSessionId';
const PENDING_WASH_ASSIGNMENT_CONTEXT_KEY = 'zavod.pendingWashAssignmentContext';
const PENDING_WASH_DETAIL_TAB_KEY = 'zavod.pendingWashDetailTab';

const issueStatusLabels: Record<string, string> = {
  OPEN: 'Открыта',
  RESOLVING: 'В работе',
  RESOLVED: 'Закрыта',
};

const controlStatusLabels: Record<string, string> = {
  NEW: 'Новое',
  OPEN: 'Ожидает',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнено',
  CANCELLED: 'Отменено',
};

const lifecycleClass: Record<string, string> = {
  STARTED: 'started',
  ISSUE: 'issue',
  RESOLVING: 'resolving',
  COMPLETED: 'completed',
};

const lifecycleFallbackLabels: Record<string, string> = {
  STARTED: 'Мойка началась',
  ISSUE: 'Есть проблема',
  RESOLVING: 'Проблему устраняют',
  COMPLETED: 'Мойка завершена',
};

const reviewStatusLabels: Record<string, string> = {
  APPROVED: 'Принято',
  NEEDS_REWORK: 'Нужно домыть',
  REJECTED: 'Отклонено',
};

const requestPriorityLabels: Record<string, string> = {
  LOW: 'Низкий',
  NORMAL: 'Обычный',
  HIGH: 'Высокий',
  URGENT: 'Срочно',
};

function hasPermission(permissions: string[], permission: string) {
  return permissions.includes(permission) || permissions.includes('wash.manage');
}

function issueTitle(issue: WashSession['issues'][number]) {
  return issue.title || issue.text || issue.message || 'Проблема мойки';
}

function displayLabel(labels: Record<string, string>, value?: string | null, fallback = 'Без статуса') {
  if (!value) return fallback;
  return labels[value] ?? value;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Время не указано';
  return new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function formatDurationSeconds(value: number) {
  const minutes = Math.max(0, Math.floor(value / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
}

function formatLiveDuration(value: string | undefined, now: number) {
  if (!value) return 'Время начала не указано';
  return formatDurationSeconds((now - new Date(value).getTime()) / 1000);
}

function washStartedAt(wash: WashSession) {
  return wash.startedAt ?? wash.createdAt;
}

function washDuration(wash: WashSession, serverNow: number) {
  if (wash.active) return formatLiveDuration(washStartedAt(wash), serverNow);
  if (typeof wash.durationSeconds === 'number') return formatDurationSeconds(wash.durationSeconds);
  const startedAt = washStartedAt(wash);
  if (startedAt && wash.completedAt) {
    return formatDurationSeconds((new Date(wash.completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  }
  return 'Время не указано';
}

function isIssueOpen(issue: WashSession['issues'][number]) {
  return issue.status !== 'RESOLVED' && !issue.resolvedAt;
}

function isControlOpen(item: WashControlItem) {
  return !['DONE', 'CANCELLED'].includes(String(item.status));
}

function washLifecycleLabel(wash: WashSession) {
  return wash.lifecycleLabel || lifecycleFallbackLabels[String(wash.lifecycleStatus || '')] || (wash.active ? 'Мойка идет' : 'Мойка завершена');
}

function isPilotWashSession(session: WashSession) {
  return isPilotFixtureText(
    session.id,
    session.lineName,
    session.events?.map((event) => `${event.type} ${event.text ?? ''}`).join(' '),
    session.messages?.map((message) => message.message).join(' '),
    session.issues?.map((issue) => `${issue.title ?? ''} ${issue.description ?? ''} ${issue.message ?? ''}`).join(' '),
    session.controlItems?.map((item) => `${item.title ?? ''} ${item.description ?? ''}`).join(' '),
  );
}

export function WashScreen() {
  const { washSessions, lines, currentUser } = useAppStore();
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<WashModal>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [reviewRating, setReviewRating] = useState('');
  const [washStartType, setWashStartType] = useState<'LINE' | 'OTHER'>('LINE');
  const [washStartLineId, setWashStartLineId] = useState('');
  const [washStartObjectName, setWashStartObjectName] = useState('');
  const [washStartObjectDescription, setWashStartObjectDescription] = useState('');
  const [washRequests, setWashRequests] = useState<WashRequest[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [listMode, setListMode] = useState<WashListMode>('ACTIVE');
  const [detailTab, setDetailTab] = useState<WashDetailTab>('OVERVIEW');

  const permissions = currentUser?.permissions ?? [];
  const canRead = Boolean(currentUser?.isAdmin || hasPermission(permissions, 'wash.read'));
  const canStart = hasPermission(permissions, 'wash.manage');
  const canMessage = hasPermission(permissions, 'wash.message.create');
  const canIssue = hasPermission(permissions, 'wash.issue.create');
  const canResolveIssue = hasPermission(permissions, 'wash.issue.resolve');
  const canControl = hasPermission(permissions, 'wash.control.create');
  const canManageControl = hasPermission(permissions, 'wash.control.manage');
  const canReview = hasPermission(permissions, 'wash.okk-review.manage');
  const canManageAssignments = Boolean(currentUser?.isAdmin || permissions.includes('assignments.manage'));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadWash = async () => {
    if (!canRead) return;
    setLoading(true);
    setErrorText(null);
    try {
      const [sessions, requests, linesData] = await Promise.all([
        apiClient.get<WashSession[]>('/wash?includeCompleted=true'),
        apiClient.get<WashRequest[]>('/wash/requests?includeCompleted=true'),
        canStart || canControl ? apiClient.get<Line[]>('/lines') : Promise.resolve([]),
      ]);
      const cleanSessions = sessions.filter((session) => !isPilotWashSession(session));
      const responseServerNow = cleanSessions.find((session) => session.serverNow)?.serverNow;
      if (responseServerNow) {
        const parsedServerNow = new Date(responseServerNow).getTime();
        if (Number.isFinite(parsedServerNow)) setServerOffsetMs(parsedServerNow - Date.now());
      }
      setWashRequests(requests.filter((request) => !isPilotFixtureText(request.id, request.lineName, request.objectName, request.description, request.comment)));
      appStore.setWashSessions(cleanSessions);
      appStore.setLines(linesData.filter((line) => !isPilotFixtureText(line.name, line.id)));
      const pendingId = window.sessionStorage.getItem(PENDING_WASH_SESSION_KEY);
      const pendingTab = window.sessionStorage.getItem(PENDING_WASH_DETAIL_TAB_KEY) as WashDetailTab | null;
      if (pendingId && cleanSessions.some((session) => session.id === pendingId)) {
        setCurrentSessionId(pendingId);
        if (pendingTab && ['OVERVIEW', 'PEOPLE', 'ISSUES', 'TASKS', 'CONTROL', 'FEED', 'OKK'].includes(pendingTab)) {
          setDetailTab(pendingTab);
        }
      }
      window.sessionStorage.removeItem(PENDING_WASH_SESSION_KEY);
      window.sessionStorage.removeItem(PENDING_WASH_DETAIL_TAB_KEY);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить мойку');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadWash(); }, [canRead]);

  const current = washSessions.find((wash) => wash.id === currentSessionId) ?? null;
  const activeSessions = useMemo(() => washSessions.filter((item) => item.active), [washSessions]);
  const completedSessions = useMemo(() => washSessions.filter((item) => !item.active), [washSessions]);
  const activeRequests = useMemo(() => washRequests.filter((item) => !['DONE', 'CANCELLED'].includes(item.status)), [washRequests]);
  const openIssuesTotal = activeSessions.reduce((total, session) => total + session.issues.filter(isIssueOpen).length, 0);
  const openControlTotal = activeSessions.reduce((total, session) => total + (session.controlItems ?? []).filter(isControlOpen).length, 0);
  const pendingReviewsTotal = activeSessions.filter((session) => !session.okkReviewStatus).length;
  const startLineOptions = lines
    .filter((line) => !isPilotFixtureText(line.name, line.id) && line.operationalState === 'STOPPED' && !line.activeDefrost)
    .map((line) => ({ value: line.id, label: line.name }));
  const requestLineOptions = lines
    .filter((line) => !isPilotFixtureText(line.name, line.id))
    .map((line) => ({ value: line.id, label: line.name }));

  const openWashAssignmentContext = (sessionId = current?.id, targetUserId?: string) => {
    const session = washSessions.find((item) => item.id === sessionId);
    if (!session?.active || !canManageAssignments) return;
    window.sessionStorage.setItem(PENDING_WASH_SESSION_KEY, session.id);
    window.sessionStorage.setItem(PENDING_WASH_DETAIL_TAB_KEY, 'PEOPLE');
    window.sessionStorage.setItem(PENDING_WASH_ASSIGNMENT_CONTEXT_KEY, JSON.stringify({
      washSessionId: session.id,
      targetUserId: targetUserId ?? null,
      mode: targetUserId ? 'active' : 'available',
      returnToWash: true,
    }));
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Shift' } }));
  };

  const resetModal = () => {
    setModal(null);
    setFiles([]);
    setReviewRating('');
    setSelectedIssueId(null);
    setSelectedControlId(null);
    setWashStartType('LINE');
    setWashStartLineId('');
    setWashStartObjectName('');
    setWashStartObjectDescription('');
  };

  const closeDetail = () => {
    setCurrentSessionId(null);
    setDetailTab('OVERVIEW');
  };

  const openSession = (sessionId: string, tab: WashDetailTab = 'OVERVIEW') => {
    setDetailTab(tab);
    setCurrentSessionId(sessionId);
  };

  useMobileBackLayer(Boolean(currentSessionId) && !modal, closeDetail, 620);
  useMobileBackLayer(modal === 'start', resetModal, 700);

  const reloadDetail = async (sessionId: string) => {
    const detail = await apiClient.get<WashSession>(`/wash/${sessionId}`);
    if (detail.serverNow) {
      const parsedServerNow = new Date(detail.serverNow).getTime();
      if (Number.isFinite(parsedServerNow)) setServerOffsetMs(parsedServerNow - Date.now());
    }
    appStore.setWashSessions([
      detail,
      ...appStore.getState().washSessions.filter((session) => session.id !== sessionId),
    ]);
  };

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void (async () => {
          await loadWash();
          if (cancelled || !currentSessionId) return;
          try {
            await reloadDetail(currentSessionId);
          } catch {
            if (!cancelled) setCurrentSessionId(null);
          }
        })();
      }, 140);
    };
    window.addEventListener('zavod:wash-updated', refresh);
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('zavod:wash-updated', refresh);
    };
  }, [canRead, currentSessionId]);

  const renderSessionCard = (wash: WashSession) => {
    const openIssues = wash.issues.filter(isIssueOpen);
    const openControls = (wash.controlItems ?? []).filter(isControlOpen);
    const lineLabel = wash.lineName || wash.objectName || 'Объект мойки не указан';
    const lifecycle = String(wash.lifecycleStatus || (wash.active ? 'STARTED' : 'COMPLETED'));
    const participantsCount = wash.participants?.length ?? 0;
    return (
      <article className={`wash-session-card ${wash.active ? 'active' : 'done'} ${lifecycleClass[lifecycle] ?? ''}`} key={wash.id}>
        <div className="wash-card-main">
          <div className="wash-card-copy">
            <h3>{lineLabel}</h3>
            <div className="wash-card-timing">
              <span>С {formatDateTime(washStartedAt(wash))}</span>
              <strong>{wash.active ? 'Длится' : 'Длилась'}: {washDuration(wash, now + serverOffsetMs)}</strong>
            </div>
            <div className="wash-card-metrics">
              <span>Людей {participantsCount}</span>
              <span>Проблем {openIssues.length}</span>
              <span>Заданий {openControls.length}</span>
              <span>ОКК: {wash.okkReviewStatus ? displayLabel(reviewStatusLabels, wash.okkReviewStatus) : 'ожидает'}</span>
            </div>
          </div>
          <span className={`tag ${wash.active ? 'wash' : ''}`}>{washLifecycleLabel(wash)}</span>
        </div>
        <div className="wash-card-actions">
          {wash.active && canManageAssignments ? (
            <button className="secondary-button" type="button" onClick={() => openWashAssignmentContext(wash.id)}>Люди</button>
          ) : null}
          <button className="action-button" type="button" onClick={() => openSession(wash.id)}>Открыть</button>
        </div>
      </article>
    );
  };

  const runRequestAction = async (request: WashRequest, action: 'take' | 'start') => {
    setLoading(true);
    setErrorText(null);
    try {
      const updated = await apiClient.post<WashRequest>(`/wash/requests/${request.id}/${action}`, {
        operationId: createOperationId(`wash-request-${action}`),
        version: request.version,
      });
      await loadWash();
      if (action === 'start' && updated.washSessionId) openSession(updated.washSessionId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось выполнить задание на мойку.');
    } finally {
      setLoading(false);
    }
  };

  const renderRequestCard = (request: WashRequest) => {
    const title = request.lineName || request.objectName || 'Объект мойки';
    const isMine = request.assignedToId === currentUser?.userId;
    return (
      <article className={`wash-request-card ${request.status.toLowerCase()}`} key={request.id}>
        <div className="wash-request-heading">
          <div>
            <span className="wash-kicker">{displayLabel(requestPriorityLabels, request.priority, 'Обычный приоритет')}</span>
            <h3>{title}</h3>
          </div>
          <span className={`tag ${request.status === 'NEW' ? 'pause' : request.status === 'WASH_STARTED' ? 'wash' : 'work'}`}>{request.statusLabel}</span>
        </div>
        <p>{request.description || request.objectDescription || 'Описание не указано'}</p>
        <div className="wash-card-meta">
          <span>Создал: {request.createdByName}</span>
          <span>{request.assignedToName ? `Исполнитель: ${request.assignedToName}` : 'Исполнитель не назначен'}</span>
          <span>{request.dueAt ? `Срок: ${formatDateTime(request.dueAt)}` : 'Без срока'}</span>
        </div>
        {request.comment ? <p className="helper-text">{request.comment}</p> : null}
        <AttachmentPreviewList attachments={request.attachments ?? []} mode="inline" />
        <div className="wash-card-actions">
          {request.status === 'NEW' && canStart ? (
            <button className="primary-button" disabled={loading} type="button" onClick={() => void runRequestAction(request, 'take')}>Взять в работу</button>
          ) : null}
          {request.status === 'IN_PROGRESS' && canStart && isMine ? (
            <button className="action-button work" disabled={loading} type="button" onClick={() => void runRequestAction(request, 'start')}>Начать мойку</button>
          ) : null}
          {request.status === 'WASH_STARTED' && request.washSessionId ? (
            <button className="action-button" type="button" onClick={() => openSession(request.washSessionId!)}>Открыть мойку</button>
          ) : null}
        </div>
      </article>
    );
  };

  if (!canRead) {
    return (
      <section className="screen-panel">
        <div className="screen-heading">
          <h2>Мойка</h2>
          <p>Раздел доступен только сотрудникам с правом просмотра мойки.</p>
        </div>
        <div className="empty-state error-state">Нет доступа к разделу мойки.</div>
      </section>
    );
  }

  if (current) {
    const openIssues = current.issues.filter(isIssueOpen);
    const openControls = (current.controlItems ?? []).filter(isControlOpen);
    const activePeople = current.participants ?? [];
    const peopleHistory = current.participantsHistory?.length ? current.participantsHistory : activePeople;
    const controlItems = (current.controlItems ?? []).filter((item) => item.type !== 'MINI_TASK');
    const miniTasks = (current.controlItems ?? []).filter((item) => item.type === 'MINI_TASK');
    const lineLabel = current.lineName || current.objectName || 'Объект мойки не указан';
    const lifecycle = String(current.lifecycleStatus || (current.active ? 'STARTED' : 'COMPLETED'));
    const firstOpenIssue = openIssues[0];
    return (
      <section className="screen-panel wash-detail-screen">
        <div className="screen-heading wash-detail-heading">
          <div>
            <h2>Мойка</h2>
            <p>{lineLabel}</p>
            <div className="wash-detail-meta">
              <span>Началась: {formatDateTime(washStartedAt(current))}</span>
              <strong>{current.active ? 'Длится' : 'Длилась'}: {washDuration(current, now + serverOffsetMs)}</strong>
            </div>
          </div>
          <span className={`tag wash-lifecycle-tag ${lifecycleClass[lifecycle] ?? ''}`}>{washLifecycleLabel(current)}</span>
        </div>
        {errorText ? <div className="empty-state error-state">{errorText}</div> : null}

        <div className="wash-sticky-actions">
          <button className="secondary-button" type="button" onClick={closeDetail}>Назад к мойкам</button>
        </div>

        <PremiumKpiStrip
          className="compact-metrics wash-detail-kpis"
          label="Состояние текущей мойки"
          items={[
            { label: 'Люди', value: activePeople.length, icon: 'Л', active: detailTab === 'PEOPLE', onClick: () => setDetailTab('PEOPLE'), tone: 'success' },
            { label: 'Проблемы', value: openIssues.length, icon: '!', active: detailTab === 'ISSUES', onClick: () => setDetailTab('ISSUES'), tone: openIssues.length ? 'danger' : 'neutral' },
            { label: 'Задания', value: miniTasks.filter(isControlOpen).length, icon: 'З', active: detailTab === 'TASKS', onClick: () => setDetailTab('TASKS'), tone: 'cool' },
            { label: 'ОКК', value: current.okkReviewStatus ? 'Есть' : 'Ждет', icon: 'О', active: detailTab === 'OKK', onClick: () => setDetailTab('OKK'), tone: current.okkReviewStatus ? 'success' : 'muted' },
          ]}
        />

        <div className="wash-action-rail">
          {canMessage && current.active ? <button className="action-button" type="button" onClick={() => setModal('message')}>Фото / комментарий</button> : null}
          {canIssue && current.active ? <button className="action-button pause" type="button" onClick={() => setModal('issue')}>Проблема</button> : null}
          {canControl && current.active ? <button className="action-button" type="button" onClick={() => setModal('control')}>Задание</button> : null}
          {canReview && current.active ? <button className="action-button" type="button" onClick={() => setModal('review')}>ОКК-проверка</button> : null}
          {canResolveIssue && current.active && firstOpenIssue ? (
            <button className="action-button work" type="button" onClick={() => { setSelectedIssueId(firstOpenIssue.id); setModal('resolveIssue'); }}>Проблема решена</button>
          ) : null}
          {canStart && current.active ? <button className="danger-button" type="button" onClick={() => setModal('complete')}>Завершить мойку</button> : null}
        </div>

        <div className="wash-detail-tabs" role="tablist" aria-label="Разделы мойки">
          {([
            ['OVERVIEW', 'Обзор'],
            ['PEOPLE', 'Люди'],
            ['ISSUES', 'Проблемы'],
            ['TASKS', 'Задания'],
            ['CONTROL', 'Контроль'],
            ['FEED', 'Лента'],
            ['OKK', 'ОКК'],
          ] as Array<[WashDetailTab, string]>)
            .filter(([value]) => current.canViewControl || (value !== 'TASKS' && value !== 'CONTROL'))
            .map(([value, label]) => (
            <button
              aria-selected={detailTab === value}
              className={detailTab === value ? 'active' : ''}
              key={value}
              onClick={() => setDetailTab(value)}
              role="tab"
              type="button"
            >
              {label}
            </button>
            ))}
        </div>

        {detailTab === 'OVERVIEW' ? (
          <article className={`wash-status-card wash-overview-card ${lifecycleClass[lifecycle] ?? ''}`} role="tabpanel">
            <div>
              <span className="wash-kicker">Текущее состояние</span>
              <h3>{lineLabel}</h3>
              <div className="wash-card-meta">
                <span>Контроль: {controlItems.filter(isControlOpen).length}</span>
                <span>Фото и файлы: {current.attachments?.length ?? 0}</span>
                <span>Автор: {current.startedByName || 'не указан'}</span>
              </div>
              <p>{current.active ? 'Все действия сохраняются с автором и временем.' : 'История, люди, замечания и контроль сохранены.'}</p>
            </div>
            <AttachmentPreviewList attachments={current.attachments} mode="inline" />
          </article>
        ) : null}

        {detailTab === 'PEOPLE' ? <section className="wash-panel wash-people-panel" role="tabpanel">
          <div className="section-subhead">
            <span>Л</span>
            <div>
              <strong>Люди на мойке</strong>
              <p>Текущие участники и история, чтобы после завершения мойки не потерять, кто был на работе.</p>
            </div>
            {current.active && canManageAssignments ? <button className="primary-button compact-action" type="button" onClick={() => openWashAssignmentContext(current.id)}>Добавить человека</button> : null}
          </div>
          <div className="wash-people-grid">
            {peopleHistory.length ? peopleHistory.map((person) => (
              <div className={`wash-person-pill ${person.endedAt ? 'done' : 'active'}`} key={`${person.userId}-${person.startedAt ?? ''}`}>
                <div>
                  <strong>{person.displayName}</strong>
                  <span>{person.endedAt ? `Был на мойке до ${formatDateTime(person.endedAt)}` : `На мойке с ${formatDateTime(person.startedAt)}`}</span>
                </div>
                {!person.endedAt && current.active && canManageAssignments ? (
                  <button className="secondary-button compact-action" type="button" onClick={() => openWashAssignmentContext(current.id, person.userId)}>Действия</button>
                ) : null}
              </div>
            )) : <div className="empty-state compact">Участники мойки не указаны.</div>}
          </div>
        </section> : null}

        {detailTab === 'ISSUES' ? <section className="wash-panel" role="tabpanel">
            <div className="section-subhead">
              <span>П</span>
              <div>
                <strong>Проблемы</strong>
                <p>Открытые замечания по мойке и вложения к ним.</p>
              </div>
            </div>
            {current.issues.length ? current.issues.map((issue) => (
              <article className="wash-feed-card" key={issue.id}>
                <div className="line-title-row">
                  <strong>{issueTitle(issue)}</strong>
                  <span className="tag">{displayLabel(issueStatusLabels, issue.status, issue.resolvedAt ? 'Закрыта' : 'Открыта')}</span>
                </div>
                {issue.description ? <p>{issue.description}</p> : null}
                <div className="line-meta">
                  {issue.createdByName ? <span>Автор: {issue.createdByName}</span> : null}
                  {issue.assignedToName ? <span>Адресат: {issue.assignedToName}</span> : null}
                  {issue.resolvedByName ? <span>Закрыл: {issue.resolvedByName}</span> : null}
                  {issue.resolvedAt ? <span>{formatDateTime(issue.resolvedAt)}</span> : null}
                </div>
                {issue.resolveComment ? <p>Итог: {issue.resolveComment}</p> : null}
                <AttachmentPreviewList attachments={issue.attachments} mode="inline" />
                {canResolveIssue && isIssueOpen(issue) ? (
                  <button className="secondary-button" type="button" onClick={() => { setSelectedIssueId(issue.id); setModal('resolveIssue'); }}>Закрыть проблему</button>
                ) : null}
              </article>
            )) : <div className="empty-state compact">Открытых проблем по мойке нет.</div>}
          </section> : null}

          {detailTab === 'CONTROL' && current.canViewControl ? <section className="wash-panel" role="tabpanel">
            <div className="section-subhead">
              <span>К</span>
              <div>
                <strong>Контроль мойки</strong>
                <p>Фронт работ, замечания, что исправляется, итог и вложения.</p>
              </div>
            </div>
            {controlItems.length ? controlItems.map((item) => (
              <article className={`wash-feed-card control-${String(item.status || 'NEW').toLowerCase()}`} key={item.id}>
                <div className="line-title-row">
                  <strong>{item.title}</strong>
                  <span className="tag">{item.statusLabel || displayLabel(controlStatusLabels, item.status, 'Новое')}</span>
                </div>
                {item.description ? <p>{item.description}</p> : null}
                <div className="line-meta">
                  {item.createdByName ? <span>Автор: {item.createdByName}</span> : null}
                  {item.assignedToName ? <span>Адресат: {item.assignedToName}</span> : null}
                  {item.requiresPhoto ? <span>Нужно фото</span> : null}
                  {item.doneAt ? <span>Итог: {formatDateTime(item.doneAt)}</span> : null}
                </div>
                {item.doneComment ? <p>Итог: {item.doneComment}</p> : null}
                <AttachmentPreviewList attachments={item.attachments} mode="inline" />
                {canManageControl && isControlOpen(item) ? (
                  <button className="secondary-button" type="button" onClick={() => { setSelectedControlId(item.id); setModal('finishControl'); }}>Отметить выполненным</button>
                ) : null}
              </article>
            )) : <div className="empty-state compact">Контрольных пунктов пока нет.</div>}
          </section> : null}

          {detailTab === 'TASKS' && current.canViewControl ? <section className="wash-panel" role="tabpanel">
            <div className="section-subhead">
              <span>З</span>
              <div>
                <strong>Мини-задания мойки</strong>
                <p>Небольшие действия внутри мойки: новое, в работе, выполнено.</p>
              </div>
            </div>
            {miniTasks.length ? miniTasks.map((item) => (
              <article className={`wash-feed-card mini-${String(item.status || 'NEW').toLowerCase()}`} key={item.id}>
                <div className="line-title-row">
                  <strong>{item.title}</strong>
                  <span className="tag">{item.statusLabel || displayLabel(controlStatusLabels, item.status, 'Новое')}</span>
                </div>
                {item.description ? <p>{item.description}</p> : null}
                <div className="line-meta">
                  {item.createdByName ? <span>Автор: {item.createdByName}</span> : null}
                  {item.assignedToName ? <span>Адресат: {item.assignedToName}</span> : null}
                  {item.doneByName ? <span>Закрыл: {item.doneByName}</span> : null}
                  {item.doneAt ? <span>{formatDateTime(item.doneAt)}</span> : null}
                </div>
                {item.doneComment ? <p>Итог: {item.doneComment}</p> : null}
                <AttachmentPreviewList attachments={item.attachments} mode="inline" />
                {canManageControl && isControlOpen(item) ? (
                  <button className="secondary-button" type="button" onClick={() => { setSelectedControlId(item.id); setModal('finishControl'); }}>Закрыть задание</button>
                ) : null}
              </article>
            )) : <div className="empty-state compact">Мини-заданий пока нет.</div>}
          </section> : null}

          {detailTab === 'FEED' ? <section className="wash-panel" role="tabpanel">
            <div className="section-subhead">
              <span>Л</span>
              <div>
                <strong>Лента мойки</strong>
                <p>Комментарии, фото и события по этой линии.</p>
              </div>
            </div>
            {current.messages.length ? current.messages.map((message) => (
              <article className="wash-feed-card" key={message.id}>
                <strong>{message.message}</strong>
                <div className="line-meta">
                  {message.authorName ? <span>{message.authorName}</span> : null}
                  <span>{formatDateTime(message.createdAt)}</span>
                </div>
                <AttachmentPreviewList attachments={message.attachments} mode="inline" />
              </article>
            )) : <div className="empty-state compact">Комментариев и фото пока нет.</div>}
            {(current.events || []).length ? (current.events || []).map((event) => (
              <div className="wash-event-row" key={event.id}>
                <strong>{event.typeLabel || 'Событие мойки'}</strong>
                <span>{event.text || 'Событие без комментария'}</span>
                <small>{event.actorName ? `${event.actorName} · ` : ''}{formatDateTime(event.createdAt)}</small>
              </div>
            )) : null}
          </section> : null}

          {detailTab === 'OKK' ? <section className="wash-panel" role="tabpanel">
            <div className="section-subhead">
              <span>О</span>
              <div>
                <strong>ОКК-проверка</strong>
                <p>Решение ОКК, оценка качества и вложения.</p>
              </div>
            </div>
            {(current.okkReviews || []).length ? (current.okkReviews || []).map((review) => (
              <article className="wash-feed-card" key={review.id}>
                <div className="line-title-row">
                  <strong>{displayLabel(reviewStatusLabels, review.status)}</strong>
                  {review.rating ? <span className="tag">Оценка {review.rating}/10</span> : null}
                </div>
                <p>{review.comment}</p>
                <div className="line-meta">
                  {review.okkUserName ? <span>ОКК: {review.okkUserName}</span> : null}
                  {review.createdAt ? <span>{formatDateTime(review.createdAt)}</span> : null}
                </div>
                <AttachmentPreviewList attachments={review.attachments} mode="inline" />
              </article>
            )) : <div className="empty-state compact">Проверок ОКК пока нет.</div>}
          </section> : null}

        {modal === 'message' ? (
          <ActionModal
            busy={loading}
            errorText={errorText}
            title="Фото или комментарий"
            fields={[{ name: 'message', label: 'Комментарий', type: 'textarea', required: true }]}
            onCancel={resetModal}
            onSubmit={async (values) => {
              setLoading(true);
              setErrorText(null);
              try {
                const message = await apiClient.post<{ id: string }>(`/wash/${current.id}/message`, { message: String(values.message), operationId: createOperationId('wash-message') });
                await uploadAttachments('WASH_MESSAGE', message.id, files);
                resetModal();
                await reloadDetail(current.id);
              } catch (error) {
                setErrorText(error instanceof Error ? error.message : 'Не удалось сохранить комментарий к мойке.');
              } finally {
                setLoading(false);
              }
            }}
          >
            <AttachmentPicker allowFiles value={files} onChange={setFiles} />
          </ActionModal>
        ) : null}
        {modal === 'issue' ? (
          <ActionModal
            title="Проблема мойки"
            fields={[
              { name: 'title', label: 'Коротко что не так', required: true },
              { name: 'description', label: 'Описание', type: 'textarea', required: true },
            ]}
            onCancel={resetModal}
            onSubmit={async (values) => {
              const issue = await apiClient.post<{ id: string }>(`/wash/${current.id}/issues`, {
                title: String(values.title),
                description: String(values.description),
                operationId: createOperationId('wash-issue'),
              });
              await uploadAttachments('WASH_ISSUE', issue.id, files);
              resetModal();
              await reloadDetail(current.id);
            }}
          >
            <AttachmentPicker allowFiles value={files} onChange={setFiles} />
          </ActionModal>
        ) : null}
        {modal === 'control' ? (
          <ActionModal
            title="Задание по мойке"
            fields={[
              { name: 'title', label: 'Что проверить или домыть', required: true },
              { name: 'description', label: 'Комментарий', type: 'textarea' },
              { name: 'type', label: 'Тип', type: 'select', options: [{ value: 'CONTROL', label: 'Контроль' }, { value: 'MINI_TASK', label: 'Мини-задача' }], defaultValue: 'CONTROL' },
              { name: 'requiresPhoto', label: 'Требовать фото при выполнении', type: 'checkbox' },
            ]}
            onCancel={resetModal}
            onSubmit={async (values) => {
              const item = await apiClient.post<{ id: string }>(`/wash/${current.id}/control-items`, {
                title: String(values.title),
                description: String(values.description || ''),
                type: String(values.type || 'CONTROL') as 'CONTROL',
                requiresPhoto: Boolean(values.requiresPhoto),
              });
              await uploadAttachments('WASH_CONTROL_ITEM', item.id, files);
              resetModal();
              await reloadDetail(current.id);
            }}
          >
            <AttachmentPicker allowFiles value={files} onChange={setFiles} />
          </ActionModal>
        ) : null}
        {modal === 'review' ? (
          <ActionModal
            busy={loading}
            errorText={errorText}
            title="ОКК-проверка мойки"
            fields={[
              { name: 'status', label: 'Решение', type: 'select', options: [{ value: 'APPROVED', label: 'Принято' }, { value: 'NEEDS_REWORK', label: 'Нужно домыть' }, { value: 'REJECTED', label: 'Отклонено' }], defaultValue: 'APPROVED', required: true },
              { name: 'comment', label: 'Комментарий', type: 'textarea', required: true },
            ]}
            onCancel={resetModal}
            onSubmit={async (values) => {
              setLoading(true);
              setErrorText(null);
              try {
                const review = await apiClient.post<{ id: string }>(`/wash/${current.id}/okk-review`, {
                  status: String(values.status || 'APPROVED'),
                  rating: reviewRating ? Number(reviewRating) : undefined,
                  comment: String(values.comment),
                });
                await uploadAttachments('WASH_OKK_REVIEW', review.id, files);
                resetModal();
                await reloadDetail(current.id);
              } catch (error) {
                setErrorText(error instanceof Error ? error.message : 'Не удалось сохранить проверку ОКК.');
              } finally {
                setLoading(false);
              }
            }}
          >
            <div className="field-label">
              Оценка качества мойки
              <div className="line-meta">1 - плохо, 10 - отлично</div>
              <div className="rating-scale" role="group" aria-label="Оценка качества мойки">
                {Array.from({ length: 10 }, (_item, index) => {
                  const value = String(index + 1);
                  return (
                    <button
                      className={reviewRating === value ? 'primary-button compact-action' : 'secondary-button compact-action'}
                      key={value}
                      type="button"
                      onClick={() => setReviewRating(value)}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
            <AttachmentPicker allowFiles value={files} onChange={setFiles} />
          </ActionModal>
        ) : null}
        {modal === 'resolveIssue' ? (
          <ActionModal
            title="Закрыть проблему"
            fields={[{ name: 'comment', label: 'Что сделали', type: 'textarea', required: true }]}
            onCancel={resetModal}
            onSubmit={async (values) => {
              await apiClient.patch(`/wash/issues/${selectedIssueId}/status`, { status: 'RESOLVED', comment: String(values.comment) });
              resetModal();
              await reloadDetail(current.id);
            }}
          />
        ) : null}
        {modal === 'finishControl' ? (
          <ActionModal
            title="Выполнить задание"
            fields={[{ name: 'comment', label: 'Комментарий', type: 'textarea' }]}
            onCancel={resetModal}
            onSubmit={async (values) => {
              await uploadAttachments('WASH_CONTROL_ITEM', String(selectedControlId), files);
              await apiClient.patch(`/wash/control-items/${selectedControlId}`, { status: 'DONE', comment: String(values.comment || '') });
              resetModal();
              await reloadDetail(current.id);
            }}
          >
            <AttachmentPicker allowFiles value={files} onChange={setFiles} />
          </ActionModal>
        ) : null}
        {modal === 'complete' ? (
          <ActionModal
            busy={loading}
            className="wash-complete-modal"
            confirmLabel="Завершить мойку"
            errorText={errorText}
            title="Завершить мойку"
            description="Перед завершением проверьте открытые проблемы, задания и решение ОКК. Если правила завода не выполнены, backend вернет понятную ошибку."
            onCancel={resetModal}
            onSubmit={async () => {
              setLoading(true);
              setErrorText(null);
              try {
                await apiClient.post(`/wash/${current.id}/complete`, { operationId: createOperationId('wash-complete') });
                resetModal();
                closeDetail();
                await loadWash();
              } catch (error) {
                setErrorText(error instanceof Error ? error.message : 'Не удалось завершить мойку.');
              } finally {
                setLoading(false);
              }
            }}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="screen-panel wash-screen">
      <PremiumSectionHeader
        title="Мойка"
        subtitle="Активные мойки по линиям: задания, проблемы, фото, комментарии и ОКК-проверка в одном рабочем месте."
      />
      {loading ? <div className="empty-state">Загрузка мойки...</div> : null}
      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}

      <div className="wash-hero">
        <div>
          <span className="wash-kicker">Быстрые действия</span>
          <h3>Управление мойкой</h3>
        </div>
        <div className="wash-hero-actions">
          {canControl ? <button className="action-button work" type="button" onClick={() => setModal('request')}>Создать задание</button> : null}
          {canStart ? <button className="primary-button" type="button" onClick={() => setModal('start')}>Начать мойку</button> : null}
        </div>
      </div>

      <PremiumKpiStrip
        className="compact-metrics"
        label="Состояние мойки"
        items={[
          { label: 'Активные', value: activeSessions.length, icon: '●', tone: 'success' },
          { label: 'Проблемы', value: openIssuesTotal, icon: '!', tone: openIssuesTotal ? 'danger' : 'neutral' },
          { label: 'Задания', value: activeRequests.length + openControlTotal, icon: 'З', tone: 'cool' },
          { label: 'ОКК ждут', value: pendingReviewsTotal, icon: 'О', tone: pendingReviewsTotal ? 'muted' : 'success' },
        ]}
      />

      <div className="wash-mode-switch" role="tablist" aria-label="Список мойки">
        <button aria-selected={listMode === 'ACTIVE'} className={listMode === 'ACTIVE' ? 'active' : ''} onClick={() => setListMode('ACTIVE')} role="tab" type="button">
          Активные <span>{activeSessions.length}</span>
        </button>
        <button aria-selected={listMode === 'REQUESTS'} className={listMode === 'REQUESTS' ? 'active' : ''} onClick={() => setListMode('REQUESTS')} role="tab" type="button">
          Задания <span>{activeRequests.length}</span>
        </button>
        <button aria-selected={listMode === 'ARCHIVE'} className={listMode === 'ARCHIVE' ? 'active' : ''} onClick={() => setListMode('ARCHIVE')} role="tab" type="button">
          Архив <span>{completedSessions.length}</span>
        </button>
      </div>

      {listMode === 'ACTIVE' ? (
        <div className="wash-session-grid" role="tabpanel">
          {activeSessions.map(renderSessionCard)}
          {!activeSessions.length && !loading ? <div className="empty-state">Активных моек сейчас нет.</div> : null}
        </div>
      ) : null}

      {listMode === 'REQUESTS' ? (
        <div className="wash-request-grid" role="tabpanel">
          {activeRequests.map(renderRequestCard)}
          {!activeRequests.length && !loading ? <div className="empty-state compact">Доступных заданий на мойку сейчас нет.</div> : null}
        </div>
      ) : null}

      {listMode === 'ARCHIVE' ? (
        <div className="wash-session-grid compact" role="tabpanel">
          {completedSessions.map(renderSessionCard)}
          {!completedSessions.length && !loading ? <div className="empty-state compact">Завершенных моек пока нет.</div> : null}
        </div>
      ) : null}

      {modal === 'request' ? (
        <ActionModal
          busy={loading}
          errorText={errorText}
          title="Новое задание на мойку"
          fields={[
            { name: 'targetType', label: 'Что нужно помыть', type: 'select', defaultValue: 'LINE', required: true, options: [{ value: 'LINE', label: 'Линия' }, { value: 'OTHER', label: 'Другой объект' }] },
            { name: 'lineId', label: 'Линия', type: 'select', options: [{ value: '', label: 'Не выбрано' }, ...requestLineOptions] },
            { name: 'objectName', label: 'Другой объект' },
            { name: 'description', label: 'Описание работ', type: 'textarea', required: true },
            { name: 'priority', label: 'Приоритет', type: 'select', defaultValue: 'NORMAL', required: true, options: [{ value: 'LOW', label: 'Низкий' }, { value: 'NORMAL', label: 'Обычный' }, { value: 'HIGH', label: 'Высокий' }, { value: 'URGENT', label: 'Срочно' }] },
            { name: 'dueAt', label: 'Срок', type: 'datetime-local' },
            { name: 'comment', label: 'Комментарий', type: 'textarea' },
          ]}
          onCancel={resetModal}
          onSubmit={async (values) => {
            setLoading(true);
            setErrorText(null);
            try {
              const targetType = String(values.targetType || 'LINE');
              if (targetType === 'LINE' && !values.lineId) throw new Error('Выберите линию.');
              if (targetType === 'OTHER' && String(values.objectName || '').trim().length < 2) throw new Error('Укажите объект мойки.');
              const request = await apiClient.post<WashRequest>('/wash/requests', {
                targetType,
                lineId: targetType === 'LINE' ? String(values.lineId) : undefined,
                objectName: targetType === 'OTHER' ? String(values.objectName).trim() : undefined,
                description: String(values.description),
                priority: String(values.priority || 'NORMAL'),
                dueAt: values.dueAt ? new Date(String(values.dueAt)).toISOString() : undefined,
                comment: String(values.comment || '').trim() || undefined,
                operationId: createOperationId('wash-request-create'),
              });
              await uploadAttachments('WASH_CONTROL_ITEM', request.id, files);
              resetModal();
              await loadWash();
            } catch (error) {
              setErrorText(error instanceof Error ? error.message : 'Не удалось создать задание на мойку.');
            } finally {
              setLoading(false);
            }
          }}
        >
          <AttachmentPicker allowFiles value={files} onChange={setFiles} />
        </ActionModal>
      ) : null}

      {modal === 'start' ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form
            className="modal-card wash-start-modal premium-deep-form"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                setErrorText(null);
                if (washStartType === 'LINE' && !washStartLineId) {
                  setErrorText('Выберите остановленную линию для мойки.');
                  return;
                }
                if (washStartType === 'OTHER' && washStartObjectName.trim().length < 2) {
                  setErrorText('Укажите, что нужно помыть.');
                  return;
                }
                try {
                  await apiClient.post('/wash/start', {
                    targetType: washStartType,
                    lineId: washStartType === 'LINE' ? washStartLineId : undefined,
                    objectName: washStartType === 'OTHER' ? washStartObjectName.trim() : undefined,
                    objectDescription: washStartType === 'OTHER' ? washStartObjectDescription.trim() : undefined,
                    operationId: createOperationId('wash-start'),
                  });
                  resetModal();
                  await loadWash();
                } catch (error) {
                  setErrorText(error instanceof Error ? error.message : 'Не удалось начать мойку.');
                }
              })();
            }}
          >
            <div className="modal-header">
              <h3>Начать мойку</h3>
              <button className="secondary-button" type="button" onClick={resetModal}>Закрыть</button>
            </div>
            <div className="segmented-control wash-target-toggle" role="group" aria-label="Что ставим на мойку">
              <button className={washStartType === 'LINE' ? 'active' : ''} type="button" onClick={() => setWashStartType('LINE')}>Линия</button>
              <button className={washStartType === 'OTHER' ? 'active' : ''} type="button" onClick={() => setWashStartType('OTHER')}>Другое</button>
            </div>
            {washStartType === 'LINE' ? (
              <>
                <label className="field-label">
                  Остановленная линия
                  <select value={washStartLineId} onChange={(event) => setWashStartLineId(event.target.value)}>
                    <option value="">Не выбрано</option>
                    {startLineOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {!startLineOptions.length ? (
                  <div className="empty-state compact">Нет остановленных линий для мойки. Сначала остановите линию.</div>
                ) : null}
              </>
            ) : (
              <>
                <label className="field-label">
                  Что моют?
                  <input value={washStartObjectName} onChange={(event) => setWashStartObjectName(event.target.value)} placeholder="Например: стена у участка упаковки" />
                </label>
                <label className="field-label">
                  Описание
                  <textarea value={washStartObjectDescription} onChange={(event) => setWashStartObjectDescription(event.target.value)} placeholder="Зона, оборудование, инвентарь или пояснение" />
                </label>
              </>
            )}
            {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
            <div className="modal-actions">
              <button className="primary-button" type="submit">Начать мойку</button>
              <button className="secondary-button" type="button" onClick={resetModal}>Отмена</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
