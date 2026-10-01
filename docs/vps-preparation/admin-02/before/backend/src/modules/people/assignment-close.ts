import { Prisma } from '@prisma/client';
import { creditCompletedLineAssignments } from './skill-experience';

export async function closeAssignmentsWithSkillCredit(
  tx: Prisma.TransactionClient,
  input: {
    where: Prisma.AssignmentWhereInput;
    endedAt: Date;
    endedById: string | null;
    comment: string;
  },
) {
  const assignments = await tx.assignment.findMany({
    where: {
      ...input.where,
      endedAt: null,
    },
    select: {
      id: true,
      factoryId: true,
      userId: true,
      lineId: true,
      positionId: true,
      kind: true,
      startedAt: true,
    },
  });
  if (!assignments.length) {
    return {
      assignments,
      closedCount: 0,
      skillCredits: [],
    };
  }

  const closed = await tx.assignment.updateMany({
    where: {
      id: { in: assignments.map((assignment) => assignment.id) },
      endedAt: null,
    },
    data: {
      endedAt: input.endedAt,
      endedById: input.endedById,
      comment: input.comment,
      version: { increment: 1 },
    },
  });
  if (closed.count !== assignments.length) {
    throw new Error('assignment closure conflict');
  }
  const skillCredits = await creditCompletedLineAssignments(tx, assignments);
  return {
    assignments,
    closedCount: closed.count,
    skillCredits,
  };
}
