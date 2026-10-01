# FACTORY-01 — ручной просмотр T1

Стенд работает только на этом компьютере: [открыть «Завод»](http://127.0.0.1:5173/). Выберите **УЧЕБНЫЙ ЗАВОД T1** (`test-factory-t1`). Это постоянный локальный **учебный** стенд, не настоящий №4 и не серверный пилот. Полный статус — PARTIAL, не Pilot Ready.

## Вход без публикации паролей

Защищённый локальный индекс, **не входит в ZIP**:

`C:\Users\79164\AppData\Local\Zavod-Factory01\run-20260926-t1\credential-index.json`

Индекс сопоставляет key/роль/учебное имя/логин и `secretFile`. Откройте соответствующий локальный файл под своей Windows учётной записью. Не вставляйте его содержимое в отчёт/чат/репозиторий. Рабочие .env/пароли не используются. Для двух ролей одновременно используйте разные профили браузера/обычное и приватное окно; logout закрывает текущий сеанс.

Есть ADMIN и30 non-ADMIN: MANAGEMENT1,MASTER2,TECHNOLOG1,OKK2,STORE2,WORKER12,по1 каждой из5TECH,CONTRACTOR_LEAD1,CONTRACTOR2,OTHER2. Все31 пользователя T1 активны; их текущие разрешения различаются. Отсутствующая кнопка не повод выдавать дополнительные права.

## MANUAL_REVIEW_INDEX

| Что посмотреть | Роль / путь | Уже сохранённый пример / ограничение |
|---|---|---|
| Структура |ADMIN→Админка |T1,11отделов/служб,15должностей/иерархия,4линии×3позиции,4defaulttemplates,учебная компания |
| Люди/навыки |ADMIN или MASTER→Люди→поиск «Учебный-Работник-01»→профиль→Навыки по линиям |Несколько line/position skills, опыт. Это рекомендация при подборе, не квалификационный hard guard; открытый профиль не получает отдельного skill-only liveupdate |
| Текущая смена |MASTER→Смена/Линии |Все4линии STOP,0активных назначений/смен — намеренный safeidle, не исчезнувшие пользователи |
| Следующая смена |MASTER→Выбрать смену→Следующая |4участника «Я буду»,4линии плана,3active slots,1снят. WORKER03 видит своё место наУЧ-Линия1. Дата сценария27.09.2026 DAY; позже ищите историю/выбранную дату, не ожидайте вечного «завтра» |
| Заявки |MASTER/соответствующийTECH→Архив→Заявки |5tech lifecycle и «Нужен УЧ — Двигатель», фото/комментарии/история. Все8 основныхT1задач DONE; автоматической Task→Stock связи нет |
| Технические остатки |STORE→Заказы/Остатки |Датчик10,ремкомплект10,расходник10,подшипник9; двигатель3 вADMINархиве. Владелец — складской отдел. STORE может расход/пополнение, не произвольный create/archive |
| ОКК/возвраты/некондиция |OKK/STORE→раздел/Архив |Завершённые записи, реальные synthetic фото, partial/history; [прочитанный XLSX](okk-archive-export.xlsx) |
| Мойка |MASTER/OKK→Архив→Мойка |УЧ-Линия1 DONE: issue/resolve,контроль,OKKreview/фото |
| Оттайка |HOLOD/MASTER→Оттайка |Текущий экран пуст после STOP/complete. Сохранённый completed event подтверждён API календаря; прежний UI календаря — [снимок](defrost-calendar-completed.png) |
| Чек-листы |ADMIN→Чек-листы→управление; OKK/MASTER→Архив |3namedtemplates;OKK10mixedpoints+refs/results,MASTER3pointline. Вархиве «Дальше»/«Далее: фото» только навигация; редактирования нет. Reference иresult — разные файлы |
| Объявления |STORE/OKK→Объявления→Архив;ADMIN→Управление |4archived synthetic publications, IMPORTANT/NORMAL/selected2depts,photo,ACKreport2users. Новыхнет — намеренно |
| Чаты |ADMIN/TECH_MECHANIC→Чаты |Активная «Учебная группа FACTORY01 T1», text/file/reply/reaction. STORE↔STORE02 — direct. WORKER/CONTRACTOR не имеютchat |
| Журнал |MASTER→Пересменка/Журнал→Архив |Обычнаяproductionrecord с комментарием/фото;otherdepartmentauthors в своих архивах по правам. Не все роли имеютarchivepermission |
| Неизменяемая передача |Только retained **managedcopy**, не основнойT1 |[UI](handover-copy-390.png), [восстановленныйMASTER](handover-restored-master.png), [receipt](handover-restored-readback.json). Mainstand не переключать ради ручного знакомства |

Не открывайте тестовые fault-injection scripts и pair scripts как «обычный запуск»: они предназначены для точных изолированных проверок. Существующие paired backups защищены вне ZIP, повторный `pair` откажется перезаписать цель.

## Штатная остановка и повторный запуск

Используйте установленный **PowerShell7 (`pwsh`)**, каталог `C:\Users\79164\Documents\work`. Не требуется UAC, служба, ExecutionPolicy bypass или установка среды.

```powershell
& .\docs\vps-preparation\factory-01\stand.ps1 -Action Stop -Target T1
```

Helper заново проверяет listener/PID/creationtime/executable/command/version и собственный pgdata, затем останавливает backend3000,preview5173 и **свой** PG15437. Stored PID не команда для `taskkill`. Если identity не совпала, helper остановится; не обходите это массовым завершением Node/PostgreSQL.

```powershell
& .\docs\vps-preparation\factory-01\stand.ps1 -Action Start -Target T1
```

Запуск использует текущие canonical `backend/dist`/`frontend/dist`, собственные secrets/config/uploads, production auth и127.0.0.1. Старый C1 на15436 не запускается. Если сборки изменены после FACTORY01, ранее полученный PASS не переносится автоматически на новую сборку.

Фактическая финальная runtime identity: [receipt](runtime-20260926-220156-536.json); состояния/сохранность: [final-live-state](final-live-state.json). PID15936backend/13268preview/24212PG — наблюдение27.09.2026, а не вечные идентификаторы. Копии Restore/Handover/HandoverRestore не имеют работающего backend/SQLподключений; их сохранённые данные не удалены.

## Что пока нельзя считать готовым

Доказан postcommit task-notification loss при сбое; полный role/gate corpus остаётся PARTIAL, см. [report](report.md). Physical phone/camera/PWA, Linux/Compose/volumes/permissions/HTTPS/WSS/reboot VPS не проверены. Стенд не открыт вLAN/internet. Учебную БД целиком на рабочую площадку не переносить.
