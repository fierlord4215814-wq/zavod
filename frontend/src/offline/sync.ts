import { pendingActionsStore, type PendingAction } from './db';
import { getApiContext } from '../store/app.store';

function nowIso() {
  return new Date().toISOString();
}

export async function queuePendingAction(action: Omit<PendingAction, 'id' | 'status' | 'createdAt' | 'updatedAt'>) {
  const payload = (action.payload && typeof action.payload === 'object' ? action.payload : {}) as Record<string, unknown>;
  const pendingAction: PendingAction = {
    ...action,
    id: crypto.randomUUID(),
    operationId: action.operationId ?? (typeof payload.operationId === 'string' ? payload.operationId : undefined),
    type: action.type ?? `${action.method} ${action.endpoint}`,
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await pendingActionsStore.put(pendingAction);
  return pendingAction.id;
}

async function sendAction(action: PendingAction) {
  const fallbackContext = getApiContext();
  const userId = action.userId ?? fallbackContext.userId;
  const factoryId = action.factoryId ?? fallbackContext.factoryId;
  const response = await fetch(action.endpoint, {
    method: action.method,
    headers: {
      'Content-Type': 'application/json',
      ...(action.headers ?? {}),
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(factoryId ? { 'x-factory-id': factoryId } : {}),
    },
    body: JSON.stringify(action.payload),
  });

  if (!response.ok) throw new Error(`Не удалось отправить действие из очереди. Код ответа: ${response.status}.`);
}

export async function syncPendingActions() {
  if (!navigator.onLine) return;

  const pending = (await pendingActionsStore.getAll())
    .filter((action) => action.status === 'pending')
    .filter((action) => !action.nextRetryAt || Date.parse(action.nextRetryAt) <= Date.now())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const action of pending) {
    try {
      await sendAction(action);
      await pendingActionsStore.remove(action.id);
    } catch (error) {
      const attempts = (action.attempts ?? 0) + 1;
      const maxAttempts = 5;
      const backoffMs = Math.min(30000, 1000 * 2 ** attempts);
      await pendingActionsStore.put({
        ...action,
        status: attempts >= maxAttempts ? 'failed' : 'pending',
        updatedAt: nowIso(),
        attempts,
        retryCount: attempts,
        nextRetryAt: new Date(Date.now() + backoffMs).toISOString(),
        error: error instanceof Error ? error.message : String(error),
        lastError: error instanceof Error ? error.message : String(error),
      } as any);
      if (!navigator.onLine) return;
    }
  }
}

export function startSyncLoop() {
  const onOnline = () => void syncPendingActions();
  window.addEventListener('online', onOnline);
  void syncPendingActions();

  return () => window.removeEventListener('online', onOnline);
}
