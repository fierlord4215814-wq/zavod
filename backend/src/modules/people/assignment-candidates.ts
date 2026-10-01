import { ContractorActualStatus, EmployeeState, Prisma, UserRole } from '@prisma/client';
import { isPilotFixtureUser } from '../../common/pilot-visibility';
import { factoryShiftDate, factoryShiftTarget } from '../../common/shift-time';

export type CurrentAssignmentCandidate = {
  access: any;
  currentAssignment: any | null;
  isMovable: boolean;
};

/**
 * Canonical availability resolver for actual LINE/WASH/TIME/WORK_AREA moves.
 * Mutations still re-check every invariant while holding their own locks.
 */
export async function resolveCurrentAssignmentCandidates(
  tx: Prisma.TransactionClient,
  factoryId: string,
): Promise<CurrentAssignmentCandidate[]> {
  const accesses = await tx.userFactoryAccess.findMany({
    where: {
      factoryId,
      isActive: true,
      isGuest: false,
      role: { in: [UserRole.WORKER, UserRole.CONTRACTOR] },
      user: { deletedAt: null, blockedAt: null },
    },
    include: {
      user: {
        include: {
          assignments: {
            where: { factoryId, endedAt: null },
            orderBy: { startedAt: 'desc' },
            take: 1,
          },
        },
      },
      department: true,
      company: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const current = factoryShiftTarget();
  const arrived = await tx.contractorShiftSubmissionItem.findMany({
    where: {
      actualStatus: ContractorActualStatus.ARRIVED,
      submission: {
        factoryId,
        targetShiftDate: factoryShiftDate(current),
        shiftType: current.shiftType,
      },
    },
    select: { contractorUserId: true },
  });
  const arrivedIds = new Set(arrived.map((item) => item.contractorUserId));

  return accesses
    .filter((access) => !isPilotFixtureUser(access.user))
    .filter((access) => access.role !== UserRole.CONTRACTOR || arrivedIds.has(access.userId))
    .map((access) => {
      const currentAssignment = access.user.assignments[0] ?? null;
      return { access, currentAssignment, isMovable: Boolean(currentAssignment) };
    })
    .filter(({ access, currentAssignment }) => Boolean(currentAssignment) || access.user.employeeState === EmployeeState.AVAILABLE);
}
