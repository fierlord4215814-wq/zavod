import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { DefrostService } from './defrost.service';
import { ChamberService } from './chamber.service';

@Controller('defrost')
export class DefrostController {
  constructor(private readonly defrostService: DefrostService, private readonly chamberService: ChamberService) {}

  @Get('chambers')
  chambers(@CurrentUser() user: UserContext, @Query('hidden') hidden?: string) {
    return this.chamberService.list(user, hidden === 'true');
  }

  @Get('chambers/:id/history')
  chamberHistory(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.chamberService.history(user, id);
  }

  @Post('chambers')
  @RequirePermission('admin.lines.manage')
  createChamber(@CurrentUser() user: UserContext, @Body() body: { name?: string; lineId?: string }) {
    return this.chamberService.create(user, body);
  }

  @Patch('chambers/:id')
  @RequirePermission('admin.lines.manage')
  renameChamber(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: { name?: string }) {
    return this.chamberService.change(user, id, 'rename', body.name);
  }

  @Post('chambers/:id/hide')
  @RequirePermission('admin.lines.manage')
  hideChamber(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.chamberService.change(user, id, 'hide');
  }

  @Post('chambers/:id/restore')
  @RequirePermission('admin.lines.manage')
  restoreChamber(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.chamberService.change(user, id, 'restore');
  }

  @Get()
  list(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.defrostService.list(user, query);
  }

  @Get('calendar')
  calendar(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.defrostService.calendar(user, query);
  }

  @Get('lines')
  lines(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.defrostService.lines(user, query);
  }

  @Get('lines/:lineId/summary')
  lineSummary(@CurrentUser() user: UserContext, @Param('lineId') lineId: string, @Query('days') days?: string) {
    return this.defrostService.lineSummary(user, lineId, days);
  }

  @Get('lines/:lineId/calendar')
  lineCalendar(@CurrentUser() user: UserContext, @Param('lineId') lineId: string, @Query() query: any) {
    return this.defrostService.lineCalendar(user, lineId, query);
  }

  @Post('lines/:lineId/start-today')
  @RequirePermission('defrost.manage')
  startToday(@CurrentUser() user: UserContext, @Param('lineId') lineId: string, @Body() body: { comment?: string; date?: string; operationId?: string }) {
    return this.defrostService.startToday(user, lineId, body);
  }

  @Post('lines/:lineId/complete-today')
  @RequirePermission('defrost.manage')
  completeToday(@CurrentUser() user: UserContext, @Param('lineId') lineId: string, @Body() body: { comment?: string; date?: string; operationId?: string }) {
    return this.defrostService.completeToday(user, lineId, body);
  }

  @Post('lines/:lineId/shock-chamber-blown')
  @RequirePermission('defrost.manage')
  markShockChamberBlown(@CurrentUser() user: UserContext, @Param('lineId') lineId: string, @Body() body: { comment?: string; date?: string; occurredAt?: string; operationId?: string }) {
    return this.defrostService.markShockChamberBlown(user, lineId, body);
  }

  @Get(':id')
  detail(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.defrostService.detail(user, id);
  }

  @Post('start')
  @RequirePermission('defrost.manage')
  start(@CurrentUser() user: UserContext, @Body() body: { lineId?: string; chamberId?: string; comment?: string; startAt?: string; operationId?: string }) {
    return this.defrostService.start(user, body);
  }

  @Post(':id/end')
  @RequirePermission('defrost.manage')
  end(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: { comment?: string; endAt?: string; operationId?: string }) {
    return this.defrostService.end(user, id, body);
  }
}
