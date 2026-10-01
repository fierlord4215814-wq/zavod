import * as React from 'react';
import { useEffect, useId, useRef, useState } from 'react';

type HelpTooltipProps = {
  title: string;
  children: React.ReactNode;
  className?: string;
};

export function HelpTooltip({ title, children, className = '' }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={`help-tooltip ${open ? 'open' : ''} ${className}`.trim()}
      onMouseEnter={() => {
        if (window.matchMedia('(hover: hover)').matches) setOpen(true);
      }}
      onMouseLeave={() => {
        if (window.matchMedia('(hover: hover)').matches) setOpen(false);
      }}
    >
      <button
        type="button"
        className="help-tooltip__button"
        aria-label={`Подсказка: ${title}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setOpen(true);
        }}
      >
        ?
      </button>
      <span id={id} role="tooltip" className="help-tooltip__popover">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </span>
  );
}
