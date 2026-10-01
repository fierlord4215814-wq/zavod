const fixtureTextPattern = /(Stage\d+|stage\d+|F03-AUTHORITY-\d{8,}|PILOT_[A-ZА-ЯЁ0-9_-]+|regression|fixture|simulation|browser|(?:^|[^a-z0-9])e2e(?:[^a-z0-9]|$)|autotest|auto-test|demo|recovery|test line|линия теста|тестовая линия|Операционные потери\s+\d{8,}.*линия контроля потерь|пилот[^\n\r]{0,120}\d{8,}|обязательный чек-лист без запуска\s+\d{8,})/i;
const fixtureUserPattern = /^(stage\d+|stage\d+[-_]|.*stage\d+.*|.*blocked-worker.*)$/i;
const checklistFixturePattern = /^(?:Проверка отдела мастеров|Проверка КИПиА|Контроль готовой продукции|Контроль температуры упаковки)\s+\d{13}(?:\b|[-:])/i;
const ordersFixturePattern = /^(?:Проверка остатка|Проверка ручная заявка|Проверка чужой остаток)\s+\d{13}(?:\b|$)/i;
const departmentOrdersFixturePattern = /^(?:Отделовой расходник (?:КИПиА|электриков)|Общий расходник интерфейса)\s+[a-z]{1,5}$/i;
const notificationOrdersFixturePattern = /^Проверка уведомления остатка\s+\d{13}$/i;
const legacyDepartmentOrdersFixturePattern = /^(?:Отделовой расходник (?:КИПиА|электриков)|Общий расходник UI)\s+\d{13}$/i;
const physicalFieldFixturePattern = /__PFFV(?:4|5)_[A-Za-z0-9_-]+__/i;
const physicalFieldFixtureCodePattern = /^pffv[45](?:[-_][A-Za-z0-9]+)*$/i;

const seededUserLabels: Record<string, string> = {
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
  'pilot-tech-electric-1': 'Тестовый электрик 1',
  'pilot-technolog-1': 'Тестовый технолог 1',
};

const seededUserContexts: Record<string, string> = {
  'test-admin': 'Админка',
  'test-management': 'Руководство',
  'test-master': 'Мастер',
  'test-store': 'Склад',
  'test-okk': 'ОКК',
  'test-tech-holod': 'Холодильная служба',
  'test-tech-kipia': 'КИПиА',
  'test-tech-mechanic': 'Механики',
  'contractor-lead-1': 'Бригадир',
};

const permissionLabels: Record<string, string> = {
  'admin.overview.read': 'Просмотр обзора админки',
  'admin.read': 'Просмотр админки',
  'admin.departments.manage': 'Управление отделами',
  'admin.departments.read': 'Просмотр отделов',
  'admin.factories.manage': 'Управление заводами',
  'admin.factories.read': 'Просмотр заводов',
  'admin.factory.manage': 'Управление заводами',
  'admin.lines.manage': 'Управление линиями в админке',
  'admin.lines.read': 'Просмотр линий в админке',
  'admin.users.manage': 'Управление пользователями',
  'company.members.read': 'Просмотр сотрудников фирмы',
  'company.members.manage': 'Управление сотрудниками фирмы',
  'admin.users.read': 'Просмотр пользователей',
  'admin.roles.manage': 'Управление ролями',
  'admin.roles.read': 'Просмотр ролей и прав',
  'admin.permissions.manage': 'Управление правами',
  'announcements.create': 'Создание объявлений',
  'announcements.archive.read': 'Просмотр архива объявлений',
  'announcements.manage': 'Управление объявлениями',
  'announcements.read': 'Просмотр объявлений',
  'announcements.settings.manage': 'Управление настройками объявлений',
  'announcements.settings.read': 'Просмотр настроек объявлений',
  'archive.read': 'Просмотр архива',
  'assignments.manage': 'Управление назначениями',
  'audit.read': 'Просмотр аудита',
  'checklists.archive.read': 'Просмотр архива чек-листов',
  'checklists.runs.manage': 'Управление прохождением чек-листов',
  'checklists.runs.read': 'Просмотр прохождений чек-листов',
  'checklists.runs.self': 'Прохождение своих чек-листов',
  'checklists.settings.manage': 'Управление настройками чек-листов',
  'checklists.settings.read': 'Просмотр настроек чек-листов',
  'checklists.templates.manage': 'Управление шаблонами чек-листов',
  'checklists.templates.read': 'Просмотр шаблонов чек-листов',
  'checklists.manage': 'Управление чек-листами',
  'checklists.read': 'Просмотр чек-листов',
  'chats.archive.read': 'Просмотр архива чатов',
  'chats.manage': 'Управление чатами',
  'chats.read': 'Просмотр чатов',
  'chats.access': 'Доступ к разрешённым чатам',
  'chats.settings.manage': 'Управление настройками чатов',
  'chats.settings.read': 'Просмотр настроек чатов',
  'chats.write': 'Сообщения в доступных чатах',
  'config.read': 'Просмотр конфигурации',
  'defrost.calendar.read': 'Просмотр календаря оттайки',
  'defrost.manage': 'Управление оттайкой',
  'defrost.read': 'Просмотр оттайки',
  'defrost.settings.manage': 'Управление настройками оттайки',
  'defrost.settings.read': 'Просмотр настроек оттайки',
  'factory.manage': 'Управление заводами и доступами',
  'factory.read': 'Просмотр выбранного завода',
  'lines.manage': 'Управление линиями',
  'lines.read': 'Просмотр линий',
  'notifications.read': 'Просмотр уведомлений',
  'okk.manage': 'Управление ОКК',
  'okk.read': 'Просмотр ОКК',
  'ops.audit.full': 'Полный операционный аудит',
  'ops.audit.read': 'Просмотр операционного аудита',
  'ops.events.read': 'Просмотр событий производства',
  'ops.overview.read': 'Просмотр операционного обзора',
  'ops.statistics.read': 'Просмотр операционной статистики',
  'orders.archive.read': 'Просмотр архива заказов и остатков',
  'orders.manage': 'Управление заказами и остатками',
  'orders.read': 'Просмотр заказов и остатков',
  'orders.items.manage': 'Управление позициями остатков',
  'orders.request': 'Создание заявки на пополнение',
  'orders.requests.manage': 'Управление заявками на заказ',
  'orders.restock': 'Пополнение остатков',
  'orders.settings.manage': 'Управление настройками заказов и остатков',
  'orders.settings.read': 'Просмотр настроек заказов и остатков',
  'orders.take': 'Списание остатков',
  'people.manage': 'Управление людьми',
  'people.notes.manage': 'Управление заметками профиля',
  'people.notes.read': 'Просмотр заметок профиля',
  'people.phone.read': 'Просмотр телефона сотрудника',
  'people.profile.manage': 'Управление профилем сотрудника',
  'people.profile.read': 'Просмотр профиля сотрудника',
  'people.read': 'Просмотр людей',
  'people.recommendations.manage': 'Управление рекомендациями назначений',
  'people.skills.manage': 'Управление навыками сотрудников',
  'people.skills.read': 'Просмотр навыков сотрудников',
  'returns.manage': 'Управление возвратами',
  'returns.read': 'Просмотр возвратов',
  'returns.publication.read': 'Просмотр публикаций возвратов',
  'settings.manage': 'Управление настройками',
  'shift-log.archive.read': 'Просмотр архива пересменки',
  'shift-log.comment': 'Комментарии к пересменке',
  'shift-log.create': 'Создание записей пересменки',
  'shift-log.important.manage': 'Управление важными записями пересменки',
  'shift-log.manage': 'Управление пересменкой',
  'shift-log.read': 'Просмотр пересменки',
  'shift-log.reads.read': 'Просмотр ознакомлений пересменки',
  'shift.manage': 'Управление сменой',
  'shift.contractor-lead.manage': 'Планы бригадира наёмных работников',
  'shift.current.manage': 'Управление текущей сменой',
  'shift.current.read': 'Просмотр текущей смены',
  'shift.future.manage': 'Управление планом будущей смены',
  'shift.future.read': 'Просмотр плана будущей смены',
  'shift.past.read': 'Просмотр прошлых смен',
  'shift.return.manage': 'Управление возвратом на смену',
  'shift.self.manage': 'Управление своей отметкой смены',
  'shift.self.read': 'Просмотр своей смены',
  'shift.settings.manage': 'Управление настройками смен',
  'shift.settings.read': 'Просмотр настроек смен',
  'stock.manage': 'Управление складскими журналами',
  'stock.read': 'Просмотр складских журналов',
  'tasks.comment': 'Комментарии к заявкам',
  'tasks.manage': 'Управление заявками',
  'tasks.read': 'Просмотр заявок',
  'tasks.create': 'Создание заявок',
  'tasks.done': 'Закрытие заявок',
  'tasks.escalation.manage': 'Управление эскалацией заявок',
  'tasks.read-receipts.read': 'Просмотр отметок чтения заявок',
  'tasks.redirect': 'Передача заявки',
  'tasks.settings.manage': 'Управление настройками заявок',
  'tasks.settings.read': 'Просмотр настроек заявок',
  'tasks.take': 'Взять заявку в работу',
  'users.password.reset': 'Сброс паролей',
  'users.manage': 'Управление пользователями',
  'wash.manage': 'Управление мойкой',
  'wash.read': 'Просмотр мойки',
  'wash.control.manage': 'Управление контролем мойки',
  'wash.control.create': 'Создание контроля мойки',
  'wash.issue.create': 'Создание проблем мойки',
  'wash.issue.resolve': 'Закрытие проблем мойки',
  'wash.message.create': 'Сообщения по мойке',
  'wash.okk-review.manage': 'ОКК-проверка мойки',
  'wash.okk-review.read': 'Просмотр ОКК-проверки мойки',
  'work-areas.manage': 'Управление повременщиками',
  'wash.settings.manage': 'Управление настройками мойки',
  'wash.settings.read': 'Просмотр настроек мойки',
};

const permissionGroupLabels: Record<string, string> = {
  company: 'Фирмы наёмных работников',
  admin: 'Администрирование',
  announcements: 'Объявления',
  archive: 'Архив',
  assignments: 'Назначения',
  audit: 'Аудит',
  checklists: 'Чек-листы',
  chats: 'Чаты',
  config: 'Конфигурация',
  defrost: 'Оттайка',
  factory: 'Заводы',
  lines: 'Линии',
  notifications: 'Уведомления',
  okk: 'ОКК',
  ops: 'Операционный контроль',
  orders: 'Заказы / Остатки',
  people: 'Люди',
  returns: 'Возвраты',
  settings: 'Настройки',
  'shift-log': 'Пересменка',
  shift: 'Смена',
  stock: 'Некондиция / склад',
  tasks: 'Заявки',
  users: 'Пользователи',
  wash: 'Мойка',
};

const permissionWordLabels: Record<string, string> = {
  admin: 'администрирование',
  announcements: 'объявления',
  archive: 'архив',
  assignments: 'назначения',
  attachments: 'вложения',
  audit: 'аудит',
  checklists: 'чек-листы',
  chats: 'чаты',
  control: 'контроль',
  create: 'создание',
  current: 'текущая смена',
  defrost: 'оттайка',
  departments: 'отделы',
  done: 'закрытие',
  factories: 'заводы',
  factory: 'завод',
  issue: 'проблемы',
  items: 'позиции',
  lines: 'линии',
  manage: 'управление',
  notifications: 'уведомления',
  okk: 'ОКК',
  orders: 'заказы',
  password: 'пароли',
  past: 'прошлые смены',
  people: 'люди',
  read: 'просмотр',
  redirect: 'передача',
  requests: 'заявки',
  reset: 'сброс',
  returns: 'возвраты',
  roles: 'роли',
  settings: 'настройки',
  shift: 'смена',
  stock: 'складские журналы',
  take: 'взятие в работу',
  tasks: 'заявки',
  templates: 'шаблоны',
  users: 'пользователи',
  wash: 'мойка',
  work: 'повременщики',
  areas: 'рабочие зоны',
};

const permissionDescriptionLabels: Record<string, string> = {
  'admin.overview.read': 'Разрешает видеть сводку админки и состояние выбранного завода.',
  'admin.read': 'Разрешает открыть админку без права изменять настройки.',
  'admin.factories.manage': 'Разрешает создавать, отключать и восстанавливать заводы через безопасные действия.',
  'admin.users.manage': 'Разрешает управлять доступами пользователей в контексте выбранного завода.',
  'company.members.read': 'Разрешает видеть сотрудников своей фирмы наёмных работников в выбранном заводе.',
  'company.members.manage': 'Разрешает старшему наёмных работников рассматривать заявки только своей фирмы.',
  'admin.roles.manage': 'Разрешает менять матрицу ролей и прав с предпросмотром последствий.',
  'admin.permissions.manage': 'Разрешает выдавать и снимать системные права.',
  'assignments.manage': 'Разрешает назначать и освобождать сотрудников на смене.',
  'audit.read': 'Разрешает смотреть журнал действий без секретов и технических путей.',
  'chats.manage': 'Разрешает создавать и настраивать доступные рабочие чаты.',
  'checklists.templates.manage': 'Разрешает создавать и редактировать шаблоны чек-листов.',
  'factory.manage': 'Разрешает управлять заводом и доступами в его контексте.',
  'lines.manage': 'Разрешает управлять линиями, позициями и шаблонами состава.',
  'notifications.read': 'Разрешает видеть свои и доступные по роли уведомления.',
  'ops.audit.full': 'Разрешает видеть расширенный операционный аудит в пределах доступа.',
  'orders.items.manage': 'Разрешает управлять позициями минимальных остатков.',
  'people.profile.manage': 'Разрешает редактировать профили сотрудников.',
  'people.skills.manage': 'Разрешает редактировать навыки сотрудников.',
  'shift.current.manage': 'Разрешает управлять текущей сменой и её действиями.',
  'shift.future.manage': 'Разрешает планировать следующую смену.',
  'shift.self.manage': 'Разрешает сотруднику управлять своей отметкой выхода.',
  'tasks.manage': 'Разрешает управлять заявками и их жизненным циклом.',
  'tasks.redirect': 'Разрешает передавать заявку в другой отдел с комментарием.',
  'wash.control.manage': 'Разрешает управлять контролем мойки.',
  'wash.okk-review.manage': 'Разрешает выполнять ОКК-проверку мойки.',
};

const latinTextPattern = /[A-Za-z]/;

const serviceRoles = new Set([
  'ADMIN',
  'MANAGEMENT',
  'MASTER',
  'OKK',
  'STORE',
  'TECHNOLOG',
  'TECH_HOLOD',
  'TECH_KIPIA',
  'TECH_ELECTRIC',
  'TECH_MECHANIC',
  'TECH_SANTECHNIK',
  'OTHER',
]);

const chatTitleLabels: Record<string, string> = {
  FACTORY: 'Общий чат завода',
  MANAGEMENT: 'Руководство',
};

export function isPilotFixtureText(...values: Array<unknown>) {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => fixtureTextPattern.test(value) || checklistFixturePattern.test(value) || ordersFixturePattern.test(value) || departmentOrdersFixturePattern.test(value) || notificationOrdersFixturePattern.test(value) || legacyDepartmentOrdersFixturePattern.test(value) || physicalFieldFixturePattern.test(value) || physicalFieldFixtureCodePattern.test(value.trim()));
}

export function diagnosticDisplayText(value: unknown, fallback = 'Диагностическая запись') {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  const normalized = text
    .replace(new RegExp(physicalFieldFixturePattern.source, 'gi'), 'Диагностическая проверка')
    .replace(/(^|\s)pffv[45](?:[-_][A-Za-z0-9]+)+(?=\s|$)/gi, '$1Диагностическая проверка')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return normalized || fallback;
}

export function shouldHidePilotFixtures() {
  if (typeof window === 'undefined') return true;
  return !/[?&]stage(?:44|50)User=/.test(window.location.search);
}

export function isPilotFixtureUser(userId?: string | null, displayName?: string | null) {
  return fixtureUserPattern.test(userId ?? '') || isPilotFixtureText(displayName);
}

export function pilotUserName(userId?: string | null, displayName?: string | null) {
  if (displayName && displayName !== userId && !isPilotFixtureText(displayName)) return displayName;
  if (userId && seededUserLabels[userId]) return seededUserLabels[userId];
  const worker = userId?.match(/^worker-(\d+)$/i);
  if (worker) return `Работник ${worker[1]}`;
  const contractor = userId?.match(/^contractor-(\d+)$/i);
  if (contractor) return `Наёмный работник ${contractor[1]}`;
  const pilotWorker = userId?.match(/^pilot-worker-(\d+)$/i);
  if (pilotWorker) return `Тестовый работник ${pilotWorker[1]}`;
  const pilotContractor = userId?.match(/^pilot-contractor-(\d+)$/i);
  if (pilotContractor) return `Тестовый наёмный ${pilotContractor[1]}`;
  return displayName || userId || 'Сотрудник';
}

export function shortPersonName(userId?: string | null, displayName?: string | null) {
  const full = pilotUserName(userId, displayName).trim().replace(/\s+/g, ' ');
  if (/^Тестовый\s+/i.test(full)) return full;
  if (/^Пользователь\s+\+?\d{1,3}\s+\*{2,}\s+\*{2,}-\d{2}-\d{2}$/u.test(full)) return full;
  const parts = full.split(' ').filter(Boolean);
  if (parts.length >= 3) return `${parts[0]} ${parts[1][0]}. ${parts[2][0]}.`;
  if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
  return full;
}

export function compactDistinctLabels(...values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value ?? '').trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLocaleLowerCase('ru-RU');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' · ');
}

export function personInitials(userId?: string | null, displayName?: string | null) {
  const name = pilotUserName(userId, displayName).trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'С';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function pilotUserContext(userId?: string | null, fallback?: string | null) {
  if (fallback) return fallback;
  if (userId && seededUserContexts[userId]) return seededUserContexts[userId];
  const worker = userId?.match(/^worker-/i);
  if (worker) return 'Производство';
  const contractor = userId?.match(/^contractor-/i);
  if (contractor) return 'Наёмные';
  return '';
}

export function isAssignableRole(role?: string | null) {
  return role === 'WORKER' || role === 'CONTRACTOR';
}

export function isServiceRole(role?: string | null) {
  return Boolean(role && serviceRoles.has(role));
}

export function pilotChatTitle(title?: string | null, type?: string | null, departmentName?: string | null) {
  const raw = title?.trim() || '';
  if (isPilotFixtureText(raw)) return '';
  if (type === 'FACTORY') return chatTitleLabels.FACTORY;
  if (type === 'MANAGEMENT') return chatTitleLabels.MANAGEMENT;
  if (departmentName) return departmentName;
  return raw
    .replace(/^Чат отдела:\s*/i, '')
    .replace(/^(.+)\1+$/u, '$1')
    .trim() || 'Рабочий чат';
}

export function permissionLabel(code: string) {
  if (permissionLabels[code]) return permissionLabels[code];
  const translated = code
    .split(/[.\-_]/g)
    .filter(Boolean)
    .map((part) => permissionWordLabels[part] ?? part)
    .join(' ');
  if (latinTextPattern.test(translated)) return 'Системное право без русского названия';
  return translated.charAt(0).toLocaleUpperCase('ru-RU') + translated.slice(1);
}

export function permissionGroupLabel(group: string) {
  return permissionGroupLabels[group] ?? 'Системные права';
}

export function permissionDescriptionLabel(code: string, group?: string | null, description?: string | null) {
  if (permissionDescriptionLabels[code]) return permissionDescriptionLabels[code];
  if (description && !latinTextPattern.test(description) && !/[a-z]{2,}\.[a-z]{2,}/i.test(description)) return description;
  return `Доступ к разделу «${permissionGroupLabel(group ?? '')}». Технический код доступен только в расширенном режиме.`;
}
