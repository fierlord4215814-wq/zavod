import { Injectable } from '@nestjs/common';
import { AttachmentKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'path';
import { ConflictError } from '../../common/errors/conflict.exception';

const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FILE_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const AUDIO_MIME_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav']);

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export function resolveFileStorageRoot(envRoot = process.env.FILE_STORAGE_ROOT, cwd = process.cwd()) {
  // FILE_STORAGE_ROOT is required for pilot/production-like runs; cwd fallback is kept for local dev compatibility.
  return resolve(envRoot?.trim() || resolve(cwd, 'uploads'));
}

@Injectable()
export class FileStorageService {
  private readonly rootDir = resolveFileStorageRoot();

  validateMimeType(kind: AttachmentKind, mimeType: string) {
    if (kind === AttachmentKind.PHOTO && !PHOTO_MIME_TYPES.has(mimeType)) {
      throw new ConflictError('Поддерживаются только фото jpg, png или webp');
    }
    if (kind === AttachmentKind.FILE && !FILE_MIME_TYPES.has(mimeType)) {
      throw new ConflictError('Поддерживаются файлы pdf, txt и фото jpg, png, webp');
    }
    if (kind === AttachmentKind.VIDEO && !VIDEO_MIME_TYPES.has(mimeType)) {
      throw new ConflictError('Поддерживаются видео mp4, webm или mov');
    }
    if (kind === AttachmentKind.AUDIO && !AUDIO_MIME_TYPES.has(mimeType)) {
      throw new ConflictError('Поддерживаются аудио webm, ogg, mp3, mp4 или wav');
    }
    if (kind !== AttachmentKind.PHOTO && kind !== AttachmentKind.FILE && kind !== AttachmentKind.VIDEO && kind !== AttachmentKind.AUDIO) {
      throw new ConflictError('Этот тип вложения пока не поддерживается');
    }
  }

  validateSize(kind: AttachmentKind, sizeBytes: number) {
    const limit = kind === AttachmentKind.PHOTO ? MAX_PHOTO_BYTES : kind === AttachmentKind.VIDEO ? MAX_VIDEO_BYTES : kind === AttachmentKind.AUDIO ? MAX_AUDIO_BYTES : MAX_FILE_BYTES;
    if (sizeBytes <= 0) throw new ConflictError('Файл пустой или недоступен');
    if (sizeBytes > limit) {
      const label = kind === AttachmentKind.PHOTO ? 'Фото должно быть не больше 10 МБ' : kind === AttachmentKind.VIDEO ? 'Видео должно быть не больше 50 МБ' : kind === AttachmentKind.AUDIO ? 'Голосовое сообщение должно быть не больше 15 МБ' : 'Файл должен быть не больше 15 МБ';
      throw new ConflictError(label);
    }
  }

  async saveUploadedFile(params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    kind: AttachmentKind;
    entityType: string;
  }) {
    this.validateMimeType(params.kind, params.mimeType);
    this.validateSize(params.kind, params.buffer.length);

    const safeExt = this.safeExtension(params.originalName, params.mimeType);
    const folder = params.entityType.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const fileName = `${randomUUID()}${safeExt}`;
    const relativePath = join(folder, fileName);
    const absoluteFolder = this.resolveStoragePath(folder);
    const absolutePath = this.resolveStoragePath(relativePath);

    await mkdir(absoluteFolder, { recursive: true });
    await writeFile(absolutePath, params.buffer);

    return {
      storagePath: relativePath.replace(/\\/g, '/'),
      sizeBytes: params.buffer.length,
    };
  }

  async readStorageFile(storagePath: string) {
    const absolutePath = this.resolveStoragePath(storagePath);
    try {
      await stat(absolutePath);
      return await readFile(absolutePath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') throw new ConflictError('Файл отсутствует в хранилище');
      throw error;
    }
  }

  buildSafeUrl(attachmentId: string) {
    return `/attachments/${attachmentId}/file`;
  }

  private resolveStoragePath(storagePath: string) {
    const normalized = String(storagePath ?? '').replace(/\\/g, '/');
    if (!normalized || isAbsolute(normalized)) throw new ConflictError('Недопустимый путь хранения файла');
    const absolutePath = resolve(this.rootDir, normalized);
    const rel = relative(this.rootDir, absolutePath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new ConflictError('Недопустимый путь хранения файла');
    return absolutePath;
  }

  private safeExtension(originalName: string, mimeType: string) {
    const ext = extname(originalName).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.txt', '.mp4', '.webm', '.mov', '.ogg', '.mp3', '.wav', '.m4a'].includes(ext)) return ext;
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'application/pdf') return '.pdf';
    if (mimeType === 'video/mp4') return '.mp4';
    if (mimeType === 'video/webm') return '.webm';
    if (mimeType === 'video/quicktime') return '.mov';
    if (mimeType === 'audio/webm') return '.webm';
    if (mimeType === 'audio/ogg') return '.ogg';
    if (mimeType === 'audio/mpeg') return '.mp3';
    if (mimeType === 'audio/mp4') return '.m4a';
    if (mimeType === 'audio/wav') return '.wav';
    return '.bin';
  }
}
