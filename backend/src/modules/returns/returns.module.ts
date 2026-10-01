import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuditModule } from '../../common/audit.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { QuantityReleaseService } from '../../common/quantity-release.service';

@Module({
  imports: [PrismaModule, AttachmentsModule, AuditModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, QuantityReleaseService],
})
export class ReturnsModule {}
