# Пласт 13: requirement status

## R1_ONE_FINGER_SCROLL

STATUS: PASS

BEFORE: На standalone-root с реальным вертикальным overflow один CDP touch drag не менял `scrollY` (`0 -> 0`).

ROOT_CAUSE: Общий `body.pwa-standalone` запрещал стандартное vertical overscroll behavior.

FIX: Canonical root-rule в `frontend/src/styles.css` изменён на `overscroll-behavior-y:auto`; локальные screen-workaround не добавлялись.

AFTER: Один touch pointer меняет offset на Shift при 360/390/430, на длинных Checklists, Ops/Admin и внутри `PremiumSheet`. Горизонтального overflow нет.

REGRESSION: `ONE_FINGER_SCROLL_GATE: PASS`; `TWO_FINGER_NOT_REQUIRED_GATE: PASS`; `R1_PREMIUM_SHEET: PASS`.

## R2_FACTORY_PICKER_MODAL

STATUS: PASS

BEFORE: Список заводов находился внизу normal auth-page и не воспринимался обязательным следующим шагом.

ROOT_CAUSE: Existing factory list не использовал canonical top-layer/modal lifecycle.

FIX: Список перенесён в существующий `PremiumSheet` с backdrop, крупными rows, safe-area, внутренним scroll и Android Back.

AFTER: Показаны ровно 11 разрешённых fixture factories; длинное название переносится; клавиатура убрана до открытия; unauthorized factory скрыт, guest downgrade не даёт permissions, прямой `/lines` получает 403.

REGRESSION: `R2_CANONICAL_FACTORY_SOURCE: PASS`; `R2_FACTORY_ACCESS_SCOPE: PASS`; `R2_ANDROID_BACK: PASS`; `R2_KEYBOARD_SAFE: PASS`; `R2_360_390_430: PASS`.

## R3_SHIFT_BOUNDARY_ASSIGNMENT

STATUS: PASS

BEFORE: Пустой NIGHT plan имел 0 planned people, но старый actual LINE assignment с `endedAt=null` мог продолжать учитываться после boundary.

ROOT_CAUSE: Assignment не был привязан отдельным schema-field к смене; current read-model не ограничивал его canonical shift window, а существующий maintenance не закрывал старый actual LINE contour и не активировал новый plan. Дополнительно старый due session мог закрыть назначение, начатое позже конца этой сессии.

FIX: Existing maintenance закрывает только LINE assignments до `window.from`, активирует ровно current `PlannedLineAssignment` через existing command, использует advisory locks/processed operations и не меняет line status. Session-close ограничен `startedAt < endedAt` закрываемой сессии.

AFTER: Empty plan даёт `0/2`; populated plan даёт ровно `B+C`, слоты `1+2`, start ровно 20:00; старый `A` отсутствует. Shift, line detail, person-first и slot-first совпадают. Повторный transition ничего не дублирует. MASTER/MANAGEMENT получают existing realtime invalidation; cross-factory denied.

REGRESSION: P13 backend `36 passed, 0 failed`; browser E2E `1 passed`; семь server-time boundary cases, timezone independence, due-session/new-assignment invariant, Stage41/Stage48/auth/realtime affected gates зелёные.

## R3A_CONTINUATION_INDICATOR

STATUS: PASS

BEFORE: Непрерывно RUNNING-линия визуально не отличалась от новой линии сразу после перехода смены.

ROOT_CAUSE: Read-model не вычислял краткий informational context относительно canonical boundary и последнего WORK event.

FIX: Добавлено derived boolean/label без DB mutation и без нового line status.

AFTER: На Shift line card видна плашка «Работает с прошлой смены» в 20:01; после 30 минут и после STOP -> WORK её нет.

REGRESSION: `R3A_CONTINUATION_INDICATOR: PASS`; `R3A_DISAPPEARS_AFTER_30_MIN: PASS`; `R3A_STOP_RESTART_REMOVES_CONTINUATION: PASS`.

