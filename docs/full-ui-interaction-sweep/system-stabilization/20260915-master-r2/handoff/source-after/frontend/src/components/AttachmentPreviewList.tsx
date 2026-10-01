import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { acquireAttachmentPreview } from '../api/attachment-preview-resource';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { type Attachment as EntityAttachment } from '../store/app.store';
import { isPilotFixtureText } from '../utils/pilot-ui';

void React;

// Preview authority is resolved by the guarded attachment-id endpoint. Archive
// detail supplies display metadata, not the source entity's write DTO.
export type AttachmentPreviewItem = Pick<EntityAttachment, 'id' | 'kind' | 'originalName' | 'mimeType' | 'sizeBytes' | 'createdAt'>;
type Attachment = AttachmentPreviewItem;

type Props = {
  attachments?: Attachment[];
  showEmpty?: boolean;
  mode?: 'list' | 'grid' | 'inline' | 'focus';
  focusIndex?: number;
  showTitle?: boolean;
  emptyText?: string;
};

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function attachmentLabel(attachment: Attachment) {
  if (attachment.mimeType.startsWith('image/')) return 'Фото';
  if (attachment.mimeType.startsWith('video/')) return 'Видео';
  if (attachment.mimeType.startsWith('audio/')) return 'Голосовое';
  return 'Файл';
}

function isImage(attachment: Attachment) {
  return attachment.mimeType.startsWith('image/');
}

function isVideo(attachment: Attachment) {
  return attachment.mimeType.startsWith('video/');
}

function isAudio(attachment: Attachment) {
  return attachment.mimeType.startsWith('audio/');
}

function mediaAlt(attachment: Attachment) {
  return attachmentDisplayName(attachment);
}

function attachmentDisplayName(attachment: Attachment) {
  if (!attachment.originalName || isPilotFixtureText(attachment.originalName)) return attachmentLabel(attachment);
  return attachment.originalName;
}

export function AttachmentPreviewList({
  attachments = [],
  showEmpty = false,
  mode = 'list',
  focusIndex = 0,
  showTitle = mode !== 'inline',
  emptyText = 'Вложений нет.',
}: Props) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [errorText, setErrorText] = useState<string | null>(null);
  const viewerTouchStartX = useRef<number | null>(null);
  const previewSequence = useRef(0);
  const closePreview = () => {
    previewSequence.current++;
    setPreview(null);
    setPreviewScale(1);
    setErrorText(null);
  };
  useMobileBackLayer(Boolean(preview), closePreview, 900);
  useBodyScrollLock(Boolean(preview));
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [failedReasons, setFailedReasons] = useState<Record<string, string>>({});
  const [objectUrls, setObjectUrls] = useState<Record<string, string>>({});
  const objectUrlsRef = useRef<Record<string, string>>({});
  const resources = useRef(new Map<string, ReturnType<typeof acquireAttachmentPreview>>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; previewSequence.current++;
      resources.current.forEach(resource => resource.release()); resources.current.clear();
      objectUrlsRef.current = {};
    };
  }, []);

  const ensureObjectUrl = async (attachment: Attachment) => {
    if (!mounted.current) return null;
    let resource = resources.current.get(attachment.id);
    if (resource && !resource.isCurrent()) { resource.release(); resources.current.delete(attachment.id); resource = undefined; }
    if (!resource) {
      resource = acquireAttachmentPreview(attachment.id, () => {
        if (!mounted.current) return;
        previewSequence.current++; setPreview(null);
        objectUrlsRef.current = {}; setObjectUrls({});
        setFailedIds(new Set(resources.current.keys()));
        setFailedReasons({}); setErrorText('Контекст доступа изменился. Откройте файл повторно.');
      });
      resources.current.set(attachment.id, resource);
    }
    try {
      const url = await resource.load();
      if (!mounted.current || !resource.isCurrent()) return null;
      objectUrlsRef.current = { ...objectUrlsRef.current, [attachment.id]: url };
      setObjectUrls(objectUrlsRef.current);
      setFailedIds((current) => {
        if (!current.has(attachment.id)) return current;
        const next = new Set(current);
        next.delete(attachment.id);
        return next;
      });
      setFailedReasons((current) => {
        if (!(attachment.id in current)) return current;
        const next = { ...current };
        delete next[attachment.id];
        return next;
      });
      return url;
    } catch (error) {
      if (!mounted.current || !resource.isCurrent()) return null;
      const reason = error instanceof Error ? error.message : 'Не удалось загрузить файл.';
      markFailed(attachment, reason);
      setErrorText(reason);
      return null;
    }
  };

  useEffect(() => {
    for (const [id, resource] of resources.current) {
      if (attachments.some(attachment => attachment.id === id)) continue;
      resource.release(); resources.current.delete(id);
      const next = { ...objectUrlsRef.current }; delete next[id]; objectUrlsRef.current = next; setObjectUrls(next);
      if (preview?.id === id) closePreview();
    }
    attachments
      .filter((attachment) => isImage(attachment) || isVideo(attachment) || isAudio(attachment))
      .forEach((attachment) => {
        if (!objectUrlsRef.current[attachment.id] && !failedIds.has(attachment.id)) {
          void ensureObjectUrl(attachment);
        }
      });
  }, [attachments, failedIds]);
  if (!attachments.length) return showEmpty ? <div className="empty-state compact">{emptyText}</div> : null;

  const imageAttachments = attachments.filter(isImage);

  const openPreview = async (attachment: Attachment) => {
    const sequence = ++previewSequence.current;
    setErrorText(null);
    // Open a cancellable loading layer immediately. Back must invalidate its await.
    setPreview(attachment); setPreviewScale(1);
    const url = await ensureObjectUrl(attachment);
    if (!mounted.current || sequence !== previewSequence.current) return;
    setPreviewScale(1);
    setPreview(attachment);
  };

  const moveImagePreview = async (direction: -1 | 1) => {
    if (!preview || !isImage(preview) || imageAttachments.length < 2) return;
    const currentIndex = imageAttachments.findIndex((attachment) => attachment.id === preview.id);
    const nextIndex = Math.min(imageAttachments.length - 1, Math.max(0, currentIndex + direction));
    if (nextIndex === currentIndex) return;
    const next = imageAttachments[nextIndex];
    const sequence = ++previewSequence.current;
    await ensureObjectUrl(next);
    if (!mounted.current || sequence !== previewSequence.current) return;
    setPreviewScale(1);
    setPreview(next);
  };

  const markFailed = (attachment: Attachment, reason = 'Не удалось загрузить файл.') => {
    setFailedIds((current) => {
      const next = new Set(current);
      next.add(attachment.id);
      return next;
    });
    setFailedReasons((current) => ({ ...current, [attachment.id]: reason }));
  };

  const renderInlineMedia = (attachment: Attachment) => {
    const failed = failedIds.has(attachment.id);
    if (failed) {
      return (
        <button className="attachment-inline-media failed" type="button" onClick={() => void openPreview(attachment)}>
          <strong>{attachmentDisplayName(attachment)}</strong>
          <span>{failedReasons[attachment.id] ?? 'Не удалось загрузить файл.'}</span>
        </button>
      );
    }
    if (isImage(attachment)) {
      const url = objectUrls[attachment.id];
      if (!url) {
        return (
          <button className="attachment-inline-media failed" type="button" onClick={() => void openPreview(attachment)}>
            <strong>{attachmentDisplayName(attachment)}</strong>
            <span>Загрузка фото...</span>
          </button>
        );
      }
      return (
        <button className="attachment-inline-media photo" type="button" onClick={() => void openPreview(attachment)}>
          <img alt={mediaAlt(attachment)} src={url} onError={() => markFailed(attachment, 'Файл повреждён или формат нельзя показать.')} />
        </button>
      );
    }
    if (isVideo(attachment)) {
      const url = objectUrls[attachment.id];
      if (!url) {
        return (
          <button className="attachment-inline-media failed" type="button" onClick={() => void openPreview(attachment)}>
            <strong>{attachmentDisplayName(attachment)}</strong>
            <span>Загрузка видео...</span>
          </button>
        );
      }
      return (
        <div className="attachment-inline-media video">
          <video controls preload="metadata" src={url} onError={() => markFailed(attachment, 'Файл повреждён или формат нельзя показать.')} />
          <button className="secondary-button compact-action" type="button" onClick={() => void openPreview(attachment)}>
            Открыть видео
          </button>
        </div>
      );
    }
    if (isAudio(attachment)) {
      const url = objectUrls[attachment.id];
      return (
        <div className="attachment-inline-media audio">
          <div>
            <strong>Голосовое сообщение</strong>
            <span>{formatSize(attachment.sizeBytes)}</span>
          </div>
          {url ? (
            <audio controls preload="metadata" src={url} onError={() => markFailed(attachment, 'Аудио недоступно или формат нельзя воспроизвести.')} />
          ) : (
            <button className="secondary-button compact-action" type="button" onClick={() => void openPreview(attachment)}>
              Загрузить
            </button>
          )}
        </div>
      );
    }
    return null;
  };

  const renderAttachment = (attachment: Attachment) => {
    if (mode === 'inline' && (isImage(attachment) || isVideo(attachment) || isAudio(attachment))) {
      return <React.Fragment key={attachment.id}>{renderInlineMedia(attachment)}</React.Fragment>;
    }
    const failed = failedIds.has(attachment.id);
    return (
      <div className={`attachment-preview ${isImage(attachment) ? 'photo' : isVideo(attachment) ? 'video' : 'file'}`} key={attachment.id}>
        {isImage(attachment) ? (
          <button className="attachment-thumb-button" type="button" aria-label={`Открыть фото: ${attachmentDisplayName(attachment)}`} title={failed ? failedReasons[attachment.id] ?? 'Не удалось загрузить фото.' : undefined} onClick={() => void openPreview(attachment)}>
            {failed ? <span aria-hidden="true">!</span> : objectUrls[attachment.id] ? <img alt={mediaAlt(attachment)} src={objectUrls[attachment.id]} onError={() => markFailed(attachment, 'Файл повреждён или формат нельзя показать.')} /> : <span>Фото</span>}
          </button>
        ) : isVideo(attachment) ? (
          <button className="attachment-thumb-button video-thumb" type="button" onClick={() => void openPreview(attachment)}>
            <span>Видео</span>
          </button>
        ) : isAudio(attachment) ? (
          <span className="attachment-file-icon">Голос</span>
        ) : (
          <span className="attachment-file-icon">{attachmentLabel(attachment)}</span>
        )}
        <div>
          <strong>{attachmentDisplayName(attachment)}</strong>
          <span>{failed ? failedReasons[attachment.id] ?? 'Не удалось загрузить файл.' : `${attachmentLabel(attachment)} · ${formatSize(attachment.sizeBytes)}`}</span>
        </div>
        <button className="secondary-button" type="button" onClick={() => void openPreview(attachment)}>
          Открыть
        </button>
      </div>
    );
  };

  const renderImageTile = (attachment: Attachment, index: number, hiddenCount = 0) => {
    const failed = failedIds.has(attachment.id);
    const url = objectUrls[attachment.id];
    return (
      <button
        aria-label={`Открыть фото ${index + 1} из ${imageAttachments.length}`}
        className={`attachment-message-gallery-item${failed ? ' failed' : ''}`}
        key={attachment.id}
        type="button"
        onClick={() => void openPreview(attachment)}
      >
        {url && !failed ? (
          <img
            alt={mediaAlt(attachment)}
            src={url}
            onError={() => markFailed(attachment, 'Файл повреждён или формат нельзя показать.')}
          />
        ) : (
          <span>{failedReasons[attachment.id] ?? 'Загрузка фото...'}</span>
        )}
        {hiddenCount > 0 ? <strong className="attachment-message-gallery-more">+{hiddenCount}</strong> : null}
      </button>
    );
  };

  const renderInlineGallery = () => {
    if (!imageAttachments.length) return null;
    const visibleImages = imageAttachments.slice(0, 4);
    return (
      <div className={`attachment-message-gallery attachment-message-gallery-${visibleImages.length}`}>
        {visibleImages.map((attachment, index) =>
          renderImageTile(attachment, index, index === visibleImages.length - 1 ? imageAttachments.length - visibleImages.length : 0),
        )}
      </div>
    );
  };

  const renderFocusImage = () => {
    if (!imageAttachments.length) return null;
    const selectedIndex = Math.min(imageAttachments.length - 1, Math.max(0, focusIndex));
    const attachment = imageAttachments[selectedIndex];
    const failed = failedIds.has(attachment.id);
    return (
      <button
        aria-label={`Открыть фото ${selectedIndex + 1} из ${imageAttachments.length}`}
        className="attachment-focus-media"
        type="button"
        onClick={() => void openPreview(attachment)}
      >
        {objectUrls[attachment.id] && !failed ? (
          <img
            alt={mediaAlt(attachment)}
            src={objectUrls[attachment.id]}
            onError={() => markFailed(attachment, 'Файл повреждён или формат нельзя показать.')}
          />
        ) : (
          <span>{failedReasons[attachment.id] ?? 'Загрузка фото...'}</span>
        )}
      </button>
    );
  };

  const previewImageIndex = preview && isImage(preview)
    ? imageAttachments.findIndex((attachment) => attachment.id === preview.id)
    : -1;
  const previewHasPrevious = previewImageIndex > 0;
  const previewHasNext = previewImageIndex >= 0 && previewImageIndex < imageAttachments.length - 1;

  return (
    <div className={`attachment-preview-block attachment-preview-${mode}`}>
      {showTitle ? <div className="attachment-preview-title">Вложения: {attachments.length}</div> : null}
      <div className={`attachment-preview-list compact-list ${mode === 'grid' ? 'media-grid' : ''}`}>
        {mode === 'inline' ? renderInlineGallery() : null}
        {mode === 'focus' ? renderFocusImage() : null}
        {attachments
          .filter((attachment) => (mode === 'inline' || mode === 'focus' ? !isImage(attachment) : true))
          .map(renderAttachment)}
      </div>

      {preview ? (
        <div className="modal-backdrop attachment-viewer-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card attachment-modal">
            <div className="modal-header">
              <h3>{attachmentDisplayName(preview)}</h3>
              {previewImageIndex >= 0 ? <span className="attachment-viewer-counter">{previewImageIndex + 1} из {imageAttachments.length}</span> : null}
              <button className="secondary-button" type="button" onClick={closePreview}>Закрыть</button>
            </div>
            {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
            {!objectUrls[preview.id] ? <div className="empty-state compact">{failedIds.has(preview.id) ? 'Файл недоступен. Закройте окно и повторите открытие.' : 'Загрузка файла…'}</div> : isImage(preview) ? (
              <div
                className="attachment-image-stage"
                onTouchStart={(event) => {
                  viewerTouchStartX.current = event.touches[0]?.clientX ?? null;
                }}
                onTouchEnd={(event) => {
                  const startX = viewerTouchStartX.current;
                  viewerTouchStartX.current = null;
                  if (startX === null || previewScale !== 1) return;
                  const distance = (event.changedTouches[0]?.clientX ?? startX) - startX;
                  if (Math.abs(distance) < 48) return;
                  void moveImagePreview(distance < 0 ? 1 : -1);
                }}
              >
                <button
                  aria-label="Предыдущее фото"
                  className="attachment-viewer-arrow previous"
                  disabled={!previewHasPrevious}
                  title="Предыдущее фото"
                  type="button"
                  onClick={() => void moveImagePreview(-1)}
                >
                  ‹
                </button>
                <div className="attachment-image-zoom-frame">
                  <img
                    className="attachment-large-preview"
                    alt={attachmentDisplayName(preview)}
                    src={objectUrls[preview.id]}
                    style={{ transform: `scale(${previewScale})` }}
                    onError={() => setErrorText('Нет доступа к файлу или файл недоступен')}
                  />
                </div>
                <button
                  aria-label="Следующее фото"
                  className="attachment-viewer-arrow next"
                  disabled={!previewHasNext}
                  title="Следующее фото"
                  type="button"
                  onClick={() => void moveImagePreview(1)}
                >
                  ›
                </button>
                <div className="attachment-viewer-zoom-controls">
                  <button
                    aria-label="Уменьшить фото"
                    disabled={previewScale <= 1}
                    title="Уменьшить"
                    type="button"
                    onClick={() => setPreviewScale((current) => Math.max(1, current - 0.5))}
                  >
                    −
                  </button>
                  <button
                    aria-label="Увеличить фото"
                    disabled={previewScale >= 3}
                    title="Увеличить"
                    type="button"
                    onClick={() => setPreviewScale((current) => Math.min(3, current + 0.5))}
                  >
                    +
                  </button>
                </div>
              </div>
            ) : isVideo(preview) ? (
              objectUrls[preview.id] ? <video className="attachment-large-preview" controls src={objectUrls[preview.id]} onError={() => setErrorText('Нет доступа к видео или файл недоступен')} /> : <div className="empty-state compact">Видео недоступно или у вас нет прав.</div>
            ) : isAudio(preview) ? (
              objectUrls[preview.id] ? <audio className="attachment-audio-player" controls src={objectUrls[preview.id]} onError={() => setErrorText('Нет доступа к аудио или файл недоступен')} /> : <div className="empty-state compact">Аудио недоступно или у вас нет прав.</div>
            ) : (
              <div className="empty-state">
                <strong>{attachmentLabel(preview)}</strong>
                <span>Предпросмотр недоступен для этого типа файла. Файл можно открыть или скачать.</span>
              </div>
            )}
            {objectUrls[preview.id] ? <a className="action-button" href={objectUrls[preview.id]} target="_blank" rel="noreferrer">Скачать/открыть</a> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

