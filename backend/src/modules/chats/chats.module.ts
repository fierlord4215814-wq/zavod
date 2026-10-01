import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({
  imports: [PrismaModule, AuditModule, AttachmentsModule],
  controllers: [ChatsController],
  providers: [ChatsService],
})
export class ChatsModule {}
