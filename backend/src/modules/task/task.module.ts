import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { AuditModule } from '../../common/audit.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DirectoryModule } from '../directory/directory.module';

@Module({
  controllers: [TaskController],
  imports: [PrismaModule, AuditModule, AttachmentsModule, NotificationsModule, DirectoryModule],
  providers: [TaskService],
})
export class TaskModule {}
