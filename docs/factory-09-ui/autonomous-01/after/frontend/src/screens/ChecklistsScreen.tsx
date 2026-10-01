import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { uploadAttachments } from '../api/attachments';
import { ApiNetworkError, apiClient } from '../api/client';
import { ActionModal, ActionModalField } from '../components/ActionModal';
import { AppConfirmDialog } from '../components/AppConfirmDialog';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { ChecklistItemDraft, ChecklistItemEditor } from '../components/ChecklistItemEditor';
import { duplicateChecklistItem, setChecklistItemActive } from '../components/checklist-item-draft';
import { PremiumActionItem, PremiumKpiStrip, PremiumSectionHeader, PremiumSheet } from '../components/PremiumShell';
import { checklistRowStatusLabels, checklistRunStatusLabels, displayLabel } from '../labels';
import { useMobileBackLayer, useMobileFormDirty } from '../navigation/mobile-back';
import { Attachment, useAppStore } from '../store/app.store';
import { isPilotFixtureText, shouldHidePilotFixtures } from '../utils/pilot-ui';
import { factoryDateKey } from '../utils/factory-time';

void React;

type RowType =
  | 'LEGACY'
  | 'YES_NO'
  | 'YES_NO_NA'
  | 'TEXT'
  | 'REQUIRED_COMMENT'
  | 'PHOTO'
  | 'REQUIRED_PHOTO'
  | 'NUMBER'
  | 'SELECT'
  | 'INFO';

type ChecklistTemplateRow = {
  referencePhoto?: Attachment | null;
  id: string;
  title: string;
  description?: string | null;
  sortOrder: number;
  rowType?: RowType | string;
  requiredAnswer?: boolean;
  requiresPhoto: boolean;
  requiresComment: boolean;
  isRequired: boolean;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  targetValue?: number | null;
  optionsJson?: string[] | null;
  isActive: boolean;
};

type ChecklistTemplate = {
  id: string;
  scope?: 'DEPARTMENT' | 'LINE' | string | null;
  departmentId: string;
  departmentName?: string | null;
  departmentLabel?: string | null;
  departmentScope?: string | null;
  lineId?: string | null;
  lineName?: string | null;
  lineLabel?: string | null;
  name: string;
  description?: string | null;
  archivedAt?: string | null;
  isActive?: boolean;
  assignmentRoles?: string[] | null;
  assignmentUserIds?: string[] | null;
  shiftType?: 'DAY' | 'NIGHT' | null;
  shiftLabel?: string | null;
  frequencyRule?: string | null;
  frequencyHours?: number | null;
  frequencyIntervalUnit?: 'MINUTES' | 'HOURS' | string | null;
  frequencyIntervalValue?: number | null;
  frequencyLabel?: string | null;
  assignmentLabel?: string | null;
  isMandatory?: boolean;
  lastRunAt?: string | null;
  availability?: {
    alreadyTaken?: boolean;
    duplicateBlocked?: boolean;
    currentRun?: { id: string; status: string; closedAt?: string | null } | null;
    reason?: string | null;
  };
  rows: ChecklistTemplateRow[];
};

type ChecklistRunRow = {
  id: string;
  templateRowId?: string;
  title: string;
  description?: string | null;
  sortOrder: number;
  rowType?: RowType | string;
  requiredAnswer?: boolean;
  status: 'PENDING' | 'OK' | 'NA' | 'ISSUE';
  requiresPhoto: boolean;
  requiresComment: boolean;
  isRequired: boolean;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  targetValue?: number | null;
  optionsJson?: string[] | null;
  answerBoolean?: boolean | null;
  answerText?: string | null;
  answerNumber?: number | null;
  selectedOption?: string | null;
  comment?: string | null;
  attachments?: Attachment[];
  referencePhoto?: Attachment | null;
  entryId?: string | null;
  completedByName?: string | null;
  completedAt?: string | null;
};

type ChecklistRun = {
  id: string;
  userId: string;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'AUTO_CLOSED';
  startedAt: string;
  closedAt?: string | null;
  autoClosedAt?: string | null;
  nextCheckAt?: string | null;
  shiftEndsAt?: string | null;
  frequencyRule?: string | null;
  frequencyIntervalUnit?: string | null;
  frequencyIntervalValue?: number | null;
  frequencyLabel?: string | null;
  pauseComment?: string | null;
  closeComment?: string | null;
  closeReason?: string | null;
  template?: {
    id: string;
    name: string;
    description?: string | null;
    departmentId?: string | null;
    departmentName?: string | null;
    departmentLabel?: string | null;
    frequencyRule?: string | null;
    frequencyIntervalUnit?: string | null;
    frequencyIntervalValue?: number | null;
  };
  departmentName?: string | null;
  departmentLabel?: string | null;
  departmentScope?: string | null;
  lineId?: string | null;
  lineName?: string | null;
  lineLabel?: string | null;
  shiftDate?: string | null;
  shiftType?: 'DAY' | 'NIGHT' | null;
  shiftLabel?: string | null;
  rows: ChecklistRunRow[];
  currentCheck?: ChecklistRunCheck | null;
  checks?: ChecklistRunCheck[];
  attachments?: Attachment[];
  referencePhoto?: Attachment | null;
  pauseEvents?: Array<{ id: string; reason: string; durationSeconds?: number | null }>;
  executorName?: string | null;
  closeKind?: string | null;
  closeOutcome?: 'COMPLETE' | 'INCOMPLETE' | null;
  completion?: { total: number; done: number; missingRequired: number; percent: number };
};

type ChecklistRunCheck = {
  id: string;
  sequence: number;
  status: string;
  dueAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  completedById?: string | null;
  completedByName?: string | null;
  rows?: ChecklistRunRow[];
};

type ChecklistWorkspace = {
  generatedAt: string;
  formSettings?: { requirePauseComment: boolean };
  shift: { shiftDate: string; shiftType: 'DAY' | 'NIGHT'; startsAt: string; endsAt: string };
  activeRuns: ChecklistRun[];
  completedRuns: ChecklistRun[];
  available: ChecklistTemplate[];
  manager: null | {
    summary: { inProgress: number; dueSoon: number; overdue: number; paused: number; completed: number; autoClosed: number; notTaken: number };
    runs: ChecklistRun[];
  };
};

type Tab = 'my' | 'available' | 'library' | 'archive';

type ArchiveFilters = {
  dateFrom: string;
  dateTo: string;
  templateId: string;
  userId: string;
  status: string;
  departmentId: string;
  shiftType: string;
  lineId: string;
  onlyDeviations: string;
  withPhotos: string;
  withComments: string;
};

type DirectoryDepartment = { id: string; name: string; code?: string | null };
type DirectoryUser = { userId: string; displayName: string; departmentName?: string | null };
type DirectoryLine = { id: string; name: string; status?: string | null };

type ArchiveTable = {
  template: ChecklistTemplate | null;
  columns: Array<{ id: string; title: string; rowType?: string; unit?: string | null }>;
  rows: Array<{
    id: string;
    date: string;
    time?: string | null;
    shiftLabel?: string | null;
    statusLabel?: string | null;
    userName?: string | null;
    lineName?: string | null;
    values: Record<string, { title: string; value: string; status?: string; comment?: string | null; attachments?: Attachment[] }>;
  }>;
};

type ArchiveJournalRow = {
  rowId: string;
  templateRowId: string;
  title: string;
  type: string;
  typeLabel: string;
  displayValue: string;
  unit?: string | null;
  normText?: string | null;
  status: 'ok' | 'warning' | 'missing';
  statusLabel: string;
  comment?: string | null;
  photoCount: number;
  attachmentCount: number;
  attachments?: Attachment[];
  referencePhoto?: Attachment | null;
  completedByName?: string | null;
  completedAt?: string | null;
};

type ArchiveJournalRun = {
  recordId: string;
  runId: string;
  occurrenceSequence?: number;
  templateName: string;
  date?: string | null;
  time?: string | null;
  closedAt?: string | null;
  shiftDate?: string | null;
  shiftType?: 'DAY' | 'NIGHT' | null;
  shiftLabel?: string | null;
  status: string;
  statusLabel: string;
  closeReason?: string | null;
  closeKind?: string | null;
  startedAt?: string | null;
  pauseEvents?: Array<{
    reason: string;
    pausedAt?: string | null;
    resumedAt?: string | null;
    durationSeconds?: number | null;
  }>;
  userName: string;
  lineName?: string | null;
  deviationCount: number;
  photoCount: number;
  commentCount: number;
  rows: ArchiveJournalRow[];
};

type ArchiveJournal = {
  template: { id: string; name: string; rowCount: number; lineName?: string | null } | null;
  groups: Array<{
    date: string;
    shiftType?: 'DAY' | 'NIGHT' | null;
    title: string;
    runs: Array<{
      recordId: string;
      runId: string;
      occurrenceSequence?: number;
      time?: string | null;
      userName: string;
      lineName?: string | null;
      statusLabel: string;
      deviationCount: number;
      photoCount: number;
      commentCount: number;
    }>;
  }>;
  runs: ArchiveJournalRun[];
  matrix: ArchiveTable;
};

type ChecklistShiftReport = {
  shiftDate: string;
  shiftType: 'DAY' | 'NIGHT';
  shiftLabel: string;
  summary: {
    expected: number;
    completed: number;
    missing: number;
    inProgress: number;
    deviations: number;
    manualReview: number;
  };
  items: Array<{
    templateId: string;
    templateName: string;
    lineName?: string | null;
    frequencyLabel: string;
    expectedLabel: string;
    completed: number;
    inProgress: number;
    missing: number;
    deviationCount: number;
    status: 'ok' | 'missing' | 'deviation' | 'in-progress';
    statusLabel: string;
  }>;
};

type ModalState =
  | { mode: 'start'; title: string; template: ChecklistTemplate }
  | { mode: 'create-template'; title: string }
  | { mode: 'edit-template'; title: string; template: ChecklistTemplate }
  | { mode: 'create-row'; title: string; template: ChecklistTemplate }
  | { mode: 'edit-row'; title: string; template: ChecklistTemplate; templateRow: ChecklistTemplateRow }
  | { mode: 'archive-row'; title: string; template: ChecklistTemplate; templateRow: ChecklistTemplateRow }
  | { mode: 'archive-template'; title: string; template: ChecklistTemplate }
  | { mode: 'restore-template'; title: string; template: ChecklistTemplate }
  | { mode: 'pause'; title: string; run: ChecklistRun }
  | { mode: 'resume'; title: string; run: ChecklistRun }
  | { mode: 'close'; title: string; run: ChecklistRun };

type TemplateBuilderState = {
  mode: 'create' | 'edit' | 'duplicate';
  source?: ChecklistTemplate;
  formTemplate?: ChecklistTemplate;
  formValues: Record<string, string | boolean>;
  initialFormValues: Record<string, string | boolean>;
  rows: ChecklistItemDraft[];
  initialRows: ChecklistItemDraft[];
  editorIndex: number | null;
  editorDraft: ChecklistItemDraft | null;
  editorInitialDraft: ChecklistItemDraft | null;
};

type RowDraft = {
  status: 'OK' | 'NA' | 'ISSUE' | '';
  answerBoolean: boolean | null;
  answerText: string;
  answerNumber: string;
  selectedOption: string;
  comment: string;
};

type ChecklistDetailTarget =
  | { kind: 'template'; template: ChecklistTemplate }
  | { kind: 'run'; run: ChecklistRun };

const rowTypeLabels: Record<string, string> = {
  LEGACY: 'Обычный пункт',
  YES_NO: 'Да / Нет',
  YES_NO_NA: 'Да / Нет / Не применимо',
  TEXT: 'Текстовый комментарий',
  REQUIRED_COMMENT: 'Обязательный комментарий',
  PHOTO: 'Фото',
  REQUIRED_PHOTO: 'Обязательное фото',
  NUMBER: 'Числовой параметр',
  SELECT: 'Выбор из вариантов',
  INFO: 'Информационный блок',
};

let checklistItemSequence = 0;

function itemDraftFromRow(row?: ChecklistTemplateRow, sortOrder = 10): ChecklistItemDraft {
  checklistItemSequence += 1;
  return {
    id: row?.id,
    referencePhoto: row?.referencePhoto ?? null,
    clientKey: row?.id ?? `checklist-item-${Date.now()}-${checklistItemSequence}`,
    title: row?.title ?? '',
    description: row?.description ?? '',
    sortOrder: row?.sortOrder ?? sortOrder,
    rowType: row?.rowType && row.rowType !== 'LEGACY' ? row.rowType : 'YES_NO',
    requiredAnswer: row?.requiredAnswer ?? true,
    requiresPhoto: row?.requiresPhoto ?? false,
    requiresComment: row?.requiresComment ?? false,
    isRequired: row?.isRequired ?? true,
    isActive: row?.isActive ?? true,
    unit: row?.unit ?? '',
    minValue: row?.minValue === null || row?.minValue === undefined ? '' : String(row.minValue),
    maxValue: row?.maxValue === null || row?.maxValue === undefined ? '' : String(row.maxValue),
    targetValue: row?.targetValue === null || row?.targetValue === undefined ? '' : String(row.targetValue),
    optionsText: optionsText(row),
  };
}

function rowTypeLabel(type?: string | null) {
  return rowTypeLabels[type || 'LEGACY'] ?? 'Обычный пункт';
}

function isPhotoChecklistRow(row: ChecklistTemplateRow | ChecklistRunRow) {
  const type = row.rowType ?? 'LEGACY';
  return type === 'PHOTO' || type === 'REQUIRED_PHOTO' || row.requiresPhoto;
}

function isCompositePhotoChecklistRow(row: ChecklistTemplateRow | ChecklistRunRow | null) {
  if (!row) return false;
  const type = row.rowType ?? 'LEGACY';
  return row.requiresPhoto && type !== 'PHOTO' && type !== 'REQUIRED_PHOTO';
}

function optionsText(row?: { optionsJson?: string[] | null }) {
  return Array.isArray(row?.optionsJson) ? row.optionsJson.join('\n') : '';
}

function rowFlags(row: ChecklistTemplateRow | ChecklistRunRow) {
  const flags = [
    rowTypeLabel(row.rowType),
    row.requiredAnswer ? 'нужен ответ' : '',
    row.requiresPhoto ? 'нужно фото' : '',
    row.requiresComment ? 'нужен комментарий' : '',
    row.isRequired ? 'обязательный' : 'необязательный',
    'isActive' in row && !row.isActive ? 'в архиве' : '',
  ].filter(Boolean);
  return flags.join(' / ');
}

function rowFlagBadges(row: ChecklistTemplateRow | ChecklistRunRow) {
  return [
    rowTypeLabel(row.rowType),
    row.requiredAnswer ? 'Нужен ответ' : '',
    row.requiresPhoto ? 'Нужно фото' : '',
    row.requiresComment ? 'Нужен комментарий' : '',
    row.isRequired ? 'Обязательно' : 'Необязательно',
    'isActive' in row && !row.isActive ? 'В архиве' : '',
  ].filter(Boolean);
}

function draftFromRow(row: ChecklistRunRow): RowDraft {
  return {
    status: row.status === 'PENDING' ? '' : row.status,
    answerBoolean: row.answerBoolean ?? null,
    answerText: row.answerText ?? '',
    answerNumber: row.answerNumber === null || row.answerNumber === undefined ? '' : String(row.answerNumber),
    selectedOption: row.selectedOption ?? '',
    comment: row.comment ?? '',
  };
}

function emptyRowDraft(): RowDraft {
  return {
    status: '',
    answerBoolean: null,
    answerText: '',
    answerNumber: '',
    selectedOption: '',
    comment: '',
  };
}

function formatAnswer(row: ChecklistRunRow) {
  const type = row.rowType ?? 'LEGACY';
  if (type === 'YES_NO') return row.answerBoolean === true ? 'Да' : row.answerBoolean === false ? 'Нет' : 'Не заполнено';
  if (type === 'YES_NO_NA') {
    if (row.selectedOption === 'NA') return 'Не применимо';
    return row.answerBoolean === true ? 'Да' : row.answerBoolean === false ? 'Нет' : 'Не заполнено';
  }
  if (type === 'NUMBER') return row.answerNumber === null || row.answerNumber === undefined ? 'Не заполнено' : `${row.answerNumber}${row.unit ? ` ${row.unit}` : ''}`;
  if (type === 'SELECT') return row.selectedOption || 'Не выбрано';
  if (type === 'TEXT' || type === 'REQUIRED_COMMENT') return row.answerText || row.comment || 'Не заполнено';
  if (type === 'PHOTO' || type === 'REQUIRED_PHOTO') return row.attachments?.length ? `Файлов: ${row.attachments.length}` : 'Фото не добавлено';
  if (type === 'INFO') return 'Информационный пункт';
  return displayLabel(checklistRowStatusLabels, row.status);
}

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'Не указано';
}

function durationText(seconds?: number | null) {
  if (seconds === null || seconds === undefined || seconds < 0) return 'Продолжается';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function firstAssignmentRole(template?: ChecklistTemplate) {
  return Array.isArray(template?.assignmentRoles) ? template?.assignmentRoles?.[0] ?? '' : '';
}

function templateMetaItems(template: ChecklistTemplate) {
  return [
    template.lineName || template.assignmentLabel || 'Область не задана',
    template.frequencyLabel || 'По необходимости',
    template.shiftLabel || 'Любая смена',
    template.rows.length ? `${template.rows.length} пунктов` : 'Пункты не заданы',
  ].filter(Boolean);
}

function templateLibraryMetaItems(template: ChecklistTemplate) {
  return [
    ...templateMetaItems(template),
    template.lastRunAt ? `Последний запуск: ${dateTime(template.lastRunAt)}` : 'Запусков не было',
  ].filter(Boolean);
}

function isDiagnosticLine(line: DirectoryLine) {
  return isPilotFixtureText(line.id, line.name) || /stage|test|browser|regression|diagnostic|диагност/i.test(line.name);
}

export function ChecklistsScreen() {
  const { currentUser, availableFactories, selectedFactoryId } = useAppStore();
  const [tab, setTab] = useState<Tab>('my');
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<ChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<ChecklistRun[]>([]);
  const [requirePauseComment, setRequirePauseComment] = useState(true);
  const [completedShiftRuns, setCompletedShiftRuns] = useState<ChecklistRun[]>([]);
  const [managerWorkspace, setManagerWorkspace] = useState<ChecklistWorkspace['manager']>(null);
  const [archive, setArchive] = useState<{ runs: ChecklistRun[]; templates: ChecklistTemplate[] }>({ runs: [], templates: [] });
  const [archiveTable, setArchiveTable] = useState<ArchiveTable | null>(null);
  const [archiveJournal, setArchiveJournal] = useState<ArchiveJournal | null>(null);
  const [archiveMode, setArchiveMode] = useState<'journal' | 'table'>('journal');
  const [selectedArchiveRunId, setSelectedArchiveRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<ChecklistRun | null>(null);
  const [guidedIndex, setGuidedIndex] = useState(0);
  const guidedRowRef = React.useRef<HTMLElement | null>(null);
  const checkCompletionOperationRef = React.useRef<{ checkId: string; operationId: string } | null>(null);
  const rowCompletionOperationRef = React.useRef<{ input: string; operationId: string } | null>(null);
  const rowUploadOperationsRef = React.useRef(new WeakMap<File, Map<string, string>>());
  const [showAllRows, setShowAllRows] = useState(false);
  const [showFinalReview, setShowFinalReview] = useState(false);
  const [dirtyRowIds, setDirtyRowIds] = useState<Set<string>>(() => new Set());
  const [runnerDiscardOpen, setRunnerDiscardOpen] = useState(false);
  const [runnerMenuOpen, setRunnerMenuOpen] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [previewTemplate, setPreviewTemplate] = useState<ChecklistTemplate | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewDrafts, setPreviewDrafts] = useState<Record<string, RowDraft>>({});
  const [previewFilesByRow, setPreviewFilesByRow] = useState<Record<string, File[]>>({});
  const [modal, setModal] = useState<ModalState | null>(null);
  const [templateBuilder, setTemplateBuilder] = useState<TemplateBuilderState | null>(null);
  const [builderDiscardOpen, setBuilderDiscardOpen] = useState(false);
  const [builderPublishConfirmOpen, setBuilderPublishConfirmOpen] = useState(false);
  const [standaloneRowDraft, setStandaloneRowDraft] = useState<ChecklistItemDraft | null>(null);
  const [archiveFilters, setArchiveFilters] = useState<ArchiveFilters>({
    dateFrom: '',
    dateTo: '',
    templateId: '',
    userId: '',
    status: '',
    departmentId: '',
    shiftType: '',
    lineId: '',
    onlyDeviations: '',
    withPhotos: '',
    withComments: '',
  });
  const [shiftReport, setShiftReport] = useState<ChecklistShiftReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [departments, setDepartments] = useState<DirectoryDepartment[]>([]);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [lines, setLines] = useState<DirectoryLine[]>([]);
  const [filesByRow, setFilesByRow] = useState<Record<string, File[]>>({});
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [expandedTemplateIds, setExpandedTemplateIds] = useState<Record<string, boolean>>({});
  const [showArchiveFilters, setShowArchiveFilters] = useState(false);
  const [checklistDetail, setChecklistDetail] = useState<ChecklistDetailTarget | null>(null);
  const [detailJournal, setDetailJournal] = useState<ArchiveJournal | null>(null);
  const [detailOccurrenceId, setDetailOccurrenceId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [compositeStepByRow, setCompositeStepByRow] = useState<Record<string, 0 | 1>>({});

  const canManage = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('checklists.templates.manage'));
  const canReadTemplates = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('checklists.templates.read'));
  const canArchiveReports = Boolean(currentUser?.isAdmin || currentUser?.permissions.includes('checklists.archive.read'));
  const canArchive = Boolean(canArchiveReports || currentUser?.permissions.includes('checklists.runs.self'));
  const hidePilotFixtures = shouldHidePilotFixtures();
  const selectedFactoryName = availableFactories.find((factory) => factory.id === selectedFactoryId)?.name ?? 'выбранный завод';
  const filterRuntimeRuns = (items: ChecklistRun[]) => hidePilotFixtures
    ? items.filter((run) => !isPilotFixtureText(run.userId, run.template?.name, run.template?.description, run.lineName, ...run.rows.map((row) => row.title)))
    : items;
  const filterRuntimeTemplates = (items: ChecklistTemplate[]) => hidePilotFixtures
    ? items.filter((template) => !isPilotFixtureText(template.id, template.name, template.description, template.lineName, template.assignmentLabel, ...template.rows.map((row) => row.title)))
    : items;

  const loadArchive = async (filters = archiveFilters) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const nextArchive = await apiClient.get<{ runs: ChecklistRun[]; templates: ChecklistTemplate[] }>(`/checklists/archive${params.toString() ? `?${params.toString()}` : ''}`);
    const nextArchiveTable = await apiClient.get<ArchiveTable>(`/checklists/archive/by-template${params.toString() ? `?${params.toString()}` : ''}`);
    setArchive({
      runs: filterRuntimeRuns(nextArchive.runs),
      templates: filterRuntimeTemplates(nextArchive.templates),
    });
    setArchiveTable({
      ...nextArchiveTable,
      rows: hidePilotFixtures
        ? nextArchiveTable.rows.filter((row) => !isPilotFixtureText(row.userName, row.lineName, ...Object.values(row.values).map((value) => `${value.title} ${value.value}`)))
        : nextArchiveTable.rows,
    });
    if (filters.templateId) {
      await loadArchiveJournal(filters.templateId, filters);
    } else {
      setArchiveJournal(null);
      setSelectedArchiveRunId(null);
    }
  };

  const loadArchiveJournal = async (templateId: string, filters = archiveFilters) => {
    const params = new URLSearchParams();
    Object.entries({ ...filters, templateId }).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const journal = await apiClient.get<ArchiveJournal>(`/checklists/archive/template/${templateId}/journal${params.toString() ? `?${params.toString()}` : ''}`);
    setArchiveJournal(journal);
    setArchiveTable(journal.matrix);
    setSelectedArchiveRunId((current) => current && journal.runs.some((run) => run.recordId === current) ? current : null);
  };

  const load = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const diagnosticsQuery = hidePilotFixtures ? '' : '?includeDiagnostics=true';
      const [workspace, nextTemplates] = await Promise.all([
        apiClient.get<ChecklistWorkspace>(`/checklists/workspace${diagnosticsQuery}`),
        canReadTemplates
          ? apiClient.get<ChecklistTemplate[]>(`/checklists/templates/library${diagnosticsQuery}`)
          : Promise.resolve([]),
      ]);
      const generatedAtMs = new Date(workspace.generatedAt).getTime();
      setRequirePauseComment(workspace.formSettings?.requirePauseComment ?? true);
      if (Number.isFinite(generatedAtMs)) setServerClockOffsetMs(generatedAtMs - Date.now());
      const visibleRuns = filterRuntimeRuns(workspace.activeRuns);
      const ownedTemplateIds = new Set(visibleRuns.map((run) => run.template?.id).filter(Boolean));
      setRuns(visibleRuns);
      setCompletedShiftRuns(filterRuntimeRuns(workspace.completedRuns));
      setManagerWorkspace(workspace.manager ? { ...workspace.manager, runs: filterRuntimeRuns(workspace.manager.runs) } : null);
      setTemplates(filterRuntimeTemplates(nextTemplates));
      setAvailableTemplates(filterRuntimeTemplates(workspace.available).filter((template) => !ownedTemplateIds.has(template.id)));
      if (canManage || currentUser?.isAdmin) {
        const nextDepartments = await apiClient.get<DirectoryDepartment[]>('/directory/departments');
        setDepartments(hidePilotFixtures ? nextDepartments.filter((department) => !isPilotFixtureText(department.id, department.name, department.code)) : nextDepartments);
      }
      if (canManage || canArchiveReports || currentUser?.isAdmin || currentUser?.permissions.includes('checklists.templates.read')) {
        const nextLines = await apiClient.get<DirectoryLine[]>(`/directory/lines${diagnosticsQuery}`);
        setLines(hidePilotFixtures ? nextLines.filter((line) => !isPilotFixtureText(line.id, line.name)) : nextLines);
      }
      if (canArchiveReports) {
        const nextUsers = await apiClient.get<DirectoryUser[]>('/directory/users');
        setUsers(hidePilotFixtures ? nextUsers.filter((user) => !isPilotFixtureText(user.userId, user.displayName, user.departmentName)) : nextUsers);
      }
      if (canArchive) await loadArchive();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить чек-листы.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [canArchive, canArchiveReports, canManage, canReadTemplates, currentUser?.userId, selectedFactoryId]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const onOperationalInvalidation = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason !== 'checklist') return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void load();
      }, 80);
    };
    window.addEventListener('zavod:operational-data-invalidated', onOperationalInvalidation);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('zavod:operational-data-invalidated', onOperationalInvalidation);
    };
  }, [canArchive, canArchiveReports, canManage, canReadTemplates, currentUser?.userId, selectedFactoryId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const online = () => setNetworkOnline(true);
    const offline = () => setNetworkOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  useEffect(() => {
    if (!selectedRun) return;
    const firstPending = selectedRun.rows.findIndex((row) => row.status === 'PENDING');
    setGuidedIndex(firstPending >= 0 ? firstPending : 0);
    setDrafts(Object.fromEntries(selectedRun.rows.map((row) => [row.id, draftFromRow(row)])));
    setFilesByRow({});
    setShowAllRows(false);
    setShowFinalReview(false);
    setDirtyRowIds(new Set());
    setCompositeStepByRow({});
    setSaveNotice(null);
    setRunnerMenuOpen(false);
  }, [selectedRun?.id]);

  useEffect(() => {
    if (!previewTemplate) return;
    const rows = previewTemplate.rows.filter((row) => row.isActive !== false);
    setPreviewIndex(0);
    setPreviewDrafts(Object.fromEntries(rows.map((row) => [row.id, emptyRowDraft()])));
    setPreviewFilesByRow({});
  }, [previewTemplate?.id]);

  const activeRows = useMemo(() => selectedRun?.rows ?? [], [selectedRun]);
  const currentRow = activeRows[guidedIndex] ?? null;
  const currentDraft = currentRow ? drafts[currentRow.id] ?? draftFromRow(currentRow) : null;
  const currentFiles = currentRow ? filesByRow[currentRow.id] ?? [] : [];
  const currentRowHasCompositePhoto = isCompositePhotoChecklistRow(currentRow);
  const currentCompositeStep = currentRow ? compositeStepByRow[currentRow.id] ?? 0 : 0;
  const selectedRunHasActiveCheck = !selectedRun?.checks?.length || selectedRun.checks.some((check) => check.status === 'ACTIVE');
  const runIsEditable = selectedRun?.status === 'ACTIVE' && selectedRunHasActiveCheck;
  const runnerHasUnsavedChanges = dirtyRowIds.size > 0
    || Object.values(filesByRow).some((files) => files.length > 0);
  const requestCloseRunner = () => {
    if (runnerHasUnsavedChanges) {
      setRunnerDiscardOpen(true);
      return;
    }
    setSelectedRun(null);
  };
  useMobileFormDirty('checklist-runner', Boolean(selectedRun) && runnerHasUnsavedChanges);
  useMobileBackLayer(Boolean(selectedRun), requestCloseRunner, 700);
  useMobileBackLayer(showFinalReview, () => setShowFinalReview(false), 760);
  useMobileBackLayer(Boolean(selectedArchiveRunId), () => setSelectedArchiveRunId(null), 680);
  useMobileBackLayer(showArchiveFilters && !selectedArchiveRunId, () => setShowArchiveFilters(false), 650);
  useMobileBackLayer(Boolean(previewTemplate), () => setPreviewTemplate(null), 660);

  useEffect(() => {
    if (!selectedRun || !currentRow) return;
    const frame = window.requestAnimationFrame(() => {
      guidedRowRef.current?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedRun?.id, guidedIndex]);

  const selectedArchiveRun = useMemo(
    () => archiveJournal?.runs.find((run) => run.recordId === selectedArchiveRunId) ?? null,
    [archiveJournal, selectedArchiveRunId],
  );
  const selectedDetailOccurrence = useMemo(
    () => detailJournal?.runs.find((run) => run.recordId === detailOccurrenceId) ?? null,
    [detailJournal, detailOccurrenceId],
  );
  const previewRows = useMemo(
    () => previewTemplate?.rows.filter((row) => row.isActive !== false) ?? [],
    [previewTemplate],
  );
  const previewRow = previewRows[previewIndex] ?? null;
  const previewDraft = previewRow ? previewDrafts[previewRow.id] ?? emptyRowDraft() : null;
  const toggleTemplateExpanded = (templateId: string) => {
    setExpandedTemplateIds((current) => ({ ...current, [templateId]: !current[templateId] }));
  };

  const templateAvailabilityLabel = (template: ChecklistTemplate) => {
    if (template.archivedAt || template.isActive === false) return 'Отключён';
    if (template.availability?.currentRun?.status === 'CLOSED' || template.availability?.currentRun?.status === 'AUTO_CLOSED') return 'Выполнен в этой смене';
    if (template.availability?.alreadyTaken) return 'Уже взят в этой смене';
    if (template.availability?.reason) return 'Недоступен по смене';
    return 'Доступен для работы';
  };

  const templateStatusClass = (template: ChecklistTemplate) => {
    if (template.archivedAt || template.isActive === false) return 'pause';
    if (template.availability?.alreadyTaken) return 'work';
    if (template.availability?.reason) return 'pause';
    return template.isMandatory ? 'stop' : '';
  };

  const formatArchiveDate = (value?: string | null) => {
    if (!value) return 'Дата не указана';
    const date = new Date(value.includes('.') ? value.split('.').reverse().join('-') : value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('ru-RU');
  };

  const shiftFullLabel = (shift?: string | null) => {
    if (shift === 'DAY' || shift === 'День') return 'Дневная смена';
    if (shift === 'NIGHT' || shift === 'Ночь') return 'Ночная смена';
    return 'Смена не указана';
  };

  const departmentOptions = (() => {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const ordered = [...departments].sort((left, right) => {
      if (left.id === currentUser?.departmentId) return -1;
      if (right.id === currentUser?.departmentId) return 1;
      return left.name.localeCompare(right.name, 'ru');
    });
    const options = ordered.flatMap((department) => {
      const normalizedName = department.name.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
      if (!department.id || seenIds.has(department.id) || seenNames.has(normalizedName)) return [];
      seenIds.add(department.id);
      seenNames.add(normalizedName);
      return [{ label: department.name, value: department.id }];
    });
    if (currentUser?.departmentId && !seenIds.has(currentUser.departmentId)) {
      options.unshift({ label: 'Мой отдел', value: currentUser.departmentId });
    }
    return options;
  })();
  const userOptions = users.map((user) => ({ label: `${user.displayName}${user.departmentName ? ` · ${user.departmentName}` : ''}`, value: user.userId }));
  const templateOptions = templates.map((template) => ({ label: template.name, value: template.id }));
  const realLineOptions = hidePilotFixtures ? lines.filter((line) => !isDiagnosticLine(line)) : lines;
  const lineOptionsForTemplate = (template?: ChecklistTemplate) => {
    const options = [
      { label: 'Без привязки к линии', value: '' },
      ...realLineOptions.map((line) => ({
        label: line.status === 'WORK' ? `${line.name} · работает` : line.name,
        value: line.id,
      })),
    ];
    if (template?.lineId && !options.some((option) => option.value === template.lineId)) {
      options.push({ label: `${template.lineName ?? template.lineLabel ?? 'Ранее выбранная линия'} · архивная привязка`, value: template.lineId });
    }
    return options;
  };
  const shiftOptions = [
    { label: 'Любая смена', value: '' },
    { label: 'День', value: 'DAY' },
    { label: 'Ночь', value: 'NIGHT' },
  ];
  const roleOptions = [
    { label: 'Все роли отдела', value: '' },
    { label: 'Технологи', value: 'TECHNOLOG' },
    { label: 'ОКК', value: 'OKK' },
    { label: 'Мастера', value: 'MASTER' },
    { label: 'Склад', value: 'STORE' },
    { label: 'Работники', value: 'WORKER' },
    { label: 'КИПиА', value: 'TECH_KIPIA' },
    { label: 'Холодильная служба', value: 'TECH_HOLOD' },
  ];
  const frequencyOptions = [
    { label: 'Вручную по необходимости', value: 'MANUAL' },
    { label: 'Раз в смену', value: 'ONCE_PER_SHIFT' },
    { label: '2 раза за смену', value: 'TWICE_PER_SHIFT' },
    { label: 'По интервалу', value: 'EVERY_N_HOURS' },
    { label: 'Ежедневно', value: 'DAILY' },
    { label: 'Еженедельно', value: 'WEEKLY' },
    { label: 'При запуске линии', value: 'LINE_START' },
  ];
  const intervalUnitOptions = [
    { label: 'Минуты', value: 'MINUTES' },
    { label: 'Часы', value: 'HOURS' },
  ];

  const setDraft = (rowId: string, patch: Partial<RowDraft>) => {
    setDrafts((current) => ({ ...current, [rowId]: { ...(current[rowId] ?? {} as RowDraft), ...patch } }));
    setDirtyRowIds((current) => new Set(current).add(rowId));
    setErrorText(null);
    setSaveNotice('Есть несохранённые изменения');
  };

  const setRowFiles = (rowId: string, nextFiles: File[]) => {
    setFilesByRow((current) => ({ ...current, [rowId]: nextFiles }));
    setDirtyRowIds((current) => new Set(current).add(rowId));
    setSaveNotice(nextFiles.length ? 'Есть несохранённые изменения' : null);
  };

  const uploadFiles = async (entityType: string, entityId: string, files: File[]) => {
    const target = JSON.stringify([entityType, entityId]);
    const operationIds = files.map((file) => {
      let targets = rowUploadOperationsRef.current.get(file);
      if (!targets) {
        targets = new Map<string, string>();
        rowUploadOperationsRef.current.set(file, targets);
      }
      let operationId = targets.get(target);
      if (!operationId) {
        operationId = crypto.randomUUID();
        targets.set(target, operationId);
      }
      return operationId;
    });
    await uploadAttachments(entityType, entityId, files, { operationIds });
  };

  const rowNormText = (row: ChecklistTemplateRow | ChecklistRunRow) => {
    if (row.rowType !== 'NUMBER') return null;
    const parts = [
      row.minValue !== null && row.minValue !== undefined ? `от ${row.minValue}${row.unit ? ` ${row.unit}` : ''}` : '',
      row.maxValue !== null && row.maxValue !== undefined ? `до ${row.maxValue}${row.unit ? ` ${row.unit}` : ''}` : '',
    ].filter(Boolean);
    const range = parts.length ? `Допустимо: ${parts.join(' ')}.` : '';
    const target = row.targetValue !== null && row.targetValue !== undefined ? `Цель: ${row.targetValue}${row.unit ? ` ${row.unit}` : ''}.` : '';
    return [range, target].filter(Boolean).join(' ');
  };

  const validateDraft = (
    row: ChecklistRunRow,
    draft: RowDraft,
    pendingFiles: File[],
    options: { includePhoto?: boolean; includeComment?: boolean } = {},
  ) => {
    const type = row.rowType ?? 'LEGACY';
    const attachmentCount = (row.attachments?.length ?? 0) + pendingFiles.length;
    if (type === 'LEGACY' && !draft.status) return `Выберите результат по пункту «${row.title}».`;
    if (type === 'YES_NO' && row.requiredAnswer && draft.answerBoolean === null) return `Выберите “Да” или “Нет” по пункту «${row.title}».`;
    if (type === 'YES_NO_NA' && row.requiredAnswer && draft.answerBoolean === null && draft.selectedOption !== 'NA') return `Выберите “Да”, “Нет” или “Не применимо” по пункту «${row.title}».`;
    if ((type === 'TEXT' || type === 'REQUIRED_COMMENT') && row.requiredAnswer && !draft.answerText.trim()) return `Заполните текстовый ответ по пункту «${row.title}».`;
    if (type === 'NUMBER') {
      if (row.requiredAnswer && !draft.answerNumber.trim()) return `Заполните значение по пункту «${row.title}».`;
      if (draft.answerNumber.trim()) {
        const number = Number(draft.answerNumber);
        if (!Number.isFinite(number)) return `Значение по пункту «${row.title}» должно быть числом.`;
      }
    }
    if (type === 'SELECT' && row.requiredAnswer && !draft.selectedOption) return `Выберите вариант по пункту «${row.title}».`;
    if (options.includePhoto !== false && (type === 'REQUIRED_PHOTO' || row.requiresPhoto) && attachmentCount === 0) return `Добавьте фото: пункт «${row.title}» требует подтверждение фотографией.`;
    if (options.includeComment !== false && row.requiresComment && !draft.comment.trim() && type !== 'REQUIRED_COMMENT') return `Добавьте комментарий по пункту «${row.title}».`;
    return null;
  };

  const numericDeviation = (row: ChecklistRunRow | ChecklistTemplateRow, draft: RowDraft) => {
    if (row.rowType !== 'NUMBER' || !draft.answerNumber.trim()) return null;
    const value = Number(draft.answerNumber);
    if (!Number.isFinite(value)) return null;
    if (row.minValue !== null && row.minValue !== undefined && value < row.minValue) return 'Значение ниже нормы. Оно будет сохранено как отклонение.';
    if (row.maxValue !== null && row.maxValue !== undefined && value > row.maxValue) return 'Значение выше нормы. Оно будет сохранено как отклонение.';
    return null;
  };

  const refreshRun = async (id: string) => {
    const run = await apiClient.get<ChecklistRun>(`/checklists/runs/${id}`);
    setSelectedRun(run);
    setRuns((current) => current.map((item) => (item.id === id ? run : item)));
    setDrafts(Object.fromEntries(run.rows.map((row) => [row.id, draftFromRow(row)])));
    return run;
  };

  const rowPayload = (row: ChecklistRunRow, draft: RowDraft) => {
    const type = row.rowType ?? 'LEGACY';
    if (type === 'LEGACY') return { status: draft.status || 'OK', comment: draft.comment };
    if (type === 'YES_NO') return { answerBoolean: draft.answerBoolean, comment: draft.comment };
    if (type === 'YES_NO_NA') return { answerBoolean: draft.answerBoolean, selectedOption: draft.selectedOption, comment: draft.comment };
    if (type === 'NUMBER') return { answerNumber: draft.answerNumber, comment: draft.comment };
    if (type === 'SELECT') return { selectedOption: draft.selectedOption, comment: draft.comment };
    if (type === 'TEXT' || type === 'REQUIRED_COMMENT') return { answerText: draft.answerText, comment: draft.comment || draft.answerText };
    return { status: draft.status || 'OK', comment: draft.comment };
  };

  const saveCurrentRow = async () => {
    if (!selectedRun || !currentRow || !currentDraft) return;
    const validationError = validateDraft(currentRow, currentDraft, currentFiles);
    if (validationError) {
      setErrorText(validationError);
      setSaveNotice('Есть несохранённые изменения');
      throw new Error(validationError);
    }
    setLoading(true);
    setErrorText(null);
    setSaveNotice('Сохраняется...');
    try {
      if (!networkOnline) throw new Error('Нет связи с сервером. Действие не сохранено.');
      const payload = { ...rowPayload(currentRow, currentDraft), checkId: selectedRun.currentCheck?.id ?? null };
      const input = JSON.stringify([selectedRun.id, currentRow.id, payload]);
      if (rowCompletionOperationRef.current?.input !== input) {
        rowCompletionOperationRef.current = { input, operationId: crypto.randomUUID() };
      }
      await uploadFiles(currentRow.entryId ? 'CHECKLIST_ENTRY' : 'CHECKLIST_RUN_ROW', currentRow.entryId ?? currentRow.id, currentFiles);
      await apiClient.request(`/checklists/runs/${selectedRun.id}/rows/${currentRow.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          operationId: rowCompletionOperationRef.current.operationId,
        }),
      });
      setFilesByRow((current) => ({ ...current, [currentRow.id]: [] }));
      setSaveNotice('Сохранено');
      setDirtyRowIds((current) => {
        const next = new Set(current);
        next.delete(currentRow.id);
        return next;
      });
      return await refreshRun(selectedRun.id);
    } catch (error) {
      const message = !networkOnline || error instanceof ApiNetworkError
        ? 'Нет связи. Ответ не сохранён.'
        : error instanceof Error
          ? error.message
          : 'Не удалось сохранить пункт чек-листа.';
      setSaveNotice(message);
      setErrorText(message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const goNext = async () => {
    if (!selectedRun || !currentRow) return;
    if (runIsEditable && currentRowHasCompositePhoto && currentCompositeStep === 0 && currentDraft) {
      const validationError = validateDraft(currentRow, currentDraft, currentFiles, { includePhoto: false, includeComment: false });
      if (validationError) {
        setErrorText(validationError);
        return;
      }
      setErrorText(null);
      setCompositeStepByRow((current) => ({ ...current, [currentRow.id]: 1 }));
      return;
    }
    if (runIsEditable && (currentRow.status === 'PENDING' || dirtyRowIds.has(currentRow.id))) {
      try { await saveCurrentRow(); }
      catch { return; } // saveCurrentRow already presents the error and keeps the draft.
    }
    if (guidedIndex < activeRows.length - 1) setGuidedIndex((current) => current + 1);
  };

  const goToRow = async (index: number) => {
    if (!selectedRun || !currentRow || index === guidedIndex) return;
    if (dirtyRowIds.has(currentRow.id) && !(currentRowHasCompositePhoto && currentCompositeStep === 0)) {
      try {
        await saveCurrentRow();
      } catch {
        return;
      }
    }
    setGuidedIndex(index);
  };

  const finishRun = async () => {
    if (!selectedRun) return;
    if (currentRow && currentRowHasCompositePhoto && currentCompositeStep === 0) {
      await goNext();
      return;
    }
    try {
      if (currentRow && runIsEditable && (currentRow.status === 'PENDING' || dirtyRowIds.has(currentRow.id))) await saveCurrentRow();
      await refreshRun(selectedRun.id);
      setShowFinalReview(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось проверить результат. Повторите попытку.');
    }
  };

  const retryCurrentRow = async () => {
    try { await saveCurrentRow(); }
    catch { /* Error and unchanged draft are already visible in the runner. */ }
  };

  const completeCurrentPeriodicCheck = async () => {
    if (!selectedRun?.currentCheck?.id) {
      setErrorText('Текущая проверка не найдена. Обновите чек-лист.');
      return;
    }
    const checkId = selectedRun.currentCheck.id;
    if (checkCompletionOperationRef.current?.checkId !== checkId) {
      checkCompletionOperationRef.current = { checkId, operationId: crypto.randomUUID() };
    }
    setLoading(true);
    setErrorText(null);
    try {
      const updated = await apiClient.post<ChecklistRun>(`/checklists/runs/${selectedRun.id}/checks/current/complete`, {
        checkId,
        operationId: checkCompletionOperationRef.current.operationId,
      });
      checkCompletionOperationRef.current = null;
      setShowFinalReview(false);
      setSelectedRun(null);
      setCompletionNotice(`Проверка выполнена. Следующая проверка: ${nextCheckText(updated)}.`);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось завершить текущую проверку.');
    } finally {
      setLoading(false);
    }
  };

  const templateBuilderFormValues = (template?: ChecklistTemplate, mode: TemplateBuilderState['mode'] = 'create') => ({
    name: template ? mode === 'duplicate' ? `${template.name} — копия` : template.name : '',
    description: template?.description ?? '',
    departmentId: template?.departmentId ?? currentUser?.departmentId ?? '',
    scope: template?.scope === 'LINE' || template?.lineId ? 'LINE' : 'DEPARTMENT',
    lineId: template?.lineId ?? '',
    assignmentRole: firstAssignmentRole(template),
    shiftType: template?.shiftType ?? '',
    frequencyRule: template?.frequencyRule ?? 'MANUAL',
    frequencyIntervalUnit: template?.frequencyIntervalUnit ?? 'HOURS',
    frequencyIntervalValue: template?.frequencyIntervalValue !== null && template?.frequencyIntervalValue !== undefined
      ? String(template.frequencyIntervalValue)
      : template?.frequencyHours !== null && template?.frequencyHours !== undefined
        ? String(template.frequencyHours)
        : '',
    isMandatory: template?.isMandatory ?? false,
    isActive: mode === 'duplicate' ? true : template?.isActive ?? true,
    reason: '',
  });

  const templatePayloadFromValues = (values: Record<string, string | boolean>, fallbackDepartmentId?: string | null) => {
    const frequencyRule = String(values.frequencyRule || 'MANUAL');
    const intervalUnit = String(values.frequencyIntervalUnit || 'HOURS');
    const intervalValue = values.frequencyIntervalValue ? Number(values.frequencyIntervalValue) : null;
    const scope = String(values.scope || (values.lineId ? 'LINE' : 'DEPARTMENT'));
    return {
      name: values.name,
      description: values.description,
      departmentId: values.departmentId || fallbackDepartmentId,
      scope,
      lineId: scope === 'LINE' ? values.lineId || null : null,
      assignmentRoles: values.assignmentRole ? [values.assignmentRole] : [],
      shiftType: values.shiftType || null,
      frequencyRule,
      frequencyIntervalUnit: frequencyRule === 'EVERY_N_HOURS' ? intervalUnit : null,
      frequencyIntervalValue: frequencyRule === 'EVERY_N_HOURS' ? intervalValue : null,
      frequencyHours: frequencyRule === 'EVERY_N_HOURS' && intervalUnit === 'HOURS' && intervalValue ? intervalValue : null,
      isMandatory: Boolean(values.isMandatory),
      isActive: values.isActive !== false,
    };
  };

  const rowBodyFromDraft = (draft: ChecklistItemDraft) => ({
    ...(draft.id ? { id: draft.id } : {}),
    title: draft.title.trim(),
    description: draft.description.trim(),
    sortOrder: draft.sortOrder,
    rowType: draft.rowType || 'YES_NO',
    requiredAnswer: draft.requiredAnswer,
    requiresPhoto: draft.rowType === 'REQUIRED_PHOTO' ? true : draft.requiresPhoto,
    requiresComment: draft.rowType === 'REQUIRED_COMMENT' ? true : draft.requiresComment,
    isRequired: draft.isRequired,
    isActive: draft.isActive,
    unit: draft.unit,
    minValue: draft.minValue,
    maxValue: draft.maxValue,
    targetValue: draft.targetValue,
    optionsText: draft.optionsText,
  });

  const validateItemDraft = (draft: ChecklistItemDraft) => {
    if (!draft.title.trim()) return 'Укажите название пункта.';
    if (draft.rowType === 'SELECT' && !draft.optionsText.split(/\r?\n|,/).some((option) => option.trim())) {
      return 'Добавьте хотя бы один вариант выбора.';
    }
    const min = draft.minValue === '' ? null : Number(draft.minValue);
    const max = draft.maxValue === '' ? null : Number(draft.maxValue);
    if (draft.rowType === 'NUMBER' && ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)))) {
      return 'Минимум и максимум должны быть числами.';
    }
    if (min !== null && max !== null && min > max) return 'Минимум не может быть больше максимума.';
    return null;
  };

  const openRowEditor = (template: ChecklistTemplate, row?: ChecklistTemplateRow) => {
    const draft = itemDraftFromRow(row, (template.rows.length + 1) * 10);
    setStandaloneRowDraft(draft);
    setModal(row
      ? { mode: 'edit-row', title: 'Редактировать пункт', template, templateRow: row }
      : { mode: 'create-row', title: 'Добавить пункт', template });
  };

  const openTemplateBuilder = (mode: TemplateBuilderState['mode'], source?: ChecklistTemplate) => {
    const formTemplate = source
      ? { ...source, name: mode === 'duplicate' ? `${source.name} — копия` : source.name, isActive: mode === 'duplicate' ? true : source.isActive }
      : undefined;
    const rows = source?.rows.filter((row) => mode !== 'duplicate' || row.isActive).map((row, index) => ({
      ...itemDraftFromRow(row, (index + 1) * 10),
      id: mode === 'duplicate' ? undefined : row.id,
      referencePhoto: mode === 'duplicate' ? null : row.referencePhoto,
      clientKey: mode === 'duplicate' ? `checklist-copy-${Date.now()}-${index}` : row.id,
      sortOrder: (index + 1) * 10,
    })) ?? [];
    const formValues = templateBuilderFormValues(source, mode);
    setErrorText(null);
    setTemplateBuilder({
      mode,
      source,
      formTemplate,
      formValues,
      initialFormValues: { ...formValues },
      rows,
      initialRows: rows.map((row) => ({ ...row })),
      editorIndex: null,
      editorDraft: null,
      editorInitialDraft: null,
    });
  };

  const setTemplateBuilderValue = (name: string, value: string | boolean) => {
    setTemplateBuilder((current) => current ? {
      ...current,
      formValues: {
        ...current.formValues,
        [name]: value,
        ...(name === 'scope' && value !== 'LINE' ? { lineId: '' } : {}),
      },
    } : current);
    setErrorText(null);
  };

  const updateBuilderEditor = (draft: ChecklistItemDraft) => {
    setTemplateBuilder((current) => current ? { ...current, editorDraft: draft } : current);
    setErrorText(null);
  };

  const commitBuilderEditor = () => {
    if (!templateBuilder?.editorDraft) return;
    const validationError = validateItemDraft(templateBuilder.editorDraft);
    if (validationError) {
      setErrorText(validationError);
      return;
    }
    const nextRows = [...templateBuilder.rows];
    const normalizedDraft = { ...templateBuilder.editorDraft };
    if (templateBuilder.editorIndex !== null && templateBuilder.editorIndex >= 0) nextRows[templateBuilder.editorIndex] = normalizedDraft;
    else nextRows.push(normalizedDraft);
    const orderedRows = nextRows.map((row, index) => ({ ...row, sortOrder: (index + 1) * 10 }));
    setTemplateBuilder({ ...templateBuilder, rows: orderedRows, editorIndex: null, editorDraft: null, editorInitialDraft: null });
    setErrorText(null);
  };

  const editBuilderRow = (index: number) => {
    if (!templateBuilder) return;
    const draft = { ...templateBuilder.rows[index] };
    setTemplateBuilder({ ...templateBuilder, editorIndex: index, editorDraft: draft, editorInitialDraft: { ...draft } });
    setErrorText(null);
  };

  const addBuilderRow = () => {
    if (!templateBuilder) return;
    const draft = itemDraftFromRow(undefined, (templateBuilder.rows.length + 1) * 10);
    setTemplateBuilder({
      ...templateBuilder,
      editorIndex: -1,
      editorDraft: draft,
      editorInitialDraft: { ...draft },
    });
    setErrorText(null);
  };

  const moveBuilderRow = (index: number, direction: -1 | 1) => {
    if (!templateBuilder) return;
    const target = index + direction;
    if (target < 0 || target >= templateBuilder.rows.length) return;
    const rows = [...templateBuilder.rows];
    [rows[index], rows[target]] = [rows[target], rows[index]];
    setTemplateBuilder({ ...templateBuilder, rows: rows.map((row, rowIndex) => ({ ...row, sortOrder: (rowIndex + 1) * 10 })) });
  };

  const duplicateBuilderRow = (index: number) => {
    if (!templateBuilder) return;
    const source = templateBuilder.rows[index];
    checklistItemSequence += 1;
    const copy = duplicateChecklistItem(source, `checklist-item-copy-${Date.now()}-${checklistItemSequence}`, (index + 2) * 10);
    const rows = [...templateBuilder.rows];
    rows.splice(index + 1, 0, copy);
    setTemplateBuilder({
      ...templateBuilder,
      rows: rows.map((row, rowIndex) => ({ ...row, sortOrder: (rowIndex + 1) * 10 })),
    });
  };

  const toggleBuilderRow = (index: number) => {
    if (!templateBuilder) return;
    setTemplateBuilder({
      ...templateBuilder,
      rows: templateBuilder.rows.map((row, rowIndex) => rowIndex === index ? setChecklistItemActive(row, !row.isActive) : row),
    });
  };

  const openTemplateBuilderPreview = () => {
    if (!templateBuilder) return;
    const values = templateBuilder.formValues;
    const scope = values.scope === 'LINE' ? 'LINE' : 'DEPARTMENT';
    const department = departments.find((item) => item.id === values.departmentId);
    const line = scope === 'LINE' ? lines.find((item) => item.id === values.lineId) : null;
    const intervalValue = Number(values.frequencyIntervalValue);
    const intervalUnit = values.frequencyIntervalUnit === 'MINUTES' ? 'мин' : 'ч';
    const frequencyLabel = values.frequencyRule === 'EVERY_N_HOURS'
      ? `Каждые ${Number.isFinite(intervalValue) && intervalValue > 0 ? intervalValue : '—'} ${intervalUnit}`
      : frequencyOptions.find((option) => option.value === values.frequencyRule)?.label ?? 'По необходимости';
    const rows: ChecklistTemplateRow[] = templateBuilder.rows
      .filter((row) => row.isActive)
      .map((row, index) => ({
        id: row.id ?? row.clientKey,
        title: row.title,
        description: row.description || null,
        sortOrder: (index + 1) * 10,
        rowType: row.rowType,
        requiredAnswer: row.requiredAnswer,
        requiresPhoto: row.rowType === 'REQUIRED_PHOTO' ? true : row.requiresPhoto,
        requiresComment: row.rowType === 'REQUIRED_COMMENT' ? true : row.requiresComment,
        isRequired: row.isRequired,
        unit: row.unit || null,
        minValue: row.minValue === '' ? null : Number(row.minValue),
        maxValue: row.maxValue === '' ? null : Number(row.maxValue),
        targetValue: row.targetValue === '' ? null : Number(row.targetValue),
        optionsJson: row.optionsText.split(/\r?\n|,/).map((option) => option.trim()).filter(Boolean),
        isActive: true,
      }));
    setPreviewTemplate({
      id: `checklist-builder-preview-${Date.now()}`,
      scope,
      departmentId: String(values.departmentId || ''),
      departmentName: department?.name ?? 'Выбранный отдел',
      departmentLabel: department?.name ?? 'Выбранный отдел',
      lineId: line?.id ?? null,
      lineName: line?.name ?? null,
      lineLabel: line ? `Линия: ${line.name}` : 'Общий для отдела',
      name: String(values.name || 'Новый чек-лист'),
      description: String(values.description || ''),
      assignmentRoles: values.assignmentRole ? [String(values.assignmentRole)] : [],
      shiftType: values.shiftType === 'DAY' || values.shiftType === 'NIGHT' ? values.shiftType : null,
      frequencyRule: String(values.frequencyRule || 'MANUAL'),
      frequencyIntervalUnit: String(values.frequencyIntervalUnit || 'HOURS'),
      frequencyIntervalValue: Number.isFinite(intervalValue) ? intervalValue : null,
      frequencyLabel,
      isMandatory: Boolean(values.isMandatory),
      isActive: Boolean(values.isActive),
      rows,
    });
  };

  const saveRowReference = async (templateId: string, rowId: string, draft: ChecklistItemDraft) => {
    if (!draft.isActive) return;
    if (draft.referenceFile) {
      await uploadAttachments('CHECKLIST_TEMPLATE_ROW', rowId, [draft.referenceFile], { operationIds: draft.referenceOperationId ? [draft.referenceOperationId] : undefined });
    } else if (draft.removeReference) {
      await apiClient.request(`/checklists/templates/${templateId}/rows/${rowId}/reference`, { method: 'DELETE' });
    }
  };

  const submitTemplateBuilder = async () => {
    if (!templateBuilder) return;
    const values = templateBuilder.formValues;
    if (!String(values.name ?? '').trim()) {
      setErrorText('Укажите название шаблона.');
      return;
    }
    if (!String(values.departmentId ?? '').trim()) {
      setErrorText('Выберите отдел или службу.');
      return;
    }
    if (values.scope === 'LINE' && !String(values.lineId ?? '').trim()) {
      setErrorText('Выберите линию или переключите область на “Общий для отдела”.');
      return;
    }
    if (values.frequencyRule === 'EVERY_N_HOURS') {
      const intervalValue = Number(values.frequencyIntervalValue);
      if (!Number.isFinite(intervalValue) || intervalValue <= 0) {
        setErrorText('Укажите положительный интервал проверки.');
        return;
      }
    }
    let rows = [...templateBuilder.rows];
    if (templateBuilder.editorDraft?.title.trim()) {
      const validationError = validateItemDraft(templateBuilder.editorDraft);
      if (validationError) {
        setErrorText(validationError);
        return;
      }
      if (templateBuilder.editorIndex !== null && templateBuilder.editorIndex >= 0) rows[templateBuilder.editorIndex] = templateBuilder.editorDraft;
      else rows.push(templateBuilder.editorDraft);
    }
    rows = rows.map((row, index) => ({ ...row, sortOrder: (index + 1) * 10 }));
    if (!rows.some((row) => row.isActive)) {
      setErrorText('Добавьте хотя бы один активный пункт чек-листа.');
      return;
    }
    const payload = {
      ...templatePayloadFromValues(values, templateBuilder.source?.departmentId ?? currentUser?.departmentId),
      rows: rows.map(rowBodyFromDraft),
    };
    setLoading(true);
    setErrorText(null);
    try {
      const saved = templateBuilder.mode === 'create'
        ? await apiClient.post<ChecklistTemplate>('/checklists/templates', payload)
        : templateBuilder.mode === 'duplicate' && templateBuilder.source
          ? await apiClient.post<ChecklistTemplate>(`/checklists/templates/${templateBuilder.source.id}/duplicate`, payload)
          : await apiClient.patch<ChecklistTemplate>(`/checklists/templates/${templateBuilder.source!.id}`, { ...payload, reason: values.reason });
      const savedRows = rows.map((draft) => {
        const row = saved.rows.find((item) => draft.id ? item.id === draft.id : item.sortOrder === draft.sortOrder && item.title === draft.title && item.isActive === draft.isActive);
        if (!row) throw new Error('Пункт сохранён, но не найден в ответе сервера. Откройте шаблон заново.');
        return { ...draft, id: row.id };
      });
      // If a file fails, retry edits the already saved template/rows, not a duplicate.
      setTemplateBuilder({ ...templateBuilder, mode: 'edit', source: saved, rows: savedRows, editorDraft: null, editorIndex: null, editorInitialDraft: null });
      for (const row of savedRows) await saveRowReference(saved.id, row.id!, row);
      setTemplateBuilder(null);
      await load();
      setTab('library');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Шаблон не сохранён.');
    } finally {
      setLoading(false);
    }
  };

  const requestSubmitTemplateBuilder = () => {
    if (!templateBuilder) return;
    if (templateBuilder.mode === 'edit' && templateBuilder.source?.isActive !== false && !templateBuilder.source?.archivedAt) {
      setBuilderPublishConfirmOpen(true);
      return;
    }
    void submitTemplateBuilder();
  };

  const templateBuilderDirty = Boolean(templateBuilder && (
    JSON.stringify(templateBuilder.formValues) !== JSON.stringify(templateBuilder.initialFormValues)
    || JSON.stringify(templateBuilder.rows) !== JSON.stringify(templateBuilder.initialRows)
    || (templateBuilder.editorDraft
      && JSON.stringify(templateBuilder.editorDraft) !== JSON.stringify(templateBuilder.editorInitialDraft))
  ));

  const requestCloseTemplateBuilder = () => {
    if (templateBuilderDirty) {
      setBuilderDiscardOpen(true);
      return;
    }
    setTemplateBuilder(null);
    setErrorText(null);
  };

  useMobileFormDirty('checklist-template-builder', templateBuilderDirty);

  const submitModal = async (values: Record<string, string | boolean>) => {
    if (!modal) return;
    setLoading(true);
    setErrorText(null);
    try {
      if (modal.mode === 'start') {
        const run = await apiClient.post<ChecklistRun>('/checklists/runs/start', { templateId: modal.template.id, lineId: modal.template.lineId || undefined });
        setSelectedRun(run);
        setTab('my');
      }
      if (modal.mode === 'pause') {
        await apiClient.post(`/checklists/runs/${modal.run.id}/pause`, { reason: values.reason });
        await refreshRun(modal.run.id);
      }
      if (modal.mode === 'resume') {
        await apiClient.post(`/checklists/runs/${modal.run.id}/resume`, {});
        await refreshRun(modal.run.id);
      }
      if (modal.mode === 'close') {
        await apiClient.post(`/checklists/runs/${modal.run.id}/close`, { comment: values.comment });
        setSelectedRun(null);
      }
      if (modal.mode === 'create-template') {
        await apiClient.post('/checklists/templates', {
          ...templatePayloadFromValues(values, currentUser?.departmentId),
        });
      }
      if (modal.mode === 'edit-template') {
        await apiClient.patch(`/checklists/templates/${modal.template.id}`, {
          ...templatePayloadFromValues(values, modal.template.departmentId),
          reason: values.reason,
        });
      }
      if (modal.mode === 'create-row') {
        if (!standaloneRowDraft) throw new Error('Пункт не заполнен.');
        const validationError = validateItemDraft(standaloneRowDraft);
        if (validationError) throw new Error(validationError);
        const saved = await apiClient.post<ChecklistTemplateRow>(`/checklists/templates/${modal.template.id}/rows`, rowBodyFromDraft(standaloneRowDraft));
        setModal({ ...modal, mode: 'edit-row', templateRow: saved, title: 'Изменить пункт' });
        setStandaloneRowDraft({ ...standaloneRowDraft, id: saved.id });
        await saveRowReference(modal.template.id, saved.id, standaloneRowDraft);
      }
      if (modal.mode === 'edit-row') {
        if (!standaloneRowDraft) throw new Error('Пункт не заполнен.');
        const validationError = validateItemDraft(standaloneRowDraft);
        if (validationError) throw new Error(validationError);
        await apiClient.patch(`/checklists/templates/${modal.template.id}/rows/${modal.templateRow.id}`, rowBodyFromDraft(standaloneRowDraft));
        await saveRowReference(modal.template.id, modal.templateRow.id, standaloneRowDraft);
      }
      if (modal.mode === 'archive-row') {
        await apiClient.patch(`/checklists/templates/${modal.template.id}/rows/${modal.templateRow.id}`, { isActive: false });
      }
      if (modal.mode === 'archive-template') {
        await apiClient.post(`/checklists/templates/${modal.template.id}/archive`, {});
      }
      if (modal.mode === 'restore-template') {
        await apiClient.post(`/checklists/templates/${modal.template.id}/restore`, {});
      }
      setFilesByRow({});
      setStandaloneRowDraft(null);
      setModal(null);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Действие не выполнено.');
    } finally {
      setLoading(false);
    }
  };

  const moveRow = async (template: ChecklistTemplate, row: ChecklistTemplateRow, direction: -1 | 1) => {
    await apiClient.patch(`/checklists/templates/${template.id}/rows/${row.id}`, { sortOrder: Math.max(0, row.sortOrder + direction * 10) });
    await load();
  };

  const updateArchiveFilter = (key: keyof ArchiveFilters, value: string) => {
    setArchiveFilters((current) => ({ ...current, [key]: value }));
  };

  const applyArchiveFilters = async () => {
    await loadArchive(archiveFilters);
  };

  const downloadFile = async (url: string) => {
    const { blob, filename } = await apiClient.downloadBlob(url);
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

  const archiveParams = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    Object.entries({ ...archiveFilters, ...extra }).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params;
  };

  const exportArchiveExcel = async () => {
    if (!archiveJournal?.template?.id) {
      setErrorText('Выберите шаблон, чтобы выгрузить Excel.');
      return;
    }
    setErrorText(null);
    try {
      const params = archiveParams();
      await downloadFile(`/checklists/archive/template/${archiveJournal.template.id}/export.xlsx${params.toString() ? `?${params.toString()}` : ''}`);
      setSaveNotice('Excel сформирован');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сформировать Excel.');
    }
  };

  const downloadRunPdf = async (runId: string) => {
    setErrorText(null);
    try {
      await downloadFile(`/checklists/runs/${runId}/report.pdf`);
      setSaveNotice('PDF сформирован');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сформировать PDF.');
    }
  };

  const loadShiftReport = async () => {
    const shiftDate = archiveFilters.dateFrom || factoryDateKey();
    const shiftType = archiveFilters.shiftType === 'NIGHT' ? 'NIGHT' : 'DAY';
    const params = archiveParams({ shiftDate, shiftType });
    setReportLoading(true);
    setErrorText(null);
    try {
      const report = await apiClient.get<ChecklistShiftReport>(`/checklists/reports/shift?${params.toString()}`);
      setShiftReport(report);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить сводку по смене.');
    } finally {
      setReportLoading(false);
    }
  };

  const downloadShiftReportPdf = async () => {
    const shiftDate = archiveFilters.dateFrom || shiftReport?.shiftDate || factoryDateKey();
    const shiftType = archiveFilters.shiftType === 'NIGHT' ? 'NIGHT' : shiftReport?.shiftType ?? 'DAY';
    const params = archiveParams({ shiftDate, shiftType });
    setErrorText(null);
    try {
      await downloadFile(`/checklists/reports/shift.pdf?${params.toString()}`);
      setSaveNotice('PDF смены сформирован');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось сформировать PDF смены.');
    }
  };

  const openTemplateArchive = async (template: ChecklistTemplate) => {
    const filters = { ...archiveFilters, templateId: template.id };
    setTab('archive');
    setArchiveMode('journal');
    setArchiveFilters(filters);
    setSelectedArchiveRunId(null);
    setShowArchiveFilters(true);
    await loadArchive(filters);
  };

  const closeChecklistDetail = () => {
    setChecklistDetail(null);
    setDetailJournal(null);
    setDetailOccurrenceId(null);
  };

  const openChecklistDetail = async (target: ChecklistDetailTarget) => {
    const templateId = target.kind === 'template' ? target.template.id : target.run.template?.id;
    setChecklistDetail(target);
    setDetailJournal(null);
    setDetailOccurrenceId(null);
    if (!templateId || !canArchive) return;
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '5', includeActiveOccurrences: 'true' });
      if (!hidePilotFixtures) params.set('includeDiagnostics', 'true');
      const journal = await apiClient.get<ArchiveJournal>(`/checklists/archive/template/${templateId}/journal?${params.toString()}`);
      setDetailJournal(journal);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить историю чек-листа.');
    } finally {
      setDetailLoading(false);
    }
  };

  const archiveStatusClass = (status: string) => {
    if (status === 'warning') return 'stop';
    if (status === 'missing') return 'pause';
    return 'work';
  };

  const runProgress = (run: ChecklistRun) => {
    const total = run.rows.length;
    const done = run.rows.filter((row) => row.status !== 'PENDING').length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
  };

  const isPeriodicChecklistRun = (run: ChecklistRun) => {
    const rule = String(run.frequencyRule ?? '').toUpperCase();
    const label = run.frequencyLabel?.toLowerCase() ?? '';
    return ['EVERY_N_HOURS', 'TWICE_PER_SHIFT'].includes(rule)
      || Boolean(run.frequencyIntervalValue)
      || label.includes('кажд')
      || label.startsWith('2 раза');
  };
  const serverNowMs = clockNowMs + serverClockOffsetMs;
  const activeRunCheck = (run: ChecklistRun) => (run.checks ?? []).find((check) => check.status === 'ACTIVE') ?? null;
  const formatCountdown = (milliseconds: number) => {
    const seconds = Math.max(0, Math.ceil(Math.abs(milliseconds) / 1_000));
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const restSeconds = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
  };
  const periodicTiming = (run: ChecklistRun) => {
    const check = activeRunCheck(run);
    if (!check) return { phase: 'waiting-end' as const, dueAt: null, remainingMs: null };
    const dueAt = check.dueAt ?? run.nextCheckAt ?? null;
    if (!dueAt) return { phase: 'due' as const, dueAt: null, remainingMs: 0 };
    const dueAtMs = new Date(dueAt).getTime();
    if (!Number.isFinite(dueAtMs)) return { phase: 'due' as const, dueAt: null, remainingMs: 0 };
    const remainingMs = dueAtMs - serverNowMs;
    if (remainingMs > 0) return { phase: 'upcoming' as const, dueAt, remainingMs };
    if (remainingMs > -2 * 60_000) return { phase: 'due' as const, dueAt, remainingMs };
    return { phase: 'overdue' as const, dueAt, remainingMs };
  };
  const completedChecksCount = (run: ChecklistRun) => (run.checks ?? []).filter((check) => check.status === 'COMPLETED').length;
  const nextCheckText = (run: ChecklistRun) => {
    if (run.status === 'CLOSED' || run.status === 'AUTO_CLOSED') return displayLabel(checklistRunStatusLabels, run.status);
    if (isPeriodicChecklistRun(run)) {
      const timing = periodicTiming(run);
      if (timing.phase === 'waiting-end') return 'До конца смены';
      if (timing.phase === 'upcoming' && timing.remainingMs !== null) return formatCountdown(timing.remainingMs);
      if (timing.phase === 'due') return 'Пора';
      if (timing.phase === 'overdue') return `Просрочен · ${formatCountdown(timing.remainingMs ?? 0)}`;
    }
    return run.status === 'PAUSED' ? 'На паузе' : 'В работе';
  };
  const isOverdueRun = (run: ChecklistRun) => run.status === 'ACTIVE' && isPeriodicChecklistRun(run) && periodicTiming(run).phase === 'overdue';
  const sortedRuns = useMemo(() => [...runs].sort((left, right) => {
    const priority = (run: ChecklistRun) => {
      if (run.status === 'PAUSED') return 4;
      if (!isPeriodicChecklistRun(run)) return 2;
      const phase = periodicTiming(run).phase;
      if (phase === 'overdue' || phase === 'due') return 0;
      if (phase === 'upcoming') return 1;
      return 3;
    };
    const dueTime = (run: ChecklistRun) => {
      const timing = isPeriodicChecklistRun(run) ? periodicTiming(run) : null;
      const value = timing?.dueAt ?? run.nextCheckAt;
      const parsed = value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
      return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };
    const name = (run: ChecklistRun) => run.template?.name ?? 'Чек-лист';
    return priority(left) - priority(right)
      || dueTime(left) - dueTime(right)
      || name(left).localeCompare(name(right), 'ru')
      || left.id.localeCompare(right.id);
  }), [runs, serverNowMs]);
  const finalReviewRows = selectedRun?.rows ?? [];
  const finalReviewMissing = finalReviewRows.filter((row) => row.isRequired && row.status === 'PENDING');
  const runContextMeta = (run: ChecklistRun) => [
    `Отдел: ${run.departmentLabel || run.departmentName || 'мой отдел'}`,
    run.lineLabel || (run.lineName ? `Линия: ${run.lineName}` : 'Без привязки к линии'),
    run.shiftLabel ? `Смена: ${run.shiftLabel}` : 'Смена не указана',
    `Исполнитель: ${run.executorName ?? 'вы'}`,
  ];

  const workStatus = (run: ChecklistRun) => {
    if (run.status === 'PAUSED') return { label: 'На паузе', className: 'pause' };
    if (isPeriodicChecklistRun(run)) {
      const timing = periodicTiming(run);
      if (timing.phase === 'overdue') return { label: 'Просрочено', className: 'stop' };
      if (timing.phase === 'due') return { label: 'Пора выполнить', className: 'pause' };
      if (timing.phase === 'upcoming') return { label: 'По плану', className: 'work' };
      if (timing.phase === 'waiting-end') return { label: 'Проверки выполнены', className: 'work' };
    }
    return { label: 'Выполняется', className: 'work' };
  };
  const templateContextMeta = (template: ChecklistTemplate) => [
    `Отдел: ${template.departmentLabel || template.departmentName || 'мой отдел'}`,
    template.lineLabel || (template.lineName ? `Линия: ${template.lineName}` : 'Без привязки к линии'),
    template.shiftLabel ? `Смена: ${template.shiftLabel}` : 'Любая смена',
  ];

  const renderRunCard = (run: ChecklistRun) => (
    <button className="checklist-run-card" key={run.id} onClick={() => {
      setShowArchiveFilters(false);
      setSelectedRun(run);
    }} type="button">
      <div className="checklist-run-card-main">
        <div>
          <strong>{run.template?.name ?? 'Чек-лист'}</strong>
          <span>{[dateTime(run.startedAt), run.shiftLabel, run.lineName ? `Линия: ${run.lineName}` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <span className={`status-badge ${run.status === 'PAUSED' ? 'pause' : run.status === 'ACTIVE' ? 'work' : ''}`}>
          {displayLabel(checklistRunStatusLabels, run.status)}
        </span>
      </div>
      <div className="checklist-run-progress">
        <span>{runProgress(run).done} из {runProgress(run).total || 0} пунктов</span>
        <div className="guided-progress-bar"><span style={{ width: `${runProgress(run).percent}%` }} /></div>
      </div>
      <span className="checklist-run-action">Открыть прохождение</span>
    </button>
  );

  const renderWorkRunCard = (run: ChecklistRun) => {
    const periodic = isPeriodicChecklistRun(run);
    const timing = periodic ? periodicTiming(run) : null;
    const overdue = isOverdueRun(run);
    const progress = runProgress(run);
    const primaryLabel = run.status === 'PAUSED'
      ? 'Возобновить'
      : !periodic || progress.done > 0
        ? 'Продолжить'
        : timing?.phase === 'due' || timing?.phase === 'overdue'
          ? 'Заполнить'
          : null;
    const compactMeta = [
      run.lineName || run.departmentLabel || run.departmentName || 'Мой отдел',
      `${run.rows.length} ${run.rows.length === 1 ? 'пункт' : run.rows.length < 5 ? 'пункта' : 'пунктов'}`,
    ].join(' · ');
    return (
      <article className={`panel-card checklist-work-card checklist-compact-run active ${overdue ? 'overdue' : ''}`} data-checklist-run-id={run.id} key={run.id}>
        <div className="checklist-compact-main">
          <div>
            <strong className="checklist-card-title">{run.template?.name ?? 'Чек-лист'}</strong>
            <span>{compactMeta}</span>
          </div>
          <span className={`checklist-compact-timer ${overdue ? 'overdue' : timing?.phase === 'due' ? 'due' : ''}`}>{nextCheckText(run)}</span>
        </div>
        <div className="checklist-compact-support">
          {periodic ? <span>Проверок за смену: <strong>{completedChecksCount(run)}</strong></span> : <span>Заполнено: {progress.done}/{progress.total}</span>}
          <span>{run.frequencyLabel ?? 'По необходимости'}</span>
        </div>
        <div className="checklist-compact-actions">
          {primaryLabel ? (
            <button
              className="primary-button"
              onClick={() => run.status === 'PAUSED'
                ? setModal({ mode: 'resume', title: 'Возобновить чек-лист', run })
                : setSelectedRun(run)}
              type="button"
            >
              {primaryLabel}
            </button>
          ) : null}
          <button className="secondary-button" onClick={() => void openChecklistDetail({ kind: 'run', run })} type="button">Подробнее</button>
        </div>
      </article>
    );
  };

  const renderAvailableWorkCard = (template: ChecklistTemplate) => (
    <article className="panel-card checklist-work-card checklist-compact-available available" data-checklist-template-id={template.id} key={template.id}>
      <div className="checklist-compact-main">
        <div>
          <strong className="checklist-card-title">{template.name}</strong>
          <span>{[template.lineName || template.assignmentLabel || template.departmentLabel || template.departmentName, template.frequencyLabel || 'По необходимости'].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div className="checklist-compact-actions">
        <button
          className="primary-button"
          onClick={() => setModal({ mode: 'start', title: 'Взять в работу', template })}
          type="button"
        >
          Взять в работу
        </button>
        <button className="secondary-button" onClick={() => void openChecklistDetail({ kind: 'template', template })} type="button">Подробнее</button>
      </div>
    </article>
  );

  const renderArchiveRunCard = (run: ChecklistRun) => {
    const progress = runProgress(run);
    return (
      <article className="panel-card checklist-archive-compact-card" key={run.id}>
        <div className="checklist-archive-compact-main">
          <div>
            <strong>{run.template?.name ?? 'Чек-лист'}</strong>
            <span>{[dateTime(run.startedAt), run.shiftLabel, run.lineName].filter(Boolean).join(' · ') || 'Контекст не указан'}</span>
          </div>
          <span className={`status-badge ${run.status === 'AUTO_CLOSED' ? 'pause' : 'work'}`}>
            {displayLabel(checklistRunStatusLabels, run.status)}
          </span>
        </div>
        <div className="checklist-archive-compact-progress">
          <span>{progress.done} из {progress.total} пунктов</span>
          <div className="guided-progress-bar"><span style={{ width: `${progress.percent}%` }} /></div>
        </div>
        <button className="secondary-button" onClick={() => setSelectedRun(run)} type="button">Открыть</button>
      </article>
    );
  };

  const renderRowEditor = (
    row: ChecklistRunRow | ChecklistTemplateRow,
    draft: RowDraft,
    options?: {
      files?: File[];
      onChange?: (patch: Partial<RowDraft>) => void;
      onFilesChange?: (files: File[]) => void;
      compositeStep?: 0 | 1;
    },
  ) => {
    const type = row.rowType ?? 'LEGACY';
    const update = options?.onChange ?? ((patch: Partial<RowDraft>) => setDraft(row.id, patch));
    const pendingFiles = options?.files ?? filesByRow[row.id] ?? [];
    const updateFiles = options?.onFilesChange ?? ((files: File[]) => setRowFiles(row.id, files));
    const composite = isCompositePhotoChecklistRow(row);
    const splitComposite = composite && options?.compositeStep !== undefined;
    const showPrimary = !splitComposite || options?.compositeStep === 0;
    const showPhoto = isPhotoChecklistRow(row) && (!splitComposite || options?.compositeStep === 1);
    const showComment = !splitComposite || options?.compositeStep === 1;
    if (type === 'INFO' && !row.requiresPhoto && !row.requiresComment) {
      return <div className="empty-state">Информационный пункт. Проверьте текст и нажмите “Дальше”.</div>;
    }
    return (
      <div className="guided-answer-card">
        {showPrimary && type === 'INFO' ? <div className="empty-state">Информационный пункт. Проверьте текст и добавьте настроенные подтверждения.</div> : null}
        {splitComposite ? (
          <div className="checklist-composite-step-label">
            <strong>Шаг {(options?.compositeStep ?? 0) + 1} из 2</strong>
            <span>{options?.compositeStep === 0 ? 'Сначала внесите результат измерения.' : 'Теперь добавьте обязательное фото.'}</span>
          </div>
        ) : null}
        {showPrimary && type === 'LEGACY' ? (
          <label className="field-label">Результат
            <select value={draft.status} onChange={(event) => update({ status: event.target.value as RowDraft['status'] })}>
              <option value="">Не выбрано</option>
              <option value="OK">ОК</option>
              <option value="NA">Не применимо</option>
              <option value="ISSUE">Проблема</option>
            </select>
          </label>
        ) : null}

        {showPrimary && (type === 'YES_NO' || type === 'YES_NO_NA') ? (
          <div className="checklist-choice-grid">
            <button className={draft.answerBoolean === true ? 'primary-button' : 'secondary-button'} onClick={() => update({ answerBoolean: true, selectedOption: 'YES' })} type="button">Да</button>
            <button className={draft.answerBoolean === false ? 'primary-button danger' : 'secondary-button'} onClick={() => update({ answerBoolean: false, selectedOption: 'NO' })} type="button">Нет</button>
            {type === 'YES_NO_NA' ? (
              <button className={draft.selectedOption === 'NA' ? 'primary-button' : 'secondary-button'} onClick={() => update({ answerBoolean: null, selectedOption: 'NA' })} type="button">Не применимо</button>
            ) : null}
          </div>
        ) : null}

        {showPrimary && (type === 'TEXT' || type === 'REQUIRED_COMMENT') ? (
          <label className="field-label">Ответ
            <textarea value={draft.answerText} onChange={(event) => update({ answerText: event.target.value })} placeholder="Введите ответ" />
          </label>
        ) : null}

        {showPrimary && type === 'NUMBER' ? (
          <label className="field-label">Значение{row.unit ? `, ${row.unit}` : ''}
            <input inputMode="decimal" type="number" value={draft.answerNumber} onChange={(event) => update({ answerNumber: event.target.value })} />
            {numericDeviation(row, draft) ? <span className="checklist-deviation-warning">{numericDeviation(row, draft)}</span> : null}
            {draft.answerNumber.trim() && !numericDeviation(row, draft) ? (
              <span className="checklist-numeric-result">
                {rowNormText(row) ? 'В пределах нормы' : 'Значение введено'}
              </span>
            ) : null}
          </label>
        ) : null}

        {showPrimary && type === 'SELECT' ? (
          <label className="field-label">Вариант
            <select value={draft.selectedOption} onChange={(event) => update({ selectedOption: event.target.value })}>
              <option value="">Не выбрано</option>
              {(row.optionsJson ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        ) : null}

        {showPhoto ? (
          <>
            <div className="checklist-own-photo-card">
              <strong>Ваше фото результата</strong>
              <AttachmentPicker value={pendingFiles} onChange={updateFiles} allowFiles />
            </div>
          </>
        ) : null}

        {showComment && type !== 'REQUIRED_COMMENT' && row.requiresComment ? (
          <label className="field-label">Комментарий (обязательно)
            <textarea value={draft.comment} onChange={(event) => update({ comment: event.target.value })} placeholder="Опишите результат или отклонение" />
          </label>
        ) : null}
        {showComment && type !== 'REQUIRED_COMMENT' && !row.requiresComment ? (
          <details className="checklist-optional-comment" open={draft.comment ? true : undefined}>
            <summary>Добавить комментарий</summary>
            <label className="field-label">Комментарий
              <textarea value={draft.comment} onChange={(event) => update({ comment: event.target.value })} placeholder="Необязательно" />
            </label>
          </details>
        ) : null}
      </div>
    );
  };

  const renderRowBadges = (row: ChecklistTemplateRow | ChecklistRunRow) => (
    <div className="checklist-row-badges">
      {rowFlagBadges(row).map((badge) => <span className="tag" key={badge}>{badge}</span>)}
    </div>
  );

  const renderTemplateCard = (template: ChecklistTemplate, context: 'available' | 'library' | 'archive-list') => {
    const expanded = Boolean(expandedTemplateIds[template.id]);
    const meta = context === 'library' ? templateLibraryMetaItems(template) : templateMetaItems(template);
    const canStart = context !== 'archive-list' && !template.archivedAt && template.isActive !== false;
    return (
      <article className="panel-card checklist-template-card compact-checklist-template-card" key={template.id}>
        <div className="panel-card-header checklist-template-main">
          <div className="checklist-card-heading">
            <strong className="checklist-card-title">{template.name}</strong>
            {template.description ? <span className="checklist-card-description">{template.description}</span> : null}
            <div className="checklist-card-meta">
              {meta.map((item) => <span className="tag" key={item}>{item}</span>)}
            </div>
          </div>
          <span className={`status-badge ${templateStatusClass(template)}`}>{templateAvailabilityLabel(template)}</span>
        </div>
        {template.availability?.reason ? <div className="empty-state compact">{template.availability.reason}</div> : null}
        <div className="button-row checklist-card-actions primary-card-actions">
          {canStart ? (
            <button
              className="primary-button"
              disabled={Boolean(template.availability?.duplicateBlocked)}
              onClick={() => setModal({ mode: 'start', title: context === 'available' ? 'Взять в работу' : 'Начать чек-лист', template })}
              type="button"
            >
              {context === 'available' ? 'Взять в работу' : 'Начать'}
            </button>
          ) : null}
          <button className="secondary-button" onClick={() => setPreviewTemplate(template)} type="button">Посмотреть чек-лист</button>
          {canArchive ? <button className="secondary-button" onClick={() => void openTemplateArchive(template)} type="button">Архив</button> : null}
          {(canManage || template.rows.length > 0 || context === 'archive-list') ? (
            <button className="secondary-button" onClick={() => toggleTemplateExpanded(template.id)} type="button">{expanded ? 'Скрыть' : 'Ещё'}</button>
          ) : null}
        </div>
        {expanded ? (
          <div className="checklist-template-extra">
            {canManage && context !== 'archive-list' ? (
              <div className="button-row checklist-card-actions secondary-card-actions">
                <button className="secondary-button" onClick={() => openTemplateBuilder('edit', template)} type="button">Редактировать</button>
                <button className="secondary-button" onClick={() => openTemplateBuilder('duplicate', template)} type="button">Создать копию</button>
                <button className="secondary-button" onClick={() => openRowEditor(template)} type="button">Добавить пункт</button>
                <button className="secondary-button danger" onClick={() => setModal({ mode: 'archive-template', title: 'Архивировать шаблон', template })} type="button">В архив</button>
              </div>
            ) : null}
            {context === 'archive-list' && canManage ? (
              <div className="button-row checklist-card-actions secondary-card-actions">
                <button className="secondary-button" onClick={() => setModal({ mode: 'restore-template', title: 'Восстановить шаблон', template })} type="button">Восстановить</button>
              </div>
            ) : null}
            {template.rows.length ? (
              <div className="checklist-template-row-preview">
                {template.rows.slice(0, 5).map((row) => (
                  <div className="compact-row checklist-template-row-compact" key={row.id}>
                    <div>
                      <strong>{row.sortOrder}. {row.title}</strong>
                      {renderRowBadges(row)}
                    </div>
                    {canManage && context !== 'archive-list' ? (
                      <div className="button-row">
                        <button className="secondary-button" onClick={() => void moveRow(template, row, -1)} type="button">Выше</button>
                        <button className="secondary-button" onClick={() => void moveRow(template, row, 1)} type="button">Ниже</button>
                        <button className="secondary-button" onClick={() => openRowEditor(template, row)} type="button">Редактировать</button>
                        {row.isActive ? <button className="secondary-button danger" onClick={() => setModal({ mode: 'archive-row', title: 'Удалить пункт из шаблона?', template, templateRow: row })} type="button">Удалить</button> : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                {template.rows.length > 5 ? <span className="line-meta">Ещё пунктов: {template.rows.length - 5}</span> : null}
              </div>
            ) : <div className="empty-state compact">В шаблоне пока нет пунктов.</div>}
          </div>
        ) : null}
      </article>
    );
  };

  const templateFields = (template?: ChecklistTemplate): ActionModalField[] => [
    { name: 'name', label: 'Название', required: true, defaultValue: template?.name ?? '' },
    { name: 'description', label: 'Описание', type: 'textarea', defaultValue: template?.description ?? '' },
    { name: 'departmentId', label: 'Отдел', type: 'select', options: departmentOptions, defaultValue: template?.departmentId ?? currentUser?.departmentId ?? '', required: true },
    { name: 'lineId', label: 'Привязать к линии', type: 'select', options: lineOptionsForTemplate(template), defaultValue: template?.lineId ?? '' },
    { name: 'assignmentRole', label: 'Кто может брать в работу', type: 'select', options: roleOptions, defaultValue: firstAssignmentRole(template) },
    { name: 'shiftType', label: 'Смена', type: 'select', options: shiftOptions, defaultValue: template?.shiftType ?? '' },
    { name: 'frequencyRule', label: 'Периодичность', type: 'select', options: frequencyOptions, defaultValue: template?.frequencyRule ?? 'MANUAL' },
    { name: 'frequencyIntervalUnit', label: 'Интервал: сначала выберите минуты или часы', type: 'select', options: intervalUnitOptions, defaultValue: template?.frequencyIntervalUnit ?? 'HOURS' },
    { name: 'frequencyIntervalValue', label: 'Интервал: затем укажите число', type: 'number', defaultValue: template?.frequencyIntervalValue ?? template?.frequencyHours ?? '' },
    { name: 'isMandatory', label: 'Обязательный чек-лист', type: 'checkbox', defaultValue: template?.isMandatory ?? false },
    { name: 'isActive', label: 'Шаблон активен', type: 'checkbox', defaultValue: template?.isActive ?? true },
    ...(template ? [{ name: 'reason', label: 'Причина изменения', type: 'textarea' as const }] : []),
  ];

  return (
    <section className="screen-card checklists-screen">
      <PremiumSectionHeader
        eyebrow="Отделовой контроль"
        title="Чек-листы"
        subtitle="Текущие проверки, сроки и выполнение по вашему отделу."
      />

      <PremiumKpiStrip
        className="checklist-kpi-strip"
        items={[
          { label: 'В работе', value: sortedRuns.length, icon: '✓', tone: 'success', active: tab === 'my', onClick: () => setTab('my') },
          { label: 'Доступные', value: availableTemplates.length, icon: '+', tone: 'neutral', active: tab === 'available', onClick: () => setTab('available') },
          { label: 'Архив', value: Math.max(archive.runs.length, completedShiftRuns.length), icon: '▤', tone: 'cool', active: tab === 'archive', disabled: !canArchive, onClick: () => setTab('archive') },
        ]}
        label="Состояние чек-листов"
      />

      {canManage ? (
        <div className="premium-manager-toolbar checklist-manager-toolbar">
          <span>{tab === 'library' ? 'Шаблоны отдела' : 'Настройка чек-листов'}</span>
          {tab === 'library' ? (
            <button className="secondary-button compact-action" onClick={() => openTemplateBuilder('create')} type="button">Создать шаблон</button>
          ) : (
            <button className="secondary-button compact-action" onClick={() => setTab('library')} type="button">Управление шаблонами ›</button>
          )}
        </div>
      ) : null}

      {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
      {completionNotice ? <div className="empty-state success-state" role="status">{completionNotice}</div> : null}
      {loading ? <div className="empty-state">Загрузка...</div> : null}

      {tab === 'my' && (
        <div className="list-stack checklist-workspace">
          <section className="checklist-work-section">
            <div className="section-subhead">
              <h3>В работе</h3>
              <span>{sortedRuns.length}</span>
            </div>
            {sortedRuns.length ? sortedRuns.map(renderWorkRunCard) : <div className="empty-state">Сейчас у вас нет чек-листов в работе.</div>}
          </section>
          <button
            className="primary-button checklist-start-new-button"
            onClick={() => setTab('available')}
            type="button"
          >
            Начать новый чек-лист
          </button>
        </div>
      )}

      {tab === 'available' ? (
        <div className="list-stack checklist-workspace">
          <section className="checklist-work-section" id="available-checklists">
            <div className="section-subhead">
              <h3>Доступные чек-листы</h3>
              <span>{availableTemplates.length}</span>
            </div>
            {availableTemplates.length ? availableTemplates.map(renderAvailableWorkCard) : <div className="empty-state">Доступных чек-листов для вашей смены пока нет.</div>}
          </section>
        </div>
      ) : null}

      {tab === 'library' && (
        <div className="list-stack">
          {managerWorkspace ? (
            <section className="checklist-work-section checklist-manager-control">
              <div className="section-subhead">
                <h3>Контроль отдела</h3>
                <span>{managerWorkspace.runs.length}</span>
              </div>
              <div className="checklist-manager-metrics">
                <span><strong>{managerWorkspace.summary.inProgress}</strong>В работе</span>
                <span><strong>{managerWorkspace.summary.dueSoon}</strong>Скоро срок</span>
                <span className="warning"><strong>{managerWorkspace.summary.overdue}</strong>Просрочены</span>
                <span><strong>{managerWorkspace.summary.completed}</strong>Завершены</span>
              </div>
            </section>
          ) : null}
          {templates.length ? templates.map((template) => renderTemplateCard(template, 'library')) : <div className="empty-state">В библиотеке отдела пока нет шаблонов.</div>}
        </div>
      )}

      {tab === 'archive' && canArchive ? (
        <div className="list-stack checklist-archive-workspace">
          <div className="panel-card checklist-archive-compact-header">
            <div>
              <p className="eyebrow">Архив</p>
              <h3>Завершённые чек-листы</h3>
              <span className="line-meta">Откройте запись, чтобы посмотреть ответы и результат.</span>
            </div>
            {canArchiveReports ? (
              <button className="secondary-button" onClick={() => setShowArchiveFilters(true)} type="button">Фильтры и отчёты</button>
            ) : null}
          </div>
          <div className="checklist-archive-compact-list">
            {archive.runs.length
              ? archive.runs.map(renderArchiveRunCard)
              : <div className="empty-state">Архив чек-листов пока пуст.</div>}
          </div>

          {showArchiveFilters ? (
            <PremiumSheet
              className="checklist-archive-tools"
              description="Отберите результаты и сформируйте существующие отчёты без перегруженного первого экрана."
              eyebrow="Архив чек-листов"
              footer={(
                <>
                  <button className="secondary-button" onClick={() => setShowArchiveFilters(false)} type="button">Закрыть</button>
                  <button className="primary-button" onClick={() => void applyArchiveFilters()} type="button">Применить фильтры</button>
                </>
              )}
              onClose={() => setShowArchiveFilters(false)}
              open
              title="Фильтры и отчёты"
            >
                <div className="checklist-archive-tools-body">
          <div className="panel-card checklist-archive-selector">
            <div>
              <p className="eyebrow">Архив чек-листов</p>
              <h3>{archiveJournal?.template?.name ?? 'Выберите шаблон из библиотеки'}</h3>
              <span className="line-meta">
                {archiveJournal?.template
                  ? `${archiveJournal.template.rowCount} пунктов${archiveJournal.template.lineName ? ` · ${archiveJournal.template.lineName}` : ''}`
                  : 'Журнал открывается из карточки шаблона кнопкой “Архив”. Таблица остаётся вторичным режимом.'}
              </span>
            </div>
            {archiveJournal ? (
              <div className="checklist-report-actions">
                <div className="segmented-control compact-segmented">
                <button className={archiveMode === 'journal' ? 'active' : ''} onClick={() => setArchiveMode('journal')} type="button">Журнал</button>
                <button className={archiveMode === 'table' ? 'active' : ''} onClick={() => setArchiveMode('table')} type="button">Таблица</button>
                </div>
                <button className="secondary-button" onClick={() => void exportArchiveExcel()} type="button">Экспорт в Excel</button>
              </div>
            ) : null}
          </div>

          <div className="filter-grid checklist-archive-filters premium-deep-filters">
            <label className="field-label">С
              <input type="date" value={archiveFilters.dateFrom} onChange={(event) => updateArchiveFilter('dateFrom', event.target.value)} />
            </label>
            <label className="field-label">По
              <input type="date" value={archiveFilters.dateTo} onChange={(event) => updateArchiveFilter('dateTo', event.target.value)} />
            </label>
            <label className="field-label">Статус
              <select value={archiveFilters.status} onChange={(event) => updateArchiveFilter('status', event.target.value)}>
                <option value="">Все</option>
                <option value="CLOSED">Закрыт</option>
                <option value="AUTO_CLOSED">Автозакрыт</option>
              </select>
            </label>
            <label className="field-label">Шаблон
              <select value={archiveFilters.templateId} onChange={(event) => updateArchiveFilter('templateId', event.target.value)}>
                <option value="">Все</option>
                {templateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="field-label">Смена
              <select value={archiveFilters.shiftType} onChange={(event) => updateArchiveFilter('shiftType', event.target.value)}>
                <option value="">Все</option>
                <option value="DAY">День</option>
                <option value="NIGHT">Ночь</option>
              </select>
            </label>
            <label className="field-label">Линия
              <select value={archiveFilters.lineId} onChange={(event) => updateArchiveFilter('lineId', event.target.value)}>
                <option value="">Все</option>
                {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
              </select>
            </label>
            <label className="field-label">Пользователь
              <select value={archiveFilters.userId} onChange={(event) => updateArchiveFilter('userId', event.target.value)}>
                <option value="">Все</option>
                {userOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {currentUser?.isAdmin ? (
              <label className="field-label">Отдел
                <select value={archiveFilters.departmentId} onChange={(event) => updateArchiveFilter('departmentId', event.target.value)}>
                  <option value="">Все</option>
                  {departmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
            <label className="checkbox-row">
              <input checked={archiveFilters.onlyDeviations === 'true'} type="checkbox" onChange={(event) => updateArchiveFilter('onlyDeviations', event.target.checked ? 'true' : '')} />
              Только отклонения
            </label>
            <label className="checkbox-row">
              <input checked={archiveFilters.withPhotos === 'true'} type="checkbox" onChange={(event) => updateArchiveFilter('withPhotos', event.target.checked ? 'true' : '')} />
              Только с фото
            </label>
            <label className="checkbox-row">
              <input checked={archiveFilters.withComments === 'true'} type="checkbox" onChange={(event) => updateArchiveFilter('withComments', event.target.checked ? 'true' : '')} />
              Только с комментариями
            </label>
          </div>

          <section className="panel-card checklist-shift-report">
            <div className="panel-card-header">
              <div>
                <p className="eyebrow">Сводка по смене</p>
                <h3>{shiftReport ? `${formatArchiveDate(shiftReport.shiftDate)} · ${shiftReport.shiftLabel}` : 'Выполнение обязательных чек-листов'}</h3>
                <span className="line-meta">Использует дату “С” и выбранную смену из фильтров архива.</span>
              </div>
              <div className="checklist-report-actions">
                <button className="secondary-button" disabled={reportLoading} onClick={() => void loadShiftReport()} type="button">{reportLoading ? 'Загрузка...' : 'Показать сводку'}</button>
                <button className="secondary-button" disabled={!shiftReport} onClick={() => void downloadShiftReportPdf()} type="button">PDF смены</button>
              </div>
            </div>
            {shiftReport ? (
              <>
                <div className="shift-report-summary-grid">
                  <span><strong>{shiftReport.summary.expected}</strong> ожидалось</span>
                  <span><strong>{shiftReport.summary.completed}</strong> выполнено</span>
                  <span><strong>{shiftReport.summary.missing}</strong> не хватает</span>
                  <span><strong>{shiftReport.summary.inProgress}</strong> в работе</span>
                  <span><strong>{shiftReport.summary.deviations}</strong> отклонений</span>
                  <span><strong>{shiftReport.summary.manualReview}</strong> вручную</span>
                </div>
                <div className="list-stack">
                  {shiftReport.items.slice(0, 8).map((item) => (
                    <article className={`shift-report-item ${item.status}`} key={item.templateId}>
                      <div>
                        <strong>{item.templateName}</strong>
                        <span>{[item.lineName, item.frequencyLabel, item.expectedLabel].filter(Boolean).join(' · ')}</span>
                      </div>
                      <span className={`status-badge ${item.status === 'ok' ? 'work' : item.status === 'missing' ? 'stop' : 'pause'}`}>{item.statusLabel}</span>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">Выберите дату и смену в фильтрах, затем нажмите “Показать сводку”.</div>
            )}
          </section>

          {archiveJournal && archiveMode === 'journal' ? (
            <div className="checklist-archive-journal">
              {archiveJournal.groups.length ? archiveJournal.groups.map((group) => (
                <section className="panel-card checklist-archive-group" key={`${group.date}-${group.shiftType ?? 'none'}`}>
                  <div className="panel-card-header">
                    <div className="archive-group-heading">
                      <p className="eyebrow">Дата и смена:</p>
                      <h3>{formatArchiveDate(group.date)}</h3>
                      <span>Смена: {shiftFullLabel(group.shiftType ?? null)}</span>
                    </div>
                    <span className="status-badge">{group.runs.length} заполнения</span>
                  </div>
                  <div className="list-stack">
                    {group.runs.map((run) => (
                      <button className="archive-run-row" key={run.recordId} onClick={() => {
                        setSelectedArchiveRunId(run.recordId);
                        setShowArchiveFilters(false);
                      }} type="button">
                        <span className="archive-run-time">{run.time ?? '—'}</span>
                        <span className="archive-run-person">
                          <strong>{run.userName}</strong>
                          <small>{run.lineName ?? 'Линия не указана'}{run.occurrenceSequence ? ` · Проверка ${run.occurrenceSequence}` : ''}</small>
                        </span>
                        <span className={`status-badge ${run.deviationCount ? 'stop' : 'work'}`}>{run.statusLabel}</span>
                        <span className="archive-run-metrics">
                          <span>{run.deviationCount ? `Отклонений: ${run.deviationCount}` : 'Отклонений нет'}</span>
                          {run.photoCount ? <span>Фото: {run.photoCount}</span> : null}
                          {run.commentCount ? <span>Комментарии: {run.commentCount}</span> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )) : <div className="empty-state">За выбранный период результатов по этому шаблону не найдено.</div>}
            </div>
          ) : null}

          {archiveMode === 'table' ? (
            <>
              <h3>Таблица результатов</h3>
              {archiveTable?.rows.length ? (
                <div className="checklist-archive-table-scroll" role="region" aria-label="Таблица результатов чек-листа">
                  <div className="checklist-archive-table">
                    <div className="archive-table-head">
                      <span>Дата</span>
                      <span>Смена</span>
                      <span>Кто заполнил</span>
                      <span>Линия</span>
                      {archiveTable.columns.slice(0, 10).map((column) => <span key={column.id}>{column.title}</span>)}
                    </div>
                    {archiveTable.rows.map((row) => (
                      <article className="archive-table-row" key={row.id}>
                        <span><strong>Дата:</strong> {dateTime(row.date)}</span>
                        <span><strong>Смена:</strong> {row.shiftLabel ?? 'Не указана'}</span>
                        <span><strong>Кто:</strong> {row.userName ?? 'Не указан'}</span>
                        <span><strong>Линия:</strong> {row.lineName ?? 'Не указана'}</span>
                        {archiveTable.columns.slice(0, 10).map((column) => (
                          <span className={row.values[column.id]?.status === 'warning' ? 'archive-cell-warning' : row.values[column.id]?.status === 'missing' ? 'archive-cell-missing' : ''} key={column.id}>
                            <strong>{column.title}:</strong> {row.values[column.id]?.value || '—'}
                          </span>
                        ))}
                      </article>
                    ))}
                  </div>
                </div>
              ) : <div className="empty-state">За выбранный период табличных результатов не найдено.</div>}
            </>
          ) : null}

          {!archiveJournal ? (
            <>
              <h3>Закрытые запуски</h3>
              {archive.runs.length ? archive.runs.map((run) => (
                <article className="panel-card" key={run.id}>
                  {renderRunCard(run)}
                  <div className="list-stack">
                    {run.rows.slice(0, 6).map((row) => (
                      <div className="compact-row" key={row.id}>
                        <strong>{row.title}</strong>
                        <span>{formatAnswer(row)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              )) : <div className="empty-state">Архив запусков пуст.</div>}
            </>
          ) : null}

          <h3>Архивные шаблоны</h3>
          {archive.templates.map((template) => renderTemplateCard(template, 'archive-list'))}
                </div>
            </PremiumSheet>
          ) : null}
        </div>
      ) : null}

      {selectedArchiveRun ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card wide-modal checklist-archive-detail premium-deep-panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Детали запуска</p>
                <h3>{selectedArchiveRun.templateName}</h3>
              </div>
              <div className="checklist-report-actions">
                <button className="secondary-button" onClick={() => void downloadRunPdf(selectedArchiveRun.runId)} type="button">Скачать PDF</button>
                <button className="secondary-button" onClick={() => setSelectedArchiveRunId(null)} type="button">Закрыть</button>
              </div>
            </div>
            <div className="archive-detail-summary archive-detail-summary-grid">
              <span><strong>Дата</strong>{formatArchiveDate(selectedArchiveRun.shiftDate ?? selectedArchiveRun.date)}</span>
              <span><strong>Смена</strong>{shiftFullLabel(selectedArchiveRun.shiftType ?? selectedArchiveRun.shiftLabel ?? null)}</span>
              <span><strong>Время</strong>{selectedArchiveRun.time ?? 'Не указано'}</span>
              <span><strong>Начало</strong>{dateTime(selectedArchiveRun.startedAt)}</span>
              <span><strong>Окончание</strong>{dateTime(selectedArchiveRun.closedAt)}</span>
              <span><strong>Заполнил</strong>{selectedArchiveRun.userName}</span>
              <span><strong>Линия</strong>{selectedArchiveRun.lineName ?? 'Линия не указана'}</span>
              <span className={`status-badge ${selectedArchiveRun.deviationCount ? 'stop' : 'work'}`}>{selectedArchiveRun.statusLabel}</span>
              <span><strong>Отклонения</strong>{selectedArchiveRun.deviationCount}</span>
              <span><strong>Фото</strong>{selectedArchiveRun.photoCount}</span>
              <span><strong>Комментарии</strong>{selectedArchiveRun.commentCount}</span>
            </div>
            {selectedArchiveRun.closeReason ? (
              <div className="empty-state warning-state">
                <strong>{selectedArchiveRun.closeKind?.startsWith('SHIFT_END') ? 'Причина автоматического завершения' : 'Причина завершения'}</strong>
                <span>{selectedArchiveRun.closeReason}</span>
              </div>
            ) : null}
            {selectedArchiveRun.pauseEvents?.length ? (
              <section className="checklist-archive-pauses">
                <h4>Периоды паузы</h4>
                {selectedArchiveRun.pauseEvents.map((pause, index) => (
                  <div className="compact-row" key={`${pause.pausedAt ?? 'pause'}-${index}`}>
                    <div>
                      <strong>{pause.reason || 'Причина не указана'}</strong>
                      <span>{dateTime(pause.pausedAt)} — {pause.resumedAt ? dateTime(pause.resumedAt) : 'не возобновлён'}</span>
                    </div>
                    <span className="tag pause">{durationText(pause.durationSeconds)}</span>
                  </div>
                ))}
              </section>
            ) : null}
            <div className="checklist-archive-detail-rows">
              {selectedArchiveRun.rows.map((row, index) => (
                <article className={`archive-detail-row ${row.status}`} key={row.rowId}>
                  <div>
                    <strong>{index + 1}. {row.title}</strong>
                    <div className="checklist-row-badges">
                      <span className="tag">{row.typeLabel}</span>
                      {row.normText ? <span className="tag">{row.normText}</span> : null}
                    </div>
                  </div>
                  <div className="archive-detail-value">
                    <span className={`status-badge ${archiveStatusClass(row.status)}`}>{row.statusLabel}</span>
                    <strong>{row.displayValue}</strong>
                    {row.comment ? <span>Комментарий: {row.comment}</span> : null}
                    {row.completedByName && row.completedAt ? <span>Отметил: {row.completedByName}, {dateTime(row.completedAt)}</span> : null}
                  </div>
                  {row.referencePhoto ? <section aria-label="Архивный фото-эталон"><strong>Фото-эталон на момент начала</strong><AttachmentPreviewList attachments={[row.referencePhoto]} mode="grid" /></section> : null}
                  <strong>Фото результата</strong>
                  <AttachmentPreviewList attachments={row.attachments ?? []} mode="grid" showEmpty={false} />
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <PremiumSheet
        className="checklist-local-detail-sheet"
        description={checklistDetail?.kind === 'run'
          ? [checklistDetail.run.frequencyLabel, workStatus(checklistDetail.run).label].filter(Boolean).join(' · ')
          : checklistDetail?.kind === 'template'
            ? checklistDetail.template.frequencyLabel ?? 'По необходимости'
            : undefined}
        eyebrow={selectedDetailOccurrence ? 'История проверки' : 'Чек-лист'}
        open={Boolean(checklistDetail)}
        title={selectedDetailOccurrence?.templateName
          ?? (checklistDetail?.kind === 'run' ? checklistDetail.run.template?.name : checklistDetail?.template.name)
          ?? 'Подробнее'}
        onClose={detailOccurrenceId ? () => setDetailOccurrenceId(null) : closeChecklistDetail}
      >
        {checklistDetail ? (
          selectedDetailOccurrence ? (
            <div className="checklist-local-occurrence">
              <button className="secondary-button compact-action" onClick={() => setDetailOccurrenceId(null)} type="button">← К последним проверкам</button>
              <div className="checklist-detail-metadata">
                <span><small>Результат</small><strong>{selectedDetailOccurrence.statusLabel}</strong></span>
                <span><small>Исполнитель</small><strong>{selectedDetailOccurrence.userName}</strong></span>
                <span><small>Дата и время</small><strong>{dateTime(selectedDetailOccurrence.closedAt ?? selectedDetailOccurrence.startedAt)}</strong></span>
                <span><small>Отклонения</small><strong>{selectedDetailOccurrence.deviationCount}</strong></span>
                <span><small>Комментарии</small><strong>{selectedDetailOccurrence.commentCount}</strong></span>
                <span><small>Фото</small><strong>{selectedDetailOccurrence.photoCount}</strong></span>
              </div>
              <div className="checklist-detail-history-rows">
                {selectedDetailOccurrence.rows.map((row, index) => (
                  <article className={`checklist-detail-history-row ${row.status}`} key={row.rowId}>
                    <div>
                      <strong>{index + 1}. {row.title}</strong>
                      <span>{row.displayValue}</span>
                      {row.comment ? <small>Комментарий: {row.comment}</small> : null}
                      {row.completedByName && row.completedAt ? <small>{row.completedByName} · {dateTime(row.completedAt)}</small> : null}
                    </div>
                    <span className={`status-badge ${archiveStatusClass(row.status)}`}>{row.statusLabel}</span>
                    {row.referencePhoto ? <section aria-label="Архивный фото-эталон"><strong>Фото-эталон на момент начала</strong><AttachmentPreviewList attachments={[row.referencePhoto]} mode="grid" /></section> : null}
                  <strong>Фото результата</strong>
                  <AttachmentPreviewList attachments={row.attachments ?? []} mode="grid" showEmpty={false} />
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="checklist-local-detail">
              <p className="checklist-detail-description">
                {checklistDetail.kind === 'run'
                  ? checklistDetail.run.template?.description || 'Описание не указано.'
                  : checklistDetail.template.description || 'Описание не указано.'}
              </p>
              <div className="checklist-detail-metadata">
                {checklistDetail.kind === 'run' ? (
                  <>
                    <span><small>Отдел</small><strong>{checklistDetail.run.departmentLabel || checklistDetail.run.departmentName || 'Мой отдел'}</strong></span>
                    <span><small>Линия</small><strong>{checklistDetail.run.lineName || 'Без привязки'}</strong></span>
                    <span><small>Смена</small><strong>{checklistDetail.run.shiftLabel || 'Не указана'}</strong></span>
                    <span><small>Исполнитель</small><strong>{checklistDetail.run.executorName || 'Вы'}</strong></span>
                    <span><small>Пунктов</small><strong>{checklistDetail.run.rows.length}</strong></span>
                    <span><small>Следующая проверка</small><strong>{nextCheckText(checklistDetail.run)}</strong></span>
                  </>
                ) : (
                  <>
                    <span><small>Отдел</small><strong>{checklistDetail.template.departmentLabel || checklistDetail.template.departmentName || 'Мой отдел'}</strong></span>
                    <span><small>Линия</small><strong>{checklistDetail.template.lineName || 'Без привязки'}</strong></span>
                    <span><small>Смена</small><strong>{checklistDetail.template.shiftLabel || 'Любая смена'}</strong></span>
                    <span><small>Периодичность</small><strong>{checklistDetail.template.frequencyLabel || 'По необходимости'}</strong></span>
                    <span><small>Пунктов</small><strong>{checklistDetail.template.rows.length}</strong></span>
                    <span><small>Статус</small><strong>Доступен</strong></span>
                  </>
                )}
              </div>

              {checklistDetail.kind === 'template' ? (
                <button className="secondary-button" onClick={() => {
                  const template = checklistDetail.template;
                  closeChecklistDetail();
                  setPreviewTemplate(template);
                }} type="button">Посмотреть пункты</button>
              ) : null}

              <section className="checklist-local-history">
                <div className="section-subhead">
                  <h3>Последние проверки</h3>
                  <span>{detailJournal?.runs.length ?? 0}</span>
                </div>
                {detailLoading ? <div className="empty-state">Загрузка истории...</div> : null}
                {!detailLoading && detailJournal?.runs.length ? detailJournal.runs.slice(0, 5).map((occurrence) => (
                  <button className="checklist-history-compact-row" key={occurrence.recordId} onClick={() => setDetailOccurrenceId(occurrence.recordId)} type="button">
                    <span>
                      <strong>{dateTime(occurrence.closedAt ?? occurrence.startedAt)}</strong>
                      <small>{occurrence.userName} · {occurrence.statusLabel}</small>
                    </span>
                    <span className={occurrence.deviationCount ? 'warning' : ''}>{occurrence.deviationCount ? `Отклонений: ${occurrence.deviationCount}` : 'Без отклонений'}</span>
                  </button>
                )) : null}
                {!detailLoading && !detailJournal?.runs.length ? <div className="empty-state compact">Завершённых проверок пока нет.</div> : null}
              </section>

              {checklistDetail.kind === 'run' && checklistDetail.run.status !== 'CLOSED' && checklistDetail.run.status !== 'AUTO_CLOSED' ? (
                <button
                  className="secondary-button danger"
                  onClick={() => {
                    const run = checklistDetail.run;
                    closeChecklistDetail();
                    setModal({
                      mode: 'close',
                      title: isPeriodicChecklistRun(run) ? 'Завершить чек-лист полностью' : 'Завершить чек-лист',
                      run,
                    });
                  }}
                  type="button"
                >
                  Завершить вручную
                </button>
              ) : null}
            </div>
          )
        ) : null}
      </PremiumSheet>

      {selectedRun && currentRow && currentDraft ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card wide-modal guided-run-modal">
            <div className="screen-header checklist-runner-header">
              <button className="secondary-button checklist-runner-back" aria-label="Вернуться к чек-листам" onClick={requestCloseRunner} type="button">←</button>
              <div>
                <h3>{selectedRun.template?.name ?? 'Чек-лист'}</h3>
                <span className="line-meta">
                  {[
                    selectedRun.departmentLabel || selectedRun.departmentName || 'мой отдел',
                    selectedRun.lineLabel || selectedRun.lineName,
                    selectedRun.shiftLabel,
                  ].filter(Boolean).join(' · ') || 'Контекст проверки не указан'}
                </span>
              </div>
              <div className="checklist-runner-header-actions">
                {!networkOnline ? <span className="status-badge stop">Нет связи</span> : null}
                <button
                  aria-label="Действия с чек-листом"
                  className="secondary-button checklist-runner-menu-button"
                  onClick={() => setRunnerMenuOpen(true)}
                  type="button"
                >
                  ⋯
                </button>
              </div>
            </div>

            <div className="guided-progress focus-progress">
              <strong>
                Пункт {guidedIndex + 1} из {activeRows.length}
                {currentRowHasCompositePhoto ? ` · шаг ${currentCompositeStep + 1} из 2` : ''}
              </strong>
              <div className="guided-progress-bar"><span style={{ width: `${Math.round(((guidedIndex + 1) / Math.max(activeRows.length, 1)) * 100)}%` }} /></div>
              <span className={`guided-save-state ${saveNotice === 'Сохранено' ? 'saved' : saveNotice ? 'dirty' : ''}`}>
                {!runIsEditable ? 'Архив: только просмотр.' : saveNotice ?? 'Ответ можно сохранить и продолжить позже.'}
              </span>
              {saveNotice === 'Нет связи. Ответ не сохранён.' || saveNotice === 'Не удалось сохранить' ? (
                <button className="secondary-button compact-action" disabled={loading} onClick={() => void retryCurrentRow()} type="button">Повторить</button>
              ) : null}
            </div>

            {selectedRun.checks?.length ? (
              <div className={`checklist-runner-due ${isOverdueRun(selectedRun) ? 'overdue' : ''}`}>
                <span>{nextCheckText(selectedRun)}</span>
              </div>
            ) : null}

            {selectedRun.status === 'PAUSED' ? (
              <button className="primary-button checklist-runner-resume" onClick={() => setModal({ mode: 'resume', title: 'Возобновить чек-лист', run: selectedRun })} type="button">
                Возобновить чек-лист
              </button>
            ) : null}

            <article className="panel-card guided-current-row focus-current-row" ref={guidedRowRef}>
              <div className="panel-card-header">
                <div className="guided-row-heading">
                  <strong>{currentRow.title}</strong>
                  {currentRow.description ? <span>{currentRow.description}</span> : null}
                  {currentRow.rowType === 'NUMBER' ? <span className="field-hint">{rowNormText(currentRow)}</span> : null}
                </div>
              </div>
              {currentRow.referencePhoto ? <section aria-label="Фото-эталон проверки"><strong>Фото-эталон</strong><AttachmentPreviewList attachments={[currentRow.referencePhoto]} mode="grid" /></section> : <p className="line-meta">Фото-эталон не задан.</p>}
              {!currentRowHasCompositePhoto || currentCompositeStep === 1 ? (<>
                <strong>Фото результата</strong>
                <AttachmentPreviewList attachments={currentRow.attachments ?? []} showEmpty={currentRow.requiresPhoto} />
              </>) : null}
              {currentRow.completedByName && currentRow.completedAt ? (
                <span className="checklist-answer-author">Отметил: {currentRow.completedByName}, {dateTime(currentRow.completedAt)}</span>
              ) : null}
              {runIsEditable ? renderRowEditor(currentRow, currentDraft, {
                compositeStep: currentRowHasCompositePhoto ? currentCompositeStep : undefined,
              }) : (
                <div className="empty-state">
                  <strong>{formatAnswer(currentRow)}</strong>
                  <span>{currentRow.comment || 'Закрытый чек-лист доступен только для просмотра.'}</span>
                </div>
              )}
            </article>

            <div className="checklist-number-navigation" aria-label="Пункты чек-листа">
              {activeRows.map((row, index) => (
                <button
                  aria-current={index === guidedIndex ? 'step' : undefined}
                  className={`${index === guidedIndex ? 'current' : ''} ${row.status === 'ISSUE' ? 'issue' : row.status !== 'PENDING' ? 'done' : row.isRequired && showFinalReview ? 'missing' : 'optional'}`}
                  disabled={loading}
                  key={row.id}
                  onClick={() => void goToRow(index)}
                  type="button"
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <div className="guided-navigation checklist-runner-sticky-actions">
              <button
                className="secondary-button"
                disabled={(guidedIndex === 0 && !(currentRowHasCompositePhoto && currentCompositeStep === 1)) || loading}
                onClick={() => {
                  if (currentRowHasCompositePhoto && currentCompositeStep === 1) {
                    setCompositeStepByRow((current) => ({ ...current, [currentRow.id]: 0 }));
                  } else {
                    void goToRow(Math.max(0, guidedIndex - 1));
                  }
                }}
                type="button"
              >
                Назад
              </button>
              {guidedIndex < activeRows.length - 1 ? (
                <button className="primary-button" disabled={loading} onClick={() => void goNext()} type="button">
                  {currentRowHasCompositePhoto && currentCompositeStep === 0 ? 'Далее: фото' : 'Дальше'}
                </button>
              ) : isPeriodicChecklistRun(selectedRun) && !activeRunCheck(selectedRun) ? (
                <button className="primary-button" disabled={loading} onClick={requestCloseRunner} type="button">Вернуться к чек-листам</button>
              ) : (
                <button className="primary-button" disabled={loading} onClick={() => void finishRun()} type="button">
                  {currentRowHasCompositePhoto && currentCompositeStep === 0 ? 'Далее: фото' : 'Проверить и завершить'}
                </button>
              )}
            </div>

            {showFinalReview ? (
              <div className="modal-backdrop checklist-final-review-backdrop" role="dialog" aria-label="Проверка чек-листа" aria-modal="true">
              <section className="modal-card checklist-final-review">
                <div className="panel-card-header">
                  <div>
                    <p className="eyebrow">Перед завершением</p>
                    <h3>{finalReviewMissing.length ? 'Заполните обязательные пункты' : 'Проверьте результат'}</h3>
                  </div>
                  <button className="secondary-button compact-action" onClick={() => setShowFinalReview(false)} type="button">Вернуться</button>
                </div>
                <div className="checklist-review-summary">
                  <span><strong>{finalReviewRows.filter((row) => row.status !== 'PENDING').length}</strong>Заполнено</span>
                  <span><strong>{finalReviewRows.filter((row) => row.status === 'PENDING').length}</strong>Пропущено</span>
                  <span><strong>{finalReviewMissing.length}</strong>Обязательных не заполнено</span>
                  <span><strong>{finalReviewRows.reduce((sum, row) => sum + (row.attachments?.filter((attachment) => attachment.mimeType.startsWith('image/')).length ?? 0), 0)}</strong>Фото</span>
                </div>
                {finalReviewMissing.length ? (
                  <div className="checklist-review-missing">
                    {finalReviewMissing.map((row) => {
                      const rowIndex = activeRows.findIndex((item) => item.templateRowId === row.templateRowId || item.id === row.id);
                      return (
                        <button className="secondary-button" key={row.id} onClick={() => {
                          setShowFinalReview(false);
                          if (rowIndex >= 0) setGuidedIndex(rowIndex);
                        }} type="button">
                          Перейти к пункту: {row.title}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    className="primary-button checklist-final-submit"
                    disabled={loading}
                    onClick={() => {
                      if (isPeriodicChecklistRun(selectedRun)) {
                        void completeCurrentPeriodicCheck();
                      } else {
                        setShowFinalReview(false);
                        setModal({ mode: 'close', title: 'Завершить чек-лист', run: selectedRun });
                      }
                    }}
                    type="button"
                  >
                    {isPeriodicChecklistRun(selectedRun) ? 'Завершить текущую проверку' : 'Завершить чек-лист'}
                  </button>
                )}
              </section>
              </div>
            ) : null}

            <button className="secondary-button checklist-plan-toggle" onClick={() => setShowAllRows((current) => !current)} type="button">{showAllRows ? 'Скрыть план чек-листа' : 'План чек-листа'}</button>
            {showAllRows ? (
              <div className="list-stack">
                {activeRows.map((row, index) => (
                  <button className="list-row compact-row" key={row.id} onClick={() => void goToRow(index)} type="button">
                    <div>
                      <strong>{index + 1}. {row.title}</strong>
                      <span>{formatAnswer(row)}</span>
                    </div>
                    <span className="status-badge">{displayLabel(checklistRowStatusLabels, row.status)}</span>
                  </button>
                ))}
              </div>
            ) : null}

          </div>
        </div>
      ) : null}

      <PremiumSheet
        className="checklist-runner-actions-sheet"
        eyebrow="Чек-лист"
        open={runnerMenuOpen && Boolean(selectedRun)}
        title="Действия и периодичность"
        onClose={() => setRunnerMenuOpen(false)}
      >
        {selectedRun ? (
          <div className="premium-action-list">
            <div className="checklist-runner-details">
              <strong>{displayLabel(checklistRunStatusLabels, selectedRun.status)}</strong>
              <span>{selectedRun.frequencyLabel ?? 'Выполняется по необходимости'}</span>
              {selectedRun.checks?.length ? (
                <span>Завершено проверок: {selectedRun.checks.filter((check) => check.status === 'COMPLETED').length} · {nextCheckText(selectedRun)}</span>
              ) : null}
            </div>
            {selectedRun.status === 'ACTIVE' ? (
              <PremiumActionItem
                description="Ответы сохранятся, прохождение можно будет продолжить."
                label="Поставить на паузу"
                onClick={() => {
                  setRunnerMenuOpen(false);
                  setModal({ mode: 'pause', title: 'Пауза чек-листа', run: selectedRun });
                }}
                tone="neutral"
              />
            ) : null}
          </div>
        ) : null}
      </PremiumSheet>

      {runnerDiscardOpen ? (
        <AppConfirmDialog
          danger
          title="Ответ не сохранён"
          description="Закрыть чек-лист и потерять несохранённый ответ текущего пункта?"
          confirmLabel="Выйти без сохранения"
          cancelLabel="Остаться"
          onCancel={() => setRunnerDiscardOpen(false)}
          onConfirm={() => {
            setRunnerDiscardOpen(false);
            setSelectedRun(null);
          }}
        />
      ) : null}

      {previewTemplate ? (
        <PremiumSheet
          className="checklist-preview-sheet"
          description={[previewTemplate.lineLabel, previewTemplate.frequencyLabel].filter(Boolean).join(' · ')}
          eyebrow="Предпросмотр сотрудника"
          footer={previewRow ? (
            <>
              <button className="secondary-button" disabled={previewIndex === 0} onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))} type="button">Назад</button>
              <button
                className="primary-button"
                onClick={() => {
                  if (previewIndex >= previewRows.length - 1) setPreviewTemplate(null);
                  else setPreviewIndex((index) => Math.min(previewRows.length - 1, index + 1));
                }}
                type="button"
              >
                {previewIndex >= previewRows.length - 1 ? 'Закрыть предпросмотр' : 'Далее'}
              </button>
            </>
          ) : <button className="secondary-button" onClick={() => setPreviewTemplate(null)} type="button">Закрыть</button>}
          onClose={() => setPreviewTemplate(null)}
          open
          title={previewTemplate.name}
        >
          {previewRow && previewDraft ? (
            <div className="checklist-preview-runner">
              <div className="guided-progress focus-progress">
                <strong>Пункт {previewIndex + 1} из {previewRows.length}</strong>
                <div className="guided-progress-bar"><span style={{ width: `${Math.round(((previewIndex + 1) / Math.max(previewRows.length, 1)) * 100)}%` }} /></div>
                <span className="guided-save-state">Предпросмотр не создаёт запуск и не сохраняет ответы.</span>
              </div>
              <article className="panel-card guided-current-row preview-guided-row">
                <div className="guided-row-heading">
                  <strong>{previewRow.title}</strong>
                  {previewRow.description ? <span>{previewRow.description}</span> : null}
                  {renderRowBadges(previewRow)}
                </div>
                {renderRowEditor(previewRow, previewDraft, {
                  files: previewFilesByRow[previewRow.id] ?? [],
                  onChange: (patch) => setPreviewDrafts((current) => ({
                    ...current,
                    [previewRow.id]: { ...(current[previewRow.id] ?? emptyRowDraft()), ...patch },
                  })),
                  onFilesChange: (files) => setPreviewFilesByRow((current) => ({ ...current, [previewRow.id]: files })),
                })}
              </article>
            </div>
          ) : <div className="empty-state">В шаблоне пока нет активных пунктов.</div>}
        </PremiumSheet>
      ) : null}

      {templateBuilder && !previewTemplate && !templateBuilder.editorDraft ? (
        <PremiumSheet
          className="checklist-template-builder-sheet"
          description="Настройте назначение, расписание и пункты. Уже начатые чек-листы сохранят прежний снимок."
          eyebrow="Конструктор чек-листа"
          footer={(
            <>
              <button className="secondary-button" disabled={loading} onClick={requestCloseTemplateBuilder} type="button">Отмена</button>
              <button className="primary-button" disabled={loading} onClick={requestSubmitTemplateBuilder} type="button">
                {loading ? 'Сохраняется...' : templateBuilder.mode === 'duplicate' ? 'Создать копию' : 'Сохранить шаблон'}
              </button>
            </>
          )}
          onClose={requestCloseTemplateBuilder}
          open
          title={templateBuilder.mode === 'create' ? 'Новый шаблон' : templateBuilder.mode === 'duplicate' ? 'Копия шаблона' : 'Редактировать шаблон'}
        >
          <div className="checklist-template-builder premium-deep-form">
            {errorText ? <div className="empty-state error-state" role="alert">{errorText}</div> : null}

            <section className="checklist-builder-section">
              <div className="checklist-builder-section-heading">
                <span>1</span>
                <div><h3>Основное</h3><p>Название, отдел и место выполнения.</p></div>
              </div>
              <div className="premium-deep-form-grid">
                <label className="field-label">Название
                  <input
                    autoFocus
                    maxLength={160}
                    onChange={(event) => setTemplateBuilderValue('name', event.target.value)}
                    placeholder="Например, контроль запуска линии"
                    value={String(templateBuilder.formValues.name ?? '')}
                  />
                </label>
                <label className="field-label">Отдел или служба
                  <select value={String(templateBuilder.formValues.departmentId ?? '')} onChange={(event) => setTemplateBuilderValue('departmentId', event.target.value)}>
                    <option value="">Выберите отдел</option>
                    {departmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="field-label checklist-builder-wide-field">Описание
                  <textarea
                    onChange={(event) => setTemplateBuilderValue('description', event.target.value)}
                    placeholder="Коротко объясните цель проверки"
                    value={String(templateBuilder.formValues.description ?? '')}
                  />
                </label>
              </div>
              <fieldset className="checklist-builder-fieldset">
                <legend>Где используется</legend>
                <div className="premium-segmented-control" style={{ '--segments': 2 } as React.CSSProperties}>
                  <button aria-pressed={templateBuilder.formValues.scope !== 'LINE'} className={templateBuilder.formValues.scope !== 'LINE' ? 'active' : ''} onClick={() => setTemplateBuilderValue('scope', 'DEPARTMENT')} type="button">Общий для отдела</button>
                  <button aria-pressed={templateBuilder.formValues.scope === 'LINE'} className={templateBuilder.formValues.scope === 'LINE' ? 'active' : ''} onClick={() => setTemplateBuilderValue('scope', 'LINE')} type="button">На линии</button>
                </div>
              </fieldset>
              {templateBuilder.formValues.scope === 'LINE' ? (
                <label className="field-label">Линия
                  <select value={String(templateBuilder.formValues.lineId ?? '')} onChange={(event) => setTemplateBuilderValue('lineId', event.target.value)}>
                    <option value="">Выберите линию</option>
                    {lineOptionsForTemplate(templateBuilder.source).filter((option) => option.value).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              ) : null}
            </section>

            <section className="checklist-builder-section">
              <div className="checklist-builder-section-heading">
                <span>2</span>
                <div><h3>Периодичность</h3><p>Когда и кому доступна проверка.</p></div>
              </div>
              <div className="premium-deep-form-grid">
                <label className="field-label">Периодичность
                  <select value={String(templateBuilder.formValues.frequencyRule ?? 'MANUAL')} onChange={(event) => setTemplateBuilderValue('frequencyRule', event.target.value)}>
                    {frequencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="field-label">Смена
                  <select value={String(templateBuilder.formValues.shiftType ?? '')} onChange={(event) => setTemplateBuilderValue('shiftType', event.target.value)}>
                    {shiftOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {templateBuilder.formValues.frequencyRule === 'EVERY_N_HOURS' ? (
                  <>
                    <label className="field-label">Единица интервала
                      <select value={String(templateBuilder.formValues.frequencyIntervalUnit ?? 'HOURS')} onChange={(event) => setTemplateBuilderValue('frequencyIntervalUnit', event.target.value)}>
                        {intervalUnitOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="field-label">Значение интервала
                      <input inputMode="numeric" min="1" onChange={(event) => setTemplateBuilderValue('frequencyIntervalValue', event.target.value)} type="number" value={String(templateBuilder.formValues.frequencyIntervalValue ?? '')} />
                    </label>
                  </>
                ) : null}
                <label className="field-label">Кто может взять в работу
                  <select value={String(templateBuilder.formValues.assignmentRole ?? '')} onChange={(event) => setTemplateBuilderValue('assignmentRole', event.target.value)}>
                    {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            </section>

            <section className="checklist-builder-section checklist-template-builder-items">
              <div className="checklist-builder-section-heading with-action">
                <span>3</span>
                <div><h3>Пункты</h3><p>Этот порядок сотрудник увидит при выполнении. Копия пункта не наследует сохранённый фото-эталон: для неё выберите фото отдельно.</p></div>
                <button className="secondary-button compact-action" onClick={addBuilderRow} type="button">Добавить пункт</button>
              </div>
              {templateBuilder.rows.length ? (
                <div className="checklist-builder-row-list">
                  {templateBuilder.rows.map((row, index) => (
                    <article className={`checklist-builder-row ${row.isActive ? '' : 'inactive'}`} key={row.clientKey}>
                      <div>
                        <strong>{index + 1}. {row.title}</strong>
                        <span>{rowTypeLabel(row.rowType)}{row.isActive ? '' : ' · отключён'}</span>
                      </div>
                      <div className="button-row checklist-builder-row-actions">
                        <button aria-label="Переместить выше" className="icon-button" disabled={index === 0} onClick={() => moveBuilderRow(index, -1)} type="button">↑</button>
                        <button aria-label="Переместить ниже" className="icon-button" disabled={index === templateBuilder.rows.length - 1} onClick={() => moveBuilderRow(index, 1)} type="button">↓</button>
                        <button className="secondary-button compact-action" onClick={() => editBuilderRow(index)} type="button">Изменить</button>
                        <button className="secondary-button compact-action" onClick={() => duplicateBuilderRow(index)} type="button">Копия</button>
                        <button className={`secondary-button compact-action ${row.isActive ? 'danger' : ''}`} onClick={() => toggleBuilderRow(index)} type="button">
                          {row.isActive ? 'Отключить' : 'Включить'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="empty-state compact">Добавьте первый пункт. Пустой активный шаблон сохранить нельзя.</div>}
            </section>

            <section className="checklist-builder-section">
              <div className="checklist-builder-section-heading">
                <span>4</span>
                <div><h3>Проверка и публикация</h3><p>Посмотрите экран сотрудника перед сохранением.</p></div>
              </div>
              {templateBuilder.mode === 'edit' && templateBuilder.source?.isActive !== false ? (
                <div className="empty-state warning-state">
                  <strong>Шаблон уже используется</strong>
                  <span>Начатые чек-листы сохранят прежние пункты. Новые запуски получат обновлённую версию.</span>
                </div>
              ) : null}
              <div className="checklist-builder-publish-options">
                <label className="checkbox-row">
                  <input checked={Boolean(templateBuilder.formValues.isMandatory)} onChange={(event) => setTemplateBuilderValue('isMandatory', event.target.checked)} type="checkbox" />
                  Обязательный чек-лист
                </label>
                <label className="checkbox-row">
                  <input checked={Boolean(templateBuilder.formValues.isActive)} onChange={(event) => setTemplateBuilderValue('isActive', event.target.checked)} type="checkbox" />
                  Доступен для новых запусков
                </label>
              </div>
              {templateBuilder.mode === 'edit' ? (
                <label className="field-label">Причина изменения
                  <textarea onChange={(event) => setTemplateBuilderValue('reason', event.target.value)} placeholder="Коротко укажите, что изменилось" value={String(templateBuilder.formValues.reason ?? '')} />
                </label>
              ) : null}
              <button className="secondary-button checklist-builder-preview-button" disabled={!templateBuilder.rows.some((row) => row.isActive)} onClick={openTemplateBuilderPreview} type="button">Предпросмотр как у сотрудника</button>
            </section>
          </div>
        </PremiumSheet>
      ) : null}

      {templateBuilder?.editorDraft ? (
        <ActionModal
          busy={loading}
          cancelLabel="Отмена"
          className="checklist-item-editor-modal"
          confirmLabel="Сохранить"
          dirty={JSON.stringify(templateBuilder.editorDraft) !== JSON.stringify(templateBuilder.editorInitialDraft)}
          errorText={errorText}
          onCancel={() => {
            setTemplateBuilder({ ...templateBuilder, editorIndex: null, editorDraft: null, editorInitialDraft: null });
            setErrorText(null);
          }}
          onSubmit={() => commitBuilderEditor()}
          title={templateBuilder.editorIndex !== null && templateBuilder.editorIndex >= 0 ? 'Редактирование пункта' : 'Новый пункт'}
        >
          <ChecklistItemEditor disabled={loading} showActive value={templateBuilder.editorDraft} onChange={updateBuilderEditor} />
        </ActionModal>
      ) : null}

      {builderDiscardOpen ? (
        <AppConfirmDialog
          danger
          cancelLabel="Продолжить редактирование"
          confirmLabel="Закрыть без сохранения"
          description="Несохранённые настройки и пункты шаблона будут потеряны. Уже существующие чек-листы не изменятся."
          onCancel={() => setBuilderDiscardOpen(false)}
          onConfirm={() => {
            setBuilderDiscardOpen(false);
            setTemplateBuilder(null);
            setErrorText(null);
          }}
          title="Закрыть конструктор?"
        />
      ) : null}

      {builderPublishConfirmOpen ? (
        <AppConfirmDialog
          cancelLabel="Вернуться к проверке"
          confirmLabel="Сохранить новую версию"
          description="Уже начатые чек-листы останутся с прежним снимком пунктов. Обновлённые настройки получат только новые запуски."
          onCancel={() => setBuilderPublishConfirmOpen(false)}
          onConfirm={() => {
            setBuilderPublishConfirmOpen(false);
            void submitTemplateBuilder();
          }}
          title="Обновить активный шаблон?"
        />
      ) : null}

      {modal ? (
        <ActionModal
          busy={loading}
          cancelLabel="Отмена"
          confirmLabel={
            modal.mode === 'start'
              ? 'Взять в работу'
              : modal.mode === 'close'
                ? isPeriodicChecklistRun(modal.run) ? 'Завершить чек-лист полностью' : 'Завершить чек-лист'
                : modal.mode === 'resume'
                  ? 'Возобновить'
                  : modal.mode === 'archive-row' || modal.mode === 'archive-template'
                    ? 'Подтвердить'
                    : 'Сохранить'
          }
          errorText={errorText}
          fields={
            modal.mode === 'pause'
              ? [{ name: 'reason', label: 'Причина паузы', type: 'textarea', required: requirePauseComment }]
              : modal.mode === 'close'
                ? [{
                    name: 'comment',
                    label: isPeriodicChecklistRun(modal.run) ? 'Причина досрочного завершения' : 'Причина завершения',
                    type: 'textarea',
                    required: true,
                  }]
                : modal.mode === 'edit-template'
                  ? templateFields(modal.template)
                  : modal.mode === 'create-template'
                    ? templateFields()
                    : []
          }
          onCancel={() => {
            setFilesByRow({});
            setStandaloneRowDraft(null);
            setModal(null);
          }}
          onSubmit={submitModal}
          title={modal.title}
        >
          {modal.mode === 'archive-template' || modal.mode === 'restore-template' || modal.mode === 'start' || modal.mode === 'resume' || modal.mode === 'archive-row' ? (
            <p>{'templateRow' in modal ? modal.templateRow.title : 'template' in modal ? modal.template.name : modal.run.template?.name}</p>
          ) : null}
          {modal.mode === 'pause' ? (
            <div className="checklist-pause-confirmation">
              <strong>{modal.run.template?.name ?? 'Чек-лист'}</strong>
              <span>{modal.run.lineName ? `Связанная линия: ${modal.run.lineName}` : 'Без привязки к линии'}</span>
              <span>Время начала паузы сохранит сервер после подтверждения.</span>
              <span>Пауза не завершает чек-лист и не меняет статус линии.</span>
            </div>
          ) : null}
          {modal.mode === 'create-row' || modal.mode === 'edit-row' ? (
            standaloneRowDraft ? (
              <ChecklistItemEditor disabled={loading} showActive={modal.mode === 'edit-row'} value={standaloneRowDraft} onChange={setStandaloneRowDraft} />
            ) : null
          ) : null}
          {modal.mode === 'create-template' || modal.mode === 'edit-template' ? (
            <p className="field-hint">Кому предназначен: выберите отдел, линию, смену, периодичность и роль, которая сможет взять чек-лист в работу.</p>
          ) : null}
        </ActionModal>
      ) : null}
    </section>
  );
}
