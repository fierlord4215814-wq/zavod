import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { WsModule } from '../../ws/ws.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { FileStorageService } from './file-storage.service';
import { ErrorReportFileExportService } from '../error-report/error-report-file-export.service';

@Module({
  imports: [PrismaModule, AuditModule, WsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, FileStorageService, ErrorReportFileExportService],
  exports: [AttachmentsService, FileStorageService],
})
export class AttachmentsModule {}
