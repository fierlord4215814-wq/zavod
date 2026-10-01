import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OkkController } from './okk.controller';
import { OkkService } from './okk.service';
import { AuditModule } from '../../common/audit.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { QuantityReleaseService } from '../../common/quantity-release.service';

@Module({
  controllers: [OkkController],
  imports: [PrismaModule, AuditModule, AttachmentsModule],
  providers: [OkkService, QuantityReleaseService],
})
export class OkkModule {}
