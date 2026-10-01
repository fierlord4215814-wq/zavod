# Результаты конкурентных проверок

Дата: 14.07.2026. Основной gate: `npm.cmd run semantic-integrity:v1-regression --workspace backend`.

## Итог gate

- 67 passed.
- 0 warnings.
- 0 failed.
- 16 конкурентных столкновений.
- HTTP 500: 0.

## Канонические результаты

| Сценарий | Ответы | Итог |
| --- | --- | --- |
| Мойка против оттайки одной линии | 201 / 409 | Активен ровно один процесс |
| Два сотрудника в один текущий слот | 201 / 409 | Одно активное назначение |
| Один сотрудник в два текущих слота | 201 / 409 | Одно активное назначение |
| Перевод сотрудника против запуска мойки | 409 / 201 | Один активный вид назначения |
| Два сотрудника в один будущий слот | 201 / 409 | Один активный план |
| Один сотрудник в два будущих слота | 201 / 409 | Один активный план |
| Повтор создания заявки с operationId | 201 / 201 | Одна строка заявки |
| Взять заявку против перенаправления | 201 / 201 | Один канонический статус |
| Два сотрудника берут периодический чек-лист | 409 / 201 | Один активный run |
| Два ответа на одну проверку | 201 / 409 | Один завершённый ответ |
| Два запуска scheduler напоминаний | 200 / 200 | Одно напоминание |
| Ответ против auto-close | 201 / 200 | Один финальный AUTO_CLOSED |
| Повтор отправки сообщения | 201 / 201 | Одно сообщение |
| Edit против delete | 409 / 200 | Канонично удалено |
| Два переключения реакции | 201 / 201 | Не более одной активной реакции |
| Send против удаления участника | 201 / 200 | Членство отозвано, следующий send запрещён |

## Связанные gates

- `resilience:concurrency-v1-regression` — exit 0.
- `stage11:wash-regression` — полный lifecycle/RBAC/attachments/audit, exit 0.
- `pilot:lines-wash-defrost-regression` — exit 0 после compatibility update порядка fixture.
- `line:timeline-regression` — 34 passed, 0 failed.
- `stage41:line-shift-assignment-regression` — exit 0.
- `stage48:shift-timeline-planning-regression` — 27 passed, 0 failed.
- `tasks:pilot-ready-regression` — 21 checks, 0 failures.
- `tasks:urgent-long-archive-regression` — 29 checks, 0 failures.
- `shift:handover-summary-regression` — 41 passed, 0 failed.
- `prepilot:shift-transition-archive-regression` — 17 checks passed.
- `checklists:periodic-lifecycle-regression` — exit 0.
- `checklists:workflow-v1-regression` — exit 0.
- `stage50:checklist-library-assignment-archive-regression` — 22 checks, 0 failures.
- `chat:mobile-messenger-v1-regression` — 15 passed, 0 failed.
- `security:privacy-v1-regression` — 17 passed, 0 failed.
- `stage30:release-readiness-regression` — 58 checks, 0 failures.
- `stage40a:archive-center-regression` — 36 checks, 0 failures.
- `stage49:past-shift-archive-regression` — 15 checks, 0 failures.
- `stage67:operational-analytics-regression` — exit 0.

## Browser evidence

- `semantic-integrity:v1-browser-e2e` — desktop-controlled 360/390/430/1366 evidence, exit 0.
- `line:timeline-browser-e2e` — desktop/mobile passed.
- `shift:handover-summary-browser-e2e` — desktop/mobile passed.
- `tasks:pilot-ready-e2e` — 1366/360/390/430 passed.
- `checklists:workflow-v1-browser-e2e` — 3 passed, включая offline no-false-success.
- `chat:mobile-messenger-v1-e2e` — desktop/mobile passed.
- `stage40a` browser E2E — ADMIN/STORE/OKK/WORKER и mobile 360 passed после compatibility update dev-session helper.
- `stage67` browser E2E — desktop/mobile passed.

Compatibility update `pilot:lines-wash-defrost-regression` не ослабляет проверку: fixture теперь штатно завершает мойку до старта оттайки, потому что одновременные активные процессы корректно запрещены продуктом.

Compatibility update Stage40A не меняет продуктовые ожидания: тест перешёл на текущий dev-session контракт и фактический mobile navigation sheet; проверки ролевых папок архива и overflow сохранены.
