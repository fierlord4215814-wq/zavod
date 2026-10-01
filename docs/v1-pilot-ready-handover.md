# Завод v1.0 — Pilot Ready handover

Дата snapshot: 13.06.2026.

## Итоговый статус

«Завод v1.0 — Pilot Ready» достигнут по completion evidence от 13.06.2026.

Это означает, что по текущим документированным проверкам и live evidence нет открытых P0/P1, которые блокируют ручной pilot/handover. Следующий шаг — не новый stage и не новая разработка, а ручная проверка с реальными пользователями и данными.

## Готовые крупные контуры

- Смены: текущая, следующая, будущие и прошлые смены разделены по смыслу.
- Линии: рабочий контур, действия, планирование и read-only прошлые смены.
- Заявки и простои: создание, связь простоя с заявкой, архивные источники и аналитика.
- Чек-листы: библиотека, взятие в работу, guided run, отчёты и архив.
- Чаты: внутренний messenger-контур с доступами, вложениями и mobile UX.
- Объявления: fullscreen reading, per-user acknowledgement и журнал ознакомления.
- Архив: единый архив, источники, файлы и read-only исторические срезы.
- ОКК, возвраты, некондиция, заказы/остатки: рабочие журналы и архив.
- Мойка: события, контроль, OKK review, оценка и вложения.
- Оттайка: календарь и профильные проверки.
- Пересменка: журнал и связка с прошлой сменой.
- Статистика/аудит: operational analytics и человекочитаемый audit UI.
- Админка: factory context, пользователи с доступом, отделы/службы, линии, позиции, настройки и audit.

## Пройденные проверки

- Backend build.
- Frontend build.
- Prisma validate.
- Prisma migrate status.
- Seed syntax check.
- Stage30 release readiness regression.
- Affected backend regression gates.
- Browser E2E desktop/mobile для ключевых контуров.
- Security/UI scans: no `storagePath`, `passwordHash`, tokens, secrets, raw audit UI, mojibake, prompt/alert/confirm in checked runtime surfaces.

## Закрытые проблемы

- Raw audit UI: обычному MANAGEMENT-пользователю больше не показывается raw audit log как основной пользовательский текст; добавлен человекочитаемый summary, исходный audit storage не переписан.
- Mobile admin overflow: подтверждённый overflow в мобильной админке закрыт, task-oriented navigation сохранена.
- Archive/runtime recovery/test noise: marker-backed recovery/Stage/demo/test данные убраны из обычных archive/runtime options без физического удаления истории.
- P3 sheet «Ещё»: воспроизведён и не подтверждён как продуктовый баг; после перехода sheet закрывается корректно.

## Открытые P0/P1

Открытых P0/P1 по текущему completion evidence нет.

## Остатки, не блокирующие pilot

- Ручные тестовые сообщения пользователя в общем чате (`ыфвфывфыв` / `фывфывфы`) подтверждены пользователем как ручные тестовые данные. Это не fixture leak, не баг фильтрации и не блокер Pilot Ready. Перед демонстрацией/пилотом пользователь может вручную очистить конкретные сообщения, если захочет.
- Админка остаётся крупной и насыщенной, но рабочей; подтверждённый mobile blocker закрыт.
- Future-идеи: более богатый BI, PDF/export отчёты, realtime chat, conditional checklist branching, advanced roles/job titles, Stage68, backup/restore, installer.

## Не входит в v1.0

- Stage68.
- Backup/restore.
- Installer/установка.
- ERP/1С.
- Цены, партии, себестоимость.
- Новые бизнес-модули.
- Новый feature development без отдельного решения пользователя.

## Что делать дальше

1. Провести ручной pilot/handover на телефоне с реальными пользователями и данными.
2. Проверить фактические смены, линии, людей, назначения, заявки, чек-листы, чаты, объявления, архив и админку в реальном сценарии.
3. Фиксировать только реальные pilot feedback bugs: P0/P1 сразу, P2/P3 как pilot observations/future backlog.
4. Не начинать новый feature development, Stage68, backup/restore или установку без отдельного решения пользователя.

## Evidence

- `docs/v1-completion-audit.md`
- `docs/v1-completion-goal.md`
- `docs/v1-live-ui-evidence-screenshots/`
- `docs/v1-completion-screenshots/`

## Ключевые команды и проверки

Команды ниже зафиксированы в `docs/v1-completion-audit.md` как evidence для статуса:

- `npm.cmd run build --workspace backend`
- `npm.cmd run build --workspace frontend`
- `npm.cmd run prisma:validate --workspace backend`
- `npm.cmd run prisma:migrate:status --workspace backend`
- `node --check backend/prisma/seed.js`
- `npm.cmd run stage30:release-readiness-regression --workspace backend`
- `npm.cmd run stage40a:archive-center-regression --workspace backend`
- `npm.cmd run stage42:operational-closure-regression --workspace backend`
- `npm.cmd run stage43:mobile-attachments-regression --workspace backend`
- `npm.cmd run stage48:shift-timeline-planning-regression --workspace backend`
- `npm.cmd run stage49:past-shift-archive-regression --workspace backend`
- `npm.cmd run stage52:fullscreen-announcements-regression --workspace backend`
- `npm.cmd run stage62:product-completeness-audit-regression --workspace backend`
- `npm.cmd run stage65:checklist-final-polish-regression --workspace backend`
- `npm.cmd run stage66:checklist-reports-regression --workspace backend`
- `npm.cmd run stage67:operational-analytics-regression --workspace backend`
- `npm.cmd run e2e:stage40a --workspace frontend`
- `npm.cmd run e2e:stage42 --workspace frontend`
- `npm.cmd run e2e:stage43 --workspace frontend`
- `npm.cmd run e2e:stage48 --workspace frontend`
- `npm.cmd run e2e:stage49 --workspace frontend`
- `npm.cmd run e2e:stage52 --workspace frontend`
- `npm.cmd run e2e:stage62 --workspace frontend`
- `npm.cmd run e2e:stage65 --workspace frontend`
- `npm.cmd run e2e:stage66 --workspace frontend`
- `npm.cmd run e2e:stage67 --workspace frontend`
- `npm.cmd run e2e:stage56a_1 --workspace frontend`

Также выполнены targeted scans на:

- `prompt(`, `alert(`, `confirm(`;
- mojibake;
- visible English placeholders/raw technical text;
- `storagePath`, `passwordHash`, tokens, secrets.

## Handover note

Этот документ является snapshot после completion goal. Он не заменяет реальный ручной pilot, а фиксирует, что проект готов к нему без нового feature development.
