# Пласт 12: статус требований

Дата проверки: 13.08.2026.

## Итог

- `FINAL_STATUS: PASS_WITH_PHYSICAL_PENDING`
- `PHYSICAL_RECHECK_STATUS: READY`
- `PHYSICAL_PHONE_GATE: PENDING`
- `P0: 0`
- `P1: 0`
- `P2: 0`
- P3/manual: физическая Android-проверка; один внешний Cloudflare precheck-регион недоступен, но tunnel зарегистрирован через рабочий HTTP/2-регион и публичный smoke проходит.
- Миграция не требовалась и не создавалась.

## Основной маршрут

| Контур | Статус | Доказательство |
| --- | --- | --- |
| План смены и штатный состав | PASS | Один canonical состав из пяти мест виден в плане, смене и линии. |
| Назначения | PASS | Person-first и slot-first используют один `Assignment`; добавление, замена, снятие и повторное назначение не создают дублей. |
| Realtime назначений | PASS | Второй MANAGEMENT-контекст увидел изменение `0/5 -> 1/5` без reload. |
| Запуск линии | PASS | Статус RUNNING и единственное событие начала согласованы во всех consumers. |
| Простой | PASS | Создан один status event, статус DOWNTIME согласован. |
| Заявка из простоя | PASS | Заявка связана с точным текущим `lineStatusEventId`; обычная заявка не подменяет эту связь. |
| Передача в техслужбу | PASS | TECH получил заявку, взял, прокомментировал и завершил; MASTER увидел изменения без нового входа. |
| Восстановление | PASS | Интервал простоя закрыт, линия вернулась в RUNNING, заявка сохранилась в истории. |
| STOP / restart | PASS | STOP освободил фактические назначения, сохранил шаблон, планы и историю; restart людей не воскресил. |
| Мойка | PASS | WASH имеет приоритет, использует назначения WASH, finish освобождает людей и не запускает линию автоматически. |
| Пересменка | PASS | Snapshot неизменяем и идемпотентен; следующая смена открывает архив предыдущей. |
| Cleanup | PASS | Все активные marker-сущности деактивированы штатно; физического удаления нет. |
| Post-cleanup | PASS | Существующие экраны Завода 4 повторно открыты на 360/390/430 px без marker-данных и overflow. |

## Business time и handover

- DAY D: `[08:00, 20:00)`, NIGHT D: `[20:00, D+1 08:00)`.
- 17:30: handover отклонён backend с `409`.
- 23:30 и 00:30: NIGHT сохраняет business date D.
- 07:30: NIGHT D и handover разрешён.
- 08:00: DAY D+1.
- Browser timezone `America/Los_Angeles` не сдвинул серверную дату смены.
- В snapshot вошли только работающие линии, плановые поля, активная мойка и незакрытая заявка точного события простоя.
- Люди, чек-листы и посторонние tails в snapshot не вошли.

## Security и целостность

- `RBAC_GATE`, `FACTORY_ISOLATION_GATE`, `AUDIT_GATE`: PASS.
- WORKER mutation линии: `403`.
- Cross-factory dashboard: `403`.
- Active marker objects после cleanup: `0` по всем 12 категориям.
- Все 11 проверок active reference integrity: `0` нарушений.
- Before/after hash существующих operational entities совпал.
- Удалено или непреднамеренно изменено существующих сущностей: `0`.
- Direct database writes: `0`; physical deletes: `0`.
- Историческое read-only наблюдение: четыре старых завершённых назначения связаны с неактивными линиями. Они не относятся к Пласту 12 и автоматически не исправлялись.

## Проверки

- P12 browser E2E: `1 passed`, семь скриншотов, основной viewport 390x844.
- P12 backend regression: `19 passed, 0 failed`.
- Shift handover regression: `56 passed, 0 failed`.
- Line timeline regression: `34 passed, 0 failed`.
- Security/privacy regression: `17 passed, 0 failed`.
- Access lifecycle regression: PASS.
- Backend build, frontend build, Prisma validate, Prisma migrate status: PASS.
- `node --check`, `git diff --check`, prompt/alert/confirm, mojibake и literal-secret scans: PASS.

## Fresh physical runtime

- Новый URL: `https://island-blanket-grain-magic.trycloudflare.com/`.
- Public health: `https://island-blanket-grain-magic.trycloudflare.com/api/health`.
- Frontend, health, manifest и service worker: HTTP `200`.
- Реальный ADMIN login и выбор Завода 4: PASS.
- Same-origin `/api/auth/me`: `200`.
- Authenticated WSS: `connected`.
- HTTPS, manifest, service worker `zavod-shell-v6`, 390 px без overflow: PASS.
- Bundle targets на localhost/LAN: `0`; запрещённые поля в проверенном публичном payload: `0`.
- QR: `docs/physical-field-fixes-v5-plast12/physical-recheck-qr.png`.

Физическая Android-проверка остаётся за пользователем, поэтому обычный полный PASS не выставлен.
Quick Tunnel временный, не имеет гарантии доступности и требует включённого компьютера.
