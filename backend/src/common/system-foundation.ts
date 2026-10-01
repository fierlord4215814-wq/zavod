import { PrismaClient, UserRole } from '@prisma/client';

type FoundationCatalog = {
  version: number;
  permissions: Array<[string, string]>;
  rolePermissions: Record<string, string[]>;
};

// The historical SQL snapshot never imports this module. A regression compares
// the immutable SQL rows with this current canonical source.
const catalog = require('../../prisma/system-foundation.cjs') as FoundationCatalog;

export const SYSTEM_FOUNDATION_ID = 'permissions-role-defaults-v1';

export type SystemFoundationResult = {
  state: 'INITIALIZED_CLEAN' | 'ADOPTED_EXISTING' | 'ALREADY_APPLIED';
  permissionsCreated: number;
  roleGrantsCreated: number;
  catalogVersion: number;
};

export async function applySystemFoundation(prisma: PrismaClient): Promise<SystemFoundationResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(914221, 1)::text AS lock_result`;

    const existingState = await tx.systemFoundationState.findUnique({
      where: { id: SYSTEM_FOUNDATION_ID },
    });
    if (existingState) {
      return {
        state: 'ALREADY_APPLIED',
        permissionsCreated: 0,
        roleGrantsCreated: 0,
        catalogVersion: existingState.version,
      };
    }

    const [factoryCount, userCount, accessCount] = await Promise.all([
      tx.factory.count(),
      tx.user.count(),
      tx.userFactoryAccess.count(),
    ]);
    const cleanIdentityState = factoryCount === 0 && userCount === 0 && accessCount === 0;

    const permissionInsert = await tx.permission.createMany({
      data: catalog.permissions.map(([code, description]) => ({ code, description })),
      skipDuplicates: true,
    });

    let roleGrantsCreated = 0;
    if (cleanIdentityState) {
      const roleRows = Object.entries(catalog.rolePermissions).flatMap(([role, permissionCodes]) => (
        permissionCodes.map((permissionCode) => ({
          role: role as UserRole,
          permissionCode,
          isActive: true,
        }))
      ));
      const roleInsert = await tx.rolePermission.createMany({
        data: roleRows,
        skipDuplicates: true,
      });
      roleGrantsCreated = roleInsert.count;
    }

    const state = cleanIdentityState ? 'INITIALIZED_CLEAN' : 'ADOPTED_EXISTING';
    await tx.systemFoundationState.create({
      data: {
        id: SYSTEM_FOUNDATION_ID,
        version: catalog.version,
        mode: state,
        details: {
          permissionDefinitions: catalog.permissions.length,
          canonicalRoleGrants: Object.values(catalog.rolePermissions).reduce((sum, codes) => sum + codes.length, 0),
          permissionsCreated: permissionInsert.count,
          roleGrantsCreated,
          existingIdentity: { factoryCount, userCount, accessCount },
        },
      },
    });

    return {
      state,
      permissionsCreated: permissionInsert.count,
      roleGrantsCreated,
      catalogVersion: catalog.version,
    };
  });
}
