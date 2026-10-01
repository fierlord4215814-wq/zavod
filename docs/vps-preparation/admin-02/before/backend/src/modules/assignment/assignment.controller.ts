import { Body, Controller, Post } from '@nestjs/common';
import { ShiftType } from '@prisma/client';
import { ConflictError } from '../../common/errors/conflict.exception';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { EmployeeService } from '../employee/employee.service';

class AssignDto {
  userId!: string;
  lineId!: string;
}

class UnassignDto {
  userId!: string;
}

class AssignLineDto {
  targetUserId!: string;
  lineId!: string;
  positionId?: string | null;
  slotIndex?: number | null;
  staffingTemplateId?: string | null;
  sourceAssignmentId?: string | null;
  replaceAssignmentId?: string | null;
  operationId?: string | null;
  manualAdd?: boolean;
  expectedShiftDate?: string | null;
  expectedShiftType?: ShiftType | null;
  comment?: string | null;
}

class AssignWashDto {
  targetUserId!: string;
  lineId?: string;
  washSessionId?: string;
  sourceAssignmentId?: string | null;
  operationId?: string | null;
}

class AssignTimeDto {
  targetUserId!: string;
}

class ReleaseDto {
  targetUserId!: string;
}

@Controller()
export class AssignmentController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post('assign')
  @RequirePermission('assignments.manage')
  async assign(@Body() body: AssignDto, @CurrentUser() user: UserContext) {
    return this.employeeService.assignToLine(body.userId, body.lineId, user);
  }

  @Post('unassign')
  @RequirePermission('assignments.manage')
  async unassign(@Body() body: UnassignDto, @CurrentUser() user: UserContext) {
    return this.employeeService.unassign(body.userId, user);
  }

  @Post('assignments/line')
  @RequirePermission('assignments.manage')
  async assignLine(@Body() body: AssignLineDto, @CurrentUser() user: UserContext) {
    return this.employeeService.assignToLine(body.targetUserId, body.lineId, user, {
      positionId: body.positionId,
      slotIndex: body.slotIndex,
      staffingTemplateId: body.staffingTemplateId,
      sourceAssignmentId: body.sourceAssignmentId,
      replaceAssignmentId: body.replaceAssignmentId,
      operationId: body.operationId,
      manualAdd: body.manualAdd,
      expectedShiftDate: body.expectedShiftDate,
      expectedShiftType: body.expectedShiftType,
      comment: body.comment,
    });
  }

  @Post('assignments/wash')
  @RequirePermission('wash.manage')
  async assignWash(@Body() body: AssignWashDto, @CurrentUser() user: UserContext) {
    return this.employeeService.assignToWash(body.targetUserId, user, {
      lineId: body.lineId,
      washSessionId: body.washSessionId,
      sourceAssignmentId: body.sourceAssignmentId,
      operationId: body.operationId,
    });
  }

  @Post('assignments/time')
  @RequirePermission('assignments.manage')
  async assignTime(@Body() _body: AssignTimeDto) {
    throw new ConflictError('Назначение повременщиков выполняется через настроенные рабочие зоны');
  }

  @Post('assignments/release')
  @RequirePermission('assignments.manage')
  async release(@Body() body: ReleaseDto, @CurrentUser() user: UserContext) {
    return this.employeeService.release(body.targetUserId, user);
  }
}
