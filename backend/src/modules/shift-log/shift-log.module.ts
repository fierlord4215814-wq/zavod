import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShiftLogController } from './shift-log.controller';
import { ShiftLogService } from './shift-log.service';
import { AuditModule } from '../../common/audit.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuditModule, AttachmentsModule, NotificationsModule],
  controllers: [ShiftLogController],
  providers: [ShiftLogService],
})
export class ShiftLogModule {}
