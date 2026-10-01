import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  @RequirePermission('admin.overview.read')
  async overview(@CurrentUser() user: UserContext) {
    return this.adminService.overview(user);
  }

  @Get('media/overview')
  @RequirePermission('admin.overview.read')
  async mediaOverview(@CurrentUser() user: UserContext) {
    return this.adminService.mediaOverview(user);
  }

  @Get('shift-settings')
  @RequirePermission('shift.settings.read')
  async shiftSettings(@CurrentUser() user: UserContext) {
    return this.adminService.shiftSettings(user);
  }

  @Get('task-settings')
  @RequirePermission('tasks.settings.read')
  async taskSettings(@CurrentUser() user: UserContext) {
    return this.adminService.taskSettings(user);
  }

  @Get('wash-settings')
  @RequirePermission('wash.settings.read')
  async washSettings(@CurrentUser() user: UserContext) {
    return this.adminService.washSettings(user);
  }

  @Get('defrost-settings')
  @RequirePermission('defrost.settings.read')
  async defrostSettings(@CurrentUser() user: UserContext) {
    return this.adminService.defrostSettings(user);
  }

  @Post('task-settings/preview')
  @RequirePermission('tasks.settings.manage')
  async previewTaskSettings(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.previewTaskSettings(user, body);
  }

  @Patch('task-settings')
  @RequirePermission('tasks.settings.manage')
  async updateTaskSettings(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateTaskSettings(user, body);
  }

  @Post('wash-settings/preview')
  @RequirePermission('wash.settings.manage')
  async previewWashSettings(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.previewWashSettings(user, body);
  }

  @Patch('wash-settings')
  @RequirePermission('wash.settings.manage')
  async updateWashSettings(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateWashSettings(user, body);
  }

  @Post('defrost-settings/preview')
  @RequirePermission('defrost.settings.manage')
  async previewDefrostSettings(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.previewDefrostSettings(user, body);
  }

  @Patch('defrost-settings')
  @RequirePermission('defrost.settings.manage')
  async updateDefrostSettings(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateDefrostSettings(user, body);
  }

  @Post('shift-settings/preview')
  @RequirePermission('shift.settings.manage')
  async previewShiftSettings(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.previewShiftSettings(user, body);
  }

  @Patch('shift-settings')
  @RequirePermission('shift.settings.manage')
  async updateShiftSettings(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateShiftSettings(user, body);
  }

  @Get('users')
  @RequirePermission('admin.users.read')
  async users(
    @CurrentUser() user: UserContext,
    @Query('search') search?: string,
    @Query('role') role?: UserRole,
    @Query('departmentId') departmentId?: string,
    @Query('factoryId') factoryId?: string,
    @Query('blocked') blocked?: string,
    @Query('hasFactoryAccess') hasFactoryAccess?: string,
  ) {
    return this.adminService.users(user, { search, role, departmentId, factoryId, blocked, hasFactoryAccess });
  }

  @Get('users/:id')
  @RequirePermission('admin.users.read')
  async userProfile(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.adminService.userProfile(user, id);
  }

  @Patch('users/:id/identity')
  @RequirePermission('admin.users.manage')
  async updateUserIdentity(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateUserIdentity(user, id, body);
  }

  @Get('assignment-requests')
  @RequirePermission(['admin.users.manage', 'company.members.manage'])
  async assignmentRequests(
    @CurrentUser() user: UserContext,
    @Query('status') status?: string,
    @Query('factoryId') factoryId?: string,
  ) {
    return this.adminService.assignmentRequests(user, status, factoryId);
  }

  @Post('assignment-requests/:id/accept')
  @RequirePermission(['admin.users.manage', 'company.members.manage'])
  async acceptAssignmentRequest(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.acceptAssignmentRequest(user, id, body);
  }

  @Post('assignment-requests/:id/reject')
  @RequirePermission(['admin.users.manage', 'company.members.manage'])
  async rejectAssignmentRequest(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.rejectAssignmentRequest(user, id, body);
  }

  @Patch('users/:id/factory-access')
  @RequirePermission('admin.users.manage')
  async updateFactoryAccess(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateFactoryAccess(user, id, body);
  }

  @Post('users/:id/factory-access')
  @RequirePermission('admin.users.manage')
  async grantFactoryAccess(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.grantFactoryAccess(user, id, body);
  }

  @Post('users/:id/factory-access/preview')
  @RequirePermission('admin.users.manage')
  async previewFactoryAccess(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.previewFactoryAccess(user, id, body);
  }

  @Patch('users/:id/role-department')
  @RequirePermission('admin.users.manage')
  async updateRoleDepartment(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateRoleDepartment(user, id, body);
  }

  @Post('users/:id/role-department/preview')
  @RequirePermission('admin.users.manage')
  async previewRoleDepartment(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.previewRoleDepartment(user, id, body);
  }

  @Patch('users/:id/block-status')
  @RequirePermission('admin.users.manage')
  async updateBlockStatus(@Param('id') id: string, @Body() body: { blocked: boolean; reason?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.updateBlockStatus(user, id, body);
  }

  @Get('permission-delegation/context')
  @RequirePermission('admin.users.manage')
  async permissionDelegationContext(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.permissionDelegationContext(user, factoryId);
  }

  @Post('users/:id/block-status/preview')
  @RequirePermission('admin.users.manage')
  async previewBlockStatus(@Param('id') id: string, @Body() body: { blocked: boolean; reason?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.previewBlockStatus(user, id, body);
  }

  @Get('users/:id/password-reset/preview')
  @RequirePermission(['users.password.reset', 'admin.users.manage', 'company.members.manage', 'people.profile.manage'])
  async passwordResetPreview(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.adminService.passwordResetPreview(user, id);
  }

  @Post('users/:id/password-reset')
  @RequirePermission(['users.password.reset', 'admin.users.manage', 'company.members.manage', 'people.profile.manage'])
  async resetPassword(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.resetPassword(user, id, body);
  }

  @Get('factories')
  @RequirePermission('admin.factories.read')
  async factories(@CurrentUser() user: UserContext) {
    return this.adminService.factories(user);
  }

  @Get('factories/setup/options')
  @RequirePermission('admin.factories.manage')
  async factorySetupOptions(@CurrentUser() user: UserContext) {
    return this.adminService.factorySetupOptions(user);
  }

  @Post('factories/setup/preview')
  @RequirePermission('admin.factories.manage')
  async factorySetupPreview(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.factorySetupPreview(user, body);
  }

  @Post('factories/setup/create')
  @RequirePermission('admin.factories.manage')
  async factorySetupCreate(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.factorySetupCreate(user, body);
  }

  @Get('factories/:id/context')
  @RequirePermission('admin.factories.read')
  async factoryContext(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.adminService.factoryContext(user, id);
  }

  @Get('factories/:id/config-health')
  @RequirePermission('admin.factories.read')
  async factoryConfigHealth(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.adminService.factoryConfigHealth(user, id);
  }

  @Get('factories/:id/config-export')
  @RequirePermission('admin.factories.manage')
  async factoryConfigExport(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.adminService.factoryConfigExport(user, id);
  }

  @Post('factories/config-import/preview')
  @RequirePermission('admin.factories.manage')
  async factoryConfigImportPreview(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.factoryConfigImportPreview(user, body);
  }

  @Post('factories/config-import/create')
  @RequirePermission('admin.factories.manage')
  async factoryConfigImportCreate(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.factoryConfigImportCreate(user, body);
  }

  @Post('factories')
  @RequirePermission('admin.factories.manage')
  async createFactory(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createFactory(user, body);
  }

  @Get('recovery')
  @RequirePermission('admin.factories.read')
  async recovery(
    @CurrentUser() user: UserContext,
    @Query('factoryId') factoryId?: string,
    @Query('type') type?: string,
    @Query('diagnostic') diagnostic?: string,
  ) {
    return this.adminService.recovery(user, { factoryId, type, diagnostic });
  }

  @Get('data-hygiene/summary')
  @RequirePermission('admin.overview.read')
  async dataHygieneSummary(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.dataHygieneSummary(user, { factoryId });
  }

  @Get('data-hygiene/records')
  @RequirePermission('admin.overview.read')
  async dataHygieneRecords(
    @CurrentUser() user: UserContext,
    @Query('factoryId') factoryId?: string,
    @Query('group') group?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.dataHygieneRecords(user, { factoryId, group, type, page, pageSize });
  }

  @Get('pilot-health-report/latest')
  @RequirePermission('ops.statistics.read')
  async latestPilotHealthReport(@CurrentUser() user: UserContext) {
    return this.adminService.latestPilotHealthReport(user);
  }

  @Post('recovery/:type/:id/restore')
  @RequirePermission('admin.factories.manage')
  async restoreRecoveryObject(@Param('type') type: string, @Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.restoreRecoveryObject(user, type, id, body);
  }

  @Patch('factories/:id/status')
  @RequirePermission('admin.factories.manage')
  async updateFactoryStatus(@Param('id') id: string, @Body() body: { isActive: boolean; reason?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.updateFactoryStatus(user, id, body);
  }

  @Get('departments')
  @RequirePermission('admin.departments.read')
  async departments(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.departments(user, factoryId);
  }

  @Get('organization-identity-report')
  @RequirePermission('admin.overview.read')
  async organizationIdentityReport(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.organizationIdentityReport(user, factoryId);
  }

  @Get('external-companies')
  @RequirePermission('admin.departments.read')
  async externalCompanies(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.externalCompanies(user, factoryId);
  }

  @Post('external-companies')
  @RequirePermission('admin.departments.manage')
  async createExternalCompany(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createExternalCompany(user, body);
  }

  @Patch('external-companies/:id')
  @RequirePermission('admin.departments.manage')
  async updateExternalCompany(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateExternalCompany(user, id, body);
  }

  @Patch('departments/:id/status')
  @RequirePermission('admin.departments.manage')
  async updateDepartmentStatus(@Param('id') id: string, @Body() body: { isActive: boolean; reason?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.updateDepartmentStatus(user, id, body);
  }

  @Post('departments')
  @RequirePermission('admin.departments.manage')
  async createDepartment(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createDepartment(user, body);
  }

  @Patch('departments/:id')
  @RequirePermission('admin.departments.manage')
  async updateDepartment(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateDepartment(user, id, body);
  }

  @Get('job-titles')
  @RequirePermission('admin.roles.read')
  async jobTitles(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.jobTitles(user, factoryId);
  }

  @Post('job-titles')
  @RequirePermission('admin.roles.manage')
  async createJobTitle(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createJobTitle(user, body);
  }

  @Patch('job-titles/:id')
  @RequirePermission('admin.roles.manage')
  async updateJobTitle(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateJobTitle(user, id, body);
  }

  @Get('roles')
  @RequirePermission('admin.roles.read')
  async roles() {
    return this.adminService.roles();
  }

  @Get('roles/:role/permissions')
  @RequirePermission('admin.roles.read')
  async rolePermissions(@Param('role') role: UserRole) {
    return this.adminService.rolePermissions(role);
  }

  @Post('roles/:role/permissions/preview')
  @RequirePermission('admin.roles.manage')
  async previewRolePermissions(@Param('role') role: UserRole, @Body() body: { permissionCodes: string[] }, @CurrentUser() user: UserContext) {
    return this.adminService.previewRolePermissions(user, role, body);
  }

  @Patch('roles/:role/permissions')
  @RequirePermission('admin.roles.manage')
  async updateRolePermissions(@Param('role') role: UserRole, @Body() body: { permissionCodes: string[]; reason?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.updateRolePermissions(user, role, body);
  }

  @Post('users/:id/permission-copy-preview')
  @RequirePermission('admin.users.manage')
  async permissionCopyPreview(@Param('id') id: string, @Body() body: { sourceUserId: string; factoryId?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.permissionCopyPreview(user, body.sourceUserId, id, body);
  }

  @Post('users/:id/permission-copy-apply')
  @RequirePermission('admin.users.manage')
  async permissionCopyApply(@Param('id') id: string, @Body() body: { sourceUserId: string; factoryId?: string; reason?: string }, @CurrentUser() user: UserContext) {
    return this.adminService.permissionCopyApply(user, body.sourceUserId, id, body);
  }

  @Get('permissions')
  @RequirePermission('admin.roles.read')
  async permissions() {
    return this.adminService.permissions();
  }

  @Get('lines-config')
  @RequirePermission('admin.lines.read')
  async linesConfig(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.linesConfig(user, factoryId);
  }

  @Get('staffing-control/context')
  @RequirePermission('lines.read')
  async staffingControlContext(@CurrentUser() user: UserContext) {
    return this.adminService.staffingControlContext(user);
  }

  @Post('staffing-control/lines/:id/templates')
  @RequirePermission('lines.manage')
  async createStaffingControlTemplate(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createStaffingControlTemplate(user, id, body);
  }

  @Patch('staffing-control/lines/:id/templates/:templateId')
  @RequirePermission('lines.manage')
  async updateStaffingControlTemplate(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Body() body: any,
    @CurrentUser() user: UserContext,
  ) {
    return this.adminService.updateStaffingControlTemplate(user, id, templateId, body);
  }

  @Post('staffing-control/lines/:id/templates/:templateId/default/preview')
  @RequirePermission('lines.manage')
  async previewStaffingControlDefault(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @CurrentUser() user: UserContext,
  ) {
    return this.adminService.previewStaffingControlDefault(user, id, templateId);
  }

  @Post('staffing-control/lines/:id/templates/:templateId/default')
  @RequirePermission('lines.manage')
  async setStaffingControlDefault(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Body() body: any,
    @CurrentUser() user: UserContext,
  ) {
    return this.adminService.setStaffingControlDefault(user, id, templateId, body ?? {});
  }

  @Get('lines')
  @RequirePermission('admin.lines.read')
  async lines(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.linesConfig(user, factoryId);
  }

  @Post('lines')
  @RequirePermission('admin.lines.manage')
  async createLine(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createLine(user, body);
  }

  @Get('lines/:id')
  @RequirePermission('admin.lines.read')
  async line(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.adminService.lineConfig(user, id);
  }

  @Patch('lines/:id')
  @RequirePermission('admin.lines.manage')
  async updateLine(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateLine(user, id, body);
  }

  @Get('lines/:id/positions')
  @RequirePermission('admin.lines.read')
  async linePositions(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.adminService.linePositions(user, id);
  }

  @Get('lines/:id/staffing-templates')
  @RequirePermission('admin.lines.read')
  async lineTemplates(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.adminService.lineTemplates(user, id);
  }

  @Post('lines/:id/positions')
  @RequirePermission('admin.lines.manage')
  async createPosition(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createPosition(user, id, body);
  }

  @Patch('lines/:id/positions/:positionId')
  @RequirePermission('admin.lines.manage')
  async updatePosition(@Param('id') id: string, @Param('positionId') positionId: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updatePosition(user, id, positionId, body);
  }

  @Post('lines/:id/staffing-templates')
  @RequirePermission('admin.lines.manage')
  async createTemplate(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createTemplate(user, id, body);
  }

  @Patch('lines/:id/staffing-templates/:templateId')
  @RequirePermission('admin.lines.manage')
  async updateTemplate(@Param('id') id: string, @Param('templateId') templateId: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateTemplate(user, id, templateId, body);
  }

  @Get('work-areas')
  @RequirePermission('admin.lines.read')
  async adminWorkAreas(@CurrentUser() user: UserContext, @Query('factoryId') factoryId?: string) {
    return this.adminService.workAreasConfig(user, factoryId);
  }

  @Post('work-areas')
  @RequirePermission('admin.lines.manage')
  async createWorkArea(@Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createWorkArea(user, body);
  }

  @Patch('work-areas/:id')
  @RequirePermission('admin.lines.manage')
  async updateWorkArea(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateWorkArea(user, id, body);
  }

  @Post('work-areas/:id/positions')
  @RequirePermission('admin.lines.manage')
  async createWorkAreaPosition(@Param('id') id: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.createWorkAreaPosition(user, id, body);
  }

  @Patch('work-areas/:id/positions/:positionId')
  @RequirePermission('admin.lines.manage')
  async updateWorkAreaPosition(@Param('id') id: string, @Param('positionId') positionId: string, @Body() body: any, @CurrentUser() user: UserContext) {
    return this.adminService.updateWorkAreaPosition(user, id, positionId, body);
  }
}
