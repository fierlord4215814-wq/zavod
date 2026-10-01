import * as React from 'react';

void React;

type Attachment = {
  id: string;
  originalName: string;
  mimeType: string;
  publicUrl?: string | null;
};

type Comment = {
  id: string;
  userId?: string;
  author?: string;
  message?: string;
  text?: string;
  createdAt?: string;
  attachments?: Attachment[];
};

export function CommentThread({ comments }: { comments: Comment[] }) {
  if (!comments.length) return <div className="empty-state compact">Комментариев пока нет</div>;

  return (
    <div className="comment-thread">
      {comments.map((comment) => (
        <article className="comment-item" key={comment.id}>
          <div className="line-title-row">
            <strong>{comment.author ?? comment.userId ?? 'Пользователь'}</strong>
            {comment.createdAt ? <span className="tag">{new Date(comment.createdAt).toLocaleString()}</span> : null}
          </div>
          <p>{comment.message ?? comment.text}</p>
          {comment.attachments?.length ? (
            <div className="line-meta">
              {comment.attachments.map((attachment) => <span className="tag" key={attachment.id}>{attachment.originalName}</span>)}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
