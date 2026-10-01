import { BASE_URL } from './client';
import { appStore, getApiContext } from '../store/app.store';

// Protected previews live only while mounted consumers hold a lease. This is not
// an API response cache: no persisted bytes, errors or cross-session reuse.
type Entry = { users: number; url: string | null; pending: Promise<string> | null; abort: AbortController | null; valid: boolean };
const entries = new Map<string, Entry>();
let contextKey = '';
let unsubscribe: (() => void) | null = null;
let leases = 0;
const invalidationListeners = new Set<() => void>();
function identity() {
  const state = appStore.getState();
  return JSON.stringify([getApiContext(), state.authStatus, state.currentUser?.role, state.currentUser?.isGuest, state.currentUser?.departmentId, [...(state.currentUser?.permissions ?? [])].sort()]);
}
function dispose(entry: Entry) {
  entry.valid = false;
  entry.abort?.abort();
  if (entry.url) URL.revokeObjectURL(entry.url);
  entry.url = null;
}
function checkContext() {
  const next = identity();
  if (next === contextKey) return;
  contextKey = next;
  entries.forEach(dispose);
  entries.clear();
  invalidationListeners.forEach(listener => listener());
}
export function acquireAttachmentPreview(id: string, onInvalidated: () => void) {
  if (!unsubscribe) { contextKey = identity(); unsubscribe = appStore.subscribe(checkContext); }
  checkContext();
  const key = contextKey;
  let entry = entries.get(id);
  if (!entry) { entry = { users: 0, url: null, pending: null, abort: null, valid: true }; entries.set(id, entry); }
  const resource = entry;
  resource.users++; leases++;
  // Per-lease wrapper: two attachments may share the same consumer callback.
  const notify = () => onInvalidated();
  invalidationListeners.add(notify);
  let released = false;
  const isCurrent = () => !released && resource.valid && key === identity();
  return {
    isCurrent,
    load(): Promise<string> {
      if (!isCurrent()) return Promise.reject(new Error('Контекст доступа изменился. Откройте файл повторно.'));
      if (resource.url) return Promise.resolve(resource.url);
      if (resource.pending) return resource.pending;
      const context = getApiContext();
      if (!context.userId || !context.factoryId) return Promise.reject(new Error('Войдите и выберите завод для просмотра файла.'));
      const controller = new AbortController();
      resource.abort = controller;
      const timeout = window.setTimeout(() => controller.abort(), 30_000);
      const operation = (async () => {
        try {
          const response = await fetch(`${BASE_URL}/attachments/${encodeURIComponent(id)}/file`, {
            signal: controller.signal,
            headers: { 'x-user-id': context.userId, 'x-factory-id': context.factoryId, ...(context.authToken ? { Authorization: `Bearer ${context.authToken}` } : {}) },
          });
          if (!response.ok) throw new Error(response.status === 401 ? 'Сессия истекла. Войдите снова.' : response.status === 403 ? 'Нет прав для просмотра.' : response.status === 404 ? 'Файл отсутствует в хранилище.' : 'Не удалось загрузить файл. Повторите попытку.');
          const blob = await response.blob();
          if (!resource.valid || key !== identity() || controller.signal.aborted) throw new Error('Загрузка отменена. Откройте файл повторно.');
          if (!blob.size) throw new Error('Файл повреждён или пустой.');
          resource.url = URL.createObjectURL(blob);
          return resource.url;
        } catch (error) {
          if (controller.signal.aborted) throw new Error('Загрузка отменена или превышено время ожидания. Повторите попытку.');
          if (error instanceof TypeError) throw new Error('Нет связи с сервером. Повторите загрузку файла.');
          throw error;
        } finally { window.clearTimeout(timeout); resource.pending = null; resource.abort = null; }
      })();
      resource.pending = operation;
      return operation;
    },
    release() {
      if (released) return;
      released = true; leases--; resource.users--;
      invalidationListeners.delete(notify);
      if (!resource.users) { dispose(resource); if (entries.get(id) === resource) entries.delete(id); }
      if (!leases) { unsubscribe?.(); unsubscribe = null; contextKey = ''; }
    },
  };
}
