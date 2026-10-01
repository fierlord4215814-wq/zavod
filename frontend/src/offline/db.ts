import { getAll, put, remove } from './indexeddb';

export type PendingAction = {
  id: string;
  operationId?: string;
  type?: string;
  endpoint: string;
  method: 'POST' | 'PATCH';
  payload: unknown;
  entityType?: string;
  entityId?: string;
  headers?: Record<string, string>;
  userId?: string;
  factoryId?: string;
  optimisticKey?: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
  lastError?: string;
  attempts?: number;
  retryCount?: number;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CachedEntity<T> = {
  key: string;
  data: T;
  updatedAt: string;
};

export const pendingActionsStore = {
  getAll: async () => (await getAll('pending')) as PendingAction[],
  put: async (action: PendingAction) => put('pending', action),
  remove: async (id: string) => remove('pending', id),
};

export const cacheStore = {
  getAll: async <T>() => (await getAll('cache')) as CachedEntity<T>[],
  put: async <T>(entry: CachedEntity<T>) => put('cache', entry),
  remove: async (key: string) => remove('cache', key),
};
