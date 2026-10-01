# PFF V5 Plast 16C - discovery

Дата discovery: 27.08.2026. Код приложения на этом шаге не менялся.

## Runtime ownership

- Проверены порты `3000`, `5173`, `3101`, `5175`: слушателей нет.
- Процесс `cloudflared.exe` не запущен.
- Controlled regression и production-like runtime не пересекаются.
- `SINGLE_MAINTENANCE_OWNER_GATE: PASS`.

## Canonical контур

- API и формулы: `backend/src/modules/ops/ops.controller.ts` + `backend/src/modules/ops/ops.service.ts`.
- История действий: canonical `AuditLog`, запись через `backend/src/common/audit.service.ts`.
- Серверное время завода: `backend/src/common/shift-time.ts`, `factoryServerNow()` и `factoryDayWindow()` (`Europe/Moscow`).
- UI: `frontend/src/screens/OpsAuditScreen.tsx`.
- Общий визуальный контур: `frontend/src/components/PremiumShell.tsx` и canonical tokens в `frontend/src/styles.css`.
- Диагностическая видимость: `backend/src/common/pilot-visibility.ts`.
- Права: controller permissions и независимые service guards; factory scope берётся только из `UserContext.selectedFactoryId`.

Новых `StatisticsEvent`, `StatisticsCounter`, aggregate tables или второго read-model не требуется.

## Существующая правильная основа

- Простои строятся из `LineEvent`, а не из заявок или UI-состояния.
- Заявка считается созданной из простоя только при явной связи `Task.lineStatusEventId`.
- Реакция, исполнение и решение уже имеют различимые timestamp-источники.
- Процентили используют nearest-rank: `ceil(N * p) - 1` после сортировки.
- Проверки чек-листа учитывают parent lifecycle и не считают `ACTIVE` child текущим при закрытом parent.
- Качество использует отдельные canonical сущности `OkkRecord`, `StockDefect`, `ReturnRecord`.
- Мойка считается по `WashSession`, проблемы по `WashIssue`, мини-задания по `WashControlItem`.
- Audit берётся из `AuditLog`, не из операционного архива.
- Diagnostic marker уже распознаёт `__PFFV5_P...__`; включение diagnostic rows разрешено только diagnostic ADMIN на backend.

## Подтверждённые разрывы

1. Общие фильтры `overview/events/audit/module-summary` разбирают `YYYY-MM-DD` через `new Date(value)`: это UTC-полночь, а `dateTo` не становится концом factory-local дня.
2. `TaskHistory` во вкладке «События» не ограничен периодом до merge; период может показывать чужие по времени строки.
3. «Модули» смешивает all-time counts и period-filtered counts без объяснения. Большинство карточек игнорирует выбранный период.
4. Выбор заявок по `createdAt/updatedAt/doneAt/deadlineAt` пропускает часть сущностей, открытых на границе периода, и использует текущий status вместо status-as-of-period-end.
5. Простой, закрытый после конца выбранного периода, ошибочно помечается закрытым на конец периода (`isOpen` зависит от наличия любого будущего `WORK`).
6. «Эффект 10 минут» умножает `10 * 365`, называет календарные дни рабочими и не ограничивает эффект фактическими потерями.
7. В `overview/module-summary` fixture filtering применяется не ко всем canonical сущностям.
8. В Audit actor часто сводится к «Сотрудник», объект показывается только типом, nested before/after превращается в «изменено», а список перегружен detail chips.
9. Ошибка service guard Audit возвращается английским текстом.
10. Вкладка «Потери» держит длинный фильтр перед данными; Audit не имеет canonical `PremiumSheet` для деталей.
11. Известные 723 legacy child statuses не изменяются, но Statistics должна явно учитывать effective parent lifecycle и показывать read-only data-quality warning.

## Migration

`NOT_REQUIRED`. Все необходимые timestamps, lifecycle fields, relations, factory scope и audit payload уже существуют. Никаких schema/DB migration в Plast 16C не планируется.

## Минимальная стратегия исправления

1. Перевести весь Ops read-model на один factory-local half-open period `[from, to)` и `factoryServerNow()`.
2. Исправить overlap/as-of semantics заявок и простоя без изменения canonical business rows.
3. Сделать «Модули» полностью period-scoped и вернуть явный human scope label.
4. Заменить «10 минут» на bounded effect выбранного периода: не больше фактически потерянного времени.
5. Закрыть fixture filtering во всех счётчиках и добавить небольшой набор доказуемых data-quality warnings.
6. Дать Audit общую human presentation, resolved actor/object labels и компактный `PremiumSheet`.
7. Перевести фильтры Statistics/Audit в существующий `PremiumSheet`; сохранить один Industrial Premium 10F контур.
8. Доказать формулы отдельным controlled runner с literal expected values и реальным browser flow.

## Что не трогаем

- P13-P16B владельцев shift/checklist/archive/XLSX, кроме компактных affected smoke.
- 723 legacy checklist child rows и три ambiguous ordinary open STOP.
- Factory 4 business data.
- RBAC matrix, guards, Prisma schema, миграции, backup/restore, uploads и `.env`.

