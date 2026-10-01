# Physical Field Fixes V2 - Stage 02

## Итог

- `STAGE02`: **PASS_WITH_P2**.
- `REQUIREMENTS`: `E01-E16`, `F01-F27`, `G01-G29`, `H01-H10`, `I01-I15`.
- `P0`: 0.
- `P1`: 0.
- `P2`: необязательный отдельный комментарий к строкам плана линии отсутствует в текущей canonical модели `LineShiftWorkPlan`; артикул, наименование, гофры и комментарий к итогу смены работают. Additive migration ради необязательного поля на этом этапе не выполнялась.
- `P2`: жесты Android Back/swipe и поведение установленной PWA требуют проверки на физическом телефоне; browser-контракт, 360/390/430 и Back layers проверены.

## Реализовано

### Командный центр текущей смены

- Текущая смена показана компактной строкой с действием «Выбрать смену» и bottom sheet текущей, следующей, прошлой и двух будущих смен.
- Четыре квадрата «Линии», «Люди», «Простой», «Заявки» переключают рабочее содержимое, а не являются декоративными KPI.
- Основной порядок: активный простой, работающие линии, повременщики/рабочие зоны, компактный список людей на смене.
- Остановленные линии исключены из оперативной картины и доступны через осознанное действие «Запустить линию».

### Линии и назначения

- Компактная карточка линии показывает статус, `Люди N/M`, состав, активную связанную заявку и действия «Простой», «Остановить», «Подробнее», «План».
- На 360 px действия используют устойчивую сетку 2x2; horizontal overflow и разлом текста отсутствуют.
- Карточка простоя показывает причину, длительность и заявку только при явной связи `lineStatusEventId`/`sourceKind=DOWNTIME`.
- «Люди» открывает assignment sheet со свободными и назначенными сотрудниками, server-side поиском неотмеченных и canonical skill recommendation.
- LINE/WASH/TIME/WORK_AREA используют существующие `Assignment`, `WorkArea`, `WorkAreaPosition`, `operationId`, locking и idempotency. Второй assignment engine не создан.
- Занятый слот имеет одно действие с sheet: профиль, заменить, переназначить, освободить, отправить домой. Пустой слот показывает «Свободно» и «Назначить».
- «Отправить домой» использует существующую серверную команду, закрывает назначение и сохраняет историю/audit.

### Read-only роли

- Добавлен scoped endpoint `GET /lines/:id/current-shift-detail` для ролей с `shift.current.read`/`shift.self.read` без `lines.read`.
- Endpoint возвращает только линию, позиции, безопасные имена назначенных, шаблон/нехватку и активную оттайку.
- Заявки, мойка, недавние события и детали простоя вне разрешений роли не возвращаются.
- Assignment board остаётся запрещён прямым API для WORKER.
- Factory scope и существующие guards сохранены.

## Canonical invariants

- Текущий факт хранится в существующих `ShiftSession`/`Assignment`; будущий план не смешан с текущим фактом.
- Состояние линии меняется только через существующий `LineService`.
- Повременщики и рабочие зоны используют один справочник `WorkArea`/`WorkAreaPosition`.
- Связь простой -> заявка учитывается только при явной связи, без эвристики по тексту или времени.
- Industrial Premium 10F остаётся единственным визуальным контуром: Stage02 расширяет `frontend/src/styles.css` существующими tokens, отдельной темы и локальной палитры нет.
- Модель данных и Prisma schema в Stage02 не менялись.

## Изменённые файлы

- `backend/src/modules/line/line.controller.ts`
- `backend/src/modules/line/line.service.ts`
- `backend/scripts/physical-field-fixes-v2-stage02-regression.js`
- `backend/package.json`
- `frontend/src/screens/ShiftPeopleScreen.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v2-stage02.spec.ts`
- `frontend/package.json`
- `docs/physical-field-fixes-v2-stage02.md`
- `codex_zavod_physical_field_fixes_v2/progress.md`

## Backend changes

- Добавлен только безопасный read-model текущей смены для line detail; mutation paths и permission model не расширялись.
- Audit storage, Assignment, line status history, tasks и factory access не менялись.
- БД и runtime-данные продукта не редактировались вручную; targeted regressions использовали штатные диагностические сценарии.

## Migrations

- Новых migration нет.
- `prisma validate`: PASS.
- `prisma migrate status`: 45 migrations, database schema up to date.

## Targeted tests

- Backend build: PASS.
- Frontend build: PASS; только известное предупреждение Vite о размере chunk.
- `physical-field-fixes:v2-stage02-regression`: PASS, 26/26.
- `physical-field-fixes:v2-stage02-e2e`: PASS, 4/4 desktop/mobile.
- `pilot-fix:plast3-regression`: PASS, 125/125.
- `stage41:line-shift-assignment-regression`: PASS, 25/25.
- `line:effective-time-regression`: PASS, 11/11.
- `pilot:lines-wash-defrost-regression`: PASS, 21/21.
- `stage40b:downtime-task-analytics-regression`: PASS, 23/23.
- Browser `prompt/alert/confirm`: не найден.
- Mojibake в изменённом продуктовом коде: не найден.
- Secret/storage scan: совпадение только в защитном assertion regression; значения секретов и `storagePath` в payload не обнаружены.

## Screenshots

- `docs/physical-field-fixes-v2-screenshots/stage02/master-current-shift-desktop.png`
- `docs/physical-field-fixes-v2-screenshots/stage02/master-current-shift-360.png`
- `docs/physical-field-fixes-v2-screenshots/stage02/master-current-shift-390.png`
- `docs/physical-field-fixes-v2-screenshots/stage02/master-current-shift-430.png`

360/390/430: PASS, horizontal overflow отсутствует. Физический телефон: `PENDING`.

## Runtime

- Backend: `http://127.0.0.1:3000/health`, PID `11516`, status `ok`.
- Frontend: `http://127.0.0.1:5173`, preview PID `18848`, HTTP 200.
- Оба процесса оставлены запущенными для следующего этапа маршрута.

`CURRENT_ASSIGNMENT_INVARIANTS`: **PASS**.

`NEXT_SAFE_STAGE`: **03**.
