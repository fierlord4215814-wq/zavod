import React, { useEffect, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { useRef } from 'react';
import { apiClient } from '../api/client';
import { ActionModal } from '../components/ActionModal';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { appStore, StockDefect, useAppStore } from '../store/app.store';

type StockModal = 'create' | 'issue' | 'attachment' | 'edit' | null;

const unitOptions = [
  { label: 'штуки', value: 'штуки' },
  { label: 'гофры', value: 'гофры' },
];

const statusLabels: Record<string, string> = {
  NEW: 'Новая',
  ON_STOCK: 'На складе',
  ISSUED: 'Выдано',
  ARCHIVED: 'Архив',
};

function isReadable(text?: string | null) {
  return Boolean(text && text.trim() && !/[\ufffd]|\u043f\u0457\u0405/.test(text));
}

function defectName(item: StockDefect) {
  return isReadable(item.name) ? item.name! : isReadable(item.displayName) ? item.displayName! : isReadable(item.productName) ? item.productName! : 'Без наименования';
}

function defectUnit(item: StockDefect) {
  return item.unit === 'гофры' ? 'гофры' : 'штуки';
}

export function StockScreen() {
  const { stock, factoryId, currentUser } = useAppStore();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [modal, setModal] = useState<StockModal>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const loadSequence = useRef(0);

  const canManage = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('stock.manage'));

  const load = async () => {
    const sequence = ++loadSequence.current;
    const isCurrent = () => sequence === loadSequence.current && appStore.getState().factoryId === factoryId;
    setErrorText(null);
    try {
      const items = await apiClient.get<StockDefect[]>(`/stock?factoryId=${factoryId}`);
      if (!isCurrent()) return;
      appStore.setStock(items);
    } catch (error) {
      if (!isCurrent()) return;
      appStore.setStock([]);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить некондицию.');
    }
  };

  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 140); };
    window.addEventListener('zavod:stock-updated', refresh);
    window.addEventListener('zavod:ws-reconnected', refresh);
    return () => {
      ++loadSequence.current;
      clearTimeout(timer);
      window.removeEventListener('zavod:stock-updated', refresh);
      window.removeEventListener('zavod:ws-reconnected', refresh);
    };
  }, [factoryId]);

  const uploadForDefect = async () => {
    if (!activeId || !files.length) return;
    setBusy(true);
    setErrorText(null);
    try {
      await uploadAttachments('STOCK_DEFECT', activeId, files);
      setModal(null);
      setActiveId(null);
      setFiles([]);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить фото.');
    } finally {
      setBusy(false);
    }
  };

  const archiveDefect = async (id: string) => {
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/stock/${id}/archive`, {});
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось архивировать некондицию.');
    } finally {
      setBusy(false);
    }
  };

  const active = stock.find((item) => item.id === activeId) ?? null;
  useMobileBackLayer(Boolean(active) && !modal, () => setActiveId(null), 620);
  useMobileBackLayer(modal === 'attachment', () => { if (!busy) setModal(null); }, 740);
  useBodyScrollLock((Boolean(active) && !modal) || modal === 'attachment');
  const defectSummary = (item: StockDefect) => `${item.quantity} ${defectUnit(item)}`;

  return (
    <section className="screen-panel stock-screen">
      <div className="screen-heading">
        <h2>Некондиция</h2>
        <p>Складская некондиция, выдача, архив и вложения по правам склада.</p>
      </div>
      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      <div className="metric-grid">
        <div className="metric-card"><div className="metric-label">Записи</div><div className="metric-value">{stock.length}</div></div>
        <div className="metric-card"><div className="metric-label">Выдано</div><div className="metric-value">{stock.filter((item) => item.status === 'ISSUED').length}</div></div>
      </div>
      {canManage ? <button className="action-button work" style={{ width: '100%', marginBottom: 12 }} type="button" onClick={() => setModal('create')}>Создать некондицию</button> : null}
      <div className="section-stack">
        {!stock.length && !errorText ? <div className="empty-state">Некондиции пока нет.</div> : null}
        {stock.map((item) => (
          <article className="card compact-record-card" key={item.id}>
            <div className="compact-record-main">
              <div>
                <span className="compact-record-date">{statusLabels[item.status] ?? 'Статус'}</span>
                <strong>{defectName(item)}</strong>
                <span>{defectSummary(item)}</span>
              </div>
              <span className="tag">{statusLabels[item.status] ?? 'Статус не указан'}</span>
            </div>
            <div className="compact-record-footer">
              <span>{item.attachments?.length ? `Вложений: ${item.attachments.length}` : 'Без вложений'}</span>
              <button className="secondary-button compact-action" type="button" onClick={() => setActiveId(item.id)}>Подробнее</button>
            </div>
          </article>
        ))}
      </div>

      {modal === 'create' ? (
        <ActionModal
          title="Создать некондицию"
          fields={[
            { name: 'name', label: 'Наименование', placeholder: 'Можно оставить пустым' },
            { name: 'quantity', label: 'Количество', type: 'number', required: true },
            { name: 'unit', label: 'Единица', type: 'select', required: true, defaultValue: 'штуки', options: unitOptions },
          ]}
          busy={busy}
          errorText={errorText}
          confirmLabel="Создать"
          onCancel={() => setModal(null)}
          onSubmit={async (values) => {
            setBusy(true);
            setErrorText(null);
            try {
              await apiClient.post('/stock', { name: String(values.name ?? ''), quantity: Number(values.quantity), unit: String(values.unit ?? 'штуки') });
              setModal(null);
              await load();
            } catch (error) {
              setErrorText(error instanceof Error ? error.message : 'Не удалось создать некондицию.');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {modal === 'edit' && active ? (
        <ActionModal
          title="Редактировать некондицию"
          fields={[
            { name: 'name', label: 'Наименование', defaultValue: active.name ?? active.productName ?? '' },
            { name: 'quantity', label: 'Количество', type: 'number', required: true, defaultValue: active.quantity },
            { name: 'unit', label: 'Единица', type: 'select', required: true, defaultValue: defectUnit(active), options: unitOptions },
          ]}
          busy={busy}
          errorText={errorText}
          confirmLabel="Сохранить"
          onCancel={() => setModal(null)}
          onSubmit={async (values) => {
            setBusy(true);
            setErrorText(null);
            try {
              await apiClient.patch(`/stock/${active.id}`, { name: String(values.name ?? ''), quantity: Number(values.quantity), unit: String(values.unit ?? 'штуки') });
              setModal(null);
              setActiveId(null);
              await load();
            } catch (error) {
              setErrorText(error instanceof Error ? error.message : 'Не удалось обновить некондицию.');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {modal === 'issue' && activeId ? (
        <ActionModal
          title="Выдать некондицию"
          fields={[{ name: 'comment', label: 'Комментарий выдачи', type: 'textarea', required: true }]}
          busy={busy}
          errorText={errorText}
          confirmLabel="Выдать"
          onCancel={() => setModal(null)}
          onSubmit={async (values) => {
            setBusy(true);
            setErrorText(null);
            try {
              await apiClient.post(`/stock/${activeId}/issue`, { comment: String(values.comment) });
              setModal(null);
              setActiveId(null);
              await load();
            } catch (error) {
              setErrorText(error instanceof Error ? error.message : 'Не удалось выдать некондицию.');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {modal === 'attachment' && activeId ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-form">
            <h3>Добавить фото некондиции</h3>
            <AttachmentPicker value={files} onChange={setFiles} allowFiles disabled={busy} />
            <div className="modal-actions">
              <button className="secondary-button" disabled={busy} type="button" onClick={() => setModal(null)}>Отмена</button>
              <button className="primary-button" disabled={busy || !files.length} type="button" onClick={() => void uploadForDefect()}>Загрузить</button>
            </div>
          </div>
        </div>
      ) : null}
      {active && !modal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-dashboard-card premium-deep-panel">
            <div className="modal-header">
              <h3>{defectName(active)}</h3>
              <button className="secondary-button" type="button" onClick={() => setActiveId(null)}>Закрыть</button>
            </div>
            <div className="info-grid">
              <span>Статус: <strong>{statusLabels[active.status] ?? 'Статус не указан'}</strong></span>
              <span>Количество: <strong>{defectSummary(active)}</strong></span>
            </div>
            <AttachmentPreviewList attachments={active.attachments} />
            {canManage ? (
              <div className="premium-action-row" style={{ marginTop: 12 }}>
                <button className="action-button pause" disabled={busy} type="button" onClick={() => setModal('issue')}>Выдать</button>
                <button className="action-button" disabled={busy} type="button" onClick={() => setModal('edit')}>Редактировать</button>
                <button className="action-button stop" disabled={busy} type="button" onClick={() => void archiveDefect(active.id)}>Архив</button>
                <button className="secondary-button" disabled={busy} type="button" onClick={() => setModal('attachment')}>Фото</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
