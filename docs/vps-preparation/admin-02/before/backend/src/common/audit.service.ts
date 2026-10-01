import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { factoryServerNow } from './shift-time';

type AuditPayload = {
  userId?: string | null;
  factoryId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(payload: AuditPayload): Promise<void> {
    try {
      await this.writeWithClient(this.prisma.db, payload);
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  async writeTx(tx: Prisma.TransactionClient, payload: AuditPayload): Promise<void> {
    await this.writeWithClient(tx, payload);
  }

  private async writeWithClient(client: Prisma.TransactionClient | PrismaService['db'], payload: AuditPayload) {
    const anonymous = payload.userId === 'anonymous';
    await client.auditLog.create({
      data: {
        userId: anonymous ? null : payload.userId ?? null,
        factoryId: anonymous ? null : payload.factoryId ?? null,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId ?? null,
        details: payload.details ?? {},
        createdAt: factoryServerNow(),
      },
    });
  }
}
