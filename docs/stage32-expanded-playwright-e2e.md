# Stage 32 — Expanded Playwright E2E Coverage

## Scope

Stage 32 expands the existing Stage 31 Playwright setup. It does not add business logic, modules, routes, tables, or schema changes.

## Roles Covered

- ADMIN;
- MANAGEMENT;
- MASTER;
- WORKER;
- STORE;
- OKK;
- TECH_HOLOD;
- CONTRACTOR_LEAD.

## Screens Covered

- Администрирование;
- Объявления;
- Люди;
- Чаты;
- Уведомления;
- Статистика / Аудит;
- Заявки;
- Чек-листы;
- Заказы / Остатки;
- Пересменка / Журнал;
- Смена;
- Линии;
- Мойка;
- Возвраты на производство;
- Некондиция;
- ОКК;
- Оттайка.

## Mobile Coverage

The `mobile-360-edge` project checks a 360px viewport for ADMIN, MASTER, WORKER, STORE, and OKK paths. It verifies page load, no raw crash text, Russian UI, and no obvious horizontal overflow.

## Safe Actions

The smoke test may perform safe read-state actions:

- mark notifications as read;
- mark an announcement as read when the button is available.

No destructive or heavy create/update flows are included.

## Russian UI Gate

Browser-visible text is checked for common mojibake and visible English placeholders. Technical enum values in audit/diagnostic contexts remain out of scope for this browser smoke.

## Commands

```powershell
npm.cmd run stage32:browser-e2e
```

The command reuses the Stage 31 e2e production-preview approach and `mode=e2e` dev-login gate.

## Limitations

This is still a browser smoke suite. It does not replace Stage 22 manual browser/device E2E for real phone ergonomics, PWA installability, offline retry feel, and long workflow verification.
