import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { AttachmentInputButton } from './AttachmentInputButton';
import { attachmentFileKey, mergeAttachmentFiles } from './attachment-files';
import { PremiumSheet } from './PremiumShell';

void React;

type AttachmentPickerProps = {
  value: File[];
  onChange: (files: File[]) => void;
  allowFiles?: boolean;
  allowVideo?: boolean;
  disabled?: boolean;
  compact?: boolean;
  singleTrigger?: boolean;
};

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function fileKindLabel(file: File) {
  if (file.type.startsWith('image/')) return 'Фото';
  if (file.type.startsWith('video/')) return 'Видео';
  if (file.type === 'application/pdf') return 'PDF';
  if (file.type === 'text/plain') return 'Текстовый файл';
  return 'Файл';
}

export function AttachmentPicker({ value, onChange, allowFiles = false, allowVideo = false, disabled = false, compact = false, singleTrigger = false }: AttachmentPickerProps) {
  const [errorText, setErrorText] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const previews = useMemo(() => value.map((file) => ({
    file,
    url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
  })), [value]);

  useEffect(() => {
    return () => previews.forEach((preview) => {
      if (preview.url) URL.revokeObjectURL(preview.url);
    });
  }, [previews]);

  const addFiles = (files: File[], mode: 'photo' | 'video' | 'camera' | 'file') => {
    const result = mergeAttachmentFiles(value, files, { allowFiles, allowVideo, mode });
    setErrorText(result.error);
    onChange(result.files);
    setActionsOpen(false);
  };

  return (
    <div className={`attachment-picker ${compact ? 'compact' : ''}`}>
      <div className="line-meta">{singleTrigger ? 'Фото и файлы добавляются через системный выбор устройства.' : compact ? 'Выберите фото, видео или файл для сообщения.' : 'Добавьте вложение. На телефоне камера и системный выбор открываются отдельными кнопками.'}</div>
      {singleTrigger ? (
        <button className="secondary-button attachment-single-trigger" disabled={disabled} onClick={() => setActionsOpen(true)} type="button">
          Добавить вложение{value.length ? ` · ${value.length}` : ''}
        </button>
      ) : <div className="attachment-actions premium-action-row">
        <AttachmentInputButton className="secondary-button attachment-button" disabled={disabled} mode="camera" multiple={false} onFiles={(files) => addFiles(files, 'camera')}>
          Сделать фото
        </AttachmentInputButton>
        <AttachmentInputButton className="secondary-button attachment-button" disabled={disabled} mode="photo" onFiles={(files) => addFiles(files, 'photo')}>
          Добавить фото
        </AttachmentInputButton>
        {allowVideo ? (
          <AttachmentInputButton className="secondary-button attachment-button" disabled={disabled} mode="video" onFiles={(files) => addFiles(files, 'video')}>
            Добавить видео
          </AttachmentInputButton>
        ) : null}
        {allowFiles ? (
          <AttachmentInputButton className="secondary-button attachment-button" disabled={disabled} mode="file" onFiles={(files) => addFiles(files, 'file')}>
            Добавить файл
          </AttachmentInputButton>
        ) : null}
      </div>}
      <PremiumSheet open={actionsOpen} title="Добавить вложение" description="Выберите источник на устройстве." onClose={() => setActionsOpen(false)}>
        <div className="premium-action-list attachment-source-list">
          <AttachmentInputButton className="premium-action-item blue" disabled={disabled} mode="camera" multiple={false} onFiles={(files) => addFiles(files, 'camera')}>
            <span className="premium-action-item-icon" aria-hidden="true">●</span><span className="premium-action-item-copy"><strong>Сделать фото</strong><small>Открыть камеру устройства</small></span><span className="premium-action-item-chevron" aria-hidden="true">›</span>
          </AttachmentInputButton>
          <AttachmentInputButton className="premium-action-item gold" disabled={disabled} mode="photo" onFiles={(files) => addFiles(files, 'photo')}>
            <span className="premium-action-item-icon" aria-hidden="true">▧</span><span className="premium-action-item-copy"><strong>Выбрать фото</strong><small>Открыть галерею устройства</small></span><span className="premium-action-item-chevron" aria-hidden="true">›</span>
          </AttachmentInputButton>
          {allowVideo ? (
            <AttachmentInputButton className="premium-action-item blue" disabled={disabled} mode="video" onFiles={(files) => addFiles(files, 'video')}>
              <span className="premium-action-item-icon" aria-hidden="true">▶</span><span className="premium-action-item-copy"><strong>Выбрать видео</strong><small>Открыть видео на устройстве</small></span><span className="premium-action-item-chevron" aria-hidden="true">›</span>
            </AttachmentInputButton>
          ) : null}
          {allowFiles ? (
            <AttachmentInputButton className="premium-action-item neutral" disabled={disabled} mode="file" onFiles={(files) => addFiles(files, 'file')}>
              <span className="premium-action-item-icon" aria-hidden="true">□</span><span className="premium-action-item-copy"><strong>Выбрать файл</strong><small>PDF, текст, фото или видео</small></span><span className="premium-action-item-chevron" aria-hidden="true">›</span>
            </AttachmentInputButton>
          ) : null}
        </div>
      </PremiumSheet>
      {allowVideo && !compact ? <div className="line-meta">Видео: до 50 МБ, без офлайн-синхронизации файлов.</div> : null}
      {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
      {previews.length ? (
        <div className="attachment-preview-list">
          {previews.map(({ file, url }, index) => (
            <div className="attachment-preview" key={`${attachmentFileKey(file)}-${index}`}>
              {url ? <img alt={file.name} src={url} /> : <span className="tag">{file.type.startsWith('video/') ? 'Видео' : 'Файл'}</span>}
              <div>
                <strong>{file.name}</strong>
                <span>{fileKindLabel(file)} · {formatSize(file.size)}</span>
              </div>
              <button className="secondary-button" disabled={disabled} type="button" onClick={() => onChange(value.filter((_item, itemIndex) => itemIndex !== index))}>
                Убрать
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
