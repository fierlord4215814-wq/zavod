import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useMobileBackLayer, useMobileFormDirty } from '../navigation/mobile-back';
import { useAppStore } from '../store/app.store';
import { PremiumActionRow, PremiumSectionHeader } from './PremiumShell';

type AssignmentOption = {
  id: string;
  label: string;
  description: string;
};
type RequestRow = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  requestedRole: string;
  roleLabel: string;
  departmentName: string | null;
  companyName: string | null;
  comment: string | null;
  createdAt: string;
  decisionReason: string | null;
};
type Context = {
  status: 'WAITING_ASSIGNMENT' | 'ASSIGNED';
  request: RequestRow | null;
  options: {
    assignments: AssignmentOption[];
  };
};

function newOperationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `guest-assignment-${crypto.randomUUID()}`
    : `guest-assignment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось отправить заявку.';
}

export function GuestAssignmentRequestCard() {
  const { currentUser, selectedFactoryId } = useAppStore();
  const [context, setContext] = useState<Context | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [assignmentOptionId, setAssignmentOptionId] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationIdRef = useRef(newOperationId());
  const draftKey = `zavod.guest-assignment-draft.${currentUser?.userId ?? 'anonymous'}.${selectedFactoryId}`;

  useMobileBackLayer(expanded, () => setExpanded(false), 700);
  useMobileFormDirty('guest-assignment-request', expanded && Boolean(assignmentOptionId || comment.trim()));

  const load = async () => {
    try {
      const next = await apiClient.get<Context>('/auth/assignment-request');
      setContext(next);
      setError(null);
      setAssignmentOptionId((current) => (
        current && next.options.assignments.some((option) => option.id === current)
          ? current
          : next.options.assignments[0]?.id ?? ''
      ));
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(draftKey) ?? '{}') as { assignmentOptionId?: string; comment?: string };
      if (saved.assignmentOptionId) setAssignmentOptionId(saved.assignmentOptionId);
      if (saved.comment) setComment(saved.comment);
    } catch {
      // A damaged local draft must not block the request form.
    }
    void load();
  }, [draftKey]);

  useEffect(() => {
    if (!expanded) return;
    try {
      window.sessionStorage.setItem(draftKey, JSON.stringify({ assignmentOptionId, comment }));
    } catch {
      // Draft recovery is best-effort when browser storage is unavailable.
    }
  }, [assignmentOptionId, comment, draftKey, expanded]);

  const activeRequest = context?.request?.status === 'PENDING' ? context.request : null;
  const canSubmit = useMemo(() => Boolean(
    assignmentOptionId && context?.options.assignments.some((option) => option.id === assignmentOptionId),
  ), [assignmentOptionId, context?.options.assignments]);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/auth/assignment-request', {
        assignmentOptionId,
        comment,
        operationId: operationIdRef.current,
      });
      try {
        window.sessionStorage.removeItem(draftKey);
      } catch {
        // The submitted request is authoritative even if local cleanup is unavailable.
      }
      setExpanded(false);
      await load();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card guest-assignment-card" aria-label="Назначение доступа">
      <PremiumSectionHeader
        eyebrow="Статус доступа"
        title="Вы вошли как Гость"
        subtitle="Рабочая роль ещё не назначена. Отправьте одну заявку ответственному руководителю."
        actions={<span className={`tag ${activeRequest ? 'pause' : ''}`}>{activeRequest ? 'На рассмотрении' : 'Ожидает назначения'}</span>}
      />

      {context?.request ? (
        <div className={`guest-request-status ${context.request.status.toLowerCase()}`} role="status">
          <strong>{context.request.roleLabel}</strong>
          <span>{context.request.departmentName ?? context.request.companyName ?? 'Подразделение не выбрано'}</span>
          {context.request.status === 'PENDING' ? <small>Заявка отправлена. Повторная заявка не требуется.</small> : null}
          {context.request.status === 'REJECTED' ? <small>Отклонено: {context.request.decisionReason ?? 'причина не указана'}</small> : null}
        </div>
      ) : null}

      {!activeRequest && expanded ? (
        <div className="guest-request-form">
          <label>
            Назначение
            <select value={assignmentOptionId} onChange={(event) => setAssignmentOptionId(event.target.value)}>
              <option value="">Выберите назначение</option>
              {context?.options.assignments.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          {context?.options.assignments.find((option) => option.id === assignmentOptionId)?.description ? (
            <p className="line-meta">{context.options.assignments.find((option) => option.id === assignmentOptionId)?.description}</p>
          ) : null}
          <label>
            Комментарий
            <textarea value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} placeholder="Коротко уточните, куда вас назначить" />
          </label>
          <PremiumActionRow className="guest-request-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => setExpanded(false)}>Отмена</button>
            <button className="primary-button" type="button" disabled={busy || !canSubmit} onClick={() => void submit()}>
              {busy ? 'Отправляю...' : 'Отправить заявку'}
            </button>
          </PremiumActionRow>
        </div>
      ) : null}

      {!activeRequest && !expanded ? (
        <button className="primary-button guest-request-open" type="button" onClick={() => setExpanded(true)}>
          Подать заявку на назначение
        </button>
      ) : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
    </section>
  );
}
