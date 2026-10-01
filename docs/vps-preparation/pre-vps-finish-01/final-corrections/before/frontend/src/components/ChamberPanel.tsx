import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { CurrentUser } from '../store/app.store';

type Chamber = { id: string; lineId: string | null; name: string; lineName: string | null; hiddenAt?: string | null };
type ChamberEvent = { id: string; status: string; eventType: string; startAt: string; endAt: string | null; comment: string | null; endComment: string | null };

export function ChamberPanel({ currentUser }: { currentUser: CurrentUser | null }) {
  const canManage = Boolean(currentUser && !currentUser.isGuest && currentUser.permissions.includes('admin.lines.manage')
    && (currentUser.isAdmin || currentUser.role === 'MANAGEMENT'));
  const canWork = Boolean(currentUser?.permissions.includes('defrost.manage'));
  const [hidden, setHidden] = useState(false);
  const [chambers, setChambers] = useState<Chamber[]>([]);
  const [selected, setSelected] = useState<Chamber | null>(null);
  const [history, setHistory] = useState<ChamberEvent[]>([]);
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState('');
  const [comment, setComment] = useState('');
  const [confirmHide, setConfirmHide] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await apiClient.get<Chamber[]>(`/defrost/chambers?hidden=${hidden}`);
      setChambers(rows);
      setSelected((current) => current ? rows.find((row) => row.id === current.id) ?? null : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось получить камеры.');
    }
  }, [hidden]);

  const loadHistory = useCallback(async (id: string) => {
    try { setHistory(await apiClient.get<ChamberEvent[]>(`/defrost/chambers/${id}/history`)); }
    catch { setHistory([]); setSelected(null); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (selected) void loadHistory(selected.id);
    else setHistory([]);
  }, [selected?.id, loadHistory]);
  useEffect(() => {
    const refresh = () => { void load(); if (selected) void loadHistory(selected.id); };
    window.addEventListener('zavod:defrost-updated', refresh);
    return () => window.removeEventListener('zavod:defrost-updated', refresh);
  }, [load, loadHistory, selected?.id]);

  const perform = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await action();
      setNotice(success);
      setConfirmHide(null);
      await load();
      if (selected) await loadHistory(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выполнить действие.');
    } finally { setBusy(false); }
  };
  const active = history.find((item) => item.status === 'ACTIVE' && item.eventType === 'DEFROST') ?? null;

  return <section className="card" aria-label="Камеры оттайки">
    <div className="card-header"><div><h3>Камеры</h3><p>Сначала камеры линий, затем отдельные камеры завода.</p></div></div>
    {canManage ? <div className="button-row">
      <button className="secondary-button" type="button" disabled={!hidden} onClick={() => { setHidden(false); setSelected(null); }}>Действующие</button>
      <button className="secondary-button" type="button" disabled={hidden} onClick={() => { setHidden(true); setSelected(null); }}>Скрытые</button>
    </div> : null}
    {canManage && !hidden ? <div className="field-group">
      <label className="field-label" htmlFor="new-chamber-name">Новая отдельная камера</label>
      <input id="new-chamber-name" className="field-input" maxLength={120} value={newName} onChange={(event) => setNewName(event.target.value)} />
      <button className="action-button" type="button" disabled={busy || !newName.trim()} onClick={() => void perform(async () => {
        await apiClient.post('/defrost/chambers', { name: newName.trim() }); setNewName('');
      }, 'Камера добавлена.')}>Добавить камеру</button>
    </div> : null}
    {error ? <p className="empty-state error-state" role="alert">{error}</p> : null}
    {notice ? <p className="empty-state success-state" role="status">{notice}</p> : null}
    {!chambers.length ? <p className="empty-state compact">{hidden ? 'Скрытых камер нет.' : 'Доступных камер нет.'}</p> : null}
    <div className="defrost-line-grid">
      {chambers.map((chamber) => <button className="defrost-line-card" key={chamber.id} type="button"
        onClick={() => { setSelected(chamber); setRename(chamber.name); setConfirmHide(null); }}>
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
          <button className="secondary-button" disabled={busy || !rename.trim() || rename.trim() === selected.name} type="button"
            onClick={() => void perform(() => apiClient.patch(`/defrost/chambers/${selected.id}`, { name: rename.trim() }), 'Название сохранено.')}>Сохранить название</button>
          {hidden ? <button className="action-button" disabled={busy} type="button"
            onClick={() => void perform(() => apiClient.post(`/defrost/chambers/${selected.id}/restore`), 'Камера возвращена.')}>Вернуть камеру</button>
            : confirmHide === selected.id ? <>
              <button className="action-button danger" disabled={busy} type="button"
                onClick={() => void perform(() => apiClient.post(`/defrost/chambers/${selected.id}/hide`), 'Камера скрыта.')}>Подтвердить скрытие</button>
              <button className="secondary-button" type="button" onClick={() => setConfirmHide(null)}>Отмена</button>
            </> : <button className="secondary-button" disabled={busy} type="button" onClick={() => setConfirmHide(selected.id)}>Скрыть камеру</button>}
        </div>
      </div> : null}
      {!hidden && !selected.lineId && canWork ? <div className="field-group">
        <label className="field-label" htmlFor="chamber-comment">Комментарий к оттайке</label>
        <input id="chamber-comment" className="field-input" value={comment} onChange={(event) => setComment(event.target.value)} />
        <button className="action-button" type="button" disabled={busy} onClick={() => void perform(async () => {
          if (active) await apiClient.post(`/defrost/${active.id}/end`, { comment });
          else await apiClient.post('/defrost/start', { chamberId: selected.id, comment });
          setComment('');
        }, active ? 'Оттайка завершена.' : 'Оттайка начата.')}>
          {active ? 'Завершить оттайку' : 'Начать оттайку'}
        </button>
      </div> : null}
      <h4>История камеры</h4>
      {!history.length ? <p className="empty-state compact">Событий нет.</p> : history.map((item) => <div className="defrost-event-row" key={item.id}>
        <strong>{item.status === 'ACTIVE' ? 'Идёт оттайка' : 'Оттайка завершена'}</strong>
        <span>{new Date(item.startAt).toLocaleString('ru-RU')}{item.endAt ? ` — ${new Date(item.endAt).toLocaleString('ru-RU')}` : ''}</span>
        {item.comment ? <span>{item.comment}</span> : null}
      </div>)}
    </div> : null}
  </section>;
}
