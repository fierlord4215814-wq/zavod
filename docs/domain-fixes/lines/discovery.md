# Lines domain fix: discovery checkpoint

Дата: 31.08.2026

Повторный доменный аудит не проводился. Работа продолжена от завершённого аудита в `docs/domain-audits/lines/` и его реестра LINE-001...LINE-019.

## Использованные canonical owners

- `LineService` и существующий `Line.version`: проекция состояния и команды линии.
- `Assignment`: люди на линии; второй контур назначений не создавался.
- `Task`: заявки, в том числе связанные с простоем.
- `WashService` и `DefrostService`: самостоятельные lifecycle мойки и оттайки.
- `backend/src/common/shift-time.ts` и `frontend/src/utils/factory-time.ts`: заводское время.
- effective permissions и backend guards: окончательное решение по доступу.
- `ArchiveService` и `OpsService`: история и статистические read-models.
- `PremiumSheet`, `ActionModal` и `frontend/src/navigation/mobile-back.ts`: слои и Back.
- `frontend/src/styles.css`: существующая Industrial Premium 10F дизайн-система.

## Решение по схеме данных

`MIGRATION: NOT_REQUIRED`. Существующие `Line.version`, `LineEvent.downtimeReason`, комментарий события и связи Defrost/Wash/Task полностью покрывают исправления. Prisma schema и данные не менялись.

## Контролируемый контур

- Финальный marker: `__LINE_FIX_1788197959721__`.
- Использованы две изолированные diagnostic factory; Factory 4 не использовался для state-transition проверки.
- Перед cleanup: backend audit `41/41`, targeted backend `16/16`, browser E2E `31/31`.
- После cleanup активных marker-сущностей нет, физические удаления не выполнялись.
- Product source, роли и защищённый снимок Factory 4 совпали до и после controlled run.

## Что не трогалось

- LINE-015: immutable исторические названия, отдельное продуктовое решение.
- LINE-016 и LINE-018: P3/debt вне текущего scope.
- Люди, смены, заявки, мойка и оттайка не получали новый owner или новую бизнес-логику.
- People audit не запускался.
