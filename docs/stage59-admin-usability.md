# Stage59 — Admin Usability Cleanup / Guided Configurator UX

## Discovery Result

Админка уже имела рабочие контуры Stage53/56/57/58:

- выбранный завод и `/admin/factories/:id/context`;
- пользователи с доступом через `UserFactoryAccess`;
- локальные отделы и общие службы;
- линии, позиции, шаблоны состава и рабочие зоны;
- foundation должностей;
- русские label helpers для ролей и прав;
- проверку готовности `/admin/factories/:id/config-health`;
- мастер создания завода;
- экспорт/импорт JSON-конфигурации без runtime/history/users/secrets;
- аудит важных admin-действий.

Проблема была не в отдельном endpoint, а в плотности UI: плоский ряд разделов, стена предупреждений готовности, много одинаково важных кнопок и слабый первый шаг для пользователя, который не является разработчиком.

## Migration

Миграция не нужна. Stage59 использует существующие модели и endpoint'ы. Backend guards остаются источником истины.

## Что Изменено

### Guided Overview

Стартовый раздел админки теперь `Обзор`. Он показывает:

- выбранный завод;
- краткие счетчики по контексту завода;
- быстрые задачи `Что нужно настроить?`;
- сгруппированную готовность завода.

### Task-Based Navigation

Плоская навигация заменена на смысловые группы:

- Завод;
- Люди;
- Производство;
- Безопасность и модули.

Старые разделы не удалены. Пользователь просто получает более понятный вход в те же рабочие контуры.

### Quick Actions

Добавлены карточки быстрых действий:

- создать завод;
- добавить линию;
- настроить шаблон состава;
- добавить рабочую зону;
- создать должность;
- выдать доступ;
- настроить права;
- проверить готовность.

Карточки ведут в существующие секции, без новых routes и без дублирования модулей.

### Config Health

Проверка готовности больше не выглядит как бесконечный список предупреждений. Замечания группируются по смыслу:

- Линии и позиции;
- Пользователи и доступы;
- Шаблоны состава;
- Настройки модулей;
- Рабочие зоны;
- Должности;
- Прочее.

На первом экране показываются главные группы. Детали раскрываются кнопкой `Показать список`.

### Permission Labels

В `Роли и права` первичным текстом стали русские названия и короткие описания прав. Технические коды показываются только в режиме `Расширенно`.

Примеры:

- `admin.departments.manage` -> `Управление отделами`;
- `announcements.archive.read` -> `Просмотр архива объявлений`;
- `assignments.manage` -> `Управление назначениями`;
- `tasks.redirect` -> `Передача заявки`;
- `wash.control.manage` -> `Управление контролем мойки`.

Поиск сохраняет возможность работать и по русскому названию, и по коду.

### Human Hints

В конфигурационных формах добавлены короткие русские подсказки:

- линия — производственная линия завода, не повременщики;
- позиция — место в составе линии;
- шаблон состава — план людей для запуска линии;
- рабочая зона — повременщики или отдельная зона вне производственной линии;
- должность — понятная роль сотрудника внутри завода;
- право — доступ к действию, backend guard остается источником истины.

### Mobile UX

Проверена мобильная верстка 360px:

- навигация переносится карточками;
- быстрые действия не создают горизонтальный overflow;
- health groups читаются карточками;
- права не превращаются в raw RBAC matrix;
- bottom nav не перекрывает desktop-admin content.

## Что Не Трогалось

- Не создавался новый admin module.
- Не менялась модель RBAC.
- Не добавлялись custom roles/job titles beyond existing foundation.
- Не менялись Stage56/57/58 backend endpoints.
- Не было DB reset, destructive migration или physical delete.
- Не менялась бизнес-логика заводов, линий, должностей и доступа.

## RBAC / Security

Stage59 не расширяет доступ. Все действия проходят через существующие backend guards:

- `UserFactoryAccess`;
- factory scope;
- admin permissions;
- blocked/cross-factory denial;
- last-admin guard.

UI только делает путь понятнее. Он не является источником прав.

## Audit

Новые UI-действия используют существующие admin endpoints, поэтому важные действия продолжают писать audit:

- создание/изменение завода;
- создание/изменение линий и позиций;
- создание/изменение шаблонов состава;
- создание/изменение рабочих зон;
- выдача доступа;
- просмотр health/config context;
- импорт/экспорт конфигурации.

## Regression Checklist

Stage59 regression проверяет:

- admin получает factory context;
- config health доступен и группируется;
- permissions endpoint возвращает данные для русских labels;
- экспорт/preview импорт работают без записи preview в БД;
- базовые admin create flows не сломаны;
- non-admin/blocked denied;
- нет `storagePath`, `passwordHash`, `tokens`, secrets в admin responses.

## Browser Checklist

Stage59 Playwright проверяет:

- desktop overview;
- task-based navigation;
- quick action routing;
- grouped health;
- human-readable permissions;
- export/import доступность;
- mobile 360px overview/health/permissions;
- no prompt/alert/confirm;
- no mojibake;
- no visible English placeholders;
- no `storagePath` in UI.

## Screenshots

- `docs/stage59-admin-usability-screenshots/01-admin-overview-desktop.png`
- `docs/stage59-admin-usability-screenshots/02-admin-quick-actions-desktop.png`
- `docs/stage59-admin-usability-screenshots/03-admin-structure-section-desktop.png`
- `docs/stage59-admin-usability-screenshots/04-admin-health-grouped-desktop.png`
- `docs/stage59-admin-usability-screenshots/05-admin-permissions-human-readable.png`
- `docs/stage59-admin-usability-screenshots/06-admin-export-import-clean.png`
- `docs/stage59-admin-usability-screenshots/07-admin-mobile-overview.png`
- `docs/stage59-admin-usability-screenshots/08-admin-mobile-health.png`
- `docs/stage59-admin-usability-screenshots/09-admin-mobile-permissions.png`

## Future

- Guided wizard for first-time admins with step-by-step completion state.
- Deeper custom roles/job titles architecture.
- Safer bulk edit flows for positions and templates.
- Import/export diff viewer with side-by-side changes.
- Code splitting for frontend bundle size.
