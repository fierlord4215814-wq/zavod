import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@RequirePermission('notifications.read')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: UserContext, @Query('unreadOnly') unreadOnly?: string) {
    return this.notificationsService.list(user, { unreadOnly });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: UserContext) {
    return this.notificationsService.unreadCount(user);
  }

  @Get('push/status')
  async pushStatus(@CurrentUser() user: UserContext) {
    return this.notificationsService.pushStatus(user);
  }

  @Post('push/subscribe')
  async subscribePush(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.notificationsService.subscribePush(user, body);
  }

  @Post('push/unsubscribe')
  async unsubscribePush(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.notificationsService.unsubscribePush(user, body);
  }

  @Post(':id/read')
  async markRead(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.notificationsService.markRead(user, id);
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: UserContext) {
    return this.notificationsService.markAllRead(user);
  }
}
