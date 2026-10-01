import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { canAccessFactory } from '../../common/permissions';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { ReturnsService } from './returns.service';
import { QuantityReleaseInput } from '../../common/quantity-release.service';

class CreateReturnDto {
  title?: string;
  reason?: string;
  description?: string;
  photoUrl?: string;
  receivedAt?: string;
  productionDate?: string;
  article?: string;
  productName?: string;
  mismatchReason?: string;
  quantity?: number;
  unit?: string;
  lineId?: string;
  decision?: string;
  operationId?: string;
}

class CompletionDto {
  completionMark?: string;
  completedByUserId?: string;
  correctiveActionsComment?: string;
}

@Controller('returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Post()
  async createReturn(@Body() body: CreateReturnDto, @CurrentUser() user: UserContext) {
    return this.returnsService.createReturn(user, body);
  }

  @Patch(':id')
  @RequirePermission('returns.manage')
  async updateReturn(@Param('id') id: string, @Body() body: { description?: string }, @CurrentUser() user: UserContext) {
    return this.returnsService.updateReturn(user, id, body);
  }

  @Post(':id/archive')
  async archiveReturn(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.returnsService.archiveReturn(user, id);
  }

  @Post(':id/mark-completion')
  @RequirePermission('returns.manage')
  async markCompletion(@Param('id') id: string, @Body() body: CompletionDto, @CurrentUser() user: UserContext) {
    return this.returnsService.markCompletion(user, id, body);
  }

  @Post(':id/complete')
  @RequirePermission('returns.manage')
  async fullyComplete(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.returnsService.fullyComplete(user, id);
  }

  @Post(':id/partial-release')
  @RequirePermission('returns.manage')
  async partialRelease(@Param('id') id: string, @Body() body: QuantityReleaseInput, @CurrentUser() user: UserContext) {
    return this.returnsService.partialRelease(user, id, body);
  }

  @Get('publication-lines')
  async publicationLines(@CurrentUser() user: UserContext) {
    return this.returnsService.publicationLines(user);
  }

  @Get()
  async listReturns(@Req() req: any, @CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string, @Query() query?: any) {
    const selectedFactoryId = factoryId ?? req.user.selectedFactoryId;
    if (!canAccessFactory(req.user, selectedFactoryId)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к выбранному заводу' });
    }

    return this.returnsService.listReturns(user, selectedFactoryId, query ?? {});
  }
}
