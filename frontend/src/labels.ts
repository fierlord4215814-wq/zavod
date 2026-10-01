export const roleLabels: Record<string, string> = {
  ADMIN: 'Администратор',
  MANAGEMENT: 'Руководство',
  MASTER: 'Мастер',
  WORKER: 'Работник',
  CONTRACTOR: 'Наёмный работник',
  CONTRACTOR_LEAD: 'Старший наёмных работников',
  OKK: 'ОКК',
  TECHNOLOG: 'Технолог',
  STORE: 'Склад',
  TECH_HOLOD: 'Холодильная служба',
  TECH_KIPIA: 'КИПиА',
  TECH_ELECTRIC: 'Электрик',
  TECH_MECHANIC: 'Механик',
  TECH_SANTECHNIK: 'Сантехник',
  OTHER: 'Другое',
};

export const taskStatusLabels: Record<string, string> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  DONE: 'Готово',
  new: 'Новая',
  taken: 'В работе',
  completed: 'Готово',
};

export const taskTypeLabels: Record<string, string> = {
  URGENT: 'Срочная',
  LONG: 'Долгая',
};

export const lineStatusLabels: Record<string, string> = {
  WORK: 'Работает',
  WORKING: 'Работает',
  PAUSE: 'Простой',
  STOP: 'Остановлена',
};

export const washStatusLabels: Record<string, string> = {
  STARTED: 'Мойка идёт',
  IN_PROGRESS: 'Мойка идёт',
  ISSUE: 'Проблема',
  RESOLVING: 'Решается',
  DONE: 'Завершено',
  COMPLETED: 'Завершено',
};

export const checklistRunStatusLabels: Record<string, string> = {
  ACTIVE: 'Активен',
  PAUSED: 'На паузе',
  CLOSED: 'Закрыт',
  AUTO_CLOSED: 'Автозакрыт',
};

export const checklistRowStatusLabels: Record<string, string> = {
  PENDING: 'Ожидает',
  OK: 'ОК',
  NA: 'Не применимо',
  ISSUE: 'Проблема',
};

export const orderStatusLabels: Record<string, string> = {
  ACTIVE: 'Активная',
  ORDERED: 'Заказано',
  NOT_NEEDED: 'Не нужно',
  CLOSED_RESERVED: 'Закрыта',
};

export const orderSourceLabels: Record<string, string> = {
  AUTO_FROM_STOCK: 'Из остатка',
  MANUAL: 'Ручная',
};

export const defrostStatusLabels: Record<string, string> = {
  ACTIVE: 'Активна',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
};

export const shiftLogStatusLabels: Record<string, string> = {
  ACTIVE: 'Активная',
  CLOSED: 'Закрыта',
  ARCHIVED: 'Архив',
};

export const chatTypeLabels: Record<string, string> = {
  FACTORY: 'Общий чат',
  DEPARTMENT: 'Чат отдела',
  MANAGEMENT: 'Руководство',
  SYSTEM: 'Системный',
  CUSTOM: 'Настраиваемый',
};

export const chatMessageKindLabels: Record<string, string> = {
  USER: 'Сообщение',
  SYSTEM: 'Системное',
};

export const announcementPriorityLabels: Record<string, string> = {
  NORMAL: 'Обычное',
  IMPORTANT: 'Важно',
};

export const employeeStateLabels: Record<string, string> = {
  AVAILABLE: 'Свободен',
  ASSIGNED: 'На линии',
  WASHING: 'Мойка',
  TIME_ROLE: 'Повременщик',
  OFF_SHIFT: 'Отправлен домой',
};

export const skillLevelLabels: Record<string, string> = {
  none: 'Нет опыта',
  some: 'Есть опыт',
  experienced: 'Опытный',
};

export function displayLabel(labels: Record<string, string>, value?: string | null) {
  if (!value) return '—';
  return labels[value] ?? value;
}

export function roleLabel(role?: string | null) {
  return displayLabel(roleLabels, role);
}
