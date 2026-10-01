import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { WorkAreasService } from './work-areas.service';

class AssignWorkAreaDto {
  targetUserId?: string;
  workAreaPositionId?: string | null;
  slotIndex?: number | null;
  sourceAssignmentId?: string | null;
  operationId?: string | null;
}
class PlannedCountDto { plannedCount!: number; }

@Controller('work-areas')
export class WorkAreasController {
  constructor(private readonly workAreasService: WorkAreasService) {}

  @Get()
  @RequirePermission(['assignments.manage', 'shift.current.read', 'shift.self.read', 'people.read'])
  async list(@CurrentUser() user: UserContext) {
    return this.workAreasService.list(user);
  }

  @Get(':id/board')
  @RequirePermission(['assignments.manage', 'shift.current.read', 'shift.self.read', 'people.read'])
  async board(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.workAreasService.board(user, id);
  }

  @Post(':id/assign')
  @RequirePermission('assignments.manage')
  async assign(@Param('id') id: string, @Body() body: AssignWorkAreaDto, @CurrentUser() user: UserContext) {
    return this.workAreasService.assign(user, id, body);
  }

  @Patch(':id/positions/:positionId/planned-count')
  @RequirePermission('assignments.manage')
  async updatePlannedCount(@Param('id') id: string, @Param('positionId') positionId: string, @Body() body: PlannedCountDto, @CurrentUser() user: UserContext) {
    return this.workAreasService.updatePlannedCount(user, id, positionId, Number(body.plannedCount));
  }

  @Post(':id/positions/:positionId/planned-count/preview')
  @RequirePermission('assignments.manage')
  async previewPlannedCount(@Param('id') id: string, @Param('positionId') positionId: string, @Body() body: PlannedCountDto, @CurrentUser() user: UserContext) {
    return this.workAreasService.previewPlannedCount(user, id, positionId, Number(body.plannedCount));
  }
}
