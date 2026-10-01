# Пласт 7 - статус требований

## Линии

- `LINE_START_RETURN_LABEL_GATE: PASS`
- `LINE_EVENT_HUMAN_TEXT_GATE: PASS`
- `STOPPED_LINE_DETAIL_COMPACT_GATE: PASS`

Глобальное действие называется «Запустить новую линию», конкретная остановленная линия - «Вернуть в работу», активная мойка - «Открыть мойку». Последнее событие показывает человекочитаемый тип, локальные дату/время и автора при его наличии; raw enum, event id и operationId в рабочую карточку не попадают.

## Пласт 4

- `P4_ACTION_VISUAL_GATE: PASS`
- `P4_REQUEST_FILTER_GATE: PASS`
- `P4_PEOPLE_PROFILE_GATE: PASS`
- `P4_PROFILE_SCROLL_GATE: PASS`
- `P4_LINE_HISTORY_GATE: PASS`
- `P4_LINE_STATS_GATE: PASS`
- `P4_STOCK_FILTER_GATE: PASS`
- `P4_HANDOVER_GATE: PASS`
- `P4_NOTIFICATION_HUMAN_GATE: PASS`
- `P4_SETTINGS_GATE: PASS`
- `P4_DELEGATION_GATE: PASS`
- `P4_ERROR_REPORT_GATE: PASS`
- `P4_WORKAREA_GATE: PASS`

Проверено в реальном browser runtime на 390 px. Длинный профиль прокручен до последнего действия: `scrollTop=703`, `scrollHeight=1545`, `clientHeight=842`; footer не перекрывает содержимое. WorkArea использует только «Нужно / Назначено / Не хватает».

## Пласт 5

- `P5_ANNOUNCEMENT_VIEWER_GATE: PASS`
- `P5_ANNOUNCEMENT_SWIPE_GATE: PASS`
- `P5_ANNOUNCEMENT_TEXT_SCROLL_GATE: PASS`
- `P5_ANNOUNCEMENT_FIXED_ACK_GATE: PASS`
- `P5_ANNOUNCEMENT_FULLSCREEN_GATE: PASS`
- `P5_RECURRENCE_CREATION_UI_GATE: PASS`
- `P5_CHAT_1_2_3_4_5PLUS_GATE: PASS`
- `P5_CHAT_FULLSCREEN_GATE: PASS`
- `P5_CHAT_CONTEXT_RETURN_GATE: PASS`
- `P5_CHAT_PARTICIPANT_ACCENT_GATE: PASS`
- `P5_CHAT_GROUPING_GATE: PASS`

Форма объявления показывает ровно четыре варианта повторения: не повторять, раз в неделю, раз в 2 недели, раз в месяц. Browser E2E на desktop и mobile прошёл `2/2`. Исправлено пересечение zoom-кнопок с навигацией fullscreen; возврат сохраняет актуальную позицию списка.

## Пласт 6

- `P6_OKK_PARTIAL_MOBILE_GATE: PASS`
- `P6_RETURN_PARTIAL_MOBILE_GATE: PASS`
- `P6_PARTIAL_SHEET_GATE: PASS`
- `P6_ARCHIVE_MOBILE_GATE: PASS`
- `P6_PARENT_HISTORY_GATE: PASS`

На 390 px проверены `52 -> 30 -> 22`, полная выдача остатка возврата, архив родительской записи и immutable history. Android Back следует общему контракту: первое нажатие закрывает клавиатуру, второе - sheet.

## Общие mobile/browser gates

- `PWA_ONE_FINGER_SCROLL_FINAL_GATE: PASS`
- `MODAL_STACK_FINAL_GATE: PASS`
- `SAFE_AREA_FINAL_GATE: PASS`
- `MOBILE_360_GATE: PASS`
- `MOBILE_390_GATE: PASS`
- `MOBILE_430_GATE: PASS`
- `DESKTOP_SMOKE_GATE: PASS`
- `NO_HORIZONTAL_OVERFLOW_GATE: PASS`
- `CLEANUP_GATE: PASS`

Полные действия выполнялись один раз на 390 px; 360 и 430 px использованы для layout smoke. Desktop проверен отдельным smoke. Активных marker-сущностей после штатного archive/deactivate: `0`; существующие сущности физически не удалялись.

## Итог

- `P0: 0`
- `P1: 0`
- `P2: 0`
- `PHYSICAL_PHONE_GATE: PENDING`

