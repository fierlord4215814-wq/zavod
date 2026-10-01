import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { PremiumKpiStrip, PremiumSectionHeader } from '../components/PremiumShell';
import { appStore, NotificationItem, useAppStore } from '../store/app.store';
import { notificationNavigationIntent, NotificationNavigationIntent } from '../notifications/browser-notifications';

const entityLabels: Record<string, string> = {
  TASK: 'Заявка',
  ORDER_REQUEST: 'Заявка на заказ',
  MINIMUM_STOCK_ITEM: 'Остаток',
  SHIFT_LOG: 'Пересменка',
  WASH_ISSUE: 'Проблема мойки',
  WASH_OKK_REVIEW: 'ОКК мойки',
  WASH_CONTROL_ITEM: 'Контроль мойки',
  CHECKLIST_RUN: 'Чек-лист',
  DEFROST_EVENT: 'Оттайка',
  ANNOUNCEMENT: 'Объявление',
};

const severityLabels: Record<string, { label: string; className: string }> = {
  INFO: { label: 'Информация', className: '' },
  WARNING: { label: 'Внимание', className: 'pause' },
  CRITICAL: { label: 'Важно', className: 'stop' },
};

function groupNotifications(items: NotificationItem[]) {
  const fresh = items.filter((item) => !item.readAt);
  const earlier = items.filter((item) => item.readAt);
  return [
    { title: 'Новые', items: fresh },
    { title: 'Ранее', items: earlier },
  ].filter((group) => group.items.length);
}

type Props = {
  onOpenSource?: (intent: NotificationNavigationIntent) => Promise<void>;
};

export function NotificationsScreen({ onOpenSource }: Props) {
  const { notificationsUnreadCount, availableFactories, selectedFactoryId } = useAppStore();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const grouped = useMemo(() => groupNotifications(notifications), [notifications]);
  const unreadCritical = useMemo(() => notifications.filter((item) => !item.readAt && item.severity === 'CRITICAL'), [notifications]);

  const load = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const [items, unread] = await Promise.all([
        apiClient.get<NotificationItem[]>('/notifications'),
        apiClient.get<{ count: number }>('/notifications/unread-count'),
      ]);
      setNotifications(items);
      appStore.setNotificationsUnreadCount(unread.count);
    } catch (error) {
      setNotifications([]);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить уведомления');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const markRead = async (id: string) => {
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/notifications/${id}/read`, {});
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось отметить уведомление');
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post('/notifications/read-all', {});
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось прочитать уведомления');
    } finally {
      setBusy(false);
    }
  };

  const openSource = async (item: NotificationItem) => {
    if (!onOpenSource) return;
    setBusy(true);
    setErrorText(null);
    setNoticeText(null);
    try {
      await onOpenSource(notificationNavigationIntent(item));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Источник уведомления сейчас недоступен.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screen-panel notifications-screen">
      <PremiumSectionHeader
        title="Уведомления"
        subtitle="События по вашему пользователю, отделу и заводу. Чаты не создают обычные уведомления."
      />
      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {noticeText ? <div className="empty-state success-state">{noticeText}</div> : null}

      <PremiumKpiStrip
        items={[
          { label: 'Непрочитанные', value: loading && !notifications.length ? '—' : notificationsUnreadCount, icon: '●', tone: 'success' },
          { label: 'Важные', value: loading && !notifications.length ? '—' : unreadCritical.length, icon: '!', tone: 'danger' },
          { label: 'Всего', value: loading && !notifications.length ? '—' : notifications.length, icon: 'Σ', tone: 'neutral' },
        ]}
        label="Состояние уведомлений"
      />

      <div className="button-row">
        <button className="secondary-button" disabled={loading || busy || notificationsUnreadCount === 0} type="button" onClick={() => void markAllRead()}>
          Отметить всё прочитанным
        </button>
        <button className="secondary-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent('zavod:open-settings'))}>
          Настройки уведомлений
        </button>
      </div>

      <div className="section-stack" style={{ marginTop: 12 }}>
        {loading && !notifications.length ? <div className="empty-state" role="status">Загрузка уведомлений…</div> : null}
        {!loading && !notifications.length && !errorText ? <div className="empty-state">Уведомлений нет.</div> : null}
        {grouped.map((group) => (
          <section className="section-card notification-group" key={group.title}>
            <div className="section-subhead">
              <span>{group.items.length}</span>
              <div>
                <strong>{group.title}</strong>
                <p>{group.title === 'Новые' ? 'Требуют внимания' : 'Уже просмотрены'}</p>
              </div>
            </div>
            <div className="section-stack">
              {group.items.map((item) => {
                const entityLabel = item.entityType ? entityLabels[item.entityType] ?? 'Событие' : null;
                const severity = severityLabels[item.severity] ?? severityLabels.INFO;
                const sourceFactoryName = item.factoryId
                  ? availableFactories.find((factory) => factory.id === item.factoryId)?.name
                    ?? (item.factoryId === selectedFactoryId ? 'Текущий завод' : 'Доступный завод')
                  : null;
                return (
                  <article className={`card notification-card compact-notification-card ${item.readAt ? '' : 'active-card'} ${item.severity === 'CRITICAL' ? 'critical' : ''}`} key={item.id}>
                    <div className="line-title-row">
                      <h3 className="line-name">{item.title}</h3>
                      <span className={`tag ${severity.className}`}>{severity.label}</span>
                    </div>
                    <p className="line-meta">{item.message}</p>
                    <div className="line-meta" style={{ marginTop: 8 }}>
                      <span>{new Date(item.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      {sourceFactoryName ? <span>Источник: {sourceFactoryName}</span> : null}
                      {entityLabel ? <span>{entityLabel}</span> : null}
                      {!item.readAt ? <span>не прочитано</span> : <span>прочитано</span>}
                    </div>
                    <div className="button-row">
                      {item.sourceRoute ? (
                        <button className="secondary-button" disabled={busy} type="button" onClick={() => void openSource(item)}>
                          Открыть
                        </button>
                      ) : null}
                      {!item.readAt ? (
                        <button className="action-button work" disabled={busy} type="button" onClick={() => void markRead(item.id)}>
                          Отметить прочитанным
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
