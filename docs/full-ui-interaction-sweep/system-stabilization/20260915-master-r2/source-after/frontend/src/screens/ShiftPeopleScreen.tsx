import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { apiClient } from '../api/client';
import { useRef } from 'react';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { PremiumActionItem, PremiumKpiStrip, PremiumSectionHeader, PremiumSheet } from '../components/PremiumShell';
import { PeopleSearchPanel, type PeopleSearchContext, type PeopleSearchResult } from '../components/PeopleSearchPanel';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { defrostStatusLabels, roleLabels } from '../labels';
import { isAssignableRole, isPilotFixtureText, isPilotFixtureUser, pilotUserName, shortPersonName } from '../utils/pilot-ui';
import { factoryDateTimeInput, factoryDateTimeInputToIso, factoryDateTimeLabel } from '../utils/factory-time';
import { appStore, useAppStore } from '../store/app.store';
import type {
  Attachment,
  Line,
  LinePosition,
  LineStaffingTemplate,
  LineTaskSummary,
  ShiftPerson,
  ShortageItem,
} from '../store/app.store';

void React;

type PersonActionMode = 'line' | 'wash' | 'time' | 'home' | 'release' | null;
type LineActionMode = 'pause' | 'stop' | 'work' | 'task' | 'downtimeTask' | 'wash' | 'endShift' | 'activateLine' | null;
type PeoplePanelMode = 'all' | 'available' | 'active' | null;
type CurrentOperationalView = 'lines' | 'downtime' | 'requests'; let retainedCurrentOperationalView: CurrentOperationalView = 'lines';
type FuturePanelMode = 'willBe' | 'contractors' | 'plannedLines' | null;
type RequirementEditor = {
  kind: 'LINE' | 'WORK_AREA';
  title: string;
  current: number;
  min: number;
  max: number;
  lineId?: string;
  templateId?: string;
  itemId?: string;
  workAreaId?: string;
  positionId?: string;
};
type RequirementPreview = {
  currentValue: number;
  nextValue: number;
  requiresRelease: boolean;
  counts: { current: number; future: number };
  affected: Array<{
    scope: 'CURRENT' | 'FUTURE';
    displayName: string;
    slotIndex?: number | null;
    shiftDate?: string | null;
    shiftType?: string | null;
  }>;
};
type TemplateRemapPreview = {
  lineVersion: number;
  targetTemplate: { id: string; name: string } | null;
  counts: {
    activeKept: number;
    activeMoved: number;
    activeReleased: number;
    plannedKept: number;
    plannedMoved: number;
    plannedReleased: number;
  };
  requiresConfirmation: boolean;
  affectedAssignments: Array<{ displayName: string; from: string; to: string | null; action: 'MOVE' | 'RELEASE' }>;
  shiftDate?: string;
  shiftType?: string;
  planUpdatedAt?: string | null;
};
type TemplateRemapDialog = {
  scope: 'CURRENT' | 'FUTURE' | 'ACTIVATE';
  lineId: string;
  templateId: string | null;
  operationId: string;
  preview: TemplateRemapPreview;
};

const PENDING_LINE_ASSIGNMENT_CONTEXT_KEY = 'zavod.pendingLineAssignmentContext';
const PENDING_WASH_ASSIGNMENT_CONTEXT_KEY = 'zavod.pendingWashAssignmentContext';
const PENDING_WASH_SESSION_KEY = 'zavod.pendingWashSessionId';
const PENDING_WASH_DETAIL_TAB_KEY = 'zavod.pendingWashDetailTab';
type WashAssignmentReturnContext = {
  washSessionId: string;
  targetUserId?: string | null;
  mode?: 'available' | 'active';
  returnToWash?: boolean;
};
type FutureNonLinePending = {
  kind: FutureAssignmentKind;
  options: {
    workAreaId?: string;
    workAreaPositionId?: string;
    slotIndex?: number;
    timeRoleName?: string;
    replaceAssignmentId?: string;
  };
  targetLabel: string;
};
type ManualSearchSheet = { context: 'CURRENT' | 'FUTURE'; source: 'GENERAL' | 'SLOT' } | null;
type ManualSearchSelection = { result: PeopleSearchResult; context: PeopleSearchContext; operationId: string } | null;
type CurrentLinePickerSelection = { userId: string; displayName: string; mode: 'assign' | 'start' } | null;
type CurrentSlotAction = {
  source: 'LINE' | 'WORK_AREA';
  positionId: string;
  slotIndex: number;
  label: string;
  assignment: NonNullable<AssignmentBoard['slots'][number]['assignment']>;
} | null;

type ShiftMeResponse = {
  user: ShiftPerson | null;
  shiftSession: { id: string; startedAt: string } | null;
  activeWillBe?: { id: string; targetShiftDate: string; shiftType: string; status: string; comment?: string | null } | null;
  pendingReturnRequest?: { id: string; status: string; reason: string; createdAt: string } | null;
  allowedActions: {
    canStartShift: boolean;
    canEndShift: boolean;
    canMarkWillBe?: boolean;
    canCancelWillBe?: boolean;
    canRequestReturn?: boolean;
  };
};

type FutureShift = {
  targetShiftDate: string;
  shiftType: string;
  willBe: Array<{ id: string; userId?: string; displayName: string; status: string; comment?: string | null }>;
  contractorSubmissions: Array<{ id: string; leadName: string; companyName?: string; status: string; items: Array<{ id?: string; contractorUserId?: string | null; displayName: string; status: string; actualStatus?: string; version?: number }> }>;
  plannedNonLineAssignments?: FuturePlannedAssignment[];
  plannedLines?: Array<{
    lineId: string;
    lineName: string;
    statusLabel: string;
    staffingTemplateId?: string | null;
    staffingTemplateName?: string | null;
    plannedAssignmentsCount: number;
    plannedSlots: number;
    shortageCount: number;
    workPlanRowsCount: number;
  }>;
  counts: {
    willBe: number;
    cancelled: number;
    removed: number;
    contractorItems: number;
    plannedLines: number;
    plannedSlots: number;
    plannedAssignments: number;
    plannedNonLineAssignments: number;
    confirmedUnassigned: number;
    assignedUnconfirmed: number;
    deficit: number;
    surplus: number;
  };
  ownAssignment?: FuturePlannedAssignment | {
    id: string;
    kind: 'LINE';
    lineId: string;
    lineName: string;
    positionId: string;
    positionName: string;
    slotIndex: number;
    targetLabel: string;
  } | null;
};

type FutureAssignmentKind = 'WASH' | 'TIME' | 'WORK_AREA';

type FuturePlannedAssignment = {
  id: string;
  kind: FutureAssignmentKind;
  userId: string;
  displayName?: string | null;
  targetLabel: string;
  workAreaId?: string | null;
  workAreaName?: string | null;
  workAreaPositionId?: string | null;
  workAreaPositionName?: string | null;
  slotIndex?: number | null;
  timeRoleName?: string | null;
  createdAt?: string;
};

type FutureAssignmentBoard = {
  shiftDate: string;
  shiftType: string;
  assignments: FuturePlannedAssignment[];
  workAreas: Array<{
    id: string;
    name: string;
    assignmentKind: 'TIME' | 'WORK_AREA';
    positions: Array<{
      id: string;
      title: string;
      plannedCount: number;
      minRequired: number;
      maxRequired: number;
      isFlexible: boolean;
      isExtraSlot: boolean;
      slots: Array<{
        workAreaPositionId: string;
        title: string;
        slotIndex: number;
        assignment: FuturePlannedAssignment | null;
      }>;
    }>;
  }>;
  candidates: Array<{
    userId: string;
    displayName: string;
    role: 'WORKER' | 'CONTRACTOR';
    companyName?: string | null;
    departmentName: string | null;
    employeeState: ShiftPerson['employeeState'];
    willBeStatus?: string | null;
    plannedAssignmentId?: string | null;
    isBusyNow?: boolean;
  }>;
  counts: { planned: number; wash: number; time: number; workArea: number };
};

type ContractorLeadPool = {
  company: { id: string; name: string };
  currentShift: { shiftDate: string; shiftType: string };
  people: Array<{
    userId: string;
    displayName: string;
    onShift: boolean;
    actual: { id: string; submissionId: string; actualStatus: 'PLANNED' | 'ARRIVED' | 'ABSENT'; version: number } | null;
  }>;
};

type ContractorLeadSubmission = {
  id: string;
  targetShiftDate: string;
  shiftType: string;
  companyNameSnapshot?: string | null;
  status: string;
  items: Array<{
    id: string;
    contractorUserId: string;
    actualStatus: 'PLANNED' | 'ARRIVED' | 'ABSENT';
    version: number;
    displayName: string;
  }>;
};

type ShiftTimeline = {
  current: { shiftDate: string; targetShiftDate: string; shiftType: string; label: string };
  next: { shiftDate: string; targetShiftDate: string; shiftType: string; label: string };
  future: Array<{ shiftDate: string; targetShiftDate: string; shiftType: string; label: string }>;
  past: Array<{ shiftDate: string; targetShiftDate: string; shiftType: string; label: string }>;
};

type HandoverItem = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  currentStatusLabel?: string | null;
  alreadyCompleted?: boolean;
  startedAt?: string | null;
  durationLabel?: string | null;
  reason?: string | null;
  description?: string | null;
  departmentNames?: string[];
  assigneeNames?: string[];
  responseMinutes?: number | null;
  workMinutes?: number | null;
  quantity?: string | null;
  lineId?: string | null;
  taskId?: string | null;
  washSessionId?: string | null;
  defrostEventId?: string | null;
};

type ShiftHandoverSnapshot = {
  shiftDate: string;
  shiftType: string;
  shiftLabel: string;
  departmentName: string;
  generatedAt: string;
  authorName: string;
  comment?: string | null;
  window: { from: string; to: string };
  nextShift: { shiftDate: string; shiftType: string; shiftLabel: string };
  counts: { lines: number; washes: number; tasks: number; defrosts: number; people: number; importantLogs: number; total: number };
  sections: { lines: HandoverItem[]; washes: HandoverItem[]; tasks: HandoverItem[]; defrosts: HandoverItem[]; people: HandoverItem[]; importantLogs: HandoverItem[] };
};

type HandoverAvailability = {
  available: boolean;
  shiftDate: string;
  shiftType: string;
  opensAt: string;
  closesAt: string;
  message: string;
};

type HandoverView = {
  snapshot: ShiftHandoverSnapshot;
  logId?: string | null;
  immutable?: boolean;
  alreadyHandedOver?: boolean;
  liveStatusCheckedAt?: string;
};

type HandoverLogResponse = {
  id: string;
  message?: string;
  alreadyHandedOver?: boolean;
  handover: HandoverView;
};

type PastShift = {
  month: string;
  shifts?: PastShiftCard[];
  sessions: Array<{ id: string; userId: string; displayName?: string | null; startedAt: string; endedAt: string | null; shiftType: string; status: string; role: string }>;
  assignments: Array<{ id: string; userId: string; kind: string; lineName: string | null; positionName: string | null; startedAt: string; endedAt: string | null; comment?: string | null }>;
};

type PastShiftCard = {
  key: string;
  shiftDate: string;
  shiftType: string;
  shiftTypeLabel: string;
  title: string;
  masterLabel: string;
  masters: string[];
  peopleCount: number;
  lineCount: number;
  downtimeCount: number;
  taskCount: number;
  washCount: number;
  importantShiftLogs: number;
  readOnly: boolean;
};

type PastShiftDetail = {
  key: string;
  title: string;
  timeRange: string;
  shiftDate: string;
  shiftType: string;
  shiftTypeLabel: string;
  readOnly: boolean;
  scope?: 'SELF' | 'FACTORY';
  allowedActions: Record<string, boolean>;
  summary: {
    masters: string[];
    peopleCount: number;
    lineCount: number;
    downtimeCount: number;
    downtimeLabel: string;
    taskCount: number;
    washCount: number;
    importantShiftLogs: number;
    contractorCount?: number;
    contractorCompanies?: Array<{ name: string; count: number }>;
  };
  people: Array<{ id: string; displayName: string; targetName: string; positionName: string; label: string; slotIndex?: number | null; startedAt?: string; endedAt?: string | null }>;
  lines: Array<{
    lineId: string;
    lineName?: string;
    name?: string;
    worked: boolean;
    peopleCount: number;
    assignedCount?: number;
    requiredCount?: number;
    operationalState?: 'RUNNING' | 'DOWNTIME' | 'WASH' | 'DEFROST' | 'STOPPED' | 'UNKNOWN';
    operationalStateDataStatus?: 'AVAILABLE' | 'MISSING';
    staffingDataStatus?: 'AVAILABLE' | 'MISSING';
    selectedComposition?: { id: string; name: string } | null;
    stateDurations?: { workMs: number; downtimeMs: number; stoppedMs: number; washMs: number; defrostMs: number };
    workPlanRows: Array<{ id: string; article: string; productName: string; plannedGofrCount: number }>;
    downtimeCount: number;
    taskCount?: number;
    washCount: number;
    defrostCount?: number;
  }>;
  downtime: Array<{ id: string; lineName: string; startTime: string; endTime: string | null; durationLabel: string; reason: string; comment?: string | null; corrected: boolean; linkedTasks: Array<{ id: string; statusLabel: string; departments: string[] }> }>;
  tasks: Array<{ id: string; lineName: string; typeLabel: string; statusLabel: string; description?: string | null; createdTime: string; startedTime?: string | null; doneTime?: string | null; departments: string[]; takenByName?: string | null; doneByName?: string | null; overdueLong: boolean }>;
  washes: Array<{ id: string; lineName: string; status: string; timeRange: string; issuesCount: number; openIssuesCount: number; controlItemsCount: number; okkReviews: Array<{ id: string; rating?: number | null; comment: string }> }>;
  shiftLogs: Array<{ id: string; title?: string | null; text: string; isImportant: boolean; createdTime: string; authorName: string; departmentName: string; commentsCount: number }>;
  tabs: string[];
};

type PersonProfile = {
  id: string;
  displayName: string;
  role: string;
  departmentName: string | null;
  employeeState: ShiftPerson['employeeState'];
  currentAssignment: ShiftPerson['currentAssignment'];
  phoneLabel?: string | null;
  profilePhoto?: Attachment | null;
  factoryAccesses?: Array<{ factoryName: string; role: string; departmentName: string | null; isActive: boolean }>;
  factoryAccessSummary?: { factoryName: string; role: string; departmentName: string | null; isActive: boolean } | null;
  sections: { skills: string; recommendations: string; comments: string | null };
  serviceTaskStatus?: { state: 'FREE' | 'ON_TASK'; label: string; taskId?: string; title?: string | null; lineName?: string | null; departments?: string[]; sourceRoute?: string } | null;
};

type LineDashboard = {
  line: Line;
  positions: LinePosition[];
  staffingTemplates: LineStaffingTemplate[];
  assignmentsByPosition: Array<{
    position: LinePosition;
    assignments: Array<{ id: string; userId: string; displayName: string; startedAt: string }>;
  }>;
  withoutPosition: Array<{ id: string; userId: string; displayName: string; startedAt: string }>;
  activeTemplate: LineStaffingTemplate | null;
  structureConfigured: boolean;
  structureMessage: string | null;
  shortageSummary: ShortageItem[] | null;
  activeTasks: LineTaskSummary[];
  activeWash: Array<{ id: string; status: string; createdAt: string }>;
  activeDefrost?: { id: string; status: string; startAt: string; comment?: string | null } | null;
  latestDefrost?: Array<{ id: string; status: string; startAt: string; endAt?: string | null; durationSeconds?: number | null }>;
  recentEvents: Array<{
    id: string;
    status: 'WORK' | 'PAUSE' | 'STOP';
    humanTitle?: string | null;
    actorName?: string | null;
    occurredAt?: string | null;
    comment?: string | null;
    createdAt: string;
    downtimeReason?: string | null;
    downtimeReasonLabel?: string | null;
    correctedStartAt?: string | null;
    correctedEndAt?: string | null;
  }>;
  activeDowntimeEvent?: {
    id: string;
    status: string;
    comment?: string | null;
    createdAt: string;
    downtimeReason?: string | null;
    downtimeReasonLabel?: string | null;
    correctedStartAt?: string | null;
    correctedEndAt?: string | null;
  } | null;
};

type RecipientDepartment = {
  id: string;
  name: string;
  code?: string | null;
  scope?: string | null;
  factoryId?: string | null;
};

type AssignmentBoard = {
  line: Line;
  activeTemplate: LineStaffingTemplate | null;
  structureConfigured: boolean;
  structureMessage: string | null;
  positions: LinePosition[];
  slots: Array<{
    positionId: string;
    positionName: string;
    displayName?: string | null;
    skillCode?: string | null;
    plannedCount?: number | null;
    minRequired?: number | null;
    maxRequired?: number | null;
    isFlexible?: boolean;
    isExtraSlot?: boolean;
    doesNotAffectShortage?: boolean;
    slotIndex: number;
    assignment: { id: string; userId: string; displayName: string; startedAt: string; profilePhoto?: Attachment | null } | null;
  }>;
  candidates: Array<{
    userId: string;
    displayName: string;
    profilePhoto?: Attachment | null;
    role: 'WORKER' | 'CONTRACTOR';
    departmentName: string | null;
    companyName?: string | null;
    employeeState: ShiftPerson['employeeState'];
    isMovable?: boolean;
    currentAssignment?: ShiftPerson['currentAssignment'];
    skillMatches?: Array<{ positionId: string; type: 'DIRECT' | 'SIMILAR' | 'NONE'; label: string; recommended?: boolean }>;
  }>;
  shortage: ShortageItem[] | null;
};

type PlanningBoard = Omit<AssignmentBoard, 'candidates' | 'slots'> & {
  shiftDate: string;
  shiftType: string;
  statusLabel: string;
  planUpdatedAt?: string | null;
  staffingTemplate: LineStaffingTemplate | null;
  counts: { planned: number; freeSlots: number; willBeCandidates: number };
  candidates: Array<AssignmentBoard['candidates'][number] & {
    willBeStatus?: string | null;
    plannedAssignmentId?: string | null;
    isBusyNow?: boolean;
  }>;
  slots: Array<Omit<AssignmentBoard['slots'][number], 'assignment'> & {
    assignment: ({ id: string; userId: string; displayName: string; startedAt?: string; createdAt?: string; profilePhoto?: Attachment | null } | null);
  }>;
};

type LineShiftAssignmentRow = {
  id: string;
  sortOrder: number;
  article: string;
  productName: string;
  plannedGofrCount: number;
};

type LineShiftAssignment = {
  id: string | null;
  shiftSessionId: string | null;
  shiftDate: string;
  shiftType: string;
  canEdit: boolean;
  isPast: boolean;
  rows: LineShiftAssignmentRow[];
};

type WorkArea = {
  id: string;
  name: string;
  assignmentKind: 'TIME' | 'WORK_AREA';
  positions: WorkAreaPosition[];
  shortageSummary?: WorkAreaShortage[];
};

type WorkAreaPosition = {
  id: string;
  title: string;
  minRequired: number;
  maxRequired: number;
  defaultPlanned: number;
  plannedCount: number;
  isFlexible: boolean;
  isExtraSlot: boolean;
  doesNotAffectShortage: boolean;
};

type WorkAreaShortage = {
  workAreaPositionId: string;
  title: string;
  minRequired: number;
  maxRequired: number;
  plannedCount: number;
  required: number;
  actual: number;
  missing: number;
  isExtraSlot: boolean;
  doesNotAffectShortage: boolean;
};

type WorkAreaBoard = {
  workArea: WorkArea;
  slots: Array<{
    workAreaPositionId: string;
    title: string;
    slotIndex: number;
    minRequired: number;
    maxRequired: number;
    defaultPlanned: number;
    plannedCount: number;
    isFlexible: boolean;
    isExtraSlot: boolean;
    doesNotAffectShortage: boolean;
    assignment: { id: string; userId: string; displayName: string; startedAt: string; profilePhoto?: Attachment | null } | null;
  }>;
  shortage: WorkAreaShortage[];
  candidates: Array<{
    userId: string;
    displayName: string;
    profilePhoto?: Attachment | null;
    role: 'WORKER' | 'CONTRACTOR';
    departmentName: string | null;
    companyName?: string | null;
    employeeState?: ShiftPerson['employeeState'];
    isMovable?: boolean;
    currentAssignment?: ShiftPerson['currentAssignment'];
  }>;
};

const stateMeta: Record<ShiftPerson['employeeState'], { label: string; tag: string }> = {
  AVAILABLE: { label: 'Свободен', tag: 'work' },
  ASSIGNED: { label: 'На линии', tag: 'pause' },
  WASHING: { label: 'Мойка', tag: 'wash' },
  TIME_ROLE: { label: 'Повременщик', tag: 'pause' },
  OFF_SHIFT: { label: 'Отправлен домой', tag: 'stop' },
};

const activePersonStates: ShiftPerson['employeeState'][] = ['ASSIGNED', 'WASHING', 'TIME_ROLE'];

// LineEvent.status follows the backend enum; planning is a separate read model.
const statusLabels: Record<'WORK' | 'PAUSE' | 'STOP', string> = {
  WORK: 'Работает',
  PAUSE: 'Простой',
  STOP: 'Остановлена',
};

const canonicalLineStateMeta: Record<NonNullable<Line['operationalState']>, { label: string; tag: string }> = {
  RUNNING: { label: 'Работает', tag: 'work' },
  DOWNTIME: { label: 'Простой', tag: 'pause' },
  WASH: { label: 'На мойке', tag: 'wash' },
  DEFROST: { label: 'На оттайке', tag: 'defrost' },
  STOPPED: { label: 'Остановлена', tag: 'stop' },
};

function openLineWash(sessionId?: string | null) {
  if (sessionId) window.sessionStorage.setItem('zavod.pendingWashSessionId', sessionId);
  window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Wash' } }));
}

function openLineDefrost() {
  window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Defrost' } }));
}
const SHIFT_REFRESH_INTERVAL_MS = 8000;
const SHIFT_LOAD_TIMEOUT_MS = 15000;

async function withShiftLoadTimeout<T>(promise: Promise<T>) {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error('Смена загружается слишком долго. Проверьте связь и повторите.')), SHIFT_LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

function formatElapsed(from?: string | null, to?: string | null, serverNow?: string | null) {
  if (!from) return 'время не указано';
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : serverNow ? new Date(serverNow).getTime() : NaN;
  if (!to && !serverNow) return 'длительность уточняется';
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'меньше минуты';
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${minutes} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'не указано';
  return date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function formatFactoryTime(value?: string | null) {
  if (!value) return 'сейчас';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'не указано';
  return date.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
}

const handoverSections: Array<{ key: keyof ShiftHandoverSnapshot['sections']; title: string; empty: string }> = [
  { key: 'lines', title: 'Линии в работе', empty: 'Нет продолжающих работу линий' },
  { key: 'washes', title: 'Мойка', empty: 'Нет продолжающихся моек' },
  { key: 'tasks', title: 'Простои и заявки', empty: 'Нет активных простоев' },
];

function shiftKindLabel(value?: string | null) {
  return value === 'NIGHT' ? 'Ночь' : 'День';
}

function shiftKindRange(value?: string | null) {
  return value === 'NIGHT' ? '20:00–08:00' : '08:00–20:00';
}

function formatShiftDateLabel(value?: string | null) {
  const raw = value?.slice(0, 10);
  if (!raw) return 'дата смены недоступна';
  const [year, month, day] = raw.split('-');
  if (!year || !month || !day) return raw;
  return `${day}.${month}.${year}`;
}

function willBeStatusLabel(status: string) {
  if (status === 'WILL_BE') return 'Я буду';
  if (status === 'CANCELLED') return 'Отменил';
  if (status === 'REMOVED_BY_MASTER') return 'Не вызывать / не требуется';
  return status;
}

function totalMissing(items?: ShortageItem[] | null) {
  return items?.reduce((sum, item) => sum + item.missing, 0) ?? 0;
}

function normalizeLineName(name: string) {
  return name.trim().replace(/^линия\s+/i, '').replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function dedupeLines(lines: Line[]) {
  const byName = new Map<string, Line>();
  for (const line of lines) {
    const key = normalizeLineName(line.name);
    const existing = byName.get(key);
    if (!existing || existing.name.toLocaleLowerCase('ru-RU').startsWith('линия ')) byName.set(key, line);
  }
  return Array.from(byName.values());
}

function shiftRuntimeSignature(params: {
  people: ShiftPerson[];
  lines: Line[];
  timeline: ShiftTimeline | null;
  future: FutureShift | null;
  board: AssignmentBoard | null;
  planningBoard: PlanningBoard | null;
}) {
  const peoplePart = params.people.map((person) => `${person.userId}:${person.employeeState}:${person.currentAssignment?.lineId ?? ''}:${person.currentAssignment?.positionId ?? ''}`).join('|');
  const linesPart = params.lines.map((line) => `${line.id}:${line.status}:${line.activeWorkersCount ?? ''}:${line.activeTasksCount ?? ''}:${line.activeWash?.id ?? ''}`).join('|');
  const timelinePart = `${params.timeline?.current.targetShiftDate ?? ''}:${params.timeline?.next.targetShiftDate ?? ''}`;
  const futurePart = `${params.future?.counts.willBe ?? ''}:${params.future?.counts.plannedLines ?? ''}:${params.future?.counts.plannedAssignments ?? ''}`;
  const boardPart = `${params.board?.slots.map((slot) => `${slot.positionId}:${slot.slotIndex}:${slot.assignment?.userId ?? ''}`).join('|') ?? ''}`;
  const planningPart = `${params.planningBoard?.slots.map((slot) => `${slot.positionId}:${slot.slotIndex}:${slot.assignment?.userId ?? ''}`).join('|') ?? ''}`;
  return `${peoplePart}#${linesPart}#${timelinePart}#${futurePart}#${boardPart}#${planningPart}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export type ShiftTaskReturn = {
  profileId: string; includeAllPeople: boolean; shiftTab: 'past' | 'current' | 'next' | 'future';
  currentOperationalView: CurrentOperationalView; peoplePanelMode: PeoplePanelMode; peopleSearch: string;
  futurePanelMode?: FuturePanelMode; futureSearch?: string; selectedFuturePersonId?: string;
  selectedFutureTarget?: ShiftTimeline['future'][number] | null;
  historyMonth?: string; historySelectedDate?: string; pastDetailTab?: string; pastShiftKey?: string;
  dashboard?: { lineId: string; readOnly: boolean };
  planning?: { lineId: string; shiftDate: string; shiftType: string; templateId?: string; candidateId: string; slot: { positionId: string; slotIndex: number; label: string } | null };
  futureBoard?: { shiftDate: string; shiftType: string };
  workAreaId?: string;
  selectedAssignmentSlot?: { positionId: string; slotIndex: number; label: string } | null;
  selectedAssignmentCandidateId?: string;
  parentScroll?: Array<{ selector: string; top: number; left: number }>;
  pageTop?: number;
};
const taskReturnScrollSelectors = ['.current-people-panel', '.quick-assignment-sheet', '.compact-line-dashboard', '.work-area-assignment-board', '.planning-assignment-scroll', '.future-nonline-assignment-modal'];
type ShiftPeopleScreenProps = { mode?: 'workspace' | 'history'; taskReturn?: ShiftTaskReturn };

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function monthTitle(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return year && monthNumber ? `${MONTH_NAMES[monthNumber - 1]} ${year}` : 'История смен';
}

function moveMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  const index = year * 12 + monthNumber - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function monthCalendar(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return [] as Array<{ date: string; day: number } | null>;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const sundayFirst = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const mondayOffset = (sundayFirst + 6) % 7;
  return [
    ...Array.from({ length: mondayOffset }, () => null),
    ...Array.from({ length: days }, (_value, index) => ({
      date: `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
      day: index + 1,
    })),
  ];
}

export function ShiftPeopleScreen({ mode = 'workspace', taskReturn }: ShiftPeopleScreenProps = {}) {
  const { lines, currentUser, availableFactories, selectedFactoryId } = useAppStore();
  const historyOnly = mode === 'history';
  const [people, setPeople] = useState<ShiftPerson[]>([]);
  const [includeAllPeople, setIncludeAllPeople] = useState(taskReturn?.includeAllPeople ?? false);
  const [loading, setLoading] = useState(true);
  const [initialLoadCompleted, setInitialLoadCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState('Нет новых событий');
  const [shiftTab, setShiftTab] = useState<'past' | 'current' | 'next' | 'future'>(taskReturn?.shiftTab ?? (historyOnly ? 'past' : 'current'));
  const [currentOperationalView, setCurrentOperationalView] = useState<CurrentOperationalView>(taskReturn?.currentOperationalView ?? retainedCurrentOperationalView);
  const [shiftPickerOpen, setShiftPickerOpen] = useState(false);
  const [peoplePanelMode, setPeoplePanelMode] = useState<PeoplePanelMode>(taskReturn?.peoplePanelMode ?? null);
  const [peopleSearch, setPeopleSearch] = useState(taskReturn?.peopleSearch ?? '');
  const [selectedQuickPersonId, setSelectedQuickPersonId] = useState('');
  const [assignmentMenuUser, setAssignmentMenuUser] = useState<ShiftPerson | null>(null);
  const [assignmentFlowUser, setAssignmentFlowUser] = useState<ShiftPerson | null>(null);
  const [workAreaPickerUser, setWorkAreaPickerUser] = useState<ShiftPerson | null>(null);
  const [currentLinePickerSelection, setCurrentLinePickerSelection] = useState<CurrentLinePickerSelection>(null);
  const [currentSlotAction, setCurrentSlotAction] = useState<CurrentSlotAction>(null);
  const [futurePanelMode, setFuturePanelMode] = useState<FuturePanelMode>(taskReturn?.futurePanelMode ?? null);
  const [futureSearch, setFutureSearch] = useState(taskReturn?.futureSearch ?? '');
  const [selectedFuturePersonId, setSelectedFuturePersonId] = useState(taskReturn?.selectedFuturePersonId ?? '');
  const [shiftTimeline, setShiftTimeline] = useState<ShiftTimeline | null>(null);
  const [selfShift, setSelfShift] = useState<ShiftMeResponse | null>(null);
  const [futureShift, setFutureShift] = useState<FutureShift | null>(null);
  const [selectedFutureTarget, setSelectedFutureTarget] = useState<ShiftTimeline['future'][number] | null>(taskReturn?.selectedFutureTarget ?? null);
  const [pastShift, setPastShift] = useState<PastShift | null>(null);
  const [pastShiftDetail, setPastShiftDetail] = useState<PastShiftDetail | null>(null);
  const [pastDetailTab, setPastDetailTab] = useState(taskReturn?.pastDetailTab ?? 'Обзор');
  const [historyMonth, setHistoryMonth] = useState(taskReturn?.historyMonth ?? '');
  const [historySelectedDate, setHistorySelectedDate] = useState(taskReturn?.historySelectedDate ?? '');
  const [notNeededWillBe, setNotNeededWillBe] = useState<{ id: string; userId: string; displayName: string } | null>(null);
  const [notNeededReason, setNotNeededReason] = useState('');
  const [willBeComment, setWillBeComment] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [handoverView, setHandoverView] = useState<HandoverView | null>(null);
  const [previousHandover, setPreviousHandover] = useState<HandoverLogResponse | null>(null);
  const [handoverMode, setHandoverMode] = useState<'prepare' | 'previous' | null>(null);
  const [handoverComment, setHandoverComment] = useState('');
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [handoverAvailability, setHandoverAvailability] = useState<HandoverAvailability | null>(null);

  const [actionUser, setActionUser] = useState<ShiftPerson | null>(null);
  const [personAction, setPersonAction] = useState<PersonActionMode>(null);
  const [lineAction, setLineAction] = useState<LineActionMode>(null);
  const [pendingLine, setPendingLine] = useState<Line | null>(null);

  const [lineId, setLineId] = useState('');
  const [washSessionId, setWashSessionId] = useState('');
  const [washAssignmentReturnContext, setWashAssignmentReturnContext] = useState<WashAssignmentReturnContext | null>(null);
  const [positionId, setPositionId] = useState('');
  const [staffingTemplateId, setStaffingTemplateId] = useState('');
  const [homeComment, setHomeComment] = useState('');
  const [statusComment, setStatusComment] = useState('');
  const [lineEventTimeMode, setLineEventTimeMode] = useState<'NOW' | 'CUSTOM'>('NOW');
  const [lineEventTime, setLineEventTime] = useState('');
  const [lineEventServerNow, setLineEventServerNow] = useState<string | null>(null);
  const [downtimeReason, setDowntimeReason] = useState('TECHNICAL');
  const [downtimeReasonOptions, setDowntimeReasonOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [taskDescription, setTaskDescription] = useState('');
  const [taskDepartmentId, setTaskDepartmentId] = useState('');
  const [taskDepartments, setTaskDepartments] = useState<RecipientDepartment[]>([]);
  const [planPercent, setPlanPercent] = useState('');
  const [planComment, setPlanComment] = useState('');
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [activationTemplateId, setActivationTemplateId] = useState('');
  const [downtimeCorrectionTarget, setDowntimeCorrectionTarget] = useState<LineDashboard['recentEvents'][number] | null>(null);
  const [correctionStartAt, setCorrectionStartAt] = useState('');
  const [correctionEndAt, setCorrectionEndAt] = useState('');
  const [correctionComment, setCorrectionComment] = useState('');

  const [dashboard, setDashboard] = useState<LineDashboard | null>(null);
  const [dashboardReadOnly, setDashboardReadOnly] = useState(false);
  const [lineActionsOpen, setLineActionsOpen] = useState(false);
  const [assignmentBoard, setAssignmentBoard] = useState<AssignmentBoard | null>(null);
  const [planningBoard, setPlanningBoard] = useState<PlanningBoard | null>(null);
  const [futureAssignmentBoard, setFutureAssignmentBoard] = useState<FutureAssignmentBoard | null>(null);
  const [futureNonLinePending, setFutureNonLinePending] = useState<FutureNonLinePending | null>(null);
  const [planningLinePickerOpen, setPlanningLinePickerOpen] = useState(false);
  const [lineShiftAssignmentLine, setLineShiftAssignmentLine] = useState<{ id: string; name: string } | null>(null);
  const [selectedAssignmentSlot, setSelectedAssignmentSlot] = useState<{ positionId: string; slotIndex: number; label: string } | null>(taskReturn?.selectedAssignmentSlot ?? null);
  const [selectedAssignmentCandidateId, setSelectedAssignmentCandidateId] = useState<string>(taskReturn?.selectedAssignmentCandidateId ?? '');
  const [currentAssignmentConfirm, setCurrentAssignmentConfirm] = useState(false);
  const [selectedPlanningSlot, setSelectedPlanningSlot] = useState<{ positionId: string; slotIndex: number; label: string } | null>(taskReturn?.planning?.slot ?? null);
  const [selectedPlanningCandidateId, setSelectedPlanningCandidateId] = useState<string>(taskReturn?.planning?.candidateId ?? '');
  const [planningAssignmentConfirm, setPlanningAssignmentConfirm] = useState(false);
  const [manualSearchSheet, setManualSearchSheet] = useState<ManualSearchSheet>(null);
  const [manualSearchQuery, setManualSearchQuery] = useState('');
  const [manualSearchSelection, setManualSearchSelection] = useState<ManualSearchSelection>(null);
  const [lineShiftAssignment, setLineShiftAssignment] = useState<LineShiftAssignment | null>(null);
  const [assignmentRowForm, setAssignmentRowForm] = useState<{ id?: string; article: string; productName: string; plannedGofrCount: string } | null>(null);
  const [assignmentRowToDelete, setAssignmentRowToDelete] = useState<LineShiftAssignmentRow | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [returnLoading, setReturnLoading] = useState(Boolean(taskReturn?.profileId));
  useEffect(() => {
    if (!taskReturn?.profileId) return;
    let cancelled = false;
    // Only view selectors cross the task boundary. Re-read each existing guarded
    // parent, never retain an actionable board DTO or replay a planning command.
    const restore = async () => {
      try {
        const result = await Promise.all([
          apiClient.get<PersonProfile>(`/people/${encodeURIComponent(taskReturn.profileId)}/profile`),
          taskReturn.dashboard ? apiClient.get<LineDashboard>(`/lines/${encodeURIComponent(taskReturn.dashboard.lineId)}/${taskReturn.dashboard.readOnly ? 'current-shift-detail' : 'dashboard'}`) : null,
          taskReturn.dashboard && !taskReturn.dashboard.readOnly ? apiClient.get<AssignmentBoard>(`/lines/${encodeURIComponent(taskReturn.dashboard.lineId)}/assignment-board`) : null,
          taskReturn.planning ? apiClient.get<PlanningBoard>(`/lines/${encodeURIComponent(taskReturn.planning.lineId)}/planning-board?${new URLSearchParams({ shiftDate: taskReturn.planning.shiftDate, shiftType: taskReturn.planning.shiftType, ...(taskReturn.planning.templateId ? { staffingTemplateId: taskReturn.planning.templateId } : {}) })}`) : null,
          taskReturn.futureBoard ? apiClient.get<FutureAssignmentBoard>(`/shift/future-assignment-board?${new URLSearchParams({ targetShiftDate: taskReturn.futureBoard.shiftDate, shiftType: taskReturn.futureBoard.shiftType })}`) : null,
          taskReturn.workAreaId ? apiClient.get<WorkAreaBoard>(`/work-areas/${encodeURIComponent(taskReturn.workAreaId)}/board`) : null,
          taskReturn.pastShiftKey ? apiClient.get<PastShiftDetail>(`/shift/past/${encodeURIComponent(taskReturn.pastShiftKey)}`) : null,
        ]);
        if (cancelled) return;
        setProfile(result[0]); setDashboard(result[1]); setAssignmentBoard(result[2]);
        setDashboardReadOnly(Boolean(taskReturn.dashboard?.readOnly));
        setPlanningBoard(result[3]); setFutureAssignmentBoard(result[4]); setWorkAreaBoard(result[5]); setPastShiftDetail(result[6]);
      } catch (error) {
        if (!cancelled) setErrorText(errorMessage(error, 'Не удалось восстановить контекст смены. Откройте профиль повторно.'));
      } finally { if (!cancelled) setReturnLoading(false); }
    };
    void restore();
    return () => { cancelled = true; };
  }, []);
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([]);
  const [workAreaBoard, setWorkAreaBoard] = useState<WorkAreaBoard | null>(null);
  const [workAreaLoading, setWorkAreaLoading] = useState(false);
  const [contractorLeadPool, setContractorLeadPool] = useState<ContractorLeadPool | null>(null);
  const [contractorLeadSubmissions, setContractorLeadSubmissions] = useState<ContractorLeadSubmission[]>([]);
  const [selectedContractorIds, setSelectedContractorIds] = useState<string[]>([]);
  const [requirementEditor, setRequirementEditor] = useState<RequirementEditor | null>(null);
  const [requirementValue, setRequirementValue] = useState(0);
  const [requirementPreview, setRequirementPreview] = useState<RequirementPreview | null>(null);
  const [templateRemapDialog, setTemplateRemapDialog] = useState<TemplateRemapDialog | null>(null);
  const shiftSignatureRef = useRef('');
  const shiftPickerTouchStartY = useRef<number | null>(null);
  const lineBoardScrollRef = useRef<HTMLDivElement | null>(null);
  const workAreaBoardScrollRef = useRef<HTMLDivElement | null>(null);
  const futureAssignmentAttemptRef = useRef<{ key: string; operationId: string } | null>(null);
  const futureReleaseAttemptRef = useRef<{ assignmentId: string; operationId: string } | null>(null);
  const returnScrollRestored = useRef(false);
  useEffect(() => {
    if (!taskReturn || returnLoading || !initialLoadCompleted || profile || returnScrollRestored.current) return;
    const frame = requestAnimationFrame(() => {
      for (const saved of taskReturn.parentScroll ?? []) {
        if (!taskReturnScrollSelectors.includes(saved.selector)) continue;
        document.querySelector<HTMLElement>(saved.selector)?.scrollTo({ top: saved.top, left: saved.left });
      }
      if (!document.body.classList.contains('app-scroll-locked')) window.scrollTo({ top: taskReturn.pageTop ?? 0, left: 0 });
      returnScrollRestored.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [returnLoading, initialLoadCompleted, profile]);

  useBodyScrollLock(Boolean(
    shiftPickerOpen
    || peoplePanelMode
    || manualSearchSheet
    || assignmentMenuUser
    || workAreaPickerUser
    || currentLinePickerSelection
    || notNeededWillBe
    || currentSlotAction
    || planningLinePickerOpen
    || workAreaBoard
    || futureAssignmentBoard
    || futureNonLinePending
    || planningBoard
    || dashboard
    || lineActionsOpen
    || lineAction
    || (actionUser && personAction)
    || profile
    || handoverMode
    || lineShiftAssignment
    || assignmentRowForm
    || assignmentRowToDelete
    || downtimeCorrectionTarget
    || requirementEditor
    || templateRemapDialog
  ));

  const isManagerView = Boolean(
    currentUser?.isAdmin ||
    currentUser?.role === 'MASTER' ||
    currentUser?.role === 'MANAGEMENT' ||
    currentUser?.permissions.includes('assignments.manage'),
  );
  const canManageLineStatus = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('lines.manage'));
  const canReadDefrost = Boolean(
    currentUser?.isAdmin
    || currentUser?.permissions.includes('defrost.read')
    || currentUser?.permissions.includes('defrost.manage'),
  );
  const isContractorLead = currentUser?.role === 'CONTRACTOR_LEAD';
  const isStoreReader = currentUser?.role === 'STORE';
  const isTechnicalReader = Boolean(currentUser?.role && [
    'TECH_MECHANIC',
    'TECH_ELECTRIC',
    'TECH_HOLOD',
    'TECH_KIPIA',
    'TECH_SANTECHNIK',
  ].includes(currentUser.role));
  const isOperationalReader = Boolean(
    !isManagerView &&
    (currentUser?.permissions.includes('shift.current.read') || currentUser?.permissions.includes('shift.future.read') || isStoreReader),
  );
  const canReadPastShift = Boolean(
    currentUser?.isAdmin ||
    currentUser?.permissions.includes('shift.past.read') ||
    currentUser?.permissions.includes('shift.self.read'),
  );
  const canHandover = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('shift.current.manage'));
  const canReadHandover = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('shift-log.read'));
  const canLoadShiftTimeline = Boolean(
    currentUser?.isAdmin
    || currentUser?.permissions.includes('shift.self.read')
    || currentUser?.permissions.includes('shift.future.read')
    || currentUser?.permissions.includes('shift.future.manage'),
  );
  useMobileBackLayer(Boolean(handoverMode), () => setHandoverMode(null), 1010);
  useMobileBackLayer(shiftPickerOpen, () => setShiftPickerOpen(false), 720);
  useMobileBackLayer(Boolean(peoplePanelMode), () => setPeoplePanelMode(null), 760);
  useMobileBackLayer(Boolean(assignmentMenuUser), () => {
    setAssignmentMenuUser(null);
    setAssignmentFlowUser(null);
  }, 820);
  useMobileBackLayer(Boolean(workAreaPickerUser), () => {
    setWorkAreaPickerUser(null);
    if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser);
  }, 850);
  useMobileBackLayer(Boolean(currentLinePickerSelection), () => {
    setCurrentLinePickerSelection(null);
    if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser);
  }, 840);
  useMobileBackLayer(Boolean(currentSlotAction), () => setCurrentSlotAction(null), 960);
  useMobileBackLayer(Boolean(requirementEditor), () => { setRequirementEditor(null); setRequirementPreview(null); }, 975);
  useMobileBackLayer(Boolean(templateRemapDialog), () => {
    if (templateRemapDialog?.scope === 'ACTIVATE') setLineAction('activateLine');
    setTemplateRemapDialog(null);
  }, 985);
  useMobileBackLayer(Boolean(futureNonLinePending), () => setFutureNonLinePending(null), 990);
  useMobileBackLayer(Boolean(futureAssignmentBoard), () => setFutureAssignmentBoard(null), 900);
  useMobileBackLayer(Boolean(planningBoard), () => {
    setPlanningBoard(null);
    setSelectedPlanningSlot(null);
    setSelectedPlanningCandidateId('');
    setPlanningAssignmentConfirm(false);
  }, 800);
  useMobileBackLayer(Boolean(assignmentRowForm), () => setAssignmentRowForm(null), 920);
  useMobileBackLayer(Boolean(assignmentRowToDelete), () => setAssignmentRowToDelete(null), 930);
  useMobileBackLayer(Boolean(downtimeCorrectionTarget), () => setDowntimeCorrectionTarget(null), 930);
  useMobileBackLayer(Boolean(lineShiftAssignment), () => {
    setLineShiftAssignment(null);
    setLineShiftAssignmentLine(null);
    setAssignmentRowForm(null);
    setAssignmentRowToDelete(null);
  }, 810);
  useMobileBackLayer(Boolean(dashboard && selectedAssignmentSlot), () => {
    setSelectedAssignmentSlot(null);
    setSelectedAssignmentCandidateId('');
    setCurrentAssignmentConfirm(false);
  }, 940);
  useMobileBackLayer(Boolean(notNeededWillBe), () => {
    setNotNeededWillBe(null);
    setNotNeededReason('');
  }, 970);
  useMobileBackLayer(historyOnly && Boolean(pastShiftDetail), () => {
    setPastShiftDetail(null);
    setPastDetailTab('Обзор');
  }, 740);
  useMobileBackLayer(Boolean(manualSearchSheet), () => {
    setManualSearchSheet(null);
    setManualSearchQuery('');
  }, 980);
  useMobileBackLayer(Boolean(lineAction), () => {
    setLineAction(null);
    setPendingLine(null);
    if (assignmentFlowUser && (lineAction === 'work' || lineAction === 'activateLine')) {
      setCurrentLinePickerSelection({ userId: assignmentFlowUser.userId, displayName: assignmentFlowUser.displayName, mode: 'assign' });
    }
  }, 1000);
  useMobileBackLayer(Boolean(actionUser && personAction), () => {
    setPersonAction(null);
    setActionUser(null);
    if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser);
  }, 1000);
  useMobileBackLayer(Boolean(profile), () => setProfile(null), 1010);
  useMobileBackLayer(Boolean(dashboard), () => {
    setLineActionsOpen(false);
    setDashboard(null);
    setAssignmentBoard(null);
    setSelectedAssignmentSlot(null);
    setSelectedAssignmentCandidateId('');
    setCurrentAssignmentConfirm(false);
    if (assignmentFlowUser) {
      setCurrentLinePickerSelection({ userId: assignmentFlowUser.userId, displayName: assignmentFlowUser.displayName, mode: 'assign' });
    }
  }, 740);
  useMobileBackLayer(Boolean(workAreaBoard), () => {
    setWorkAreaBoard(null);
    setSelectedAssignmentSlot(null);
    setSelectedAssignmentCandidateId('');
    if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser);
  }, 780);
  useEffect(() => {
    if (isManagerView) return;
    setManualSearchSheet(null);
    setManualSearchQuery('');
    setManualSearchSelection(null);
  }, [isManagerView, currentUser?.role, currentUser?.permissions]);
  const pilotLines = useMemo(() => dedupeLines(lines.filter((line) => !isPilotFixtureText(line.id, line.name))), [lines]);
  const selectedLine = useMemo(() => pilotLines.find((line) => line.id === lineId) ?? null, [lineId, pilotLines]);
  const selectedTemplate = useMemo(() => {
    if (!selectedLine) return null;
    return selectedLine.staffingTemplates?.find((template) => template.id === staffingTemplateId) ?? selectedLine.activeTemplate ?? null;
  }, [selectedLine, staffingTemplateId]);
  const sortedLines = useMemo(() => {
    return [...pilotLines].sort((a, b) => {
      const activeA = a.isActiveForShift ? 1 : 0;
      const activeB = b.isActiveForShift ? 1 : 0;
      if (activeA !== activeB) return activeB - activeA;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [pilotLines]);
  const washLines = useMemo(() => sortedLines.filter((line) => line.operationalState === 'WASH'), [sortedLines]);
  const defrostLines = useMemo(() => sortedLines.filter((line) => line.operationalState === 'DEFROST'), [sortedLines]);
  const activeLines = useMemo(
    () => sortedLines.filter((line) => line.operationalState === 'RUNNING' || line.operationalState === 'DOWNTIME'),
    [sortedLines],
  );
  const activeDowntimeLines = useMemo(
    () => activeLines.filter((line) => line.operationalState === 'DOWNTIME'),
    [activeLines],
  );
  const workingLines = useMemo(() => activeLines.filter((line) => line.operationalState === 'RUNNING'), [activeLines]);
  const otherActiveLines = useMemo(
    () => activeLines.filter((line) => !line.operationalState),
    [activeDowntimeLines, activeLines],
  );
  const timeAreas = useMemo(() => workAreas.filter((area) => area.assignmentKind === 'TIME'), [workAreas]);
  const operationalWorkAreas = useMemo(() => workAreas.filter((area) => area.assignmentKind !== 'TIME'), [workAreas]);
  const stoppedLines = useMemo(
    () => sortedLines.filter((line) => line.operationalState === 'STOPPED'),
    [sortedLines],
  );
  const inactiveLines = useMemo(
    () => sortedLines.filter((line) => !line.operationalState),
    [sortedLines],
  );
  const currentOperationalLines = useMemo(
    () => [...workingLines, ...activeDowntimeLines, ...otherActiveLines, ...washLines, ...defrostLines, ...stoppedLines, ...inactiveLines],
    [activeDowntimeLines, defrostLines, inactiveLines, otherActiveLines, stoppedLines, washLines, workingLines],
  );
  const productionStaffLines = useMemo(
    () => sortedLines.filter((line) => line.includedInProductionStaffTotal),
    [sortedLines],
  );
  const assignedLineWorkersCount = useMemo(
    () => {
      const visibleUserIds = new Set(productionStaffLines.flatMap((line) => line.activeAssignments?.map((assignment) => assignment.userId) ?? []));
      if (visibleUserIds.size) return visibleUserIds.size;
      return productionStaffLines.reduce((total, line) => total + (line.productionStaffAssignedCount ?? 0), 0);
    },
    [productionStaffLines],
  );
  const requiredLineWorkersCount = useMemo(
    () => productionStaffLines.reduce((total, line) => total + (line.productionStaffRequiredCount ?? 0), 0),
    [productionStaffLines],
  );
  const operationalTaskLines = useMemo(
    () => sortedLines.filter((line) => Boolean(line.activeTaskSummary) || (line.activeTasksCount ?? 0) > 0),
    [sortedLines],
  );
  const pendingActivationLine = useMemo(() => {
    return pendingLine ?? inactiveLines.find((line) => line.id === lineId) ?? null;
  }, [inactiveLines, lineId, pendingLine]);

  const peopleGroups = useMemo(() => {
    const groups = new Map<string, ShiftPerson[]>();
    for (const person of people.filter((item) => !isPilotFixtureUser(item.userId, item.displayName))) {
      const key = person.category ?? person.departmentName ?? 'Прочие';
      groups.set(key, [...(groups.get(key) ?? []), person]);
    }
    return Array.from(groups.entries());
  }, [people]);

  const runtimePeople = useMemo(
    () => people.filter((item) => !isPilotFixtureUser(item.userId, item.displayName)),
    [people],
  );

  const workforcePeople = useMemo(
    () => runtimePeople.filter((item) => isAssignableRole(item.role)),
    [runtimePeople],
  );

  const freeWorkforcePeople = useMemo(
    () => workforcePeople.filter((item) => item.employeeState === 'AVAILABLE' && !item.currentAssignment),
    [workforcePeople],
  );

  const assignedWorkforcePeople = useMemo(
    () => workforcePeople.filter((item) => Boolean(item.currentAssignment) || activePersonStates.includes(item.employeeState)),
    [workforcePeople],
  );

  const availablePeople = useMemo(
    () => freeWorkforcePeople,
    [freeWorkforcePeople],
  );

  const activePeople = useMemo(
    () => assignedWorkforcePeople,
    [assignedWorkforcePeople],
  );

  const peoplePanelTitle = peoplePanelMode === 'available'
    ? 'Свободные люди'
    : peoplePanelMode === 'active'
      ? 'Люди в работе'
      : 'Люди на смене';

  const peoplePanelList = useMemo(() => {
    const source = peoplePanelMode === 'available'
      ? freeWorkforcePeople
      : peoplePanelMode === 'active'
        ? assignedWorkforcePeople
        : workforcePeople;
    const query = peopleSearch.trim().toLowerCase();
    if (!query) return source;
    return source.filter((person) => [
      person.displayName,
      shortPersonName(person.userId, person.displayName),
      roleLabels[person.role] ?? person.role,
      person.departmentName ?? '',
      person.currentAssignment?.lineName ?? '',
      person.currentAssignment?.positionName ?? '',
      person.currentAssignment?.timeRoleName ?? '',
    ].join(' ').toLowerCase().includes(query));
  }, [assignedWorkforcePeople, freeWorkforcePeople, peoplePanelMode, peopleSearch, workforcePeople]);

  const filteredFreeWorkforcePeople = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    if (!query) return freeWorkforcePeople;
    return freeWorkforcePeople.filter((person) => [
      person.displayName,
      shortPersonName(person.userId, person.displayName),
      roleLabels[person.role] ?? person.role,
      person.departmentName ?? '',
    ].join(' ').toLowerCase().includes(query));
  }, [freeWorkforcePeople, peopleSearch]);

  const filteredAssignedWorkforcePeople = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    if (!query) return assignedWorkforcePeople;
    return assignedWorkforcePeople.filter((person) => [
      person.displayName,
      shortPersonName(person.userId, person.displayName),
      roleLabels[person.role] ?? person.role,
      person.departmentName ?? '',
      person.currentAssignment?.lineName ?? '',
      person.currentAssignment?.positionName ?? '',
      person.currentAssignment?.timeRoleName ?? '',
    ].join(' ').toLowerCase().includes(query));
  }, [assignedWorkforcePeople, peopleSearch]);

  const selectedQuickPerson = useMemo(
    () => runtimePeople.find((person) => person.userId === selectedQuickPersonId) ?? null,
    [runtimePeople, selectedQuickPersonId],
  );

  const futureWillBePeople = useMemo(
    () => (futureShift?.willBe ?? []).filter((item) => item.status === 'WILL_BE'),
    [futureShift?.willBe],
  );

  const futureContractorPeople = useMemo(() => {
    return (futureShift?.contractorSubmissions ?? []).flatMap((submission) => (
      submission.items.map((item) => ({
        ...item,
        leadName: submission.leadName,
        companyName: submission.companyName,
        submissionStatus: submission.status,
      }))
    ));
  }, [futureShift?.contractorSubmissions]);

  const plannedFutureLines = futureShift?.plannedLines ?? [];

  const futurePanelTitle = futurePanelMode === 'willBe'
    ? 'Отметились “Я буду”'
    : futurePanelMode === 'contractors'
      ? 'Наёмники будущей смены'
      : 'Плановые линии';

  const filteredFutureWillBe = useMemo(() => {
    const query = futureSearch.trim().toLowerCase();
    if (!query) return futureWillBePeople;
    return futureWillBePeople.filter((item) => [
      item.displayName,
      shortPersonName(item.userId ?? item.id, item.displayName),
      willBeStatusLabel(item.status),
      item.comment ?? '',
    ].join(' ').toLowerCase().includes(query));
  }, [futureSearch, futureWillBePeople]);

  const filteredFutureContractors = useMemo(() => {
    const query = futureSearch.trim().toLowerCase();
    if (!query) return futureContractorPeople;
    return futureContractorPeople.filter((item) => [
      item.displayName,
      item.leadName,
      item.status,
      item.submissionStatus,
    ].join(' ').toLowerCase().includes(query));
  }, [futureContractorPeople, futureSearch]);

  const filteredPlannedFutureLines = useMemo(() => {
    const query = futureSearch.trim().toLowerCase();
    if (!query) return plannedFutureLines;
    return plannedFutureLines.filter((line) => [
      line.lineName,
      line.statusLabel,
      line.staffingTemplateName ?? '',
      line.shortageCount ? `не хватает ${line.shortageCount}` : '',
    ].join(' ').toLowerCase().includes(query));
  }, [futureSearch, plannedFutureLines]);

  const selectedFuturePersonName = useMemo(() => {
    if (!selectedFuturePersonId) return '';
    const willBe = futureWillBePeople.find((item) => item.userId === selectedFuturePersonId);
    const contractor = futureContractorPeople.find((item) => item.contractorUserId === selectedFuturePersonId);
    const planned = futureShift?.plannedNonLineAssignments?.find((item) => item.userId === selectedFuturePersonId);
    const candidate = planningBoard?.candidates.find((item) => item.userId === selectedFuturePersonId);
    return willBe?.displayName ?? contractor?.displayName ?? planned?.displayName ?? candidate?.displayName ?? '';
  }, [futureContractorPeople, futureShift?.plannedNonLineAssignments, futureWillBePeople, planningBoard?.candidates, selectedFuturePersonId]);

  const futurePlanForUser = (userId?: string | null) => {
    if (!userId) return null;
    return futureShift?.plannedNonLineAssignments?.find((item) => item.userId === userId) ?? null;
  };

  const currentCandidateSkill = (candidate: AssignmentBoard['candidates'][number]) => {
    if (!selectedAssignmentSlot) {
      const recommended = candidate.skillMatches?.find((match) => match.recommended);
      return {
        className: recommended?.type === 'DIRECT' ? 'skill-direct' : recommended?.type === 'SIMILAR' ? 'skill-similar' : 'skill-neutral',
        label: recommended?.label ?? 'Выберите слот для проверки навыка',
      };
    }
    const match = candidate.skillMatches?.find((item) => item.positionId === selectedAssignmentSlot.positionId)
      ?? candidate.skillMatches?.find((item) => item.type === 'SIMILAR')
      ?? null;
    if (match?.type === 'DIRECT') return { className: 'skill-direct', label: match.label || 'Подходит по навыку' };
    if (match?.type === 'SIMILAR') return { className: 'skill-similar', label: match.label || 'Похожий навык' };
    return { className: 'skill-none', label: 'Нет отмеченного навыка для этого слота' };
  };

  const planningCandidateSkill = (candidate: PlanningBoard['candidates'][number]) => {
    if (!selectedPlanningSlot) {
      const recommended = candidate.skillMatches?.find((match) => match.recommended);
      return {
        className: recommended?.type === 'DIRECT' ? 'skill-direct' : recommended?.type === 'SIMILAR' ? 'skill-similar' : 'skill-none',
        label: recommended?.label ?? 'Выберите слот для проверки навыка',
      };
    }
    const match = candidate.skillMatches?.find((item) => item.positionId === selectedPlanningSlot.positionId)
      ?? candidate.skillMatches?.find((item) => item.type === 'SIMILAR')
      ?? null;
    if (match?.type === 'DIRECT') return { className: 'skill-direct', label: match.label || 'Подходит по навыку' };
    if (match?.type === 'SIMILAR') return { className: 'skill-similar', label: match.label || 'Похожий навык' };
    return { className: 'skill-none', label: 'Нет отмеченного навыка для этого слота' };
  };

  const assignmentDestinationLabel = (person: ShiftPerson) => {
    const assignment = person.currentAssignment;
    if (!assignment) return 'Свободен для назначения';
    if (assignment.lineName) {
      return `${assignment.lineName}${assignment.positionName ? ` · ${assignment.positionName}` : ''}${assignment.slotIndex ? ` · слот ${assignment.slotIndex}` : ''}`;
    }
    if (assignment.kind === 'WASH' || assignment.washSessionId) return 'Мойка';
    if (assignment.kind === 'WORK_AREA') return assignment.timeRoleName ?? 'Рабочая зона';
    return assignment.timeRoleName ?? 'Повременщик';
  };

  const candidateAssignmentDestination = (assignment?: ShiftPerson['currentAssignment']) => {
    if (!assignment) return 'Свободен для назначения';
    if (assignment.lineId) {
      const lineName = pilotLines.find((line) => line.id === assignment.lineId)?.name ?? 'Другая линия';
      return `${lineName}${assignment.positionName ? ` · ${assignment.positionName}` : ''}`;
    }
    if (assignment.kind === 'WASH' || assignment.washSessionId) return 'Сейчас на мойке';
    if (assignment.kind === 'WORK_AREA') return assignment.timeRoleName ?? 'Рабочая зона';
    return assignment.timeRoleName ?? 'Повременщик';
  };

  const assignmentKindLabel = (person: ShiftPerson) => {
    const kind = person.currentAssignment?.kind;
    if (kind === 'LINE') return 'Линия';
    if (kind === 'WASH') return 'Мойка';
    if (kind === 'WORK_AREA') return 'Рабочая зона';
    if (kind === 'TIME') return 'Повременщик';
    return 'Свободен';
  };

  const selectCurrentCandidate = (userId: string) => {
    if (manualSearchSelection?.result.userId !== userId) setManualSearchSelection(null);
    setSelectedAssignmentCandidateId(userId);
    setCurrentAssignmentConfirm(false);
  };

  const selectCurrentSlot = (slot: { positionId: string; slotIndex: number; label: string }) => {
    setSelectedAssignmentSlot(slot);
    setSelectedAssignmentCandidateId('');
    setCurrentAssignmentConfirm(false);
  };

  const selectPlanningCandidate = (userId: string) => {
    if (manualSearchSelection?.result.userId !== userId) setManualSearchSelection(null);
    setSelectedPlanningCandidateId(userId);
    setPlanningAssignmentConfirm(false);
  };

  const selectPlanningSlot = (slot: { positionId: string; slotIndex: number; label: string }) => {
    setSelectedPlanningSlot(slot);
    setPlanningAssignmentConfirm(false);
  };

  const showToast = (message: string) => {
    setToastText(message);
    window.setTimeout(() => setToastText((current) => (current === message ? null : current)), 3500);
  };

  const postCurrentShiftAction = <T,>(url: string, body: Record<string, unknown> = {}) =>
    apiClient.request<T>(url, {
      method: 'POST',
      body: JSON.stringify({ ...body, operationId: body.operationId ?? crypto.randomUUID() }),
    });

  const loadContractorLeadData = async () => {
    const [pool, submissions] = await Promise.all([
      apiClient.get<ContractorLeadPool>('/shift/contractor-lead/pool'),
      apiClient.get<ContractorLeadSubmission[]>('/shift/contractor-lead/current'),
    ]);
    setContractorLeadPool(pool);
    setContractorLeadSubmissions(submissions);
  };

  const load = async (options?: { silent?: boolean }) => {
    if (!options?.silent && !initialLoadCompleted) setLoading(true);
    if (!options?.silent) setErrorText(null);
    try {
      if (isManagerView || isOperationalReader) {
        const [peopleData, linesData, workAreasData, timelineData] = await withShiftLoadTimeout(Promise.all([
          apiClient.get<ShiftPerson[]>(`/shift/people?includeAll=${includeAllPeople ? 'true' : 'false'}`),
          isStoreReader
            ? Promise.resolve([])
            : apiClient.get<Line[]>(isManagerView ? '/lines' : '/lines/shift-overview'),
          apiClient.get<WorkArea[]>('/work-areas').catch(() => []),
          canLoadShiftTimeline ? apiClient.get<ShiftTimeline>('/shift/timeline') : Promise.resolve(null),
        ]));
        setPeople(peopleData);
        appStore.setLines(linesData);
        setWorkAreas(workAreasData);
        setShiftTimeline(timelineData);
        const nextSignature = shiftRuntimeSignature({ people: peopleData, lines: linesData, timeline: timelineData, future: futureShift, board: assignmentBoard, planningBoard });
        if (shiftSignatureRef.current && nextSignature !== shiftSignatureRef.current) {
          setLiveStatus('Обновлено: смена или назначения изменились');
        }
        shiftSignatureRef.current = nextSignature;
      } else {
        const [self, selfWorkAreas, selfLines, timelineData] = await withShiftLoadTimeout(Promise.all([
          apiClient.get<ShiftMeResponse>('/shift/me'),
          currentUser?.role === 'WORKER' ? apiClient.get<WorkArea[]>('/work-areas').catch(() => []) : Promise.resolve([]),
          currentUser?.role === 'WORKER' ? apiClient.get<Line[]>('/lines/shift-overview').catch(() => []) : Promise.resolve([]),
          canLoadShiftTimeline ? apiClient.get<ShiftTimeline>('/shift/timeline') : Promise.resolve(null),
        ]));
        setSelfShift(self);
        setPeople(self.user ? [self.user] : []);
        appStore.setLines(selfLines);
        setWorkAreas(selfWorkAreas);
        setShiftTimeline(timelineData);
        const nextSignature = shiftRuntimeSignature({ people: self.user ? [self.user] : [], lines: [], timeline: timelineData, future: futureShift, board: assignmentBoard, planningBoard });
        if (shiftSignatureRef.current && nextSignature !== shiftSignatureRef.current) {
          setLiveStatus('Обновлено: данные смены изменились');
        }
        shiftSignatureRef.current = nextSignature;
      }
      if (isContractorLead) {
        await loadContractorLeadData();
      } else {
        setContractorLeadPool(null);
        setContractorLeadSubmissions([]);
        setSelectedContractorIds([]);
      }
    } catch (error) {
      if (!options?.silent) setErrorText(errorMessage(error, 'Не удалось загрузить смену'));
    } finally {
      if (!options?.silent) {
        setLoading(false);
        setInitialLoadCompleted(true);
      }
    }
  };

  useEffect(() => {
    void load();
  }, [includeAllPeople, isManagerView, isOperationalReader, isContractorLead, isStoreReader, canLoadShiftTimeline, currentUser?.role]);

  useEffect(() => {
    void Promise.all([
      canManageLineStatus
        ? apiClient.get<Array<{ value: string; label: string }>>('/lines/downtime-reasons')
        : Promise.resolve([]),
      apiClient.get<{ timestamp: string }>('/health'),
    ]).then(([reasons, health]) => {
      setDowntimeReasonOptions(reasons);
      if (canManageLineStatus) {
        setDowntimeReason((current) => reasons.some((item) => item.value === current) ? current : reasons[0]?.value ?? '');
      }
      if (health.timestamp) setLineEventServerNow(health.timestamp);
    }).catch(() => setDowntimeReasonOptions([]));
  }, [canManageLineStatus, selectedFactoryId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void apiClient.get<{ timestamp: string }>('/health')
        .then((health) => { if (health.timestamp) setLineEventServerNow(health.timestamp); })
        .catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const refreshOperationalData = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load({ silent: true }), 60);
    };
    window.addEventListener('zavod:operational-data-invalidated', refreshOperationalData);
    return () => {
      window.removeEventListener('zavod:operational-data-invalidated', refreshOperationalData);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [includeAllPeople, isManagerView, isOperationalReader, isContractorLead, isStoreReader, canLoadShiftTimeline, currentUser?.role]);

  const loadHandoverContext = async () => {
    if (!canReadHandover) return;
    const [previous, availability] = await Promise.all([
      apiClient.get<HandoverLogResponse | null>('/shift-log/handover/previous').catch(() => null),
      canHandover ? apiClient.get<HandoverAvailability>('/shift-log/handover/availability').catch(() => null) : Promise.resolve(null),
    ]);
    setPreviousHandover(previous);
    setHandoverAvailability(availability);
    if (availability?.available && canHandover) {
      const summary = await apiClient.get<HandoverView>('/shift-log/handover/summary').catch(() => null);
      if (summary) setHandoverView(summary);
    } else {
      setHandoverView(null);
    }
  };

  useEffect(() => {
    if (shiftTab !== 'current' || !canReadHandover) return;
    void loadHandoverContext();
    const timer = window.setInterval(() => void loadHandoverContext(), 30_000);
    return () => window.clearInterval(timer);
  }, [shiftTab, canReadHandover, canHandover, selectedFactoryId]);

  const openHandoverSummary = async () => {
    if (!canHandover || !handoverAvailability?.available || handoverLoading) return;
    setHandoverLoading(true);
    setErrorText(null);
    try {
      const summary = await apiClient.get<HandoverView>('/shift-log/handover/summary');
      setHandoverView(summary);
      setHandoverComment(summary.snapshot.comment ?? '');
      setHandoverMode('prepare');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось собрать сводку передачи смены'));
    } finally {
      setHandoverLoading(false);
    }
  };

  const refreshHandoverSummary = async () => {
    if (handoverLoading) return;
    setHandoverLoading(true);
    setErrorText(null);
    try {
      const summary = await apiClient.get<HandoverView>('/shift-log/handover/summary');
      setHandoverView(summary);
      showToast(summary.alreadyHandedOver ? 'Открыта сохранённая передача смены' : 'Оперативная сводка обновлена');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось обновить сводку'));
    } finally {
      setHandoverLoading(false);
    }
  };

  const submitHandover = async () => {
    if (!handoverView || handoverView.alreadyHandedOver || handoverLoading) return;
    setHandoverLoading(true);
    setErrorText(null);
    try {
      const created = await apiClient.post<HandoverLogResponse>('/shift-log/handover', { comment: handoverComment.trim() || null });
      setHandoverView({ ...created.handover, logId: created.id, alreadyHandedOver: true, immutable: true });
      showToast(created.message || 'Смена передана следующей смене');
      await loadHandoverContext();
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось передать смену'));
    } finally {
      setHandoverLoading(false);
    }
  };

  const openPreviousHandover = async () => {
    if (!previousHandover) return;
    setHandoverLoading(true);
    try {
      const log = await apiClient.get<HandoverLogResponse>(`/shift-log/${previousHandover.id}`);
      await apiClient.post(`/shift-log/${previousHandover.id}/read`, {});
      setPreviousHandover(log);
      setHandoverMode('previous');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось открыть передачу предыдущей смены'));
    } finally {
      setHandoverLoading(false);
    }
  };

  useEffect(() => {
    const loadTab = async () => {
      try {
        if (shiftTab === 'next' || shiftTab === 'future') {
          const target = shiftTab === 'future' ? selectedFutureTarget : null;
          const query = target
            ? `?${new URLSearchParams({ targetShiftDate: target.shiftDate, shiftType: target.shiftType })}`
            : '';
          setFutureShift(await apiClient.get<FutureShift>(`/shift/future${query}`));
        }
        if (shiftTab === 'past' && canReadPastShift) {
          const query = historyOnly && historyMonth ? `?month=${encodeURIComponent(historyMonth)}` : '';
          const data = await apiClient.get<PastShift>(`/shift/past${query}`);
          setPastShift(data);
          if (historyOnly && !historyMonth) setHistoryMonth(data.month);
        }
      } catch (error) {
        setErrorText(errorMessage(error, 'Не удалось загрузить данные смены'));
      }
    };
    void loadTab();
  }, [shiftTab, isManagerView, canReadPastShift, selectedFutureTarget?.shiftDate, selectedFutureTarget?.shiftType, historyOnly, historyMonth]);

  useEffect(() => {
    if (!selectedLine) return;
    const template = selectedLine.activeTemplate ?? null;
    setStaffingTemplateId(template?.id ?? '');
    setPositionId(selectedLine.positions?.[0]?.id ?? '');
  }, [selectedLine?.id]);

  useEffect(() => {
    if (shiftTab !== 'future') return;
    if (!selectedFutureTarget && shiftTimeline?.future?.length) {
      setSelectedFutureTarget(shiftTimeline.future[0]);
    }
  }, [shiftTab, shiftTimeline?.future, selectedFutureTarget]);

  const selectedFactoryName = useMemo(
    () => availableFactories.find((factory) => factory.id === selectedFactoryId)?.name ?? 'завод не выбран',
    [availableFactories, selectedFactoryId],
  );

  const shiftModeInfo = useMemo(() => {
    if (shiftTab === 'past') {
      const shiftDate = pastShiftDetail?.shiftDate ?? pastShift?.shifts?.[0]?.shiftDate ?? shiftTimeline?.past?.[0]?.shiftDate ?? '';
      const shiftType = pastShiftDetail?.shiftType ?? pastShift?.shifts?.[0]?.shiftType ?? shiftTimeline?.past?.[0]?.shiftType ?? '';
      const openedTitle = pastShiftDetail?.title ?? pastShift?.shifts?.[0]?.title ?? shiftTimeline?.past?.[0]?.label ?? 'Прошлая смена';
      return {
        title: 'Прошлая смена',
        subtitle: openedTitle,
        details: shiftDate
          ? `${formatShiftDateLabel(shiftDate)} · ${shiftKindLabel(shiftType)} · ${pastShiftDetail?.timeRange ?? shiftKindRange(shiftType)}`
          : 'Выберите смену в архиве',
        status: 'Архив открыт только для просмотра',
        badge: 'Архив',
      };
    }
    if (shiftTab === 'next') {
      const target = shiftTimeline?.next;
      return {
        title: 'Следующая смена',
        subtitle: target?.label ?? 'План следующей смены',
        details: target
          ? `${formatShiftDateLabel(target.shiftDate)} · ${shiftKindLabel(target.shiftType)} · ${shiftKindRange(target.shiftType)}`
          : 'План смены загружается',
        status: 'Планирование не меняет текущую смену',
        badge: 'План',
      };
    }
    if (shiftTab === 'future') {
      const target = selectedFutureTarget ?? shiftTimeline?.future?.[0];
      return {
        title: 'Будущая смена',
        subtitle: target?.label ?? 'Выберите смену для планирования',
        details: target
          ? `${formatShiftDateLabel(target.shiftDate)} · ${shiftKindLabel(target.shiftType)} · ${shiftKindRange(target.shiftType)}`
          : 'Выберите смену для планирования',
        status: 'Черновик будущих назначений',
        badge: 'Будущая',
      };
    }
    const target = shiftTimeline?.current;
    return {
      title: 'Текущая смена',
      subtitle: target?.label ?? 'Смена сейчас',
      details: target
        ? `${formatShiftDateLabel(target.shiftDate)} · ${shiftKindLabel(target.shiftType)} · ${shiftKindRange(target.shiftType)}`
        : 'Текущая смена · время завода',
      status: 'Можно вести людей, линии и задания текущей смены',
      badge: 'Сейчас',
    };
  }, [pastShift?.shifts, pastShiftDetail, selectedFutureTarget, shiftTab, shiftTimeline]);

  const stats = useMemo(() => ({
    total: workforcePeople.length,
    available: freeWorkforcePeople.length,
    active: assignedWorkforcePeople.length,
    off: workforcePeople.filter((item) => item.employeeState === 'OFF_SHIFT').length,
  }), [assignedWorkforcePeople.length, freeWorkforcePeople.length, workforcePeople]);

  const masterAttentionTaskCount = useMemo(
    () => operationalTaskLines.reduce((sum, line) => sum + Math.max(1, line.activeTasksCount ?? 0), 0),
    [operationalTaskLines],
  );

  const linePlannedPeople = (line: Line) => line.requiredCount ?? line.activeTemplate?.items?.reduce((sum, item) => {
    if (item.doesNotAffectShortage) return sum;
    return sum + Number(item.plannedCount ?? item.defaultPlanned ?? item.requiredCount ?? 0);
  }, 0) ?? 0;

  const changeShiftTab = (mode: 'past' | 'current' | 'next' | 'future') => {
    setShiftTab(mode);
    if (mode !== 'current') setPeoplePanelMode(null);
    if (mode === 'current' || mode === 'past') setFuturePanelMode(null);
  };

  const chooseShift = (mode: 'past' | 'current' | 'next' | 'future', futureTarget?: ShiftTimeline['future'][number]) => {
    if (futureTarget) setSelectedFutureTarget(futureTarget);
    changeShiftTab(mode);
    setShiftPickerOpen(false);
  };

  const openOperationalView = (view: CurrentOperationalView) => {
    setPeoplePanelMode(null);
    retainedCurrentOperationalView = view; setCurrentOperationalView(view);
    window.setTimeout(() => document.getElementById('shift-operational-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  };

  const openPersonAction = (person: ShiftPerson, mode: PersonActionMode) => {
    const firstLine = pilotLines[0] ?? null;
    const defaultLineId = person.currentAssignment?.lineId ?? firstLine?.id ?? '';
    const defaultLine = pilotLines.find((line) => line.id === defaultLineId) ?? firstLine;
    const defaultTemplate = defaultLine?.staffingTemplates?.find((template) => template.id === defaultLine.defaultStaffingTemplateId)
      ?? defaultLine?.activeTemplate
      ?? null;

    setActionUser(person);
    setPersonAction(mode);
    setLineId(defaultLineId);
    setWashSessionId(person.currentAssignment?.washSessionId ?? washAssignmentReturnContext?.washSessionId ?? washLines[0]?.activeWash?.id ?? '');
    setPositionId(person.currentAssignment?.positionId ?? defaultLine?.positions?.[0]?.id ?? '');
    setStaffingTemplateId(person.currentAssignment?.staffingTemplateId ?? defaultTemplate?.id ?? '');
    setHomeComment('');
    setErrorText(null);
  };

  const openProfile = async (personId: string) => {
    setBusy(true);
    setErrorText(null);
    try {
      const data = await apiClient.get<PersonProfile>(`/people/${personId}/profile`);
      setProfile(data);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось открыть профиль'));
    } finally {
      setBusy(false);
    }
  };

  const openPeoplePanel = (mode: Exclude<PeoplePanelMode, null>, selectedUserId?: string) => {
    setShiftTab('current');
    setPeoplePanelMode(mode);
    setPeopleSearch('');
    setSelectedQuickPersonId(selectedUserId ?? '');
  };

  useEffect(() => {
    if (!initialLoadCompleted) return;

    const pendingLine = window.sessionStorage.getItem(PENDING_LINE_ASSIGNMENT_CONTEXT_KEY);
    if (pendingLine) {
      window.sessionStorage.removeItem(PENDING_LINE_ASSIGNMENT_CONTEXT_KEY);
      try {
        const context = JSON.parse(pendingLine) as { lineId?: string; readOnly?: boolean };
        if (context.lineId && pilotLines.some((line) => line.id === context.lineId)) {
          setShiftTab('current');
          void openDashboard(context.lineId, { readOnly: Boolean(context.readOnly) || !isManagerView });
          return;
        }
      } catch {
        setErrorText('Не удалось восстановить переход к составу линии');
      }
    }

    const pendingWash = window.sessionStorage.getItem(PENDING_WASH_ASSIGNMENT_CONTEXT_KEY);
    if (!pendingWash || !isManagerView) return;
    window.sessionStorage.removeItem(PENDING_WASH_ASSIGNMENT_CONTEXT_KEY);
    try {
      const context = JSON.parse(pendingWash) as Partial<WashAssignmentReturnContext>;
      if (!context.washSessionId) return;
      setWashSessionId(context.washSessionId);
      setWashAssignmentReturnContext({
        washSessionId: context.washSessionId,
        targetUserId: context.targetUserId ?? null,
        mode: context.mode === 'active' ? 'active' : 'available',
        returnToWash: Boolean(context.returnToWash),
      });
      openPeoplePanel(context.mode === 'active' ? 'active' : 'available', context.targetUserId ?? undefined);
    } catch {
      setErrorText('Не удалось восстановить переход к людям на мойке');
    }
  }, [initialLoadCompleted, isManagerView, pilotLines]);

  const openAssignmentMenu = (person: ShiftPerson) => {
    setAssignmentFlowUser(person);
    setAssignmentMenuUser(person);
    setSelectedQuickPersonId(person.userId);
    setErrorText(null);
  };

  const chooseAssignmentTarget = async (mode: 'slot' | 'wash' | 'workArea' | 'home') => {
    if (!assignmentMenuUser) return;
    const person = assignmentMenuUser;
    setAssignmentMenuUser(null);
    if (mode === 'home') {
      openPersonAction(person, 'home');
      return;
    }
    if (mode === 'slot') {
      await openSlotBoardForPerson(person);
      return;
    }
    if (mode === 'workArea') {
      if (workAreas.length === 1) {
        await openWorkAreaForPerson(person, workAreas[0].id);
      } else {
        setWorkAreaPickerUser(person);
      }
      return;
    }
    openPersonAction(person, mode);
  };

  const openFuturePanel = (mode: Exclude<FuturePanelMode, null>, selectedUserId?: string) => {
    setFuturePanelMode(mode);
    setFutureSearch('');
    setSelectedFuturePersonId(selectedUserId ?? '');
    window.setTimeout(() => document.getElementById('future-planning-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  };

  const openManualEmployeeSearch = (context: 'CURRENT' | 'FUTURE', source: 'GENERAL' | 'SLOT' = 'GENERAL') => {
    if (!isManagerView) return;
    setManualSearchQuery('');
    setManualSearchSheet({ context, source });
    setErrorText(null);
  };

  const chooseManualSearchResult = async (result: PeopleSearchResult, context: PeopleSearchContext | null) => {
    if (!context || !manualSearchSheet) return;
    const selection = { result, context, operationId: crypto.randomUUID() };
    setManualSearchSelection(selection);
    setManualSearchSheet(null);
    setManualSearchQuery('');
    if (context.kind === 'CURRENT') {
      setSelectedAssignmentCandidateId(result.userId);
      setCurrentAssignmentConfirm(result.requiresManualAdd);
      if (manualSearchSheet.source === 'GENERAL' || !dashboard) {
        if (!workingLines.length && !stoppedLines.length && !inactiveLines.length) {
          setErrorText('Нет доступных линий для назначения');
          return;
        }
        setSelectedAssignmentSlot(null);
        setCurrentLinePickerSelection({ userId: result.userId, displayName: result.displayName, mode: 'assign' });
      }
      return;
    }
    setSelectedFuturePersonId(result.userId);
    setSelectedPlanningCandidateId(result.userId);
    setPlanningAssignmentConfirm(!result.selfConfirmed);
    if (manualSearchSheet.source === 'GENERAL' || !planningBoard) {
      await openFutureLineBoardForUser(result.userId, result.displayName);
    }
  };

  const openSlotBoardForPerson = async (person: ShiftPerson) => {
    if (!workingLines.length && !stoppedLines.length && !inactiveLines.length) {
      setErrorText('Нет доступных линий для назначения');
      return;
    }
    setSelectedAssignmentSlot(null);
    setSelectedAssignmentCandidateId(person.userId);
    setCurrentLinePickerSelection({ userId: person.userId, displayName: person.displayName, mode: 'assign' });
  };

  const openWorkAreaForPerson = async (person: ShiftPerson, workAreaId: string) => {
    const targetArea = workAreas.find((area) => area.id === workAreaId) ?? null;
    if (!targetArea) {
      setErrorText('Рабочая зона недоступна или отключена');
      return;
    }
    setWorkAreaPickerUser(null);
    setSelectedAssignmentSlot(null);
    setSelectedAssignmentCandidateId(person.userId);
    await openWorkAreaBoard(targetArea.id);
  };

  const toggleContractorPlanSelection = (userId: string) => {
    setSelectedContractorIds((current) => current.includes(userId)
      ? current.filter((item) => item !== userId)
      : [...current, userId]);
  };

  const submitContractorPlan = async () => {
    if (!selectedContractorIds.length || busy) return;
    const selectedCount = selectedContractorIds.length;
    setBusy(true);
    setErrorText(null);
    try {
      const target = nextShiftParams();
      await apiClient.post('/shift/contractor-submissions', {
        targetShiftDate: target.shiftDate,
        shiftType: target.shiftType,
        contractorUserIds: selectedContractorIds,
        operationId: crypto.randomUUID(),
      });
      setSelectedContractorIds([]);
      await loadContractorLeadData();
      showToast(`План отправлен. Приведу: ${selectedCount}`);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось отправить план наёмных работников'));
    } finally {
      setBusy(false);
    }
  };

  const updateContractorActual = async (
    person: ContractorLeadPool['people'][number],
    actualStatus: 'ARRIVED' | 'ABSENT',
  ) => {
    if (!person.actual || busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.patch(`/shift/contractor-submissions/${person.actual.submissionId}/items/${person.actual.id}/actual`, {
        actualStatus,
        expectedVersion: person.actual.version,
        operationId: crypto.randomUUID(),
      });
      await loadContractorLeadData();
      showToast(actualStatus === 'ARRIVED' ? 'Прибытие подтверждено' : 'Отсутствие зафиксировано');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось обновить фактическую явку'));
    } finally {
      setBusy(false);
    }
  };

  const addContractorReplacement = async (person: ContractorLeadPool['people'][number]) => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post('/shift/contractor-lead/current-arrivals', {
        contractorUserId: person.userId,
        operationId: crypto.randomUUID(),
      });
      await loadContractorLeadData();
      showToast('Замена добавлена в фактический состав смены');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось добавить замену'));
    } finally {
      setBusy(false);
    }
  };

  const openFutureDraftBoard = async (selectedCandidateId?: string) => {
    const targetLine = plannedFutureLines[0]
      ? pilotLines.find((item) => item.id === plannedFutureLines[0].lineId) ?? null
      : pilotLines[0] ?? null;
    if (!targetLine) {
      setErrorText('Нет доступных линий для планового назначения');
      return;
    }
    setSelectedFuturePersonId(selectedCandidateId ?? selectedFuturePersonId);
    await openPlanningBoard(targetLine, null, undefined, { selectedCandidateId: selectedCandidateId ?? selectedFuturePersonId });
    showToast('Открыт черновик планового назначения. Текущая смена не меняется.');
  };

  const openFutureLineBoardForUser = async (userId: string | undefined | null, displayName?: string | null) => {
    if (!userId) {
      setErrorText('У этого человека нет связанного профиля для планового назначения');
      return;
    }
    const plannedLine = plannedFutureLines.find((line) => line.shortageCount > 0)
      ?? plannedFutureLines.find((line) => line.plannedAssignmentsCount < line.plannedSlots)
      ?? plannedFutureLines[0]
      ?? null;
    if (!plannedLine) {
      await openFutureDraftBoard(userId);
      if (displayName) showToast(`${shortPersonName(userId, displayName)} выбран для черновика планового назначения`);
      return;
    }
    setSelectedFuturePersonId(userId);
    await openPlannedLineBoard(plannedLine, userId);
    if (displayName) showToast(`${shortPersonName(userId, displayName)} выбран для планового назначения`);
  };

  const openFutureAssignmentBoardForUser = async (userId: string | undefined | null, displayName?: string | null) => {
    if (!userId) {
      setErrorText('У этого человека нет связанного профиля для планового назначения');
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const params = nextShiftParams();
      const query = new URLSearchParams({ targetShiftDate: params.shiftDate, shiftType: params.shiftType });
      setSelectedFuturePersonId(userId);
      setFutureAssignmentBoard(await apiClient.get<FutureAssignmentBoard>(`/shift/future-assignment-board?${query}`));
      if (displayName) showToast(`${shortPersonName(userId, displayName)} выбран для планирования будущей смены`);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось открыть план будущей смены'));
    } finally {
      setBusy(false);
    }
  };

  const openDashboard = async (id: string, options?: { silent?: boolean; readOnly?: boolean }) => {
    if (!options?.silent) setDashboardLoading(true);
    if (!options?.silent) setErrorText(null);
    try {
      const data = await apiClient.get<LineDashboard>(options?.readOnly ? `/lines/${id}/current-shift-detail` : `/lines/${id}/dashboard`);
      const board = options?.readOnly ? null : await apiClient.get<AssignmentBoard>(`/lines/${id}/assignment-board`);
      setDashboard(data);
      setAssignmentBoard(board);
      setDashboardReadOnly(Boolean(options?.readOnly));
      if (options?.silent) {
        const nextSignature = shiftRuntimeSignature({ people, lines, timeline: shiftTimeline, future: futureShift, board, planningBoard });
        if (shiftSignatureRef.current && nextSignature !== shiftSignatureRef.current) {
          setLiveStatus('Обновлено: назначения на линии изменились');
        }
        shiftSignatureRef.current = nextSignature;
      }
    } catch (error) {
      if (!options?.silent) setErrorText(errorMessage(error, 'Не удалось открыть линию'));
    } finally {
      if (!options?.silent) setDashboardLoading(false);
    }
  };

  const openLineShiftAssignment = async (line: { id: string; name: string }, params?: { shiftDate?: string; shiftType?: string }) => {
    setBusy(true);
    setErrorText(null);
    try {
      const query = params?.shiftDate && params.shiftType ? `?${new URLSearchParams({ shiftDate: params.shiftDate, shiftType: params.shiftType })}` : '';
      setLineShiftAssignment(await apiClient.get<LineShiftAssignment>(`/lines/${line.id}/shift-assignment${query}`));
      setLineShiftAssignmentLine(line);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось открыть текущее задание'));
    } finally {
      setBusy(false);
    }
  };

  const nextShiftParams = () => {
    const target = shiftTab === 'future' ? selectedFutureTarget : shiftTimeline?.next;
    const shiftDate = (target?.shiftDate ?? futureShift?.targetShiftDate?.slice(0, 10) ?? '').slice(0, 10);
    const shiftType = target?.shiftType ?? futureShift?.shiftType ?? 'DAY';
    return { shiftDate, shiftType };
  };

  const openPastShift = async (shiftKey: string) => {
    setBusy(true);
    setErrorText(null);
    try {
      const detail = await apiClient.get<PastShiftDetail>(`/shift/past/${shiftKey}`);
      setPastShiftDetail(detail);
      setPastDetailTab('Обзор');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось открыть архив смены'));
    } finally {
      setBusy(false);
    }
  };

  const openPlanningBoard = async (line: Line, templateId?: string | null, target?: { shiftDate: string; shiftType: string }, options?: { silent?: boolean; selectedCandidateId?: string }) => {
    if (!options?.silent) setBusy(true);
    if (!options?.silent) setErrorText(null);
    try {
      const params = target ?? nextShiftParams();
      const query = new URLSearchParams({
        shiftDate: params.shiftDate,
        shiftType: params.shiftType,
      });
      if (templateId) query.set('staffingTemplateId', templateId);
      setPlanningBoard(await apiClient.get<PlanningBoard>(`/lines/${line.id}/planning-board?${query}`));
      setSelectedPlanningSlot(null);
      setSelectedPlanningCandidateId(options?.selectedCandidateId ?? '');
    } catch (error) {
      if (!options?.silent) setErrorText(errorMessage(error, 'Не удалось открыть план линии'));
    } finally {
      if (!options?.silent) setBusy(false);
    }
  };

  const refreshPlanningOverview = async (target?: { shiftDate: string; shiftType: string }) => {
    if (shiftTab !== 'next' && shiftTab !== 'future') return;
    const params = target ?? nextShiftParams();
    const query = new URLSearchParams({ targetShiftDate: params.shiftDate, shiftType: params.shiftType });
    setFutureShift(await apiClient.get<FutureShift>(`/shift/future?${query}`));
  };

  const openPlannedLineBoard = async (plannedLine: NonNullable<FutureShift['plannedLines']>[number], selectedCandidateId?: string) => {
    const line = pilotLines.find((item) => item.id === plannedLine.lineId);
    if (!line) return;
    await openPlanningBoard(line, undefined, undefined, { selectedCandidateId });
  };

  const addLineToPlan = async (line: Line) => {
    setPlanningLinePickerOpen(false);
    await openPlanningBoard(line);
    await refreshPlanningOverview();
  };

  const saveAssignmentRow = async () => {
    if (!lineShiftAssignmentLine || !assignmentRowForm || busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      const payload = {
        id: assignmentRowForm.id,
        article: assignmentRowForm.article.trim(),
        productName: assignmentRowForm.productName.trim(),
        plannedGofrCount: Number(assignmentRowForm.plannedGofrCount),
      };
      if (!payload.article || !payload.productName || !Number.isFinite(payload.plannedGofrCount) || payload.plannedGofrCount <= 0) {
        throw new Error('Заполните артикул, наименование и гофр по плану');
      }
      const updated = await apiClient.patch<LineShiftAssignment>(`/lines/${lineShiftAssignmentLine.id}/shift-assignment/rows`, {
        ...payload,
        shiftDate: lineShiftAssignment?.shiftDate,
        shiftType: lineShiftAssignment?.shiftType,
      });
      setLineShiftAssignment(updated);
      setAssignmentRowForm(null);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось сохранить строку задания'));
    } finally {
      setBusy(false);
    }
  };

  const deleteAssignmentRow = async () => {
    if (!lineShiftAssignmentLine || !assignmentRowToDelete || busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      const updated = await apiClient.request<LineShiftAssignment>(`/lines/${lineShiftAssignmentLine.id}/shift-assignment/rows/${assignmentRowToDelete.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ shiftDate: lineShiftAssignment?.shiftDate, shiftType: lineShiftAssignment?.shiftType }),
      });
      setLineShiftAssignment(updated);
      setAssignmentRowToDelete(null);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось удалить строку задания'));
    } finally {
      setBusy(false);
    }
  };

  const openWorkAreaBoard = async (id: string, options?: { silent?: boolean }) => {
    if (!options?.silent) setWorkAreaLoading(true);
    if (!options?.silent) setErrorText(null);
    try {
      setSelectedAssignmentSlot(null);
      setWorkAreaBoard(await apiClient.get<WorkAreaBoard>(`/work-areas/${id}/board`));
    } catch (error) {
      if (!options?.silent) setErrorText(errorMessage(error, 'Не удалось открыть повременщиков'));
    } finally {
      if (!options?.silent) setWorkAreaLoading(false);
    }
  };

  const refreshAfterAction = async () => {
    await load();
    if (dashboard) await openDashboard(dashboard.line.id, { readOnly: dashboardReadOnly });
    if (workAreaBoard) await openWorkAreaBoard(workAreaBoard.workArea.id);
  };

  const returnToWashDetail = (sessionId: string) => {
    window.sessionStorage.setItem(PENDING_WASH_SESSION_KEY, sessionId);
    window.sessionStorage.setItem(PENDING_WASH_DETAIL_TAB_KEY, 'PEOPLE');
    setWashAssignmentReturnContext(null);
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Wash' } }));
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load({ silent: true });
      if (dashboard?.line.id) void openDashboard(dashboard.line.id, { silent: true, readOnly: dashboardReadOnly });
      if (workAreaBoard?.workArea.id) void openWorkAreaBoard(workAreaBoard.workArea.id, { silent: true });
      if (planningBoard?.line.id) {
        void openPlanningBoard(planningBoard.line, undefined, { shiftDate: planningBoard.shiftDate, shiftType: planningBoard.shiftType }, { silent: true });
      }
      if (shiftTab === 'next' || shiftTab === 'future') void refreshPlanningOverview();
    }, SHIFT_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [dashboard?.line.id, dashboardReadOnly, workAreaBoard?.workArea.id, planningBoard?.line.id, planningBoard?.shiftDate, planningBoard?.shiftType, shiftTab, includeAllPeople, isManagerView]);

  const submitPersonAction = async () => {
    if (!actionUser || !personAction || busy) return;
    setBusy(true);
    setErrorText(null);

    try {
      const shouldReturnToWash = Boolean(
        washAssignmentReturnContext?.returnToWash
        && washAssignmentReturnContext.washSessionId === washSessionId
        && (personAction === 'wash'
          || (personAction === 'release' && actionUser.currentAssignment?.washSessionId === washAssignmentReturnContext.washSessionId)),
      );
      if (personAction === 'line') {
        if (!lineId) throw new Error('Выберите линию');
        if (selectedLine?.positions?.length && !positionId) throw new Error('Выберите позицию');
        await postCurrentShiftAction('/assignments/line', {
          targetUserId: actionUser.userId,
          lineId,
          positionId: positionId || null,
          staffingTemplateId: staffingTemplateId || null,
        });
        showToast(`${shortPersonName(actionUser.userId, actionUser.displayName)} назначен: ${selectedLine?.name ?? 'линия'}${selectedLine?.positions?.find((position) => position.id === positionId)?.name ? ` — ${selectedLine.positions.find((position) => position.id === positionId)?.name}` : ''}`);
      }
      if (personAction === 'wash') {
        if (!washSessionId) throw new Error('Выберите активную мойку');
        await postCurrentShiftAction('/assignments/wash', {
          targetUserId: actionUser.userId,
          washSessionId,
          sourceAssignmentId: actionUser.currentAssignment?.id ?? null,
        });
        showToast(`${shortPersonName(actionUser.userId, actionUser.displayName)} назначен на мойку`);
      }
      if (personAction === 'home') {
        if (!homeComment.trim()) throw new Error('Комментарий обязателен');
        await apiClient.post('/shift/send-home', { targetUserId: actionUser.userId, comment: homeComment.trim() });
        showToast(`${shortPersonName(actionUser.userId, actionUser.displayName)} отправлен домой`);
      }
      if (personAction === 'release') {
        await postCurrentShiftAction('/assignments/release', { targetUserId: actionUser.userId });
        showToast(`${shortPersonName(actionUser.userId, actionUser.displayName)} освобождён`);
        openPeoplePanel('available', actionUser.userId);
      }

      setActionUser(null);
      setPersonAction(null);
      setAssignmentFlowUser(null);
      if (shouldReturnToWash && washAssignmentReturnContext) {
        returnToWashDetail(washAssignmentReturnContext.washSessionId);
        return;
      }
      await refreshAfterAction();
    } catch (error) {
      setErrorText(errorMessage(error, 'Действие не выполнено'));
    } finally {
      setBusy(false);
    }
  };

  const resetLineEventTime = () => {
    setLineEventTimeMode('NOW');
    void apiClient.get<{ timestamp: string }>('/health')
      .then((health) => {
        if (!health.timestamp) return;
        setLineEventServerNow(health.timestamp);
        setLineEventTime(factoryDateTimeInput(health.timestamp));
      })
      .catch(() => {
        setLineEventTime('');
      });
  };

  const openLineAction = (mode: LineActionMode) => {
    setLineAction(mode);
    setStatusComment('');
    if (mode === 'pause' || mode === 'stop' || mode === 'work') resetLineEventTime();
    setDowntimeReason(downtimeReasonOptions[0]?.value ?? '');
    setTaskDescription('');
    setTaskDepartmentId('');
    setTaskFiles([]);
    setPlanPercent('');
    setPlanComment('');
    setErrorText(null);
    if (mode === 'task' || mode === 'downtimeTask') {
      void apiClient.get<RecipientDepartment[]>('/tasks/recipient-departments')
        .then((items) => {
          setTaskDepartments(items);
          setTaskDepartmentId(items[0]?.id ?? '');
        })
        .catch(() => setTaskDepartments([]));
    }
  };

  const submitLineAction = async () => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);

    try {
      if (lineAction === 'activateLine') {
        const targetLine = pendingActivationLine;
        if (!targetLine) throw new Error('Выберите линию');
        const preview = await apiClient.post<TemplateRemapPreview>(`/lines/${targetLine.id}/activate-template/preview`, {
          staffingTemplateId: activationTemplateId || null,
        });
        setTemplateRemapDialog({
          scope: 'ACTIVATE',
          lineId: targetLine.id,
          templateId: activationTemplateId || null,
          operationId: crypto.randomUUID(),
          preview,
        });
        setLineAction(null);
        return;
      }

      if (!lineAction) return;
      if (lineAction === 'pause' || lineAction === 'stop' || lineAction === 'work') {
        const actionLine = lineAction === 'work' && pendingLine ? pendingLine : dashboard?.line ?? pendingLine;
        if (!actionLine) throw new Error('Выберите линию');
        if ((lineAction === 'pause' || lineAction === 'stop') && !statusComment.trim()) {
          throw new Error('Комментарий обязателен');
        }
        if ((lineAction === 'pause' || lineAction === 'stop') && !downtimeReason) {
          throw new Error(downtimeReasonOptions.length ? 'Выберите причину простоя' : 'Список причин сейчас недоступен. Обновите экран.');
        }
        const effectiveAt = lineEventTimeMode === 'CUSTOM' ? factoryDateTimeInputToIso(lineEventTime) : null;
        if (lineEventTimeMode === 'CUSTOM' && !effectiveAt) throw new Error('Укажите корректное фактическое время события');
        await apiClient.patch(`/lines/${actionLine.id}/status`, {
          status: lineAction === 'pause' ? 'PAUSE' : lineAction === 'stop' ? 'STOP' : 'WORK',
          comment: statusComment.trim() || undefined,
          downtimeReason: lineAction === 'pause' || lineAction === 'stop' ? downtimeReason : undefined,
          effectiveAt: effectiveAt ?? undefined,
          ...(typeof actionLine.version === 'number' ? { expectedVersion: actionLine.version } : {}),
        });
        if (lineAction === 'work') showToast(`${actionLine.name} возвращена в работу`);
        setPendingLine(null);
        if (!dashboard) {
          setLineAction(null);
          await load();
          if (lineAction === 'work') {
            if (assignmentFlowUser) setSelectedAssignmentCandidateId(assignmentFlowUser.userId);
            await openDashboard(actionLine.id);
          }
          return;
        }
      }
      if (!dashboard) throw new Error('Откройте линию для действия');
      if (lineAction === 'task' || lineAction === 'downtimeTask') {
        if (!taskDescription.trim()) throw new Error('Описание заявки обязательно');
        if (lineAction === 'downtimeTask' && !dashboard.activeDowntimeEvent?.id) throw new Error('Нет активного простоя для связи с заявкой');
        if (lineAction === 'downtimeTask' && !taskDepartmentId) throw new Error('Выберите отдел-получатель');
        const task = await apiClient.post<{ id: string }>('/tasks', {
          lineId: dashboard.line.id,
          lineStatusEventId: lineAction === 'downtimeTask' ? dashboard.activeDowntimeEvent?.id : undefined,
          operationId: crypto.randomUUID(),
          type: 'URGENT',
          description: taskDescription.trim(),
          departmentRecipientIds: taskDepartmentId ? [taskDepartmentId] : undefined,
        });
        if (task?.id && taskFiles.length) await uploadAttachments('TASK', task.id, taskFiles);
      }
      if (lineAction === 'wash') {
        if (dashboard.activeWash.length) throw new Error('На линии уже есть активная мойка');
        await apiClient.post('/wash/start', { lineId: dashboard.line.id, operationId: crypto.randomUUID() });
      }
      if (lineAction === 'endShift') {
        const percent = Number(planPercent);
        if (!Number.isFinite(percent) || percent < 0) throw new Error('Укажите процент выполнения плана');
        if (percent < 80 && !planComment.trim()) throw new Error('Комментарий обязателен при выполнении ниже 80%');
        const currentShift = await apiClient.get<{ id: string } | null>('/shift/current');
        if (!currentShift?.id) throw new Error('Активная смена не найдена');
        await apiClient.post('/shift/line-results', {
          lineId: dashboard.line.id,
          shiftSessionId: currentShift.id,
          planCompletionPercent: percent,
          comment: planComment.trim() || null,
        });
      }

      setLineAction(null);
      await refreshAfterAction();
    } catch (error) {
      setErrorText(errorMessage(error, 'Действие по линии не выполнено'));
    } finally {
      setBusy(false);
    }
  };

  const requestTemplateRemap = async (scope: 'CURRENT' | 'FUTURE', line: Line, templateId: string | null) => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      const operationId = crypto.randomUUID();
      const body = scope === 'FUTURE' && planningBoard
        ? {
            shiftDate: planningBoard.shiftDate,
            shiftType: planningBoard.shiftType,
            staffingTemplateId: templateId,
          }
        : { staffingTemplateId: templateId };
      const preview = await apiClient.post<TemplateRemapPreview>(
        scope === 'CURRENT'
          ? `/lines/${line.id}/activate-template/preview`
          : `/lines/${line.id}/planning-board/template/preview`,
        body,
      );
      setTemplateRemapDialog({ scope, lineId: line.id, templateId, operationId, preview });
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось проверить смену шаблона'));
    } finally {
      setBusy(false);
    }
  };

  const applyTemplateRemap = async () => {
    if (!templateRemapDialog || busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      if (templateRemapDialog.scope === 'CURRENT' || templateRemapDialog.scope === 'ACTIVATE') {
        await apiClient.post(`/lines/${templateRemapDialog.lineId}/${templateRemapDialog.scope === 'ACTIVATE' ? 'activate-for-shift' : 'activate-template'}`, {
          staffingTemplateId: templateRemapDialog.templateId,
          expectedVersion: templateRemapDialog.preview.lineVersion,
          operationId: templateRemapDialog.operationId,
          confirmRemap: true,
        });
        const activatedLineId = templateRemapDialog.lineId;
        const activationFlow = templateRemapDialog.scope === 'ACTIVATE';
        setTemplateRemapDialog(null);
        if (activationFlow) {
          setPendingLine(null);
          setLineId('');
          await load();
          await openDashboard(activatedLineId);
        } else {
          await refreshAfterAction();
        }
      } else if (planningBoard) {
        const updated = await apiClient.post<PlanningBoard>(`/lines/${templateRemapDialog.lineId}/planning-board/template/apply`, {
          shiftDate: planningBoard.shiftDate,
          shiftType: planningBoard.shiftType,
          staffingTemplateId: templateRemapDialog.templateId,
          expectedPlanUpdatedAt: templateRemapDialog.preview.planUpdatedAt ?? null,
          operationId: templateRemapDialog.operationId,
          confirmRemap: true,
        });
        setTemplateRemapDialog(null);
        setPlanningBoard(updated);
        await refreshPlanningOverview({ shiftDate: updated.shiftDate, shiftType: updated.shiftType });
      }
      showToast('Шаблон состава обновлён');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось применить шаблон состава'));
    } finally {
      setBusy(false);
    }
  };

  const closeTemplateRemap = () => {
    if (templateRemapDialog?.scope === 'ACTIVATE') setLineAction('activateLine');
    setTemplateRemapDialog(null);
  };

  const openDowntimeCorrection = (event: LineDashboard['recentEvents'][number]) => {
    setDowntimeCorrectionTarget(event);
    setCorrectionStartAt(factoryDateTimeInput(event.correctedStartAt ?? event.createdAt));
    setCorrectionEndAt(factoryDateTimeInput(event.correctedEndAt ?? lineEventServerNow));
    setCorrectionComment('');
    setErrorText(null);
    if (!event.correctedEndAt) {
      void apiClient.get<{ timestamp: string }>('/health').then((health) => {
        if (!health.timestamp) return;
        setLineEventServerNow(health.timestamp);
        setCorrectionEndAt(factoryDateTimeInput(health.timestamp));
      }).catch(() => undefined);
    }
  };

  const submitDowntimeCorrection = async () => {
    if (!dashboard || !downtimeCorrectionTarget || busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      if (!correctionStartAt || !correctionEndAt || !correctionComment.trim()) {
        throw new Error('Укажите время начала, окончания и комментарий');
      }
      const correctedStartAt = factoryDateTimeInputToIso(correctionStartAt);
      const correctedEndAt = factoryDateTimeInputToIso(correctionEndAt);
      if (!correctedStartAt || !correctedEndAt) throw new Error('Укажите корректное время начала и окончания');
      await apiClient.post(`/archive/downtime/${downtimeCorrectionTarget.id}/correction`, {
        correctedStartAt,
        correctedEndAt,
        comment: correctionComment.trim(),
      });
      setDowntimeCorrectionTarget(null);
      await openDashboard(dashboard.line.id);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось уточнить время простоя'));
    } finally {
      setBusy(false);
    }
  };

  const assignCandidateToSlot = async (candidateUserId: string, positionId: string, slotIndex = 1) => {
    if (!dashboard || busy) return;
    const openLineId = dashboard.line.id;
    const previousScrollTop = lineBoardScrollRef.current?.scrollTop ?? 0;
    setBusy(true);
    setErrorText(null);
    try {
      const person = workforcePeople.find((item) => item.userId === candidateUserId);
      const candidate = assignmentBoard?.candidates.find((item) => item.userId === candidateUserId);
      const manual = manualSearchSelection?.result.userId === candidateUserId && manualSearchSelection.context.kind === 'CURRENT'
        ? manualSearchSelection
        : null;
      const slot = assignmentBoard?.slots.find((item) => item.positionId === positionId && item.slotIndex === slotIndex && !item.assignment);
      const occupiedSlot = assignmentBoard?.slots.find((item) => item.positionId === positionId && item.slotIndex === slotIndex && item.assignment);
      await postCurrentShiftAction('/assignments/line', {
        targetUserId: candidateUserId,
        lineId: dashboard.line.id,
        positionId,
        slotIndex,
        staffingTemplateId: assignmentBoard?.activeTemplate?.id ?? null,
        sourceAssignmentId: candidate?.currentAssignment?.id ?? person?.currentAssignment?.id ?? null,
        replaceAssignmentId: occupiedSlot?.assignment?.id ?? null,
        operationId: manual?.operationId,
        manualAdd: Boolean(manual?.result.requiresManualAdd),
        expectedShiftDate: manual?.context.shiftDate ?? null,
        expectedShiftType: manual?.context.shiftType ?? null,
      });
      showToast(`${shortPersonName(candidateUserId, manual?.result.displayName ?? candidate?.displayName ?? person?.displayName)} назначен: ${dashboard.line.name}${slot?.displayName || slot?.positionName ? ` — ${slot.displayName ?? slot.positionName}` : ''}`);
      setSelectedAssignmentSlot(null);
      setSelectedAssignmentCandidateId('');
      setCurrentAssignmentConfirm(false);
      setManualSearchSelection(null);
      await load();
      await openDashboard(openLineId, { silent: true });
      setAssignmentFlowUser(null);
      window.requestAnimationFrame(() => {
        if (lineBoardScrollRef.current) lineBoardScrollRef.current.scrollTop = previousScrollTop;
      });
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось загрузить назначение'));
    } finally {
      setBusy(false);
    }
  };

  const confirmCurrentSlotAssignment = async () => {
    if (!selectedAssignmentCandidateId || !selectedAssignmentSlot) {
      setErrorText('Выберите слот и сотрудника');
      return;
    }
    const selectedPerson = workforcePeople.find((item) => item.userId === selectedAssignmentCandidateId);
    const selectedSlot = assignmentBoard?.slots.find((item) => item.positionId === selectedAssignmentSlot.positionId && item.slotIndex === selectedAssignmentSlot.slotIndex);
    const manual = manualSearchSelection?.result.userId === selectedAssignmentCandidateId && manualSearchSelection.context.kind === 'CURRENT'
      ? manualSearchSelection
      : null;
    const needsConfirm = Boolean(manual?.result.requiresManualAdd || selectedPerson?.currentAssignment?.id || (selectedSlot?.assignment && selectedSlot.assignment.userId !== selectedAssignmentCandidateId));
    if (needsConfirm && !currentAssignmentConfirm) {
      setCurrentAssignmentConfirm(true);
      return;
    }
    await assignCandidateToSlot(selectedAssignmentCandidateId, selectedAssignmentSlot.positionId, selectedAssignmentSlot.slotIndex);
  };

  const confirmPlanningSlotAssignment = async () => {
    if (!planningBoard || !selectedPlanningCandidateId || !selectedPlanningSlot || busy) {
      setErrorText('Выберите слот и сотрудника');
      return;
    }
    const candidate = planningBoard.candidates.find((item) => item.userId === selectedPlanningCandidateId);
    const selectedSlot = planningBoard.slots.find((item) => item.positionId === selectedPlanningSlot.positionId && item.slotIndex === selectedPlanningSlot.slotIndex);
    const manual = manualSearchSelection?.result.userId === selectedPlanningCandidateId && manualSearchSelection.context.kind === 'FUTURE'
      ? manualSearchSelection
      : null;
    const needsConfirm = Boolean(manual?.result.selfConfirmed === false || candidate?.plannedAssignmentId || (selectedSlot?.assignment && selectedSlot.assignment.userId !== selectedPlanningCandidateId));
    if (needsConfirm && !planningAssignmentConfirm) {
      setPlanningAssignmentConfirm(true);
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const updated = await apiClient.post<PlanningBoard>(`/lines/${planningBoard.line.id}/planning-board/assign`, {
        shiftDate: planningBoard.shiftDate,
        shiftType: planningBoard.shiftType,
        staffingTemplateId: planningBoard.staffingTemplate?.id ?? null,
        positionId: selectedPlanningSlot.positionId,
        slotIndex: selectedPlanningSlot.slotIndex,
        targetUserId: selectedPlanningCandidateId,
        sourceAssignmentId: candidate?.plannedAssignmentId ?? null,
        replaceAssignmentId: selectedSlot?.assignment?.id ?? null,
        operationId: manualSearchSelection?.result.userId === selectedPlanningCandidateId ? manualSearchSelection.operationId : undefined,
        manualAssignment: manualSearchSelection?.result.userId === selectedPlanningCandidateId,
      });
      showToast(`${shortPersonName(selectedPlanningCandidateId, manualSearchSelection?.result.userId === selectedPlanningCandidateId ? manualSearchSelection.result.displayName : candidate?.displayName)} запланирован: ${planningBoard.line.name} — ${selectedPlanningSlot.label}`);
      setPlanningBoard(updated);
      setSelectedPlanningSlot(null);
      setSelectedPlanningCandidateId('');
      setPlanningAssignmentConfirm(false);
      setManualSearchSelection(null);
      await refreshPlanningOverview({ shiftDate: planningBoard.shiftDate, shiftType: planningBoard.shiftType });
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось запланировать сотрудника'));
    } finally {
      setBusy(false);
    }
  };

  const releasePlannedUser = async (assignmentId: string) => {
    if (!planningBoard || busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/lines/${planningBoard.line.id}/planning-board/release/${assignmentId}`, {});
      await openPlanningBoard(planningBoard.line, undefined, { shiftDate: planningBoard.shiftDate, shiftType: planningBoard.shiftType });
      await refreshPlanningOverview({ shiftDate: planningBoard.shiftDate, shiftType: planningBoard.shiftType });
      showToast('Плановый слот освобождён');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось освободить плановый слот'));
    } finally {
      setBusy(false);
    }
  };

  const refreshFutureAssignmentBoard = async (target?: { shiftDate: string; shiftType: string }) => {
    const params = target ?? nextShiftParams();
    const query = new URLSearchParams({ targetShiftDate: params.shiftDate, shiftType: params.shiftType });
    setFutureAssignmentBoard(await apiClient.get<FutureAssignmentBoard>(`/shift/future-assignment-board?${query}`));
    await refreshPlanningOverview(params);
  };

  const assignFutureNonLine = async (kind: FutureAssignmentKind, options: { workAreaId?: string; workAreaPositionId?: string; slotIndex?: number; timeRoleName?: string; replaceAssignmentId?: string } = {}) => {
    if (!futureAssignmentBoard || !selectedFuturePersonId || busy) {
      setErrorText('Выберите сотрудника для будущей смены');
      return;
    }
    setBusy(true);
    setErrorText(null);
    const attemptKey = JSON.stringify([
      selectedFuturePersonId,
      futureAssignmentBoard.shiftDate,
      futureAssignmentBoard.shiftType,
      kind,
      options.workAreaId ?? null,
      options.workAreaPositionId ?? null,
      options.slotIndex ?? null,
      options.replaceAssignmentId ?? null,
    ]);
    if (futureAssignmentAttemptRef.current?.key !== attemptKey) {
      futureAssignmentAttemptRef.current = { key: attemptKey, operationId: crypto.randomUUID() };
    }
    try {
      const sourceAssignment = futureAssignmentBoard.assignments.find((item) => item.userId === selectedFuturePersonId) ?? null;
      await apiClient.post('/shift/future-assignments', {
        targetUserId: selectedFuturePersonId,
        shiftDate: futureAssignmentBoard.shiftDate,
        shiftType: futureAssignmentBoard.shiftType,
        kind,
        ...options,
        sourceAssignmentId: sourceAssignment?.id ?? null,
        operationId: futureAssignmentAttemptRef.current.operationId,
      });
      const label = kind === 'WASH'
        ? 'мойка'
        : kind === 'TIME'
          ? options.timeRoleName ?? 'повременщики'
          : 'рабочая зона';
      showToast(`${shortPersonName(selectedFuturePersonId, selectedFuturePersonName)} запланирован: ${label}`);
      futureAssignmentAttemptRef.current = null;
      setFutureNonLinePending(null);
      await refreshFutureAssignmentBoard({ shiftDate: futureAssignmentBoard.shiftDate, shiftType: futureAssignmentBoard.shiftType });
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось создать плановое назначение'));
    } finally {
      setBusy(false);
    }
  };

  const requestFutureNonLine = (kind: FutureAssignmentKind, targetLabel: string, options: FutureNonLinePending['options'] = {}) => {
    if (!futureAssignmentBoard || !selectedFuturePersonId) {
      setErrorText('Выберите сотрудника для будущей смены');
      return;
    }
    const source = futureAssignmentBoard.assignments.find((item) => item.userId === selectedFuturePersonId) ?? null;
    if (source || options.replaceAssignmentId) {
      setFutureNonLinePending({ kind, targetLabel, options });
      return;
    }
    void assignFutureNonLine(kind, options);
  };

  const releaseFutureNonLine = async (assignmentId: string) => {
    if (!futureAssignmentBoard || busy) return;
    setBusy(true);
    setErrorText(null);
    if (futureReleaseAttemptRef.current?.assignmentId !== assignmentId) {
      futureReleaseAttemptRef.current = { assignmentId, operationId: crypto.randomUUID() };
    }
    try {
      await apiClient.post(`/shift/future-assignments/${assignmentId}/release`, { operationId: futureReleaseAttemptRef.current.operationId });
      await refreshFutureAssignmentBoard({ shiftDate: futureAssignmentBoard.shiftDate, shiftType: futureAssignmentBoard.shiftType });
      showToast('Плановое назначение освобождено');
      futureReleaseAttemptRef.current = null;
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось освободить плановое назначение'));
    } finally {
      setBusy(false);
    }
  };

  const openLineRequirementEditor = (slot: AssignmentBoard['slots'][number]) => {
    if (!dashboard || !assignmentBoard?.activeTemplate) return;
    const item = assignmentBoard.activeTemplate.items?.find((templateItem) => templateItem.positionId === slot.positionId);
    if (!item) return;
    const current = Number(item.plannedCount ?? item.defaultPlanned ?? item.requiredCount ?? slot.plannedCount ?? 1);
    const min = Number(item.minRequired ?? item.requiredCount ?? slot.minRequired ?? 0);
    const max = Number(item.maxRequired ?? item.requiredCount ?? slot.maxRequired ?? current);
    setRequirementValue(current);
    setRequirementPreview(null);
    setRequirementEditor({
      kind: 'LINE',
      title: slot.displayName ?? slot.positionName,
      current,
      min,
      max,
      lineId: dashboard.line.id,
      templateId: assignmentBoard.activeTemplate.id,
      itemId: item.id,
    });
  };

  const openWorkAreaRequirementEditor = (slot: WorkAreaBoard['slots'][number]) => {
    if (!workAreaBoard) return;
    const current = Number(slot.plannedCount ?? slot.defaultPlanned ?? 0);
    setRequirementValue(current);
    setRequirementPreview(null);
    setRequirementEditor({
      kind: 'WORK_AREA',
      title: slot.title,
      current,
      min: slot.minRequired,
      max: slot.maxRequired,
      workAreaId: workAreaBoard.workArea.id,
      positionId: slot.workAreaPositionId,
    });
  };

  const saveRequirement = async () => {
    if (!requirementEditor || busy) return;
    const next = Math.max(requirementEditor.min, Math.min(requirementEditor.max, Math.round(requirementValue)));
    if (!Number.isFinite(next)) {
      setErrorText('Укажите целое количество сотрудников');
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const preview = requirementEditor.kind === 'LINE'
        ? await apiClient.post<RequirementPreview>(`/lines/${requirementEditor.lineId}/staffing-templates/${requirementEditor.templateId}/items/${requirementEditor.itemId}/planned-count/preview`, { plannedCount: next })
        : await apiClient.post<RequirementPreview>(`/work-areas/${requirementEditor.workAreaId}/positions/${requirementEditor.positionId}/planned-count/preview`, { plannedCount: next });
      setRequirementPreview(preview);
      if (preview.requiresRelease) return;
      if (requirementEditor.kind === 'LINE') {
        await apiClient.patch(`/lines/${requirementEditor.lineId}/staffing-templates/${requirementEditor.templateId}/items/${requirementEditor.itemId}/planned-count`, { plannedCount: next });
        if (requirementEditor.lineId) await openDashboard(requirementEditor.lineId);
      } else {
        await apiClient.patch(`/work-areas/${requirementEditor.workAreaId}/positions/${requirementEditor.positionId}/planned-count`, { plannedCount: next });
        if (requirementEditor.workAreaId) await openWorkAreaBoard(requirementEditor.workAreaId);
      }
      setRequirementEditor(null);
      setRequirementPreview(null);
      showToast(`Потребность «${requirementEditor.title}» сохранена: ${next}`);
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось изменить потребность'));
    } finally {
      setBusy(false);
    }
  };

  const assignCandidateToWorkArea = async (candidateUserId: string, positionId: string, requestedSlotIndex?: number) => {
    if (!workAreaBoard || busy) return;
    const openWorkAreaId = workAreaBoard.workArea.id;
    const previousScrollTop = workAreaBoardScrollRef.current?.scrollTop ?? 0;
    setBusy(true);
    setErrorText(null);
    try {
      const candidate = workAreaBoard.candidates.find((item) => item.userId === candidateUserId);
      const slot = workAreaBoard.slots.find((item) => item.workAreaPositionId === positionId && !item.assignment);
      await postCurrentShiftAction(`/work-areas/${workAreaBoard.workArea.id}/assign`, {
        targetUserId: candidateUserId,
        workAreaPositionId: positionId,
        slotIndex: requestedSlotIndex ?? slot?.slotIndex ?? null,
        sourceAssignmentId: candidate?.currentAssignment?.id
          ?? people.find((person) => person.userId === candidateUserId)?.currentAssignment?.id
          ?? null,
      });
      showToast(`${shortPersonName(candidateUserId, candidate?.displayName)} назначен: ${workAreaBoard.workArea.name}${slot?.title ? ` — ${slot.title}` : ''}`);
      await load();
      await openWorkAreaBoard(openWorkAreaId, { silent: true });
      setSelectedAssignmentSlot(null);
      setSelectedAssignmentCandidateId('');
      setAssignmentFlowUser(null);
      window.requestAnimationFrame(() => {
        if (workAreaBoardScrollRef.current) workAreaBoardScrollRef.current.scrollTop = previousScrollTop;
      });
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось назначить повременщика'));
    } finally {
      setBusy(false);
    }
  };

  const confirmWorkAreaAssignment = async () => {
    if (!selectedAssignmentCandidateId || !selectedAssignmentSlot) {
      setErrorText('Выберите слот и сотрудника');
      return;
    }
    await assignCandidateToWorkArea(selectedAssignmentCandidateId, selectedAssignmentSlot.positionId, selectedAssignmentSlot.slotIndex);
  };

  const releaseAssignedUser = async (userId: string, displayName?: string | null, context?: string, options?: { selectForReassign?: boolean; closeBoard?: boolean }) => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      await postCurrentShiftAction('/assignments/release', { targetUserId: userId });
      showToast(`${shortPersonName(userId, displayName)} освобождён${context ? `: ${context}` : ''}`);
      if (options?.closeBoard) {
        await load();
        setDashboard(null);
        setAssignmentBoard(null);
        setWorkAreaBoard(null);
      } else {
        await refreshAfterAction();
      }
      if (options?.selectForReassign) {
        openPeoplePanel('available', userId);
      }
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось освободить сотрудника'));
    } finally {
      setBusy(false);
    }
  };

  const markWillBe = async () => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post('/shift/will-be', { comment: willBeComment.trim() || null });
      setWillBeComment('');
      const self = await apiClient.get<ShiftMeResponse>('/shift/me');
      setSelfShift(self);
      setPeople(self.user ? [self.user] : []);
      if (shiftTab === 'next' || shiftTab === 'future') await refreshPlanningOverview();
      showToast('Отметка «Я буду» сохранена');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось отметиться'));
    } finally {
      setBusy(false);
    }
  };

  const cancelWillBe = async () => {
    if (busy || !selfShift?.activeWillBe) return;
    if (!willBeComment.trim()) {
      setErrorText('Комментарий обязателен для отмены');
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post('/shift/will-be/cancel', { willBeId: selfShift.activeWillBe.id, comment: willBeComment.trim() });
      setWillBeComment('');
      const self = await apiClient.get<ShiftMeResponse>('/shift/me');
      setSelfShift(self);
      setPeople(self.user ? [self.user] : []);
      if (shiftTab === 'next' || shiftTab === 'future') await refreshPlanningOverview();
      showToast('Отметка на будущую смену отменена');
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось отменить отметку'));
    } finally {
      setBusy(false);
    }
  };

  const markWillBeNotNeeded = async () => {
    if (!notNeededWillBe || busy) return;
    if (!notNeededReason.trim()) {
      setErrorText('Укажите причину, почему сотрудника не нужно вызывать');
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post(`/shift/will-be/${notNeededWillBe.id}/remove`, { comment: notNeededReason.trim() });
      showToast(`${shortPersonName(notNeededWillBe.id, notNeededWillBe.displayName)}: не вызывать на смену`);
      setSelectedFuturePersonId((current) => current === notNeededWillBe.userId ? '' : current);
      setNotNeededWillBe(null);
      setNotNeededReason('');
      await refreshPlanningOverview();
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось обновить план сотрудника'));
    } finally {
      setBusy(false);
    }
  };
  const requestReturn = async () => {
    if (busy) return;
    if (!returnReason.trim()) {
      setErrorText('Укажите причину возврата');
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      await apiClient.post('/shift/return-request', { reason: returnReason.trim() });
      setReturnReason('');
      setSelfShift(await apiClient.get<ShiftMeResponse>('/shift/me'));
    } catch (error) {
      setErrorText(errorMessage(error, 'Не удалось запросить возврат'));
    } finally {
      setBusy(false);
    }
  };

  const openLineCard = (line: Line, readOnly = false) => {
    if (line.isActiveForShift) {
      setSelectedAssignmentSlot(null);
      setSelectedAssignmentCandidateId('');
      void openDashboard(line.id, { readOnly });
      return;
    }
    setPendingLine(line);
    setActivationTemplateId(line.defaultStaffingTemplateId ?? line.activeTemplate?.id ?? '');
    setLineAction('activateLine');
  };

  const returnLineToWork = async (line: Line) => {
    setPendingLine(line);
    openLineAction('work');
  };

  const openQuickLineAction = (line: Line, mode: 'pause' | 'stop') => {
    setDashboard(null);
    setAssignmentBoard(null);
    setPendingLine(line);
    openLineAction(mode);
  };

  const openTaskScreen = () => {
    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen: 'Tasks' } }));
  };

  const renderCompactLineCard = (line: Line, readOnly = false) => {
    const plannedPeople = linePlannedPeople(line);
    const event = line.activeDowntimeEvent;
    const eventStartAt = event?.correctedStartAt ?? event?.createdAt ?? null;
    const linkedTask = line.activeTaskSummary?.sourceKind === 'DOWNTIME' ? line.activeTaskSummary : null;
    const state = line.operationalState;
    const isWash = state === 'WASH';
    const isDefrost = state === 'DEFROST';
    const visualStatus = isWash ? 'wash' : isDefrost ? 'defrost' : state === 'DOWNTIME' ? 'downtime' : state === 'STOPPED' ? 'stopped' : 'working';
    const canonicalLabel = isWash ? 'На мойке' : isDefrost ? 'На оттайке' : state === 'DOWNTIME' ? 'Простой' : state === 'RUNNING' ? 'Работает' : 'Остановлена';
    return (
      <article
        className={`card operational-line-card current-shift-line-card ${visualStatus} ${readOnly ? 'readonly' : ''}`}
        data-line-status={state ?? 'UNKNOWN'}
        key={line.id}
      >
        <div className="current-line-card-head">
          <div>
            <h3 className="line-name">{line.name}</h3>
            <span className={`tag ${isWash ? 'wash' : state === 'DOWNTIME' ? 'pause' : state === 'RUNNING' ? 'work' : 'stop'}`}>{canonicalLabel}</span>
            {line.continuesFromPreviousShift ? (
              <span className="tag line-continuation-tag">{line.continuationLabel ?? 'Работает с прошлой смены'}</span>
            ) : null}
          </div>
          <strong className="line-people-count">Люди {line.assignedCount ?? line.activeWorkersCount ?? 0}/{plannedPeople || '—'}</strong>
        </div>
        {state === 'DOWNTIME' && event ? (
          <div className="compact-downtime-note">
            <span>{event.downtimeReasonLabel || 'Причина не указана'} · {formatElapsed(eventStartAt, null, lineEventServerNow)}</span>
            {linkedTask ? (
              <span>{linkedTask.serviceLabel || 'Служба не назначена'} · {linkedTask.assigneeDisplayName || 'Исполнитель не назначен'} · {linkedTask.taskStatusLabel}</span>
            ) : <span>Связанной активной заявки нет</span>}
          </div>
        ) : null}
        <div className="line-compact-meta">
          <span>{line.activeTemplate?.name ?? 'Состав не выбран'}</span>
          {(line.activeTasksCount ?? 0) > 0 ? <span>Заявки: {line.activeTasksCount}</span> : null}
          {isWash ? <span>Мойка активна</span> : null}
        </div>
        {readOnly ? (
          <div className="compact-line-actions readonly-actions">
            <button className="secondary-button compact-action" type="button" onClick={() => openLineCard(line, true)}>Подробнее</button>
          </div>
        ) : (
          <div className="compact-line-actions">
            <button className="action-button pause compact-action" type="button" disabled={busy || state !== 'RUNNING'} onClick={() => openQuickLineAction(line, 'pause')}>Простой</button>
            <button className="action-button stop compact-action" type="button" disabled={busy || state !== 'RUNNING'} onClick={() => openQuickLineAction(line, 'stop')}>Остановить</button>
            <button className="secondary-button compact-action" type="button" onClick={() => openLineCard(line)}>Подробнее</button>
            <button className="secondary-button compact-action line-plan-compact" type="button" disabled={busy} onClick={() => void openLineShiftAssignment(line)}>План</button>
          </div>
        )}
      </article>
    );
  };

  const renderAttendanceRow = (person: ShiftPerson) => (
    <article className="current-shift-person-row" key={`attendance-${person.userId}`}>
      <ProfilePhoto photo={person.profilePhoto} userId={person.userId} displayName={person.displayName} size="small" />
      <div className="current-shift-person-copy">
        <strong>{shortPersonName(person.userId, person.displayName)}</strong>
        <span>{person.departmentName ?? person.companyName ?? 'Подразделение не указано'} · {roleLabels[person.role] ?? person.role}</span>
      </div>
      <button className="secondary-button compact-action" type="button" onClick={() => void openProfile(person.userId)}>Подробнее</button>
    </article>
  );

  const profileFactoryAccess = profile?.factoryAccesses?.find((access) => access.isActive)
    ?? profile?.factoryAccessSummary
    ?? profile?.factoryAccesses?.[0]
    ?? null;
  const profileAssignmentLabel = profile?.currentAssignment
    ? profile.currentAssignment.lineName
      ? `${profile.currentAssignment.lineName}${profile.currentAssignment.positionName ? ` · ${profile.currentAssignment.positionName}` : ''}`
      : profile.currentAssignment.timeRoleName ?? (profile.currentAssignment.washSessionId ? 'Мойка' : 'Назначение без линии')
    : 'Нет текущего назначения';
  const displayedHandover = handoverMode === 'previous' ? previousHandover?.handover ?? null : handoverView;
  const openHandoverItem = (section: keyof ShiftHandoverSnapshot['sections'], item: HandoverItem) => {
    setHandoverMode(null);
    if (section === 'lines' && item.lineId) {
      void openDashboard(item.lineId);
      return;
    }
    const screens: Partial<Record<keyof ShiftHandoverSnapshot['sections'], string>> = {
      tasks: 'Tasks',
      washes: 'Wash',
      defrosts: 'Defrost',
      importantLogs: 'Log',
    };
    const screen = screens[section];
    if (screen) window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: { screen } }));
  };

  const effectiveHistoryMonth = historyMonth || pastShift?.month || '';
  const historyCells = monthCalendar(effectiveHistoryMonth);
  const historyShiftsByDate = new Map<string, PastShiftCard[]>();
  for (const shift of pastShift?.shifts ?? []) {
    historyShiftsByDate.set(shift.shiftDate, [...(historyShiftsByDate.get(shift.shiftDate) ?? []), shift]);
  }
  const selectedHistoryShifts = historySelectedDate ? historyShiftsByDate.get(historySelectedDate) ?? [] : [];

  if (historyOnly) {
    return (
      <section className="screen-panel shift-history-screen" data-testid="worker-shift-history">
        <PremiumSectionHeader title="История смен" subtitle="Только ваши фактически отработанные смены и перемещения." />
        {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
        {toastText ? <div className="empty-state success-state">{toastText}</div> : null}

        <section className="card shift-history-calendar-card">
          <div className="shift-history-month-nav">
            <button className="secondary-button icon-button" type="button" aria-label="Предыдущий месяц" disabled={!effectiveHistoryMonth || loading} onClick={() => {
              setPastShiftDetail(null);
              setHistorySelectedDate('');
              setHistoryMonth(moveMonth(effectiveHistoryMonth, -1));
            }}>‹</button>
            <div><strong>{monthTitle(effectiveHistoryMonth)}</strong><span>Фактическая явка и назначения</span></div>
            <button className="secondary-button icon-button" type="button" aria-label="Следующий месяц" disabled={!effectiveHistoryMonth || loading} onClick={() => {
              setPastShiftDetail(null);
              setHistorySelectedDate('');
              setHistoryMonth(moveMonth(effectiveHistoryMonth, 1));
            }}>›</button>
          </div>
          <div className="shift-history-legend" aria-label="Обозначения смен">
            <span><i className="day" /> День</span>
            <span><i className="night" /> Ночь</span>
          </div>
          <div className="shift-history-calendar-grid" role="grid" aria-label={monthTitle(effectiveHistoryMonth)}>
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span className="shift-history-weekday" key={day}>{day}</span>)}
            {historyCells.map((cell, index) => {
              if (!cell) return <span className="shift-history-day empty" key={`empty-${index}`} aria-hidden="true" />;
              const shifts = historyShiftsByDate.get(cell.date) ?? [];
              const hasDay = shifts.some((shift) => shift.shiftType === 'DAY');
              const hasNight = shifts.some((shift) => shift.shiftType === 'NIGHT');
              const hasWork = hasDay || hasNight;
              return (
                <button
                  className={`shift-history-day ${hasDay ? 'has-day' : ''} ${hasNight ? 'has-night' : ''} ${historySelectedDate === cell.date ? 'selected' : ''}`}
                  type="button"
                  key={cell.date}
                  disabled={!hasWork || busy}
                  aria-label={`${cell.date}${hasDay ? ', дневная смена' : ''}${hasNight ? ', ночная смена' : ''}`}
                  onClick={() => {
                    setHistorySelectedDate(cell.date);
                    setPastShiftDetail(null);
                    if (shifts.length === 1) void openPastShift(shifts[0].key);
                  }}
                >
                  <span>{cell.day}</span>
                  {hasWork ? <span className="shift-history-day-markers" aria-hidden="true">{hasDay ? <i className="day" /> : null}{hasNight ? <i className="night" /> : null}</span> : null}
                </button>
              );
            })}
          </div>
          {!loading && !(pastShift?.shifts?.length) ? <div className="empty-state compact">В этом месяце фактически отработанных смен нет.</div> : null}
        </section>

        {selectedHistoryShifts.length > 1 && !pastShiftDetail ? (
          <section className="card shift-history-choice-card">
            <h3>{formatShiftDateLabel(historySelectedDate)}</h3>
            <p>Выберите смену этого дня.</p>
            <div className="shift-history-choice-actions">
              {selectedHistoryShifts.map((shift) => (
                <button className={`secondary-button ${shift.shiftType === 'DAY' ? 'day-choice' : 'night-choice'}`} type="button" key={shift.key} onClick={() => void openPastShift(shift.key)}>
                  {shift.shiftTypeLabel} · {shiftKindRange(shift.shiftType)}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {pastShiftDetail ? (
          <section className="card shift-history-detail-card" data-history-scope={pastShiftDetail.scope ?? 'SELF'}>
            <div className="line-title-row">
              <div><h3>{pastShiftDetail.title}</h3><span>{pastShiftDetail.timeRange} · только ваша история</span></div>
              <span className={`tag ${pastShiftDetail.shiftType === 'DAY' ? 'pause' : ''}`}>{pastShiftDetail.shiftTypeLabel}</span>
            </div>
            <div className="shift-history-intervals">
              {pastShiftDetail.people.map((assignment, index) => (
                <article className="position-row" key={assignment.id}>
                  <div>
                    <strong>{assignment.targetName} · {assignment.positionName}</strong>
                    <span>{formatFactoryTime(assignment.startedAt)}–{assignment.endedAt ? formatFactoryTime(assignment.endedAt) : 'до конца смены'}{assignment.slotIndex ? ` · слот ${assignment.slotIndex}` : ''}</span>
                  </div>
                  <span className="tag">{index ? 'Перемещение' : 'Назначение'}</span>
                </article>
              ))}
              {!pastShiftDetail.people.length ? <div className="empty-state compact">Фактическая смена отмечена без назначения на линию или рабочую зону.</div> : null}
            </div>
            <button className="secondary-button" type="button" onClick={() => {
              setPastShiftDetail(null);
              setPastDetailTab('Обзор');
            }}>Назад к календарю</button>
          </section>
        ) : null}
      </section>
    );
  }

  return (
    <section className="screen-panel">
      <PremiumSectionHeader
        title="Смена"
        subtitle={isManagerView
          ? 'Рабочий стол мастера: линии, люди, назначения, заявки и мойка.'
          : isOperationalReader
            ? 'Обзор смены и людей без управляющих действий.'
            : 'Ваша смена и текущее назначение.'}
      />

      {shiftTab === 'current' && isManagerView ? (
        <div className="metric-grid premium-kpi-strip operational-metrics" data-count="4">
          <button className={`metric-card shift-metric-button ${currentOperationalView === 'lines' && !peoplePanelMode ? 'selected' : ''}`} aria-pressed={currentOperationalView === 'lines' && !peoplePanelMode} type="button" onClick={() => openOperationalView('lines')}>
            <span className="premium-kpi-icon" aria-hidden="true">≡</span>
            <div className="metric-label">В работе</div>
            <div className="metric-value">{workingLines.length}</div>
            <span>На мойке: {washLines.length}</span>
          </button>
          <button className={`metric-card success shift-metric-button ${peoplePanelMode ? 'selected' : ''}`} aria-pressed={Boolean(peoplePanelMode)} type="button" onClick={() => openPeoplePanel('all')}>
            <span className="premium-kpi-icon" aria-hidden="true">●</span>
            <div className="metric-label">Люди на смене</div>
            <div className="metric-value">{stats.total}</div>
          </button>
          <button className={`metric-card danger shift-metric-button ${currentOperationalView === 'downtime' && !peoplePanelMode ? 'selected' : ''}`} aria-pressed={currentOperationalView === 'downtime' && !peoplePanelMode} type="button" onClick={() => openOperationalView('downtime')}>
            <span className="premium-kpi-icon" aria-hidden="true">Ⅱ</span>
            <div className="metric-label">Простой</div>
            <div className="metric-value">{activeDowntimeLines.length}</div>
            <span>Только активные</span>
          </button>
          <button className={`metric-card cool shift-metric-button ${currentOperationalView === 'requests' && !peoplePanelMode ? 'selected' : ''}`} aria-pressed={currentOperationalView === 'requests' && !peoplePanelMode} type="button" onClick={() => openOperationalView('requests')}>
            <span className="premium-kpi-icon" aria-hidden="true">!</span>
            <div className="metric-label">Заявки</div>
            <div className="metric-value">{masterAttentionTaskCount}</div>
            <span>Требуют внимания</span>
          </button>
        </div>
      ) : null}
      {shiftTab === 'current' && !isManagerView ? (
        <div className="metric-grid premium-kpi-strip operational-metrics" data-count="3">
          <div className="metric-card"><span className="premium-kpi-icon" aria-hidden="true">≡</span><div className="metric-label">В работе</div><div className="metric-value">{workingLines.length}</div><span>На мойке: {washLines.length}</span></div>
          <div className="metric-card success"><span className="premium-kpi-icon" aria-hidden="true">●</span><div className="metric-label">Люди на смене</div><div className="metric-value">{stats.total}</div></div>
          <div className="metric-card danger"><span className="premium-kpi-icon" aria-hidden="true">Ⅱ</span><div className="metric-label">Простой</div><div className="metric-value">{activeDowntimeLines.length}</div></div>
        </div>
      ) : null}
      {shiftTab === 'current' ? (
        <div className="production-staffing-summary" data-testid="production-staffing-counter">
          <span>На производственных линиях:</span>
          <strong>{assignedLineWorkersCount} из {requiredLineWorkersCount}</strong>
        </div>
      ) : null}
      {shiftTab === 'next' || shiftTab === 'future' ? (
        <div className="metric-grid premium-kpi-strip operational-metrics planning-metrics future-plan-metrics" data-count="8">
          <button className={`metric-card accent shift-metric-button ${futurePanelMode === 'plannedLines' ? 'selected' : ''}`} type="button" onClick={() => openFuturePanel('plannedLines')}>
            <span className="premium-kpi-icon" aria-hidden="true">≡</span>
            <div className="metric-label">Линий в плане</div>
            <div className="metric-value">{futureShift?.counts.plannedLines ?? 0}</div>
            <span>Открыть линии</span>
          </button>
          <div className="metric-card"><span className="premium-kpi-icon" aria-hidden="true">□</span><div className="metric-label">Нужно по слотам</div><div className="metric-value">{futureShift?.counts.plannedSlots ?? 0}</div><span>Плановая потребность</span></div>
          <button className={`metric-card success shift-metric-button ${futurePanelMode === 'willBe' ? 'selected' : ''}`} type="button" onClick={() => openFuturePanel('willBe')}>
            <span className="premium-kpi-icon" aria-hidden="true">✓</span>
            <div className="metric-label">Подтвердили «Я буду»</div>
            <div className="metric-value">{futureShift?.counts.willBe ?? 0}</div>
            <span>Открыть список</span>
          </button>
          <div className="metric-card cool"><span className="premium-kpi-icon" aria-hidden="true">●</span><div className="metric-label">Распределено</div><div className="metric-value">{futureShift?.counts.plannedAssignments ?? 0}</div><span>Линии и зоны</span></div>
          <div className="metric-card warning"><span className="premium-kpi-icon" aria-hidden="true">?</span><div className="metric-label">Подтвердили без места</div><div className="metric-value">{futureShift?.counts.confirmedUnassigned ?? 0}</div><span>Нужно распределить</span></div>
          <div className="metric-card muted"><span className="premium-kpi-icon" aria-hidden="true">!</span><div className="metric-label">Назначены без ответа</div><div className="metric-value">{futureShift?.counts.assignedUnconfirmed ?? 0}</div><span>Нужно подтвердить</span></div>
          <div className={`metric-card ${futureShift?.counts.deficit ? 'danger' : 'success'}`}><span className="premium-kpi-icon" aria-hidden="true">−</span><div className="metric-label">Дефицит</div><div className="metric-value">{futureShift?.counts.deficit ?? 0}</div><span>Свободные слоты</span></div>
          <div className={`metric-card ${futureShift?.counts.surplus ? 'warning' : 'muted'}`}><span className="premium-kpi-icon" aria-hidden="true">+</span><div className="metric-label">Избыток</div><div className="metric-value">{futureShift?.counts.surplus ?? 0}</div><span>Можно не вызывать</span></div>
        </div>
      ) : null}
      {shiftTab === 'past' ? (
        <div className="metric-grid premium-kpi-strip operational-metrics past-metrics" data-count="2">
          <div className="metric-card muted"><span className="premium-kpi-icon" aria-hidden="true">Σ</span><div className="metric-label">Прошлых смен</div><div className="metric-value">{pastShift?.shifts?.length ?? 0}</div></div>
          <div className="metric-card muted"><span className="premium-kpi-icon" aria-hidden="true">⌂</span><div className="metric-label">Действия</div><div className="metric-value">Архив</div></div>
        </div>
      ) : null}

      <button className={`shift-selector-compact ${shiftTab}`} type="button" aria-haspopup="dialog" aria-expanded={shiftPickerOpen} onClick={() => setShiftPickerOpen(true)}>
        <span>
          <small>{shiftModeInfo.title} · {selectedFactoryName}</small>
          <strong>{shiftModeInfo.details}</strong>
        </span>
        <span className="shift-selector-action">Выбрать смену <b aria-hidden="true">⌄</b></span>
      </button>

      {shiftPickerOpen ? (
        <div className="modal-backdrop sheet-backdrop shift-picker-backdrop" role="dialog" aria-modal="true" aria-labelledby="shift-picker-title" onClick={() => setShiftPickerOpen(false)}>
          <div
            className="modal-card shift-picker-sheet compact-modal"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => { shiftPickerTouchStartY.current = event.touches[0]?.clientY ?? null; }}
            onTouchEnd={(event) => {
              const start = shiftPickerTouchStartY.current;
              const end = event.changedTouches[0]?.clientY ?? null;
              shiftPickerTouchStartY.current = null;
              if (start !== null && end !== null && end - start > 70) setShiftPickerOpen(false);
            }}
          >
            <div className="sheet-drag-handle" aria-hidden="true" />
            <div className="line-title-row">
              <div><h3 id="shift-picker-title">Выбрать смену</h3><span>Текущий экран и прокрутка сохранятся</span></div>
              <button className="secondary-button compact-action" type="button" onClick={() => setShiftPickerOpen(false)}>Закрыть</button>
            </div>
            <div className="shift-picker-options">
              <button className={`shift-picker-option ${shiftTab === 'current' ? 'selected' : ''}`} type="button" onClick={() => chooseShift('current')}>
                <span><strong>Текущая смена</strong><small>{shiftTimeline?.current ? `${formatShiftDateLabel(shiftTimeline.current.shiftDate)} · ${shiftKindLabel(shiftTimeline.current.shiftType)} · ${shiftKindRange(shiftTimeline.current.shiftType)}` : 'Сейчас'}</small></span>
                <span className="tag work">Сейчас</span>
              </button>
              <button className={`shift-picker-option ${shiftTab === 'next' ? 'selected' : ''}`} type="button" onClick={() => chooseShift('next')}>
                <span><strong>Следующая смена</strong><small>{shiftTimeline?.next ? `${formatShiftDateLabel(shiftTimeline.next.shiftDate)} · ${shiftKindLabel(shiftTimeline.next.shiftType)} · ${shiftKindRange(shiftTimeline.next.shiftType)}` : 'План'}</small></span>
                <span className="tag pause">План</span>
              </button>
              <button className={`shift-picker-option ${shiftTab === 'past' ? 'selected' : ''}`} type="button" disabled={!canReadPastShift} onClick={() => chooseShift('past')}>
                <span><strong>Прошлая смена</strong><small>{shiftTimeline?.past?.[0] ? `${formatShiftDateLabel(shiftTimeline.past[0].shiftDate)} · ${shiftKindLabel(shiftTimeline.past[0].shiftType)}` : 'Архив недоступен'}</small></span>
                <span className="tag">Архив</span>
              </button>
              {shiftTimeline?.future.slice(0, 2).map((target, index) => (
                <button className={`shift-picker-option ${shiftTab === 'future' && selectedFutureTarget?.targetShiftDate === target.targetShiftDate && selectedFutureTarget?.shiftType === target.shiftType ? 'selected' : ''}`} type="button" key={`${target.targetShiftDate}:${target.shiftType}`} onClick={() => chooseShift('future', target)}>
                  <span><strong>Будущая смена {index + 1}</strong><small>{formatShiftDateLabel(target.shiftDate)} · {shiftKindLabel(target.shiftType)} · {shiftKindRange(target.shiftType)}</small></span>
                  <span className="tag pause">Будущая</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {shiftTab === 'current' && canReadHandover && previousHandover?.handover?.snapshot ? (
        <section className="card handover-received-card">
          <div>
            <p className="eyebrow">Передано предыдущей сменой</p>
            <h3>{previousHandover.handover.snapshot.shiftLabel} · {formatShiftDateLabel(previousHandover.handover.snapshot.shiftDate)}</h3>
            <p>{previousHandover.handover.snapshot.authorName} · {formatDateTime(previousHandover.handover.snapshot.generatedAt)}</p>
            <div className="line-meta">
              <span className="tag pause">Оперативных хвостов: {previousHandover.handover.snapshot.counts.total}</span>
              {previousHandover.handover.snapshot.comment ? <span className="tag">Есть комментарий</span> : null}
            </div>
          </div>
          <button className="primary-button" type="button" disabled={handoverLoading} onClick={() => void openPreviousHandover()}>Открыть</button>
        </section>
      ) : null}
      {shiftTab === 'current' && canHandover && handoverAvailability?.available ? (
        <button className="action-button work handover-open-button" type="button" disabled={handoverLoading} onClick={() => void openHandoverSummary()}>
          {handoverView?.alreadyHandedOver ? 'Открыть передачу смены' : 'Передать смену'}
        </button>
      ) : null}
      {loading && !initialLoadCompleted ? <div className="empty-state">Загружаю смену...</div> : null}
      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {toastText ? <div className="empty-state success-state">{toastText}</div> : null}
      <div className="live-refresh-row" aria-live="polite">
        <span className={`live-refresh-pill ${liveStatus.startsWith('Обновлено') ? 'updated' : ''}`}>{liveStatus}</span>
      </div>

      {shiftTab === 'current' && isManagerView && peoplePanelMode ? (
        <div className="modal-backdrop sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="shift-people-panel-title" onClick={() => setPeoplePanelMode(null)}>
        <section className="modal-card current-people-panel shift-workforce-panel current-people-sheet" id="shift-people-panel" onClick={(event) => event.stopPropagation()}>
          <div className="line-title-row">
            <div>
              <h3 id="shift-people-panel-title">На смене</h3>
              <span>Свободные сначала, затем уже распределённые сотрудники</span>
            </div>
            <span className="slot-inline-actions">
              <span className="tag work">Свободные: {filteredFreeWorkforcePeople.length}</span>
              <span className="tag pause">Распределены: {filteredAssignedWorkforcePeople.length}</span>
            </span>
          </div>
          <label className="field-label" htmlFor="shift-people-search">Поиск по ФИО, роли, линии</label>
          <input
            id="shift-people-search"
            value={peopleSearch}
            onChange={(event) => setPeopleSearch(event.target.value)}
            placeholder="Например: Иванов, фасовщик, Пицца"
          />
          <button className="secondary-button manual-employee-search-button" type="button" disabled={busy} onClick={() => openManualEmployeeSearch('CURRENT')}>
            Выбрать из неотмеченных
          </button>
          {selectedQuickPerson ? (
            <div className="empty-state compact selected-person-hint">
              Выбран для следующего назначения: {shortPersonName(selectedQuickPerson.userId, selectedQuickPerson.displayName)}
            </div>
          ) : null}
          <div className="shift-workforce-sections">
            <section className="workforce-section">
              <div className="section-subhead compact-heading"><h3>Свободные</h3><span>{filteredFreeWorkforcePeople.length}</span></div>
              <div className="quick-people-grid workforce-grid">
                {filteredFreeWorkforcePeople.map((person) => {
                  const meta = stateMeta[person.employeeState];
                  const selected = selectedQuickPersonId === person.userId;
                  return (
                    <article className={`quick-person-card workforce-person-card ${selected ? 'selected' : ''}`} key={person.userId}>
                      <div className="quick-person-main">
                        <ProfilePhoto photo={person.profilePhoto} userId={person.userId} displayName={person.displayName} size="small" />
                        <div>
                          <strong>{shortPersonName(person.userId, person.displayName)}</strong>
                          <span>{roleLabels[person.role] ?? person.role}{person.companyName ? ` · ${person.companyName}` : person.departmentName ? ` · ${person.departmentName}` : ''}</span>
                          <span>{person.departmentName ?? person.companyName ?? 'Подразделение не указано'}</span>
                        </div>
                        <span className={`tag ${meta.tag}`}>{meta.label}</span>
                      </div>
                      <div className="quick-person-actions compact-person-actions">
                        <button className="primary-button compact-action" type="button" disabled={busy} onClick={() => openAssignmentMenu(person)}>Назначить</button>
                      </div>
                    </article>
                  );
                })}
                {!filteredFreeWorkforcePeople.length ? <div className="empty-state compact">Свободных работников или наёмных сотрудников нет</div> : null}
              </div>
            </section>

            <section className="workforce-section">
              <div className="section-subhead compact-heading"><h3>Распределены</h3><span>{filteredAssignedWorkforcePeople.length}</span></div>
              <div className="quick-people-grid workforce-grid">
                {filteredAssignedWorkforcePeople.map((person) => {
                  const meta = stateMeta[person.employeeState];
                  const selected = selectedQuickPersonId === person.userId;
                  const busyLabel = assignmentDestinationLabel(person);
                  return (
                    <article className={`quick-person-card workforce-person-card assigned ${selected ? 'selected' : ''}`} key={person.userId}>
                  <div className="quick-person-main">
                    <ProfilePhoto photo={person.profilePhoto} userId={person.userId} displayName={person.displayName} size="small" />
                    <div>
                      <strong>{shortPersonName(person.userId, person.displayName)}</strong>
                      <span>{roleLabels[person.role] ?? person.role}{person.companyName ? ` · ${person.companyName}` : person.departmentName ? ` · ${person.departmentName}` : ''}</span>
                          <span>{assignmentKindLabel(person)}: {busyLabel}</span>
                    </div>
                    <span className={`tag ${meta.tag}`}>{meta.label}</span>
                  </div>
                      <div className="quick-person-actions compact-person-actions">
                        <button className="primary-button compact-action" type="button" disabled={busy} onClick={() => openAssignmentMenu(person)}>Переназначить</button>
                      </div>
                    </article>
                  );
                })}
                {!filteredAssignedWorkforcePeople.length ? <div className="empty-state compact">Распределённых работников или наёмных сотрудников нет</div> : null}
              </div>
            </section>
          </div>
          <p className="skill-legend compact-skill-legend">Навык проверяется по выбранной линии и позиции: зелёный — прямое совпадение, золотой — схожий навык, нейтральный — без подтверждённого совпадения.</p>
          <div className="modal-actions sticky-actions">
            <button className="secondary-button" type="button" onClick={() => setPeoplePanelMode(null)}>Закрыть</button>
          </div>
        </section>
        </div>
      ) : null}

      {(shiftTab === 'next' || shiftTab === 'future') && futurePanelMode ? (
        <section className="card admin-card wide current-people-panel future-planning-panel" id="future-planning-panel">
          <div className="line-title-row">
            <div>
              <h3>{futurePanelTitle}</h3>
              <span>Компактный план будущей смены. Текущая смена не меняется.</span>
            </div>
            <span className="slot-inline-actions">
              <span className="tag">
                {futurePanelMode === 'willBe'
                  ? filteredFutureWillBe.length
                  : futurePanelMode === 'contractors'
                    ? filteredFutureContractors.length
                    : filteredPlannedFutureLines.length}
              </span>
              {futurePanelMode === 'plannedLines' && isManagerView && !filteredPlannedFutureLines.length ? (
                <button className="secondary-button compact-action" type="button" disabled={busy || !pilotLines.length} onClick={() => void openFutureDraftBoard()}>
                  Открыть черновик
                </button>
              ) : null}
            </span>
          </div>
          <div className="tab-row compact-tabs">
            <button className={futurePanelMode === 'willBe' ? 'primary-button' : 'secondary-button'} type="button" onClick={() => openFuturePanel('willBe', selectedFuturePersonId)}>Я буду</button>
            {isManagerView ? <button className={futurePanelMode === 'contractors' ? 'primary-button' : 'secondary-button'} type="button" onClick={() => openFuturePanel('contractors', selectedFuturePersonId)}>Наёмники</button> : null}
            <button className={futurePanelMode === 'plannedLines' ? 'primary-button' : 'secondary-button'} type="button" onClick={() => openFuturePanel('plannedLines', selectedFuturePersonId)}>Плановые линии</button>
          </div>
          <label className="field-label" htmlFor="future-planning-search">Поиск по ФИО, линии, статусу</label>
          <input
            id="future-planning-search"
            value={futureSearch}
            onChange={(event) => setFutureSearch(event.target.value)}
            placeholder="Например: Иванов, Пицца, оператор"
          />
          {isManagerView ? (
            <button className="secondary-button manual-employee-search-button" type="button" disabled={busy} onClick={() => openManualEmployeeSearch('FUTURE')}>
              Назначить не отметившегося
            </button>
          ) : null}
          {selectedFuturePersonId ? (
            <div className="empty-state compact selected-person-hint">
              Выбран для планового назначения: {shortPersonName(selectedFuturePersonId, selectedFuturePersonName)}
            </div>
          ) : null}
          {futurePanelMode === 'willBe' ? (
            <div className="quick-people-grid">
              {filteredFutureWillBe.map((person) => {
                const userId = person.userId ?? '';
                const selected = selectedFuturePersonId === userId;
                const planned = futurePlanForUser(userId);
                return (
                  <article className={`quick-person-card ${selected ? 'selected' : ''}`} key={person.id}>
                    <div className="quick-person-main">
                      <ProfilePhoto photo={null} userId={userId || person.id} displayName={person.displayName} size="small" />
                      <div>
                        <strong>{shortPersonName(userId || person.id, person.displayName)}</strong>
                        <span>Будущая смена · {willBeStatusLabel(person.status)}</span>
                        {planned ? <span>План: {planned.targetLabel}</span> : null}
                        {person.comment ? <span>{person.comment}</span> : null}
                      </div>
                      <span className={`tag ${planned ? 'pause' : 'work'}`}>{planned ? 'Есть план' : 'Я буду'}</span>
                    </div>
                    <div className="quick-person-actions">
                      {userId ? <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void openProfile(userId)}>Профиль</button> : null}
                      {isManagerView ? (
                        <>
                          <button className="primary-button compact-action" type="button" disabled={busy || !userId || person.status !== 'WILL_BE'} onClick={() => void openFutureAssignmentBoardForUser(userId, person.displayName)}>
                            Назначить
                          </button>
                          {person.status === 'WILL_BE' ? (
                            <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => {
                              setNotNeededWillBe({ id: person.id, userId, displayName: person.displayName });
                              setNotNeededReason('');
                            }}>
                              Не вызывать
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {!filteredFutureWillBe.length ? <div className="empty-state compact">На эту смену пока никто не отметил “Я буду”</div> : null}
            </div>
          ) : null}
          {futurePanelMode === 'contractors' ? (
            <div className="quick-people-grid">
              {filteredFutureContractors.map((person) => {
                const userId = person.contractorUserId ?? '';
                const selected = selectedFuturePersonId === userId;
                const planned = futurePlanForUser(userId);
                return (
                  <article className={`quick-person-card ${selected ? 'selected' : ''}`} key={person.id ?? `${person.displayName}-${person.leadName}`}>
                    <div className="quick-person-main">
                      <ProfilePhoto photo={null} userId={userId || person.displayName} displayName={person.displayName} size="small" />
                      <div>
                        <strong>{shortPersonName(userId || person.displayName, person.displayName)}</strong>
                        <span>Наёмный работник · {person.companyName ?? 'фирма не указана'} · заявка: {person.leadName}</span>
                        {planned ? <span>План: {planned.targetLabel}</span> : null}
                        <span>{person.status}</span>
                      </div>
                      <span className={`tag ${planned ? 'pause' : ''}`}>{planned ? 'Есть план' : 'Наёмник'}</span>
                    </div>
                    <div className="quick-person-actions">
                      {userId ? <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void openProfile(userId)}>Профиль</button> : null}
                      {isManagerView ? (
                        <button className="primary-button compact-action" type="button" disabled={busy || !userId} onClick={() => void openFutureAssignmentBoardForUser(userId, person.displayName)}>
                          Назначить
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {!filteredFutureContractors.length ? <div className="empty-state compact">Наёмники на эту смену пока не заявлены</div> : null}
            </div>
          ) : null}
          {futurePanelMode === 'plannedLines' ? (
            <div className="quick-people-grid future-line-grid">
              {filteredPlannedFutureLines.map((line) => (
                <article className={`quick-person-card future-line-card ${line.shortageCount ? 'needs-attention' : ''}`} key={line.lineId}>
                  <div className="quick-person-main">
                    <div className="line-avatar">ЛН</div>
                    <div>
                      <strong>{line.lineName}</strong>
                      <span>{line.statusLabel} · назначено {line.plannedAssignmentsCount} из {line.plannedSlots}</span>
                      <span>{line.shortageCount ? `Не хватает мест: ${line.shortageCount}` : 'Состав по плану закрыт'}</span>
                      {line.staffingTemplateName ? <span>Шаблон: {line.staffingTemplateName}</span> : null}
                    </div>
                    <span className={`tag ${line.shortageCount ? 'pause' : 'work'}`}>{line.shortageCount ? 'Нужно закрыть' : 'Готово'}</span>
                  </div>
                  {isManagerView ? <div className="quick-person-actions"><button className="primary-button compact-action" type="button" disabled={busy} onClick={() => void openPlannedLineBoard(line, selectedFuturePersonId || undefined)}>Открыть назначение</button></div> : null}
                </article>
              ))}
              {!filteredPlannedFutureLines.length ? <div className="empty-state compact">Плановых линий по этому фильтру нет. Черновик назначения доступен в заголовке панели.</div> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {shiftTab === 'next' ? (
        <section className="card admin-card wide planning-card">
          <h3>Следующая смена</h3>
          <p>План ближайшей смены: кто отметил “Я буду”, какие линии подготовить и кого поставить в конкретные слоты. Это не текущая работа.</p>
          {isManagerView ? (
            <>
              <div className="line-meta planning-meta">
                <span className="tag work">{shiftTimeline?.next.shiftDate ?? futureShift?.targetShiftDate?.slice(0, 10)} · {shiftTimeline?.next.shiftType === 'NIGHT' || futureShift?.shiftType === 'NIGHT' ? 'Ночь' : 'День'}</span>
                <span className="tag work">Подтвердили: {futureShift?.counts.willBe ?? 0}</span>
                <span className="tag pause">Отменили: {futureShift?.counts.cancelled ?? 0}</span>
                <span className="tag">Сняты мастером: {futureShift?.counts.removed ?? 0}</span>
                <span className="tag">Наёмники: {futureShift?.counts.contractorItems ?? 0}</span>
              </div>
              <div className="section-stack">
                {futureShift?.willBe.slice(0, 12).map((item) => (
                  <div className="position-row" key={item.id}>
                    <div><strong>{shortPersonName(item.id, item.displayName)}</strong><span>План · {willBeStatusLabel(item.status)}{item.comment ? ` · ${item.comment}` : ''}</span></div>
                  </div>
                ))}
                {!futureShift?.willBe.length ? <div className="empty-state compact">Пока никто не отметился</div> : null}
              </div>
              <div className="section-subhead">
                <h3>Плановые линии</h3>
                <span>{futureShift?.counts.plannedLines ?? futureShift?.plannedLines?.length ?? 0}</span>
              </div>
              <div className="section-stack planned-lines-list">
                {futureShift?.plannedLines?.map((line) => (
                  <button className="position-row planned-line-row" type="button" key={line.lineId} disabled={busy} onClick={() => void openPlannedLineBoard(line)}>
                    <div>
                      <strong>{line.lineName}</strong>
                      <span>{line.statusLabel} · назначено {line.plannedAssignmentsCount} из {line.plannedSlots}{line.shortageCount ? ` · не хватает ${line.shortageCount}` : ''}</span>
                      {line.staffingTemplateName ? <span>Шаблон: {line.staffingTemplateName}</span> : null}
                    </div>
                    <span className="tag pause">План</span>
                  </button>
                ))}
                {!futureShift?.plannedLines?.length ? <div className="empty-state compact">Линии в план этой смены ещё не добавлены</div> : null}
              </div>
              <div className="modal-actions">
                <button className="primary-button" type="button" disabled={busy} onClick={() => setPlanningLinePickerOpen(true)}>Добавить линию в план</button>
              </div>
            </>
          ) : (
            <>
              <p>Отметка “Я буду” видна только вам и мастеру смены.</p>
              <div className="line-meta">
                <span className="tag">{selfShift?.activeWillBe ? 'Вы отметились' : 'Отметки нет'}</span>
                {selfShift?.activeWillBe ? <span className="tag">{selfShift.activeWillBe.shiftType}</span> : null}
              </div>
              <textarea value={willBeComment} onChange={(event) => setWillBeComment(event.target.value)} placeholder={selfShift?.activeWillBe ? 'Комментарий для отмены' : 'Комментарий к отметке, если нужен'} />
              <div className="modal-actions">
                {!selfShift?.activeWillBe ? <button className="primary-button" type="button" onClick={() => void markWillBe()} disabled={busy}>Я буду</button> : null}
                {selfShift?.activeWillBe ? <button className="secondary-button" type="button" onClick={() => void cancelWillBe()} disabled={busy}>Отменить</button> : null}
              </div>
              <div className="section-subhead"><h3>Моё место</h3><span>План</span></div>
              {futureShift?.ownAssignment ? (
                <article className="position-row worker-own-future-assignment">
                  <div>
                    <strong>{futureShift.ownAssignment.targetLabel}</strong>
                    <span>{futureShift.ownAssignment.kind === 'LINE' ? 'Линия и позиция' : 'Рабочая зона / повременщик'}{'slotIndex' in futureShift.ownAssignment && futureShift.ownAssignment.slotIndex ? ` · слот ${futureShift.ownAssignment.slotIndex}` : ''}</span>
                  </div>
                  <span className="tag work">Назначено</span>
                </article>
              ) : <div className="empty-state compact">Место ещё не определено.</div>}
              <div className="section-subhead"><h3>Плановые линии</h3><span>{futureShift?.plannedLines?.length ?? 0}</span></div>
              <div className="section-stack planned-lines-list">
                {futureShift?.plannedLines?.map((line) => (
                  <div className="position-row planned-line-row" key={line.lineId}>
                    <div>
                      <strong>{line.lineName}</strong>
                      <span>{line.statusLabel} · плановые слоты: {line.plannedSlots}</span>
                    </div>
                    <span className="tag pause">План</span>
                  </div>
                ))}
                {!futureShift?.plannedLines?.length ? <div className="empty-state compact">Плановые линии пока не опубликованы</div> : null}
              </div>
            </>
          )}
        </section>
      ) : null}

      {shiftTab === 'future' ? (
        <section className="card admin-card wide planning-card">
          <h3>Будущие смены</h3>
          <p>Выберите дату, чтобы открыть такой же план, как у “Следующей” смены: люди “Я буду”, плановые линии и конкретные слоты.</p>
          <div className="section-stack">
            {shiftTimeline?.future.map((target) => (
              <button
                className={`position-row ${selectedFutureTarget?.shiftDate === target.shiftDate && selectedFutureTarget?.shiftType === target.shiftType ? 'selected' : ''}`}
                key={`${target.shiftDate}-${target.shiftType}`}
                type="button"
                onClick={() => setSelectedFutureTarget(target)}
              >
                <div>
                  <strong>{target.shiftDate} · {target.shiftType === 'NIGHT' ? 'Ночь' : 'День'}</strong>
                  <span>{selectedFutureTarget?.shiftDate === target.shiftDate && selectedFutureTarget?.shiftType === target.shiftType ? 'Открыт план этой смены' : 'Открыть план смены'}</span>
                </div>
                <span className="slot-inline-actions">
                  <span className="tag">Будущая</span>
                </span>
              </button>
            ))}
            {!shiftTimeline?.future.length ? <div className="empty-state compact">Будущие смены пока не рассчитаны</div> : null}
          </div>
          {selectedFutureTarget ? (
            <>
              <div className="line-meta planning-meta">
                <span className="tag work">{selectedFutureTarget.shiftDate} · {selectedFutureTarget.shiftType === 'NIGHT' ? 'Ночь' : 'День'}</span>
                <span className="tag work">Подтвердили: {futureShift?.counts.willBe ?? 0}</span>
                <span className="tag">Плановых линий: {futureShift?.counts.plannedLines ?? futureShift?.plannedLines?.length ?? 0}</span>
                <span className="tag pause">Текущая смена не затрагивается</span>
              </div>
              <div className="section-subhead"><h3>Отметились “Я буду”</h3><span>{futureShift?.counts.willBe ?? 0}</span></div>
              <div className="section-stack">
                {futureShift?.willBe.slice(0, 12).map((item) => (
                  <div className="position-row" key={item.id}>
                    <div><strong>{shortPersonName(item.id, item.displayName)}</strong><span>План · {willBeStatusLabel(item.status)}{item.comment ? ` · ${item.comment}` : ''}</span></div>
                  </div>
                ))}
                {!futureShift?.willBe.length ? <div className="empty-state compact">Пока никто не отметился</div> : null}
              </div>
              <div className="section-subhead"><h3>Плановые линии выбранной смены</h3><span>{futureShift?.plannedLines?.length ?? 0}</span></div>
              <div className="section-stack planned-lines-list">
                {futureShift?.plannedLines?.map((line) => isManagerView ? (
                  <button className="position-row planned-line-row" type="button" key={line.lineId} disabled={busy} onClick={() => void openPlannedLineBoard(line)}>
                    <div><strong>{line.lineName}</strong><span>{line.statusLabel} · назначено {line.plannedAssignmentsCount} из {line.plannedSlots}{line.shortageCount ? ` · не хватает ${line.shortageCount}` : ''}</span>{line.staffingTemplateName ? <span>Шаблон: {line.staffingTemplateName}</span> : null}</div>
                    <span className="tag pause">Открыть</span>
                  </button>
                ) : (
                  <article className="position-row planned-line-row" key={line.lineId}>
                    <div><strong>{line.lineName}</strong><span>Занято {line.plannedAssignmentsCount} из {line.plannedSlots} · без списка ФИО</span></div>
                    <span className="tag pause">План</span>
                  </article>
                ))}
                {!futureShift?.plannedLines?.length ? <div className="empty-state compact">В эту будущую смену линии ещё не добавлены</div> : null}
              </div>
              {!isManagerView ? (
                <>
                  <div className="section-subhead"><h3>Моё место</h3><span>План</span></div>
                  {futureShift?.ownAssignment ? (
                    <article className="position-row worker-own-future-assignment">
                      <div><strong>{futureShift.ownAssignment.targetLabel}</strong><span>{futureShift.ownAssignment.kind === 'LINE' ? 'Линия и позиция' : 'Рабочая зона / повременщик'}</span></div>
                      <span className="tag work">Назначено</span>
                    </article>
                  ) : <div className="empty-state compact">Место ещё не определено.</div>}
                </>
              ) : null}
              {isManagerView ? (
                <div className="modal-actions">
                  <button className="primary-button" type="button" disabled={busy} onClick={() => setPlanningLinePickerOpen(true)}>Добавить линию в план</button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {shiftTab === 'past' ? (
        <section className="card admin-card wide archive-shift-card">
          <h3>Прошлые смены</h3>
          <p>Архив смен. Здесь только просмотр: люди, линии, простои, заявки, мойка и пересменка без рабочих действий.</p>
          <div className="line-meta">
            <span className="tag">Месяц: {pastShift?.month ?? '...'}</span>
            <span className="tag">Смены: {pastShift?.shifts?.length ?? 0}</span>
            <span className="tag">Только просмотр</span>
          </div>
          <div className="past-shift-layout">
            <div className="section-stack past-shift-list">
              {pastShift?.shifts?.map((shift) => (
                <button className={`position-row past-shift-card ${pastShiftDetail?.key === shift.key ? 'selected' : ''}`} key={shift.key} type="button" onClick={() => void openPastShift(shift.key)} disabled={busy}>
                  <div>
                    <strong>{shift.title}</strong>
                    <span>Мастера: {shift.masterLabel}</span>
                    <span>Линии: {shift.lineCount} · Простои: {shift.downtimeCount} · Заявки: {shift.taskCount}</span>
                  </div>
                  <span className="tag">Архив</span>
                </button>
              ))}
              {!pastShift?.shifts?.length ? <div className="empty-state compact">История смен за период пуста</div> : null}
            </div>

            {pastShiftDetail ? (
              <div className="past-shift-detail">
                <div className="line-title-row">
                  <div>
                    <h3>{pastShiftDetail.title}</h3>
                    <span>{pastShiftDetail.timeRange} · режим только для просмотра</span>
                  </div>
                  <span className="tag pause">Архив</span>
                </div>
                <div className="tab-row compact-tabs">
                  {pastShiftDetail.tabs.map((tab) => (
                    <button key={tab} className={pastDetailTab === tab ? 'primary-button' : 'secondary-button'} type="button" onClick={() => setPastDetailTab(tab)}>
                      {tab}
                    </button>
                  ))}
                </div>

                {pastDetailTab === 'Обзор' ? (
                  <div className="metric-grid past-shift-summary">
                    <div className="metric-card"><div className="metric-label">Людей на смене</div><div className="metric-value">{pastShiftDetail.summary.peopleCount}</div></div>
                    <div className="metric-card"><div className="metric-label">Линий работало</div><div className="metric-value">{pastShiftDetail.summary.lineCount}</div></div>
                    <div className="metric-card accent"><div className="metric-label">Простои</div><div className="metric-value">{pastShiftDetail.summary.downtimeCount}</div><span>{pastShiftDetail.summary.downtimeLabel}</span></div>
                    <div className="metric-card"><div className="metric-label">Заявки</div><div className="metric-value">{pastShiftDetail.summary.taskCount}</div></div>
                    <div className="metric-card"><div className="metric-label">Мойки</div><div className="metric-value">{pastShiftDetail.summary.washCount}</div></div>
                    <div className="metric-card muted"><div className="metric-label">Важные записи</div><div className="metric-value">{pastShiftDetail.summary.importantShiftLogs}</div></div>
                    <div className="metric-card"><div className="metric-label">Наёмных работников</div><div className="metric-value">{pastShiftDetail.summary.contractorCount ?? 0}</div></div>
                    <div className="empty-state compact wide">Мастера: {pastShiftDetail.summary.masters.length ? pastShiftDetail.summary.masters.join(', ') : 'Мастер не указан'}</div>
                    {pastShiftDetail.summary.contractorCompanies?.length ? (
                      <div className="empty-state compact wide">По фирмам: {pastShiftDetail.summary.contractorCompanies.map((company) => `${company.name} — ${company.count}`).join(', ')}</div>
                    ) : null}
                  </div>
                ) : null}
                {pastDetailTab === 'Люди' ? (
                  <div className="section-stack">
                    {pastShiftDetail.people.map((person) => (
                      <div className="position-row" key={person.id}>
                        <div><strong>{person.displayName}</strong><span>{person.targetName} / {person.positionName}{person.slotIndex ? ` · слот ${person.slotIndex}` : ''}</span></div>
                      </div>
                    ))}
                    {!pastShiftDetail.people.length ? <div className="empty-state compact">Назначений в этой смене не найдено</div> : null}
                  </div>
                ) : null}
                {pastDetailTab === 'Линии' ? (
                  <div className="section-stack">
                    {pastShiftDetail.lines.map((line) => (
                      <div className="position-row past-line-row" key={line.lineId}>
                        <div>
                          <strong>{line.lineName ?? line.name ?? 'Линия не указана'}</strong>
                          <span>
                            {line.operationalStateDataStatus === 'MISSING'
                              ? 'Состояние: данные не были зафиксированы'
                              : `Состояние: ${line.operationalState === 'RUNNING' ? 'Работала' : line.operationalState === 'DOWNTIME' ? 'Простой' : line.operationalState === 'WASH' ? 'На мойке' : line.operationalState === 'DEFROST' ? 'На оттайке' : 'Остановлена'}`}
                          </span>
                          <span>Людей за смену: {line.peopleCount} · Простои: {line.downtimeCount} · Заявки: {line.taskCount ?? 0} · Мойка: {line.washCount ? 'была' : 'нет'}</span>
                          <span>
                            {line.staffingDataStatus === 'MISSING'
                              ? 'Состав: данные не были зафиксированы'
                              : `Состав: ${line.selectedComposition?.name ?? 'не указан'} · на завершение ${line.assignedCount ?? 0} из ${line.requiredCount ?? 0}`}
                          </span>
                          {line.workPlanRows.length ? <span>Задание смены: {line.workPlanRows.map((row) => `${row.article} — ${row.productName} — ${row.plannedGofrCount} гофр`).join('; ')}</span> : null}
                        </div>
                        <span className="tag">Только просмотр</span>
                      </div>
                    ))}
                    {!pastShiftDetail.lines.length ? <div className="empty-state compact">Данные по линиям не были зафиксированы</div> : null}
                  </div>
                ) : null}
                {pastDetailTab === 'Простои' ? (
                  <div className="section-stack">
                    {pastShiftDetail.downtime.map((item) => (
                      <div className="position-row" key={item.id}>
                        <div>
                          <strong>{item.startTime}–{item.endTime ?? 'не закрыт'} · {item.durationLabel}</strong>
                          <span>{item.lineName} · Причина: {item.reason}</span>
                          {item.comment ? <span>Комментарий: {item.comment}</span> : null}
                          {item.linkedTasks.length ? <span>Заявки: {item.linkedTasks.map((task) => `${task.departments.join(', ') || 'отдел не указан'} — ${task.statusLabel}`).join('; ')}</span> : null}
                        </div>
                        {item.corrected ? <span className="tag">Уточнено</span> : null}
                      </div>
                    ))}
                    {!pastShiftDetail.downtime.length ? <div className="empty-state compact">Простоев в этой смене не найдено</div> : null}
                  </div>
                ) : null}
                {pastDetailTab === 'Заявки' ? (
                  <div className="section-stack">
                    {pastShiftDetail.tasks.map((task) => (
                      <div className="position-row" key={task.id}>
                        <div>
                          <strong>{task.lineName} → {task.departments.join(', ') || 'отдел не указан'}</strong>
                          <span>{task.typeLabel} · {task.statusLabel} · создана {task.createdTime}{task.startedTime ? ` · взята ${task.startedTime}` : ''}{task.doneTime ? ` · закрыта ${task.doneTime}` : ''}</span>
                          {task.description ? <span>{task.description}</span> : null}
                        </div>
                        {task.overdueLong ? <span className="tag stop">Просрочена</span> : null}
                      </div>
                    ))}
                    {!pastShiftDetail.tasks.length ? <div className="empty-state compact">Заявок в этой смене не найдено</div> : null}
                  </div>
                ) : null}
                {pastDetailTab === 'Мойка' ? (
                  <div className="section-stack">
                    {pastShiftDetail.washes.map((wash) => (
                      <div className="position-row" key={wash.id}>
                        <div>
                          <strong>{wash.lineName}</strong>
                          <span>{wash.timeRange} · {wash.status}</span>
                          <span>Проблемы: {wash.issuesCount} · Контроль: {wash.controlItemsCount} · ОКК: {wash.okkReviews.length}</span>
                          {wash.okkReviews.some((review) => review.rating) ? <span>Оценка ОКК: {wash.okkReviews.map((review) => review.rating).filter(Boolean).join(', ')}</span> : null}
                        </div>
                      </div>
                    ))}
                    {!pastShiftDetail.washes.length ? <div className="empty-state compact">Моек в этой смене не найдено</div> : null}
                  </div>
                ) : null}
                {pastDetailTab === 'Пересменка' ? (
                  <div className="section-stack">
                    {pastShiftDetail.shiftLogs.map((log) => (
                      <div className="position-row" key={log.id}>
                        <div>
                          <strong>{log.title || 'Запись пересменки'}</strong>
                          <span>{log.createdTime} · {log.departmentName} · {log.authorName}</span>
                          <span>{log.text}</span>
                        </div>
                        {log.isImportant ? <span className="tag stop">Важная</span> : null}
                      </div>
                    ))}
                    {!pastShiftDetail.shiftLogs.length ? <div className="empty-state compact">Записей пересменки в этой смене не найдено</div> : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state compact">Выберите смену, чтобы посмотреть детали.</div>
            )}
          </div>
          <div className="empty-state compact">В архиве смен рабочие действия скрыты. Доступны только просмотр и переходы к источникам по правам.</div>
        </section>
      ) : null}

      {!isManagerView && selfShift?.allowedActions.canRequestReturn ? (
        <section className="card admin-card wide">
          <h3>Возврат на смену</h3>
          <p>Запрос отправляется мастеру. До решения управленческие действия недоступны.</p>
          <textarea value={returnReason} onChange={(event) => { setReturnReason(event.target.value); if (errorText === 'Укажите причину возврата') setErrorText(null); }} placeholder="Причина возврата" />
          <button className="primary-button" type="button" onClick={() => void requestReturn()} disabled={busy}>Запросить возврат</button>
        </section>
      ) : null}

      {shiftTab === 'current' && isContractorLead && contractorLeadPool ? (
        <section className="card admin-card wide contractor-lead-workbench">
          <div className="line-title-row">
            <div>
              <h3>Наёмные работники</h3>
              <span>{contractorLeadPool.company.name} · только ваша фирма</span>
            </div>
            <span className="tag work">Прибыло: {contractorLeadPool.people.filter((person) => person.actual?.actualStatus === 'ARRIVED').length}</span>
          </div>
          <div className="line-meta">
            <span className="tag">Запланировано: {contractorLeadPool.people.filter((person) => person.actual).length}</span>
            <span className="tag pause">Выбрано на следующую смену: {selectedContractorIds.length}</span>
          </div>
          <div className="section-subhead compact-heading"><h3>Текущая смена</h3><span>Факт</span></div>
          <div className="quick-people-grid workforce-grid">
            {contractorLeadPool.people.map((person) => {
              const status = person.actual?.actualStatus ?? null;
              return (
                <article className="quick-person-card workforce-person-card" key={person.userId}>
                  <div className="quick-person-main">
                    <ProfilePhoto photo={null} userId={person.userId} displayName={person.displayName} size="small" />
                    <div>
                      <strong>{shortPersonName(person.userId, person.displayName)}</strong>
                      <span>{person.onShift ? 'На смене' : 'Не на смене'}</span>
                    </div>
                    <span className={`tag ${status === 'ARRIVED' ? 'work' : status === 'ABSENT' ? 'stop' : 'pause'}`}>
                      {status === 'ARRIVED' ? 'Прибыл' : status === 'ABSENT' ? 'Отсутствует' : status === 'PLANNED' ? 'Запланирован' : 'Не запланирован'}
                    </span>
                  </div>
                  <div className="quick-person-actions">
                    {person.actual ? (
                      <>
                        <button className="primary-button compact-action" type="button" disabled={busy || status === 'ARRIVED'} onClick={() => void updateContractorActual(person, 'ARRIVED')}>Прибыл</button>
                        <button className="secondary-button compact-action" type="button" disabled={busy || status === 'ABSENT'} onClick={() => void updateContractorActual(person, 'ABSENT')}>Не прибыл</button>
                      </>
                    ) : (
                      <button className="primary-button compact-action" type="button" disabled={busy} onClick={() => void addContractorReplacement(person)}>Добавить как замену</button>
                    )}
                  </div>
                </article>
              );
            })}
            {!contractorLeadPool.people.length ? <div className="empty-state compact">В вашей фирме пока нет активных наёмных работников</div> : null}
          </div>
          <div className="section-subhead compact-heading"><h3>Следующая смена</h3><span>План</span></div>
          <div className="quick-people-grid workforce-grid">
            {contractorLeadPool.people.map((person) => {
              const selected = selectedContractorIds.includes(person.userId);
              return (
                <label className={`quick-person-card workforce-person-card contractor-plan-option ${selected ? 'selected' : ''}`} key={`plan-${person.userId}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleContractorPlanSelection(person.userId)} />
                  <span><strong>{shortPersonName(person.userId, person.displayName)}</strong><span>{selected ? 'Включён в план' : 'Не выбран'}</span></span>
                </label>
              );
            })}
          </div>
          <div className="modal-actions sticky-actions">
            <button className="secondary-button" type="button" disabled={busy || !contractorLeadPool.people.length} onClick={() => setSelectedContractorIds(contractorLeadPool.people.map((person) => person.userId))}>Выбрать всех</button>
            <button className="secondary-button" type="button" disabled={busy || !selectedContractorIds.length} onClick={() => setSelectedContractorIds([])}>Снять всех</button>
            <button className="primary-button" type="button" disabled={busy || !selectedContractorIds.length} onClick={() => void submitContractorPlan()}>Приведу: {selectedContractorIds.length}</button>
          </div>
          {contractorLeadSubmissions.length ? <p className="helper-text">Последний сохранённый план: {contractorLeadSubmissions[0].items.length} чел. · {contractorLeadSubmissions[0].companyNameSnapshot ?? contractorLeadPool.company.name}</p> : null}
        </section>
      ) : null}

      {shiftTab === 'current' ? <div className="shift-layout operational-workspace" id="shift-operational-content">
        {isManagerView && currentOperationalView === 'lines' ? (
          <section className="shift-column lines-active-section">
            <div className="section-subhead"><h3>Линии в работе</h3><span>{activeLines.length}</span></div>
            <div className="section-stack">
              {!loading && !activeLines.length ? <div className="empty-state">Работающих линий сейчас нет</div> : null}
              {activeLines.map((line) => renderCompactLineCard(line))}
            </div>
          </section>
        ) : null}

        {isManagerView && currentOperationalView === 'downtime' ? (
          <section className="shift-column current-downtime-panel">
            <div className="section-subhead"><h3>Активные простои</h3><span>{activeDowntimeLines.length}</span></div>
            <div className="section-stack">
              {!activeDowntimeLines.length ? <div className="empty-state compact">В текущей смене нет активных простоев.</div> : null}
              {activeDowntimeLines.map((line) => {
                const event = line.activeDowntimeEvent!;
                const eventStartAt = event.correctedStartAt ?? event.createdAt;
                const linkedTask = line.activeTaskSummary?.sourceKind === 'DOWNTIME' ? line.activeTaskSummary : null;
                return (
                  <article className="card current-downtime-row" key={event.id}>
                    <div className="current-downtime-main">
                      <div className="line-title-row"><h3 className="line-name">{line.name}</h3><span className="tag stop">Простой</span></div>
                      <span>{event.downtimeReasonLabel || 'Причина не указана'} · длится {formatElapsed(eventStartAt, null, lineEventServerNow)}</span>
                      {linkedTask ? (
                        <div className="line-task-summary assigned">
                          <span className="line-task-summary-label">Связанная заявка</span>
                          <strong>{linkedTask.serviceLabel || 'Служба не назначена'} · {linkedTask.taskStatusLabel}</strong>
                          <span>{linkedTask.assigneeDisplayName || 'Исполнитель не назначен'}{linkedTask.overdue ? ' · Просрочена' : ''}</span>
                        </div>
                      ) : <span className="helper-text">Активной заявки, связанной с этим простоем, нет.</span>}
                    </div>
                    <div className="current-downtime-actions">
                      <button className="secondary-button compact-action" type="button" onClick={() => openLineCard(line)}>Подробнее</button>
                      <button className="primary-button success compact-action" type="button" disabled={busy} onClick={() => void returnLineToWork(line)}>Вернуть в работу</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {isManagerView && currentOperationalView === 'requests' ? (
          <section className="shift-column current-requests-panel">
            <div className="section-subhead"><h3>Заявки, требующие внимания</h3><span>{masterAttentionTaskCount}</span></div>
            <div className="section-stack">
              {!operationalTaskLines.length ? <div className="empty-state compact">В текущей оперативной картине нет открытых заявок.</div> : null}
              {operationalTaskLines.map((line) => {
                const task = line.activeTaskSummary;
                if (!task) return (
                  <article className="card current-request-row" key={`task-count:${line.id}`}>
                    <div><strong>{line.name}</strong><span>Открытых заявок: {line.activeTasksCount ?? 0}</span></div>
                    <button className="secondary-button compact-action" type="button" onClick={openTaskScreen}>Открыть заявки</button>
                  </article>
                );
                return (
                  <article className={`card current-request-row ${task.overdue ? 'overdue' : ''}`} key={task.taskId}>
                    <div className="current-request-copy">
                      <div className="line-title-row"><strong>{line.name}</strong><span className={`tag ${task.overdue ? 'stop' : task.taskStatus === 'NEW' ? 'pause' : 'work'}`}>{task.taskStatusLabel}</span></div>
                      <span>{task.taskTypeLabel} · {task.sourceKind === 'DOWNTIME' ? 'Связана с простоем' : 'Производственная проблема'}</span>
                      <span>{task.serviceLabel || 'Служба не назначена'} · {task.assigneeDisplayName || 'Исполнитель не назначен'}</span>
                      <span>Возраст: {formatElapsed(task.createdAt, null, lineEventServerNow)}{task.overdue ? ' · требует внимания' : ''}</span>
                      {task.additionalActiveCount ? <span>Ещё открытых по линии: {task.additionalActiveCount}</span> : null}
                    </div>
                    <button className="secondary-button compact-action" type="button" onClick={openTaskScreen}>Подробнее</button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {!isManagerView && (isTechnicalReader || currentUser?.role === 'WORKER') ? (
          <section className="shift-column" data-testid="shift-readonly-lines">
            <div className="section-subhead"><h3>Линии в работе</h3><span>{activeLines.length}</span></div>
            <div className="section-stack">
              {!loading && !activeLines.length ? <div className="empty-state compact">Работающих линий сейчас нет</div> : null}
              {activeLines.map((line) => renderCompactLineCard(line, true))}
            </div>
          </section>
        ) : null}

        {isManagerView && currentOperationalView === 'lines' ? (
          <section className="shift-column">
            <div className="section-subhead"><h3>Повременщики и рабочие зоны</h3><span>{workAreas.length}</span></div>
            <div className="section-stack">
              {!loading && !workAreas.length ? <div className="empty-state">Рабочие зоны пока не настроены</div> : null}
              {[...timeAreas, ...operationalWorkAreas].map((area) => {
                const required = area.shortageSummary?.reduce((sum, item) => sum + item.required, 0) ?? 0;
                const assigned = area.shortageSummary?.reduce((sum, item) => sum + item.actual, 0) ?? 0;
                const missing = area.shortageSummary?.reduce((sum, item) => sum + item.missing, 0) ?? 0;
                return (
                  <article className={`card line-summary-card work-area-card ${missing > 0 ? 'shortage' : ''}`} key={area.id}>
                    <div className="line-title-row">
                      <div><h3 className="line-name">{area.name}</h3><span>{area.assignmentKind === 'TIME' ? 'Повременщики' : 'Рабочая зона'}</span></div>
                      <span className={`tag ${missing > 0 ? 'stop' : 'work'}`}>{missing > 0 ? 'Нехватка' : 'Укомплектовано'}</span>
                    </div>
                    <div className="line-meta">
                      <span className="tag">Нужно: {required}</span>
                      <span className="tag">Назначено: {assigned}</span>
                      <span className={`tag ${missing > 0 ? 'stop' : 'work'}`}>Не хватает: {missing}</span>
                    </div>
                    <button className="primary-button line-open-button" type="button" onClick={() => void openWorkAreaBoard(area.id)}>
                      {area.assignmentKind === 'TIME' ? 'Открыть повременщиков' : 'Открыть рабочую зону'}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {isManagerView && currentOperationalView === 'lines' ? (
          <section className="shift-column lines-wash-section" data-testid="shift-wash-lines">
            <div className="section-subhead"><h3>Линии на мойке</h3><span>{washLines.length}</span></div>
            <div className="section-stack">
              {!washLines.length ? <div className="empty-state compact">Линий на мойке сейчас нет</div> : null}
              {washLines.map((line) => renderCompactLineCard(line))}
            </div>
          </section>
        ) : null}

        {isManagerView && currentOperationalView === 'lines' ? (
          <section className="shift-column lines-stopped-section" data-testid="shift-stopped-lines">
            <div className="section-subhead"><h3>Остановленные линии</h3><span>{stoppedLines.length + inactiveLines.length}</span></div>
            <div className="section-stack">
              {[...stoppedLines, ...inactiveLines].map((line) => renderCompactLineCard(line))}
              {!stoppedLines.length && !inactiveLines.length ? <div className="empty-state compact">Остановленных линий нет</div> : null}
              <button className="primary-button start-line-compact-button" type="button" disabled={!stoppedLines.length && !inactiveLines.length} onClick={() => {
                setAssignmentFlowUser(null);
                setCurrentLinePickerSelection({ userId: '', displayName: 'Выберите линию для запуска', mode: 'start' });
              }}>
                Запустить новую линию
              </button>
            </div>
          </section>
        ) : null}

        {isManagerView && currentOperationalView === 'lines' ? (
          <section className="shift-column current-shift-attendance-section">
            <div className="section-subhead"><h3>На смене</h3><span>{workforcePeople.filter((person) => person.onShift !== false && person.employeeState !== 'OFF_SHIFT').length}</span></div>
            <div className="current-shift-people-list">
              {workforcePeople
                .filter((person) => person.onShift !== false && person.employeeState !== 'OFF_SHIFT')
                .map((person) => renderAttendanceRow(person))}
              {!workforcePeople.some((person) => person.onShift !== false && person.employeeState !== 'OFF_SHIFT') ? <div className="empty-state compact">На текущей смене пока нет сотрудников.</div> : null}
            </div>
          </section>
        ) : null}

        {!isManagerView && (isOperationalReader || currentUser?.role === 'WORKER') ? (
          <section className="shift-column" data-testid="shift-readonly-time-areas">
            <div className="section-subhead"><h3>Повременщики</h3><span>{timeAreas.length}</span></div>
            <div className="section-stack">
              {!loading && !timeAreas.length ? <div className="empty-state compact">Позиции повременщиков пока не настроены</div> : null}
              {timeAreas.map((area) => {
                const required = area.shortageSummary?.reduce((sum, item) => sum + item.required, 0) ?? 0;
                const actual = area.shortageSummary?.reduce((sum, item) => sum + item.actual, 0) ?? 0;
                const missing = area.shortageSummary?.reduce((sum, item) => sum + item.missing, 0) ?? 0;
                return (
                  <article className="card line-summary-card work-area-card readonly" key={area.id}>
                    <div className="line-title-row">
                      <div><h3 className="line-name">{area.name}</h3><span>Повременщики</span></div>
                      <span className={`tag ${missing > 0 ? 'stop' : 'work'}`}>{actual}/{required}</span>
                    </div>
                    <div className="line-meta">
                      <span className="tag">Нужно: {required}</span>
                      <span className="tag">Назначено: {actual}</span>
                      <span className={`tag ${missing > 0 ? 'stop' : 'work'}`}>Не хватает: {missing}</span>
                    </div>
                    <div className="line-meta">
                      {area.shortageSummary?.slice(0, 4).map((item) => (
                        <span className="tag" key={item.workAreaPositionId}>{item.title}: {item.actual}/{item.required}</span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {!isManagerView && (isTechnicalReader || currentUser?.role === 'WORKER') ? (
          <section className="shift-column lines-wash-section" data-testid="shift-readonly-wash-lines">
            <div className="section-subhead"><h3>Линии на мойке</h3><span>{washLines.length}</span></div>
            <div className="section-stack">
              {!washLines.length ? <div className="empty-state compact">Линий на мойке сейчас нет</div> : null}
              {washLines.map((line) => renderCompactLineCard(line, true))}
            </div>
          </section>
        ) : null}

        {!isManagerView && (isTechnicalReader || currentUser?.role === 'WORKER') ? (
          <section className="shift-column lines-stopped-section" data-testid="shift-readonly-stopped-lines">
            <div className="section-subhead"><h3>Остановленные линии</h3><span>{stoppedLines.length + inactiveLines.length}</span></div>
            <div className="section-stack">
              {[...stoppedLines, ...inactiveLines].map((line) => renderCompactLineCard(line, true))}
              {!stoppedLines.length && !inactiveLines.length ? <div className="empty-state compact">Остановленных линий нет</div> : null}
            </div>
          </section>
        ) : null}

        {!isManagerView ? (
        <section className="shift-column">
          <div className="section-subhead">
            <h3>{isStoreReader ? 'Свободные люди' : isTechnicalReader ? 'Люди текущей смены' : 'Моя смена'}</h3>
            <span>{people.length}</span>
          </div>
          {isManagerView ? (
            <label className="toggle-row">
              <input checked={includeAllPeople} onChange={(event) => setIncludeAllPeople(event.target.checked)} type="checkbox" />
              Показать всех
            </label>
          ) : null}
          <div className="section-stack">
            {!loading && !people.length ? <div className="empty-state">Людей в доступной области пока нет</div> : null}
            {peopleGroups.map(([group, groupPeople]) => (
              <section className="people-group" key={group}>
                <div className="section-subhead compact-heading"><h3>{group}</h3><span>{groupPeople.length}</span></div>
                {groupPeople.map((person) => {
                  const meta = stateMeta[person.employeeState];
                  const assignable = isAssignableRole(person.role);
                  return (
                    <article className={`card person-card ${person.onShift === false ? 'dimmed' : ''}`} key={person.userId}>
                      <div className="line-title-row">
                        <span className="person-title-with-photo">
                          <ProfilePhoto photo={person.profilePhoto} userId={person.userId} displayName={person.displayName} size="small" />
                          <button className="link-title" type="button" onClick={() => void openProfile(person.userId)}>{pilotUserName(person.userId, person.displayName)}</button>
                        </span>
                        <span className={`tag ${meta.tag}`}>{meta.label}</span>
                      </div>
                      <div className="line-meta">
                        <span className="tag">{roleLabels[person.role] ?? person.role}</span>
                        {person.departmentName ? <span className="tag">{person.departmentName}</span> : null}
                        {person.currentAssignment?.lineName ? <span className="tag">{person.currentAssignment.lineName}</span> : null}
                        {person.currentAssignment?.positionName ? <span className="tag">{person.currentAssignment.positionName}</span> : null}
                        {person.currentAssignment?.timeRoleName ? <span className="tag">{person.currentAssignment.timeRoleName}</span> : null}
                      </div>
                      {isManagerView && assignable ? (
                        <div className="action-grid people-actions">
                          <button className="action-button work" type="button" onClick={() => openPersonAction(person, 'line')}>На линию</button>
                          <button className="action-button" type="button" onClick={() => openPersonAction(person, 'wash')}>На мойку</button>
                          <button className="action-button" type="button" disabled={!timeAreas.length} onClick={() => {
                            const targetArea = timeAreas[0];
                            if (targetArea) void openWorkAreaForPerson(person, targetArea.id);
                          }}>Повременщик</button>
                          <button className="action-button pause" type="button" onClick={() => openPersonAction(person, 'release')}>Освободить</button>
                          <button className="action-button stop" type="button" onClick={() => openPersonAction(person, 'home')}>Домой</button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        </section>
        ) : null}
      </div> : null}

      {handoverMode && displayedHandover?.snapshot ? (
        <div className="modal-backdrop handover-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card wide-modal handover-modal">
            <div className="screen-header handover-header">
              <div>
                <p className="eyebrow">{handoverMode === 'previous' ? 'Передано предыдущей сменой' : 'Закрыть и передать смену'}</p>
                <h3>{displayedHandover.snapshot.shiftLabel} · {formatShiftDateLabel(displayedHandover.snapshot.shiftDate)}</h3>
                <p>{shiftKindRange(displayedHandover.snapshot.shiftType)} · данные на {formatDateTime(displayedHandover.snapshot.generatedAt)}</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setHandoverMode(null)}>Закрыть</button>
            </div>

            <div className="handover-summary-strip">
              <span className="tag">Отдел: {displayedHandover.snapshot.departmentName}</span>
              <span className="tag">Мастер: {displayedHandover.snapshot.authorName}</span>
              <span className={`tag ${displayedHandover.snapshot.counts.total ? 'pause' : 'work'}`}>Открытых хвостов: {displayedHandover.snapshot.counts.total}</span>
              {displayedHandover.immutable || displayedHandover.alreadyHandedOver ? <span className="tag work">Снимок сохранён</span> : <span className="tag">Черновик</span>}
            </div>

            {!displayedHandover.snapshot.counts.total ? <div className="empty-state compact success-state">Смена передаётся без открытых оперативных хвостов.</div> : null}

            <div className="handover-sections">
              {handoverSections.map((section) => {
                const items = displayedHandover.snapshot.sections[section.key];
                return (
                  <details className="handover-section" key={section.key} open={items.length > 0}>
                    <summary><span>{section.title}</span><span className={`tag ${items.length ? 'pause' : ''}`}>{items.length}</span></summary>
                    {!items.length ? <div className="empty-state compact">{section.empty}</div> : null}
                    {items.map((item) => (
                      <article className={`handover-item ${item.alreadyCompleted ? 'resolved' : ''} ${item.status === 'STOP' || item.status === 'URGENT' ? 'critical' : ''}`} key={`${section.key}:${item.id}`}>
                        <div>
                          <strong>{item.title}</strong>
                          <span>{item.currentStatusLabel || item.statusLabel}{item.durationLabel ? ` · ${item.durationLabel}` : ''}</span>
                          {item.reason ? <span>{item.reason}</span> : null}
                          {item.description ? <span>{item.description}</span> : null}
                          {item.departmentNames?.length ? <span>Адресат: {item.departmentNames.join(', ')}</span> : null}
                          {item.assigneeNames?.length ? <span>Ответственный: {item.assigneeNames.join(', ')}</span> : null}
                          {item.responseMinutes !== null && item.responseMinutes !== undefined ? <span>Реакция: {item.responseMinutes} мин{item.workMinutes !== null && item.workMinutes !== undefined ? ` · в работе ${item.workMinutes} мин` : ''}</span> : null}
                          {item.quantity ? <span>Количество: {item.quantity}</span> : null}
                        </div>
                        <button className="secondary-button compact-action" type="button" onClick={() => openHandoverItem(section.key, item)}>Открыть</button>
                      </article>
                    ))}
                  </details>
                );
              })}
            </div>

            <div className="handover-comment-block">
              <label className="field-label" htmlFor="handover-comment">Комментарий следующей смене</label>
              {handoverMode === 'prepare' && !displayedHandover.alreadyHandedOver ? (
                <textarea id="handover-comment" maxLength={2000} value={handoverComment} onChange={(event) => setHandoverComment(event.target.value)} placeholder="Необязательный комментарий к оперативной сводке" />
              ) : <p>{displayedHandover.snapshot.comment || 'Комментарий не добавлен'}</p>}
            </div>

            {handoverMode === 'prepare' ? (
              <div className="modal-actions handover-sticky-actions">
                <button className="secondary-button" type="button" disabled={handoverLoading} onClick={() => void refreshHandoverSummary()}>Обновить</button>
                {!displayedHandover.alreadyHandedOver ? <button className="primary-button" type="button" disabled={handoverLoading} onClick={() => void submitHandover()}>Передать следующей смене</button> : null}
                {displayedHandover.alreadyHandedOver ? <span className="empty-state compact success-state">Смена уже передана</span> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {manualSearchSheet ? (
        <div className="modal-backdrop people-search-backdrop" role="dialog" aria-modal="true" aria-labelledby="manual-people-search-title">
          <div className="modal-card people-search-sheet">
            <div className="people-search-sheet-header">
              <div>
                <span className="eyebrow">Ручное назначение</span>
                <h3 id="manual-people-search-title">Найти сотрудника</h3>
                <p>Поиск сотрудника, который не отметил присутствие или «Я буду».</p>
              </div>
              <button className="secondary-button compact-action" type="button" onClick={() => { setManualSearchSheet(null); setManualSearchQuery(''); }}>Закрыть</button>
            </div>
            <PeopleSearchPanel
              mode="ASSIGNMENT"
              context={manualSearchSheet.context}
              shiftDate={manualSearchSheet.context === 'FUTURE' ? nextShiftParams().shiftDate : undefined}
              shiftType={manualSearchSheet.context === 'FUTURE' ? nextShiftParams().shiftType as 'DAY' | 'NIGHT' : undefined}
              value={manualSearchQuery}
              onChange={setManualSearchQuery}
              onSelect={(result, context) => void chooseManualSearchResult(result, context)}
              autoFocus
            />
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" type="button" onClick={() => { setManualSearchSheet(null); setManualSearchQuery(''); }}>Вернуться к назначениям</button>
            </div>
          </div>
        </div>
      ) : null}

      {assignmentMenuUser ? (
        <div className="modal-backdrop sheet-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card assignment-target-sheet compact-modal">
            <div className="line-title-row">
              <div>
                <h3>Куда назначить?</h3>
                <span>{shortPersonName(assignmentMenuUser.userId, assignmentMenuUser.displayName)} · {roleLabels[assignmentMenuUser.role] ?? assignmentMenuUser.role}</span>
              </div>
              <span className={`tag ${stateMeta[assignmentMenuUser.employeeState].tag}`}>{stateMeta[assignmentMenuUser.employeeState].label}</span>
            </div>
            <div className="empty-state compact selected-person-hint">
              Сейчас: {assignmentDestinationLabel(assignmentMenuUser)}
            </div>
            <div className="assignment-target-grid">
              <button className="position-row assignment-target-option target-line" type="button" disabled={busy || (!workingLines.length && !stoppedLines.length && !inactiveLines.length)} onClick={() => void chooseAssignmentTarget('slot')}>
                <span className="assignment-target-icon" aria-hidden="true">≡</span>
                <div>
                  <strong>Линия</strong>
                  <span>{workingLines.length} работают · выбрать слот</span>
                </div>
                <span className="tag work">Выбрать</span>
              </button>
              <button className="position-row assignment-target-option target-wash" type="button" disabled={busy || !washLines.length} onClick={() => void chooseAssignmentTarget('wash')}>
                <span className="assignment-target-icon wash" aria-hidden="true">≈</span>
                <div>
                  <strong>Мойка</strong>
                  <span>Выбрать активную сессию мойки</span>
                </div>
                <span className="tag wash">Мойка</span>
              </button>
              <button className="position-row assignment-target-option target-work-area" type="button" disabled={busy || !workAreas.length} onClick={() => void chooseAssignmentTarget('workArea')}>
                <span className="assignment-target-icon" aria-hidden="true">⌂</span>
                <div>
                  <strong>Рабочая зона</strong>
                  <span>Позиция или повременная работа</span>
                </div>
                <span className="tag pause">{workAreas.length}</span>
              </button>
              <button className="position-row assignment-target-option target-home danger-option" type="button" disabled={busy} onClick={() => void chooseAssignmentTarget('home')}>
                <span className="assignment-target-icon danger" aria-hidden="true">⌂</span>
                <div>
                  <strong>Отправить домой</strong>
                  <span>Закрыть текущее назначение</span>
                </div>
                <span className="tag stop">Домой</span>
              </button>
            </div>
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" type="button" onClick={() => setAssignmentMenuUser(null)} disabled={busy}>Закрыть</button>
            </div>
          </div>
        </div>
      ) : null}

      {workAreaPickerUser ? (
        <div className="modal-backdrop sheet-backdrop nested-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="work-area-picker-title" onClick={() => {
          setWorkAreaPickerUser(null);
          if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser);
        }}>
          <div className="modal-card assignment-target-sheet compact-modal" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-drag-handle" aria-hidden="true" />
            <div className="line-title-row">
              <div>
                <h3 id="work-area-picker-title">Выберите рабочую зону</h3>
                <span>{shortPersonName(workAreaPickerUser.userId, workAreaPickerUser.displayName)} · затем выберите позицию</span>
              </div>
              <button className="secondary-button compact-action" type="button" onClick={() => {
                setWorkAreaPickerUser(null);
                if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser);
              }}>Назад</button>
            </div>
            <div className="assignment-target-grid">
              {workAreas.map((area) => (
                <button className="position-row assignment-target-option target-work-area work-area-picker-option" type="button" disabled={busy} key={area.id} onClick={() => void openWorkAreaForPerson(workAreaPickerUser, area.id)}>
                  <div>
                    <strong>{area.name}</strong>
                    <span>{area.positions.length} позиций · {area.assignmentKind === 'TIME' ? 'повременщики' : 'рабочая зона'}</span>
                  </div>
                  <span className={`tag ${area.assignmentKind === 'TIME' ? 'pause' : ''}`}>Выбрать</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {currentLinePickerSelection ? (
        <div className="modal-backdrop sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="current-line-picker-title" onClick={() => {
          setCurrentLinePickerSelection(null);
          if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser);
        }}>
          <div className="modal-card current-line-picker-sheet compact-modal" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-drag-handle" aria-hidden="true" />
            <div className="line-title-row">
              <div>
                <h3 id="current-line-picker-title">{currentLinePickerSelection.mode === 'start' ? 'Запустить новую линию' : 'Выберите линию'}</h3>
                <span>{currentLinePickerSelection.mode === 'start'
                  ? 'Только остановленные и не включённые в текущую смену линии'
                  : `${shortPersonName(currentLinePickerSelection.userId, currentLinePickerSelection.displayName)} · сначала работающие линии`}</span>
              </div>
              <button className="secondary-button compact-action" type="button" onClick={() => {
                setCurrentLinePickerSelection(null);
                if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser);
              }}>Назад</button>
            </div>
            {currentLinePickerSelection.mode === 'assign' ? <div className="current-line-picker-list">
              {workingLines.map((line) => (
                <button className="shift-picker-option working-line-option" type="button" key={line.id} onClick={() => {
                  setSelectedAssignmentCandidateId(currentLinePickerSelection.userId);
                  setCurrentLinePickerSelection(null);
                  void openDashboard(line.id);
                }}>
                  <span><strong>{line.name}</strong><small>Люди {line.activeWorkersCount ?? 0}/{linePlannedPeople(line) || '—'} · {line.activeTemplate?.name ?? 'состав не выбран'}</small></span>
                  <span className="tag work">Выбрать</span>
                </button>
              ))}
              {!workingLines.length ? <div className="empty-state compact">Работающих линий сейчас нет</div> : null}
            </div> : null}
            <details className="startable-lines-disclosure" open={currentLinePickerSelection.mode === 'start'}>
              <summary>Запустить новую линию <span className="tag">{stoppedLines.length + inactiveLines.length}</span></summary>
              <div className="current-line-picker-list">
                {stoppedLines.map((line) => (
                  <button className="shift-picker-option stopped-line-option" type="button" key={line.id} onClick={() => {
                    if (currentLinePickerSelection.mode === 'assign') setSelectedAssignmentCandidateId(currentLinePickerSelection.userId);
                    setCurrentLinePickerSelection(null);
                    setPendingLine(line);
                    openLineAction('work');
                  }}>
                    <span><strong>{line.name}</strong><small>Остановлена · запуск требует подтверждения</small></span>
                    <span className="tag stop">Вернуть</span>
                  </button>
                ))}
                {inactiveLines.map((line) => (
                  <button className="shift-picker-option" type="button" key={line.id} onClick={() => {
                    if (currentLinePickerSelection.mode === 'assign') setSelectedAssignmentCandidateId(currentLinePickerSelection.userId);
                    setCurrentLinePickerSelection(null);
                    setPendingLine(line);
                    setActivationTemplateId(line.defaultStaffingTemplateId ?? line.activeTemplate?.id ?? '');
                    setLineAction('activateLine');
                  }}>
                    <span><strong>{line.name}</strong><small>Не включена в текущую смену</small></span>
                    <span className="tag pause">Запустить</span>
                  </button>
                ))}
                {!stoppedLines.length && !inactiveLines.length ? <div className="empty-state compact">Все доступные линии уже работают</div> : null}
              </div>
            </details>
          </div>
        </div>
      ) : null}

      {notNeededWillBe ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="not-needed-title">
          <div className="modal-card compact-modal future-not-needed-modal">
            <h3 id="not-needed-title">Не вызывать на смену</h3>
            <p>{shortPersonName(notNeededWillBe.id, notNeededWillBe.displayName)} будет снят с плановых назначений этой смены и получит уведомление.</p>
            <label className="field-label" htmlFor="not-needed-reason">Причина</label>
            <textarea id="not-needed-reason" value={notNeededReason} onChange={(event) => setNotNeededReason(event.target.value)} placeholder="Например: состав уже укомплектован" autoFocus />
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => {
                setNotNeededWillBe(null);
                setNotNeededReason('');
              }}>Отмена</button>
              <button className="primary-button" type="button" disabled={busy || !notNeededReason.trim()} onClick={() => void markWillBeNotNeeded()}>Не вызывать</button>
            </div>
          </div>
        </div>
      ) : null}

      {currentSlotAction ? (
        <div className="modal-backdrop sheet-backdrop nested-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="slot-actions-title" onClick={() => setCurrentSlotAction(null)}>
          <div className="modal-card slot-actions-sheet compact-modal" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-drag-handle" aria-hidden="true" />
            <div className="line-title-row">
              <div><h3 id="slot-actions-title">Действия с сотрудником</h3><span>{shortPersonName(currentSlotAction.assignment.userId, currentSlotAction.assignment.displayName)} · {currentSlotAction.label}</span></div>
              <button className="secondary-button compact-action" type="button" onClick={() => setCurrentSlotAction(null)}>Закрыть</button>
            </div>
            <div className="assignment-target-grid slot-action-options">
              <button className="position-row assignment-target-option" type="button" onClick={() => { void openProfile(currentSlotAction.assignment.userId); setCurrentSlotAction(null); }}>
                <div><strong>Профиль</strong><span>Открыть карточку сотрудника</span></div><span className="tag">Открыть</span>
              </button>
              <button className="position-row assignment-target-option" type="button" disabled={busy} onClick={() => {
                if (currentSlotAction.source === 'LINE') {
                  selectCurrentSlot({ positionId: currentSlotAction.positionId, slotIndex: currentSlotAction.slotIndex, label: currentSlotAction.label });
                } else {
                  setSelectedAssignmentSlot({ positionId: currentSlotAction.positionId, slotIndex: currentSlotAction.slotIndex, label: currentSlotAction.label });
                }
                setCurrentSlotAction(null);
              }}>
                <div><strong>Заменить в слоте</strong><span>Выбрать другого человека для этого места</span></div><span className="tag pause">Заменить</span>
              </button>
              <button className="position-row assignment-target-option" type="button" disabled={busy} onClick={() => {
                const person = workforcePeople.find((item) => item.userId === currentSlotAction.assignment.userId);
                setCurrentSlotAction(null);
                setDashboard(null);
                setAssignmentBoard(null);
                setWorkAreaBoard(null);
                if (person) openAssignmentMenu(person);
              }}>
                <div><strong>Переназначить</strong><span>Выбрать линию, мойку или рабочую зону</span></div><span className="tag pause">Выбрать</span>
              </button>
              <button className="position-row assignment-target-option" type="button" disabled={busy} onClick={() => {
                const action = currentSlotAction;
                setCurrentSlotAction(null);
                void releaseAssignedUser(action.assignment.userId, action.assignment.displayName, dashboard?.line.name ?? workAreaBoard?.workArea.name ?? action.label, { selectForReassign: true, closeBoard: true });
              }}>
                <div><strong>Освободить</strong><span>Закрыть назначение и оставить человека на смене</span></div><span className="tag">Освободить</span>
              </button>
              <button className="position-row assignment-target-option danger-option" type="button" disabled={busy} onClick={() => {
                const person = workforcePeople.find((item) => item.userId === currentSlotAction.assignment.userId);
                setCurrentSlotAction(null);
                setDashboard(null);
                setAssignmentBoard(null);
                setWorkAreaBoard(null);
                if (person) openPersonAction(person, 'home');
              }}>
                <div><strong>Отправить домой</strong><span>Требуется подтверждение и комментарий</span></div><span className="tag stop">Домой</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {planningLinePickerOpen ? (
        <PremiumSheet
          className="future-plan-line-picker"
          description={`${nextShiftParams().shiftDate} · ${nextShiftParams().shiftType === 'NIGHT' ? 'ночная смена' : 'дневная смена'}`}
          eyebrow="План будущей смены"
          footer={<button className="secondary-button" disabled={busy} onClick={() => setPlanningLinePickerOpen(false)} type="button">Закрыть</button>}
          onClose={() => setPlanningLinePickerOpen(false)}
          open
          title="Добавить линию в план"
        >
          <div className="future-plan-line-picker-content">
            <p className="helper-text">Выберите реальную производственную линию. Рабочие зоны и тестовые линии сюда не попадают.</p>
            <div className="future-plan-line-list">
              {pilotLines
                .filter((line) => !(futureShift?.plannedLines ?? []).some((planned) => planned.lineId === line.id))
                .map((line) => (
                  <button className="future-plan-line-row" type="button" key={line.id} disabled={busy} onClick={() => void addLineToPlan(line)}>
                    <span className="future-plan-line-name">{line.name}</span>
                    <span aria-hidden="true" className="future-plan-line-add">+</span>
                  </button>
                ))}
            </div>
            {!pilotLines.filter((line) => !(futureShift?.plannedLines ?? []).some((planned) => planned.lineId === line.id)).length ? (
              <div className="empty-state compact">Все доступные линии уже добавлены в план этой смены</div>
            ) : null}
          </div>
        </PremiumSheet>
      ) : null}

      {workAreaBoard ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-dashboard-card work-area-assignment-board" ref={workAreaBoardScrollRef}>
            <div className="line-title-row">
              <div>
                <h3>{workAreaBoard.workArea.name}</h3>
                {assignmentFlowUser ? <span>{shortPersonName(assignmentFlowUser.userId, assignmentFlowUser.displayName)} · выберите свободный слот</span> : <span>Выберите слот, затем сотрудника</span>}
              </div>
              <span className="tag">{workAreaBoard.workArea.assignmentKind === 'TIME' ? 'Повременщики' : 'Рабочая зона'}</span>
            </div>
            <div className="work-area-slot-summary" aria-label="Сводка по рабочей зоне">
              <span><small>Нужно</small><strong>{workAreaBoard.shortage.reduce((sum, item) => sum + item.required, 0)}</strong></span>
              <span><small>Назначено</small><strong>{workAreaBoard.shortage.reduce((sum, item) => sum + item.actual, 0)}</strong></span>
              <span className={workAreaBoard.shortage.some((item) => item.missing > 0) ? 'warning' : 'success'}><small>Не хватает</small><strong>{workAreaBoard.shortage.reduce((sum, item) => sum + item.missing, 0)}</strong></span>
            </div>
            {workAreaLoading ? <div className="empty-state compact">Загружаю повременщиков...</div> : null}
            <section className="assignment-board">
              <div className="section-subhead"><h3>Позиции и слоты</h3><span>{workAreaBoard.slots.length}</span></div>
              <div className="assignment-board-grid work-area-slot-grid">
                <div className="slot-list">
                  {workAreaBoard.shortage.map((position) => {
                    const positionSlots = workAreaBoard.slots.filter((slot) => slot.workAreaPositionId === position.workAreaPositionId);
                    const flexibleSlot = positionSlots.find((slot) => slot.isFlexible) ?? null;
                    return (
                      <section className="work-area-position-group" key={position.workAreaPositionId}>
                        <div className="work-area-position-group-header">
                          <div><strong>{position.title}</strong><span>Нужно {position.required} · назначено {position.actual}</span></div>
                          {flexibleSlot ? <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => openWorkAreaRequirementEditor(flexibleSlot)}>Изменить потребность</button> : null}
                        </div>
                        {positionSlots.map((slot) => (
                          <div
                            className={`slot-row compact-slot-row ${slot.assignment ? 'filled' : ''} ${selectedAssignmentSlot?.positionId === slot.workAreaPositionId && selectedAssignmentSlot.slotIndex === slot.slotIndex ? 'selected' : ''}`}
                            key={`${slot.workAreaPositionId}-${slot.slotIndex}`}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              const userId = event.dataTransfer.getData('text/plain');
                              if (userId) void assignCandidateToWorkArea(userId, slot.workAreaPositionId, slot.slotIndex);
                            }}
                          >
                            <div className="assignment-slot-copy">
                              <span className="assignment-slot-eyebrow">Рабочее место</span>
                              <strong>{slot.isExtraSlot ? 'Дополнительное место' : `${slot.title} · место ${slot.slotIndex}`}</strong>
                              {slot.assignment ? (
                                <span className="person-title-with-photo compact assignment-slot-person">
                                  <ProfilePhoto photo={slot.assignment.profilePhoto} userId={slot.assignment.userId} displayName={slot.assignment.displayName} size="small" />
                                  {shortPersonName(slot.assignment.userId, slot.assignment.displayName)}
                                </span>
                              ) : <span className="assignment-slot-empty">Сотрудник не назначен</span>}
                            </div>
                            <span className={`tag ${slot.assignment ? 'work' : slot.isExtraSlot ? 'pause' : ''}`}>{slot.assignment ? 'Назначен' : 'Не назначен'}</span>
                            {slot.assignment ? (
                              <button className="secondary-button compact-action slot-action-button" type="button" disabled={busy} onClick={() => setCurrentSlotAction({
                                source: 'WORK_AREA',
                                positionId: slot.workAreaPositionId,
                                slotIndex: slot.slotIndex,
                                label: `${slot.title} #${slot.slotIndex}`,
                                assignment: slot.assignment!,
                              })}>Действия</button>
                            ) : (
                              <button className="primary-button compact-action" type="button" disabled={busy || (!assignmentFlowUser && !workAreaBoard.candidates.length)} onClick={() => {
                                if (assignmentFlowUser) {
                                  void assignCandidateToWorkArea(assignmentFlowUser.userId, slot.workAreaPositionId, slot.slotIndex);
                                  return;
                                }
                                selectCurrentSlot({ positionId: slot.workAreaPositionId, slotIndex: slot.slotIndex, label: `${slot.title} #${slot.slotIndex}` });
                              }}>
                                {assignmentFlowUser ? 'Назначить сюда' : 'Выбрать сотрудника'}
                              </button>
                            )}
                          </div>
                        ))}
                      </section>
                    );
                  })}
                  {!workAreaBoard.slots.length ? <div className="empty-state compact">Слоты рабочей зоны пока не настроены</div> : null}
                </div>
              </div>
            </section>
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" type="button" onClick={() => {
                setWorkAreaBoard(null);
                setSelectedAssignmentSlot(null);
                setSelectedAssignmentCandidateId('');
              }} disabled={busy}>Закрыть</button>
            </div>
          </div>
        </div>
      ) : null}

      {workAreaBoard && selectedAssignmentSlot && !assignmentFlowUser ? (
        <div className="modal-backdrop nested-sheet-backdrop assignment-person-backdrop" role="dialog" aria-modal="true" aria-labelledby="work-area-candidate-title" onClick={() => {
          setSelectedAssignmentSlot(null);
          setSelectedAssignmentCandidateId('');
        }}>
          <div className="modal-card assignment-person-sheet compact-modal" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-drag-handle" aria-hidden="true" />
            <div className="line-title-row">
              <div>
                <h3 id="work-area-candidate-title">Выберите сотрудника</h3>
                <span>{workAreaBoard.workArea.name} · {selectedAssignmentSlot.label}</span>
              </div>
              <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => {
                setSelectedAssignmentSlot(null);
                setSelectedAssignmentCandidateId('');
              }}>Назад</button>
            </div>
            <div className="candidate-list compact-candidate-list assignment-person-list">
              {workAreaBoard.candidates.map((candidate) => (
                <article className="candidate-card compact-candidate-card assignment-person-row" key={candidate.userId}>
                  <span className="person-title-with-photo">
                    <ProfilePhoto photo={candidate.profilePhoto} userId={candidate.userId} displayName={candidate.displayName} size="small" />
                    <strong>{pilotUserName(candidate.userId, candidate.displayName)}</strong>
                  </span>
                  <span>{candidate.isMovable ? candidateAssignmentDestination(candidate.currentAssignment) : (candidate.companyName ?? candidate.departmentName ?? roleLabels[candidate.role] ?? candidate.role)}</span>
                  <button className={candidate.isMovable ? 'secondary-button compact-action' : 'primary-button compact-action'} type="button" disabled={busy} onClick={() => {
                    if (candidate.isMovable) {
                      setSelectedAssignmentCandidateId(candidate.userId);
                      setCurrentAssignmentConfirm(true);
                      return;
                    }
                    void assignCandidateToWorkArea(candidate.userId, selectedAssignmentSlot.positionId, selectedAssignmentSlot.slotIndex);
                  }}>{candidate.isMovable ? 'Переставить' : 'Назначить'}</button>
                </article>
              ))}
              {!workAreaBoard.candidates.length ? <div className="empty-state compact">Свободных работников и наёмных работников нет</div> : null}
            </div>
            {currentAssignmentConfirm && selectedAssignmentCandidateId ? (
              <div className="inline-confirm-panel">
                <strong>Подтвердите перестановку</strong>
                <span>{shortPersonName(selectedAssignmentCandidateId, workAreaBoard.candidates.find((item) => item.userId === selectedAssignmentCandidateId)?.displayName)} → {workAreaBoard.workArea.name} / {selectedAssignmentSlot.label}</span>
                <span>Старое место будет освобождено штатно, без дублирующего назначения.</span>
                <div className="modal-actions sticky-actions">
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => { setSelectedAssignmentCandidateId(''); setCurrentAssignmentConfirm(false); }}>Отмена</button>
                  <button className="primary-button" type="button" disabled={busy} onClick={() => void confirmWorkAreaAssignment()}>Подтвердить</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {requirementEditor ? (
        <div className="modal-backdrop nested-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="requirement-editor-title">
          <div className="modal-card compact-modal requirement-editor-modal">
            <div className="line-title-row">
              <div>
                <h3 id="requirement-editor-title">Изменить потребность</h3>
                <span>{requirementEditor.title}</span>
              </div>
              <span className="tag">Сейчас: {requirementEditor.current}</span>
            </div>
            <p className="helper-text">Укажите, сколько сотрудников требуется. Занятые текущие и будущие слоты защищены backend и не будут удалены молча.</p>
            <div className="requirement-stepper" aria-label={`Потребность для ${requirementEditor.title}`}>
              <button
                aria-label="Уменьшить потребность"
                className="secondary-button"
                disabled={busy || requirementValue <= requirementEditor.min}
                onClick={() => { setRequirementPreview(null); setRequirementValue((value) => Math.max(requirementEditor.min, value - 1)); }}
                type="button"
              >−</button>
              <label className="field-label">
                Требуется сотрудников
                <input
                  inputMode="numeric"
                  max={requirementEditor.max}
                  min={requirementEditor.min}
                  onChange={(event) => { setRequirementValue(Number(event.target.value)); setRequirementPreview(null); }}
                  type="number"
                  value={requirementValue}
                />
              </label>
              <button
                aria-label="Увеличить потребность"
                className="secondary-button"
                disabled={busy || requirementValue >= requirementEditor.max}
                onClick={() => { setRequirementPreview(null); setRequirementValue((value) => Math.min(requirementEditor.max, value + 1)); }}
                type="button"
              >+</button>
            </div>
            <span className="helper-text">Допустимо: от {requirementEditor.min} до {requirementEditor.max}</span>
            {requirementPreview?.requiresRelease ? (
              <div className="inline-confirm-panel requirement-blocked-preview">
                <strong>Сначала освободите занятые слоты</strong>
                <span>Текущая смена: {requirementPreview.counts.current} · будущие смены: {requirementPreview.counts.future}</span>
                {requirementPreview.affected.map((item, index) => (
                  <span key={`${item.scope}-${item.displayName}-${index}`}>{item.displayName} · слот {item.slotIndex ?? 'не указан'}{item.scope === 'FUTURE' ? ` · ${item.shiftDate ?? ''} ${item.shiftType === 'NIGHT' ? 'ночь' : 'день'}` : ''}</span>
                ))}
                <span>Потребность не изменена.</span>
              </div>
            ) : null}
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" disabled={busy} onClick={() => { setRequirementEditor(null); setRequirementPreview(null); }} type="button">Отмена</button>
              <button className="primary-button" disabled={busy || requirementValue < requirementEditor.min || requirementValue > requirementEditor.max} onClick={() => void saveRequirement()} type="button">Сохранить потребность</button>
            </div>
          </div>
        </div>
      ) : null}

      {futureAssignmentBoard ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-dashboard-card future-nonline-assignment-modal">
            <div className="line-title-row">
              <div>
                <h3>План будущей смены</h3>
                <span>{futureAssignmentBoard.shiftDate} · {futureAssignmentBoard.shiftType === 'NIGHT' ? 'ночная смена' : 'дневная смена'}</span>
              </div>
              <span className="tag pause">Не влияет на текущую смену</span>
            </div>
            <p className="helper-text">Выберите, куда поставить человека в будущей смене: на линию, мойку, повременщики или конкретную рабочую зону.</p>
            {selectedFuturePersonId ? (
              <div className="empty-state compact selected-person-hint">
                <strong>{shortPersonName(selectedFuturePersonId, selectedFuturePersonName)}</strong>
                {(() => {
                  const currentPlan = futureAssignmentBoard.assignments.find((item) => item.userId === selectedFuturePersonId);
                  return currentPlan ? <span>Уже запланирован: {currentPlan.targetLabel}</span> : <span>План ещё не выбран</span>;
                })()}
              </div>
            ) : null}
            <div className="line-meta planning-meta">
              <span className="tag work">Всего назначений: {futureAssignmentBoard.counts.planned}</span>
              <span className="tag">Мойка: {futureAssignmentBoard.counts.wash}</span>
              <span className="tag">Повременщики: {futureAssignmentBoard.counts.time}</span>
              <span className="tag">Рабочие зоны: {futureAssignmentBoard.counts.workArea}</span>
            </div>
            <section className="assignment-board">
              <div className="section-subhead"><h3>Быстрые варианты</h3><span>4</span></div>
              {(() => {
                const currentPlan = futureAssignmentBoard.assignments.find((item) => item.userId === selectedFuturePersonId);
                const selectedCandidate = futureAssignmentBoard.candidates.find((item) => item.userId === selectedFuturePersonId);
                return (
                  <div className="quick-people-grid future-line-grid">
                    <article className="quick-person-card future-line-card">
                      <div className="quick-person-main"><div className="line-avatar">ЛН</div><div><strong>Линия / слот</strong><span>Открыть доску плановых линий</span></div></div>
                      <button className="primary-button compact-action" type="button" disabled={busy || !selectedFuturePersonId} onClick={() => { setFutureAssignmentBoard(null); void openFutureLineBoardForUser(selectedFuturePersonId, selectedCandidate?.displayName ?? selectedFuturePersonName); }}>Выбрать слот линии</button>
                    </article>
                    <article className="quick-person-card future-line-card">
                      <div className="quick-person-main"><div className="line-avatar">М</div><div><strong>Мойка</strong><span>Плановое назначение на мойку</span></div></div>
                      <button className="primary-button compact-action" type="button" disabled={busy || !selectedFuturePersonId} onClick={() => requestFutureNonLine('WASH', 'Мойка')}>{currentPlan ? 'Переназначить' : 'Запланировать'}</button>
                    </article>
                    <article className="quick-person-card future-line-card">
                      <div className="quick-person-main"><div className="line-avatar">П</div><div><strong>Повременщики</strong><span>Выберите настроенную позицию в слотах ниже</span></div></div>
                      <span className="tag">Справочник позиций</span>
                    </article>
                    {currentPlan ? (
                      <article className="quick-person-card future-line-card needs-attention">
                        <div className="quick-person-main"><div className="line-avatar">✓</div><div><strong>{currentPlan.targetLabel}</strong><span>Новое место заменит это назначение после подтверждения</span></div></div>
                        <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void releaseFutureNonLine(currentPlan.id)}>Освободить</button>
                      </article>
                    ) : null}
                  </div>
                );
              })()}
            </section>
            <section className="assignment-board">
              <div className="section-subhead"><h3>Рабочие зоны</h3><span>{futureAssignmentBoard.workAreas.length}</span></div>
              <div className="slot-list">
                {futureAssignmentBoard.workAreas.flatMap((area) => area.positions.flatMap((position) => position.slots.map((slot) => {
                  const currentPlan = futureAssignmentBoard.assignments.find((item) => item.userId === selectedFuturePersonId);
                  const selectedCandidate = futureAssignmentBoard.candidates.find((item) => item.userId === selectedFuturePersonId);
                  return (
                    <div className={`slot-row compact-slot-row ${slot.assignment ? 'filled' : ''}`} key={`${area.id}-${slot.workAreaPositionId}-${slot.slotIndex}`}>
                      <div className="assignment-slot-copy">
                        <span className="assignment-slot-eyebrow">Позиция будущей смены</span>
                        <strong>{area.name} / {slot.title} #{slot.slotIndex}</strong>
                        {slot.assignment ? <span className="assignment-slot-person">{slot.assignment.displayName ?? 'Сотрудник'} · {slot.assignment.targetLabel}</span> : <span className="assignment-slot-empty">Сотрудник не назначен</span>}
                      </div>
                      <span className={`tag ${slot.assignment ? 'work' : ''}`}>{slot.assignment ? 'Запланирован' : 'Не назначен'}</span>
                      {slot.assignment ? (
                        <span className="slot-inline-actions">
                          <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void openProfile(slot.assignment!.userId)}>Профиль</button>
                          {selectedFuturePersonId && slot.assignment.userId !== selectedFuturePersonId ? (
                            <button className="primary-button compact-action" type="button" disabled={busy} onClick={() => requestFutureNonLine(
                              area.assignmentKind,
                              `${area.name} / ${slot.title} #${slot.slotIndex}`,
                              {
                                workAreaId: area.id,
                                workAreaPositionId: slot.workAreaPositionId,
                                slotIndex: slot.slotIndex,
                                replaceAssignmentId: slot.assignment!.id,
                              },
                            )}>Заменить</button>
                          ) : null}
                          <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void releaseFutureNonLine(slot.assignment!.id)}>Освободить</button>
                        </span>
                      ) : (
                        <button
                          className="primary-button compact-action"
                          type="button"
                          disabled={busy || !selectedFuturePersonId}
                          onClick={() => requestFutureNonLine(
                            area.assignmentKind,
                            `${area.name} / ${slot.title} #${slot.slotIndex}`,
                            {
                              workAreaId: area.id,
                              workAreaPositionId: slot.workAreaPositionId,
                              slotIndex: slot.slotIndex,
                            },
                          )}
                        >
                          {selectedFuturePersonId ? `Назначить: ${shortPersonName(selectedFuturePersonId, selectedCandidate?.displayName ?? selectedFuturePersonName)}` : 'Выберите сотрудника'}
                        </button>
                      )}
                    </div>
                  );
                })))}
                {!futureAssignmentBoard.workAreas.length ? <div className="empty-state compact">Рабочие зоны пока не настроены</div> : null}
              </div>
            </section>
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" type="button" onClick={() => setFutureAssignmentBoard(null)} disabled={busy}>Закрыть</button>
            </div>
          </div>
        </div>
      ) : null}

      {futureAssignmentBoard && futureNonLinePending ? (
        <div className="modal-backdrop nested-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="future-move-confirm-title" onClick={() => setFutureNonLinePending(null)}>
          <div className="modal-card compact-modal" onClick={(event) => event.stopPropagation()}>
            <div className="line-title-row">
              <div>
                <h3 id="future-move-confirm-title">Подтвердите плановое назначение</h3>
                <span>{shortPersonName(selectedFuturePersonId, selectedFuturePersonName)}</span>
              </div>
              <span className="tag pause">Будущая смена</span>
            </div>
            <div className="inline-confirm-panel">
              <span>Сейчас: {futureAssignmentBoard.assignments.find((item) => item.userId === selectedFuturePersonId)?.targetLabel ?? 'без назначения'}</span>
              <strong>Будет: {futureNonLinePending.targetLabel}</strong>
              {futureNonLinePending.options.replaceAssignmentId ? <span>Сотрудник, который сейчас занимает выбранный слот, будет штатно освобождён из плана.</span> : null}
              <span>Текущая смена и фактические назначения не изменятся.</span>
            </div>
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setFutureNonLinePending(null)}>Отмена</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void assignFutureNonLine(futureNonLinePending.kind, futureNonLinePending.options)}>Подтвердить</button>
            </div>
          </div>
        </div>
      ) : null}

      {planningBoard ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-dashboard-card planning-assignment-modal">
            <div className="planning-assignment-scroll">
            <div className="line-title-row">
              <div>
                <h3>{planningBoard.line.name}</h3>
                <span>{planningBoard.shiftDate} · {planningBoard.shiftType === 'NIGHT' ? 'ночная смена' : 'дневная смена'}</span>
              </div>
              <span className="tag pause">{planningBoard.statusLabel}</span>
            </div>
            <p className="helper-text">Это план следующей смены. Здесь нет статусов “Работает”, простоя и мойки.</p>
            <label className="field-label" htmlFor="planning-template">Шаблон состава</label>
            <select
              id="planning-template"
              value={planningBoard.staffingTemplate?.id ?? ''}
              onChange={(event) => void requestTemplateRemap('FUTURE', planningBoard.line, event.target.value || null)}
              disabled={busy}
            >
              <option value="">Без шаблона</option>
              {planningBoard.line.staffingTemplates?.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <div className="line-meta planning-meta">
              <span className="tag work">Запланировано: {planningBoard.counts.planned}</span>
              <span className="tag">Свободные слоты: {planningBoard.counts.freeSlots}</span>
              <span className="tag">“Я буду”: {planningBoard.counts.willBeCandidates}</span>
            </div>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void openLineShiftAssignment(planningBoard.line, { shiftDate: planningBoard.shiftDate, shiftType: planningBoard.shiftType })}>
              Текущее задание будущей смены
            </button>
            <section className="assignment-board">
              <div className="section-subhead"><h3>Плановые слоты</h3><span>{planningBoard.slots.length}</span></div>
              <div className="assignment-board-grid">
                <div className="slot-list">
                  {planningBoard.slots.map((slot) => {
                    const label = `${slot.displayName ?? slot.positionName} #${slot.slotIndex}`;
                    const selected = selectedPlanningSlot?.positionId === slot.positionId && selectedPlanningSlot.slotIndex === slot.slotIndex;
                    return (
                      <div className={`slot-row compact-slot-row ${slot.assignment ? 'filled' : ''} ${selected ? 'selected' : ''}`} key={`${slot.positionId}-${slot.slotIndex}`}>
                        <div className="assignment-slot-copy">
                          <span className="assignment-slot-eyebrow">Позиция</span>
                          <strong>{slot.isExtraSlot ? 'Дополнительно' : slot.displayName ?? slot.positionName} #{slot.slotIndex}</strong>
                          {slot.assignment ? (
                            <span className="person-title-with-photo compact assignment-slot-person">
                              <ProfilePhoto photo={slot.assignment.profilePhoto} userId={slot.assignment.userId} displayName={slot.assignment.displayName} size="small" />
                              {slot.assignment.displayName}
                            </span>
                          ) : <span className="assignment-slot-empty">Сотрудник не назначен</span>}
                        </div>
                        <span className={`tag ${slot.assignment ? 'work' : selected ? 'pause' : ''}`}>{slot.assignment ? 'Запланирован' : selected ? 'Позиция выбрана' : 'Не назначен'}</span>
                        {slot.assignment ? (
                          <span className="slot-inline-actions">
                            <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void openProfile(slot.assignment!.userId)}>Профиль</button>
                            <button className="secondary-button compact-action" type="button" disabled={busy || !planningBoard.candidates.length} onClick={() => selectPlanningSlot({ positionId: slot.positionId, slotIndex: slot.slotIndex, label })}>Заменить</button>
                            <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void releasePlannedUser(slot.assignment!.id)}>Освободить</button>
                          </span>
                        ) : (
                          <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => selectPlanningSlot({ positionId: slot.positionId, slotIndex: slot.slotIndex, label })}>
                            Выбрать слот
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="candidate-list compact-candidate-list">
                  <div className="candidate-section-heading">
                    <strong>Свободные для плана</strong>
                    <span>{planningBoard.candidates.filter((candidate) => !candidate.plannedAssignmentId).length}</span>
                    <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => openManualEmployeeSearch('FUTURE', selectedPlanningSlot ? 'SLOT' : 'GENERAL')}>
                      Назначить не отметившегося
                    </button>
                  </div>
                  {planningBoard.candidates.filter((candidate) => !candidate.plannedAssignmentId).map((candidate) => {
                    const selected = selectedPlanningCandidateId === candidate.userId;
                    const skill = planningCandidateSkill(candidate);
                    return (
                      <article className={`candidate-card compact-candidate-card ${skill.className} ${selected ? 'selected' : ''}`} key={candidate.userId}>
                        <span className="person-title-with-photo">
                          <ProfilePhoto photo={candidate.profilePhoto} userId={candidate.userId} displayName={candidate.displayName} size="small" />
                          <strong>{shortPersonName(candidate.userId, candidate.displayName)}</strong>
                        </span>
                        <span>{roleLabels[candidate.role] ?? candidate.role}{candidate.companyName ? ` · ${candidate.companyName}` : candidate.departmentName ? ` · ${candidate.departmentName}` : ''}</span>
                        <span>{candidate.willBeStatus === 'WILL_BE' ? 'Я буду' : 'Не подтвердил явку'}</span>
                        <span className={`tag skill-tag ${skill.className}`}>{skill.label}</span>
                        {candidate.isBusyNow ? <span className="tag">Сейчас работает на текущей смене</span> : null}
                        <span className="slot-inline-actions">
                          <button className={selected ? 'primary-button compact-action' : 'secondary-button compact-action'} type="button" disabled={busy} onClick={() => selectPlanningCandidate(candidate.userId)}>
                            Выбрать
                          </button>
                          <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void openProfile(candidate.userId)}>Профиль</button>
                        </span>
                      </article>
                    );
                  })}
                  <div className="candidate-section-heading"><strong>Уже назначены в будущей смене</strong><span>{planningBoard.candidates.filter((candidate) => candidate.plannedAssignmentId).length}</span></div>
                  {planningBoard.candidates.filter((candidate) => candidate.plannedAssignmentId).map((candidate) => {
                    const selected = selectedPlanningCandidateId === candidate.userId;
                    const skill = planningCandidateSkill(candidate);
                    return (
                      <article className={`candidate-card compact-candidate-card ${skill.className} ${selected ? 'selected' : ''}`} key={candidate.userId}>
                        <span className="person-title-with-photo">
                          <ProfilePhoto photo={candidate.profilePhoto} userId={candidate.userId} displayName={candidate.displayName} size="small" />
                          <strong>{shortPersonName(candidate.userId, candidate.displayName)}</strong>
                        </span>
                        <span>{roleLabels[candidate.role] ?? candidate.role}{candidate.companyName ? ` · ${candidate.companyName}` : candidate.departmentName ? ` · ${candidate.departmentName}` : ''}</span>
                        <span>Уже назначен в будущей смене</span>
                        <span className={`tag skill-tag ${skill.className}`}>{skill.label}</span>
                        {candidate.isBusyNow ? <span className="tag">Сейчас работает на текущей смене</span> : null}
                        <span className="slot-inline-actions">
                          <button className={selected ? 'primary-button compact-action' : 'secondary-button compact-action'} type="button" disabled={busy} onClick={() => selectPlanningCandidate(candidate.userId)}>
                            Переназначить
                          </button>
                          <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => void openProfile(candidate.userId)}>Профиль</button>
                        </span>
                      </article>
                    );
                  })}
                </div>
              </div>
              {planningAssignmentConfirm ? (
                <div className="inline-confirm-panel">
                  <strong>{manualSearchSelection?.result.userId === selectedPlanningCandidateId && manualSearchSelection.result.selfConfirmed === false
                    ? 'Сотрудник не отметил «Я буду». Назначить его в будущую смену?'
                    : 'Подтвердите плановую замену'}</strong>
                  <span>
                    {selectedPlanningCandidateId ? shortPersonName(selectedPlanningCandidateId, manualSearchSelection?.result.userId === selectedPlanningCandidateId ? manualSearchSelection.result.displayName : planningBoard.candidates.find((item) => item.userId === selectedPlanningCandidateId)?.displayName) : 'Сотрудник'}
                    {' → '}
                    {planningBoard.line.name}{selectedPlanningSlot ? ` / ${selectedPlanningSlot.label}` : ''}
                  </span>
                  <span>{manualSearchSelection?.result.userId === selectedPlanningCandidateId && manualSearchSelection.result.selfConfirmed === false
                    ? `${manualSearchSelection.context.label}. Самоподтверждение сотрудника не создаётся. Автор действия: вы (${roleLabels[currentUser?.role ?? ''] ?? 'руководитель'}).`
                    : 'Старое плановое место или сотрудник в слоте будут освобождены штатно, без дублей.'}</span>
                </div>
              ) : null}
            </section>
            </div>
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" type="button" onClick={() => { setPlanningBoard(null); setSelectedPlanningSlot(null); setSelectedPlanningCandidateId(''); setPlanningAssignmentConfirm(false); }} disabled={busy}>Закрыть</button>
              <button className="primary-button" type="button" onClick={() => void confirmPlanningSlotAssignment()} disabled={busy || !selectedPlanningSlot || !selectedPlanningCandidateId}>
                {selectedPlanningSlot && selectedPlanningCandidateId
                  ? `Назначить: ${shortPersonName(selectedPlanningCandidateId, planningBoard.candidates.find((item) => item.userId === selectedPlanningCandidateId)?.displayName)} → ${planningBoard.line.name} / ${selectedPlanningSlot.label}`
                  : 'Выберите слот и сотрудника'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {templateRemapDialog ? (
        <div className="modal-backdrop nested-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="template-remap-title" onClick={closeTemplateRemap}>
          <div className="modal-card compact-modal template-remap-preview" onClick={(event) => event.stopPropagation()}>
            <div className="line-title-row">
              <div>
                <h3 id="template-remap-title">Проверка смены шаблона</h3>
                <span>{templateRemapDialog.preview.targetTemplate?.name ?? 'Без шаблона'}</span>
              </div>
              <span className="tag pause">{templateRemapDialog.scope === 'FUTURE' ? 'Будущий план' : templateRemapDialog.scope === 'ACTIVATE' ? 'Запуск линии' : 'Текущая смена'}</span>
            </div>
            <div className="work-area-slot-summary" aria-label="Итог переноса сотрудников">
              <span><small>Останутся</small><strong>{templateRemapDialog.preview.counts.activeKept + templateRemapDialog.preview.counts.plannedKept}</strong></span>
              <span><small>Перейдут</small><strong>{templateRemapDialog.preview.counts.activeMoved + templateRemapDialog.preview.counts.plannedMoved}</strong></span>
              <span className={(templateRemapDialog.preview.counts.activeReleased + templateRemapDialog.preview.counts.plannedReleased) > 0 ? 'warning' : 'success'}><small>Освободятся</small><strong>{templateRemapDialog.preview.counts.activeReleased + templateRemapDialog.preview.counts.plannedReleased}</strong></span>
            </div>
            <div className="candidate-list compact-candidate-list">
              {templateRemapDialog.preview.affectedAssignments.map((item, index) => (
                <div className="slot-row compact-slot-row" key={`${item.displayName}-${index}`}>
                  <div><strong>{item.displayName}</strong><span>{item.from} → {item.to ?? 'свободен'}</span></div>
                  <span className={`tag ${item.action === 'RELEASE' ? 'stop' : 'pause'}`}>{item.action === 'RELEASE' ? 'Освободить' : 'Перенести'}</span>
                </div>
              ))}
              {!templateRemapDialog.preview.affectedAssignments.length ? <div className="empty-state compact">Все назначения сохранят свои места.</div> : null}
            </div>
            <p className="helper-text">Изменение применяется атомарно. Случайных перестановок и дублирующих назначений не будет.</p>
            <div className="modal-actions sticky-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={closeTemplateRemap}>Отмена</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void applyTemplateRemap()}>Применить шаблон</button>
            </div>
          </div>
        </div>
      ) : null}

      {dashboard && assignmentFlowUser && !dashboardReadOnly ? (
        <div className="modal-backdrop sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="person-first-slot-title" data-testid="person-first-slot-picker">
          <div className="modal-card quick-assignment-sheet compact-modal" ref={lineBoardScrollRef}>
            <div className="sheet-drag-handle" aria-hidden="true" />
            <div className="line-title-row">
              <div>
                <h3 id="person-first-slot-title">{dashboard.line.name}</h3>
                <span>{shortPersonName(assignmentFlowUser.userId, assignmentFlowUser.displayName)} · выберите свободную позицию</span>
              </div>
              <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => {
                setDashboard(null);
                setAssignmentBoard(null);
                setSelectedAssignmentSlot(null);
                setCurrentLinePickerSelection({
                  userId: assignmentFlowUser.userId,
                  displayName: assignmentFlowUser.displayName,
                  mode: 'assign',
                });
              }}>Назад</button>
            </div>
            <div className="empty-state compact selected-person-hint">
              Человек выбран. Нажатие на свободный слот назначит его сразу.
            </div>
            <div className="slot-list quick-assignment-slots">
              {assignmentBoard?.slots.map((slot) => (
                <div className={`slot-row compact-slot-row ${slot.assignment ? 'filled' : ''}`} key={`${slot.positionId}-${slot.slotIndex}`}>
                  <div className="assignment-slot-copy">
                    <span className="assignment-slot-eyebrow">Позиция</span>
                    <strong>{slot.isExtraSlot ? 'Дополнительно' : slot.displayName ?? slot.positionName} #{slot.slotIndex}</strong>
                    <span className={slot.assignment ? 'assignment-slot-person' : 'assignment-slot-empty'}>{slot.assignment ? shortPersonName(slot.assignment.userId, slot.assignment.displayName) : 'Сотрудник не назначен'}</span>
                  </div>
                  <span className={`tag ${slot.assignment ? 'pause' : 'work'}`}>{slot.assignment ? 'Назначен' : 'Не назначен'}</span>
                  <button
                    className="primary-button compact-action"
                    disabled={busy || Boolean(slot.assignment)}
                    onClick={() => void assignCandidateToSlot(assignmentFlowUser.userId, slot.positionId, slot.slotIndex)}
                    type="button"
                  >
                    {slot.assignment ? 'Недоступно' : 'Назначить'}
                  </button>
                </div>
              ))}
              {!assignmentBoard?.slots.length ? <div className="empty-state compact">{assignmentBoard?.structureMessage ?? 'Состав линии не настроен'}</div> : null}
            </div>
          </div>
        </div>
      ) : dashboard ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-dashboard-card compact-line-dashboard" ref={lineBoardScrollRef}>
            <div className="line-title-row line-dashboard-heading">
              <div>
                <h3>{dashboard.line.name}</h3>
                <span>{dashboard.activeTemplate?.name ?? 'Состав не выбран'}</span>
              </div>
              <span className={`tag ${dashboard.line.operationalState ? canonicalLineStateMeta[dashboard.line.operationalState].tag : 'stop'}`}>
                {dashboard.line.operationalState ? canonicalLineStateMeta[dashboard.line.operationalState].label : 'Состояние обновляется'}
              </span>
            </div>
            {dashboardLoading ? <div className="empty-state compact">Загружаю линию...</div> : null}

            <PremiumKpiStrip
              className="line-dashboard-kpis"
              label={`Состояние линии ${dashboard.line.name}`}
              items={[
                {
                  label: 'Людей',
                  value: assignmentBoard?.slots.filter((slot) => slot.assignment).length
                    ?? dashboard.assignmentsByPosition.reduce((count, group) => count + group.assignments.length, dashboard.withoutPosition.length),
                  tone: 'success',
                  hint: 'сейчас',
                },
                {
                  label: 'По плану',
                  value: assignmentBoard?.slots.filter((slot) => !slot.isExtraSlot).length
                    ?? dashboard.shortageSummary?.reduce((count, item) => count + item.required, 0)
                    ?? 0,
                  tone: 'neutral',
                  hint: dashboard.activeTemplate ? 'мест' : 'без состава',
                },
                {
                  label: 'Заявок',
                  value: dashboard.activeTasks.length,
                  tone: dashboard.activeTasks.length ? 'danger' : 'muted',
                  hint: 'активных',
                },
                {
                  label: 'Событий',
                  value: dashboard.recentEvents.length,
                  tone: dashboard.activeDowntimeEvent ? 'danger' : 'cool',
                  hint: dashboard.activeDowntimeEvent ? 'есть простой' : 'за смену',
                },
              ]}
            />

            {dashboardReadOnly ? <div className="empty-state compact">Просмотр состава и истории линии без управляющих действий.</div> : (
              <div className="line-dashboard-primary-actions">
                {dashboard.line.operationalState === 'WASH' ? (
                  <button className="action-button" type="button" disabled={busy} onClick={() => openLineWash(dashboard.line.activeWash?.id)}>Открыть мойку</button>
                ) : dashboard.line.operationalState === 'DEFROST' ? (
                  canReadDefrost ? <button className="action-button" type="button" disabled={busy} onClick={openLineDefrost}>Открыть оттайку</button> : null
                ) : dashboard.line.operationalState !== 'RUNNING' ? (
                  <button className="action-button work" type="button" disabled={busy} onClick={() => openLineAction('work')}>Вернуть в работу</button>
                ) : (
                  <button className="action-button stop" type="button" disabled={busy} onClick={() => openLineAction('pause')}>Зафиксировать простой</button>
                )}
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setLineActionsOpen(true)}>Все действия</button>
              </div>
            )}

            {!dashboardReadOnly ? <section className="assignment-board">
              <div className="section-subhead"><h3>Позиции</h3><span>{assignmentBoard?.slots.length ?? 0}</span></div>
              <div className="slot-list compact-line-slot-list">
                {assignmentBoard?.slots.map((slot) => (
                  <div
                    className={`slot-row compact-slot-row ${slot.assignment ? 'filled' : ''} ${selectedAssignmentSlot?.positionId === slot.positionId && selectedAssignmentSlot.slotIndex === slot.slotIndex ? 'selected' : ''}`}
                    key={`${slot.positionId}-${slot.slotIndex}`}
                  >
                    <div className="assignment-slot-copy">
                      <span className="assignment-slot-eyebrow">Позиция</span>
                      <strong>{slot.isExtraSlot ? 'Дополнительно' : slot.displayName ?? slot.positionName} #{slot.slotIndex}</strong>
                      {slot.isFlexible ? <span>План: {slot.plannedCount ?? slot.maxRequired ?? 0} из {slot.maxRequired ?? slot.plannedCount ?? 0}</span> : null}
                      {slot.assignment ? (
                        <span className="person-title-with-photo compact assignment-slot-person">
                          <ProfilePhoto photo={slot.assignment.profilePhoto} userId={slot.assignment.userId} displayName={slot.assignment.displayName} size="small" />
                          {shortPersonName(slot.assignment.userId, slot.assignment.displayName)}
                        </span>
                      ) : <span className="assignment-slot-empty">Сотрудник не назначен</span>}
                    </div>
                    <span className={`tag ${slot.assignment ? 'work' : slot.isExtraSlot ? 'pause' : ''}`}>{slot.assignment ? 'Назначен' : 'Не назначен'}</span>
                    {slot.assignment ? (
                      <button className="secondary-button compact-action slot-action-button" type="button" disabled={busy} onClick={() => setCurrentSlotAction({
                        source: 'LINE',
                        positionId: slot.positionId,
                        slotIndex: slot.slotIndex,
                        label: `${slot.displayName ?? slot.positionName} #${slot.slotIndex}`,
                        assignment: slot.assignment!,
                      })}>Действия</button>
                    ) : (
                      <button className="primary-button compact-action" type="button" disabled={busy || !((assignmentBoard?.candidates.length ?? 0) + assignedWorkforcePeople.length)} onClick={() => {
                        selectCurrentSlot({ positionId: slot.positionId, slotIndex: slot.slotIndex, label: `${slot.displayName ?? slot.positionName} #${slot.slotIndex}` });
                      }}>Назначить</button>
                    )}
                    {slot.isFlexible && slot.slotIndex === 1 ? (
                      <span className="slot-inline-actions slot-plan-controls">
                        <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => openLineRequirementEditor(slot)}>Изменить потребность</button>
                      </span>
                    ) : null}
                  </div>
                ))}
                {!assignmentBoard?.slots.length ? <div className="empty-state compact">Выберите состав в разделе «Настройки линии»</div> : null}
              </div>

              {selectedAssignmentSlot ? (
                <div className="modal-backdrop nested-sheet-backdrop assignment-person-backdrop" role="dialog" aria-modal="true" aria-labelledby="line-candidate-picker-title" data-testid="slot-first-person-picker" onClick={() => {
                  setSelectedAssignmentSlot(null);
                  setSelectedAssignmentCandidateId('');
                  setCurrentAssignmentConfirm(false);
                }}>
                  <div className="modal-card assignment-person-sheet compact-modal" id="line-candidate-picker" onClick={(event) => event.stopPropagation()}>
                    <div className="sheet-drag-handle" aria-hidden="true" />
                    <div className="line-title-row">
                      <div>
                        <h3 id="line-candidate-picker-title">Выберите сотрудника</h3>
                        <span>{dashboard.line.name} · {selectedAssignmentSlot.label}</span>
                      </div>
                      <button className="secondary-button compact-action" type="button" disabled={busy} onClick={() => {
                        setSelectedAssignmentSlot(null);
                        setSelectedAssignmentCandidateId('');
                        setCurrentAssignmentConfirm(false);
                      }}>Назад</button>
                    </div>
                    <button className="secondary-button compact-action manual-candidate-action" type="button" disabled={busy} onClick={() => openManualEmployeeSearch('CURRENT', 'SLOT')}>
                      Найти не отметившегося сотрудника
                    </button>
                    <div className="candidate-list compact-candidate-list assignment-person-list">
                      {assignmentBoard?.candidates.map((candidate) => {
                        const skill = currentCandidateSkill(candidate);
                        return (
                          <article className={`candidate-card compact-candidate-card assignment-person-row ${skill.className}`} key={candidate.userId}>
                            <span className="person-title-with-photo">
                              <ProfilePhoto photo={candidate.profilePhoto} userId={candidate.userId} displayName={candidate.displayName} size="small" />
                              <strong>{shortPersonName(candidate.userId, candidate.displayName)}</strong>
                            </span>
                            <span>{candidate.isMovable ? candidateAssignmentDestination(candidate.currentAssignment) : (candidate.companyName ?? candidate.departmentName ?? roleLabels[candidate.role] ?? candidate.role)} · {skill.label}</span>
                            <button className={candidate.isMovable ? 'secondary-button compact-action' : 'primary-button compact-action'} type="button" disabled={busy} onClick={() => {
                              if (candidate.isMovable) {
                                selectCurrentCandidate(candidate.userId);
                                setCurrentAssignmentConfirm(true);
                                return;
                              }
                              void assignCandidateToSlot(candidate.userId, selectedAssignmentSlot.positionId, selectedAssignmentSlot.slotIndex);
                            }}>{candidate.isMovable ? 'Переставить' : 'Назначить'}</button>
                          </article>
                        );
                      })}
                      {!assignmentBoard?.candidates.length ? <div className="empty-state compact">Свободных работников и наёмных работников нет</div> : null}
                    </div>
                    {currentAssignmentConfirm ? (
                      <div className="inline-confirm-panel">
                        <strong>{manualSearchSelection?.result.userId === selectedAssignmentCandidateId && manualSearchSelection.result.requiresManualAdd
                          ? 'Сотрудник не отмечен на текущей смене. Добавить в смену и назначить?'
                          : 'Подтвердите перестановку'}</strong>
                        <span>
                          {selectedAssignmentCandidateId ? shortPersonName(selectedAssignmentCandidateId, manualSearchSelection?.result.userId === selectedAssignmentCandidateId ? manualSearchSelection.result.displayName : workforcePeople.find((item) => item.userId === selectedAssignmentCandidateId)?.displayName ?? assignmentBoard?.candidates.find((item) => item.userId === selectedAssignmentCandidateId)?.displayName) : 'Сотрудник'}
                          {' → '}
                          {dashboard.line.name} / {selectedAssignmentSlot.label}
                        </span>
                        <span>{manualSearchSelection?.result.userId === selectedAssignmentCandidateId && manualSearchSelection.result.requiresManualAdd
                          ? `${manualSearchSelection.context.label}. Автор действия: вы (${roleLabels[currentUser?.role ?? ''] ?? 'мастер'}).`
                          : 'Старое место будет освобождено штатно, без дублей.'}</span>
                      </div>
                    ) : null}
                    {selectedAssignmentCandidateId ? <div className="modal-actions sticky-actions line-candidate-actions">
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => {
                        setSelectedAssignmentCandidateId('');
                        setCurrentAssignmentConfirm(false);
                      }}>Отмена</button>
                      <button className="primary-button" type="button" disabled={busy} onClick={() => void confirmCurrentSlotAssignment()}>
                        {manualSearchSelection?.result.userId === selectedAssignmentCandidateId && manualSearchSelection.result.requiresManualAdd ? 'Добавить и назначить' : 'Подтвердить перестановку'}
                      </button>
                    </div> : null}
                  </div>
                </div>
              ) : null}
            </section> : null}

            {dashboardReadOnly ? (
              <section className="dashboard-grid">
                <div className="section-subhead"><h3>Позиции</h3><span>{dashboard.assignmentsByPosition.length}</span></div>
                {dashboard.assignmentsByPosition.map((group) => {
                  const shortage = dashboard.shortageSummary?.find((item) => item.positionId === group.position.id);
                  return (
                    <div className="position-row" key={group.position.id}>
                      <div>
                        <strong>{group.position.displayName ?? group.position.name}</strong>
                        <span>{group.assignments.map((item) => item.displayName).join(', ') || 'Нет людей'}</span>
                      </div>
                      <span className={`tag ${shortage?.missing ? 'stop' : 'work'}`}>
                        {shortage ? `${shortage.actual}/${shortage.required}` : group.assignments.length}
                      </span>
                    </div>
                  );
                })}
                {dashboard.withoutPosition.length ? (
                    <div className="position-row">
                      <div><strong>Без позиции</strong><span>{dashboard.withoutPosition.map((item) => item.displayName).join(', ')}</span></div>
                    </div>
                  ) : null}
              </section>
            ) : null}

            <div className="line-last-event">
              <span className="eyebrow">Последнее событие</span>
              {dashboard.recentEvents[0] ? (
                <>
                  <strong>{dashboard.recentEvents[0].humanTitle ?? statusLabels[dashboard.recentEvents[0].status] ?? 'Событие линии'}</strong>
                  <span>{formatDateTime(dashboard.recentEvents[0].occurredAt ?? dashboard.recentEvents[0].correctedStartAt ?? dashboard.recentEvents[0].createdAt)}
                    {dashboard.recentEvents[0].actorName ? ` · ${dashboard.recentEvents[0].actorName}` : ''}
                  </span>
                </>
              ) : <span>Событий этой смены пока нет</span>}
            </div>

            <details className="line-dashboard-details" id="line-runtime-stats">
              <summary>Настройки и активность <span className="tag">{dashboard.activeTasks.length + dashboard.activeWash.length + (dashboard.activeDefrost ? 1 : 0)}</span></summary>
              {!dashboardReadOnly ? (
                <div className="line-template-control">
                  <label className="field-label" htmlFor="active-template">Активный шаблон состава</label>
                  <select
                    id="active-template"
                    value={dashboard.activeTemplate?.id ?? ''}
                    onChange={(event) => void requestTemplateRemap('CURRENT', dashboard.line, event.target.value || null)}
                    disabled={busy}
                  >
                    <option value="">Без шаблона</option>
                    {dashboard.staffingTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <section className="dashboard-activity">
                <div className="line-meta dashboard-tags">
                  <span className="tag">Заявки: {dashboard.activeTasks.length}</span>
                  <span className="tag">Мойка: {dashboard.activeWash.length}</span>
                  <span className="tag">Оттайка: {dashboard.activeDefrost ? 'активна' : dashboard.latestDefrost?.length ?? 0}</span>
                  <span className="tag">События: {dashboard.recentEvents.length}</span>
                </div>
                {dashboard.activeDefrost ? (
                  <div className="empty-state compact">Оттайка активна с {new Date(dashboard.activeDefrost.startAt).toLocaleString()}</div>
                ) : null}
                {dashboard.latestDefrost?.slice(0, 3).map((event) => (
                  <div className="empty-state compact" key={event.id}>
                    Оттайка {defrostStatusLabels[event.status] ?? 'Статус не указан'}: {new Date(event.startAt).toLocaleString()}
                  </div>
                ))}
                {dashboard.activeTasks.map((task) => (
                  <div className="empty-state compact" key={task.taskId}>
                    {task.serviceLabel || 'Служба не указана'}{task.assigneeDisplayName ? ` — ${task.assigneeDisplayName}` : ''} · {task.taskStatusLabel}
                  </div>
                ))}
                {dashboard.shortageSummary?.some((item) => item.missing > 0) ? (
                  <div className="shortage-list">
                    {dashboard.shortageSummary.filter((item) => item.missing > 0).map((item) => (
                      <span className="tag stop" key={item.positionId}>{item.displayName ?? item.positionName}: -{item.missing}</span>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">Данных по линии нет</div>
                )}
                {dashboard.recentEvents.filter((event) => event.status === 'PAUSE' || event.status === 'STOP').slice(0, 3).map((event) => {
                  const eventStartAt = event.correctedStartAt ?? event.createdAt;
                  const eventEndAt = event.correctedEndAt ?? null;
                  return (
                    <div className="empty-state compact" key={event.id}>
                      <strong>{event.status === 'PAUSE' ? 'Простой' : 'Остановка'}:</strong> {event.downtimeReasonLabel || 'Причина не указана'} · {factoryDateTimeLabel(eventStartAt)}
                      {eventEndAt ? <span> · {formatElapsed(eventStartAt, eventEndAt)}</span> : null}
                      {event.comment ? <span> · {event.comment}</span> : null}
                      {!dashboardReadOnly ? (
                        <div className="button-row">
                          <button className="secondary-button" type="button" disabled={busy} onClick={() => openDowntimeCorrection(event)}>Уточнить время простоя</button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            </details>

            {!selectedAssignmentSlot ? <div className="modal-actions sticky-actions line-dashboard-footer">
              <button className="secondary-button" type="button" onClick={() => {
                setLineActionsOpen(false);
                setDashboard(null);
                setAssignmentBoard(null);
                setDashboardReadOnly(false);
                setSelectedAssignmentSlot(null);
                setSelectedAssignmentCandidateId('');
                setCurrentAssignmentConfirm(false);
              }} disabled={busy}>Закрыть</button>
              <button className="secondary-button" type="button" onClick={() => void openLineShiftAssignment(dashboard.line)} disabled={busy}>План</button>
              <button className="primary-button" type="button" onClick={() => void openDashboard(dashboard.line.id, { readOnly: dashboardReadOnly })} disabled={busy}>Обновить</button>
            </div> : null}
          </div>
        </div>
      ) : null}

      {dashboard && !dashboardReadOnly ? (
        <PremiumSheet
          className="line-actions-premium-sheet"
          open={lineActionsOpen}
          title="Действия по линии"
          description={dashboard.line.name}
          onClose={() => setLineActionsOpen(false)}
        >
          <div className="premium-action-list line-action-options">
            {dashboard.line.operationalState === 'WASH' ? (
              <PremiumActionItem
                label="Открыть мойку"
                description="Возврат в работу доступен после завершения мойки"
                icon="◉"
                tone="blue"
                disabled={busy}
                onClick={() => { setLineActionsOpen(false); openLineWash(dashboard.activeWash[0]?.id ?? dashboard.line.activeWash?.id); }}
              />
            ) : dashboard.line.operationalState === 'DEFROST' ? (
              <PremiumActionItem
                label="Открыть оттайку"
                description="Изменение состояния линии доступно после завершения оттайки"
                icon="◌"
                tone="blue"
                disabled={busy || !canReadDefrost}
                reason={!canReadDefrost ? 'Нет доступа к разделу оттайки.' : undefined}
                onClick={() => { setLineActionsOpen(false); openLineDefrost(); }}
              />
            ) : dashboard.line.operationalState !== 'RUNNING' ? (
              <PremiumActionItem label="Вернуть в работу" description="Зафиксировать запуск линии" icon="▶" tone="green" disabled={busy} onClick={() => { setLineActionsOpen(false); openLineAction('work'); }} />
            ) : (
              <>
                <PremiumActionItem label="Зафиксировать простой" description="Причина, комментарий и фактическое время" icon="Ⅱ" tone="red" disabled={busy} onClick={() => { setLineActionsOpen(false); openLineAction('pause'); }} />
                <PremiumActionItem label="Остановить линию" description="Линия перейдёт в остановленные" icon="■" tone="red" disabled={busy} onClick={() => { setLineActionsOpen(false); openLineAction('stop'); }} />
              </>
            )}
            <PremiumActionItem label="Срочная заявка" description="Создать заявку по этой линии" icon="+" tone="gold" disabled={busy} onClick={() => { setLineActionsOpen(false); openLineAction('task'); }} />
            {dashboard.activeDowntimeEvent ? (
              <PremiumActionItem label="Заявка из простоя" description="Связать заявку с текущим простоем" icon="!" tone="red" disabled={busy} onClick={() => { setLineActionsOpen(false); openLineAction('downtimeTask'); }} />
            ) : null}
            {!dashboard.activeWash.length ? (
              <PremiumActionItem
                label="Начать мойку"
                description="Открыть штатный контур мойки линии"
                reason={dashboard.line.operationalState !== 'STOPPED' ? 'Сначала остановите линию: мойка начинается только для остановленной линии.' : undefined}
                icon="◌"
                tone="gold"
                disabled={busy || dashboard.line.operationalState !== 'STOPPED'}
                onClick={() => { setLineActionsOpen(false); openLineAction('wash'); }}
              />
            ) : null}
            <PremiumActionItem label="Завершить смену линии" description="Зафиксировать процент выполнения плана" icon="✓" tone="red" disabled={busy} onClick={() => { setLineActionsOpen(false); openLineAction('endShift'); }} />
            <PremiumActionItem label="Статистика и активность" description="Заявки, мойка, оттайка и последние события" icon="≡" tone="blue" disabled={busy} onClick={() => {
              setLineActionsOpen(false);
              const detail = document.getElementById('line-runtime-stats') as HTMLDetailsElement | null;
              if (detail) detail.open = true;
              window.setTimeout(() => detail?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
            }} />
          </div>
        </PremiumSheet>
      ) : null}

      {lineShiftAssignment && lineShiftAssignmentLine ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card line-shift-assignment-modal premium-deep-form">
            <div className="line-title-row">
              <div>
                <h3>Текущее задание</h3>
                <span>{lineShiftAssignmentLine.name} · {lineShiftAssignment.shiftType === 'NIGHT' ? 'ночная смена' : 'дневная смена'} · {lineShiftAssignment.shiftDate}</span>
              </div>
              <span className={`tag ${lineShiftAssignment.isPast ? 'pause' : 'work'}`}>{lineShiftAssignment.isPast ? 'Прошлая смена' : 'Доступно'}</span>
            </div>
            {lineShiftAssignment.rows.length ? (
              <div className="line-shift-assignment-list">
                {lineShiftAssignment.rows.map((row) => (
                  <div className="line-shift-assignment-row" key={row.id}>
                    <div>
                      <strong>{row.article}</strong>
                      <span>{row.productName}</span>
                      <span>Гофр по плану: {row.plannedGofrCount}</span>
                    </div>
                    {lineShiftAssignment.canEdit ? (
                      <div className="row-actions">
                        <button className="secondary-button" type="button" disabled={busy} onClick={() => setAssignmentRowForm({
                          id: row.id,
                          article: row.article,
                          productName: row.productName,
                          plannedGofrCount: String(row.plannedGofrCount),
                        })}>Изменить</button>
                        <button className="secondary-button danger" type="button" disabled={busy} onClick={() => setAssignmentRowToDelete(row)}>Удалить</button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Задание не заполнено</div>
            )}
            {!lineShiftAssignment.canEdit ? (
              <div className="empty-state compact">Прошлые смены и роли без права управления доступны только для просмотра.</div>
            ) : null}
            {lineShiftAssignment.canEdit && lineShiftAssignment.rows.length < 10 ? (
              <button className="primary-button" type="button" disabled={busy} onClick={() => setAssignmentRowForm({ article: '', productName: '', plannedGofrCount: '' })}>
                Добавить строку
              </button>
            ) : null}
            {lineShiftAssignment.rows.length >= 10 ? <div className="empty-state compact">Максимум 10 строк</div> : null}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => {
                setLineShiftAssignment(null);
                setLineShiftAssignmentLine(null);
                setAssignmentRowForm(null);
                setAssignmentRowToDelete(null);
              }} disabled={busy}>Закрыть</button>
              <button className="primary-button" type="button" onClick={() => lineShiftAssignmentLine ? void openLineShiftAssignment(lineShiftAssignmentLine, { shiftDate: lineShiftAssignment.shiftDate, shiftType: lineShiftAssignment.shiftType }) : undefined} disabled={busy}>Обновить</button>
            </div>
          </div>
        </div>
      ) : null}

      {assignmentRowForm ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-form">
            <h3>{assignmentRowForm.id ? 'Изменить строку задания' : 'Добавить строку задания'}</h3>
            <label className="field-label" htmlFor="assignment-article">Артикул</label>
            <input id="assignment-article" value={assignmentRowForm.article} onChange={(event) => setAssignmentRowForm({ ...assignmentRowForm, article: event.target.value })} />
            <label className="field-label" htmlFor="assignment-product">Наименование</label>
            <input id="assignment-product" value={assignmentRowForm.productName} onChange={(event) => setAssignmentRowForm({ ...assignmentRowForm, productName: event.target.value })} />
            <label className="field-label" htmlFor="assignment-gofr">Гофр по плану</label>
            <input id="assignment-gofr" type="number" min="1" value={assignmentRowForm.plannedGofrCount} onChange={(event) => setAssignmentRowForm({ ...assignmentRowForm, plannedGofrCount: event.target.value })} />
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setAssignmentRowForm(null)} disabled={busy}>Отмена</button>
              <button className="primary-button" type="button" onClick={() => void saveAssignmentRow()} disabled={busy}>Сохранить</button>
            </div>
          </div>
        </div>
      ) : null}

      {assignmentRowToDelete ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-form">
            <h3>Удалить строку задания?</h3>
            <p>Строка будет скрыта из текущего задания линии. История действия останется в аудите.</p>
            <div className="empty-state compact">{assignmentRowToDelete.article} · {assignmentRowToDelete.productName}</div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setAssignmentRowToDelete(null)} disabled={busy}>Отмена</button>
              <button className="primary-button danger" type="button" onClick={() => void deleteAssignmentRow()} disabled={busy}>Удалить</button>
            </div>
          </div>
        </div>
      ) : null}

      {downtimeCorrectionTarget ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-form">
            <h3>Уточнить время простоя</h3>
            <p>Статистика будет использовать уточнённое время. Старое и новое значение останутся в аудите.</p>
            <label className="field-label" htmlFor="downtime-correction-start">Фактическое начало</label>
            <input id="downtime-correction-start" type="datetime-local" value={correctionStartAt} onChange={(event) => setCorrectionStartAt(event.target.value)} />
            <label className="field-label" htmlFor="downtime-correction-end">Фактическое окончание</label>
            <input id="downtime-correction-end" type="datetime-local" value={correctionEndAt} onChange={(event) => setCorrectionEndAt(event.target.value)} />
            <label className="field-label" htmlFor="downtime-correction-comment">Комментарий к уточнению</label>
            <textarea id="downtime-correction-comment" value={correctionComment} onChange={(event) => setCorrectionComment(event.target.value)} placeholder="Почему время уточняется" />
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setDowntimeCorrectionTarget(null)} disabled={busy}>Отмена</button>
              <button className="primary-button" type="button" onClick={() => void submitDowntimeCorrection()} disabled={busy}>Сохранить уточнение</button>
            </div>
          </div>
        </div>
      ) : null}

      {lineAction ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-form">
            <h3>{lineAction === 'activateLine' ? (pendingActivationLine?.name ?? 'Активировать линию') : (dashboard?.line.name ?? pendingLine?.name ?? 'Линия')}</h3>
            {lineAction === 'activateLine' ? (
              <>
                <p>Добавить линию в текущую смену? Это создаст сменное состояние линии без учёта продукции.</p>
                {!pendingLine ? (
                  <>
                    <label className="field-label" htmlFor="activate-line-select">Линия</label>
                    <select
                      id="activate-line-select"
                      value={lineId}
                      onChange={(event) => {
                        setLineId(event.target.value);
                        const nextLine = inactiveLines.find((line) => line.id === event.target.value);
                        setActivationTemplateId(nextLine?.defaultStaffingTemplateId ?? nextLine?.activeTemplate?.id ?? '');
                      }}
                    >
                      <option value="">Выберите линию</option>
                      {inactiveLines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
                    </select>
                  </>
                ) : null}
                <label className="field-label" htmlFor="activate-template-select">Шаблон состава</label>
                <select id="activate-template-select" value={activationTemplateId} onChange={(event) => setActivationTemplateId(event.target.value)}>
                  <option value="">Без шаблона</option>
                  {pendingActivationLine?.staffingTemplates?.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </>
            ) : null}
            {(lineAction === 'pause' || lineAction === 'stop' || lineAction === 'work') ? (
              <>
                <p>{lineAction === 'work' ? 'Подтвердите фактический запуск линии в работу.' : 'Выберите причину и добавьте комментарий к простою или остановке.'}</p>
                <label className="field-label" htmlFor="line-event-time-mode">Время события</label>
                <select id="line-event-time-mode" value={lineEventTimeMode} onChange={(event) => setLineEventTimeMode(event.target.value === 'CUSTOM' ? 'CUSTOM' : 'NOW')}>
                  <option value="NOW">Сейчас</option>
                  <option value="CUSTOM">Указать фактическое время</option>
                </select>
                {lineEventTimeMode === 'CUSTOM' ? (
                  <>
                    <label className="field-label" htmlFor="line-event-effective-at">Фактическое время</label>
                    <input id="line-event-effective-at" type="datetime-local" value={lineEventTime} onChange={(event) => setLineEventTime(event.target.value)} />
                  </>
                ) : null}
                <div className="empty-state compact">
                  Можно указать фактическое время, если событие отметили не сразу. Сервер примет только интервал в пределах 30 минут.
                  {lineEventServerNow ? <span className="line-meta"> Серверное время: {formatDateTime(lineEventServerNow)}</span> : null}
                </div>
                {lineAction !== 'work' ? (
                  <>
                    <label className="field-label" htmlFor="downtime-reason">Причина простоя</label>
                    <select id="downtime-reason" value={downtimeReason} onChange={(event) => setDowntimeReason(event.target.value)}>
                      {downtimeReasonOptions.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                    </select>
                    <textarea value={statusComment} onChange={(event) => setStatusComment(event.target.value)} placeholder="Комментарий к событию" />
                  </>
                ) : null}
              </>
            ) : null}
            {lineAction === 'task' || lineAction === 'downtimeTask' ? (
              <>
                <p>{lineAction === 'downtimeTask' ? 'Заявка будет связана с активным простоем линии и попадёт в аналитику простоев.' : 'Создание срочной заявки по линии.'}</p>
                {lineAction === 'downtimeTask' ? (
                  <>
                    <label className="field-label" htmlFor="downtime-task-department">Отдел-получатель</label>
                    <select id="downtime-task-department" value={taskDepartmentId} onChange={(event) => setTaskDepartmentId(event.target.value)}>
                      <option value="">Выберите отдел</option>
                      {taskDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </>
                ) : null}
                <textarea value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} placeholder="Что нужно срочно сделать" />
                <AttachmentPicker value={taskFiles} onChange={setTaskFiles} allowFiles />
              </>
            ) : null}
            {lineAction === 'wash' ? <p>Начать мойку по этой линии? Текущие назначенные люди будут переведены в мойку.</p> : null}
            {lineAction === 'endShift' ? (
              <>
                <p>Введите ручной процент выполнения плана по линии. Это не учёт продукции и не интеграция с 1С.</p>
                <input value={planPercent} onChange={(event) => setPlanPercent(event.target.value)} inputMode="decimal" placeholder="Например: 100" />
                <textarea value={planComment} onChange={(event) => setPlanComment(event.target.value)} placeholder="Комментарий обязателен ниже 80%" />
              </>
            ) : null}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => {
                const restoreAssignmentFlow = Boolean(assignmentFlowUser && (lineAction === 'work' || lineAction === 'activateLine'));
                setLineAction(null);
                setPendingLine(null);
                if (restoreAssignmentFlow && assignmentFlowUser) setCurrentLinePickerSelection({ userId: assignmentFlowUser.userId, displayName: assignmentFlowUser.displayName, mode: 'assign' });
              }} disabled={busy}>Отмена</button>
              <button className="primary-button" type="button" onClick={() => void submitLineAction()} disabled={busy}>Подтвердить</button>
            </div>
          </div>
        </div>
      ) : null}

      {actionUser && personAction ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card premium-deep-form">
            <h3>{pilotUserName(actionUser.userId, actionUser.displayName)}</h3>
            {personAction === 'line' || personAction === 'wash' ? (
              <>
                <p>{personAction === 'line' ? 'Назначение на линию и позицию' : 'Назначение на мойку'}</p>
                {personAction === 'line' ? (
                  <>
                    <label className="field-label" htmlFor="line-select">Линия</label>
                    <select id="line-select" value={lineId} onChange={(event) => setLineId(event.target.value)}>
                      <option value="">Выберите линию</option>
                      {activeLines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
                    </select>
                    <label className="field-label" htmlFor="position-select">Позиция</label>
                    <select id="position-select" value={positionId} onChange={(event) => setPositionId(event.target.value)}>
                      <option value="">Выберите позицию</option>
                      {selectedLine?.positions?.map((position) => (
                        <option key={position.id} value={position.id}>{position.name}</option>
                      ))}
                    </select>
                    <label className="field-label" htmlFor="template-select">Шаблон</label>
                    <select id="template-select" value={staffingTemplateId} onChange={(event) => setStaffingTemplateId(event.target.value)}>
                      <option value="">Без шаблона</option>
                      {selectedLine?.staffingTemplates?.map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </select>
                    {selectedTemplate ? <p>Назначение будет связано с шаблоном «{selectedTemplate.name}».</p> : null}
                  </>
                ) : (
                  <>
                    <label className="field-label" htmlFor="wash-session-select">Активная мойка</label>
                    <select id="wash-session-select" value={washSessionId} onChange={(event) => setWashSessionId(event.target.value)}>
                      <option value="">Выберите активную мойку</option>
                      {washLines.map((line) => line.activeWash ? (
                        <option key={line.activeWash.id} value={line.activeWash.id}>{line.name}</option>
                      ) : null)}
                    </select>
                    {!washLines.length ? <p className="helper-text">Активных моек сейчас нет. Сначала начните мойку в разделе линии.</p> : null}
                  </>
                )}
              </>
            ) : null}
            {personAction === 'home' ? (
              <>
                <p>Отправить сотрудника домой</p>
                <textarea value={homeComment} onChange={(event) => setHomeComment(event.target.value)} placeholder="Укажите комментарий" />
              </>
            ) : null}
            {personAction === 'release' ? <p>Снять назначение и освободить сотрудника?</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => { setPersonAction(null); setActionUser(null); if (assignmentFlowUser) setAssignmentMenuUser(assignmentFlowUser); }} disabled={busy}>Отмена</button>
              <button className="primary-button" type="button" onClick={() => void submitPersonAction()} disabled={busy}>Подтвердить</button>
            </div>
          </div>
        </div>
      ) : null}

      {profile ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card profile-card">
            <div className="profile-card-body">
            <div className="profile-hero profile-hero-rich">
              <div className="profile-title-panel profile-title-panel-with-photo">
                <ProfilePhoto photo={profile.profilePhoto} userId={profile.id} displayName={profile.displayName} size="large" />
                <div className="profile-title-content">
                  <span className="eyebrow">Карточка сотрудника</span>
                  <h3>{profile.displayName}</h3>
                  <p>{shortPersonName(profile.id, profile.displayName)}</p>
                  <div className="profile-status-grid">
                    <span className="tag">Роль: {roleLabels[profile.role] ?? profile.role}</span>
                    <span className="tag">{profile.departmentName ?? profileFactoryAccess?.departmentName ?? 'Отдел не указан'}</span>
                    <span className={`tag ${stateMeta[profile.employeeState].tag}`}>{stateMeta[profile.employeeState].label}</span>
                    {profile.phoneLabel ? <span className="tag">{profile.phoneLabel}</span> : null}
                  </div>
                  <span className="profile-photo-caption">Фото загружает мастер или руководитель</span>
                </div>
              </div>
            </div>
            <div className="profile-summary-grid">
              <div className="profile-summary-card">
                <span>Завод</span>
                <strong>{profileFactoryAccess?.factoryName ?? 'Завод не указан'}</strong>
              </div>
              <div className="profile-summary-card">
                <span>Смена</span>
                <strong>{profile.currentAssignment ? 'Есть назначение' : 'Без назначения'}</strong>
              </div>
              <div className="profile-summary-card">
                <span>Назначение</span>
                <strong>{profileAssignmentLabel}</strong>
              </div>
              <div className="profile-summary-card">
                <span>Контакты</span>
                <strong>{profile.phoneLabel ?? 'Телефон скрыт'}</strong>
              </div>
            </div>
            <div className="profile-sections">
              <div className="position-row">
                <div>
                  <strong>Текущее назначение</strong>
                  <span>{profileAssignmentLabel}</span>
                </div>
              </div>
              {profile.serviceTaskStatus ? (
                <div className="position-row service-status-row">
                  <div>
                    <strong>{profile.serviceTaskStatus.label}</strong>
                    <span>
                      {profile.serviceTaskStatus.state === 'ON_TASK'
                        ? `${profile.serviceTaskStatus.title ?? 'Заявка'}${profile.serviceTaskStatus.lineName ? ` · ${profile.serviceTaskStatus.lineName}` : ''}`
                        : 'Активной заявки в работе нет'}
                    </span>
                  </div>
                  {profile.serviceTaskStatus.state === 'ON_TASK' ? (
                    <button className="secondary-button compact-action" type="button" onClick={() => {
                    window.dispatchEvent(new CustomEvent('zavod:navigate', { detail: {
                      screen: 'Tasks', taskId: profile.serviceTaskStatus?.taskId,
                      taskReturn: {
                        profileId: profile.id, includeAllPeople, shiftTab, currentOperationalView, peoplePanelMode, peopleSearch,
                        futurePanelMode, futureSearch, selectedFuturePersonId, selectedFutureTarget,
                        historyMonth, historySelectedDate, pastDetailTab, pastShiftKey: pastShiftDetail?.key,
                        dashboard: dashboard ? { lineId: dashboard.line.id, readOnly: dashboardReadOnly } : undefined,
                        planning: planningBoard ? { lineId: planningBoard.line.id, shiftDate: planningBoard.shiftDate, shiftType: planningBoard.shiftType, templateId: planningBoard.staffingTemplate?.id, candidateId: selectedPlanningCandidateId, slot: selectedPlanningSlot } : undefined,
                        futureBoard: futureAssignmentBoard ? { shiftDate: futureAssignmentBoard.shiftDate, shiftType: futureAssignmentBoard.shiftType } : undefined,
                        workAreaId: workAreaBoard?.workArea.id, selectedAssignmentSlot, selectedAssignmentCandidateId,
                        pageTop: document.body.style.position === 'fixed' ? -(parseFloat(document.body.style.top) || 0) : window.scrollY,
                        parentScroll: taskReturnScrollSelectors.flatMap((selector) => {
                          const element = document.querySelector<HTMLElement>(selector);
                          return element ? [{ selector, top: element.scrollTop, left: element.scrollLeft }] : [];
                        }),
                      } satisfies ShiftTaskReturn,
                    } }));
                    }}>
                      Посмотреть заявку
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="position-row"><div><strong>Навыки</strong><span>{profile.sections.skills}</span></div></div>
              <div className="position-row"><div><strong>Рекомендации</strong><span>{profile.sections.recommendations}</span></div></div>
              {profile.sections.comments ? <div className="position-row"><div><strong>Комментарии</strong><span>{profile.sections.comments}</span></div></div> : null}
            </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setProfile(null)}>Закрыть</button>
              <button className="primary-button" type="button" onClick={() => void openProfile(profile.id)} disabled={busy}>Обновить</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
