import { useSyncExternalStore } from 'react';

export const DEV_USER_STORAGE_KEY = 'zavod.devUserId';
export const SELECTED_FACTORY_STORAGE_KEY = 'zavod.selectedFactoryId';
export const AUTH_TOKEN_STORAGE_KEY = 'zavod.authToken';

export type AuthStatus = 'loading' | 'ready' | 'error' | 'noFactories';

export type CurrentUser = {
  userId: string;
  role: string;
  departmentId: string | null;
  departmentName?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  jobTitleName?: string | null;
  displayName?: string | null;
  permissions: string[];
  isAdmin: boolean;
  isGuest: boolean;
};

export type AvailableFactory = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  role: string;
  departmentName: string | null;
  companyName?: string | null;
  isGuest: boolean;
};

export type LineStatus = 'STOP' | 'PAUSE' | 'WORK' | 'PLAN' | 'PLANNING';
export type LineOperationalState = 'RUNNING' | 'DOWNTIME' | 'WASH' | 'DEFROST' | 'STOPPED';

export type LineTaskSummary = {
  taskId: string;
  taskStatus: 'NEW' | 'IN_PROGRESS';
  taskStatusLabel: string;
  taskType: 'URGENT' | 'LONG';
  taskTypeLabel: string;
  serviceLabel?: string | null;
  assigneeDisplayName?: string | null;
  hasAssignee: boolean;
  createdAt: string;
  startedAt?: string | null;
  deadlineAt?: string | null;
  overdue?: boolean;
  sourceKind: 'LINE' | 'DOWNTIME';
  sourceLabel: string;
  canOpen: boolean;
  additionalActiveCount?: number;
};

export type Line = {
  id: string;
  lineId?: string;
  factoryId?: string;
  name: string;
  status: LineStatus;
  version?: number;
  defaultStaffingTemplateId?: string | null;
  operationalState?: LineOperationalState;
  operationalStateStartedAt?: string | null;
  currentRunStartedAt?: string | null;
  continuesFromPreviousShift?: boolean;
  continuationLabel?: string | null;
  productionShiftId?: string;
  productionShiftDate?: string;
  productionShiftType?: 'DAY' | 'NIGHT';
  assignedCount?: number;
  requiredCount?: number;
  productionStaffAssignedCount?: number;
  productionStaffRequiredCount?: number;
  includedInProductionStaffTotal?: boolean;
  activeAssignments?: Array<{
    id: string;
    userId: string;
    positionId?: string | null;
    slotIndex?: number | null;
    displayName?: string | null;
    positionName?: string | null;
    startedAt?: string;
  }>;
  activeAssignmentsRedacted?: boolean;
  selectedComposition?: { id: string; name: string } | null;
  requiredProductionPositions?: Array<{ positionId: string; positionName: string; requiredCount: number }>;
  positions?: LinePosition[];
  staffingTemplates?: LineStaffingTemplate[];
  activeWorkersCount?: number;
  activeTemplate?: LineStaffingTemplate | null;
  structureConfigured?: boolean;
  structureMessage?: string | null;
  shortageSummary?: ShortageItem[] | null;
  activeTasksCount?: number;
  activeTaskSummary?: LineTaskSummary | null;
  activeWash?: { id: string; status: string; createdAt: string } | null;
  activeDefrost?: { id: string; status: string; startAt: string; comment?: string | null } | null;
  activeDowntimeEvent?: {
    id: string;
    status: LineStatus;
    createdAt: string;
    comment?: string | null;
    downtimeReason?: string | null;
    downtimeReasonLabel?: string | null;
    confirmedEndAt?: string | null;
    correctedStartAt?: string | null;
    correctedEndAt?: string | null;
  } | null;
  isActiveForShift?: boolean;
};

export type LinePosition = {
  id: string;
  factoryId?: string;
  lineId: string;
  name: string;
  displayName?: string | null;
  normalizedName?: string | null;
  skillCode?: string | null;
  skillFamilyKey?: string | null;
  isExtraSlot?: boolean;
  doesNotAffectShortage?: boolean;
  sortOrder: number;
  isActive: boolean;
};

export type LineStaffingTemplate = {
  id: string;
  factoryId?: string;
  lineId: string;
  name: string;
  isActive: boolean;
  items?: Array<{
    id: string;
    positionId: string;
    requiredCount: number;
    minRequired?: number | null;
    maxRequired?: number | null;
    defaultPlanned?: number | null;
    plannedCount?: number | null;
    isFlexible?: boolean;
    isExtraSlot?: boolean;
    doesNotAffectShortage?: boolean;
    sortOrder: number;
    position?: LinePosition;
  }>;
};

export type ShortageItem = {
  positionId: string;
  positionName: string;
  displayName?: string | null;
  skillCode?: string | null;
  minRequired?: number | null;
  maxRequired?: number | null;
  defaultPlanned?: number | null;
  plannedCount?: number | null;
  isFlexible?: boolean;
  isExtraSlot?: boolean;
  doesNotAffectShortage?: boolean;
  required: number;
  actual: number;
  missing: number;
  canAddMore?: boolean;
};

export type Employee = {
  id: string;
  name: string;
};

export type Task = {
  id: string;
  title?: string;
  description?: string;
  type?: 'URGENT' | 'LONG';
  lineId?: string;
  lineName?: string | null;
  status: 'NEW' | 'IN_PROGRESS' | 'DONE' | 'new' | 'taken' | 'completed';
  assigneeId?: string;
  assigneeName?: string | null;
  createdByName?: string | null;
  takenByName?: string | null;
  doneByName?: string | null;
  deadlineAt?: string | null;
  overdue?: boolean;
  escalatedAt?: string | null;
  recipients?: Array<{ departmentId: string; departmentName: string | null; scope?: string | null }>;
  assignees?: Array<{ userId: string; displayName: string; isPrimary?: boolean }>;
  comments?: Array<{ id: string; message: string; userId: string; authorName?: string | null; createdAt?: string; attachments?: Attachment[] }>;
  commentsCount?: number;
  readsCount?: number;
  createdAt?: string;
  startedAt?: string | null;
  doneAt?: string | null;
  takenAt?: string | null;
  responseMinutes?: number | null;
  executionMinutes?: number | null;
  resolutionMinutes?: number | null;
  lineStatusEventId?: string | null;
  attachments?: Attachment[];
};

export type WashIssue = {
  id: string;
  text?: string;
  title?: string | null;
  description?: string | null;
  message?: string | null;
    status?: 'OPEN' | 'RESOLVING' | 'RESOLVED' | string;
    resolvedAt?: string | null;
    resolveComment?: string | null;
    createdByName?: string | null;
    assignedToName?: string | null;
    resolvedByName?: string | null;
    attachments?: Attachment[];
  };
export type WashMessage = { id: string; message: string; createdAt?: string; userId?: string; authorName?: string | null; attachments?: Attachment[] };
export type WashEvent = { id: string; type: string; typeLabel?: string; text?: string | null; createdAt?: string; actorId?: string | null; actorName?: string | null };
export type WashControlItem = {
  id: string;
  title: string;
  description?: string | null;
  type?: 'CONTROL' | 'MINI_TASK' | string;
    status?: 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | string;
    statusLabel?: string | null;
    requiresPhoto?: boolean;
    doneComment?: string | null;
    createdAt?: string;
    doneAt?: string | null;
    createdByName?: string | null;
    assignedToName?: string | null;
    doneByName?: string | null;
    attachments?: Attachment[];
  };
export type WashOkkReview = {
  id: string;
  status: 'APPROVED' | 'REJECTED' | 'NEEDS_REWORK' | string;
  rating?: number | null;
    comment: string;
    createdAt?: string;
    okkUserName?: string | null;
    attachments?: Attachment[];
  };
export type WashSession = {
  id: string;
  lineId?: string | null;
  lineName?: string | null;
  targetType?: 'LINE' | 'OTHER' | string;
  objectName?: string | null;
  objectDescription?: string | null;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string | null;
  durationSeconds?: number;
  serverNow?: string;
  status?: string;
    lifecycleStatus?: 'STARTED' | 'ISSUE' | 'RESOLVING' | 'COMPLETED' | string;
    lifecycleLabel?: string;
    active: boolean;
  messages: WashMessage[];
  issues: WashIssue[];
  events?: WashEvent[];
  controlItems?: WashControlItem[];
  okkReviews?: WashOkkReview[];
  openIssuesCount?: number;
    openControlItemsCount?: number;
    okkReviewStatus?: string | null;
    canViewControl?: boolean;
    startedByName?: string | null;
    participants?: Array<{ userId: string; displayName: string; startedAt?: string; endedAt?: string | null }>;
    participantsHistory?: Array<{ userId: string; displayName: string; startedAt?: string; endedAt?: string | null }>;
    attachments?: Attachment[];
  };

export type Attachment = {
  id: string;
  entityType: string;
  entityId: string;
  kind: 'PHOTO' | 'FILE' | 'VIDEO' | 'AUDIO';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  publicUrl?: string | null;
  createdAt?: string;
  uploadedById?: string;
};
export type OkkRecord = {
  id: string;
  description: string;
  status: 'BLOCKED' | 'DECISION' | 'CLOSED' | 'UNBLOCKED' | 'COMPLETION_PENDING' | 'COMPLETED' | 'ARCHIVED' | string;
  lineId?: string;
  assignedMasterId?: string;
  defectDate?: string | null;
  productionDate?: string | null;
  shiftLabel?: string | null;
  article?: string | null;
  productName?: string | null;
  mismatchReason?: string | null;
  defectQuantity?: string | null;
  decision?: string | null;
  masterUserId?: string | null;
  masterNameSnapshot?: string | null;
  assignedMasterName?: string | null;
  temperatureAfterExtraFreeze?: string | null;
  completionMark?: string | null;
  unblockDate?: string | null;
  completedByUserId?: string | null;
  completedByNameSnapshot?: string | null;
  blockedByUserId?: string | null;
  blockedByNameSnapshot?: string | null;
  correctiveActions?: string | null;
  archivedAt?: string | null;
  attachments?: Attachment[];
  quantitySummary?: QuantitySummary | null;
  releaseHistory?: QuantityReleaseHistory[];
  availableActions?: string[];
};
export type StockDefect = {
  id: string;
  productName?: string | null;
  name?: string | null;
  displayName?: string | null;
  quantity: number;
  unit?: string | null;
  status: 'NEW' | 'ON_STOCK' | 'ISSUED' | 'ARCHIVED';
  comment?: string | null;
  attachments?: Attachment[];
};
export type ReturnItem = {
  id: string;
  description: string;
  photoUrl: string;
  createdAt?: string;
  receivedAt?: string | null;
  productionDate?: string | null;
  article?: string | null;
  productName?: string | null;
  mismatchReason?: string | null;
  quantity?: number | null;
  unit?: string | null;
  lineId?: string | null;
  line?: { id: string; name: string } | null;
  decision?: string | null;
  completionMark?: string | null;
  completedByUserId?: string | null;
  completedByNameSnapshot?: string | null;
  correctiveActionsComment?: string | null;
  status?: 'ACTIVE' | 'COMPLETION_MARKED' | 'COMPLETED' | 'ARCHIVED' | string;
  archivedAt?: string | null;
  retentionDays?: number;
  attachments?: Attachment[];
  author?: { id: string; displayName?: string | null; role?: string | null; roleLabel?: string | null } | null;
  availableActions?: string[];
  quantitySummary?: QuantitySummary | null;
  releaseHistory?: QuantityReleaseHistory[];
};

export type QuantitySummary = {
  original: string;
  released: string;
  remaining: string;
  unit: string | null;
  canRelease: boolean;
  unavailableReason?: string | null;
};

export type QuantityReleaseHistory = {
  id: string;
  sourceType: 'OKK' | 'RETURN';
  sourceId: string;
  actorName: string;
  quantity: string;
  unit: string;
  quantityBefore: string;
  quantityAfter: string;
  comment: string;
  createdAt: string;
};
export type ShiftLogHandoverItem = {
  id: string;
  title: string;
  statusLabel: string;
  currentStatusLabel?: string | null;
  alreadyCompleted?: boolean;
  durationLabel?: string | null;
  reason?: string | null;
  description?: string | null;
};

export type ShiftLogHandoverSnapshot = {
  shiftDate: string;
  shiftType: string;
  shiftLabel: string;
  departmentName: string;
  generatedAt: string;
  authorName: string;
  comment?: string | null;
  counts: { lines: number; washes: number; tasks: number; defrosts: number; people: number; importantLogs: number; total: number };
  sections: {
    lines: ShiftLogHandoverItem[];
    washes: ShiftLogHandoverItem[];
    tasks: ShiftLogHandoverItem[];
    defrosts: ShiftLogHandoverItem[];
    people: ShiftLogHandoverItem[];
    importantLogs: ShiftLogHandoverItem[];
  };
};

export type ShiftLog = {
  archiveReadOnly?: boolean;
  id: string;
  title?: string | null;
  text: string;
  departmentId?: string | null;
  departmentName?: string | null;
  logDate?: string | null;
  shiftLabel?: string | null;
  isImportant?: boolean;
  importantUntil?: string | null;
  status?: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  readCount?: number;
  attachments?: Attachment[];
  comments?: { id: string; text: string; attachments?: Attachment[] }[];
  availableActions?: string[];
  handover?: { snapshot: ShiftLogHandoverSnapshot; immutable: boolean; liveStatusCheckedAt?: string } | null;
};

export type NotificationItem = {
  id: string;
  factoryId?: string | null;
  departmentId?: string | null;
  userId?: string | null;
  type: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  sourceRoute?: string | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  readAt?: string | null;
  createdAt: string;
  expiresAt?: string | null;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  operationId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  authorContext?: string | null;
  authorProfile?: {
    userId: string;
    displayName: string;
    roleLabel?: string | null;
    departmentName?: string | null;
  } | null;
  replyToMessageId?: string | null;
  replyTo?: {
    id: string;
    authorName?: string | null;
    text: string;
    deleted?: boolean;
  } | null;
  kind: 'USER' | 'SYSTEM' | string;
  text: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  deleted?: boolean;
  attachments?: Attachment[];
  poll?: {
    id: string;
    question: string;
    anonymous: boolean;
    multipleChoice: boolean;
    allowRevote: boolean;
    isActive: boolean;
    votersCount: number;
    mineOptionIds: string[];
    options: Array<{
      id: string;
      text: string;
      count: number;
      percent: number;
      mine?: boolean;
      users?: string[];
    }>;
  } | null;
  reactions?: Array<{
    emoji: string;
    count: number;
    mine?: boolean;
    users?: string[];
  }>;
};

export type ChatItem = {
  id: string;
  factoryId?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
    type: 'FACTORY' | 'DEPARTMENT' | 'MANAGEMENT' | 'SYSTEM' | 'CUSTOM' | 'DIRECT' | string;
    title: string;
    displayTitle?: string | null;
    typeLabel?: string | null;
    directUser?: {
      userId: string;
      displayName: string;
      roleLabel?: string | null;
      departmentName?: string | null;
    } | null;
    description?: string | null;
  isActive: boolean;
  isHidden: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  unreadCount?: number;
  membersCount?: number;
  membersSummary?: Array<{
    id?: string;
    targetType: 'USER' | 'DEPARTMENT' | 'ROLE' | string;
    userId?: string | null;
    roleCode?: string | null;
    departmentId?: string | null;
    displayName: string;
    departmentName?: string | null;
    roleLabel?: string | null;
      canRead: boolean;
      canWrite: boolean;
      canManage: boolean;
      membershipRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | string;
      membershipRoleLabel?: string | null;
      hiddenAt?: string | null;
      communicationBlockedAt?: string | null;
      leftAt?: string | null;
      removedAt?: string | null;
      isActive?: boolean;
    }>;
  latestMessage?: ChatMessage | null;
  messages?: ChatMessage[];
  availableActions?: string[];
  membershipRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  communicationBlocked?: boolean;
  communicationBlockedByMe?: boolean;
};

export type AnnouncementItem = {
  id: string;
  factoryId?: string | null;
  departmentId?: string | null;
  audienceType?: 'FACTORY' | 'MY_DEPARTMENT' | 'SELECTED' | string;
  departmentIds?: string[];
  audienceDepartments?: Array<{ id: string; name: string }>;
  title: string;
  text: string;
  priority: 'NORMAL' | 'IMPORTANT' | string;
  recurrence?: 'NONE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | string;
  recurrenceLabel?: string;
  visibleFrom: string;
  visibleUntil: string;
    archivedAt?: string | null;
    readAt?: string | null;
    acknowledgedAt?: string | null;
    isActive?: boolean;
    isArchived?: boolean;
    scopeLabel?: string;
    department?: { id: string; name: string } | null;
    author?: { id: string; role: string; displayName?: string | null; roleLabel?: string | null } | null;
  attachments?: Attachment[];
  availableActions?: string[];
};

export type ShiftPerson = {
  userId: string;
  companyName?: string | null;
  displayName: string;
  role: string;
  departmentId: string | null;
  departmentName?: string | null;
  profilePhoto?: Attachment | null;
  category?: string | null;
  onShift?: boolean;
  employeeState: 'AVAILABLE' | 'ASSIGNED' | 'WASHING' | 'TIME_ROLE' | 'OFF_SHIFT';
  currentAssignment: {
    id?: string | null;
    kind: 'LINE' | 'WASH' | 'TIME' | 'WORK_AREA';
    lineId?: string | null;
    lineName?: string | null;
    positionId?: string | null;
    positionName?: string | null;
    staffingTemplateId?: string | null;
    staffingTemplateName?: string | null;
    washSessionId?: string | null;
    workAreaId?: string | null;
    workAreaPositionId?: string | null;
    slotIndex?: number | null;
    timeRoleName?: string | null;
    startedAt: string;
  } | null;
};

type AppState = {
  currentUser: CurrentUser | null;
  availableFactories: AvailableFactory[];
  selectedFactoryId: string;
  authStatus: AuthStatus;
  authError: string | null;
  authToken: string;

  /**
   * Compatibility aliases for existing prototype screens.
   * New code should use currentUser.userId and selectedFactoryId.
   */
  userId: string;
  factoryId: string;

  lines: Line[];
  lineWorkers: Record<string, Employee[]>;
  tasks: Task[];
  washSessions: WashSession[];
  okkRecords: OkkRecord[];
  stock: StockDefect[];
  returns: ReturnItem[];
  shiftLogs: ShiftLog[];
  notificationsUnreadCount: number;
  announcementsUnreadCount: number;
  chatsUnreadCount: number;
  tasksAttentionCount: number;
};

function safeLocalStorageGet(key: string) {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private/offline contexts.
  }
}

function createInitialState(): AppState {
  const userId = safeLocalStorageGet(DEV_USER_STORAGE_KEY);
  const selectedFactoryId = safeLocalStorageGet(SELECTED_FACTORY_STORAGE_KEY);

  return {
    currentUser: userId
      ? { userId, role: 'OTHER', departmentId: null, permissions: [], isAdmin: false, isGuest: true }
      : null,
    availableFactories: [],
    selectedFactoryId,
    authStatus: 'loading',
    authError: null,
    authToken: safeLocalStorageGet(AUTH_TOKEN_STORAGE_KEY),
    userId,
    factoryId: selectedFactoryId,
    lines: [],
    lineWorkers: {},
    tasks: [],
    washSessions: [],
    okkRecords: [],
    stock: [],
    returns: [],
    shiftLogs: [],
    notificationsUnreadCount: 0,
    announcementsUnreadCount: 0,
    chatsUnreadCount: 0,
    tasksAttentionCount: 0,
  };
}

let state: AppState = createInitialState();

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function clearFactoryScopedData(next: AppState): AppState {
  return {
    ...next,
    lines: [],
    lineWorkers: {},
    tasks: [],
    washSessions: [],
    okkRecords: [],
    stock: [],
    returns: [],
    shiftLogs: [],
    notificationsUnreadCount: 0,
    announcementsUnreadCount: 0,
    chatsUnreadCount: 0,
    tasksAttentionCount: 0,
  };
}

function clearFactoryScopedSessionState() {
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith('zavod.session.') || key?.startsWith('zavod.pending') || key === 'zavod.chat.returnState') {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Session recovery is best-effort in private/offline contexts.
  }
}

export const appStore = {
  getState: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setAuthLoading: () => {
    state = { ...state, authStatus: 'loading', authError: null };
    notify();
  },
  setAuthError: (message: string) => {
    state = { ...state, authStatus: 'error', authError: message };
    notify();
  },
  setSession: (params: {
    currentUser: CurrentUser | null;
    availableFactories: AvailableFactory[];
    selectedFactoryId?: string | null;
    authStatus?: AuthStatus;
    authToken?: string | null;
  }) => {
    const hasSelectedFactoryParam = Object.prototype.hasOwnProperty.call(params, 'selectedFactoryId');
    const selectedFactoryId = hasSelectedFactoryParam ? (params.selectedFactoryId ?? '') : state.selectedFactoryId;
    const userId = params.currentUser?.userId ?? state.userId;
    const hasAuthTokenParam = Object.prototype.hasOwnProperty.call(params, 'authToken');
    const authToken = hasAuthTokenParam ? (params.authToken ?? '') : state.authToken;

    if (userId) safeLocalStorageSet(DEV_USER_STORAGE_KEY, userId);
    if (selectedFactoryId) safeLocalStorageSet(SELECTED_FACTORY_STORAGE_KEY, selectedFactoryId);
    if (hasSelectedFactoryParam && !selectedFactoryId) {
      try {
        window.localStorage.removeItem(SELECTED_FACTORY_STORAGE_KEY);
      } catch {
        // Storage may be unavailable in private/offline contexts.
      }
    }
    if (authToken) safeLocalStorageSet(AUTH_TOKEN_STORAGE_KEY, authToken);
    if (hasAuthTokenParam && !authToken) {
      try {
        window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      } catch {
        // Storage may be unavailable in private/offline contexts.
      }
    }

    const nextState = {
      ...state,
      currentUser: params.currentUser,
      availableFactories: params.availableFactories,
      selectedFactoryId,
      authStatus: params.authStatus ?? (params.availableFactories.length ? 'ready' : 'noFactories'),
      authError: null,
      authToken,
      userId,
      factoryId: selectedFactoryId,
    };
    if (selectedFactoryId !== state.selectedFactoryId) clearFactoryScopedSessionState();
    state = selectedFactoryId !== state.selectedFactoryId ? clearFactoryScopedData(nextState) : nextState;
    notify();
  },
  selectFactory: (factoryId: string) => {
    safeLocalStorageSet(SELECTED_FACTORY_STORAGE_KEY, factoryId);
    clearFactoryScopedSessionState();
    state = clearFactoryScopedData({ ...state, selectedFactoryId: factoryId, factoryId });
    notify();
  },
  setDevUserId: (userId: string) => {
    safeLocalStorageSet(DEV_USER_STORAGE_KEY, userId);
    state = { ...state, userId, currentUser: state.currentUser ? { ...state.currentUser, userId } : null };
    notify();
  },
  setAuthToken: (token: string) => {
    safeLocalStorageSet(AUTH_TOKEN_STORAGE_KEY, token);
    state = { ...state, authToken: token };
    notify();
  },
  clearAuth: () => {
    try {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(DEV_USER_STORAGE_KEY);
      window.localStorage.removeItem(SELECTED_FACTORY_STORAGE_KEY);
      clearFactoryScopedSessionState();
    } catch {
      // Storage may be unavailable in private/offline contexts.
    }
    state = clearFactoryScopedData({
      ...state,
      currentUser: null,
      availableFactories: [],
      selectedFactoryId: '',
      authStatus: 'ready',
      authError: null,
      authToken: '',
      userId: '',
      factoryId: '',
    });
    notify();
  },
  setLines: (lines: Line[]) => { state = { ...state, lines }; notify(); },
  setLineWorkers: (lineId: string, workers: Employee[]) => {
    state = { ...state, lineWorkers: { ...state.lineWorkers, [lineId]: workers } };
    notify();
  },
  setTasks: (tasks: Task[]) => { state = { ...state, tasks }; notify(); },
  setWashSessions: (washSessions: WashSession[]) => { state = { ...state, washSessions }; notify(); },
  patchWashSession: (sessionId: string, patch: Partial<WashSession>) => {
    state = {
      ...state,
      washSessions: state.washSessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)),
    };
    notify();
  },
  setOkkRecords: (okkRecords: OkkRecord[]) => { state = { ...state, okkRecords }; notify(); },
  setStock: (stock: StockDefect[]) => { state = { ...state, stock }; notify(); },
  setReturns: (returns: ReturnItem[]) => { state = { ...state, returns }; notify(); },
  setShiftLogs: (shiftLogs: ShiftLog[]) => { state = { ...state, shiftLogs }; notify(); },
  setNotificationsUnreadCount: (notificationsUnreadCount: number) => { state = { ...state, notificationsUnreadCount }; notify(); },
  setAnnouncementsUnreadCount: (announcementsUnreadCount: number) => { state = { ...state, announcementsUnreadCount }; notify(); },
  setChatsUnreadCount: (chatsUnreadCount: number) => { state = { ...state, chatsUnreadCount }; notify(); },
  setTasksAttentionCount: (tasksAttentionCount: number) => { state = { ...state, tasksAttentionCount }; notify(); },
};

export function getApiContext() {
  return {
    userId: state.currentUser?.userId || state.userId || safeLocalStorageGet(DEV_USER_STORAGE_KEY),
    factoryId: state.selectedFactoryId || safeLocalStorageGet(SELECTED_FACTORY_STORAGE_KEY),
    authToken: state.authToken || safeLocalStorageGet(AUTH_TOKEN_STORAGE_KEY),
  };
}

export function useAppStore(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.getState, appStore.getState);
}
