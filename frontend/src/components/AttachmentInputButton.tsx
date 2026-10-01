import * as React from 'react';
import { useRef } from 'react';

void React;

export type AttachmentInputMode = 'photo' | 'video' | 'camera' | 'file';

const ACCEPT_BY_MODE: Record<AttachmentInputMode, string> = {
  photo: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/webm,video/quicktime',
  camera: 'image/*',
  file: 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,.pdf,.txt',
};

type AttachmentInputButtonProps = {
  mode: AttachmentInputMode;
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  multiple?: boolean;
  title?: string;
};

export function AttachmentInputButton({
  mode,
  onFiles,
  children,
  className = '',
  disabled = false,
  multiple = true,
  title,
}: AttachmentInputButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input || disabled) return;
    // Android standalone PWA keeps the picker gesture only when click() runs
    // synchronously inside the user's button click.
    input.value = '';
    input.click();
  };

  return (
    <>
      <button
        className={className}
        disabled={disabled}
        onClick={openPicker}
        title={title}
        type="button"
      >
        {children}
      </button>
      <input
        ref={inputRef}
        accept={ACCEPT_BY_MODE[mode]}
        aria-hidden="true"
        capture={mode === 'camera' ? 'environment' : undefined}
        className="attachment-native-input"
        disabled={disabled}
        multiple={mode !== 'camera' && multiple}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) onFiles(files);
        }}
        tabIndex={-1}
        type="file"
      />
    </>
  );
}

