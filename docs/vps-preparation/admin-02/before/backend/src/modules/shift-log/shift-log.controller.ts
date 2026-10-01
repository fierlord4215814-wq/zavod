import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { ShiftLogService } from './shift-log.service';

@Controller('shift-log')
export class ShiftLogController {
  constructor(private readonly shiftLogService: ShiftLogService) {}

  @Get('handover/availability')
  @RequirePermission(['shift.current.manage', 'shift-log.manage'])
  async handoverAvailability(@CurrentUser() user: UserContext, @Query('departmentId') departmentId?: string) {
    return this.shiftLogService.handoverAvailability(user, { departmentId });
  }

  @Get('handover/summary')
  @RequirePermission(['shift.current.manage', 'shift-log.manage'])
  async handoverSummary(@CurrentUser() user: UserContext, @Query('departmentId') departmentId?: string) {
    return this.shiftLogService.handoverSummary(user, { departmentId });
  }

  @Post('handover')
  @RequirePermission(['shift.current.manage', 'shift-log.manage'])
  async createHandover(@Body() body: { departmentId?: string | null; comment?: string | null }, @CurrentUser() user: UserContext) {
    return this.shiftLogService.createHandover(user, body);
  }

  @Get('handover/previous')
  @RequirePermission('shift-log.read')
  async previousHandover(@CurrentUser() user: UserContext, @Query('departmentId') departmentId?: string) {
    return this.shiftLogService.previousHandover(user, { departmentId });
  }

  @Post()
  @RequirePermission(['shift-log.create', 'shift-log.manage'])
  async createLog(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.shiftLogService.createLog(user, body);
  }

  @Get('archive')
  @RequirePermission(['shift-log.archive.read', 'shift-log.manage'])
  async archive(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.shiftLogService.archive(user, query);
  }

  @Get(':id')
  @RequirePermission('shift-log.read')
  async getLog(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.shiftLogService.getLog(user, id);
  }

  @Get('archive/:id')
  @RequirePermission(['shift-log.archive.read', 'shift-log.manage'])
  async getArchiveLog(@CurrentUser() user: UserContext, @Param('id') id: string, @Query() query: any) {
    return this.shiftLogService.getArchiveLog(user, id, query);
  }

  @Patch(':id')
  @RequirePermission(['shift-log.create', 'shift-log.manage'])
  async updateLog(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.shiftLogService.updateLog(user, id, body);
  }

  @Post(':id/archive')
  @RequirePermission('shift-log.manage')
  async archiveLog(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.shiftLogService.archiveLog(id, user);
  }

  @Delete(':id')
  @RequirePermission('shift-log.manage')
  async deleteLog(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.shiftLogService.deleteLog(id, user);
  }

  @Post(':id/comment')
  @RequirePermission(['shift-log.comment', 'shift-log.manage'])
  async addComment(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.shiftLogService.addComment(user, id, body);
  }

  @Post(':id/read')
  @RequirePermission('shift-log.read')
  async markRead(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.shiftLogService.markRead(user, id);
  }

  @Get(':id/reads')
  @RequirePermission('shift-log.read')
  async reads(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.shiftLogService.reads(user, id);
  }

  @Post(':id/close-important')
  @RequirePermission(['shift-log.important.manage', 'shift-log.manage'])
  async closeImportant(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.shiftLogService.closeImportant(user, id, body);
  }

  @Get()
  @RequirePermission('shift-log.read')
  async listLogs(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.shiftLogService.listLogs(user, query);
  }
}
