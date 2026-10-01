# Stage 47 — Pilot Testability + Small Correctness Fixes

## Discovery result

Stage 47 переиспользует существующие контуры: `UserFactoryAccess`, `ShiftSession`, `ShiftWillBe`, `UserSkill`, ОКК/возвраты, пересменку, заказы/остатки, мойку и Stage43 attachment preview. Новая схема БД не потребовалась: для пилотных людей достаточно idempotent script и существующих runtime display helpers.

Текущими seed-данными было неудобно проверять pilot flow: в интерфейсе встречались технические `worker-1`/Stage-пользователи, не было понятного набора людей на текущую и будущую смену, а часть справочников возвращала raw id вместо человекочитаемых имён.

## Pilot scenario

Скрипт:

```bash
npm.cmd run stage47:pilot-scenario --workspace backend
```

Он idempotent: повторный запуск обновляет записи и не плодит дубли.

Создаются/обновляются пользователи Завода 4:

- Тестовый работник 1, 2, 3;
- Тестовый наёмный 1, 2;
- Тестовый мастер 1;
- Тестовый ОКК 1;
- Тестовый кладовщик 1;
- Тестовый КИПиА 1;
- Тестовый холодильщик 1;
- Тестовый технолог 1.

Текущая смена получает active shift sessions для части работников/наёмных и мастера. Ближайшая будущая смена получает отметки “Я буду” для `Тестовый работник 3` и `Тестовый наёмный 2`; эти отметки не делают людей занятыми в текущей смене.

## Correctness fixes

- ОКК и Возвраты используют date input без обязательного ручного выбора времени.
- Пересменка показывает `departmentName`, например `Отдел: Технологи`, а не UUID.
- Заказы / Остатки используют select единиц измерения: `шт`, `кг`, `г`, `м`, `см`, `л`, `мл`, `упак.`, `короб`, `рулон`, `пара`.
- Для `шт`, `короб`, `пара`, `упак.`, `рулон` количество должно быть целым.
- Для `кг`, `г`, `м`, `см`, `л`, `мл` дробные значения разрешены.
- Оценка ОКК мойки стала контролом 1–10 с подписью “Оценка качества мойки”.
- Backend проверяет рейтинг мойки: только 1–10.
- Directory/task/wash payloads используют человекочитаемые pilot display names и скрывают Stage fixture users.

## Attachments / wash preview

Stage47 не меняет storage architecture и не добавляет новый файловый модуль. Существующий `AttachmentPreviewList` остаётся общим viewer: thumbnails для фото, карточки файлов, guarded download endpoint, без `storagePath` в API payload.

## RBAC / scope

Backend guards не расширялись. Pilot users получают обычные роли и доступ к Заводу 4 через `UserFactoryAccess`. Blocked/cross-factory checks остаются в regression. Архив и вложения не получают дополнительных прав.

## Not included

- ERP/1С/партии/цены/себестоимость;
- custom roles/job titles architecture;
- DB reset или physical delete;
- offline binary sync;
- агрессивное скрытие production-like данных.

## Regression checklist

```bash
npm.cmd run stage47:pilot-testability-correctness-regression --workspace backend
npm.cmd run stage47:browser-e2e
```

Дополнительно при финальном gate:

- Stage46.1B / Stage46 / Stage45.2 / Stage45.1;
- Stage44 если затронуты чек-листы;
- Stage43 если затронуты attachment guards;
- Stage42 если затронута мойка;
- Stage40A если затронута архивная видимость;
- Stage30 release readiness;
- builds, Prisma checks, seed check, prompt/alert scan, mojibake/visible-English scan.
