import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from './audit.service';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';
import { UserContext } from './user-context.types';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string | string[]>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!permission) return true;

    const requiredPermissions = Array.isArray(permission) ? permission : [permission];
    const request = context.switchToHttp().getRequest();
    const user = request.user as UserContext | undefined;
    const allowed = Boolean(
      user &&
      !user.isGuest &&
      (user.isAdmin || requiredPermissions.some((code) => user.permissions.includes(code))),
    );

    if (allowed) return true;

    await this.auditService.write({
      userId: user?.userId ?? null,
      factoryId: user?.selectedFactoryId || null,
      action: 'ACCESS_DENIED',
      entityType: 'Permission',
      entityId: requiredPermissions.join('|'),
      details: {
        path: request.url,
        method: request.method,
        requiredPermission: requiredPermissions,
        role: user?.role ?? null,
        isGuest: user?.isGuest ?? true,
      },
    });

    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Недостаточно прав для этого действия.',
    });
  }
}
