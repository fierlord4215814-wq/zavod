import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TaskStatus, TaskType } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { TaskService } from './task.service';

class CreateTaskDto {
  lineId?: string | null;
  lineStatusEventId?: string | null;
  operationId!: string;
  description?: string;
  type?: TaskType;
  departmentRecipientIds?: string[];
  assigneeUserIds?: string[];
  deadlineAt?: string | null;
}

class TaskActionDto {
  operationId!: string;
  comment?: string | null;
}

class AddCommentDto {
  message!: string;
  operationId!: string;
}

class RedirectTaskDto {
  newDepartmentRecipientIds?: string[];
  newAssigneeUserIds?: string[];
  comment?: string | null;
  operationId?: string;
}

@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  @RequirePermission(['tasks.create', 'tasks.manage'])
  async createTask(@Body() body: CreateTaskDto, @CurrentUser() user: UserContext) {
    return this.taskService.createTask({
      lineId: body.lineId,
      lineStatusEventId: body.lineStatusEventId,
      actor: user,
      operationId: body.operationId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      description: body.description,
      type: body.type ?? TaskType.URGENT,
      departmentRecipientIds: body.departmentRecipientIds,
      assigneeUserIds: body.assigneeUserIds,
      deadlineAt: body.deadlineAt,
    });
  }

  @Post(':id/take')
  @RequirePermission(['tasks.take', 'tasks.manage'])
  async takeTask(@Param('id') id: string, @Body() body: TaskActionDto, @CurrentUser() user: UserContext) {
    return this.taskService.takeTask(id, user, body.operationId);
  }

  @Post(':id/complete')
  @RequirePermission(['tasks.done', 'tasks.manage'])
  async completeTask(@Param('id') id: string, @Body() body: TaskActionDto, @CurrentUser() user: UserContext) {
    return this.taskService.completeTask(id, user, body.operationId, body.comment ?? null);
  }

  @Post(':id/comment')
  @RequirePermission(['tasks.comment', 'tasks.manage'])
  async addComment(@Param('id') id: string, @Body() body: AddCommentDto, @CurrentUser() user: UserContext) {
    return this.taskService.addComment(id, user, body.message, body.operationId);
  }

  @Get('board')
  @RequirePermission('tasks.read')
  async board(@CurrentUser() user: UserContext, @Query('includeFixtures') includeFixtures?: string) {
    return this.taskService.board(user, { includeFixtures });
  }

  @Get('assignee-candidates')
  @RequirePermission('tasks.read')
  async assigneeCandidates(@CurrentUser() user: UserContext, @Query('query') query?: string, @Query('departmentId') departmentId?: string) {
    return this.taskService.assigneeCandidates(user, { query, departmentId });
  }

  @Get('archive/summary')
  @RequirePermission('tasks.read')
  async archiveSummary(
    @CurrentUser() user: UserContext,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('lineId') lineId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('type') type?: TaskType,
    @Query('status') status?: TaskStatus,
    @Query('shiftType') shiftType?: string,
    @Query('includeFixtures') includeFixtures?: string,
  ) {
    return this.taskService.archiveSummary(user, { dateFrom, dateTo, lineId, departmentId, assigneeId, type, status, shiftType, includeFixtures });
  }

  @Get('recipient-departments')
  @RequirePermission('tasks.read')
  async recipientDepartments(@CurrentUser() user: UserContext) {
    return this.taskService.recipientDepartments(user);
  }

  @Post(':id/redirect')
  @RequirePermission(['tasks.redirect', 'tasks.manage'])
  async redirectTask(@Param('id') id: string, @Body() body: RedirectTaskDto, @CurrentUser() user: UserContext) {
    return this.taskService.redirectTask(id, user, body);
  }

  @Get(':id')
  @RequirePermission('tasks.read')
  async detail(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.taskService.detail(id, user, true);
  }

  @Post(':id/read')
  @RequirePermission('tasks.read')
  async markRead(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.taskService.markRead(id, user);
  }

  @Get(':id/reads')
  @RequirePermission(['tasks.read-receipts.read', 'tasks.manage'])
  async reads(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.taskService.reads(id, user);
  }

  @Post('escalation/check')
  @RequirePermission(['tasks.escalation.manage', 'tasks.manage'])
  async checkEscalation(@CurrentUser() user: UserContext) {
    return this.taskService.checkOverdueLongTasks(user);
  }

  @Get()
  @RequirePermission('tasks.read')
  async listTasks(
    @CurrentUser() user: UserContext,
    @Query('status') status?: TaskStatus,
    @Query('type') type?: TaskType,
    @Query('my') my?: string,
    @Query('departmentId') departmentId?: string,
    @Query('assignedToMe') assignedToMe?: string,
    @Query('lineId') lineId?: string,
    @Query('includeDone') includeDone?: string,
    @Query('includeFixtures') includeFixtures?: string,
    @Query('overdue') overdue?: string,
    @Query('search') search?: string,
  ) {
    return this.taskService.listTasks(user, { status, type, my, departmentId, assignedToMe, lineId, includeDone, includeFixtures, overdue, search });
  }
}
