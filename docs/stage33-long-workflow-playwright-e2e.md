# Stage 33 — Long Workflow Playwright E2E

## Scope

Stage 33 expands the existing Playwright setup with longer browser workflows. It does not add business logic, modules, database schema changes, or redesigns.

## Workflows Covered

1. MASTER shift workflow:
   - login;
   - factory selection;
   - Смена;
   - Линии;
   - Заявки;
   - Мойка;
   - Пересменка / Журнал.

2. STORE returns workflow:
   - Возвраты на производство;
   - Активные;
   - Архив;
   - Новая запись form labels.

3. OKK defect workflow:
   - ОКК;
   - active/archive sections;
   - Excel-style defect field labels;
   - edit visibility smoke.

4. Chats workflow:
   - Чаты;
   - first available chat detail;
   - one safe `Stage33 browser smoke` message when input is available.

5. Announcements workflow:
   - Объявления;
   - Активные;
   - Важные;
   - Архив when available;
   - mark read when available;
   - create form labels without creating an announcement.

6. People/skills workflow:
   - Люди;
   - filters;
   - profile/detail where available;
   - skills and phone visibility smoke.

## Mobile Coverage

The mobile 360px long-smoke covers:

- MASTER: Смена, Линии;
- STORE: Возвраты на производство;
- OKK: ОКК;
- Чаты;
- Люди.

It checks no raw crash text, Russian UI, and no obvious horizontal overflow.

## Actions Tested

Only safe actions are included:

- sending a short chat message with `Stage33 browser smoke`;
- marking announcements as read when available;
- opening forms and validating Russian labels.

The suite intentionally avoids destructive actions, archive actions, binary attachments, and heavy data creation.

## Russian UI Gate

Each workflow checks visible browser text for mojibake and common English placeholder strings. Technical audit/diagnostic enum values are not the target of this browser workflow suite.

## Commands

```powershell
npm.cmd run stage33:browser-e2e
```

The command reuses the Stage 31/32 production-preview e2e mode with dev-login enabled only for e2e builds.

## Limitations

This remains automated smoke coverage. Stage 22 manual browser/device pass is still required for real phone ergonomics, PWA installability, offline/reconnect feel, and long human workflows.
