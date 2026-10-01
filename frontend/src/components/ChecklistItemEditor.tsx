import React from 'react';
import { Attachment } from '../store/app.store';
import { AttachmentPicker } from './AttachmentPicker';
import { AttachmentPreviewList } from './AttachmentPreviewList';
import { createOperationId } from '../api/operation';
import { setChecklistItemActive } from './checklist-item-draft';

void React;

export type ChecklistItemDraft = {
  id?: string;
  clientKey: string;
  title: string;
  description: string;
  sortOrder: number;
  rowType: string;
  requiredAnswer: boolean;
  requiresPhoto: boolean;
  requiresComment: boolean;
  isRequired: boolean;
  isActive: boolean;
  unit: string;
  minValue: string;
  maxValue: string;
  targetValue: string;
  optionsText: string;
  referencePhoto?: Attachment | null;
  referenceFile?: File | null;
  referenceOperationId?: string;
  removeReference?: boolean;
};

const rowTypeOptions = [
  ['YES_NO', 'Да / Нет'],
  ['YES_NO_NA', 'Да / Нет / Не применимо'],
  ['TEXT', 'Текстовый ответ'],
  ['REQUIRED_COMMENT', 'Обязательный комментарий'],
  ['PHOTO', 'Фото'],
  ['REQUIRED_PHOTO', 'Обязательное фото'],
  ['NUMBER', 'Числовой параметр'],
  ['SELECT', 'Выбор из вариантов'],
  ['INFO', 'Информационный блок'],
] as const;

const unitOptions = ['', 'кг', 'г', 'мм', 'см', '°C', 'шт', '%', 'другое'];

type Props = {
  value: ChecklistItemDraft;
  onChange: (value: ChecklistItemDraft) => void;
  disabled?: boolean;
  showActive?: boolean;
};

export function ChecklistItemEditor({ value, onChange, disabled = false, showActive = false }: Props) {
  const patch = (next: Partial<ChecklistItemDraft>) => onChange({ ...value, ...next });
  const isNumber = value.rowType === 'NUMBER';
  const isSelect = value.rowType === 'SELECT';
  const isInfo = value.rowType === 'INFO';
  const isRequiredPhoto = value.rowType === 'REQUIRED_PHOTO';
  const isRequiredComment = value.rowType === 'REQUIRED_COMMENT';

  return (
    <div className="checklist-item-editor">
      <label className="field-label">Название пункта
        <input disabled={disabled} maxLength={240} onChange={(event) => patch({ title: event.target.value })} required value={value.title} />
      </label>
      <label className="field-label">Тип пункта
        <select disabled={disabled} onChange={(event) => patch({ rowType: event.target.value })} value={value.rowType}>
          {rowTypeOptions.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </select>
      </label>
      <label className="field-label">Подсказка или описание примера
        <textarea disabled={disabled} onChange={(event) => patch({ description: event.target.value })} placeholder="Коротко объясните, что нужно проверить" value={value.description} />
      </label>

      <section className="checklist-reference-editor" aria-label="Фото-эталон пункта">
        <strong>Фото-эталон (необязательно)</strong>
        <p className="line-meta">Одна фотография-пример. Не заменяет фото результата. Изменения применятся после сохранения; завершённые проверки сохранят прежний эталон.</p>
        {!value.removeReference && !value.referenceFile && value.referencePhoto ? <AttachmentPreviewList attachments={[value.referencePhoto]} mode="grid" /> : null}
        <span>{value.referencePhoto && !value.removeReference ? 'Заменить фото-эталон' : 'Загрузить фото-эталон'}</span>
        <AttachmentPicker disabled={disabled || !value.isActive} value={value.referenceFile ? [value.referenceFile] : []} onChange={(files) => patch({ referenceFile: files.at(-1) ?? null, referenceOperationId: createOperationId('checklist-reference'), removeReference: false })} />
        {!value.isActive ? <p className="field-hint">Фото отключённого пункта доступно только для просмотра. Включите пункт, чтобы изменить эталон.</p> : null}
        {value.referencePhoto || value.referenceFile ? <button className="secondary-button" type="button" disabled={disabled || !value.isActive} onClick={() => patch({ referenceFile: null, referencePhoto: null, removeReference: true })}>Убрать фото-эталон</button> : null}
      </section>

      {isNumber ? (
        <div className="checklist-item-editor-grid">
          <label className="field-label">Единица
            <select disabled={disabled} onChange={(event) => patch({ unit: event.target.value })} value={value.unit}>
              {unitOptions.map((unit) => <option key={unit || 'none'} value={unit}>{unit || 'Без единицы'}</option>)}
            </select>
          </label>
          <label className="field-label">Минимум
            <input disabled={disabled} inputMode="decimal" onChange={(event) => patch({ minValue: event.target.value })} type="number" value={value.minValue} />
          </label>
          <label className="field-label">Максимум
            <input disabled={disabled} inputMode="decimal" onChange={(event) => patch({ maxValue: event.target.value })} type="number" value={value.maxValue} />
          </label>
          <label className="field-label">Целевое значение
            <input disabled={disabled} inputMode="decimal" onChange={(event) => patch({ targetValue: event.target.value })} type="number" value={value.targetValue} />
          </label>
        </div>
      ) : null}

      {isSelect ? (
        <label className="field-label">Варианты выбора
          <textarea disabled={disabled} onChange={(event) => patch({ optionsText: event.target.value })} placeholder={'Каждый вариант с новой строки'} required value={value.optionsText} />
        </label>
      ) : null}

      <div className="checklist-item-editor-flags">
        {!isInfo ? (
          <label className="field-label checkbox-field">
            <input checked={value.requiredAnswer} disabled={disabled} onChange={(event) => patch({ requiredAnswer: event.target.checked })} type="checkbox" />
            Требовать ответ
          </label>
        ) : null}
        <label className="field-label checkbox-field">
          <input checked={value.isRequired} disabled={disabled} onChange={(event) => patch({ isRequired: event.target.checked })} type="checkbox" />
          Обязательный пункт
        </label>
        {!isRequiredComment ? (
          <label className="field-label checkbox-field">
            <input checked={value.requiresComment} disabled={disabled} onChange={(event) => patch({ requiresComment: event.target.checked })} type="checkbox" />
            Требовать комментарий
          </label>
        ) : null}
        {!isRequiredPhoto ? (
          <label className="field-label checkbox-field">
            <input checked={value.requiresPhoto} disabled={disabled} onChange={(event) => patch({ requiresPhoto: event.target.checked })} type="checkbox" />
            Требовать фото
          </label>
        ) : null}
        {showActive ? (
          <label className="field-label checkbox-field">
            <input checked={value.isActive} disabled={disabled} onChange={(event) => onChange(setChecklistItemActive(value, event.target.checked))} type="checkbox" />
            Пункт активен
          </label>
        ) : null}
      </div>
    </div>
  );
}
