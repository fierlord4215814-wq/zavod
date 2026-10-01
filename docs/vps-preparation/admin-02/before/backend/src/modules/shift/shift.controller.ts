import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ShiftType, UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { EmployeeService } from '../employee/employee.service';
import { ShiftService } from './shift.service';

class SendHomeDto {
  targetUserId!: string;
  comment!: string;
}

class LineResultDto {
  lineId!: string;
  shiftSessionId!: string;
  planCompletionPercent?: number | null;
  comment?: string | null;
}

class WillBeDto {
  targetShiftDate?: string;
  shiftType?: ShiftType;
  comment?: string | null;
}

class WillBeCancelDto {
  willBeId?: string;
  comment?: string | null;
}

class ReturnRequestDto {
  reason?: string | null;
}

class ReturnDecisionDto {
  status!: 'APPROVED' | 'REJECTED';
  decisionComment?: string | null;
}

class ContractorSubmissionDto {
  targetShiftDate?: string;
  shiftType?: ShiftType;
  contractorUserIds?: string[];
  comment?: string | null;
  operationId?: string | null;
}

class ContractorActualStatusDto {
  actualStatus!: 'ARRIVED' | 'ABSENT';
  expectedVersion?: number;
  operationId?: string | null;
}

class ContractorCurrentArrivalDto {
  contractorUserId!: string;
  operationId?: string | null;
}

class ContractorSubmissionItemDecisionDto {
  status!: 'APPROVED' | 'REJECTED';
  masterComment?: string | null;
}

class FutureShiftAssignmentDto {
  targetUserId?: string;
  shiftDate?: string;
  shiftType?: ShiftType;
  kind?: 'WASH' | 'TIME' | 'WORK_AREA';
  workAreaId?: string | null;
  workAreaPositionId?: string | null;
  slotIndex?: number | null;
  timeRoleName?: string | null;
  comment?: string | null;
  operationId?: string | null;
  sourceAssignmentId?: string | null;
  replaceAssignmentId?: string | null;
}

class FutureShiftAssignmentReleaseDto {
  operationId?: string | null;
}

@Controller('shift')
export class ShiftController {
  constructor(
    private readonly shiftService: ShiftService,
    private readonly employeeService: EmployeeService,
  ) {}

  @Post('start')
  async start(@CurrentUser() user: UserContext) {
    return this.shiftService.start(user);
  }

  @Post('end')
  async end(@CurrentUser() user: UserContext) {
    return this.shiftService.end(user);
  }

  @Get('current')
  async current(@CurrentUser() user: UserContext) {
    return this.shiftService.current(user);
  }

  @Get('timeline')
  @RequirePermission(['shift.self.read', 'shift.future.read', 'shift.future.manage'])
  async timeline(@CurrentUser() user: UserContext) {
    return this.shiftService.timeline(user);
  }

  @Get('future')
  @RequirePermission(['shift.self.read', 'shift.future.read', 'shift.future.manage'])
  async future(
    @CurrentUser() user: UserContext,
    @Query('targetShiftDate') targetShiftDate?: string,
    @Query('shiftType') shiftType?: ShiftType,
  ) {
    return this.shiftService.future(user, { targetShiftDate, shiftType });
  }

  @Get('future-assignment-board')
  @RequirePermission('shift.future.manage')
  async futureAssignmentBoard(
    @CurrentUser() user: UserContext,
    @Query('targetShiftDate') targetShiftDate?: string,
    @Query('shiftType') shiftType?: ShiftType,
  ) {
    return this.shiftService.futureAssignmentBoard(user, { targetShiftDate, shiftType });
  }

  @Post('future-assignments')
  @RequirePermission('shift.future.manage')
  async createFutureAssignment(@Body() body: FutureShiftAssignmentDto, @CurrentUser() user: UserContext) {
    return this.shiftService.createFutureShiftAssignment(user, body);
  }

  @Post('future-assignments/:id/release')
  @RequirePermission('shift.future.manage')
  async releaseFutureAssignment(@Param('id') id: string, @Body() body: FutureShiftAssignmentReleaseDto, @CurrentUser() user: UserContext) {
    return this.shiftService.releaseFutureShiftAssignment(user, id, body);
  }

  @Get('past')
  @RequirePermission(['shift.past.read', 'shift.self.read'])
  async past(
    @CurrentUser() user: UserContext,
    @Query('month') month?: string,
    @Query('userId') userId?: string,
    @Query('lineId') lineId?: string,
    @Query('role') role?: UserRole,
  ) {
    return this.shiftService.past(user, { month, userId, lineId, role });
  }

  @Get('past/:shiftKey')
  @RequirePermission(['shift.past.read', 'shift.self.read'])
  async pastDetail(@Param('shiftKey') shiftKey: string, @CurrentUser() user: UserContext) {
    return this.shiftService.pastDetail(user, shiftKey);
  }

  @Get('people')
  async people(@CurrentUser() user: UserContext, @Query('includeAll') includeAll?: string) {
    return this.shiftService.people(user, includeAll === 'true');
  }

  @Get('me')
  @RequirePermission('shift.self.read')
  async me(@CurrentUser() user: UserContext) {
    return this.shiftService.me(user);
  }

  @Post('will-be')
  @RequirePermission('shift.self.manage')
  async markWillBe(@Body() body: WillBeDto, @CurrentUser() user: UserContext) {
    return this.shiftService.markWillBe(user, body);
  }

  @Post('will-be/cancel')
  @RequirePermission('shift.self.manage')
  async cancelWillBe(@Body() body: WillBeCancelDto, @CurrentUser() user: UserContext) {
    return this.shiftService.cancelWillBe(user, body);
  }

  @Post('will-be/:id/remove')
  @RequirePermission('shift.future.manage')
  async removeWillBe(@Param('id') id: string, @Body() body: { comment?: string | null }, @CurrentUser() user: UserContext) {
    return this.shiftService.removeWillBe(user, id, body);
  }

  @Post('send-home')
  @RequirePermission('assignments.manage')
  async sendHome(@Body() body: SendHomeDto, @CurrentUser() user: UserContext) {
    return this.employeeService.sendHome(body.targetUserId, user, body.comment);
  }

  @Post('return-request')
  @RequirePermission('shift.self.manage')
  async createReturnRequest(@Body() body: ReturnRequestDto, @CurrentUser() user: UserContext) {
    return this.shiftService.createReturnRequest(user, body);
  }

  @Get('return-requests')
  @RequirePermission('shift.return.manage')
  async returnRequests(@CurrentUser() user: UserContext) {
    return this.shiftService.returnRequests(user);
  }

  @Patch('return-requests/:id')
  @RequirePermission('shift.return.manage')
  async decideReturnRequest(@Param('id') id: string, @Body() body: ReturnDecisionDto, @CurrentUser() user: UserContext) {
    return this.shiftService.decideReturnRequest(user, id, body);
  }

  @Get('contractor-lead/current')
  @RequirePermission('shift.contractor-lead.manage')
  async contractorLeadCurrent(@CurrentUser() user: UserContext) {
    return this.shiftService.contractorLeadCurrent(user);
  }

  @Get('contractor-lead/pool')
  @RequirePermission('shift.contractor-lead.manage')
  async contractorLeadPool(@CurrentUser() user: UserContext) {
    return this.shiftService.contractorLeadPool(user);
  }

  @Post('contractor-submissions')
  @RequirePermission('shift.contractor-lead.manage')
  async createContractorSubmission(@Body() body: ContractorSubmissionDto, @CurrentUser() user: UserContext) {
    return this.shiftService.createContractorSubmission(user, body);
  }

  @Patch('contractor-submissions/:submissionId/items/:itemId/actual')
  @RequirePermission('shift.contractor-lead.manage')
  async updateContractorActualStatus(
    @Param('submissionId') submissionId: string,
    @Param('itemId') itemId: string,
    @Body() body: ContractorActualStatusDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.shiftService.updateContractorActualStatus(user, submissionId, itemId, body);
  }

  @Post('contractor-lead/current-arrivals')
  @RequirePermission('shift.contractor-lead.manage')
  async addContractorCurrentArrival(@Body() body: ContractorCurrentArrivalDto, @CurrentUser() user: UserContext) {
    return this.shiftService.addContractorCurrentArrival(user, body);
  }

  @Patch('contractor-submissions/:submissionId/items/:itemId')
  @RequirePermission('shift.future.manage')
  async decideContractorSubmissionItem(
    @Param('submissionId') submissionId: string,
    @Param('itemId') itemId: string,
    @Body() body: ContractorSubmissionItemDecisionDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.shiftService.decideContractorSubmissionItem(user, submissionId, itemId, body);
  }

  @Post('line-results')
  @RequirePermission(['assignments.manage', 'lines.manage'])
  async createLineResult(@Body() body: LineResultDto, @CurrentUser() user: UserContext) {
    return this.shiftService.createLineResult(user, body);
  }
}
