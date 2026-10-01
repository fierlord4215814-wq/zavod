# PHYSICAL FIELD FIXES V5 — Пласт 3: discovery

Дата проверки: 08.08.2026.

## Существующий canonical-контур

- Состояние линии вычисляется существующим `LineService`: `RUNNING`, `DOWNTIME`, `STOPPED`, `WASH`.
- Мойка хранится в `WashSession`; участники мойки — в общем `Assignment` с `kind=WASH` и `washSessionId`.
- История мойки уже представлена `WashEvent`, `WashMessage`, `WashIssue`, `WashControlItem`, `WashOkkReview` и общими `Attachment`.
- Оттайка хранится в `DefrostEvent`, а время текущего рабочего запуска линии берётся из общего line-state/read-model.
- Пользовательские экраны уже существуют в `WashScreen`, `SituationScreen`, `ShiftPeopleScreen` и `DefrostScreen`.
- Canonical дизайн-система остаётся в `frontend/src/styles.css`; второй theme/style-контур не создавался.

## Подтверждённые разрывы

1. UI мойки повторял состояние и время, а список людей требовал лишних переходов.
2. Возврат из общего назначения людей не сохранял контекст конкретной мойки.
3. Завершение мойки требовало сериализованного lock/recheck состава участников.
4. Оттайка могла показывать старое рабочее время вместо текущего запуска линии.
5. В Заводе 4 оставались активные legacy-мойки, созданные диагностическими и документированными pilot-аккаунтами.
6. Карточка линии на мойке не давала открыть детали линии и не показывала отдельную подпись «На мойке» при наличии проблемы.
7. В мобильной сводке оттайки длинное пустое значение разбивалось почти по буквам.

## Baseline и схема

- Backend build: PASS.
- Frontend build: PASS.
- Prisma validate: PASS.
- Prisma migrate status: 50 migrations, schema up to date.
- Новые поля и новая таблица не требуются.
- Migration: не нужна и не создавалась.

## Read-only inventory до reconciliation

- Активных legacy `WashSession`: 16.
- `PROVEN_TEST`: 13.
- `PROVEN_PILOT_TEST`: 3.
- `POSSIBLE_REAL_USER_DATA`: 0.
- `VALID_CURRENT_SESSION`: 0.
- Конфликтных сессий: 6 в 3 группах.
- Активных участников: 0.
- Физическое удаление не требовалось.

Вывод: существующей схемы и сервисов достаточно. Нужны минимальные исправления общего read-model/UI, сериализация операций и одноразовая безопасная reconciliation только доказанных test/pilot записей.
