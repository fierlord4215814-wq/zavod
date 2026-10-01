import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { LineStatus, ShiftType } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { LineService } from './line.service';

class UpdateLineStatusDto {
  status!: LineStatus;
  comment?: string;
  downtimeReason?: string | null;
  expectedVersion?: number | null;
  effectiveAt?: string | null;
  occurredAt?: string | null;
  eventTime?: string | null;
}

class PositionDto {
  name!: string;
  sortOrder?: number;
  isActive?: boolean;
  deletedAt?: string | null;
}

class StaffingTemplateDto {
  name!: string;
  isActive?: boolean;
  items!: Array<{
    positionId: string;
    requiredCount?: number;
    minRequired?: number;
    maxRequired?: number;
    defaultPlanned?: number;
    plannedCount?: number;
    isFlexible?: boolean;
    isExtraSlot?: boolean;
    doesNotAffectShortage?: boolean;
    sortOrder?: number;
  }>;
}

class ActivateTemplateDto {
  staffingTemplateId?: string | null;
  expectedVersion?: number | null;
  operationId?: string | null;
  confirmRemap?: boolean;
}

class PlannedCountDto {
  plannedCount!: number;
}

class ShiftAssignmentQueryDto {
  shiftSessionId?: string;
  shiftDate?: string;
  shiftType?: ShiftType;
}

class ShiftAssignmentRowDto {
  id?: string;
  article?: string;
  productName?: string;
  plannedGofrCount?: number;
  sortOrder?: number;
}

class ShiftAssignmentDto extends ShiftAssignmentQueryDto {
  rows?: ShiftAssignmentRowDto[];
}

class PlanningBoardQueryDto {
  shiftDate?: string;
  shiftType?: ShiftType;
  staffingTemplateId?: string;
}

class PlanningTemplateChangeDto extends PlanningBoardQueryDto {
  expectedPlanUpdatedAt?: string | null;
  operationId?: string | null;
  confirmRemap?: boolean;
}

class LineTimelineQueryDto {
  shiftDate?: string;
  shiftType?: ShiftType;
}

class PlannedSlotDto extends PlanningBoardQueryDto {
  targetUserId?: string;
  positionId?: string;
  slotIndex?: number;
  sourceAssignmentId?: string | null;
  replaceAssignmentId?: string | null;
  operationId?: string | null;
  manualAssignment?: boolean;
  comment?: string | null;
}

@Controller('lines')
export class LineController {
  constructor(private readonly lineService: LineService) {}

  @Get()
  @RequirePermission('lines.read')
  async list(@CurrentUser() user: UserContext) {
    return this.lineService.list(user);
  }

  @Get('shift-overview')
  @RequirePermission(['lines.read', 'shift.current.read', 'shift.self.read'])
  async shiftOverview(@CurrentUser() user: UserContext) {
    return this.lineService.shiftOverview(user);
  }

  @Get('downtime-reasons')
  @RequirePermission('lines.read')
  async downtimeReasons() {
    return this.lineService.downtimeReasons();
  }

  @Get(':id/current-shift-detail')
  @RequirePermission(['lines.read', 'shift.current.read', 'shift.self.read'])
  async currentShiftDetail(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.lineService.currentShiftDetail(user, id);
  }

  @Get(':id/dashboard')
  @RequirePermission('lines.read')
  async dashboard(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.lineService.dashboard(user, id);
  }

  @Get(':id/timeline')
  @RequirePermission('lines.read')
  async timeline(@Param('id') id: string, @Query() query: LineTimelineQueryDto, @CurrentUser() user: UserContext) {
    return this.lineService.timeline(user, id, query);
  }

  @Get(':id/assignment-board')
  @RequirePermission(['lines.read', 'assignments.manage'])
  async assignmentBoard(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.lineService.assignmentBoard(user, id);
  }

  @Get(':id/planning-board')
  @RequirePermission(['lines.read', 'shift.future.read', 'shift.future.manage'])
  async planningBoard(@Param('id') id: string, @Query() query: PlanningBoardQueryDto, @CurrentUser() user: UserContext) {
    return this.lineService.planningBoard(user, id, query);
  }

  @Post(':id/planning-board/template/preview')
  @RequirePermission(['shift.future.manage', 'assignments.manage'])
  async previewPlanningTemplate(
    @Param('id') id: string,
    @Body() body: PlanningTemplateChangeDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.previewPlanningTemplate(user, id, body);
  }

  @Post(':id/planning-board/template/apply')
  @RequirePermission(['shift.future.manage', 'assignments.manage'])
  async applyPlanningTemplate(
    @Param('id') id: string,
    @Body() body: PlanningTemplateChangeDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.applyPlanningTemplate(user, id, body);
  }

  @Post(':id/planning-board/assign')
  @RequirePermission(['shift.future.manage', 'assignments.manage'])
  async assignPlannedSlot(@Param('id') id: string, @Body() body: PlannedSlotDto, @CurrentUser() user: UserContext) {
    return this.lineService.assignPlannedSlot(user, id, body);
  }

  @Post(':id/planning-board/release/:assignmentId')
  @RequirePermission(['shift.future.manage', 'assignments.manage'])
  async releasePlannedSlot(@Param('id') id: string, @Param('assignmentId') assignmentId: string, @CurrentUser() user: UserContext) {
    return this.lineService.releasePlannedAssignment(user, id, assignmentId);
  }

  @Get(':id/shift-assignment')
  @RequirePermission('lines.read')
  async getShiftAssignment(
    @Param('id') id: string,
    @Query() query: ShiftAssignmentQueryDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.getShiftAssignment(user, id, query);
  }

  @Put(':id/shift-assignment')
  @RequirePermission(['lines.assignment.manage', 'lines.manage', 'shift.manage', 'assignments.manage'])
  async replaceShiftAssignment(
    @Param('id') id: string,
    @Body() body: ShiftAssignmentDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.replaceShiftAssignment(user, id, body);
  }

  @Patch(':id/shift-assignment/rows')
  @RequirePermission(['lines.assignment.manage', 'lines.manage', 'shift.manage', 'assignments.manage'])
  async upsertShiftAssignmentRow(
    @Param('id') id: string,
    @Body() body: ShiftAssignmentDto & ShiftAssignmentRowDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.upsertShiftAssignmentRow(user, id, body);
  }

  @Delete(':id/shift-assignment/rows/:rowId')
  @RequirePermission(['lines.assignment.manage', 'lines.manage', 'shift.manage', 'assignments.manage'])
  async deleteShiftAssignmentRow(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body() body: ShiftAssignmentQueryDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.deleteShiftAssignmentRow(user, id, rowId, body ?? {});
  }

  @Get(':id/workers')
  @RequirePermission('lines.read')
  async getWorkers(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.lineService.getActiveWorkers(user, id);
  }

  @Post(':id/positions')
  @RequirePermission('lines.manage')
  async createPosition(@Param('id') id: string, @Body() body: PositionDto, @CurrentUser() user: UserContext) {
    return this.lineService.createPosition(user, id, body);
  }

  @Patch(':id/positions/:positionId')
  @RequirePermission('lines.manage')
  async updatePosition(
    @Param('id') id: string,
    @Param('positionId') positionId: string,
    @Body() body: PositionDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.updatePosition(user, id, positionId, body);
  }

  @Post(':id/staffing-templates')
  @RequirePermission('lines.manage')
  async createStaffingTemplate(
    @Param('id') id: string,
    @Body() body: StaffingTemplateDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.createStaffingTemplate(user, id, body);
  }

  @Patch(':id/staffing-templates/:templateId')
  @RequirePermission('lines.manage')
  async updateStaffingTemplate(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Body() body: StaffingTemplateDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.updateStaffingTemplate(user, id, templateId, body);
  }

  @Post(':id/activate-template')
  @RequirePermission(['lines.manage', 'assignments.manage'])
  async activateTemplate(
    @Param('id') id: string,
    @Body() body: ActivateTemplateDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.activateTemplate(user, id, body);
  }

  @Post(':id/activate-template/preview')
  @RequirePermission(['lines.manage', 'assignments.manage'])
  async previewTemplateActivation(
    @Param('id') id: string,
    @Body() body: ActivateTemplateDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.previewTemplateActivation(user, id, body);
  }

  @Patch(':id/staffing-templates/:templateId/items/:itemId/planned-count')
  @RequirePermission(['lines.manage', 'assignments.manage'])
  async updateTemplateItemPlannedCount(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Param('itemId') itemId: string,
    @Body() body: PlannedCountDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.updateTemplateItemPlannedCount(user, id, templateId, itemId, Number(body.plannedCount));
  }

  @Post(':id/staffing-templates/:templateId/items/:itemId/planned-count/preview')
  @RequirePermission(['lines.manage', 'assignments.manage'])
  async previewTemplateItemPlannedCount(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Param('itemId') itemId: string,
    @Body() body: PlannedCountDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.previewTemplateItemPlannedCount(user, id, templateId, itemId, Number(body.plannedCount));
  }

  @Post(':id/activate-for-shift')
  @RequirePermission(['lines.manage', 'assignments.manage'])
  async activateForShift(
    @Param('id') id: string,
    @Body() body: ActivateTemplateDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.activateForShift(user, id, body);
  }

  @Patch(':id/status')
  @RequirePermission('lines.manage')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateLineStatusDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.lineService.updateStatus(id, body.status, body.comment, user, body.downtimeReason ?? null, {
      effectiveAt: body.effectiveAt ?? body.occurredAt ?? body.eventTime ?? null,
      expectedVersion: body.expectedVersion ?? null,
    });
  }
}
