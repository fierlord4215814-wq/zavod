import type { AttachmentInputMode } from './AttachmentInputButton';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const FILE_TYPES = ['application/pdf', 'text/plain'];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

type ValidateOptions = {
  allowFiles: boolean;
  allowVideo: boolean;
  mode?: AttachmentInputMode;
};

export function attachmentFileKey(file: File) {
  return `${file.name}-${file.size}-${file.type}`;
}

export function validateAttachmentFile(file: File, options: ValidateOptions): string | null {
  const isPhoto = PHOTO_TYPES.includes(file.type);
  const isVideo = VIDEO_TYPES.includes(file.type);
  const isFile = FILE_TYPES.includes(file.type);
  const mode = options.mode;

  if ((mode === 'photo' || mode === 'camera') && !isPhoto) return 'Поддерживаются только фото jpg, png или webp.';
  if (mode === 'video' && !isVideo) return 'Поддерживаются видео mp4, webm или mov.';
  if (!mode && !options.allowFiles && !isPhoto) return 'Поддерживаются только фото jpg, png или webp.';
  if (!isPhoto && !isVideo && !isFile) return 'Поддерживаются фото jpg, png, webp, видео mp4/webm/mov, PDF и txt.';
  if (isVideo && !options.allowVideo) return 'Видео в этой форме не поддерживается.';
  if (!isPhoto && !isVideo && !options.allowFiles) return 'Файлы в этой форме не поддерживаются.';
  if (isPhoto && file.size > MAX_PHOTO_BYTES) return 'Фото должно быть не больше 10 МБ.';
  if (isVideo && file.size > MAX_VIDEO_BYTES) return 'Видео должно быть не больше 50 МБ.';
  if (!isPhoto && !isVideo && file.size > MAX_FILE_BYTES) return 'Файл должен быть не больше 15 МБ.';
  if (file.size <= 0) return 'Файл пустой или недоступен.';
  return null;
}

export function mergeAttachmentFiles(
  current: File[],
  incoming: File[],
  options: ValidateOptions,
) {
  const next = [...current];
  let error: string | null = null;
  const keys = new Set(next.map(attachmentFileKey));
  for (const file of incoming) {
    const problem = validateAttachmentFile(file, options);
    if (problem) {
      error = problem;
      continue;
    }
    const key = attachmentFileKey(file);
    if (!keys.has(key)) {
      keys.add(key);
      next.push(file);
    }
  }
  return { files: next, error };
}
