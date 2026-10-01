# Пласт 17C: discovery

## Scope

Пласт закрывает только SB-009, SB-012, SB-013, SB-015 и SB-016. SB-017 и SB-018 не затрагиваются. Новый WebSocket endpoint, event bus, permission engine или polling-контур не создаются.

## Изученный canonical contour

- Backend transport: `backend/src/ws/ws.service.ts`, один endpoint `/ws`.
- Typed event names: `backend/src/ws/events.ts`.
- Effective capabilities: `backend/src/common/effective-permissions.ts`; тот же результат уже используется при WebSocket-аутентификации.
- Client owner: `frontend/src/ws/client.ts` и единственное подключение из `frontend/src/App.tsx`.
- Target producers/consumers: OKK, Wash и Defrost в существующих backend services и frontend screens.
- Source evidence: realtime matrix Пласта 17A и effective capability matrix/final report Пласта 17B.

## Подтверждённые корневые причины

1. **SB-009:** `App.tsx` открывает operational WebSocket для любого выбранного завода, включая Guest. Backend Guest корректно запрещает, а клиент затем запускает reconnect.
2. **SB-012:** WebSocket-аутентификация уже вычисляет effective permissions, но `sendToFactory` учитывает только `factoryId`. `safePayloadSummary` дополнительно раскрывает `id`, `status`, `type` и lifecycle status пользователям без capability модуля.
3. **SB-013:** backend имеет `okk_updated`, но frontend event union/consumer его не обрабатывает. Не все успешные OKK mutations публикуют invalidation после commit.
4. **SB-015:** часть Wash mutations публикует событие без `factoryId`, поэтому текущий transport его отбрасывает; `WashScreen` не подписан на профильное invalidation. Несколько emit выполняются внутри DB transaction.
5. **SB-016:** Defrost использует только `line_updated`; профильного `defrost_updated` и consumer у открытого календаря нет. Отметка обдува не публикует realtime invalidation.

## Решение

- Оставить один `/ws` и один frontend connection owner.
- Добавить к существующему event registry backend-owned audience policy на основе уже рассчитанных effective permissions.
- Factory events передавать как opaque invalidation: только event type и `changedAt`; canonical API остаётся source of truth.
- Сохранить recipient-scoped Chat/Notification и target-scoped auth lifecycle без перевода на factory broadcast.
- Guest не подключать к operational WebSocket. При auth-context change прекращать reconnect старого socket и создавать новый только после обновления canonical auth context.
- OKK/Wash/Defrost consumers выполнять bounded/debounced canonical refetch без прямого merge неполного WS payload.

## Migration

**NOT_REQUIRED.** Схема данных достаточна; меняется transport contract и client convergence. Prisma schema и migrations не затрагиваются.

## Что не трогаем

- бизнес-состояния OKK, мойки, оттайки, линий и смен;
- factory/department/company rules API;
- chat membership и notification recipient selection;
- SB-017 offline outbox и SB-018 legacy UI fragments;
- `.env`, uploads, backup/restore и реальные рабочие данные.

