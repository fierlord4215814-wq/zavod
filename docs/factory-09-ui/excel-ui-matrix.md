# FACTORY-09-UI-01 — Excel → объект админки → сохранение

Источник: вложенный `shtat_linii_i_personal.xlsx`, лист «Штат» A1:I25, SHA-256 `92f7fafc074f58b048f864350fea3ab7e5de5b6a9e890fb4e5cb3477cebf33a8`. Номер №9 задан отдельной прямой поправкой пользователя, в книге номера нет. Значения мест не являются списком людей или явкой. Статусы ниже отражают фактический UI readback, а не намерение.

| Excel | Исходный состав: загрузчик/фасовщик/грузчик | Предусмотренный объект UI завода №9 | Создание UI | Reopen/второй вход | SQL read-only |
|---|---:|---|---|---|---|
| Строка 5, Фасовка А | 3/2/1 = 6 | Line + позиции + staffing template | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Строка 6, Фасовка Б | 5/2/1 = 8 | Line + позиции + staffing template | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Строка 7, Фасовка В | 4/0/0 = 4 | Line + только применимая позиция/нулевые слоты | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Строка 8, Фасовка Г | 1/2/1 = 4 | Line + позиции + staffing template | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Строка 9, Фасовка Д | 1/2/1 = 4 | Line + позиции + staffing template | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Строка 10, Фасовка Е | 1/2/1 = 4 | Line + позиции + staffing template | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Строка 11, Фасовка Ж | 1/2/1 = 4 | Line + позиции + staffing template | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Строка 12, Фасовка И | 1/1/1 = 3 | Line + позиции + staffing template | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Строка 13, Фасовка К | 5/5/1 = 11 | Line + позиции + staffing template | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN | NOT_RUN |
| Итого | 22/18/8 = 48 **мест** | 9 линий, не 48 User | NOT_RUN | NOT_RUN | NOT_RUN |

| Excel | Значение | Предусмотренный объект UI завода №9 | Создание UI | Reopen/второй вход |
|---|---|---|---|---|
| Строка 16 | Водитель погрузчика, 1–2, 12 ч | JobTitle + work area/диапазон, не фиксированные два человека | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN |
| Строка 17 | Уборщица производства, 1–2, 12 ч | JobTitle + work area/диапазон | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN |
| Строка 18 | Оператор-наладчик, 1–2, 12 ч | JobTitle + work area; не TECH_MECHANIC по одному названию | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN |
| Строка 21 | Мастер цеха, 1, 24 ч | JobTitle.shiftDurationHours=24 | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN |
| Строка 22 | Сырьевой мастер, 1, 12 ч | JobTitle.shiftDurationHours=12 | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN |
| Строка 23 | Старший мастер, 1, H23=12 ч, I23 график не уточнялся | JobTitle.shiftDurationHours=12 с явной оговоркой о неподтверждённом реальном графике | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN |
| Строка 24 | Сменный технолог, 1, 24 ч | JobTitle.shiftDurationHours=24; функции ОКК только одному учебному профилю №9 | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN |
| Строка 25 | Механик, 1, 24 ч | Отдельный JobTitle/TECH_MECHANIC, не КИПиА/электрик/холод | NOT_RUN_FIRST_ADMIN_HANDOFF | NOT_RUN |

ФИО, телефонов, списка фирм и бригад в Excel нет. Минимальные учебные профили/фирмы создаются только через UI после личного входа первого ADMIN; они не подменяют реальный roster.
