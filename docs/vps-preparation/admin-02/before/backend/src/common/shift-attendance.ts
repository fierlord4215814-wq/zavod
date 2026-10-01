import { Prisma, ShiftReturnRequestStatus } from '@prisma/client';
import { FactoryShiftTarget, factoryShiftTarget, factoryShiftWindow } from './shift-time';

export async function isSentHomeAwaitingReturn(
  tx: Prisma.TransactionClient,
  factoryId: string,
  userId: string,
  target: FactoryShiftTarget = factoryShiftTarget(),
) {
  const window = factoryShiftWindow(target);
  const sentHome = await tx.auditLog.findFirst({
    where: {
      factoryId,
      action: 'EMPLOYEE_SENT_HOME',
      entityType: 'User',
      entityId: userId,
      createdAt: { gte: window.from, lt: window.to },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!sentHome) return false;

  const approvedReturn = await tx.shiftReturnRequest.findFirst({
    where: {
      factoryId,
      userId,
      status: ShiftReturnRequestStatus.APPROVED,
      decidedAt: { gt: sentHome.createdAt, lt: window.to },
    },
    orderBy: { decidedAt: 'desc' },
  });
  return !approvedReturn;
}
