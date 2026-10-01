import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AttachmentEntityType, UserRole } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { hasPilotFixtureMarker, pilotDisplayName } from '../../common/pilot-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { ErrorReportFileExportService } from './error-report-file-export.service';

type ErrorReportBody = {
  title?: string;
  description?: string;
  section?: string;
  authorName?: string;
  operationId?: string;
};

const MAX_TITLE = 120;
const MAX_SECTION = 80;
const MAX_DESCRIPTION = 5000;
const STATUSES = new Set(['NEW', 'IN_PROGRESS', 'CLOSED']);

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Новое',
  IN_PROGRESS: 'В работе',
  CLOSED: 'Закрыто',
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  MANAGEMENT: 'Руководство',
  MASTER: 'Мастер',
  WORKER: 'Работник',
  CONTRACTOR: 'Наёмный работник',
  CONTRACTOR_LEAD: 'Бригадир наёмников',
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

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, maxLength);
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\bDATABASE_URL\s*=\s*[^\s]+/gi, '[скрыто]')
    .replace(/\bJWT_SECRET\s*=\s*[^\s]+/gi, '[скрыто]')
    .replace(/\bSESSION_SECRET\s*=\s*[^\s]+/gi, '[скрыто]')
    .replace(/\bpasswordHash\s*[:=]\s*[^\s]+/gi, '[скрыто]')
    .replace(/\bstoragePath\s*[:=]\s*[^\s]+/gi, '[скрыто]')
    .replace(/\b(?:access|refresh)?token\s*[:=]\s*[^\s]+/gi, '[скрыто]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, '[скрыто]');
}

function roleLabel(role?: string | null) {
  if (!role) return 'Не указана';
  return ROLE_LABELS[role] ?? 'Не указана';
}

@Injectable()
export class ErrorReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly fileExportService: ErrorReportFileExportService,
  ) {}

  async create(user: UserContext, body: ErrorReportBody) {
    await this.assertActiveReporter(user);
    const title = normalizeText(body.title, MAX_TITLE);
    const description = redactSensitiveText(normalizeText(body.description, MAX_DESCRIPTION));
    const section = normalizeText(body.section || 'Не указан', MAX_SECTION);

    if (!title) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Укажите тему сообщения.' });
    if (!description) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Опишите, что произошло.' });

    const { report, created } = await this.prisma.db.$transaction(async (tx) => {
      const processed = await this.findProcessedCreate(tx, user, body.operationId);
      if (processed) return { report: processed, created: false };

      const saved = await tx.errorReport.create({
        data: {
          factoryId: user.selectedFactoryId || null,
          authorId: user.userId || null,
          authorRole: this.userRole(user.role),
          section,
          title,
          description,
        },
        include: { author: true, factory: true, closedBy: true },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'ERROR_REPORT_CREATED',
        entityType: 'ErrorReport',
        entityId: saved.id,
        details: { section, title },
      });
      if (body.operationId) {
        await tx.processedOperation.create({ data: { userId: user.userId, operationId: body.operationId, resultKey: saved.id } });
      }
      return { report: saved, created: true };
    });

    if (created) await this.writeFileExport(report.id);

    return {
      ok: true,
      id: report.id,
      message: 'Ошибка отправлена администратору.',
      report: this.serializeReport(report),
    };
  }

  private async assertActiveReporter(user: UserContext) {
    if (!user.userId || user.userId === 'anonymous' || !user.selectedFactoryId) {
      throw new ForbiddenException({ code: 'AUTH_REQUIRED', message: 'Войдите в приложение и выберите завод.' });
    }
    const reporter = await this.prisma.db.user.findFirst({
      where: {
        id: user.userId,
        blockedAt: null,
        deletedAt: null,
        factoryAccess: {
          some: {
            factoryId: user.selectedFactoryId,
            isActive: true,
            deactivatedAt: null,
          },
        },
      },
      select: { id: true },
    });
    if (!reporter) {
      throw new ForbiddenException({ code: 'FACTORY_ACCESS_DENIED', message: 'Нет доступа к выбранному заводу.' });
    }
  }

  async list(user: UserContext, query: any = {}) {
    this.assertAdmin(user);
    const status = STATUSES.has(String(query.status ?? '')) ? String(query.status) : undefined;
    const reports = await this.prisma.db.errorReport.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        ...(status ? { status } : {}),
      },
      include: { author: true, factory: true, closedBy: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const visibleReports = query.includeDiagnostics === 'true'
      ? reports
      : reports.filter((report) => !this.isRuntimeReportNoise(report));
    return this.withAttachments(visibleReports);
  }

  async detail(user: UserContext, id: string) {
    const report = await this.loadReport(user, id);
    const [serialized] = await this.withAttachments([report]);
    return serialized;
  }

  async updateStatus(user: UserContext, id: string, body: any) {
    this.assertAdmin(user);
    const status = String(body.status ?? '').trim();
    if (!STATUSES.has(status)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Выберите корректный статус.' });
    const report = await this.loadReport(user, id);
    const updated = await this.prisma.db.errorReport.update({
      where: { id },
      data: {
        status,
        ...(status === 'CLOSED' ? { closedAt: new Date(), closedById: user.userId } : { closedAt: null, closedById: null }),
      },
      include: { author: true, factory: true, closedBy: true },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'ERROR_REPORT_STATUS_UPDATED',
      entityType: 'ErrorReport',
      entityId: id,
      details: { oldStatus: report.status, newStatus: status },
    });
    const [serialized] = await this.withAttachments([updated]);
    return serialized;
  }

  private async loadReport(user: UserContext, id: string) {
    const report = await this.prisma.db.errorReport.findFirst({
      where: { id },
      include: { author: true, factory: true, closedBy: true },
    });
    if (!report) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Сообщение об ошибке не найдено.' });
    const isOwner = report.authorId === user.userId;
    const isSameFactory = !report.factoryId || report.factoryId === user.selectedFactoryId;
    if (!isSameFactory || (!user.isAdmin && !isOwner)) {
      await this.writeDenied(user, report.factoryId, id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к этому сообщению.' });
    }
    return report;
  }

  private async findProcessedCreate(tx: any, user: UserContext, operationId?: string) {
    if (!operationId) return null;
    const processed = await tx.processedOperation.findUnique({
      where: { userId_operationId: { userId: user.userId, operationId } },
    });
    if (!processed) return null;
    if (!processed.resultKey) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Результат действия больше недоступен. Обновите список.' });
    const existing = await tx.errorReport.findFirst({
      where: { id: processed.resultKey, factoryId: user.selectedFactoryId, authorId: user.userId },
      include: { author: true, factory: true, closedBy: true },
    });
    if (!existing) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Результат действия больше недоступен. Обновите список.' });
    return existing;
  }

  private async withAttachments(reports: any[]) {
    const attachments = await this.attachmentsService.listForEntities(AttachmentEntityType.ERROR_REPORT, reports.map((report) => report.id));
    return reports.map((report) => ({
      ...this.serializeReport(report),
      attachments: attachments.get(report.id) ?? [],
    }));
  }

  private serializeReport(report: any) {
    return {
      id: report.id,
      factoryId: report.factoryId,
      factoryName: report.factory?.name ?? null,
      authorId: report.authorId,
      authorName: report.author ? pilotDisplayName(report.author) : 'Пользователь',
      authorRole: report.authorRole,
      authorRoleLabel: roleLabel(report.authorRole),
      section: report.section,
      title: report.title,
      description: report.description,
      status: report.status,
      statusLabel: STATUS_LABELS[report.status] ?? 'Не указан',
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      closedAt: report.closedAt,
      closedByName: report.closedBy ? pilotDisplayName(report.closedBy) : null,
    };
  }

  private isRuntimeReportNoise(report: any) {
    return hasPilotFixtureMarker(report.id, report.section, report.title, report.description);
  }

  private async writeFileExport(reportId: string) {
    try {
      await this.fileExportService.exportReport(reportId);
    } catch (error) {
      console.warn('Файловая копия сообщения об ошибке не создана. Запись в приложении сохранена.', error instanceof Error ? error.message : String(error));
    }
  }

  private assertAdmin(user: UserContext) {
    if (user.isAdmin) return;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Список сообщений об ошибках доступен только администратору.' });
  }

  private userRole(role: string): UserRole | null {
    return Object.values(UserRole).includes(role as UserRole) ? (role as UserRole) : null;
  }

  private async writeDenied(user: UserContext, factoryId: string | null, entityId: string) {
    try {
      await this.auditService.write({
        userId: user.userId,
        factoryId: factoryId ?? user.selectedFactoryId,
        action: 'ACCESS_DENIED',
        entityType: 'ErrorReport',
        entityId,
        details: { reason: 'Нет доступа к сообщению об ошибке', role: user.role },
      });
    } catch {
      // Denial result must not depend on audit write availability.
    }
  }
}
