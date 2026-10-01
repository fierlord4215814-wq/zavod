import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmployeeService } from '../employee/employee.service';
import { LineModule } from '../line/line.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShiftController } from './shift.controller';
import { ShiftService } from './shift.service';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule, LineModule],
  controllers: [ShiftController],
  providers: [ShiftService, EmployeeService],
})
export class ShiftModule {}
