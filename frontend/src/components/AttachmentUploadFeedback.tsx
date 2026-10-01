import React from 'react';
import type { AttachmentUploadProgress } from '../api/attachments';

type AttachmentUploadFeedbackProps = {
  progress: AttachmentUploadProgress | null;
  onCancel?: () => void;
  onRetry?: () => void;
};

export function AttachmentUploadFeedback({ progress, onCancel, onRetry }: AttachmentUploadFeedbackProps) {
  const feedbackRef = React.useRef<HTMLDivElement>(null);
  const canRetry = progress?.state === 'error' || progress?.state === 'cancelled';
  React.useEffect(() => {
    if (canRetry) feedbackRef.current?.scrollIntoView({ block: 'end' });
  }, [canRetry, progress?.state]);
  if (!progress) return null;
  const isUploading = progress.state === 'uploading';
  const status = progress.state === 'done'
    ? 'Файл загружен'
    : progress.state === 'cancelled'
      ? 'Загрузка отменена'
      : progress.state === 'error'
        ? 'Не удалось загрузить файл'
        : `Загрузка: ${progress.percent}%`;

  return (
    <div ref={feedbackRef} className={`attachment-upload-feedback state-${progress.state}`} role="status" aria-live="polite">
      <div className="attachment-upload-copy">
        <strong>{status}</strong>
        <span>{progress.file.name}</span>
        {progress.error ? <small>{progress.error}</small> : null}
      </div>
      <progress max={100} value={progress.percent} aria-label={`Загрузка файла ${progress.file.name}`} />
      <div className="premium-action-row attachment-upload-actions">
        {isUploading && onCancel ? <button className="secondary-button" type="button" onClick={onCancel}>Отменить</button> : null}
        {canRetry && onRetry ? <button className="primary-button" type="button" onClick={onRetry}>Повторить</button> : null}
      </div>
    </div>
  );
}
