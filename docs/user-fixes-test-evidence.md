# Пласт 8: evidence автоматических проверок

Дата: 18.07.2026. Все команды запускались на текущем worktree; безопасные fixture-данные создавались только существующими regression/E2E контурами. Физическая очистка истории не выполнялась.

## Backend и контракты

| Команда | Результат | Что доказывает |
|---|---:|---|
| `npm.cmd run pilot-fix:plast1-regression --workspace backend` | PASS, 24/0 | mobile primitives, transport вложений, header/back/keyboard contracts |
| `npm.cmd run pilot-fix:plast2-regression --workspace backend` | PASS | Guest request/review, роли, phone/company/factory isolation |
| `npm.cmd run pilot-fix:plast3-regression --workspace backend` | PASS, 125/0 | текущая/будущая смена, LINE/WASH/TIME/WORK_AREA, concurrency, архивы, time boundaries |
| `npm.cmd run pilot-fix:plast4-regression --workspace backend` | PASS, 16/0 | handover, мойка, оттайка, scope и idempotency |
| `npm.cmd run pilot-fix:plast5-regression --workspace backend` | PASS, 20/0 | отделовые процессы, возвраты, checklist runner |
| `npm.cmd run pilot-fix:plast6-regression --workspace backend` | PASS, 31/0 | analytics, archive, admin preview и права |
| `npm.cmd run security:privacy-v1-regression --workspace backend` | PASS, 17/0 | публичные DTO, redaction, no storage-path/sensitive payload leakage |
| `node --check backend/scripts/pilot-fix-plast1-regression.js` | PASS | синтаксис обновлённого regression-runner |

## Browser E2E

| Команда | Результат | Покрытие |
|---|---:|---|
| `npm.cmd run pilot-fix:plast1-e2e --workspace frontend` | PASS, 4/4 | shell, report/attachment UI, chat profile, 360 |
| `npm.cmd run pilot-fix:plast2-e2e --workspace frontend` | PASS, 2/2 | Guest request, admin decision, menu refresh |
| `npm.cmd run pilot-fix:plast3-e2e --workspace frontend` | PASS, 12/12 | assignments, company roles, read-only roles, 360/390/430 |
| `npm.cmd run pilot-fix:plast4-e2e --workspace frontend` | PASS, 8/8 | handover, wash, defrost, 360/390/430 |
| `npm.cmd run pilot-fix:plast5-e2e --workspace frontend` | PASS, 8/8 | journal, stock request, returns, focused runner, 360/390/430 |
| `npm.cmd run pilot-fix:plast6-e2e --workspace frontend` | PASS, 6/6 | analytics/admin, 360/390/430 |

Всего в повторных browser-паках: 40 сценариев, без падений. E2E также проверяют отсутствие horizontal overflow, sticky actions и эмулируемый Back в применимых workflow.

## Build и схема

| Команда | Результат |
|---|---|
| `npm.cmd run build --workspace backend` | PASS |
| `npm.cmd run build --workspace frontend` | PASS; только известное non-blocking предупреждение Vite о крупном chunk |
| `npm.cmd run prisma:validate --workspace backend` | PASS |
| `npm.cmd run prisma:migrate:status --workspace backend` | PASS, 45 migrations, schema up to date |

## Targeted scans

- `prompt/alert/confirm` в `frontend/src` и `backend/src`: вызовы не найдены.
- Security/privacy regression подтвердил отсутствие публичных внутренних путей хранения, чувствительных значений и необработанных payloads в проверяемых DTO.
- Изменённые исходники/документы вручную просмотрены на mojibake; проблем не найдено. В защитных assertions допускаются сами названия запрещённых полей, но не значения.

## Screenshots

Свежие артефакты собраны в [`docs/user-fixes-complete-screenshots/`](user-fixes-complete-screenshots/): mobile 360 shell, Guest request, master assignments, defrost, checklist runner и analytics. Они созданы из успешных изолированных E2E запусков этого sweep.
