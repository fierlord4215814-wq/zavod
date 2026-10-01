export type DowntimeReasonOption = {
  value: string;
  label: string;
};

const DOWNTIME_REASON_OPTIONS: readonly DowntimeReasonOption[] = Object.freeze([
  { value: 'TECHNICAL', label: 'Техническая неисправность' },
  { value: 'TECHNOLOGY', label: 'Нарушение технологии' },
  { value: 'QUALITY', label: 'Качество / ОКК' },
  { value: 'DEFROST', label: 'Оттайка' },
  { value: 'WASH', label: 'Мойка' },
  { value: 'PEOPLE', label: 'Нет людей' },
  { value: 'WAREHOUSE', label: 'Нет сырья / склад' },
  { value: 'WAITING_DECISION', label: 'Ожидание решения' },
  { value: 'OTHER', label: 'Другое' },
]);

const LABELS = new Map(DOWNTIME_REASON_OPTIONS.map((item) => [item.value, item.label]));

export function downtimeReasonOptions(): DowntimeReasonOption[] {
  return DOWNTIME_REASON_OPTIONS.map((item) => ({ ...item }));
}

export function normalizeDowntimeReasonCode(value?: string | null): string | null {
  const normalized = String(value ?? '').trim().toLocaleUpperCase('ru-RU');
  return LABELS.has(normalized) ? normalized : null;
}

export function inferDowntimeReasonCode(value?: string | null): string {
  const text = String(value ?? '').trim().toLocaleLowerCase('ru-RU');
  if (/оттайк/.test(text)) return 'DEFROST';
  if (/мойк/.test(text)) return 'WASH';
  if (/окк|качеств|брак|несоответ/.test(text)) return 'QUALITY';
  if (/сырь|склад|остат|упаков/.test(text)) return 'WAREHOUSE';
  if (/люд|сотрудник|персонал/.test(text)) return 'PEOPLE';
  if (/технолог/.test(text)) return 'TECHNOLOGY';
  if (/решен|ожидан/.test(text)) return 'WAITING_DECISION';
  if (/тех|механ|электр|кип|холод|неисправ/.test(text)) return 'TECHNICAL';
  return 'OTHER';
}

export function historicalDowntimeReasonCode(value?: string | null): string {
  const raw = String(value ?? '').trim();
  const known = normalizeDowntimeReasonCode(raw);
  if (known) return known;
  if (!raw) return 'OTHER';
  const inferred = inferDowntimeReasonCode(raw);
  if (inferred !== 'OTHER') return inferred;
  const safeCode = raw
    .toLocaleUpperCase('ru-RU')
    .replace(/[^A-ZА-ЯЁ0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return safeCode || 'OTHER';
}

export function downtimeReasonLabel(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Причина не указана';
  const normalized = normalizeDowntimeReasonCode(raw);
  if (normalized) return LABELS.get(normalized)!;

  const inferred = inferDowntimeReasonCode(raw);
  if (inferred !== 'OTHER') return LABELS.get(inferred)!;

  const humanized = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU');
  if (!humanized) return LABELS.get('OTHER')!;
  return `Ранее указанная причина: ${humanized.charAt(0).toLocaleUpperCase('ru-RU')}${humanized.slice(1)}`;
}
