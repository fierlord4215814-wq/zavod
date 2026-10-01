import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
