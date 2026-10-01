import { Injectable } from '@nestjs/common';
import { AttachmentEntityType, AttachmentKind, UserRole } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pilotDisplayName } from '../../common/pilot-visibility';
import { PrismaService } from '../../prisma/prisma.service';
import { FileStorageService } from '../attachments/file-storage.service';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  MANAGEMENT: 'Руководство',
  MASTER: 'Мастер',
  WORKER: 'Работник',
  CONTRACTOR: 'Наёмный работник',
  CONTRACTOR_LEAD: 'Старший наёмных работников',
  OKK: 'ОКК',
  TECHNOLOG: 'Технолог',
  STORE: 'Склад',
  TECH_HOLOD: 'Холодильная служба',
  TECH_KIPIA: 'КИПиА',
  TECH_ELECTRIC: 'Электрик',
  TECH_MECHANIC: 'Механик',
  TECH_SANTECHNIK: 'Сантехник',
  OTHER: 'Другое',
};

function projectRoot(cwd = process.cwd()) {
  return path.basename(cwd).toLowerCase() === 'backend' ? path.dirname(cwd) : cwd;
}

function readRuntimeConfigValue(key: string, cwd = process.cwd()) {
  const envFile = process.env.ZAVOD_RUNTIME_ENV_FILE;
  const candidates = [
    envFile ? path.join(path.dirname(envFile), 'zavod.config.json') : '',
    path.join(projectRoot(cwd), 'setup', 'runtime', 'zavod.config.json'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const data = JSON.parse(readFileSync(candidate, 'utf8').replace(/^\uFEFF/, ''));
      const value = data?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch {
      // Runtime config is optional for local dev; env/default below remain safe.
    }
  }
  return '';
}

export function resolveErrorReportsExportRoot(env = process.env, cwd = process.cwd()) {
  const configured =
    env.ERROR_REPORTS_EXPORT_PATH?.trim() ||
    readRuntimeConfigValue('errorReportsExportPath', cwd);
  return path.resolve(configured || path.join(projectRoot(cwd), 'data', 'error-reports-export'));
}

function normalizeText(value: unknown, fallback = 'не указано') {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return text || fallback;
}

function roleLabel(role?: UserRole | string | null) {
  if (!role) return 'Не указана';
  return ROLE_LABELS[String(role)] ?? 'Не указана';
}

function safeName(value: string, fallback = 'file') {
  const clean = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80);
  return clean || fallback;
}

function slug(value: string, fallback = 'report') {
  return safeName(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || fallback;
}

function isoFileStamp(value: Date) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

function safeJoin(root: string, ...segments: string[]) {
  const target = path.resolve(root, ...segments);
  const rel = path.relative(path.resolve(root), target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Недопустимый путь файловой копии.');
  return target;
}

@Injectable()
export class ErrorReportFileExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
  ) {}

  async exportReport(reportId: string) {
    const report = await this.prisma.db.errorReport.findUnique({
      where: { id: reportId },
      include: { author: true, factory: true, closedBy: true },
    });
    if (!report) return { ok: false, warning: 'Сообщение об ошибке не найдено.' };

    const [departmentAccess, attachments] = await Promise.all([
      report.authorId && report.factoryId
        ? this.prisma.db.userFactoryAccess.findFirst({
            where: { userId: report.authorId, factoryId: report.factoryId },
            include: { department: true },
          })
        : null,
      this.prisma.db.attachment.findMany({
        where: { entityType: AttachmentEntityType.ERROR_REPORT, entityId: report.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const root = resolveErrorReportsExportRoot();
    const folderName = [
      isoFileStamp(new Date(report.createdAt)),
      `report-${report.id.slice(0, 8)}`,
      slug(report.factory?.name ?? 'factory'),
      slug(report.section),
    ].join('-');
    const reportDir = safeJoin(root, folderName);
    const attachmentsDir = safeJoin(reportDir, 'attachments');
    await mkdir(attachmentsDir, { recursive: true });

    const attachmentResults = [];
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      const extension = path.extname(attachment.originalName || '') || this.extensionByMime(attachment.mimeType);
      const baseName = safeName(path.basename(attachment.originalName || `attachment-${index + 1}`, extension), `attachment-${index + 1}`);
      const fileName = `${String(index + 1).padStart(2, '0')}-${baseName}${extension || '.bin'}`;
      const relativeName = `attachments/${fileName}`;
      try {
        const buffer = await this.storage.readStorageFile(attachment.storagePath);
        await writeFile(safeJoin(reportDir, relativeName), buffer, { flag: 'w' });
        attachmentResults.push({
          id: attachment.id,
          originalName: attachment.originalName,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          copiedAs: relativeName,
          copied: true,
        });
      } catch {
        attachmentResults.push({
          id: attachment.id,
          originalName: attachment.originalName,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          copied: false,
          warning: 'Файл вложения недоступен в хранилище.',
        });
      }
    }

    const authorName = report.author ? pilotDisplayName(report.author) : 'Пользователь';
    const manifest = {
      schemaVersion: 1,
      packageType: 'error-report-export',
      format: 'html+txt',
      createdAt: new Date().toISOString(),
      report: {
        id: report.id,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        factory: report.factory?.name ?? null,
        author: authorName,
        role: roleLabel(report.authorRole),
        department: departmentAccess?.department?.name ?? null,
        section: report.section,
        title: report.title,
        status: report.status,
      },
      files: {
        reportHtml: 'report.html',
        reportTxt: 'report.txt',
        attachments: attachmentResults,
      },
      warnings: attachmentResults.filter((item) => !item.copied).map((item) => `${item.originalName}: ${item.warning}`),
    };

    await Promise.all([
      writeFile(safeJoin(reportDir, 'report.html'), this.renderHtml(report, authorName, departmentAccess?.department?.name ?? null, attachmentResults), 'utf8'),
      writeFile(safeJoin(reportDir, 'report.txt'), this.renderText(report, authorName, departmentAccess?.department?.name ?? null, attachmentResults), 'utf8'),
      writeFile(safeJoin(reportDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    ]);

    return {
      ok: true,
      reportId: report.id,
      attachmentCount: attachments.length,
      copiedAttachmentCount: attachmentResults.filter((item) => item.copied).length,
      missingAttachmentCount: attachmentResults.filter((item) => !item.copied).length,
    };
  }

  private renderHtml(report: any, authorName: string, departmentName: string | null, attachments: any[]) {
    const imageBlocks = attachments
      .filter((item) => item.copied && item.kind === AttachmentKind.PHOTO)
      .map((item) => `<figure><img src="${escapeHtml(item.copiedAs)}" alt="${escapeHtml(item.originalName)}"><figcaption>${escapeHtml(item.originalName)}</figcaption></figure>`)
      .join('\n');
    const attachmentRows = attachments.map((item) => `<li>${escapeHtml(item.originalName)} — ${escapeHtml(item.kind)} · ${escapeHtml(item.mimeType)} · ${item.copied ? escapeHtml(item.copiedAs) : 'файл недоступен'}</li>`).join('\n');
    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(report.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #182033; background: #f5f7fb; }
    main { max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #d9e0ec; border-radius: 12px; padding: 24px; }
    h1 { margin-top: 0; }
    dl { display: grid; grid-template-columns: 220px 1fr; gap: 8px 16px; }
    dt { color: #56657d; }
    dd { margin: 0; }
    .description { white-space: normal; line-height: 1.5; padding: 16px; background: #f0f4fa; border-radius: 10px; }
    img { max-width: 100%; border-radius: 10px; border: 1px solid #d9e0ec; }
    figure { margin: 18px 0; }
  </style>
</head>
<body>
<main>
  <h1>Сообщение об ошибке</h1>
  <dl>
    <dt>ID</dt><dd>${escapeHtml(report.id)}</dd>
    <dt>Дата</dt><dd>${escapeHtml(new Date(report.createdAt).toLocaleString('ru-RU'))}</dd>
    <dt>Завод</dt><dd>${escapeHtml(report.factory?.name ?? 'не указан')}</dd>
    <dt>Автор</dt><dd>${escapeHtml(authorName)}</dd>
    <dt>Роль</dt><dd>${escapeHtml(roleLabel(report.authorRole))}</dd>
    <dt>Отдел</dt><dd>${escapeHtml(departmentName ?? 'не указан')}</dd>
    <dt>Раздел</dt><dd>${escapeHtml(report.section)}</dd>
    <dt>Тема</dt><dd>${escapeHtml(report.title)}</dd>
    <dt>Статус</dt><dd>${escapeHtml(report.status)}</dd>
  </dl>
  <h2>Описание</h2>
  <div class="description">${escapeHtml(normalizeText(report.description, ''))}</div>
  <h2>Вложения</h2>
  ${attachments.length ? `<ul>${attachmentRows}</ul>${imageBlocks}` : '<p>Вложений нет.</p>'}
  <p>Оригинал сообщения доступен администратору в приложении «Завод».</p>
</main>
</body>
</html>
`;
  }

  private renderText(report: any, authorName: string, departmentName: string | null, attachments: any[]) {
    return [
      'Сообщение об ошибке',
      '',
      `ID: ${report.id}`,
      `Дата: ${new Date(report.createdAt).toLocaleString('ru-RU')}`,
      `Завод: ${report.factory?.name ?? 'не указан'}`,
      `Автор: ${authorName}`,
      `Роль: ${roleLabel(report.authorRole)}`,
      `Отдел: ${departmentName ?? 'не указан'}`,
      `Раздел: ${report.section}`,
      `Тема: ${report.title}`,
      `Статус: ${report.status}`,
      '',
      'Описание:',
      normalizeText(report.description, ''),
      '',
      'Вложения:',
      ...(attachments.length
        ? attachments.map((item) => `- ${item.originalName} · ${item.kind} · ${item.mimeType} · ${item.copied ? item.copiedAs : 'файл недоступен'}`)
        : ['Вложений нет.']),
      '',
      'Оригинал сообщения доступен администратору в приложении «Завод».',
      '',
    ].join('\n');
  }

  private extensionByMime(mimeType: string) {
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'application/pdf') return '.pdf';
    if (mimeType === 'text/plain') return '.txt';
    if (mimeType === 'video/mp4') return '.mp4';
    if (mimeType === 'video/webm') return '.webm';
    if (mimeType === 'video/quicktime') return '.mov';
    return '.bin';
  }
}
