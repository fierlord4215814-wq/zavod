# Полный реестр пользовательских фиксов

Дата начала сверки: 18.07.2026. Это построчный реестр требований из Пластов 1-6, Пласта 8 и связанных ранних stage-документов. Одна строка описывает один наблюдаемый пользователем контракт; повторяющиеся формулировки дедуплицированы только когда описывают тот же самый контракт.

## Легенда evidence

- `B1`-`B6` — backend regression Пластов 1-6; `U1`-`U6` — соответствующие browser E2E.
- `S` — точечный stage/regression, `P` — privacy/security/access lifecycle evidence.
- `PHYSICAL_ONLY` не считается автоматическим пропуском и не повышает physical gate до PASS.

## A. PWA и mobile shell

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 001 | Шапка | Одна строка «Онлайн · Роль Фамилия» | 01/D, 08/A | `PremiumShell.tsx`, `App.tsx`, `styles.css` | B1 `/auth/me` | U1 360/390/430 | нет | PROVEN | — |
| 002 | Шапка | ФИО и роль берутся только из текущей сессии | 01/D, 08/A | `App.tsx`, store, `/auth/me` | B1 | U1 login A→B | нет | PROVEN | — |
| 003 | Шапка | Старое имя не остаётся после logout/login или смены роли | 01/D, 08/A | `App.tsx`, app store | P access lifecycle | U1, U2 | нет | PROVEN | — |
| 004 | Завод | Название завода читаемо на 360 px | 01/D, 08/A | `FactorySelectScreen.tsx`, `styles.css` | — | U1 360 | нет | PROVEN | — |
| 005 | Завод | Доступные заводы и CTA видны в первом viewport | 01/D, 08/A | `FactorySelectScreen.tsx` | — | U1 360/390 | нет | PROVEN | — |
| 006 | Shell | Верхняя/нижняя safe-area не съедает контент | 01/G, 08/A | `styles.css`, `App.tsx` | — | U1-U6 360/390/430 | частично | PROVEN | Реальный device inset — PHYSICAL_ONLY 170 |
| 007 | Shell | Bottom navigation фиксирована у viewport bottom | 01/G, 08/A | `App.tsx`, `styles.css` | — | U1-U6 | нет | PROVEN | — |
| 008 | Shell | Bottom navigation не перекрывает content/sticky CTA | 01/G, 08/A | `styles.css`, shared action rows | — | U1-U6 360/390/430 | частично | PROVEN | Реальная клавиатура — PHYSICAL_ONLY 171 |
| 009 | Modal/sheet | Внутренний scroll sheet/modal, а не уход за экран | 01/C,G, 08/A | `ActionModal.tsx`, mobile-back, `styles.css` | — | U1/U4/U5 | нет | PROVEN | — |
| 010 | Back | Android Back закрывает верхний layer прежде маршрута | 01/C, 08/A | `navigation/mobile-back.ts`, `ActionModal.tsx` | — | U1-U6 emulated | да | PROVEN | Hardware gesture — PHYSICAL_ONLY 172 |
| 011 | Back | Нет duplicate history и Back-loop | 01/C, 08/A | `mobile-back.ts`, `App.tsx` | — | U1 | да | PROVEN | Hardware gesture — PHYSICAL_ONLY 172 |
| 012 | Forms | Длинные русские CTA переносятся, target остаётся читаемым | 01/G, 08/A | `styles.css`, Premium action row | — | U3-U6 360/390/430 | нет | PROVEN | — |
| 013 | Forms | Visible loading/error/disabled state без ложной активность | 01/G, 08/A | `ActionModal.tsx`, `styles.css` | — | U1/U4/U5 | нет | PROVEN | — |
| 014 | Safety | Нет browser prompt/alert/confirm | 01/C, 08/A | shared modal stack | P scan | U1-U6 | нет | PROVEN | — |
| 015 | Ошибка | «Сообщить об ошибке» доступно каждой разрешённой роли | 01/F, 02/F, 08/A | `BugReportScreen.tsx`, error-report service | B1, P Guest | U1/U2 | нет | PROVEN | — |

## B. Вложения, чат и профиль

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 016 | Picker | Фото из галереи открывается direct user gesture | 01/A, 08/B | `AttachmentPicker.tsx` | B1 source | U1 | да | PROVEN | Реальный picker — PHYSICAL_ONLY 173 |
| 017 | Picker | Видео поддержано общим picker | 01/A, 08/B | `AttachmentPicker.tsx` | B1 source | U1 | да | PROVEN | Реальное видео — PHYSICAL_ONLY 173 |
| 018 | Picker | Камера/capture поддержана общим picker | 01/A, 08/B | `AttachmentPicker.tsx` | B1 source | U1 | да | PROVEN | Permission prompt — PHYSICAL_ONLY 173 |
| 019 | Picker | Произвольный файл поддержан общим picker | 01/A, 08/B | `AttachmentPicker.tsx` | B1 source | U1 | нет | PROVEN | — |
| 020 | Picker | Повторный выбор того же файла работает после input reset | 01/A, 08/B | `AttachmentPicker.tsx` | B1 source | U1 | да | PROVEN | Реальный OS picker — PHYSICAL_ONLY 173 |
| 021 | Upload | Общий transport даёт progress/cancel/retry/error | 01/A, 08/B | `api/attachments.ts`, `BugReportScreen.tsx` | B1 | U1 error/retry | нет | PROVEN | — |
| 022 | Upload | Attachment operationId не создаёт дубль при повторе | 01/A, 08/B | `api/attachments.ts`, backend attachment service | B1, P privacy | U1 | нет | PROVEN | — |
| 023 | Privacy | Public attachment DTO не раскрывает storagePath | 01/A, 08/B | attachment serializers/controllers | P privacy | U1 | нет | PROVEN | — |
| 024 | Chat | Чат использует общий picker/transport | 01/A, 08/B | `ChatsScreen.tsx`, `api/attachments.ts` | B1 | U1 chat | да | PROVEN | Реальная камера — PHYSICAL_ONLY 173 |
| 025 | Checklist | Checklist использует общий picker/transport | 01/A, 05/E, 08/B | `ChecklistsScreen.tsx`, `api/attachments.ts` | B1, B5 | U5 | да | PROVEN | Реальная камера — PHYSICAL_ONLY 173 |
| 026 | Quality | ОКК/брак использует общий transport | 01/A, 08/B | `OkkScreen.tsx`, `api/attachments.ts` | B1 | U5 | да | PROVEN | Реальная камера — PHYSICAL_ONLY 173 |
| 027 | Returns | Возвраты используют общий transport | 01/A, 05/D, 08/B | `ReturnsScreen.tsx`, `api/attachments.ts` | B1, B5 | U5 | да | PROVEN | Реальная камера — PHYSICAL_ONLY 173 |
| 028 | Orders | Заказы используют общий transport | 01/A, 05/C, 08/B | `OrdersStockScreen.tsx`, `api/attachments.ts` | B5 | U5 | да | PROVEN | Реальная камера — PHYSICAL_ONLY 173 |
| 029 | Tasks | Заявка с линии использует общий transport | 01/A, 08/B | `ShiftPeopleScreen.tsx`, `api/attachments.ts` | B1 after fix | U3 | нет | PROVEN_AFTER_FIX | Локальный FormData удалён |
| 030 | Errors | Error report использует общий transport | 01/A, 08/B | `BugReportScreen.tsx`, `api/attachments.ts` | B1 | U1 | да | PROVEN | Реальная камера — PHYSICAL_ONLY 173 |
| 031 | Chat profile | Avatar открывает компактный профиль участника | 01/E, 08/B | `ChatsScreen.tsx`, profile DTO | B1 safe DTO | U1 360 | нет | PROVEN | — |
| 032 | Chat profile | Профиль не раскрывает телефон/секретные поля | 01/E, 08/B | chat/profile DTO | P privacy | U1 | нет | PROVEN | — |
| 033 | Chat | Реакции, reply, edit и soft-delete доступны по правам | 08/B, Stage51/56A | `ChatsScreen.tsx`, chats service | S stage51 | U1/U5 | нет | PROVEN | — |
| 034 | Chat | Emoji, фото и видео не ломают composer | 08/B, Stage51/56A | `ChatsScreen.tsx`, picker | S stage51 | U1 360/390/430 | да | PROVEN | Camera/video physical — 173 |
| 035 | Voice | Deny/retry микрофона и release stream корректны | 01/B, 08/B | `ChatsScreen.tsx`, media helper | B1 source | U1 emulated | да | PHYSICAL_ONLY | Нужен физический микрофон |

## C. Роли, меню и identity

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 036 | Guest | Guest не видит объявления | 02/E, 08/C | announcements service, navigation | B2, P Guest | U2 | нет | PROVEN | Старый контракт — SUPERSEDED 037 |
| 037 | Guest | Старое «Guest видит объявления» заменено final deny | 02/E, 08 | matrix/docs | B2 | U2 | нет | SUPERSEDED | Final contract: строка 036 |
| 038 | Guest | Guest подаёт одну assignment request и видит статус | 02/E, 08/C | AssignmentRequests service, guest UI | B2 | U2 desktop/360 | нет | PROVEN | — |
| 039 | Guest | Guest не self-escalates и не выбирает forbidden reviewer/role | 02/E, 08/C | assignment requests guards | B2 | U2 | нет | PROVEN | — |
| 040 | Guest | Guest создаёт error report, но не открывает admin list | 01/F, 08/C | error-report service/menu | B1, P Guest | U1/U2 | нет | PROVEN | — |
| 041 | Worker | WORKER видит только свою смену и личные actions | 02/F, 08/C | permissions catalog, shift guards | B2, B3 | U2/U3 | нет | PROVEN | — |
| 042 | Worker | WORKER не spoof-назначает другого человека | 03/C, 08/C | ShiftService/assignment guards | B3 | U3 | нет | PROVEN | — |
| 043 | Worker | WORKER без checklist/returns/line management | 02/F, 08/C | navigation, service guards | B2, B5 | U2/U5 | нет | PROVEN | — |
| 044 | Store | STORE видит returns, но не stock/orders/defrost/full lines | 02/F, 05/B, 08/C | permissions catalog, services | B2, B3, B5 | U2/U3/U5 | нет | PROVEN | — |
| 045 | Tech | TECH_* имеет read-only line/people и service tasks | 02/F, 03/F, 08/C | navigation, line/assignment guards | B2, B3 | U2/U3 | нет | PROVEN | — |
| 046 | Contractor | CONTRACTOR имеет только собственный status/assignment | 02/F, 03/D, 08/C | navigation, shift guards | B2, B3 | U2/U3 | нет | PROVEN | — |
| 047 | Contractor lead | Lead ограничен своей фирмой, планом и фактом | 02/F, 03/D, 08/C | company service, submissions | B2, B3 | U2/U3 | нет | PROVEN | — |
| 048 | Master | MASTER управляет линиями, людьми, заданиями, мойкой/оттайкой | 02/F, 03, 04, 08/C | permission catalog, services | B2-B4 | U2-U4 | нет | PROVEN | — |
| 049 | Management/Admin | MANAGEMENT/ADMIN получают только разрешённый factory scope | 02/F, 06/E, 08/C | middleware, permission guards | B2, B6, P access | U2/U6 | нет | PROVEN | — |
| 050 | Lifecycle | Logout A→login B не оставляет stale menu | 02, 08/C | auth refresh, app store | P lifecycle | U1/U2 | нет | PROVEN | — |
| 051 | Lifecycle | Live role change обновляет menu/API без relogin | 02/E,F, 08/C | `/auth/me`, navigation | P live-role | U2 360 | нет | PROVEN | — |
| 052 | Lifecycle | Blocked/deactivated user не получает рабочий context | 02, 08/C | middleware, auth service | P lifecycle | U2 | нет | PROVEN | — |
| 053 | Menu preview | Admin preview использует тот же catalog, что реальное меню | 02/F, 06/D, 08/C | `navigation/permissions.ts`, admin UI | B6 | U6 | нет | PROVEN | — |

## D. Организация, телефоны и фирмы

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 054 | Оргструктура | Factory, Department, JobTitle и Role разделены | 02/A, 08/D | Prisma schema, AdminService | B2 | U2/U6 | нет | PROVEN | — |
| 055 | Оргструктура | ExternalCompany не становится Department | 02/D, 08/D | Prisma/Admin services | B2 | U2/U6 | нет | PROVEN | — |
| 056 | Оргструктура | Operational forms передают departmentId, не text | 02/A,B, 08/D | directory/Admin services | B2, B5 | U2/U5 | нет | PROVEN | — |
| 057 | Оргструктура | Нет hardcoded operational department list | 02/B, 08/D | canonical Department directory | B2, P adversarial | U2/U5 | нет | PROVEN | — |
| 058 | Оргструктура | Inactive department/position не попадает в operational form | 02/A, 08/D | directory services/UI | B2 | U2/U6 | нет | PROVEN | — |
| 059 | Телефон | +7/8/spaces дают одну identity при login/search | 02/C, 08/D | phone normalizer/AuthService | B2 | U2 | нет | PROVEN | Fixture-only normalizer P2 tracked |
| 060 | Телефон | Duplicate canonical phone блокируется с русской ошибкой | 02/C, 08/D | Admin/Auth services | B2 | U2/U6 | нет | PROVEN | — |
| 061 | Фирма | Старший подключает работника по ФИО/телефону без duplicate User | 02/D, 03/D, 08/D | company/assignment-request service | B2, B3 | U2/U3 | нет | PROVEN | — |
| 062 | Фирма | Deactivate/archive фирмы сохраняет историю | 02/D, 08/D | AdminService, Prisma | B2 | U2/U6 | нет | PROVEN | — |
| 063 | Локализация | CONTRACTOR и LEAD имеют русские human labels | 02/D, 08/D | labels/Admin UI | B2 | U2/U6 | нет | PROVEN | — |
| 064 | Admin UI | Technical enums не являются основным admin текстом | 02/D, 08/D | AdminConfigScreen, labels | B2, B6 | U6 360 | нет | PROVEN | — |

## E. Смена, люди, назначения и архив

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 065 | Фильтры людей | «Все / Свободные / В работе» корректно разделяют список | 03/A, 08/E | `ShiftPeopleScreen.tsx`, ShiftService | B3 | U3 360/390/430 | нет | PROVEN | — |
| 066 | Slot-first | Линия→деталь→позиция→человек использует canonical command | 03/A, 08/E | Shift/Assignment services | B3 concurrency | U3 | нет | PROVEN | — |
| 067 | Person-first | Человек→цель сохраняет selection при Back | 03/A, 08/E | `ShiftPeopleScreen.tsx`, mobile-back | B3 | U3 | да | PROVEN | Hardware Back — 172 |
| 068 | Skills | Recommendations и стаж/навык читаемы при выборе | 03/A, 08/E,N | people/skills UI | S stage25/26 | U3 | нет | PROVEN | — |
| 069 | Assignment | Уже назначенного можно canonical move/replace/unassign | 03/A, 08/E | Assignment service | B3 | U3 | нет | PROVEN | — |
| 070 | Search | No-show ищется server-side, без подделки attendance | 03/A, 08/E | PeopleSearchPanel/employee service | B3 | U3 | нет | PROVEN | — |
| 071 | Assignment | Один человек не имеет два current placements | 03/A, 08/E | Assignment service/locks | B3 concurrency | U3 | нет | PROVEN | — |
| 072 | Assignment | LINE/WASH/TIME/WORK_AREA используют один engine | 03/A,E, 08/E | Assignment/PlannedAssignment | B3 | U3 | нет | PROVEN | — |
| 073 | TIME | Free-text TIME route закрыт | 03/E, 08/E | assignment controller | B3, P adversarial | U3 | нет | PROVEN_AFTER_FIX | `409`, canonical positions only |
| 074 | TIME | «Повременщики» — постоянный блок canonical positions | 03/E, 08/E | WorkArea/Position, ShiftPeople | B3 | U3 | нет | PROVEN | — |
| 075 | Contractor | Master видит только фактически прибывшего наёмника с badge фирмы | 03/D, 08/E | submissions/Shift service | B3 | U3 | нет | PROVEN | — |
| 076 | Contractor | План и факт показываются раздельно | 03/D, 08/E | ShiftPeople/submissions | B3 | U3 | нет | PROVEN | — |
| 077 | Contractor | Не прибывшего нельзя назначить | 03/D, 08/E | AssignmentService guard | B3 | U3 | нет | PROVEN | — |
| 078 | Archive | Личный архив показывает только actual attendance, DAY/NIGHT/split | 03/G, 08/E | shift time/archive service | B3 | U3 | нет | PROVEN | — |
| 079 | Archive | Self declaration без attendance не создаёт ложную смену | 03/G, 08/E | attendance/archive service | B3 | U3 | нет | PROVEN | — |
| 080 | Archive | Shift archive сохраняет факт/фирмы/history snapshot | 03/H, 08/E | archive/ShiftService | B3 | U3 | нет | PROVEN | — |

## F. Линии и простой

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 081 | Линии | Общая карточка показывает «Людей: N», не список фамилий | 03/B, 08/F | `ShiftPeopleScreen.tsx` | B3 | U3 360 | нет | PROVEN | — |
| 082 | Линии | Production staffing отделён от task/service line | 03/B, 08/F | line dashboard/service | B3 | U3 | нет | PROVEN | — |
| 083 | Линии | Работа/пауза/простой имеют distinct readable states | 03/B, 08/F | line service, `styles.css` | B3, S line | U3 | нет | PROVEN | — |
| 084 | Линии | STOP/PAUSE повторяются идемпотентно | 03/B, 08/F | LineService | B3, S line | U3 | нет | PROVEN | — |
| 085 | Линии | Остановленная линия уходит в «Остановленные линии» | 03/B, 08/F | ShiftPeople/line service | S line | U3 360 | нет | PROVEN | — |
| 086 | Линии | «Простой» имеет причину/длительность/red state/return CTA | 03/B, 08/F | line dashboard | S line | U3 | нет | PROVEN | — |
| 087 | Линии | WORKER/TECH read-only, MASTER controls, STORE no workspace | 03/B,F, 08/F | permissions/line service | B2, B3 | U2/U3 | нет | PROVEN | — |
| 088 | Timeline | Timeline содержит only line/work/stop/task/move/wash/defrost | 03/H, 08/F | line timeline | S timeline | U3 | нет | PROVEN | — |
| 089 | Downtime task | Только lineStatusEventId связывает заявку с простоем | 03/H, 04/A, 08/F | Task/Line/Ops services | B6 | U3/U6 | нет | PROVEN | — |
| 090 | Defrost link | SHOCK_CHAMBER_BLOWN не становится обычной оттайкой | 04/E, 08/F | DefrostService | B4 | U4 | нет | PROVEN | — |

## G. Передача смены

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 091 | Handover | Window DAY 18-20 и NIGHT 06-08 проверяется сервером | 04/A, 08/G | shift-handover, ShiftLog service | S handover 56 | U4 | нет | PROVEN | — |
| 092 | Handover | До window UI скрыт и direct API denied | 04/A, 08/G | availability helper/service guard | S handover | U4 | нет | PROVEN | — |
| 093 | Handover | Primary содержит только работающие линии и план гофр | 04/A, 08/G | shift handover snapshot | S handover | U4 360 | нет | PROVEN | — |
| 094 | Handover | Только продолжающаяся мойка попадает в передачу | 04/A, 08/G | ShiftLog/Wash read model | S handover | U4 | нет | PROVEN | — |
| 095 | Handover | Только linked unresolved downtime task попадает в передачу | 04/A, 08/G | Task/ShiftLog read model | S handover | U4 | нет | PROVEN | — |
| 096 | Handover | Unlinked open tasks/checklists/people не попадают | 04/A, 05/F, 08/G,K | ShiftLog snapshot | S handover | U4 | нет | PROVEN | — |
| 097 | Handover | Snapshot immutable и operationId идемпотентен | 04/A, 08/G | ShiftLog service | S handover | U4 | нет | PROVEN | — |
| 098 | Handover | Ночная смена после полуночи сохраняет правильную shiftDate | shift clarification, 08/G | `shift-time.ts`, handover helper | B3, S handover | U4 | нет | PROVEN | — |

## H. Мойка и оттайка

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 099 | Мойка | Карточка компактна: объект/status/start/duration/counters | 04/B, 08/H | `WashScreen.tsx`, `styles.css` | B4 | U4 360/390/430 | нет | PROVEN | — |
| 100 | Мойка | CTA «Открыть мойку» и «К линиям» различаются | 04/B, 08/H | `WashScreen.tsx` | — | U4 | нет | PROVEN | — |
| 101 | Мойка | Create task не запускает active wash | 04/C, 08/H | WashService | B4 | U4 | нет | PROVEN | — |
| 102 | Мойка | Take task не запускает active wash | 04/C, 08/H | WashService | B4 | U4 | нет | PROVEN | — |
| 103 | Мойка | Separate start даёт одну active wash session | 04/C, 08/H | WashService/locks | B4 | U4 | нет | PROVEN | — |
| 104 | Мойка | Continuing wash показана в handover | 04/A,C, 08/H | Wash/ShiftLog read model | B4 | U4 | нет | PROVEN | — |
| 105 | Мойка | Fixture-only duplicate washes скрыты ordinary runtime | 08/H, post-route P2 | pilot visibility/WashService | P adversarial | U4 | нет | PROVEN | Физическая cleanup запрещена |
| 106 | Оттайка | Compact cards и KPI без giant/empty circles | 04/D,F, 08/I | `DefrostScreen.tsx`, `styles.css` | B4 | U4 | нет | PROVEN | — |
| 107 | Оттайка | KPI реально фильтруют/scroll, имеют active state | 04/D, 08/I | `DefrostScreen.tsx` | B4 | U4 | нет | PROVEN | — |
| 108 | Оттайка | Несколько defrost/blow в один день отображаются отдельно | 04/E, 08/I | DefrostService/calendar | B4 | U4 | нет | PROVEN | — |
| 109 | Оттайка | Blow distinct accent и count после последней defrost | 04/E, 08/I | DefrostService | B4 | U4 | нет | PROVEN | — |
| 110 | Оттайка | Prediction algorithm не заменён arbitrary threshold | 04/E, 08/I | DefrostService | B4 | U4 | нет | PROVEN | — |
| 111 | Оттайка | Calendar closes via common Back layer | 04/E, 08/I | `DefrostScreen.tsx`, mobile-back | B4 | U4 | да | PROVEN | Hardware Back — 172 |

## I. Отделовые процессы, заказы и возвраты

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 112 | Журнал | Journal create/read/filter только own department | 05/A, 08/J | ShiftLog service/screen | B5 | U5 | нет | PROVEN | — |
| 113 | Журнал | Department selector скрыт при одном department | 05/A, 08/J | `ShiftLogScreen.tsx` | B5 | U5 360 | нет | PROVEN | — |
| 114 | Журнал | Foreign departmentId spoof запрещён | 05/A, 08/J | ShiftLogService guard | B5 | U5 | нет | PROVEN | — |
| 115 | Заказы | Orders/stock own department; ADMIN only all-department | 05/B, 08/J | OrdersService/screen | B5 | U5 | нет | PROVEN | — |
| 116 | Заказы | MANAGEMENT не получает automatic cross-department scope | 05/B, 08/J | OrdersService guard | B5 | U5 | нет | PROVEN | — |
| 117 | Заказы | Explicit CTA «Создать заявку на заказ» | 05/C, 08/J | `OrdersStockScreen.tsx` | — | U5 | нет | PROVEN | — |
| 118 | Заказы | Request возможна без existing stock item | 05/C, 08/J | OrdersService | B5 | U5 | нет | PROVEN | — |
| 119 | Заказы | Name/description/quantity/unit/comment/attachments recorded | 05/C, 08/J | Orders DTO/service/UI | B5 | U5 | нет | PROVEN | — |
| 120 | Заказы | Approve/reject reason atomic, one decision winner | 05/C, 08/J | OrdersService/locks | B5 | U5 | нет | PROVEN | — |
| 121 | Возвраты | Canonical premium shell replaces legacy header/KPI | 05/D, 08/J | `ReturnsScreen.tsx`, `PremiumShell.tsx` | B5 | U5 | нет | PROVEN | — |
| 122 | Возвраты | Viewer roles и mutation roles не смешаны | 05/D, 08/J | ReturnsService guard | B5 | U5 | нет | PROVEN | — |
| 123 | Возвраты | WORKER/CONTRACTOR direct route/API denied | 05/D, 08/J | ReturnsService/navigation | B2, B5 | U5 | нет | PROVEN | — |

## J. Checklist runner

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 124 | Runner | Один focused item: title, N из M, progress и number nav | 05/E, 08/K | `ChecklistsScreen.tsx`, `styles.css` | B5 | U5 360/390/430 | нет | PROVEN | — |
| 125 | Runner | Number navigation сохраняет answer при back/forward | 05/E, 08/K | `ChecklistsScreen.tsx` | B5 | U5 | нет | PROVEN | — |
| 126 | Runner | One primary answer control; no technical chips/save item | 05/E, 08/K | `ChecklistsScreen.tsx` | B5 | U5 | нет | PROVEN | — |
| 127 | Runner | «Далее» autosaves; «Назад» не теряет answer | 05/E, 08/K | checklist service/screen | B5 | U5 | нет | PROVEN | — |
| 128 | Runner | Required empty local error blocks finish and returns to item | 05/E, 08/K | checklist validation | B5 | U5 | нет | PROVEN | — |
| 129 | Runner | Optional skip remains soft and finish allowed | 05/E, 08/K | checklist validation | B5 | U5 | нет | PROVEN | — |
| 130 | Runner | Comment optional unless explicit requiresComment | 05/E, 08/K | checklist model/service | B5 | U5 | нет | PROVEN | — |
| 131 | Runner | Out-of-range сохраняется как ISSUE, не требует comment сам по себе | 05/E, 08/K | ChecklistsService | B5, S stage44 | U5 | нет | PROVEN | — |
| 132 | Runner | Photo uses canonical attachment transport | 05/E, 08/K | ChecklistsScreen/attachments | B1, B5 | U5 | да | PROVEN | Camera physical — 173 |
| 133 | Runner | Pause/reopen/periodic reminders remain working | 05/F, 08/K | checklist lifecycle service | S stage13/65 | U5 | нет | PROVEN | — |
| 134 | Runner | DAY closes 21:00, NIGHT closes 09:00 | 05/F, 08/K | periodic lifecycle/time | S periodic | U5 | нет | PROVEN | — |
| 135 | Runner | Unfinished personal run not transferred/new handover | 05/F, 08/K | checklist/handover services | B5, S handover | U5 | нет | PROVEN | — |
| 136 | Runtime hygiene | Diagnostic checklist fixtures hidden ordinary runtime | 08/K | pilot visibility/checklists | P adversarial | U5 | нет | PROVEN_AFTER_FIX | Exact marker contract |
| 137 | Runner | Keyboard/sticky action and Android Back preserve draft | 05/E, 08/K | ChecklistsScreen/mobile-back | B5 | U5 | да | PROVEN | Hardware keyboard/back — 171/172 |

## K. Аналитика, архив и админка

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 138 | Analytics | STOP/PAUSE/WORK/LONG translated to Russian | 06/B, 08/L | `OpsAuditScreen.tsx`, labels | B6 | U6 360 | нет | PROVEN | — |
| 139 | Analytics | Mobile analytic grids are readable 1-2 columns | 06/B, 08/L | `OpsAuditScreen.tsx`, styles | B6 | U6 360/390/430 | нет | PROVEN | — |
| 140 | Analytics | KPI affords click only when it filters/drills down | 01/G, 06/B, 08/L | OpsAuditScreen/KPI strip | B6 | U6 | нет | PROVEN | — |
| 141 | Analytics | Open data marked preliminary and factory-period label clear | 06/A,B, 08/L | OpsService/OpsAuditScreen | B6 | U6 | нет | PROVEN | — |
| 142 | Analytics | Factory-local dates and archive dates do not shift timezone | 06/A, 08/L | factory time/ArchiveService | B6 | U6 | нет | PROVEN | — |
| 143 | Analytics | No overlap/future lost time; open interval capped at asOf | 06/A, 08/L | OpsService | B6 | U6 | нет | PROVEN | — |
| 144 | Analytics | Linked downtime task only by explicit event relation | 06/A, 08/L | OpsService/TaskService | B6 | U6 | нет | PROVEN | — |
| 145 | Analytics | Checklist counters and p50/p90 are reconciled/explained | 06/A, 08/L | OpsService | B6 | U6 | нет | PROVEN | — |
| 146 | Analytics | Management/Admin only; cross-factory denied | 06/A,E, 08/L | OpsService guards/navigation | B6 | U6 | нет | PROVEN | — |
| 147 | Admin | Separate Department/JobTitle/Role/Company/User sections | 06/D, 08/M | `AdminConfigScreen.tsx`, AdminService | B6 | U6 360/390/430 | нет | PROVEN | — |
| 148 | Admin | Create has duplicate warning and soft archive, no physical delete | 06/D, 08/M | AdminService/UI | B2, B6 | U6 | нет | PROVEN | — |
| 149 | Admin | Permission search/group/select visible/clear visible | 06/D, 08/M | AdminConfigScreen | B6 | U6 | нет | PROVEN | — |
| 150 | Admin | Preview final rights/menu matches canonical menu | 06/D, 08/M | permissions catalog/Admin UI | B6 | U6 | нет | PROVEN | — |
| 151 | Admin | Mobile forms/long permissions fit above nav/keyboard | 06/D, 08/M | AdminConfigScreen/styles | B6 | U6 360/390/430 | да | PROVEN | Hardware keyboard — 171 |
| 152 | Admin | Last-admin and blocked/deactivated guards remain enforced | 06/D, 08/M | AdminService/guards | P lifecycle, S stage60 | U6 | нет | PROVEN | — |
| 153 | Admin | Delegation is subset with final rights preview | 06/D, 08/M | AdminService/delegation UI | P delegation | U6 | нет | PROVEN | — |
| 154 | Admin | Contractor role requires company; company never substitutes department | 06/D, 08/M | AdminService/schema | B2, B6 | U6 | нет | PROVEN | — |

## L. Ранние пользовательские fixes, сохранённые финальными контрактами

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 155 | ОКК | Defect form uses Day/Night select and safe master selection | Stage16, 08/N | `OkkScreen.tsx`, OkkService | S stage16 | U5 | нет | PROVEN | — |
| 156 | Некондиция | Optional name and units «штуки/гофры» display safely | Stage16, 08/N | Stock/Okk UI/services | S stage16 | U5 | нет | PROVEN | — |
| 157 | Объявления | Recipient can acknowledge; outsider is denied | Stage24/52, 08/N | announcement service/screen | S stage24 | U5 | нет | PROVEN | — |
| 158 | Пересменка | Important entry is visibly distinct; author server-fixed | Stage14, 08/N | ShiftLog screen/service | B5 | U5 | нет | PROVEN | — |
| 159 | Чек-листы | «Взять в работу» / «Начать новый» and active/available split | Stage50/65, 08/N | ChecklistsScreen | S stage50/65 | U5 | нет | PROVEN | — |
| 160 | Чек-листы | Interval builder uses minutes/hours plus number | Stage50/65, 08/N | ChecklistsScreen/service | S stage50/65 | U5 | нет | PROVEN | — |
| 161 | Оттайка | «Поставить на оттайку» / «Запустить в работу» are distinct actions | Stage15/37, 08/N | DefrostScreen/service | B4 | U4 | нет | PROVEN | — |
| 162 | Линии | Skills visual emphasis and staff filters remain usable | Stage25/26, 08/N | ShiftPeople/people UI | S stage25/26 | U3 | нет | PROVEN | — |
| 163 | UI | No raw id/camelCase/English placeholder as primary user text | v1 goal, 08/N | labels/screens/serializers | P privacy/localization | U1-U6 | нет | PROVEN | — |
| 164 | UI | No public secrets/passwordHash/tokens/storagePath | v1 goal, 08/N | serializers/guards | P privacy | U1-U6 | нет | PROVEN | — |
| 165 | Runtime | Stage/test/demo markers do not pollute ordinary runtime | v1 goal, 08/N | pilot visibility helpers | P adversarial | U1-U6 | нет | PROVEN | — |
| 166 | Design | One canonical Industrial Premium system, no parallel theme | user design requirement, 08 | `styles.css`, `PremiumShell.tsx` | P adversarial | U1-U6 | нет | PROVEN | Historic literals remain P2 |

## M. Физически проверяемые пункты

| № | Модуль | Исходный фикс | Источник | Canonical product files | Backend evidence | Browser / viewport | Physical | Статус | Остаток |
|---|---|---|---|---|---|---|---|---|---|
| 167 | Installed PWA | PWA opens from home screen and preserves standalone lifecycle | 01/A,B,C, physical gate | manifest/SW/main | readiness regressions | emulated only | да | PHYSICAL_ONLY | Проверить установленную PWA |
| 168 | Camera/gallery | Real Android permission prompt and media capture work | 01/A, 08/B | AttachmentPicker/media helpers | source/browser readiness | emulated only | да | PHYSICAL_ONLY | Проверить on-device |
| 169 | Microphone | Real deny→allow→retry and voice playback works | 01/B, 08/B | ChatsScreen/media helper | source/browser readiness | emulated only | да | PHYSICAL_ONLY | Проверить on-device |
| 170 | Push/vibration | OS/browser permission, push and vibration work | physical gate | notifications/push | automated readiness | emulated only | да | PHYSICAL_ONLY | Проверить on-device |
| 171 | Keyboard | Real Android keyboard preserves sticky action/input | 01/G, 05/E, physical gate | styles/mobile layout | browser geometry | emulated only | да | PHYSICAL_ONLY | Проверить on-device |
| 172 | Gesture Back | Hardware/gesture Back matches layer stack and root dialog | 01/C, physical gate | mobile-back | emulated Back | emulated only | да | PHYSICAL_ONLY | Проверить on-device |
| 173 | Master route | Live master route on a real shift is practical | physical gate | existing linked modules | automated route packs | desktop/emulated mobile | да | PHYSICAL_ONLY | Проверить on-device |

## Final conclusion

Пласт 8 повторно подтвердил 173 отдельных пользовательских контракта кодом, targeted regressions и browser E2E. Итог: `PROVEN = 162`, `PROVEN_AFTER_FIX = 3`, `SUPERSEDED = 1`, `PHYSICAL_ONLY = 7`, `PARTIAL = 0`, `MISSING = 0`.

Единственный доказанный автоматизируемый разрыв этого пласта был в строке 029: вложения задания, созданного из экрана людей смены, уходили локальным `FormData`-циклом. Экран переведён на canonical `uploadAttachments`; данных, API-контракта и RBAC это не изменило. Повторный `pilot-fix:plast1-regression` подтвердил новый путь.

Физические пункты 167--173 намеренно остаются `PHYSICAL_ONLY`: эмуляция браузера не может честно доказать установленную PWA, системные Android-permissions, камеру, микрофон, push/vibration, hardware Back и живую смену. Они не отмечены как PASS.
