import * as React from 'react';
import { useMobileBackLayer } from '../navigation/mobile-back';

void React;

type AdminConfirmDialogProps = {
  title: string;
  description: string;
  consequences?: string[];
  confirmLabel?: string;
  requireText?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
};

export function AdminConfirmDialog({
  title,
  description,
  consequences = [],
  confirmLabel = 'Подтвердить',
  requireText,
  requireReason = false,
  reasonLabel = 'Причина',
  reasonPlaceholder = 'Например: линия больше не используется',
  busy = false,
  error,
  onCancel,
  onConfirm,
}: AdminConfirmDialogProps) {
  const [text, setText] = React.useState('');
  const [reason, setReason] = React.useState('');
  const reasonReady = !requireReason || reason.trim().length >= 3;
  const canConfirm = !busy && reasonReady && (!requireText || text.trim() === requireText);
  useMobileBackLayer(true, onCancel, 800);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card premium-deep-form">
        <h3>{title}</h3>
        <p>{description}</p>
        {consequences.length ? (
          <div className="admin-consequences">
            {consequences.map((item) => <span key={item}>{item}</span>)}
          </div>
        ) : null}
        {requireText ? (
          <>
            <label className="field-label" htmlFor="admin-confirm-text">Введите: {requireText}</label>
            <input id="admin-confirm-text" value={text} onChange={(event) => setText(event.target.value)} disabled={busy} />
          </>
        ) : null}
        {requireReason ? (
          <>
            <label className="field-label" htmlFor="admin-confirm-reason">{reasonLabel}</label>
            <textarea
              id="admin-confirm-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              placeholder={reasonPlaceholder}
              rows={3}
            />
            <small className="field-hint">Причина попадёт в аудит и Центр восстановления.</small>
          </>
        ) : null}
        {error ? <div className="empty-state error-state compact">{error}</div> : null}
        <div className="modal-actions premium-action-row">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="primary-button" type="button" onClick={() => onConfirm(reason.trim() || undefined)} disabled={!canConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

