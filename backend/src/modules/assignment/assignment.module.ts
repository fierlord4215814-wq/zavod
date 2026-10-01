import { Module } from '@nestjs/common';
import { AssignmentController } from './assignment.controller';
import { EmployeeService } from '../employee/employee.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../common/audit.module';

@Module({
  controllers: [AssignmentController],
  imports: [PrismaModule, AuditModule],
  providers: [EmployeeService],
})
export class AssignmentModule {}
