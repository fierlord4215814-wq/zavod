# FACTORY9-SHIFT-AND-MULTIFACTORY-05 — actor × factory × action

Только новый срез 29.09.2026. `LIVE` означает штатный UI/HTTP с серверной записью и readback; `ISOLATED` — методный тест без рабочего SQL. Исторические F04 результаты не приписываются этому блоку.

| Actor и контекст | Действие | Результат |
|---|---|---|
| Примеров Олег 9 / №9 / WORKER | Обычный вход и POST штатного `/shift/start` с настоящим bearer | `LIVE PASS`: создана одна 12-часовая session `d0d42cae-8665-4378-9c1e-0d58b11052c6`, первоначально ACTIVE; в UI на смене 1. Не было назначения/кредита. |
| Примеров Борис 9 / №9 / MASTER | UI «Люди на смене → Олег → Отправить домой» с комментарием | `LIVE PASS`: UI 1→0, точная session ENDED, User OFF_SHIFT, 2 audit events; нет активного Assignment, credit=0. |
| Примерова Ульяна 9 / №9 / CONTRACTOR | Старая расщеплённая session после прежнего sendHome | `READ-ONLY`: штатная maintenance закрыла к 08:00 МСК, credit старого assignment остался 1; не выдаётся за своевременное закрытие отправкой домой. |
| Примеров Николай 9 / №9 / WORKER | Независимая старая session | `READ-ONLY`: штатная maintenance закрыла по собственному сроку; адресная операция над ним не выполнялась. |
| Примерова Марина 9 / №9 / STORE | UI-публикация одного учебного возврата с проверенным PNG, выход и новый вход | `LIVE PASS`: ReturnRecord `e3582754-8d73-455a-8f0e-871b853092fa`, 1 Attachment, 1 шт., фото/название сохранены; не фото реальной продукции. |
| Примеров Борис 9 / №9 / MASTER | UI checklist archive и Back после source/build/restart | `LIVE PARTIAL`: сводка 3 completed, отдельно четвёртое 0/2, архивная карточка и Back открываются; новые A/B/C фото и two-window не перепроверялись. |
| Примеров Андрей 9 / №9 / MANAGEMENT | UI ON: 8 локальных overrides; сохранение учебного подчинённого Павла; контрольный OFF→DENY→ON | `LIVE PARTIAL`: локальный Save и audit actor/factory PASS; №4/global HTTP 403, OFF HTTP 403, финально ON и MANAGEMENT. Прямые self/peer/stale-write мутации не запускались; isolated guards PASS. |
| Три прежних TECH №4 → №9 | UI-грант exact №9, отдельный OFF→DENY→ON каждого | `LIVE PASS`: три UFA ID в report, роли прежние, №4 UFA/count сохранены. При OFF №4 `/tasks` 200, №9 403; для электрика Task-link/file №9 тоже 403. Финально все ON, audit всех циклов есть. |
| Борис №9 MASTER → старые КИПиА/электрик №4 | UI URGENT+LONG №9, notice/deeplink, take/comment/done | `LIVE PASS`: обе Task source №9 DONE, по 2 комментария; source archive 4/4, XLSX HTTP 200. Обратное №4→№9 NOT_RUN. |
| Электрик `mobile-tech-electric` / №4↔№9 | Одна source ShiftSession №4, две открытые вкладки «Смена», штатный end | `LIVE PASS` для «Смена»: обе страницы показали 1, после end без F5 0; одна SQL session ENDED, active session/Assignment/credit 0. Отдельный экран «Люди» №9 ошибочно показал свободен при active session — FAIL для этого consumer. |
| КИПиА/электрик/холодильщик №4↔№9 | Единый service chat | `BLOCKED_PRODUCT_PATH`: обычный `/chats` даёт существующий factory-local №4 chat, №9 пуст; общего Chat с `factoryId=NULL` нет. Никаких дублирующих чатов не создавалось. |
| ADMIN / №9 | UI archive checklist A/B/C после грантов | `LIVE PARTIAL`: архивный запуск хранит проверки 1–3 Завершено, 4 Закрыто, фото первой проверки доступно. Полный two-window checklist retest не выполнен. |

