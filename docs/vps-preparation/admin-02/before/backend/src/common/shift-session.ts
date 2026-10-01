import { Prisma } from '@prisma/client';
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
