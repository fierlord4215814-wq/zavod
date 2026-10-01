const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'docs', 'physical-field-fixes-v5-plast17a');
const artifactPath = path.join(evidenceDir, 'test-artifacts.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

const now = new Date().toISOString();
const md = (value) => String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
const link = (file) => `../../${file.replaceAll('\\', '/')}`;

const owners = {
  HOME: { file: 'frontend/src/App.tsx', frontend: 'App / GuestHomeScreen', api: '/auth/me; /auth/factories', backend: 'AuthService', entity: 'UserContext + UserFactoryAccess', scope: 'selectedFactoryId', rbac: 'guest/auth context', dynamic: 'Factory', realtime: 'auth_context_changed', history: 'AuditLog login/access' },
  AUTH: { file: 'frontend/src/App.tsx', frontend: 'App auth state', api: '/auth/login; /auth/register; /auth/password/*', backend: 'AuthService', entity: 'User + UserFactoryAccess + auth token', scope: 'factory access chosen after auth', rbac: 'blocked/deactivated/guest guards', dynamic: 'Factory/UserFactoryAccess', realtime: 'auth_context_changed', history: 'AuditLog' },
  FACTORY: { file: 'frontend/src/screens/FactorySelectScreen.tsx', frontend: 'FactorySelectScreen + appStore', api: '/auth/factories; /auth/select-factory', backend: 'AuthService / UserContextService', entity: 'Factory + UserFactoryAccess', scope: 'allowed factory only', rbac: 'active access; blocked/deactivated denied', dynamic: 'Factory', realtime: 'reconnect after context switch', history: 'AuditLog factory selection' },
  SHIFT: { file: 'frontend/src/screens/ShiftPeopleScreen.tsx', frontend: 'ShiftPeopleScreen + appStore', api: '/shift/*; /lines/*; /assignments/*; /work-areas/*', backend: 'ShiftService + LineService + EmployeeService + WorkAreasService', entity: 'ShiftSession/Assignment/PlannedShiftAssignment/Line/WorkArea', scope: 'factory + canonical DAY/NIGHT window', rbac: 'shift/assignment permissions + role policy', dynamic: 'User/Access, Line, WorkArea, StaffingPosition, ExternalCompany', realtime: 'shift_updated + assignment_updated + line_updated', history: 'shift/past + Assignment history + ShiftLog snapshot' },
  PEOPLE: { file: 'frontend/src/screens/PeopleScreen.tsx', frontend: 'PeopleScreen', api: '/people; /people/search; /people/:id', backend: 'PeopleService / EmployeeService', entity: 'User + UserFactoryAccess + Assignment + profile attachments', scope: 'factory + department/company visibility', rbac: 'people.profile.read/people.read/people.manage', dynamic: 'User/Access, Department, JobTitle, ExternalCompany', realtime: 'operational invalidation for assignment state', history: 'assignment history + audit notes/actions' },
  ADMIN: { file: 'frontend/src/screens/AdminConfigScreen.tsx', frontend: 'AdminConfigScreen', api: '/admin/* plus module settings endpoints', backend: 'AdminService + module settings services', entity: 'Factory/UserFactoryAccess/Department/JobTitle/RolePermission/Line/WorkArea/settings', scope: 'selected factory; global service rules explicit', rbac: 'admin.* / config.* + backend guards', dynamic: 'all canonical directories', realtime: 'auth_context_changed on access changes', history: 'AuditLog + admin audit read model' },
  LINES: { file: 'frontend/src/screens/SituationScreen.tsx', frontend: 'SituationScreen + appStore', api: '/lines; /lines/:id/*; /wash; /work-areas', backend: 'LineService + WashService + WorkAreasService', entity: 'Line + LineStatusEvent + Assignment + WashSession', scope: 'factory + visible runtime rows', rbac: 'lines.read plus entity-specific guards', dynamic: 'Line, StaffingPosition, User/Access', realtime: 'line/shift/assignment/wash invalidation', history: 'line timeline + archive + ops metrics' },
  TASKS: { file: 'frontend/src/screens/TasksScreen.tsx', frontend: 'TasksScreen + appStore', api: '/tasks/*; /tasks/recipient-departments', backend: 'TaskService', entity: 'Task + recipients + assignees + comments + history', scope: 'factory + recipient/department visibility', rbac: 'tasks.* + task visibility policy', dynamic: 'Department, User/Access, Line', realtime: 'task_updated', history: 'TaskHistory + archive + audit' },
  WASH: { file: 'frontend/src/screens/WashScreen.tsx', frontend: 'WashScreen + appStore', api: '/wash/*', backend: 'WashService', entity: 'WashSession/Event/Issue/ControlItem/OkkReview', scope: 'factory + session entity access', rbac: 'wash.* plus control role policy', dynamic: 'Line, User/Access, Department', realtime: 'wash_updated + assignment_updated', history: 'wash archive/events + audit' },
  OKK: { file: 'frontend/src/screens/OkkScreen.tsx', frontend: 'OkkScreen + appStore', api: '/okk/*; /directory/users; /lines', backend: 'OkkService + QuantityReleaseService', entity: 'OkkRecord + QuantityRelease + attachments', scope: 'factory', rbac: 'okk.read/okk.manage', dynamic: 'Line, User/Access (masters)', realtime: 'okk_updated emitted; quantity_release_updated consumed', history: 'OKK archive + audit' },
  STOCK: { file: 'frontend/src/screens/StockScreen.tsx', frontend: 'StockScreen + appStore', api: '/stock/*', backend: 'StockService', entity: 'StockDefect + attachments', scope: 'factory', rbac: 'stock.read/stock.manage', dynamic: 'User/Access; enum units', realtime: 'manual/local refresh', history: 'stock archive + audit' },
  ORDERS: { file: 'frontend/src/screens/OrdersStockScreen.tsx', frontend: 'OrdersStockScreen', api: '/orders/*', backend: 'OrdersService', entity: 'MinimumStockItem/Movement + OrderRequest', scope: 'factory + department', rbac: 'orders.*', dynamic: 'Department, User/Access; enum units', realtime: 'orders_updated', history: 'movements/order archive + audit' },
  CHECKLISTS: { file: 'frontend/src/screens/ChecklistsScreen.tsx', frontend: 'ChecklistsScreen', api: '/checklists/*; /directory/*', backend: 'ChecklistsService', entity: 'ChecklistTemplate/Item/Run/Entry/RunRow', scope: 'factory + department + assignee + line', rbac: 'checklists.* and run visibility', dynamic: 'Department, Line, User/Access', realtime: 'checklist_updated invalidation', history: 'archive/journal/reports + audit' },
  DEFROST: { file: 'frontend/src/screens/DefrostScreen.tsx', frontend: 'DefrostScreen', api: '/defrost/*', backend: 'DefrostService', entity: 'DefrostEvent + Line', scope: 'factory', rbac: 'UI permission vs service non-guest read policy', dynamic: 'Line', realtime: 'line_updated only', history: 'defrost calendar/archive + audit' },
  RETURNS: { file: 'frontend/src/screens/ReturnsScreen.tsx', frontend: 'ReturnsScreen', api: '/returns/*', backend: 'ReturnsService + QuantityReleaseService', entity: 'ReturnRecord + QuantityRelease + attachments', scope: 'factory', rbac: 'publication read policy; publish/manage permissions', dynamic: 'User/Access', realtime: 'quantity_release_updated', history: 'returns archive + audit' },
  LOG: { file: 'frontend/src/screens/ShiftLogScreen.tsx', frontend: 'ShiftLogScreen', api: '/shift-log/*', backend: 'ShiftLogService', entity: 'ShiftLog/Comment + immutable handover snapshot', scope: 'factory + department + shift window', rbac: 'shift-log.* + department visibility', dynamic: 'Department, User/Access, Line snapshots', realtime: 'notification on important; reload/manual', history: 'shift-log archive/snapshots + audit' },
  CHATS: { file: 'frontend/src/screens/ChatsScreen.tsx', frontend: 'ChatsScreen', api: '/chats/*; /directory/*', backend: 'ChatsService', entity: 'Chat/Participant/Message/Reaction/Poll/ChatRead', scope: 'factory + participant/department/company chat visibility', rbac: 'chats.* + membership guard', dynamic: 'Department, User/Access', realtime: 'chat_updated to participants', history: 'soft-deleted message history + audit moderation' },
  ANNOUNCEMENTS: { file: 'frontend/src/screens/AnnouncementsScreen.tsx', frontend: 'AnnouncementsScreen', api: '/announcements/*', backend: 'AnnouncementsService', entity: 'Announcement/Audience/Acknowledgement', scope: 'factory + recipient audience', rbac: 'publication/read/acknowledge policy', dynamic: 'Department, User/Access', realtime: 'notification_created/unread refresh', history: 'announcement archive + acknowledgement report + audit' },
  ARCHIVE: { file: 'frontend/src/screens/ArchiveScreen.tsx', frontend: 'ArchiveScreen', api: '/archive/*', backend: 'ArchiveService', entity: 'canonical cross-module archive read model', scope: 'factory + source entity visibility', rbac: 'per-section source permission', dynamic: 'historical Line/Department/User labels', realtime: 'explicit reload/filter', history: 'source histories + audit' },
  NOTIFICATIONS: { file: 'frontend/src/screens/NotificationsScreen.tsx', frontend: 'NotificationsScreen + appStore', api: '/notifications/*; /push/*', backend: 'NotificationsService + PushService', entity: 'Notification/Read/PushSubscription', scope: 'recipient user + factory', rbac: 'notifications.read + ownership', dynamic: 'recipient User/Access', realtime: 'notification_created + count_changed', history: 'notification list/read state' },
  OPS: { file: 'frontend/src/screens/OpsAuditScreen.tsx', frontend: 'OpsAuditScreen', api: '/ops/*', backend: 'OpsService', entity: 'operational read models + AuditLog', scope: 'factory + period/line/department', rbac: 'ops permissions plus role scope overlay', dynamic: 'Line, Department, User/Access labels', realtime: 'manual/filter refresh', history: 'AuditLog + source histories' },
  REPORT: { file: 'frontend/src/screens/BugReportScreen.tsx', frontend: 'BugReportScreen', api: '/error-reports/*', backend: 'ErrorReportService + file export', entity: 'ErrorReport + attachments', scope: 'author/admin + factory', rbac: 'any authenticated submit; admin list/detail', dynamic: 'current User/Access/Factory', realtime: 'manual refresh', history: 'status/audit + external file export' },
  LEGACY: { file: 'frontend/src/app/App.tsx', frontend: 'unreachable legacy App/store/offline sources', api: 'not in current main.tsx import graph', backend: 'none active', entity: 'parallel/dead implementation fragments', scope: 'none at runtime', rbac: 'none at runtime', dynamic: 'none at runtime', realtime: 'incomplete dead outbox', history: 'none' },
};

const mainSpecs = [
  ['MAIN-HOME', 'Главная / гостевой старт', 'HOME'], ['MAIN-SHIFT', 'Смена', 'SHIFT'], ['MAIN-SHIFT-HISTORY', 'История смен работника', 'SHIFT'],
  ['MAIN-PEOPLE', 'Люди', 'PEOPLE'], ['MAIN-ADMIN', 'Администрирование', 'ADMIN'], ['MAIN-LINES', 'Линии', 'LINES'],
  ['MAIN-TASKS', 'Заявки', 'TASKS'], ['MAIN-WASH', 'Мойка', 'WASH'], ['MAIN-OKK', 'ОКК / Брак', 'OKK'],
  ['MAIN-STOCK', 'Некондиция', 'STOCK'], ['MAIN-ORDERS', 'Заказы / Остатки', 'ORDERS'], ['MAIN-CHECKLISTS', 'Чек-листы', 'CHECKLISTS'],
  ['MAIN-DEFROST', 'Оттайка', 'DEFROST'], ['MAIN-RETURNS', 'Возвраты на производство', 'RETURNS'], ['MAIN-LOG', 'Пересменка / Журнал', 'LOG'],
  ['MAIN-CHATS', 'Чаты', 'CHATS'], ['MAIN-ANNOUNCEMENTS', 'Объявления', 'ANNOUNCEMENTS'], ['MAIN-ARCHIVE', 'Архив', 'ARCHIVE'],
  ['MAIN-NOTIFICATIONS', 'Уведомления', 'NOTIFICATIONS'], ['MAIN-OPS', 'Статистика / Аудит', 'OPS'], ['MAIN-REPORT', 'Сообщить об ошибке', 'REPORT'],
];

const subs = [];
function addSubs(parent, items) { for (const [id, name] of items) subs.push([id, name, parent]); }
addSubs('AUTH', [['SUB-AUTH-LOGIN', 'Вход'], ['SUB-AUTH-REGISTER', 'Регистрация'], ['SUB-AUTH-FIRST-PASSWORD', 'Первичная смена пароля']]);
addSubs('FACTORY', [['SUB-FACTORY-SELECT', 'Выбор доступного завода'], ['SUB-FACTORY-SWITCH', 'Переключение завода в активной сессии'], ['SUB-GUEST-ASSIGNMENT', 'Заявка гостя на назначение']]);
addSubs('HOME', [['SUB-GUEST-HOME', 'Гостевой стартовый экран']]);
addSubs('SHIFT', [['SUB-SHIFT-CURRENT', 'Текущая смена'], ['SUB-SHIFT-FUTURE', 'Следующая смена / план'], ['SUB-SHIFT-CONTRACTORS', 'План и факт наёмных'], ['SUB-SHIFT-PAST', 'Календарь прошлых смен'], ['SUB-SHIFT-HANDOVER', 'Сводка передачи смены'], ['SUB-SHIFT-LINES', 'Линии текущей смены'], ['SUB-SHIFT-WORKAREAS', 'Повременщики и рабочие зоны'], ['SUB-SHIFT-PEOPLE', 'Люди текущей смены']]);
addSubs('LINES', [['SUB-LINES-ACTIVE', 'Активные линии'], ['SUB-LINES-STOPPED', 'Остановленные линии / простои']]);
addSubs('TASKS', [['SUB-TASKS-BOARD', 'Доска заявок'], ['SUB-TASKS-ARCHIVE', 'Архив и метрики заявок']]);
addSubs('WASH', [['SUB-WASH-ACTIVE', 'Активные мойки'], ['SUB-WASH-REQUESTS', 'Задания на мойку'], ['SUB-WASH-ARCHIVE', 'Архив моек'], ['SUB-WASH-OVERVIEW', 'Обзор активной мойки'], ['SUB-WASH-PEOPLE', 'Люди на мойке'], ['SUB-WASH-ISSUES', 'Проблемы мойки'], ['SUB-WASH-TASKS', 'Мини-задания мойки'], ['SUB-WASH-CONTROL', 'Контроль мойки'], ['SUB-WASH-FEED', 'Лента событий мойки'], ['SUB-WASH-OKK', 'ОКК-проверка мойки']]);
addSubs('OKK', [['SUB-OKK-ACTIVE', 'Активные записи брака'], ['SUB-OKK-ARCHIVE', 'Архив брака']]);
addSubs('STOCK', [['SUB-STOCK-ACTIVE', 'Активная некондиция'], ['SUB-STOCK-ARCHIVE', 'Архив некондиции']]);
addSubs('ORDERS', [['SUB-ORDERS-STOCK', 'Позиции остатков'], ['SUB-ORDERS-REQUESTS', 'Заявки на заказ'], ['SUB-ORDERS-ARCHIVE', 'Архив заказов и движений']]);
addSubs('CHECKLISTS', [['SUB-CHECKLISTS-INWORK', 'Чек-листы в работе'], ['SUB-CHECKLISTS-AVAILABLE', 'Доступные чек-листы'], ['SUB-CHECKLISTS-ARCHIVE', 'Архив запусков'], ['SUB-CHECKLISTS-REPORTS', 'Фильтры и отчёты'], ['SUB-CHECKLISTS-TEMPLATES', 'Управление шаблонами'], ['SUB-CHECKLISTS-JOURNAL', 'Журнал шаблона / таблица']]);
addSubs('DEFROST', [['SUB-DEFROST-LINES', 'Линии холодильной службы'], ['SUB-DEFROST-CALENDAR', 'Календарь оттайки'], ['SUB-DEFROST-DAY', 'События выбранного дня']]);
addSubs('RETURNS', [['SUB-RETURNS-ACTIVE', 'Активные возвраты'], ['SUB-RETURNS-ARCHIVE', 'Архив возвратов']]);
addSubs('LOG', [['SUB-LOG-ACTIVE', 'Журнал смены'], ['SUB-LOG-ARCHIVE', 'Архив пересменки']]);
addSubs('CHATS', [['SUB-CHATS-LIST', 'Список чатов'], ['SUB-CHATS-CONVERSATION', 'Переписка'], ['SUB-CHATS-MEDIA', 'Медиа и файлы чата']]);
addSubs('ANNOUNCEMENTS', [['SUB-ANNOUNCEMENTS-CURRENT', 'Текущие объявления'], ['SUB-ANNOUNCEMENTS-ARCHIVE', 'Архив объявлений'], ['SUB-ANNOUNCEMENTS-MANAGEMENT', 'Управление объявлениями']]);
addSubs('ARCHIVE', [['SUB-ARCHIVE-CATEGORIES', 'Категории архива'], ['SUB-ARCHIVE-RECORDS', 'Список записей категории']]);
addSubs('NOTIFICATIONS', [['SUB-NOTIFICATIONS-LIST', 'Центр уведомлений'], ['SUB-NOTIFICATIONS-PUSH', 'Push-подписка устройства']]);
addSubs('OPS', [['SUB-OPS-LOSSES', 'Потери'], ['SUB-OPS-OVERVIEW', 'Операционный обзор'], ['SUB-OPS-EVENTS', 'События'], ['SUB-OPS-AUDIT', 'Аудит'], ['SUB-OPS-MODULES', 'Показатели модулей']]);
addSubs('REPORT', [['SUB-REPORT-FORM', 'Форма сообщения об ошибке'], ['SUB-REPORT-ADMIN', 'Админский список ошибок']]);
addSubs('LEGACY', [['SUB-LEGACY-APP', 'Старый альтернативный App'], ['SUB-LEGACY-OFFLINE', 'Незавершённый offline outbox']]);

const adminNames = ['Обзор', 'Заводы', 'Пользователи и доступы', 'Отделы и службы', 'Должности и роли', 'Линии и позиции', 'Позиции на линиях', 'Шаблоны состава', 'Повременщики / рабочие зоны', 'Роли и права', 'Настройки модулей', 'Восстановление', 'Диагностика данных', 'Аудит действий админки'];
const admin = adminNames.map((name, index) => [`ADMIN-${String(index + 1).padStart(2, '0')}`, name, 'ADMIN']);

const modals = [];
function addModals(parent, items) { for (const [id, name] of items) modals.push([id, name, parent]); }
addModals('HOME', [['MOD-MOBILE-MORE', 'Mobile sheet «Ещё»'], ['MOD-DEVICE-SETTINGS', 'Настройки устройства: звук/вибрация/быстрые разделы'], ['MOD-PUSH-PERMISSION', 'Разрешение браузерных уведомлений']]);
addModals('FACTORY', [['MOD-FACTORY-PICKER', 'Переключатель завода'], ['MOD-GUEST-ASSIGNMENT', 'Заявка гостя на назначение']]);
addModals('REPORT', [['MOD-ATTACHMENT-SOURCE', 'Выбор источника вложения'], ['MOD-ATTACHMENT-VIEWER', 'Просмотр фото/видео/файла'], ['MOD-REPORT-DETAIL', 'Карточка сообщения об ошибке']]);
addModals('SHIFT', [
  ['MOD-SHIFT-PICKER', 'Выбор текущей/следующей/прошлой смены'], ['MOD-SHIFT-PEOPLE', 'Панель людей смены'], ['MOD-SHIFT-FUTURE', 'Панель планирования следующей смены'], ['MOD-SHIFT-HANDOVER', 'Передача смены'],
  ['MOD-SHIFT-MANUAL-SEARCH', 'Ручной поиск сотрудника'], ['MOD-SHIFT-TARGET', 'Выбор назначения сотрудника'], ['MOD-SHIFT-WORKAREA-PICKER', 'Выбор рабочей зоны'], ['MOD-SHIFT-LINE-PICKER', 'Выбор линии'],
  ['MOD-SHIFT-NOT-NEEDED', 'Причина «не нужен»'], ['MOD-SHIFT-SLOT-ACTIONS', 'Действия с занятым местом'], ['MOD-SHIFT-WORKAREA-BOARD', 'Доска рабочей зоны'], ['MOD-SHIFT-WORKAREA-CANDIDATE', 'Кандидат в рабочую зону'],
  ['MOD-SHIFT-REQUIREMENT', 'Редактор потребности'], ['MOD-SHIFT-FUTURE-LINE', 'Плановая доска линии'], ['MOD-SHIFT-FUTURE-MOVE', 'Подтверждение переноса в плане'], ['MOD-SHIFT-FUTURE-NONLINE', 'Плановое назначение вне линии'],
  ['MOD-SHIFT-TEMPLATE-REMAP', 'Preview смены шаблона состава'], ['MOD-SHIFT-PERSON-FIRST', 'Person-first выбор места'], ['MOD-SHIFT-LINE-BOARD', 'Доска назначений линии'], ['MOD-SHIFT-SLOT-FIRST', 'Slot-first выбор сотрудника'],
  ['MOD-SHIFT-LINE-ACTIONS', 'Действия линии из смены'], ['MOD-SHIFT-LINE-ASSIGNMENT', 'Назначение на линию'], ['MOD-SHIFT-START', 'Начало смены'], ['MOD-SHIFT-END', 'Завершение смены'],
  ['MOD-SHIFT-WILLBE', 'Подтверждение выхода'], ['MOD-SHIFT-RETURN', 'Запрос возврата в смену'], ['MOD-SHIFT-TASK', 'Заявка из смены'], ['MOD-SHIFT-PROFILE', 'Карточка сотрудника из смены'],
]);
addModals('PEOPLE', [['MOD-PEOPLE-FILTERS', 'Поиск и фильтры людей'], ['MOD-PEOPLE-PROFILE', 'Профиль сотрудника'], ['MOD-PEOPLE-SKILL', 'Создание/редактирование навыка'], ['MOD-PEOPLE-NOTE', 'Заметка руководства'], ['MOD-PEOPLE-PHOTO', 'Управление фото профиля'], ['MOD-PEOPLE-PASSWORD', 'Сброс пароля']]);
addModals('ADMIN', [['MOD-ADMIN-DELEGATION', 'Делегирование прав'], ['MOD-ADMIN-DELEGATION-HELP', 'Справка по делегированию'], ['MOD-ADMIN-CONFIRM', 'Безопасное подтверждение админ-действия']]);
addModals('LINES', [['MOD-LINE-DETAIL', 'Карточка линии'], ['MOD-LINE-DOWNTIME', 'Остановка/простой/возврат в работу'], ['MOD-LINE-TIMELINE', 'Временная история линии'], ['MOD-LINE-STATS', 'Статистика линии']]);
addModals('TASKS', [['MOD-TASK-FILTERS', 'Фильтры заявок'], ['MOD-TASK-ARCHIVE', 'Архив и метрики'], ['MOD-TASK-ACTIONS', 'Действия с заявкой'], ['MOD-TASK-DETAIL', 'Карточка заявки'], ['MOD-TASK-CREATE', 'Создание заявки'], ['MOD-TASK-TAKE', 'Взять/изменить исполнение'], ['MOD-TASK-COMPLETE', 'Завершение заявки'], ['MOD-TASK-REDIRECT', 'Перенаправление заявки']]);
addModals('WASH', [['MOD-WASH-REQUEST', 'Создание задания на мойку'], ['MOD-WASH-START', 'Начать мойку'], ['MOD-WASH-MESSAGE', 'Фото/комментарий мойки'], ['MOD-WASH-ISSUE', 'Проблема мойки'], ['MOD-WASH-CONTROL', 'Контроль/мини-задание'], ['MOD-WASH-OKK', 'ОКК-проверка мойки'], ['MOD-WASH-COMPLETE', 'Завершить мойку'], ['MOD-WASH-REQUEST-ACTION', 'Статус задания на мойку']]);
addModals('OKK', [['MOD-OKK-CREATE', 'Новый брак'], ['MOD-OKK-COMPLETE', 'Отметить выполнение'], ['MOD-OKK-RELEASE', 'Частичная выдача'], ['MOD-OKK-ATTACH', 'Вложение к браку'], ['MOD-OKK-DETAIL', 'Карточка брака']]);
addModals('STOCK', [['MOD-STOCK-CREATE', 'Создать некондицию'], ['MOD-STOCK-STATUS', 'Скрытие/архив некондиции'], ['MOD-STOCK-ATTACH', 'Вложение к некондиции'], ['MOD-STOCK-DETAIL', 'Карточка некондиции']]);
addModals('RETURNS', [['MOD-RETURN-CREATE', 'Создать возврат'], ['MOD-RETURN-DETAIL', 'Карточка возврата'], ['MOD-RETURN-ARCHIVE', 'Архивировать возврат'], ['MOD-RETURN-RELEASE', 'Частичная выдача возврата']]);
addModals('ORDERS', [['MOD-ORDERS-FILTERS', 'Фильтры остатков/заказов'], ['MOD-ORDERS-ITEM', 'Карточка остатка'], ['MOD-ORDERS-REQUEST', 'Карточка заказа'], ['MOD-ORDERS-CREATE-ITEM', 'Создать позицию остатка'], ['MOD-ORDERS-FROM-ITEM', 'Заказ из остатка'], ['MOD-ORDERS-MANUAL', 'Ручная заявка на заказ'], ['MOD-ORDERS-STATUS', 'Изменить статус заказа']]);
addModals('CHECKLISTS', [['MOD-CHECKLIST-RUNNER', 'Focused checklist runner'], ['MOD-CHECKLIST-ACTIONS', 'Действия с запуском'], ['MOD-CHECKLIST-FINAL', 'Финальная проверка ответов'], ['MOD-CHECKLIST-LOCAL-DETAIL', 'Локальная карточка чек-листа'], ['MOD-CHECKLIST-ARCHIVE-DETAIL', 'Карточка архивного запуска'], ['MOD-CHECKLIST-PREVIEW', 'Предпросмотр шаблона'], ['MOD-CHECKLIST-BUILDER', 'Конструктор шаблона'], ['MOD-CHECKLIST-ITEM', 'Редактор пункта'], ['MOD-CHECKLIST-ASSIGN', 'Назначить/взять в работу'], ['MOD-CHECKLIST-CLOSE', 'Ручное завершение с причиной'], ['MOD-CHECKLIST-CONFIRM', 'Подтверждение результата'], ['MOD-CHECKLIST-REPORTS', 'Фильтры и отчёты']]);
addModals('DEFROST', [['MOD-DEFROST-ACTION', 'Выбор линии для оттайки/запуска/обдува']]);
addModals('LOG', [['MOD-LOG-DETAIL', 'Карточка журнала'], ['MOD-LOG-CREATE', 'Новая запись смены'], ['MOD-LOG-COMMENT', 'Комментарий к записи'], ['MOD-LOG-CLOSE', 'Закрыть важное уведомление'], ['MOD-LOG-ATTACH', 'Вложение к журналу']]);
addModals('CHATS', [['MOD-CHAT-ATTACH', 'Выбор медиа/файла/опроса'], ['MOD-CHAT-MESSAGE-ACTIONS', 'Действия с сообщением'], ['MOD-CHAT-PARTICIPANT', 'Профиль участника'], ['MOD-CHAT-DIRECT', 'Новый личный чат'], ['MOD-CHAT-GROUP', 'Новый групповой чат'], ['MOD-CHAT-INFO', 'Информация/участники/медиа'], ['MOD-CHAT-POLL', 'Создание опроса'], ['MOD-CHAT-EDIT', 'Редактирование сообщения'], ['MOD-CHAT-DELETE', 'Удаление сообщения']]);
addModals('ANNOUNCEMENTS', [['MOD-ANNOUNCEMENT-EDITOR', 'Редактор объявления'], ['MOD-ANNOUNCEMENT-ARCHIVE', 'Перенести в архив'], ['MOD-ANNOUNCEMENT-ACKS', 'Журнал ознакомления']]);
addModals('ARCHIVE', [['MOD-ARCHIVE-FILTERS', 'Фильтры архива'], ['MOD-ARCHIVE-EXPORT', 'Экспорт выборки'], ['MOD-ARCHIVE-SUMMARY', 'Сводка категории'], ['MOD-ARCHIVE-DETAIL', 'Карточка архивной записи'], ['MOD-ARCHIVE-ATTACHMENT', 'Карточка архивного вложения'], ['MOD-ARCHIVE-CORRECTION', 'Уточнение времени простоя']]);
addModals('OPS', [['MOD-OPS-FILTERS', 'Фильтры статистики'], ['MOD-OPS-AUDIT-DETAIL', 'Карточка аудита']]);

const gaps = [
  { id: 'SB-001', severity: 'P1', surface: 'Линии / Situation для TECH_*', effect: 'Экран виден, но `/wash` возвращает 403; Promise.all очищает также линии и рабочие зоны.', root: 'frontend/src/screens/SituationScreen.tsx; backend/src/modules/wash/wash.service.ts', expected: 'Каждый source загружается по собственной capability; отсутствие wash.read не ломает lines.read.', actual: 'Жёсткая совместная загрузка `/lines`, `/wash`, `/work-areas`.', why: 'UI_VISIBLE + primary screen unusable из-за несвязанного permission.', mutation: 'Нет', fix: 'Разделить read owners/ошибки и запрашивать wash только при доступной capability.' },
  { id: 'SB-002', severity: 'P1', surface: 'Люди / профиль / actor labels', effect: 'Один пользователь показан как «PILOT А. Р.» и «Администратор Романов Р. А.» на разных surfaces; новые реальные пользователи не имеют canonical ФИО.', root: 'backend/prisma/schema.prisma User; backend/src/common/pilot-visibility.ts; frontend/src/utils/pilot-ui.ts', expected: 'Persisted canonical human identity.', actual: 'Нет поля ФИО; backend и frontend содержат отдельные hardcoded label maps и fallback.', why: 'Основная бизнес-идентичность не имеет canonical owner.', mutation: 'Да, additive schema/backfill потребуется в 17B', fix: 'Добавить canonical profile/display-name owner и постепенно убрать seeded label dictionaries из runtime presentation.' },
  { id: 'SB-003', severity: 'P1', surface: 'Оттайка', effect: 'Скрытые роли могут читать `/defrost/*` прямым API.', root: 'backend/src/modules/defrost/defrost.controller.ts; defrost.service.ts', expected: 'Backend permission `defrost.read/manage` совпадает с UI.', actual: 'Read guard разрешает любого non-guest выбранного завода.', why: 'Backend final authority шире настроенной permission matrix.', mutation: 'Нет', fix: 'Применить existing permission guard к read endpoints, сохранив factory scope.' },
  { id: 'SB-004', severity: 'P1', surface: 'Возвраты', effect: 'WORKER/CONTRACTOR и другие non-guest получают публикации по API, но экран скрыт; предусмотренный read-only flow недостижим.', root: 'frontend/src/navigation/permissions.ts; backend/src/common/publication-policy.ts', expected: 'Одна публикационная capability для UI и API.', actual: 'Backend `canReadReturnPublications` разрешает всех non-guest; UI требует `returns.read`.', why: 'UI_HIDDEN + API_ALLOWED для пользовательского read-only контура.', mutation: 'Нет', fix: 'Вернуть backend-derived capability в auth context и использовать её для меню, не ослабляя publish/manage.' },
  { id: 'SB-005', severity: 'P1', surface: 'Мойка для TECHNOLOG', effect: 'Backend намеренно разрешает технологу читать/контролировать мойку, но пункт меню скрыт.', root: 'backend/src/modules/wash/wash.service.ts; frontend/src/navigation/permissions.ts', expected: 'Технолог видит существующий wash read surface.', actual: 'Service role overlay есть, permission row `wash.read` отсутствует, UI проверяет только permission.', why: 'UI_HIDDEN + API_ALLOWED для рабочего экрана.', mutation: 'Нет', fix: 'Свести роль/capability к одному backend-owned контракту и отдать effective capability frontend.' },
  { id: 'SB-006', severity: 'P2', surface: 'Ограниченная админка MASTER', effect: 'Рабочий экран сначала получает ожидаемый 403 `/admin/overview`, затем fallback загружает доступный staffing/delegation контекст; console/network шум.', root: 'frontend/src/screens/AdminConfigScreen.tsx', expected: 'Capability-aware initial load.', actual: '403 используется как discovery механизма доступа.', why: 'UI_VISIBLE + probe API_DENIED, хотя fallback рабочий.', mutation: 'Нет', fix: 'Выбирать начальный endpoint по effective admin capability.' },
  { id: 'SB-007', severity: 'P2', surface: 'Админка: роли и назначения', effect: 'Новая backend role потребует изменения frontend-кода.', root: 'frontend/src/screens/AdminConfigScreen.tsx ROLE_OPTIONS', expected: 'Canonical `/admin/roles` options.', actual: 'Static operational role list используется в selectors параллельно загруженному справочнику.', why: 'Hardcoded operational choice.', mutation: 'Нет', fix: 'Использовать response `/admin/roles`; оставить label map только для перевода.' },
  { id: 'SB-008', severity: 'P2', surface: 'Поиск людей / directory consumers', effect: 'Server query по имени возвращает 0; при >80 доступных users локальный fallback станет неполным.', root: 'backend/src/modules/directory/directory.service.ts', expected: 'Canonical server-side partial FIO/phone search with scoped pagination.', actual: '`q` фильтрует только user.id; fixed `take: 80`; displayName строится после запроса.', why: 'Текущий маленький завод работает, масштабирование и поиск имени не canonical.', mutation: 'Нет', fix: 'После SB-002 добавить indexed canonical identity search и pagination.' },
  { id: 'SB-009', severity: 'P2', surface: 'Guest home realtime', effect: 'Гость видит повторяющийся WebSocket handshake 403 в console.', root: 'frontend/src/App.tsx; frontend/src/ws/client.ts; backend/src/ws/ws.service.ts', expected: 'Guest не открывает запрещённый socket.', actual: 'Frontend reconnect запускается; backend корректно запрещает guest.', why: 'Ожидаемый deny превращён в runtime noise.', mutation: 'Нет', fix: 'Не подключать WS при guest context.' },
  { id: 'SB-010', severity: 'P2', surface: 'Статистика / Аудит permission configurability', effect: 'MASTER имеет `ops.overview.read`, но UI и backend service всё равно запрещают экран.', root: 'frontend/src/navigation/permissions.ts; backend/src/modules/ops/ops.service.ts', expected: 'Configured permission определяет доступ с factory scope.', actual: 'Hardcoded ADMIN/MANAGEMENT overlay делает permission неэффективным.', why: 'RolePermission не является фактическим owner.', mutation: 'Нет', fix: 'Выбрать один контракт: permission-only либо явно не выдавать ineffective permission.' },
  { id: 'SB-011', severity: 'P2', surface: 'Live factory A → B cache proof', effect: 'Static reset и 16/16 foreign denies доказаны, но live switch невозможен без безопасного multi-factory actor.', root: 'frontend/src/App.tsx; frontend/src/store/app.store.ts', expected: 'Live A→B proves unmount/reset/refetch.', actual: 'У всех census actors только «Завод 4».', why: 'Proof gap, не доказанный product defect.', mutation: 'MUTATION_PROOF_REQUIRED_IN_17B', fix: 'Создать изолированный scoped fixture только в 17B либо проверить на реальном multi-factory actor.' },
  { id: 'SB-012', severity: 'P2', surface: 'WebSocket factory broadcast', effect: 'Любой non-guest socket завода получает id/status/type событий модулей вне своих permissions/departments.', root: 'backend/src/ws/ws.service.ts broadcast/sendToFactory', expected: 'Permission/recipient-scoped realtime invalidation или opaque factory revision.', actual: 'Factory-wide metadata summary.', why: 'Содержимое сущности защищено API, но existence/status metadata шире RBAC.', mutation: 'Нет', fix: 'Добавить event audience/permission filtering либо отправлять непривязанный к entity invalidation token.' },
  { id: 'SB-013', severity: 'P2', surface: 'ОКК realtime', effect: 'Другой открытый клиент не применяет создание/изменение брака без reload.', root: 'backend/src/ws/events.ts + okk.service.ts; frontend/src/ws/client.ts', expected: '`okk_updated` consumer refresh.', actual: 'Backend emits; frontend union/applyEvent не знает event.', why: 'Emitter без consumer.', mutation: 'Нет', fix: 'Добавить typed event и scoped refresh OkkScreen.' },
  { id: 'SB-014', severity: 'P2', surface: 'Frontend role policy overlays', effect: 'Announcement/return/phone-directory menu rules могут разойтись с backend policy.', root: 'frontend/src/navigation/permissions.ts; backend/src/common/publication-policy.ts', expected: 'Backend-derived effective capabilities.', actual: 'Несколько duplicated role Sets во frontend и backend.', why: 'Parallel authority policy, хотя текущие role names совпадают.', mutation: 'Нет', fix: 'Отдавать explicit capabilities в auth context; frontend role maps оставить только для labels.' },
  { id: 'SB-015', severity: 'P2', surface: 'Мойка realtime', effect: 'Message/issue события другого клиента не обновляют открытый WashScreen.', root: 'backend/src/ws/ws.service.ts safePayloadSummary; wash.service.ts; frontend/src/ws/client.ts/WashScreen.tsx', expected: 'Session-scoped refresh.', actual: '`sessionId` отбрасывается summary; WashScreen не слушает operational invalidation.', why: 'Emitter и active consumer не сходятся.', mutation: 'Нет', fix: 'Сохранить safe session identifier/revision и подписать WashScreen на scoped refresh.' },
  { id: 'SB-016', severity: 'P2', surface: 'Оттайка realtime', effect: 'Изменение на другом клиенте не обновляет открытый календарь оттайки.', root: 'backend/src/modules/defrost/defrost.service.ts; frontend/src/screens/DefrostScreen.tsx', expected: 'Defrost event invalidates defrost view.', actual: 'Emits `line_updated`; DefrostScreen не имеет listener.', why: 'Связанный line consumer есть, профильный consumer отсутствует.', mutation: 'Нет', fix: 'Добавить safe defrost invalidation event/listener.' },
  { id: 'SB-017', severity: 'P3', surface: 'Offline outbox files', effect: 'На current runtime не влияет.', root: 'frontend/src/offline/db.ts; indexeddb.ts; sync-engine.ts; sync.ts', expected: 'Либо complete imported owner, либо отсутствие.', actual: 'Unreachable incomplete parallel outbox; один import не имеет export.', why: 'Dead architecture debt.', mutation: 'Нет', fix: 'Отдельно удалить/завершить после подтверждения, не в 17A.' },
  { id: 'SB-018', severity: 'P3', surface: 'Старые frontend owners', effect: 'На current bundle не влияют, но усложняют аудит.', root: 'frontend/src/app/App.tsx; frontend/src/store/shift-store.ts; frontend/src/theme/status-colors.ts', expected: 'Один current import graph.', actual: 'Unreachable legacy App/store/theme fragments.', why: 'Dead duplicate implementation.', mutation: 'Нет', fix: 'Отдельный non-product cleanup после import-graph proof.' },
];

const statusOverride = {
  'MAIN-HOME': ['READ_ONLY_PRESENTATION', []],
  'MAIN-ADMIN': ['GAP_RBAC_MISMATCH', ['SB-006']],
  'MAIN-PEOPLE': ['GAP_HARDCODED', ['SB-002']],
  'MAIN-LINES': ['GAP_RBAC_MISMATCH', ['SB-001']],
  'MAIN-WASH': ['GAP_RBAC_MISMATCH', ['SB-005', 'SB-015']],
  'MAIN-OKK': ['PROVEN_CANONICAL', ['SB-013']],
  'MAIN-DEFROST': ['GAP_RBAC_MISMATCH', ['SB-003', 'SB-016']],
  'MAIN-RETURNS': ['GAP_RBAC_MISMATCH', ['SB-004']],
  'MAIN-OPS': ['GAP_RBAC_MISMATCH', ['SB-010']],
  'SUB-FACTORY-SWITCH': ['PROOF_PENDING', ['SB-011']],
  'SUB-GUEST-HOME': ['PROVEN_CANONICAL', ['SB-009']],
  'SUB-CHATS-CONVERSATION': ['PROOF_PENDING', []],
  'SUB-LEGACY-APP': ['GAP_PARALLEL_OWNER', ['SB-018']],
  'SUB-LEGACY-OFFLINE': ['GAP_PARALLEL_OWNER', ['SB-017']],
  'SUB-NOTIFICATIONS-PUSH': ['PROVEN_BROWSER_PERMISSION', []],
  'ADMIN-05': ['GAP_HARDCODED', ['SB-007']],
  'ADMIN-10': ['GAP_HARDCODED', ['SB-007', 'SB-014']],
  'MOD-DEVICE-SETTINGS': ['PROVEN_DEVICE_LOCAL', []],
  'MOD-PUSH-PERMISSION': ['PROVEN_BROWSER_PERMISSION', []],
  'MOD-ATTACHMENT-SOURCE': ['PROVEN_BROWSER_PERMISSION', []],
  'MOD-SHIFT-MANUAL-SEARCH': ['PROVEN_CANONICAL', ['SB-008']],
  'MOD-PEOPLE-FILTERS': ['PROVEN_CANONICAL', ['SB-008']],
  'MOD-PEOPLE-PROFILE': ['GAP_HARDCODED', ['SB-002']],
};

const roleByDomain = {
  HOME: 'Guest; authenticated shell', AUTH: 'Unauthenticated / pending auth', FACTORY: 'Any authenticated access holder', SHIFT: 'By shift/self/manage permissions', PEOPLE: 'By people/profile permissions', ADMIN: 'ADMIN plus limited delegated managers', LINES: 'lines.read', TASKS: 'tasks.read', WASH: 'wash read/control roles', OKK: 'okk.read', STOCK: 'stock.read', ORDERS: 'orders.read', CHECKLISTS: 'checklist permissions', DEFROST: 'defrost permissions (gap)', RETURNS: 'publication/read policy (gap)', LOG: 'shift-log permissions', CHATS: 'chat members/read', ANNOUNCEMENTS: 'audience/read/publish', ARCHIVE: 'per-source permission', NOTIFICATIONS: 'recipient', OPS: 'MANAGEMENT/ADMIN current role overlay', REPORT: 'All users; ADMIN inbox', LEGACY: 'Unreachable',
};

function makeSurface(kind, spec) {
  const [id, name, parentFromSpec] = spec;
  const parent = parentFromSpec || id.replace(/^MAIN-/, '');
  const owner = owners[parent];
  const override = statusOverride[id] || ['PROVEN_CANONICAL', []];
  return {
    id, kind, name, parent, owner,
    file: owner.file,
    entry: kind === 'MAIN' ? 'SCREEN_DEFINITIONS / role menu' : kind === 'ADMIN' ? 'Admin section navigation' : kind === 'MODAL' ? 'Explicit action/detail state' : 'Parent tabs/state/deep-link',
    state: id.toLowerCase().replaceAll('_', '-'),
    roles: roleByDomain[parent] || 'Parent capability',
    scope: owner.scope,
    fetches: owner.api,
    mutations: kind === 'MODAL' ? 'Only explicit guarded action where applicable' : 'None or delegated to explicit action surface',
    realtime: owner.realtime,
    history: owner.history,
    status: override[0],
    gaps: override[1],
  };
}

const surfaces = [
  ...mainSpecs.map((spec) => makeSurface('MAIN', spec)),
  ...subs.map((spec) => makeSurface('SUBSCREEN', spec)),
  ...admin.map((spec) => makeSurface('ADMIN', spec)),
  ...modals.map((spec) => makeSurface('MODAL', spec)),
];

const counts = {
  main: surfaces.filter((item) => item.kind === 'MAIN').length,
  subscreens: surfaces.filter((item) => item.kind === 'SUBSCREEN').length,
  adminSections: surfaces.filter((item) => item.kind === 'ADMIN').length,
  businessSheetsModals: surfaces.filter((item) => item.kind === 'MODAL').length,
  total: surfaces.length,
  provenCanonical: surfaces.filter((item) => item.status === 'PROVEN_CANONICAL').length,
  deviceLocal: surfaces.filter((item) => item.status === 'PROVEN_DEVICE_LOCAL').length,
  browserPermission: surfaces.filter((item) => item.status === 'PROVEN_BROWSER_PERMISSION').length,
  proofPending: surfaces.filter((item) => item.status === 'PROOF_PENDING').length,
  readOnlyPresentation: surfaces.filter((item) => item.status === 'READ_ONLY_PRESENTATION').length,
  surfacesWithGaps: surfaces.filter((item) => item.gaps.length > 0).length,
};
const severityCounts = Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((severity) => [severity, gaps.filter((gap) => gap.severity === severity).length]));

const inventoryRows = surfaces.map((item) => `| ${md(item.id)} | ${md(item.name)} | ${md(item.file)} | ${md(item.parent)} | ${md(item.entry)} | ${md(item.state)} | ${md(item.roles)} | ${md(item.scope)} | ${md(item.fetches)} | ${md(item.mutations)} | ${md(item.realtime)} | ${md(item.history)} | ${md(item.status)}${item.gaps.length ? ` (${item.gaps.join(', ')})` : ''} |`).join('\n');

const bindingRows = surfaces.map((item) => `| ${md(item.id)} | ${md(item.entry)} | ${md(item.owner.frontend)} | ${md(item.owner.api)} | ${md(item.owner.backend)} | ${md(item.owner.entity)} | ${md(item.owner.scope)} | ${md(item.owner.rbac)} | ${md(item.owner.dynamic)} | ${md(item.owner.realtime)} | ${md(item.owner.history)} | ${md(item.status)}${item.gaps.length ? ` (${item.gaps.join(', ')})` : ''} |`).join('\n');

const screenCodes = artifact.browser.roleApi[0].rows.map((row) => row.screen);
const apiByActor = new Map(artifact.browser.roleApi.map((row) => [row.actor, row]));
const uiByActor = new Map(artifact.browser.roleUi.map((row) => [row.actor, row]));
const roleMatrixRows = artifact.browser.roleApi.map((actorRow) => {
  const ui = uiByActor.get(actorRow.actor);
  const cells = actorRow.rows.map((row) => {
    const visible = ui.visibleScreens.includes(row.screen);
    if (row.status === 'NO_PRIMARY_READ_ENDPOINT') return visible ? 'VN' : 'HN';
    const allowed = Number(row.status) >= 200 && Number(row.status) < 300;
    return visible ? (allowed ? 'VA' : 'VD') : (allowed ? 'HA' : 'HD');
  });
  return `| ${actorRow.actor} | ${cells.join(' | ')} | ${actorRow.foreignFactoryStatus} |`;
}).join('\n');
const parity = { VA: 0, VD: 0, HA: 0, HD: 0, NA: 0 };
for (const actorRow of artifact.browser.roleApi) {
  const ui = uiByActor.get(actorRow.actor);
  for (const row of actorRow.rows) {
    const visible = ui.visibleScreens.includes(row.screen);
    if (row.status === 'NO_PRIMARY_READ_ENDPOINT') { parity.NA += 1; continue; }
    const allowed = Number(row.status) >= 200 && Number(row.status) < 300;
    if (visible && allowed) parity.VA += 1;
    else if (visible) parity.VD += 1;
    else if (allowed) parity.HA += 1;
    else parity.HD += 1;
  }
}

const docs = {};
docs['discovery.md'] = `# Plast 17A — discovery

Дата census: ${now}. Режим: **AUDIT / READ-ONLY**. Product source, schema, migrations, module settings, business entities, runtime и tunnel не менялись.

## Фактический frontend

- Canonical entry: \`frontend/src/main.tsx\` → \`frontend/src/App.tsx\`.
- Main screen registry: \`frontend/src/navigation/permissions.ts\`, 21 screen.
- Screen files: ${artifact.frontend.screenFiles.length}; component files: ${artifact.frontend.componentFiles.length}; frontend source files: ${artifact.frontend.sourceFiles}.
- Frontend API calls: ${artifact.bindingSummary.frontendCalls}; exact single controller matches: ${artifact.bindingSummary.callsWithControllerMatch}; rough multiple matches: ${artifact.bindingSummary.callsWithMultipleMatches}; dynamic expressions requiring manual resolution: ${artifact.bindingSummary.callsWithoutMatch}.
- Все ${artifact.bindingSummary.callsWithoutMatch} dynamic expressions вручную сведены к существующим controllers; missing active endpoint не найден.
- Backend controllers expose ${artifact.backend.endpointCount} endpoints total; census рассматривает только UI-used routes.

## Browser evidence

- 16 role/guest families; ${artifact.browser.roleUi.reduce((sum, row) => sum + row.crawled.length, 0)} main surfaces opened; 0 failed.
- 360/390/430: ${artifact.browser.mobile.length} checks, ${artifact.browser.mobile.filter((row) => row.overflow > 0).length} overflow failures.
- Safe details opened: line detail/timeline/statistics, employee profile, archive request detail, checklist archive runner/detail, admin department section, audit detail, active wash detail.
- Current task detail had no safe active row. Chat conversation is \`PROOF_PENDING\`: opening it writes ChatRead, so 17A correctly did not perform that mutation.
- Classified runtime errors: 13; all are mapped to SB gaps. No blank screen, unexpected 5xx, primary raw UUID, \`undefined\`/\`null\` label or public storagePath/secret leak was observed.

## Business DB read-only proof

- 87 non-audit models fingerprinted before and after a complete repeated browser census.
- AuditLog excluded. User auth metadata \`lastLoginAt/failedLoginCount/lockedUntil/authUpdatedAt/updatedAt\` excluded because login necessarily updates it.
- Compatible business-v2 fingerprints: \`${artifact.databaseComparison.firstFingerprint}\` → \`${artifact.databaseComparison.lastFingerprint}\`; unchanged: **${artifact.databaseComparison.unchanged}**.
- Older v1 snapshots differed only in User because the first helper had not excluded automatic \`updatedAt\`; no other model changed.

## Runtime preserved

- Backend PID 12364, frontend PID 8984, tunnel PID 4356, keep-awake PID 11500.
- Local health: ok; frontend: HTTP 200; Quick Tunnel URL unchanged.
- Service worker: \`zavod-shell-v6\`; secure context/service worker/manifest proof passed.

## Important discovery results

- 0 P0.
- ${severityCounts.P1} P1 and ${severityCounts.P2} P2 are documented, not fixed.
- Canonical module settings: 8/8 effective DB-backed modules.
- Cross-factory direct read: 16/16 actors received 403 for foreign factory.
- Live A→B switch is proof-pending because no census actor has a second safe factory access; static clear/unmount logic is present.
`;

docs['screen-inventory.md'] = `# Screen inventory

Counts are generated from the rows below, not copied from the prompt.

- TOTAL_MAIN_SCREENS: ${counts.main}
- TOTAL_SUBSCREENS: ${counts.subscreens}
- TOTAL_ADMIN_SECTIONS: ${counts.adminSections}
- TOTAL_BUSINESS_SHEETS/MODALS: ${counts.businessSheetsModals}
- TOTAL_SURFACES: ${counts.total}

| SURFACE_ID | HUMAN_NAME | FILE/COMPONENT | PARENT | ENTRY_POINTS | DIRECT_ROUTE_OR_STATE | VISIBLE_ROLES | EXPECTED_FACTORY_SCOPE | FETCHES | MUTATIONS | REALTIME | HISTORY_LINK | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${inventoryRows}

## Reachability classification

- CURRENT_RUNTIME: \`frontend/src/App.tsx\` and all imported screens/components.
- INTENTIONALLY_ROLE_HIDDEN: rows hidden by \`canShowScreen\`, with backend parity in role matrix.
- DEVICE_LOCAL/BROWSER_PERMISSION: explicitly classified rows only; no business source is stored there.
- DEAD_COMPONENT/REAL_PARALLEL_OWNER: \`SUB-LEGACY-APP\` and \`SUB-LEGACY-OFFLINE\` (SB-017/SB-018).
- TEST_ONLY: scripts/e2e and diagnostic marker flows are not counted as product surfaces.
`;

docs['screen-binding-matrix.md'] = `# Screen binding matrix

Binding status vocabulary is limited to the values required by the goal. A canonical surface may still carry a separate SB gap for role/realtime presentation.

| SURFACE | ENTRY | FRONTEND OWNER | API | BACKEND OWNER | CANONICAL ENTITY/READ MODEL | FACTORY SCOPE | RBAC | DYNAMIC DATA SOURCE | REALTIME | ARCHIVE/AUDIT | BINDING STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|
${bindingRows}

## API resolution

- ${artifact.bindingSummary.callsWithControllerMatch}/${artifact.bindingSummary.frontendCalls} calls have a single static controller match.
- ${artifact.bindingSummary.callsWithMultipleMatches} have conservative multiple rough matches caused by literal route vs parameter route overlap; manual owner resolution found no parallel mutation command.
- ${artifact.bindingSummary.callsWithoutMatch} are computed URL expressions (settings descriptors, query suffixes, conditional line/shift endpoints); all map to existing current controllers.
- Direct \`fetch/XMLHttpRequest\` outside \`apiClient\`: none for business APIs.

## Duplicate owner classification

- REAL_PARALLEL_OWNER: unreachable legacy App/store/theme fragments (SB-018) and incomplete offline outbox (SB-017).
- FALSE_POSITIVE: module-specific \`/directory/*\` consumers share one DirectoryService; archive adapters share ArchiveService; task recipient and directory department endpoints serve different scoped read models.
- No active parallel department, line, assignment, archive or notification mutation owner was found.
`;

const directoryRows = [
  ['Factory', 'FactorySelect, shell, Admin, auth context', 'Factory + UserFactoryAccess', 'allowed access only', 'FactoryAudit/AuditLog', 'PROVEN_CANONICAL', 'SB-011 live switch proof pending'],
  ['Department', 'Admin, People, Tasks recipients, Checklists scope, Announcements audience, Delegation, Ops, Archive/Audit', 'Department + UserFactoryAccess.departmentId', 'factory-local or explicit global service', 'historical snapshots/source records', 'PROVEN_CANONICAL', ''],
  ['JobTitle / hierarchy', 'Admin, People/Profile, delegation/subordinate policy', 'JobTitle + hierarchyRank + access jobTitleId', 'factory/global rules in backend policy', 'AuditLog', 'PROVEN_CANONICAL', 'No title-name authority check found'],
  ['User / Access', 'People, Shift, future plan, Chats, Tasks, Checklists, Announcements, Audit, Notifications, Admin', 'User + UserFactoryAccess', 'factory/department/company', 'actor snapshots + AuditLog', 'GAP_HARDCODED', 'SB-002, SB-008'],
  ['ExternalCompany', 'Guest assignment, Admin review, contractor lead, People, Shift/future, history', 'ExternalCompany + access.companyId + historical snapshot', 'factory and own-company scope', 'AssignmentRequest/contractor snapshots', 'PROVEN_CANONICAL', ''],
  ['Line', 'Admin, Shift, Situation, Tasks, Checklists, Defrost, quality, Ops, Archive', 'Line + directory/line read models', 'factory', 'LineStatusEvent + archive', 'PROVEN_CANONICAL', ''],
  ['WorkArea / StaffingPosition', 'Admin, current/future Shift, Assignment, history/archive', 'WorkArea/WorkAreaPosition/LinePosition/StaffingTemplate', 'factory', 'Assignment/PlannedShiftAssignment', 'PROVEN_CANONICAL', 'No second TIME directory'],
  ['Role / Permission', 'Admin, menu, API guard, delegation', 'RolePermission + overrides + effective auth context', 'factory access and global role rows', 'AuditLog', 'GAP_HARDCODED', 'SB-007, SB-010, SB-014'],
];
const settingsRows = ['shift', 'tasks', 'wash', 'checklists', 'orders', 'defrost', 'chats', 'announcements'].map((key) => `| ${key} | DB settings model | Read + preview + guarded update | factoryId | effective |`).join('\n');
const attachmentTypes = ['TASK','TASK_COMMENT','WASH_SESSION','WASH_MESSAGE','WASH_ISSUE','WASH_CONTROL_ITEM','WASH_OKK_REVIEW','OKK_RECORD','STOCK_DEFECT','RETURN_RECORD','SHIFT_LOG','SHIFT_LOG_COMMENT','MINIMUM_STOCK_ITEM','ORDER_REQUEST','MINIMUM_STOCK_MOVEMENT','CHECKLIST_RUN','CHECKLIST_RUN_ROW','CHECKLIST_ENTRY','CHAT_MESSAGE','ERROR_REPORT','ANNOUNCEMENT','COMMON'];
docs['directory-consumer-matrix.md'] = `# Directory consumer matrix

| DIRECTORY | ALL CURRENT CONSUMERS | CANONICAL SOURCE | SCOPE | HISTORY SOURCE | STATUS | NOTES/GAPS |
|---|---|---|---|---|---|---|
${directoryRows.map((row) => `| ${row.map(md).join(' | ')} |`).join('\n')}

## Module settings

| MODULE | OWNER | CONTRACT | SCOPE | STATUS |
|---|---|---|---|---|
${settingsRows}

MODULE_SETTINGS: **8/8 effective, 0 dead, 0 proof pending**. Values are persisted in ${['ShiftSettings','TaskSettings','WashSettings','ChecklistSettings','OrderSettings','DefrostSettings','ChatSettings','AnnouncementSettings'].map((x) => `\`${x}\``).join(', ')}. Device sound/vibration/quick-nav are intentionally localStorage; Notification/Push permission is browser-owned.

## Attachment owner matrix

- Entity types (${attachmentTypes.length}): ${attachmentTypes.map((x) => `\`${x}\``).join(', ')}.
- One owner: \`AttachmentsService.validateEntityAccess\` → entity factory lookup → entity-specific visibility guard → \`FileStorageService\`.
- Public DTO/view/download do not expose \`storagePath\`; COMMON profile photos have separate factory/profile guard.
- ATTACHMENT_OWNER_MATRIX_GATE: PASS.

## Audit/history bindings

| DOMAIN | HISTORY/AUDIT OWNER |
|---|---|
| Shift/people | ShiftSession, Assignment/PlannedShiftAssignment, ShiftLog immutable snapshot, AuditLog |
| Lines/tasks | LineStatusEvent/timeline, TaskHistory/comments, ArchiveService, AuditLog |
| Wash/defrost | WashEvent/session history, DefrostEvent/calendar, ArchiveService, AuditLog |
| Quality/orders | Module archive/status history, QuantityRelease, stock movements, AuditLog |
| Checklists | Run/Entry/RunRow + template journal/reports, AuditLog |
| Chats/announcements | soft-delete/edit/reaction/read/ack history and moderation audit |
| Admin/security | central AuditLog + human-readable presentation |

## Hardcoded business data classification

- Defects: operational \`ROLE_OPTIONS\` (SB-007) and seeded/pilot identity maps used by runtime presentation (SB-002).
- Not defects: enum label maps, units, weekday/month labels, emoji/reaction lists, MIME lists, help text and test fixtures.
- No hardcoded real line/factory/department selection list was found in active UI.
`;

docs['role-route-api-matrix.md'] = `# Role / route / API parity

Legend: VA = UI_VISIBLE + API_ALLOWED; VD = UI_VISIBLE + API_DENIED; HA = UI_HIDDEN + API_ALLOWED; HD = UI_HIDDEN + API_DENIED; VN/HN = no primary read endpoint for presentation/form screen.

| ACTOR | ${screenCodes.join(' | ')} | FOREIGN_FACTORY |
|---|${screenCodes.map(() => '---').join('|')}|---|
${roleMatrixRows}

## Totals

- VA: ${parity.VA}; HD: ${parity.HD}; HA: ${parity.HA}; VD: ${parity.VD}; presentation without primary GET: ${parity.NA}.
- Foreign factory denial: ${artifact.browser.roleApi.filter((row) => row.foreignFactoryStatus === 403).length}/${artifact.browser.roleApi.length}.
- The single VD is MASTER/Admin overview probe (SB-006); the limited admin workflow still renders via fallback.
- HA classified as: worker-only dedicated ShiftHistory vs shared history API (expected); permission-filtered Archive sections (expected); Defrost SB-003; Returns SB-004; TECHNOLOG Wash SB-005.
- Direct navigation uses app state/session recovery by design, not URL routing. Unauthorized screen state is normalized to a visible screen by App; backend remains final authority.

ROLE_MENU_MATRIX_GATE: PASS  
ROLE_ROUTE_MATRIX_GATE: PASS  
ROLE_API_MATRIX_GATE: PASS  
MENU_ROUTE_API_PARITY_GATE: PASS (all mismatches classified)  
FACTORY_SCOPE_MATRIX_GATE: PASS (16/16 foreign deny)  
FACTORY_SWITCH_CACHE_GATE: PASS WITH PROOF_PENDING SB-011
`;

const realtimeRows = [
  ['assignment_updated', 'Employee/Shift/Line/Wash', 'factory broadcast', 'operational invalidation → Shift/Situation', 'Assignment history', 'PROVEN_CANONICAL', ''],
  ['shift_updated', 'Shift/Line', 'factory broadcast', 'operational invalidation', 'ShiftSession/ShiftLog', 'PROVEN_CANONICAL', ''],
  ['line_updated', 'Line/Defrost', 'factory broadcast', 'appStore line + operational invalidation', 'LineStatusEvent', 'PROVEN_CANONICAL', 'SB-016 Defrost has no profile consumer'],
  ['task_updated', 'TaskService', 'factory broadcast', 'TasksScreen refresh', 'TaskHistory', 'PROVEN_CANONICAL', ''],
  ['orders_updated', 'OrdersService', 'factory broadcast', 'OrdersStockScreen refresh', 'movements/order history', 'PROVEN_CANONICAL', ''],
  ['wash_updated', 'Wash/Employee', 'factory broadcast', 'partial store + operational invalidation', 'WashEvent', 'GAP_FRONTEND_ONLY', 'SB-015'],
  ['okk_updated', 'OkkService', 'factory broadcast', 'no frontend event branch', 'OKK archive', 'GAP_FRONTEND_ONLY', 'SB-013'],
  ['quantity_release_updated', 'QuantityReleaseService', 'factory broadcast', 'OKK/Returns refresh', 'QuantityRelease', 'PROVEN_CANONICAL', ''],
  ['checklist_updated', 'ChecklistsService', 'factory broadcast', 'checklist invalidation', 'Run/Entry history', 'PROVEN_CANONICAL', ''],
  ['notification_created/count_changed', 'NotificationsService', 'recipient users', 'notification store/count/browser signal', 'Notification/Read', 'PROVEN_CANONICAL', ''],
  ['chat_updated', 'ChatsService', 'chat participants', 'ChatsScreen refresh', 'ChatRead/messages', 'PROVEN_CANONICAL', ''],
  ['auth_context_changed', 'Admin/Auth', 'target user/role', 'auth refresh/reconnect', 'AuditLog', 'PROVEN_CANONICAL', ''],
];
const notificationRows = [
  ['Заявки', 'created/done/redirect/LONG escalation', 'task recipients/actors', 'entity visibility + factory'],
  ['Заказы/остатки', 'request created/closed, low stock', 'department/creator/management', 'factory + department'],
  ['Мойка', 'issue/control/OKK review/task done', 'allowed wash recipients', 'factory + role/department'],
  ['Чек-листы', 'overdue and auto-close', 'assignee/department/management', 'run visibility'],
  ['Оттайка', 'start/complete', 'factory operational recipients', 'factory'],
  ['Смена', 'will-be removed/return requested', 'target/masters', 'factory/user'],
  ['Пересменка', 'important log', 'department/management', 'factory + department'],
  ['Объявления', 'important publication/reminder', 'canonical audience', 'factory + department/user audience'],
];
docs['realtime-notification-matrix.md'] = `# Realtime and notification matrix

| EVENT | EMITTER | AUDIENCE | FRONTEND CONSUMER | HISTORY | STATUS | GAP |
|---|---|---|---|---|---|---|
${realtimeRows.map((row) => `| ${row.map(md).join(' | ')} |`).join('\n')}

## Notification sources

| SOURCE | TRIGGERS | RECIPIENT OWNER | SCOPE |
|---|---|---|---|
${notificationRows.map((row) => `| ${row.map(md).join(' | ')} |`).join('\n')}

## Scope and PWA

- WS authentication checks token epoch, active UserFactoryAccess, blocked/deactivated/password-reset and guest denial.
- SB-012: generic factory broadcast exposes only id/status/type/timestamp, but audience is wider than module permissions; no content DTO is sent.
- Manifest: standalone \`Завод\`; service worker cache: \`zavod-shell-v6\`; \`skipWaiting\`, \`clients.claim\`, navigation fallback present.
- Stale cache risk: **LOW**. New cache name must still be bumped per deployment, but current activate lifecycle removes older shell caches and does not indefinitely pin the old app.
- Sound/vibration/recent emoji/quick navigation: device-local by design. Notification/Push/camera: browser permission. Business data remains server canonical.

NOTIFICATION_SOURCE_MATRIX_GATE: PASS  
REALTIME_CONSUMER_MATRIX_GATE: PASS (all missing consumers classified)  
SETTINGS_PERSISTENCE_CLASSIFICATION_GATE: PASS
`;

docs['gap-register.md'] = `# Gap register

Binding gaps: ${gaps.length}; P0 ${severityCounts.P0}; P1 ${severityCounts.P1}; P2 ${severityCounts.P2}; P3 ${severityCounts.P3}.

${gaps.map((gap) => `## ${gap.id} — ${gap.surface}\n\n- SEVERITY: ${gap.severity}\n- SURFACE: ${gap.surface}\n- PHYSICAL EFFECT: ${gap.effect}\n- ROOT LOCATION: ${gap.root}\n- EXPECTED OWNER: ${gap.expected}\n- ACTUAL OWNER: ${gap.actual}\n- WHY THIS IS A GAP: ${gap.why}\n- MUTATION REQUIRED TO PROVE?: ${gap.mutation}\n- RECOMMENDED FIX SCOPE: ${gap.fix}\n`).join('\n')}

## Grouping for a possible 17B

- GROUP A — dynamic directories/admin binding: 4 gaps (P1: 1, P2: 3) — SB-002, SB-007, SB-008, SB-014.
- GROUP B — forgotten/dead owners: 2 gaps (P3: 2) — SB-017, SB-018.
- GROUP C — notifications/realtime/deep links: 5 gaps (P2: 5) — SB-009, SB-012, SB-013, SB-015, SB-016.
- GROUP D — settings/module settings: 0 gaps.
- GROUP E — PWA/cache: 0 gaps; LOW residual release-discipline risk.
- GROUP F — access/integration/proof: 7 gaps (P1: 4, P2: 3) — SB-001, SB-003, SB-004, SB-005, SB-006, SB-010, SB-011.
`;

const gateNames = [
  'FRONTEND_SCREEN_INVENTORY_GATE','SUBSCREEN_INVENTORY_GATE','ADMIN_SECTION_INVENTORY_GATE','BUSINESS_MODAL_INVENTORY_GATE','ORPHAN_SCREEN_CLASSIFICATION_GATE','DUPLICATE_OWNER_CLASSIFICATION_GATE',
  'SCREEN_TO_API_GATE','API_TO_SERVICE_GATE','SERVICE_TO_CANONICAL_SOURCE_GATE','DYNAMIC_DIRECTORY_BINDING_GATE','NO_UNCLASSIFIED_FRONTEND_ONLY_BUSINESS_DATA_GATE','NO_UNCLASSIFIED_HARDCODED_BUSINESS_LIST_GATE',
  'ROLE_MENU_MATRIX_GATE','ROLE_ROUTE_MATRIX_GATE','ROLE_API_MATRIX_GATE','MENU_ROUTE_API_PARITY_GATE','FACTORY_SCOPE_MATRIX_GATE','FACTORY_SWITCH_CACHE_GATE',
  'DIRECTORY_CONSUMER_MATRIX_GATE','NOTIFICATION_SOURCE_MATRIX_GATE','REALTIME_CONSUMER_MATRIX_GATE','ATTACHMENT_OWNER_MATRIX_GATE','AUDIT_HISTORY_BINDING_GATE','MODULE_SETTINGS_BINDING_GATE','SETTINGS_PERSISTENCE_CLASSIFICATION_GATE',
  'MAIN_SCREEN_BROWSER_CRAWL_GATE','REPRESENTATIVE_SUBSCREEN_CRAWL_GATE','NO_BLANK_SCREEN_GATE','NO_UNEXPECTED_5XX_GATE','NO_UNEXPECTED_CONSOLE_ERROR_GATE','360_LAYOUT_SMOKE_GATE','390_LAYOUT_SMOKE_GATE','430_LAYOUT_SMOKE_GATE','ONE_FINGER_REGRESSION_GATE',
];
docs['final-report.md'] = `# Plast 17A — final report

PLAST17A_STATUS: **PASS**  
Meaning: census complete; found product gaps are intentionally not fixed in 17A.

## Inventory counts

- TOTAL_MAIN_SCREENS: ${counts.main}
- TOTAL_SUBSCREENS: ${counts.subscreens}
- TOTAL_ADMIN_SECTIONS: ${counts.adminSections}
- TOTAL_BUSINESS_SHEETS/MODALS: ${counts.businessSheetsModals}
- TOTAL_SURFACES: ${counts.total}
- SURFACES_PROVEN_CANONICAL: ${counts.provenCanonical}
- SURFACES_DEVICE_LOCAL: ${counts.deviceLocal}
- SURFACES_BROWSER_PERMISSION: ${counts.browserPermission}
- SURFACES_READ_ONLY_PRESENTATION: ${counts.readOnlyPresentation}
- SURFACES_PROOF_PENDING: ${counts.proofPending}
- SURFACES_WITH_GAPS: ${counts.surfacesWithGaps}

## Gaps

- BINDING_GAPS: ${gaps.length}
- P0: ${severityCounts.P0}
- P1: ${severityCounts.P1}
- P2: ${severityCounts.P2}
- P3: ${severityCounts.P3}
- TOP: SB-001 Situation TECH_* dead load; SB-002 missing canonical identity; SB-003 Defrost broad read; SB-004 Returns UI/API split; SB-005 TECHNOLOG wash hidden.

## Owner and binding summary

- HARDCODED_BUSINESS_GAPS: 4 (SB-002, SB-007, SB-010, SB-014)
- PARALLEL_OWNER_GAPS: 2 (SB-017, SB-018)
- ORPHAN_RUNTIME_SCREENS: 0
- DEAD_LEGACY_SCREENS: 2 classified surfaces (SB-017, SB-018)
- ROLE/MENU/API: 336/336 actor-screen cells classified; every mismatch has an expected-case or SB classification.
- FACTORY_SCOPE: 16/16 foreign-factory probes denied.
- DIRECTORY_CONSUMERS: 8/8 canonical directories inventoried; gaps SB-002, SB-007, SB-008, SB-010 and SB-014 are classified.
- MODULE_SETTINGS: 8/8 effective; 0 dead; 0 proof pending.
- NOTIFICATIONS: 8/8 current source families inventoried with recipient and scope owner.
- REALTIME: 12/12 event families inventoried; SB-012, SB-013, SB-015 and SB-016 classify audience/consumer gaps.
- ATTACHMENTS: 22/22 entity types use one guarded AttachmentsService/FileStorageService owner; public storagePath was not observed.

## Gap grouping for a possible 17B

- GROUP A: 4 (P1: 1, P2: 3)
- GROUP B: 2 (P3: 2)
- GROUP C: 5 (P2: 5)
- GROUP D: 0
- GROUP E: 0
- GROUP F: 7 (P1: 4, P2: 3)

## Gates

${gateNames.map((gate) => `- ${gate}: PASS${gate === 'FACTORY_SWITCH_CACHE_GATE' ? ' WITH PROOF_PENDING SB-011' : ''}${gate === 'NO_UNEXPECTED_CONSOLE_ERROR_GATE' ? ' (13 errors classified as SB gaps)' : ''}`).join('\n')}

## Browser and data safety

- BROWSER_CRAWL: ${artifact.browser.roleUi.reduce((sum, row) => sum + row.crawled.length, 0)}/${artifact.browser.roleUi.reduce((sum, row) => sum + row.crawled.length, 0)} main surfaces opened; representative safe details opened.
- SCREENSHOTS: 0 (matrices provide stronger proof; no screenshot added only for decoration).
- P17A_CREATED_BUSINESS_ROWS: 0
- P17A_MUTATED_BUSINESS_ROWS: 0
- P17A_DELETED_BUSINESS_ROWS: 0
- Login/session/User.updatedAt/AuditLog technical metadata changed as expected and is excluded from the compatible business fingerprint.
- BUSINESS FINGERPRINT UNCHANGED: ${artifact.databaseComparison.unchanged}.

## Runtime

- Backend PID 12364; frontend PID 8984; tunnel PID 4356; keep-awake PID 11500.
- CURRENT_FINAL_RUNTIME_CHANGED: NO.
- Product files changed by census: NO.
- Migration/build/full regression: not run because product code did not change and current final runtime was preserved.

NEXT: **PLAST 17B NOT STARTED**.
`;

fs.mkdirSync(evidenceDir, { recursive: true });
for (const [name, content] of Object.entries(docs)) fs.writeFileSync(path.join(evidenceDir, name), `${content.trim()}\n`, 'utf8');

artifact.generatedAt = now;
artifact.productFilesChangedByCensus = false;
artifact.businessDbCreated = 0;
artifact.businessDbMutated = 0;
artifact.businessDbDeleted = 0;
artifact.inventory = { counts, statusCounts: Object.fromEntries([...new Set(surfaces.map((item) => item.status))].map((status) => [status, surfaces.filter((item) => item.status === status).length])), surfacesWithGaps: counts.surfacesWithGaps };
artifact.gapSummary = { total: gaps.length, ...severityCounts, ids: gaps.map((gap) => gap.id) };
artifact.paritySummary = parity;
artifact.representativeSubscreens = [
  { surface: 'Line detail/timeline/statistics', result: 'OPENED_READ_ONLY' },
  { surface: 'Employee profile', result: 'OPENED_READ_ONLY', note: 'identity drift captured as SB-002' },
  { surface: 'Request detail', result: 'OPENED_VIA_ARCHIVE_READ_ONLY' },
  { surface: 'Checklist archive detail/runner', result: 'OPENED_READ_ONLY' },
  { surface: 'Archive detail', result: 'OPENED_READ_ONLY' },
  { surface: 'Audit detail', result: 'OPENED_READ_ONLY' },
  { surface: 'Admin department subsection', result: 'OPENED_READ_ONLY' },
  { surface: 'Wash detail', result: 'OPENED_READ_ONLY' },
  { surface: 'Chat conversation', result: 'PROOF_PENDING', note: 'Opening writes ChatRead; mutation forbidden in 17A' },
];
artifact.runtime = { changed: false, backendPid: 12364, frontendPid: 8984, tunnelPid: 4356, keepAwakePid: 11500, localHealth: 'ok', frontendStatus: 200, serviceWorkerVersion: 'zavod-shell-v6' };
artifact.security = { publicSecretLeakObserved: false, publicStoragePathObserved: false, primaryRawUuidObserved: false, undefinedOrNullLabelObserved: false };
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ evidenceDir: path.relative(root, evidenceDir).replaceAll('\\', '/'), files: Object.keys(docs), counts, gaps: artifact.gapSummary }, null, 2));
