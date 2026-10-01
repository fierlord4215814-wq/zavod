import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmployeeService } from '../employee/employee.service';
import { WorkAreasController } from './work-areas.controller';
import { WorkAreasService } from './work-areas.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [WorkAreasController],
  providers: [WorkAreasService, EmployeeService],
})
export class WorkAreasModule {}
