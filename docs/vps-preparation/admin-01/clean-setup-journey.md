# ADMIN01 — clean Admin setup journey

**Настройка bounded C через UI выполнена; полный self-service = PARTIAL. Отдельный final clean smoke = PASS.** Все новые доказательства — Windows UI/HTTP/WS/SQL, не VPS/Linux. CLI foundation/bootstrap использовались только как штатная начальная установка; успешные бизнес-шаги SQL writes не заменялись.

## Основной путь

| Шаг | Реальная операция и результат | Primary evidence |
|---|---|---|
| Чистая основа | Собственная копия final C0: foundation, один ADMIN, один нейтральный A0; без C1 history | [clean-target](clean-target.json), [baseline](before.json) |
| Bounded C | Admin empty wizard → C; после исправления app context `/auth/me`/selected factory/consumer согласованы; A0 unchanged | [structure](structure-journey.json) |
| Структура | UI два отдела, parent→child две должности, одна остановленная линия, позиция, шаблон состава; edit/guards/reload | [structure](structure-journey.json), [CRUD](crud-edit-journey.json) |
| Люди | Штатная browser-регистрация guest, Admin ФИО/UFA/role/department/job; три собственных участника, без копирования identity | [users](users-journey.json), [security](users-security.json) |
| Личный вход | Одноразовое recovery → личный пароль → обычный login; reuse401/stale403; credential не в evidence | [recovery](recovery-after.json) |
| Обычный consumer | MASTER/WORKER в отдельных сеансах выбирают C, видят разрешённые меню/структуру, чужие/full Admin API denied; line update безF5 | [roles](roles-permissions.json), [CRUD](crud-edit-journey.json), [security](users-security.json) |
| Настройки | Реальные preview/PATCH→SQL→reload и downstream; 30 operational editable,25 bounded consumer PASS,5 PARTIAL | [66-field matrix](module-settings-matrix.md), [persistence](settings-persistence.json) |
| Чек-лист | UI create/rules/photos/update/copy; обычный исполнитель, closed snapshot неизменен, второй UI738мс | [editor](checklist-editor-ui.json), [copy](checklist-copy-after.json) |
| Объявление | UI factory/departments/priority, reader ACK, author report, archive | [announcements](announcements-ui.json) |
| Аудит | Обязательные семейства событий, актор/цель/завод/время, safe details | [audit](audit-readback.json) |
| Завершение fixtures | Три users blocked, все UFA revoked, операции закрыты, структура неактивна, C inactive;19 history counters сохранены | [cleanup](cleanup-c.json) |

Незакрытый переход к полноценному сопровождению: User home=A0 с active C UFA успешно назначается на C, но отправка домой409; UI мастера для решения возврата не найден. Дополнительно30 мёртвых toggles и оставшиеся ветви из [remaining-gaps](remaining-gaps.md). Поэтому это доказательство успешной базовой настройки без программиста, **не полного self-service PASS**.

## Отдельный smoke после последней product edit

[final57](final57.json) создал новую собственную `zavod_local02_admin01_fresh`: все57 unchanged migrations; strict diff0. [setup](clean-smoke-setup.json): до foundation22 identity/business counters0; затем только1 factory/1 ADMIN/1 UFA. Новые защищённые credentials и отдельный uploads-каталог остались вне workspace evidence/ZIP.

[final browser receipt](clean-smoke-ui.json): first recovery login → установка личного пароля → normal login на390px → Admin UI → bounded Department create → read/reload → edit → deactivate → три audit records того же ADMIN/factory. WebSocket connected; выбранные9 business counters после smoke0. [Скриншот](clean-smoke-admin-390.png).

**Не скрытая оговорка:** первый Department с техническим маркером `smoke` был создан, но не появился в ordinary runtime из-за существующего diagnostic filter. Его точная собственная запись деактивирована audited HTTP cleanup; это не UI edit PASS. Второй Department с обычным нейтральным именем прошёл весь UI цикл. В final smoke DB остаются **два неактивных отдела**, один ADMIN/нейтральный factory и нулевая проверенная рабочая активность. Ничего не удаляли и filter не ослабляли. Первоначальный locator timeout сохранён в receipt как история.

Final390 показывает ещё P2 legacy hint «скопируйте структуру завода4», хотя чистый target его не содержит. Это устаревшая подсказка, не требование создавать настоящий №4 и не доказательство готового clone flow.

После smoke его backend остановлен; C1 возвращён: [final-live-state](final-live-state.json), [runtime](runtime-readback.json). Native Windows smoke не проверяет Docker volumes/permissions, внешние HTTPS/WSS, Linux или restart VPS. Собственные ADMIN01 targets и audit/history сохранены отдельно, не переносятся на рабочую площадку.
