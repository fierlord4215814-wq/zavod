import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit.module';
import { UserContextService } from '../../common/user-context.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, UserContextService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
