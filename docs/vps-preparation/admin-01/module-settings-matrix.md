# ADMIN01 — все текущие настройки модулей

## Дельта ADMIN02 —26.09.2026

Из прежних30 dead подключено **только ShiftSettings.sendHomeRequiresComment**: existing Admin editor/preview→false→настоящий send-home UI без комментария→audit null→true restored. Backend default true, empty comment409, UI hint совпадает. [UI proof](../admin-02/comment-setting-ui.json), [HTTP default/error proof](../admin-02/ui-errors-final.json). Current counts:31 operational/editable,35 readonly, в том числе29 DEAD_CONFIG; reserved/superseded/forced deny unchanged. Positive/negative `returnRequestEnabled` также проверен [ADMIN02](../admin-02/report.md). Историческая66-field таблица ниже сохраняет состояние ADMIN01, не переписана задним числом; новая дельта не означает полноту остальных модулей.

Authority: `backend/prisma/schema.prisma`, действующие service consumers и `frontend/src/screens/AdminConfigScreen.tsx`. **66** бизнес-полей в восьми моделях, не 67. Технические `id/factoryId/createdAt/updatedAt` не считаются настройками. Инвентаризация: [source references](settings-source-inventory.json). Совпадение имени в serializer/preview/type не считается потребителем.

Текущий UI: 30 редактируемых полей, 36 read-only с объяснением. Среди 36: 30 без подключённого операционного потребителя, три reserved, два superseded legacy, один принудительный guest deny. В 30 operational: 25 bounded consumer PASS, пять PARTIAL. Это не полная приёмка модулей/ролей.

`E/P` = редактор → preview/подтверждение → HTTP → SQL → reload, исходные значения восстановлены. Общий [persistence receipt](settings-persistence.json) содержит первоначальные32 поля, включая два позже распознанных legacy defrost. `R/S` = показано read-only, поле хранится в модели/API; новый UI write не заявлен. Для всех строк DB owner — модель в заголовке. Все проверки локальные Windows; VPS/LINUX не проверены.

## ShiftSettings — 12

UI/API owner: AdminConfigScreen → AdminController `/admin/shift-settings` → AdminService. Реальные consumers — ShiftService, EmployeeService, PeopleService.

| Setting | UI / persistence | Consumer / реальный результат | Статус |
|---|---|---|---|
| dayShiftStartTime | R/S | Не используется; время идёт через текущую factory-time архитектуру | DEAD_CONFIG / PARTIAL |
| dayShiftEndTime | R/S | Операционного чтения нет | DEAD_CONFIG / PARTIAL |
| nightShiftStartTime | R/S | Операционного чтения нет | DEAD_CONFIG / PARTIAL |
| nightShiftEndTime | R/S | Операционного чтения нет | DEAD_CONFIG / PARTIAL |
| willBeOpenHoursBeforeShift | R/S | Операционного чтения нет | DEAD_CONFIG / PARTIAL |
| noShowCheckMinutesAfterShiftStart | R/S | Операционного чтения нет | DEAD_CONFIG / PARTIAL |
| minAssignmentMoveIntervalMinutes | E/P | [Реальные назначения](shift-remaining-ui.json): 60 → HTTP409; 1 после фактического интервала → UI201, оба назначения закрыты через STOP | PASS bounded |
| contractorLeadMaxPeoplePerShift | E/P | Лимит1: UI план одного допустимого человека201; два ID →409 лимита, но второй ID принадлежал lead, не второму допустимому contractor | PARTIAL: нет UI превышения двумя допустимыми людьми |
| returnRequestEnabled | E/P | false: `/shift/me` false и POST409; true потребитель найден, но положительная OFF_SHIFT ветвь не достигнута из-за `sendHome` home-factory guard | PARTIAL |
| autoCloseChecklistsAtShiftEnd | R/S | Не consumer текущего checklist maintenance | DEAD_CONFIG / PARTIAL |
| sendHomeRequiresComment | R/S | Комментарий обязателен независимо от поля | DEAD_CONFIG / PARTIAL |
| willBeCancelRequiresComment | E/P | [UI без комментария](shift-setting-ui.json) → HTTP → CANCELLED; capability больше не инвертирована значением требования | PASS bounded |

## TaskSettings — 12

AdminConfigScreen → AdminController `/admin/task-settings` → AdminService; TaskService/TasksScreen. [Живой receipt](task-settings-ui.json).

| Setting | UI / persistence | Consumer / результат | Статус |
|---|---|---|---|
| longTaskDefaultDeadlineHours | E/P | MASTER form7 часов после исправления formSettings и existing factory-time input/parse; раньше45 вместо7 | PASS bounded |
| longTaskEscalationEnabled | E/P | UI «Проверить долгие»: off0, on с grace0 →1 SQL escalatedAt | PASS bounded, не scheduler boundary |
| longTaskEscalationGraceMinutes | E/P | grace60 →0; grace0 →1 на том же просроченном LONG | PASS bounded |
| urgentTaskRequiresLineWhenCreatedFromLine | R/S | Чтения поля нет | DEAD_CONFIG / PARTIAL |
| taskRedirectRequiresComment | E/P | false → UI передача без комментария201; true → реальный409 | PASS bounded |
| taskDoneRequiresComment | E/P | true →409 без комментария; UI завершение с комментарием, DONE; отдельное правило просрочки не снято | PASS bounded |
| taskReadReceiptsEnabled | E/P | false →0 TaskRead; true → обычное открытие создаёт TaskRead | PASS bounded |
| taskAttachmentsEnabled | R/S | Старый frontend type не потребитель; файлы существуют независимо от флага | DEAD_CONFIG / PARTIAL |
| taskDepartmentRecipientsEnabled | R/S | Адресация реализована, но этот toggle её не управляет | DEAD_CONFIG / PARTIAL |
| taskPersonalAssigneeEnabled | R/S | Персональный исполнитель существует независимо от флага | DEAD_CONFIG / PARTIAL |
| taskChatMirrorEnabledReserved | R/S | Explicit reserved, не согласованное рабочее зеркало | DEFERRED_BY_PRODUCT |
| taskStorageRetentionMode | R/S | Операционного retention consumer нет | DEAD_CONFIG / PARTIAL |

## WashSettings — 11

AdminController `/admin/wash-settings` → AdminService; WashService/WashScreen. [Живой receipt](wash-defrost-settings.json): своя мойка DONE, обе control tasks DONE, issue решён, OKK approval сохранён.

| Setting | UI / persistence | Consumer / результат | Статус |
|---|---|---|---|
| washIssueRequiresPhoto | R/S | Операционного чтения нет | DEAD_CONFIG / PARTIAL |
| washIssueResolveRequiresPhoto | E/P | true без фото →409; false → UI resolve без фото; не доказан новый picker в самой форме resolve | PASS bounded guard |
| washCompleteRequiresOkkReview | E/P | true →409 до OKK; UI approval → completion | PASS bounded |
| washCompleteRequiresNoOpenIssues | E/P | true с issue →409; false проходит этот guard; issue затем штатно закрыт | PASS bounded |
| washMiniTasksEnabled | E/P | off409; on → настоящая UI mini-task | PASS bounded |
| washControlEnabled | E/P | off409; on → UI control create/done | PASS bounded |
| washOkkReviewEnabled | E/P | off409; on → UI OKK review | PASS bounded |
| washDefaultControlItems | R/S | Автосоздания из поля нет | DEAD_CONFIG / PARTIAL |
| washAllowNonLineWorkers | R/S | Чтения поля нет; guards не менялись | DEAD_CONFIG / PARTIAL |
| washMessagesEnabled | R/S | Переписка есть, toggle не подключён | DEAD_CONFIG / PARTIAL |
| washAttachmentsEnabled | R/S | Вложения есть, toggle не подключён | DEAD_CONFIG / PARTIAL |

## DefrostSettings — 5

AdminController `/admin/defrost-settings` → AdminService; DefrostService/DefrostScreen. Current today start/complete специально игнорирует старые comment flags по `docs/stage37-defrost-calendar-ux.md`, § «Старт/Завершение». Это retained product contract, не ошибка guards. [Факт](wash-defrost-settings.json).

| Setting | UI / persistence | Consumer / результат | Статус |
|---|---|---|---|
| defrostCommentRequiredOnStart | R; историческое P | Legacy start consumer есть; текущий today UI с true принимает пустой комментарий согласно Stage37 | DEFERRED_BY_PRODUCT / SUPERSEDED_UI |
| defrostCommentRequiredOnEnd | R; историческое P | Legacy end409 без комментария, today UI завершает без него согласно Stage37 | DEFERRED_BY_PRODUCT / SUPERSEDED_UI |
| defrostShowOnLineDashboard | R/S | Операционного чтения нет | DEAD_CONFIG / PARTIAL |
| defrostCalendarEnabled | R/S | Календарь работает независимо от toggle | DEAD_CONFIG / PARTIAL |
| defrostAttachmentsEnabled | R/S | Чтения поля нет | DEAD_CONFIG / PARTIAL |

## OrderSettings — 8

OrdersController `/orders/settings` → OrdersService; OrdersStockScreen. Full settings permission не расширен; ordinary summary содержит только четыре form hints. [Живой receipt](orders-settings-ui.json).

| Setting | UI / persistence | Consumer / результат | Статус |
|---|---|---|---|
| lowStockNotificationsEnabled | E/P | off0 новых; on1 при пересечении порога; второй UI1095мс | PASS bounded |
| orderRequestNotificationsEnabled | R/S | Serializer/preview, не condition рассылки | DEAD_CONFIG / PARTIAL |
| restockRequiresComment | E/P | false → UI201; true →409 без комментария | PASS bounded |
| takeRequiresComment | E/P | false → UI201; true →409 без комментария | PASS bounded |
| archiveRequiresComment | E/P | true →409; false → UI archive, SQL archivedAt | PASS bounded |
| defaultUnit | E/P | Новая форма читает кг вместо захардкоженного шт; в первоначальной записи кг был выбран вручную | PASS формы; не автоматического первоначального create |
| warningYellowPercent | R/S | Serializer/preview, рабочий расчёт предупреждения не читает | DEAD_CONFIG / PARTIAL |
| warningRedPercent | R/S | То же | DEAD_CONFIG / PARTIAL |

## ChecklistSettings — 6

ChecklistsController `/checklists/settings` → ChecklistsService; ChecklistsScreen. [Pause/close receipt](checklist-settings-ui.json), [полный editor](checklist-editor-ui.json).

| Setting | UI / persistence | Consumer / результат | Статус |
|---|---|---|---|
| autoCloseAtDayShiftEnd | E/P | Maintenance consumer есть; естественная DAY граница не пройдена на ADMIN01 C | PARTIAL / NOT_VERIFIED_TIME_BOUNDARY |
| autoCloseAtNightShiftEnd | E/P | Maintenance consumer есть; естественная NIGHT граница не пройдена | PARTIAL / NOT_VERIFIED_TIME_BOUNDARY |
| requirePauseComment | E/P | false → MASTER UI pause201/PAUSED; true →409 без комментария, затем resume/close | PASS bounded |
| allowEditAfterCloseHours | E/P | Ноль → закрытый row HTTP409; положительный повторный UI вход в grace требует политики | PARTIAL / POLICY_PENDING |
| checklistAttachmentsEnabled | R/S | Serializer, не gate вложений | DEAD_CONFIG / PARTIAL |
| archiveEnabled | R/S | Serializer, не gate архива | DEAD_CONFIG / PARTIAL |

## ChatSettings — 7

AdminController `/admin/chat-settings` → ChatsService; ChatsScreen. [Живой receipt](chats-admin-ui.json). WORKER/CONTRACTOR ceiling сохраняется независимо от этих значений.

| Setting | UI / persistence | Consumer / результат | Статус |
|---|---|---|---|
| chatEnabled | E/P | false → write409; true → разрешённое UI сообщение | PASS bounded |
| attachmentsEnabled | R/S | Serializer, не gate guarded attachment | DEAD_CONFIG / PARTIAL |
| editWindowMinutes | E/P | Ноль →403; 30 → UI edit и второй reader | PASS bounded |
| deleteWindowMinutes | E/P | Ноль →403; 30 → UI soft-delete, SQL deletedAt | PASS bounded |
| retentionMonths | R/S | Нет retention executor | DEAD_CONFIG / PARTIAL |
| voiceReserved | R/S | Reserved field; существующая отправка audio не равна этому toggle | DEFERRED_BY_PRODUCT |
| videoReserved | R/S | Reserved | DEFERRED_BY_PRODUCT |

## AnnouncementSettings — 5

AdminController `/admin/announcement-settings` → AnnouncementsService; AnnouncementsScreen. [Живой receipt](announcements-ui.json).

| Setting | UI / persistence | Consumer / результат | Статус |
|---|---|---|---|
| defaultVisibleDays | E/P | Published/expires interval созданного UI объявления, SQL readback | PASS bounded |
| archiveRetentionDays | R/S | Retention executor отсутствует | DEAD_CONFIG / PARTIAL |
| attachmentsEnabled | R/S | Serializer, не gate вложений | DEAD_CONFIG / PARTIAL |
| guestCanRead | R/S | Принудительный false; guest denied canonical policy | N/A / EXPECTED_HIDDEN |
| importantBadgeEnabled | E/P | Важная публикация/флаг отображения, reader/report | PASS bounded |

## Настройки вне восьми моделей

Линия/позиция/состав/рабочая зона — отдельные конфигурационные сущности, не потерянные module toggles; владельцы и live proof в [Admin matrix](admin-acceptance-matrix.md). ОКК review настраивается через WashSettings. Для returns, handover, notifications, contact visibility нет отдельного текущего Admin settings model: действуют scope/RBAC, адресаты, права и существующие формы. Это **не автоматически MISSING_V1**. Phone visibility owner — PeopleService/effective capabilities; full contact policy permutations в ADMIN01 не проверялись. Общий enable/disable всех модулей не реализован отдельным универсальным переключателем; меню следует effective permissions. Timezone architecture, scheduler и runtime config не изменялись.
