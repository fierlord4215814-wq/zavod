import { Prisma, ShiftSessionStatus } from '@prisma/client';
import { ConflictError } from './errors/conflict.exception';
import { factoryServerNow, factoryShiftSessionSchedule } from './shift-time';

export async function buildShiftSessionCreateData(
  tx: Prisma.TransactionClient,
  input: {
    factoryId: string;
    userId: string;
    startedById: string | null;
    startedAt?: Date;
  },
) {
  const access = await tx.userFactoryAccess.findUnique({
    where: {
      userId_factoryId: {
        userId: input.userId,
        factoryId: input.factoryId,
      },
    },
    select: {
      isActive: true,
      jobTitle: {
        select: {
          shiftDurationHours: true,
        },
      },
    },
  });
  const schedule = factoryShiftSessionSchedule(
    input.startedAt ?? factoryServerNow(),
    access?.isActive ? access.jobTitle?.shiftDurationHours : 12,
  );
  return {
    factoryId: input.factoryId,
    userId: input.userId,
    startedAt: schedule.startedAt,
    shiftType: schedule.shiftType,
    durationHours: schedule.durationHours,
    plannedEndAt: schedule.plannedEndAt,
    startedById: input.startedById,
  };
}

// Caller holds the person-wide assignmentUser lock and performs all related
// assignment/state/audit changes in this same transaction.
export async function finishShiftSessionTx(
  tx: Prisma.TransactionClient,
  session: { id: string; userId: string; factoryId: string; version: number },
  input: { endedAt: Date; endedById: string | null; autoClosed: boolean },
) {
  const updated = await tx.shiftSession.updateMany({
    where: {
      id: session.id,
      userId: session.userId,
      factoryId: session.factoryId,
      version: session.version,
      status: ShiftSessionStatus.ACTIVE,
    },
    data: {
      endedAt: input.endedAt,
      endedById: input.endedById,
      autoClosed: input.autoClosed,
      status: ShiftSessionStatus.ENDED,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new ConflictError('Смена уже изменилась. Обновите экран и повторите действие.');
}
