import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { useRef } from 'react';
import { uploadAttachments } from '../api/attachments';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { PremiumSectionHeader } from '../components/PremiumShell';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { announcementPriorityLabels, displayLabel } from '../labels';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { AnnouncementItem, appStore, useAppStore } from '../store/app.store';
import { isPilotFixtureText } from '../utils/pilot-ui';

type Tab = 'new' | 'archive' | 'manage';
type Modal = 'create' | 'edit' | 'archive' | 'report' | null;
type DepartmentOption = { id: string; name: string };
type AudienceType = 'FACTORY' | 'MY_DEPARTMENT' | 'SELECTED';
type AnnouncementRecurrence = 'NONE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
type AnnouncementDraft = {
  title: string;
  text: string;
  priority: string;
  audienceType: AudienceType;
  departmentIds: string[];
  visibleUntil: string;
  recurrence: AnnouncementRecurrence;
};
type AckReportRow = {
  userId: string;
  displayName: string;
  departmentName?: string | null;
  roleLabel?: string | null;
  acknowledgedAt?: string | null;
};
type AckReport = {
  announcement: AnnouncementItem;
  acknowledged: AckReportRow[];
  pending: AckReportRow[];
  totals: { all: number; acknowledged: number; pending: number };
};
const ANNOUNCEMENT_REFRESH_INTERVAL_MS = 8000;
const announcementRecurrenceLabels: Record<AnnouncementRecurrence, string> = {
  NONE: 'Не повторять',
  WEEKLY: 'Раз в неделю',
  BIWEEKLY: 'Раз в 2 недели',
  MONTHLY: 'Раз в месяц',
};

const emptyDraft: AnnouncementDraft = {
  title: '',
  text: '',
  priority: 'NORMAL',
  audienceType: 'FACTORY' as AudienceType,
  departmentIds: [] as string[],
  visibleUntil: '',
  recurrence: 'NONE',
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatShortDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function visibleTitle(item: AnnouncementItem) {
  return item.title || 'Объявление';
}

function announcementsSignature(items: AnnouncementItem[]) {
  return items.map((item) => `${item.id}:${item.acknowledgedAt ?? ''}:${item.readAt ?? ''}`).join('|');
}

export function AnnouncementsScreen() {
  const { currentUser } = useAppStore();
  const [tab, setTab] = useState<Tab>('new');
  const [unread, setUnread] = useState<AnnouncementItem[]>([]);
  const [archive, setArchive] = useState<AnnouncementItem[]>([]);
  const [managed, setManaged] = useState<AnnouncementItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selected, setSelected] = useState<AnnouncementItem | null>(null);
  const [report, setReport] = useState<AckReport | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState('Нет новых событий');
  const [pageByAnnouncement, setPageByAnnouncement] = useState<Record<string, number>>({});
  const [acknowledgedId, setAcknowledgedId] = useState<string | null>(null);
  const announcementTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const unreadSignatureRef = useRef('');

  const closeModal = () => {
    if (loading) return;
    setModal(null);
    if (modal === 'report') setReport(null);
  };

  useBodyScrollLock(Boolean(modal));
  useMobileBackLayer(Boolean(modal), closeModal, 760);
  useMobileBackLayer(tab === 'archive' && Boolean(selected) && !modal, () => setSelected(null), 650);

  const canCreate = Boolean(
    currentUser?.isAdmin
    || currentUser?.permissions.includes('announcements.create'),
  );
  const canManage = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('announcements.manage'));
  const canArchive = Boolean(!currentUser?.isGuest && (
    currentUser?.isAdmin ||
    currentUser?.permissions.includes('announcements.read') ||
    currentUser?.permissions.includes('announcements.archive.read')
  ));

  const cleanUnread = useMemo(() => unread.filter((item) => !isPilotFixtureText(item.title, item.text)), [unread]);
  const current = cleanUnread[0] ?? null;
  const currentIndex = current ? cleanUnread.findIndex((item) => item.id === current.id) + 1 : 0;
  const unreadLabel = cleanUnread.length === 1 ? '1 непрочитанное' : `${cleanUnread.length} непрочитанных`;
  const selectedDepartmentNames = departments
    .filter((department) => draft.departmentIds.includes(department.id))
    .map((department) => department.name);
  const audiencePreviewLabel = draft.audienceType === 'FACTORY'
    ? 'Получатели: весь завод'
    : draft.audienceType === 'MY_DEPARTMENT'
      ? 'Получатели: мой отдел'
      : selectedDepartmentNames.length
        ? `Получатели: ${selectedDepartmentNames.join(', ')}`
        : 'Получатели: отделы не выбраны';

  const loadUnread = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    if (!options?.silent) setErrorText(null);
    try {
      const response = await apiClient.get<{ total: number; current: AnnouncementItem | null; items: AnnouncementItem[] }>('/announcements/current');
      const nextItems = (response.items ?? []).filter((item) => !isPilotFixtureText(item.title, item.text));
      setUnread(response.items ?? []);
      appStore.setAnnouncementsUnreadCount(nextItems.length);
      const nextSignature = announcementsSignature(nextItems);
      if (unreadSignatureRef.current && nextSignature !== unreadSignatureRef.current) {
        setLiveStatus('Новое объявление или обновление');
      }
      unreadSignatureRef.current = nextSignature;
    } catch (error) {
      if (!options?.silent) {
        setUnread([]);
        appStore.setAnnouncementsUnreadCount(0);
        setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить новые объявления.');
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  const loadArchive = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const response = await apiClient.get<AnnouncementItem[]>('/announcements/archive');
      setArchive(response.filter((item) => !isPilotFixtureText(item.title, item.text)));
    } catch (error) {
      setArchive([]);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить архив объявлений.');
    } finally {
      setLoading(false);
    }
  };

  const loadManaged = async () => {
    if (!canManage) return;
    setLoading(true);
    setErrorText(null);
    try {
      const response = await apiClient.get<AnnouncementItem[]>('/announcements?activeOnly=false');
      setManaged(response.filter((item) => !isPilotFixtureText(item.title, item.text)));
    } catch (error) {
      setManaged([]);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить управление объявлениями.');
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async () => {
    if (!canCreate && !canManage) return;
    try {
      setDepartments(await apiClient.get<DepartmentOption[]>('/announcements/audience-departments'));
    } catch {
      setDepartments([]);
    }
  };

  useEffect(() => {
    void loadUnread();
    void loadDepartments();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (tab === 'new') void loadUnread({ silent: true });
    }, ANNOUNCEMENT_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [tab]);

  const openTab = (nextTab: Tab) => {
    if (nextTab === 'archive' && !canArchive) return;
    setTab(nextTab);
    if (nextTab === 'new') void loadUnread();
    if (nextTab === 'archive') void loadArchive();
    if (nextTab === 'manage') void loadManaged();
  };

  useEffect(() => {
    if (tab === 'archive' && !canArchive) setTab('new');
  }, [tab, canArchive]);

  const acknowledge = async (item: AnnouncementItem) => {
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/announcements/${item.id}/ack`, {});
      setAcknowledgedId(item.id);
      setUnread((items) => items.map((announcement) => (
        announcement.id === item.id
          ? { ...announcement, acknowledgedAt: new Date().toISOString(), readAt: new Date().toISOString() }
          : announcement
      )));
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setUnread((items) => {
        const nextItems = items.filter((announcement) => announcement.id !== item.id);
        appStore.setAnnouncementsUnreadCount(nextItems.filter((announcement) => !isPilotFixtureText(announcement.title, announcement.text)).length);
        return nextItems;
      });
      await loadUnread();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось отметить ознакомление.');
    } finally {
      setAcknowledgedId(null);
      setLoading(false);
    }
  };

  const openCreate = () => {
    setSelected(null);
    setDraft(emptyDraft);
    setFiles([]);
    setModal('create');
  };

  const openEdit = (item: AnnouncementItem) => {
    setSelected(item);
    setDraft({
      title: item.title,
      text: item.text,
      priority: item.priority,
      audienceType: (item.audienceType as AudienceType)
        ?? (item.departmentIds?.length ? 'SELECTED' : item.departmentId ? 'MY_DEPARTMENT' : 'FACTORY'),
      departmentIds: item.departmentIds ?? [],
      visibleUntil: item.visibleUntil ? item.visibleUntil.slice(0, 16) : '',
      recurrence: (item.recurrence as AnnouncementRecurrence) ?? 'NONE',
    });
    setFiles([]);
    setModal('edit');
  };

  const saveAnnouncement = async () => {
    if (!draft.title.trim() || !draft.text.trim()) {
      setErrorText('Заполните заголовок и текст объявления.');
      return;
    }
    if (draft.audienceType === 'SELECTED' && !draft.departmentIds.length) {
      setErrorText('Выберите хотя бы один отдел.');
      return;
    }
    setLoading(true);
    setErrorText(null);
    try {
      const body = {
        title: draft.title.trim(),
        text: draft.text.trim(),
        priority: draft.priority,
        audienceType: draft.audienceType,
        departmentIds: draft.audienceType === 'SELECTED' ? draft.departmentIds : [],
        visibleUntil: draft.visibleUntil || undefined,
        recurrence: draft.recurrence,
      };
      const saved = modal === 'edit' && selected
        ? await apiClient.patch<AnnouncementItem>(`/announcements/${selected.id}`, body)
        : await apiClient.post<AnnouncementItem>('/announcements', body);
      if (files.length) await uploadAttachments('ANNOUNCEMENT', saved.id, files);
      setModal(null);
      setSelected(null);
      setFiles([]);
      if (tab === 'manage') await loadManaged();
      else await loadUnread();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сохранить объявление.');
    } finally {
      setLoading(false);
    }
  };

  const archiveSelected = async () => {
    if (!selected) return;
    setLoading(true);
    setErrorText(null);
    try {
      await apiClient.post(`/announcements/${selected.id}/archive`, {});
      setModal(null);
      setSelected(null);
      await loadManaged();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось перенести объявление в архив.');
    } finally {
      setLoading(false);
    }
  };

  const openReport = async (item: AnnouncementItem) => {
    setSelected(item);
    setModal('report');
    setLoading(true);
    setErrorText(null);
    try {
      setReport(await apiClient.get<AckReport>(`/announcements/${item.id}/ack-report`));
    } catch (error) {
      setReport(null);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить журнал ознакомления.');
    } finally {
      setLoading(false);
    }
  };

  const renderAnnouncement = (item: AnnouncementItem, mode: 'read' | 'archive') => {
    const attachments = item.attachments ?? [];
    const images = attachments.filter((attachment) => attachment.mimeType.startsWith('image/'));
    const filesOnly = attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'));
    const pageCount = images.length + 1;
    const requestedPage = pageByAnnouncement[item.id] ?? 0;
    const activePage = Math.min(pageCount - 1, Math.max(0, requestedPage));
    const isTextPage = activePage === images.length;
    const movePage = (direction: -1 | 1) => {
      setPageByAnnouncement((currentPages) => ({
        ...currentPages,
        [item.id]: Math.min(pageCount - 1, Math.max(0, activePage + direction)),
      }));
    };
    const isAcknowledged = Boolean(item.acknowledgedAt || item.readAt || acknowledgedId === item.id);

    return (
      <article className={`announcement-fullscreen-card announcement-page-viewer ${item.priority === 'IMPORTANT' ? 'important' : ''}`}>
        <header className="announcement-viewer-header">
          <div>
            <strong>{visibleTitle(item)}</strong>
            <span>{mode === 'read' ? `Объявление ${currentIndex} из ${cleanUnread.length}` : item.isArchived ? 'Архив' : 'Просмотр'}</span>
          </div>
          <span className={`tag ${item.priority === 'IMPORTANT' ? 'stop' : ''}`}>{displayLabel(announcementPriorityLabels, item.priority)}</span>
        </header>

        <div
          className={`announcement-page-stage ${isTextPage ? 'text-page-active' : 'photo-page-active'}`}
          onTouchStart={(event) => {
            announcementTouchStartRef.current = {
              x: event.touches[0]?.clientX ?? 0,
              y: event.touches[0]?.clientY ?? 0,
            };
          }}
          onTouchEnd={(event) => {
            const start = announcementTouchStartRef.current;
            announcementTouchStartRef.current = null;
            if (!start) return;
            const deltaX = (event.changedTouches[0]?.clientX ?? start.x) - start.x;
            const deltaY = (event.changedTouches[0]?.clientY ?? start.y) - start.y;
            if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
            movePage(deltaX < 0 ? 1 : -1);
          }}
        >
          {!isTextPage ? (
            <div className="announcement-photo-page">
              <AttachmentPreviewList
                attachments={images}
                focusIndex={activePage}
                mode="focus"
                showTitle={false}
              />
            </div>
          ) : (
            <div className="announcement-text-page" data-scroll-region="announcement-text">
              <h2>{visibleTitle(item)}</h2>
              <div className="announcement-meta">
                <span>{item.author?.displayName ?? 'Автор'} · {item.author?.roleLabel ?? 'роль не указана'}</span>
                <span>Опубликовано: {formatDate(item.visibleFrom)}</span>
                <span>Действует до: {formatDate(item.visibleUntil)}</span>
                <span>Получатели: {item.scopeLabel ?? item.department?.name ?? 'Весь завод'}</span>
                <span>Напоминание: {item.recurrenceLabel ?? announcementRecurrenceLabels[(item.recurrence as AnnouncementRecurrence) ?? 'NONE']}</span>
              </div>
              <p>{item.text}</p>
              {filesOnly.length ? <AttachmentPreviewList attachments={filesOnly} showTitle={false} /> : null}
            </div>
          )}
        </div>

        <nav className="announcement-page-navigation" aria-label="Страницы объявления">
          <button aria-label="Предыдущая страница" disabled={activePage === 0} type="button" onClick={() => movePage(-1)}>←</button>
          <span>{activePage + 1} из {pageCount}</span>
          <button aria-label="Следующая страница" disabled={activePage === pageCount - 1} type="button" onClick={() => movePage(1)}>→</button>
        </nav>

        {mode === 'read' ? (
          <footer className="announcement-sticky-actions">
            <button className="primary-button" disabled={loading || isAcknowledged} type="button" onClick={() => void acknowledge(item)}>
              {isAcknowledged ? '✓ Ознакомлен' : 'Ознакомлен'}
            </button>
          </footer>
        ) : (
          <div className="announcement-read-status">
            {item.readAt ? `Ознакомлен ${formatDate(item.readAt)}` : 'Не ознакомлен'}
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="screen-panel announcements-screen">
      <div className="announcement-mobile-bar" aria-label="Навигация объявлений">
        <button
          aria-label="Назад"
          className="secondary-button compact-action announcement-back-button"
          type="button"
          onClick={() => {
            if (tab !== 'new') openTab('new');
            else window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Shift' } }));
          }}
        >
          ←
        </button>
        <div>
          <strong>Объявления</strong>
          <span>{cleanUnread.length ? unreadLabel : 'Новых нет'}</span>
        </div>
        {canArchive ? <button className="secondary-button compact-action" type="button" onClick={() => openTab('archive')}>Архив</button> : null}
      </div>

      <PremiumSectionHeader
        title="Объявления"
        subtitle="Важные сообщения завода. Прочитайте объявление и подтвердите ознакомление."
      />

      <div className="segmented-tabs announcement-tabs">
        <button className={tab === 'new' ? 'active' : ''} type="button" onClick={() => openTab('new')}>Новые</button>
        {canArchive ? <button className={tab === 'archive' ? 'active' : ''} type="button" onClick={() => openTab('archive')}>Архив</button> : null}
        {canManage ? <button className={tab === 'manage' ? 'active' : ''} type="button" onClick={() => openTab('manage')}>Управление</button> : null}
      </div>
      {canCreate ? (
        <button className="primary-button announcement-main-create" type="button" onClick={openCreate}>
          Создать объявление
        </button>
      ) : null}

      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {loading && !modal ? <div className="empty-state compact">Загрузка объявлений...</div> : null}
      <div className="live-refresh-row" aria-live="polite">
        <span className={`live-refresh-pill ${liveStatus.startsWith('Нов') ? 'updated' : ''}`}>{liveStatus}</span>
      </div>

      {tab === 'new' ? (
        <div className="announcement-reader">
          {current ? renderAnnouncement(current, 'read') : (
            <div className="empty-state announcement-empty">
              <h3>Новых объявлений нет.</h3>
              <p>{canArchive ? 'Новых объявлений для вас сейчас нет. Доступные объявления можно посмотреть в архиве.' : 'Новых объявлений для вас сейчас нет.'}</p>
              {canArchive ? <button className="secondary-button" type="button" onClick={() => openTab('archive')}>Архив объявлений</button> : null}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'archive' ? (
        <div className="section-stack">
          {!archive.length && !loading ? <div className="empty-state">Прочитанных объявлений пока нет.</div> : null}
          {archive.map((item) => (
            <article className="announcement-archive-card" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.scopeLabel ?? 'Весь завод'} · {formatShortDate(item.visibleFrom)}</span>
              </div>
              <span className={item.readAt ? 'tag ok' : 'tag pause'}>{item.readAt ? `Ознакомлен ${formatDate(item.readAt)}` : 'Не ознакомлен'}</span>
              <button className="secondary-button" type="button" onClick={() => setSelected(selected?.id === item.id ? null : item)}>
                {selected?.id === item.id ? 'Свернуть' : 'Открыть'}
              </button>
              {selected?.id === item.id ? <div className="announcement-archive-detail">{renderAnnouncement(item, 'archive')}</div> : null}
            </article>
          ))}
        </div>
      ) : null}

      {tab === 'manage' && canManage ? (
        <div className="section-stack">
          <div className="button-row">
            {canCreate ? <button className="primary-button" type="button" onClick={openCreate}>Создать объявление</button> : null}
            <button className="secondary-button" type="button" onClick={() => void loadManaged()}>Обновить</button>
          </div>
          {!managed.length && !loading ? <div className="empty-state">Доступных объявлений для управления нет.</div> : null}
          {managed.map((item) => (
            <article className="announcement-manage-card" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.scopeLabel ?? 'Весь завод'} · {formatDate(item.visibleFrom)}</span>
                <span>Напоминание: {item.recurrenceLabel ?? announcementRecurrenceLabels[(item.recurrence as AnnouncementRecurrence) ?? 'NONE']}</span>
              </div>
              <span className={`tag ${item.priority === 'IMPORTANT' ? 'stop' : ''}`}>{displayLabel(announcementPriorityLabels, item.priority)}</span>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => void openReport(item)}>Журнал ознакомления</button>
                <button className="secondary-button" type="button" onClick={() => openEdit(item)}>Редактировать</button>
                {!item.archivedAt ? <button className="secondary-button danger" type="button" onClick={() => { setSelected(item); setModal('archive'); }}>В архив</button> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {(modal === 'create' || modal === 'edit') ? (
        <div
          aria-label={modal === 'create' ? 'Создать объявление' : 'Редактировать объявление'}
          aria-modal="true"
          className="modal-backdrop"
          role="dialog"
        >
          <div className="modal-card announcement-editor-modal">
            <header className="modal-header">
              <h3>{modal === 'create' ? 'Создать объявление' : 'Редактировать объявление'}</h3>
              <button className="secondary-button" disabled={loading} type="button" onClick={closeModal}>Закрыть</button>
            </header>
            <div className="form-grid">
              <label>
                <span>Заголовок</span>
                <input value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} />
              </label>
              <label>
                <span>Важность</span>
                <select value={draft.priority} onChange={(event) => setDraft((value) => ({ ...value, priority: event.target.value }))}>
                  <option value="NORMAL">Обычное</option>
                  <option value="IMPORTANT">Важно</option>
                </select>
              </label>
              <fieldset className="wide-field announcement-audience-field">
                <legend>Получатели</legend>
                <div className="announcement-audience-modes">
                  <button
                    className={draft.audienceType === 'FACTORY' ? 'active' : ''}
                    type="button"
                    onClick={() => setDraft((value) => ({ ...value, audienceType: 'FACTORY', departmentIds: [] }))}
                  >
                    Весь завод
                  </button>
                  {currentUser?.departmentId ? (
                    <button
                      className={draft.audienceType === 'MY_DEPARTMENT' ? 'active' : ''}
                      type="button"
                      onClick={() => setDraft((value) => ({ ...value, audienceType: 'MY_DEPARTMENT', departmentIds: [] }))}
                    >
                      Мой отдел
                    </button>
                  ) : null}
                  <button
                    className={draft.audienceType === 'SELECTED' ? 'active' : ''}
                    type="button"
                    onClick={() => setDraft((value) => ({ ...value, audienceType: 'SELECTED' }))}
                  >
                    Выбранные отделы
                  </button>
                </div>
                {draft.audienceType === 'SELECTED' ? (
                  <>
                    <div className="announcement-department-tools">
                      <button
                        className="secondary-button compact-action"
                        type="button"
                        onClick={() => setDraft((value) => ({
                          ...value,
                          departmentIds: departments.map((department) => department.id),
                        }))}
                      >
                        Выбрать все
                      </button>
                      <button
                        className="secondary-button compact-action"
                        type="button"
                        onClick={() => setDraft((value) => ({ ...value, departmentIds: [] }))}
                      >
                        Снять все
                      </button>
                    </div>
                    <div className="announcement-department-grid">
                      {departments.map((department) => {
                        const active = draft.departmentIds.includes(department.id);
                        return (
                          <button
                            className={active ? 'active' : ''}
                            type="button"
                            key={department.id}
                            onClick={() => setDraft((value) => ({
                              ...value,
                              departmentIds: active
                                ? value.departmentIds.filter((id) => id !== department.id)
                                : [...value.departmentIds, department.id],
                            }))}
                          >
                            <span>{active ? '✓' : '+'}</span>
                            {department.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="announcement-audience-chips">
                      {selectedDepartmentNames.map((name) => <span className="tag work" key={name}>{name}</span>)}
                      {!selectedDepartmentNames.length ? <span className="field-hint">Выберите хотя бы один отдел.</span> : null}
                    </div>
                  </>
                ) : null}
              </fieldset>
              <label>
                <span>Действует до</span>
                <input type="datetime-local" value={draft.visibleUntil} onChange={(event) => setDraft((value) => ({ ...value, visibleUntil: event.target.value }))} />
              </label>
              <label>
                <span>Повторное напоминание</span>
                <select
                  value={draft.recurrence}
                  onChange={(event) => setDraft((value) => ({
                    ...value,
                    recurrence: event.target.value as AnnouncementRecurrence,
                  }))}
                >
                  {(Object.entries(announcementRecurrenceLabels) as Array<[AnnouncementRecurrence, string]>).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="wide-field">
                <span>Текст</span>
                <textarea rows={8} value={draft.text} onChange={(event) => setDraft((value) => ({ ...value, text: event.target.value }))} />
              </label>
            </div>
            <div className="announcement-preview-box">
              <strong>Предпросмотр для сотрудника</strong>
              <p>{draft.title || 'Заголовок объявления'}</p>
              <span>{audiencePreviewLabel}</span>
              <span>Напоминание: {announcementRecurrenceLabels[draft.recurrence]}</span>
            </div>
            <AttachmentPicker allowFiles allowVideo value={files} onChange={setFiles} disabled={loading} />
            {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
            <footer className="modal-footer">
              <button className="secondary-button" disabled={loading} type="button" onClick={closeModal}>Отмена</button>
              <button className="primary-button" disabled={loading} type="button" onClick={() => void saveAnnouncement()}>Сохранить</button>
            </footer>
          </div>
        </div>
      ) : null}

      {modal === 'archive' && selected ? (
        <div aria-label="Перенести объявление в архив" aria-modal="true" className="modal-backdrop" role="dialog">
          <div className="modal-card premium-deep-form compact-modal">
            <header className="modal-header">
              <h3>Перенести объявление в архив</h3>
              <button className="secondary-button" disabled={loading} type="button" onClick={closeModal}>Закрыть</button>
            </header>
            <p>Объявление будет скрыто из активного списка. История ознакомления сохранится.</p>
            <footer className="modal-footer">
              <button className="secondary-button" disabled={loading} type="button" onClick={closeModal}>Отмена</button>
              <button className="secondary-button danger" disabled={loading} type="button" onClick={() => void archiveSelected()}>В архив</button>
            </footer>
          </div>
        </div>
      ) : null}

      {modal === 'report' ? (
        <div aria-label="Журнал ознакомления" aria-modal="true" className="modal-backdrop" role="dialog">
          <div className="modal-card announcement-report-modal">
            <header className="modal-header">
              <h3>Журнал ознакомления</h3>
              <button className="secondary-button" disabled={loading} type="button" onClick={closeModal}>Закрыть</button>
            </header>
            {report ? (
              <div className="announcement-report">
                <div className="announcement-report-summary">
                  <strong>{report.announcement.title}</strong>
                  <span>Ознакомились: {report.totals.acknowledged}</span>
                  <span>Не ознакомились: {report.totals.pending}</span>
                </div>
                <h4>Ознакомились</h4>
                {report.acknowledged.length ? report.acknowledged.map((row) => (
                  <div className="announcement-report-row" key={row.userId}>
                    <span>{row.displayName}</span>
                    <span>{row.departmentName ?? row.roleLabel ?? 'Сотрудник'}</span>
                    <strong>{formatDate(row.acknowledgedAt)}</strong>
                  </div>
                )) : <div className="empty-state compact">Пока никто не подтвердил ознакомление.</div>}
                <h4>Не ознакомились</h4>
                {report.pending.length ? report.pending.map((row) => (
                  <div className="announcement-report-row pending" key={row.userId}>
                    <span>{row.displayName}</span>
                    <span>{row.departmentName ?? row.roleLabel ?? 'Сотрудник'}</span>
                    <strong>Ожидается</strong>
                  </div>
                )) : <div className="empty-state compact">Все получатели ознакомились.</div>}
              </div>
            ) : <div className="empty-state compact">Загрузка журнала...</div>}
          </div>
        </div>
      ) : null}
    </section>
  );
}
