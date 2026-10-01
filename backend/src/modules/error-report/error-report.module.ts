import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ErrorReportFileExportService } from './error-report-file-export.service';
import { ErrorReportController } from './error-report.controller';
import { ErrorReportService } from './error-report.service';

@Module({
  imports: [PrismaModule, AuditModule, AttachmentsModule],
  controllers: [ErrorReportController],
  providers: [ErrorReportService, ErrorReportFileExportService],
  exports: [ErrorReportFileExportService],
})
export class ErrorReportModule {}
