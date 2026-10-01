import { UserContext } from '../../common/user-context.types';

const DEFROST_READ_PERMISSIONS = [
  'defrost.read',
  'defrost.calendar.read',
  'defrost.manage',
] as const;

export function canReadDefrost(user: UserContext | null | undefined): boolean {
  return Boolean(
    user
    && !user.isGuest
    && user.selectedFactoryId
    && (
      user.isAdmin
      || DEFROST_READ_PERMISSIONS.some((permission) => user.permissions.includes(permission))
    ),
  );
}
