# ZAVOD v1.0 - Multi-Factory TECH Live Proof

Дата проверки: 05.09.2026 (Europe/Moscow).

## Итог

ZAVOD_MULTI_FACTORY_TECH_STATUS: PASS

PRODUCT_CHANGES_REQUIRED: YES

CANONICAL_FACTORY_ACCESS_OWNER: `UserFactoryAccess` + `UserContextService` + `AuthService` + guarded methods `AdminService`

CANONICAL_EFFECTIVE_PERMISSION_OWNER: `resolveEffectivePermissions` -> `UserContext.permissions[]`

CANONICAL_TASK_ROUTING_OWNER: `TaskService`; source authority is `Task.factoryId`, recipients are resolved through the existing task recipient/service relation

CANONICAL_NOTIFICATION_OWNER: `NotificationsService`

CANONICAL_REALTIME_OWNER: `WsService`, one existing `/ws` connection model

ADMIN_MULTI_FACTORY_CONFIGURATION: PASS

ARBITRARY_SUBSET: PASS

TECH_ROLE_IMPLIES_ALL_FACTORIES: NO

ALLOWED_FACTORIES_TESTED: МФ Сервис А / МФ Сервис В / МФ Сервис Г (logical A/C/D)

FORBIDDEN_FACTORY_TESTED: МФ Сервис Б (logical B)

SELECTED_FACTORY_ISOLATION: PASS

REMOTE_URGENT: PASS

REMOTE_LONG: PASS

SOURCE_FACTORY_PROVENANCE: PASS

SAFE_NOTIFICATION_FACTORY_SWITCH: PASS

FORBIDDEN_FACTORY_SELECTOR: PASS

FORBIDDEN_FACTORY_API: PASS

FORBIDDEN_FACTORY_REALTIME: PASS

FORBIDDEN_FACTORY_NOTIFICATION: PASS

FORBIDDEN_FACTORY_ATTACHMENT: PASS

FORBIDDEN_DEEP_LINK_BYPASS: PASS

INDEPENDENT_UFA_REVOKE: PASS

REVOKE_BEFORE_CLICK: PASS

EFFECTIVE_ALLOW_DENY: PASS

TASK_HISTORY_FACTORY_IDENTITY: PASS

AUDIT_FACTORY_IDENTITY: PASS

NEW_TECH_FACTORY_MAP: NO

NEW_RBAC: NO

NEW_NOTIFICATION_OWNER: NO

NEW_REALTIME_OWNER: NO

GLOBAL_TECH_ALL_FACTORIES: NO

MIGRATION: NOT_REQUIRED

## Закрытые дефекты

1. Админский список пользователей выбранного завода включал историческую неактивную `UserFactoryAccess` как текущую и мог показывать одного человека дважды. Обычная выборка теперь учитывает только активный доступ; отдельный guarded-контур кандидатов сохраняет возможность восстановить существующую запись без дубля.
2. Админка не давала практично выбрать пользователя другого управляемого завода для выдачи доступа к текущему выбранному заводу. Добавлен ограниченный список кандидатов только из заводов, где актор имеет активную роль `ADMIN`; целевой завод жёстко совпадает с текущим admin-контекстом.
3. Профиль пользователя показывал доступ только выбранного завода. Теперь Admin видит сосуществующий набор доступов в пределах управляемых им заводов.
4. После выдачи или независимого отзыва доступа auth-change адресовался одному factory-контексту. Теперь существующий владелец realtime инвалидирует authority cache пользователя глобально, после чего `/auth/me` возвращает актуальный A/C/D или A/D набор.
5. В карточке удалённого уведомления не было стабильной человекочитаемой provenance. Теперь UI показывает название исходного завода; raw id не используется как основной текст.

Архитектурные владельцы, модель ролей, task routing, notification owner и realtime owner не менялись.

## Изменённые файлы

PRODUCT_FILES_CHANGED:

- `backend/src/modules/admin/admin.service.ts`
- `frontend/src/screens/AdminConfigScreen.tsx`
- `frontend/src/screens/NotificationsScreen.tsx`

TEST_FILES_CHANGED:

- `backend/scripts/multi-factory-tech-live-proof-regression.js`
- `frontend/e2e/multi-factory-tech-live-proof.spec.ts`
- `backend/scripts/notification-authority-source-navigation-regression.js` (старый fixture переведён на текущий Bearer login; security assertions не ослаблены)

EVIDENCE_FILES_CREATED:

- `docs/multi-factory-tech-live-proof/final-report.md`
- `docs/multi-factory-tech-live-proof-screenshots/`

## Проверки

TARGETED_BACKEND: PASS - 47 passed, 0 failed. Проверены Admin multi-UFA, A/C/D subset, idempotent restore, URGENT/LONG, selected-factory isolation, B API/attachment/deep-link deny, effective allow/deny, revoke lifecycle, history и audit.

TARGETED_REALTIME: PASS - удалённые C URGENT/LONG доставлены персональному TECH-сеансу в A с source C; B metadata не доставлены; новый C socket запрещён после revoke; существующий authority cache инвалидирован.

TARGETED_NOTIFICATIONS: PASS - source provenance, safe switch, forged B filtering и revoke-before-click доказаны; существующий `notification-authority-source-navigation-regression` также прошёл без failed checks.

TARGETED_BROWSER: PASS - 2 passed, 0 failed: desktop 1440x960 и mobile 390x844. Видимый путь Admin config -> TECH A/C/D -> remote C URGENT/LONG -> safe C open -> revoke C -> A/D only; B отсутствует. Горизонтального overflow нет.

SECURITY_PRIVACY: PASS - 17 passed, 0 failed. Product UI files не содержат protected-field ссылок; server matches являются redaction/serialization guards, test matches являются отрицательными assertions. Mojibake не найден; единственное текстовое совпадение находится внутри защитного regex. `prompt`/`alert`/`confirm` не добавлены.

BACKEND_BUILD: PASS

FRONTEND_BUILD: PASS - только известные неблокирующие предупреждения Vite о CJS API и размере chunk.

PRISMA_VALIDATE: PASS

PRISMA_MIGRATE_STATUS: PASS - 53 migrations, database schema is up to date.

SCRIPT_SYNTAX: PASS - оба изменённых backend runner прошли `node --check`.

RUNTIME_HEALTH: PASS - свежий production backend ответил `status=ok`.

## Cleanup

ACTIVE_TEST_USERS_AFTER_CLEANUP: 0

ACTIVE_TEST_UFA_AFTER_CLEANUP: 0

ACTIVE_TEST_FACTORIES_AFTER_CLEANUP: 0

ACTIVE_TEST_TASKS_AFTER_CLEANUP: 0

ACTIVE_TEST_ATTACHMENTS_AFTER_CLEANUP: 0

OTHER_ACTIVE_TEST_ARTIFACTS_AFTER_CLEANUP: 0

PHYSICAL_DELETES: 0

PREEXISTING_OPERATIONAL_CHANGED: 0

Factory 4 и существующие операционные данные не использовались как disposable fixtures. Cleanup выполнен через штатную деактивацию; история физически не удалялась.

## Evidence

- Backend result: `.codex-runtime/multi-factory-tech-live-proof/backend-result.json`
- Desktop result: `.codex-runtime/multi-factory-tech-live-proof/desktop-edge-browser-result.json`
- Mobile result: `.codex-runtime/multi-factory-tech-live-proof/mobile-360-edge-browser-result.json`
- Desktop/mobile cleanup: `.codex-runtime/multi-factory-tech-live-proof/*-cleanup.txt`
- Screenshots: `docs/multi-factory-tech-live-proof-screenshots/`

PHYSICAL_ANDROID_PUSH: PENDING

NEW_OUT_OF_SCOPE_FINDINGS: NONE

FINAL_STOP: STOP - do not start Scheduler, Load/Capacity, F-08, Final Acceptance or Physical Android/PWA Goal.
