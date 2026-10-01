import * as React from 'react';
import { FormEvent, useState } from 'react';
import { AttachmentPicker } from './AttachmentPicker';

void React;

type CommentBoxProps = {
  placeholder?: string;
  busy?: boolean;
  errorText?: string | null;
  withAttachments?: boolean;
  onSubmit: (message: string, files: File[]) => void | Promise<void>;
};

export function CommentBox({
  placeholder = 'Комментарий',
  busy = false,
  errorText = null,
  withAttachments = false,
  onSubmit,
}: CommentBoxProps) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit(message.trim(), files);
    setMessage('');
    setFiles([]);
  };

  return (
    <form className="comment-box" onSubmit={(event) => void submit(event)}>
      <textarea disabled={busy} onChange={(event) => setMessage(event.target.value)} placeholder={placeholder} value={message} />
      {withAttachments ? <AttachmentPicker value={files} onChange={setFiles} allowFiles disabled={busy} /> : null}
      {errorText ? <div className="empty-state error-state compact">{errorText}</div> : null}
      <button className="primary-button" disabled={busy || (!message.trim() && !files.length)} type="submit">Отправить</button>
    </form>
  );
}
