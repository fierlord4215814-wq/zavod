# Stage69 — Pilot Readiness Final Smoke / Freeze

Дата проверки: 15.06.2026.

Статус: финальный smoke после Stage68 выполнен. Статус `Завод v1.0 — Pilot Ready` сохраняется.

## Что проверено

- Backend:
  - `npm.cmd run build --workspace backend` — зелёный.
  - `npm.cmd run prisma:validate --workspace backend` — зелёный.
  - `/health` на свежем локальном backend — `200 OK`.
  - Stage30 release-readiness — зелёный после очистки runbook-примера от учебного URI.
- Frontend:
  - `npm.cmd run build --workspace frontend` — зелёный.
  - Vite предупреждает о большом основном chunk, но это не runtime failure.
  - Приложение открыто на `http://127.0.0.1:5173/`, пустого экрана нет.
- Browser smoke:
  - Desktop: основные экраны admin/management/master/store/worker открываются без blank screen, raw error, видимых UUID как основного текста, `storagePath` или secret values.
  - Mobile 360px: быстрые рабочие экраны, объявления, чек-листы, смена и админка открываются без horizontal overflow.
  - Mobile admin: вход через выбор завода показывает рабочий `Завод 4`, Stage/test/demo factories скрыты из ordinary factory selector.
- Роли:
  - `test-admin`: видит админку и управленческие разделы.
  - `test-management`: видит управленческие рабочие разделы и статистику/аудит.
  - `test-master`: видит смену, линии, заявки, мойку, чек-листы, журнал, чаты, объявления, архив.
  - `test-store`: видит складские сценарии без Stage/test stock noise после фикса.
  - `worker-1`: не видит админку; видит ограниченный набор рабочих разделов.
- Вложения:
  - Существующий attachment через guarded endpoint вернул metadata без `storagePath`.
  - Файл отдался по правам через `/attachments/:id/file`.
- Read-only/targeted gates:
  - `node backend/scripts/stage69-pilot-readiness-smoke-regression.js` — 8 passed, 0 failed.
  - `npm.cmd run stage62:product-completeness-audit-regression --workspace backend` — 24 passed, 0 failed.
  - `npm.cmd run stage30:release-readiness-regression --workspace backend` — 58 passed, 0 failed.

## Найденные проблемы и исправления

### Stage/test noise в “Некондиции”

Факт: при browser smoke под ролью `test-store` ordinary runtime экран “Некондиция” показывал записи вида `stage8 stock ...`.

Причина: `StockService.listDefects()` отдавал `StockDefect` без существующего pilot visibility marker-фильтра. Архивный stock-раздел имел тот же риск.

Исправлено:

- `backend/src/modules/stock/stock.service.ts` — обычный список `/stock` фильтрует записи с `hasPilotFixtureMarker`.
- `backend/src/modules/archive/archive.service.ts` — `loadStock()` фильтрует такие записи в ordinary archive stock runtime.

Важно: записи не удалялись, БД не менялась, история остаётся доступной для диагностики/админского разбора.

### Stage/test factories в выборе завода

Факт: на mobile 360px `test-admin` видел длинный список Stage/test/demo заводов на экране выбора завода до входа в рабочий контекст.

Исправлено:

- `frontend/src/screens/FactorySelectScreen.tsx` — ordinary factory selector скрывает Stage/test/demo factory options через существующий `isPilotFixtureText`, а также очевидные технические варианты, где и название, и код являются только числами.

Важно: backend-доступы и `UserFactoryAccess` не менялись. Это только очистка ordinary UI выбора рабочего завода.

### Runbook-пример с URI

Факт: Stage30 secret scan считал literal вида `PostgreSQL connection URI` в Stage68 runbook-примерах потенциальным secret leak.

Исправлено:

- `docs/stage68-first-start-and-maintenance-runbook.md`
- `docs/stage68-restore-runbook.md`

Учебный URI заменён на человекочитаемый placeholder без схемы и пароля.

## Known issues, не блокируют пилот

- Админка остаётся большой и содержит много диагностических счётчиков. На mobile 360px она рабочая и без overflow, но требует внимательного прохождения пользователем.
- Frontend production build предупреждает о chunk больше 500 kB. Это performance/architecture future, не блокер первого pilot demo.
- В backup/runbook остаются известные Stage68 warnings: часть attachment records без файлов и orphan files. Они не исправляются автоматически и не блокируют pilot, потому что backup сохраняет доступные файлы.
- Ручные тестовые сообщения пользователя в чатах не являются fixture leak и не блокируют Pilot Ready.

## Блокеры пилота

Открытых P0/P1 по текущему smoke evidence нет.

## Что сознательно не запускалось

- `restore`, `pg_restore`, DB reset/drop/truncate.
- Full backup `--create` после Stage68.
- Старые regression gates, которые создают или меняют runtime-данные, если они не нужны для Stage69 freeze-smoke.
- Новые крупные функции, Admin Maintenance UI, Stage68 продолжение.

## Итог

Проект можно считать готовым к первому пилотному показу по текущему evidence. Дальше стоит проводить ручной pilot/handover на телефоне с реальными пользователями и фиксировать только подтверждённые pilot feedback bugs.

## Дополнительный финальный UI-pass 16.06.2026

- Добавлен последний пункт меню `Сообщить об ошибке`.
- Механизм не использует БД: сообщение сохраняется локальным `.txt` в папку `error/`.
- Тема, раздел, автор и описание сохраняются; `DATABASE_URL`, token-like значения, `passwordHash` и `storagePath` редактируются до `[скрыто]`.
- Raw `userId`, `factoryId`, `storagePath`, секреты и абсолютные пути не показываются в UI и не возвращаются API.
- Desktop smoke: 19 разделов открылись под `test-admin`, включая `Сообщить об ошибке`; horizontal overflow 0, blank/raw error/secret markers не обнаружены.
- Mobile 360px smoke: 19 разделов открылись под `test-admin`; пункт `Сообщить об ошибке` открыт через лист `Ещё`; horizontal overflow 0.
- Live save smoke: создан тестовый отчёт `error/2026-06-16T14-30-22-826Z-final-smoke-1781620222763.txt`, фейковые `DATABASE_URL`, token и `storagePath` в файле отредактированы.
- Скриншоты: `docs/v1-completion-screenshots/final-ui-pass/desktop-after-final-pass.png`, `docs/v1-completion-screenshots/final-ui-pass/mobile-report-after-submit.png`, `docs/v1-completion-screenshots/final-ui-pass/mobile-shift-after-pass.png`.
- Targeted regression: `npm.cmd run final-ui:bug-report-regression --workspace backend` — 15 passed, 0 failed.
- Связанные проверки после правок: backend build, frontend build, Prisma validate, Stage30 release readiness, profile-photo RBAC regression — зелёные.
- Не запускались: restore, full backup `--create`, миграции, reset/drop/truncate, cleanup uploads, изменение `.env`.
