# Stage 35 — UX / Safety / Notifications / Role Holes Hardening

## Discovery

Проверены существующие участки:

- навигация и список экранов в `frontend/src/App.tsx`;
- общий `ActionModal`;
- экран линий `SituationScreen`;
- экран уведомлений `NotificationsScreen`;
- Stage31–34 Playwright setup и browser specs;
- backend guards уже покрываются Stage28, Stage34 и профильными regressions.

Новые модули, routes, permissions и таблицы не добавлялись.

## Line UX

Раздел «Линии» теперь работает как рабочий список:

- основной экран показывает «Активные линии»;
- остановленные и пустые линии не засоряют основной список;
- неактивные линии доступны через действие «Запустить линию»;
- запуск линии открывает безопасный modal выбора;
- карточка линии открывает локальный дашборд линии;
- смена статуса выполняется через confirmation modal;
- «Простой» и «Остановить» требуют комментарий.

Детальное назначение людей, гибкие слоты, мойка, заявка и выполнение плана остаются в сменном/линейном рабочем контуре, без большого редизайна.

## Safety

На Stage35 усилены самые заметные accidental-click риски в разделе линий:

- запуск линии требует подтверждения;
- возврат в работу требует подтверждения;
- простой требует комментарий;
- остановка требует комментарий;
- `window.alert`, `window.confirm`, `window.prompt` не используются.

Остальные опасные действия уже проходят через существующие `ActionModal`/safe modal flows: архив, полное завершение, заявки, ОКК, возвраты, настройки, чек-листы.

## Role / Department Holes

Backend guards остаются источником истины. На Stage35 browser gate дополнительно проверяет:

- `WORKER` не видит администрирование, линии, аудит, ОКК и управленческие действия;
- `CONTRACTOR_LEAD` не видит администрирование, линии и assignment board;
- управленческие элементы в UI не показываются неподходящим ролям.

Глубокие backend checks остаются в Stage28, Stage34 и профильных backend regressions.

## Notifications UX

Экран уведомлений усилен:

- группы «Новые», «Сегодня», «Ранее»;
- severity labels: «Важно», «Внимание», «Информация»;
- счётчик важных непрочитанных уведомлений;
- `read-all` остаётся доступен только когда есть непрочитанные;
- пустое состояние: «Уведомлений нет.»;
- чаты не создают обычный notification spam.

Backend dedupe для видимых уведомлений был уже добавлен на Stage34 и остаётся активным: один и тот же event/entity не должен показываться пользователю дублем.

## Sound Notifications

Добавлен осторожный browser-only foundation:

- переключатель «Звук уведомлений: включён/выключен»;
- кнопка «Проверить звук»;
- короткий Web Audio API beep без внешних аудио-файлов;
- звук предназначен только для критичных непрочитанных уведомлений;
- первый запуск звука происходит только после пользовательского действия.

Звук не включается для каждого chat message, read marker или обычного info-события.

## Playwright

Добавлен:

- `frontend/e2e/stage35-ux-safety-notifications.spec.ts`;
- `frontend/scripts/stage35-playwright-e2e.js`;
- root script `stage35:browser-e2e`;
- frontend script `e2e:stage35`.

Проверки:

- active lines list;
- запуск линии через modal;
- dangerous status action через modal;
- worker/contractor lead role visibility;
- уведомления, группы, read-all, sound toggle;
- mobile 360px по линиям, смене, уведомлениям, ОКК, возвратам, чатам;
- русский UI, отсутствие mojibake и browser dialogs.

## What Remains Manual

Stage22 manual browser/device pass всё ещё нужен:

- реальный телефон;
- ощущение PWA/offline;
- физическая камера/файлы;
- субъективная удобность длинной смены.

## Regression Checklist

```powershell
npm.cmd run stage31:browser-e2e
npm.cmd run stage32:browser-e2e
npm.cmd run stage33:browser-e2e
npm.cmd run stage34:browser-e2e
npm.cmd run stage35:browser-e2e
npm.cmd run build --workspace frontend
npm.cmd run build --workspace backend
npm.cmd run stage30:release-readiness-regression --workspace backend
node --check backend/prisma/seed.js
rg "window\.(prompt|alert|confirm)|\balert\(" frontend/src frontend/public
targeted mojibake scan over frontend/src frontend/public docs
```
