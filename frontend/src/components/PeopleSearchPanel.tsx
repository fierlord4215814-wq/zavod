import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';

export type PeopleSearchResult = {
  userId: string;
  displayName: string;
  role: string;
  roleLabel: string;
  departmentName: string | null;
  phoneLabel: string | null;
  matchedByPhone: boolean;
  presenceStatus: string | null;
  assignmentStatus: string | null;
  currentAssignmentSummary: string | null;
  canAssign: boolean;
  requiresManualAdd: boolean;
  selfConfirmed: boolean | null;
  reasonCode: string | null;
  reason: string | null;
};

export type PeopleSearchContext = {
  kind: 'CURRENT' | 'FUTURE';
  shiftDate: string;
  shiftType: 'DAY' | 'NIGHT';
  label: string;
};

type SearchResponse = {
  queryAccepted: boolean;
  message: string | null;
  context: PeopleSearchContext | null;
  results: PeopleSearchResult[];
};

type Props = {
  mode: 'ASSIGNMENT' | 'PEOPLE_DIRECTORY';
  context?: 'CURRENT' | 'FUTURE';
  shiftDate?: string;
  shiftType?: 'DAY' | 'NIGHT';
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: PeopleSearchResult, context: PeopleSearchContext | null) => void;
  selectLabel?: string;
  autoFocus?: boolean;
};

export function PeopleSearchPanel({
  mode,
  context,
  shiftDate,
  shiftType,
  value,
  onChange,
  onSelect,
  selectLabel = 'Выбрать',
  autoFocus = false,
}: Props) {
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const query = value.trim();
    const letters = query.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я]/gi, '');
    const digits = query.replace(/\D/g, '');
    const accepted = letters.length >= 2 || digits.length >= 4;
    const sequence = ++requestSequence.current;
    setError(null);
    if (!accepted) {
      setLoading(false);
      setResponse({
        queryAccepted: false,
        message: 'Введите минимум 2 буквы или 4 цифры номера',
        context: null,
        results: [],
      });
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, mode });
        if (context) params.set('context', context);
        if (shiftDate) params.set('shiftDate', shiftDate);
        if (shiftType) params.set('shiftType', shiftType);
        const next = await apiClient.get<SearchResponse>(`/people/search?${params.toString()}`);
        if (sequence !== requestSequence.current) return;
        setResponse(next);
      } catch {
        if (sequence !== requestSequence.current) return;
        setResponse(null);
        setError('Не удалось выполнить поиск. Проверьте соединение.');
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [context, mode, retryKey, shiftDate, shiftType, value]);

  return (
    <div className="people-search-panel">
      <div className="people-search-sticky">
        <label className="field-label" htmlFor={`people-search-${mode.toLowerCase()}`}>Фамилия, имя или телефон</label>
        <div className="people-search-input-row">
          <input
            id={`people-search-${mode.toLowerCase()}`}
            autoFocus={autoFocus}
            autoComplete="off"
            inputMode="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Поиск: фамилия, имя или телефон"
          />
          {value ? <button className="secondary-button compact-action" type="button" onClick={() => onChange('')}>Очистить</button> : null}
        </div>
        {response?.context ? <span className="tag pause search-context-tag">{response.context.label}</span> : null}
      </div>

      <div className="people-search-results" aria-live="polite">
        {loading ? <div className="empty-state compact">Ищу сотрудника...</div> : null}
        {error ? (
          <div className="empty-state error-state compact">
            <span>{error}</span>
            <button className="secondary-button compact-action" type="button" onClick={() => setRetryKey((value) => value + 1)}>Повторить</button>
          </div>
        ) : null}
        {!loading && !error && response?.message && !response.results.length ? <div className="empty-state compact">{response.message}</div> : null}
        {!loading && !error ? response?.results.map((result) => (
          <article className={`people-search-result-card ${result.canAssign ? 'available' : 'disabled'}`} key={result.userId}>
            <div className="people-search-result-main">
              <strong>{result.displayName}</strong>
              <span>{result.roleLabel}{result.departmentName ? ` · ${result.departmentName}` : ''}</span>
              {result.phoneLabel ? <span className="people-search-phone">{result.matchedByPhone ? 'Совпадение по номеру · ' : ''}{result.phoneLabel}</span> : null}
              {result.presenceStatus ? <span className={`tag ${result.presenceStatus.includes('Не ') ? 'pause' : result.presenceStatus.includes('домой') ? 'stop' : 'work'}`}>{result.presenceStatus}</span> : null}
              {result.currentAssignmentSummary ? <span className="tag">Уже назначен: {result.currentAssignmentSummary}</span> : null}
              {!result.currentAssignmentSummary && result.assignmentStatus ? <span className="tag">{result.assignmentStatus}</span> : null}
              {!result.canAssign && result.reason ? <span className="people-search-reason">{result.reason}</span> : null}
            </div>
            <button
              className={result.canAssign || mode === 'PEOPLE_DIRECTORY' ? 'primary-button compact-action' : 'secondary-button compact-action'}
              type="button"
              disabled={mode === 'ASSIGNMENT' && !result.canAssign}
              onClick={() => onSelect(result, response?.context ?? null)}
            >
              {mode === 'PEOPLE_DIRECTORY' ? 'Открыть профиль' : result.canAssign ? selectLabel : 'Недоступен'}
            </button>
          </article>
        )) : null}
      </div>
    </div>
  );
}
