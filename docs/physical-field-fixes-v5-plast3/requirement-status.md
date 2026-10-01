# PHYSICAL FIELD FIXES V5 — Пласт 3: requirement status

## Backend и данные

| Требование | Статус | Evidence |
| --- | --- | --- |
| Одна active мойка на объект/линию | PASS | duplicate start → 409 |
| Canonical `Assignment kind=WASH` | PASS | назначение, detail и завершение используют одну запись |
| Line/Wash/detail видят одну active сессию | PASS | targeted regression |
| Время мойки от server start/serverNow | PASS | targeted regression и browser UI |
| Lock/recheck при завершении | PASS | session, line и participant operation locks |
| Повторное завершение идемпотентно | PASS | targeted regression |
| Участники освобождаются, история остаётся | PASS | targeted regression + E2E |
| Линия не запускается автоматически | PASS | после complete статус линии `STOP` |
| WORKER mutation denied | PASS | 403 |
| Cross-factory denied | PASS | 409/guard evidence |
| Realtime после commit | PASS | WebSocket regression |
| Reconciliation dry-run безопасен | PASS | 0 mutations |
| Reconciliation apply только proven test/pilot | PASS | 16 закрыто, real/current 0 |
| Нет physical delete | PASS | код, отчёт и сохранность child records |
| Reconciliation идемпотентна | PASS | повторный dry-run: active/eligible 0 |
| Оттайка использует canonical current line run | PASS | старое завершённое событие не становится current |
| Server time для start/end оттайки | PASS | targeted regression |
| Defrost operationId идемпотентен | PASS | targeted regression |
| WORKER/cross-factory defrost denied | PASS | 403/409 |
| Публичный payload без storage/secrets | PASS | API regression и browser body scan |

## Browser/mobile

| Требование | Статус |
| --- | --- |
| Компактная карточка мойки: статус, длительность, люди, проблемы, задания | PASS |
| Компактный detail: header, KPI, действия, вкладки | PASS |
| «Люди» назначает и возвращает в ту же мойку | PASS |
| Повторное переназначение не создаёт дубль | PASS |
| Завершение закрывает задание штатно и освобождает людей | PASS |
| Линия показывает «На мойке», «Открыть мойку», без ложного «Вернуть в работу» | PASS |
| Оттайка показывает текущий запуск и читаемую длительность | PASS |
| KPI оттайки и пустые значения читаемы на mobile | PASS |
| 360/390/430 px без horizontal overflow | PASS |
| Desktop 1365 px | PASS |
| Android Back в проверенных detail-переходах | PASS |
| Временные browser fixtures не остались активными | PASS, все counts 0 |

## Gates

- `physical-field-fixes:v5-plast3-regression`: 31 passed, 0 failed.
- `pilot:lines-wash-defrost-regression`: 21 passed, 0 failed.
- `physical-field-fixes:v5-plast3-e2e`: 1 passed; внутри 360/390/430/1365 и полный 390px workflow.
- Backend build: PASS.
- Frontend build: PASS; только известные Vite CJS/large chunk warnings.
- Prisma validate/status: PASS, migration не нужна.

Итог: `P0=0`, `P1=0`, `P2=0` в scope Пласта 3.
