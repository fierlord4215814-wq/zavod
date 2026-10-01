# PHYSICAL FIELD FIXES V5 - Пласт 7

## Итог

`FINAL_STATUS: PASS_WITH_PHYSICAL_PENDING`

Browser runtime был доступен с первой штатной попытки. Visual gates Пластов 4-6 закрыты на реальном интерфейсе. Открытых P0/P1/P2 нет. Физический Android пользователь ещё не подтвердил, поэтому `PHYSICAL_PHONE_GATE: PENDING`.

## Найдено и исправлено

1. Line actions смешивали запуск новой линии и возврат конкретной линии. Теперь используются отдельные подписи «Запустить новую линию», «Вернуть в работу» и «Открыть мойку».
2. Detail линии не имел единого human presenter последнего события. Dashboard теперь отдаёт человекочитаемый тип события и безопасное имя автора; рабочий UI не показывает event id, raw enum или operationId.
3. Detail остановленной линии стал content-driven: показывает статус, состав/его отсутствие, назначение, последнее событие, доступные действия, историю и статистику без искусственной пустой высоты.
4. В fullscreen вложений zoom-кнопки перекрывали кнопку следующего изображения. Общий attachment viewer получил безопасный отступ; desktop и mobile E2E после исправления зелёные.
5. Устаревшие browser assertions синхронизированы с действующими контрактами: позиция списка измеряется после открытия viewer, а Android Back сначала закрывает клавиатуру и только затем sheet. Security assertions не ослаблялись.

## Visual evidence

- Пласт 4: действия линий, request filters, люди/профиль, прокрутка профиля, история/статистика линий, остатки, пересменка, уведомления, настройки, delegation, error report и WorkArea проверены на 390 px.
- Пласт 5: announcement pages, text scroll, fixed acknowledgement, fullscreen/swipe, четыре recurrence option, chat mosaic 1-5+, fullscreen/context return, participant accents и grouping проверены browser E2E на desktop/mobile.
- Пласт 6: OKK/Returns partial release, preview `52 -> 30 -> 22`, полное закрытие остатка, archive и parent history проверены на 390 px.
- Layout smoke: 360, 430 и desktop; horizontal overflow не найден.
- One-finger scroll, body lock, modal stack и safe-area/sticky footer прошли на затронутых экранах.

Скриншоты: `docs/physical-field-fixes-v5-plast7/screenshots/`.

## Проверки

- backend build: PASS;
- frontend build: PASS, только известное Vite large-chunk warning;
- line human presenter regression: `29 passed, 0 failed`;
- Plast 5 browser E2E: `2 passed, 0 failed`;
- Plast 6 browser E2E: PASS;
- `git diff --check`: PASS;
- prompt/alert/confirm: нет product usage;
- mojibake: нет;
- credentials/secrets/public storagePath: значений не найдено; совпадения в тестах являются защитными assertions.

Prisma schema и миграции не менялись, поэтому Prisma validate повторно не требовался. Guards, RBAC, factory scope и бизнес-команды линий не ослаблялись.

## Cleanup

- `ACTIVE_TEST_ARTIFACTS: 0`
- `PREEXISTING_ENTITIES_DELETED: 0`
- P5 announcement архивирован, P5 chat деактивирован штатно.
- P6 OKK/Return records архивированы, quantity ledger и audit сохранены.

## Изменённые файлы

- `backend/src/modules/line/line.service.ts`
- `backend/scripts/line-card-detail-polish-regression.js`
- `frontend/src/screens/SituationScreen.tsx`
- `frontend/src/screens/ShiftPeopleScreen.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v5-plast5.spec.ts`
- `frontend/e2e/physical-field-fixes-v5-plast6.spec.ts`
- четыре evidence-документа и шесть representative screenshots в `docs/physical-field-fixes-v5-plast7/`

## Physical-ready runtime

- `PUBLIC_HTTPS_URL: https://moved-correlation-varieties-cope.trycloudflare.com`
- `PUBLIC_HEALTH_URL: https://moved-correlation-varieties-cope.trycloudflare.com/api/health`
- `QR_PATH: C:\Users\79164\Documents\work\.codex-runtime\physical-field-fixes-v5-plast7\physical-ready-qr.png`
- `BACKEND_PID: 17316`
- `FRONTEND_PID: 14620`
- `TUNNEL_PID: 11016`
- `KEEP_AWAKE_PID: 9736`
- `SERVICE_WORKER_VERSION: zavod-shell-v6`
- `RUNTIME_STARTED_AT: 2026-08-09T11:51:01.8510453+03:00`

External read-only smoke: frontend, `/api/health`, `/health`, manifest и service worker - HTTP 200; same-origin API и public WebSocket - PASS; Edge подтвердил secure context и активный service worker.

Quick Tunnel временный. Для доступа с телефона компьютер должен оставаться включённым; backend, frontend, tunnel и keep-awake намеренно оставлены работающими.

`PHYSICAL_PHONE_GATE: PENDING`

