import { UserRole } from '@prisma/client';

export const ASSIGNABLE_EMPLOYEE_ROLES = [UserRole.WORKER, UserRole.CONTRACTOR] as const;

export function isAssignableEmployeeRole(role: UserRole | string | null | undefined) {
  return role === UserRole.WORKER || role === UserRole.CONTRACTOR;
}
