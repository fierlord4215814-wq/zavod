const SENSITIVE_KEY = /password|token|secret|database_url|storagepath|credential/i;
const IDENTIFIER_KEY = /(^id$|id$|ids$|operationid|entityid|factoryid|userid|lineid|departmentid|assigneeuserid|recipientids)/i;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

export type AuditPresentationRow = {
  label: string;
  value?: string;
  before?: string;
  after?: string;
};

export type AuditPresentation = {
  summary: string[];
  rows: AuditPresentationRow[];
};

const KEY_LABELS: Record<string, string> = {
  actionLabel: 'Действие',
  acknowledged: 'Ознакомились',
  archived: 'Перенесено в архив',
  article: 'Артикул',
  comment: 'Комментарий',
  dateFrom: 'Начало периода',
  dateTo: 'Конец периода',
  deadlineAt: 'Срок',
  downtimeReason: 'Причина простоя',
  defectQuantity: 'Количество брака',
  description: 'Описание',
  effectiveAt: 'Фактическое время',
  effectiveTimeMode: 'Источник времени',
  frequencyIntervalUnit: 'Единица интервала',
  frequencyIntervalValue: 'Интервал',
  frequencyRule: 'Периодичность',
  firstName: 'Имя',
  includeArchive: 'Архив',
  isGuest: 'Гостевой доступ',
  kind: 'Тип',
  lastName: 'Фамилия',
  method: 'Действие',
  mimeType: 'Тип файла',
  middleName: 'Отчество',
  newStatus: 'Новый статус',
  name: 'Наименование',
  oldStatus: 'Предыдущий статус',
  path: 'Раздел',
  priority: 'Важность',
  productName: 'Продукция',
  quantity: 'Количество',
  quantityAfter: 'Осталось',
  quantityBefore: 'Было',
  reason: 'Причина',
  mismatchReason: 'Причина несоответствия',
  recordedAt: 'Записано',
  releasedAssignments: 'Завершено назначений',
  releasedQuantity: 'Выдано',
  schemaVersion: 'Версия схемы',
  shiftDate: 'Дата смены',
  shiftType: 'Смена',
  sizeBytes: 'Размер файла',
  startedOnComplete: 'Взята при завершении',
  status: 'Статус',
  total: 'Всего',
  type: 'Тип',
  unit: 'Единица',
  visibleFrom: 'Начало показа',
  visibleUntil: 'Срок действия',
  warnings: 'Предупреждения',
};

const VALUE_LABELS: Record<string, string> = {
  ACTIVE: 'Активно',
  ARCHIVED: 'В архиве',
  AUTO_CLOSED: 'Закрыто автоматически',
  BLOCKED: 'Заблокировано',
  CANCELLED: 'Отменено',
  CLOSED: 'Закрыто',
  COMPLETED: 'Завершено',
  CUSTOM: 'Уточнено вручную',
  DAY: 'День',
  DONE: 'Завершено',
  IN_PROGRESS: 'В работе',
  LONG: 'Долгая',
  MANUAL: 'Закрыто вручную',
  MANUAL_EARLY: 'Закрыто вручную досрочно',
  NEW: 'Новое',
  NIGHT: 'Ночь',
  NO_STAFF: 'Не хватает людей',
  OTHER: 'Другое',
  PAUSE: 'Простой',
  RESOLVED: 'Решено',
  SERVER_NOW: 'Время сервера',
  SHIFT_END: 'Закрыто окончанием смены',
  STOP: 'Остановлена',
  TECHNICAL: 'Техническая причина',
  TECHNOLOGY: 'Технологическая причина',
  TECHNOLOGICAL: 'Технологическая причина',
  QUALITY: 'Контроль качества',
  PEOPLE: 'Не хватает людей',
  WAREHOUSE: 'Ожидание склада',
  WAITING_DECISION: 'Ожидание решения',
  URGENT: 'Срочная',
  WASH: 'Мойка',
  WORK: 'Работает',
};

const READINESS_STATUS_LABELS: Record<string, string> = {
  blocker: 'Есть блокирующие замечания',
  warning: 'Требует проверки',
  ready: 'Готово',
  ok: 'В порядке',
};

export function presentAuditDetails(details: unknown): AuditPresentation {
  if (!isRecord(details)) return { summary: [], rows: [] };

  const rows: AuditPresentationRow[] = [];
  const consumed = new Set<string>();

  addPair(rows, consumed, details, 'oldStatus', 'newStatus', 'Статус');
  addPair(rows, consumed, details, 'quantityBefore', 'quantityAfter', 'Количество');
  addPair(rows, consumed, details, 'oldValue', 'newValue', 'Значение');

  for (const [key, value] of Object.entries(details)) {
    if (consumed.has(key) || shouldHideKey(key) || key === 'actionLabel') continue;
    const label = KEY_LABELS[key];
    if (!label) continue;
    const formatted = formatAuditValue(key, value);
    if (!formatted) continue;
    rows.push({ label, value: formatted });
    if (rows.length >= 10) break;
  }

  const summary = rows.slice(0, 3).map((row) => {
    if (row.before !== undefined || row.after !== undefined) {
      return `${row.label}: ${row.before ?? 'не задано'} → ${row.after ?? 'не задано'}`;
    }
    return `${row.label}: ${row.value ?? 'не задано'}`;
  });
  return { summary, rows };
}

export function maskAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskAuditDetails);
  if (typeof value === 'string') {
    if (/password|token|secret|database_url|storagepath/i.test(value)) return '[скрыто]';
    return value.replace(new RegExp(UUID_PATTERN.source, 'gi'), 'идентификатор скрыт');
  }
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = '[скрыто]';
      continue;
    }
    result[key] = maskAuditDetails(nested);
  }
  return result;
}

function addPair(
  rows: AuditPresentationRow[],
  consumed: Set<string>,
  details: Record<string, unknown>,
  beforeKey: string,
  afterKey: string,
  fallbackLabel: string,
) {
  if (!(beforeKey in details) && !(afterKey in details)) return;
  consumed.add(beforeKey);
  consumed.add(afterKey);
  const before = details[beforeKey];
  const after = details[afterKey];

  if (isRecord(before) || isRecord(after)) {
    const beforeRecord = isRecord(before) ? before : {};
    const afterRecord = isRecord(after) ? after : {};
    const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])];
    for (const key of keys) {
      if (shouldHideKey(key) || !KEY_LABELS[key]) continue;
      const beforeValue = formatAuditValue(key, beforeRecord[key]);
      const afterValue = formatAuditValue(key, afterRecord[key]);
      if (beforeValue === afterValue || (!beforeValue && !afterValue)) continue;
      rows.push({ label: KEY_LABELS[key], before: beforeValue || 'не задано', after: afterValue || 'не задано' });
      if (rows.length >= 8) return;
    }
    return;
  }

  const beforeValue = formatAuditValue(beforeKey, before);
  const afterValue = formatAuditValue(afterKey, after);
  if (beforeValue || afterValue) {
    rows.push({ label: fallbackLabel, before: beforeValue || 'не задано', after: afterValue || 'не задано' });
  }
}

function formatAuditValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (Array.isArray(value)) return value.length ? `Выбрано: ${value.length}` : 'Не выбрано';
  if (isRecord(value)) return 'Изменено';

  const raw = String(value).trim();
  if (!raw || UUID_PATTERN.test(raw) || IDENTIFIER_KEY.test(key)) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    }
  }
  if (key === 'path') return routeLabel(raw);
  if (key === 'method') return methodLabel(raw);
  if (['status', 'oldStatus', 'newStatus'].includes(key) && READINESS_STATUS_LABELS[raw]) {
    return READINESS_STATUS_LABELS[raw];
  }
  if (VALUE_LABELS[raw]) return VALUE_LABELS[raw];
  if (/^[A-Z_]{2,}$/.test(raw)) return 'Изменено';
  if (/[a-z]+[A-Z][A-Za-z]+/.test(raw)) return 'Изменено';
  return raw.length > 140 ? `${raw.slice(0, 139).trim()}…` : raw;
}

function routeLabel(value: string) {
  const route = value.split('?')[0];
  if (route.startsWith('/ops/operations')) return 'Операционная аналитика';
  if (route.startsWith('/ops/audit')) return 'Аудит';
  if (route.startsWith('/admin')) return 'Администрирование';
  if (route.startsWith('/archive')) return 'Архив';
  if (route.startsWith('/checklists')) return 'Чек-листы';
  if (route.startsWith('/announcements')) return 'Объявления';
  if (route.startsWith('/chats')) return 'Чаты';
  if (route.startsWith('/tasks')) return 'Заявки';
  if (route.startsWith('/wash')) return 'Мойка';
  return 'Раздел системы';
}

function methodLabel(value: string) {
  return ({ GET: 'Просмотр', POST: 'Создание', PATCH: 'Изменение', PUT: 'Изменение', DELETE: 'Отключение' } as Record<string, string>)[value] ?? 'Действие';
}

function shouldHideKey(key: string) {
  return SENSITIVE_KEY.test(key) || IDENTIFIER_KEY.test(key) || key === 'includeDiagnostics' || key === 'marker';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
