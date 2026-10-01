import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { AttachmentPreviewList, type AttachmentPreviewItem } from '../components/AttachmentPreviewList';
import { ActionModal } from '../components/ActionModal';
import { PremiumActionItem, PremiumSectionHeader, PremiumSheet } from '../components/PremiumShell';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { factoryDateKey } from '../utils/factory-time';

type ArchiveSectionKey = 'tasks' | 'checklists' | 'okk' | 'returns' | 'stock' | 'orders' | 'wash' | 'defrost' | 'shiftLog' | 'announcements' | 'attachments';
type ArchiveSection = { key: ArchiveSectionKey; label: string; description: string };
type ArchiveItem = {
  id: string; section: ArchiveSectionKey; sourceType: string; sourceId: string; title: string; date: string;
  status: string | null; departmentName: string | null; lineName: string | null; authorName: string | null;
  summary: string | null; hasAttachments: boolean; sourceRoute?: string | null;
  responseMinutes?: number | null; executionMinutes?: number | null; resolutionMinutes?: number | null;
};
type ArchiveAttachment = {
  id: string; filename: string; kind: string; mimeType: string; size: number; createdAt: string; author: string;
  sourceType: string; sourceTitle: string; sourceId: string; sourceRoute?: string | null; downloadAllowed: boolean;
};
type ArchiveItemsResponse = { items: ArchiveItem[]; page: number; pageSize: number; total: number; hasMore: boolean; metrics?: { takeQuantity: number; restockQuantity: number } | null };
type ArchiveAttachmentsResponse = { items: ArchiveAttachment[]; page: number; pageSize: number; total: number; hasMore: boolean };
type ArchiveOptions = {
  sections: ArchiveSection[];
  departments: Array<{ id: string; name: string }>;
  lines: Array<{ id: string; name: string }>;
  checklistTemplates: Array<{ id: string; name: string }>;
};
type ArchiveDetailField = { label: string; value: string | number | boolean | null; kind?: 'text' | 'status' | 'datetime' | 'duration' };
type ArchiveDetailEntry = { title: string; status?: string | null; date?: string | null; actor?: string | null; text?: string | null; fields?: ArchiveDetailField[]; attachmentIds?: string[] };
type ArchiveDetail = {
  section: ArchiveSectionKey; sourceType: string; title: string; status: string | null; date: string; sourceRoute: string | null;
  sections: Array<{ title: string; fields?: ArchiveDetailField[]; entries?: ArchiveDetailEntry[]; emptyText?: string }>;
  attachments: Array<{ id: string; filename: string; kind: string; mimeType: string; size: number; createdAt: string; author: string }>;
};
type ArchiveFilters = {
  dateFrom: string; dateTo: string; search: string; status: string; lineId: string; departmentId: string;
  assigneeId: string; reason: string; type: string; templateId: string; downtimeLinkedOnly: boolean;
};
type DowntimeTab = 'summary' | 'lines' | 'departments' | 'assignees' | 'overdue' | 'items';
type DowntimeOptions = {
  lines: Array<{ id: string; name: string }>; departments: Array<{ id: string; name: string }>;
  assignees: Array<{ userId: string; displayName?: string | null; departmentName: string | null }>;
  reasons: Array<{ value: string; label: string }>;
};
type DowntimeData = { summary: any | null; lines: any[]; departments: any[]; assignees: any[]; items: any[]; total: number };
type Props = { onOpenSource?: (screenCode: string) => void };

const EMPTY_FILTERS: ArchiveFilters = { dateFrom: '', dateTo: '', search: '', status: '', lineId: '', departmentId: '', assigneeId: '', reason: '', type: '', templateId: '', downtimeLinkedOnly: false };
const sectionLabels: Record<ArchiveSectionKey, { label: string; description: string; empty: string }> = {
  tasks: { label: 'Заявки и простои', description: 'Заявки, реакции служб и связанные простои.', empty: 'За выбранный период заявок и простоев нет.' },
  checklists: { label: 'Чек-листы', description: 'Запуски, проверки и сохранённые результаты.', empty: 'За выбранный период чек-листов нет.' },
  okk: { label: 'ОКК', description: 'Контроль качества, решения и частичные выдачи.', empty: 'За выбранный период записей ОКК нет.' },
  returns: { label: 'Возвраты на производство', description: 'Возвраты, решения и частичные выдачи.', empty: 'За выбранный период возвратов нет.' },
  stock: { label: 'Некондиция', description: 'Складская некондиция и решения.', empty: 'За выбранный период некондиции нет.' },
  orders: { label: 'Заказы / Остатки', description: 'Движения остатков и заявки на заказ.', empty: 'За выбранный период движений и заявок нет.' },
  wash: { label: 'Мойка', description: 'Мойки, проблемы, контроль и оценки ОКК.', empty: 'За выбранный период моек нет.' },
  defrost: { label: 'Оттайка', description: 'Оттайка и обдув шоковых камер.', empty: 'За выбранный период событий нет.' },
  shiftLog: { label: 'Пересменка / Журнал', description: 'Записи журнала и сохранённые снимки передачи.', empty: 'За выбранный период записей пересменки нет.' },
  announcements: { label: 'Объявления', description: 'Объявления и история ознакомления.', empty: 'За выбранный период объявлений нет.' },
  attachments: { label: 'Файлы и вложения', description: 'Доступные фото, видео и документы.', empty: 'За выбранный период вложений нет.' },
};
const sourceLabels: Record<string, string> = {
  TASK: 'Заявка', CHECKLIST_RUN: 'Чек-лист', OKK_RECORD: 'ОКК', RETURN_RECORD: 'Возврат', STOCK_DEFECT: 'Некондиция',
  MINIMUM_STOCK_ITEM: 'Остаток', MINIMUM_STOCK_MOVEMENT: 'Движение остатка', ORDER_REQUEST: 'Заявка на заказ',
  WASH_SESSION: 'Мойка', DEFROST_EVENT: 'Оттайка', SHIFT_LOG: 'Пересменка', ANNOUNCEMENT: 'Объявление',
  CHAT_MESSAGE: 'Сообщение чата', QUANTITY_RELEASE_OPERATION: 'Частичная выдача',
};
const kindLabels: Record<string, string> = { PHOTO: 'Фото', VIDEO: 'Видео', AUDIO: 'Аудио', FILE: 'Файл' };
const statusLabels: Record<string, string> = {
  NEW: 'Новая', IN_PROGRESS: 'В работе', DONE: 'Готово', ACTIVE: 'Активно', PAUSED: 'На паузе', CLOSED: 'Закрыто',
  AUTO_CLOSED: 'Закрыто сменой', STARTED: 'Мойка идёт', REVIEW: 'На проверке', COMPLETED: 'Завершено', CANCELLED: 'Отменено',
  ARCHIVED: 'Архив', APPROVED: 'Принято', NEEDS_REWORK: 'Нужно доработать', REJECTED: 'Отклонено', BLOCKED: 'Заблокировано',
  DECISION: 'Ожидает решения', UNBLOCKED: 'Разблокировано', COMPLETION_PENDING: 'Ожидает завершения', ON_STOCK: 'На складе',
  ISSUED: 'Выдано', TAKE: 'Израсходовано', RESTOCK: 'Пополнено', ADJUSTMENT_RESERVED: 'Корректировка', NORMAL: 'Обычное',
  IMPORTANT: 'Важное', PARTIAL_RELEASE: 'Частичная выдача', ORDERED: 'Заказано', NOT_NEEDED: 'Не требуется',
  CLOSED_RESERVED: 'Закрыто', WORK: 'Работает', STOP: 'Остановлена', PAUSE: 'Простой', CLOSED_WITH_RUN: 'Закрыта вместе с запуском',
  PENDING: 'Ожидает', OK: 'Выполнено', ISSUE: 'Есть замечание', NA: 'Не применяется',
};
const statusOptions: Partial<Record<ArchiveSectionKey, string[]>> = {
  tasks: ['NEW', 'IN_PROGRESS', 'DONE'], checklists: ['CLOSED', 'AUTO_CLOSED'],
  okk: ['BLOCKED', 'DECISION', 'UNBLOCKED', 'COMPLETION_PENDING', 'COMPLETED', 'ARCHIVED', 'PARTIAL_RELEASE'],
  returns: ['ACTIVE', 'COMPLETED', 'ARCHIVED', 'PARTIAL_RELEASE'], stock: ['ON_STOCK', 'ISSUED', 'ARCHIVED'],
  orders: ['ACTIVE', 'ORDERED', 'NOT_NEEDED', 'CLOSED_RESERVED'], wash: ['IN_PROGRESS', 'REVIEW', 'DONE'],
  defrost: ['ACTIVE', 'COMPLETED', 'CANCELLED'], shiftLog: ['ACTIVE', 'CLOSED', 'ARCHIVED'], announcements: ['IMPORTANT', 'ARCHIVED'],
};
const downtimeTabs: Array<[DowntimeTab, string]> = [['summary', 'Сводка'], ['lines', 'По линиям'], ['departments', 'По отделам'], ['assignees', 'По исполнителям'], ['overdue', 'Просроченные'], ['items', 'Детали']];

function formatDate(value?: string | null) {
  if (!value) return 'Дата не указана';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
function formatSize(size: number) { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`; }
function previewAttachment(attachment: ArchiveDetail['attachments'][number]): AttachmentPreviewItem {
  return {
    id: attachment.id,
    kind: attachment.kind === 'PHOTO' || attachment.kind === 'VIDEO' || attachment.kind === 'AUDIO' ? attachment.kind : 'FILE',
    originalName: attachment.filename, mimeType: attachment.mimeType,
    sizeBytes: attachment.size, createdAt: attachment.createdAt,
  };
}
function statusLabel(status?: string | null) { return status ? statusLabels[status] ?? 'Состояние сохранено' : 'Без статуса'; }
function formatMinutes(value?: number | null) {
  if (value === null || value === undefined) return 'нет данных';
  const hours = Math.floor(value / 60); const minutes = value % 60;
  return hours ? (minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`) : `${minutes} мин`;
}
function cleanCsvValue(value: unknown) {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
function downloadBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
function dedupeBy<T>(rows: T[], keyOf: (row: T) => string) {
  const seen = new Set<string>();
  return rows.filter((row) => { const key = keyOf(row); if (seen.has(key)) return false; seen.add(key); return true; });
}
function filterCount(filters: ArchiveFilters) {
  return [filters.dateFrom, filters.dateTo, filters.search.trim(), filters.status, filters.lineId, filters.departmentId, filters.assigneeId, filters.reason, filters.type, filters.templateId, filters.downtimeLinkedOnly ? 'yes' : ''].filter(Boolean).length;
}

export function ArchiveScreen({ onOpenSource }: Props) {
  const [sections, setSections] = useState<ArchiveSection[]>([]);
  const [options, setOptions] = useState<ArchiveOptions>({ sections: [], departments: [], lines: [], checklistTemplates: [] });
  const [selectedSection, setSelectedSection] = useState<ArchiveSectionKey | null>(null);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [attachments, setAttachments] = useState<ArchiveAttachment[]>([]);
  const [metrics, setMetrics] = useState<ArchiveItemsResponse['metrics']>(null);
  const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [hasMore, setHasMore] = useState(false);
  const [draftFilters, setDraftFilters] = useState<ArchiveFilters>({ ...EMPTY_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState<ArchiveFilters>({ ...EMPTY_FILTERS });
  const [filtersOpen, setFiltersOpen] = useState(false); const [exportOpen, setExportOpen] = useState(false); const [summaryOpen, setSummaryOpen] = useState(false);
  const [detail, setDetail] = useState<ArchiveDetail | null>(null); const [attachmentDetail, setAttachmentDetail] = useState<ArchiveAttachment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false); const [loading, setLoading] = useState(false); const [loadingMore, setLoadingMore] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null); const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [printItems, setPrintItems] = useState<ArchiveItem[]>([]); const [printAttachments, setPrintAttachments] = useState<ArchiveAttachment[]>([]);
  const [downtimeTab, setDowntimeTab] = useState<DowntimeTab>('summary');
  const [downtimeOptions, setDowntimeOptions] = useState<DowntimeOptions>({ lines: [], departments: [], assignees: [], reasons: [] });
  const [downtimeData, setDowntimeData] = useState<DowntimeData>({ summary: null, lines: [], departments: [], assignees: [], items: [], total: 0 });
  const [downtimeError, setDowntimeError] = useState<string | null>(null); const [correctionTarget, setCorrectionTarget] = useState<any | null>(null);
  const listScrollRef = useRef(0);

  const currentMeta = selectedSection ? sectionLabels[selectedSection] : null;
  const activeFilterCount = filterCount(appliedFilters);
  const showLineFilter = Boolean(selectedSection && ['tasks', 'checklists', 'okk', 'wash', 'defrost'].includes(selectedSection));
  const showDepartmentFilter = Boolean(selectedSection && ['tasks', 'checklists', 'orders', 'shiftLog'].includes(selectedSection));

  useMobileBackLayer(Boolean(selectedSection) && !filtersOpen && !exportOpen && !summaryOpen && !detail && !attachmentDetail, () => {
    setSelectedSection(null); window.scrollTo({ top: 0 });
  }, 500);

  const buildParams = (section: ArchiveSectionKey, filters: ArchiveFilters, nextPage: number, pageSize = 24) => {
    const params = new URLSearchParams({ section, page: String(nextPage), pageSize: String(pageSize) });
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom); if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.search.trim()) params.set('search', filters.search.trim()); if (filters.lineId) params.set('lineId', filters.lineId);
    if (filters.departmentId) params.set('departmentId', filters.departmentId); if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
    if (filters.templateId) params.set('templateId', filters.templateId);
    if (filters.reason) params.set('downtimeReason', filters.reason); if (filters.downtimeLinkedOnly) params.set('downtimeLinkedOnly', 'true');
    if (filters.status) {
      if (section === 'announcements' && filters.status === 'IMPORTANT') params.set('type', 'IMPORTANT');
      else if (section === 'announcements' && filters.status === 'ARCHIVED') params.set('status', 'ARCHIVE');
      else params.set('status', filters.status);
    }
    if (filters.type) {
      if (section === 'attachments') params.set('type', filters.type);
      else if (section === 'tasks') params.set('taskType', filters.type);
      else params.set('type', filters.type);
    }
    return params.toString();
  };

  const loadContent = async (nextPage: number, append: boolean, filters = appliedFilters) => {
    if (!selectedSection) return;
    append ? setLoadingMore(true) : setLoading(true); setErrorText(null);
    try {
      const params = buildParams(selectedSection, filters, nextPage);
      if (selectedSection === 'attachments') {
        const response = await apiClient.get<ArchiveAttachmentsResponse>(`/archive/attachments?${params}`);
        setAttachments((current) => dedupeBy(append ? [...current, ...response.items] : response.items, (row) => row.id));
        setItems([]); setMetrics(null); setTotal(response.total); setHasMore(response.hasMore);
      } else {
        const response = await apiClient.get<ArchiveItemsResponse>(`/archive/items?${params}`);
        setItems((current) => dedupeBy(append ? [...current, ...response.items] : response.items, (row) => `${row.sourceType}:${row.id}`));
        setAttachments([]); setMetrics(response.metrics ?? null); setTotal(response.total); setHasMore(response.hasMore);
      }
      setPage(nextPage);
    } catch (error) {
      if (!append) { setItems([]); setAttachments([]); setTotal(0); setHasMore(false); }
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить архив.');
    } finally { setLoading(false); setLoadingMore(false); }
  };

  useEffect(() => {
    void apiClient.get<ArchiveOptions>('/archive/options').then((response) => { setOptions(response); setSections(response.sections); }).catch((error) => {
      setSections([]); setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить разделы архива.');
    });
  }, []);
  useEffect(() => { if (selectedSection) void loadContent(1, false, appliedFilters); }, [selectedSection, appliedFilters]);
  useEffect(() => {
    if (selectedSection !== 'tasks') return;
    void apiClient.get<DowntimeOptions>('/archive/downtime/options').then(setDowntimeOptions).catch(() => setDowntimeOptions({ lines: [], departments: [], assignees: [], reasons: [] }));
  }, [selectedSection]);

  const selectSection = (key: ArchiveSectionKey) => {
    setDraftFilters({ ...EMPTY_FILTERS }); setAppliedFilters({ ...EMPTY_FILTERS }); setItems([]); setAttachments([]);
    setDetail(null); setAttachmentDetail(null); setSaveNotice(null); setSelectedSection(key); window.scrollTo({ top: 0 });
  };
  const goHome = () => { setSelectedSection(null); setDetail(null); setAttachmentDetail(null); setSaveNotice(null); window.scrollTo({ top: 0 }); };
  const applyFilters = () => { setAppliedFilters({ ...draftFilters }); setFiltersOpen(false); setSaveNotice(null); };
  const resetFilters = () => { const empty = { ...EMPTY_FILTERS }; setDraftFilters(empty); setAppliedFilters(empty); setFiltersOpen(false); setSaveNotice(null); };
  const submitSearch = (event: React.FormEvent) => { event.preventDefault(); setAppliedFilters({ ...draftFilters }); };

  const activeFilterSummary = useMemo(() => {
    const labels: string[] = [];
    if (appliedFilters.dateFrom || appliedFilters.dateTo) labels.push(`${appliedFilters.dateFrom || 'начало'} — ${appliedFilters.dateTo || 'сегодня'}`);
    if (appliedFilters.lineId) labels.push(`Линия: ${options.lines.find((line) => line.id === appliedFilters.lineId)?.name ?? 'выбрана'}`);
    if (appliedFilters.departmentId) labels.push(`Отдел: ${options.departments.find((department) => department.id === appliedFilters.departmentId)?.name ?? 'выбран'}`);
    if (appliedFilters.templateId) labels.push(`Чек-лист: ${options.checklistTemplates.find((template) => template.id === appliedFilters.templateId)?.name ?? 'выбран'}`);
    if (appliedFilters.status) labels.push(statusLabel(appliedFilters.status));
    if (appliedFilters.type) labels.push(appliedFilters.type === 'URGENT' ? 'Срочная' : appliedFilters.type === 'LONG' ? 'Долгая' : kindLabels[appliedFilters.type] ?? statusLabel(appliedFilters.type));
    if (appliedFilters.search.trim()) labels.push(`Поиск: ${appliedFilters.search.trim()}`);
    return labels;
  }, [appliedFilters, options]);

  const openItemDetail = async (item: ArchiveItem) => {
    if (!selectedSection) return;
    listScrollRef.current = window.scrollY; setDetailLoading(true); setErrorText(null);
    try { setDetail(await apiClient.get<ArchiveDetail>(`/archive/detail/${selectedSection}/${encodeURIComponent(item.sourceType)}/${encodeURIComponent(item.id)}`)); }
    catch (error) { setErrorText(error instanceof Error ? error.message : 'Не удалось открыть запись архива.'); }
    finally { setDetailLoading(false); }
  };
  const closeDetail = () => { setDetail(null); setAttachmentDetail(null); requestAnimationFrame(() => window.scrollTo({ top: listScrollRef.current })); };
  const openSource = (route?: string | null) => { if (!route || !onOpenSource) return; setDetail(null); setAttachmentDetail(null); onOpenSource(route); };

  const fetchAllRows = async () => {
    if (!selectedSection) return { items: [] as ArchiveItem[], attachments: [] as ArchiveAttachment[] };
    const allItems: ArchiveItem[] = []; const allAttachments: ArchiveAttachment[] = [];
    for (let nextPage = 1; nextPage <= 100; nextPage += 1) {
      const params = buildParams(selectedSection, appliedFilters, nextPage, 100);
      if (selectedSection === 'attachments') {
        const response = await apiClient.get<ArchiveAttachmentsResponse>(`/archive/attachments?${params}`); allAttachments.push(...response.items); if (!response.hasMore) break;
      } else {
        const response = await apiClient.get<ArchiveItemsResponse>(`/archive/items?${params}`); allItems.push(...response.items); if (!response.hasMore) break;
      }
    }
    return { items: dedupeBy(allItems, (row) => `${row.sourceType}:${row.id}`), attachments: dedupeBy(allAttachments, (row) => row.id) };
  };

  const exportCurrentCsv = async () => {
    setLoading(true);
    try {
      const rows = await fetchAllRows();
      const exportRows = selectedSection === 'attachments'
        ? rows.attachments.map((row) => [formatDate(row.createdAt), row.filename, kindLabels[row.kind] ?? row.kind, formatSize(row.size), row.sourceTitle, row.author])
        : rows.items.map((row) => [formatDate(row.date), currentMeta?.label ?? '', row.title, statusLabel(row.status), row.lineName ?? '', row.departmentName ?? '', row.authorName ?? '', row.summary ?? '']);
      const headers = selectedSection === 'attachments' ? ['Дата', 'Файл', 'Тип', 'Размер', 'Источник', 'Автор'] : ['Дата', 'Раздел', 'Название', 'Статус', 'Линия', 'Отдел', 'Автор', 'Описание'];
      if (!exportRows.length) { setSaveNotice('В текущей выборке нет строк для выгрузки.'); return; }
      const lines = [headers, ...exportRows].map((row) => row.map(cleanCsvValue).join(';'));
      downloadTextFile(`архив-${currentMeta?.label ?? 'выборка'}-${factoryDateKey()}.csv`, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8');
      setSaveNotice(`CSV сформирован: ${exportRows.length} записей.`); setExportOpen(false);
    } catch (error) { setSaveNotice(error instanceof Error ? error.message : 'Не удалось сформировать CSV.'); }
    finally { setLoading(false); }
  };
  const exportCurrentXlsx = async () => {
    if (!selectedSection || exportingExcel) return;
    setExportingExcel(true); setSaveNotice(null);
    try {
      const params = buildParams(selectedSection, appliedFilters, 1, 100);
      const response = await apiClient.downloadBlob(`/archive/export/xlsx?${params}`);
      downloadBlobFile(response.filename, response.blob);
      setSaveNotice(`Excel сформирован: ${response.primaryCount ?? total} записей.`); setExportOpen(false);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : 'Не удалось сформировать Excel. Повторите позже.');
    } finally { setExportingExcel(false); }
  };
  const printCurrentArchive = async () => {
    setLoading(true);
    try {
      const rows = await fetchAllRows(); setPrintItems(rows.items); setPrintAttachments(rows.attachments);
      setSaveNotice(`Подготовлено к печати: ${rows.items.length + rows.attachments.length} записей.`); setExportOpen(false); setTimeout(() => window.print(), 50);
    } catch (error) { setSaveNotice(error instanceof Error ? error.message : 'Не удалось подготовить печать.'); }
    finally { setLoading(false); }
  };

  const loadDowntimeAnalytics = async () => {
    if (selectedSection !== 'tasks') return; setDowntimeError(null);
    try {
      const params = buildParams('tasks', appliedFilters, 1, 100);
      const [summary, lines, departments, assignees, list] = await Promise.all([
        apiClient.get<any>(`/archive/downtime/summary?${params}`), apiClient.get<any[]>(`/archive/downtime/by-lines?${params}`),
        apiClient.get<any[]>(`/archive/downtime/by-departments?${params}`), apiClient.get<any[]>(`/archive/downtime/by-assignees?${params}`),
        apiClient.get<{ items: any[]; total: number }>(`/archive/downtime/items?${params}`),
      ]);
      setDowntimeData({ summary, lines, departments, assignees, items: list.items, total: list.total });
    } catch (error) { setDowntimeError(error instanceof Error ? error.message : 'Не удалось загрузить сводку простоев.'); }
  };
  const openSummary = () => { setSummaryOpen(true); if (selectedSection === 'tasks') void loadDowntimeAnalytics(); };
  const submitCorrection = async (values: Record<string, string | boolean>) => {
    if (!correctionTarget) return;
    await apiClient.post(`/archive/downtime/${correctionTarget.id}/correction`, { correctedStartAt: values.correctedStartAt, correctedEndAt: values.correctedEndAt, comment: values.comment });
    setCorrectionTarget(null); await loadDowntimeAnalytics();
  };

  const renderFilterFields = () => selectedSection ? (
    <div className="archive-filter-sheet-form">
      <div className="form-grid compact-grid premium-deep-form-grid">
        <label><span>Дата с</span><input type="date" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters((value) => ({ ...value, dateFrom: event.target.value }))} /></label>
        <label><span>Дата по</span><input type="date" value={draftFilters.dateTo} onChange={(event) => setDraftFilters((value) => ({ ...value, dateTo: event.target.value }))} /></label>
        <label><span>Поиск</span><input value={draftFilters.search} onChange={(event) => setDraftFilters((value) => ({ ...value, search: event.target.value }))} placeholder="Название, линия, комментарий" /></label>
        {showLineFilter ? (
          <label><span>Линия</span><select value={draftFilters.lineId} onChange={(event) => setDraftFilters((value) => ({ ...value, lineId: event.target.value }))}>
            <option value="">Все линии</option>{options.lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
          </select></label>
        ) : null}
        {showDepartmentFilter ? (
          <label><span>Отдел</span><select value={draftFilters.departmentId} onChange={(event) => setDraftFilters((value) => ({ ...value, departmentId: event.target.value }))}>
            <option value="">Все доступные отделы</option>{options.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select></label>
        ) : null}
        {selectedSection === 'checklists' ? (
          <label><span>Чек-лист</span><select value={draftFilters.templateId} onChange={(event) => setDraftFilters((value) => ({ ...value, templateId: event.target.value }))}>
            <option value="">Все чек-листы</option>{options.checklistTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select></label>
        ) : null}
        {(statusOptions[selectedSection]?.length ?? 0) > 0 ? (
          <label><span>Статус</span><select value={draftFilters.status} onChange={(event) => setDraftFilters((value) => ({ ...value, status: event.target.value }))}>
            <option value="">Все статусы</option>{statusOptions[selectedSection]?.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select></label>
        ) : null}
        {selectedSection === 'tasks' ? (
          <>
            <label><span>Тип заявки</span><select value={draftFilters.type} onChange={(event) => setDraftFilters((value) => ({ ...value, type: event.target.value }))}><option value="">Все типы</option><option value="URGENT">Срочная</option><option value="LONG">Долгая</option></select></label>
            <label><span>Исполнитель</span><select value={draftFilters.assigneeId} onChange={(event) => setDraftFilters((value) => ({ ...value, assigneeId: event.target.value }))}><option value="">Все исполнители</option>{downtimeOptions.assignees.map((assignee) => <option key={assignee.userId} value={assignee.userId}>{assignee.displayName ?? 'Сотрудник'}{assignee.departmentName ? ` · ${assignee.departmentName}` : ''}</option>)}</select></label>
            <label><span>Причина простоя</span><select value={draftFilters.reason} onChange={(event) => setDraftFilters((value) => ({ ...value, reason: event.target.value }))}><option value="">Все причины</option>{downtimeOptions.reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label>
            <label className="checkbox-label"><input type="checkbox" checked={draftFilters.downtimeLinkedOnly} onChange={(event) => setDraftFilters((value) => ({ ...value, downtimeLinkedOnly: event.target.checked }))} /><span>Только связанные с простоем</span></label>
          </>
        ) : null}
        {selectedSection === 'orders' ? (
          <label><span>Тип движения</span><select value={draftFilters.type} onChange={(event) => setDraftFilters((value) => ({ ...value, type: event.target.value }))}><option value="">Движения и заявки</option><option value="TAKE">Израсходовано</option><option value="RESTOCK">Пополнено</option></select></label>
        ) : null}
        {selectedSection === 'attachments' ? (
          <label><span>Тип файла</span><select value={draftFilters.type} onChange={(event) => setDraftFilters((value) => ({ ...value, type: event.target.value }))}><option value="">Все файлы</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        ) : null}
      </div>
    </div>
  ) : null;

  const renderDowntimeSummary = () => {
    if (downtimeError) return <div className="empty-state error-state">{downtimeError}</div>;
    if (!downtimeData.summary) return <div className="empty-state compact">Загрузка сводки...</div>;
    const rows = downtimeTab === 'lines' ? downtimeData.lines
      : downtimeTab === 'departments' ? downtimeData.departments
        : downtimeTab === 'assignees' ? downtimeData.assignees
          : downtimeData.items.filter((row) => downtimeTab === 'items' || row.overdueLong);
    return (
      <div className="downtime-analytics archive-secondary-summary">
        <div className="tab-row archive-summary-tabs">{downtimeTabs.map(([key, label]) => <button className={`secondary-button ${downtimeTab === key ? 'active' : ''}`} key={key} type="button" onClick={() => setDowntimeTab(key)}>{label}</button>)}</div>
        {downtimeTab === 'summary' ? (
          <>
            <div className="metric-grid compact-metrics">
              <div className="metric-card"><div className="metric-label">Простоев</div><div className="metric-value">{downtimeData.summary.downtime.count}</div></div>
              <div className="metric-card"><div className="metric-label">Общая длительность</div><div className="metric-value">{formatMinutes(downtimeData.summary.downtime.totalMinutes)}</div></div>
              <div className="metric-card"><div className="metric-label">Средний простой</div><div className="metric-value">{formatMinutes(downtimeData.summary.downtime.averageMinutes)}</div></div>
              <div className="metric-card"><div className="metric-label">P90 простоя</div><div className="metric-value">{formatMinutes(downtimeData.summary.downtime.p90Minutes)}</div></div>
              <div className="metric-card"><div className="metric-label">Заявок</div><div className="metric-value">{downtimeData.summary.tasks.total}</div></div>
              <div className="metric-card"><div className="metric-label">Открыты на конец</div><div className="metric-value">{downtimeData.summary.tasks.openAtPeriodEnd}</div></div>
            </div>
            <div className="archive-two-column">
              <div className="card"><h4>Проблемные линии</h4>{(downtimeData.summary.topLinesByDuration ?? []).map((line: any) => <div className="archive-row" key={line.lineId}><span>{line.lineName}</span><strong>{formatMinutes(line.totalMinutes)}</strong></div>)}</div>
              <div className="card"><h4>Причины</h4>{(downtimeData.summary.topReasons ?? []).map((reason: any) => <div className="archive-row" key={reason.reason}><span>{reason.label}</span><strong>{formatMinutes(reason.totalMinutes)}</strong></div>)}</div>
            </div>
          </>
        ) : (
          <div className="section-stack">{rows.map((row: any) => (
            <article className="card archive-summary-row" key={`${row.kind ?? downtimeTab}:${row.id ?? row.lineId ?? row.departmentId ?? row.userId}`}>
              <strong>{row.title ?? row.lineName ?? row.departmentName ?? row.displayName ?? 'Запись'}</strong>
              <div className="line-meta">
                {row.date ? <span>{formatDate(row.date)}</span> : null}
                {row.totalMinutes !== undefined ? <span>{formatMinutes(row.totalMinutes)}</span> : null}
                {row.durationMinutes !== undefined ? <span>{formatMinutes(row.durationMinutes)}</span> : null}
                {row.tasksTotal !== undefined ? <span>Заявок: {row.tasksTotal}</span> : null}
                {row.status ? <span>{statusLabel(row.status)}</span> : null}
              </div>
              {row.kind === 'downtime' && row.canCorrect ? <button className="secondary-button" type="button" onClick={() => setCorrectionTarget(row)}>Уточнить время</button> : null}
            </article>
          ))}{!rows.length ? <div className="empty-state compact">Данных по выбранному срезу нет.</div> : null}</div>
        )}
      </div>
    );
  };

  const detailValue = (field: ArchiveDetailField) => {
    if (field.value === null || field.value === '') return 'Не указано';
    if (field.kind === 'datetime') return formatDate(String(field.value));
    if (field.kind === 'status') return statusLabel(String(field.value));
    if (typeof field.value === 'boolean') return field.value ? 'Да' : 'Нет';
    return String(field.value);
  };

  const displayedCount = selectedSection === 'attachments' ? attachments.length : items.length;

  return (
    <section className="screen-panel archive-screen">
      {!selectedSection ? (
        <>
          <PremiumSectionHeader title="Архив" subtitle="История рабочих разделов в одном месте." />
          {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
          {!sections.length && !errorText ? <div className="empty-state">У вас нет доступных разделов архива.</div> : null}
          <nav aria-label="Разделы архива" className="archive-category-list">
            {sections.map((section) => {
              const meta = sectionLabels[section.key];
              return <button className="archive-category-row" data-archive-category={section.key} key={section.key} onClick={() => selectSection(section.key)} type="button"><span><strong>{meta?.label ?? section.label}</strong><small>{meta?.description ?? section.description}</small></span><b aria-hidden="true">›</b></button>;
            })}
          </nav>
        </>
      ) : (
        <div className="archive-category-view">
          <header className="archive-category-header">
            <button aria-label="Назад к разделам архива" className="secondary-button compact-action archive-back-button" onClick={goHome} type="button">‹</button>
            <div><p className="eyebrow">Архив</p><h2>{currentMeta?.label}</h2><p>{currentMeta?.description}</p></div>
          </header>

          <div className="archive-compact-toolbar">
            <form className="archive-search-form" onSubmit={submitSearch}>
              <input aria-label="Поиск в архиве" value={draftFilters.search} onChange={(event) => setDraftFilters((value) => ({ ...value, search: event.target.value }))} placeholder="Поиск" />
              <button className="secondary-button compact-action" type="submit">Найти</button>
            </form>
            <button className="secondary-button archive-toolbar-button" onClick={() => setFiltersOpen(true)} type="button">Фильтры{activeFilterCount ? ` · ${activeFilterCount}` : ''}</button>
            {(selectedSection === 'tasks' || selectedSection === 'orders') ? <button className="secondary-button archive-toolbar-button" onClick={openSummary} type="button">Сводка</button> : null}
            <button aria-label="Экспорт архива" className="secondary-button compact-action archive-more-button" onClick={() => setExportOpen(true)} type="button">•••</button>
          </div>

          {activeFilterCount ? (
            <div className="archive-active-filters"><div>{activeFilterSummary.slice(0, 3).map((label) => <span className="tag" key={label}>{label}</span>)}{activeFilterCount > 3 ? <span className="tag">Ещё: {activeFilterCount - 3}</span> : null}</div><button className="text-button" onClick={resetFilters} type="button">Сбросить</button></div>
          ) : null}
          {saveNotice ? <div className="empty-state compact success-state archive-save-notice">{saveNotice}</div> : null}
          {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
          {loading ? <div className="empty-state compact">Загрузка записей...</div> : null}

          {!loading && !errorText && displayedCount === 0 ? (
            <div className="empty-state archive-empty-state"><strong>{currentMeta?.empty}</strong>{activeFilterCount ? <button className="secondary-button" onClick={resetFilters} type="button">Сбросить фильтры</button> : null}</div>
          ) : null}

          {selectedSection !== 'attachments' ? (
            <div className="archive-record-list" data-archive-record-list>
              {items.map((item) => (
                <article className="archive-record-row" key={`${item.sourceType}:${item.id}`}>
                  <button className="archive-record-open" disabled={detailLoading} onClick={() => void openItemDetail(item)} type="button">
                    <span className="archive-record-main"><strong>{item.title}</strong><small>{[item.lineName, item.departmentName, formatDate(item.date)].filter(Boolean).join(' · ')}</small></span>
                    <span className="archive-record-side"><em className={`status-badge ${String(item.status ?? '').toLowerCase()}`}>{statusLabel(item.status)}</em>{item.hasAttachments ? <small>Есть файлы</small> : null}<b aria-hidden="true">›</b></span>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="archive-record-list" data-archive-record-list>
              {attachments.map((attachment) => (
                <article className="archive-record-row" key={attachment.id}>
                  <button className="archive-record-open" onClick={() => { listScrollRef.current = window.scrollY; setAttachmentDetail(attachment); }} type="button">
                    <span className="archive-record-main"><strong>{attachment.filename}</strong><small>{attachment.sourceTitle} · {formatDate(attachment.createdAt)}</small></span>
                    <span className="archive-record-side"><em className="status-badge info">{kindLabels[attachment.kind] ?? 'Файл'}</em><small>{formatSize(attachment.size)}</small><b aria-hidden="true">›</b></span>
                  </button>
                </article>
              ))}
            </div>
          )}

          {displayedCount ? <div className="archive-list-footer"><span>{hasMore ? `Показано ${displayedCount}, есть ещё` : `Показано ${displayedCount} из ${total}`}</span>{hasMore ? <button className="secondary-button" disabled={loadingMore} onClick={() => void loadContent(page + 1, true)} type="button">{loadingMore ? 'Загрузка...' : 'Показать ещё'}</button> : null}</div> : null}
        </div>
      )}

      <PremiumSheet open={filtersOpen} title={`Фильтры · ${currentMeta?.label ?? 'Архив'}`} description="Показываются только поля, применимые к этому разделу." onClose={() => { setDraftFilters({ ...appliedFilters }); setFiltersOpen(false); }} footer={<div className="premium-action-row"><button className="secondary-button" onClick={resetFilters} type="button">Сбросить</button><button className="primary-button" onClick={applyFilters} type="button">Показать записи</button></div>} className="archive-filter-sheet">
        {renderFilterFields()}
      </PremiumSheet>

      <PremiumSheet open={exportOpen} title="Экспорт выборки" description="Категория, завод, период, поиск и фильтры сохраняются без изменений." onClose={() => setExportOpen(false)} className="archive-export-sheet">
        <div className="archive-export-actions">
          <PremiumActionItem label={exportingExcel ? 'Формируем Excel…' : 'Excel (.xlsx)'} description="Один человекочитаемый файл со всей выборкой" icon="↓" tone="gold" disabled={loading || exportingExcel} onClick={() => void exportCurrentXlsx()} />
          <PremiumActionItem label="Печать / PDF" description="Человеческие подписи и активные фильтры" icon="▤" tone="blue" disabled={loading || exportingExcel} onClick={() => void printCurrentArchive()} />
          <PremiumActionItem label="CSV (для интеграций)" description="Вторичный табличный формат UTF-8" icon="↓" tone="neutral" disabled={loading || exportingExcel} onClick={() => void exportCurrentCsv()} />
        </div>
      </PremiumSheet>

      <PremiumSheet open={summaryOpen} title={`Сводка · ${currentMeta?.label ?? ''}`} description="Вторичный аналитический срез; записи архива остаются основным экраном." onClose={() => setSummaryOpen(false)} className="archive-summary-sheet">
        {selectedSection === 'tasks' ? renderDowntimeSummary() : null}
        {selectedSection === 'orders' && metrics ? <div className="metric-grid compact-metrics"><div className="metric-card"><div className="metric-label">Израсходовано</div><div className="metric-value">{metrics.takeQuantity}</div></div><div className="metric-card"><div className="metric-label">Пополнено</div><div className="metric-value">{metrics.restockQuantity}</div></div></div> : null}
      </PremiumSheet>

      <PremiumSheet open={Boolean(detail)} title={detail?.title ?? 'Запись архива'} eyebrow={detail ? `${sourceLabels[detail.sourceType] ?? 'История'} · ${formatDate(detail.date)}` : undefined} description={detail ? statusLabel(detail.status) : undefined} onClose={closeDetail} className="archive-detail-sheet" footer={detail?.sourceRoute ? <button className="secondary-button" onClick={() => openSource(detail.sourceRoute)} type="button">Открыть исходный раздел</button> : undefined}>
        {detail?.sections.map((section, sectionIndex) => <section className="archive-detail-section" key={`${section.title}:${sectionIndex}`}><h4>{section.title}</h4>{section.fields?.length ? <dl>{section.fields.map((field, fieldIndex) => <div key={`${field.label}:${fieldIndex}`}><dt>{field.label}</dt><dd>{detailValue(field)}</dd></div>)}</dl> : null}{section.entries?.length ? <div className="archive-detail-timeline">{section.entries.map((entry, entryIndex) => <article key={`${entry.title}:${entryIndex}`}><header><strong>{entry.title}</strong>{entry.status ? <span className="status-badge">{statusLabel(entry.status)}</span> : null}</header><small>{[entry.actor, entry.date ? formatDate(entry.date) : null].filter(Boolean).join(' · ')}</small>{entry.text ? <p>{entry.text}</p> : null}{entry.fields?.length ? <dl>{entry.fields.map((field, fieldIndex) => <div key={`${field.label}:${fieldIndex}`}><dt>{field.label}</dt><dd>{detailValue(field)}</dd></div>)}</dl> : null}{entry.attachmentIds?.length ? <div>{detail.attachments.filter((attachment) => entry.attachmentIds?.includes(attachment.id)).map((attachment) => <div key={attachment.id}><AttachmentPreviewList attachments={[previewAttachment(attachment)]} showTitle={false} /><small>{attachment.author} · {formatDate(attachment.createdAt)}</small></div>)}</div> : null}</article>)}</div> : section.emptyText ? <p className="empty-state compact">{section.emptyText}</p> : null}</section>)}
        {detail?.attachments.filter((attachment) => !detail.sections.some((section) => section.entries?.some((entry) => entry.attachmentIds?.includes(attachment.id)))).length ? <section className="archive-detail-section"><h4>Вложения</h4>{detail.attachments.filter((attachment) => !detail.sections.some((section) => section.entries?.some((entry) => entry.attachmentIds?.includes(attachment.id)))).map((attachment) => <div key={attachment.id}><AttachmentPreviewList attachments={[previewAttachment(attachment)]} showTitle={false} /><small>{attachment.author} · {formatDate(attachment.createdAt)}</small></div>)}</section> : null}
      </PremiumSheet>

      <PremiumSheet open={Boolean(attachmentDetail)} title={attachmentDetail?.filename ?? 'Вложение'} description={attachmentDetail?.sourceTitle} onClose={closeDetail} className="archive-detail-sheet" footer={attachmentDetail?.sourceRoute ? <button className="secondary-button" onClick={() => openSource(attachmentDetail.sourceRoute)} type="button">Открыть источник</button> : undefined}>
        {attachmentDetail ? <AttachmentPreviewList key={attachmentDetail.id} attachments={[previewAttachment(attachmentDetail)]} showTitle={false} /> : null}
        {attachmentDetail ? <section className="archive-detail-section"><h4>Сведения о файле</h4><dl><div><dt>Тип</dt><dd>{kindLabels[attachmentDetail.kind] ?? 'Файл'}</dd></div><div><dt>Размер</dt><dd>{formatSize(attachmentDetail.size)}</dd></div><div><dt>Автор</dt><dd>{attachmentDetail.author}</dd></div><div><dt>Добавлено</dt><dd>{formatDate(attachmentDetail.createdAt)}</dd></div><div><dt>Источник</dt><dd>{sourceLabels[attachmentDetail.sourceType] ?? 'Рабочий раздел'}</dd></div></dl></section> : null}
      </PremiumSheet>

      {correctionTarget ? <ActionModal title="Уточнить время простоя" description={`${correctionTarget.title}. Старое и новое значение сохранятся в аудите.`} fields={[{ name: 'correctedStartAt', label: 'Фактическое начало', type: 'datetime-local', required: true }, { name: 'correctedEndAt', label: 'Фактическое окончание', type: 'datetime-local', required: true }, { name: 'comment', label: 'Комментарий', type: 'textarea', required: true }]} confirmLabel="Сохранить уточнение" onCancel={() => setCorrectionTarget(null)} onSubmit={submitCorrection} /> : null}

      <section className="archive-print-view" aria-hidden="true"><h1>{currentMeta?.label ?? 'Архив'}</h1><p>{activeFilterSummary.join(' · ') || 'Без дополнительных фильтров'}</p>{printItems.map((item) => <article key={`${item.sourceType}:${item.id}`}><h2>{item.title}</h2><p>{formatDate(item.date)} · {statusLabel(item.status)}</p><p>{[item.lineName, item.departmentName, item.authorName].filter(Boolean).join(' · ')}</p>{item.summary ? <p>{item.summary}</p> : null}</article>)}{printAttachments.map((attachment) => <article key={attachment.id}><h2>{attachment.filename}</h2><p>{formatDate(attachment.createdAt)} · {attachment.sourceTitle} · {attachment.author}</p></article>)}</section>
    </section>
  );
}
