# Stage61 — Admin Russian Localization Hardening

## Discovery result

Админка уже имела рабочие контуры Stage53/56/57/58/59/60: контекст выбранного завода, русские секции, права, настройки модулей, экспорт/импорт конфигурации, проверку готовности и Центр восстановления. Миграция не потребовалась: проблема была не в данных, а в человекочитаемом отображении.

Найденные источники английского/technical текста:

- fallback `permissionLabel()` переводил неизвестные части permission code как английские слова;
- backend отдавал `Permission.description` из seed на английском (`Read`, `Manage`, `View`, `Create`);
- `moduleSettings.summary` в factory context отдавал camelCase ключи настроек;
- factory setup/export/import показывали `skillCode`, `foundation`, `permission presets`, `stable localKey`, `factory-config-v1`, `Stage58`;
- админский audit summary мог показывать query-параметры `factoryId/includeArchive`, `schemaVersion` и технические action/entity labels;
- часть safe-modal placeholders была mojibake в виде набора знаков вопроса.

## Migration

Миграция не нужна. Существующие таблицы, роли, права, UserFactoryAccess, audit и recovery не менялись.

## What changed

- Расширены русские labels для всех permission codes, которые backend сейчас отдаёт через `/admin/permissions`.
- Fallback неизвестного права теперь не выводит английские части кода как primary UI text.
- Описания прав в UI берутся из русской карты/русского fallback, а английские backend descriptions не показываются обычному админу.
- Backend `factoryContext.moduleSettings.summary` теперь отдаёт русские названия настроек вместо camelCase.
- Factory setup/export/import тексты очищены от `skillCode`, `foundation`, `permission presets`, `stable localKey`, `factory-config-v1`, `Stage58`.
- Админский audit summary маскирует technical query names и русифицирует типы/действия для UI.
- Исправлены mojibake placeholders причин в dangerous action modals.

## Advanced mode

Technical permission code остаётся доступен только через кнопку `Расширенно`. Это диагностический режим для администратора/поддержки, не основной текст матрицы прав.

## Screenshots

Скриншоты Stage61:

- `docs/stage61-admin-russian-localization-screenshots/01-permissions-russian-desktop.png`
- `docs/stage61-admin-russian-localization-screenshots/02-permissions-advanced-codes-desktop.png`
- `docs/stage61-admin-russian-localization-screenshots/03-module-settings-russian.png`
- `docs/stage61-admin-russian-localization-screenshots/04-config-health-russian.png`
- `docs/stage61-admin-russian-localization-screenshots/05-export-import-russian.png`
- `docs/stage61-admin-russian-localization-screenshots/06-recovery-center-russian.png`
- `docs/stage61-admin-russian-localization-screenshots/07-mobile-admin-overview-russian.png`
- `docs/stage61-admin-russian-localization-screenshots/08-mobile-permissions-russian.png`

## Checks

Новые проверки:

- `stage61:admin-russian-localization-regression`;
- `stage61:browser-e2e`.

Playwright проверяет реальный `body.innerText()` ключевых секций админки и mobile 360px, а не только grep по исходникам.

## Security / RBAC

Backend guards, UserFactoryAccess, factory scope, blocked/cross-factory policy не менялись. Stage61 не расширяет доступы и не скрывает backend errors frontend-only.

API/UI по-прежнему не должны отдавать обычному пользователю:

- `storagePath`;
- `passwordHash`;
- tokens/secrets;
- raw permission codes как primary labels.

## Future

- Если в seed появятся новые permission codes, нужно добавить русские labels/descriptions в `frontend/src/utils/pilot-ui.ts`.
- Можно вынести permission dictionary в общий backend/frontend config, но это отдельный этап, чтобы не смешивать локализацию с архитектурой RBAC.
