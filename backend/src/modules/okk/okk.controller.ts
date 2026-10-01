import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { OkkStatus } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { canAccessFactory } from '../../common/permissions';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { OkkService } from './okk.service';
import { QuantityReleaseInput } from '../../common/quantity-release.service';

class CreateOkkDto {
  lineId!: string;
  assignedMasterId?: string;
  description!: string;
  defectDate?: string;
  productionDate?: string;
  shiftLabel?: string;
  article?: string;
  productName?: string;
  mismatchReason?: string;
  defectQuantity?: string;
  decision?: string;
  masterUserId?: string;
  temperatureAfterExtraFreeze?: string;
  operationId?: string;
}

class DecisionDto {
  decisionText!: string;
}

class OkkCompletionDto {
  completionMark?: string;
  unblockDate?: string;
  completedByUserId?: string;
  blockedByUserId?: string;
  correctiveActions?: string;
}

@Controller('okk')
export class OkkController {
  constructor(private readonly okkService: OkkService) {}

  @Post()
  @RequirePermission('okk.manage')
  async create(@Body() body: CreateOkkDto, @CurrentUser() user: UserContext) {
    return this.okkService.createRecord(user, body);
  }

  @Post(':id/ack')
  @RequirePermission('okk.manage')
  async acknowledge(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.okkService.acknowledge(user, id);
  }

  @Post(':id/decision')
  @RequirePermission('okk.manage')
  async setDecision(@Param('id') id: string, @Body() body: DecisionDto, @CurrentUser() user: UserContext) {
    return this.okkService.setDecision(user, id, body.decisionText);
  }

  @Post(':id/close')
  @RequirePermission('okk.manage')
  async close(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.okkService.closeRecord(user, id);
  }

  @Post(':id/unblock')
  @RequirePermission('okk.manage')
  async unblock(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.okkService.unblock(user, id);
  }

  @Post(':id/archive')
  @RequirePermission('okk.manage')
  async archive(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.okkService.archive(user, id);
  }

  @Post(':id/completion')
  @RequirePermission('okk.manage')
  async markCompletion(@Param('id') id: string, @Body() body: OkkCompletionDto, @CurrentUser() user: UserContext) {
    return this.okkService.markCompletion(user, id, body);
  }

  @Post(':id/full-complete')
  @RequirePermission('okk.manage')
  async fullyComplete(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.okkService.fullyComplete(user, id);
  }

  @Post(':id/partial-release')
  @RequirePermission('okk.manage')
  async partialRelease(@Param('id') id: string, @Body() body: QuantityReleaseInput, @CurrentUser() user: UserContext) {
    return this.okkService.partialRelease(user, id, body);
  }

  @Patch(':id')
  @RequirePermission('okk.manage')
  async update(@Param('id') id: string, @Body() body: CreateOkkDto, @CurrentUser() user: UserContext) {
    return this.okkService.updateRecord(user, id, body);
  }

  @Get()
  @RequirePermission('okk.read')
  async list(
    @Req() req: any,
    @Query('factoryId') factoryId?: string,
    @Query('status') status?: OkkStatus,
    @Query('includeArchive') includeArchive?: string,
  ) {
    const selectedFactoryId = factoryId ?? req.user.selectedFactoryId;
    if (!canAccessFactory(req.user, selectedFactoryId)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к выбранному заводу' });
    }

    return this.okkService.listRecords(req.user, selectedFactoryId, status, includeArchive === 'true');
  }
}
