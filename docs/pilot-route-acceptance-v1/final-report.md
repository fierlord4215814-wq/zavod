# Финальная комплексная приёмка пилотных маршрутов v1.0

Дата: 16.07.2026. Run ID: `PILOT_ROUTE_V1_20260716094746`.

## Итог

- `PILOT_ROUTE_ACCEPTANCE: PASS`
- `PILOT_READY: YES`
- `PHYSICAL_PHONE_GATE: PENDING`
- Открытые P0: нет.
- Открытые P1: нет.
- Открытые P2: нет.

## Discovery и границы

Переиспользованы существующие regression/E2E helpers, canonical factory/RBAC/fixture visibility и ранее подтверждённые semantic/access evidence. Добавлен один тонкий orchestration runner и один read-only browser pack. Новый модуль, бизнес-функция, параллельная RBAC-система или дизайн-контур не создавались. Migration не нужна.

## Свежие доказательства

- Backend route pack: 27 PASS, 0 FAIL, exit code 0.
- Browser route pack: 3 PASS, 3 ожидаемых project-skip, exit code 0; desktop и mobile 360/390/430 px.
- Backend build, frontend build, Prisma validate, Prisma migrate status, seed syntax и Stage30: PASS.
- Factory context, Stage36 admin RBAC, role hierarchy/delegation и runtime data hygiene после финальных исправлений: PASS.
- 28 свежих screenshots сохранены в `screenshots/`; полный маршрутный mapping — в `route-matrix.md`.

## Исправленные подтверждённые P2

1. Убрана лишняя загрузка закрытого directory endpoint на обычном checklist workspace без ослабления backend guard.
2. Устранено попадание точно маркированных regression-линий и заводов в обычные runtime/read-model списки.
3. Admin overview переведён с сырых исторических totals на canonical pilot-visible данные выбранного заводского контекста.
4. Regression helpers мойки/оттайки получили корректный `finally` lifecycle вместо преждевременного завершения процесса.

## RBAC и безопасность

Backend остаётся источником истины. Свежие gates подтвердили Guest restrictions, ordinary-user deny для admin/statistics/audit, ограниченное делегирование подмножеством собственных прав, blocked/deactivated denial и cross-factory/cross-department isolation. Storage path, password hashes, credentials, token/secret values и raw UUID не используются как публичный UI-текст.

## Данные

Reset/drop/truncate/delete, physical cleanup, migration apply, backup/restore не запускались. Реальные пользователи и линии Завода 4 не перенастраивались. Диагностические helpers используют маркированные сущности, закрывают/архивируют/деактивируют их штатно и не удаляют историю. `.env`, uploads и backups не менялись.

## Остаточные наблюдения

- Ручное тестовое сообщение пользователя в чате оставлено без изменений: reliable fixture marker отсутствует.
- Открытый долгий простой «Хинкали мини» оставлен как реальная/ручная запись; решение по нему принимает пользователь в рабочем интерфейсе.
- Vite сообщает только известный large-chunk warning.
- Камера, микрофон, физический push/vibration, PWA install/offline и живой маршрут мастера требуют реального телефона: см. `manual-phone-checklist.md`.

## Evidence

- `results.json` — машинный итог и exit codes.
- `role-route-matrix.md` — роли и ограничения.
- `route-matrix.md` — 14 маршрутов и screenshots.
- `test-data-manifest.md` — provenance и состояние диагностических данных.
- `failures.md` — исправленные проблемы и оставленные наблюдения.
- `logs/` — sanitized command logs.
- `screenshots/` — свежий desktop/mobile evidence.

Программный pre-pilot gate закрыт. Следующий осознанный шаг — только ручной phone/real-shift checklist, без нового feature development.
