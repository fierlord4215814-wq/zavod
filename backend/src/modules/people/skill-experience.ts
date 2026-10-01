import { AssignmentKind, Prisma } from '@prisma/client';
import { factoryShiftDate, factoryShiftTarget } from '../../common/shift-time';

type CompletedAssignment = {
  id: string;
  factoryId: string;
  userId: string;
  lineId: string | null;
  positionId: string | null;
  kind: AssignmentKind;
  startedAt: Date;
};

export type SkillCreditResult = {
  assignmentId: string;
  factoryId: string;
  userId: string;
  lineId: string;
  positionId: string;
  shiftDate: Date;
  shiftType: 'DAY' | 'NIGHT';
  professionalSkillCredited: boolean;
};

export async function creditCompletedLineAssignments(
  tx: Prisma.TransactionClient,
  assignments: CompletedAssignment[],
): Promise<SkillCreditResult[]> {
  const candidates = assignments.filter(
    (assignment) => assignment.kind === AssignmentKind.LINE && assignment.lineId && assignment.positionId,
  );
  if (!candidates.length) return [];

  const positions = await tx.linePosition.findMany({
    where: { id: { in: [...new Set(candidates.map((assignment) => assignment.positionId!))] } },
    select: { id: true, skillFamilyKey: true, isExtraSlot: true },
  });
  const positionsById = new Map(positions.map((position) => [position.id, position]));
  const credited: SkillCreditResult[] = [];

  for (const assignment of candidates) {
    const position = positionsById.get(assignment.positionId!);
    if (!position) continue;

    const target = factoryShiftTarget(assignment.startedAt);
    const shiftDate = factoryShiftDate(target);
    const inserted = await tx.userSkillCredit.createMany({
      data: [{
        factoryId: assignment.factoryId,
        userId: assignment.userId,
        lineId: assignment.lineId!,
        positionId: assignment.positionId!,
        assignmentId: assignment.id,
        shiftDate,
        shiftType: target.shiftType,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) continue;

    if (!position.isExtraSlot) {
      await tx.userSkill.upsert({
        where: {
          factoryId_userId_lineId_positionId_isActive: {
            factoryId: assignment.factoryId,
            userId: assignment.userId,
            lineId: assignment.lineId!,
            positionId: assignment.positionId!,
            isActive: true,
          },
        },
        create: {
          factoryId: assignment.factoryId,
          userId: assignment.userId,
          lineId: assignment.lineId!,
          positionId: assignment.positionId!,
          skillFamilyKey: position.skillFamilyKey,
          experienceCount: 1,
        },
        update: {
          experienceCount: { increment: 1 },
          skillFamilyKey: position.skillFamilyKey,
        },
      });
    }
    credited.push({
      assignmentId: assignment.id,
      factoryId: assignment.factoryId,
      userId: assignment.userId,
      lineId: assignment.lineId!,
      positionId: assignment.positionId!,
      shiftDate,
      shiftType: target.shiftType,
      professionalSkillCredited: !position.isExtraSlot,
    });
  }

  return credited;
}
