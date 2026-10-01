import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';
import { AppConfirmDialog } from './AppConfirmDialog';

export type ActionModalField = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'checkbox' | 'select' | 'date' | 'datetime-local';
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
};

type ActionModalProps = {
  title: string;
  description?: string;
  fields?: ActionModalField[];
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  errorText?: string | null;
  onCancel: () => void;
  onSubmit: (values: Record<string, string | boolean>) => void | Promise<void>;
  children?: React.ReactNode;
  dirty?: boolean;
  className?: string;
};

// Boolean and textual values are not interchangeable drafts. Text/textarea and
// other textual controls may change presentation without losing their input.
const fieldKey = (field: ActionModalField) => JSON.stringify([field.name, field.type === 'checkbox' ? 'boolean' : 'text']);
const initialValue = (field: ActionModalField) => field.type === 'checkbox' ? field.defaultValue === true : String(field.defaultValue ?? '');

export function ActionModal({
  title,
  description,
  fields = [],
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  busy = false,
  errorText = null,
  onCancel,
  onSubmit,
  children,
  dirty = false,
  className = '',
}: ActionModalProps) {
  const [{ values, baseline }, setForm] = useState(() => {
    const initial: Record<string, string | boolean> = {};
    fields.forEach((field) => {
      initial[fieldKey(field)] = initialValue(field);
    });
    return { values: initial, baseline: { ...initial } };
  });
  const setValues = (update: (current: Record<string, string | boolean>) => Record<string, string | boolean>) => {
    setForm((current) => ({ ...current, values: update(current.values) }));
  };
  const [discardOpen, setDiscardOpen] = useState(false);
  const submitInFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const effectiveBusy = busy || submitting;
  const effectiveError = errorText || submitError;
  const errorRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(true);
  const fieldsSignature = React.useMemo(() => JSON.stringify(fields.map((field) => [
    field.name,
    field.type ?? 'text',
    typeof field.defaultValue,
    field.defaultValue,
    field.options ?? [],
  ])), [fields]);

  useEffect(() => {
    setForm((current) => {
      // Conditional fields may return after a parent rerender. Preserve their
      // drafts and dirty baseline; only currently rendered fields are submitted.
      const next: Record<string, string | boolean> = { ...current.values };
      const nextBaseline: Record<string, string | boolean> = { ...current.baseline };
      fields.forEach((field) => {
        const key = fieldKey(field);
        const edited = Object.prototype.hasOwnProperty.call(current.values, key)
          && current.values[key] !== current.baseline[key];
        const defaultValue = initialValue(field);
        // Late defaults update pristine fields atomically with their baseline; drafts keep both.
        next[key] = edited ? current.values[key] : defaultValue;
        nextBaseline[key] = edited ? current.baseline[key] : defaultValue;
      });
      return { values: next, baseline: nextBaseline };
    });
  }, [fieldsSignature]);

  useEffect(() => {
    if (!effectiveError) return;
    errorRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [effectiveError]);

  const hasChanges = dirty || Object.keys(values).some((name) => values[name] !== baseline[name]);
  const requestCancel = () => {
    if (busy || submitInFlight.current) return;
    if (hasChanges) setDiscardOpen(true);
    else onCancel();
  };
  useMobileBackLayer(true, requestCancel, 700);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || submitInFlight.current) return;
    const missingChoice = fields.find(field => field.type === 'select'
      && values[fieldKey(field)] !== ''
      && values[fieldKey(field)] !== undefined
      && !(field.options ?? []).some(option => option.value === values[fieldKey(field)]));
    if (missingChoice) {
      setSubmitError(`«${missingChoice.label}»: выбранный вариант недоступен. Выберите другой вариант или очистите необязательное поле.`);
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true); setSubmitError(null);
    try { await onSubmit(Object.fromEntries(fields.map(field => [field.name, values[fieldKey(field)] ?? initialValue(field)]))); }
    catch { setSubmitError('Не удалось сохранить. Введённые данные сохранены в форме. Проверьте связь и повторите попытку.'); }
    finally { submitInFlight.current = false; setSubmitting(false); }
  };

  return (
    <>
      <div className="modal-backdrop action-modal-backdrop" role="dialog" aria-modal="true">
        <form className={`modal-card premium-deep-form ${className}`.trim()} onSubmit={(event) => void submit(event)}>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
          {fields.map((field) => {
            const key = fieldKey(field);
            const value = values[key] ?? initialValue(field);
            if (field.type === 'checkbox') {
              return (
                <label className="field-label checkbox-field" key={key}>
                  <input
                    aria-label={field.label}
                    checked={value === true}
                    disabled={effectiveBusy}
                    name={field.name}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))}
                    type="checkbox"
                  />
                  {field.label}
                </label>
              );
            }
            if (field.type === 'select') {
              const unavailable = value !== '' && !(field.options ?? []).some(option => option.value === value);
              return (
                <label className="field-label" key={key}>
                  {field.label}
                  <select
                    aria-label={field.label}
                    aria-invalid={unavailable || undefined}
                    disabled={effectiveBusy}
                    name={field.name}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    required={field.required}
                    value={String(value ?? '')}
                  >
                    <option value="">Не выбрано</option>
                    {unavailable ? <option value={String(value)} disabled>Выбранный вариант недоступен</option> : null}
                    {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              );
            }
            return (
              <label className="field-label" key={key}>
                {field.label}
                {field.type === 'textarea' ? (
                  <textarea
                    aria-label={field.label}
                    autoFocus={fields[0]?.name === field.name}
                    disabled={effectiveBusy}
                    name={field.name}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    placeholder={field.placeholder}
                    required={field.required}
                    value={String(value ?? '')}
                  />
                ) : (
                  <input
                    aria-label={field.label}
                    autoFocus={fields[0]?.name === field.name}
                    disabled={effectiveBusy}
                    name={field.name}
                    inputMode={field.type === 'number' ? 'decimal' : undefined}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    placeholder={field.placeholder}
                    required={field.required}
                    type={field.type ?? 'text'}
                    value={String(value ?? '')}
                  />
                )}
              </label>
            );
          })}
          {children}
          {effectiveError ? <div className="empty-state error-state" ref={errorRef}>{effectiveError}</div> : null}
          <div className="modal-actions premium-action-row">
            <button className="secondary-button" disabled={effectiveBusy} onClick={requestCancel} type="button">{cancelLabel}</button>
            <button className="primary-button" disabled={effectiveBusy} type="submit">{confirmLabel}</button>
          </div>
        </form>
      </div>
      {discardOpen ? (
        <AppConfirmDialog
          danger
          title="Изменения не сохранены"
          description="Закрыть форму и потерять введённые данные?"
          confirmLabel="Закрыть без сохранения"
          cancelLabel="Остаться"
          onCancel={() => setDiscardOpen(false)}
          onConfirm={onCancel}
        />
      ) : null}
    </>
  );
}
