import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { StockStatus } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { canAccessFactory } from '../../common/permissions';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { StockService } from './stock.service';

class CreateStockDefectDto { productName?: string; name?: string; quantity!: number; unit?: string; operationId?: string; }
class UpdateStockDefectDto { productName?: string; name?: string; quantity?: number; unit?: string; comment?: string; }
class IssueStockDefectDto { comment!: string; }

@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post()
  @RequirePermission('stock.manage')
  async createDefect(@Body() body: CreateStockDefectDto, @CurrentUser() user: UserContext) {
    return this.stockService.createDefect(user, body);
  }

  @Patch(':id')
  @RequirePermission('stock.manage')
  async updateDefect(@Param('id') id: string, @Body() body: UpdateStockDefectDto, @CurrentUser() user: UserContext) {
    return this.stockService.updateDefect(user, id, body);
  }

  @Post(':id/issue')
  @RequirePermission('stock.manage')
  async issueDefect(@Param('id') id: string, @Body() body: IssueStockDefectDto, @CurrentUser() user: UserContext) {
    return this.stockService.issueDefect(user, id, body.comment);
  }

  @Post(':id/archive')
  @RequirePermission('stock.manage')
  async archiveDefect(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.stockService.archiveDefect(user, id);
  }

  @Get()
  @RequirePermission('stock.read')
  async listDefects(@Req() req: any, @Query('factoryId') factoryId?: string, @Query('status') status?: StockStatus) {
    const selectedFactoryId = factoryId ?? req.user.selectedFactoryId;
    if (!canAccessFactory(req.user, selectedFactoryId)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к выбранному заводу' });
    }

    return this.stockService.listDefects(selectedFactoryId, status);
  }
}
