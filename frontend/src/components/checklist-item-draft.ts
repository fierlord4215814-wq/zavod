import type { ChecklistItemDraft } from './ChecklistItemEditor';
import { createOperationId } from '../api/operation';

export function setChecklistItemActive(draft: ChecklistItemDraft, isActive: boolean): ChecklistItemDraft {
  return {
    ...draft,
    isActive,
    // An archived row is read-only on the server. Preserve its saved reference,
    // but do not submit an upload/removal that was drafted before deactivation.
    ...(!isActive ? { referenceFile: null, referenceOperationId: undefined, removeReference: false } : {}),
  };
}

export function duplicateChecklistItem(draft: ChecklistItemDraft, clientKey: string, sortOrder: number): ChecklistItemDraft {
  return {
    ...draft,
    id: undefined,
    clientKey,
    title: `${draft.title} — копия`,
    sortOrder,
    // Saved attachments belong to the original row; do not imply inheritance.
    referencePhoto: null,
    referenceFile: draft.isActive ? draft.referenceFile : null,
    referenceOperationId: draft.isActive && draft.referenceFile ? createOperationId('checklist-reference-copy') : undefined,
    removeReference: false,
  };
}
