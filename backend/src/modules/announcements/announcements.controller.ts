import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { AnnouncementsService } from './announcements.service';

@Controller()
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get('announcements')
  list(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.announcementsService.list(user, query);
  }

  @Get('announcements/current')
  current(@CurrentUser() user: UserContext) {
    return this.announcementsService.current(user);
  }

  @Get('announcements/unread')
  unread(@CurrentUser() user: UserContext) {
    return this.announcementsService.unread(user);
  }

  @Get('announcements/archive')
  archiveList(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.announcementsService.archiveList(user, query);
  }

  @Get('announcements/audience-departments')
  audienceDepartments(@CurrentUser() user: UserContext) {
    return this.announcementsService.audienceDepartments(user);
  }

  @Get('announcements/:id')
  detail(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.announcementsService.detail(user, id);
  }

  @Get('announcements/:id/ack-report')
  ackReport(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.announcementsService.ackReport(user, id);
  }

  @Post('announcements')
  create(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.announcementsService.create(user, body);
  }

  @Patch('announcements/:id')
  @RequirePermission('announcements.manage')
  update(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.announcementsService.update(user, id, body);
  }

  @Post('announcements/:id/archive')
  @RequirePermission('announcements.manage')
  archive(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.announcementsService.archive(user, id);
  }

  @Post('announcements/:id/read')
  markRead(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.announcementsService.markRead(user, id);
  }

  @Post('announcements/:id/ack')
  acknowledge(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.announcementsService.markRead(user, id);
  }

  @Get('admin/announcement-settings')
  @RequirePermission('announcements.settings.read')
  settings(@CurrentUser() user: UserContext) {
    return this.announcementsService.settings(user);
  }

  @Post('admin/announcement-settings/preview')
  @RequirePermission('announcements.settings.manage')
  previewSettings(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.announcementsService.previewSettings(user, body);
  }

  @Patch('admin/announcement-settings')
  @RequirePermission('announcements.settings.manage')
  updateSettings(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.announcementsService.updateSettings(user, body);
  }
}
