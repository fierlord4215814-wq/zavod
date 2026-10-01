import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { ChecklistsService } from './checklists.service';

@Controller('checklists')
export class ChecklistsController {
  constructor(private readonly service: ChecklistsService) {}

  @Get('settings')
  @RequirePermission('checklists.settings.read')
  settings(@CurrentUser() user: UserContext) {
    return this.service.settings(user);
  }

  @Post('settings/preview')
  @RequirePermission('checklists.settings.manage')
  previewSettings(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.service.previewSettings(user, body);
  }

  @Patch('settings')
  @RequirePermission('checklists.settings.manage')
  updateSettings(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.service.updateSettings(user, body);
  }

  @Get('templates')
  @RequirePermission('checklists.templates.read')
  templates(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.service.templates(user, query);
  }

  @Get('templates/library')
  @RequirePermission('checklists.templates.read')
  library(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.service.library(user, query);
  }

  @Post('templates')
  @RequirePermission('checklists.templates.manage')
  createTemplate(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.service.createTemplate(user, body);
  }

  @Get('templates/:id')
  @RequirePermission('checklists.templates.read')
  template(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.service.template(user, id);
  }

  @Patch('templates/:id')
  @RequirePermission('checklists.templates.manage')
  updateTemplate(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.service.updateTemplate(user, id, body);
  }

  @Post('templates/:id/duplicate')
  @RequirePermission('checklists.templates.manage')
  duplicateTemplate(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.service.duplicateTemplate(user, id, body);
  }

  @Post('templates/:id/archive')
  @RequirePermission('checklists.templates.manage')
  archiveTemplate(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.service.archiveTemplate(user, id);
  }

  @Post('templates/:id/restore')
  @RequirePermission('checklists.templates.manage')
  restoreTemplate(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.service.restoreTemplate(user, id);
  }

  @Post('templates/:id/rows')
  @RequirePermission('checklists.templates.manage')
  createRow(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.service.createTemplateRow(user, id, body);
  }

  @Patch('templates/:id/rows/:rowId')
  @RequirePermission('checklists.templates.manage')
  updateRow(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('rowId') rowId: string, @Body() body: any) {
    return this.service.updateTemplateRow(user, id, rowId, body);
  }

  @Get('runs/my')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage'])
  myRuns(@CurrentUser() user: UserContext) {
    return this.service.myRuns(user);
  }

  @Delete('templates/:id/rows/:rowId/reference')
  @RequirePermission('checklists.templates.manage')
  clearReference(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('rowId') rowId: string) {
    return this.service.clearReference(user, id, rowId);
  }

  @Get('runs')
  @RequirePermission('checklists.runs.read')
  runs(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.service.runs(user, query);
  }

  @Post('runs')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage'])
  startRun(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.service.startRun(user, body);
  }

  @Get('available')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage', 'checklists.templates.read'])
  available(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.service.available(user, query);
  }

  @Get('workspace')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage', 'checklists.templates.read'])
  workspace(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.service.workspace(user, query);
  }

  @Post('runs/start')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage'])
  startAvailableRun(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.service.startRun(user, body);
  }

  @Post('runs/auto-close')
  @RequirePermission('checklists.runs.manage')
  autoClose(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.service.autoClose(user, body);
  }

  @Get('runs/:id/report.pdf')
  @RequirePermission(['checklists.archive.read', 'checklists.runs.read', 'checklists.runs.self'])
  async runPdfReport(@CurrentUser() user: UserContext, @Param('id') id: string, @Res() response: any) {
    const report = await this.service.runPdfReport(user, id);
    response.setHeader('Content-Type', report.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(report.filename)}"`);
    response.setHeader('Content-Length', report.buffer.length);
    response.end(report.buffer);
  }

  @Get('runs/:id')
  @RequirePermission(['checklists.runs.read', 'checklists.runs.self'])
  run(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.service.run(user, id);
  }

  @Post('runs/:id/rows/:rowId/complete')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage'])
  completeRow(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('rowId') rowId: string, @Body() body: any) {
    return this.service.completeRow(user, id, rowId, body);
  }

  @Post('runs/:id/checks/current/complete')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage'])
  completeCurrentCheck(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.service.completeCurrentCheck(user, id, body);
  }

  @Post('runs/:id/pause')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage'])
  pause(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.service.pause(user, id, body);
  }

  @Post('runs/:id/resume')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage'])
  resume(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.service.resume(user, id);
  }

  @Post('runs/:id/close')
  @RequirePermission(['checklists.runs.self', 'checklists.runs.manage'])
  close(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.service.close(user, id, body);
  }

  @Get('archive')
  @RequirePermission(['checklists.archive.read', 'checklists.runs.self'])
  archive(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.service.archive(user, query);
  }

  @Get('archive/by-template')
  @RequirePermission(['checklists.archive.read', 'checklists.runs.self'])
  archiveByTemplate(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.service.archiveByTemplate(user, query);
  }

  @Get('archive/by-template/:templateId')
  @RequirePermission(['checklists.archive.read', 'checklists.runs.self'])
  archiveByTemplateId(@CurrentUser() user: UserContext, @Param('templateId') templateId: string, @Query() query: any) {
    return this.service.archiveByTemplate(user, { ...query, templateId });
  }

  @Get('archive/template/:templateId/journal')
  @RequirePermission(['checklists.archive.read', 'checklists.runs.self'])
  archiveJournal(@CurrentUser() user: UserContext, @Param('templateId') templateId: string, @Query() query: any) {
    return this.service.archiveJournal(user, templateId, query);
  }

  @Get('archive/template/:templateId/export.xlsx')
  @RequirePermission('checklists.archive.read')
  async exportTemplateArchive(@CurrentUser() user: UserContext, @Param('templateId') templateId: string, @Query() query: any, @Res() response: any) {
    const report = await this.service.exportTemplateArchiveExcel(user, templateId, query);
    response.setHeader('Content-Type', report.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(report.filename)}"`);
    response.setHeader('Content-Length', report.buffer.length);
    response.end(report.buffer);
  }

  @Get('reports/shift')
  @RequirePermission('checklists.archive.read')
  shiftReport(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.service.shiftComplianceReport(user, query);
  }

  @Get('reports/shift.pdf')
  @RequirePermission('checklists.archive.read')
  async shiftReportPdf(@CurrentUser() user: UserContext, @Query() query: any, @Res() response: any) {
    const report = await this.service.shiftCompliancePdfReport(user, query);
    response.setHeader('Content-Type', report.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(report.filename)}"`);
    response.setHeader('Content-Length', report.buffer.length);
    response.end(report.buffer);
  }
}
