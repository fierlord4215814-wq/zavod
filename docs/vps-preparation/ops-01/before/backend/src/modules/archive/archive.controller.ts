import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { UserContext } from '../../common/user-context.types';
import { ArchiveService } from './archive.service';
import { ArchiveXlsxService } from './archive-xlsx.service';

@Controller('archive')
export class ArchiveController {
  constructor(
    private readonly archiveService: ArchiveService,
    private readonly archiveXlsxService: ArchiveXlsxService,
  ) {}

  @Get('sections')
  sections(@CurrentUser() user: UserContext) {
    return this.archiveService.sections(user);
  }

  @Get('items')
  items(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.items(user, query);
  }

  @Get('export/xlsx')
  async exportXlsx(
    @CurrentUser() user: UserContext,
    @Query() query: any,
    @Res({ passthrough: true }) response: any,
  ) {
    const result = await this.archiveXlsxService.create(user, query);
    const encodedFilename = encodeURIComponent(result.filename);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    response.setHeader('X-Archive-Primary-Count', String(result.primaryCount));
    return new StreamableFile(result.buffer);
  }

  @Get('detail/:section/:sourceType/:itemId')
  detail(
    @CurrentUser() user: UserContext,
    @Param('section') section: string,
    @Param('sourceType') sourceType: string,
    @Param('itemId') itemId: string,
    @Query() query: any,
  ) {
    return this.archiveService.detail(user, section, sourceType, itemId, query);
  }

  @Get('attachments')
  attachments(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.attachments(user, query);
  }

  @Get('options')
  options(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.options(user, query);
  }

  @Get('downtime/summary')
  downtimeSummary(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.downtimeSummary(user, query);
  }

  @Get('downtime/by-lines')
  downtimeByLines(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.downtimeByLines(user, query);
  }

  @Get('downtime/by-departments')
  downtimeByDepartments(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.downtimeByDepartments(user, query);
  }

  @Get('downtime/by-assignees')
  downtimeByAssignees(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.downtimeByAssignees(user, query);
  }

  @Get('downtime/items')
  downtimeItems(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.downtimeItems(user, query);
  }

  @Get('downtime/options')
  downtimeOptions(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.archiveService.downtimeOptions(user, query);
  }

  @Post('downtime/:eventId/correction')
  correctDowntime(@Param('eventId') eventId: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.archiveService.correctDowntime(user, eventId, body);
  }
}
