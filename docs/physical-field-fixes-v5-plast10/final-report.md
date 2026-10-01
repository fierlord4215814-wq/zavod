# PHYSICAL FIELD FIXES V5 — Пласт 10

Дата evidence: 12–13.08.2026.

## Итог

Admin control plane подтверждён настоящим browser integration slice: данные создавались через видимые формы, читались и изменялись через UI, использовались в рабочих модулях, затем штатно завершались, архивировались или soft-deactivate в dependency-aware порядке. Прямых Prisma writes в основном E2E и physical deletes не было.

## Админка и canonical owners

Проверены 14 фактических разделов: Обзор; Заводы; Пользователи и доступы; Отделы и службы; Должности и роли; Линии и позиции; Позиции на линиях; Шаблоны состава; Повременщики / рабочие зоны; Роли и права; Настройки модулей; Восстановление; Диагностика данных; Аудит действий админки.

Canonical owners:

- организация, доступы, recovery и audit — `AdminController` / `AdminService` и существующие Prisma entities;
- линии, позиции и состав — `LineService`, `LineStaffingTemplate` и items;
- Senior Master authority — `StaffingControlPolicyService`, factory scope, permissions и `JobTitle.parentJobTitleId`;
- consumers — существующие shift/assignment/checklist/chat/task/announcement contours.

Disconnected-разрыв был один: backend уже возвращал `diagnosticRecovery`, но UI его не показывал. Существующий endpoint теперь доступен через видимый диагностический список и штатное подтверждение восстановления. Декоративные локальные справочники не создавались.

## Staffing templates

ADMIN создаёт шаблон в разделе «Шаблоны состава»: выбирает линию, название, состояние и позиции с количеством, видит итог по плану, может редактировать, дублировать и сделать шаблон основным.

Старший мастер получает тот же scoped builder только когда backend подтверждает руководящую позицию через дерево должностей. Телефоны, имена, pilot id и названия отдела не используются как authority. Обычный MASTER и WORKER не видят mutation UI и получают запрет при прямом API. Cross-factory mutation запрещена.

Шаблон A×2 + B×1 + C×2 дал 5 canonical мест. Это подтверждено в Line/current Shift, slot-first и person-first assignment consumers; future shift picker увидел созданную линию. После cleanup default link очищен существующим service, шаблоны и позиции деактивированы без потери истории.

## Live integration

- Department: создан через UI, повторно открыт, использован заявкой, checklist и announcement audience, затем soft-deactivated.
- JobTitle: созданы parent MASTER и child WORKER, проверена hierarchy, затем child-first deactivation.
- User: создан штатной саморегистрацией, назначен через админку, прошёл block/unblock и access deactivate/restore; финально заблокирован, доступ отключён.
- Line/positions/templates: созданы и изменены через UI, использованы Line/Shift/Assignment/Future plan.
- Checklist: template создан, пользователь взял его в работу, выполнил focused runner; run завершён, template архивирован.
- Chat: закрытая группа с двумя участниками, realtime preview/unread/read без reload; чат архивирован, сообщения сохранены.
- Request: новый отдел доступен получателем; marker request завершён.
- Announcement: целевой отдел увидел и подтвердил, другой отдел не увидел; объявление архивировано.
- Audit: marker history сохранилась; после cleanup найдено 31 связанное audit-событие.
- Custom field/global notification: `NOT_APPLICABLE`, потому что отдельных live admin contours в v1.0 нет.

## Cleanup и post-cleanup

Marker: `__PFFV5_P10_1786494965172-19a73a__`.

Создано через UI: 11 сущностей/групп сущностей. Проверено: 9 post-cleanup reads, 7 updates, 8 cross-module consumers и 2 deny-набора.

Финальный operational inventory marker:

- active total: `0`;
- active users/accesses/departments/job titles/lines/positions/templates/checklists/chats/tasks/announcements/assignments/plans: `0`;
- physical deletes: `0`;
- pre-existing operational entities deleted: `0`;
- pre-existing operational entities unintentionally modified: `0`.

После cleanup повторно открыты Люди, Линии, Смена, Заявки, Чаты, Чек-листы, Уведомления, future shift picker, announcement editor и Audit. Marker line/department отсутствуют в active pickers. Broken active default staffing refs и orphan active template items: `0`.

Повторный Stage53 обновил timestamp блокировки только у собственной диагностической fixture `stage53-blocked-admin`; пользователь оставался заблокированным до и после. Рабочие/pilot пользователи не менялись.

## Исправления продукта

1. Добавлен общий backend policy для staffing control на базе существующей RBAC/job hierarchy.
2. ADMIN и scoped Senior Master подключены к одному canonical staffing builder/API.
3. В Data Hygiene UI показан существующий diagnostic recovery и добавлено штатное восстановление.
4. Полный management-список объявлений получает свежие записи независимо от приоритета старых записей.
5. Исправлена frontend route-restore race после входа.
6. Test marker detection ограничен отдельными токенами и не скрывает обычный текст с буквами `e2e`.
7. Уточнены accessible labels модальных подтверждений.
8. Завершены штатный chat archive UI и realtime обновление; UUID не показывается как основной пользовательский текст.

## Изменённые файлы Пласта 10

- `backend/package.json`
- `backend/scripts/physical-field-fixes-v5-plast10-inventory.js`
- `backend/scripts/physical-field-fixes-v5-plast10-regression.js`
- `backend/scripts/stage36-admin-ux-factory-rbac-regression.js`
- `backend/src/common/pilot-visibility.ts`
- `backend/src/modules/admin/admin.controller.ts`
- `backend/src/modules/admin/admin.module.ts`
- `backend/src/modules/admin/admin.service.ts`
- `backend/src/modules/announcements/announcements.service.ts`
- `backend/src/modules/chats/chats.service.ts`
- `backend/src/modules/line/line.module.ts`
- `backend/src/modules/line/line.service.ts`
- `backend/src/modules/line/staffing-control-policy.service.ts`
- `frontend/package.json`
- `frontend/e2e/physical-field-fixes-v5-plast10.spec.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/ActionModal.tsx`
- `frontend/src/screens/AdminConfigScreen.tsx`
- `frontend/src/screens/AnnouncementsScreen.tsx`
- `frontend/src/screens/ChatsScreen.tsx`
- `frontend/src/utils/pilot-ui.ts`
- файлы evidence в `docs/physical-field-fixes-v5-plast10/`.

Prisma schema и migration в Пласте 10 не менялись.

## Tests и screenshots

- Main E2E: PASS, 1 test, 2.8 min, desktop и 360/390/430 px.
- Backend P10: 15/0.
- Stage36: 22/0.
- Stage53: exit 0.
- Backend/frontend builds: exit 0.
- Prisma validate/status: valid/up to date, 52 migrations.
- Static/security scans: PASS.

Screenshots: `01`–`07` PNG в этой папке; машинный журнал — `test-artifacts.json`.

P0: 0.  
P1: 0.  
P2: 0 по продукту.

## Fresh physical runtime

Актуальные backend/frontend собраны из проверенного рабочего дерева и запущены отдельными процессами. Новый Quick Tunnel ведёт на frontend; `/api/health`, auth API и `/ws` работают через тот же HTTPS origin.

Внешний read-only smoke: frontend `200`; health `200/ok`; manifest `200`; service worker `200`; secure context `true`; ADMIN login `201`; «Завод 4» найден и выбран; `/auth/me` `200`; authenticated WSS получил `connected`; запросов к localhost/LAN из публичного bundle `0`; `storagePath`, `passwordHash`, credentials и token values в проверенном публичном ответе не обнаружены.

PUBLIC_HTTPS_URL: https://reload-layer-url-helping.trycloudflare.com  
PUBLIC_HEALTH_URL: https://reload-layer-url-helping.trycloudflare.com/api/health  
BACKEND_PID: 8684  
FRONTEND_PID: 13592  
TUNNEL_PID: 8828  
KEEP_AWAKE_PID: 4416  
SERVICE_WORKER_VERSION: zavod-shell-v6  
RUNTIME_STARTED_AT: 2026-08-13T09:58:10.2838484+03:00  
QR_PATH: C:\Users\79164\Documents\work\docs\physical-field-fixes-v5-plast10\physical-recheck-qr.png

Quick Tunnel временный и не имеет гарантии доступности. Для физической проверки компьютер и четыре указанных процесса должны оставаться включёнными.

FINAL_STATUS: PASS_WITH_PHYSICAL_PENDING  
PHYSICAL_RECHECK_STATUS: READY  
PHYSICAL_PHONE_GATE: PENDING
