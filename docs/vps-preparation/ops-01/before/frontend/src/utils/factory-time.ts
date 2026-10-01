export const FACTORY_TIME_ZONE = 'Europe/Moscow';

export function factoryDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: FACTORY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Не удалось определить дату завода.');
  return `${year}-${month}-${day}`;
}

export function addFactoryDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return factoryDateKey(date);
}

export function factoryDateTimeLabel(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: FACTORY_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function factoryDateTimeParts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FACTORY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  if (!year || !month || !day || !hour || !minute) return null;
  return { year, month, day, hour, minute };
}

export function factoryDateTimeInput(value?: string | Date | null) {
  if (!value) return '';
  const parts = factoryDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : '';
}

export function factoryDateTimeInputToIso(value?: string | null) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function factoryShortDateTimeLabel(value?: string | Date | null) {
  if (!value) return 'время не указано';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'время не указано';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: FACTORY_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function factoryDurationLabel(from?: string | Date | null, serverNow?: string | Date | null) {
  if (!from) return 'длительность не указана';
  const start = from instanceof Date ? from : new Date(from);
  const end = serverNow instanceof Date ? serverNow : serverNow ? new Date(serverNow) : null;
  if (Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) return 'длительность уточняется';
  const minutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}
