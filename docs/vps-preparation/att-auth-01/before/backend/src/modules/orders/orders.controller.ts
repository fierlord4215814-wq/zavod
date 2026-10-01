import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('settings')
  @RequirePermission('orders.settings.read')
  settings(@CurrentUser() user: UserContext) {
    return this.ordersService.settings(user);
  }

  @Post('settings/preview')
  @RequirePermission('orders.settings.manage')
  previewSettings(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.ordersService.previewSettings(user, body);
  }

  @Patch('settings')
  @RequirePermission('orders.settings.manage')
  updateSettings(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.ordersService.updateSettings(user, body);
  }

  @Get('summary')
  @RequirePermission('orders.read')
  summary(@CurrentUser() user: UserContext) {
    return this.ordersService.summary(user);
  }

  @Get('items')
  @RequirePermission('orders.read')
  items(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.ordersService.items(user, query);
  }

  @Get('items/:id')
  @RequirePermission('orders.read')
  item(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.ordersService.item(user, id);
  }

  @Post('items')
  @RequirePermission('orders.items.manage')
  createItem(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.ordersService.createItem(user, body);
  }

  @Patch('items/:id')
  @RequirePermission('orders.items.manage')
  updateItem(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.ordersService.updateItem(user, id, body);
  }

  @Post('items/:id/take')
  @RequirePermission('orders.take')
  take(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.ordersService.take(user, id, body);
  }

  @Post('items/:id/restock')
  @RequirePermission('orders.restock')
  restock(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.ordersService.restock(user, id, body);
  }

  @Post('items/:id/order')
  @RequirePermission('orders.request')
  orderFromItem(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.ordersService.orderFromItem(user, id, body);
  }

  @Post('items/:id/archive')
  @RequirePermission('orders.items.manage')
  archiveItem(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.ordersService.archiveItem(user, id, body);
  }

  @Post('items/:id/restore')
  @RequirePermission('orders.items.manage')
  restoreItem(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.ordersService.restoreItem(user, id);
  }

  @Get('requests')
  @RequirePermission('orders.read')
  requests(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.ordersService.requests(user, query);
  }

  @Post('requests')
  @RequirePermission('orders.request')
  createManualRequest(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.ordersService.createManualRequest(user, body);
  }

  @Get('requests/:id')
  @RequirePermission('orders.read')
  request(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.ordersService.request(user, id);
  }

  @Post('requests/:id/close')
  @RequirePermission('orders.requests.manage')
  closeRequest(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.ordersService.closeRequest(user, id, body);
  }
}
