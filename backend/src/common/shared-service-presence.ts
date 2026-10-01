import { UserRole } from '@prisma/client';

export const SHARED_TECH_ROLES = new Set<UserRole>([
  UserRole.TECH_KIPIA,
  UserRole.TECH_ELECTRIC,
  UserRole.TECH_HOLOD,
]);

type ActiveSession = { factoryId: string };
type ServiceAccess = {
  factoryId: string;
  role: UserRole;
  isActive: boolean;
  isGuest: boolean;
  deactivatedAt?: Date | null;
  department?: { scope: string; isActive: boolean; deletedAt?: Date | null } | null;
  factory?: { name: string; isActive: boolean; deletedAt?: Date | null } | null;
};

export function sharedServicePresenceSource(input: {
  targetFactoryId: string;
  targetRole: UserRole;
  targetIsGuest: boolean;
  targetIsActive: boolean;
  targetDepartment?: { isActive: boolean; deletedAt?: Date | null } | null;
  activeSessions: ActiveSession[];
  serviceAccesses: ServiceAccess[];
}): ServiceAccess | null {
  if (input.targetIsGuest || !input.targetIsActive || !SHARED_TECH_ROLES.has(input.targetRole)
    || !input.targetDepartment?.isActive || input.targetDepartment.deletedAt) return null;
  return input.serviceAccesses.find((source) =>
    source.factoryId !== input.targetFactoryId
    && source.role === input.targetRole
    && source.isActive && !source.isGuest && !source.deactivatedAt
    && source.department?.scope === 'GLOBAL'
    && source.department.isActive && !source.department.deletedAt
    && Boolean(source.factory?.isActive) && !source.factory?.deletedAt
    && input.activeSessions.some((session) => session.factoryId === source.factoryId),
  ) ?? null;
}
