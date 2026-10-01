import { appStore, getApiContext } from '../store/app.store';

export const BASE_URL = import.meta.env.VITE_API_URL?.trim() || '/api';

type RequestOptions = RequestInit & {
  skipContextHeaders?: boolean;
};

type UploadProgressOptions = {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
};

export class ApiNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

export class ApiContextChangedError extends Error {
  constructor() {
    // A command may already have committed. Do not claim that it was undone.
    super('Контекст доступа изменился. Ответ прежнего запроса не применён. Обновите данные перед повторным действием.');
    this.name = 'ApiContextChangedError';
  }
}

let connectivityRequestSequence = 0;
let connectivityObservationSequence = 0;

function observeResponseContext() {
  const sequence = ++connectivityRequestSequence;
  const identity = () => {
    const state = appStore.getState();
    return JSON.stringify([getApiContext(), state.authStatus, state.currentUser?.role,
      state.currentUser?.isGuest, state.currentUser?.departmentId,
      [...(state.currentUser?.permissions ?? [])].sort()]);
  };
  const initial = identity();
  let invalidated = false;
  // Remember intervening transitions too: comparing only the final A after
  // A→B→A (or logout/login) would accept a response from an obsolete session.
  const release = appStore.subscribe(() => { if (identity() !== initial) invalidated = true; });
  return {
    current: () => !invalidated, release,
    assertCurrent: () => { if (invalidated) throw new ApiContextChangedError(); },
    reportConnectivity: (message: string | null) => {
      // An older in-flight request cannot overwrite a newer observation. This
      // describes this API transport only, not application health or commit status.
      if (invalidated || sequence < connectivityObservationSequence) return;
      connectivityObservationSequence = sequence;
      emitApiConnectivity(message);
    },
  };
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError || error instanceof ApiNetworkError
    || (error instanceof Error && error.name === 'TimeoutError');
}

function networkErrorMessage() {
  return 'Не удалось получить ответ сервера. Проверьте результат действия перед повтором.';
}

function invalidResponseMessage() {
  return 'Сервер вернул некорректный ответ. Проверьте результат действия перед повтором.';
}

function emitApiConnectivity(message: string | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('zavod:api-connectivity', { detail: { message } }));
}

function safeApiMessage(message: string) {
  const text = message.trim();
  if (!text) return '';
  const technicalMarkers = [
    /factoryId|userId|departmentId|permission|payload|scope|rbac|UserFactoryAccess/i,
    /storagePath|passwordHash|DATABASE_URL|token|secret/i,
    /factory context required|access denied|forbidden|unauthorized|not found/i,
    /[A-Za-z]{3,}/,
    /\b[A-Za-z]+[A-Z][A-Za-z]*\b/,
    /^[A-Z0-9_:-]{4,}$/,
  ];
  if (technicalMarkers.some((pattern) => pattern.test(text))) return '';
  return text;
}

async function apiErrorMessage(response: Response) {
  let message = '';
  try {
    const payload = await response.json();
    if (payload && typeof payload.message === 'string') message = payload.message;
  } catch {
    // Non-JSON responses use the user-facing fallback below.
  }

  const safeMessage = safeApiMessage(message);

  if (response.status === 401) return safeMessage || 'Сессия истекла. Войдите снова.';
  if (response.status === 403) {
    return safeMessage || 'Нет доступа к этому действию. Если доступ должен быть, обратитесь к мастеру, руководителю или администратору.';
  }
  if (response.status === 404) return 'Данные не найдены.';
  if (response.status === 409) return safeMessage || 'Действие сейчас невозможно из-за текущего состояния данных.';
  if (response.status >= 500) return 'Ошибка сервера. Повторите позже.';
  return safeMessage || `Не удалось выполнить запрос. Код ответа: ${response.status}.`;
}

async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  const fullUrl = `${BASE_URL}${url}`;
  const context = getApiContext();
  const contextHeaders: Record<string, string> = {
    ...(context.userId ? { 'x-user-id': context.userId } : {}),
    ...(context.factoryId ? { 'x-factory-id': context.factoryId } : {}),
    ...(context.authToken ? { Authorization: `Bearer ${context.authToken}` } : {}),
  };
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options?.skipContextHeaders ? {} : contextHeaders),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const responseContext = observeResponseContext();

  try {
    const response = await fetch(fullUrl, {
      ...options,
      headers,
    });
    responseContext.assertCurrent();
    // A current HTTP refusal still proves that this request reached a responder.
    // Keep its business error; never equate this notice reset with command success.
    responseContext.reportConnectivity(null);
    if (!response.ok) {
      const message = await apiErrorMessage(response);
      responseContext.assertCurrent();
      throw new Error(message);
    }
    const result = response.status === 204 ? null : await response.json();
    responseContext.assertCurrent();
    return result as T;
  } catch (error) {
    responseContext.assertCurrent();
    if (isNetworkError(error)) {
      const message = networkErrorMessage();
      responseContext.reportConnectivity(message);
      throw new ApiNetworkError(message);
    }
    if (error instanceof SyntaxError) throw new Error(invalidResponseMessage());
    throw error;
  } finally {
    responseContext.release();
  }
}

async function downloadBlob(url: string): Promise<{ blob: Blob; filename: string; primaryCount: number | null }> {
  const fullUrl = `${BASE_URL}${url}`;
  const context = getApiContext();
  const responseContext = observeResponseContext();
  try {
  const response = await fetch(fullUrl, {
    headers: {
      ...(context.userId ? { 'x-user-id': context.userId } : {}),
      ...(context.factoryId ? { 'x-factory-id': context.factoryId } : {}),
      ...(context.authToken ? { Authorization: `Bearer ${context.authToken}` } : {}),
    },
  });
  responseContext.assertCurrent();
  responseContext.reportConnectivity(null);
  if (!response.ok) throw new Error(await apiErrorMessage(response));
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    ?? disposition.match(/filename="([^"]+)"/)?.[1]
    ?? '';
  const filename = encoded ? decodeURIComponent(encoded) : 'report';
  const countValue = Number(response.headers.get('x-archive-primary-count'));
  const blob = await response.blob();
  responseContext.assertCurrent();
  return { blob, filename, primaryCount: Number.isFinite(countValue) ? countValue : null };
  } catch (error) {
    responseContext.assertCurrent();
    if (isNetworkError(error)) {
      const message = networkErrorMessage();
      responseContext.reportConnectivity(message);
      throw new ApiNetworkError(message);
    }
    throw error;
  } finally {
    responseContext.release();
  }
}

function uploadWithProgress<T>(url: string, formData: FormData, options: UploadProgressOptions = {}) {
  return new Promise<T>((resolve, reject) => {
    const context = getApiContext();
    const responseContext = observeResponseContext();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => {
      responseContext.release();
      options.signal?.removeEventListener('abort', abort);
    };
    xhr.open('POST', `${BASE_URL}${url}`);
    if (context.userId) xhr.setRequestHeader('x-user-id', context.userId);
    if (context.factoryId) xhr.setRequestHeader('x-factory-id', context.factoryId);
    if (context.authToken) xhr.setRequestHeader('Authorization', `Bearer ${context.authToken}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (responseContext.current() && event.lengthComputable) options.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    const failTransport = () => {
      finish();
      if (!responseContext.current()) { reject(new ApiContextChangedError()); return; }
      const message = networkErrorMessage();
      responseContext.reportConnectivity(message);
      reject(new ApiNetworkError(message));
    };
    xhr.onerror = failTransport;
    xhr.ontimeout = failTransport;
    xhr.onabort = () => { finish(); reject(new DOMException('Загрузка отменена.', 'AbortError')); };
    xhr.onload = () => {
      finish();
      if (!responseContext.current()) { reject(new ApiContextChangedError()); return; }
      if (xhr.status === 0) { failTransport(); return; }
      responseContext.reportConnectivity(null);
      const payload = xhr.response ?? (() => {
        try { return JSON.parse(xhr.responseText); } catch { return null; }
      })();
      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.status !== 204 && payload === null) {
          reject(new Error(invalidResponseMessage()));
          return;
        }
        options.onProgress?.(100);
        resolve(payload as T);
        return;
      }
      const rawMessage = payload && typeof payload.message === 'string' ? payload.message : '';
      const safeMessage = safeApiMessage(rawMessage);
      if (xhr.status === 401) reject(new Error(safeMessage || 'Сессия истекла. Войдите снова.'));
      else if (xhr.status === 403) reject(new Error(safeMessage || 'Нет доступа к загрузке этого вложения.'));
      else if (xhr.status === 409) reject(new Error(safeMessage || 'Файл не подходит или действие сейчас невозможно.'));
      else if (xhr.status >= 500) reject(new Error('Ошибка сервера. Повторите загрузку позже.'));
      else reject(new Error(safeMessage || `Не удалось загрузить файл. Код ответа: ${xhr.status}.`));
    };
    if (options.signal) {
      if (options.signal.aborted) {
        xhr.abort();
        finish();
        reject(new DOMException('Загрузка отменена.', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', abort, { once: true });
    }
    xhr.send(formData);
  });
}

export const apiClient = {
  get: <T>(url: string) => request<T>(url),
  request,
  downloadBlob,
  post: <T>(url: string, body?: any) =>
    request<T>(url, {
      method: 'POST',
      body: JSON.stringify({ ...(body ?? {}), operationId: body?.operationId ?? crypto.randomUUID() }),
    }),
  patch: <T>(url: string, body?: any) =>
    request<T>(url, {
      method: 'PATCH',
      body: JSON.stringify({ ...(body ?? {}), operationId: body?.operationId ?? crypto.randomUUID() }),
    }),
  upload: <T>(url: string, formData: FormData) =>
    request<T>(url, {
      method: 'POST',
      body: formData,
    }),
  uploadWithProgress,
};
