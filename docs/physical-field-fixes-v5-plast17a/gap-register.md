# Gap register

Binding gaps: 18; P0 0; P1 5; P2 11; P3 2.

## SB-001 — Линии / Situation для TECH_*

- SEVERITY: P1
- SURFACE: Линии / Situation для TECH_*
- PHYSICAL EFFECT: Экран виден, но `/wash` возвращает 403; Promise.all очищает также линии и рабочие зоны.
- ROOT LOCATION: frontend/src/screens/SituationScreen.tsx; backend/src/modules/wash/wash.service.ts
- EXPECTED OWNER: Каждый source загружается по собственной capability; отсутствие wash.read не ломает lines.read.
- ACTUAL OWNER: Жёсткая совместная загрузка `/lines`, `/wash`, `/work-areas`.
- WHY THIS IS A GAP: UI_VISIBLE + primary screen unusable из-за несвязанного permission.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Разделить read owners/ошибки и запрашивать wash только при доступной capability.

## SB-002 — Люди / профиль / actor labels

- SEVERITY: P1
- SURFACE: Люди / профиль / actor labels
- PHYSICAL EFFECT: Один пользователь показан как «PILOT А. Р.» и «Администратор Романов Р. А.» на разных surfaces; новые реальные пользователи не имеют canonical ФИО.
- ROOT LOCATION: backend/prisma/schema.prisma User; backend/src/common/pilot-visibility.ts; frontend/src/utils/pilot-ui.ts
- EXPECTED OWNER: Persisted canonical human identity.
- ACTUAL OWNER: Нет поля ФИО; backend и frontend содержат отдельные hardcoded label maps и fallback.
- WHY THIS IS A GAP: Основная бизнес-идентичность не имеет canonical owner.
- MUTATION REQUIRED TO PROVE?: Да, additive schema/backfill потребуется в 17B
- RECOMMENDED FIX SCOPE: Добавить canonical profile/display-name owner и постепенно убрать seeded label dictionaries из runtime presentation.

## SB-003 — Оттайка

- SEVERITY: P1
- SURFACE: Оттайка
- PHYSICAL EFFECT: Скрытые роли могут читать `/defrost/*` прямым API.
- ROOT LOCATION: backend/src/modules/defrost/defrost.controller.ts; defrost.service.ts
- EXPECTED OWNER: Backend permission `defrost.read/manage` совпадает с UI.
- ACTUAL OWNER: Read guard разрешает любого non-guest выбранного завода.
- WHY THIS IS A GAP: Backend final authority шире настроенной permission matrix.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Применить existing permission guard к read endpoints, сохранив factory scope.

## SB-004 — Возвраты

- SEVERITY: P1
- SURFACE: Возвраты
- PHYSICAL EFFECT: WORKER/CONTRACTOR и другие non-guest получают публикации по API, но экран скрыт; предусмотренный read-only flow недостижим.
- ROOT LOCATION: frontend/src/navigation/permissions.ts; backend/src/common/publication-policy.ts
- EXPECTED OWNER: Одна публикационная capability для UI и API.
- ACTUAL OWNER: Backend `canReadReturnPublications` разрешает всех non-guest; UI требует `returns.read`.
- WHY THIS IS A GAP: UI_HIDDEN + API_ALLOWED для пользовательского read-only контура.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Вернуть backend-derived capability в auth context и использовать её для меню, не ослабляя publish/manage.

## SB-005 — Мойка для TECHNOLOG

- SEVERITY: P1
- SURFACE: Мойка для TECHNOLOG
- PHYSICAL EFFECT: Backend намеренно разрешает технологу читать/контролировать мойку, но пункт меню скрыт.
- ROOT LOCATION: backend/src/modules/wash/wash.service.ts; frontend/src/navigation/permissions.ts
- EXPECTED OWNER: Технолог видит существующий wash read surface.
- ACTUAL OWNER: Service role overlay есть, permission row `wash.read` отсутствует, UI проверяет только permission.
- WHY THIS IS A GAP: UI_HIDDEN + API_ALLOWED для рабочего экрана.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Свести роль/capability к одному backend-owned контракту и отдать effective capability frontend.

## SB-006 — Ограниченная админка MASTER

- SEVERITY: P2
- SURFACE: Ограниченная админка MASTER
- PHYSICAL EFFECT: Рабочий экран сначала получает ожидаемый 403 `/admin/overview`, затем fallback загружает доступный staffing/delegation контекст; console/network шум.
- ROOT LOCATION: frontend/src/screens/AdminConfigScreen.tsx
- EXPECTED OWNER: Capability-aware initial load.
- ACTUAL OWNER: 403 используется как discovery механизма доступа.
- WHY THIS IS A GAP: UI_VISIBLE + probe API_DENIED, хотя fallback рабочий.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Выбирать начальный endpoint по effective admin capability.

## SB-007 — Админка: роли и назначения

- SEVERITY: P2
- SURFACE: Админка: роли и назначения
- PHYSICAL EFFECT: Новая backend role потребует изменения frontend-кода.
- ROOT LOCATION: frontend/src/screens/AdminConfigScreen.tsx ROLE_OPTIONS
- EXPECTED OWNER: Canonical `/admin/roles` options.
- ACTUAL OWNER: Static operational role list используется в selectors параллельно загруженному справочнику.
- WHY THIS IS A GAP: Hardcoded operational choice.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Использовать response `/admin/roles`; оставить label map только для перевода.

## SB-008 — Поиск людей / directory consumers

- SEVERITY: P2
- SURFACE: Поиск людей / directory consumers
- PHYSICAL EFFECT: Server query по имени возвращает 0; при >80 доступных users локальный fallback станет неполным.
- ROOT LOCATION: backend/src/modules/directory/directory.service.ts
- EXPECTED OWNER: Canonical server-side partial FIO/phone search with scoped pagination.
- ACTUAL OWNER: `q` фильтрует только user.id; fixed `take: 80`; displayName строится после запроса.
- WHY THIS IS A GAP: Текущий маленький завод работает, масштабирование и поиск имени не canonical.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: После SB-002 добавить indexed canonical identity search и pagination.

## SB-009 — Guest home realtime

- SEVERITY: P2
- SURFACE: Guest home realtime
- PHYSICAL EFFECT: Гость видит повторяющийся WebSocket handshake 403 в console.
- ROOT LOCATION: frontend/src/App.tsx; frontend/src/ws/client.ts; backend/src/ws/ws.service.ts
- EXPECTED OWNER: Guest не открывает запрещённый socket.
- ACTUAL OWNER: Frontend reconnect запускается; backend корректно запрещает guest.
- WHY THIS IS A GAP: Ожидаемый deny превращён в runtime noise.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Не подключать WS при guest context.

## SB-010 — Статистика / Аудит permission configurability

- SEVERITY: P2
- SURFACE: Статистика / Аудит permission configurability
- PHYSICAL EFFECT: MASTER имеет `ops.overview.read`, но UI и backend service всё равно запрещают экран.
- ROOT LOCATION: frontend/src/navigation/permissions.ts; backend/src/modules/ops/ops.service.ts
- EXPECTED OWNER: Configured permission определяет доступ с factory scope.
- ACTUAL OWNER: Hardcoded ADMIN/MANAGEMENT overlay делает permission неэффективным.
- WHY THIS IS A GAP: RolePermission не является фактическим owner.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Выбрать один контракт: permission-only либо явно не выдавать ineffective permission.

## SB-011 — Live factory A → B cache proof

- SEVERITY: P2
- SURFACE: Live factory A → B cache proof
- PHYSICAL EFFECT: Static reset и 16/16 foreign denies доказаны, но live switch невозможен без безопасного multi-factory actor.
- ROOT LOCATION: frontend/src/App.tsx; frontend/src/store/app.store.ts
- EXPECTED OWNER: Live A→B proves unmount/reset/refetch.
- ACTUAL OWNER: У всех census actors только «Завод 4».
- WHY THIS IS A GAP: Proof gap, не доказанный product defect.
- MUTATION REQUIRED TO PROVE?: MUTATION_PROOF_REQUIRED_IN_17B
- RECOMMENDED FIX SCOPE: Создать изолированный scoped fixture только в 17B либо проверить на реальном multi-factory actor.

## SB-012 — WebSocket factory broadcast

- SEVERITY: P2
- SURFACE: WebSocket factory broadcast
- PHYSICAL EFFECT: Любой non-guest socket завода получает id/status/type событий модулей вне своих permissions/departments.
- ROOT LOCATION: backend/src/ws/ws.service.ts broadcast/sendToFactory
- EXPECTED OWNER: Permission/recipient-scoped realtime invalidation или opaque factory revision.
- ACTUAL OWNER: Factory-wide metadata summary.
- WHY THIS IS A GAP: Содержимое сущности защищено API, но existence/status metadata шире RBAC.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Добавить event audience/permission filtering либо отправлять непривязанный к entity invalidation token.

## SB-013 — ОКК realtime

- SEVERITY: P2
- SURFACE: ОКК realtime
- PHYSICAL EFFECT: Другой открытый клиент не применяет создание/изменение брака без reload.
- ROOT LOCATION: backend/src/ws/events.ts + okk.service.ts; frontend/src/ws/client.ts
- EXPECTED OWNER: `okk_updated` consumer refresh.
- ACTUAL OWNER: Backend emits; frontend union/applyEvent не знает event.
- WHY THIS IS A GAP: Emitter без consumer.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Добавить typed event и scoped refresh OkkScreen.

## SB-014 — Frontend role policy overlays

- SEVERITY: P2
- SURFACE: Frontend role policy overlays
- PHYSICAL EFFECT: Announcement/return/phone-directory menu rules могут разойтись с backend policy.
- ROOT LOCATION: frontend/src/navigation/permissions.ts; backend/src/common/publication-policy.ts
- EXPECTED OWNER: Backend-derived effective capabilities.
- ACTUAL OWNER: Несколько duplicated role Sets во frontend и backend.
- WHY THIS IS A GAP: Parallel authority policy, хотя текущие role names совпадают.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Отдавать explicit capabilities в auth context; frontend role maps оставить только для labels.

## SB-015 — Мойка realtime

- SEVERITY: P2
- SURFACE: Мойка realtime
- PHYSICAL EFFECT: Message/issue события другого клиента не обновляют открытый WashScreen.
- ROOT LOCATION: backend/src/ws/ws.service.ts safePayloadSummary; wash.service.ts; frontend/src/ws/client.ts/WashScreen.tsx
- EXPECTED OWNER: Session-scoped refresh.
- ACTUAL OWNER: `sessionId` отбрасывается summary; WashScreen не слушает operational invalidation.
- WHY THIS IS A GAP: Emitter и active consumer не сходятся.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Сохранить safe session identifier/revision и подписать WashScreen на scoped refresh.

## SB-016 — Оттайка realtime

- SEVERITY: P2
- SURFACE: Оттайка realtime
- PHYSICAL EFFECT: Изменение на другом клиенте не обновляет открытый календарь оттайки.
- ROOT LOCATION: backend/src/modules/defrost/defrost.service.ts; frontend/src/screens/DefrostScreen.tsx
- EXPECTED OWNER: Defrost event invalidates defrost view.
- ACTUAL OWNER: Emits `line_updated`; DefrostScreen не имеет listener.
- WHY THIS IS A GAP: Связанный line consumer есть, профильный consumer отсутствует.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Добавить safe defrost invalidation event/listener.

## SB-017 — Offline outbox files

- SEVERITY: P3
- SURFACE: Offline outbox files
- PHYSICAL EFFECT: На current runtime не влияет.
- ROOT LOCATION: frontend/src/offline/db.ts; indexeddb.ts; sync-engine.ts; sync.ts
- EXPECTED OWNER: Либо complete imported owner, либо отсутствие.
- ACTUAL OWNER: Unreachable incomplete parallel outbox; один import не имеет export.
- WHY THIS IS A GAP: Dead architecture debt.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Отдельно удалить/завершить после подтверждения, не в 17A.

## SB-018 — Старые frontend owners

- SEVERITY: P3
- SURFACE: Старые frontend owners
- PHYSICAL EFFECT: На current bundle не влияют, но усложняют аудит.
- ROOT LOCATION: frontend/src/app/App.tsx; frontend/src/store/shift-store.ts; frontend/src/theme/status-colors.ts
- EXPECTED OWNER: Один current import graph.
- ACTUAL OWNER: Unreachable legacy App/store/theme fragments.
- WHY THIS IS A GAP: Dead duplicate implementation.
- MUTATION REQUIRED TO PROVE?: Нет
- RECOMMENDED FIX SCOPE: Отдельный non-product cleanup после import-graph proof.


## Grouping for a possible 17B

- GROUP A — dynamic directories/admin binding: 4 gaps (P1: 1, P2: 3) — SB-002, SB-007, SB-008, SB-014.
- GROUP B — forgotten/dead owners: 2 gaps (P3: 2) — SB-017, SB-018.
- GROUP C — notifications/realtime/deep links: 5 gaps (P2: 5) — SB-009, SB-012, SB-013, SB-015, SB-016.
- GROUP D — settings/module settings: 0 gaps.
- GROUP E — PWA/cache: 0 gaps; LOW residual release-discipline risk.
- GROUP F — access/integration/proof: 7 gaps (P1: 4, P2: 3) — SB-001, SB-003, SB-004, SB-005, SB-006, SB-010, SB-011.
