# Stage 27 — Склад: Возвраты на производство + Повременщики

## Discovery

Складской контур уже имел `ReturnRecord`, `ReturnsService`, `ReturnsController`, экран возвратов, permissions `returns.read` / `returns.manage`, attachment entity `RETURN_RECORD` и audit family `RETURN_RECORD_*`. Поэтому таблица “Возвраты на производство” расширяет существующий `ReturnRecord`, а не создаёт второй складской или ОКК-модуль.

Повременщики уже частично существовали как свободная повременная роль через `AssignmentKind.TIME` и `EmployeeState.TIME_ROLE`. Для Stage 27 добавлен отдельный контур рабочих зон: это не производственная линия, не line dashboard и не мойка.

## Возвраты На Производство

Запись хранит поля Excel-таблицы кладовщиков:

- дата поступления;
- дата изготовления;
- артикул;
- наименование продукции;
- причина несоответствия;
- количество;
- принятое решение;
- отметка о выполнении;
- кто выполнил;
- корректирующие действия и комментарии.

Поля 1–7 обязательны при создании. Поля 8–10 обязательны перед полным завершением. “Полностью завершён” переводит запись в архив через soft archive (`archivedAt`, `archivedById`, `deletedAt`) без физического удаления.

Вложения используют существующий `RETURN_RECORD`; metadata не содержит `storagePath`, download остаётся под общим guarded attachment foundation.

## RBAC

Чтение идёт через `returns.read`. Управление идёт через `returns.manage`; STORE получает это право в seed. WORKER/CONTRACTOR сохраняют текущую read-политику старого модуля возвратов, но не могут создавать и редактировать записи без `returns.manage`.

Все операции factory-scoped. Cross-factory запись не открывается в выбранном заводе.

## Повременщики / Work Areas

Добавлены `WorkArea`, `WorkAreaPosition`, `WorkAreaShiftState` и `AssignmentKind.WORK_AREA`.

Seed создаёт рабочую зону “Повременщики” для `factory-4`:

- Оператор-наладчик: 1–2;
- Грузчик склада: 1–2;
- Грузчик: 1–5;
- Водитель погрузчика: 1;
- Уборщицы: 2–4;
- Мойка тары: 1;
- Запасной сотрудник: 0–1;
- Жарщики: 2;
- Дополнительно.

`Дополнительно` является optional extra slot: min=0, не влияет на shortage.

Рабочая зона не попадает в список производственных линий и не меняет статус линии. Назначенный в рабочую зону сотрудник занят и не может одновременно быть назначен на линию, мойку или другую рабочую зону.

Кандидаты ограничены WORKER/CONTRACTOR, как и для line assignment safety. MASTER/OKK/STORE/ADMIN не являются кандидатами.

## UI

Экран “Возвраты” стал таблицей/карточками “Возвраты на производство” с активным списком и архивом. STORE видит действия создания, отметки выполнения, полного завершения и вложений.

Экран “Смена” получил секцию “Повременщики”. Мастер видит план “X из Y”, shortage, кандидатов и может назначать/освобождать людей.

## Audit

Подтверждены/добавлены:

- `RETURN_RECORD_CREATED`;
- `RETURN_RECORD_UPDATED`;
- `RETURN_RECORD_COMPLETION_MARKED`;
- `RETURN_RECORD_FULLY_COMPLETED`;
- `RETURN_RECORD_ARCHIVED`;
- `WORK_AREA_PLANNED_COUNT_UPDATED`;
- `ASSIGNMENT_WORK_AREA_CREATED`;
- `ACCESS_DENIED` через общий guard.

Audit details не содержат storage paths, secrets или auth-токены.

## Regression

Regression `stage27:store-returns-work-areas-regression` проверяет:

- обязательность полей 1–7 и 8–10;
- soft archive без physical delete;
- STORE create/update/mark/complete;
- WORKER edit forbidden;
- attachment metadata без `storagePath`;
- cross-factory и blocked user guards;
- seed рабочей зоны “Повременщики”;
- min/max/default parsing;
- plannedCount внутри диапазона и reject вне диапазона;
- extra slot не влияет на shortage;
- кандидаты только WORKER/CONTRACTOR;
- non-worker direct assignment rejected;
- занятый в work area worker не может быть назначен на line;
- release ставит `endedAt`;
- work area не появляется как production line;
- line status не меняется.

## Temporary Decisions

`AssignmentKind.TIME` оставлен для старых свободных повременных ролей. Новый structured поток использует `WORK_AREA`.

Полного складского учёта, партий, цен, себестоимости и интеграций с 1С нет.
