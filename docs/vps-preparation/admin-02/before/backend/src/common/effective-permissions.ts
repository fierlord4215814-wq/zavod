import { PermissionEffect, UserRole } from '@prisma/client';

type PermissionOverrideLike = {
  permissionCode: string;
  effect: PermissionEffect | 'ALLOW' | 'DENY';
};

export function resolveEffectivePermissions(input: {
  role: UserRole | string;
  isGuest: boolean;
  rolePermissionCodes: string[];
  overrides?: PermissionOverrideLike[];
}) {
  if (input.isGuest) return [];

  const permissions = new Set(input.rolePermissionCodes);
  for (const override of input.overrides ?? []) {
    const effect = String(override.effect);
    if (effect === PermissionEffect.ALLOW) permissions.add(override.permissionCode);
    if (effect === PermissionEffect.DENY) permissions.delete(override.permissionCode);
  }

  // Product eligibility ceiling: membership and personal ALLOW cannot enable chat
  // for these roles. All consumers use this effective context (including WS).
  if (input.role === UserRole.WORKER || input.role === UserRole.CONTRACTOR) {
    for (const permission of permissions) {
      if (permission.startsWith('chats.')) permissions.delete(permission);
    }
  }

  if (input.role !== UserRole.ADMIN && input.role !== UserRole.MANAGEMENT) {
    for (const permission of permissions) {
      if (permission.startsWith('ops.')) permissions.delete(permission);
    }
  }

  return Array.from(permissions).sort();
}
