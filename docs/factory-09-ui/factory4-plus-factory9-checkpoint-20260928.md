# Исходный №4 и будущий №9 в одной системе — read-only checkpoint

28.09.2026, проверка после уточнения пользователя. Новый маршрут: **сохранённый №4 → после безопасной подготовки создать №9 через админку той же системы**. Отдельная FACTORY09 больше не является целью бизнес-наполнения. Снимки из `ZAVOD_FACTORY4_PLUS_FACTORY9_SCOPE_CORRECTION.zip` поверх `work` не накладывались. Это проверка источника и границ, не запуск старого приложения и не создание №9.

## Точная идентичность локального источника

| Признак | Read-only результат |
|---|---|
| Конфигурация канонического приложения | `backend/.env` (mtime 14.06.2026) указывает `localhost:5432/mes`; значения credentials не выводились. `FILE_STORAGE_ROOT=C:\Users\79164\Documents\work\uploads`. |
| Windows PostgreSQL | Служба `postgresql-x64-18` работает из `C:\Program Files\PostgreSQL\18\data`; listener `5432` принадлежит её `postgres.exe`. SQL соединение: `current_database=mes`, server address `::1`, port `5432`, PostgreSQL `18.3`. `data_directory` SQL-role не вправе читать; соответствие каталога установлено по Windows service metadata, не выдаётся за SQL readback. |
| Завод | Ровно проверенный `code=factory-4`, `name=Завод 4`, `id=537cbb48-7fba-48b6-80af-659f82cdaeb3`, active. Создан 05.05.2026. Его `code` и исходная БД соответствуют прежним `full-ui-interaction-sweep`/pilot-отчётам. Это сильный локальный кандидат на прежний №4; другое удалённое место не исследовалось. |
| Существующий ADMIN | В №4 две активные негостевые ADMIN UFA: `test-admin` и `pilot-pack-admin`. Последний соответствует ранее указанному пользователем номеру с окончанием `9009`; у него установлен пароль (только boolean, hash не читался), `passwordResetRequired=false`, blocked/deleted=false. Обычный вход в этой проверке **не выполнялся**. Личный ADMIN из отдельной FACTORY09 не переносился. |
| Структура и история №4 | `2451` не удалённых User с base factory №4; `1870` distinct active UFA; `21` активная Line, `185` Department, `348` JobTitle, `354` ShiftSession, `709` Assignment, `860` Task, `1552` ChecklistRun, `2076` активных Attachment. Это число **записей**, не доказанный реальный штат. В общей `mes` всего `711` Factory (`130` active), много test/fixture истории; не объявлять её чистой производственной БД. |
| Файлы | Настроенный root существует: `2260` файлов, `32 337 100` bytes. Из `2076` активных Attachment №4 `2076` путей относительные и внутри root; `1970` файлов присутствуют с совпадающим `sizeBytes`, **106 отсутствуют**. Причина/давность отсутствия не определены; файлы и строки не менялись. Это не proof полного сохранения вложений. |
| Другие процессы | На момент проверки `mes` не имела иных SQL-сессий кроме read-only probe. Порты backend `3000` и frontend `5173` всё ещё принадлежат отдельной FACTORY09, не старому №4. Это моментальный срез, не гарантия отсутствия будущего writer. |

## Несовместимость со свежим кодом — зависимая UI-ветвь STOP

В каноническом `backend/prisma/migrations` — `57` SQL миграций. В `mes` ровно `53` успешно применены; их имена и SHA-256 совпадают с source. В таблице также `5` исторических rolled-back записей и `0` unresolved. Четыре source migration **не применены**:

1. `20260620122500_vps_prep_permission_catalog` (системный каталог прав);
2. `20260922190000_vps_prep_01_auth_recovery`;
3. `20260923193000_local01_schema_contract_reconciliation`;
4. `20260924190000_local02_chat_and_checklist_reference`.

Фактический SQL schema readback подтверждает отсутствие `SystemFoundationState`, `User.passwordRecoveryHash`, `ChecklistRunRow.referenceAttachmentId` и `OrderSettings_factoryId_fkey`. Поэтому текущий backend после этих миграций **не подтверждён совместимым** с `mes`; его запуск на ней недопустим как read-only операция и может включить scheduler. `migrate deploy`, schema repair, seed, restore, перенос людей/паролей и прямые business writes **не выполнялись**. Отдельная FACTORY09 с 57/57 не доказывает готовность старой базы.

Перед изменением исходной `mes` требуется согласованная недеструктивная копия **вместе** с `work/uploads` и защищённой конфигурацией, проверка восстановимости на независимой цели и отдельное решение по безопасному обновлению схемы/кода. Известный небезопасный backup/restore путь не применялся. Старого текущего полного отпечатка DB+uploads до этой проверки нет: counts и сегодняшние 1970/2076 не доказывают byte-неизменность с прежних дат; T1 `FAILED` остаётся отдельной историей.

## Отдельная FACTORY09 — сохранена, но не источник №4

Fresh `runtime.ps1 -Action Status` в 14:47:33 UTC: свой PG `127.0.0.1:15439` (`zavod_factory09_ui01`), backend `3000`, frontend `5173`; остановка и переключение не выполнялись. До поправки цели браузер показал обычный онлайн-экран технического ADMIN на bootstrap-основе; после личного шага пользователя read-only SQL показывает один технический Factory/ADMIN, один установленный личный пароль и один `FIRST_ADMIN_RECOVERY_REISSUED` audit, но Line/JobTitle/ChecklistRun `0/0/0`. Этот успешный вход **не является** входом старого ADMIN №4. Настоящего №9 там не создано. Файл кода и пароль не включены в этот checkpoint. Кодовые recovery/checklist fixes и старые review ZIP не откатывались.

```text
CURRENT_INTENT=EXISTING_FACTORY4_PLUS_NEW_FACTORY9_IN_SAME_DB
SOURCE_FACTORY4=LOCAL_MES_CONFIRMED_CANDIDATE
SOURCE_ADMIN=DB_ACCESS_CONFIRMED_NORMAL_LOGIN_NOT_RUN
SOURCE_PRESERVATION=COUNTS_AND_FILE_METADATA_ONLY_NOT_EXACT_HISTORY_PROOF
SOURCE_ATTACHMENTS=1970_PRESENT_106_MISSING_OF_2076_ACTIVE
SCHEMA_COMPATIBILITY=FAIL_53_OF_57_APPLIED_4_STRUCTURAL_OR_CATALOG_GAPS
SAFE_PAIRED_BACKUP=NOT_DONE
FACTORY09_BUSINESS_FILL=PAUSED_NO_FACTORY9_CREATED
FACTORY9_IN_ORIGINAL_DB=NOT_CREATED
ORIGINAL_APP_START=NOT_RUN
T1_TOUCHED=NO
VPS_R2_R5_MAIN_SWEEP=NOT_RESUMED
FINAL_STOP=STOP_BEFORE_SOURCE_DB_BACKUP_SCHEMA_CHANGE_OR_UI_WRITE
```
