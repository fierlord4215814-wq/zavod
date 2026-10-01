import { appStore, getApiContext, type NotificationItem } from '../store/app.store';

const API_URL = import.meta.env.VITE_API_URL?.trim() || '';
const WS_DEBUG = import.meta.env.DEV && localStorage.getItem('zavod.wsDebug') === '1';
const WS_ENABLED = import.meta.env.VITE_WS_ENABLED !== '0';

type WsStatus = 'connecting' | 'connected' | 'fallback' | 'closed';
type ResourceInvalidation = { changedAt?: string };

type WsEvent =
  | { type: 'connected'; payload: { message?: string } }
  | { type: 'assignment_updated'; payload: ResourceInvalidation }
  | { type: 'shift_updated'; payload: ResourceInvalidation }
  | { type: 'task_updated'; payload: ResourceInvalidation }
  | { type: 'orders_updated'; payload: ResourceInvalidation }
  | { type: 'line_updated'; payload: ResourceInvalidation }
  | { type: 'wash_updated'; payload: ResourceInvalidation }
  | { type: 'okk_updated'; payload: ResourceInvalidation }
  | { type: 'stock_updated'; payload: ResourceInvalidation }
  | { type: 'returns_updated'; payload: ResourceInvalidation }
  | { type: 'defrost_updated'; payload: ResourceInvalidation }
  | { type: 'quantity_release_updated'; payload: ResourceInvalidation }
  | { type: 'checklist_updated'; payload: ResourceInvalidation }
  | { type: 'notification_created'; payload: NotificationItem }
  | { type: 'notifications_count_changed'; payload: { reason?: string } }
  | { type: 'auth_context_changed'; payload: { message?: string } }
  | { type: 'chat_updated'; payload: { chatId?: string } };

type ConnectOptions = {
  onNotification?: (notification: NotificationItem) => void;
  onUnreadShouldRefresh?: () => void;
  onAuthContextChanged?: (message: string) => void;
  onStatus?: (status: WsStatus) => void;
};

let operationalRefreshTimer: number | null = null;

function scheduleOperationalRefresh(reason: 'assignment' | 'shift' | 'line' | 'wash' | 'quantity-release' | 'checklist' | 'reconnect', isCurrent: () => boolean) {
  if (operationalRefreshTimer !== null) window.clearTimeout(operationalRefreshTimer);
  operationalRefreshTimer = window.setTimeout(() => {
    operationalRefreshTimer = null;
    if (!isCurrent()) return;
    window.dispatchEvent(new CustomEvent('zavod:operational-data-invalidated', { detail: { reason } }));
  }, 140);
}

function resolveWsConnection() {
  const url = new URL(API_URL || window.location.origin);
  const context = getApiContext();
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  if (!context.authToken && context.userId) url.searchParams.set('userId', context.userId);
  if (context.factoryId) url.searchParams.set('factoryId', context.factoryId);
  url.hash = '';
  return {
    url: url.toString(),
    protocols: [
      'zavod-v1',
      ...(context.authToken ? [`auth.${context.authToken}`] : []),
    ],
  };
}

function applyEvent(event: WsEvent, options: ConnectOptions, isCurrent: () => boolean) {
  const state = appStore.getState();

  if (event.type === 'task_updated') {
    window.dispatchEvent(new CustomEvent('zavod:task-updated', { detail: event.payload }));
    if (WS_DEBUG) console.debug('[ws] task_updated');
  }

  if (event.type === 'orders_updated') {
    window.dispatchEvent(new CustomEvent('zavod:orders-updated', { detail: event.payload }));
    if (WS_DEBUG) console.debug('[ws] orders_updated');
  }

  if (event.type === 'line_updated') {
    scheduleOperationalRefresh('line', isCurrent);
    if (WS_DEBUG) console.debug('[ws] line_updated');
  }

  if (event.type === 'assignment_updated') {
    scheduleOperationalRefresh('assignment', isCurrent);
    if (WS_DEBUG) console.debug('[ws] assignment_updated');
  }

  if (event.type === 'shift_updated') {
    scheduleOperationalRefresh('shift', isCurrent);
    if (WS_DEBUG) console.debug('[ws] shift_updated');
  }

  if (event.type === 'wash_updated') {
    scheduleOperationalRefresh('wash', isCurrent);
    window.dispatchEvent(new CustomEvent('zavod:wash-updated', { detail: event.payload }));
    if (WS_DEBUG) console.debug('[ws] wash_updated');
  }

  if (event.type === 'okk_updated') {
    window.dispatchEvent(new CustomEvent('zavod:okk-updated', { detail: event.payload }));
    if (WS_DEBUG) console.debug('[ws] okk_updated');
  }

  if (event.type === 'stock_updated') {
    window.dispatchEvent(new CustomEvent('zavod:stock-updated', { detail: event.payload }));
  }

  if (event.type === 'returns_updated') {
    window.dispatchEvent(new CustomEvent('zavod:returns-updated', { detail: event.payload }));
  }

  if (event.type === 'defrost_updated') {
    window.dispatchEvent(new CustomEvent('zavod:defrost-updated', { detail: event.payload }));
    if (WS_DEBUG) console.debug('[ws] defrost_updated');
  }

  if (event.type === 'quantity_release_updated') {
    scheduleOperationalRefresh('quantity-release', isCurrent);
    window.dispatchEvent(new CustomEvent('zavod:quantity-release-updated', { detail: event.payload }));
    if (WS_DEBUG) console.debug('[ws] quantity_release_updated');
  }

  if (event.type === 'checklist_updated') {
    scheduleOperationalRefresh('checklist', isCurrent);
    if (WS_DEBUG) console.debug('[ws] checklist_updated');
  }

  if (event.type === 'notification_created') {
    appStore.setNotificationsUnreadCount(state.notificationsUnreadCount + 1);
    options.onNotification?.(event.payload);
  }

  if (event.type === 'notifications_count_changed') {
    options.onUnreadShouldRefresh?.();
  }

  if (event.type === 'auth_context_changed') {
    options.onAuthContextChanged?.(event.payload.message ?? 'Права доступа изменились. Данные будут обновлены.');
  }

  if (event.type === 'chat_updated') {
    window.dispatchEvent(new CustomEvent('zavod:chat-updated', { detail: event.payload }));
  }
}

export function connectWs(options: ConnectOptions = {}) {
  if (!WS_ENABLED || typeof WebSocket === 'undefined') {
    options.onStatus?.('fallback');
    return { close: () => undefined };
  }

  let closedByCaller = false;
  let reconnectSuppressed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let attempts = 0;
  const contextKey = () => {
    const state = appStore.getState();
    return JSON.stringify([getApiContext(), state.authStatus, state.currentUser?.role,
      state.currentUser?.isGuest, state.currentUser?.departmentId,
      [...(state.currentUser?.permissions ?? [])].sort()]);
  };
  const initialContext = contextKey();
  let contextInvalidated = false;
  // Invalidate synchronously, including an A→B→A transition before React cleanup.
  const unsubscribeContext = appStore.subscribe(() => {
    if (contextKey() !== initialContext) contextInvalidated = true;
  });
  const isCurrent = () => !closedByCaller && !contextInvalidated;

  const clearReconnect = () => {
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (!isCurrent() || reconnectSuppressed || reconnectTimer !== null) return;
    clearReconnect();
    options.onStatus?.('fallback');
    if (!navigator.onLine) return;
    attempts += 1;
    const delay = attempts <= 6
      ? Math.min(15000, 1000 * 2 ** Math.min(attempts, 4))
      : 30000;
    reconnectTimer = window.setTimeout(connect, delay);
  };

  const connect = () => {
    if (!isCurrent() || reconnectSuppressed) return;
    if (!navigator.onLine) {
      options.onStatus?.('fallback');
      return;
    }
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
    clearReconnect();
    try {
      options.onStatus?.('connecting');
      const connection = resolveWsConnection();
      const currentSocket = new WebSocket(connection.url, connection.protocols);
      socket = currentSocket;
      currentSocket.onopen = () => {
        if (!isCurrent() || socket !== currentSocket) return;
        attempts = 0;
        options.onStatus?.('connected');
        // A separate signal cannot be swallowed by the shared operational debounce.
        window.dispatchEvent(new CustomEvent('zavod:ws-reconnected'));
        scheduleOperationalRefresh('reconnect', isCurrent);
        if (WS_DEBUG) console.debug('[ws] connected');
      };
      currentSocket.onmessage = (event) => {
        if (!isCurrent() || socket !== currentSocket) return;
        try {
          const parsed = JSON.parse(event.data) as WsEvent;
          if (parsed.type === 'auth_context_changed') {
            reconnectSuppressed = true;
            clearReconnect();
          }
          applyEvent(parsed, options, isCurrent);
        } catch {
          if (WS_DEBUG) console.debug('[ws] message parse error');
        }
      };
      currentSocket.onerror = () => {
        if (WS_DEBUG) console.debug('[ws] error');
      };
      currentSocket.onclose = (event) => {
        if (!isCurrent() || socket !== currentSocket) return;
        socket = null;
        if (WS_DEBUG) console.debug('[ws] closed');
        if (event.code === 4001) reconnectSuppressed = true;
        if (reconnectSuppressed) {
          options.onStatus?.('closed');
          return;
        }
        scheduleReconnect();
      };
    } catch {
      scheduleReconnect();
    }
  };

  const onOnline = () => {
    if (!isCurrent() || reconnectSuppressed) return;
    attempts = 0;
    clearReconnect();
    connect();
  };
  window.addEventListener('online', onOnline);
  connect();

  return {
    close: () => {
      closedByCaller = true;
      unsubscribeContext();
      clearReconnect();
      window.removeEventListener('online', onOnline);
      options.onStatus?.('closed');
      socket?.close();
    },
  };
}
