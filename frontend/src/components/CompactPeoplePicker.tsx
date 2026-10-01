import React, { useMemo } from 'react';

export type CompactPeoplePickerItem = {
  id: string;
  name: string;
  meta: string;
  phoneLabel?: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
};

type Props = {
  items: CompactPeoplePickerItem[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (item: CompactPeoplePickerItem) => void;
  selectedIds?: string[];
  actionLabel?: string;
  emptyLabel?: string;
  autoFocus?: boolean;
  showAllInitially?: boolean;
};

function normalizedLetters(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я]/gi, '');
}

function normalizedDigits(value: string) {
  return value.replace(/\D/g, '');
}

export function CompactPeoplePicker({
  items,
  query,
  onQueryChange,
  onSelect,
  selectedIds = [],
  actionLabel = 'Выбрать',
  emptyLabel = 'Подходящих сотрудников не найдено.',
  autoFocus = false,
  showAllInitially = false,
}: Props) {
  const letters = normalizedLetters(query);
  const digits = normalizedDigits(query);
  const hasQuery = Boolean(query.trim());
  const queryAccepted = showAllInitially || letters.length >= 2 || digits.length >= 4;
  const selected = new Set(selectedIds);
  const filtered = useMemo(() => {
    if (!queryAccepted) return [];
    if (showAllInitially && !hasQuery) return items;
    const textNeedle = query.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    return items.filter((item) => {
      const text = `${item.name} ${item.meta}`.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
      const phoneDigits = normalizedDigits(item.phoneLabel ?? '');
      return ((showAllInitially ? letters.length >= 1 : letters.length >= 2) && text.includes(textNeedle))
        || ((showAllInitially ? digits.length >= 1 : digits.length >= 4) && phoneDigits.includes(digits));
    });
  }, [digits, hasQuery, items, letters.length, query, queryAccepted, showAllInitially]);

  return (
    <div className="compact-people-picker">
      <label className="field-label">
        Фамилия, имя или телефон
        <input
          autoFocus={autoFocus}
          autoComplete="off"
          inputMode="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Минимум 2 буквы или 4 цифры"
        />
      </label>
      {!queryAccepted ? (
        <div className="empty-state compact">Введите минимум 2 буквы имени или 4 цифры телефона.</div>
      ) : null}
      {queryAccepted && !filtered.length ? <div className="empty-state compact">{emptyLabel}</div> : null}
      <div className="compact-people-picker-results">
        {filtered.map((item) => {
          const isSelected = selected.has(item.id);
          return (
            <article className={`compact-person-choice ${isSelected ? 'selected' : ''} ${item.disabled ? 'disabled' : ''}`} key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.meta}</span>
                {item.disabledReason ? <small>{item.disabledReason}</small> : null}
              </div>
              <button
                className={isSelected ? 'secondary-button compact-action' : 'primary-button compact-action'}
                type="button"
                disabled={item.disabled}
                onClick={() => onSelect(item)}
              >
                {isSelected ? 'Убрать' : actionLabel}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
