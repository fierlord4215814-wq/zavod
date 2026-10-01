# DEAD_SETTINGS_OBSERVATION

Ровно29 current DEAD_CONFIG после ADMIN02, а не30. `sendHomeRequiresComment` уже operational и повторно не исправлялся. Основание: retained [66-field inventory/owners](../admin-01/module-settings-matrix.md), [source inventory](../admin-01/settings-source-inventory.json); текущие owner hashes в [final-source-checks](final-source-checks.json). FACTORY01 не подключал ни один из29 флагов.

Общий persistence/UI owner: `backend/prisma/schema.prisma` → `backend/src/modules/admin/admin.service.ts`/`admin.controller.ts` → `frontend/src/screens/AdminConfigScreen.tsx`. Для orders settings также `backend/src/modules/orders/orders.service.ts`/`orders.controller.ts`. Read-only значение/serializer — **не** операционный consumer. В таблице указан именно ожидаемый модульный consumer, его наличие не означает чтения данного поля.

| # / setting | Ожидаемый эффект, если будет согласован | Фактический эффект / T1 observation | Consumer owner | Приоритет |
|---|---|---|---|---|
|1 ShiftSettings.dayShiftStartTime |Настраиваемое начало DAY |Нет операционного чтения; T1 использует существующее factory-time08/20, Windows clock не менялся |`backend/src/common/shift-time.ts`, `modules/shift/shift.service.ts` |USEFUL_LATER; передVPS сверить реальный режим завода |
|2 dayShiftEndTime |Конец DAY |То же; current/future и scheduler contract не заменены значением поля |Те же |USEFUL_LATER |
|3 nightShiftStartTime |Начало NIGHT |То же |Те же |USEFUL_LATER |
|4 nightShiftEndTime |Конец NIGHT |То же |Те же |USEFUL_LATER |
|5 willBeOpenHoursBeforeShift |Окно «Я буду» |Поле не управляет окном;4 фактических UI confirmations прошли current rule |`backend/src/modules/shift/shift.service.ts` |USEFUL_LATER |
|6 noShowCheckMinutesAfterShiftStart |Настраиваемый срок no-show |Операционного чтения нет; T1 не повторял временную boundary |Shift/assignment maintenance existing owners |USEFUL_LATER; предпосылка, не новыйPASS |
|7 autoCloseChecklistsAtShiftEnd |Единый сменный autoclose |Не owner current checklist maintenance; отдельные ChecklistSettings существуют |`backend/src/modules/checklists/checklists.service.ts` |DEFERRED/REMOVE_CANDIDATE как дублирующее поле |
|8 TaskSettings.urgentTaskRequiresLineWhenCreatedFromLine |Обязательность линии |Toggle не читается; T1 создал реальные заявки на4линиях через current form/guard |`backend/src/modules/task/task.service.ts`, `frontend/src/screens/TasksScreen.tsx` |DEFERRED/REMOVE_CANDIDATE до точного правила |
|9 taskAttachmentsEnabled |Включение вложений |Файлы задач работают, флаг ими не управляет |Task + `modules/attachments/attachments.service.ts` |USEFUL_LATER |
|10 taskDepartmentRecipientsEnabled |Включение departmentaddressing |Реальная адресация5tech работает независимо отtoggle |TaskService/TasksScreen |USEFUL_LATER |
|11 taskPersonalAssigneeEnabled |Включение personalassignee |Личные TECH/MGMT/TECHNOLOG задачи работают независимо отtoggle |TaskService/TasksScreen |USEFUL_LATER |
|12 taskStorageRetentionMode |Retention задач |Executor нет; история не удалялась |TaskService/archive owner |DEFERRED/REMOVE_CANDIDATE; retention-policy требуется |
|13 WashSettings.washIssueRequiresPhoto |Обязательное фото issue |Toggle не consumer; отдельный resolve-photo guard проверен без его подмены |`backend/src/modules/wash/wash.service.ts`, `frontend/src/screens/WashScreen.tsx` |USEFUL_LATER |
|14 washDefaultControlItems |Автосоздание контрольных пунктов |Автосоздания изполя нет; current UI control task создаётся вручную и DONE |WashService/WashScreen |USEFUL_LATER |
|15 washAllowNonLineWorkers |Разрешать неработниковлинии |Поле не guard; фактические permissions/scope сохранены |WashService/assignment owner |DEFERRED/REMOVE_CANDIDATE до явного attendance-rule |
|16 washMessagesEnabled |Включать переписку мойки |Переписка прошла, toggleнеуправляет |WashService/WashScreen |USEFUL_LATER |
|17 washAttachmentsEnabled |Включать washfiles |Фото/guarded read прошли, toggleнеуправляет |WashService/AttachmentsService |USEFUL_LATER |
|18 DefrostSettings.defrostShowOnLineDashboard |Показывать на line dashboard |Операционного чтения нет; lifecycle/calendar прошли |`backend/src/modules/defrost/defrost.service.ts`, `frontend/src/screens/DefrostScreen.tsx` |USEFUL_LATER |
|19 defrostCalendarEnabled |Включать календарь |Календарь работает независимо отtoggle |DefrostService/DefrostScreen |USEFUL_LATER |
|20 defrostAttachmentsEnabled |Включать attachments |Потребителя нет; отдельная photo ветвь оттайки не принята этим T1 cycle |DefrostService/AttachmentsService |DEFERRED/REMOVE_CANDIDATE |
|21 OrderSettings.orderRequestNotificationsEnabled |Переключать requestnotice |Serializer не condition; minimumnotice управляется **другим**, действующим lowStockNotificationsEnabled |`backend/src/modules/orders/orders.service.ts`, `modules/notifications/notifications.service.ts` |USEFUL_LATER |
|22 warningYellowPercent |Настраиваемый yellowthreshold |Расчёт этот параметр не читает; current min5 иnotice проверены |OrdersService/`frontend/src/screens/OrdersStockScreen.tsx` |USEFUL_LATER |
|23 warningRedPercent |Настраиваемый redthreshold |То же |Те же |USEFUL_LATER |
|24 ChecklistSettings.checklistAttachmentsEnabled |Переключать attachments |References/resultfiles иguards реально работают, флаг ими не управляет |`backend/src/modules/checklists/checklists.service.ts`, `frontend/src/screens/ChecklistsScreen.tsx` |USEFUL_LATER |
|25 archiveEnabled |Переключать checklistarchive |Архив/readonly/P/R работает независимо отtoggle |Те же/AttachmentsService |DEFERRED/REMOVE_CANDIDATE до archive-policy |
|26 ChatSettings.attachmentsEnabled |Переключать chatfiles |Guardedupload/download/revoke работает независимо отtoggle |`backend/src/modules/chats/chats.service.ts`, `frontend/src/screens/ChatsScreen.tsx` |USEFUL_LATER |
|27 retentionMonths |Retention переписки |Executorнет; физическая очистка не выполнялась |ChatsService |DEFERRED/REMOVE_CANDIDATE; retention-policy |
|28 AnnouncementSettings.archiveRetentionDays |Retention публикаций |Executorнет;currentarchive прошёл, история сохранена |`backend/src/modules/announcements/announcements.service.ts` |DEFERRED/REMOVE_CANDIDATE; retention-policy |
|29 attachmentsEnabled |Переключать announcementfiles |Current photo+scope/revoke/archive/P/R работают безtoggle |AnnouncementsService/AttachmentsService |USEFUL_LATER |

`DEAD_SETTINGS_BLOCKING_BEFORE_VPS=NONE_PROVEN_IN_T1_SCENARIOS`. Ни один конкретный из29 флагов не помешал утверждённому T1 сценарию. Это не доказательство пригодности всех настроек для любого будущего завода: режим времени/политики вложений/retention нужно согласовать перед deployment. Неработающий toggle не означает неработающий модуль.

Два checklist defects (INFO requirements и upload retry) и identity race не объяснялись deadsettings: исправлены реальные frontend owners. Потеря task-notification после commit — отдельный **BLOCKING_BEFORE_VPS**, не `orderRequestNotificationsEnabled` и не поручение массово подключить29 полей.

Минимальный будущий подход: выбрать **один** действительно нужный параметр, утвердить meaning/совместимость, связать существующий editor→service consumer→UI guard, проверить обе величины/роли/scope/secondreader/restart. Сейчас это не выполнялось. Reserved voice/video/taskChatMirror, superseded defrostcomment flags и принудительный guest deny в29 не включены.
