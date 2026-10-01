import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { WashService } from './wash.service';

class StartWashDto {
  lineId?: string;
  targetType?: 'LINE' | 'OTHER';
  objectName?: string;
  objectDescription?: string;
  operationId!: string;
}
class SessionActionDto { message!: string; operationId!: string; }
class IssueDto { title?: string; description?: string; message?: string; assignedToId?: string | null; operationId?: string; }
class IssueStatusDto { status?: string; comment?: string; operationId?: string; }
class ControlItemDto { title?: string; description?: string; assignedToId?: string | null; requiresPhoto?: boolean; type?: 'CONTROL' | 'MINI_TASK'; }
class ControlStatusDto { status?: string; comment?: string; }
class OkkReviewDto { status?: string; rating?: number; comment?: string; }
class WashRequestDto {
  lineId?: string;
  targetType?: 'LINE' | 'OTHER';
  objectName?: string;
  objectDescription?: string;
  description?: string;
  priority?: string;
  dueAt?: string;
  comment?: string;
  operationId!: string;
}
class WashRequestActionDto { operationId!: string; version?: number; }

@Controller('wash')
export class WashController {
  constructor(private readonly washService: WashService) {}

  @Get('requests')
  async listRequests(
    @CurrentUser() user: UserContext,
    @Query('includeCompleted') includeCompleted?: string,
  ) {
    return this.washService.listRequests(user, { includeCompleted });
  }

  @Post('requests')
  @RequirePermission('wash.control.create')
  async createRequest(@Body() body: WashRequestDto, @CurrentUser() user: UserContext) {
    return this.washService.createRequest(user, body);
  }

  @Post('requests/:id/take')
  @RequirePermission('wash.manage')
  async takeRequest(@Param('id') id: string, @Body() body: WashRequestActionDto, @CurrentUser() user: UserContext) {
    return this.washService.takeRequest(user, id, body);
  }

  @Post('requests/:id/start')
  @RequirePermission('wash.manage')
  async startRequest(@Param('id') id: string, @Body() body: WashRequestActionDto, @CurrentUser() user: UserContext) {
    return this.washService.startRequest(user, id, body);
  }

  @Get()
  async listActive(
    @CurrentUser() user: UserContext,
    @Query('activeOnly') activeOnly?: string,
    @Query('includeCompleted') includeCompleted?: string,
    @Query('includeDiagnostics') includeDiagnostics?: string,
    @Query('lineId') lineId?: string,
    @Query('status') status?: string,
  ) {
    return this.washService.list(user, { activeOnly, includeCompleted, includeDiagnostics, lineId, status });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.washService.detail(user, id);
  }

  @Post('start')
  @RequirePermission('wash.manage')
  async startWash(@Body() body: StartWashDto, @CurrentUser() user: UserContext) {
    return this.washService.startWash(
      body,
      user.userId,
      body.operationId ?? `wash-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user.selectedFactoryId,
    );
  }

  @Post(':id/message')
  @RequirePermission('wash.message.create')
  async addMessage(@Param('id') id: string, @Body() body: SessionActionDto, @CurrentUser() user: UserContext) {
    return this.washService.addMessage(id, user.userId, body.message, body.operationId, user.selectedFactoryId);
  }

  @Post(':id/issue')
  @RequirePermission('wash.issue.create')
  async addIssueLegacy(@Param('id') id: string, @Body() body: IssueDto, @CurrentUser() user: UserContext) {
    return this.washService.addIssue(id, user.userId, body, user.selectedFactoryId);
  }

  @Post(':id/issues')
  @RequirePermission('wash.issue.create')
  async addIssue(@Param('id') id: string, @Body() body: IssueDto, @CurrentUser() user: UserContext) {
    return this.washService.addIssue(id, user.userId, body, user.selectedFactoryId);
  }

  @Post('issue/:id/resolve')
  @RequirePermission('wash.issue.resolve')
  async resolveIssue(@Param('id') id: string, @Body() body: IssueStatusDto, @CurrentUser() user: UserContext) {
    return this.washService.setIssueStatus(id, user.userId, 'RESOLVED', body.comment || body.operationId, user.selectedFactoryId);
  }

  @Patch('issues/:id/status')
  @RequirePermission('wash.issue.resolve')
  async updateIssueStatus(@Param('id') id: string, @Body() body: IssueStatusDto, @CurrentUser() user: UserContext) {
    return this.washService.setIssueStatus(id, user.userId, body.status || 'RESOLVED', body.comment, user.selectedFactoryId);
  }

  @Post(':id/control-items')
  @RequirePermission('wash.control.create')
  async createControlItem(@Param('id') id: string, @Body() body: ControlItemDto, @CurrentUser() user: UserContext) {
    return this.washService.createControlItem(id, user.userId, body, user.selectedFactoryId);
  }

  @Patch('control-items/:id')
  @RequirePermission('wash.control.manage')
  async updateControlItem(@Param('id') id: string, @Body() body: ControlStatusDto, @CurrentUser() user: UserContext) {
    return this.washService.updateControlItem(id, user.userId, body, user.selectedFactoryId);
  }

  @Post(':id/okk-review')
  @RequirePermission('wash.okk-review.manage')
  async createOkkReview(@Param('id') id: string, @Body() body: OkkReviewDto, @CurrentUser() user: UserContext) {
    return this.washService.createOkkReview(id, user.userId, body, user.selectedFactoryId);
  }

  @Post(':id/complete')
  @RequirePermission('wash.manage')
  async completeWash(@Param('id') id: string, @Body() body: { operationId: string }, @CurrentUser() user: UserContext) {
    return this.washService.completeWash(id, user.userId, user.selectedFactoryId, body.operationId);
  }
}
