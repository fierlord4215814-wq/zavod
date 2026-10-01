import { Prisma, ShiftReturnRequestStatus } from '@prisma/client';
import { FactoryShiftTarget, factoryShiftTarget, factoryShiftWindow } from './shift-time';
import { ConflictError } from './errors/conflict.exception';

// Call inside the transaction AFTER its assignmentUser (person-wide) lock.
// Never include foreign ids/names in the error or repair foreign rows here.
export async function assertNoForeignAttendanceTx(tx: Prisma.TransactionClient, factoryId: string, userId: string) {
  const [assignment, session] = await Promise.all([
    tx.assignment.findFirst({ where: { userId, factoryId: { not: factoryId }, endedAt: null }, select: { id: true } }),
    tx.shiftSession.findFirst({ where: { userId, factoryId: { not: factoryId }, status: 'ACTIVE' }, select: { id: true } }),
  ]);
  if (assignment || session) throw new ConflictError('У сотрудника есть действующая смена или назначение на другом заводе. Сначала завершите их на той площадке.');
}

export async function assertAttendanceAccessTx(tx: Prisma.TransactionClient, factoryId: string, userId: string) {
  const [user, access] = await Promise.all([
    tx.user.findUnique({ where: { id: userId } }),
    tx.userFactoryAccess.findUnique({ where: { userId_factoryId: { userId, factoryId } } }),
  ]);
  if (!user || user.blockedAt || user.deletedAt || !access?.isActive || access.isGuest) {
    throw new ConflictError('У сотрудника нет активного доступа к этому заводу.');
  }
  await assertNoForeignAttendanceTx(tx, factoryId, userId);
  return { user, access };
}

export async function assertMayAttendTx(tx: Prisma.TransactionClient, factoryId: string, userId: string) {
  await assertNoForeignAttendanceTx(tx, factoryId, userId);
  if (await isSentHomeAwaitingReturn(tx, factoryId, userId)) {
    throw new ConflictError('Сотрудник отправлен домой. Вернуться на смену можно только через запрос и подтверждение мастера.');
  }
}

export async function isSentHomeAwaitingReturn(
  tx: Prisma.TransactionClient,
  factoryId: string,
  userId: string,
  target: FactoryShiftTarget = factoryShiftTarget(),
  requestCreatedAt?: Date,
) {
  const window = factoryShiftWindow(target);
  const sentHome = await latestSentHomeTx(tx, factoryId, userId, target);
  if (!sentHome || (requestCreatedAt && (requestCreatedAt < sentHome.createdAt || requestCreatedAt >= window.to))) return false;

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

export async function latestSentHomeTx(tx: Prisma.TransactionClient, factoryId: string, userId: string, target: FactoryShiftTarget = factoryShiftTarget()) {
  const window = factoryShiftWindow(target);
  return tx.auditLog.findFirst({
    where: {
      factoryId,
      action: 'EMPLOYEE_SENT_HOME',
      entityType: 'User',
      entityId: userId,
      createdAt: { gte: window.from, lt: window.to },
    },
    orderBy: { createdAt: 'desc' },
  });
}
