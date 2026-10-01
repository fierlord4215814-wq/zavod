# FACTORY01_STRUCTURE_MATRIX

27.09.2026. Только собственная Windows functional БД. Источник: [Admin UI→HTTP→SQL](structure.json), [пользователи](users.json), [исправленные и повторно сверенные ФИО](names-reconciled.json), [финальная сохранность](final-live-state.json). Создание SQL/seed вместо Admin не использовалось; SQL ниже — проверка результата.

| Объект / владелец | Что создано | Проверка потребителя и запретов | Результат |
|---|---|---|---|
| Чистая основа / Prisma migrations, foundation, AuthService | Отдельный кластер PostgreSQL18.3/15437;57 migrations; bootstrap factory, ADMIN, UFA;19 бизнес-счётчиков0 | [C0 SQL](c0-setup.json), [ротация, два обычных входа,13 экранов/HTTP/WS](c0-browser.json); demo seed не запускался | PASS C0_WINDOWS_FUNCTIONAL; первоначальный desktop screenshot переходный, не visual PASS |
| T1 / AdminConfigScreen→AdminController/AdminService→Factory | «УЧЕБНЫЙ ЗАВОД T1», `test-factory-t1`, ACTIVE | Обычный factory picker всех ролей; чужой bootstrap403/скрытые объекты; native restart/restore | PASS |
| Отделы / Department |11:4 LOCAL (производство, ОКК, склад, руководство),7 GLOBAL (5 tech, технологи, другие службы) | Правильная shared-service модель; не выдаётся автоматический доступ на другой завод | PASS; повторный Б не создавался |
| Линии / Line | УЧ-Линия1–4 | MASTER/current/future/task/wash/defrost; чужой factory deny; финально4 STOP | PASS |
| Позиции / Position, staffing template |12 (3/линию),4 default templates | Настоящие slot selector и планирование, свободные места/занятые; не hardcoded обход guards | PASS |
| Должности / JobTitle |15 synthetic; роли не заменены должностями | MASTER→старший WORKER→WORKER;2 cycle409; пользователи связаны с должностями | PASS |
| Подрядчик / Company, companyId |«УЧЕБНЫЙ ПОДРЯДЧИК T1», lead+2 CONTRACTOR | UI arrival, назначение, release/STOP; компания не превращена в отдел | PASS структуры; полный company-approval UI не принят |
| Пользователи / User, UserFactoryAccess |30 synthetic non-ADMIN+1 ADMIN;14/14 non-ADMIN roles |30 точных ФИО повторно сверены;31 active UFA,0 blocked/guest в T1; уникальные секреты вне repo/ZIP | PASS создания/входа, не автоматический PASS всех ролей |
| WORKER / Shift/Assignment/PlannedLineAssignment |12, по3 логических участника на каждую из4 линий;8 current+4 future | Current/future не смешаны;4 «Я буду»,4 плановых назначения,1 снято;3 будущих активны | PASS; это учебный сценарий, не штатное расписание реального завода |
| Навыки / UserSkill, UserSkillCredit |12 начальных line/position combinations +5 дополнительных; edit/deactivate; automatic credit | DIRECT/SIMILAR/NONE — подбор по опыту; не квалификационный hard guard | PASS current model; отдельного каталога5 произвольных квалификаций нет |
| Чек-листы / Template/Run/Row/Attachment |3 согласованных названия, первый10 пунктов;9 типов; отдельные reference/result files |3 одновременных разных автора;7 CLOSED runs в итоговой основе; immutable старых эталонов | PASS practical |
| Технический запас / MinimumStockItem/Movement |5 items; итог3/9/10/10/10, двигатель в архиве;7 точных movements |10→7→10→3, concurrency201/409; расходник10→9→10; не ERP | PASS |
| Сохранность / существующие pg_dump/pg_restore, guarded files |90 public таблиц,57 checksums,68 bindings/68 физических файлов | Native3-process restart, quiescent pair, новый restore target,6 обычных ролей | PASS Windows, не Linux/Compose |

Bootstrap «УЧЕБНАЯ ОСНОВА FACTORY01» не производственная площадка, operational history в неё не импортирована. Старые C1/B/C остались в прежнем, отдельно сохранённом target; они не подключались для новых операций. Настоящий №4 не создавался.

Final safe idle:0 текущих assignments/sessions,0 незавершённых tasks/runs; T1 и31 пользователь активны. Файлы/история/планы сохранены. См. [manual review](manual-review.md).
