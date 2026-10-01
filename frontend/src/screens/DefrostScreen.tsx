import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { PremiumKpiStrip, PremiumSectionHeader } from '../components/PremiumShell';
import { ChamberPanel } from '../components/ChamberPanel';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { useAppStore } from '../store/app.store';

void React;

type DefrostEvent = {
  id: string;
  lineId: string;
  lineName: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  eventType?: 'DEFROST' | 'SHOCK_CHAMBER_BLOWN';
  eventTypeLabel?: string;
  startAt: string;
  endAt: string | null;
  durationSeconds: number | null;
  comment: string | null;
  endComment: string | null;
  startedById: string;
  endedById: string | null;
  startedBy?: { id: string; displayName?: string | null };
  endedBy?: { id: string; displayName?: string | null } | null;
};

type ShockChamberBlowStats = {
  count: number;
  lastAt: string | null;
  baselineAt: string | null;
  baselineSource: 'LAST_DEFROST' | 'FALLBACK_24H';
  warningLevel: 'NORMAL' | 'WARNING' | 'RECOMMEND_DEFROST';
  warningText: string | null;
};

type DefrostLine = {
  id: string;
  name: string;
  status: string;
  canStartDefrost?: boolean;
  latestEvent: DefrostEvent | null;
  activeEvent: DefrostEvent | null;
  todayEventsCount: number;
  currentRunStartedAt?: string | null;
  currentRunDataStatus?: 'AVAILABLE' | 'MISSING';
  serverNow?: string;
  shockChamberBlowStats?: ShockChamberBlowStats;
  badge: 'ON_DEFROST' | 'TODAY_EVENTS' | 'WORK_STARTED' | 'NO_EVENTS';
};

type CalendarDay = {
  date: string;
  hasDefrostStart: boolean;
  hasWorkStart: boolean;
  hasShockChamberBlown?: boolean;
  colorState: 'NONE' | 'RED' | 'GREEN' | 'RED_GREEN';
  startEvents: DefrostEvent[];
  workEvents: DefrostEvent[];
  shockChamberBlowEvents?: DefrostEvent[];
  startCount?: number;
  workCount?: number;
  shockChamberBlowCount?: number;
};

type CalendarResponse = {
  line: { id: string; name: string; status: string };
  month: string;
  today: string;
  days: CalendarDay[];
  shockChamberBlowStats?: ShockChamberBlowStats;
};

type DefrostSummary = {
  periodDays: number;
  workingDays: number | null;
  defrostCount: number;
  averageDefrostMinutes: number | null;
  averageWorkBetweenDefrostsMinutes: number | null;
  hasEnoughData: boolean;
  message: string | null;
};

type ModalState = {
  mode: 'start' | 'complete' | 'blow';
};

type LineFilter = 'WORKING' | 'DEFROST';

const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие';
}

function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function currentMonth() {
  return dateKey().slice(0, 7);
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(year, monthNumber - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function monthTitle(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
    .format(new Date(year, monthNumber - 1, 1));
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
    .format(new Date(`${date}T12:00:00+03:00`));
}

function formatTime(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

function formatMinutes(value: number | null) {
  if (value === null || value === undefined) return 'Недостаточно данных';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes} мин`;
  return `${hours} ч ${minutes} мин`;
}

function dayOffset(date: string) {
  const value = new Date(`${date}T12:00:00+03:00`);
  const jsDay = value.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function dayNumber(date: string) {
  return Number(date.slice(-2));
}

function lastEventText(line: DefrostLine) {
  if (line.activeEvent) return `Оттайка в ${formatTime(line.activeEvent.startAt)}`;
  if (line.currentRunStartedAt) return `В работе с ${formatTime(line.currentRunStartedAt)}`;
  if (line.status === 'WORK') return 'В работе · время запуска не зафиксировано';
  const event = line.latestEvent;
  if (!event) return 'По этой линии ещё не было событий оттайки.';
  if (event.endAt) return `Запущено в работу в ${formatTime(event.endAt)}`;
  return `Оттайка в ${formatTime(event.startAt)}`;
}

function shockChamberText(stats?: ShockChamberBlowStats) {
  if (!stats) return 'Обдувы шоковой камеры не зафиксированы.';
  const last = stats.lastAt ? ` · последний ${formatTime(stats.lastAt)}` : '';
  return `Обдувов с последней оттайки: ${stats.count}${last}`;
}

function shockChamberClass(stats?: ShockChamberBlowStats) {
  if (stats?.warningLevel === 'RECOMMEND_DEFROST') return 'danger';
  if (stats?.warningLevel === 'WARNING') return 'warning';
  return '';
}

function liveDuration(from: string | null | undefined, now: number) {
  if (!from) return null;
  const minutes = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000));
  return formatMinutes(minutes);
}

function colorClass(day: CalendarDay) {
  if (day.colorState === 'RED') return 'defrost-day-red';
  if (day.colorState === 'GREEN') return 'defrost-day-green';
  if (day.colorState === 'RED_GREEN') return 'defrost-day-split';
  return 'defrost-day-empty';
}

export function DefrostScreen() {
  const { currentUser, selectedFactoryId } = useAppStore();
  const [lines, setLines] = useState<DefrostLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<DefrostLine | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [summaryDays, setSummaryDays] = useState<30 | 60>(30);
  const [summary, setSummary] = useState<DefrostSummary | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [comment, setComment] = useState('');
  const [loadingLines, setLoadingLines] = useState(false);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const lineListRef = useRef<HTMLDivElement | null>(null);
  const lineListScrollRef = useRef(0);
  const actionAttemptRef = useRef<{ input: string; operationId: string } | null>(null);
  const actionInFlightRef = useRef(false);
  const closeLine = () => {
    setSelectedLine(null);
    window.requestAnimationFrame(() => window.scrollTo({ top: lineListScrollRef.current, left: 0, behavior: 'auto' }));
  };
  useMobileBackLayer(Boolean(modal), () => {
    setModal(null);
    setComment('');
    setErrorText(null);
  }, 800);
  useMobileBackLayer(Boolean(selectedLine) && !modal, closeLine, 500);
  const [lineFilter, setLineFilter] = useState<LineFilter>('WORKING');
  const [minuteNow, setMinuteNow] = useState(Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const canManageToday = Boolean(
    currentUser?.permissions.includes('defrost.manage'),
  );

  const modalLines = useMemo(() => {
    if (!modal) return lines;
    if (modal.mode === 'start') return lines.filter((line) => line.canStartDefrost !== false && line.status !== 'WORK' && !line.activeEvent);
    if (modal.mode === 'complete') return lines.filter((line) => Boolean(line.activeEvent));
    return lines;
  }, [lines, modal]);

  const filteredLines = useMemo(() => {
    if (lineFilter === 'WORKING') return lines.filter((line) => line.status === 'WORK' && !line.activeEvent);
    return lines.filter((line) => Boolean(line.activeEvent));
  }, [lineFilter, lines]);

  const selectedDay = useMemo(
    () => calendar?.days.find((day) => day.date === selectedDate) ?? null,
    [calendar, selectedDate],
  );

  const isToday = selectedDate === (calendar?.today ?? dateKey());
  const isPast = selectedDate < (calendar?.today ?? dateKey());
  const isFuture = selectedDate > (calendar?.today ?? dateKey());

  const loadLines = async () => {
    setLoadingLines(true);
    setErrorText(null);
    try {
      const response = await apiClient.get<DefrostLine[]>('/defrost/lines');
      const responseServerNow = response.find((line) => line.serverNow)?.serverNow;
      if (responseServerNow) {
        const parsedServerNow = new Date(responseServerNow).getTime();
        if (Number.isFinite(parsedServerNow)) setServerOffsetMs(parsedServerNow - Date.now());
      }
      setLines(response);
      setSelectedLine((current) => current
        ? response.find((line) => line.id === current.id) ?? current
        : current);
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setLoadingLines(false);
    }
  };

  const loadCalendar = async (lineId: string, month: string, options: { preserveSelectedDate?: boolean } = {}) => {
    setLoadingCalendar(true);
    setErrorText(null);
    try {
      const data = await apiClient.get<CalendarResponse>(`/defrost/lines/${lineId}/calendar?month=${encodeURIComponent(month)}`);
      setCalendar(data);
      setSelectedDate((current) => {
        if (options.preserveSelectedDate && data.days.some((day) => day.date === current)) return current;
        return month === data.today.slice(0, 7) ? data.today : `${month}-01`;
      });
      setSelectedLine((current) => current?.id === lineId ? { ...current, shockChamberBlowStats: data.shockChamberBlowStats ?? current.shockChamberBlowStats } : current);
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      setLoadingCalendar(false);
    }
  };

  const loadSummary = async (lineId: string, days: 30 | 60) => {
    try {
      setSummary(await apiClient.get<DefrostSummary>(`/defrost/lines/${lineId}/summary?days=${days}`));
    } catch {
      setSummary(null);
    }
  };

  useEffect(() => {
    void loadLines();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setMinuteNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedLine) return;
    void loadCalendar(selectedLine.id, selectedMonth);
  }, [selectedLine?.id, selectedMonth]);

  useEffect(() => {
    if (!selectedLine) return;
    void loadSummary(selectedLine.id, summaryDays);
  }, [selectedLine?.id, summaryDays]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        const lineId = selectedLine?.id ?? null;
        void (async () => {
          await loadLines();
          if (!lineId) return;
          await Promise.all([
            loadCalendar(lineId, selectedMonth, { preserveSelectedDate: true }),
            loadSummary(lineId, summaryDays),
          ]);
        })();
      }, 140);
    };
    window.addEventListener('zavod:defrost-updated', refresh);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('zavod:defrost-updated', refresh);
    };
  }, [selectedLine?.id, selectedMonth, summaryDays]);

  const openLine = (line: DefrostLine) => {
    lineListScrollRef.current = window.scrollY;
    setSelectedLine(line);
    setSelectedMonth(currentMonth());
    setSelectedDate(dateKey());
    setCalendar(null);
    setSummary(null);
    setErrorText(null);
    setNoticeText(null);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  };

  const refreshAfterAction = async () => {
    await loadLines();
    if (selectedLine) await loadCalendar(selectedLine.id, selectedMonth, { preserveSelectedDate: true });
    if (selectedLine) await loadSummary(selectedLine.id, summaryDays);
  };

  const submitAction = async (line: DefrostLine, submittedComment = comment) => {
    if (!modal || busy || actionInFlightRef.current) return;
    const input = JSON.stringify([modal.mode, line.id, submittedComment]);
    if (actionAttemptRef.current?.input !== input) {
      actionAttemptRef.current = { input, operationId: crypto.randomUUID() };
    }
    actionInFlightRef.current = true;
    setBusy(true);
    setErrorText(null);
    setNoticeText(null);
    try {
      const endpoint = modal.mode === 'start'
        ? `/defrost/lines/${line.id}/start-today`
        : modal.mode === 'complete'
          ? `/defrost/lines/${line.id}/complete-today`
          : `/defrost/lines/${line.id}/shock-chamber-blown`;
      const result = await apiClient.post<{ message?: string; shockChamberBlowStats?: ShockChamberBlowStats }>(endpoint, {
        comment: submittedComment,
        operationId: actionAttemptRef.current.operationId,
      });
      if (modal.mode === 'blow') {
        setNoticeText(result.message ?? 'Отметка сохранена.');
        setSelectedLine((current) => current?.id === line.id ? { ...current, shockChamberBlowStats: result.shockChamberBlowStats ?? current.shockChamberBlowStats } : current);
      }
      setModal(null);
      setComment('');
      if (modal.mode === 'complete') {
        setSelectedLine((current) => current?.id === line.id ? { ...current, activeEvent: null } : current);
      }
      await refreshAfterAction();
    } catch (error) {
      setErrorText(errorMessage(error));
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  };

  const openAction = (mode: ModalState['mode']) => {
    actionAttemptRef.current = null;
    setComment('');
    setErrorText(null);
    setNoticeText(null);
    setModal({ mode });
  };

  const selectLineFilter = (filter: LineFilter) => {
    setLineFilter(filter);
    window.setTimeout(() => lineListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  };

  const renderLineList = () => (
    <>
      <PremiumSectionHeader
        title="Оттайка"
        subtitle="Быстрая фиксация оттайки и запуска в работу по производственным линиям."
      />

      <PremiumKpiStrip
        className="defrost-kpi-strip"
        items={[
          { label: 'В работе', value: lines.filter((line) => line.status === 'WORK' && !line.activeEvent).length, icon: '▶', tone: 'success', active: lineFilter === 'WORKING', onClick: () => selectLineFilter('WORKING') },
          { label: 'На оттайке', value: lines.filter((line) => Boolean(line.activeEvent)).length, icon: '❄', tone: 'cool', active: lineFilter === 'DEFROST', onClick: () => selectLineFilter('DEFROST') },
        ]}
        label="Состояние оттайки"
      />

      {canManageToday ? (
        <div className="defrost-primary-actions">
          <button className="action-button danger" type="button" onClick={() => openAction('start')}>
            Поставить на оттайку
          </button>
          <button className="action-button warning" type="button" onClick={() => openAction('blow')}>
            Обдул шоковую камеру
          </button>
          <button className="action-button work" type="button" onClick={() => openAction('complete')}>
            Запустить в работу
          </button>
        </div>
      ) : null}

      {loadingLines ? <div className="empty-state">Загрузка линий...</div> : null}
      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {noticeText ? <div className="empty-state success-state">{noticeText}</div> : null}
      {!loadingLines && !errorText && !lines.length ? <div className="empty-state">Производственные линии не найдены.</div> : null}

      <div className="defrost-line-grid" ref={lineListRef}>
        {filteredLines.map((line) => {
          const duration = line.activeEvent
            ? liveDuration(line.activeEvent.startAt, minuteNow + serverOffsetMs)
            : liveDuration(line.currentRunStartedAt, minuteNow + serverOffsetMs);
          const noBlowAfterStart = Boolean(
            !line.activeEvent
            && line.currentRunStartedAt
            && (!line.shockChamberBlowStats?.lastAt || new Date(line.shockChamberBlowStats.lastAt) < new Date(line.currentRunStartedAt)),
          );
          const sinceLastBlow = liveDuration(line.shockChamberBlowStats?.lastAt, minuteNow + serverOffsetMs);
          return (
          <button className="defrost-line-card" key={line.id} onClick={() => openLine(line)} type="button">
            <span className="defrost-line-card-head">
              <span className="defrost-line-title">{line.name}</span>
              <span className={`tag ${line.badge === 'ON_DEFROST' ? 'stop' : line.badge === 'WORK_STARTED' ? 'work' : ''}`}>
                {line.activeEvent ? 'На оттайке' : 'В работе'}
              </span>
            </span>
            <span className="defrost-line-last">{lastEventText(line)}</span>
            {duration ? <span className="defrost-line-duration">{line.activeEvent ? 'На оттайке' : 'В работе'}: {duration}</span> : null}
            <span className={`defrost-blow-counter ${shockChamberClass(line.shockChamberBlowStats)}`}>
              {shockChamberText(line.shockChamberBlowStats)}
            </span>
            {sinceLastBlow ? <span className="defrost-line-duration">С последнего обдува: {sinceLastBlow}</span> : null}
            {noBlowAfterStart ? <span className="defrost-blow-warning warning">После запуска обдувов не было</span> : null}
            {line.shockChamberBlowStats?.warningText ? (
              <span className={`defrost-blow-warning ${shockChamberClass(line.shockChamberBlowStats)}`}>
                {line.shockChamberBlowStats.warningText}
              </span>
            ) : null}
          </button>
          );
        })}
        {!filteredLines.length && lines.length ? <div className="empty-state compact">По выбранному состоянию линий нет.</div> : null}
      </div>
      <ChamberPanel currentUser={currentUser} factoryId={selectedFactoryId} />
    </>
  );

  const renderDateDetail = () => {
    if (!selectedLine || !selectedDay) return null;
    const timeline = [
      ...selectedDay.startEvents.map((event) => ({
        key: `start-${event.id}`,
        at: event.startAt,
        title: `Оттайка в ${formatTime(event.startAt)}`,
        text: event.comment || 'Комментария нет',
        author: event.startedBy?.displayName ?? 'зафиксирован',
        tone: 'defrost',
        duration: event.durationSeconds === null ? null : formatMinutes(Math.round(event.durationSeconds / 60)),
      })),
      ...selectedDay.workEvents.map((event) => ({
        key: `work-${event.id}`,
        at: event.endAt ?? event.startAt,
        title: `Запущено в работу в ${formatTime(event.endAt)}`,
        text: event.endComment || 'Комментария нет',
        author: event.endedBy?.displayName ?? 'зафиксирован',
        tone: 'work',
        duration: null,
      })),
      ...(selectedDay.shockChamberBlowEvents ?? []).map((event) => ({
        key: `blow-${event.id}`,
        at: event.startAt,
        title: `Обдув шоковой камеры в ${formatTime(event.startAt)}`,
        text: event.comment || 'Комментария нет',
        author: event.startedBy?.displayName ?? 'зафиксирован',
        tone: 'blow',
        duration: null,
      })),
    ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
    return (
      <aside className="card defrost-detail-card">
        <div className="card-header">
          <div>
            <h3>{selectedLine.name}</h3>
            <p>{formatDate(selectedDate)}</p>
          </div>
          {isToday ? <span className="tag work">Сегодня</span> : null}
        </div>

        {timeline.length ? (
          <div className="defrost-event-block">
            <h4>События: {timeline.length}</h4>
            {timeline.map((event) => (
              <div className={`defrost-event-row ${event.tone}`} key={event.key}>
                <strong>{event.title}</strong>
                <span>{event.text}</span>
                <small>{event.duration ? `${event.duration} · ` : ''}Автор: {event.author}</small>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">Событий нет.</div>
        )}

        {isPast ? <p className="helper-text">Прошлые даты доступны только для просмотра.</p> : null}
        {isFuture ? <p className="helper-text">Будущие даты доступны только для просмотра.</p> : null}
        {!canManageToday && isToday ? <p className="helper-text">Редактировать может только холодильная служба.</p> : null}

      </aside>
    );
  };

  const renderCalendar = () => {
    if (!selectedLine) return null;
    const firstOffset = calendar?.days[0] ? dayOffset(calendar.days[0].date) : 0;
    return (
      <>
        <div className="screen-heading">
          <button className="secondary-button defrost-back-button" type="button" onClick={closeLine}>
            К списку линий
          </button>
          <h2>{selectedLine.name}</h2>
          <p>Красный день — линию поставили на оттайку, зелёный — запустили в работу.</p>
          <div className={`defrost-selected-blow ${shockChamberClass(selectedLine.shockChamberBlowStats)}`}>
            <strong>{shockChamberText(selectedLine.shockChamberBlowStats)}</strong>
            {selectedLine.shockChamberBlowStats?.warningText ? <span>{selectedLine.shockChamberBlowStats.warningText}</span> : null}
          </div>
        </div>

        <div className="defrost-month-toolbar">
          <button className="secondary-button" type="button" onClick={() => setSelectedMonth((value) => shiftMonth(value, -1))}>
            Назад
          </button>
          <strong>{monthTitle(selectedMonth)}</strong>
          <button className="secondary-button" type="button" onClick={() => setSelectedMonth((value) => shiftMonth(value, 1))}>
            Вперёд
          </button>
          <button className="secondary-button" type="button" onClick={() => setSelectedMonth(currentMonth())}>
            Сегодня
          </button>
        </div>

        {loadingCalendar ? <div className="empty-state">Загрузка календаря...</div> : null}
        {errorText ? <div className="empty-state error-state">{errorText}</div> : null}

        {calendar ? (
          <div className="defrost-calendar-layout">
            <div className="defrost-calendar-card">
              <div className="defrost-calendar-grid">
                {weekdayLabels.map((day) => <div className="defrost-weekday" key={day}>{day}</div>)}
                {Array.from({ length: firstOffset }).map((_item, index) => (
                  <div className="defrost-day-placeholder" key={`empty-${index}`} />
                ))}
                {calendar.days.map((day) => (
                  <button
                    className={`defrost-day ${colorClass(day)} ${day.date === selectedDate ? 'selected' : ''} ${day.date === calendar.today ? 'today' : ''}`}
                    key={day.date}
                    onClick={() => setSelectedDate(day.date)}
                    type="button"
                  >
                    <span>{dayNumber(day.date)}</span>
                    {(day.startCount || day.workCount || day.shockChamberBlowCount) ? (
                      <small className="defrost-day-count">{(day.startCount ?? 0) + (day.workCount ?? 0) + (day.shockChamberBlowCount ?? 0)}</small>
                    ) : null}
                    {day.hasShockChamberBlown ? <i className="defrost-day-blow-dot" aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
              <div className="defrost-legend">
                <span><i className="legend-red" />Поставили на оттайку</span>
                <span><i className="legend-green" />Запустили в работу</span>
                <span><i className="legend-split" />Оба события</span>
                <span><i className="legend-blow" />Обдул шоковую камеру</span>
              </div>
            </div>
            {renderDateDetail()}
          </div>
        ) : null}

        <section className="card defrost-summary-card">
          <div className="card-header">
            <div>
              <h3>Сводка оттайки</h3>
              <p>Коротко о частоте и длительности.</p>
            </div>
            <div className="button-row">
              <button className={`secondary-button ${summaryDays === 30 ? 'active' : ''}`} type="button" onClick={() => setSummaryDays(30)}>30 дней</button>
              <button className={`secondary-button ${summaryDays === 60 ? 'active' : ''}`} type="button" onClick={() => setSummaryDays(60)}>60 дней</button>
            </div>
          </div>
          {summary ? (
            <div className="metric-grid compact-metrics">
              <div className="metric-card"><div className="metric-label">Оттаек</div><div className="metric-value">{summary.defrostCount}</div></div>
              <div className="metric-card"><div className="metric-label">Средняя оттайка</div><div className="metric-value">{formatMinutes(summary.averageDefrostMinutes)}</div></div>
              <div className="metric-card"><div className="metric-label">Между оттайками</div><div className="metric-value">{formatMinutes(summary.averageWorkBetweenDefrostsMinutes)}</div></div>
              <div className="metric-card"><div className="metric-label">Дней с событиями</div><div className="metric-value">{summary.workingDays ?? 'Нет данных'}</div></div>
            </div>
          ) : (
            <div className="empty-state compact">Недостаточно данных для расчёта</div>
          )}
          {summary?.message ? <p className="helper-text">{summary.message}</p> : null}
        </section>
      </>
    );
  };

  return (
    <section className="screen-panel">
      {selectedLine ? renderCalendar() : renderLineList()}

      {modal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card defrost-action-modal premium-deep-form">
            <header className="modal-header">
              <h3>{modal.mode === 'start' ? 'Поставить на оттайку' : modal.mode === 'complete' ? 'Запустить в работу' : 'Обдул шоковую камеру'}</h3>
              <button className="secondary-button" disabled={busy} type="button" onClick={() => { setModal(null); setComment(''); setErrorText(null); }}>Закрыть</button>
            </header>
            <p>
              {modal.mode === 'start'
                ? 'Выберите линию. Дата и время будут взяты автоматически.'
                : modal.mode === 'complete'
                  ? 'Выберите линию с активной оттайкой. Дата и время запуска будут взяты автоматически.'
                  : 'Выберите линию или шоковую камеру. Отметка сохранится в истории и обновит счётчик с последней оттайки.'}
            </p>
            <label className="field-label">
              Комментарий
              <textarea disabled={busy} onChange={(event) => setComment(event.target.value)} placeholder="Можно оставить пустым" value={comment} />
            </label>
            {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
            <div className="defrost-modal-line-list">
              {modal.mode === 'start' && !modalLines.length ? (
                <div className="empty-state compact">Нет остановленных линий для оттайки. Сначала остановите линию.</div>
              ) : null}
              {modal.mode === 'complete' && !modalLines.length ? (
                <div className="empty-state compact">Нет активной оттайки для запуска в работу.</div>
              ) : null}
              {modalLines.map((line) => {
                const disabled = busy || (modal.mode === 'start' && Boolean(line.activeEvent)) || (modal.mode === 'complete' && !line.activeEvent);
                return (
                  <button
                    className={`defrost-modal-line ${line.activeEvent ? 'active-defrost' : ''}`}
                    disabled={disabled}
                    key={line.id}
                    onClick={() => void submitAction(line, comment)}
                    type="button"
                  >
                    <strong>{line.name}</strong>
                    <span>{modal.mode === 'blow' ? shockChamberText(line.shockChamberBlowStats) : line.activeEvent ? `На оттайке с ${formatTime(line.activeEvent.startAt)}` : lastEventText(line)}</span>
                    {modal.mode === 'blow' && line.shockChamberBlowStats?.warningText ? <span className={`defrost-blow-warning ${shockChamberClass(line.shockChamberBlowStats)}`}>{line.shockChamberBlowStats.warningText}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
