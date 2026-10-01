import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineController } from './line.controller';
import { LineService } from './line.service';
import { AuditModule } from '../../common/audit.module';
import { StaffingControlPolicyService } from './staffing-control-policy.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [LineController],
  providers: [LineService, StaffingControlPolicyService],
  exports: [LineService, StaffingControlPolicyService],
})
export class LineModule {}
