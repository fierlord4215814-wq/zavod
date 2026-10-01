# PHYSICAL FIELD FIXES V5 / Plast 1 - requirement status

Дата проверки: 03.08.2026.

Итог: `PASS`.

## Acceptance gates

| Gate | Статус | Доказательство |
| --- | --- | --- |
| `CANONICAL_LINE_STATE_GATE` | PASS | `LineService` формирует один backend read-model для списка, смены, dashboard и detail. Приоритет: `WASH > DOWNTIME > RUNNING > STOPPED`. |
| `SHIFT_LINES_PARITY_GATE` | PASS | Browser E2E сравнил одну и ту же линию, людей, мойку и статусы на экранах «Смена» и «Линии» до и после переходов. |
| `LINE_COUNTER_PARITY_GATE` | PASS | Текущие группы и счётчики обоих экранов берутся из canonical DTO; E2E проверил значения до и после переходов и reload. |
| `SHIFT_GROUP_ORDER_GATE` | PASS | Порядок в «Смене»: линии в работе, повременщики/рабочие зоны, мойка, остановленные линии. Проверено на desktop, 360, 390 и 430 px. |
| `PRODUCTION_STAFF_TOTAL_GATE` | PASS | Счётчик «На производственных линиях: X из Y» считает уникальные активные LINE-назначения и требуемые позиции активного плана; TIME/WASH/WORK_AREA и закрытые назначения исключены. |
| `ATOMIC_TRANSITIONS_GATE` | PASS | Изменение статуса использует transaction lock/version; повтор одинакового статуса идемпотентен; realtime публикуется после commit. |
| `STOP_RELEASE_PRESERVE_COMPOSITION_GATE` | PASS | STOP закрывает фактические LINE-назначения, освобождает людей и сохраняет template/current/future work plan и историю. Повторный запуск не возвращает людей автоматически. |
| `WASH_SINGLE_ACTIVE_GATE` | PASS | Новый конкурентный запуск мойки создаёт не более одной активной сессии; повторный запрос идемпотентен; завершение мойки не запускает линию автоматически. |
| `DOWNTIME_SINGLE_ACTIVE_GATE` | PASS | Конкурентный PAUSE создаёт один активный простой, повтор не создаёт дубль. |
| `SERVER_TIME_DURATION_GATE` | PASS | Новые wash/defrost timestamps задаются сервером; client timestamps не определяют начало/конец; длительность строится из серверного интервала. |
| `ARCHIVED_SHIFT_READONLY_GATE` | PASS | Архив строится по историческому окну смены, сохраняет линии, позже отключённые, исключает созданные после окна и не содержит mutation controls. |
| `REALTIME_CACHE_PARITY_GATE` | PASS | `LINE_UPDATED`, `WASH_UPDATED`, `ASSIGNMENT_UPDATED`, `SHIFT_UPDATED` публикуются после commit и инвалидируют единый operational cache; E2E проверил reload/reconnect-поведение. |
| `FACTORY_ISOLATION_GATE` | PASS | Targeted regression подтвердил отказ cross-factory и минимальную матрицу MASTER/WORKER/MANAGEMENT/ADMIN. Backend guards не ослаблены. |
| `MOBILE_LAYOUT_GATE` | PASS | Playwright проверил 360/390/430 px без horizontal overflow, с корректным порядком групп и доступными действиями. |
| `CLEANUP_GATE` | PASS | Все marker-артефакты завершены/деактивированы штатно. Финальный read-only срез: все активные счётчики равны 0; physical delete не выполнялся. |

## Severity

- P0: 0.
- P1: 0.
- P2: 0.
- Неблокирующее эксплуатационное наблюдение: в существующих данных Завода 4 до этого пласта были старые незавершённые wash-сессии. Они не изменялись и не скрывались; canonical read-model показывает единое состояние, а новые дубли блокируются.

## Scope boundaries

- Пласт 2 не начинался.
- Prisma schema и migration-файлы не менялись; migration не нужна.
- `.env`, uploads, backups и реальные пользовательские данные не менялись.
- Общий аудит и исторический regression-хвост не запускались.

