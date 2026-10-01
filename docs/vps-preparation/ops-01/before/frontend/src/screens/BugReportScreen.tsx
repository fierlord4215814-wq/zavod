import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AttachmentUploadProgress, uploadAttachments } from '../api/attachments';
import { apiClient } from '../api/client';
import { AttachmentPicker } from '../components/AttachmentPicker';
import { AttachmentPreviewList } from '../components/AttachmentPreviewList';
import { AttachmentUploadFeedback } from '../components/AttachmentUploadFeedback';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { roleLabel } from '../labels';
import { useMobileBackLayer, useMobileFormDirty } from '../navigation/mobile-back';
import { Attachment, useAppStore } from '../store/app.store';

const sectionOptions = [
  'Смена',
  'Люди',
  'Линии',
  'Заявки',
  'Мойка',
  'ОКК',
  'Чек-листы',
  'Чаты',
  'Объявления',
  'Архив',
  'Админка',
  'Другое',
];

type ErrorReport = {
  id: string;
  section: string;
  title: string;
  description: string;
  authorName?: string | null;
  authorRoleLabel?: string | null;
  factoryName?: string | null;
  status: 'NEW' | 'IN_PROGRESS' | 'CLOSED' | string;
  statusLabel?: string;
  createdAt: string;
  closedAt?: string | null;
  closedByName?: string | null;
  attachments?: Attachment[];
};

type ReportResponse = {
  ok: boolean;
  id: string;
  message: string;
  report: ErrorReport;
};

const statusOptions = [
  { value: 'NEW', label: 'Новое' },
  { value: 'IN_PROGRESS', label: 'В работе' },
  { value: 'CLOSED', label: 'Закрыто' },
];

function formatDate(value?: string | null) {
  if (!value) return 'не указано';
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function BugReportScreen() {
  const { currentUser, availableFactories, selectedFactoryId } = useAppStore();
  const selectedFactory = useMemo(
    () => availableFactories.find((factory) => factory.id === selectedFactoryId),
    [availableFactories, selectedFactoryId],
  );
  const currentRoleLabel = roleLabel(currentUser?.role);
  const isAdmin = Boolean(currentUser?.isAdmin);
  const [title, setTitle] = useState('');
  const [section, setSection] = useState(sectionOptions[0]);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [reports, setReports] = useState<ErrorReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<ErrorReport | null>(null);
  const [uploadProgress, setUploadProgress] = useState<AttachmentUploadProgress | null>(null);
  const pendingUploadRef = useRef<{ reportId: string; files: File[]; operationIds: string[] } | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const draftKey = `zavod.session.error-report.${currentUser?.userId ?? 'anonymous'}.${selectedFactoryId}`;
  useMobileBackLayer(Boolean(selectedReport), () => setSelectedReport(null), 500);
  useBodyScrollLock(Boolean(selectedReport));
  useMobileFormDirty('error-report', Boolean(title.trim() || description.trim() || files.length));

  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(draftKey) ?? '{}') as { title?: string; section?: string; description?: string };
      if (saved.title) setTitle(saved.title);
      if (saved.section && sectionOptions.includes(saved.section)) setSection(saved.section);
      if (saved.description) setDescription(saved.description);
    } catch {
      // A damaged local draft must not block the report screen.
    }
  }, [draftKey]);

  useEffect(() => {
    try {
      if (title.trim() || description.trim()) window.sessionStorage.setItem(draftKey, JSON.stringify({ title, section, description }));
      else window.sessionStorage.removeItem(draftKey);
    } catch {
      // Draft recovery is best-effort when browser storage is unavailable.
    }
  }, [description, draftKey, section, title]);

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !busy && !pendingUploadRef.current;

  const loadReports = async () => {
    if (!isAdmin) return;
    try {
      const items = await apiClient.get<ErrorReport[]>('/error-reports');
      setReports(items);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось загрузить сообщения об ошибках.');
    }
  };

  useEffect(() => {
    void loadReports();
  }, [isAdmin, selectedFactoryId]);

  const completeSubmission = async (reportId: string, reportFiles: File[], operationIds: string[]) => {
    setBusy(true);
    setErrorText(null);
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    try {
      await uploadAttachments('ERROR_REPORT', reportId, reportFiles, {
        signal: controller.signal,
        operationIds,
        onProgress: setUploadProgress,
      });
      pendingUploadRef.current = null;
      setResultText('Ошибка отправлена администратору.');
      setTitle('');
      setDescription('');
      setFiles([]);
      try { window.sessionStorage.removeItem(draftKey); } catch { /* Submitted report is already authoritative. */ }
      setUploadProgress(null);
      await loadReports();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setErrorText('Сообщение создано, но загрузка файла отменена. Можно повторить загрузку.');
      } else {
        setErrorText(error instanceof Error ? error.message : 'Сообщение создано, но файл не загрузился.');
      }
    } finally {
      uploadControllerRef.current = null;
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErrorText(null);
    setResultText(null);
    try {
      const response = await apiClient.post<ReportResponse>('/error-reports', {
        title: title.trim(),
        section,
        description: description.trim(),
      });
      if (!files.length) {
        setResultText('Ошибка отправлена администратору.');
        setTitle('');
        setDescription('');
        try { window.sessionStorage.removeItem(draftKey); } catch { /* Submitted report is already authoritative. */ }
        await loadReports();
        return;
      }
      const pending = {
        reportId: response.id,
        files: [...files],
        operationIds: files.map(() => crypto.randomUUID()),
      };
      pendingUploadRef.current = pending;
      await completeSubmission(pending.reportId, pending.files, pending.operationIds);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось отправить сообщение.');
    } finally {
      setBusy(false);
    }
  };

  const retryUpload = () => {
    const pending = pendingUploadRef.current;
    if (!pending || busy) return;
    void completeSubmission(pending.reportId, pending.files, pending.operationIds);
  };

  const openReport = async (id: string) => {
    setErrorText(null);
    try {
      const item = await apiClient.get<ErrorReport>(`/error-reports/${id}`);
      setSelectedReport(item);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось открыть сообщение.');
    }
  };

  const updateStatus = async (report: ErrorReport, status: string) => {
    setErrorText(null);
    try {
      const updated = await apiClient.patch<ErrorReport>(`/error-reports/${report.id}/status`, { status });
      setSelectedReport(updated);
      await loadReports();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось изменить статус.');
    }
  };

  return (
    <section className="screen-panel bug-report-screen">
      <div className="screen-heading">
        <h2>Сообщить об ошибке</h2>
        <p>Опишите проблему в приложении. Автор, роль, завод, дата и время фиксируются автоматически.</p>
      </div>

      <div className="section-card bug-report-card">
        <div className="section-subhead">
          <span>!</span>
          <div>
            <strong>Сообщение администратору</strong>
            <p>Укажите раздел, тему и что произошло. Можно приложить фото или скриншот.</p>
          </div>
        </div>

        {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
        {resultText ? (
          <div className="empty-state success-state">
            <strong>{resultText}</strong>
          </div>
        ) : null}

        <div className="form-grid">
          <label className="field-label">
            Раздел
            <select value={section} onChange={(event) => setSection(event.target.value)}>
              {sectionOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="field-label">
            Тема
            <input
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например: не открывается заявка"
            />
          </label>
        </div>

        <label className="field-label">
          Описание
          <textarea
            maxLength={5000}
            rows={8}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Что нажали, что ожидали увидеть, что произошло. Не вставляйте пароли и секретные данные."
          />
        </label>

        <AttachmentPicker value={files} onChange={setFiles} allowFiles allowVideo disabled={busy} compact singleTrigger />
        <AttachmentUploadFeedback
          progress={uploadProgress}
          onCancel={() => uploadControllerRef.current?.abort()}
          onRetry={retryUpload}
        />

        <p className="bug-report-context-compact">
          Автор, роль ({currentRoleLabel}), завод ({selectedFactory?.name ?? 'не выбран'}), дата и время будут добавлены автоматически.
        </p>

        <div className="sticky-action-row">
          <button className="primary-button" disabled={!canSubmit} type="button" onClick={() => void submit()}>
            {busy ? 'Отправляется...' : 'Отправить администратору'}
          </button>
        </div>
      </div>

      {isAdmin ? (
        <div className="section-card bug-report-admin-card">
          <div className="section-subhead">
            <span>А</span>
            <div>
              <strong>Сообщения об ошибках</strong>
              <p>Список доступен только администратору выбранного завода.</p>
            </div>
          </div>
          <div className="admin-list bug-report-list">
            {!reports.length ? <div className="empty-state compact">Сообщений пока нет.</div> : null}
            {reports.map((report) => (
              <button className="admin-row bug-report-row" key={report.id} type="button" onClick={() => void openReport(report.id)}>
                <span>
                  <strong>{report.section} · {report.title}</strong>
                  <small>{report.authorName ?? 'Пользователь'} · {report.authorRoleLabel ?? 'роль не указана'} · {report.factoryName ?? 'завод не указан'}</small>
                </span>
                <span className={`status-pill bug-status-${report.status.toLowerCase()}`}>{report.statusLabel ?? report.status}</span>
                <span>{formatDate(report.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selectedReport ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card bug-report-detail-modal">
            <div className="modal-header">
              <div>
                <h3>{selectedReport.title}</h3>
                <p>{selectedReport.section} · {selectedReport.authorName ?? 'Пользователь'} · {formatDate(selectedReport.createdAt)}</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setSelectedReport(null)}>Закрыть окно</button>
            </div>
            <div className="bug-report-detail-body">
              <span className={`status-pill bug-status-${selectedReport.status.toLowerCase()}`}>{selectedReport.statusLabel ?? selectedReport.status}</span>
              <p>{selectedReport.description}</p>
              <AttachmentPreviewList attachments={selectedReport.attachments ?? []} showEmpty mode="grid" emptyText="Вложений нет." />
            </div>
            <div className="modal-actions">
              {statusOptions.map((item) => (
                <button
                  className={selectedReport.status === item.value ? 'primary-button' : 'secondary-button'}
                  disabled={selectedReport.status === item.value}
                  key={item.value}
                  type="button"
                  onClick={() => void updateStatus(selectedReport, item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
