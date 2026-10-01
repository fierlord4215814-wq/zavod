# Line Assignment Board Regression

Цель проверки: подтвердить, что доска назначений линии работает от БД, соблюдает роли, factory scope и не превращает общий список людей в меню кандидатов.

## Backend candidates

- WORKER виден в `candidates`.
- CONTRACTOR виден в `candidates`.
- MASTER не виден в `candidates`.
- MANAGEMENT не виден в `candidates`.
- TECHNOLOG не виден в `candidates`.
- OKK не виден в `candidates`.
- STORE не виден в `candidates`.
- TECH_KIPIA не виден в `candidates`.
- TECH_HOLOD не виден в `candidates`.
- TECH_ELECTRIC не виден в `candidates`.
- TECH_MECHANIC не виден в `candidates`.
- TECH_SANTECHNIK не виден в `candidates`.
- CONTRACTOR_LEAD не виден в `candidates`.
- ADMIN не виден в `candidates`.
- OTHER не виден в `candidates`, пока он не выделен в отдельную рабочую роль.

## Direct API checks

- `POST /assignments/line` для WORKER проходит при валидной линии, позиции и шаблоне.
- `POST /assignments/line` для CONTRACTOR проходит при валидной линии, позиции и шаблоне.
- `POST /assignments/line` для MASTER возвращает ошибку.
- `POST /assignments/line` для OKK возвращает ошибку.
- `POST /assignments/line` для STORE возвращает ошибку.
- `POST /assignments/line` для TECH-роли возвращает ошибку.
- `POST /assignments/line` для CONTRACTOR_LEAD возвращает ошибку.
- `POST /assignments/line` для ADMIN возвращает ошибку.
- Повторное назначение без release возвращает conflict.
- Назначение на чужой factory возвращает ошибку.
- Назначение на position другой line возвращает ошибку.
- Назначение на position, которого нет в выбранном template, возвращает ошибку.
- Назначение blocked/deleted user возвращает ошибку.

## UI checks

- Общий раздел "Люди" показывает все роли по отделам/категориям.
- В меню назначения на линию нет MASTER, MANAGEMENT, OKK, STORE, TECHNOLOG, TECH-ролей, CONTRACTOR_LEAD, ADMIN и OTHER.
- Доска линии показывает слоты по активному шаблону.
- Пустой слот можно заполнить выбором кандидата.
- Drag/drop работает как дополнительный UX, но не является единственным способом назначения.
- Ошибка backend показывается в UI честно, без demo fallback.
- Нет `window.prompt`, `window.alert`, `window.confirm`.

## Audit

- Успешное назначение пишет `ASSIGNMENT_LINE_CREATED`.
- Отказ из-за роли пишет `ASSIGNMENT_REJECTED_FOR_ROLE`.
- Отказ из-за active assignment пишет `ASSIGNMENT_REJECTED_FOR_CONFLICT`.
- Forbidden попытки пишут `ACCESS_DENIED`.
