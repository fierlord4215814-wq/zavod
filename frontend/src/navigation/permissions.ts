export type Screen = 'Home' | 'Shift' | 'ShiftHistory' | 'People' | 'Admin' | 'Situation' | 'Tasks' | 'Wash' | 'OKK' | 'Stock' | 'Orders' | 'Checklists' | 'Defrost' | 'Returns' | 'Log' | 'Chats' | 'Announcements' | 'Archive' | 'Notifications' | 'Ops' | 'Report';

export type ScreenCode = 'home' | 'shift' | 'shift-history' | 'people' | 'admin' | 'situation' | 'tasks' | 'wash' | 'okk' | 'stock' | 'orders' | 'checklists' | 'returns' | 'log' | 'defrost' | 'chats' | 'announcements' | 'archive' | 'notifications' | 'ops' | 'report';

export type NavIconName =
  | 'home'
  | 'shift'
  | 'people'
  | 'admin'
  | 'lines'
  | 'tasks'
  | 'wash'
  | 'quality'
  | 'stock'
  | 'orders'
  | 'checklists'
  | 'defrost'
  | 'returns'
  | 'log'
  | 'chats'
  | 'announcements'
  | 'archive'
  | 'notifications'
  | 'ops'
  | 'report'
  | 'settings'
  | 'more';

export type ScreenDefinition = { id: Screen; code: ScreenCode; label: string; icon: NavIconName };

export const SCREEN_DEFINITIONS: ScreenDefinition[] = [
  { id: 'Home', code: 'home', label: 'Главная', icon: 'home' },
  { id: 'Shift', code: 'shift', label: 'Смена', icon: 'shift' },
  { id: 'ShiftHistory', code: 'shift-history', label: 'История смен', icon: 'archive' },
  { id: 'People', code: 'people', label: 'Люди', icon: 'people' },
  { id: 'Admin', code: 'admin', label: 'Админка', icon: 'admin' },
  { id: 'Situation', code: 'situation', label: 'Линии', icon: 'lines' },
  { id: 'Tasks', code: 'tasks', label: 'Заявки', icon: 'tasks' },
  { id: 'Wash', code: 'wash', label: 'Мойка', icon: 'wash' },
  { id: 'OKK', code: 'okk', label: 'ОКК', icon: 'quality' },
  { id: 'Stock', code: 'stock', label: 'Некондиция', icon: 'stock' },
  { id: 'Orders', code: 'orders', label: 'Заказы / Остатки', icon: 'orders' },
  { id: 'Checklists', code: 'checklists', label: 'Чек-листы', icon: 'checklists' },
  { id: 'Defrost', code: 'defrost', label: 'Оттайка', icon: 'defrost' },
  { id: 'Returns', code: 'returns', label: 'Возвраты на производство', icon: 'returns' },
  { id: 'Log', code: 'log', label: 'Пересменка / Журнал', icon: 'log' },
  { id: 'Chats', code: 'chats', label: 'Чаты', icon: 'chats' },
  { id: 'Announcements', code: 'announcements', label: 'Объявления', icon: 'announcements' },
  { id: 'Archive', code: 'archive', label: 'Архив', icon: 'archive' },
  { id: 'Notifications', code: 'notifications', label: 'Уведомления', icon: 'notifications' },
  { id: 'Ops', code: 'ops', label: 'Статистика / Аудит', icon: 'ops' },
  { id: 'Report', code: 'report', label: 'Сообщить об ошибке', icon: 'report' },
];

const SCREEN_PERMISSIONS: Record<ScreenCode, string[]> = {
  home: [],
  shift: ['shift.self.read', 'shift.current.read', 'shift.future.read', 'assignments.manage'],
  'shift-history': ['shift.self.read'],
  people: ['people.profile.read', 'people.read', 'shift.self.read'],
  admin: [
    'admin.overview.read',
    'admin.users.read',
    'admin.users.manage',
    'admin.roles.read',
    'admin.factories.read',
    'admin.departments.read',
    'admin.lines.read',
    'admin.read',
    'config.read',
  ],
  situation: ['lines.read'],
  tasks: ['tasks.read'],
  wash: ['wash.read'],
  okk: ['okk.read'],
  stock: ['stock.read'],
  orders: ['orders.read'],
  checklists: ['checklists.templates.read', 'checklists.runs.self', 'checklists.runs.read'],
  returns: ['returns.publication.read'],
  log: ['shift-log.read'],
  defrost: ['defrost.read', 'defrost.manage'],
  chats: ['chats.access'],
  announcements: ['announcements.read'],
  archive: [
    'tasks.read',
    'checklists.archive.read',
    'checklists.runs.read',
    'checklists.runs.self',
    'okk.read',
    'returns.read',
    'stock.read',
    'orders.read',
    'wash.read',
    'defrost.read',
    'shift-log.archive.read',
    'shift-log.read',
    'announcements.archive.read',
    'announcements.read',
    'chats.read',
  ],
  notifications: ['notifications.read'],
  ops: ['ops.overview.read', 'ops.events.read', 'ops.audit.read', 'ops.statistics.read'],
  report: [],
};

export function canShowScreen(
  screenCode: ScreenCode,
  permissions: string[],
  _role: string,
  isGuest: boolean,
): boolean {
  if (isGuest) return screenCode === 'home' || screenCode === 'report';
  if (screenCode === 'home') return false;

  const required = SCREEN_PERMISSIONS[screenCode] ?? [];
  return required.length === 0 || required.some((permission) => permissions.includes(permission));
}

export function roleHomeScreen(visibleScreens: ScreenDefinition[], role: string, isGuest: boolean): Screen {
  if (isGuest) return visibleScreens.some((item) => item.id === 'Home') ? 'Home' : visibleScreens[0]?.id ?? 'Home';
  if (visibleScreens.some((item) => item.id === 'Shift')) return 'Shift';
  if (role === 'ADMIN' && visibleScreens.some((item) => item.id === 'Admin')) return 'Admin';
  return visibleScreens[0]?.id ?? 'Shift';
}

export function defaultQuickScreenIds(visibleScreens: ScreenDefinition[], home: Screen): Screen[] {
  const allowed = new Set(visibleScreens.map((item) => item.id));
  const preferred: Screen[] = [home, 'Situation', 'Tasks', 'Checklists', 'Chats', 'People'];
  return [...new Set(preferred.filter((id) => allowed.has(id)))]
    .concat(visibleScreens.map((item) => item.id).filter((id) => !preferred.includes(id)))
    .slice(0, 4);
}
