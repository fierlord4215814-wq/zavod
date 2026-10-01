import { ShiftType } from '@prisma/client';
import { readFileSync } from 'node:fs';

export const FACTORY_TIME_ZONE = 'Europe/Moscow';

export type FactoryShiftTarget = {
  shiftDate: string;
  shiftType: ShiftType;
};

export type FactoryShiftWindow = FactoryShiftTarget & {
  from: Date;
  to: Date;
};

export type FactoryHandoverAvailability = FactoryShiftTarget & {
  available: boolean;
  opensAt: Date;
  closesAt: Date;
};

export type FactoryShiftSessionSchedule = FactoryShiftTarget & {
  startedAt: Date;
  durationHours: 12 | 24;
  plannedEndAt: Date;
};

const MOSCOW_OFFSET = '+03:00';
const INTERNAL_TEST_NOW_ENV = 'ZAVOD_INTERNAL_TEST_NOW';
const INTERNAL_TEST_NOW_FILE_ENV = 'ZAVOD_INTERNAL_TEST_NOW_FILE';

export function factoryServerNow() {
  let raw = '';
  if (process.env.NODE_ENV === 'test') {
    const clockFile = process.env[INTERNAL_TEST_NOW_FILE_ENV]?.trim();
    try {
      raw = clockFile
        ? readFileSync(clockFile, 'utf8').trim()
        : process.env[INTERNAL_TEST_NOW_ENV]?.trim() ?? '';
    } catch {
      throw new Error('Не удалось прочитать внутреннее тестовое время сервера.');
    }
  }
  if (!raw) return new Date();
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new Error('Некорректное внутреннее тестовое время сервера.');
  }
  return value;
}

export function factoryDateTimeParts(date: Date) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: FACTORY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(values.map((item) => [item.type, item.value])) as Record<string, string>;
}

export function factoryDateKey(date: Date) {
  const value = factoryDateTimeParts(date);
  return `${value.year}-${value.month}-${value.day}`;
}

export function factoryTimeLabel(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: FACTORY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function factoryDisplayDate(date: Date) {
  const [year, month, day] = factoryDateKey(date).split('-');
  return `${day}.${month}.${year}`;
}

export function factoryShiftTarget(date = factoryServerNow()): FactoryShiftTarget {
  const value = factoryDateTimeParts(date);
  const hour = Number(value.hour);
  const currentDate = `${value.year}-${value.month}-${value.day}`;
  if (hour >= 8 && hour < 20) return { shiftDate: currentDate, shiftType: ShiftType.DAY };
  if (hour >= 20) return { shiftDate: currentDate, shiftType: ShiftType.NIGHT };
  return { shiftDate: addFactoryDays(currentDate, -1), shiftType: ShiftType.NIGHT };
}

export function addFactoryCalendarDays(date: Date, days: number) {
  const value = factoryDateTimeParts(date);
  const dateKey = addFactoryDays(`${value.year}-${value.month}-${value.day}`, days);
  return new Date(`${dateKey}T${value.hour}:${value.minute}:${value.second}${MOSCOW_OFFSET}`);
}

export function addFactoryCalendarMonths(date: Date, months: number) {
  const value = factoryDateTimeParts(date);
  const targetMonth = new Date(Date.UTC(Number(value.year), Number(value.month) - 1 + months, 1));
  const year = targetMonth.getUTCFullYear();
  const month = targetMonth.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(value.day), lastDay);
  const dateKey = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return new Date(`${dateKey}T${value.hour}:${value.minute}:${value.second}${MOSCOW_OFFSET}`);
}

export function addFactoryDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00${MOSCOW_OFFSET}`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FACTORY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addFactoryShifts(target: FactoryShiftTarget, offset: number): FactoryShiftTarget {
  let result = { ...target };
  const step = offset >= 0 ? 1 : -1;
  for (let index = 0; index < Math.abs(offset); index += 1) {
    if (step > 0) {
      result = result.shiftType === ShiftType.DAY
        ? { shiftDate: result.shiftDate, shiftType: ShiftType.NIGHT }
        : { shiftDate: addFactoryDays(result.shiftDate, 1), shiftType: ShiftType.DAY };
    } else {
      result = result.shiftType === ShiftType.NIGHT
        ? { shiftDate: result.shiftDate, shiftType: ShiftType.DAY }
        : { shiftDate: addFactoryDays(result.shiftDate, -1), shiftType: ShiftType.NIGHT };
    }
  }
  return result;
}

export function factoryShiftWindow(target: FactoryShiftTarget): FactoryShiftWindow {
  const from = target.shiftType === ShiftType.DAY
    ? new Date(`${target.shiftDate}T08:00:00${MOSCOW_OFFSET}`)
    : new Date(`${target.shiftDate}T20:00:00${MOSCOW_OFFSET}`);
  const to = target.shiftType === ShiftType.DAY
    ? new Date(`${target.shiftDate}T20:00:00${MOSCOW_OFFSET}`)
    : new Date(`${addFactoryDays(target.shiftDate, 1)}T08:00:00${MOSCOW_OFFSET}`);
  return { ...target, from, to };
}

export function normalizeShiftDurationHours(value: unknown): 12 | 24 {
  return Number(value) === 24 ? 24 : 12;
}

export function factoryShiftSessionSchedule(
  startedAt = factoryServerNow(),
  durationHoursValue: unknown = 12,
): FactoryShiftSessionSchedule {
  const target = factoryShiftTarget(startedAt);
  const window = factoryShiftWindow(target);
  const durationHours = normalizeShiftDurationHours(durationHoursValue);
  return {
    ...target,
    startedAt,
    durationHours,
    plannedEndAt: new Date(window.from.getTime() + durationHours * 60 * 60 * 1000),
  };
}

export function factoryDayWindow(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('Некорректная дата завода.');
  return {
    from: new Date(`${dateKey}T00:00:00${MOSCOW_OFFSET}`),
    to: new Date(`${addFactoryDays(dateKey, 1)}T00:00:00${MOSCOW_OFFSET}`),
  };
}

export function factoryHandoverAvailability(date = factoryServerNow()): FactoryHandoverAvailability {
  const target = factoryShiftTarget(date);
  const window = factoryShiftWindow(target);
  const opensAt = new Date(window.to.getTime() - 2 * 60 * 60 * 1000);
  return {
    ...target,
    available: date >= opensAt && date < window.to,
    opensAt,
    closesAt: window.to,
  };
}

export function factoryShiftDate(target: FactoryShiftTarget) {
  return new Date(`${target.shiftDate}T00:00:00${MOSCOW_OFFSET}`);
}

export function shiftTypeForFactoryTime(date: Date) {
  return factoryShiftTarget(date).shiftType;
}
