# Review ZIP — FACTORY9-SHIFT-AND-MULTIFACTORY-05

В пакете: этот файл, `report.md`, `actor-factory-action.md`, `test-and-runtime-evidence.md`; UI-снимки manager-before, return-after-relogin, kipia-grant-restored, двух экранов общей смены, исходных/архивных заявок и архивного чек-листа; полные `source-before/` и `source-after/` только точных изменённых исходников и тестов; `source-before-after.patch`; `manifest.json` с SHA-256 каждого payload. `source-after/` включает новые targeted/SQL scripts. Исходники BEFORE сняты в защищённую предзапись до правок. Рабочие `.env`, DATABASE_URL, dump, JWT, passwords, cookies, uploads, пути хранения файлов и чужие данные в ZIP не входят.

Состояние пакета — **финальный локальный PARTIAL**: UI-гранты/отзыв/возврат и две cross-factory Task, одна общая смена на экранах «Смена», возврат и архив подтверждены. Единых чатов служб нет; экран «Люди» №9 неверно показывает shared presence; SQL race/fault и некоторые negative/two-window проверки не выполнены. Наличие ZIP не означает допуск пилота.

