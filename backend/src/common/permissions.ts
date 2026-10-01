import { ForbiddenException } from '@nestjs/common';
import { UserContext } from './user-context.types';

export function hasPermission(userContext: UserContext, permissionCode: string): boolean {
  return userContext.isAdmin || userContext.permissions.includes(permissionCode);
}

export function requirePermission(userContext: UserContext, permissionCode: string): void {
  if (!hasPermission(userContext, permissionCode)) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: `Missing permission: ${permissionCode}`,
    });
  }
}

export function canAccessFactory(userContext: UserContext, factoryId: string): boolean {
  return !userContext.isGuest && userContext.selectedFactoryId === factoryId;
}

export function isAdmin(userContext: UserContext): boolean {
  return userContext.isAdmin;
}
