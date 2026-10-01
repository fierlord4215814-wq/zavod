import { UserContext } from './user-context.types';

export function canReadTask(user: UserContext, task: any) {
  if (user.isGuest) return false;
  if (user.isAdmin || user.permissions.includes('tasks.manage')) return true;
  if (task.factoryId !== user.selectedFactoryId) return false;
  if (
    task.createdById === user.userId
    || task.assignedToId === user.userId
    || task.takenById === user.userId
    || task.doneById === user.userId
  ) return true;
  if (task.assignees?.some((item: any) => item.active && item.userId === user.userId)) return true;
  return Boolean(
    user.departmentId
    && task.departmentRecipients?.some((item: any) => item.active && item.departmentId === user.departmentId),
  );
}
