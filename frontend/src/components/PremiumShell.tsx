import React, { type ReactNode, useId } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMobileBackLayer } from '../navigation/mobile-back';

void React;

type PremiumSectionHeaderProps = {
  title: string;
  subtitle: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
};

export function PremiumSectionHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  className = '',
}: PremiumSectionHeaderProps) {
  return (
    <div className={`screen-heading premium-screen-heading ${actions ? 'with-actions' : ''} ${className}`.trim()}>
      <div className="premium-screen-heading-copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className="premium-screen-heading-actions">{actions}</div> : null}
    </div>
  );
}

export type PremiumKpiItem = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'success' | 'danger' | 'cool' | 'muted';
  active?: boolean;
  disabled?: boolean;
  hint?: string;
  onClick?: () => void;
};

type PremiumKpiStripProps = {
  items: PremiumKpiItem[];
  className?: string;
  label?: string;
};

export function PremiumKpiStrip({ items, className = '', label = 'Ключевые показатели' }: PremiumKpiStripProps) {
  return (
    <div
      aria-label={label}
      className={`metric-grid premium-kpi-strip ${className}`.trim()}
      data-count={Math.min(items.length, 4)}
    >
      {items.map((item) => {
        const className = `metric-card premium-kpi-card ${item.tone ?? 'neutral'} ${item.active ? 'active' : ''}`.trim();
        const content = (
          <>
            {item.icon ? <span className="premium-kpi-icon" aria-hidden="true">{item.icon}</span> : null}
            <span className="metric-label">{item.label}</span>
            <strong className="metric-value">{item.value}</strong>
            {item.hint ? <span className="premium-kpi-hint">{item.hint}</span> : null}
          </>
        );

        return item.onClick ? (
          <button
            aria-pressed={item.active}
            className={className}
            disabled={item.disabled}
            key={item.label}
            onClick={item.onClick}
            type="button"
          >
            {content}
          </button>
        ) : (
          <div className={className} key={item.label}>{content}</div>
        );
      })}
    </div>
  );
}

type PremiumActionRowProps = {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
};

export function PremiumActionRow({ children, className = '', sticky = false }: PremiumActionRowProps) {
  return (
    <div className={`premium-action-row ${sticky ? 'sticky-action-row' : ''} ${className}`.trim()}>
      {children}
    </div>
  );
}

type PremiumSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  eyebrow?: string;
  description?: string;
  footer?: ReactNode;
  className?: string;
  closeLabel?: string;
};

export function PremiumSheet({
  open,
  title,
  onClose,
  children,
  eyebrow,
  description,
  footer,
  className = '',
  closeLabel = 'Закрыть',
}: PremiumSheetProps) {
  const titleId = useId();
  useBodyScrollLock(open);
  useMobileBackLayer(open, onClose, 760);
  if (!open) return null;

  return (
    <div className="sheet-backdrop premium-sheet-backdrop" onClick={onClose}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`premium-sheet ${className}`.trim()}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <span className="premium-sheet-handle" aria-hidden="true" />
        <header className="premium-sheet-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h3 id={titleId}>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button className="secondary-button compact-action" onClick={onClose} type="button">{closeLabel}</button>
        </header>
        <div className="premium-sheet-body">{children}</div>
        {footer ? <footer className="premium-sheet-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

type PremiumActionItemProps = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  description?: string;
  reason?: string;
  tone?: 'gold' | 'green' | 'red' | 'blue' | 'neutral';
  disabled?: boolean;
  className?: string;
};

export function PremiumActionItem({
  label,
  onClick,
  icon,
  description,
  reason,
  tone = 'blue',
  disabled = false,
  className = '',
}: PremiumActionItemProps) {
  const reasonId = useId();
  return (
    <button
      aria-describedby={disabled && reason ? reasonId : undefined}
      className={`premium-action-item ${tone} ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon ? <span className="premium-action-item-icon" aria-hidden="true">{icon}</span> : null}
      <span className="premium-action-item-copy">
        <strong>{label}</strong>
        {disabled && reason ? <small id={reasonId}>{reason}</small> : description ? <small>{description}</small> : null}
      </span>
      <span className="premium-action-item-chevron" aria-hidden="true">›</span>
    </button>
  );
}
