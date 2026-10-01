import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { OpsService } from './ops.service';

@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get('overview')
  @RequirePermission(['ops.overview.read', 'ops.statistics.read'])
  overview(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.overview(user, query);
  }

  @Get('events')
  @RequirePermission('ops.events.read')
  events(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.events(user, query);
  }

  @Get('audit')
  @RequirePermission(['ops.audit.read', 'ops.audit.full'])
  audit(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.audit(user, query);
  }

  @Get('module-summary')
  @RequirePermission(['ops.statistics.read', 'ops.overview.read'])
  moduleSummary(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.moduleSummary(user, query);
  }

  @Get('operations/overview')
  @RequirePermission(['ops.statistics.read', 'ops.overview.read'])
  operationsOverview(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.operationsAnalytics(user, query);
  }

  @Get('operations/lines')
  @RequirePermission(['ops.statistics.read', 'ops.overview.read'])
  operationsLines(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.operationsAnalytics(user, query).then((data) => ({
      period: data.period,
      items: data.lines,
      dataQuality: data.dataQuality,
    }));
  }

  @Get('operations/downtimes')
  @RequirePermission(['ops.statistics.read', 'ops.overview.read'])
  operationsDowntimes(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.operationsAnalytics(user, query).then((data) => ({
      period: data.period,
      items: data.downtimes,
      dataQuality: data.dataQuality,
    }));
  }

  @Get('operations/tasks')
  @RequirePermission(['ops.statistics.read', 'ops.overview.read'])
  operationsTasks(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.operationsAnalytics(user, query).then((data) => ({
      period: data.period,
      items: data.tasks,
      dataQuality: data.dataQuality,
    }));
  }

  @Get('operations/departments')
  @RequirePermission(['ops.statistics.read', 'ops.overview.read'])
  operationsDepartments(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.operationsAnalytics(user, query).then((data) => ({
      period: data.period,
      items: data.departments,
      dataQuality: data.dataQuality,
    }));
  }

  @Get('operations/repeated-problems')
  @RequirePermission(['ops.statistics.read', 'ops.overview.read'])
  operationsRepeatedProblems(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.opsService.operationsAnalytics(user, query).then((data) => ({
      period: data.period,
      items: data.repeatedProblems,
      dataQuality: data.dataQuality,
    }));
  }
}
