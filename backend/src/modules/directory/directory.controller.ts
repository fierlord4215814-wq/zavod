import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { DirectoryService } from './directory.service';

@Controller('directory')
export class DirectoryController {
  constructor(private readonly directoryService: DirectoryService) {}

  @Get('users')
  @RequirePermission([
    'tasks.read',
    'tasks.create',
    'tasks.manage',
    'okk.read',
    'okk.manage',
    'wash.read',
    'wash.manage',
    'checklists.templates.read',
    'checklists.templates.manage',
    'chats.read',
    'chats.write',
    'chats.manage',
    'shift-log.read',
    'shift-log.manage',
    'orders.read',
    'orders.items.manage',
    'defrost.read',
    'admin.users.read',
    'admin.users.manage',
  ])
  users(
    @CurrentUser() user: UserContext,
    @Query('q') q?: string,
    @Query('query') query?: string,
    @Query('role') role?: UserRole,
    @Query('departmentId') departmentId?: string,
    @Query('factoryId') factoryId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.directoryService.users(user, { q: q ?? query, role, departmentId, factoryId, page, limit });
  }

  @Get('departments')
  @RequirePermission([
    'tasks.read',
    'tasks.create',
    'tasks.manage',
    'orders.read',
    'orders.items.manage',
    'checklists.templates.read',
    'checklists.templates.manage',
    'chats.read',
    'chats.manage',
    'shift-log.read',
    'shift-log.manage',
    'announcements.read',
    'announcements.manage',
    'admin.departments.read',
    'admin.departments.manage',
  ])
  departments(@CurrentUser() user: UserContext, @Query('q') q?: string, @Query('factoryId') factoryId?: string) {
    return this.directoryService.departments(user, { q, factoryId });
  }

  @Get('lines')
  @RequirePermission(['lines.read', 'assignments.manage', 'defrost.read', 'defrost.manage', 'okk.read', 'okk.manage', 'wash.read', 'wash.manage', 'checklists.templates.read', 'checklists.templates.manage', 'admin.lines.read', 'admin.lines.manage'])
  lines(
    @CurrentUser() user: UserContext,
    @Query('q') q?: string,
    @Query('factoryId') factoryId?: string,
    @Query('includeDiagnostics') includeDiagnostics?: string,
  ) {
    return this.directoryService.lines(user, { q, factoryId, includeDiagnostics });
  }

  @Get('roles')
  @RequirePermission(['admin.users.read', 'admin.users.manage'])
  roles() {
    return this.directoryService.roles();
  }
}
