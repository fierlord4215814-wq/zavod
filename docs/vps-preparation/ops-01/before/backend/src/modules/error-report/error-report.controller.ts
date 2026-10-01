import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { UserContext } from '../../common/user-context.types';
import { ErrorReportService } from './error-report.service';

type ErrorReportBody = {
  title?: string;
  description?: string;
  section?: string;
  authorName?: string;
  operationId?: string;
};

@Controller('error-reports')
export class ErrorReportController {
  constructor(private readonly errorReportService: ErrorReportService) {}

  @Post()
  async create(@CurrentUser() user: UserContext, @Body() body: ErrorReportBody) {
    return this.errorReportService.create(user, body);
  }

  @Get()
  async list(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.errorReportService.list(user, query);
  }

  @Get(':id')
  async detail(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.errorReportService.detail(user, id);
  }

  @Patch(':id/status')
  async updateStatus(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.errorReportService.updateStatus(user, id, body);
  }
}
