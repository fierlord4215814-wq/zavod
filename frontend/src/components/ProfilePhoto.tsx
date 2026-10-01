import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import type { Attachment } from '../store/app.store';
import { shortPersonName } from '../utils/pilot-ui';

type ProfilePhotoProps = {
  photo?: Attachment | null;
  userId: string;
  displayName: string;
  size?: 'small' | 'medium' | 'large';
};

export function ProfilePhoto({ photo, userId, displayName, size = 'medium' }: ProfilePhotoProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const initials = useMemo(() => shortPersonName(userId, displayName).slice(0, 2).toUpperCase(), [displayName, userId]);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setObjectUrl(null);
    if (!photo?.id) return undefined;

    void apiClient.downloadBlob(`/attachments/${photo.id}/file`)
      .then(({ blob }) => {
        if (!active) return;
        setObjectUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [photo?.id]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  return (
    <span className={`profile-avatar ${size} ${photo?.id && !failed ? 'has-photo' : ''}`} aria-label="Фото профиля">
      {objectUrl ? <img src={objectUrl} alt={`Фото: ${shortPersonName(userId, displayName)}`} /> : initials}
    </span>
  );
}
