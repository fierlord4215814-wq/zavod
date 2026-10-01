# Plast 16C - controlled formula proof

## Метод

- Изолированный marker: `__PFFV5_P16C_1787868705921-605f4d__`.
- Период: локальный день завода `2026-08-27`, timezone `Europe/Moscow`.
- Границы query: `[2026-08-26T21:00:00.000Z, 2026-08-27T21:00:00.000Z)`.
- Controlled `asOf`: `2026-08-27T20:30:00.000Z`.
- Expected значения заданы literal-константами теста, а не вычислены production helper.
- Business happy path выполнялся canonical services/API; direct Prisma использовался только для изолированного setup и soft cleanup.
- До controlled-time запуска подтверждён один maintenance owner: `SINGLE_MAINTENANCE_OWNER_GATE: PASS`.

## Простои

Controlled durations: `10, 10, 20, 30` минут.

| Метрика | Формула | Expected | Actual |
|---|---|---:|---:|
| Количество | число уникальных clipped интервалов | 4 | 4 |
| Всего | `10 + 10 + 20 + 30` | 70 | 70 |
| Среднее | `round(70 / 4)` | 18 | 18 |
| Медиана | nearest-rank p50, rank `ceil(4 * 0.5)` | 10 | 10 |
| p90 | nearest-rank, rank `ceil(4 * 0.9)` | 30 | 30 |
| Открытых на `asOf` | interval без закрытия до `asOf` | 1 | 1 |

Открытый интервал считается только в пересечении с `[from, min(to, asOf))`. Будущее событие `WORK` не делает его закрытым задним числом. Один `LineEvent` не размножается связанными заявками, комментариями или историей.

Самая проблемная линия определяется по `lostMinutes DESC`, затем `downtimeCount DESC`, затем по человекочитаемому имени. Controlled Line A имеет 60 минут против 10 минут Line B и выбрана детерминированно.

Причины: техническая неисправность `1 / 10 мин`, контроль качества `1 / 20 мин`, нехватка людей `1 / 30 мин`, другое `1 / 10 мин`.

## Заявки

Фактический контракт:

- reaction: `createdAt -> takenAt`;
- execution: `takenAt -> doneAt`;
- resolution: `createdAt -> doneAt`.

| Метрика | Expected | Actual |
|---|---:|---:|
| Всего | 3 | 3 |
| Открыто на конец периода | 2 | 2 |
| Завершено | 1 | 1 |
| Срочных открытых | 1 | 1 |
| Просроченных LONG | 1 | 1 |
| Реакция avg/median/p90 | 5 / 5 / 5 | 5 / 5 / 5 |
| Исполнение avg/median/p90 | 20 / 20 / 20 | 20 / 20 / 20 |
| Решение avg/median/p90 | 25 / 25 / 25 | 25 / 25 / 25 |

Заявка относится к простою только при явной canonical связи `lineStatusEventId`. В controlled data одна связанная и одна несвязанная заявка; double count отсутствует.

## Эффект 10 минут

Формула: `min(actualLostMinutes, workdaysInPeriod * 10)`. Для одного буднего дня и 70 минут фактической потери expected/actual равны 10 минутам. Метрика не использует старое `10 * 365` и не может вычесть больше реальной потери.

## Чек-листы, мойка и качество

| Контур | Expected | Actual |
|---|---|---|
| Чек-листы | started 4; active 1; runs completed 3; checks completed 1; overdue 1; manual 2; shift 1 | совпало |
| Мойка | active 1; completed 1; issues 1; open issues 1; mini-tasks 1; done 1 | совпало |
| Качество | OKK 1; некондиция 1; remaining quantity 15; возвраты 1 | совпало |

`MANUAL` и `MANUAL_EARLY` входят в ручное закрытие, `SHIFT_END/AUTO_CLOSED` - в сменное. Child `ACTIVE` не считается текущим при закрытом parent. Исторические 723 child rows не изменялись.

Количество некондиции берётся один раз из canonical remaining quantity; original и partial-release ledger не суммируются как два независимых объёма.

## Модули и Audit

Все карточки «Модули» следуют выбранному периоду. Controlled counts: заявки 3, мойка 2, чек-листы 4, заказы 0, ОКК 1, остатки 1, возвраты 1, пересменка 0, оттайка 0, уведомления 0, доступ 0.

Audit proof: canonical `AuditLog`, 25 controlled rows, human action/actor/object labels, before/after `Количество: 20 -> 15`, без raw details, UUID как основного текста, JSON dump и secret fields.

## Итог

- Formula checks: `79/79`.
- Cleanup and protected-data checks: `17/17`.
- `STATISTICS_FORMULA_GATES: 18/18`.
- `AUDIT_GATES: 10/10`.
- Active marker entities after cleanup: `0`.
- Factory 4 protected hash before/after: одинаковый.
