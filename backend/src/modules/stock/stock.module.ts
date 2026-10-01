import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuditModule } from '../../common/audit.module';

@Module({
  imports: [PrismaModule, AttachmentsModule, AuditModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
