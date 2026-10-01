import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WashController } from './wash.controller';
import { WashService } from './wash.service';
import { AuditModule } from '../../common/audit.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  controllers: [WashController],
  imports: [PrismaModule, AuditModule, AttachmentsModule, NotificationsModule],
  providers: [WashService],
})
export class WashModule {}
