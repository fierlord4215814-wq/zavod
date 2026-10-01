# Release Readiness

## Что Готово

- Backend health/version endpoints.
- Prisma migrations и seed.
- Stage regression suite.
- PWA/offline foundation.
- Local upload storage policy.
- Backup/restore docs.
- Retention docs.
- Test fixtures strategy.
- Admin settings coverage.
- Menu/role visibility regression.

## Запуск

Backend:

```powershell
npm.cmd run start --workspace backend
```

Frontend dev:

```powershell
npm.cmd run dev --workspace frontend -- --host 127.0.0.1
```

Frontend preview:

```powershell
npm.cmd run build --workspace frontend
npm.cmd run preview --workspace frontend -- --host 127.0.0.1
```

## Проверки

- `/health` не содержит секретов.
- `/version` не содержит секретов.
- `prisma:migrate:status` показывает актуальную схему.
- Full regression gate проходит.
- Browser/device manual pass ещё обязателен.

## Временно

- Bearer token хранится в `localStorage`.
- Uploads остаются local dev storage.
- Offline binary sync не готов.
- WebSocket/realtime hardening не финализирован.
- Production deployment packaging ещё не выполнялся.

## Не Входит

Проект намеренно не делает 1С, ERP, бухгалтерию, product accounting, партии, цены и себестоимость.
