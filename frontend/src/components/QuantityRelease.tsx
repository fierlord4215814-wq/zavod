import React, { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { createOperationId } from '../api/operation';
import type { QuantityReleaseHistory, QuantitySummary } from '../store/app.store';
import { PremiumSheet } from './PremiumShell';

type QuantityReleaseSheetProps = {
  open: boolean;
  sourceKey: string;
  summary: QuantitySummary | null | undefined;
  busy: boolean;
  errorText?: string | null;
  onClose: () => void;
  onSubmit: (input: { quantity: string; comment: string; operationId: string }) => void | Promise<void>;
};

function scaledValue(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,17}(?:\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}

function scaledText(value: bigint) {
  const whole = value / 1000n;
  const fraction = String(value % 1000n).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Время не указано'
    : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

export function QuantityBalance({
  summary,
  compact = false,
}: {
  summary: QuantitySummary | null | undefined;
  compact?: boolean;
}) {
  if (!summary?.unit) return null;
  if (compact) {
    return (
      <div className="quantity-balance-compact" aria-label="Количество продукции">
        <strong>Осталось: {summary.remaining} {summary.unit}</strong>
        <span>Из исходных {summary.original} · выдано {summary.released}</span>
      </div>
    );
  }
  return (
    <div className="quantity-balance-grid" aria-label="Количество продукции">
      <div><span>Исходно</span><strong>{summary.original} {summary.unit}</strong></div>
      <div><span>Выдано</span><strong>{summary.released} {summary.unit}</strong></div>
      <div className="remaining"><span>Осталось</span><strong>{summary.remaining} {summary.unit}</strong></div>
    </div>
  );
}

export function QuantityReleaseHistoryList({ history }: { history: QuantityReleaseHistory[] | undefined }) {
  if (!history?.length) return null;
  return (
    <section className="quantity-release-history" aria-label="История выдач">
      <h4>История выдач</h4>
      <div className="quantity-release-history-list">
        {history.map((operation) => (
          <article key={operation.id}>
            <div>
              <strong>Выдано {operation.quantity} {operation.unit}</strong>
              <span>Остаток: {operation.quantityAfter} {operation.unit}</span>
            </div>
            <p>{operation.comment}</p>
            <small>{operation.actorName} · {formatDate(operation.createdAt)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

export function QuantityReleaseSheet({
  open,
  sourceKey,
  summary,
  busy,
  errorText,
  onClose,
  onSubmit,
}: QuantityReleaseSheetProps) {
  const formId = useId();
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  const [operationId, setOperationId] = useState(() => createOperationId('quantity-release'));

  useEffect(() => {
    if (!open) return;
    setQuantity('');
    setComment('');
    setOperationId(createOperationId('quantity-release'));
  }, [open, sourceKey]);

  const preview = useMemo(() => {
    const available = summary ? scaledValue(summary.remaining) : null;
    const requested = scaledValue(quantity);
    if (available === null || requested === null || requested <= 0n || requested > available) return null;
    return {
      requested: scaledText(requested),
      after: scaledText(available - requested),
    };
  }, [quantity, summary?.remaining]);

  if (!summary?.unit) return null;
  const valid = Boolean(preview && comment.trim());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    await onSubmit({ quantity: quantity.trim(), comment: comment.trim(), operationId });
  };

  return (
    <PremiumSheet
      className="quantity-release-sheet"
      description={`Доступно: ${summary.remaining} ${summary.unit}`}
      footer={(
        <div className="premium-action-row quantity-release-actions">
          <button className="secondary-button" disabled={busy} onClick={onClose} type="button">Отмена</button>
          <button className="primary-button" disabled={busy || !valid} form={formId} type="submit">
            {preview ? `Выдать ${preview.requested} ${summary.unit}` : 'Выдать часть'}
          </button>
        </div>
      )}
      onClose={busy ? () => undefined : onClose}
      open={open}
      title="Выдать часть продукции"
    >
      <form className="quantity-release-form" id={formId} onSubmit={(event) => void submit(event)}>
        <label className="field-label">
          <span>Количество</span>
          <input
            autoFocus
            disabled={busy}
            inputMode="decimal"
            min="0.001"
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Например, 30"
            required
            step="0.001"
            type="number"
            value={quantity}
          />
        </label>
        <label className="field-label">
          <span>Комментарий *</span>
          <textarea
            disabled={busy}
            maxLength={1000}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Например, передано на переборку"
            required
            rows={4}
            value={comment}
          />
        </label>
        <div className="quantity-release-unit">
          <span>Единица</span>
          <strong>{summary.unit}</strong>
        </div>
        <div className="quantity-release-preview" aria-live="polite">
          <div><span>Было</span><strong>{summary.remaining}</strong></div>
          <div><span>Выдаём</span><strong>{preview?.requested ?? '—'}</strong></div>
          <div><span>Останется</span><strong>{preview?.after ?? '—'}</strong></div>
        </div>
        {errorText ? <div className="empty-state error-state compact" role="alert">{errorText}</div> : null}
      </form>
    </PremiumSheet>
  );
}
