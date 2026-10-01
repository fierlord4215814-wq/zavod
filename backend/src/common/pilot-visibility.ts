import { maskPhone } from './password';

const STAGE_MARKER_RE = /stage(?:\d+(?:[-.\s_][A-Za-z0-9А-Яа-яёЁ]+)?|[-_\s][A-Za-z0-9А-Яа-яёЁ_-]+)/i;
const PHYSICAL_FIELD_FIXTURE_RE = /__PFFV(?:4|5)_[A-Za-z0-9_-]+__/i;
const PHYSICAL_FIELD_FIXTURE_CODE_RE = /^pffv[45](?:[-_][A-Za-z0-9]+)*$/i;
const TECHNICAL_FIXTURE_RE = /(regression|fixture|simulation|browser|e2e|autotest|auto-test|demo|recovery|pilot-smoke)/i;
const TEST_LINE_RE = /(test line|линия теста|тестовая линия|Проверочная (?:рабочая линия|линия (?:мойки|оттайки))\s+\d{13}|Операционные потери\s+\d+:\s*линия контроля потерь)/i;
const VERIFIED_PILOT_FIXTURE_RE = /(?:^|\b)(?:PILOT(?:[_ -][A-ZА-ЯЁ0-9_-]+)|Пилот department-first\s+\d{13}|Integrity control\s+\d+|Operational cycle\s+\d+|Проверка простоя\s+\d+|(?:Контроль|Проверка доступа) мойки\s+\d{10,})(?:\b|$)/i;

const RUNTIME_FIXTURE_RE = /(smoke|diagnostic|quality cross factory)/i;
const RUNTIME_OPERATION_FIXTURE_RE = /(?:^|[_-])realtime-v1(?:[_-]|$)/i;
const CHECKLIST_FIXTURE_RE = /^(?:Проверка отдела мастеров|Проверка КИПиА|Контроль готовой продукции|Контроль температуры упаковки|Температура перед выпуском)\s+\d{13}(?:\b|[-:])|^Отделовой контроль UI \d{13}$/i;
const ERROR_REPORT_EXPORT_FIXTURE_RE = /^Проверка файловой копии\s+error-report-export-\d{13}$/i;
const FACTORY_FIXTURE_CODE_RE = /^(?:pilot-access-lifecycle-v1|quality-cross-factory|security-privacy-v1-factory|shock-blow-other-factory|line-effective-time-other|(?:handover(?:-browser)?|line-timeline(?:-other)?|timeline-e2e|history)-\d{13}-[a-z0-9]+|checklist-workflow-\d{13}|pilot-route-lines-wash-defrost-\d{13}|stage15-defrost-\d{13})$/i;
const USER_FIXTURE_RE = /^(stage\d+|stage\d+[-_].*|stage[-_].*|.*stage\d+.*|.*blocked-worker.*|recovery-.*|realtime-v1-.*|push-v1-.*|shock-blow-.*|checklist-(?:periodic|workflow|department).+|pilot-pack-.+-(?:source|target))$/i;
const DIAGNOSTIC_ACTOR_RE = /^test(?:-|$)/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SEEDED_USER_LABELS: Record<string, string> = {
  'test-admin': 'Администратор',
  'test-management': 'Руководитель',
  'test-master': 'Мастер',
  'test-store': 'Кладовщик',
  'test-okk': 'ОКК',
  'test-tech-holod': 'Холодильная служба',
  'test-tech-kipia': 'КИПиА',
  'test-tech-mechanic': 'Механик',
  'contractor-lead-1': 'Бригадир наёмных работников',
  'pilot-worker-1': 'Тестовый работник 1',
  'pilot-worker-2': 'Тестовый работник 2',
  'pilot-worker-3': 'Тестовый работник 3',
  'pilot-contractor-1': 'Тестовый наёмный 1',
  'pilot-contractor-2': 'Тестовый наёмный 2',
  'pilot-master-1': 'Тестовый мастер 1',
  'pilot-okk-1': 'Тестовый ОКК 1',
  'pilot-store-1': 'Тестовый кладовщик 1',
  'pilot-tech-kipia-1': 'Тестовый КИПиА 1',
  'pilot-tech-holod-1': 'Тестовый холодильщик 1',
  'pilot-technolog-1': 'Тестовый технолог 1',
  'pilot-tech-electric-1': 'Тестовый электрик 1',
};

const PILOT_PACK_USER_LABELS: Record<string, string> = {
  'pilot-pack-guest': 'PILOT Гость Громов Г. Г.',
  'pilot-pack-senior-master': 'PILOT Старший мастер Беляев Б. С.',
  'pilot-pack-kipia-lead': 'PILOT Начальник КИПиА Захаров З. К.',
  'pilot-pack-management': 'PILOT Руководитель Алексеева А. Р.',
  'pilot-pack-admin': 'PILOT Администратор Романов Р. А.',
  'pilot-pack-test-lead': 'PILOT Руководитель тестового отдела',
  'pilot-pack-test-specialist': 'PILOT Специалист тестового отдела',
  'pilot-pack-master-source': 'PILOT Мастер-образец для назначения',
  'pilot-pack-guest-worker-target': 'PILOT Гость для назначения Работником',
  'pilot-pack-guest-contractor-target': 'PILOT Гость для назначения Подрядчиком',
  'pilot-pack-guest-master-target': 'PILOT Гость для назначения Мастером',
  'pilot-pack-guest-kipia-target': 'PILOT Гость для назначения КИПиА',
  'pilot-pack-guest-test-target': 'PILOT Гость для тестового отдела',
  'pilot-pack-worker-source': 'PILOT Работник-образец для назначения',
  'pilot-pack-contractor-source': 'PILOT Подрядчик-образец для назначения',
  'mobile-contractor-lead': 'Бригадир подрядчиков',
  'mobile-technolog': 'Технолог',
  'mobile-other-specialist': 'Специалист',
  'mobile-tech-mechanic': 'Механик',
  'mobile-tech-electric': 'Электрик',
  'mobile-tech-holod': 'Холодильщик',
  'mobile-tech-santechnik': 'Сантехник',
};

function hasExactAnnouncementFixture(values: Array<unknown>) {
  // Documented title AND body pairs, not a timestamp/title heuristic.
  // stage24-announcements; physical-field-fixes-v5-plast17c-existing-realtime.
  const pairs: Array<[RegExp, string]> = [
    [/^Проверка объявления завода \d{13}$/, 'Активное объявление для всего завода в служебной проверке.'],
    [/^Проверка объявления отдела \d{13}$/, 'Объявление для отдела руководства в служебной проверке.'],
    [/^Плановое уведомление \d{13}$/, 'Проверка адресного realtime без раскрытия содержимого.'],
  ];
  return pairs.some(([title, body]) => values.includes(body) && values.some(value => typeof value === 'string' && title.test(value)));
}

function hasExactCompanyFixture(value: string) {
  // pilot-pack-v1 canonical company; Cyrillic word-boundary is not reliable here.
  if (value === 'PILOT Фирма наёмных работников v1.0') return true;
  // pilot-fix-plast3: Date.now().toString(36), bounded timestamp shape.
  const match = value.match(/^Временная фирма [АБ] ([a-z0-9]{8,9})$/);
  if (!match) return false;
  const timestamp = Number.parseInt(match[1], 36);
  return timestamp >= Date.UTC(2000, 0, 1) && timestamp < Date.UTC(2100, 0, 1) && timestamp.toString(36) === match[1];
}

export function hasPilotFixtureMarker(...values: Array<unknown>) {
  return hasExactAnnouncementFixture(values) || values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value) => !UUID_RE.test(value.trim()))
    .some((value) => STAGE_MARKER_RE.test(value)
      || TECHNICAL_FIXTURE_RE.test(value)
      || TEST_LINE_RE.test(value)
      || VERIFIED_PILOT_FIXTURE_RE.test(value)
      || RUNTIME_FIXTURE_RE.test(value)
      || CHECKLIST_FIXTURE_RE.test(value)
      || ERROR_REPORT_EXPORT_FIXTURE_RE.test(value)
      || FACTORY_FIXTURE_CODE_RE.test(value.trim())
      // Exact existing scheduler-boundary and multi-factory-tech generator codes.
      || /^scheduler-(?:граница|изоляция|конкурентность|защита)-\d{13}-[a-f0-9]{6}$/i.test(value)
      || /^mf-service-[abcd]$/.test(value)
      || hasExactCompanyFixture(value)
      || hasPhysicalFieldFixtureMarker(value));
}

export function hasPhysicalFieldFixtureMarker(...values: Array<unknown>) {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => PHYSICAL_FIELD_FIXTURE_RE.test(value) || PHYSICAL_FIELD_FIXTURE_CODE_RE.test(value.trim()));
}

export function hasRuntimeFixtureMarker(...values: Array<unknown>) {
  return hasPilotFixtureMarker(...values)
    || hasPhysicalFieldFixtureMarker(...values)
    || values
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .some((value) => RUNTIME_OPERATION_FIXTURE_RE.test(value));
}

export function isRuntimeVisibleTask(task: {
  id?: string | null;
  createdById?: string | null;
  operationId?: string | null;
  description?: string | null;
  lineId?: string | null;
  line?: { id?: string | null; name?: string | null } | null;
  comments?: Array<{ message?: string | null }> | null;
}) {
  if (isDiagnosticFixtureActor(task.createdById)) return false;
  return !hasRuntimeFixtureMarker(
    task.id,
    task.operationId,
    task.description,
    task.lineId,
    task.line?.id,
    task.line?.name,
    ...((task.comments ?? []).map((comment) => comment.message)),
  );
}

export function isRuntimeVisibleShiftLog(log: {
  id?: string | null;
  createdById?: string | null;
  title?: string | null;
  text?: string | null;
}) {
  if (isDiagnosticFixtureActor(log.createdById)) return false;
  // Exact stage14 regression payload + documented fixture author, not a title heuristic.
  // Keep the persisted archive and unrelated human-authored pilot records intact.
  if (isDocumentedPilotTestActor(log.createdById) && (
    (log.title === 'Проверка пересменки' && log.text === 'Line handover note') ||
    (log.title === 'Проверка пересменки обновлена' && log.text === 'Line handover note updated')
  )) return false;
  return !hasRuntimeFixtureMarker(log.id, log.title, log.text);
}

export function isPilotVisibleLine(line: { id?: string | null; name?: string | null; deletedAt?: Date | string | null; deactivatedAt?: Date | string | null; isActive?: boolean | null }) {
  if (line.deletedAt) return false;
  if (line.deactivatedAt) return false;
  if (line.isActive === false) return false;
  return !hasPilotFixtureMarker(line.id, line.name);
}

export function normalizePilotLineName(name?: string | null) {
  return (name ?? '')
    .trim()
    .replace(/^линия\s+/i, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU');
}

export function dedupePilotLines<T extends { name?: string | null }>(lines: T[]) {
  const byName = new Map<string, T>();
  for (const line of lines) {
    const key = normalizePilotLineName(line.name);
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing || String(existing.name ?? '').toLocaleLowerCase('ru-RU').startsWith('линия ')) {
      byName.set(key, line);
    }
  }
  return Array.from(byName.values());
}

export function isPilotFixtureUser(user: { id?: string | null; userId?: string | null; displayName?: string | null } | string | null | undefined) {
  const id = typeof user === 'string' ? user : user?.id ?? user?.userId ?? '';
  const displayName = typeof user === 'string' ? '' : user?.displayName ?? '';
  return USER_FIXTURE_RE.test(id) || STAGE_MARKER_RE.test(displayName);
}

export function isDiagnosticFixtureActor(user: { id?: string | null; userId?: string | null; displayName?: string | null } | string | null | undefined) {
  const id = typeof user === 'string' ? user : user?.id ?? user?.userId ?? '';
  return DIAGNOSTIC_ACTOR_RE.test(id) || isPilotFixtureUser(user);
}

export function isDocumentedPilotTestActor(user: { id?: string | null; userId?: string | null } | string | null | undefined) {
  const id = typeof user === 'string' ? user : user?.id ?? user?.userId ?? '';
  return (id.startsWith('pilot-') && Object.prototype.hasOwnProperty.call(SEEDED_USER_LABELS, id))
    || (id.startsWith('pilot-pack-') && Object.prototype.hasOwnProperty.call(PILOT_PACK_USER_LABELS, id));
}

export function isRuntimeVisibleWashSession(session: {
  id?: string | null;
  startedById?: string | null;
  lineId?: string | null;
  lineName?: string | null;
  objectName?: string | null;
  objectDescription?: string | null;
  line?: { id?: string | null; name?: string | null } | null;
}) {
  if (isDiagnosticFixtureActor(session.startedById)) return false;
  return !hasPilotFixtureMarker(
    session.id,
    session.lineId,
    session.lineName,
    session.line?.id,
    session.line?.name,
    session.objectName,
    session.objectDescription,
  );
}

export function pilotDisplayName(user: {
  id?: string | null;
  userId?: string | null;
  displayName?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  phone?: string | null;
  normalizedPhone?: string | null;
} | string | null | undefined) {
  const id = typeof user === 'string' ? user : user?.id ?? user?.userId ?? '';
  const canonicalName = typeof user === 'string'
    ? ''
    : [user?.lastName, user?.firstName, user?.middleName]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join(' ');
  if (canonicalName) return canonicalName;
  const explicit = typeof user === 'string' ? '' : user?.displayName ?? '';
  if (explicit && !isPilotFixtureUser({ id, displayName: explicit }) && explicit !== id) return explicit;
  if (PILOT_PACK_USER_LABELS[id]) return PILOT_PACK_USER_LABELS[id];
  if (SEEDED_USER_LABELS[id]) return SEEDED_USER_LABELS[id];
  const worker = id.match(/^worker-(\d+)$/i);
  if (worker) return `Работник ${worker[1]}`;
  const contractor = id.match(/^contractor-(\d+)$/i);
  if (contractor) return `Наёмный работник ${contractor[1]}`;
  const pilotWorker = id.match(/^pilot-worker-(\d+)$/i);
  if (pilotWorker) return `Тестовый работник ${pilotWorker[1]}`;
  const pilotContractor = id.match(/^pilot-contractor-(\d+)$/i);
  if (pilotContractor) return `Тестовый наёмный ${pilotContractor[1]}`;
  const phone = typeof user === 'string' ? '' : user?.normalizedPhone ?? user?.phone ?? '';
  if (UUID_RE.test(id) && phone) return `Пользователь ${maskPhone(phone)}`;
  if (UUID_RE.test(id)) return 'Сотрудник';
  return id || 'Сотрудник';
}
