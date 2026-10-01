import * as React from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';

void React;

type AppConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AppConfirmDialog({
  title,
  description,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  onCancel,
  onConfirm,
}: AppConfirmDialogProps) {
  useBodyScrollLock(true);
  useMobileBackLayer(true, onCancel, 1000);

  return (
    <div className="modal-backdrop app-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="app-confirm-title">
      <div className="modal-card premium-deep-form compact-modal">
        <h3 id="app-confirm-title">{title}</h3>
        <p>{description}</p>
        <div className="modal-actions premium-action-row">
          <button className="secondary-button" onClick={onCancel} type="button">{cancelLabel}</button>
          <button className={danger ? 'danger-button' : 'primary-button'} onClick={onConfirm} type="button">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
