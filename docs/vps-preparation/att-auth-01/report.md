# ATT-AUTH-01 — bounded PASS / STOP_FOR_REVIEW

27.09.2026. Три запрошенных file-authority разрыва закрыты после live before на **новой** owned копии T1. Canonical `work`, один writer; 2 existing backend owners +1 маленький общий predicate, 2 targeted tests. Frontend/auth resolver/roles/notification seams/schema не менялись. [Точная матрица owner→gap→fix→proof](authority-matrix.md), [source hashes/diff](source-checks.json), [план](plan.md).

## Фактически проверено

- [Live before](live-before.json): canonical ADMIN+guest; shared/чужой отдел Orders; запрещённый B replay через разрешённую A. Это настоящие HTTP/SQL, не выдуманный UserContext.
- [Orders 96 проверок](orders-matrix.json): три типа, current factory/department/role/guest/blocked/deleted/revoked/stale token, bytes SHA, archived read/write separation, HEAD/Range, lawful replay/no duplicate. [Внутренняя metadata binding parity](source-binding-after.json).
- [Семейная регрессия](families.json): positive + ADMINguest deny, Task/comment/chat/current membership, WORKER/CONTRACTOR ceiling, reference A/B/results/closed run, journal/quality/return/profile/wash/announcement. Pure archive-only permission case — **изолированный тест**, не новая live роль. Immutable handover file boundary — [HTTP persisted fixture](handover-boundary-after.json), не весь lifecycle.
- [UI 390/1440](ui.json): две страницы, source/file/реальные bytes, revoke/current WS, held real response не возвращает закрытое окно, old notice не предоставляет источник, восстановление доступа. [Мобильный viewer](ui-stock-390.png), [desktop](ui-stock-1440.png), [после смены отдела](ui-after-department-change-390.png).
- [Финальные проверки](final-checks.json): **48/48** attachment/security/archive, **121/121** TASK_NOTIFY/NOTIFY02/Orders/Task, **10/10** frontend navigation/WS, **41** foundation/auth; backend build/frontend typecheck PASS; Prisma validate/isolated generate/DMMF/57 checksums/strict diff0. Frontend build не менялся, прошлый build сохранён. До initial fix13 tests:12 fail/1 pass; до journal fix3 tests:2 fail/1 pass. J20 historical unrelated failure не переобъявлялся PASS и WORKER chats не разрешались.

Дополнительные проверки внутри порученного file-boundary выявили и закрыли: serializer metadata при неверном factory binding; ordinary file read для archive-only journal reader; upload/delete immutable handover. Они не меняют бизнес-логику Orders/ShiftLog, recipient policy или права источника.

## Сохранность и стенд

[Парная копия](copy.json), [ACL](acl-readback.json), [итог](final-state.json): **90 main tables /68 исходных attachments/68 файлов T1 unchanged**, user flags/UFA в копии восстановлены, original copied files exact, свои задачи/заказы/остатки завершены, lock waiters0, copy connections0. Тестовые файлы/история/isolated bindings сохранены. Handover fixture — уже сохранённая immutable сводка, не открытая операция; не архивировалась обходом канонического запрета.

Main T1 ACTIVE: [http://127.0.0.1:5173/](http://127.0.0.1:5173/), backend3000 PID26872, preview5173 PID27552, own PG15437 PID24212 на момент финальной сверки. Backend копии25192 остановлен; предыдущие backend21240/26936/15892 заменены с повторной identity-проверкой. Старый T1 backend26296/preview20508 штатно остановлены перед копированием, PG не останавливался. Последний [runtime receipt](../factory-01/runtime-20260927-150113-020.json) включён в review manifest. Использовать текущий безопасный helper, не сохранённые PID:

`./docs/vps-preparation/factory-01/stand.ps1 -Action Stop -Target T1`

Он повторно проверяет loopback/PID/createdUtc/executable/command/version/PGdata. Сейчас Stop не выполнялся: стенд оставлен пользователю.

## Честные границы evidence

Первый family harness ошибочно ожидал запрет **нового** эталона активного шаблона; production policy была верной. [Точная ссылка B восстановлена](reference-harness-recovery.json), новая synthetic фотография сохранена, архивные snapshots не изменены; prior failure receipt оставлен. Первый UI selector нашёл два законных уведомления (создание/закрытие); selector уточнён по title, повтор прошёл. Первый final-state selector обращался к несуществующему `OrderRequest.operationId`; исправлен только helper, повторная read-only сверка PASS. Эти наблюдения не скрыты и не выданы за product fixes.

TASK_CREATED и все6 NOTIFY02 durability fixes retained/accepted; исторический NOTIFY02 отчёт PARTIAL не переписан. V1/full roles/five live gates/063/policy/29 settings остаются вне этого bounded PASS. Не было большого SQL fault corpus на T1, нового завода/users/grants, физических удалений, рабочей БД/.env/uploads, WSL/VPN/UAC/Linux/VPS действий.

## Передача

Один [review ZIP](review-pack-attauth01-20260927.zip), [manifest](review-pack-manifest.json), [полный byte/SHA readback](review-pack-readback.json). Пакет self-contained для review исходников/изменений/доказательств, **не installer и не runtime backup**. Dump/uploads/secrets/credential index/dependencies/build binaries не включены. Для повторения live нужны existing canonical dependencies/builds и защищённая собственная тестовая среда.

```text
ATT_AUTH_STATUS=PASS
ADMIN_GUEST_DENIAL=PASS_LIVE
ORDER_REQUEST_SOURCE_PARITY=PASS_LIVE
MINIMUM_STOCK_ITEM_SOURCE_PARITY=PASS_LIVE
MOVEMENT_PARENT_AUTHORITY=PASS_LIVE
UPLOAD_REPLAY_AUTHORITY=LIVE_FIXED
LEGAL_ARCHIVE_READERS=PASS_LIVE_WITH_ISOLATED_ARCHIVE_ONLY_CASE
READ_WRITE_DELETE_SEPARATION=PASS_TARGETED
REVOKED_STALE_ACCESS=PASS_LIVE_AND_LATE_UI
OTHER_ATTACHMENT_REGRESSION=PASS_TARGETED_20_CASES
TASK_NOTIFY_AND_NOTIFY02=RETAINED_121_AFFECTED_TESTS_PASS
MIGRATIONS=57_UNCHANGED
TESTS_BUILDS=48_BACKEND_ATTACHMENT+121_RETAINED+10_FRONTEND+41_AUTH_PASS_BUILD_PRISMA_DIFF0
T1_PRESERVATION=90_TABLES_68_FILES_EXACT_ACTIVE
REVIEW_ZIP=review-pack-attauth01-20260927.zip; exact bytes/SHA in review-pack-readback.json
LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED
PHYSICAL_PHONE=PENDING
REAL_FACTORY_4=NOT_CONFIGURED
VPS_DEPLOYMENT=NOT_STARTED
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE
FINAL_STOP=STOP_FOR_REVIEW
```
