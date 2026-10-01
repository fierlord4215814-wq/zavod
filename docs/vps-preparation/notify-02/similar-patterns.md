# Новый bounded inventory после NOTIFY-02

27.09.2026. Current call sites, не общий аудит модулей и не доказательство всех crash paths. Только шесть событий NOTIFY-02 получили новый live SQL fault. «RETRY_RECOVERABLE» ниже означает повторный вход в persistent notifier по source, **не** гарантированное автоматическое восстановление, immutable recipient snapshot или exactly-once transport.

| Existing owner / call site | Что установлено | Классификация после NOTIFY-02 |
|---|---|---|
| `task/task.service.ts:createTask` → `persistTaskCreatedTx` | Принятый TASK-NOTIFY seam и тело createTask побайтно сохранены; прежние 8 targeted tests повторены | **ATOMIC_DURABLE**, retained PASS |
| `orders/orders.service.ts:createRequestTx,move,closeRequest` | Request/Movement/status + Processed/audit + required rows в одном tx; close resolve тоже внутри | **ATOMIC_DURABLE**; ранее **PROVEN_LOSS**, теперь RESOLVED — [before](fault-before.json), [after](sql-after.json) |
| `task/task.service.ts:completeTask,redirectTask,checkOverdueLongTasks` | Required rows и resolution/marker/history/audit внутри business tx; scanner task lock + recheck | **ATOMIC_DURABLE**; ранее **PROVEN_LOSS**, теперь RESOLVED. Ни одной новой открытой live-proven notification loss здесь нет |
| `orders/orders.service.ts:archiveItem` → resolve | Archive commit затем persistent resolve/count WS; не входит в исправленные create/move/close | **POSTCOMMIT_WINDOW_ONLY** по source. Повтор archive ограничен active item. Не новый live FAIL |
| `defrost/defrost.service.ts:start,end` (notify около299/376) | Notify после tx; processed result также доходит до notifier | **RETRY_RECOVERABLE** по source, окно до retry остаётся; изменение получателей после события отдельно не проверено |
| `wash/wash.service.ts:addIssue` (605) | Notify после tx вне changed; replay снова входит | **RETRY_RECOVERABLE** по source |
| Тот же `updateControlItem` (781) | DONE notify зависит от итогового статуса, не changed; same-status снова входит | **RETRY_RECOVERABLE** по source |
| Тот же `createControlItem,createOkkReview` (724/830) | Business tx затем notify; отдельного processed replay в inspected create нет | **POSTCOMMIT_WINDOW_ONLY**, не PROVEN_LOSS без отдельного fault |
| `announcements/announcements.service.ts:create/notifyImportant` (209/808) | Commit announcement/audit затем fanout; initial event не равен reminder | **POSTCOMMIT_WINDOW_ONLY** |
| Тот же `processReminderOccurrence` (379–399) | createOnce по occurrence/user до продвижения nextReminderAt; незавершённая occurrence может повторяться | **RETRY_RECOVERABLE** только пока eligibility сохраняется; **POLICY_DEPENDENT** для future/expired/late ACK/global и изменённой аудитории |
| `shift/shift.service.ts:cancelWillBe,removeWillBe` (1841/1900) | Commit статуса/планов/audit затем notify; повтор требует WILL_BE, уже изменённый статус исключён | **POSTCOMMIT_WINDOW_ONLY**, source skipped-state candidate; **не live-proven loss** |
| Тот же `createReturnRequest` (1937) | Commit PENDING request/audit, WS, затем notify; повтор rejected при существующем PENDING | **POSTCOMMIT_WINDOW_ONLY**, source skipped-state candidate; не исправлять здесь |
| `shift-log/shift-log.service.ts:createLog` (159) | Create log, отдельный audit, затем important notify | **POSTCOMMIT_WINDOW_ONLY**; новое fault/atomicity исследование не проводилось |
| `checklists/checklists.service.ts:closeRun` (1560) | AUTO_CLOSED notification после tx; уже AUTO_CLOSED возвращается и снова входит в notifier при том же закрытии | **RETRY_RECOVERABLE** по inspected source branch; достижимость конкретного внешнего retry отдельно не доказана |
| Тот же `closeRunByMaintenance` (1616) | Commit AUTO_CLOSED затем notify; следующий maintenance выбирает ACTIVE/PAUSED | **POSTCOMMIT_WINDOW_ONLY**, source skipped-state candidate; не PROVEN_LOSS |
| Тот же `runMaintenance` reminders (965/978) | Внешний tx с run-lock вызывает createOnce, который открывает **свой** tx; это не supplied-tx atomic business transition. Повтор возможен в due/overdue window | **RETRY_RECOVERABLE / POLICY_DEPENDENT** на временной границе; grace/shared refs не решены |
| `task:takeTask` | В текущем owner нет вызова required persistent TASK_TAKEN, только WS/legacy push | **POLICY_DEPENDENT**: не добавлять новое обязательное in-app событие по наличию неиспользуемого helper |
| Остальные owners/все downstream consumers/прочие notification producers | За пределами выбранного call-site inventory | **NOT_REVIEWED**. Отсутствие строки здесь не PASS |

Никакого outbox/schema58/worker не добавлено. Следующий пакет определяется более сильным новым live evidence: [два текущих разрыва file authority](remaining-gaps.md), а не автоматическим переписыванием остальных notification owners.
