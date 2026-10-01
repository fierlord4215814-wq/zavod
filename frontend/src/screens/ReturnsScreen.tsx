import React, { useEffect, useMemo, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { useRef } from 'react';
import { apiClient } from '../api/client';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { PremiumKpiStrip, PremiumSectionHeader } from '../components/PremiumShell';
import { QuantityBalance, QuantityReleaseHistoryList, QuantityReleaseSheet } from '../components/QuantityRelease';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { appStore, ReturnItem, useAppStore } from '../store/app.store';
import { isPilotFixtureText } from '../utils/pilot-ui';

type ReturnDraft = {
  title: string;
  reason: string;
  article: string;
  quantity: string;
  unit: string;
  lineId: string;
};

type LineOption = { id: string; name: string };
type ModalMode = 'create' | 'archive' | 'partialRelease' | null;

const emptyDraft: ReturnDraft = {
  title: '',
  reason: '',
  article: '',
  quantity: '',
  unit: 'гофр',
  lineId: '',
};

function formatDate(value?: string | null) {
  if (!value) return 'Дата не указана';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Дата не указана'
    : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

function safeText(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function quantityLabel(item: ReturnItem) {
  if (item.quantitySummary?.unit) return `${item.quantitySummary.remaining} ${item.quantitySummary.unit}`;
  if (item.quantity == null) return 'Количество не указано';
  return `${item.quantity} ${safeText(item.unit, 'ед.')}`;
}

export function ReturnsScreen() {
  const { returns, factoryId, currentUser } = useAppStore();
  const [archive, setArchive] = useState<ReturnItem[]>([]);
  const [lines, setLines] = useState<LineOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalMode>(null);
  const [draft, setDraft] = useState<ReturnDraft>(emptyDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [viewMode, setViewMode] = useState<'feed' | 'archive'>('feed');
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const canPublish = Boolean(
    currentUser?.isAdmin
    || currentUser?.permissions.includes('returns.manage'),
  );
  const feed = useMemo(
    () => returns.filter((item) => !item.archivedAt && item.status !== 'ARCHIVED' && item.status !== 'COMPLETED'),
    [returns],
  );
  const cleanArchive = useMemo(
    () => archive.filter((item) => !isPilotFixtureText(
      item.id,
      item.description,
      item.article,
      item.productName,
      item.mismatchReason,
    )),
    [archive],
  );
  const selected = useMemo(
    () => [...feed, ...cleanArchive].find((item) => item.id === selectedId) ?? null,
    [cleanArchive, feed, selectedId],
  );
  const visibleRecords = viewMode === 'feed' ? feed : cleanArchive;

  useMobileBackLayer(Boolean(selected) && !modal, () => setSelectedId(null), 620);
  useMobileBackLayer(modal === 'create', () => setModal(null), 700);
  useMobileBackLayer(modal === 'archive', () => setModal(null), 700);

  const load = async () => {
    const sequence = ++loadSequence.current;
    const isCurrent = () => sequence === loadSequence.current && appStore.getState().factoryId === factoryId;
    setErrorText(null);
    try {
      const [activeItems, allItems] = await Promise.all([
        apiClient.get<ReturnItem[]>(`/returns?factoryId=${factoryId}`),
        apiClient.get<ReturnItem[]>(`/returns?factoryId=${factoryId}&includeArchive=true`),
      ]);
      if (!isCurrent()) return;
      appStore.setReturns(activeItems);
      const activeIds = new Set(activeItems.map((item) => item.id));
      setArchive(allItems.filter((item) =>
        !activeIds.has(item.id)
        || Boolean(item.archivedAt)
        || item.status === 'ARCHIVED'
        || item.status === 'COMPLETED',
      ));
      if (canPublish) {
        const options = await apiClient.get<LineOption[]>('/returns/publication-lines');
        if (isCurrent()) setLines(options);
      }
    } catch (error) {
      if (!isCurrent()) return;
      appStore.setReturns([]);
      setArchive([]);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить возвраты на производство.');
    }
  };

  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 140); };
    window.addEventListener('zavod:quantity-release-updated', refresh);
    window.addEventListener('zavod:returns-updated', refresh);
    window.addEventListener('zavod:ws-reconnected', refresh);
    return () => {
      ++loadSequence.current;
      clearTimeout(timer);
      window.removeEventListener('zavod:quantity-release-updated', refresh);
      window.removeEventListener('zavod:returns-updated', refresh);
      window.removeEventListener('zavod:ws-reconnected', refresh);
    };
  }, [factoryId, canPublish]);

  const openCreate = () => {
    setDraft(emptyDraft);
    setFiles([]);
    setErrorText(null);
    setModal('create');
  };

  const submitCreate = async () => {
    if (!draft.title.trim() || !draft.reason.trim() || !draft.article.trim()) {
      setErrorText('Заполните заголовок, причину и артикул.');
      return;
    }
    if (!Number.isFinite(Number(draft.quantity)) || Number(draft.quantity) <= 0) {
      setErrorText('Количество должно быть больше нуля.');
      return;
    }
    if (!files.length) {
      setErrorText('Добавьте фотографию возвращённой продукции.');
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const saved = await apiClient.post<ReturnItem>('/returns', {
        title: draft.title.trim(),
        reason: draft.reason.trim(),
        article: draft.article.trim(),
        quantity: Number(draft.quantity),
        unit: draft.unit,
        lineId: draft.lineId || null,
        photoUrl: 'attachment-pending',
      });
      await uploadAttachments('RETURN_RECORD', saved.id, files);
      setModal(null);
      setFiles([]);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось опубликовать возврат.');
    } finally {
      setBusy(false);
    }
  };

  const archiveSelected = async () => {
    if (!selectedId) return;
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/returns/${selectedId}/archive`, {});
      setModal(null);
      setSelectedId(null);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось перенести публикацию в архив.');
    } finally {
      setBusy(false);
    }
  };

  const releasePart = async (values: { quantity: string; comment: string; operationId: string }) => {
    if (!selectedId) return;
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/returns/${selectedId}/partial-release`, values);
      await load();
      setModal(null);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось выдать часть продукции.');
    } finally {
      setBusy(false);
    }
  };

  const renderItem = (item: ReturnItem, archived: boolean) => (
    <article className={`returns-publication-card ${archived ? 'archived' : ''}`} key={item.id}>
      <div className={`returns-publication-media ${(item.attachments ?? []).length ? 'has-media' : 'is-empty'}`}>
        <AttachmentPreviewList attachments={item.attachments ?? []} />
        {!(item.attachments ?? []).length ? <span>Фотография недоступна</span> : null}
      </div>
      <div className="returns-publication-content">
        <div className="returns-publication-heading">
          <div>
            <strong>{safeText(item.productName, 'Возврат на производство')}</strong>
            <span>{formatDate(item.createdAt ?? item.receivedAt)}</span>
          </div>
          <span className={`tag ${archived ? 'pause' : 'work'}`}>{archived ? 'Архив' : 'Публикация'}</span>
        </div>
        <p>{safeText(item.mismatchReason ?? item.description, 'Причина не указана')}</p>
        <div className="returns-publication-meta">
          <span><b>Артикул:</b> {safeText(item.article, 'не указан')}</span>
          {!item.quantitySummary ? <span><b>Количество:</b> {quantityLabel(item)}</span> : null}
          {item.line?.name ? <span><b>Линия:</b> {item.line.name}</span> : null}
          <span><b>Автор:</b> {safeText(item.author?.displayName, item.author?.roleLabel ?? 'Сотрудник')}</span>
        </div>
        <QuantityBalance compact summary={item.quantitySummary} />
        <button className="secondary-button" type="button" onClick={() => setSelectedId(item.id)}>Открыть</button>
      </div>
    </article>
  );

  return (
    <section className="screen-panel returns-screen">
      <PremiumSectionHeader
        title="Возвраты на производство"
        subtitle="Фото и причины возврата продукции. Новые публикации находятся сверху."
      />
      {errorText && !modal ? <div className="empty-state error-state">{errorText}</div> : null}
      <PremiumKpiStrip
        label="Публикации возвратов"
        items={[
          { label: 'Новые', value: feed.length, tone: feed.length ? 'cool' : 'success', active: viewMode === 'feed', onClick: () => setViewMode('feed') },
          { label: 'Архив', value: cleanArchive.length, tone: 'muted', active: viewMode === 'archive', onClick: () => setViewMode('archive') },
        ]}
      />
      {canPublish ? (
        <button className="primary-button returns-create-button" type="button" disabled={busy} onClick={openCreate}>
          Опубликовать возврат
        </button>
      ) : null}
      <div className="section-stack returns-publication-list">
        {!visibleRecords.length && !errorText ? (
          <div className="empty-state">
            {viewMode === 'feed' ? 'Новых возвратов на производство нет.' : 'Архив возвратов пуст.'}
          </div>
        ) : null}
        {visibleRecords.map((item) => renderItem(item, viewMode === 'archive'))}
      </div>

      {modal === 'create' ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="return-create-title">
          <section className="modal-card premium-deep-form returns-publication-editor">
            <header className="modal-header">
              <div>
                <span className="eyebrow">Новая публикация</span>
                <h3 id="return-create-title">Возврат на производство</h3>
              </div>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setModal(null)}>Закрыть</button>
            </header>
            <div className="form-grid">
              <label className="wide-field">
                <span>Заголовок</span>
                <input value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Например, повреждённая упаковка" />
              </label>
              <label className="wide-field">
                <span>Краткая причина</span>
                <textarea rows={4} value={draft.reason} onChange={(event) => setDraft((value) => ({ ...value, reason: event.target.value }))} />
              </label>
              <label>
                <span>Артикул</span>
                <input value={draft.article} onChange={(event) => setDraft((value) => ({ ...value, article: event.target.value }))} />
              </label>
              <label>
                <span>Количество</span>
                <input type="number" min="1" inputMode="numeric" value={draft.quantity} onChange={(event) => setDraft((value) => ({ ...value, quantity: event.target.value }))} />
              </label>
              <label>
                <span>Единица</span>
                <select value={draft.unit} onChange={(event) => setDraft((value) => ({ ...value, unit: event.target.value }))}>
                  <option value="гофр">гофр</option>
                  <option value="шт.">шт.</option>
                  <option value="кг">кг</option>
                </select>
              </label>
              <label>
                <span>Линия, если относится</span>
                <select value={draft.lineId} onChange={(event) => setDraft((value) => ({ ...value, lineId: event.target.value }))}>
                  <option value="">Без привязки к линии</option>
                  {lines.map((line) => <option value={line.id} key={line.id}>{line.name}</option>)}
                </select>
              </label>
            </div>
            <div className="returns-photo-field">
              <strong>Фотография продукции</strong>
              <AttachmentPicker value={files} onChange={setFiles} disabled={busy} />
            </div>
            {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
            <footer className="modal-footer">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setModal(null)}>Отмена</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void submitCreate()}>Опубликовать</button>
            </footer>
          </section>
        </div>
      ) : null}

      {selected && !modal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="return-detail-title">
          <section className="modal-card premium-deep-panel returns-publication-detail">
            <header className="modal-header">
              <h3 id="return-detail-title">{safeText(selected.productName, 'Возврат на производство')}</h3>
              <button className="secondary-button" type="button" onClick={() => setSelectedId(null)}>Закрыть</button>
            </header>
            <AttachmentPreviewList attachments={selected.attachments ?? []} />
            <p className="returns-publication-reason">{safeText(selected.mismatchReason ?? selected.description, 'Причина не указана')}</p>
            <div className="returns-publication-meta detail">
              <span><b>Дата:</b> {formatDate(selected.createdAt ?? selected.receivedAt)}</span>
              <span><b>Автор:</b> {safeText(selected.author?.displayName, selected.author?.roleLabel ?? 'Сотрудник')}</span>
              <span><b>Служба:</b> {safeText(selected.author?.roleLabel, 'не указана')}</span>
              {selected.line?.name ? <span><b>Линия:</b> {selected.line.name}</span> : null}
              <span><b>Артикул:</b> {safeText(selected.article, 'не указан')}</span>
              <span><b>Количество:</b> {quantityLabel(selected)}</span>
            </div>
            <QuantityBalance summary={selected.quantitySummary} />
            <QuantityReleaseHistoryList history={selected.releaseHistory} />
            {canPublish && viewMode === 'feed' ? (
              <footer className="modal-footer">
                {selected.availableActions?.includes('partial-release') ? (
                  <button className="action-button" type="button" onClick={() => { setErrorText(null); setModal('partialRelease'); }}>Выдать часть</button>
                ) : null}
                <button className="secondary-button danger" type="button" onClick={() => setModal('archive')}>В архив</button>
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}

      {selected && modal === 'archive' ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="return-archive-title">
          <section className="modal-card premium-deep-form compact-modal">
            <h3 id="return-archive-title">Перенести публикацию в архив?</h3>
            <p>Она исчезнет из новой ленты, но останется в истории.</p>
            {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
            <footer className="modal-footer">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setModal(null)}>Отмена</button>
              <button className="secondary-button danger" type="button" disabled={busy} onClick={() => void archiveSelected()}>В архив</button>
            </footer>
          </section>
        </div>
      ) : null}
      {selected && modal === 'partialRelease' ? (
        <QuantityReleaseSheet
          busy={busy}
          errorText={errorText}
          onClose={() => { setErrorText(null); setModal(null); }}
          onSubmit={releasePart}
          open
          sourceKey={selected.id}
          summary={selected.quantitySummary}
        />
      ) : null}
    </section>
  );
}
