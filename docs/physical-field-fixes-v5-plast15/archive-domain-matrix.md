# Пласт 15: canonical Archive domain matrix

Финальная сверка выполнена 25.08.2026. Все 11 фактических категорий читают canonical entities существующих модулей; frontend-local archive и второй исторический контур не создавались. `normalTotal = 0` для некондиции и заказов означает корректное пустое operational-состояние. Их source-to-detail contract доказан диагностическим ADMIN на сохранённой fixture history, не созданной Пластом 15.

## Заявки и простои

- CATEGORY: Заявки и простои (`tasks`).
- SOURCE MODULE: `task`, `line`.
- CANONICAL SERVICE: `TaskService`, `LineService`; read-model `ArchiveService.loadTasks/buildDowntimeAnalytics`.
- CANONICAL ENTITIES: `Task`, recipients, assignees, `TaskComment`, `TaskHistory`, exact linked `LineEvent`.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=tasks`, `/archive/detail/tasks/:sourceType/:itemId`, `/archive/downtime/*`.
- FACTORY SCOPE: `Task.factoryId` and linked `LineEvent.factoryId` equal selected factory.
- ROLE SCOPE: source task visibility; management analytics keeps its existing guard.
- LIST FIELDS: type, status, description, date, line, departments, assignee and timing summary.
- DETAIL FIELDS: creator, recipients, assignees, deadline, start/end, comments, status history and exact `lineStatusEventId` relation rendered as human context.
- ATTACHMENTS: task/comment files via guarded `/attachments/:id/file`.
- COMMENTS: canonical `TaskComment`.
- HISTORY: canonical `TaskHistory`; ordinary tasks are never inferred as downtime without the exact relation.
- EXPORT: full filtered selection, human labels, CSV-injection protection.
- PAGINATION: stable date/id order, `hasMore`, 24-row UI page and deduplicated load-more.
- KNOWN GAP: three real-looking open historical STOP events without reliable fixture markers remain visible and time-dependent; documented P2, no automatic mutation.
- STATUS: PASS.

## Чек-листы

- CATEGORY: Чек-листы (`checklists`).
- SOURCE MODULE: `checklists`.
- CANONICAL SERVICE: `ChecklistsService`; read-model `ArchiveService.loadChecklists`.
- CANONICAL ENTITIES: template/run snapshots, rows, occurrences, occurrence answers and pause events.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=checklists`, `/archive/detail/checklists/:sourceType/:itemId`.
- FACTORY SCOPE: `ChecklistRun.factoryId`.
- ROLE SCOPE: existing checklist permissions, scoped management and own-run policy.
- LIST FIELDS: historical name, close status/date, department, line, shift and actor.
- DETAIL FIELDS: run snapshot, occurrence lifecycle, item answers, numeric/tolerance result, yes/no/choice/text, comments, pause data, close reason and photo references.
- ATTACHMENTS: run/row/answer files through the guarded attachment endpoint.
- COMMENTS: row comments and close reason.
- HISTORY: immutable run/occurrence snapshot; 723 legacy active children are mapped as “Закрыта вместе с запуском” when the parent is closed.
- EXPORT: all filtered rows, not only the visible client page.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: stored status of 723 legacy children remains inconsistent by design; read-model correction prevents operational misclassification.
- STATUS: PASS.

## ОКК

- CATEGORY: ОКК (`okk`).
- SOURCE MODULE: `okk`.
- CANONICAL SERVICE: `OkkService`; read-model `ArchiveService.loadOkk`.
- CANONICAL ENTITIES: `OkkRecord`, immutable `QuantityReleaseOperation` ledger.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=okk`, `/archive/detail/okk/:sourceType/:itemId`.
- FACTORY SCOPE: selected factory.
- ROLE SCOPE: `okk.read` or ADMIN.
- LIST FIELDS: product/article, line, quantity/unit, status, decision and remaining quantity.
- DETAIL FIELDS: original/released/remaining quantity, issue, decision, corrective fields, actors and timestamps.
- ATTACHMENTS: canonical ОКК photos/files.
- COMMENTS: description, mismatch, decision, correction and release comments.
- HISTORY: immutable partial-release ledger preserved.
- EXPORT: full filtered result.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: none in P15 scope.
- STATUS: PASS.

## Возвраты на производство

- CATEGORY: Возвраты на производство (`returns`).
- SOURCE MODULE: `returns`.
- CANONICAL SERVICE: `ReturnsService`; read-model `ArchiveService.loadReturns`.
- CANONICAL ENTITIES: `ReturnRecord`, immutable `QuantityReleaseOperation` ledger.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=returns`, `/archive/detail/returns/:sourceType/:itemId`.
- FACTORY SCOPE: selected factory.
- ROLE SCOPE: `returns.read` or ADMIN.
- LIST FIELDS: source/product, quantity, status, decision and remaining quantity.
- DETAIL FIELDS: source context, original/released/remaining values, decisions, actors and timestamps.
- ATTACHMENTS: canonical return files.
- COMMENTS: mismatch, decision, corrective and release comments.
- HISTORY: final state plus immutable release operations.
- EXPORT: full filtered result.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: none in P15 scope.
- STATUS: PASS.

## Некондиция

- CATEGORY: Некондиция (`stock`).
- SOURCE MODULE: `stock`.
- CANONICAL SERVICE: `StockService`; read-model `ArchiveService.loadStock`.
- CANONICAL ENTITIES: `StockDefect`.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=stock`, `/archive/detail/stock/:sourceType/:itemId`.
- FACTORY SCOPE: selected factory.
- ROLE SCOPE: `stock.read` or ADMIN.
- LIST FIELDS: product/name, quantity, unit, status, comment, actor and dates.
- DETAIL FIELDS: all fields actually stored by the model; no invented warehouse semantics.
- ATTACHMENTS: canonical stock-defect files.
- COMMENTS: canonical comment.
- HISTORY: record timestamps and archive state.
- EXPORT: full filtered result; empty normal selection exports headers safely.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: normal operational count is zero; diagnostic history proves the adapter/detail contract.
- STATUS: PASS.

## Заказы / Остатки

- CATEGORY: Заказы / Остатки (`orders`).
- SOURCE MODULE: `orders`.
- CANONICAL SERVICE: `OrdersService`; read-model `ArchiveService.loadOrders`.
- CANONICAL ENTITIES: stock item, quantity movement and order request.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=orders`, `/archive/detail/orders/:sourceType/:itemId`.
- FACTORY SCOPE: selected factory plus existing department scope.
- ROLE SCOPE: `orders.read` or ADMIN.
- LIST FIELDS: item/request, movement or request status, quantity, department and date.
- DETAIL FIELDS: old/new quantity where canonical, reason, requester, closer, request status and timestamps.
- ATTACHMENTS: item/order attachments through guarded source access.
- COMMENTS: movement reason and request close comment.
- HISTORY: canonical movement ledger and request lifecycle; closing an order does not synthesize stock changes.
- EXPORT: full filtered result.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: normal operational count is zero; diagnostic history proves both source types.
- STATUS: PASS.

## Мойка

- CATEGORY: Мойка (`wash`).
- SOURCE MODULE: `wash`.
- CANONICAL SERVICE: `WashService`; read-model `ArchiveService.loadWash`.
- CANONICAL ENTITIES: session, assignments, messages, issues, events, control items and ОКК reviews.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=wash`, `/archive/detail/wash/:sourceType/:itemId`.
- FACTORY SCOPE: selected factory.
- ROLE SCOPE: `wash.read` or ADMIN.
- LIST FIELDS: line/area, status, start/end, actors and aggregate counts.
- DETAIL FIELDS: people history, event/message timeline, issues/resolution, controls, mini-tasks and ОКК review.
- ATTACHMENTS: session and child-event files through guarded source access.
- COMMENTS: canonical messages, issues, controls and reviews.
- HISTORY: canonical session/event lifecycle; business lifecycle unchanged.
- EXPORT: full filtered result.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: none in P15 scope.
- STATUS: PASS.

## Оттайка

- CATEGORY: Оттайка (`defrost`).
- SOURCE MODULE: `defrost`.
- CANONICAL SERVICE: `DefrostService`; read-model `ArchiveService.loadDefrost`.
- CANONICAL ENTITIES: `DefrostEvent`.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=defrost`, `/archive/detail/defrost/:sourceType/:itemId`.
- FACTORY SCOPE: selected factory.
- ROLE SCOPE: existing non-guest archive/source permissions.
- LIST FIELDS: line/chamber, event status, start/end and comment.
- DETAIL FIELDS: event/context, start/end actor, timestamps, duration and comments.
- ATTACHMENTS: none beyond what the actual source model supports.
- COMMENTS: start/end comments.
- HISTORY: canonical event timestamps.
- EXPORT: full filtered result.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: none in P15 scope.
- STATUS: PASS.

## Пересменка / Журнал

- CATEGORY: Пересменка / Журнал (`shiftLog`).
- SOURCE MODULE: `shift-log`.
- CANONICAL SERVICE: `ShiftLogService`; read-model `ArchiveService.loadShiftLog`.
- CANONICAL ENTITIES: `ShiftLog`, comments and persisted handover JSON snapshot.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=shiftLog`, `/archive/detail/shiftLog/:sourceType/:itemId`.
- FACTORY SCOPE: selected factory.
- ROLE SCOPE: ADMIN or own department under existing shift-log permissions.
- LIST FIELDS: title, shift/date, status, department, author and snapshot summary.
- DETAIL FIELDS: stored working-line/article/plan/corrugated/wash/unresolved-downtime snapshot plus comments and actors.
- ATTACHMENTS: canonical shift-log files.
- COMMENTS: canonical log comments and source text.
- HISTORY: persisted snapshot only; current live state is never recomputed.
- EXPORT: full filtered result.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: none in P15 scope.
- STATUS: PASS.

## Объявления

- CATEGORY: Объявления (`announcements`).
- SOURCE MODULE: `announcements`.
- CANONICAL SERVICE: `AnnouncementsService`; read-model `ArchiveService.loadAnnouncements`.
- CANONICAL ENTITIES: announcement, audience departments and reads.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/items?section=announcements`, `/archive/detail/announcements/:sourceType/:itemId`.
- FACTORY SCOPE: selected factory/global audience under canonical policy.
- ROLE SCOPE: existing announcement visibility and archive permission.
- LIST FIELDS: title, priority/status, publication date, department and text summary.
- DETAIL FIELDS: content, audience, author, publish/archive window and read history.
- ATTACHMENTS: canonical announcement files.
- COMMENTS: announcement text.
- HISTORY: publication/archive/read timestamps.
- EXPORT: full filtered result.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: none in P15 scope.
- STATUS: PASS.

## Файлы и вложения

- CATEGORY: Файлы и вложения (`attachments`).
- SOURCE MODULE: `attachments` plus each source owner.
- CANONICAL SERVICE: `AttachmentsService`; source resolver in `ArchiveService`.
- CANONICAL ENTITIES: active `Attachment` metadata and guarded source entity.
- ARCHIVE ENDPOINT/READ MODEL: `/archive/attachments`; bytes only through `/attachments/:id/file`.
- FACTORY SCOPE: attachment and resolved source factory.
- ROLE SCOPE: source entity visibility; Archive grants no independent file privilege.
- LIST FIELDS: safe filename, kind, size, date, human uploader and source title.
- DETAIL FIELDS: safe metadata only; absolute path and storage internals are never returned.
- ATTACHMENTS: this category is the attachment catalog.
- COMMENTS: not applicable.
- HISTORY: creation metadata; soft-deleted files excluded.
- EXPORT: safe metadata only over the full filtered selection.
- PAGINATION: stable and duplicate-free.
- KNOWN GAP: canonical missing-file behavior remains owned by the attachment endpoint.
- STATUS: PASS.

## Final matrix gate

| Category | Source→Archive | List | Detail | Filter | Attachment | Export | Status |
|---|---|---|---|---|---|---|---|
| Заявки / простои | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Чек-листы | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| ОКК | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Возвраты | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Некондиция | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Заказы / Остатки | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Мойка | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Оттайка | PASS | PASS | PASS | PASS | N/A | PASS | PASS |
| Пересменка / Журнал | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Объявления | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Файлы и вложения | PASS | PASS | safe metadata | PASS | guarded file | PASS | PASS |
