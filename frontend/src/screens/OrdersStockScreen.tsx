import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { apiClient } from '../api/client';
import { ActionModal, ActionModalField } from '../components/ActionModal';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { PremiumSheet } from '../components/PremiumShell';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { Attachment, useAppStore } from '../store/app.store';
import { isPilotFixtureText } from '../utils/pilot-ui';

void React;

type ShortageStatus = 'NORMAL' | 'LOW' | 'CRITICAL' | 'OUT';
type StockItem = {
  id: string;
  departmentId?: string | null;
  departmentName?: string | null;
  departmentLabel?: string | null;
  departmentScope?: string | null;
  name: string;
  category?: string | null;
  description?: string | null;
  storageLocation?: string | null;
  currentQuantity: number;
  minThreshold: number;
  initialQuantity: number;
  referenceQuantity: number;
  unit: string;
  percent: number;
  color: 'green' | 'yellow' | 'red';
  belowThreshold: boolean;
  shortageStatus: ShortageStatus;
  shortageStatusLabel: string;
  activeOrderRequestsCount: number;
  hasOpenOrderRequest: boolean;
  archivedAt?: string | null;
  attachments?: Attachment[];
  movements?: Array<{ id: string; type: string; typeLabel: string; quantity: number; beforeQuantity: number; afterQuantity: number; unit: string; comment: string; createdAt: string }>;
  orderRequests?: OrderRequest[];
};

type OrderRequest = {
  id: string;
  departmentId?: string | null;
  departmentName?: string | null;
  departmentLabel?: string | null;
  departmentScope?: string | null;
  title: string;
  sourceType: 'AUTO_FROM_STOCK' | 'MANUAL';
  sourceTypeLabel: string;
  status: 'ACTIVE' | 'ORDERED' | 'NOT_NEEDED' | 'CLOSED_RESERVED';
  statusLabel: string;
  requestedQuantity?: number | null;
  unit?: string | null;
  reasonComment: string;
  description?: string | null;
  closeComment?: string | null;
  createdAt: string;
  closedAt?: string | null;
  createdByLabel?: string | null;
  sourceItem?: { id: string; name: string; unit: string | null; currentQuantity: number; minThreshold: number; departmentLabel?: string | null } | null;
  attachments?: Attachment[];
};

type Summary = {
  belowThreshold: number; criticalItems?: number; activeRequests: number; itemsCount: number;
  formSettings?: { defaultUnit: string; takeRequiresComment: boolean; restockRequiresComment: boolean; archiveRequiresComment: boolean };
};
type Tab = 'items' | 'requests' | 'archive';
type ModalMode = 'create-item' | 'edit-item' | 'take' | 'restock' | 'order' | 'manual-request' | 'close-ordered' | 'close-not-needed' | 'archive' | 'restore';
type DirectoryDepartment = { id: string; name: string; scope?: string | null };
type OrderRequestStatusFilter = '' | OrderRequest['status'];
type OrdersFilters = {
  search: string;
  category: string;
  status: '' | ShortageStatus;
  requestStatus: OrderRequestStatusFilter;
  department: string;
};

const STOCK_UNITS = ['шт', 'кг', 'г', 'м', 'см', 'л', 'мл', 'упак.', 'короб', 'рулон', 'пара'];
const INTEGER_UNITS = new Set(['шт', 'короб', 'пара', 'упак.', 'рулон']);

const statusFilters: Array<{ label: string; value: '' | ShortageStatus }> = [
  { label: 'Все статусы', value: '' },
  { label: 'Нормально', value: 'NORMAL' },
  { label: 'Мало', value: 'LOW' },
  { label: 'Критично', value: 'CRITICAL' },
  { label: 'Нет в наличии', value: 'OUT' },
];

const requestStatusFilters: Array<{ label: string; value: OrderRequestStatusFilter }> = [
  { label: 'Все решения', value: '' },
  { label: 'К заказу', value: 'ORDERED' },
  { label: 'Отклонена', value: 'NOT_NEEDED' },
  { label: 'Закрыта', value: 'CLOSED_RESERVED' },
];

function formatDate(value?: string | null) {
  if (!value) return 'Не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Не указано';
  return date.toLocaleString('ru-RU');
}

function statusClass(status: ShortageStatus) {
  if (status === 'OUT' || status === 'CRITICAL') return 'stop';
  if (status === 'LOW') return 'pause';
  return 'work';
}

function quantityText(value?: number | null, unit?: string | null) {
  if (value === null || value === undefined) return 'Не указано';
  return `${value} ${unit ?? ''}`.trim();
}

function isVisibleStockItem(item: StockItem) {
  return !isPilotFixtureText(item.name, item.category, item.description, item.storageLocation);
}

function isVisibleOrderRequest(request: OrderRequest) {
  return !isPilotFixtureText(
    request.title,
    request.description,
    request.reasonComment,
    request.closeComment,
    request.sourceItem?.name,
  );
}

export function OrdersStockScreen() {
  const { currentUser } = useAppStore();
  const [tab, setTab] = useState<Tab>('items');
  const [items, setItems] = useState<StockItem[]>([]);
  const [requests, setRequests] = useState<OrderRequest[]>([]);
  const [archiveItems, setArchiveItems] = useState<StockItem[]>([]);
  const [archiveRequests, setArchiveRequests] = useState<OrderRequest[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<OrderRequest | null>(null);
  const [modal, setModal] = useState<null | { title: string; mode: ModalMode; item?: StockItem; request?: OrderRequest }>(null);
  const [modalOperationId, setModalOperationId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | ShortageStatus>('');
  const [requestStatusFilter, setRequestStatusFilter] = useState<OrderRequestStatusFilter>('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<OrdersFilters>({ search: '', category: '', status: '', requestStatus: '', department: '' });
  const [departments, setDepartments] = useState<DirectoryDepartment[]>([]);
  const actionInFlightRef = useRef(false);

  const canManageItems = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('orders.items.manage'));
  const canRestock = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('orders.restock') || currentUser?.permissions.includes('orders.items.manage'));
  const canTake = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('orders.take'));
  const canRequest = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('orders.request'));
  const canClose = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('orders.requests.manage'));
  const canArchive = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('orders.archive.read'));
  const canFilterDepartments = Boolean(currentUser?.isAdmin);
  useBodyScrollLock(Boolean(selectedItem || selectedRequest));
  useMobileBackLayer(Boolean(selectedItem) && !modal, () => setSelectedItem(null), 700);
  useMobileBackLayer(Boolean(selectedRequest) && !modal, () => setSelectedRequest(null), 700);
  const departmentOptions = useMemo(
    () => [
      { value: '', label: 'Все доступные отделы' },
      { value: 'shared', label: 'Общее' },
      ...departments.map((department) => ({
        value: department.id,
        label: department.scope === 'GLOBAL' ? `${department.name} · общая служба` : department.name,
      })),
    ],
    [departments],
  );
  const departmentFormOptions = useMemo(
    () => [
      { value: 'shared', label: 'Общее' },
      ...departments.map((department) => ({
        value: department.id,
        label: department.scope === 'GLOBAL' ? `${department.name} · общая служба` : department.name,
      })),
    ],
    [departments],
  );

  const load = async (nextFilters: OrdersFilters = { search, category: categoryFilter, status: statusFilter, requestStatus: requestStatusFilter, department: departmentFilter }) => {
    setLoading(true);
    setErrorText(null);
    try {
      const params = new URLSearchParams();
      if (nextFilters.search.trim()) params.set('search', nextFilters.search.trim());
      if (nextFilters.category) params.set('category', nextFilters.category);
      if (nextFilters.status) params.set('shortageStatus', nextFilters.status);
      if (canFilterDepartments && nextFilters.department) params.set('departmentId', nextFilters.department);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const requestParams = new URLSearchParams();
      if (nextFilters.search.trim()) requestParams.set('search', nextFilters.search.trim());
      if (nextFilters.category) requestParams.set('category', nextFilters.category);
      if (canFilterDepartments && nextFilters.department) requestParams.set('departmentId', nextFilters.department);
      const requestSuffix = requestParams.toString() ? `?${requestParams.toString()}` : '';
      const [nextSummary, nextItems, nextRequests] = await Promise.all([
        apiClient.get<Summary>('/orders/summary'),
        apiClient.get<StockItem[]>(`/orders/items${suffix}`),
        apiClient.get<OrderRequest[]>(`/orders/requests${requestSuffix}`),
      ]);
      const visibleItems = nextItems.filter(isVisibleStockItem);
      const visibleRequests = nextRequests.filter(isVisibleOrderRequest);
      setSummary(nextSummary);
      setItems(visibleItems);
      setRequests(visibleRequests);
      if (canFilterDepartments && !departments.length) {
        setDepartments(await apiClient.get<DirectoryDepartment[]>('/directory/departments'));
      }
      if (canArchive) {
        const itemArchiveParams = new URLSearchParams(params);
        itemArchiveParams.set('archive', 'true');
        const requestArchiveParams = new URLSearchParams(requestParams);
        requestArchiveParams.set('archive', 'true');
        if (nextFilters.requestStatus) requestArchiveParams.set('status', nextFilters.requestStatus);
        const [archived, closed] = await Promise.all([
          apiClient.get<StockItem[]>(`/orders/items?${itemArchiveParams.toString()}`),
          apiClient.get<OrderRequest[]>(`/orders/requests?${requestArchiveParams.toString()}`),
        ]);
        setArchiveItems(archived.filter(isVisibleStockItem));
        setArchiveRequests(closed.filter(isVisibleOrderRequest));
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить остатки и заявки.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [canArchive, canFilterDepartments, departmentFilter]);

  useEffect(() => {
    const refreshFromRealtime = () => {
      void load();
      if (selectedItem?.id) void apiClient.get<StockItem>(`/orders/items/${selectedItem.id}`).then(setSelectedItem).catch(() => undefined);
      if (selectedRequest?.id) void apiClient.get<OrderRequest>(`/orders/requests/${selectedRequest.id}`).then(setSelectedRequest).catch(() => undefined);
    };
    window.addEventListener('zavod:orders-updated', refreshFromRealtime);
    return () => window.removeEventListener('zavod:orders-updated', refreshFromRealtime);
  }, [categoryFilter, departmentFilter, requestStatusFilter, search, selectedItem?.id, selectedRequest?.id, statusFilter]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    [...items, ...archiveItems].forEach((item) => {
      if (item.category) set.add(item.category);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [archiveItems, items]);

  const activeList = useMemo(() => [...items].sort((a, b) => Number(b.belowThreshold) - Number(a.belowThreshold) || a.name.localeCompare(b.name, 'ru')), [items]);

  const resetForm = () => setFiles([]);

  const openModal = (next: NonNullable<typeof modal>) => {
    resetForm();
    setModalOperationId(crypto.randomUUID());
    setModal(next);
  };

  const uploadFiles = async (entityType: string, entityId: string) => {
    await uploadAttachments(entityType, entityId, files);
  };

  const modalFields = (): ActionModalField[] => {
    if (!modal) return [];
    if (modal.mode === 'create-item' || modal.mode === 'edit-item') {
      const item = modal.item;
      return [
        { name: 'name', label: 'Наименование', required: true, defaultValue: item?.name ?? '' },
        { name: 'category', label: 'Категория', placeholder: 'Например: расходники, запчасти, упаковка', defaultValue: item?.category ?? '' },
        { name: 'storageLocation', label: 'Склад / зона хранения', placeholder: 'Например: склад техслужбы', defaultValue: item?.storageLocation ?? '' },
        ...(canFilterDepartments ? [{ name: 'departmentId', label: 'Отдел / владелец', type: 'select' as const, defaultValue: item?.departmentId ?? 'shared', options: departmentFormOptions }] : []),
        { name: 'minThreshold', label: 'Минимальный остаток', type: 'number', required: true, defaultValue: item?.minThreshold ?? '' },
        ...(modal.mode === 'create-item' ? [{ name: 'initialQuantity', label: 'Текущий остаток', type: 'number' as const, required: true }] : []),
        { name: 'unit', label: 'Единица измерения', type: 'select', required: true, defaultValue: item?.unit ?? summary?.formSettings?.defaultUnit ?? 'шт', options: STOCK_UNITS.map((value) => ({ value, label: value })) },
        { name: 'description', label: 'Комментарий', type: 'textarea', defaultValue: item?.description ?? '' },
      ];
    }
    if (modal.mode === 'take' || modal.mode === 'restock') {
      return [
        { name: 'quantity', label: `Количество, ${modal.item?.unit ?? ''}`, type: 'number', required: true },
        { name: 'comment', label: modal.mode === 'take' ? 'Комментарий к расходу' : 'Комментарий к пополнению', type: 'textarea', required: modal.mode === 'take' ? (summary?.formSettings?.takeRequiresComment ?? true) : (summary?.formSettings?.restockRequiresComment ?? true) },
      ];
    }
    if (modal.mode === 'order') {
      return [
        { name: 'quantity', label: `Сколько заказать, ${modal.item?.unit ?? ''}`, type: 'number', required: true, defaultValue: modal.item ? Math.max(modal.item.minThreshold - modal.item.currentQuantity, 1) : '' },
        { name: 'comment', label: 'Причина заказа', type: 'textarea', required: true },
      ];
    }
    if (modal.mode === 'manual-request') {
      return [
        { name: 'title', label: 'Наименование', required: true },
        ...(canFilterDepartments ? [{ name: 'departmentId', label: 'Отдел', type: 'select' as const, defaultValue: currentUser?.departmentId ?? 'shared', options: departmentFormOptions }] : []),
        { name: 'description', label: 'Описание', type: 'textarea' },
        { name: 'quantity', label: 'Желаемое количество', type: 'number' },
        { name: 'unit', label: 'Единица', type: 'select', required: true, defaultValue: 'шт', options: STOCK_UNITS.map((value) => ({ value, label: value })) },
        { name: 'comment', label: 'Комментарий', type: 'textarea', required: true },
      ];
    }
    if (modal.mode === 'close-ordered' || modal.mode === 'close-not-needed' || modal.mode === 'archive') {
      return [{ name: 'comment', label: modal.mode === 'archive' ? 'Причина архивации' : 'Комментарий', type: 'textarea', required: modal.mode === 'archive' ? (summary?.formSettings?.archiveRequiresComment ?? true) : modal.mode !== 'close-ordered' }];
    }
    return [];
  };

  const validateIntegerUnit = (value: string, unit: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Укажите количество.';
    if (number < 0) return 'Количество не может быть меньше нуля.';
    if (INTEGER_UNITS.has(unit) && !Number.isInteger(number)) return `Для "${unit}" нужно целое число.`;
    return null;
  };

  const runAction = async (values: Record<string, string | boolean>) => {
    if (!modal || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setLoading(true);
    setErrorText(null);
    try {
      const unit = String(values.unit || modal.item?.unit || 'шт');
      const rawDepartmentId = typeof values.departmentId === 'string' ? values.departmentId : '';
      const formDepartmentId = rawDepartmentId && rawDepartmentId !== 'shared' ? rawDepartmentId : null;
      const quantityValue = String(values.quantity ?? values.initialQuantity ?? '');
      if (['take', 'restock', 'order'].includes(modal.mode)) {
        const quantityError = validateIntegerUnit(quantityValue, unit);
        if (quantityError || Number(quantityValue) <= 0) throw new Error(quantityError ?? 'Количество должно быть больше нуля.');
      }
      if (modal.mode === 'create-item') {
        const minError = validateIntegerUnit(String(values.minThreshold ?? ''), unit);
        const initialError = validateIntegerUnit(String(values.initialQuantity ?? ''), unit);
        if (minError || initialError || Number(values.initialQuantity) <= 0) throw new Error(minError ?? initialError ?? 'Текущий остаток должен быть больше нуля.');
        const created = await apiClient.post<StockItem>('/orders/items', {
          name: values.name,
          category: values.category,
          storageLocation: values.storageLocation,
          description: values.description,
          minThreshold: Number(values.minThreshold),
          initialQuantity: Number(values.initialQuantity),
          unit,
          departmentId: formDepartmentId,
        });
        await uploadFiles('MINIMUM_STOCK_ITEM', created.id);
      }
      if (modal.mode === 'edit-item' && modal.item) {
        await apiClient.patch<StockItem>(`/orders/items/${modal.item.id}`, {
          name: values.name,
          category: values.category,
          storageLocation: values.storageLocation,
          description: values.description,
          minThreshold: Number(values.minThreshold),
          unit,
          departmentId: formDepartmentId,
          reason: 'Обновление карточки остатка',
        });
      }
      if (modal.mode === 'take' && modal.item) await apiClient.post(`/orders/items/${modal.item.id}/take`, { quantity: Number(values.quantity), comment: values.comment, operationId: modalOperationId || crypto.randomUUID() });
      if (modal.mode === 'restock' && modal.item) await apiClient.post(`/orders/items/${modal.item.id}/restock`, { quantity: Number(values.quantity), comment: values.comment, operationId: modalOperationId || crypto.randomUUID() });
      if (modal.mode === 'order' && modal.item) {
        const created = await apiClient.post<OrderRequest>(`/orders/items/${modal.item.id}/order`, { requestedQuantity: Number(values.quantity), reasonComment: values.comment, operationId: modalOperationId || crypto.randomUUID() });
        await uploadFiles('ORDER_REQUEST', created.id);
      }
      if (modal.mode === 'manual-request') {
        const created = await apiClient.post<OrderRequest>('/orders/requests', { title: values.title, description: values.description, requestedQuantity: values.quantity ? Number(values.quantity) : null, unit: values.unit, reasonComment: values.comment, departmentId: formDepartmentId, operationId: modalOperationId || crypto.randomUUID() });
        await uploadFiles('ORDER_REQUEST', created.id);
      }
      if (modal.mode === 'close-ordered' && modal.request) await apiClient.post(`/orders/requests/${modal.request.id}/close`, { closeStatus: 'ORDERED', comment: values.comment });
      if (modal.mode === 'close-not-needed' && modal.request) await apiClient.post(`/orders/requests/${modal.request.id}/close`, { closeStatus: 'NOT_NEEDED', comment: values.comment });
      if (modal.mode === 'archive' && modal.item) await apiClient.post(`/orders/items/${modal.item.id}/archive`, { comment: values.comment });
      if (modal.mode === 'restore' && modal.item) await apiClient.post(`/orders/items/${modal.item.id}/restore`, {});
      setModal(null);
      setModalOperationId('');
      await load();
      if ((modal.mode === 'edit-item' || modal.mode === 'take' || modal.mode === 'restock' || modal.mode === 'order' || modal.mode === 'archive' || modal.mode === 'restore') && modal.item) {
        const updated = await apiClient.get<StockItem>(`/orders/items/${modal.item.id}`);
        setSelectedItem((current) => current?.id === updated.id ? updated : current);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Действие не выполнено.');
    } finally {
      actionInFlightRef.current = false;
      setLoading(false);
    }
  };

  const openItemDetail = async (item: StockItem) => {
    setSelectedItem(item);
    try {
      setSelectedItem(await apiClient.get<StockItem>(`/orders/items/${item.id}`));
    } catch {
      setSelectedItem(item);
    }
  };

  return (
    <section className="screen-panel orders-stock-screen">
      <div className="screen-heading">
        <h2>Заказы / Остатки</h2>
        <p>Неснижаемый запас критичных позиций и заявки на пополнение. Это не складской учёт и не 1С.</p>
      </div>

      <div className="dashboard-grid">
        <div className="metric-card"><div className="metric-label">Ниже минимума</div><div className="metric-value">{summary?.belowThreshold ?? 0}</div></div>
        <div className="metric-card"><div className="metric-label">Критично / нет</div><div className="metric-value">{summary?.criticalItems ?? 0}</div></div>
        <div className="metric-card"><div className="metric-label">Открытые заявки</div><div className="metric-value">{summary?.activeRequests ?? 0}</div></div>
        <div className="metric-card"><div className="metric-label">Позиции</div><div className="metric-value">{summary?.itemsCount ?? 0}</div></div>
      </div>

      <div className="premium-segmented-control orders-stock-tabs" style={{ '--segments': canArchive ? 3 : 2 } as React.CSSProperties}>
        <button aria-pressed={tab === 'items'} className={tab === 'items' ? 'active' : ''} type="button" onClick={() => setTab('items')}>Остатки</button>
        <button aria-pressed={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} type="button" onClick={() => setTab('requests')}>Заявки на заказ</button>
        {canArchive ? <button aria-pressed={tab === 'archive'} className={tab === 'archive' ? 'active' : ''} type="button" onClick={() => setTab('archive')}>Архив</button> : null}
      </div>

      <div className="premium-filter-trigger-row orders-stock-filter-trigger">
        <button className="secondary-button" type="button" onClick={() => {
          setFilterDraft({ search, category: categoryFilter, status: statusFilter, requestStatus: requestStatusFilter, department: departmentFilter });
          setFilterOpen(true);
        }}>Поиск и фильтры</button>
        <span className="premium-filter-summary">
          {[
            search ? `«${search}»` : '',
            categoryFilter || '',
            tab !== 'requests' ? statusFilters.find((item) => item.value === statusFilter)?.label ?? '' : '',
            tab === 'archive' ? requestStatusFilters.find((item) => item.value === requestStatusFilter)?.label ?? '' : '',
            canFilterDepartments && departmentFilter ? departmentOptions.find((item) => item.value === departmentFilter)?.label ?? '' : '',
          ].filter((item) => item && item !== 'Все статусы' && item !== 'Все решения').join(' · ') || (tab === 'requests' ? 'Все открытые заявки' : tab === 'archive' ? 'Весь доступный архив' : 'Все доступные позиции')}
        </span>
      </div>

      <PremiumSheet
        open={filterOpen}
        title="Поиск и фильтры"
        description="Фильтры применяются только в доступной вам области завода."
        onClose={() => setFilterOpen(false)}
        footer={(
          <>
            <button className="secondary-button" type="button" onClick={() => setFilterDraft({ search: '', category: '', status: '', requestStatus: '', department: '' })}>Сбросить</button>
            <button className="primary-button" type="button" onClick={() => {
              setSearch(filterDraft.search.trim());
              setCategoryFilter(filterDraft.category);
              setStatusFilter(filterDraft.status);
              setRequestStatusFilter(filterDraft.requestStatus);
              setDepartmentFilter(filterDraft.department);
              setFilterOpen(false);
              void load(filterDraft);
            }}>Показать</button>
          </>
        )}
      >
        <div className="premium-filter-form">
          <label>Поиск<input autoFocus value={filterDraft.search} onChange={(event) => setFilterDraft((current) => ({ ...current, search: event.target.value }))} placeholder={tab === 'requests' ? 'Название, причина или позиция' : 'Название, категория или зона'} /></label>
          <label>
            Категория
            <select value={filterDraft.category} onChange={(event) => setFilterDraft((current) => ({ ...current, category: event.target.value }))}>
              <option value="">Все категории</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          {tab !== 'requests' ? (
            <label>
              Состояние остатка
              <select value={filterDraft.status} onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value as '' | ShortageStatus }))}>
                {statusFilters.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          ) : null}
          {tab === 'archive' ? (
            <label>
              Решение по заявке
              <select value={filterDraft.requestStatus} onChange={(event) => setFilterDraft((current) => ({ ...current, requestStatus: event.target.value as OrderRequestStatusFilter }))}>
                {requestStatusFilters.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          ) : null}
          {canFilterDepartments ? (
            <label>
              Отдел
              <select value={filterDraft.department} onChange={(event) => setFilterDraft((current) => ({ ...current, department: event.target.value }))}>
                {departmentOptions.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </PremiumSheet>

      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {loading ? <div className="empty-state">Загрузка...</div> : null}

      {tab === 'items' ? (
        <div className="card-list">
          {canManageItems ? <button className="primary-button" type="button" onClick={() => openModal({ title: 'Новая позиция остатка', mode: 'create-item' })}>+ Новая позиция</button> : null}
          {!activeList.length && !loading ? <div className="empty-state">Активных позиций остатков пока нет.</div> : null}
          {activeList.map((item) => (
            <article className={`card line-card compact-record-card ${item.shortageStatus === 'OUT' || item.shortageStatus === 'CRITICAL' ? 'critical-card' : item.shortageStatus === 'LOW' ? 'needs-attention' : ''}`} key={item.id}>
              <div className="compact-record-main">
                <div>
                  <span className="compact-record-date">{item.category || 'Без категории'}</span>
                  <strong>{item.name}</strong>
                  <span>{quantityText(item.currentQuantity, item.unit)}</span>
                </div>
                <span className={`tag ${statusClass(item.shortageStatus)}`}>{item.shortageStatusLabel}</span>
              </div>
              <div className="compact-record-footer">
                <span>Владелец: {item.departmentLabel || 'Общее'}</span>
                {item.hasOpenOrderRequest ? <span className="tag pause">Открытый заказ: {item.activeOrderRequestsCount}</span> : <span>Открытого заказа нет</span>}
                <button className="secondary-button compact-action" type="button" onClick={() => void openItemDetail(item)}>Подробнее</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {tab === 'requests' ? (
        <div className="card-list">
          {canRequest ? <button className="primary-button" type="button" onClick={() => openModal({ title: 'Подать заявку на заказ', mode: 'manual-request' })}>Подать заявку</button> : null}
          {!requests.length && !loading ? <div className="empty-state">Открытых заявок на заказ пока нет.</div> : null}
          {requests.map((request) => (
            <OrderRequestCard canClose={canClose} key={request.id} onCloseNoNeed={() => openModal({ title: 'Закрыть как не нужную', mode: 'close-not-needed', request })} onCloseOrdered={() => openModal({ title: 'Отметить как заказано', mode: 'close-ordered', request })} onOpen={() => setSelectedRequest(request)} request={request} />
          ))}
        </div>
      ) : null}

      {tab === 'archive' ? (
        <div className="card-list">
          {archiveItems.map((item) => (
            <article className="card line-card compact-record-card dimmed" key={item.id}>
              <div className="compact-record-main">
                <div>
                  <span className="compact-record-date">Архив</span>
                  <strong>{item.name}</strong>
                  <span>{quantityText(item.currentQuantity, item.unit)}</span>
                </div>
                <span className="tag">Архив</span>
              </div>
              <div className="compact-record-footer">
                <span>{item.departmentLabel || 'Общее'}</span>
                <button className="secondary-button compact-action" type="button" onClick={() => void openItemDetail(item)}>Подробнее</button>
              </div>
            </article>
          ))}
          {archiveRequests.map((request) => (
            <OrderRequestCard canClose={false} key={request.id} onOpen={() => setSelectedRequest(request)} request={request} />
          ))}
        </div>
      ) : null}

      {selectedItem ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-panel">
            <div className="modal-header"><h3>{selectedItem.name}</h3><button className="secondary-button" type="button" onClick={() => setSelectedItem(null)}>Закрыть окно</button></div>
            <div className="info-grid">
              <span>Статус: <strong>{selectedItem.shortageStatusLabel}</strong></span>
              <span>Количество: <strong>{quantityText(selectedItem.currentQuantity, selectedItem.unit)}</strong></span>
              <span>Минимум: <strong>{quantityText(selectedItem.minThreshold, selectedItem.unit)}</strong></span>
              <span>Категория: <strong>{selectedItem.category || 'Без категории'}</strong></span>
              <span>Отдел / владелец: <strong>{selectedItem.departmentLabel || 'Общее'}</strong></span>
              <span>Зона: <strong>{selectedItem.storageLocation || 'Не указана'}</strong></span>
            </div>
            {selectedItem.description ? <p>{selectedItem.description}</p> : null}
            {selectedItem.hasOpenOrderRequest ? <span className="tag pause">Открытый заказ: {selectedItem.activeOrderRequestsCount}</span> : null}
            <AttachmentPreviewList attachments={selectedItem.attachments} />
            <div className="admin-inline-actions">
              {canManageItems && selectedItem.archivedAt ? <button className="secondary-button" type="button" onClick={() => openModal({ title: 'Восстановить позицию', mode: 'restore', item: selectedItem })}>Восстановить</button> : null}
              {!selectedItem.archivedAt && canManageItems ? <button className="secondary-button" type="button" onClick={() => openModal({ title: 'Редактировать остаток', mode: 'edit-item', item: selectedItem })}>Редактировать</button> : null}
              {!selectedItem.archivedAt && canTake ? <button className="action-button" type="button" onClick={() => openModal({ title: 'Израсходовать', mode: 'take', item: selectedItem })}>Израсходовать</button> : null}
              {!selectedItem.archivedAt && canRequest ? <button className="secondary-button" disabled={selectedItem.hasOpenOrderRequest} title={selectedItem.hasOpenOrderRequest ? 'По позиции уже есть открытая заявка' : undefined} type="button" onClick={() => openModal({ title: 'Заказать пополнение', mode: 'order', item: selectedItem })}>Заказать</button> : null}
              {!selectedItem.archivedAt && canRestock ? <button className="success-button" type="button" onClick={() => openModal({ title: 'Пополнить остаток', mode: 'restock', item: selectedItem })}>Пополнить</button> : null}
              {!selectedItem.archivedAt && canManageItems ? <button className="secondary-button" type="button" onClick={() => openModal({ title: 'В архив', mode: 'archive', item: selectedItem })}>В архив</button> : null}
            </div>
            {(selectedItem.movements ?? []).map((movement) => (
              <div className="position-row" key={movement.id}>
                <div><strong>{movement.typeLabel}</strong><span>{movement.comment}</span><small>{formatDate(movement.createdAt)}</small></div>
                <span>{quantityText(movement.beforeQuantity, movement.unit)} → {quantityText(movement.afterQuantity, movement.unit)}</span>
              </div>
            ))}
            {(selectedItem.orderRequests ?? []).map((request) => <OrderRequestCard canClose={false} key={request.id} request={request} />)}
          </div>
        </div>
      ) : null}

      {selectedRequest ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-panel">
            <div className="modal-header"><h3>{selectedRequest.title}</h3><button className="secondary-button" type="button" onClick={() => setSelectedRequest(null)}>Закрыть окно</button></div>
            <p>{selectedRequest.reasonComment}</p>
            <p>Создал: {selectedRequest.createdByLabel || 'Пользователь'} · {formatDate(selectedRequest.createdAt)} · {selectedRequest.departmentLabel || 'Общее'}</p>
            {selectedRequest.sourceItem ? <p>Связанный остаток: {selectedRequest.sourceItem.name}</p> : null}
            <AttachmentPreviewList attachments={selectedRequest.attachments} />
          </div>
        </div>
      ) : null}

      {modal ? (
        <ActionModal
          busy={loading}
          confirmLabel={modal.mode === 'restore' ? 'Восстановить' : 'Сохранить'}
          errorText={errorText}
          fields={modalFields()}
          onCancel={() => { setModal(null); setModalOperationId(''); }}
          onSubmit={(values) => runAction(values)}
          title={modal.title}
        >
          {['create-item', 'order', 'manual-request'].includes(modal.mode) ? <AttachmentPicker allowFiles onChange={setFiles} value={files} /> : null}
          {modal.mode === 'order' && modal.item?.hasOpenOrderRequest ? <div className="empty-state warning-state">По этой позиции уже есть открытая заявка. Новая заявка не будет создана, пока старая открыта.</div> : null}
        </ActionModal>
      ) : null}
    </section>
  );
}

function OrderRequestCard({ request, canClose, onOpen, onCloseOrdered, onCloseNoNeed }: { request: OrderRequest; canClose: boolean; onOpen?: () => void; onCloseOrdered?: () => void; onCloseNoNeed?: () => void }) {
  return (
    <article className="card line-card order-request-card">
      <div className="line-title-row order-request-card-head">
        <h3>{request.title}</h3>
        <span className={`tag ${request.status === 'ACTIVE' ? 'work' : ''}`}>{request.statusLabel}</span>
      </div>
      <div className="info-grid order-request-card-meta">
        <span>Тип: <strong>{request.sourceTypeLabel}</strong></span>
        <span>Количество: <strong>{request.requestedQuantity ? quantityText(request.requestedQuantity, request.unit) : 'Не указано'}</strong></span>
        <span>Отдел / владелец: <strong>{request.departmentLabel || 'Общее'}</strong></span>
        <span>Создал: <strong>{request.createdByLabel || 'Пользователь'}</strong></span>
        <span>Дата: <strong>{formatDate(request.createdAt)}</strong></span>
      </div>
      <p>{request.reasonComment}</p>
      {request.sourceItem ? <span className="tag">Остаток: {request.sourceItem.name} · {request.sourceItem.departmentLabel || 'Общее'}</span> : null}
      {request.closeComment ? <p>Комментарий закрытия: {request.closeComment}</p> : null}
      <AttachmentPreviewList attachments={request.attachments} />
      <div className="admin-inline-actions">
        {onOpen ? <button className="secondary-button" type="button" onClick={onOpen}>Открыть</button> : null}
        {canClose && request.status === 'ACTIVE' && onCloseOrdered ? <button className="success-button" type="button" onClick={onCloseOrdered}>К заказу</button> : null}
        {canClose && request.status === 'ACTIVE' && onCloseNoNeed ? <button className="secondary-button danger" type="button" onClick={onCloseNoNeed}>Отклонить</button> : null}
      </div>
    </article>
  );
}
