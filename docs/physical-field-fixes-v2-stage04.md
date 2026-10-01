# Physical Field Fixes V2 - Stage 04

## Итог

- `STAGE04`: **PASS_WITH_P2**.
- `REQUIREMENTS`: `L01-L33`, `M01-M29`, `N01-N16`.
- `CONSTRUCTOR_STATUS`: **RESTORED_CANONICAL**.
- `OLD_RUNNER_STATUS`: **DISCONNECTED**.
- `P0`: 0.
- `P1`: 0.
- `P2`: установленная PWA, физическая клавиатура Android и реальная камера требуют проверки на телефоне; browser-контракт и размеры 360/390 px проверены.

## Canonical constructor

- Восстановлен один редактор пунктов `ChecklistItemEditor`, подключённый к созданию, редактированию и копированию шаблона.
- Шаблон и его пункты сохраняются одной backend-транзакцией; активный пустой шаблон запрещён.
- Поддержаны существующие типы: да/нет, да/нет/не применимо, текст, обязательный комментарий, фото, обязательное фото, число, список и информационный пункт.
- Пункты можно добавлять, редактировать, переставлять и мягко отключать. Физического удаления истории нет.
- Старый metadata-first API сохранён совместимым: пустой шаблон создаётся только как выключенный черновик, первый активный пункт включает его.
- Общий `ActionModal` получил стабильные имена полей; отдельный form/theme-контур не создан.

## Selectors and RBAC

- Отделы берутся из canonical `Department`, дедуплицируются по id и нормализованному имени; одинаковые видимые варианты не повторяются.
- Поле линии называется «Привязать к линии» и показывает активные реальные линии выбранного завода независимо от рабочего статуса.
- Пустое значение означает отделовой шаблон; историческая ссылка сохраняется при редактировании.
- Backend независимо проверяет department scope, line factory scope и права управления шаблонами.
- Руководитель управляет своим отделом, ADMIN сохраняет полный сценарий, WORKER и чужой отдел получают запрет прямого API.

## Home and focused runner

- Главный экран содержит четыре кликабельных раздела: «В работе», «Доступные», «Просрочено», «Архив».
- Ниже показывается только выбранный список; старые дублирующие вкладки и блок «Скоро» отключены.
- Управление шаблонами перенесено во вторичные действия.
- Runner показывает один пункт, тонкий прогресс, один ответ и компактную строку цикла. На mobile скрыта крупная номерная навигация.
- Ответ сохраняется при переходе «Дальше → Назад»; завершённый цикл не закрывает периодический run.
- Periodic lifecycle, напоминания, границы смены и запрет переноса в handover сохранены существующим backend-контуром.

## Дополнительный подтверждённый дефект

- Библиотека включала архив и сортировала `archivedAt ASC`. В PostgreSQL `NULL` оказывался после дат, поэтому лимит мог заполняться архивом, а свежие активные шаблоны исчезали из UI.
- Порядок исправлен на явный `NULLS FIRST`; targeted regression подтверждает присутствие свежего активного шаблона в ограниченном ответе.
- Данные, audit и архивные записи не переписывались.

## Изменённые файлы

- `backend/src/modules/checklists/checklists.service.ts`
- `backend/src/modules/checklists/checklists.controller.ts`
- `backend/scripts/checklist-workflow-v1-regression.js`
- `backend/scripts/physical-field-fixes-v2-stage04-regression.js`
- `backend/package.json`
- `frontend/src/components/ActionModal.tsx`
- `frontend/src/components/ChecklistItemEditor.tsx`
- `frontend/src/screens/ChecklistsScreen.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v2-stage04.spec.ts`
- `frontend/scripts/physical-field-fixes-v2-stage04-e2e.js`
- `frontend/package.json`
- `docs/physical-field-fixes-v2-stage04.md`
- `codex_zavod_physical_field_fixes_v2/progress.md`

## Backend changes

- Nested create/update/duplicate используют существующие `ChecklistTemplate` и `ChecklistTemplateRow`.
- Restore активного шаблона без активных пунктов запрещён.
- Omitted rows при update деактивируются, но не удаляются.
- Library ordering отдаёт unarchived templates перед архивным хвостом.
- Существующие guards, factory scope и department scope не ослаблялись.

## Migrations

- Новых migration нет.
- `prisma validate`: PASS.
- `prisma migrate status`: 45 migrations, database schema up to date.

## Targeted tests

- Backend build: PASS.
- Frontend production build: PASS; только известное предупреждение Vite о размере chunk.
- `physical-field-fixes:v2-stage04-regression`: PASS, 15/15.
- `physical-field-fixes:v2-stage04-e2e`: PASS, 6/6 desktop/mobile.
- Stage13 checklist regression: PASS.
- Stage44 checklist UX regression: PASS, 27/27.
- Stage50 checklist library/archive regression: PASS, 22/22.
- Stage64 checklist workflow regression: PASS, 15/15.
- Stage65 checklist UX regression: PASS, 13/13.
- Periodic lifecycle regression: PASS.
- `checklist-workflow:v1-regression`: PASS, 79/79. Fixture теперь учитывает штатное окно передачи смены; product guard не ослаблялся.
- Department-first checklist regression: PASS, 16/16.
- Browser E2E проверяет create/edit/duplicate после reload, уникальность отделов, четыре списка, сохранение ответа Back/Next, 360 и 390 px.
- Временные E2E-шаблоны штатно архивированы; активных временных run не осталось.
- Browser `prompt/alert/confirm`: не найден.
- Mojibake в изменённых файлах: не найден.
- Secret scan: единственное совпадение находится в защитном regex regression; значений секретов, `storagePath`, `passwordHash` и token values в публичных payload нет.

## Screenshots

- `docs/physical-field-fixes-v2-screenshots/stage04/desktop-edge-home.png`
- `docs/physical-field-fixes-v2-screenshots/stage04/desktop-edge-builder.png`
- `docs/physical-field-fixes-v2-screenshots/stage04/desktop-edge-library.png`
- `docs/physical-field-fixes-v2-screenshots/stage04/desktop-edge-runner.png`
- `docs/physical-field-fixes-v2-screenshots/stage04/mobile-360-edge-home.png`
- `docs/physical-field-fixes-v2-screenshots/stage04/mobile-360-edge-builder.png`
- `docs/physical-field-fixes-v2-screenshots/stage04/mobile-360-edge-library.png`
- `docs/physical-field-fixes-v2-screenshots/stage04/mobile-360-edge-runner.png`
- `docs/physical-field-fixes-v2-screenshots/stage04/mobile-390-edge-runner.png`

360/390: PASS, horizontal overflow отсутствует. Физический телефон: `PENDING`.

## Runtime

- Backend: `http://127.0.0.1:3000/health`, PID `18420`, status `ok`.
- Frontend E2E web server был временным и остановлен runner-скриптом; финальный runtime будет поднят в Stage05.

`NEXT_SAFE_STAGE`: **05**.
