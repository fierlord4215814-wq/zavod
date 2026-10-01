# Stage 38 — Mobile Navigation Shell

## Discovery

Проверено:

- `frontend/src/App.tsx`;
- `frontend/src/navigation/permissions.ts`;
- `frontend/src/styles.css`;
- текущие `stage31`-`stage37` Playwright specs/scripts;
- root/frontend package scripts.

Существующий navigation source сохранён: экран берётся из общего массива `screens`, доступность остаётся через `canShowScreen(...)`. Второй Playwright setup не создавался.

## Mobile Top Menu

На ширине до `768px` появляется верхнее быстрое меню:

- `Смена`;
- `Люди`;
- `Уведомления`;
- `Чек-листы`;
- `Объявления`.

Пункт показывается только если он доступен текущей роли. Для уведомлений сохраняется unread badge.

Desktop/tablet шире `768px` оставлен на прежней нижней навигации.

## Bottom Sheet

На mobile старая перегруженная нижняя навигация скрыта визуально. Вместо неё показана компактная кнопка `Ещё`.

Шторка открывает остальные доступные разделы:

- Линии;
- Заявки;
- Мойка;
- Чаты;
- ОКК;
- Некондиция;
- Возвраты на производство;
- Заказы / Остатки;
- Оттайка;
- Пересменка / Журнал;
- Статистика / Аудит;
- Администрирование;
- другие доступные пункты, если они есть у роли.

Закрытие:

- кнопка `Закрыть`;
- клик вне панели;
- выбор пункта меню.

## RBAC / Visibility

Backend не менялся. Frontend visibility по-прежнему удобство, источник истины остаётся backend guard.

Проверено:

- ADMIN видит все доступные пункты;
- MASTER не видит администрирование;
- WORKER не видит управленческие разделы;
- STORE видит складские разделы;
- OKK видит ОКК и доступную мойку;
- запрещённые пункты не попадают в mobile sheet.

## Mobile UX

Кнопки сделаны крупными для пальца, длинные названия переносятся внутри карточек, нижняя шторка не должна давать горизонтальный overflow на 360px.

Offline pill/logout остаются в верхней панели.

## Regression

Добавлено:

- `frontend/e2e/stage38-mobile-navigation.spec.ts`;
- `frontend/scripts/stage38-playwright-e2e.js`;
- root script `stage38:browser-e2e`;
- frontend script `e2e:stage38`.

Проверки Stage38:

- mobile 360px ADMIN: quick menu + bottom sheet;
- mobile 360px MASTER;
- mobile 360px WORKER;
- mobile 360px STORE/OKK;
- notification badge if unread count exists;
- forbidden menu items hidden;
- sheet open/close;
- no horizontal overflow;
- no mojibake / visible English placeholders;
- no prompt/alert/confirm.

Совместимость старых browser smoke:

- Stage31, Stage32, Stage33, Stage34 и Stage35 E2E helpers теперь умеют на mobile открывать раздел через `Ещё`, если пункт не находится в верхнем быстром меню;
- продуктовая навигация не расширялась ради старых тестов: быстрый верхний доступ остался только для основных разделов, остальные пункты остаются в шторке;
- Stage31-Stage38 Playwright проверки прошли после обновления helpers.

## Temporary / Manual

Реальный свайп вниз не добавлялся отдельно: закрытие через кнопку, backdrop и выбор пункта. Реальный device pass всё ещё нужен для проверки ощущения пальцем на телефоне.
