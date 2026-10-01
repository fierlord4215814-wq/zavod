export const WS_EVENTS = {
  ASSIGNMENT_UPDATED: 'assignment_updated',
  SHIFT_UPDATED: 'shift_updated',
  LINE_UPDATED: 'line_updated',
  TASK_UPDATED: 'task_updated',
  ORDERS_UPDATED: 'orders_updated',
  WASH_UPDATED: 'wash_updated',
  OKK_UPDATED: 'okk_updated',
  STOCK_UPDATED: 'stock_updated',
  RETURNS_UPDATED: 'returns_updated',
  DEFROST_UPDATED: 'defrost_updated',
  QUANTITY_RELEASE_UPDATED: 'quantity_release_updated',
  CHECKLIST_UPDATED: 'checklist_updated',
  NOTIFICATION_CREATED: 'notification_created',
  NOTIFICATIONS_COUNT_CHANGED: 'notifications_count_changed',
  AUTH_CONTEXT_CHANGED: 'auth_context_changed',
  CHAT_UPDATED: 'chat_updated',
} as const;

export type WsEventType = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
}

export type FactoryWsEventType =
  | typeof WS_EVENTS.ASSIGNMENT_UPDATED
  | typeof WS_EVENTS.SHIFT_UPDATED
  | typeof WS_EVENTS.LINE_UPDATED
  | typeof WS_EVENTS.TASK_UPDATED
  | typeof WS_EVENTS.ORDERS_UPDATED
  | typeof WS_EVENTS.WASH_UPDATED
  | typeof WS_EVENTS.OKK_UPDATED
  | typeof WS_EVENTS.STOCK_UPDATED
  | typeof WS_EVENTS.RETURNS_UPDATED
  | typeof WS_EVENTS.DEFROST_UPDATED
  | typeof WS_EVENTS.QUANTITY_RELEASE_UPDATED
  | typeof WS_EVENTS.CHECKLIST_UPDATED;

export const FACTORY_WS_EVENT_CAPABILITIES: Readonly<Record<FactoryWsEventType, readonly string[]>> = {
  [WS_EVENTS.ASSIGNMENT_UPDATED]: [
    'assignments.manage',
    'shift.self.read',
    'shift.current.read',
    'shift.future.read',
    'shift.past.read',
  ],
  [WS_EVENTS.SHIFT_UPDATED]: [
    'assignments.manage',
    'shift.self.read',
    'shift.current.read',
    'shift.future.read',
    'shift.past.read',
  ],
  [WS_EVENTS.LINE_UPDATED]: ['lines.read'],
  [WS_EVENTS.TASK_UPDATED]: ['tasks.read'],
  [WS_EVENTS.ORDERS_UPDATED]: ['orders.read'],
  [WS_EVENTS.WASH_UPDATED]: ['wash.read'],
  [WS_EVENTS.OKK_UPDATED]: ['okk.read'],
  [WS_EVENTS.STOCK_UPDATED]: ['stock.read'],
  [WS_EVENTS.RETURNS_UPDATED]: ['returns.publication.read'],
  [WS_EVENTS.DEFROST_UPDATED]: ['defrost.read', 'defrost.manage', 'defrost.calendar.read'],
  [WS_EVENTS.QUANTITY_RELEASE_UPDATED]: ['okk.read', 'returns.read', 'returns.publication.read'],
  [WS_EVENTS.CHECKLIST_UPDATED]: [
    'checklists.templates.read',
    'checklists.runs.read',
    'checklists.runs.self',
    'checklists.archive.read',
  ],
};

export function isFactoryWsEvent(type: string): type is FactoryWsEventType {
  return Object.prototype.hasOwnProperty.call(FACTORY_WS_EVENT_CAPABILITIES, type);
}
