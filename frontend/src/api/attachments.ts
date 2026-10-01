import { createOperationId } from './operation';
import { apiClient } from './client';

export type AttachmentUploadProgress = {
  file: File;
  index: number;
  percent: number;
  state: 'uploading' | 'done' | 'error' | 'cancelled';
  error?: string;
};

type UploadAttachmentsOptions = {
  signal?: AbortSignal;
  operationIds?: string[];
  onProgress?: (progress: AttachmentUploadProgress) => void;
};

export async function uploadAttachments<T = unknown>(entityType: string, entityId: string, files: File[], options: UploadAttachmentsOptions = {}) {
  const uploaded: T[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', entityType);
    formData.append('entityId', entityId);
    formData.append('kind', file.type.startsWith('image/') ? 'PHOTO' : file.type.startsWith('video/') ? 'VIDEO' : file.type.startsWith('audio/') ? 'AUDIO' : 'FILE');
    formData.append('operationId', options.operationIds?.[index] ?? createOperationId('attachment'));
    options.onProgress?.({ file, index, percent: 0, state: 'uploading' });
    try {
      const result = await apiClient.uploadWithProgress<T>('/attachments/upload', formData, {
        signal: options.signal,
        // Bytes sent is not server acceptance; keep cancellation available until the response.
        onProgress: (percent) => options.onProgress?.({ file, index, percent, state: 'uploading' }),
      });
      uploaded.push(result);
      options.onProgress?.({ file, index, percent: 100, state: 'done' });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      options.onProgress?.({
        file,
        index,
        percent: 0,
        state: cancelled ? 'cancelled' : 'error',
        error: error instanceof Error ? error.message : 'Не удалось загрузить файл.',
      });
      throw error;
    }
  }
  return uploaded;
}
