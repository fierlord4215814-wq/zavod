# Пласт 11: bounded discovery

Дата evidence: 13.08.2026.

## Заявки

Canonical контур уже существовал: Prisma `Task`, `TaskDepartmentRecipient`, `TaskAssignee`, `TaskComment`, `TaskHistory`, attachment/audit/notification и WebSocket infrastructure. Второй модуль не создавался.

- Типы: `URGENT` и `LONG`.
- Lifecycle: `NEW -> IN_PROGRESS -> DONE`; передача возвращает заявку в `NEW` с новым получателем и сбрасывает прежнее взятие в работу.
- `LONG` обязательно имеет срок и адресата. Просрочка и эскалация рассчитываются существующим backend-контуром.
- Получатели выбираются из canonical `Department`; линия - из canonical активных линий выбранного завода.
- Видимость и действия определяет backend: factory scope, creator/assignee/active department recipient либо `tasks.manage`. Недействующие, гостевые, blocked/deactivated и fixture-получатели не становятся исполнителями.
- Завершённые заявки остаются в истории и архиве; physical delete не используется.
- `operationId` и operation lock обеспечивают идемпотентное создание; take/complete/comment/redirect имеют повторяемое безопасное поведение.

Подтверждённый продуктовый разрыв был в согласованности consumers: realtime не охватывал весь lifecycle, redirect сохранял устаревшее состояние исполнителя, уведомления не завершались вместе с entity lifecycle, а UI не имел полного canonical набора фильтров. Исправлен существующий контур, новая RBAC или новая сущность не добавлялись.

## Остатки и заявки на заказ

Canonical контур: `MinimumStockItem`, `MinimumStockMovement`, `OrderRequest`, module settings, attachments, общий audit/notification и WebSocket.

- Это неснижаемый запас критичных позиций, не ERP и не полноценный складской учёт.
- Позиция хранит наименование, категорию, единицу, текущее и минимальное количество, отдел-владелец, зону и комментарий.
- Количество меняется только явными штатными действиями «Израсходовать» и «Пополнить», каждое создаёт movement/audit.
- Заявка создаётся вручную либо из позиции. Реальные статусы: `ACTIVE`, `ORDERED`, `NOT_NEEDED`, `CLOSED_RESERVED`.
- Закрытие «К заказу» или «Отклонена» не меняет остаток автоматически. Это намеренная текущая семантика.
- Открытый заказ на ту же позицию не дублируется. Повтор того же close command идемпотентен; попытка другого решения после закрытия конфликтует.
- Архив позиции - soft archive. История и связи сохраняются.

Pilot-матрица Завода 4 на момент проверки: MANAGEMENT/ADMIN имеют необходимые права на остатки и заявки на заказ; у pilot STORE эти права отсутствуют, поэтому UI и API закрыты. Права не расширялись ради теста.

## Scope и migration

Factory isolation применяется в каждом read/write query. Для не-ADMIN дополнительно действует department scope. Сериализаторы используют узкие user selects и не отдают `storagePath`, `passwordHash`, credentials или token values.

Prisma schema уже поддерживает все требуемые связи и lifecycle. Migration не нужна и не создавалась.

## Test-data policy

Основной browser flow использовал marker `__PFFV5_P11_<runId>__`. URGENT/LONG были завершены, order закрыт, marker stock item архивирован, marker notifications прочитаны. Реальные позиции не менялись; hash 372 предсуществующих позиций до/после совпал.

