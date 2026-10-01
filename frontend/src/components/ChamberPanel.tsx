import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import type { CurrentUser } from '../store/app.store';

type Chamber = { id: string; lineId: string | null; name: string; lineName: string | null; hiddenAt?: string | null };
type ChamberEvent = { id: string; status: string; eventType: string; startAt: string; endAt: string | null; comment: string | null; endComment: string | null };
type ChamberHistory = { scopeKey: string; chamberId: string | null; generation: number; status: 'idle' | 'loading' | 'ready' | 'error'; events: ChamberEvent[] };

export function ChamberPanel({ currentUser, factoryId }: { currentUser: CurrentUser | null; factoryId: string }) {
  const canManage = Boolean(currentUser && !currentUser.isGuest && currentUser.permissions.includes('admin.lines.manage')
    && (currentUser.isAdmin || currentUser.role === 'MANAGEMENT'));
  const canWork = Boolean(currentUser?.permissions.includes('defrost.manage'));
  const [hidden, setHidden] = useState(false);
  const scopeKey = `${currentUser?.userId ?? 'signed-out'}:${factoryId}:${hidden ? 'hidden' : 'visible'}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [chambersState, setChambersState] = useState<{ scopeKey: string; rows: Chamber[] }>({ scopeKey, rows: [] });
  const chambers = chambersState.scopeKey === scopeKey ? chambersState.rows : [];
  const [selectedState, setSelectedState] = useState<{ scopeKey: string; chamber: Chamber } | null>(null);
  const selected = selectedState?.scopeKey === scopeKey ? selectedState.chamber : null;
  const selectedRef = useRef<{ scopeKey: string; id: string } | null>(null);
  const [historyState, setHistoryState] = useState<ChamberHistory>({ scopeKey, chamberId: null, generation: 0, status: 'idle', events: [] });
  const historyGeneration = useRef(0);
  const historyAuthorityRef = useRef<{ scopeKey: string; chamberId: string | null; generation: number; status: ChamberHistory['status'] }>({ scopeKey, chamberId: null, generation: 0, status: 'idle' });
  const listGeneration = useRef(0);
  const busyRef = useRef(false);
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState('');
  const [comment, setComment] = useState('');
  const [confirmHide, setConfirmHide] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clearSelection = useCallback(() => {
    historyGeneration.current += 1;
    selectedRef.current = null;
    historyAuthorityRef.current = { scopeKey: scopeRef.current, chamberId: null, generation: historyGeneration.current, status: 'idle' };
    setSelectedState(null);
    setHistoryState({ scopeKey: scopeRef.current, chamberId: null, generation: historyGeneration.current, status: 'idle', events: [] });
    setConfirmHide(null);
    setComment('');
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    const generation = ++historyGeneration.current;
    historyAuthorityRef.current = { scopeKey, chamberId: id, generation, status: 'loading' };
    setHistoryState({ scopeKey, chamberId: id, generation, status: 'loading', events: [] });
    try {
      const events = await apiClient.get<ChamberEvent[]>(`/defrost/chambers/${id}/history`);
      if (scopeRef.current !== scopeKey || historyGeneration.current !== generation
        || selectedRef.current?.scopeKey !== scopeKey || selectedRef.current.id !== id) return;
      historyAuthorityRef.current = { scopeKey, chamberId: id, generation, status: 'ready' };
      setHistoryState({ scopeKey, chamberId: id, generation, status: 'ready', events });
    } catch {
      if (scopeRef.current !== scopeKey || historyGeneration.current !== generation
        || selectedRef.current?.scopeKey !== scopeKey || selectedRef.current.id !== id) return;
      historyAuthorityRef.current = { scopeKey, chamberId: id, generation, status: 'error' };
      setHistoryState({ scopeKey, chamberId: id, generation, status: 'error', events: [] });
    }
  }, [scopeKey]);

  const load = useCallback(async (): Promise<Chamber[] | null> => {
    const generation = ++listGeneration.current;
    try {
      const rows = await apiClient.get<Chamber[]>(`/defrost/chambers?hidden=${hidden}`);
      if (scopeRef.current !== scopeKey || listGeneration.current !== generation) return null;
      setChambersState({ scopeKey, rows });
      const current = selectedRef.current;
      if (current?.scopeKey === scopeKey) {
        const chamber = rows.find((row) => row.id === current.id);
        if (chamber) setSelectedState({ scopeKey, chamber });
        else clearSelection();
      }
      return rows;
    } catch (cause) {
      if (scopeRef.current !== scopeKey || listGeneration.current !== generation) return null;
      clearSelection();
      setChambersState({ scopeKey, rows: [] });
      setError(cause instanceof Error ? cause.message : 'Не удалось получить камеры.');
      return null;
    }
  }, [hidden, scopeKey, clearSelection]);

  useEffect(() => {
    clearSelection();
    setChambersState({ scopeKey, rows: [] });
    if (currentUser && factoryId) void load();
    return () => { historyGeneration.current += 1; listGeneration.current += 1; };
  }, [scopeKey, currentUser?.userId, factoryId, clearSelection, load]);
  useEffect(() => {
    const refresh = () => {
      const current = selectedRef.current;
      if (current?.scopeKey === scopeKey) void loadHistory(current.id);
      void load();
    };
    window.addEventListener('zavod:defrost-updated', refresh);
    return () => window.removeEventListener('zavod:defrost-updated', refresh);
  }, [scopeKey, load, loadHistory]);

  const perform = async (targetId: string | null, generation: number | null, action: () => Promise<unknown>, success: string, clearComment = false) => {
    if (busyRef.current || (targetId && (selectedRef.current?.scopeKey !== scopeKey
      || selectedRef.current.id !== targetId || historyGeneration.current !== generation
      || historyAuthorityRef.current.scopeKey !== scopeKey || historyAuthorityRef.current.chamberId !== targetId
      || historyAuthorityRef.current.generation !== generation || historyAuthorityRef.current.status !== 'ready'))) return;
    busyRef.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      await action();
      if (scopeRef.current !== scopeKey) return;
      setNotice(success);
      setConfirmHide(null);
      if (clearComment) setComment('');
      const rows = await load();
      if (targetId && rows?.some((row) => row.id === targetId)
        && selectedRef.current?.scopeKey === scopeKey && selectedRef.current.id === targetId) await loadHistory(targetId);
    } catch (cause) {
      if (scopeRef.current === scopeKey) setError(cause instanceof Error ? cause.message : 'Не удалось выполнить действие.');
    } finally { busyRef.current = false; setBusy(false); }
  };
  const historyReady = Boolean(selected && historyState.scopeKey === scopeKey && historyState.chamberId === selected.id
    && historyState.generation === historyGeneration.current && historyState.status === 'ready');
  const history = historyReady ? historyState.events : [];
  const active = history.find((item) => item.status === 'ACTIVE' && item.eventType === 'DEFROST') ?? null;

  return <section className="card" aria-label="Камеры оттайки">
    <div className="card-header"><div><h3>Камеры</h3><p>Сначала камеры линий, затем отдельные камеры завода.</p></div></div>
    {canManage ? <div className="button-row">
      <button className="secondary-button" type="button" disabled={busy || !hidden} onClick={() => { clearSelection(); setHidden(false); }}>Действующие</button>
      <button className="secondary-button" type="button" disabled={busy || hidden} onClick={() => { clearSelection(); setHidden(true); }}>Скрытые</button>
    </div> : null}
    {canManage && !hidden ? <div className="field-group">
      <label className="field-label" htmlFor="new-chamber-name">Новая отдельная камера</label>
      <input id="new-chamber-name" className="field-input" maxLength={120} value={newName} onChange={(event) => setNewName(event.target.value)} />
      <button className="action-button" type="button" disabled={busy || !newName.trim()} onClick={() => void perform(null, null, async () => {
        await apiClient.post('/defrost/chambers', { name: newName.trim() }); setNewName('');
      }, 'Камера добавлена.')}>Добавить камеру</button>
    </div> : null}
    {error ? <p className="empty-state error-state" role="alert">{error}</p> : null}
    {notice ? <p className="empty-state success-state" role="status">{notice}</p> : null}
    {!chambers.length ? <p className="empty-state compact">{hidden ? 'Скрытых камер нет.' : 'Доступных камер нет.'}</p> : null}
    <div className="defrost-line-grid">
      {chambers.map((chamber) => <button className="defrost-line-card" key={chamber.id} type="button" disabled={busy}
        onClick={() => {
          if (busyRef.current) return;
          selectedRef.current = { scopeKey, id: chamber.id };
          setSelectedState({ scopeKey, chamber });
          setRename(chamber.name); setComment(''); setConfirmHide(null);
          void loadHistory(chamber.id);
        }}>
        <strong>{chamber.name}</strong><span>{chamber.lineId ? `Линия: ${chamber.lineName ?? chamber.name}` : 'Отдельная камера'}</span>
      </button>)}
    </div>
    {selected ? <div className="card">
      <h4>{selected.name}</h4>
      <p>{selected.lineId ? `Камера линии ${selected.lineName ?? ''}` : 'Отдельная камера'}</p>
      {canManage ? <div className="field-group">
        <label className="field-label" htmlFor="rename-chamber">Название камеры</label>
        <input id="rename-chamber" className="field-input" maxLength={120} value={rename} onChange={(event) => setRename(event.target.value)} />
        <div className="button-row">
          <button className="secondary-button" disabled={busy || !historyReady || !rename.trim() || rename.trim() === selected.name} type="button"
            onClick={() => void perform(selected.id, historyState.generation, () => apiClient.patch(`/defrost/chambers/${selected.id}`, { name: rename.trim() }), 'Название сохранено.')}>Сохранить название</button>
          {hidden ? <button className="action-button" disabled={busy || !historyReady} type="button"
            onClick={() => void perform(selected.id, historyState.generation, () => apiClient.post(`/defrost/chambers/${selected.id}/restore`), 'Камера возвращена.')}>Вернуть камеру</button>
            : confirmHide === selected.id ? <>
              <button className="action-button danger" disabled={busy || !historyReady} type="button"
                onClick={() => void perform(selected.id, historyState.generation, () => apiClient.post(`/defrost/chambers/${selected.id}/hide`), 'Камера скрыта.')}>Подтвердить скрытие</button>
              <button className="secondary-button" disabled={busy} type="button" onClick={() => setConfirmHide(null)}>Отмена</button>
            </> : <button className="secondary-button" disabled={busy || !historyReady} type="button" onClick={() => setConfirmHide(selected.id)}>Скрыть камеру</button>}
        </div>
      </div> : null}
      {!hidden && !selected.lineId && canWork ? <div className="field-group">
        <label className="field-label" htmlFor="chamber-comment">Комментарий к оттайке</label>
        <input id="chamber-comment" className="field-input" value={comment} onChange={(event) => setComment(event.target.value)} />
        <button className="action-button" type="button" disabled={busy || !historyReady} onClick={() => {
          const chamberId = selected.id;
          const eventId = active?.id ?? null;
          const operationComment = comment;
          void perform(chamberId, historyState.generation, () => eventId
            ? apiClient.post(`/defrost/${eventId}/end`, { comment: operationComment })
            : apiClient.post('/defrost/start', { chamberId, comment: operationComment }),
          eventId ? 'Оттайка завершена.' : 'Оттайка начата.', true);
        }}>
          {!historyReady ? 'Загрузка истории…' : active ? 'Завершить оттайку' : 'Начать оттайку'}
        </button>
      </div> : null}
      <h4>История камеры</h4>
      {!historyReady && historyState.scopeKey === scopeKey && historyState.chamberId === selected.id && historyState.status === 'error'
        ? <div className="empty-state error-state" role="alert">Не удалось загрузить историю. <button className="secondary-button" type="button" disabled={busy} onClick={() => void loadHistory(selected.id)}>Повторить</button></div>
        : !historyReady ? <p className="empty-state compact">Загружаю историю камеры…</p>
          : !history.length ? <p className="empty-state compact">Событий нет.</p> : history.map((item) => <div className="defrost-event-row" key={item.id}>
        <strong>{item.status === 'ACTIVE' ? 'Идёт оттайка' : 'Оттайка завершена'}</strong>
        <span>{new Date(item.startAt).toLocaleString('ru-RU')}{item.endAt ? ` — ${new Date(item.endAt).toLocaleString('ru-RU')}` : ''}</span>
        {item.comment ? <span>{item.comment}</span> : null}
      </div>)}
    </div> : null}
  </section>;
}
