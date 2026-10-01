# PHYSICAL FIELD FIXES V5 - Пласт 8: финальный отчет

Дата завершения: 09.08.2026.

## Итог

- `FINAL_STATUS`: `PASS_WITH_PHYSICAL_PENDING`.
- `PHYSICAL_RECHECK_STATUS`: `READY`.
- `PHYSICAL_PHONE_GATE`: `PENDING` до подтверждения пользователя на реальном Android.
- P0: 0.
- P1: 0.
- P2: 0 по automated evidence Пласта 8.
- Пласт 9 не начинался.

## Canonical checklist contour

- Владелец бизнес-логики: `backend/src/modules/checklists/checklists.service.ts`.
- Backend guards: `backend/src/modules/checklists/checklists.controller.ts` и существующие permission/factory guards.
- Модель: `ChecklistTemplate`, `ChecklistTemplateRow`, `ChecklistRun`, `ChecklistRunRow`, `ChecklistRunCheck`, `ChecklistRunCheckRow`, `ChecklistPauseEvent` в `backend/prisma/schema.prisma`.
- Пользовательский экран и builder: `frontend/src/screens/ChecklistsScreen.tsx`.
- Редактор пункта: `frontend/src/components/ChecklistItemEditor.tsx`.
- Shared UI: существующие `PremiumSheet`, `PremiumActionItem`, `PremiumKpiStrip` и canonical tokens из `frontend/src/styles.css`.
- Второй checklist service, scheduler, audit, notification contour или UI theme не создавались.

## Существующие возможности, сохраненные в реализации

- Типы пунктов: обычный результат, да/нет, да/нет/не применимо, текст, обязательный комментарий, фото, обязательное фото, число, выбор и информация.
- Периодичность: вручную, один/два раза за смену, интервал в минутах/часах, ежедневно, еженедельно и при запуске линии.
- Существующие factory/department/line scopes, personal take-in-work, pause/resume, reminders, auto-close в 21:00/09:00, архив, отчеты, attachments и audit сохранены.
- Число вне диапазона создает понятное отклонение. Комментарий обязателен только при `requiresComment=true`.
- `startRun` копирует конфигурацию активных пунктов в run/check rows. Уже начатое выполнение остается immutable при изменении шаблона; новое выполнение получает новую конфигурацию.
- Миграция не потребовалась: текущая Prisma schema полностью поддерживает реализованное поведение.

## Что изменено в checklist UX

- Основная навигация стала трехчастной: «В работе», «Доступные», «Архив».
- Просроченные проверки остаются заметными и правильно сортируются внутри рабочего списка, без четвертой верхней вкладки.
- Focused runner показывает один пункт за раз, прогресс, назад/далее, pause/resume и корректные item-specific controls.
- Archive filters и detail/report panels используют canonical `PremiumSheet`.
- В архивной детали видны способ закрытия, причина автоматического закрытия и человекочитаемые интервалы пауз.
- Builder разделен на «Основное», «Периодичность», «Пункты», «Проверка и публикация».
- Редактор поддерживает добавление, изменение, порядок, дублирование и включение/отключение пунктов.
- Preview использует тот же focused rendering, что и сотрудник, и не создает run или другие runtime records.
- Перед изменением активного шаблона показывается явное подтверждение поверх sheet; overlay order исправлен через shared tokens/variant.

## Fixture inventory и cleanup

- Выполнен ограниченный read-only inventory Factory 4.
- Массовая очистка не выполнялась.
- Штатно soft-архивирована ровно одна явно доказанная pilot fixture: «Проверка пересменки для пилота», id prefix `0c524aa3`.
- Использован guarded `POST /shift-log/:id/archive`; physical delete не выполнялся.
- После операции совпадений в operational списке мастера: 0; в архиве: 1.
- Audit evidence: `SHIFT_LOG_ENTRY_UPDATED`.
- Все записи без надежного marker остались `POSSIBLE_REAL_DATA` и не менялись.
- Reset/drop/truncate/physical delete: 0.

## Future-plan picker

- Picker будущей смены переведен на canonical `PremiumSheet`.
- Каждая активная реальная линия доступна целиком как compact row с одним понятным `+`.
- Удалено искусственное ограничение первых 18 строк.
- Длинные названия не обрезают действие; последняя строка полностью видна над sticky footer.
- Используется прежняя backend-команда назначения. Бизнес-логика и данные назначения не менялись.

## Измененные файлы

- `backend/src/modules/checklists/checklists.service.ts`
- `backend/src/modules/shift-log/shift-log.service.ts`
- `backend/src/modules/shift-log/shift-log.controller.ts`
- `backend/scripts/checklist-workflow-v1-regression.js`
- `backend/scripts/checklist-department-first-v1-regression.js`
- `backend/scripts/stage14-shift-log-regression.js`
- `backend/scripts/stage48-shift-timeline-planning-regression.js`
- `frontend/src/screens/ChecklistsScreen.tsx`
- `frontend/src/screens/ShiftPeopleScreen.tsx`
- `frontend/src/components/AppConfirmDialog.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v5-plast8.spec.ts`
- `frontend/package.json`
- `docs/physical-field-fixes-v5-plast8/discovery.md`
- `docs/physical-field-fixes-v5-plast8/requirement-status.md`
- `docs/physical-field-fixes-v5-plast8/test-artifacts.json`
- representative screenshots и этот отчет в `docs/physical-field-fixes-v5-plast8/`.

## Targeted backend и static evidence

- Checklist workflow: 80 passed, 0 failed.
- Periodic lifecycle: 0 failed.
- Department-first: 16 passed.
- Stage13: 0 failed.
- Stage44: 27 passed.
- Stage50: 22 passed.
- Stage64: 15 passed.
- Stage65: 13 passed.
- Stage66: 0 failed.
- Stage48 future planning: 27 passed, 0 failed.
- Stage14 ShiftLog safe archive: 0 failed.
- Backend build: PASS.
- Frontend build: PASS; только известное неблокирующее Vite large-chunk warning.
- Prisma validate: PASS.
- Prisma migrate status: 52 migrations, schema up to date.
- `node --check` измененных backend regression scripts: PASS.
- `git diff --check`: PASS; только уведомления о существующих CRLF conventions.
- Targeted scans: browser `prompt/alert/confirm` отсутствуют; mojibake и literal secret values не найдены; защитные assertions не являются утечкой.

Compatibility updates в regression fixtures не ослабляют guards:

- checklist regressions завершают occurrence через актуальный `/checks/current/complete`;
- Stage14 использует guarded soft archive вместо legacy delete fixture flow;
- Stage48 проверяет audit actions, реально возникающие при идемпотентном reuse существующего `LineShiftWorkPlan`.

## Browser/mobile evidence

- Targeted Playwright: 3 passed, 0 failed.
- Полный workflow проверен на 390 px.
- Layout smoke: 360 px и 430 px.
- Builder/preview smoke: desktop.
- Horizontal overflow: отсутствует.
- Android Back, sticky footer, safe area и one-finger scroll: PASS по canonical sheet contract и targeted E2E.
- Временные runs закрыты, templates архивированы, line/position/staffing template деактивированы; assignments не создавались; physical delete count: 0.

Representative screenshots:

- `docs/physical-field-fixes-v5-plast8/checklist-list-390.png`
- `docs/physical-field-fixes-v5-plast8/checklist-runner-390.png`
- `docs/physical-field-fixes-v5-plast8/checklist-builder-desktop.png`
- `docs/physical-field-fixes-v5-plast8/checklist-preview-desktop.png`
- `docs/physical-field-fixes-v5-plast8/future-plan-picker-390.png`

## Fresh physical-ready runtime

- `PUBLIC_HTTPS_URL`: `https://walls-design-recommended-delhi.trycloudflare.com`
- `PUBLIC_HEALTH_URL`: `https://walls-design-recommended-delhi.trycloudflare.com/api/health`
- `BACKEND_PID`: `1940`
- `FRONTEND_PID`: `4740`
- `TUNNEL_PID`: `10988`
- `KEEP_AWAKE_PID`: `9736`
- `SERVICE_WORKER_VERSION`: `zavod-shell-v6`
- `RUNTIME_STARTED_AT`: `2026-08-09T14:40:02.8358124+03:00`
- `QR_PATH`: `C:\Users\79164\Documents\work\docs\physical-field-fixes-v5-plast8\physical-ready-qr.png`

Local strict-runtime evidence:

- compiled backend health: 200;
- production frontend preview: 200;
- same-origin `/api/health`: 200;
- real pilot MASTER login: PASS;
- Factory 4 selected and confirmed by `auth/me`: PASS;
- signed WebSocket through frontend proxy: OPEN;
- manifest and service worker script: 200.

Public read-only HTTPS evidence:

- frontend: 200;
- `/api/health`: 200, backend status `ok`;
- anonymous same-origin API: 200 with guarded Guest context;
- secure context: true;
- manifest: 200;
- service worker script: 200, version `zavod-shell-v6`, registration present;
- unsigned public WebSocket upgrade reaches backend and is correctly denied with HTTP 403;
- 390 px public shell has content and no horizontal overflow.

The automated environment did not relay the real password or bearer token through the public third-party tunnel. Real signed login and WebSocket were proven locally; the final public signed session remains the intended physical-phone action.

The backend is the current compiled local-pilot runtime with test auth headers disabled. `NODE_ENV=production` was not forced because the existing `.env` intentionally has no production JWT secret; `.env` was not changed.

Quick Tunnel is temporary. The computer, backend, frontend, tunnel and keep-awake process must remain running for the public URL to work.
