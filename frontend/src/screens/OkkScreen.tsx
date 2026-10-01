import React, { useEffect, useMemo, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { apiClient } from '../api/client';
import { ActionModal, ActionModalField } from '../components/ActionModal';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { PremiumKpiStrip, PremiumSectionHeader } from '../components/PremiumShell';
import { QuantityBalance, QuantityReleaseHistoryList, QuantityReleaseSheet } from '../components/QuantityRelease';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { appStore, Line, OkkRecord, useAppStore } from '../store/app.store';
import { isPilotFixtureText } from '../utils/pilot-ui';

type OkkModal = 'create' | 'completion' | 'fullComplete' | 'attachment' | 'partialRelease' | null;
type UserOption = { id?: string; userId?: string; displayName?: string; role?: string; departmentName?: string | null };

const roleLabels: Record<string, string> = {
  ADMIN: 'Администратор',
  MANAGEMENT: 'Руководство',
  MASTER: 'Мастер',
  TECHNOLOG: 'Технолог',
  OKK: 'ОКК',
  STORE: 'Склад',
  TECH_KIPIA: 'КИПиА',
  TECH_HOLOD: 'Холодильная служба',
  TECH_MECHANIC: 'Механик',
  WORKER: 'Сотрудник',
  CONTRACTOR: 'Подрядчик',
};

const okkStatusLabels: Record<string, string> = {
  BLOCKED: 'Забраковано',
  DECISION: 'Решение принято',
  CLOSED: 'Закрыто',
  UNBLOCKED: 'Разблокировано',
  COMPLETION_PENDING: 'Выполнение отмечено',
  COMPLETED: 'Завершено',
  ARCHIVED: 'Архив',
};

function isPilotOkkNoise(record: OkkRecord) {
  return isPilotFixtureText(record.id, record.description, record.article, record.productName, record.mismatchReason, record.decision, record.correctiveActions);
}

function userValue(user: UserOption) {
  return user.userId ?? user.id ?? '';
}

function isReadable(text?: string | null) {
  return Boolean(text && text.trim() && !/[\ufffd]|\u043f\u0457\u0405/.test(text));
}

function userLabel(user: UserOption) {
  const value = userValue(user);
  const name = isReadable(user.displayName) && user.displayName !== value
    ? user.displayName!
    : roleLabels[user.role ?? ''] ?? 'Сотрудник';
  return user.departmentName ? `${name} · ${user.departmentName}` : name;
}

function safeText(value: unknown, fallback = 'Не указано') {
  const text = String(value ?? '').trim();
  return isReadable(text) ? text : fallback;
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return 'Не указана';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Не указана';
  return withTime ? date.toLocaleString('ru-RU') : date.toLocaleDateString('ru-RU');
}

export function OkkScreen() {
  const { okkRecords, factoryId, currentUser } = useAppStore();
  const [archive, setArchive] = useState<OkkRecord[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [masters, setMasters] = useState<UserOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [modal, setModal] = useState<OkkModal>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<'active' | 'archive'>('active');

  const canManage = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('okk.manage'));
  const activeRecords = okkRecords.filter((record) => !record.archivedAt && record.status !== 'COMPLETED' && record.status !== 'ARCHIVED');
  const selected = useMemo(() => [...okkRecords, ...archive].find((record) => record.id === activeId) ?? null, [activeId, archive, okkRecords]);
  const visibleRecords = viewMode === 'active' ? activeRecords : archive;
  const lineById = useMemo(() => new Map(lines.map((line) => [line.id, line.name])), [lines]);
  useMobileBackLayer(Boolean(selected) && !modal, () => setActiveId(null), 620);
  useBodyScrollLock(modal === 'attachment');
  useMobileBackLayer(modal === 'attachment', () => {
    if (busy) return;
    setFiles([]);
    setModal(null);
  }, 740);

  const load = async () => {
    if (!factoryId) return;
    setErrorText(null);
    try {
      const [active, archived, lineList] = await Promise.all([
        apiClient.get<OkkRecord[]>(`/okk?factoryId=${factoryId}`),
        apiClient.get<OkkRecord[]>(`/okk?factoryId=${factoryId}&includeArchive=true`),
        apiClient.get<Line[]>('/lines'),
      ]);
      appStore.setOkkRecords(active);
      setArchive(archived.filter((record) => (record.archivedAt || record.status === 'COMPLETED' || record.status === 'ARCHIVED') && !isPilotOkkNoise(record)));
      setLines(lineList);
      if (canManage) {
        const [masterList, userList] = await Promise.all([
          apiClient.get<UserOption[] | { users?: UserOption[]; people?: UserOption[] }>('/directory/users?role=MASTER'),
          apiClient.get<UserOption[] | { users?: UserOption[]; people?: UserOption[] }>('/directory/users'),
        ]);
        const normalize = (payload: UserOption[] | { users?: UserOption[]; people?: UserOption[] }) => Array.isArray(payload) ? payload : payload.users ?? payload.people ?? [];
        setMasters(normalize(masterList).filter((user) => userValue(user)));
        setUsers(normalize(userList).filter((user) => userValue(user)));
      }
    } catch (error) {
      appStore.setOkkRecords([]);
      setArchive([]);
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить данные ОКК.');
    }
  };

  useEffect(() => { void load(); }, [factoryId]);
  useEffect(() => {
    let refreshTimer: number | null = null;
    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void load();
      }, 140);
    };
    window.addEventListener('zavod:quantity-release-updated', refresh);
    window.addEventListener('zavod:okk-updated', refresh);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('zavod:quantity-release-updated', refresh);
      window.removeEventListener('zavod:okk-updated', refresh);
    };
  }, [factoryId, canManage]);

  const postAction = async (id: string, path: string, body?: unknown) => {
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/okk/${id}/${path}`, body ?? {});
      await load();
      return true;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Действие ОКК не выполнено.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createRecord = async (values: Record<string, string | boolean>) => {
    setBusy(true);
    setErrorText(null);
    try {
      const quantityValue = String(values.defectQuantityValue ?? '').trim();
      const quantityUnit = String(values.defectQuantityUnit ?? 'штуки').trim();
      const { defectQuantityValue: _value, defectQuantityUnit: _unit, ...rest } = values;
      await apiClient.post('/okk', {
        ...rest,
        defectQuantity: quantityValue ? `${quantityValue} ${quantityUnit}` : '',
      });
      setModal(null);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось создать запись ОКК.');
    } finally {
      setBusy(false);
    }
  };

  const markCompletion = async (values: Record<string, string | boolean>) => {
    if (!activeId) return;
    if (await postAction(activeId, 'completion', values)) {
      setModal(null);
      setActiveId(null);
    }
  };

  const uploadForRecord = async () => {
    if (!activeId || !files.length) return;
    setBusy(true);
    setErrorText(null);
    try {
      await uploadAttachments('OKK_RECORD', activeId, files);
      setModal(null);
      setActiveId(null);
      setFiles([]);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить вложения.');
    } finally {
      setBusy(false);
    }
  };

  const releasePart = async (values: { quantity: string; comment: string; operationId: string }) => {
    if (!activeId) return;
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/okk/${activeId}/partial-release`, values);
      await load();
      setModal(null);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось выдать часть продукции.');
    } finally {
      setBusy(false);
    }
  };

  const createFields: ActionModalField[] = [
    { name: 'lineId', label: 'Линия', type: 'select', required: true, options: lines.map((line) => ({ label: line.name, value: line.id })) },
    { name: 'masterUserId', label: 'Мастер', type: 'select', required: true, options: masters.map((user) => ({ label: userLabel(user), value: userValue(user) })) },
    { name: 'defectDate', label: 'Дата брака', type: 'date', required: true },
    { name: 'shiftLabel', label: 'Смена', type: 'select', required: true, options: [{ label: 'День', value: 'День' }, { label: 'Ночь', value: 'Ночь' }] },
    { name: 'productionDate', label: 'Дата изготовления', type: 'date' },
    { name: 'article', label: 'Артикул' },
    { name: 'productName', label: 'Наименование продукции', required: true },
    { name: 'mismatchReason', label: 'Описание / причина несоответствия', type: 'textarea', required: true },
    { name: 'defectQuantityValue', label: 'Количество забракованной продукции', type: 'number' },
    { name: 'defectQuantityUnit', label: 'Единица', type: 'select', defaultValue: 'штуки', options: [{ label: 'штуки', value: 'штуки' }, { label: 'гофры', value: 'гофры' }] },
    { name: 'decision', label: 'Принятое решение', type: 'textarea' },
    { name: 'temperatureAfterExtraFreeze', label: 'Температура после доп. заморозки' },
  ];

  const completionFields: ActionModalField[] = [
    { name: 'completionMark', label: 'Отметка о выполнении', type: 'textarea', required: true, defaultValue: selected?.completionMark ?? '' },
    { name: 'unblockDate', label: 'Дата разбраковки', type: 'date', required: true },
    { name: 'completedByUserId', label: 'Кто выполнил / разбраковал', type: 'select', required: true, options: users.map((user) => ({ label: userLabel(user), value: userValue(user) })) },
    { name: 'blockedByUserId', label: 'Кто забраковал', type: 'select', required: true, options: users.map((user) => ({ label: userLabel(user), value: userValue(user) })) },
    { name: 'correctiveActions', label: 'Корректирующие действия', type: 'textarea', required: true },
  ];

  const recordLineName = (record: OkkRecord) => lineById.get(record.lineId ?? '') ?? 'Без линии';
  const recordTitle = (record: OkkRecord) => safeText(record.productName ?? record.description, 'Запись ОКК');
  const recordReason = (record: OkkRecord) => safeText(record.mismatchReason ?? record.description, 'Причина не указана');

  const renderRecordDetails = (record: OkkRecord, archived = false) => (
    <>
      <div className="line-title-row">
        <h3 className="line-name">{recordTitle(record)}</h3>
        <span className={`tag ${archived ? 'pause' : 'stop'}`}>{okkStatusLabels[record.status] ?? 'Статус не указан'}</span>
      </div>
      <div className="okk-table-grid">
        {[
          ['Дата брака', formatDate(record.defectDate)],
          ['Смена', safeText(record.shiftLabel)],
          ['Линия', recordLineName(record)],
          ['Мастер', safeText((record as any).assignedMasterName ?? record.masterNameSnapshot, 'Мастер не указан')],
          ['Дата изготовления', formatDate(record.productionDate)],
          ['Артикул', safeText(record.article)],
          ['Наименование', safeText(record.productName ?? record.description)],
          ['Описание / причина', safeText(record.mismatchReason ?? record.description)],
          [record.quantitySummary ? 'Исходное количество' : 'Количество', safeText(record.defectQuantity)],
          ['Решение', safeText(record.decision)],
          ['Отметка о выполнении', safeText(record.completionMark)],
          ['Кто выполнил', safeText(record.completedByNameSnapshot)],
          ['Кто забраковал', safeText(record.blockedByNameSnapshot)],
          ['Корректирующие действия', safeText(record.correctiveActions)],
        ].map(([label, value]) => (
          <div className="okk-field" key={label}>
            <strong>{label}</strong>
            <span>{value}</span>
          </div>
        ))}
      </div>
      <QuantityBalance summary={record.quantitySummary} />
      <QuantityReleaseHistoryList history={record.releaseHistory} />
      <AttachmentPreviewList attachments={record.attachments} />
      {canManage && !archived ? (
        <div className="action-grid" style={{ marginTop: 12 }}>
          {record.quantitySummary?.canRelease ? (
            <button className="action-button" disabled={busy} type="button" onClick={() => { setErrorText(null); setActiveId(record.id); setModal('partialRelease'); }}>Выдать часть</button>
          ) : null}
          <button className="action-button" disabled={busy} type="button" onClick={() => { setActiveId(record.id); setModal('completion'); }}>Отметить выполнение</button>
          <button className="action-button work" disabled={busy} type="button" onClick={() => { setActiveId(record.id); setModal('fullComplete'); }}>Полностью завершён</button>
          <button className="secondary-button" disabled={busy} type="button" onClick={() => { setActiveId(record.id); setModal('attachment'); }}>Прикрепить</button>
        </div>
      ) : null}
    </>
  );

  const renderRecord = (record: OkkRecord, archived = false) => (
    <article className={`card okk-record-card compact-record-card ${archived ? 'dimmed' : ''}`} key={record.id}>
      <div className="compact-record-main">
        <div>
          <span className="compact-record-date">{formatDate(record.defectDate)}</span>
          <strong>{recordTitle(record)}</strong>
          <span>{recordLineName(record)} · {recordReason(record)}</span>
        </div>
        <span className={`tag ${archived ? 'pause' : 'stop'}`}>{okkStatusLabels[record.status] ?? 'Статус'}</span>
      </div>
      <QuantityBalance compact summary={record.quantitySummary} />
      <div className="compact-record-footer">
        {!record.quantitySummary ? <span className="tag">{safeText(record.defectQuantity, 'Количество не указано')}</span> : <span />}
        <button className="secondary-button compact-action" type="button" onClick={() => setActiveId(record.id)}>Открыть</button>
      </div>
    </article>
  );

  return (
    <section className="screen-panel okk-screen">
      <PremiumSectionHeader title="ОКК" subtitle="Забракованная продукция, выполнение решений, архив и вложения." />
      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      <PremiumKpiStrip
        items={[
          { label: 'Активные записи', value: activeRecords.length, tone: activeRecords.length ? 'danger' : 'success', active: viewMode === 'active', onClick: () => setViewMode('active') },
          { label: 'Архив', value: archive.length, tone: 'muted', active: viewMode === 'archive', onClick: () => setViewMode('archive') },
        ]}
        label="Состояние записей ОКК"
      />
      {canManage ? <button className="primary-button" type="button" disabled={busy} onClick={() => setModal('create')}>Новый брак</button> : null}

      <div className="section-stack">
        <div className="section-subhead"><h3>{viewMode === 'active' ? 'Активные записи' : 'Архив'}</h3><span>{visibleRecords.length}</span></div>
        {!visibleRecords.length && !errorText ? <div className="empty-state">{viewMode === 'active' ? 'Активных записей ОКК пока нет.' : 'Архив ОКК пуст.'}</div> : null}
        {visibleRecords.map((record) => renderRecord(record, viewMode === 'archive'))}
      </div>

      {modal === 'create' ? <ActionModal title="Новый брак" fields={createFields} busy={busy} errorText={errorText} confirmLabel="Создать" onCancel={() => setModal(null)} onSubmit={createRecord} /> : null}
      {modal === 'completion' && activeId ? <ActionModal title="Отметить выполнение" fields={completionFields} busy={busy} errorText={errorText} confirmLabel="Сохранить" onCancel={() => setModal(null)} onSubmit={markCompletion} /> : null}
      {modal === 'fullComplete' && activeId ? (
        <ActionModal
          title="Полностью завершить запись"
          description="После подтверждения запись будет скрыта из активного списка и останется в архиве."
          busy={busy}
          errorText={errorText}
          confirmLabel="Подтвердить"
          onCancel={() => setModal(null)}
          onSubmit={async () => {
            if (await postAction(activeId, 'full-complete')) {
              setModal(null);
              setActiveId(null);
            }
          }}
        />
      ) : null}
      {modal === 'attachment' && activeId ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-form">
            <h3>Добавить вложения ОКК</h3>
            <AttachmentPicker value={files} onChange={setFiles} allowFiles disabled={busy} />
            <div className="modal-actions">
              <button className="secondary-button" disabled={busy} type="button" onClick={() => { setFiles([]); setModal(null); }}>Отмена</button>
              <button className="primary-button" disabled={busy || !files.length} type="button" onClick={() => void uploadForRecord()}>Загрузить</button>
            </div>
          </div>
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
      {selected && !modal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-dashboard-card premium-deep-panel">
            <div className="modal-header">
              <h3>Запись ОКК</h3>
              <button className="secondary-button" type="button" onClick={() => setActiveId(null)}>Закрыть</button>
            </div>
            {renderRecordDetails(selected, Boolean(selected.archivedAt || selected.status === 'COMPLETED' || selected.status === 'ARCHIVED'))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
