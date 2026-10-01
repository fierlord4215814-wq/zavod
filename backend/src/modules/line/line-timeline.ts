import { LineStatus } from '@prisma/client';

export type LineTimelineStateKind = 'WORK' | 'DOWNTIME' | 'STOPPED' | 'WASH' | 'DEFROST';

export type LineTimelineStatusSource = {
  id: string;
  status: LineStatus;
  occurredAt: Date;
  reason?: string | null;
  comment?: string | null;
  actorName?: string | null;
};

export type LineTimelineOverrideSource = {
  id: string;
  kind: 'WASH' | 'DEFROST';
  startedAt: Date;
  endedAt: Date | null;
  actorName?: string | null;
  comment?: string | null;
  canOpen: boolean;
};

export type LineTimelineInterval = {
  id: string;
  kind: LineTimelineStateKind;
  occurredAt: string;
  endedAt: string;
  durationMs: number;
  title: string;
  description: string | null;
  downtimeReason: string | null;
  downtimeReasonLabel: string | null;
  comment: string | null;
  status: string;
  sourceType: 'LINE_EVENT' | 'WASH_SESSION' | 'DEFROST_EVENT';
  sourceId: string;
  canOpen: boolean;
  actorName: string | null;
};

export type LineTimelineBuildResult = {
  intervals: LineTimelineInterval[];
  overlapKinds: Array<{ from: string; to: string; kinds: LineTimelineStateKind[] }>;
  coveredUntil: Date;
};

const statePriority: LineTimelineStateKind[] = ['WASH', 'DEFROST', 'DOWNTIME', 'STOPPED', 'WORK'];

function clamp(value: Date, from: Date, to: Date) {
  return new Date(Math.max(from.getTime(), Math.min(to.getTime(), value.getTime())));
}

function stateForStatus(source: LineTimelineStatusSource | null): LineTimelineStateKind | null {
  if (!source) return null;
  if (source.status === LineStatus.WORK) return 'WORK';
  if (source.status === LineStatus.PAUSE) {
    const reason = String(source.reason ?? '').toUpperCase();
    return reason === 'WASH' || reason === 'DEFROST' ? 'STOPPED' : 'DOWNTIME';
  }
  return 'STOPPED';
}

function titleFor(kind: LineTimelineStateKind) {
  if (kind === 'WORK') return 'Линия работает';
  if (kind === 'DOWNTIME') return 'Подтверждённый простой';
  if (kind === 'WASH') return 'Линия на мойке';
  if (kind === 'DEFROST') return 'Линия на оттайке';
  return 'Линия остановлена';
}

function sourceTypeFor(kind: LineTimelineStateKind) {
  if (kind === 'WASH') return 'WASH_SESSION' as const;
  if (kind === 'DEFROST') return 'DEFROST_EVENT' as const;
  return 'LINE_EVENT' as const;
}

export function buildLineTimelineIntervals(input: {
  from: Date;
  to: Date;
  now: Date;
  statusEvents: LineTimelineStatusSource[];
  overrides: LineTimelineOverrideSource[];
}): LineTimelineBuildResult {
  const coveredUntil = input.to.getTime() <= input.now.getTime()
    ? input.to
    : input.now.getTime() > input.from.getTime()
      ? input.now
      : input.from;
  if (coveredUntil.getTime() <= input.from.getTime()) return { intervals: [], overlapKinds: [], coveredUntil };

  const statusEvents = [...input.statusEvents]
    .filter((event) => event.occurredAt.getTime() < coveredUntil.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const overrides = input.overrides
    .map((item) => ({
      ...item,
      startedAt: clamp(item.startedAt, input.from, coveredUntil),
      endedAt: clamp(item.endedAt ?? coveredUntil, input.from, coveredUntil),
    }))
    .filter((item) => item.startedAt.getTime() < item.endedAt.getTime());

  const points = new Set<number>([input.from.getTime(), coveredUntil.getTime()]);
  for (const event of statusEvents) {
    if (event.occurredAt >= input.from && event.occurredAt < coveredUntil) points.add(event.occurredAt.getTime());
  }
  for (const item of overrides) {
    points.add(item.startedAt.getTime());
    points.add(item.endedAt.getTime());
  }
  const orderedPoints = [...points].sort((a, b) => a - b);
  const intervals: LineTimelineInterval[] = [];
  const overlapKinds: LineTimelineBuildResult['overlapKinds'] = [];

  for (let index = 0; index < orderedPoints.length - 1; index += 1) {
    const start = new Date(orderedPoints[index]);
    const end = new Date(orderedPoints[index + 1]);
    if (start >= end) continue;
    const currentStatus = [...statusEvents].reverse().find((event) => event.occurredAt <= start) ?? null;
    const baseKind = stateForStatus(currentStatus);
    const activeOverrides = overrides.filter((item) => item.startedAt <= start && item.endedAt > start);
    const candidateKinds = [...new Set([
      ...(baseKind ? [baseKind] : []),
      ...activeOverrides.map((item) => item.kind),
    ])];
    const operationalKinds = candidateKinds.filter((kind) => kind !== 'STOPPED' || !activeOverrides.length);
    if (operationalKinds.length > 1) {
      overlapKinds.push({ from: start.toISOString(), to: end.toISOString(), kinds: operationalKinds });
    }
    const kind = statePriority.find((candidate) => candidateKinds.includes(candidate)) ?? null;
    if (!kind) continue;
    const override = activeOverrides.find((item) => item.kind === kind) ?? null;
    const source = override ?? currentStatus;
    if (!source) continue;
    const description = kind === 'WASH' || kind === 'DEFROST'
      ? override?.comment ?? null
      : currentStatus?.reason || currentStatus?.comment || null;
    const interval: LineTimelineInterval = {
      id: `interval:${kind}:${source.id}:${start.toISOString()}`,
      kind,
      occurredAt: start.toISOString(),
      endedAt: end.toISOString(),
      durationMs: Math.max(0, end.getTime() - start.getTime()),
      title: titleFor(kind),
      description,
      downtimeReason: kind === 'DOWNTIME' || kind === 'STOPPED' ? currentStatus?.reason ?? null : null,
      downtimeReasonLabel: null,
      comment: kind === 'WASH' || kind === 'DEFROST' ? override?.comment ?? null : currentStatus?.comment ?? null,
      status: kind,
      sourceType: sourceTypeFor(kind),
      sourceId: source.id,
      canOpen: override?.canOpen ?? false,
      actorName: source.actorName ?? null,
    };
    const previous = intervals.length ? intervals[intervals.length - 1] : undefined;
    if (previous && previous.kind === interval.kind && previous.sourceId === interval.sourceId && previous.endedAt === interval.occurredAt) {
      previous.endedAt = interval.endedAt;
      previous.durationMs += interval.durationMs;
      if (!previous.description && interval.description) previous.description = interval.description;
      continue;
    }
    intervals.push(interval);
  }

  return { intervals, overlapKinds, coveredUntil };
}
