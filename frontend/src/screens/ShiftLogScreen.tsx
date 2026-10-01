import React, { useEffect, useMemo, useRef, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { apiClient } from '../api/client';
import { ActionModal } from '../components/ActionModal';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { PremiumKpiStrip, PremiumSectionHeader, PremiumSheet } from '../components/PremiumShell';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { displayLabel, shiftLogStatusLabels } from '../labels';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { ShiftLog, useAppStore } from '../store/app.store';

type Tab = 'active' | 'important' | 'archive';
type LogModal = 'create' | 'comment' | 'attachment' | 'close-important' | null;
type DirectoryDepartment = { id: string; name: string };

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatLogDate(value?: string | null) {
  if (!value) return 'Дата не указана';
  return new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}

const handoverSectionLabels: Record<string, { title: string; empty: string }> = {
  lines: { title: 'Линии в работе', empty: 'Нет продолжающих работу линий' },
  washes: { title: 'Мойка', empty: 'Нет продолжающихся моек' },
  tasks: { title: 'Простои и заявки', empty: 'Нет активных простоев' },
};

const handoverSectionOrder = ['lines', 'washes', 'tasks'] as const;

export function ShiftLogScreen() {
  const { currentUser, selectedFactoryId } = useAppStore();
  const [tab, setTab] = useState<Tab>('active');
  const [logs, setLogs] = useState<ShiftLog[]>([]);
  const [selected, setSelected] = useState<ShiftLog | null>(null);
  const [modal, setModal] = useState<LogModal>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: '', dateFrom: '', dateTo: '', departmentId: '', shiftLabel: '' });
  const [filterDraft, setFilterDraft] = useState(filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [departments, setDepartments] = useState<DirectoryDepartment[]>([]);
  const [opening, setOpening] = useState(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const loadSequence = useRef(0);
  const openSequence = useRef(0);
  const scope = JSON.stringify([selectedFactoryId, currentUser?.userId, currentUser?.role, currentUser?.departmentId, currentUser?.permissions]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const closeSelected = () => { openSequence.current += 1; setOpening(false); setSelected(null); };

  const canCreate = Boolean(currentUser?.permissions.includes('shift-log.create') || currentUser?.permissions.includes('shift-log.manage'));
  const canArchive = Boolean(currentUser?.permissions.includes('shift-log.archive.read') || currentUser?.permissions.includes('shift-log.manage'));
  const canImportant = Boolean(currentUser?.permissions.includes('shift-log.important.manage') || currentUser?.permissions.includes('shift-log.manage') || currentUser?.isAdmin);
  useBodyScrollLock(Boolean(selected) || modal === 'attachment');
  useMobileBackLayer((Boolean(selected) || opening) && !modal, closeSelected, 700);
  useMobileBackLayer(modal === 'attachment', () => setModal(null), 740);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (tab === 'important') params.set('importantOnly', 'true');
    if (tab === 'archive') params.set('includeClosed', 'true');
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters, tab]);

  const viewKey = `${scope}:${tab}:${query}`;
  const viewRef = useRef(viewKey);
  viewRef.current = viewKey;

  const load = async (silent = false) => {
    if (silent && loadingRef.current) return;
    const sequence = ++loadSequence.current;
    const current = () => viewRef.current === viewKey && sequence === loadSequence.current;
    if (!silent) { setLoading(true); setErrorText(null); }
    try {
      const path = tab === 'archive' ? `/shift-log/archive${query ? `?${query}` : ''}` : `/shift-log${query ? `?${query}` : ''}`;
      const rows = await apiClient.get<ShiftLog[]>(path);
      if (!current()) return;
      setLogs(rows);
      const selectedId = selectedRef.current?.id;
      if (silent && selectedId) {
        try {
          const detail = await apiClient.get<ShiftLog>(`/shift-log/${tab === 'archive' ? 'archive/' : ''}${selectedId}`);
          // Polling must not reopen a detail closed with Back or replace another log/draft.
          if (current()) setSelected((previous) => previous?.id === selectedId ? detail : previous);
        } catch (error) {
          if (current()) { setSelected((previous) => previous?.id === selectedId ? null : previous); setModal(null); throw error; }
        }
      }
      if (currentUser?.isAdmin && !silent) {
        const items = await apiClient.get<DirectoryDepartment[]>('/directory/departments');
        if (current()) setDepartments(items);
      }
    } catch (error) {
      if (current()) { setLogs([]); setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить пересменку'); }
    } finally {
      if (current() && !silent) setLoading(false);
    }
  };

  useEffect(() => {
    scopeRef.current = scope; viewRef.current = viewKey;
    closeSelected(); setModal(null); setFiles([]); setLogs([]); setDepartments([]);
    return () => { scopeRef.current = ''; viewRef.current = ''; openSequence.current += 1; };
  }, [scope]);

  useEffect(() => {
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await load(true); } finally { inFlight = false; }
    };
    void load();
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); loadSequence.current += 1; };
  }, [query, tab, scope]);

  const departmentOptions = useMemo(() => {
    const seen = new Set<string>();
    return departments
      .filter((department) => department.id && department.name && !seen.has(department.id) && seen.add(department.id))
      .map((department) => ({ label: department.name, value: department.id }));
  }, [departments]);

  const openLog = async (log: ShiftLog) => {
    const sequence = ++openSequence.current;
    const current = () => sequence === openSequence.current && scopeRef.current === scope;
    setOpening(true);
    setErrorText(null);
    try {
      const archived = tab === 'archive';
      const detail = await apiClient.get<ShiftLog>(`/shift-log/${archived ? 'archive/' : ''}${log.id}`);
      if (!current()) return;
      setSelected(detail);
      if (!archived) await apiClient.post(`/shift-log/${log.id}/read`, {});
    } catch (error) {
      if (current()) setErrorText(error instanceof Error ? error.message : 'Не удалось открыть запись пересменки');
    } finally { if (current()) setOpening(false); }
  };

  const uploadForLog = async () => {
    if (!selected || !files.length) return;
    setLoading(true);
    setErrorText(null);
    try {
      await uploadAttachments('SHIFT_LOG', selected.id, files);
      setFiles([]);
      setModal(null);
      setSelected(await apiClient.get<ShiftLog>(`/shift-log/${selected.id}`));
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить файл');
    } finally {
      setLoading(false);
    }
  };

  const submitModal = async (values: Record<string, string | boolean>) => {
    setLoading(true);
    setErrorText(null);
    try {
      if (modal === 'create') {
        const created = await apiClient.post<ShiftLog>('/shift-log', {
          title: values.title,
          text: values.text,
          logDate: values.logDate || todayKey(),
          shiftLabel: values.shiftLabel || 'День',
          isImportant: Boolean(values.isImportant),
          departmentId: values.departmentId || currentUser?.departmentId,
        });
        setSelected(created);
      }
      if (modal === 'comment' && selected) {
        await apiClient.post(`/shift-log/${selected.id}/comment`, { text: values.text });
        setSelected(await apiClient.get<ShiftLog>(`/shift-log/${selected.id}`));
      }
      if (modal === 'close-important' && selected) {
        await apiClient.post(`/shift-log/${selected.id}/close-important`, { comment: values.comment });
        setSelected(await apiClient.get<ShiftLog>(`/shift-log/${selected.id}`));
      }
      setModal(null);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Действие не выполнено');
    } finally {
      setLoading(false);
    }
  };

  const openFilters = () => {
    setFilterDraft(filters);
    setFilterOpen(true);
  };

  const filterSummary = [
    filters.search ? `«${filters.search}»` : '',
    filters.shiftLabel || '',
    filters.dateFrom || filters.dateTo ? `${filters.dateFrom || 'начало'} — ${filters.dateTo || 'сегодня'}` : '',
    filters.departmentId ? departmentOptions.find((item) => item.value === filters.departmentId)?.label ?? '' : '',
  ].filter(Boolean).join(' · ') || 'Все доступные записи';

  return (
    <section className="screen-panel shift-log-screen">
      <PremiumSectionHeader
        title="Пересменка"
        subtitle="Отделовый журнал передачи смены с важными уведомлениями, комментариями и файлами."
      />
      <PremiumKpiStrip
        className="shift-log-kpi-strip"
        items={[
          { label: 'Записи', value: logs.length, icon: '≡', tone: 'neutral' },
          { label: 'Важные', value: logs.filter((log) => log.isImportant).length, icon: '!', tone: 'danger' },
          { label: 'День', value: logs.filter((log) => log.shiftLabel === 'День').length, icon: '☼', tone: 'success' },
          { label: 'Ночь', value: logs.filter((log) => log.shiftLabel === 'Ночь').length, icon: '☾', tone: 'cool' },
        ]}
        label="Состояние журнала смены"
      />
      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      <div className="shift-log-scope-note">
        {currentUser?.isAdmin ? 'Администратор видит журнал по доступному заводу.' : 'Показаны записи вашего отдела или службы.'}
      </div>

      <div className="segmented-control">
        <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')} type="button">Активные</button>
        <button className={tab === 'important' ? 'active' : ''} onClick={() => setTab('important')} type="button">Важные</button>
        {canArchive ? <button className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')} type="button">Архив</button> : null}
      </div>

      <div className="premium-filter-trigger-row shift-log-filter-trigger">
        <button className="secondary-button" type="button" onClick={openFilters}>Поиск и фильтры</button>
        <span className="premium-filter-summary">{filterSummary}</span>
        {canCreate ? <button className="primary-button" type="button" onClick={() => setModal('create')}>Новая запись</button> : null}
      </div>

      <PremiumSheet
        open={filterOpen}
        title="Поиск и фильтры"
        description="Отберите записи журнала по понятным признакам."
        onClose={() => setFilterOpen(false)}
        footer={(
          <>
            <button className="secondary-button" type="button" onClick={() => setFilterDraft({ search: '', dateFrom: '', dateTo: '', departmentId: '', shiftLabel: '' })}>Сбросить</button>
            <button className="primary-button" type="button" onClick={() => { setFilters(filterDraft); setFilterOpen(false); }}>Показать</button>
          </>
        )}
      >
        <div className="premium-filter-form">
          <label>Поиск<input autoFocus placeholder="Текст записи" value={filterDraft.search} onChange={(event) => setFilterDraft((current) => ({ ...current, search: event.target.value }))} /></label>
          <label>Дата с<input type="date" value={filterDraft.dateFrom} onChange={(event) => setFilterDraft((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
          <label>Дата по<input type="date" value={filterDraft.dateTo} onChange={(event) => setFilterDraft((current) => ({ ...current, dateTo: event.target.value }))} /></label>
          <label>
            Смена
            <select value={filterDraft.shiftLabel} onChange={(event) => setFilterDraft((current) => ({ ...current, shiftLabel: event.target.value }))}>
              <option value="">Все смены</option>
              <option value="День">День</option>
              <option value="Ночь">Ночь</option>
            </select>
          </label>
          {currentUser?.isAdmin ? (
            <label>
              Отдел
              <select value={filterDraft.departmentId} onChange={(event) => setFilterDraft((current) => ({ ...current, departmentId: event.target.value }))}>
                <option value="">Все отделы</option>
                {departmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </PremiumSheet>

      {loading ? <div className="empty-state">Загрузка...</div> : null}

      <div className="section-stack">
        {logs.length ? logs.map((log) => (
          <button className={`card list-row shift-log-card ${log.isImportant ? 'shift-log-important-card' : ''}`} key={log.id} onClick={() => void openLog(log)} type="button">
            <div>
              <strong>{log.title || 'Комментарий к смене'}</strong>
              <span>{formatLogDate(log.logDate ?? undefined)} · {log.shiftLabel ?? 'Смена не указана'} · {log.departmentName ? `Отдел: ${log.departmentName}` : 'Отдел не указан'}</span>
              <span>{displayLabel(shiftLogStatusLabels, log.status ?? 'ACTIVE')}</span>
              <span>{log.text}</span>
            </div>
            <span className={`tag ${log.isImportant ? 'stop' : 'work'}`}>{log.isImportant ? 'Важно' : `${log.comments?.length ?? 0} / ${log.readCount ?? 0}`}</span>
          </button>
        )) : <div className="empty-state">Нет записей для вашего отдела.</div>}
      </div>

      {selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card wide-modal">
            <div className="screen-header">
              <div>
                <p className="eyebrow">{displayLabel(shiftLogStatusLabels, selected.status ?? 'ACTIVE')} {selected.isImportant ? '· важно' : ''}</p>
                <h3>{selected.title || 'Запись пересменки'}</h3>
                <p>{formatLogDate(selected.logDate ?? undefined)} · {selected.shiftLabel ?? 'Смена не указана'} · {selected.departmentName ?? 'Отдел не указан'}</p>
              </div>
              <button className="secondary-button" onClick={() => setSelected(null)} type="button">Закрыть окно</button>
            </div>
            {selected.handover?.snapshot ? (
              <div className="handover-log-detail">
                <div className="handover-summary-strip">
                  <span className="tag">Передал: {selected.handover.snapshot.authorName}</span>
                  <span className={`tag ${selected.handover.snapshot.counts.total ? 'pause' : 'work'}`}>Хвостов: {selected.handover.snapshot.counts.total}</span>
                  <span className="tag work">Неизменяемый снимок</span>
                </div>
                {selected.handover.snapshot.comment ? <p><strong>Комментарий следующей смене:</strong> {selected.handover.snapshot.comment}</p> : null}
                {!selected.handover.snapshot.counts.total ? <div className="empty-state compact success-state">Смена передана без открытых оперативных хвостов.</div> : null}
                <div className="handover-sections">
                  {handoverSectionOrder.map((key) => {
                    const items = selected.handover!.snapshot.sections[key] ?? [];
                    const meta = handoverSectionLabels[key];
                    return (
                      <details className="handover-section" key={key} open={items.length > 0}>
                        <summary><span>{meta.title}</span><span className={`tag ${items.length ? 'pause' : ''}`}>{items.length}</span></summary>
                        {!items.length ? <div className="empty-state compact">{meta.empty}</div> : null}
                        {items.map((item) => (
                          <article className={`handover-item ${item.alreadyCompleted ? 'resolved' : ''}`} key={item.id}>
                            <div>
                              <strong>{item.title}</strong>
                              <span>{item.currentStatusLabel || item.statusLabel}{item.durationLabel ? ` · ${item.durationLabel}` : ''}</span>
                              {item.reason ? <span>{item.reason}</span> : null}
                              {item.description ? <span>{item.description}</span> : null}
                            </div>
                          </article>
                        ))}
                      </details>
                    );
                  })}
                </div>
              </div>
            ) : <p>{selected.text}</p>}
            {selected.archiveReadOnly ? <p className="muted">Архивная запись · только просмотр</p> : null}
            <AttachmentPreviewList attachments={selected.attachments ?? []} />
            <div className="button-row">
              {!selected.archiveReadOnly && !selected.handover ? <button className="secondary-button" onClick={() => setModal('comment')} type="button">Комментарий</button> : null}
              {!selected.archiveReadOnly && !selected.handover ? <button className="secondary-button" onClick={() => setModal('attachment')} type="button">Файл</button> : null}
              {!selected.archiveReadOnly && !selected.handover && selected.isImportant && canImportant ? <button className="secondary-button danger" onClick={() => setModal('close-important')} type="button">Закрыть важное</button> : null}
            </div>
            {(selected.comments ?? []).map((comment) => (
              <div className="comment-item" key={comment.id}>
                <strong>{comment.text}</strong>
                <AttachmentPreviewList attachments={comment.attachments ?? []} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {modal === 'create' ? (
        <ActionModal
          busy={loading}
          errorText={errorText}
          fields={[
            { name: 'title', label: 'Заголовок' },
            { name: 'logDate', label: 'Дата', type: 'date', defaultValue: todayKey(), required: true },
            { name: 'shiftLabel', label: 'Смена', type: 'select', options: [{ label: 'День', value: 'День' }, { label: 'Ночь', value: 'Ночь' }], defaultValue: 'День', required: true },
            { name: 'text', label: 'Комментарий к смене', type: 'textarea', required: true },
            ...(currentUser?.isAdmin ? [{ name: 'departmentId', label: 'Отдел', type: 'select' as const, options: departmentOptions, defaultValue: currentUser.departmentId ?? '', required: true }] : []),
            ...(canImportant ? [{ name: 'isImportant', label: 'Важная запись', type: 'checkbox' as const }] : []),
          ]}
          onCancel={() => setModal(null)}
          onSubmit={submitModal}
          title="Новая запись"
        />
      ) : null}

      {modal === 'comment' && selected ? (
        <ActionModal busy={loading} errorText={errorText} fields={[{ name: 'text', label: 'Комментарий', type: 'textarea', required: true }]} onCancel={() => setModal(null)} onSubmit={submitModal} title="Комментарий" />
      ) : null}

      {modal === 'close-important' && selected ? (
        <ActionModal busy={loading} errorText={errorText} fields={[{ name: 'comment', label: 'Комментарий закрытия', type: 'textarea', required: true }]} onCancel={() => setModal(null)} onSubmit={submitModal} title="Закрыть важное уведомление" />
      ) : null}

      {modal === 'attachment' && selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>Файл к записи</h3>
            <AttachmentPicker value={files} onChange={setFiles} allowFiles disabled={loading} />
            {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
            <div className="modal-actions">
              <button className="secondary-button" disabled={loading} type="button" onClick={() => setModal(null)}>Отмена</button>
              <button className="primary-button" disabled={loading || !files.length} type="button" onClick={() => void uploadForLog()}>Загрузить</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
