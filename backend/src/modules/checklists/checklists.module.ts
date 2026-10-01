import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChecklistsController } from './checklists.controller';
import { ChecklistsService } from './checklists.service';

@Module({
  imports: [PrismaModule, AttachmentsModule, NotificationsModule],
  controllers: [ChecklistsController],
  providers: [ChecklistsService],
})
export class ChecklistsModule {}
