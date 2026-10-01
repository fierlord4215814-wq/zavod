import { hasPhysicalFieldFixtureMarker } from './pilot-visibility';

export type DataHygieneGroup =
  | 'test-records'
  | 'broken-names'
  | 'dirty-stock'
  | 'old-disabled'
  | 'hidden-runtime'
  | 'incomplete-config';

export type DataHygieneReason = {
  group: DataHygieneGroup;
  label: string;
};

const STAGE_OR_TEST_RE = /(stage\s*\d+|stage\d+|regression|browser|e2e|demo|test-fixture|fixture|simulation|autotest|auto-test)/i;
// Retained names emitted by role-hierarchy-delegation-regression.js.
const HIERARCHY_FIXTURE_RE = /^Stage hierarchy(?: (?:lead|worker|foreign parent))? [a-z0-9]{8,}$/i;
const MOJIBAKE_RE = /(\?{3,}|�|пїЅ|Ð|Гђ|Рџ|Р Сџ|Р |РЎ|Рќ|Рљ|Рћ|Р‘|Р“|Р”|Р•|Р–|Р—|Р™|Р›|Рњ|Рў|РЈ|Р¤|РҐ|Р¦|Р§|РЁ|Р©|СЊ|С‹|СЌ|СЋ|СЏ|вЂ|РІС)/;
const GARBAGE_ONLY_RE = /^[\s?._\-—–:;,'"()[\]{}<>/\\|]+$/;
const DIRTY_STOCK_NAMES = new Set(['апра']);

export const DATA_HYGIENE_ALLOWED_UNITS = ['шт', 'кг', 'г', 'м', 'см', 'л', 'мл', 'упак.', 'короб', 'рулон', 'пара'];
export const DATA_HYGIENE_INTEGER_UNITS = new Set(['шт', 'короб', 'пара', 'упак.', 'рулон']);

function strings(values: Array<unknown>) {
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim());
}

export function hasStageOrTestMarker(...values: Array<unknown>) {
  return strings(values).some((value) => STAGE_OR_TEST_RE.test(value) || HIERARCHY_FIXTURE_RE.test(value));
}

export function hasBrokenVisibleName(...values: Array<unknown>) {
  return strings(values).some((value) => {
    if (!value) return true;
    if (MOJIBAKE_RE.test(value)) return true;
    return GARBAGE_ONLY_RE.test(value);
  });
}

export function dataHygieneReasons(input: {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  description?: unknown;
  unit?: unknown;
  quantities?: Array<unknown>;
  disabled?: boolean;
  hiddenFromRuntime?: boolean;
  incompleteConfig?: boolean;
}) {
  const reasons: DataHygieneReason[] = [];
  const textValues = [input.id, input.title, input.name, input.description];
  if (input.unit !== undefined || input.quantities?.length) {
    const stockReason = dirtyStockReason(input);
    if (stockReason) reasons.push({ group: 'dirty-stock', label: stockReason });
  }
  if (hasStageOrTestMarker(...textValues) || hasPhysicalFieldFixtureMarker(...textValues)) {
    reasons.push({ group: 'test-records', label: 'Обнаружена отметка диагностической проверки.' });
  }
  if (hasBrokenVisibleName(input.title, input.name)) {
    reasons.push({ group: 'broken-names', label: 'Похоже на битое или нечитаемое название.' });
  }
  if (input.disabled && reasons.length) {
    reasons.push({ group: 'old-disabled', label: 'Отключённая запись требует проверки перед восстановлением.' });
  }
  if (input.hiddenFromRuntime) {
    reasons.push({ group: 'hidden-runtime', label: 'Скрыто из обычных рабочих списков.' });
  }
  if (input.incompleteConfig) {
    reasons.push({ group: 'incomplete-config', label: 'Неполная конфигурация выбранного завода.' });
  }
  return dedupeReasons(reasons);
}

export function dirtyStockReason(input: { id?: unknown; name?: unknown; description?: unknown; unit?: unknown; quantities?: Array<unknown> }) {
  const name = String(input.name ?? '').trim().toLocaleLowerCase('ru-RU');
  const unit = String(input.unit ?? '').trim();
  if (hasStageOrTestMarker(input.id, input.name, input.description)) return 'Складская запись имеет диагностическую отметку.';
  if (hasBrokenVisibleName(input.name)) return 'Складская запись содержит битое название.';
  if (DIRTY_STOCK_NAMES.has(name)) return 'Название похоже на старую ручную/demo запись.';
  if (!unit) return 'Не указана единица измерения.';
  if (!DATA_HYGIENE_ALLOWED_UNITS.includes(unit)) return 'Единица измерения не входит в разрешённый список.';
  if (/\d/.test(unit)) return 'В единице измерения есть число, похоже на старую ошибку ввода.';
  if (DATA_HYGIENE_INTEGER_UNITS.has(unit)) {
    const fractional = (input.quantities ?? []).some((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && !Number.isInteger(numeric);
    });
    if (fractional) return `Для единицы "${unit}" найдено дробное количество.`;
  }
  return null;
}

export function primaryDataHygieneGroup(reasons: DataHygieneReason[]): DataHygieneGroup {
  return reasons[0]?.group ?? 'hidden-runtime';
}

export function dataHygieneGroupLabel(group: DataHygieneGroup) {
  const labels: Record<DataHygieneGroup, string> = {
    'test-records': 'Тестовые записи',
    'broken-names': 'Битые названия',
    'dirty-stock': 'Грязные остатки',
    'old-disabled': 'Старые отключённые записи',
    'hidden-runtime': 'Скрыто из рабочих списков',
    'incomplete-config': 'Неполные конфигурации',
  };
  return labels[group];
}

function dedupeReasons(reasons: DataHygieneReason[]) {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.group}:${reason.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
