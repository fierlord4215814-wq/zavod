import { UserContext } from '../../common/user-context.types';

// Shared by Orders queries and attachment authority. A null/shared department
// is not public; GLOBAL departments still require the exact department id.
export function ordersDepartmentVisibilityWhere(
  user: UserContext,
  requestedDepartmentId?: unknown,
): { departmentId?: string | null } {
  const requested = String(requestedDepartmentId ?? '').trim();
  const sharedRequested = ['shared', 'global', 'common', 'none', 'null'].includes(requested.toLowerCase());
  if (user.isAdmin && !user.isGuest) {
    if (sharedRequested) return { departmentId: null };
    if (requested && requested !== 'all') return { departmentId: requested };
    return {};
  }
  return { departmentId: user.departmentId ?? '__none__' };
}
