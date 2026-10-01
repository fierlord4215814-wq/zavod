# LOCAL-01 / UI-SWEEP-036 — адресная C1 Windows-сверка, 24.09.2026

Разрешение пользователя относится только к этому gate в собственной учебной C1. Основной UI Sweep не возобновлён. Источник 19 имён — `docs/full-ui-interaction-sweep/system-stabilization/20260916-master-r4/handoff/shift-log-19-bindings.json`; исторический статус его строк не заменён этим документом.

## Действительно выполнено

- Перед запуском проверен `c1-shiftlog-036.cjs` и собственная runtime identity; явный approval на точное действие получен. Реальный Edge на loopback создал обычную запись `f78cb509-994f-4d65-9219-e9d9f57bd21f`, прикрепил файл `f6f300a3-d667-4ff1-bac2-8dfcc8b191d1`, затем штатно soft-архивировал. Сохранённый файл прочитан побайтно, SHA-256 `e07f7d943de198c551d2e1efbaa9d399135c5001279413151e9d7413331da8ac`.
- API: активная detail ADMIN/OKK 200; архивирование 201; архивные list/detail ADMIN 200 и `availableActions=[read]`; `archive=true` в обычном list не вернул запись; обычная detail 409; архивный доступ OKK/OTHER 403; изменение read/comment 409, повторная загрузка файла 403; архивный файл ADMIN 200, OKK 403. Физическое удаление не проверяли. WS в этой пробе доказан лишь кадром `connected`, не перерисовкой второй страницы.
- Через настоящую форму Edge созданы две отдельные учебные важные записи `160a4a66-ff23-4ad0-8f1e-cb48bb956210` и `dd7ca72e-15d3-42a7-a9cc-6d028e697271`: форма создания 201, обычный комментарий 201, загрузка через file chooser 201, закрытие важного 201. SQL read-only подтвердил `CLOSED`, `isDeleted=false`, `isImportant=false`. После закрытия записи закономерно исчезли из Active; прежний harness ошибочно ждал их там и завершался FAIL **после успешных пользовательских действий**, не по дефекту продукта. Исправлена только финальная ожидаемая вкладка harness; третью запись не создавали и исправленный harness заново не запускали.
- Отдельный `c1-shiftlog-036-archive-ui.cjs` прошёл exit 0: обе CLOSED-записи видны в «Архиве»; открытие точной карточки read-only, обычные mutation-controls отсутствуют, preview `handover-ui.txt` через guarded GET 200 и байты SHA-256 `3be3a8ef44871167852e2d3f3e5c0cf0559f7414fb410f1e32c80d12d6503bc4`; browser Back вернул карточку. Не было POST `/read` от архивного просмотра. Только эти два собственных ID после этого штатно soft-архивированы через API 201; прямые архивные detail 200, `ARCHIVED`, `availableActions=[read]`. История и audit сохранены.
- Связанные изолированные backend contracts: 14/14 PASS (`ui-sweep-036-archive-contract.test.js`, `master-r2-handover.test.js`). Это отдельный слой, не подмена live HTTP/SQL/UI.

## 19 inherited bindings — поимённый результат

`PASS_UI` означает наблюдавшееся нажатие/ввод и видимое состояние, не утверждение полного server-filter или cross-session поведения. `PASS_UI_HTTP` добавляет реальный ответ сохранения. Состояние после reload карточки покрыто отдельной архивной пробой.

| № | Binding | C1 Windows факт | Граница |
|---|---|---|---|
| 1 | Активные | PASS_UI, выбранная вкладка | Нет проверки полного набора active на второй странице |
| 2 | Важные | PASS_UI, выбранная вкладка | Серверная полнота фильтра не сверена |
| 3 | Архив | PASS_UI + real archive list/detail 200 | Отдельные архивные права проверены API |
| 4 | Поиск и фильтры | PASS_UI, sheet открыт | — |
| 5 | Новая запись | PASS_UI_HTTP, POST 201 из формы | Две собственные записи, затем закрыты/архивированы |
| 6 | Сбросить | PASS_UI, draft очищен | — |
| 7 | Показать | PASS_UI, sheet закрылся, summary обновлён | Состав серверного filtered result не принят |
| 8 | Текст записи | PASS_UI, значение введено | Только draft/summary |
| 9 | Дата с | PASS_UI, значение введено | Только draft |
| 10 | Дата по | PASS_UI, значение введено | Только draft |
| 11 | Смена | PASS_UI, `День` выбран | Только draft |
| 12 | Отдел | PASS_UI, собственный отдел выбран | Только draft |
| 13 | Открыть карточку записи | PASS_UI + archive detail; Back вернул карточку | Обычное открытие выполнено до закрытия |
| 14 | Закрыть окно | PASS_UI, modal закрылся | — |
| 15 | Комментарий | PASS_UI_HTTP, обычный comment POST 201 и текст виден | Это **не** immutable handover snapshot |
| 16 | Файл | PASS_UI, dialog и file chooser | Загрузка/guarded bytes отдельно ниже |
| 17 | Закрыть важное | PASS_UI_HTTP, POST 201, SQL `CLOSED` | После действия это уже архивная вкладка |
| 18 | Отмена | PASS_UI, dirty-confirm «Закрыть без сохранения» | Не создала комментарий |
| 19 | Загрузить | PASS_UI_HTTP, POST 201, guarded preview и byte SHA | Retry/interruption не проверены |

## Пересменка как immutable snapshot — отдельно

Два исходных 409 пустого C0 воспроизведены и объяснены действующей политикой: у первого ADMIN не было отдела. С отделом `availability=200`, вне окна создания `available=false` и сообщение об открытии 18:00; `summary=409` с тем же временным условием; `previous=200` с пустым body. ОКК без `manage` получил 403 на availability/summary. Никакого 200 вместо законного отказа не вводили. В `ShiftPeopleScreen.tsx` добавлен явный выбор отдела ADMIN и понятное сообщение об окне; для действительно пустого `previous` добавлен узкий `getOptional` в `api/client.ts`. Реальный Edge 360/390/1440 px подтвердил отсутствие запроса до выбора, параметр отдела после выбора, отказ от кнопки «Передать смену» вне окна и отсутствие horizontal overflow.

Позднее на **отдельной восстановленной копии C1**, а не исходной production-like C1, применена только встроенная управляемая тестовая точка `factoryServerNow` при `NODE_ENV=test`: 24.09 18:30 Москвы для создания, затем 20:30 для чтения предыдущей сменой. Backend оставался только на loopback, обычный Bearer login; системные часы Windows не менялись. [Edge UI создание](c1-handover-immutable-ui.cjs) дало `POST /shift-log/handover=201`, сохранённый immutable log `f72180ee-8e0b-5392-a9d3-60d7c62b22d9`, повторный summary/detail 200 и exact comment. [Edge UI следующей смены](c1-handover-previous-ui.cjs) открыл карточку «Передано предыдущей сменой» read-only; API previous/direct 200. Обычный комментарий в soft-архивном log имеет `handover=null` и не смешался с `snapshot.comment`. Read-only SQL: SHA-256 encoded immutable text `a37b9a66f98119fa3cf8ffdf44615793b202f8300a058b645322fad005aca317` до/после перехода времени совпал, у handover 0 `ShiftLogComment`. Это реальный UI/API/SQL **на managed-time копии**, не доказательство естественного окна C1 production. Тестовый backend завершён и исходный C1 production backend возвращён.

Открытый security/policy остаток gate: guest/revoked/cross-factory archival denial есть в isolated contracts и общих C1 auth/scope проверках, но не в полном live 036 replay; нет полного filtered-result proof и второй страницы без F5 для пересменки. Managed-time immutable snapshot прошёл на отдельной копии, естественное окно исходной C1 не проверено. Поэтому `UI-SWEEP-036=PARTIAL_LIVE_TESTCLOCK`, а не общий PASS. Прямые ссылки и `archive=true` для собственного soft-архивированного ID проверены live.
