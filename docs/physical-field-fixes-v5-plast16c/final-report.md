# PHYSICAL FIELD FIXES V5 - Plast 16C final report

## Статус

- `PLAST16C_STATUS: PASS`.
- `FINAL_STATUS: PASS_WITH_PHYSICAL_PENDING`.
- `PHYSICAL_RECHECK_STATUS: READY`.
- `PHYSICAL_PHONE_GATE: PENDING`.
- `PRODUCT_P0: 0`, `PRODUCT_P1: 0`, `PRODUCT_P2: 0`.
- `MIGRATION: NOT_REQUIRED`.

## Что было исправлено

1. Factory-local период теперь единый half-open `[from, to)`, с canonical server clock и status-as-of. UTC-полночь браузера больше не сдвигает выбранный день.
2. Открытые простои clipped к выбранному периоду/as-of; будущий `WORK` не закрывает простой задним числом.
3. Заявки считаются по overlap/status-as-of, а связь с простоем учитывается только через `lineStatusEventId` без дублей.
4. Avg/median/p90 и детерминированная «самая проблемная линия» сведены к одному backend read-model. p90 использует nearest rank.
5. «Эффект 10 минут» ограничен рабочими днями выбранного периода и фактической потерей.
6. Checklist aggregate использует effective parent lifecycle и не принимает закрытые legacy child `ACTIVE` за текущие проверки.
7. «Модули» следует выбранному периоду; normal view единообразно исключает надёжно помеченные fixtures.
8. Audit остаётся canonical `AuditLog`, но публичная презентация стала человекочитаемой: действие, автор, объект, время и безопасный before/after.
9. При controlled calendar rollover OKK, некондиция, возвраты и Audit переведены на общий `factoryServerNow()`. Причина дефекта была в смешении DB/system now и canonical controlled clock.
10. Filters, KPI, events и Audit detail используют существующие Industrial Premium 10F components/tokens; второй дизайн-контур не создавался.

## Изменённые файлы Plast 16C

Product:

- `backend/src/common/audit-presentation.ts`;
- `backend/src/common/audit.service.ts`;
- `backend/src/modules/ops/ops.service.ts`;
- `backend/src/modules/okk/okk.service.ts`;
- `backend/src/modules/stock/stock.service.ts`;
- `backend/src/modules/returns/returns.service.ts`;
- `backend/src/modules/task/task.service.ts`;
- `backend/src/modules/wash/wash.service.ts`;
- `frontend/src/screens/OpsAuditScreen.tsx`;
- `frontend/src/styles.css`.

Targeted tests/scripts:

- `backend/scripts/physical-field-fixes-v5-plast16c-regression.js`;
- `backend/scripts/physical-field-fixes-v5-plast16c-source-regression.js`;
- `backend/scripts/physical-field-fixes-v5-plast16c-dependency-smoke.js`;
- `frontend/e2e/physical-field-fixes-v5-plast16c.spec.ts`;
- `frontend/e2e/physical-field-fixes-v5-plast16c-final-runtime.spec.ts`;
- `frontend/scripts/physical-field-fixes-v5-plast16c-e2e.js`;
- `backend/package.json`, `frontend/package.json` - только targeted command entries.

## Formula, source and security evidence

- Controlled formulas: `79/79`; cleanup/protected data: `17/17`; всего `96/96`.
- Source regression: `15/15`.
- Formula gates: `18/18`; Audit gates: `10/10`.
- Cross-factory и WORKER direct statistics/audit denial: PASS.
- MANAGEMENT/ADMIN получают только разрешённый factory scope.
- Diagnostic rows отсутствуют в normal view; diagnostic override недоступен обычному ADMIN.
- Public payload: без raw audit details/scope ids, `storagePath`, `passwordHash`, secret/token values.

## Browser and UX evidence

- Cohesive desktop/mobile E2E: PASS, `360/390/430/1440`, Android Back, overflow `0`.
- Local final runtime: health, 10 API routes, login/Factory 4, XLSX, authenticated WebSocket, manifest, SW, secure context - PASS.
- Public final runtime через новый HTTPS origin: те же проверки - PASS.
- Console errors: `0`; failed requests: `0`; local/LAN runtime targets: `0`.
- Screenshots и QR находятся только в этой evidence-папке.

## Builds and database

- Backend build: PASS.
- Frontend production build: PASS; остаётся только известный Vite large chunk warning.
- Prisma validate: PASS.
- Prisma migrate status: 52 migrations, schema up to date.
- Seed и changed scripts syntax: PASS.
- Миграций, aggregate tables и schema changes в Plast 16C нет.

## Cleanup and legacy data

- Все `ACTIVE_P16C_*`: `0`.
- Factory 4 protected hash: `8ed7ced1e3cfc9915615faa65ea4d53b189dbbd0a702326fc72714f0f86a690a` до и после.
- Physical deletes: `0`.
- 723 global legacy checklist child rows, 573 Factory 4 rows и 4 ambiguous open STOP сохранены без mutation.
- Эти данные являются `LEGACY_DATA_REVIEW`: period-clipped, видимы как предупреждение качества и не блокируют физический recheck.

## Runtime для физической проверки

- `PUBLIC_HTTPS_URL: https://von-drawn-verse-podcasts.trycloudflare.com`.
- `PUBLIC_HEALTH_URL: https://von-drawn-verse-podcasts.trycloudflare.com/api/health`.
- `BACKEND_PID: 12364`.
- `FRONTEND_PID: 8984`.
- `TUNNEL_PID: 4356`.
- `KEEP_AWAKE_PID: 11500`.
- `SERVICE_WORKER_VERSION: zavod-shell-v6`.
- `RUNTIME_STARTED_AT: 2026-08-28T01:19:28+03:00`.
- `QR_PATH: C:\Users\79164\Documents\work\docs\physical-field-fixes-v5-plast16c\physical-recheck-qr.png`.

Quick Tunnel временный. Для проверки компьютер должен оставаться включённым, а четыре процесса выше - работающими. Физический Android PASS за пользователя не выставлялся.
