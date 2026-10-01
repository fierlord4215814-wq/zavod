import { ShiftType } from '@prisma/client';

export const SHIFT_HANDOVER_PREFIX = '__ZAVOD_SHIFT_HANDOVER_V1__';

export type HandoverItem = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  startedAt?: string | null;
  durationMinutes?: number | null;
  durationLabel?: string | null;
  reason?: string | null;
  description?: string | null;
  lineId?: string | null;
  lineStatusEventId?: string | null;
  taskId?: string | null;
  washSessionId?: string | null;
  defrostEventId?: string | null;
  departmentNames?: string[];
  assigneeNames?: string[];
  responseMinutes?: number | null;
  workMinutes?: number | null;
  quantity?: string | null;
  currentStatus?: string | null;
  currentStatusLabel?: string | null;
  alreadyCompleted?: boolean;
};

export type ShiftHandoverSnapshot = {
  schema: 'zavod.shift-handover';
  version: 1;
  factoryId: string;
  departmentId: string;
  departmentName: string;
  shiftDate: string;
  shiftType: ShiftType;
  shiftLabel: string;
  window: { from: string; to: string };
  nextShift: { shiftDate: string; shiftType: ShiftType; shiftLabel: string };
  generatedAt: string;
  authorId: string;
  authorName: string;
  comment: string | null;
  sections: {
    lines: HandoverItem[];
    washes: HandoverItem[];
    tasks: HandoverItem[];
    defrosts: HandoverItem[];
    people: HandoverItem[];
    importantLogs: HandoverItem[];
  };
  counts: {
    lines: number;
    washes: number;
    tasks: number;
    defrosts: number;
    people: number;
    importantLogs: number;
    total: number;
  };
};

const itemKeys: Array<keyof HandoverItem> = [
  'id',
  'title',
  'status',
  'statusLabel',
  'startedAt',
  'durationMinutes',
  'durationLabel',
  'reason',
  'description',
  'lineId',
  'lineStatusEventId',
  'taskId',
  'washSessionId',
  'defrostEventId',
  'departmentNames',
  'assigneeNames',
  'responseMinutes',
  'workMinutes',
  'quantity',
  'currentStatus',
  'currentStatusLabel',
  'alreadyCompleted',
];

function sanitizeItem(value: unknown): HandoverItem | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || typeof source.title !== 'string' || typeof source.status !== 'string' || typeof source.statusLabel !== 'string') return null;
  const item: Record<string, unknown> = {};
  for (const key of itemKeys) {
    if (source[key] !== undefined) item[key] = source[key];
  }
  return item as HandoverItem;
}

function sanitizeItems(value: unknown) {
  return Array.isArray(value) ? value.map(sanitizeItem).filter((item): item is HandoverItem => Boolean(item)) : [];
}

export function sanitizeShiftHandoverSnapshot(value: unknown): ShiftHandoverSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, any>;
  if (source.schema !== 'zavod.shift-handover' || source.version !== 1 || !source.sections) return null;

  const sections = {
    lines: sanitizeItems(source.sections.lines),
    washes: sanitizeItems(source.sections.washes),
    tasks: sanitizeItems(source.sections.tasks),
    defrosts: sanitizeItems(source.sections.defrosts),
    people: sanitizeItems(source.sections.people),
    importantLogs: sanitizeItems(source.sections.importantLogs),
  };
  const counts = {
    lines: sections.lines.length,
    washes: sections.washes.length,
    tasks: sections.tasks.length,
    defrosts: sections.defrosts.length,
    people: sections.people.length,
    importantLogs: sections.importantLogs.length,
    total: Object.values(sections).reduce((sum, items) => sum + items.length, 0),
  };

  return {
    schema: 'zavod.shift-handover',
    version: 1,
    factoryId: String(source.factoryId ?? ''),
    departmentId: String(source.departmentId ?? ''),
    departmentName: String(source.departmentName ?? ''),
    shiftDate: String(source.shiftDate ?? ''),
    shiftType: source.shiftType === ShiftType.NIGHT ? ShiftType.NIGHT : ShiftType.DAY,
    shiftLabel: String(source.shiftLabel ?? ''),
    window: { from: String(source.window?.from ?? ''), to: String(source.window?.to ?? '') },
    nextShift: {
      shiftDate: String(source.nextShift?.shiftDate ?? ''),
      shiftType: source.nextShift?.shiftType === ShiftType.NIGHT ? ShiftType.NIGHT : ShiftType.DAY,
      shiftLabel: String(source.nextShift?.shiftLabel ?? ''),
    },
    generatedAt: String(source.generatedAt ?? ''),
    authorId: String(source.authorId ?? ''),
    authorName: String(source.authorName ?? ''),
    comment: typeof source.comment === 'string' ? source.comment : null,
    sections,
    counts,
  };
}

export function encodeShiftHandover(snapshot: ShiftHandoverSnapshot) {
  const safeSnapshot = sanitizeShiftHandoverSnapshot(snapshot);
  if (!safeSnapshot) throw new Error('Некорректная сводка передачи смены.');
  return `${SHIFT_HANDOVER_PREFIX}${JSON.stringify(safeSnapshot)}`;
}

export function parseShiftHandover(value?: string | null): ShiftHandoverSnapshot | null {
  if (!value?.startsWith(SHIFT_HANDOVER_PREFIX)) return null;
  try {
    return sanitizeShiftHandoverSnapshot(JSON.parse(value.slice(SHIFT_HANDOVER_PREFIX.length)));
  } catch {
    return null;
  }
}

export function handoverPlainText(snapshot: ShiftHandoverSnapshot) {
  const parts = [
    `Передача смены: ${snapshot.shiftLabel.toLowerCase()} ${snapshot.shiftDate}`,
    `Оперативных хвостов: ${snapshot.counts.total}`,
  ];
  if (snapshot.comment) parts.push(`Комментарий: ${snapshot.comment}`);
  return parts.join('. ');
}
