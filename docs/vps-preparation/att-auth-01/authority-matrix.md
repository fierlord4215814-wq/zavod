# ATT-AUTH-01 — источник → вложение → операция

27.09.2026. Windows owned copy `zavod_factory01_attauth01`; это не Linux/VPS proof. Один canonical backend, production auth, обычные bearer tokens после браузерного входа. Подробные HTTP/SHA receipts: [before](live-before.json), [Orders 96 checks](orders-matrix.json), [семейства](families.json), [UI](ui.json).

| Владелец / точка | Что уже было | Подтверждённый разрыв → минимальное изменение | Проверка |
|---|---|---|---|
| `backend/src/common/user-context.service.ts:resolve`, `permission.guard.ts`, `admin/admin.service.ts:grantFactoryAccess` | Current User/UFA/factory/blocked/deleted/authEpoch; ADMIN и guest независимы. PermissionGuard guest-first | Не изменены; не второй auth engine и не запрет сохранить ADMIN+guest | Canonical grant201; before source/Notifications403 и file200. После grant — все file операции403; старые tokens проверены реальным resolver |
| `attachments/attachments.service.ts:assertCurrentAccess/assertPermission/validateAttachmentAccess/upload` | Guards по типам и операциям, safe serialization, denial audit fail-closed | ADMIN return обходил guest. Current guest/отсутствующий selected factory теперь проверяется до ADMIN и специальных ветвей | 13 initial isolated: before12 FAIL/1 PASS →13 PASS; final test suite расширен до14. Реальные guest/adminGuest/blocked/deleted/revoked/stale auth requests, audit failure изолированно |
| `orders/orders-source-authority.ts:ordersDepartmentVisibilityWhere`; `orders.service.ts:departmentVisibilityWhere` | Non-guest ADMIN видит выбранный завод; остальные — exact departmentId. Null/shared не public; без отдела `__none__`; GLOBAL означает exact id, не все заводы | Predicate извлечён без расширения source permissions; Orders и Attachments используют одну функцию. Никакого вызова полного Orders GET из Attachments | Own/shared/other/GLOBAL/no-department, роли/старый token, foreign selected factory |
| `attachments.service.ts:assertOrdersAttachmentAccess` / ORDER_REQUEST | Источник требует orders.read; direct entity reader сохраняется после закрытия. Active list и archive list — разные фильтры | Файл проверял только factory. Добавлены selected factory + общий department predicate; read сохраняется для закрытого entity, upload/delete требуют ACTIVE | Source409/file200 before → source409/file403; законное read metadata/bytes SHA200 active/archive, archived upload/delete403 даже ADMIN |
| Та же точка / MINIMUM_STOCK_ITEM | Direct source read включает архив/неактивное; write permissions отдельные | Factory+department; upload/delete только isActive && archivedAt=null | Все режимы как выше; shared MANAGEMENT denial; физическое удаление не используется |
| Та же точка / MINIMUM_STOCK_MOVEMENT | Движение принадлежит item; item detail — источник чтения, самостоятельного movement GET нет | Проверяются movement.factoryId и parent item factory/department/state; одного movement.factoryId недостаточно | Parent foreign при собственном movement →403; собственный item/movement →bytes SHA200; parent archive →read200/write403 |
| `validateAttachmentAccess`; `listForEntities` + четыре Orders callers | Internal helper не публичный auth endpoint; owners должны передавать уже разрешённые source ids | Attachment.factoryId не совпадал с parent, а внутренний serializer отдавал его metadata. Direct boundary rejects; Orders callers передают selected factory, helper фильтрует binding | [Before/after внутренней выдачи](source-binding-after.json); foreign/null binding denied, никакого silent repair. Read-only source detail200 без ошибочного attachment |
| `uploadUnlocked` | uploadedById+operationId replay; новая цель проверялась до поиска old result | Live B revoked/A allowed возвращал metadata B. Теперь проверяется сохранённое вложение/current write authority и binding; deleted replay rejected; legitimate same replay retained | Direct B403 + replayA201/B metadata before → replay403 без metadata/дубля. Same lawful replay201/sameid; new target не маскирует old object. Общая changed-payload policy не решалась |
| `uploadChecklistReference` | Собственный transactional lock/row authority/replay; byte identity и сохранение A/B | Дополнительно проверен existing.factoryId до чтения bytes replay; прежняя reference policy не менялась | Historical A/current B bytes читаются; guest403; reference deactivation403. Новая загрузка в активный template — законная отдельная операция |
| `assertShiftLogAttachmentAccess` | Department/factory, архив отдельно, канонический ShiftLog запрещает изменения immutable handover | Archive-only пропускал ordinary file; immutable handover позволял upload. Добавлены ordinary read permission и parseShiftHandover write/delete denial | 2 новые isolated negatives до FAIL →PASS; [live source409/upload201 before](handover-boundary-before.json) →read SHA200/upload/delete403 ADMIN и MASTER [after](handover-boundary-after.json). Pure archive-only context — isolated, не live-grant claim |

## Матрица трёх Orders types

Во всех случаях metadata и bytes проверены отдельно. Allowed reads сверяют SHA; denials не содержат attachmentId/metadata/storagePath. Проверены selected non-guest ADMIN, свой/чужой/null отдел, exact GLOBAL, отсутствие отдела, foreign selected factory, guest/adminGuest, blocked/deleted/revoked, смена роли/отдела с тем же токеном, stale authEpoch, восстановление. Старые notification/id не дают доступа. HTTP-коды source409, file403 — действующее скрытие источника, не универсальный новый код.

Read/write/delete различаются: active разрешённый ADMIN upload201 и soft-deactivate200; archive read200, upload/deactivate403. Existing permissions (`orders.request`, `orders.take`, `orders.items.manage`, STORE upload compatibility) сохранены, чтение не выдаёт новое write permission. HEAD200/empty и Range200/full body охарактеризованы на разрешённом файле; после revoke оба403. Новый206/streaming не добавлен.

## Прямые потребители internal metadata helper

Source inspection, не blanket live security acceptance всех экранов:

| Existing owner | Отбор до `listForEntities` |
|---|---|
| Orders items/item/requests/request | itemWhere/requestWhere selected factory+department; теперь также factory-bound metadata |
| Task withAttachments | list/detail/archive проходят canSeeTask/selected factory; comment ids получены из этих задач |
| Chats detail/media | loadChat/canReadChat и membership текущего пользователя; messages принадлежат разрешённому chat |
| Checklists serializeRuns/reference DTO | runWhere/архивный owner/selected factory/department; reference select исключает private path. Этот пакет не меняет существующую политику self/manage/archive |
| ShiftLog serializeLogs | logWhere + отдельный archive owner; обычное чтение не заменяет archive permission |
| Wash serializeSessions/control | selected factory sessions/visible control items из owner; downstream children этих sessions |
| OKK/Stock/Returns | Guard/controller и selected factory list owner, затем visible rows/архивные rows |
| Announcements/ErrorReport | loadVisible/audience/current scope либо report owner/admin; helper получает отобранные ids |
| COMMON profile | отдельный People owner/active target UFA; не общий COMMON upload |

Нельзя использовать `listForEntities` как публичную авторизацию. Его optional factory filter — проверка целостности bindings при сериализации, не новый движок прав.

## Специальные ветви, проверенные реально

[families.json](families.json): Task/comment; chat с разрешённым membership → revoke403 →restore SHA200, WORKER/CONTRACTOR403; checklist reference A/B отдельно от result/entry/run/runRow; закрытые run/check immutable; ordinary journal; OKK/return/stock, COMMON profile, wash message/issue/control, announcement. У каждого выбранного семейства есть положительные HTTP bytes/SHA и ADMIN+guest metadata/file/upload/deactivate403. RUN/RUN_ROW — явно обозначенные isolated SQL attachment bindings к реально закрытому run, не новый UI lifecycle. Profile photo штатно soft-removed, свои чаты архивированы, байты сохранены. Бизнес/архивные таблицы до/после read-only file reads совпали; audit учитывается отдельно.

Immutable handover — отдельная сохранённая synthetic SQL fixture с каноническим encoding и настоящим HTTP; **не** повторная приёмка всего handover lifecycle. Pure archive-only изолированный контекст не выдаётся за новый production grant: grants/role matrix не менялись.

## UI / остаточные границы

[ui.json](ui.json): 390/1440, два обычных browser contexts; source →preview→actual bytes, смена отдела через Admin API/current WS, новые запросы409/403; настоящий held200 response отпущен после смены контекста, source modal/preview/protected images остались0; old personal notice сохранился, source/file denied; restore→UI/bytes200. Без F5/mock. Уже полученные до revoke bytes с устройства не отзываются.

GENERAL changed business payload / notification publication/grace / Range206 / full roles/five gates/original063/29 settings остаются прежними policy/acceptance границами. J20 не ослаблен. Нет оснований объявлять весь v1 Pilot Ready.
