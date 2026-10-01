import { UserContext } from './user-context.types';

export function canReadAnnouncements(user: UserContext) {
  return !user.isGuest && (
    user.isAdmin
    || user.permissions.includes('announcements.read')
  );
}

export function canPublishAnnouncement(user: UserContext) {
  return !user.isGuest && (
    user.isAdmin
    || user.permissions.includes('announcements.create')
  );
}

export function canReadReturnPublications(user: UserContext) {
  return !user.isGuest && (user.isAdmin || user.permissions.includes('returns.publication.read'));
}

export function canPublishReturn(user: UserContext) {
  return !user.isGuest && (
    user.isAdmin
    || user.permissions.includes('returns.manage')
  );
}
