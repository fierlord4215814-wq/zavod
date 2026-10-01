import * as React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from './api/client';
import { canShowScreen, defaultQuickScreenIds, NavIconName, roleHomeScreen, SCREEN_DEFINITIONS, Screen, ScreenDefinition } from './navigation/permissions';
import { AdminConfigScreen } from './screens/AdminConfigScreen';
import { FactorySelectScreen } from './screens/FactorySelectScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { OpsAuditScreen } from './screens/OpsAuditScreen';
import { OkkScreen } from './screens/OkkScreen';
import { ReturnsScreen } from './screens/ReturnsScreen';
import { OrdersStockScreen } from './screens/OrdersStockScreen';
import { ChecklistsScreen } from './screens/ChecklistsScreen';
import { DefrostScreen } from './screens/DefrostScreen';
import { ChatsScreen } from './screens/ChatsScreen';
import { AnnouncementsScreen } from './screens/AnnouncementsScreen';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { BugReportScreen } from './screens/BugReportScreen';
import { AppConfirmDialog } from './components/AppConfirmDialog';
import { GuestHomeScreen } from './screens/GuestHomeScreen';
import { PeopleScreen, PeopleTaskReturn } from './screens/PeopleScreen';
import { ShiftLogScreen } from './screens/ShiftLogScreen';
import { ShiftPeopleScreen, ShiftTaskReturn } from './screens/ShiftPeopleScreen';
import { SituationScreen, SituationTaskReturn } from './screens/SituationScreen';
import { StockScreen } from './screens/StockScreen';
import { TasksScreen } from './screens/TasksScreen';
import { WashScreen } from './screens/WashScreen';
import { appStore, AvailableFactory, CurrentUser, NotificationItem, useAppStore } from './store/app.store';
import { connectWs } from './ws/client';
import { hasDirtyMobileForm, hasDirtyMobileForms, installMobileBackCoordinator, leaveStandaloneApp, useMobileBackLayer } from './navigation/mobile-back';
import { useBodyScrollLock } from './hooks/useBodyScrollLock';
import { isStandalonePwa } from './utils/pwa-runtime';
import { observePwaInstall } from './utils/pwa-install';
import { PwaInstallButton } from './components/PwaInstallButton';
import { DeviceAccessPanel } from './components/DeviceAccessPanel';
import { roleLabel } from './labels';
import { AppTheme, applyAppTheme, persistAppTheme, readAppTheme } from './theme';
import {
  BROWSER_NOTIFY_STORAGE_KEY,
  browserNotificationPermission,
  notificationFlags,
  NOTIFICATION_NAVIGATION_EVENT,
  NotificationNavigationIntent,
  playNotificationSound,
  requestBrowserNotificationPermission,
  setNotificationFlag,
  signalImportantNotification,
  SOUND_STORAGE_KEY,
  VIBRATION_STORAGE_KEY,
  vibrateNotification,
} from './notifications/browser-notifications';

void React;

type PushStatus = {
  available: boolean;
  publicKey: string | null;
  reason?: string;
  activeSubscriptions: number;
};

type DevLoginResponse = {
  userId: string;
  availableFactories: AvailableFactory[];
  recommendedFactoryId: string | null;
};

type MeResponse = {
  userId: string;
  selectedFactoryId: string;
  role: string;
  departmentId: string | null;
  companyId?: string | null;
  permissions: string[];
  isAdmin: boolean;
  isGuest: boolean;
  displayName?: string | null;
  jobTitleName?: string | null;
  departmentName?: string | null;
  companyName?: string | null;
  availableFactories: AvailableFactory[];
};

type DirtyNavigation =
  | { kind: 'screen'; next: Screen; remember: boolean; taskIntent?: {
      id: string; context: string; epoch: number; source: Screen;
      returnValue?: PeopleTaskReturn | ShiftTaskReturn | SituationTaskReturn;
    } }
  | { kind: 'exit' };

const screens = SCREEN_DEFINITIONS;
const THEME_OPTIONS: Array<{ id: AppTheme; label: string }> = [
  { id: 'dark', label: 'Тёмная' },
  { id: 'gray', label: 'Серая' },
  { id: 'light', label: 'Светлая' },
];

const NOTIFICATIONS_REFRESH_INTERVAL_MS = 8000;
const SESSION_ROUTE_PREFIX = 'zavod.session.route';
const SESSION_SCROLL_PREFIX = 'zavod.session.scroll';
const QUICK_NAV_PREFIX = 'zavod.quick-nav';

function safeSessionGet(key: string) {
  try { return window.sessionStorage.getItem(key) ?? ''; } catch { return ''; }
}

function safeSessionSet(key: string, value: string) {
  try { window.sessionStorage.setItem(key, value); } catch { /* Session recovery is best-effort. */ }
}

function safeLocalJson(key: string): Screen[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is Screen => typeof item === 'string') : [];
  } catch { return []; }
}

function safeLocalHas(key: string) {
  try { return window.localStorage.getItem(key) !== null; } catch { return false; }
}

function toCurrentUser(response: MeResponse): CurrentUser {
  return {
    userId: response.userId,
    role: response.role,
    departmentId: response.departmentId,
    companyId: response.companyId ?? null,
    permissions: response.permissions,
    isAdmin: response.isAdmin,
    isGuest: response.isGuest,
    displayName: response.displayName ?? null,
    jobTitleName: response.jobTitleName ?? null,
    departmentName: response.departmentName ?? null,
    companyName: response.companyName ?? null,
  };
}

function compactPersonName(value?: string | null) {
  const clean = String(value ?? '').replace(/^PILOT\s+/i, '').trim();
  if (!clean) return '';
  const parts = clean.split(/\s+/);
  const initialParts = parts.slice(-2).filter((part) => /^[А-ЯЁA-Z]\.?$/u.test(part));
  if (initialParts.length === 2 && parts.length >= 3) return `${parts[parts.length - 3]} ${initialParts.join(' ')}`;
  if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}.`;
  return clean;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

const navIconPaths: Record<NavIconName, React.ReactNode> = {
  home: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10.5V20h11v-9.5" /><path d="M9 20v-5h6v5" /></>,
  shift: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10.5V20h11v-9.5" /><path d="M9 20v-5h6v5" /></>,
  people: <><path d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M15.5 10a2.5 2.5 0 1 0 0-5" /><path d="M3.5 20a5 5 0 0 1 10 0" /><path d="M13.5 18.5a4.5 4.5 0 0 1 7 1.5" /></>,
  admin: <><path d="M12 3.5 19 7v5c0 4.2-2.9 7.2-7 8.5-4.1-1.3-7-4.3-7-8.5V7l7-3.5Z" /><path d="M9.5 12.5 11.2 14l3.6-4" /></>,
  lines: <><path d="M3 13h3l2-5 4 10 3-8 2 3h4" /></>,
  tasks: <><path d="M8 4h8l1 3h3v13H4V7h3l1-3Z" /><path d="M8 11h8" /><path d="M8 15h6" /></>,
  wash: <><path d="M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10Z" /><path d="M9 14a3 3 0 0 0 4 2.7" /></>,
  quality: <><path d="M12 3.5 19 7v5c0 4.2-2.9 7.2-7 8.5-4.1-1.3-7-4.3-7-8.5V7l7-3.5Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  stock: <><path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z" /><path d="M4 8.5V16l8 4 8-4V8.5" /><path d="M12 13v7" /></>,
  orders: <><path d="M5 6h14v13H5z" /><path d="M8 6a4 4 0 0 1 8 0" /><path d="M8 12h8" /><path d="M8 16h5" /></>,
  checklists: <><path d="M6 4h12v16H6z" /><path d="m8.5 9 1.2 1.2L12 8" /><path d="M13.5 9.5H16" /><path d="m8.5 15 1.2 1.2L12 14" /><path d="M13.5 15.5H16" /></>,
  defrost: <><path d="M12 3v18" /><path d="M5 7l14 10" /><path d="M19 7 5 17" /><path d="M8 3.5 12 7l4-3.5" /><path d="M8 20.5 12 17l4 3.5" /></>,
  returns: <><path d="M7 7h9a4 4 0 0 1 0 8H6" /><path d="m8.5 4.5-4 4 4 4" /><path d="M4.5 8.5H16" /></>,
  log: <><path d="M6 4h10l2 2v14H6z" /><path d="M16 4v4h4" /><path d="M9 11h6" /><path d="M9 15h6" /></>,
  chats: <><path d="M5 6h14v10H8l-3 3V6Z" /><path d="M8 10h8" /><path d="M8 13h5" /></>,
  announcements: <><path d="M4 13V8l11-3v11L4 13Z" /><path d="M8 14l2 5" /><path d="M17 8.5a3 3 0 0 1 0 4.5" /></>,
  archive: <><path d="M4 7h16v13H4z" /><path d="M4 7l2-3h12l2 3" /><path d="M9 12h6" /></>,
  notifications: <><path d="M18 10a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" /><path d="M9.5 19a2.5 2.5 0 0 0 5 0" /></>,
  ops: <><path d="M5 19V9" /><path d="M12 19V5" /><path d="M19 19v-7" /><path d="M3.5 19.5h17" /></>,
  report: <><path d="M12 3 3.5 19h17L12 3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="M4.5 12h2" /><path d="M17.5 12h2" /><path d="m6.7 6.7 1.4 1.4" /><path d="m15.9 15.9 1.4 1.4" /><path d="m17.3 6.7-1.4 1.4" /><path d="m8.1 15.9-1.4 1.4" /></>,
  more: <><path d="M5 12h.01" /><path d="M12 12h.01" /><path d="M19 12h.01" /></>,
};

function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg className="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {navIconPaths[name]}
    </svg>
  );
}

function devicePushSummary(pushStatus: PushStatus | null) {
  if (pushStatus?.available) return 'Уведомления устройства можно включить для этого браузера.';
  const reason = pushStatus?.reason?.trim();
  if (!reason) return 'Внутренние уведомления доступны в приложении.';
  if (/vapid|push|https/i.test(reason)) return 'Уведомления устройства пока не настроены. Внутренняя лента продолжает работать.';
  return 'Уведомления устройства сейчас недоступны. Внутренняя лента продолжает работать.';
}

export default function App() {
  const {
    currentUser,
    availableFactories,
    selectedFactoryId,
    authStatus,
    userId,
    authToken,
    notificationsUnreadCount,
    announcementsUnreadCount,
    chatsUnreadCount,
    tasksAttentionCount,
  } = useAppStore();
  const [screen, setScreen] = useState<Screen>('Shift');
  useEffect(observePwaInstall, []);
  const [theme, setTheme] = useState<AppTheme>(readAppTheme);
  const [themeStorageNotice, setThemeStorageNotice] = useState<string | null>(null);
  const screenHistoryRef = useRef<Screen[]>(['Shift']);
  const appBackRef = useRef<() => void>(() => undefined);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileSheetView, setMobileSheetView] = useState<'sections' | 'settings'>('sections');
  const [quickSlotPickerIndex, setQuickSlotPickerIndex] = useState<number | null>(null);
  const [apiConnectivityMessage, setApiConnectivityMessage] = useState<string | null>(null);
  const [pwaUpdateWorker, setPwaUpdateWorker] = useState<ServiceWorker | null>(null);
  const [pwaUpdateApplying, setPwaUpdateApplying] = useState(false);
  const [pwaUpdateConfirmOpen, setPwaUpdateConfirmOpen] = useState(false);
  const [dirtyNavigation, setDirtyNavigation] = useState<DirtyNavigation | null>(null);
  const [quickPreference, setQuickPreference] = useState<Screen[]>([]);
  const [quickPreferenceConfigured, setQuickPreferenceConfigured] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'fallback' | 'closed'>('closed');
  const [realtimeMessage, setRealtimeMessage] = useState<string | null>(null);
  const [realtimeContextEpoch, setRealtimeContextEpoch] = useState(0);
  const [deviceFlags, setDeviceFlags] = useState(notificationFlags);
  const [devicePermission, setDevicePermission] = useState(browserNotificationPermission());
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pendingNotificationIntent, setPendingNotificationIntent] = useState<NotificationNavigationIntent | null>(null);
  const [pendingNotificationScreen, setPendingNotificationScreen] = useState<{ screen: Screen; epoch: number } | null>(null);
  const notificationNavigationInFlight = useRef(new Map<string, Promise<void>>());
  const notificationNavigationSequence = useRef(0);
  const asyncContextEpoch = useRef(0);
  const navigationScrollFrame = useRef<number | null>(null);
  const contextIdentity = () => {
    const state = appStore.getState();
    return JSON.stringify([state.currentUser?.userId, state.selectedFactoryId, state.authToken, state.authStatus,
      state.currentUser?.role, state.currentUser?.isGuest, state.currentUser?.departmentId,
      [...(state.currentUser?.permissions ?? [])].sort()]);
  };
  // Subscribe synchronously to store transitions: a factory/user round trip must also cancel old work.
  useLayoutEffect(() => {
    let identity = contextIdentity();
    const unsubscribe = appStore.subscribe(() => {
      const next = contextIdentity();
      if (next === identity) return;
      identity = next;
      asyncContextEpoch.current += 1;
      if (navigationScrollFrame.current !== null) cancelAnimationFrame(navigationScrollFrame.current);
      navigationScrollFrame.current = null;
      notificationNavigationInFlight.current.clear();
    });
    return () => {
      unsubscribe();
      asyncContextEpoch.current += 1;
      if (navigationScrollFrame.current !== null) cancelAnimationFrame(navigationScrollFrame.current);
      notificationNavigationInFlight.current.clear();
    };
  }, []);
  const [pendingTask, setPendingTask] = useState<{ id: string; context: string; epoch: number } | null>(null);
  const [taskReturn, setTaskReturn] = useState<{ screen: Screen; context: string; value: PeopleTaskReturn | ShiftTaskReturn | SituationTaskReturn } | null>(null);
  useMobileBackLayer(mobileMoreOpen, () => {
    if (quickSlotPickerIndex !== null) setQuickSlotPickerIndex(null);
    else if (mobileSheetView === 'settings') setMobileSheetView('sections');
    else setMobileMoreOpen(false);
  }, 650);
  useMobileBackLayer(exitDialogOpen, () => setExitDialogOpen(false), 1000);

  useEffect(() => applyAppTheme(theme), [theme]);

  useEffect(() => installMobileBackCoordinator(() => appBackRef.current()), []);

  useEffect(() => {
    document.body.classList.toggle('pwa-standalone', isStandalonePwa());
    return () => document.body.classList.remove('pwa-standalone');
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      if (!authToken && !userId) {
        appStore.setSession({ currentUser: null, availableFactories: [], selectedFactoryId: '', authStatus: 'ready' });
        return;
      }

      appStore.setAuthLoading();
      try {
        if (authToken) {
          const me = await apiClient.get<MeResponse>('/auth/me');
          const hasSavedFactory = selectedFactoryId && me.availableFactories.some((factory) => factory.id === selectedFactoryId);
          appStore.setSession({
            currentUser: toCurrentUser(me),
            availableFactories: me.availableFactories,
            selectedFactoryId: hasSavedFactory ? me.selectedFactoryId : null,
            authStatus: hasSavedFactory ? 'ready' : me.availableFactories.length ? 'ready' : 'noFactories',
            authToken,
          });
          return;
        }

        const login = await apiClient.request<DevLoginResponse>('/auth/dev-login', {
          method: 'POST',
          body: JSON.stringify({ userId }),
          skipContextHeaders: true,
        });

        const hasSavedFactory = selectedFactoryId && login.availableFactories.some((factory) => factory.id === selectedFactoryId);
        const nextFactoryId = hasSavedFactory ? selectedFactoryId : null;

        appStore.setSession({
          currentUser: {
            userId: login.userId,
            role: 'OTHER',
            departmentId: null,
            permissions: [],
            isAdmin: false,
            isGuest: true,
          },
          availableFactories: login.availableFactories,
          selectedFactoryId: nextFactoryId,
          authStatus: nextFactoryId ? 'loading' : login.availableFactories.length ? 'ready' : 'noFactories',
        });

        if (!nextFactoryId) return;

        const me = await apiClient.get<MeResponse>('/auth/me');
        appStore.setSession({
          currentUser: toCurrentUser(me),
          availableFactories: me.availableFactories,
          selectedFactoryId: me.selectedFactoryId,
          authStatus: 'ready',
        });
      } catch (error) {
        appStore.setAuthError(error instanceof Error ? error.message : 'Не удалось загрузить сессию');
      }
    };

    void bootstrap();
  }, []);

  const hasSelectedFactory = Boolean(
    selectedFactoryId && availableFactories.some((factory) => factory.id === selectedFactoryId),
  );

  const visibleScreens = useMemo(() => {
    if (!currentUser) return screens;
    const filtered = screens.filter((item) =>
      canShowScreen(item.code, currentUser.permissions, currentUser.role, currentUser.isGuest),
    );
    if (filtered.length) return filtered;
    if (currentUser.isGuest) return screens.filter((item) => item.code === 'home' || item.code === 'report');
    return [];
  }, [currentUser]);
  const roleDefaultHomeScreen = useMemo(
    () => roleHomeScreen(visibleScreens, currentUser?.role ?? '', Boolean(currentUser?.isGuest)),
    [currentUser?.isGuest, currentUser?.role, visibleScreens],
  );
  const navigationContextKey = currentUser && selectedFactoryId
    ? `${currentUser.userId}.${selectedFactoryId}`
    : '';
  const navigationPermissionsKey = JSON.stringify([currentUser?.role, [...(currentUser?.permissions ?? [])].sort()]);
  const homeScreen = useMemo(() => {
    if (currentUser?.isGuest || !quickPreferenceConfigured) return roleDefaultHomeScreen;
    const allowed = new Set(visibleScreens.map((item) => item.id));
    return quickPreference.find((id) => allowed.has(id)) ?? roleDefaultHomeScreen;
  }, [currentUser?.isGuest, quickPreference, quickPreferenceConfigured, roleDefaultHomeScreen, visibleScreens]);
  const navigationContextRef = useRef('');
  useEffect(() => {
    setPendingTask(null);
    setTaskReturn(null);
    setDirtyNavigation(null);
    // Legacy unscoped intents must never survive login/factory changes or reload.
    try { window.localStorage.removeItem('zavod.taskHighlightId'); } catch { /* Optional storage. */ }
  }, [navigationContextKey, navigationPermissionsKey]);
  const shellRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const shell: HTMLElement | null = shellRef.current;
    if (!shell) return;
    const menus = shell.querySelectorAll<HTMLElement>('.bottom-nav, .mobile-quick-nav');
    const measure = () => {
      const height = Math.max(0, ...Array.from(menus, (menu) => menu.getBoundingClientRect().height));
      shell.style.setProperty('--shell-navigation-inset', `${Math.ceil(height)}px`);
    };
    const observer = new ResizeObserver(measure);
    menus.forEach((menu) => observer.observe(menu));
    measure();
    return () => observer.disconnect();
  }, [authStatus, hasSelectedFactory, visibleScreens]);

  useEffect(() => {
    if (!visibleScreens.some((item) => item.id === screen)) {
      const fallback = homeScreen;
      screenHistoryRef.current = [fallback];
      setScreen(fallback);
    }
  }, [homeScreen, screen, visibleScreens]);

  useEffect(() => {
    if (authStatus !== 'ready' || !hasSelectedFactory || !navigationContextKey || !visibleScreens.length || navigationContextRef.current === navigationContextKey) return;
    const quickKey = `${QUICK_NAV_PREFIX}.${navigationContextKey}`;
    const nextQuickPreference = safeLocalJson(quickKey);
    const nextQuickPreferenceConfigured = safeLocalHas(quickKey);
    setQuickPreference(nextQuickPreference);
    setQuickPreferenceConfigured(nextQuickPreferenceConfigured);

    const allowed = new Set(visibleScreens.map((item) => item.id));
    const initialHome = currentUser?.isGuest || !nextQuickPreferenceConfigured
      ? roleDefaultHomeScreen
      : nextQuickPreference.find((id) => allowed.has(id)) ?? roleDefaultHomeScreen;
    navigationContextRef.current = navigationContextKey;
    const routeKey = `${SESSION_ROUTE_PREFIX}.${navigationContextKey}`;
    const saved = safeSessionGet(routeKey) as Screen;
    const initial = allowed.has(saved) ? saved : initialHome;
    screenHistoryRef.current = [initial];
    setScreen(initial);
    if (navigationScrollFrame.current !== null) cancelAnimationFrame(navigationScrollFrame.current);
    const epoch = asyncContextEpoch.current;
    navigationScrollFrame.current = window.requestAnimationFrame(() => {
      navigationScrollFrame.current = null;
      if (epoch !== asyncContextEpoch.current || document.body.classList.contains('app-scroll-locked')) return;
      const top = Number(safeSessionGet(`${SESSION_SCROLL_PREFIX}.${navigationContextKey}.${initial}`)) || 0;
      window.scrollTo({ top, left: 0, behavior: 'auto' });
    });
  }, [authStatus, currentUser?.isGuest, hasSelectedFactory, navigationContextKey, roleDefaultHomeScreen, visibleScreens]);

  const mobileQuickItems = useMemo(
    () => {
      if (currentUser?.isGuest) return visibleScreens;
      const allowed = new Set(visibleScreens.map((item) => item.id));
      const defaults = defaultQuickScreenIds(visibleScreens, roleDefaultHomeScreen);
      const preferred = (quickPreferenceConfigured ? quickPreference : defaults)
        .filter((id, index, list) => allowed.has(id) && list.indexOf(id) === index);
      const ids = [...preferred, ...defaults, ...visibleScreens.map((item) => item.id)]
        .filter((id, index, list) => allowed.has(id) && list.indexOf(id) === index)
        .slice(0, 4);
      return ids
        .map((id) => visibleScreens.find((item) => item.id === id))
        .filter((item): item is ScreenDefinition => Boolean(item));
    },
    [currentUser?.isGuest, quickPreference, quickPreferenceConfigured, roleDefaultHomeScreen, visibleScreens],
  );

  const mobileMoreItems = useMemo(
    () => {
      const quickIds = new Set(mobileQuickItems.map((item) => item.id));
      return visibleScreens.filter((item) => !quickIds.has(item.id));
    },
    [mobileQuickItems, visibleScreens],
  );
  const selectedFactory = availableFactories.find((factory) => factory.id === selectedFactoryId);
  const selectedFactoryName = selectedFactory?.name ?? 'Завод';
  const sessionRoleLabel = roleLabel(currentUser?.role);
  const identityRole = sessionRoleLabel === 'Другое'
    ? currentUser?.jobTitleName?.trim() || sessionRoleLabel
    : sessionRoleLabel;
  const identityName = compactPersonName(currentUser?.displayName);
  const identityLabel = identityName && identityName.toLocaleLowerCase('ru-RU') !== identityRole.toLocaleLowerCase('ru-RU')
    ? `${identityRole} ${identityName}`
    : identityRole;
  const badgeForScreen = (id: Screen) => {
    if (id === 'Notifications') return notificationsUnreadCount;
    if (id === 'Announcements') return announcementsUnreadCount;
    if (id === 'Chats') return chatsUnreadCount;
    if (id === 'Tasks') return tasksAttentionCount;
    return 0;
  };
  const badgeLabelForScreen = (id: Screen) => {
    const count = badgeForScreen(id);
    if (!count) return '';
    if (id === 'Announcements') return `${count > 99 ? '99+' : count} непрочитанное`;
    return String(count > 99 ? '99+' : count);
  };

  const openScreen = (next: Screen, remember = true, bypassDirtyCheck = false, linkedTaskNavigation = false) => {
    if (!visibleScreens.some((item) => item.id === next)) return;
    if (!bypassDirtyCheck && next !== screen && hasDirtyMobileForms()) {
      setDirtyNavigation({ kind: 'screen', next, remember });
      setMobileMoreOpen(false);
      setMobileSheetView('sections');
      return;
    }
    if (navigationContextKey) {
      const pageTop = document.body.style.position === 'fixed' ? -(parseFloat(document.body.style.top) || 0) : window.scrollY;
      safeSessionSet(`${SESSION_SCROLL_PREFIX}.${navigationContextKey}.${screen}`, String(pageTop));
      safeSessionSet(`${SESSION_ROUTE_PREFIX}.${navigationContextKey}`, next);
    }
    if (!linkedTaskNavigation) setPendingTask(null);
    if (!linkedTaskNavigation && !(screen === 'Tasks' && next === taskReturn?.screen)) setTaskReturn(null);
    if (remember && next !== screen) {
      const history = screenHistoryRef.current;
      screenHistoryRef.current = [...history, next].slice(-20);
    }
    setScreen(next);
    setMobileMoreOpen(false);
    setMobileSheetView('sections');
    if (navigationScrollFrame.current !== null) cancelAnimationFrame(navigationScrollFrame.current);
    const epoch = asyncContextEpoch.current;
    navigationScrollFrame.current = window.requestAnimationFrame(() => {
      navigationScrollFrame.current = null;
      if (epoch !== asyncContextEpoch.current || document.body.classList.contains('app-scroll-locked')) return;
      const top = navigationContextKey
        ? Number(safeSessionGet(`${SESSION_SCROLL_PREFIX}.${navigationContextKey}.${next}`)) || 0
        : 0;
      window.scrollTo({ top, left: 0, behavior: 'auto' });
    });
  };

  const openScreenByCode = (code: string) => {
    const target = visibleScreens.find((item) => item.code === code);
    if (target) openScreen(target.id);
  };

  const navigateNotificationSource = async (intent: NotificationNavigationIntent, isCurrent: () => boolean) => {
    const sourceRoute = intent.sourceRoute?.trim() ?? '';
    const sourceFactoryId = intent.factoryId?.trim() || selectedFactoryId;
    if (!sourceRoute || !sourceFactoryId) throw new Error('Источник уведомления сейчас недоступен.');

    const targetDefinition = SCREEN_DEFINITIONS.find((item) => item.code === sourceRoute);
    if (!targetDefinition) throw new Error('Связанный раздел больше недоступен.');
    const targetHeaders = { 'x-factory-id': sourceFactoryId };

    if (intent.notificationId) {
      await apiClient.request(`/notifications/${encodeURIComponent(intent.notificationId)}/read`, {
        method: 'POST',
        body: '{}',
        headers: targetHeaders,
      });
      if (!isCurrent()) return;
      if (sourceFactoryId === selectedFactoryId) {
        const unread = await apiClient.request<{ count: number }>('/notifications/unread-count', { headers: targetHeaders }).catch(() => null);
        if (!isCurrent()) return;
        if (unread) appStore.setNotificationsUnreadCount(unread.count);
      }
    }

    const me = await apiClient.request<MeResponse>('/auth/me', { headers: targetHeaders });
    if (!isCurrent()) return;
    const factoryAllowed = !me.isGuest
      && me.selectedFactoryId === sourceFactoryId
      && me.availableFactories.some((factory) => factory.id === sourceFactoryId);
    if (!factoryAllowed) throw new Error('Доступ к заводу этого уведомления больше не действует.');
    if (!canShowScreen(targetDefinition.code, me.permissions, me.role, me.isGuest)) {
      throw new Error('Доступ к связанному разделу больше не действует.');
    }
    if (sourceFactoryId !== selectedFactoryId && hasDirtyMobileForms()) {
      throw new Error('Сначала сохраните или отмените изменения на текущем экране.');
    }

    if (sourceFactoryId === selectedFactoryId) {
      appStore.setSession({
        currentUser: toCurrentUser(me),
        availableFactories: me.availableFactories,
        selectedFactoryId: me.selectedFactoryId,
        authStatus: 'ready',
      });
      setPendingNotificationScreen({ screen: targetDefinition.id, epoch: asyncContextEpoch.current });
      return;
    }

    const targetContextKey = `${me.userId}.${sourceFactoryId}`;
    safeSessionSet(`${SESSION_ROUTE_PREFIX}.${targetContextKey}`, targetDefinition.id);
    appStore.selectFactory(sourceFactoryId);
    appStore.setSession({
      currentUser: toCurrentUser(me),
      availableFactories: me.availableFactories,
      selectedFactoryId: me.selectedFactoryId,
      authStatus: 'ready',
    });
    setPendingNotificationScreen({ screen: targetDefinition.id, epoch: asyncContextEpoch.current });
  };

  const openNotificationSource = (intent: NotificationNavigationIntent) => {
    const key = JSON.stringify([currentUser?.userId, intent.factoryId || selectedFactoryId, intent.notificationId, intent.sourceRoute]);
    const inFlight = notificationNavigationInFlight.current.get(key);
    if (inFlight) return inFlight;
    // Latest distinct intent wins; the same pending intent joins its current operation.
    notificationNavigationInFlight.current.clear();
    const epoch = asyncContextEpoch.current;
    const sequence = ++notificationNavigationSequence.current;
    const isCurrent = () => epoch === asyncContextEpoch.current && sequence === notificationNavigationSequence.current;
    const operation = navigateNotificationSource(intent, isCurrent).catch((error) => {
      if (isCurrent()) throw error;
    }).finally(() => {
      if (notificationNavigationInFlight.current.get(key) === operation) notificationNavigationInFlight.current.delete(key);
    });
    notificationNavigationInFlight.current.set(key, operation);
    return operation;
  };

  appBackRef.current = () => {
    const history = screenHistoryRef.current;
    if (history.length > 1) {
      const nextHistory = history.slice(0, -1);
      if (hasDirtyMobileForms()) {
        setDirtyNavigation({ kind: 'screen', next: nextHistory[nextHistory.length - 1] ?? homeScreen, remember: false });
        return;
      }
      screenHistoryRef.current = nextHistory;
      openScreen(nextHistory[nextHistory.length - 1] ?? homeScreen, false);
      return;
    }
    if (screen !== homeScreen) {
      if (hasDirtyMobileForms()) {
        setDirtyNavigation({ kind: 'screen', next: homeScreen, remember: false });
        return;
      }
      screenHistoryRef.current = [homeScreen];
      openScreen(homeScreen, false);
      return;
    }
    if (hasDirtyMobileForms()) {
      setDirtyNavigation({ kind: 'exit' });
      return;
    }
    setExitDialogOpen(true);
  };

  useEffect(() => {
    if (!currentUser?.userId || !selectedFactoryId) navigationContextRef.current = '';
  }, [currentUser?.userId, selectedFactoryId]);

  useEffect(() => {
    setMobileMoreOpen(false);
    setMobileSheetView('sections');
    setQuickSlotPickerIndex(null);
  }, [screen]);

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ screen?: Screen; userId?: string; taskId?: string; taskReturn?: PeopleTaskReturn | ShiftTaskReturn | SituationTaskReturn }>).detail;
      if (detail?.screen) {
        if (detail.screen === 'Tasks' && detail.taskId && navigationContextKey
          && visibleScreens.some((item) => item.id === 'Tasks')) {
          if (hasDirtyMobileForms()) {
            // Keep the complete intent in the existing confirmation, not in a
            // prematurely active target that Stay or a context change could replay.
            setDirtyNavigation({ kind: 'screen', next: 'Tasks', remember: true, taskIntent: {
              id: detail.taskId, context: navigationContextKey, epoch: asyncContextEpoch.current,
              source: screen, returnValue: detail.taskReturn,
            } });
            setMobileMoreOpen(false);
            setMobileSheetView('sections');
            return;
          }
          setPendingTask({ id: detail.taskId, context: navigationContextKey, epoch: asyncContextEpoch.current });
          setTaskReturn(detail.taskReturn ? { screen, context: navigationContextKey, value: detail.taskReturn } : null);
        }
        openScreen(detail.screen, true, false, Boolean(detail.screen === 'Tasks' && detail.taskId && !hasDirtyMobileForms()));
        if (detail.screen === 'People' && detail.userId) {
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('zavod:open-person-profile', { detail: { userId: detail.userId } }));
          }, 0);
        }
      }
    };
    window.addEventListener('zavod:navigate', onNavigate as EventListener);
    return () => window.removeEventListener('zavod:navigate', onNavigate as EventListener);
  }, [visibleScreens, screen, navigationContextKey]);

  useEffect(() => {
    const acceptIntent = (intent: NotificationNavigationIntent | null | undefined) => {
      if (!intent?.sourceRoute) return;
      setPendingNotificationIntent(intent);
    };
    const onNotificationNavigation = (event: Event) => {
      acceptIntent((event as CustomEvent<NotificationNavigationIntent>).detail);
    };
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ZAVOD_NOTIFICATION_NAVIGATION') acceptIntent(event.data.intent);
    };
    window.addEventListener(NOTIFICATION_NAVIGATION_EVENT, onNotificationNavigation as EventListener);
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);

    const url = new URL(window.location.href);
    const coldIntent = {
      notificationId: url.searchParams.get('notificationId'),
      factoryId: url.searchParams.get('notificationFactory'),
      sourceRoute: url.searchParams.get('notificationRoute'),
    };
    if (coldIntent.sourceRoute) {
      acceptIntent(coldIntent);
      url.searchParams.delete('notificationId');
      url.searchParams.delete('notificationFactory');
      url.searchParams.delete('notificationRoute');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }

    return () => {
      window.removeEventListener(NOTIFICATION_NAVIGATION_EVENT, onNotificationNavigation as EventListener);
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    };
  }, []);

  useEffect(() => {
    if (!pendingNotificationIntent || authStatus !== 'ready' || !hasSelectedFactory) return;
    const intent = pendingNotificationIntent;
    setPendingNotificationIntent(null);
    void openNotificationSource(intent).catch((error) => {
      const message = error instanceof Error ? error.message : 'Источник уведомления сейчас недоступен.';
      setRealtimeMessage(message);
      window.setTimeout(() => setRealtimeMessage(null), 7000);
    });
  }, [authStatus, hasSelectedFactory, pendingNotificationIntent, selectedFactoryId]);

  useEffect(() => {
    if (!pendingNotificationScreen) return;
    if (pendingNotificationScreen.epoch !== asyncContextEpoch.current || !visibleScreens.some((item) => item.id === pendingNotificationScreen.screen)) {
      setPendingNotificationScreen(null);
      return;
    }
    const target = pendingNotificationScreen.screen;
    setPendingNotificationScreen(null);
    openScreen(target);
  }, [pendingNotificationScreen, visibleScreens]);

  useBodyScrollLock(mobileMoreOpen);

  useEffect(() => {
    const onOpenSettings = () => {
      setMobileSheetView('settings');
      setMobileMoreOpen(true);
    };
    const onApiConnectivity = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string | null }>).detail;
      setApiConnectivityMessage(detail?.message ?? null);
    };
    const onPwaUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ worker?: ServiceWorker | null }>).detail;
      setPwaUpdateWorker(detail?.worker ?? null);
      setPwaUpdateApplying(false);
    };
    window.addEventListener('zavod:open-settings', onOpenSettings as EventListener);
    window.addEventListener('zavod:api-connectivity', onApiConnectivity as EventListener);
    window.addEventListener('zavod:pwa-update', onPwaUpdate as EventListener);
    return () => {
      window.removeEventListener('zavod:open-settings', onOpenSettings as EventListener);
      window.removeEventListener('zavod:api-connectivity', onApiConnectivity as EventListener);
      window.removeEventListener('zavod:pwa-update', onPwaUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (authStatus !== 'ready' || !hasSelectedFactory) return;
    if (currentUser?.isGuest) {
      setRealtimeStatus('closed');
      return;
    }

    let cancelled = false;
    let counterSequence = 0;
    const epoch = asyncContextEpoch.current;
    const isCurrent = () => !cancelled && epoch === asyncContextEpoch.current;
    const refreshAppCounters = async () => {
      const sequence = ++counterSequence;
      const visibleCodes = new Set(visibleScreens.map((item) => item.code));
      const [notifications, announcements, chats, tasks] = await Promise.all([
        visibleCodes.has('notifications') ? apiClient.get<{ count: number }>('/notifications/unread-count').catch(() => ({ count: 0 })) : Promise.resolve({ count: 0 }),
        visibleCodes.has('announcements') ? apiClient.get<{ total: number }>('/announcements/current').catch(() => ({ total: 0 })) : Promise.resolve({ total: 0 }),
        visibleCodes.has('chats') ? apiClient.get<Array<{ unreadCount?: number }>>('/chats').catch(() => []) : Promise.resolve([]),
        visibleCodes.has('tasks') ? apiClient.get<Array<{ status?: string }>>('/tasks?includeDone=false').catch(() => []) : Promise.resolve([]),
      ]);
      if (!isCurrent() || sequence !== counterSequence) return;
      appStore.setNotificationsUnreadCount(Number(notifications.count) || 0);
      appStore.setAnnouncementsUnreadCount(Number(announcements.total) || 0);
      appStore.setChatsUnreadCount(chats.reduce((sum, chat) => sum + (Number(chat.unreadCount) || 0), 0));
      appStore.setTasksAttentionCount(tasks.filter((task) => task.status !== 'DONE').length);
    };
    let notificationsTimer: number | null = null;
    const stopFallbackPolling = () => {
      if (notificationsTimer === null) return;
      window.clearInterval(notificationsTimer);
      notificationsTimer = null;
    };
    const startFallbackPolling = () => {
      if (notificationsTimer !== null) return;
      notificationsTimer = window.setInterval(() => {
        void refreshAppCounters();
      }, NOTIFICATIONS_REFRESH_INTERVAL_MS);
    };
    const ws = connectWs({
      onStatus: (status) => {
        setRealtimeStatus(status);
        if (status === 'fallback') startFallbackPolling();
        if (status === 'connected') stopFallbackPolling();
      },
      onUnreadShouldRefresh: () => void refreshAppCounters(),
      onAuthContextChanged: (message) => {
        setRealtimeMessage(message);
        void apiClient.get<MeResponse>('/auth/me').then((me) => {
          if (!isCurrent()) return;
          const hasFactory = Boolean(me.selectedFactoryId && me.availableFactories.some((factory) => factory.id === me.selectedFactoryId));
          appStore.setSession({
            currentUser: toCurrentUser(me),
            availableFactories: me.availableFactories,
            selectedFactoryId: hasFactory ? me.selectedFactoryId : '',
            authStatus: hasFactory ? 'ready' : me.availableFactories.length ? 'ready' : 'noFactories',
          });
          setRealtimeContextEpoch((value) => value + 1);
        }).catch(() => undefined);
      },
      onNotification: (notification) => {
        if (!isCurrent()) return;
        setRealtimeMessage(notification.title);
        window.setTimeout(() => setRealtimeMessage(null), 7000);
        void signalImportantNotification(notification);
      },
    });
    void refreshAppCounters();
    const onStatusChange = () => setOnline(navigator.onLine);
    window.addEventListener('online', onStatusChange);
    window.addEventListener('offline', onStatusChange);

    return () => {
      cancelled = true;
      ws.close();
      stopFallbackPolling();
      window.removeEventListener('online', onStatusChange);
      window.removeEventListener('offline', onStatusChange);
    };
  }, [authStatus, currentUser?.isGuest, currentUser?.userId, hasSelectedFactory, realtimeContextEpoch, selectedFactoryId, visibleScreens]);

  useEffect(() => {
    if (authStatus !== 'ready' || !hasSelectedFactory || !currentUser?.isGuest) return;

    let cancelled = false;
    const refreshGuestAssignment = async () => {
      try {
        const me = await apiClient.get<MeResponse>('/auth/me');
        if (cancelled || me.isGuest) return;
        const hasFactory = Boolean(me.selectedFactoryId && me.availableFactories.some((factory) => factory.id === me.selectedFactoryId));
        appStore.setSession({
          currentUser: toCurrentUser(me),
          availableFactories: me.availableFactories,
          selectedFactoryId: hasFactory ? me.selectedFactoryId : '',
          authStatus: hasFactory ? 'ready' : me.availableFactories.length ? 'ready' : 'noFactories',
        });
      } catch {
        // The guest screen remains usable while a reviewer is deciding.
      }
    };
    const timer = window.setInterval(() => void refreshGuestAssignment(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authStatus, currentUser?.isGuest, currentUser?.userId, hasSelectedFactory, selectedFactoryId]);

  const connectivityMessage = apiConnectivityMessage
    ?? (!online ? 'Нет сети. Просмотр открытых данных доступен. Результат отправленных действий проверьте после восстановления связи.' : null);

  const performPwaUpdate = () => {
    if (!pwaUpdateWorker) {
      window.location.reload();
      return;
    }
    setPwaUpdateApplying(true);
    pwaUpdateWorker.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(() => window.location.reload(), 4000);
  };

  const applyPwaUpdate = () => {
    if (hasDirtyMobileForms()) {
      setPwaUpdateConfirmOpen(true);
      return;
    }
    performPwaUpdate();
  };

  const loadDeviceSettings = async () => {
    setDeviceError(null);
    setDeviceFlags(notificationFlags());
    setDevicePermission(browserNotificationPermission());
    try {
      setPushStatus(await apiClient.get<PushStatus>('/notifications/push/status'));
    } catch {
      setPushStatus(null);
      setDeviceError('Настройки уведомлений устройства сейчас недоступны. Лента уведомлений продолжает работать.');
    }
  };

  useEffect(() => {
    if (mobileMoreOpen && mobileSheetView === 'settings') void loadDeviceSettings();
  }, [mobileMoreOpen, mobileSheetView]);

  const setDeviceFlag = (key: string, enabled: boolean) => {
    setNotificationFlag(key, enabled);
    setDeviceFlags(notificationFlags());
  };

  const enableDeviceNotifications = async () => {
    setDeviceBusy(true);
    setDeviceError(null);
    setDeviceNotice(null);
    try {
      const nextPermission = await requestBrowserNotificationPermission();
      setDevicePermission(nextPermission);
      if (nextPermission !== 'granted') {
        setDeviceFlag(BROWSER_NOTIFY_STORAGE_KEY, false);
        setDeviceNotice(nextPermission === 'unsupported'
          ? 'Этот браузер не поддерживает уведомления.'
          : 'Браузер не разрешил уведомления. Их можно включить в настройках сайта.');
        return;
      }
      setDeviceFlag(BROWSER_NOTIFY_STORAGE_KEY, true);
      if (!pushStatus?.available || !pushStatus.publicKey) {
        setDeviceNotice(pushStatus?.reason ?? 'Браузерные уведомления пока не настроены на сервере. Уведомления внутри приложения работают.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushStatus.publicKey),
      });
      const result = await apiClient.post<{ activeSubscriptions: number }>('/notifications/push/subscribe', {
        ...subscription.toJSON(),
        userAgent: navigator.userAgent,
        deviceLabel: 'Браузер',
      });
      setPushStatus((current) => current ? { ...current, activeSubscriptions: result.activeSubscriptions } : current);
      setDeviceNotice('Уведомления браузера включены для этого устройства.');
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Не удалось включить уведомления устройства');
    } finally {
      setDeviceBusy(false);
    }
  };

  const disableDeviceNotifications = async () => {
    setDeviceBusy(true);
    setDeviceError(null);
    setDeviceNotice(null);
    try {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      await subscription?.unsubscribe();
      const result = await apiClient.post<{ activeSubscriptions: number }>('/notifications/push/unsubscribe', subscription?.toJSON() ?? {});
      setDeviceFlag(BROWSER_NOTIFY_STORAGE_KEY, false);
      setPushStatus((current) => current ? { ...current, activeSubscriptions: result.activeSubscriptions } : current);
      setDeviceNotice('Уведомления браузера отключены для этого пользователя.');
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Не удалось отключить уведомления устройства');
    } finally {
      setDeviceBusy(false);
    }
  };

  const testDeviceSignals = async () => {
    setDeviceError(null);
    setDeviceNotice(null);
    if (deviceFlags.sound) await playNotificationSound().catch(() => setDeviceError('Не удалось воспроизвести звук в этом браузере.'));
    if (deviceFlags.vibration && !vibrateNotification()) setDeviceNotice('Вибрация не поддерживается этим устройством.');
    if (!deviceFlags.sound && !deviceFlags.vibration) setDeviceNotice('Включите звук или вибрацию, чтобы проверить сигнал.');
  };

  const changeFactory = () => {
    if (navigationContextKey) {
      try { window.sessionStorage.removeItem(`${SESSION_ROUTE_PREFIX}.${navigationContextKey}`); } catch { /* Ignore unavailable storage. */ }
    }
    navigationContextRef.current = '';
    appStore.setSession({
      currentUser,
      availableFactories,
      selectedFactoryId: '',
      authStatus: 'ready',
      authToken,
    });
    setMobileMoreOpen(false);
    setMobileSheetView('sections');
  };

  if (authStatus !== 'ready' || !hasSelectedFactory) {
    return <FactorySelectScreen />;
  }

  return (
    <main className="app-shell" ref={shellRef}>
      <header className="topbar">
        <div className="brand" aria-label="Завод">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-copy">
            <h1 className="brand-name">{selectedFactoryName}</h1>
            <p className="brand-subtitle">Завод</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className={`status-pill compact-status ${online ? '' : 'offline'}`} title={`${online ? 'Онлайн' : 'Офлайн'} · ${identityLabel}`}>
            <span className="status-dot" />
            <span className="compact-status-label">{online ? 'Онлайн' : 'Офлайн'} · {identityLabel}</span>
          </div>
          {visibleScreens.some((item) => item.id === 'Notifications') ? <button
            aria-label={notificationsUnreadCount > 0 ? `Уведомления: ${notificationsUnreadCount}` : 'Уведомления'}
            className={`topbar-notification-button ${screen === 'Notifications' ? 'active' : ''}`}
            onClick={() => openScreen('Notifications')}
            type="button"
          >
            <span className="topbar-bell" aria-hidden="true" />
            {notificationsUnreadCount > 0 ? (
              <span className="topbar-notification-badge">
                {notificationsUnreadCount > 99 ? '99+' : notificationsUnreadCount}
              </span>
            ) : null}
          </button> : null}
        </div>
      </header>

      {connectivityMessage ? (
        <div className="pwa-status-banner warning" role="status">
          <strong>{online ? 'Ответ не получен' : 'Нет связи'}</strong>
          <span>{connectivityMessage}</span>
        </div>
      ) : null}

      {realtimeStatus === 'fallback' ? (
        <div className="pwa-status-banner warning" role="status">
          <strong>Мгновенные обновления недоступны</strong>
          <span>Уведомления продолжают обновляться резервным опросом.</span>
        </div>
      ) : null}

      {realtimeMessage ? (
        <div className="toast-message realtime-toast" role="status">{realtimeMessage}</div>
      ) : null}

      {pwaUpdateWorker ? (
        <div className="pwa-status-banner update" role="status">
          <strong>Доступна новая версия</strong>
          <span>Обновите приложение, чтобы перейти на свежую сборку без переустановки.</span>
          <button className="primary-button compact-action" type="button" disabled={pwaUpdateApplying} onClick={applyPwaUpdate}>
            {pwaUpdateApplying ? 'Обновляю...' : 'Обновить'}
          </button>
        </div>
      ) : null}

      {mobileQuickItems.length ? (
        <nav className={`mobile-quick-nav ${currentUser?.isGuest ? 'guest-only' : ''}`} aria-label="Основная навигация">
          {mobileQuickItems.map((item) => (
            <button
              className={`mobile-quick-button ${screen === item.id ? 'active' : ''}`}
              key={item.id}
              onClick={() => openScreen(item.id)}
              type="button"
            >
              <span className="nav-icon" aria-hidden="true"><NavIcon name={item.icon} /></span>
              <span>{item.label}</span>
              {badgeForScreen(item.id) > 0 ? <span className="nav-badge">{badgeForScreen(item.id) > 99 ? '99+' : badgeForScreen(item.id)}</span> : null}
            </button>
          ))}
        </nav>
      ) : null}

      {mobileMoreItems.length || !currentUser?.isGuest ? <div className="mobile-more-shell">
        <button
          aria-expanded={mobileMoreOpen}
          className={`mobile-more-button ${mobileMoreItems.some((item) => item.id === screen) ? 'active' : ''}`}
          onClick={() => {
            setMobileMoreOpen((value) => {
              const next = !value;
              if (next) setMobileSheetView('sections');
              return next;
            });
          }}
          type="button"
        >
          <span className="nav-icon" aria-hidden="true"><NavIcon name="more" /></span>
          <span>Ещё</span>
        </button>
      </div> : null}

      {/* Local forms/read state belong to this authority/session generation. */}
      <React.Fragment key={asyncContextEpoch.current}>
      {screen === 'Home' && <GuestHomeScreen />}
      {screen === 'Shift' && <ShiftPeopleScreen taskReturn={taskReturn?.context === navigationContextKey && taskReturn.screen === 'Shift' ? taskReturn.value as ShiftTaskReturn : undefined} />}
      {screen === 'ShiftHistory' && <ShiftPeopleScreen mode="history" />}
      {screen === 'People' && <PeopleScreen taskReturn={taskReturn?.context === navigationContextKey && taskReturn.screen === 'People' ? taskReturn.value as PeopleTaskReturn : undefined} />}
      {screen === 'Admin' && <AdminConfigScreen />}
      {screen === 'Situation' && <SituationScreen taskReturn={taskReturn?.context === navigationContextKey && taskReturn.screen === 'Situation' ? taskReturn.value as SituationTaskReturn : undefined} />}
      {screen === 'Tasks' && <React.Fragment key={`${navigationContextKey}:${currentUser?.role}:${[...(currentUser?.permissions ?? [])].sort().join('|')}`}><TasksScreen targetTaskId={pendingTask?.context === navigationContextKey && pendingTask.epoch === asyncContextEpoch.current ? pendingTask.id : undefined} onTargetConsumed={() => setPendingTask(null)} /></React.Fragment>}
      {screen === 'Wash' && <WashScreen />}
      {screen === 'OKK' && <OkkScreen />}
      {screen === 'Stock' && <StockScreen />}
      {screen === 'Orders' && <OrdersStockScreen />}
      {screen === 'Checklists' && <ChecklistsScreen />}
      {screen === 'Defrost' && <DefrostScreen />}
      {screen === 'Returns' && <ReturnsScreen />}
      {screen === 'Log' && <ShiftLogScreen />}
      {screen === 'Chats' && <ChatsScreen />}
      {screen === 'Announcements' && <AnnouncementsScreen />}
      {screen === 'Archive' && <ArchiveScreen onOpenSource={openScreenByCode} />}
      {screen === 'Notifications' && <NotificationsScreen onOpenSource={openNotificationSource} />}
      {screen === 'Ops' && <OpsAuditScreen />}
      {screen === 'Report' && <BugReportScreen />}
      </React.Fragment>

      <nav className="bottom-nav" aria-label="Основная навигация">
        {visibleScreens.map((item) => (
          <button
            className={`nav-button ${screen === item.id ? 'active' : ''}`}
            key={item.id}
            onClick={() => openScreen(item.id)}
            type="button"
          >
            <span className="nav-icon" aria-hidden="true"><NavIcon name={item.icon} /></span>
            <span>{item.label}</span>
            {item.id === 'Admin' ? <span className="visually-hidden">Администрирование</span> : null}
            {badgeForScreen(item.id) > 0 ? <span className="nav-badge">{badgeForScreen(item.id) > 99 ? '99+' : badgeForScreen(item.id)}</span> : null}
          </button>
        ))}
        {!currentUser?.isGuest ? <button
          className="nav-button nav-settings-button"
          onClick={() => {
            setMobileSheetView('settings');
            setMobileMoreOpen(true);
          }}
          type="button"
        >
          <span className="nav-icon" aria-hidden="true"><NavIcon name="settings" /></span>
          <span>Настройки</span>
        </button> : null}
      </nav>

      {mobileMoreOpen ? (
        <div className="mobile-sheet-backdrop" onClick={() => { setMobileMoreOpen(false); setMobileSheetView('sections'); setQuickSlotPickerIndex(null); }}>
          <section className="mobile-nav-sheet" aria-label={mobileSheetView === 'settings' ? 'Настройки' : 'Остальные разделы'} onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sheet-header">
              <span className="mobile-sheet-handle" aria-hidden="true" />
              <h2>{mobileSheetView === 'settings' ? 'Настройки' : 'Ещё'}</h2>
              <div className="mobile-sheet-header-actions">
                {mobileSheetView === 'settings' ? (
                  <button className="secondary-button" type="button" onClick={() => {
                    if (quickSlotPickerIndex !== null) setQuickSlotPickerIndex(null);
                    else setMobileSheetView('sections');
                  }}>Назад</button>
                ) : (
                  <button className="secondary-button" type="button" onClick={() => { setMobileMoreOpen(false); setMobileSheetView('sections'); setQuickSlotPickerIndex(null); }}>Закрыть</button>
                )}
              </div>
            </div>
            {mobileSheetView === 'settings' ? (
              <div className="mobile-settings-panel">
                <section className="section-card compact settings-section-card">
                  <div className="section-subhead">
                    <span><NavIcon name="settings" /></span>
                    <div>
                      <strong>Аккаунт и завод</strong>
                      <p>{selectedFactoryName}. Смена завода покажет только доступные вам площадки.</p>
                    </div>
                  </div>
                  <div className="button-row">
                    <button className="secondary-button" type="button" onClick={changeFactory}>Сменить завод</button>
                    <button className="danger-button" type="button" onClick={() => appStore.clearAuth()}>Выйти из аккаунта</button>
                  </div>
                </section>

                <section className="section-card compact settings-section-card appearance-settings-card">
                  <div className="section-subhead">
                    <span><NavIcon name="settings" /></span>
                    <div>
                      <strong>Оформление</strong>
                      <p>Тема применяется сразу и сохраняется только на этом устройстве.</p>
                    </div>
                  </div>
                  <div className="theme-selector" aria-label="Тема оформления">
                    {THEME_OPTIONS.map((option) => {
                      const selected = theme === option.id;
                      return (
                        <button
                          aria-label={option.label}
                          aria-pressed={selected}
                          className={`theme-selector-option ${selected ? 'selected' : ''}`}
                          key={option.id}
                          onClick={() => {
                            setTheme(option.id);
                            setThemeStorageNotice(persistAppTheme(option.id)
                              ? null
                              : 'Тема применена, но браузер не смог сохранить выбор на устройстве.');
                          }}
                          type="button"
                        >
                          <span>{option.label}</span>
                          <span className="theme-selector-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="theme-selector-status" role="status">
                    {themeStorageNotice ?? `Выбрана: ${THEME_OPTIONS.find((option) => option.id === theme)?.label ?? 'Тёмная'}`}
                  </p>
                </section>

                <section className="section-card compact settings-section-card">
                  <div className="section-subhead">
                    <span><NavIcon name="more" /></span>
                    <div>
                      <strong>Быстрые разделы</strong>
                      <p>Настройте четыре кнопки. Первый слот открывается после входа и при возврате на главный экран.</p>
                    </div>
                  </div>
                  <div className="quick-nav-settings-list">
                    {mobileQuickItems.map((item, index) => (
                      <button
                        className="quick-nav-slot"
                        key={`${index}-${item.id}`}
                        type="button"
                        onClick={() => setQuickSlotPickerIndex(index)}
                      >
                        <span className="quick-nav-slot-number">{index + 1}</span>
                        <span className="nav-icon" aria-hidden="true"><NavIcon name={item.icon} /></span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{index === 0 ? 'Главный экран' : 'Быстрый переход'}</small>
                        </span>
                        <span className="quick-nav-slot-action">Изменить</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="section-card compact settings-section-card">
                  <div className="section-subhead">
                    <span><NavIcon name="notifications" /></span>
                    <div>
                      <strong>Уведомления устройства</strong>
                      <p>{devicePushSummary(pushStatus)}</p>
                    </div>
                  </div>
                  {deviceError ? <div className="empty-state error-state compact">{deviceError}</div> : null}
                  {deviceNotice ? <div className="empty-state success-state compact">{deviceNotice}</div> : null}
                  <div className="settings-toggle-grid">
                    <button aria-pressed={deviceFlags.sound} className={`settings-toggle-button ${deviceFlags.sound ? 'active' : ''}`} type="button" disabled={deviceBusy} onClick={() => setDeviceFlag(SOUND_STORAGE_KEY, !deviceFlags.sound)}>
                      <span>Звук</span><strong>{deviceFlags.sound ? 'Включён' : 'Выключен'}</strong>
                    </button>
                    <button aria-pressed={deviceFlags.vibration} className={`settings-toggle-button ${deviceFlags.vibration ? 'active' : ''}`} type="button" disabled={deviceBusy} onClick={() => setDeviceFlag(VIBRATION_STORAGE_KEY, !deviceFlags.vibration)}>
                      <span>Вибрация</span><strong>{deviceFlags.vibration ? 'Включена' : 'Выключена'}</strong>
                    </button>
                    {devicePermission === 'granted' ? (
                      <button className="secondary-button" type="button" disabled={deviceBusy} onClick={() => void testDeviceSignals()}>
                        Проверить сигнал
                      </button>
                    ) : null}
                    {deviceFlags.browser ? (
                      <button className="danger-button" type="button" disabled={deviceBusy} onClick={() => void disableDeviceNotifications()}>
                        Отключить уведомления
                      </button>
                    ) : (
                      <button className="action-button" type="button" disabled={deviceBusy || devicePermission === 'unsupported'} onClick={() => void enableDeviceNotifications()}>
                        Включить уведомления
                      </button>
                    )}
                  </div>
                  <p className="line-meta">
                    {devicePermission === 'granted' ? 'Уведомления разрешены на этом устройстве.' : devicePermission === 'denied' ? 'Уведомления запрещены в настройках браузера.' : devicePermission === 'unsupported' ? 'Этот браузер не поддерживает уведомления устройства.' : 'Разрешение на уведомления ещё не запрашивалось.'}
                  </p>
                </section>

                <section className="section-card compact settings-section-card">
                  <div className="section-subhead">
                    <span><NavIcon name="archive" /></span>
                    <div>
                      <strong>Установка приложения</strong>
                      <p>Приложение можно установить на телефон. Для сохранения действий требуется связь с сервером.</p>
                    </div>
                  </div>
                  <PwaInstallButton />
                </section>
                <DeviceAccessPanel />
              </div>
            ) : (
              <>
                <div className="mobile-sheet-grid">
                  {mobileMoreItems.length ? mobileMoreItems.map((item) => (
                    <button
                      className={`mobile-sheet-item ${screen === item.id ? 'active' : ''}`}
                      key={item.id}
                      onClick={() => openScreen(item.id)}
                      type="button"
                    >
                      <span className="nav-icon" aria-hidden="true"><NavIcon name={item.icon} /></span>
                      <span>{item.label}</span>
                      {item.id === 'Admin' ? <span className="visually-hidden">Администрирование</span> : null}
                      {badgeForScreen(item.id) > 0 ? <span className="nav-badge">{badgeForScreen(item.id) > 99 ? '99+' : badgeForScreen(item.id)}</span> : null}
                      {item.id === 'Announcements' && announcementsUnreadCount > 0 ? <small className="mobile-sheet-unread-note">{badgeLabelForScreen(item.id)}</small> : null}
                    </button>
                  )) : null}
                  <button className="mobile-sheet-item settings-entry" type="button" onClick={() => setMobileSheetView('settings')}>
                    <span className="nav-icon" aria-hidden="true"><NavIcon name="settings" /></span>
                    <span>Настройки</span>
                  </button>
                </div>
              </>
            )}
            {mobileSheetView === 'settings' && quickSlotPickerIndex !== null ? (
              <section className="quick-slot-picker-panel" aria-label={`Выбор раздела для слота ${quickSlotPickerIndex + 1}`}>
                <div className="mobile-sheet-header">
                  <div>
                    <span className="eyebrow">Слот {quickSlotPickerIndex + 1}</span>
                    <h3>Выберите раздел</h3>
                  </div>
                  <button className="secondary-button compact-action" type="button" onClick={() => setQuickSlotPickerIndex(null)}>Назад</button>
                </div>
                <div className="quick-slot-picker-options">
                  {visibleScreens
                    .filter((candidate) => {
                      const currentId = mobileQuickItems[quickSlotPickerIndex]?.id;
                      return candidate.id === currentId || !mobileQuickItems.some((item) => item.id === candidate.id);
                    })
                    .map((candidate) => (
                      <button
                        className={`quick-slot-option ${mobileQuickItems[quickSlotPickerIndex]?.id === candidate.id ? 'selected' : ''}`}
                        key={candidate.id}
                        type="button"
                        onClick={() => {
                          const next = mobileQuickItems.map((item) => item.id);
                          next[quickSlotPickerIndex] = candidate.id;
                          const unique = next.filter((id, index, list) => list.indexOf(id) === index).slice(0, 4);
                          setQuickPreference(unique);
                          setQuickPreferenceConfigured(true);
                          try { window.localStorage.setItem(`${QUICK_NAV_PREFIX}.${navigationContextKey}`, JSON.stringify(unique)); } catch { /* Keep in-memory selection. */ }
                          setQuickSlotPickerIndex(null);
                        }}
                      >
                        <span className="nav-icon" aria-hidden="true"><NavIcon name={candidate.icon} /></span>
                        <span>{candidate.label}</span>
                        <span>{mobileQuickItems[quickSlotPickerIndex]?.id === candidate.id ? 'Выбран' : 'Выбрать'}</span>
                      </button>
                    ))}
                </div>
              </section>
            ) : null}
          </section>
        </div>
      ) : null}
      {exitDialogOpen ? (
        <AppConfirmDialog
          title="Выйти из приложения?"
          description="Вы действительно хотите выйти из приложения?"
          confirmLabel="Выйти"
          cancelLabel="Остаться"
          onCancel={() => setExitDialogOpen(false)}
          onConfirm={leaveStandaloneApp}
        />
      ) : null}
      {pwaUpdateConfirmOpen ? (
        <AppConfirmDialog
          title="Обновить приложение?"
          description="В открытой форме есть несохранённые данные. После обновления они могут быть потеряны."
          confirmLabel="Обновить"
          cancelLabel="Остаться"
          onCancel={() => setPwaUpdateConfirmOpen(false)}
          onConfirm={() => { setPwaUpdateConfirmOpen(false); performPwaUpdate(); }}
        />
      ) : null}
      {dirtyNavigation ? (
        <AppConfirmDialog
          danger
          title={hasDirtyMobileForm('error-report') ? 'Закрыть без отправки?' : 'Закрыть форму?'}
          description={hasDirtyMobileForm('error-report') ? 'Введённый текст и вложения будут потеряны.' : 'В форме есть несохранённые данные. Закрыть её без сохранения?'}
          confirmLabel={hasDirtyMobileForm('error-report') ? 'Закрыть без отправки' : 'Закрыть без сохранения'}
          cancelLabel={hasDirtyMobileForm('error-report') ? 'Продолжить заполнение' : 'Остаться'}
          onCancel={() => setDirtyNavigation(null)}
          onConfirm={() => {
            const action = dirtyNavigation;
            setDirtyNavigation(null);
            if (action.kind === 'exit') leaveStandaloneApp();
            else {
              const intent = action.taskIntent;
              if (intent) {
                if (intent.context !== navigationContextKey || intent.epoch !== asyncContextEpoch.current
                  || !visibleScreens.some((item) => item.id === 'Tasks')) return;
                setPendingTask({ id: intent.id, context: intent.context, epoch: intent.epoch });
                setTaskReturn(intent.returnValue ? { screen: intent.source, context: intent.context, value: intent.returnValue } : null);
              }
              openScreen(action.next, action.remember, true, Boolean(intent));
            }
          }}
        />
      ) : null}
    </main>
  );
}
