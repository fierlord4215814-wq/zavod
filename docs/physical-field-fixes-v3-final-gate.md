# Physical Field Fixes V3 — финальный gate

Дата evidence: 26.07.2026.

## Итог

- Статус маршрута: `PASS_WITH_PHYSICAL_PENDING`.
- Пласты 1–7: `PASS`.
- P0: 0.
- P1: 0.
- P2: 0.
- `PHYSICAL_PHONE_GATE: PENDING`.
- Приложение, backend и Cloudflare Quick Tunnel оставлены запущенными.

Автоматизация подтверждает desktop и mobile 360/390/430 px, но не подменяет проверку установленной PWA на физическом телефоне.

## Сверка ledger

Все 65 ID из `codex_zavod_field_fixes_v3/02_MASTER_REQUIREMENTS_LEDGER.md` получили статус и evidence. Диапазоны ниже включают каждый ID без пропусков.

| ID | Количество | Статус | Основное evidence |
|---|---:|---|---|
| GLOBAL-01 | 1 | PROVEN_EXISTING | Использованы canonical backend services, RBAC и Industrial Premium 10F |
| GLOBAL-02, GLOBAL-03 | 2 | FIXED | 360/390/430, Back, sheets, sticky actions и dirty-state gates |
| GLOBAL-04, GLOBAL-05 | 2 | PROVEN_EXISTING | Factory/server time, data safety и canonical `styles.css`/`PremiumShell.tsx` |
| DATA-01..05 | 5 | FIXED | Пласт 1: утверждённые 13 линий, позиции, диапазоны и scoped cleanup |
| SKILL-01..07 | 7 | FIXED | Пласт 1: line+position credits, idempotency, рекомендации и ручная корректировка |
| ASSIGN-01..08 | 8 | FIXED | Пласт 2: единый assignment flow, дополнительные сотрудники и compact line detail |
| PEOPLE-01..02 | 2 | FIXED | Пласт 3: compact people list/profile |
| CONTACT-01 | 1 | FIXED | Пласт 1/3: scoped phone visibility и backend deny |
| ADMIN-01..03 | 3 | FIXED | Пласт 3: searchable picker, compact candidates и server filtering |
| CHAT-01..04 | 4 | FIXED | Пласт 3/7: direct/group chat, idempotency, privacy и mobile filters |
| NAV-01..04 | 4 | FIXED | Пласт 3: четыре быстрых слота, home slot и safe fallback |
| REQUEST-01..03 | 3 | FIXED | Пласт 4: compact cards, action sheet и один выбранный список |
| OKK-01..02 | 2 | FIXED | Пласт 4: active/archive switch и canonical counters |
| RETURN-01..02 | 2 | FIXED | Пласт 4: active/archive pattern и compact detail |
| DEFROST-01..03 | 3 | FIXED | Пласт 4: два режима и различимые состояния |
| WASH-01..05 | 5 | FIXED | Пласт 5: compact overview/detail при сохранённой state machine |
| CHECK-01..09 | 9 | FIXED | Пласт 6: категории, constructor, periodic lifecycle, runner и archive |
| PHYSICAL-01, PHYSICAL-02 | 2 | PROVEN_EXISTING | Все пункты учтены как field fixes; физический gate честно оставлен pending |

Сумма: 60 `FIXED`, 5 `PROVEN_EXISTING`, 0 `BLOCKED`.

## Интеграционные проверки

- Backend production build: PASS.
- Frontend production build: PASS; остаётся только известное предупреждение Vite о крупном chunk.
- Prisma validate: PASS.
- Prisma migrate status: PASS, 46 миграций, schema up to date.
- Seed syntax и Stage30 release readiness: PASS внутри integrated gate.
- `pilot-route-acceptance:v1-regression`: PASS, 27/27.
- `security:privacy-v1-regression`: PASS, 17/17.
- Guest RBAC, role hierarchy, blocked/deactivated, factory/department/company isolation: PASS.
- `realtime:v1-regression`: PASS, 7/7.
- PWA readiness и browser E2E: PASS.
- Runtime stability и realtime multirole E2E: PASS.
- Pilot route browser acceptance: PASS на 360/390/430.
- Prompt/alert/confirm, mojibake и sensitive-value scans: PASS.

## Узкий финальный фикс

На внешнем mobile 390 px был найден P2: ряд фильтров чатов занимал всё свободное место grid из-за появившейся мобильной строки `Личный чат`. Исправлена только мобильная геометрия в canonical `frontend/src/styles.css`: list panel получил четыре ряда, фильтры закреплены как compact horizontal controls.

После исправления:

- frontend build: PASS;
- chat regression: 15/15;
- Stage56A messenger regression: PASS;
- chat browser E2E: desktop и mobile 360 PASS;
- свежий внешний screenshot 390 px просмотрен: фильтры компактны, список виден сразу, page-level overflow отсутствует.

Параллельная дизайн-система не создавалась. Бизнес-логика чатов и права не менялись.

## Внешний runtime

- URL: `https://immediate-baby-cases-referred.trycloudflare.com`
- Health: `https://immediate-baby-cases-referred.trycloudflare.com/api/health`
- Backend PID: `5712`
- Frontend PID: `15108`
- Tunnel PID: `10148`
- Keep-awake PID: `14212`
- QR: `docs/quick-tunnel-mobile-pilot-v1/mobile-pilot-qr.png`
- Runtime evidence: `docs/quick-tunnel-mobile-pilot-v1/runtime/20260726-153957Z`

Внешний smoke подтвердил 18/18 пилотных ролей, выбор завода, same-origin API, WebSocket, reconnect, chat round-trip, отправку ошибки и PWA secure context.

## Физическая проверка

На реальном телефоне ещё нужно проверить установленную PWA: камеру/галерею, микрофон, push/vibration, клавиатуру/safe-area, gesture Back и один живой маршрут мастера. До этого `PHYSICAL_PHONE_GATE` остаётся `PENDING`.
