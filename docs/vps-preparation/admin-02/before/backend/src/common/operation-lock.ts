import { Prisma } from '@prisma/client';

export async function lockOperationKeys(tx: Prisma.TransactionClient, keys: Array<string | null | undefined>) {
  const normalized = [...new Set(keys.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort();
  for (const key of normalized) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

export const operationLockKey = {
  lineLifecycle: (lineId: string) => `line-lifecycle:${lineId}`,
  shiftBoundary: (factoryId: string, shiftDate: string, shiftType: string) =>
    `shift-boundary:${factoryId}:${shiftDate}:${shiftType}`,
  assignmentUser: (factoryId: string, userId: string) => `assignment-user:${factoryId}:${userId}`,
  assignmentSlot: (factoryId: string, lineId: string, positionId: string, slotIndex: number) =>
    `assignment-slot:${factoryId}:${lineId}:${positionId}:${slotIndex}`,
  assignmentWorkAreaSlot: (factoryId: string, workAreaId: string, positionId: string, slotIndex: number) =>
    `assignment-work-area-slot:${factoryId}:${workAreaId}:${positionId}:${slotIndex}`,
  workAreaPositionPlan: (factoryId: string, workAreaId: string, positionId: string) =>
    `work-area-position-plan:${factoryId}:${workAreaId}:${positionId}`,
  contractorSubmission: (factoryId: string, companyId: string, shiftDate: Date, shiftType: string) =>
    `contractor-submission:${factoryId}:${companyId}:${shiftDate.toISOString()}:${shiftType}`,
  contractorSubmissionItem: (itemId: string) => `contractor-submission-item:${itemId}`,
  plannedUser: (factoryId: string, shiftDate: Date, shiftType: string, userId: string) =>
    `planned-user:${factoryId}:${shiftDate.toISOString()}:${shiftType}:${userId}`,
  plannedLineSlot: (factoryId: string, shiftDate: Date, shiftType: string, lineId: string, positionId: string, slotIndex: number) =>
    `planned-line-slot:${factoryId}:${shiftDate.toISOString()}:${shiftType}:${lineId}:${positionId}:${slotIndex}`,
  plannedWorkAreaSlot: (factoryId: string, shiftDate: Date, shiftType: string, workAreaId: string, positionId: string, slotIndex: number) =>
    `planned-work-area-slot:${factoryId}:${shiftDate.toISOString()}:${shiftType}:${workAreaId}:${positionId}:${slotIndex}`,
  task: (taskId: string) => `task:${taskId}`,
  washSession: (sessionId: string) => `wash-session:${sessionId}`,
  washRequest: (requestId: string) => `wash-request:${requestId}`,
  orderRequest: (requestId: string) => `order-request:${requestId}`,
  orderItemRequest: (factoryId: string, itemId: string) => `order-item-request:${factoryId}:${itemId}`,
  minimumStockItem: (factoryId: string, itemId: string) => `minimum-stock-item:${factoryId}:${itemId}`,
  processedOperation: (userId: string, operationId: string) => `processed-operation:${userId}:${operationId}`,
  checklistRun: (runId: string) => `checklist-run:${runId}`,
  chat: (chatId: string) => `chat:${chatId}`,
  chatMessage: (messageId: string) => `chat-message:${messageId}`,
  chatPoll: (pollId: string) => `chat-poll:${pollId}`,
  chatOperation: (authorId: string, operationId: string) => `chat-operation:${authorId}:${operationId}`,
  notification: (key: string) => `notification:${key}`,
  announcementReminder: (announcementId: string) => `announcement-reminder:${announcementId}`,
  quantityReleaseSource: (sourceType: string, sourceId: string) => `quantity-release:${sourceType}:${sourceId}`,
  quantityReleaseOperation: (operationId: string) => `quantity-release-operation:${operationId}`,
};
